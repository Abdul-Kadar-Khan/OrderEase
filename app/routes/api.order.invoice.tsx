import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { buildSignedInvoiceUrl } from "../utils/invoice-link.server";
import { trackFeatureUsage } from "../utils/analyticsHelper.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);
  return cors(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
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
  const customerAccountId = sessionToken.sub;
  const body = await request.json();
  const orderId = body.orderId;

  if (!orderId) {
    return cors(Response.json({ error: "Missing orderId" }, { status: 400 }));
  }

  try {
    const { admin } = await unauthenticated.admin(storeDomain);

    // Confirm the order actually belongs to the customer making the request
    // before handing out an invoice link for it.
    const response = await admin.graphql(
      `#graphql
      query getOrderOwner($id: ID!) {
        order(id: $id) {
          id
          customer { id }
        }
      }`,
      { variables: { id: orderId } },
    );
    const json = await response.json();
    const order = json.data?.order;

    if (!order) {
      return cors(Response.json({ error: "Order not found" }, { status: 404 }));
    }

    // sessionToken.sub and the customer GID from the Admin API aren't always
    // formatted identically (numeric id vs full gid://...), so compare on
    // the trailing numeric id rather than requiring an exact string match.
    const numericId = (gidOrId?: string | null) => gidOrId?.match(/\d+$/)?.[0];
    if (!order.customer?.id || numericId(order.customer.id) !== numericId(customerAccountId)) {
      return cors(Response.json({ error: "Not authorized to access this order" }, { status: 403 }));
    }

    const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const invoiceUrl = buildSignedInvoiceUrl(appUrl, {
      shop: storeDomain,
      orderId,
      customerId: customerAccountId,
    });

    // Track feature usage for download-invoice
    await trackFeatureUsage({
      shop: storeDomain,
      featureId: "download-invoice",
    });

    return cors(Response.json({ url: invoiceUrl }));
  } catch (err: unknown) {
    console.error("[order-invoice] Unexpected error:", err);
    return cors(Response.json({ error: "Internal error" }, { status: 500 }));
  }
};
