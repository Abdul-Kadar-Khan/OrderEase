import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

/**
 * api.order.discount2.tsx
 * -----------------------
 * Fresh, standalone implementation of discount application for the
 * customer-account order-edit flow. This route is independent of
 * api.order.discount.tsx — it does not import, call, or share code with it.
 *
 * PRODUCT-LEVEL DISCOUNTS ONLY
 *  This route only ever applies PRODUCT-level discount codes. There is no
 *  order-level discount pathway and no client-supplied product selection —
 *  the shopper only types a discount code, and this route:
 *
 *   1. Looks the code up and inspects what it targets (specific product
 *      variants, specific products, or specific collections).
 *   2. If the code targets the whole order/cart (i.e. it's an "Amount off
 *      order" style code with no product targeting), the request is
 *      rejected with a clear message — order-level codes are not allowed
 *      here.
 *   3. Otherwise, the order's line items are scanned automatically and the
 *      discount is applied to whichever line item(s) are actually eligible
 *      for that code (matching variant, matching product, or product
 *      belongs to a matching collection). The shopper never picks products
 *      themselves.
 *
 *  Business rules for the eligible line item(s):
 *   - Always calculated against the line item's ORIGINAL price, never a
 *     price that's already been discounted.
 *   - A line item can carry only one product-level discount at a time.
 *   - If a product-level discount already exists on the line item and it
 *     was applied at checkout (i.e. this app never touched it), it is
 *     left alone and a warning is returned — checkout discounts can't be
 *     modified here.
 *   - If a product-level discount already exists and it was applied by
 *     this app, it is replaced only when the new discount amount is
 *     strictly GREATER than the existing one; otherwise nothing changes
 *     on that line item and a warning is returned.
 *
 * PLATFORM CONSTRAINT THIS ROUTE HAS TO WORK AROUND
 *  Shopify's order-editing API only allows a single discount application
 *  to sit on a given line item at any moment — see "Editing discounts in
 *  an order" in Shopify help docs. This route stamps a small
 *  machine-readable tag onto the discount's `description` field so a
 *  later request can still tell how the current amount breaks down. See
 *  `encodeTag` / `decodeTag` below.
 */

const TAG_PREFIX = "@d2:";

type Money = { amount: string; currencyCode: string };

type DiscountApplicationNode = {
  id: string;
  __typename: string;
  description?: string | null;
  /**
   * "ALL" means this discount application spreads across every eligible
   * line item on the order — i.e. an order-wide ("amount off order")
   * discount, whether it was applied at checkout or added by this app.
   * Anything else ("EXPLICIT", "ENTITLED", etc.) means it targets specific
   * line item(s) only.
   */
  targetSelection?: string | null;
};

type AllocationNode = {
  allocatedAmountSet?: { shopMoney: Money } | null;
  discountApplication?: DiscountApplicationNode | null;
};

type LineItemNode = {
  id: string;
  quantity: number;
  title?: string | null;
  variant?: {
    id: string;
    title?: string | null;
    product?: {
      id: string;
      title?: string | null;
      collections?: { nodes: { id: string }[] } | null;
    } | null;
  } | null;
  originalUnitPriceSet?: { shopMoney: Money } | null;
  calculatedDiscountAllocations?: AllocationNode[] | null;
};

/** Best available display name for a line item, for warning/summary messages. */
function lineItemDisplayName(item: LineItemNode): string {
  const productTitle = item.variant?.product?.title || item.title || "this product";
  const variantTitle = item.variant?.title;
  if (variantTitle && variantTitle !== "Default Title") {
    return `${productTitle} (${variantTitle})`;
  }
  return productTitle;
}

// A discount is only ever treated as "ours" (safe to replace) when it's
// this exact typename — the one orderEditAddLineItemDiscount produces.
// Everything else (DiscountCodeApplication, AutomaticDiscountApplication,
// ScriptDiscountApplication, or any other typename) is treated as
// checkout-origin / protected by default. See readLineItemDiscountState.
const APP_ORIGIN_TYPENAME = "ManualDiscountApplication";

