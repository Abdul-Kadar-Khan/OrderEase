import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

/**
 * GET /api/order/upsell-tags?orderId=gid://...
 *
 * Returns the deduplicated list of upsell search tags derived from the
 * active line items in the order. For each product tag "X" found on an
 * active line item, we emit "X-upshell" — the caller can then search the
 * Storefront API for products with those tags.
 */
const ORDER_TAGS_QUERY = `#graphql
  query GetOrderLineItemTags($id: ID!) {
    order(id: $id) {
      lineItems(first: 50) {
        edges {
          node {
            currentQuantity
            product {
              tags
            }
          }
        }
      }
    }
  }
`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) {
    return cors(Response.json({ error: "orderId is required" }, { status: 400 }));
  }

  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  try {
    const response = await admin.graphql(ORDER_TAGS_QUERY, {
      variables: { id: orderId },
    });

    const json = await response.json();

    if (json.errors?.length) {
      return cors(
        Response.json({ error: json.errors[0].message }, { status: 400 })
      );
    }

    const edges: Array<{ node: { currentQuantity: number; product?: { tags: string[] } | null } }> =
      json.data?.order?.lineItems?.edges ?? [];

    // Collect tags only from active (not removed) line items
    const upsellTags = new Set<string>();
    for (const { node } of edges) {
      if (node.currentQuantity > 0 && node.product?.tags) {
        for (const tag of node.product.tags) {
          upsellTags.add(`${tag}-upshell`);
        }
      }
    }

    return cors(Response.json({ tags: Array.from(upsellTags) }));
  } catch (err: unknown) {
    console.error("[upsell-tags] Unexpected error:", err);
    return cors(Response.json({ error: "Internal error" }, { status: 500 }));
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return cors(Response.json({ error: "Method not allowed" }, { status: 405 }));
}
