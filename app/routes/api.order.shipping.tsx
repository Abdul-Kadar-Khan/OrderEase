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
  const { admin, session } = await unauthenticated.admin(storeDomain);

  try {
    const res = await admin.graphql(
      `#graphql
      query getOrderShippingMethod($id: ID!) {
        order(id: $id) {
          id
          currencyCode
          shippingLine {
            id
            title
            code
            originalPriceSet {
              presentmentMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }`,
      { variables: { id: orderId } },
    );
    const json = await res.json();
    const order = json.data?.order;
    const shippingLine = order?.shippingLine ?? null;
    const currencyCode = order?.currencyCode || "USD";

    const currentShipping = shippingLine
      ? {
          title: shippingLine.title,
          code: shippingLine.code,
          amount: shippingLine.originalPriceSet?.presentmentMoney?.amount || "0.00",
          currencyCode: shippingLine.originalPriceSet?.presentmentMoney?.currencyCode || currencyCode,
        }
      : null;

    let availableMethods: Array<{ id: string; title: string; price: number }> = [];
    const methodsMap = new Map<string, { id: string; title: string; price: number }>();

    // Strategy 1: GraphQL deliveryProfiles
    try {
      const profilesRes = await admin.graphql(
        `#graphql
        query getStoreDeliveryProfiles {
          deliveryProfiles(first: 20) {
            nodes {
              profileLocationGroups {
                locationGroupZones(first: 20) {
                  nodes {
                    methodDefinitions(first: 20) {
                      nodes {
                        id
                        name
                        active
                        rateProvider {
                          __typename
                          ... on DeliveryRateDefinition {
                            price {
                              amount
                            }
                          }
                          ... on DeliveryParticipant {
                            id
                            fixedFee {
                              amount
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
        }`
      );
      const profilesJson = await profilesRes.json();
      const profiles = profilesJson.data?.deliveryProfiles?.nodes || [];

      for (const profile of profiles) {
        const groups = profile.profileLocationGroups || [];
        for (const group of groups) {
          const zones = group.locationGroupZones?.nodes || [];
          for (const zone of zones) {
            const defs = zone.methodDefinitions?.nodes || [];
            for (const def of defs) {
              const name = def.name;
              let price = 0;
              if (def.rateProvider?.__typename === "DeliveryRateDefinition" && def.rateProvider.price?.amount) {
                price = parseFloat(def.rateProvider.price.amount);
              } else if (def.rateProvider?.__typename === "DeliveryParticipant" && def.rateProvider.fixedFee?.amount) {
                price = parseFloat(def.rateProvider.fixedFee.amount);
              }
              if (name && !methodsMap.has(name.toLowerCase())) {
                methodsMap.set(name.toLowerCase(), {
                  id: def.id || name.toLowerCase(),
                  title: name,
                  price,
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[order-shipping-loader] GraphQL deliveryProfiles fetch error:", e);
    }

    // Strategy 2: REST shipping_zones.json fallback if GraphQL returned nothing
    if (methodsMap.size === 0 && session?.accessToken) {
      try {
        const restRes = await fetch(`https://${storeDomain}/admin/api/2026-04/shipping_zones.json`, {
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
            "Content-Type": "application/json",
          },
        });
        if (restRes.ok) {
          const restJson = await restRes.json();
          const zones = restJson.shipping_zones || [];
          for (const zone of zones) {
            const priceRates = zone.price_based_shipping_rates || [];
            const weightRates = zone.weight_based_shipping_rates || [];
            const carrierProviders = zone.carrier_shipping_rate_providers || [];

            for (const rate of [...priceRates, ...weightRates]) {
              const name = rate.name;
              const price = parseFloat(rate.price || "0.00");
              if (name && !methodsMap.has(name.toLowerCase())) {
                methodsMap.set(name.toLowerCase(), {
                  id: String(rate.id || name.toLowerCase()),
                  title: name,
                  price,
                });
              }
            }
            for (const provider of carrierProviders) {
              const name = provider.service_discovery_name || provider.carrier_service_id || "Carrier Shipping";
              const price = parseFloat(provider.flat_modifier || "0.00");
              if (name && !methodsMap.has(name.toLowerCase())) {
                methodsMap.set(name.toLowerCase(), {
                  id: String(provider.id || name.toLowerCase()),
                  title: name,
                  price,
                });
              }
            }
          }
        }
      } catch (restErr) {
        console.warn("[order-shipping-loader] REST shipping_zones fetch error:", restErr);
      }
    }

    availableMethods = Array.from(methodsMap.values());

    return cors(Response.json({ currentShipping, currencyCode, availableMethods }));
  } catch (err) {
    console.error("[order-shipping-loader] Error:", err);
    return cors(Response.json({ currentShipping: null, currencyCode: "INR", availableMethods: [] }));
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
  const { orderId, title, price, currencyCode = "USD" } = body;

  if (!orderId || !title || price === undefined || price === null) {
    return cors(
      Response.json({ userErrors: [{ message: "Missing orderId, title, or price." }] }, { status: 400 }),
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

  // ── Ownership check ────────────────────────────────────────────────────────
  const ownerRes = await admin.graphql(
    `#graphql
    query getOrderOwnerForShipping($id: ID!) {
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
    // Step 1: Begin order edit session
    const beginRes = await admin.graphql(
      `#graphql
      mutation OrderEditBeginForShipping($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            shippingLines {
              id
              title
            }
          }
          userErrors { field message }
        }
      }`,
      { variables: { id: orderId } },
    );
    const beginJson = await beginRes.json();
    const beginErrors = beginJson.data?.orderEditBegin?.userErrors ?? [];
    if (beginErrors.length) {
      return cors(Response.json({ userErrors: beginErrors }, { status: 422 }));
    }

    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const existingLines = calculatedOrder.shippingLines ?? [];

    // Step 2: Remove existing shipping lines if present
    for (const line of existingLines) {
      const removeRes = await admin.graphql(
        `#graphql
        mutation OrderEditRemoveShippingLine($id: ID!, $shippingLineId: ID!) {
          orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) {
            calculatedOrder { id }
            userErrors { field message }
          }
        }`,
        { variables: { id: calculatedOrderId, shippingLineId: line.id } },
      );
      const removeJson = await removeRes.json();
      const removeErrors = removeJson.data?.orderEditRemoveShippingLine?.userErrors ?? [];
      if (removeErrors.length) {
        console.warn("[order-shipping] Warning removing line:", removeErrors);
      }
    }

    // Step 3: Add new shipping line
    const numericPrice = typeof price === "number" ? price : parseFloat(String(price));
    const addRes = await admin.graphql(
      `#graphql
      mutation OrderEditAddShippingLine($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
        orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) {
          calculatedOrder { id }
          calculatedShippingLine {
            id
            title
            price {
              presentmentMoney {
                amount
                currencyCode
              }
            }
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: calculatedOrderId,
          shippingLine: {
            title,
            price: {
              amount: numericPrice,
              currencyCode,
            },
          },
        },
      },
    );
    const addJson = await addRes.json();
    const addErrors = addJson.data?.orderEditAddShippingLine?.userErrors ?? [];
    if (addErrors.length) {
      return cors(Response.json({ userErrors: addErrors }, { status: 422 }));
    }

    // Step 4: Commit order edit
    const commitRes = await admin.graphql(
      `#graphql
      mutation OrderEditCommitShipping($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
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
      {
        variables: {
          id: calculatedOrderId,
          staffNote: "Shipping method updated by customer via Customer Account UI",
        },
      },
    );
    const commitJson = await commitRes.json();
    const commitErrors = commitJson.data?.orderEditCommit?.userErrors ?? [];
    if (commitErrors.length) {
      return cors(Response.json({ userErrors: commitErrors }, { status: 422 }));
    }

    const updatedOrder = commitJson.data.orderEditCommit.order;
    const balanceDue = updatedOrder?.totalOutstandingSet?.shopMoney ?? null;
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);

    // Track order edit and feature usage
    const { source } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "change-shipping-method",
      source,
    });

    return cors(Response.json({ order: updatedOrder, balanceDue, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-shipping] Unexpected error:", err);
    return cors(
      Response.json(
        { userErrors: [{ message: err instanceof Error ? err.message : "Internal error updating shipping method" }] },
        { status: 500 },
      ),
    );
  }
}
