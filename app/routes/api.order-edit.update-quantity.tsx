import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { addOrderTags } from "../utils/orderTagsHelper.server";
import { trackOrderEdit } from "../utils/analyticsHelper.server";
import { checkOrderEditLimit } from "../utils/editLimitHelper.server";


export async function loader({ request }: LoaderFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);
  return cors(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  if (request.method === "OPTIONS") {
    return cors(
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  const body = await request.json();
  const { orderId, lineItemId, quantity, source } = body || {};

  if (!orderId || !lineItemId || quantity === undefined) {
    return cors(
      Response.json(
        { userErrors: [{ message: "Missing orderId, lineItemId, or quantity." }] },
        { status: 400 },
      ),
    );
  }

  const { isLimitReached, maxEdits } = await checkOrderEditLimit({ shop: storeDomain, orderId });
  if (isLimitReached) {
    return cors(
      Response.json(
        {
          userErrors: [
            { message: `You have reached the maximum allowed edits (${maxEdits} edits) for this order.` },
          ],
        },
        { status: 422 },
      ),
    );
  }

  // Ensure lineItemId is formatted as a CalculatedLineItem GID
  const calculatedLineItemId = lineItemId.replace("LineItem", "CalculatedLineItem");

  try {
    let actualQuantity = Number(quantity);
    let quantityMessage: string | null = null;

    if (actualQuantity > 0) {
      try {
        const lineItemRes = await admin.graphql(
          `#graphql
          query GetLineItemVariant($id: ID!) {
            order(id: $id) {
              lineItems(first: 100) {
                nodes {
                  id
                  currentQuantity
                  quantity
                  variant {
                    id
                    inventoryQuantity
                  }
                }
              }
            }
          }`,
          { variables: { id: orderId } },
        );
        const lineItemJson = await lineItemRes.json();
        const rawLineItemId = lineItemId.replace("CalculatedLineItem", "LineItem");
        const node = lineItemJson.data?.order?.lineItems?.nodes?.find(
          (n: { id: string }) => n.id === rawLineItemId || n.id === lineItemId,
        );
        const currentQty = node?.currentQuantity ?? node?.quantity ?? 0;
        const invQty = node?.variant?.inventoryQuantity;

        if (typeof invQty === "number") {
          const maxAllowed = currentQty + invQty;
          if (actualQuantity > maxAllowed) {
            if (invQty <= 0) {
              return cors(
                Response.json(
                  {
                    userErrors: [
                      {
                        message: `This product is not available in the required quantity of ${actualQuantity}. No additional stock is available in store (you already have all ${currentQty} units in your order).`,
                      },
                    ],
                  },
                  { status: 422 },
                ),
              );
            }
            return cors(
              Response.json(
                {
                  userErrors: [
                    {
                      message: `This product is not available in the required quantity of ${actualQuantity}. Only ${invQty} additional units are available in stock. The quantity has been adjusted to ${maxAllowed}. Click 'Save quantity' again to confirm.`,
                    },
                  ],
                },
                { status: 422 },
              ),
            );
          }
        }
      } catch (e) {
        console.warn("Server inventory check skipped:", e);
      }
    }

    // Step 1: begin the edit session
    const beginResponse = await admin.graphql(
      `#graphql
      mutation OrderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: orderId } },
    );

    const beginJson = await beginResponse.json();
    const beginErrors = beginJson.data?.orderEditBegin?.userErrors ?? [];
    if (beginErrors.length) {
      return cors(Response.json({ userErrors: beginErrors }, { status: 422 }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;

    // Step 2: set the quantity (restock removed quantity back to inventory)
    const updateResponse = await admin.graphql(
      `#graphql
      mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId, lineItemId: calculatedLineItemId, quantity: actualQuantity, restock: true } },
    );
    const updateJson = await updateResponse.json();
    const updateErrors = updateJson.data?.orderEditSetQuantity?.userErrors ?? [];
    if (updateErrors.length) {
      return cors(Response.json({ userErrors: updateErrors }, { status: 422 }));
    }

    // Step 3: commit
    const commitResponse = await admin.graphql(
      `#graphql
      mutation OrderEditCommit($id: ID!) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: "Quantity updated via customer account") {
          order {
            id
            name
            statusPageUrl
            totalOutstandingSet {
              shopMoney { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId } },
    );
    const commitJson = await commitResponse.json();
    const commitErrors = commitJson.data?.orderEditCommit?.userErrors ?? [];
    if (commitErrors.length) {
      return cors(Response.json({ userErrors: commitErrors }, { status: 422 }));
    }

    const order = commitJson.data.orderEditCommit.order;
    const balanceDue = order?.totalOutstandingSet?.shopMoney ?? null;

    // Determine if the merchant owes the customer a refund
    // (negative outstanding balance after a quantity decrease).
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);

    // Track order edit and feature usage
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "edit-quantity",
      source,
    });

    return cors(Response.json({ order, balanceDue, quantityMessage, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-edit] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({ userErrors: [{ message }] }, { status: 500 }));
  }
}
