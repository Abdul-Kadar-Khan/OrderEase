import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

// ───────────────────────────────────────────────────────────────────────────
// api.order.discount4
//
// Rule set (deliberately simpler than discount3 — one slot per discount
// type, order-wide, instead of per-product tracking):
//
//   - An order may carry AT MOST one order-level discount code, total.
//   - An order may carry AT MOST one product-level discount code, total.
//   - Nothing applied yet (from checkout or otherwise)?
//       -> both a product-level code AND an order-level code may be applied
//          (one of each).
//   - A product-level discount is already on the order (from checkout or a
//     previous edit)?
//       -> only an order-level code may still be applied. Another
//          product-level code is refused with a warning, regardless of
//          which product it would target.
//   - An order-level discount is already on the order?
//       -> only a product-level code may still be applied. Another
//          order-level code is refused with a warning.
//
// When a product-level code is applied on top of an existing order-level
// discount (or vice versa), the math is sequenced as:
//   1. Product-level discount is calculated against the original price.
//   2. The order-level discount is then (re)calculated against whatever
//      price remains after step 1 — not the original price.
//
// Shopify constraint this file works around: `orderEditAddLineItemDiscount`
// only allows ONE discount application per line item — a second call on an
// already-discounted line fails rather than stacking. So wherever a line
// item needs to end up carrying a combined amount, the existing discount is
// removed first (`orderEditRemoveDiscount`) and a single fresh combined
// discount is added in its place.
//
// NOTE: because the two original discount applications are removed and
// replaced by one combined application, Shopify has no way to keep showing
// both original labels/tags on its own. Whenever we combine, we build the
// new discount's `description` by concatenating each existing allocation's
// own label with the newly-applied code's label, so both stay visible
// (e.g. "PRO10 + DIS30") instead of the combined line only showing the
// most-recently-applied code's label.
// ───────────────────────────────────────────────────────────────────────────

type Money = { amount: string; currencyCode: string };

type DiscountApplicationNode = {
  id?: string | null;
  __typename?: string;
  targetSelection?: "ALL" | "ENTITLED" | "EXPLICIT" | string | null;
  targetType?: string | null;
  allocationMethod?: string | null;
  value?: { percentage?: number; amount?: string; currencyCode?: string } | null;
  // These are only present on specific concrete types in the Order Editing
  // API's CalculatedDiscountApplication interface: `code` on
  // CalculatedDiscountCodeApplication; `description` on
  // CalculatedManualDiscountApplication and CalculatedScriptDiscountApplication
  // (this is what we set as `description` in the discount input, so for
  // manual discounts it comes back to us as-is — including a previously
  // combined "A + B" label). Used to recover a human-readable label for an
  // already-applied discount so it can be preserved when we combine
  // discounts onto one line item.
  code?: string | null;
  description?: string | null;
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
  return !!app && app.targetSelection === "ALL";
}

function isProductLevelApplication(app?: DiscountApplicationNode | null): boolean {
  return !!app && app.targetSelection != null && app.targetSelection !== "ALL";
}

function money(amount: number): string {
  return Math.max(amount, 0).toFixed(2);
}

// Best-effort human label for an existing discount application, so its tag
// isn't silently dropped when it gets folded into a combined discount.
function labelFor(app: DiscountApplicationNode): string {
  // `description` covers manual and script discounts — for manual discounts
  // (CalculatedManualDiscountApplication, what this route always creates)
  // it's exactly the string we wrote, so it may already be a combined
  // "A + B" label from an earlier combine. `code` covers code-based
  // discounts. Falls back to a generic label if neither is present.
  return app.description || app.code || "Discount";
}

// Joins labels for display, de-duplicating and dropping empties, without
// repeating the same label twice if e.g. the same code covers two lines.
function combineLabels(labels: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    if (!l) continue;
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(l);
  }
  return out.join(" + ");
}

type ExistingAllocation = {
  id: string;
  amount: number;
  isOrderLevel: boolean;
  isProductLevel: boolean;
  label: string;
  app: DiscountApplicationNode;
};

