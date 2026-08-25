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
    return cors(new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }));
  }

  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const customerAccountId = sessionToken.sub;
  const { admin } = await unauthenticated.admin(storeDomain);

  const body = await request.json();
  const { orderId, email, phone } = body;

  if (!orderId) {
    return cors(Response.json({ userErrors: [{ message: "Missing orderId." }] }, { status: 400 }));
  }

  if (!email && !phone) {
    return cors(Response.json({ userErrors: [{ message: "Provide at least one field to update (email or phone)." }] }, { status: 400 }));
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

  // ── Ownership check ────────────────────────────────────────────────────────
  const ownerRes = await admin.graphql(
    `#graphql
    query getOrderOwner($id: ID!) {
      order(id: $id) {
        id
        customer { id }
      }
    }`,
    { variables: { id: orderId } },
  );
  const ownerJson = await ownerRes.json();
  const order = ownerJson.data?.order;

  if (!order) {
    return cors(Response.json({ userErrors: [{ message: "Order not found." }] }, { status: 404 }));
  }

  const numericId = (gidOrId?: string | null) => gidOrId?.match(/\d+$/)?.[0];
  if (!order.customer?.id || numericId(order.customer.id) !== numericId(customerAccountId)) {
    return cors(Response.json({ userErrors: [{ message: "Not authorized to update this order." }] }, { status: 403 }));
  }

  // ── Build input — only include fields the customer actually changed ─────────
  const numericOrderId = orderId.match(/\d+$/)?.[0];
  if (!numericOrderId) {
    return cors(Response.json({ userErrors: [{ message: "Invalid orderId format." }] }, { status: 400 }));
  }

  const input: Record<string, unknown> = { id: orderId };
  if (email) input.email = email;
  if (phone) input.phone = phone;

  try {
    const updateRes = await admin.graphql(
      `#graphql
      mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            name
            email
            phone
            statusPageUrl
          }
          userErrors { field message }
        }
      }`,
      { variables: { input } },
    );

    const updateJson = await updateRes.json();
    const errors = updateJson.data?.orderUpdate?.userErrors ?? [];

    if (errors.length) {
      return cors(Response.json({ userErrors: errors }, { status: 422 }));
    }

    // Tag the order as updated (contact changes don't produce refunds).
    await addOrderTags(admin, orderId);

    // Track order edit and feature usage
    const { source } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "contact-info",
      source,
    });

    return cors(Response.json({ order: updateJson.data.orderUpdate.order, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-contact] Unexpected error:", err);
    return cors(
      Response.json(
        { userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] },
        { status: 500 },
      ),
    );
  }
}

