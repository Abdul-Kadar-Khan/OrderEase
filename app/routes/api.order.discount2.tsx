import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

/**
 * api.order.discount2.tsx
 * -----------------------
 * Fresh, standalone implementation of discount application for the
 * customer-account order-edit flow. This route is independent of
 * api.order.discount.tsx — it does not import, call, or share code with it.
 *
 * Business rules implemented:
 *
 * PRODUCT-LEVEL DISCOUNTS
 *  - Apply only to the targeted line item (variant).
 *  - Always calculated against the line item's ORIGINAL price, never a
 *    price that's already been discounted.
 *  - A line item can carry only one product-level discount at a time.
 *  - If a product-level discount already exists on the line item and it
 *    was applied at checkout (i.e. this app never touched it), it is
 *    left alone and a warning is returned — checkout discounts can't be
 *    modified here.
 *  - If a product-level discount already exists and it was applied by
 *    this app, it is replaced only when the new discount is strictly
 *    larger; otherwise nothing changes and a warning is returned.
 *
 * ORDER-LEVEL DISCOUNTS
 *  - Apply to every line item on the order.
 *  - Never remove or shrink an existing discount (checkout or app-added)
 *    — order-level discounts are added on top, and multiple order-level
 *    discounts can be stacked over time.
 *  - Always calculated on the balance that remains AFTER every
 *    product-level discount (checkout or app) has already been taken
 *    off. Several stacked order-level discounts are each measured
 *    against that same post-product-level balance and summed, which is
 *    how Shopify itself combines multiple order discounts at checkout
 *    (they don't compound on top of one another).
 *
 * PLATFORM CONSTRAINT THIS ROUTE HAS TO WORK AROUND
 *  Shopify's order-editing API only allows a single discount
 *  application to sit on a given line item at any moment — see
 *  "Editing discounts in an order" in Shopify help docs. So whenever a
 *  line item needs to carry the effect of more than one discount
 *  (e.g. a product-level discount this app added, plus an order-level
 *  discount being added now), the two dollar amounts have to be folded
 *  into one combined `fixedValue` application. To make that fold
 *  reversible — so a later request can still tell "how much of this
 *  came from the product-level part?" — this route stamps a small
 *  machine-readable tag onto the discount's `description` field and
 *  reads it back on every subsequent request. See `encodeTag` /
 *  `decodeTag` below.
 */

const TAG_PREFIX = "@d2:";

type Money = { amount: string; currencyCode: string };

type DiscountApplicationNode = {
  id: string;
  __typename: string;
  description?: string | null;
};

type AllocationNode = {
  allocatedAmountSet?: { shopMoney: Money } | null;
  discountApplication?: DiscountApplicationNode | null;
};

type LineItemNode = {
  id: string;
  quantity: number;
  variant?: { id: string } | null;
  originalUnitPriceSet?: { shopMoney: Money } | null;
  calculatedDiscountAllocations?: AllocationNode[] | null;
};

// Discount applications that originate from something the shopper did at
// checkout (a discount code, an automatic discount, a Script/Function
// discount). Anything that isn't one of these __typenames is a discount
// this app itself created via orderEditAddLineItemDiscount.
const CHECKOUT_ORIGIN_TYPENAMES = new Set([
  "DiscountCodeApplication",
  "AutomaticDiscountApplication",
  "ScriptDiscountApplication",
]);
const APP_ORIGIN_TYPENAME = "ManualDiscountApplication";

/** What this route has stamped into a discount's description, if anything. */
interface DecodedTag {
  /** Dollar amount already frozen in from a checkout-origin discount. */
  checkoutAmount: number;
  /** Dollar amount from a product-level discount this app applied. */
  productAmount: number;
  /** Dollar amount from order-level discount(s) this app applied. */
  orderAmount: number;
  /** Human-readable label to keep showing the shopper. */
  label: string;
}

