import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

// ───────────────────────────────────────────────────────────────────────────
// api.order.discount3
//
// Rules implemented (independent design — no logic shared with
// api.order.discount.tsx or api.order.discount2.tsx):
//
// Product-level discount code:
//   - If a target product already carries a product-level discount that was
//     applied at checkout, refuse to stack another one on it and warn.
//   - Otherwise apply the code only to the product(s) the code is actually
//     eligible for.
//
// Order-level discount code:
//   - If the order already carries an order-level discount from checkout,
//     refuse another order-level discount and warn.
//   - If the order already carries a checkout order-level discount and the
//     customer is applying a *product-level* code, the math must be applied
//     in this order: product discount first (against the original product
//     price), then the existing order-level discount is re-derived against
//     the price that remains *after* the product discount.
// ───────────────────────────────────────────────────────────────────────────

type Money = { amount: string; currencyCode: string };

type DiscountApplicationNode = {
  __typename?: string;
  targetSelection?: "ALL" | "ENTITLED" | "EXPLICIT" | string | null;
  targetType?: string | null;
  allocationMethod?: string | null;
  value?: { percentage?: number; amount?: string; currencyCode?: string } | null;
};

type CalculatedDiscountAllocationNode = {
  allocatedAmountSet?: { shopMoney: Money } | null;
  discountApplication?: DiscountApplicationNode | null;
};

type CalculatedLineItemNode = {
  id: string;
  quantity: number;
  variant?: { id: string; product?: { id: string; title?: string | null } | null } | null;
  originalUnitPriceSet?: { shopMoney: Money } | null;
  calculatedDiscountAllocations?: CalculatedDiscountAllocationNode[];
};

function isOrderLevelApplication(app?: DiscountApplicationNode | null): boolean {
  // An order-level discount from checkout is one that was spread across
  // "ALL" applicable line items, rather than pinned to specific ones.
  return !!app && app.targetSelection === "ALL";
}

function isProductLevelApplication(app?: DiscountApplicationNode | null): boolean {
  // Anything targeted (ENTITLED/EXPLICIT) rather than ALL is a discount that
  // was scoped to specific product(s).
  return !!app && app.targetSelection != null && app.targetSelection !== "ALL";
}