function existingAllocationsFor(item: CalculatedLineItemNode): ExistingAllocation[] {
  const out: ExistingAllocation[] = [];
  for (const alloc of item.calculatedDiscountAllocations ?? []) {
    const app = alloc.discountApplication;
    if (!app?.id) continue;
    out.push({
      id: app.id,
      amount: parseFloat(alloc.allocatedAmountSet?.shopMoney?.amount ?? "0") || 0,
      isOrderLevel: isOrderLevelApplication(app),
      isProductLevel: isProductLevelApplication(app),
      label: labelFor(app),
      app,
    });
  }
  return out;
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
                    id
                    __typename
                    targetSelection
                    targetType
                    allocationMethod
                    value {
                      ... on PricingPercentageValue { percentage }
                      ... on MoneyV2 { amount currencyCode }
                    }
                    ... on CalculatedDiscountCodeApplication { code }
                    ... on CalculatedManualDiscountApplication { description }
                    ... on CalculatedScriptDiscountApplication { description }
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

    // ── 3. Order-wide "slot" check ───────────────────────────────────────────
    // Exactly one product-level discount and one order-level discount are
    // allowed on the order at any time, regardless of which line item(s)
    // they sit on.
    const allAllocations = lineItems.flatMap((item) => existingAllocationsFor(item));
    const hasExistingOrderLevelDiscount = allAllocations.some((a) => a.isOrderLevel);
    const hasExistingProductLevelDiscount = allAllocations.some((a) => a.isProductLevel);

    if (isOrderLevelCode && hasExistingOrderLevelDiscount) {
      return cors(
        Response.json(
          {
            userErrors: [
              { message: "This order already has an order-level discount applied. Only one order-level discount code is allowed per order." },
            ],
          },
          { status: 422 },
        ),
      );
    }
    if (!isOrderLevelCode && hasExistingProductLevelDiscount) {
      return cors(
        Response.json(
          {
            userErrors: [
              { message: "This order already has a product-level discount applied. Only one product-level discount code is allowed per order." },
            ],
          },
          { status: 422 },
        ),
      );
    }

    const applyResults: { lineItemId: string; removeIds: string[]; discount: Record<string, unknown> }[] = [];
    const warnings: string[] = [];
    const defaultCurrencyCode =
      fixedValue?.currencyCode ?? lineItems[0]?.originalUnitPriceSet?.shopMoney?.currencyCode ?? "USD";
    const newCodeLabel = codeDiscount.shortSummary || normalizedCode;

    if (isOrderLevelCode) {
      // ── 4a. ORDER-LEVEL discount code (no existing order-level discount,
      // possibly an existing product-level discount to sequence after) ──────
      const remainingBaseByLineItem = new Map<string, number>();
      let remainingOrderTotal = 0;
      for (const item of lineItems) {
        const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        const existingTotal = existingAllocationsFor(item).reduce((sum, a) => sum + a.amount, 0);
        const remainingBase = Math.max(lineTotal - existingTotal, 0);
        remainingBaseByLineItem.set(item.id, remainingBase);
        remainingOrderTotal += remainingBase;
      }

      for (const item of lineItems) {
        const remainingBase = remainingBaseByLineItem.get(item.id) ?? 0;
        if (remainingBase <= 0) continue;

        let newOrderLevelAmount = 0;
        if (percentValue != null) {
          newOrderLevelAmount = remainingBase * (percentValue / 100);
        } else if (fixedValue) {
          const share = remainingOrderTotal > 0 ? remainingBase / remainingOrderTotal : 0;
          newOrderLevelAmount = Math.min(parseFloat(fixedValue.amount) * share, remainingBase);
        }
        if (newOrderLevelAmount <= 0) continue;

        const existing = existingAllocationsFor(item);
        const existingTotal = existing.reduce((sum, a) => sum + a.amount, 0);
        const desiredTotal = existingTotal + newOrderLevelAmount;

        // Preserve whatever label(s) were already on this line (e.g. a
        // product-level code applied earlier) alongside the new order-level
        // code's own label, instead of overwriting them.
        const combinedDescription = combineLabels([...existing.map((a) => a.label), newCodeLabel]);

        applyResults.push({
          lineItemId: item.id,
          removeIds: existing.map((a) => a.id),
          discount: {
            fixedValue: { amount: money(desiredTotal), currencyCode: defaultCurrencyCode },
            description: combinedDescription,
          },
        });
      }

      if (applyResults.length === 0) {
        return cors(
          Response.json({ userErrors: [{ message: "Could not apply the order-level discount to any line item." }] }, { status: 422 }),
        );
      }
    } else {
      // ── 4b. PRODUCT-LEVEL discount code (no existing product-level
      // discount, possibly an existing order-level discount to sequence
      // after) ────────────────────────────────────────────────────────────
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
            { userErrors: [{ message: `Discount code "${discountCode}" is not valid for any product on this order.` }] },
            { status: 422 },
          ),
        );
      }

      for (const item of candidateItems) {
        const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;

        // Step 1: apply the product-level discount to the original price.
        let productDiscountAmount = 0;
        if (percentValue != null) {
          productDiscountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          productDiscountAmount = Math.min(parseFloat(fixedValue.amount), lineTotal);
        }
        productDiscountAmount = Math.min(productDiscountAmount, lineTotal);
        const priceAfterProductDiscount = lineTotal - productDiscountAmount;

        // Step 2: if this line already carries the order's one order-level
        // discount, re-derive it against the price left AFTER the product
        // discount rather than the original price.
        const existing = existingAllocationsFor(item);
        const existingOrderLevel = existing.filter((a) => a.isOrderLevel);
        let recomputedOrderLevelAmount = existingOrderLevel.reduce((sum, a) => sum + a.amount, 0);
        const orderLevelPercentage = existingOrderLevel[0]?.app.value?.percentage;
        if (existingOrderLevel.length > 0 && orderLevelPercentage != null) {
          // Percentage-based order-level discounts rescale cleanly against
          // the new, lower base. Fixed-amount ones keep whatever dollar
          // figure was already allocated to this line — a flat amount has
          // no natural "percentage of the new price" to recompute.
          recomputedOrderLevelAmount = priceAfterProductDiscount * orderLevelPercentage;
        }
        recomputedOrderLevelAmount = Math.min(recomputedOrderLevelAmount, priceAfterProductDiscount);

        const desiredTotal = productDiscountAmount + recomputedOrderLevelAmount;
        if (desiredTotal <= 0) continue;

        // Preserve the existing order-level discount's own label alongside
        // the new product-level code's label, instead of overwriting it.
        const combinedDescription = combineLabels([
          newCodeLabel,
          ...existingOrderLevel.map((a) => a.label),
        ]);

        applyResults.push({
          lineItemId: item.id,
          removeIds: existingOrderLevel.map((a) => a.id),
          discount: {
            fixedValue: {
              amount: money(desiredTotal),
              currencyCode: fixedValue?.currencyCode ?? item.originalUnitPriceSet?.shopMoney?.currencyCode ?? defaultCurrencyCode,
            },
            description: combinedDescription,
          },
        });
      }

      if (applyResults.length === 0) {
        return cors(
          Response.json({ userErrors: [{ message: "Could not apply the product-level discount to any eligible product." }] }, { status: 422 }),
        );
      }
    }

    // ── 5. Remove anything that needs replacing, then add the new/combined
    // discount for each targeted line item ─────────────────────────────────
    const removeIds = new Set<string>();
    for (const { removeIds: ids } of applyResults) {
      for (const id of ids) removeIds.add(id);
    }
    for (const discountApplicationId of removeIds) {
      const removeRes = await admin.graphql(
        `#graphql
        mutation removeDiscount($id: ID!, $discountApplicationId: ID!) {
          orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
            userErrors { field message }
          }
        }`,
        { variables: { id: calculatedOrderId, discountApplicationId } },
      );
      const removeJson = await removeRes.json();
      const removeErrors = removeJson.data?.orderEditRemoveDiscount?.userErrors ?? [];
      if (removeJson.errors?.length || removeErrors.length) {
        console.warn(`[order-discount4] Could not remove discount ${discountApplicationId}:`, removeJson.errors ?? removeErrors);
      }
    }

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
    if (applyFailures.length > 0) {
      warnings.push(...applyFailures.map((m) => `A product could not be updated: ${m}`));
    }

    // ── 6. Commit the order edit ────────────────────────────────────────────
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
    console.error("[order-discount4] Unexpected error:", err);
    return cors(
      Response.json({ userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] }, { status: 500 }),
    );
  }
}