function decodeTag(description?: string | null): DecodedTag | null {
  if (!description || !description.startsWith(TAG_PREFIX)) return null;
  const rest = description.slice(TAG_PREFIX.length);
  const closeIdx = rest.indexOf("}");
  if (closeIdx === -1) return null;
  const raw = rest.slice(0, closeIdx + 1);
  const label = rest.slice(closeIdx + 1).trim();
  try {
    const parsed = JSON.parse(raw) as { c?: number; p?: number; o?: number };
    return {
      checkoutAmount: parsed.c ?? 0,
      productAmount: parsed.p ?? 0,
      orderAmount: parsed.o ?? 0,
      label,
    };
  } catch {
    return null;
  }
}

function encodeTag(tag: DecodedTag): string {
  const raw = JSON.stringify({
    c: round2(tag.checkoutAmount),
    p: round2(tag.productAmount),
    o: round2(tag.orderAmount),
  });
  return `${TAG_PREFIX}${raw} ${tag.label}`.trim();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Resolves a line item's current discount picture, regardless of origin. */
function readLineItemDiscountState(item: LineItemNode): {
  currencyCode: string;
  existingApplicationId: string | null;
  isCheckoutOrigin: boolean;
  tag: DecodedTag;
} {
  const allocations = item.calculatedDiscountAllocations ?? [];
  const currencyCode = item.originalUnitPriceSet?.shopMoney?.currencyCode ?? "";

  if (allocations.length === 0) {
    return {
      currencyCode,
      existingApplicationId: null,
      isCheckoutOrigin: false,
      tag: { checkoutAmount: 0, productAmount: 0, orderAmount: 0, label: "" },
    };
  }

  // Shopify only ever lets one discount application sit on a line item, so
  // in practice this array has at most one entry — but we sum defensively.
  let existingApplicationId: string | null = null;
  let isCheckoutOrigin = false;
  let tag: DecodedTag = { checkoutAmount: 0, productAmount: 0, orderAmount: 0, label: "" };
  let resolvedCurrency = currencyCode;

  for (const allocation of allocations) {
    const app = allocation.discountApplication;
    if (!app) continue;
    existingApplicationId = app.id;

    const allocatedAmount = parseFloat(allocation.allocatedAmountSet?.shopMoney?.amount ?? "0");
    if (allocation.allocatedAmountSet?.shopMoney?.currencyCode) {
      resolvedCurrency = allocation.allocatedAmountSet.shopMoney.currencyCode;
    }

    if (app.__typename === APP_ORIGIN_TYPENAME) {
      const decoded = decodeTag(app.description);
      if (decoded) {
        tag = decoded;
      } else {
        // A manual discount this app didn't tag (shouldn't normally
        // happen) — treat its whole value as an untracked product-level
        // amount so it isn't silently lost.
        tag = { checkoutAmount: 0, productAmount: allocatedAmount, orderAmount: 0, label: app.description ?? "" };
      }
    } else if (CHECKOUT_ORIGIN_TYPENAMES.has(app.__typename)) {
      isCheckoutOrigin = true;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: 0,
        orderAmount: 0,
        label: app.description ?? "Checkout discount",
      };
    }
  }

  return { currencyCode: resolvedCurrency, existingApplicationId, isCheckoutOrigin, tag };
}

/** Looks up a Shopify discount code and returns its type + value. */
async function resolveDiscountCode(
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"],
  code: string,
): Promise<
  | { ok: true; kind: "percentage"; percentage: number; label: string }
  | { ok: true; kind: "fixed"; amount: string; currencyCode: string; label: string }
  | { ok: false; message: string }
> {
  const res = await admin.graphql(
    `#graphql
    query LookupDiscountCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            status
            title
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
          }
        }
      }
    }`,
    { variables: { code: code.trim().toUpperCase() } },
  );
  const json = await res.json();
  const node = json.data?.codeDiscountNodeByCode;
  if (!node) {
    return { ok: false, message: `Discount code "${code}" was not found.` };
  }

  const codeDiscount = node.codeDiscount;
  if (codeDiscount?.__typename !== "DiscountCodeBasic") {
    return { ok: false, message: `Discount code "${code}" is not a supported type.` };
  }
  if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
    return { ok: false, message: `Discount code "${code}" is ${String(codeDiscount.status).toLowerCase()}.` };
  }

  const value = codeDiscount.customerGets?.value;
  const label = codeDiscount.title || code.trim().toUpperCase();
  if (value?.percentage != null) {
    return { ok: true, kind: "percentage", percentage: value.percentage * 100, label };
  }
  if (value?.amount?.amount) {
    return {
      ok: true,
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode,
      label,
    };
  }
  return { ok: false, message: `Discount code "${code}" does not have a supported percentage or fixed value.` };
}