function money(amount: number): string {
  return Math.max(amount, 0).toFixed(2);
}

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
  const { admin } = await unauthenticated.admin(storeDomain);

  const { orderId, discountCode, variantIds } = await request.json();

  if (!orderId || !discountCode) {
    return cors(
      Response.json({ userErrors: [{ message: "Missing orderId or discountCode." }] }, { status: 400 }),
    );
  }

  const requestedVariantIds: string[] | null =
    Array.isArray(variantIds) && variantIds.length > 0 ? variantIds : null;
  const normalizedCode = String(discountCode).trim().toUpperCase();

  try {
    // ── 1. Look up the discount code and work out its shape ────────────────
    const codeRes = await admin.graphql(
      `#graphql
      query lookupDiscountCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              status
              shortSummary
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount currencyCode } }
                }
                items {
                  __typename
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts {
                    products(first: 250) { nodes { id } }
                    productVariants(first: 250) { nodes { id } }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) { nodes { id } }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy { status }
            ... on DiscountCodeFreeShipping { status }
          }
        }
      }`,
      { variables: { code: normalizedCode } },
    );
    const codeJson = await codeRes.json();
    const codeDiscount = codeJson.data?.codeDiscountNodeByCode?.codeDiscount;

    if (!codeDiscount) {
      return cors(
        Response.json({ userErrors: [{ message: `Discount code "${discountCode}" was not found.` }] }, { status: 404 }),
      );
    }
    if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
      return cors(
        Response.json(
          { userErrors: [{ message: `Discount code "${discountCode}" is ${String(codeDiscount.status).toLowerCase()}.` }] },
          { status: 422 },
        ),
      );
    }
    if (codeDiscount.__typename !== "DiscountCodeBasic") {
      return cors(
        Response.json(
          { userErrors: [{ message: "Only percentage and fixed-amount discount codes are supported." }] },
          { status: 422 },
        ),
      );
    }

    const value = codeDiscount.customerGets?.value;
    const percentValue: number | null = value?.percentage != null ? value.percentage * 100 : null;
    const fixedValue: Money | null = value?.amount?.amount
      ? { amount: value.amount.amount, currencyCode: value.amount.currencyCode }
      : null;

    if (percentValue == null && fixedValue == null) {
      return cors(
        Response.json({ userErrors: [{ message: "This discount has no usable percentage or fixed amount." }] }, { status: 422 }),
      );
    }

    // A code with items = AllDiscountItems is, by definition, an order-wide
    // discount. Anything scoped to specific products/collections is a
    // product-level discount.
    const items = codeDiscount.customerGets?.items;
    const isOrderLevelCode = !items || items.__typename === "AllDiscountItems";

    let eligibleProductIds = new Set<string>();
    let eligibleVariantIds = new Set<string>();
    if (!isOrderLevelCode) {
      if (items?.__typename === "DiscountProducts") {
        eligibleProductIds = new Set((items.products?.nodes ?? []).map((p: { id: string }) => p.id));
        eligibleVariantIds = new Set((items.productVariants?.nodes ?? []).map((v: { id: string }) => v.id));
      } else if (items?.__typename === "DiscountCollections") {
        const collectionIds: string[] = (items.collections?.nodes ?? []).map((c: { id: string }) => c.id);
        for (const collectionId of collectionIds) {
          const collRes = await admin.graphql(
            `#graphql
            query collectionProducts($id: ID!) {
              collection(id: $id) {
                products(first: 250) { nodes { id } }
              }
            }`,
            { variables: { id: collectionId } },
          );
          const collJson = await collRes.json();
          for (const p of (collJson.data?.collection?.products?.nodes ?? []) as { id: string }[]) {
            eligibleProductIds.add(p.id);
          }
        }
      }
    }

    // ── 2. Start the order edit and read the calculated line items ─────────
    // calculatedDiscountAllocations already reflects discounts applied at
    // checkout, before this session adds anything new, so it's the source
    // of truth for "what discount(s) does this order already have?"
    const beginRes = await admin.graphql(
      `#graphql
      mutation beginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 50) {
              nodes {
                id
                quantity
                variant { id product { id title } }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    __typename
                    targetSelection
                    targetType
                    allocationMethod
                    value {
                      ... on PricingPercentageValue { percentage }
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                }
              }
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

    const calculatedOrderId: string = beginJson.data.orderEditBegin.calculatedOrder.id;
    const lineItems: CalculatedLineItemNode[] = beginJson.data.orderEditBegin.calculatedOrder.lineItems?.nodes ?? [];

    if (lineItems.length === 0) {
      return cors(Response.json({ userErrors: [{ message: "This order has no line items to discount." }] }, { status: 422 }));
    }

    // Does ANY line item already carry a checkout order-level discount, and
    // if so what was it worth (per line item) and what shape is it?
    let checkoutOrderLevelApp: DiscountApplicationNode | null = null;
    const checkoutOrderLevelAmountByLineItem = new Map<string, number>();
    for (const item of lineItems) {
      for (const alloc of item.calculatedDiscountAllocations ?? []) {
        if (isOrderLevelApplication(alloc.discountApplication)) {
          checkoutOrderLevelApp = alloc.discountApplication!;
          checkoutOrderLevelAmountByLineItem.set(
            item.id,
            parseFloat(alloc.allocatedAmountSet?.shopMoney?.amount ?? "0") || 0,
          );
        }
      }
    }
    const hasCheckoutOrderLevelDiscount = checkoutOrderLevelApp !== null;

    function hasCheckoutProductLevelDiscount(item: CalculatedLineItemNode): boolean {
      return (item.calculatedDiscountAllocations ?? []).some((a) => isProductLevelApplication(a.discountApplication));
    }

    const applyResults: { lineItemId: string; discount: Record<string, unknown> }[] = [];
    const warnings: string[] = [];
    let currencyCode =
      fixedValue?.currencyCode ?? lineItems[0]?.originalUnitPriceSet?.shopMoney?.currencyCode ?? "USD";

    // ── 3a. ORDER-LEVEL discount code ───────────────────────────────────────
    if (isOrderLevelCode) {
      if (hasCheckoutOrderLevelDiscount) {
        return cors(
          Response.json(
            {
              userErrors: [
                { message: "This order already has an order-level discount applied at checkout. Another order-level discount code cannot be applied." },
              ],
            },
            { status: 422 },
          ),
        );
      }

      for (const item of lineItems) {
        const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;

        let discountAmount = 0;
        if (percentValue != null) {
          discountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          // Fixed order-wide amount is spread across lines proportionally to
          // each line's share of the order total (the usual "ACROSS" split).
          const orderTotal = lineItems.reduce(
            (sum, li) => sum + (parseFloat(li.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0) * li.quantity,
            0,
          );
          const share = orderTotal > 0 ? lineTotal / orderTotal : 0;
          discountAmount = Math.min(parseFloat(fixedValue.amount) * share, lineTotal);
        }

        if (discountAmount <= 0) continue;

        applyResults.push({
          lineItemId: item.id,
          discount: {
            fixedValue: { amount: money(discountAmount), currencyCode },
            description: codeDiscount.shortSummary || normalizedCode,
          },
        });
      }

      if (applyResults.length === 0) {
        return cors(
          Response.json({ userErrors: [{ message: "Could not apply the order-level discount to any line item." }] }, { status: 422 }),
        );
      }
    } else {
      // ── 3b. PRODUCT-LEVEL discount code ─────────────────────────────────
      const requestedVariantSet = requestedVariantIds ? new Set(requestedVariantIds) : null;

      const candidateItems = lineItems.filter((item) => {
        const variantId = item.variant?.id;
        const productId = item.variant?.product?.id;
        const matchesEligibility =
          (variantId && eligibleVariantIds.has(variantId)) || (productId && eligibleProductIds.has(productId));
        if (!matchesEligibility) return false;
        if (requestedVariantSet) return !!variantId && requestedVariantSet.has(variantId);
        return true;
      });

      if (candidateItems.length === 0) {
        return cors(
          Response.json(
            { userErrors: [{ message: `Discount code "${discountCode}" is not valid for the selected product(s).` }] },
            { status: 422 },
          ),
        );
      }

      for (const item of candidateItems) {
        const productTitle = item.variant?.product?.title ?? "This product";

        if (hasCheckoutProductLevelDiscount(item)) {
          warnings.push(`${productTitle} already has a product-level discount from checkout — the new discount was not applied to it.`);
          continue;
        }

        const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;

        // Step 1: apply the product-level discount to the (original) product
        // price.
        let productDiscountAmount = 0;
        if (percentValue != null) {
          productDiscountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          productDiscountAmount = Math.min(parseFloat(fixedValue.amount), lineTotal);
        }
        productDiscountAmount = Math.min(productDiscountAmount, lineTotal);
        const priceAfterProductDiscount = lineTotal - productDiscountAmount;

        let totalDesiredDiscount = productDiscountAmount;

        // Step 2: if an order-level discount already exists from checkout,
        // re-derive it against the price that remains AFTER the product
        // discount rather than the original price.
        if (hasCheckoutOrderLevelDiscount && checkoutOrderLevelApp) {
          const alreadyAllocated = checkoutOrderLevelAmountByLineItem.get(item.id) ?? 0;
          let recomputedOrderLevelAmount = alreadyAllocated;

          if (checkoutOrderLevelApp.value?.percentage != null) {
            recomputedOrderLevelAmount = priceAfterProductDiscount * checkoutOrderLevelApp.value.percentage;
          }
          // Fixed-amount order-level discounts keep the dollar amount that
          // checkout already allocated to this line — a flat amount doesn't
          // rescale with price the way a percentage does.

          recomputedOrderLevelAmount = Math.min(recomputedOrderLevelAmount, priceAfterProductDiscount);
          totalDesiredDiscount = productDiscountAmount + recomputedOrderLevelAmount;

          // The order-level portion is already baked into the line's price
          // via checkout's own allocation, so only submit the incremental
          // amount on top of that (product discount + any change in the
          // order-level amount caused by recalculating it on the new base).
          const incrementalAmount = totalDesiredDiscount - alreadyAllocated;
          totalDesiredDiscount = Math.max(incrementalAmount, 0);
        }

        if (totalDesiredDiscount <= 0) continue;

        applyResults.push({
          lineItemId: item.id,
          discount: {
            fixedValue: {
              amount: money(totalDesiredDiscount),
              currencyCode: fixedValue?.currencyCode ?? item.originalUnitPriceSet?.shopMoney?.currencyCode ?? currencyCode,
            },
            description: codeDiscount.shortSummary || normalizedCode,
          },
        });
      }

      if (applyResults.length === 0) {
        const message = warnings[0] ?? "Could not apply the product-level discount to any eligible product.";
        return cors(Response.json({ userErrors: [{ message }] }, { status: 422 }));
      }
    }

    // ── 4. Submit each staged discount ──────────────────────────────────────
    let appliedCount = 0;
    const applyFailures: string[] = [];
    for (const { lineItemId, discount } of applyResults) {
      const applyRes = await admin.graphql(
        `#graphql
        mutation applyLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`,
        { variables: { id: calculatedOrderId, lineItemId, discount } },
      );
      const applyJson = await applyRes.json();
      const topLevelErrors = applyJson.errors ?? [];
      const userErrors = applyJson.data?.orderEditAddLineItemDiscount?.userErrors ?? [];
      const staged = applyJson.data?.orderEditAddLineItemDiscount?.calculatedLineItem;

      if (topLevelErrors.length || userErrors.length || !staged) {
        applyFailures.push(topLevelErrors[0]?.message ?? userErrors[0]?.message ?? "Unknown error applying discount.");
        continue;
      }
      appliedCount += 1;
    }

    if (appliedCount === 0) {
      const message = applyFailures[0] ? `Could not apply the discount: ${applyFailures[0]}` : "Could not apply the discount.";
      return cors(Response.json({ userErrors: [{ message }] }, { status: 422 }));
    }

    // ── 5. Commit the order edit ────────────────────────────────────────────
    const commitRes = await admin.graphql(
      `#graphql
      mutation commitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: calculatedOrderId,
          staffNote: isOrderLevelCode
            ? `Order-level discount code "${normalizedCode}" applied via customer account`
            : `Product-level discount code "${normalizedCode}" applied to ${appliedCount} product(s) via customer account`,
        },
      },
    );
    const commitJson = await commitRes.json();
    const commitErrors = commitJson.data?.orderEditCommit?.userErrors ?? [];
    if (commitErrors.length) {
      return cors(Response.json({ userErrors: commitErrors }, { status: 422 }));
    }

    return cors(
      Response.json({
        order: commitJson.data.orderEditCommit.order,
        summary: codeDiscount.shortSummary ?? normalizedCode,
        appliedCount,
        warnings,
        userErrors: [],
      }),
    );
  } catch (err: unknown) {
    console.error("[order-discount3] Unexpected error:", err);
    return cors(
      Response.json({ userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] }, { status: 500 }),
    );
  }
}