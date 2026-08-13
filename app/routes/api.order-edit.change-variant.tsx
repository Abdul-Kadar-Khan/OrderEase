import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { addOrderTags } from "../utils/orderTagsHelper.server";
import { trackOrderEdit } from "../utils/analyticsHelper.server";


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
  const { orderId, oldLineItemId, newVariantId, quantity, source } = body || {};

  if (!orderId || !oldLineItemId || !newVariantId || quantity === undefined) {
    return cors(
      Response.json(
        { userErrors: [{ message: "Missing orderId, oldLineItemId, newVariantId, or quantity." }] },
        { status: 400 },
      ),
    );
  }

  const calculatedLineItemId = oldLineItemId.replace("LineItem", "CalculatedLineItem");

  try {
    // Step 1: begin
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
    if (beginJson.data?.orderEditBegin?.userErrors?.length) {
      return cors(Response.json({ userErrors: beginJson.data.orderEditBegin.userErrors }, { status: 422 }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;

    // Step 2: Set quantity to 0 (remove old variant)
    const removeResponse = await admin.graphql(
      `#graphql
      mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId, lineItemId: calculatedLineItemId, quantity: 0 } },
    );
    const removeJson = await removeResponse.json();
    if (removeJson.data?.orderEditSetQuantity?.userErrors?.length) {
      return cors(Response.json({ userErrors: removeJson.data.orderEditSetQuantity.userErrors }, { status: 422 }));
    }

    // Step 3: Add new variant
    const addResponse = await admin.graphql(
      `#graphql
      mutation OrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId, variantId: newVariantId, quantity: Number(quantity) } },
    );
    const addJson = await addResponse.json();
    if (addJson.data?.orderEditAddVariant?.userErrors?.length) {
      return cors(Response.json({ userErrors: addJson.data.orderEditAddVariant.userErrors }, { status: 422 }));
    }

    // Step 4: commit
    const commitResponse = await admin.graphql(
      `#graphql
      mutation OrderEditCommit($id: ID!) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: "Variant changed via customer account") {
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
    if (commitJson.data?.orderEditCommit?.userErrors?.length) {
      return cors(Response.json({ userErrors: commitJson.data.orderEditCommit.userErrors }, { status: 422 }));
    }

    const order = commitJson.data.orderEditCommit.order;
    const balanceDue = order?.totalOutstandingSet?.shopMoney ?? null;

    // Determine if the merchant owes the customer a refund
    // (negative outstanding balance after a variant downgrade).
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);

    // Track order edit and feature usage
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "swap-variant",
      source,
    });

    return cors(Response.json({ order, balanceDue, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-edit] Unexpected error:", err);
    return cors(Response.json({ userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] }, { status: 500 }));
  }
}