/** What this route has stamped into a discount's description, if anything. */
interface DecodedTag {
  /** Dollar amount already frozen in from a checkout-origin discount. */
  checkoutAmount: number;
  /** Dollar amount from a product-level discount this app applied. */
  productAmount: number;
  /** Dollar amount from order-level discount(s) this app applied in the past. */
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
  /** True only when the existing application is one THIS app created (and can therefore safely remove/replace). */
  existingIsOurs: boolean;
  /**
   * True only when there's a discount on this line item that we must leave
   * completely alone — a checkout-origin discount that specifically
   * targets this product (or another product-scoped selection). An
   * order-wide checkout discount does NOT set this: it's fine for a
   * product-level discount to be added alongside it.
   */
  blocked: boolean;
  tag: DecodedTag;
} {
  const allocations = item.calculatedDiscountAllocations ?? [];
  const currencyCode = item.originalUnitPriceSet?.shopMoney?.currencyCode ?? "";

  if (allocations.length === 0) {
    return {
      currencyCode,
      existingApplicationId: null,
      existingIsOurs: false,
      blocked: false,
      tag: { checkoutAmount: 0, productAmount: 0, orderAmount: 0, label: "" },
    };
  }

  // Shopify only ever lets one *targeted* discount application sit on a
  // line item, so in practice this array has at most one product-scoped
  // entry — but we sum defensively. An order-wide discount can appear here
  // too (proportionally allocated), alongside a product-scoped one.
  let existingApplicationId: string | null = null;
  let existingIsOurs = false;
  let blocked = false;
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
      // Only mark as "ours" if we haven't already determined that this
      // line item is blocked by a checkout-origin product-specific
      // discount. Once blocked, it stays blocked regardless of later
      // allocations in the array.
      if (!blocked) {
        existingIsOurs = true;
      }
      const decoded = decodeTag(app.description);
      if (decoded) {
        tag = decoded;
      } else {
        // A manual discount this app didn't tag (shouldn't normally
        // happen) — treat its whole value as an untracked product-level
        // amount so it isn't silently lost.
        tag = { checkoutAmount: 0, productAmount: allocatedAmount, orderAmount: 0, label: app.description ?? "" };
      }
    } else if (app.targetSelection === "ALL") {
      // An order-wide discount (e.g. a checkout-applied "amount off
      // order" code) proportionally allocated onto this line item. It
      // doesn't occupy this product's own discount slot, so a
      // product-level discount can still be added alongside it — we just
      // can't remove or shrink it, and we keep its amount around purely
      // as an informational record.
      //
      // IMPORTANT: Do NOT reset existingIsOurs or blocked here — a
      // previous allocation may have already set blocked=true for a
      // product-specific checkout discount. An order-wide allocation
      // appearing later in the array must not overwrite that.
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: tag.productAmount,
        orderAmount: tag.orderAmount,
        label: app.description || "Checkout discount",
      };
    } else {
      // Anything else that isn't a discount THIS app created — a
      // checkout discount code, automatic discount, or script discount
      // that specifically targets this product (or an unrecognized
      // targeting we can't safely reason about) — is treated as
      // protected. We leave it alone entirely rather than risk trying to
      // remove something Shopify won't actually let us remove.
      existingIsOurs = false;
      blocked = true;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: 0,
        orderAmount: 0,
        label: app.description || "Checkout discount",
      };
    }
  }

  return { currencyCode: resolvedCurrency, existingApplicationId, existingIsOurs, blocked, tag };
}

/** What a resolved discount code is allowed to apply to. */
type Targeting =
  | { type: "order" }
  | {
      type: "selection";
      variantIds: Set<string>;
      productIds: Set<string>;
      collectionIds: Set<string>;
    };

