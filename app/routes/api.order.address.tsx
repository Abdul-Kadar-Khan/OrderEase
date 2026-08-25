import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { addOrderTags } from "../utils/orderTagsHelper.server";
import { trackOrderEdit } from "../utils/analyticsHelper.server";
import { checkOrderEditLimit } from "../utils/editLimitHelper.server";

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
      query getShippingAddress($id: ID!) {
        order(id: $id) {
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            countryCode
            phone
          }
        }
      }`,
      { variables: { id: orderId } },
    );
    const json = await res.json();
    const shippingAddress = json.data?.order?.shippingAddress ?? null;
    return cors(Response.json({ shippingAddress }));
  } catch (err) {
    return cors(Response.json({ shippingAddress: null }));
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
  const { orderId, addressType, address } = body;
  // addressType: "shipping" | "billing"

  if (!orderId || !addressType || !address) {
    return cors(
      Response.json({ userErrors: [{ message: "Missing orderId, addressType, or address." }] }, { status: 400 }),
    );
  }

  if (!["shipping", "billing"].includes(addressType)) {
    return cors(
      Response.json({ userErrors: [{ message: "addressType must be 'shipping' or 'billing'." }] }, { status: 400 }),
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

  // ── Required address fields ────────────────────────────────────────────────
  if (!address.address1 || !address.city || !address.countryCode) {
    return cors(
      Response.json(
        { userErrors: [{ message: "Address line 1, city, and country are required." }] },
        { status: 400 },
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

  // ── Build the MailingAddressInput ──────────────────────────────────────────
  const mailingAddress = {
    firstName: address.firstName || "",
    lastName: address.lastName || "",
    address1: address.address1,
    address2: address.address2 || "",
    city: address.city,
    province: address.province || "",
    zip: address.zip || "",
    countryCode: address.countryCode,
    phone: address.phone || "",
  };

  // ── Build the OrderInput ───────────────────────────────────────────────────
  const input: Record<string, unknown> = { id: orderId };
  if (addressType === "shipping") {
    input.shippingAddress = mailingAddress;
  } else {
    // Billing address update — Shopify Admin API does not have a direct
    // billingAddress field on OrderInput; surface a helpful error.
    return cors(
      Response.json(
        {
          userErrors: [
            {
              message:
                "Billing address cannot be updated directly on a placed order. " +
                "Please contact support to update your billing address.",
            },
          ],
        },
        { status: 422 },
      ),
    );
  }

  try {
    const updateRes = await admin.graphql(
      `#graphql
      mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            name
            statusPageUrl
            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              zip
              country
              phone
            }
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

    // Tag the order as updated (address changes don't produce refunds).
    await addOrderTags(admin, orderId);

    // Track order edit and feature usage
    const { source } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "change-address",
      source,
    });

    return cors(Response.json({ order: updateJson.data.orderUpdate.order, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-address] Unexpected error:", err);
    return cors(
      Response.json(
        { userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] },
        { status: 500 },
      ),
    );
  }
}

