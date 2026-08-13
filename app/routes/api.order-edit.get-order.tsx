import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

const GET_ORDER_DETAILS_QUERY = `#graphql
  query GetOrderLineItems($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      currencyCode
      currentSubtotalPriceSet {
        shopMoney { amount currencyCode }
      }
      currentTotalPriceSet {
        shopMoney { amount currencyCode }
      }
      lineItems(first: 100) {
        edges {
          node {
            id
            name
            title
            variantTitle
            currentQuantity
            quantity
            originalUnitPriceSet {
              shopMoney { amount currencyCode }
            }
            image {
              url
              altText
            }
            variant {
              id
              title
              product {
                id
                title
                vendor
              }
              selectedOptions {
                name
                value
              }
              media(first: 1) {
                edges {
                  node {
                    ... on MediaImage {
                      image { url altText }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) {
    return cors(Response.json({ error: "Missing orderId" }, { status: 400 }));
  }

  try {
    const response = await admin.graphql(GET_ORDER_DETAILS_QUERY, {
      variables: { id: orderId },
    });

    const json = await response.json();

    if (json.errors?.length) {
      return cors(Response.json({ error: json.errors[0].message }, { status: 400 }));
    }

    const rawEdges = json.data?.order?.lineItems?.edges ?? [];

    // Explicitly filter for items with currentQuantity > 0 (excluding soft-deleted items)
    const lineItems = rawEdges
      .filter((edge: any) => edge.node && edge.node.currentQuantity > 0)
      .map((edge: any) => {
        const node = edge.node;
        const unitPrice = Number(node.originalUnitPriceSet?.shopMoney?.amount || 0);
        const currencyCode = node.originalUnitPriceSet?.shopMoney?.currencyCode || "USD";
        
        // Compute total line item price based on currentQuantity
        const totalAmount = {
          amount: (unitPrice * node.currentQuantity).toFixed(2),
          currencyCode,
        };

        const image = node.image || node.variant?.media?.edges?.[0]?.node?.image || null;
        const selectedOptions = node.variant?.selectedOptions || [];
        const merchandise = {
          id: node.variant?.id || '',
          title: node.title || node.name || '',
          image,
          selectedOptions,
          product: {
            id: node.variant?.product?.id || '',
            title: node.variant?.product?.title || node.title || node.name || '',
            vendor: node.variant?.product?.vendor || '',
          },
        };
        const cost = {
          totalAmount,
        };

        return {
          id: node.id,
          name: node.name,
          title: node.title || node.name,
          variantTitle: node.variantTitle,
          currentQuantity: node.currentQuantity,
          quantity: node.currentQuantity,
          image,
          selectedOptions,
          price: totalAmount,
          cost,
          merchandise,
        };
      });

    return cors(Response.json({ order: json.data?.order ?? null, lineItems }));
  } catch (err: unknown) {
    console.error("[get-order] Unexpected error:", err);
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