/** Computes the dollar amount a resolved discount is worth against `base`. */
function discountAmountAgainst(
  resolved: { kind: "percentage"; percentage: number } | { kind: "fixed"; amount: string },
  base: number,
): number {
  if (resolved.kind === "percentage") {
    return Math.max(base * (resolved.percentage / 100), 0);
  }
  return Math.min(Math.max(parseFloat(resolved.amount) || 0, 0), base);
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
    return cors(
      new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  }

  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  const { orderId, discountCode, variantId } = await request.json();

  if (!orderId || !discountCode) {
    return cors(
      Response.json({ userErrors: [{ message: "Missing orderId or discountCode." }] }, { status: 400 }),
    );
  }

  // A variantId present means "apply to this one product only" (product
  // level). Its absence means "apply to the whole order" (order level).
  const isProductLevel = typeof variantId === "string" && variantId.length > 0;

  try {
    const resolved = await resolveDiscountCode(admin, discountCode);
    if (!resolved.ok) {
      return cors(Response.json({ userErrors: [{ message: resolved.message }] }, { status: 422 }));
    }

    const beginRes = await admin.graphql(
      `#graphql
      mutation BeginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 100) {
              nodes {
                id
                quantity
                variant { id }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    description
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

    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId: string = calculatedOrder.id;
    const allLineItems: LineItemNode[] = calculatedOrder.lineItems?.nodes ?? [];

    if (allLineItems.length === 0) {
      return cors(
        Response.json({ userErrors: [{ message: "This order has no line items to discount." }] }, { status: 422 }),
      );
    }

    const targetLineItems = isProductLevel
      ? allLineItems.filter((item) => item.variant?.id === variantId)
      : allLineItems;

    if (isProductLevel && targetLineItems.length === 0) {
      return cors(
        Response.json({ userErrors: [{ message: "That product could not be found on this order." }] }, { status: 422 }),
      );
    }

    const warnings: string[] = [];
    const skippedApplicationIds: string[] = [];
    let appliedCount = 0;

    for (const item of targetLineItems) {
      const state = readLineItemDiscountState(item);
      const originalUnit = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const currencyCode = state.currencyCode || item.originalUnitPriceSet?.shopMoney?.currencyCode || "USD";

      if (isProductLevel) {
        // ── Product-level request ──────────────────────────────────────
        if (state.isCheckoutOrigin) {
          warnings.push(
            "This product already has a discount applied during checkout. Checkout discounts cannot be modified.",
          );
          continue;
        }

        const newProductAmount = discountAmountAgainst(
          resolved.kind === "percentage"
            ? { kind: "percentage", percentage: resolved.percentage }
            : { kind: "fixed", amount: resolved.amount },
          originalLineTotal,
        );

        if (state.tag.productAmount > 0 && newProductAmount <= state.tag.productAmount) {
          warnings.push(
            `The existing product discount on this item is already greater than or equal to "${discountCode}". It was not replaced.`,
          );
          continue;
        }

        if (state.existingApplicationId) {
          skippedApplicationIds.push(state.existingApplicationId);
          const removeRes = await admin.graphql(
            `#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`,
            { variables: { id: calculatedOrderId, discountApplicationId: state.existingApplicationId } },
          );
          const removeJson = await removeRes.json();
          const removeErrors = removeJson.data?.orderEditRemoveDiscount?.userErrors ?? [];
          if (removeJson.errors?.length || removeErrors.length) {
            warnings.push(`Could not update the discount on this product: ${removeErrors[0]?.message ?? "unknown error"}.`);
            continue;
          }
        }

        const newTag: DecodedTag = {
          checkoutAmount: 0,
          productAmount: newProductAmount,
          orderAmount: state.tag.orderAmount,
          label: resolved.label,
        };
        const combinedAmount = newProductAmount + state.tag.orderAmount;

        const applyRes = await admin.graphql(
          `#graphql
          mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
            orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
              calculatedLineItem { id }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              id: calculatedOrderId,
              lineItemId: item.id,
              discount: {
                fixedValue: { amount: combinedAmount.toFixed(2), currencyCode },
                description: encodeTag(newTag),
              },
            },
          },
        );
        const applyJson = await applyRes.json();
        const applyErrors = applyJson.data?.orderEditAddLineItemDiscount?.userErrors ?? [];
        if (applyJson.errors?.length || applyErrors.length) {
          warnings.push(
            `Could not apply the product discount: ${applyJson.errors?.[0]?.message ?? applyErrors[0]?.message ?? "unknown error"}.`,
          );
          continue;
        }
        appliedCount += 1;
      } else {
        // ── Order-level request ─────────────────────────────────────────
        // Always leaves checkout and existing app discounts intact; only
        // adds to the order-level component, measured against the
        // balance left after every product-level discount.
        const baseAfterProductLevel = Math.max(
          originalLineTotal - state.tag.checkoutAmount - state.tag.productAmount,
          0,
        );

        const additionalOrderAmount = discountAmountAgainst(
          resolved.kind === "percentage"
            ? { kind: "percentage", percentage: resolved.percentage }
            : { kind: "fixed", amount: resolved.amount },
          baseAfterProductLevel,
        );

        if (additionalOrderAmount <= 0) {
          // Nothing left to discount on this line — not an error, just
          // skip it silently (e.g. it's already fully discounted).
          continue;
        }

        const newOrderAmount = state.tag.orderAmount + additionalOrderAmount;
        const newTag: DecodedTag = {
          checkoutAmount: state.tag.checkoutAmount,
          productAmount: state.tag.productAmount,
          orderAmount: newOrderAmount,
          label: state.tag.label ? `${state.tag.label} + ${resolved.label}` : resolved.label,
        };
        const combinedAmount = state.tag.checkoutAmount + state.tag.productAmount + newOrderAmount;

        if (state.existingApplicationId) {
          skippedApplicationIds.push(state.existingApplicationId);
          const removeRes = await admin.graphql(
            `#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`,
            { variables: { id: calculatedOrderId, discountApplicationId: state.existingApplicationId } },
          );
          const removeJson = await removeRes.json();
          const removeErrors = removeJson.data?.orderEditRemoveDiscount?.userErrors ?? [];
          if (removeJson.errors?.length || removeErrors.length) {
            warnings.push(`Could not update the order discount on one item: ${removeErrors[0]?.message ?? "unknown error"}.`);
            continue;
          }
        }

        const applyRes = await admin.graphql(
          `#graphql
          mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
            orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
              calculatedLineItem { id }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              id: calculatedOrderId,
              lineItemId: item.id,
              discount: {
                fixedValue: { amount: combinedAmount.toFixed(2), currencyCode },
                description: encodeTag(newTag),
              },
            },
          },
        );
        const applyJson = await applyRes.json();
        const applyErrors = applyJson.data?.orderEditAddLineItemDiscount?.userErrors ?? [];
        if (applyJson.errors?.length || applyErrors.length) {
          warnings.push(
            `Could not apply the order discount to one item: ${applyJson.errors?.[0]?.message ?? applyErrors[0]?.message ?? "unknown error"}.`,
          );
          continue;
        }
        appliedCount += 1;
      }
    }

    if (appliedCount === 0) {
      // Nothing changed on the order — no need to commit, just report why.
      return cors(
        Response.json({
          success: false,
          applied: false,
          warnings: warnings.length ? warnings : ["Nothing was eligible to be discounted."],
          userErrors: [],
        }),
      );
    }

    const commitRes = await admin.graphql(
      `#graphql
      mutation CommitEdit($id: ID!, $staffNote: String) {
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
          staffNote: isProductLevel
            ? `Product discount "${discountCode}" applied via customer account`
            : `Order discount "${discountCode}" applied via customer account`,
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
        success: true,
        applied: true,
        order: commitJson.data.orderEditCommit.order,
        appliedCount,
        warnings,
        userErrors: [],
      }),
    );
  } catch (err: unknown) {
    console.error("[order-discount2] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({ userErrors: [{ message }] }, { status: 500 }));
  }
}