/** Looks up a Shopify discount code, its value, and what it targets. */
async function resolveDiscountCode(
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"],
  code: string,
): Promise<
  | { ok: true; kind: "percentage"; percentage: number; label: string; targeting: Targeting }
  | { ok: true; kind: "fixed"; amount: string; currencyCode: string; label: string; targeting: Targeting }
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
              items {
                __typename
                ... on AllDiscountItems {
                  allItems
                }
                ... on DiscountProducts {
                  productVariants(first: 250) { nodes { id } }
                  products(first: 250) { nodes { id } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { nodes { id } }
                }
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

  const items = codeDiscount.customerGets?.items;

  // "AllDiscountItems" means the code discounts everything in the cart —
  // that's an order-level discount code, which this route does not allow.
  if (!items || items.__typename === "AllDiscountItems") {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`,
    };
  }

  const variantIds = new Set<string>(
    (items.productVariants?.nodes ?? []).map((n: { id: string }) => n.id),
  );
  const productIds = new Set<string>(
    (items.products?.nodes ?? []).map((n: { id: string }) => n.id),
  );
  const collectionIds = new Set<string>(
    (items.collections?.nodes ?? []).map((n: { id: string }) => n.id),
  );

  if (variantIds.size === 0 && productIds.size === 0 && collectionIds.size === 0) {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`,
    };
  }

  const targeting: Targeting = { type: "selection", variantIds, productIds, collectionIds };

  const value = codeDiscount.customerGets?.value;
  const label = codeDiscount.title || code.trim().toUpperCase();
  if (value?.percentage != null) {
    return { ok: true, kind: "percentage", percentage: value.percentage * 100, label, targeting };
  }
  if (value?.amount?.amount) {
    return {
      ok: true,
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode,
      label,
      targeting,
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

/** Does this line item's variant/product/collection match what the code targets? */
function lineItemMatchesTargeting(item: LineItemNode, targeting: Targeting): boolean {
  if (targeting.type === "order") return true;

  const variantId = item.variant?.id;
  const productId = item.variant?.product?.id;
  const collectionIds = item.variant?.product?.collections?.nodes?.map((n) => n.id) ?? [];

  if (variantId && targeting.variantIds.has(variantId)) return true;
  if (productId && targeting.productIds.has(productId)) return true;
  if (collectionIds.some((id) => targeting.collectionIds.has(id))) return true;

  return false;
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

  const { orderId, discountCode } = await request.json();

  if (!orderId || !discountCode) {
    return cors(
      Response.json({ userErrors: [{ message: "Missing orderId or discountCode." }] }, { status: 400 }),
    );
  }

  try {
    const resolved = await resolveDiscountCode(admin, discountCode);
    if (!resolved.ok) {
      // Includes the "this is an order-level discount code" case.
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
                title
                variant {
                  id
                  title
                  product {
                    id
                    title
                    collections(first: 50) { nodes { id } }
                  }
                }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    description
                    targetSelection
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

    // Automatically find which line item(s) this product-level code is
    // actually eligible for. The shopper never selects products themselves.
    const targetLineItems = allLineItems.filter((item) => lineItemMatchesTargeting(item, resolved.targeting));

    if (targetLineItems.length === 0) {
      return cors(
        Response.json(
          { userErrors: [{ message: `No product eligible for discount code "${discountCode}" was found on this order.` }] },
          { status: 422 },
        ),
      );
    }

    const warnings: string[] = [];
    const appliedProducts: string[] = [];
    const skippedProducts: string[] = [];
    let appliedCount = 0;
    let replacedCount = 0;

    for (const item of targetLineItems) {
      const displayName = lineItemDisplayName(item);
      const state = readLineItemDiscountState(item);
      const originalUnit = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const currencyCode = state.currencyCode || item.originalUnitPriceSet?.shopMoney?.currencyCode || "USD";

      // Calculate what the new discount would be worth on this line item.
      const newProductAmount = discountAmountAgainst(
        resolved.kind === "percentage"
          ? { kind: "percentage", percentage: resolved.percentage }
          : { kind: "fixed", amount: resolved.amount },
        originalLineTotal,
      );

      // ─── Existing checkout-origin product-level discount (blocked) ───
      // If a checkout discount specifically targets this product, compare
      // amounts: replace if the new discount is strictly greater, otherwise
      // warn and skip.
      if (state.blocked) {
        const existingAmount = state.tag.checkoutAmount;

        if (newProductAmount <= existingAmount) {
          // New discount is not greater — keep the existing one.
          warnings.push(
            `"${displayName}" already has a checkout discount worth ${existingAmount.toFixed(2)} ${currencyCode}. ` +
              `"${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode}, so the existing discount was kept.`,
          );
          skippedProducts.push(displayName);
          continue;
        }

        // New discount IS greater — attempt to remove the old and apply the new.
        if (state.existingApplicationId) {
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
            const rawMessage = removeErrors[0]?.message ?? removeJson.errors?.[0]?.message ?? "unknown error";
            warnings.push(
              `"${displayName}" has a checkout discount (${existingAmount.toFixed(2)} ${currencyCode}). ` +
                `Tried to replace with "${discountCode}" (${newProductAmount.toFixed(2)} ${currencyCode}) but removal failed: ${rawMessage}`,
            );
            skippedProducts.push(displayName);
            continue;
          }
        }

        // Old checkout discount removed — now apply the new one below.
        // (falls through to the apply step at the bottom of the loop)
      } else {
        // ─── Existing APP-applied product discount (not blocked) ───
        // Replace only when the new one is strictly greater.
        if (state.tag.productAmount > 0 && newProductAmount <= state.tag.productAmount) {
          const existingLabel = state.tag.label ? `"${state.tag.label}"` : "The existing discount";
          warnings.push(
            `"${displayName}" already has ${existingLabel} applied, worth ${state.tag.productAmount.toFixed(2)} ${currencyCode}. ` +
              `"${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode} on this product, so the existing discount was kept.`,
          );
          skippedProducts.push(displayName);
          continue;
        }

        // Remove existing app-applied discount before adding the new one.
        if (state.existingApplicationId && state.existingIsOurs) {
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
            const rawMessage = removeErrors[0]?.message ?? removeJson.errors?.[0]?.message ?? "unknown error";
            if (/discount code/i.test(rawMessage) && /can'?t be removed/i.test(rawMessage)) {
              warnings.push(
                `"${displayName}" already has a discount applied — skipped.`,
              );
            } else {
              warnings.push(`Could not update the discount on "${displayName}": ${rawMessage}.`);
            }
            skippedProducts.push(displayName);
            continue;
          }
        }
      }

      // ─── Apply the new discount ───
      const wasReplacement = state.blocked || state.tag.productAmount > 0;

      const newTag: DecodedTag = {
        checkoutAmount: state.blocked ? 0 : state.tag.checkoutAmount,
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
        const rawMessage = applyJson.errors?.[0]?.message ?? applyErrors[0]?.message ?? "unknown error";
        if (state.tag.checkoutAmount > 0 && /discount/i.test(rawMessage)) {
          warnings.push(
            `"${displayName}" already has an order-level discount from checkout — could not add another discount on top.`,
          );
        } else {
          warnings.push(`Could not apply the discount to "${displayName}": ${rawMessage}.`);
        }
        skippedProducts.push(displayName);
        continue;
      }

      appliedCount += 1;
      appliedProducts.push(displayName);
      if (wasReplacement) replacedCount += 1;
    }

    if (appliedCount === 0) {
      // Nothing changed on the order — no need to commit, just report why.
      // Return HTTP 200 (not 422) so the frontend doesn't throw — the loop
      // completed normally, it's just that every eligible product was
      // skipped for a known reason. The caller gets `applied: false` with
      // per-product warnings.
      //
      // IMPORTANT: userErrors stays empty so the frontend api.js helper
      // does NOT throw (it checks `result.userErrors?.length`). The
      // warnings array tells the UI exactly what happened per product.
      return cors(
        Response.json({
          success: false,
          applied: false,
          appliedCount: 0,
          appliedProducts: [],
          skippedProducts,
          discountLabel: resolved.label,
          warnings: warnings.length ? warnings : ["No eligible products found for this discount code."],
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
          staffNote: `Product discount "${discountCode}" applied via customer account`,
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
        appliedProducts,
        replacedCount,
        skippedProducts,
        discountLabel: resolved.label,
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