import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { addOrderTags } from "../utils/orderTagsHelper.server";
import { trackOrderEdit } from "../utils/analyticsHelper.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) {
    return cors(Response.json({ error: "Missing orderId" }, { status: 400 }));
  }

  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  try {
    const res = await admin.graphql(
      `#graphql
      query getOrderNote($id: ID!) {
        order(id: $id) {
          id
          note
        }
      }`,
      { variables: { id: orderId } },
    );
    const json = await res.json();
    const order = json.data?.order;

    return cors(Response.json({ note: order?.note || "" }));
  } catch (err) {
    console.error("[order-note-loader] Error:", err);
    return cors(Response.json({ note: "" }));
  }
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
  const { orderId, note } = body;

  if (!orderId || note === undefined) {
    return cors(
      Response.json({ userErrors: [{ message: "Missing orderId or note." }] }, { status: 400 }),
    );
  }

  // ── Ownership check ────────────────────────────────────────────────────────
  const ownerRes = await admin.graphql(
    `#graphql
    query getOrderOwnerForNote($id: ID!) {
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

  try {
    const updateRes = await admin.graphql(
      `#graphql
      mutation updateOrderNote($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            note
            statusPageUrl
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: orderId,
            note: String(note).trim(),
          },
        },
      },
    );
    const updateJson = await updateRes.json();
    const userErrors = updateJson.data?.orderUpdate?.userErrors ?? [];

    if (userErrors.length > 0) {
      return cors(Response.json({ userErrors }, { status: 422 }));
    }

    await addOrderTags(admin, orderId, false);

    // Track order edit and feature usage
    const { source } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "order-note",
      source,
    });

    return cors(
      Response.json({
        note: updateJson.data?.orderUpdate?.order?.note || "",
        order: updateJson.data?.orderUpdate?.order || null,
        userErrors: [],
      }),
    );
  } catch (err: unknown) {
    console.error("[order-note-action] Unexpected error:", err);
    return cors(
      Response.json(
        { userErrors: [{ message: err instanceof Error ? err.message : "Internal error updating order note" }] },
        { status: 500 },
      ),
    );
  }
}

