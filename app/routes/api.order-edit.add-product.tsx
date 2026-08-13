import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { addOrderTags } from "../utils/orderTagsHelper.server";
import { trackOrderEdit } from "../utils/analyticsHelper.server";

/**
 * Adds a product variant to an existing order, called from the
 * "Add a product to your order" panel in the customer account extension.
 *
 * Flow: orderEditBegin -> orderEditAddVariant -> orderEditCommit.
 * Committing with notifyrue makes Shopify automatically email
 * the customer an invoice with a secure payment link if the edit raises
 * the order total — this is how the "remaining payment" is handled, the
 * same mechanism used for draft order invoices. No custom payment/charge
 * logic is needed here.
 */

export async function loader({ request }: LoaderFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);

  return cors(
    new Response(
      JSON.stringify({
        success: true,
        message: "Customer Account GET working!",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
}

export async function action({ request }: ActionFunctionArgs) {
  // CORS preflight — the extension runs on a different origin, so the
  // browser sends an OPTIONS request before the real POST.

  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);

  if (request.method === "OPTIONS") {
    return cors(
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  // Extract the store domain from the session token's dest property
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  const body = await request.json();
  const { orderId, variantId, quantity, source } = body || {};

  if (!orderId || !variantId || !quantity) {
    return cors(
      Response.json(
        {
          userErrors: [{ message: "Missing orderId, variantId, or quantity." }],
        },
        { status: 400 },
      ),
    );
  }

  try {
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

    // Step 2: add the variant
    const addResponse = await admin.graphql(
      `#graphql
      mutation OrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedOrder {
            addedLineItems(first: 1) { nodes { id quantity } }
          }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId, variantId, quantity } },
    );
    const addJson = await addResponse.json();
    const addErrors = addJson.data?.orderEditAddVariant?.userErrors ?? [];
    if (addErrors.length) {
      return cors(Response.json({ userErrors: addErrors }, { status: 422 }));
    }

    // Step 3: commit — notifyCustomer sends the invoice/payment-link email
    // automatically if a balance is now due.
    const commitResponse = await admin.graphql(
      `#graphql
      mutation OrderEditCommit($id: ID!) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: "Product added via customer account") {
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
    // (negative outstanding balance after edit).
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);

    // Track order edit and feature usage
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "add-product",
      source,
    });

    return cors(Response.json({ order, balanceDue, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-edit] Unexpected error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({ userErrors: [{ message }] }, { status: 500 }));
  }
}
