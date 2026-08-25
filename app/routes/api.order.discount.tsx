import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
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
    return cors(Response.json(
      { userErrors: [{ message: "Missing orderId or discountCode." }] },
      { status: 400 }
    ));
  }

  // variantIds, when provided, scopes the discount to only those product
  // variants' line items. Omitted/empty means "apply to the whole order".
  const targetVariantIds: string[] | null =
    Array.isArray(variantIds) && variantIds.length > 0 ? variantIds : null;

  try {
    // ── Step 1: Validate the discount code ──────────────────────────────────
    const discountRes = await admin.graphql(
      `#graphql
      query validateDiscount($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          id
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
      { variables: { code: discountCode.trim().toUpperCase() } },
    );
    const discountJson = await discountRes.json();
    const discountNode = discountJson.data?.codeDiscountNodeByCode;

    if (!discountNode) {
      return cors(Response.json(
        { userErrors: [{ message: `Discount code "${discountCode}" not found.` }] },
        { status: 404 }
      ));
    }

    const codeDiscount = discountNode.codeDiscount;
    if (codeDiscount?.status && codeDiscount.status !== "ACTIVE") {
      return cors(Response.json(
        { userErrors: [{ message: `Discount code "${discountCode}" is ${codeDiscount.status.toLowerCase()}.` }] },
        { status: 422 }
      ));
    }

    // Extract discount value from DiscountCodeBasic
    let discountInput: Record<string, unknown> | null = null;
    if (codeDiscount?.__typename === "DiscountCodeBasic") {
      const value = codeDiscount.customerGets?.value;
      if (value?.percentage != null) {
        discountInput = {
          percentValue: value.percentage * 100, // API expects 0-100
          description: codeDiscount.shortSummary || discountCode.trim().toUpperCase(),
        };
      } else if (value?.amount?.amount) {
        discountInput = {
          fixedValue: {
            amount: value.amount.amount,
            currencyCode: value.amount.currencyCode,
          },
          description: codeDiscount.shortSummary || discountCode.trim().toUpperCase(),
        };
      }
    }

    if (!discountInput) {
      return cors(Response.json(
        { userErrors: [{ message: "This discount type is not supported (only percentage and fixed-amount codes are accepted)." }] },
        { status: 422 }
      ));
    }

    // ── Step 1b: Work out which products/variants this code is even allowed
    // to apply to ─────────────────────────────────────────────────────────
    // A code discount can be scoped to "all items", to specific products /
    // variants, or to entire collections. If it's restricted, applying it to
    // a product outside that scope should be refused with a clear message
    // rather than silently discounting (or erroring out from) something the
    // merchant never configured it for.
    type Eligibility =
      | { type: "all" }
      | { type: "restricted"; productIds: Set<string>; variantIds: Set<string> };

    let eligibility: Eligibility = { type: "all" };
    if (codeDiscount?.__typename === "DiscountCodeBasic") {
      const items = codeDiscount.customerGets?.items;
      if (items?.__typename === "DiscountProducts") {
        eligibility = {
          type: "restricted",
          productIds: new Set((items.products?.nodes ?? []).map((p: { id: string }) => p.id)),
          variantIds: new Set((items.productVariants?.nodes ?? []).map((v: { id: string }) => v.id)),
        };
      } else if (items?.__typename === "DiscountCollections") {
        const collectionIds: string[] = (items.collections?.nodes ?? []).map((c: { id: string }) => c.id);
        const productIds = new Set<string>();
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
          const productNodes = collJson.data?.collection?.products?.nodes ?? [];
          for (const p of productNodes as { id: string }[]) productIds.add(p.id);
        }
        eligibility = { type: "restricted", productIds, variantIds: new Set() };
      }
      // Anything else (including AllDiscountItems, or no items data at all)
      // is left as { type: "all" } — unrestricted.
    }

    // ── Step 2: Begin order edit + get calculated line items ────────────────
    const beginRes = await admin.graphql(
      `#graphql
      mutation orderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 50) {
              nodes {
                id
                quantity
                editableQuantity
                variant { id product { id title } }
                originalUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                calculatedDiscountAllocations {
                  allocatedAmountSet {
                    shopMoney { amount currencyCode }
                  }
                  discountApplication {
                    __typename
                    id
                    description
                    allocationMethod
                    targetSelection
                    targetType
                    value {
                      ... on PricingPercentageValue {
                        percentage
                      }
                      ... on MoneyV2 {
                        amount
                        currencyCode
                      }
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
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const allLineItems = (calculatedOrder.lineItems?.nodes ?? []).filter(
      (item: { quantity?: number; editableQuantity?: number }) => {
        const qty = item.editableQuantity ?? item.quantity ?? 0;
        return qty > 0;
      },
    );

    if (allLineItems.length === 0) {
      return cors(Response.json(
        { userErrors: [{ message: "No line items found to apply the discount to." }] },
        { status: 422 }
      ));
    }

    // Narrow down to the requested products, if the customer chose specific
    // ones rather than the whole order.
    type Money = { amount: string; currencyCode: string };
    type DiscountApplicationNode = {
      __typename?: string;
      id: string;
      description?: string | null;
      allocationMethod?: string | null;
      targetSelection?: string | null;
      targetType?: string | null;
      value?: {
        percentage?: number;
        amount?: string;
        currencyCode?: string;
      } | null;
    };
    type LineItemNode = {
      id: string;
      quantity: number;
      variant?: { id: string; product?: { id: string; title?: string | null } | null } | null;
      originalUnitPriceSet?: { shopMoney: Money } | null;
      calculatedDiscountAllocations?: {
        allocatedAmountSet?: { shopMoney: Money } | null;
        discountApplication?: DiscountApplicationNode | null;
      }[];
    };

    let lineItems: LineItemNode[] = allLineItems;

    // Shopify's order-edit API always represents a discount we add via
    // orderEditAddLineItemDiscount as a generic "manual" discount
    // application — it does NOT link back to the original discount code
    // (DIS10, PRO10, etc.), nor to whether it was a product-level or
    // order-level application, even though that's what a customer typed in.
    // That means there is no field we can query later to ask "which code(s)
    // are already on this line item, and how much did each contribute?" —
    // the API genuinely doesn't retain any of that. To make duplicate
    // detection AND correct stacking math possible, we tag each discount's
    // code, scope, and dollar amount into the `description` we send, using a
    // `[code:scope:amount|code:scope:amount] label` format, and parse that
    // same tag back out on every subsequent request.
    //
    // scope is "O" (order-level: this request had no specific product
    // selected) or "P" (product-level: this request targeted specific
    // product(s)). This distinction matters for the math below: multiple
    // order-level discounts are each calculated against the subtotal AFTER
    // product-level discounts (and summed with each other), matching how
    // Shopify's real checkout combines multiple order-level discounts —
    // rather than each one compounding on top of the last. Product-level
    // discounts keep compounding sequentially, since a customer targeting a
    // specific product again is intentionally stacking onto whatever's
    // already been done to that product.
    // `percent` is only set for percentage-type discounts — it's what lets a
    // later request compare "is the new code's percentage greater than the
    // one already on this product?" without re-querying Shopify for the
    // original discount definition (which orderEdit doesn't expose anyway).
    // Fixed-amount discounts leave it undefined.
    type DiscountEntry = {
      code: string;
      scope: "O" | "P";
      amount: number;
      percent?: number;
      isCheckout?: boolean;
    };

    // Shopify's order-edit API gives us exactly one string field
    // (`description`) to both DISPLAY to the customer/staff on the order AND
    // to persist our own tracking data in (code, scope, dollar amount) for
    // parsing back out on a later request — there's nowhere else to stash
    // it. Earlier this just prefixed a raw "[DIS10:P:1.52:10.00]" tag onto
    // the text, which is exactly the ugly, confusing string customers were
    // seeing on their order. To fix that while still keeping the tracking
    // data, the tag is now encoded as invisible zero-width characters
    // appended after a clean, human-readable label — e.g. the customer sees
    // "DIS10 10% + PRO50 50%", while the same string still silently carries
    // everything needed to parse it back into entries next time.
    // ── Compact invisible encoding (base-4) ─────────────────────────────────
    // Shopify limits the description field to 255 characters. The old binary
    // encoding used 8 ZW chars per byte — way too many for stacked discounts.
    // Base-4 uses 4 ZW chars per byte (2 bits each), halving the size.
    // A different marker (U+FEFF) distinguishes new payloads from old ones so
    // the decoder can handle both formats transparently.
    const ZW_B4 = ["\u200B", "\u200C", "\u2060", "\u2062"] as const; // 00, 01, 10, 11
    const ZW_B4_MAP: Record<string, number> = { "\u200B": 0, "\u200C": 1, "\u2060": 2, "\u2062": 3 };
    const ZW_MARK_NEW = "\uFEFF"; // byte-order mark — new-format delimiter
    const ZW_MARK_OLD = "\u200D"; // old-format delimiter (backward compat)

    function encodeInvisiblePayload(payload: string): string {
      const bytes = Array.from(new TextEncoder().encode(payload));
      const chars: string[] = [];
      for (const b of bytes) {
        chars.push(ZW_B4[(b >> 6) & 3]);
        chars.push(ZW_B4[(b >> 4) & 3]);
        chars.push(ZW_B4[(b >> 2) & 3]);
        chars.push(ZW_B4[b & 3]);
      }
      return `${ZW_MARK_NEW}${chars.join("")}${ZW_MARK_NEW}`;
    }

    function decodeBase4(zwChars: string): string | null {
      const charArr = Array.from(zwChars);
      const byteCount = Math.floor(charArr.length / 4);
      const bytes = new Uint8Array(byteCount);
      for (let i = 0; i < byteCount; i++) {
        const a = ZW_B4_MAP[charArr[i * 4]] ?? 0;
        const b = ZW_B4_MAP[charArr[i * 4 + 1]] ?? 0;
        const c = ZW_B4_MAP[charArr[i * 4 + 2]] ?? 0;
        const d = ZW_B4_MAP[charArr[i * 4 + 3]] ?? 0;
        bytes[i] = (a << 6) | (b << 4) | (c << 2) | d;
      }
      try { return new TextDecoder().decode(bytes); } catch { return null; }
    }

    function decodeOldBinary(zwChars: string): string | null {
      const bits = Array.from(zwChars, (ch) => (ch === "\u200C" ? "1" : "0")).join("");
      const byteCount = Math.floor(bits.length / 8);
      const bytes = new Uint8Array(byteCount);
      for (let i = 0; i < byteCount; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
      try { return new TextDecoder().decode(bytes); } catch { return null; }
    }

    function extractInvisiblePayload(text: string): { visible: string; payload: string | null } {
      // Try new base-4 format first (U+FEFF markers)
      let start = text.indexOf(ZW_MARK_NEW);
      if (start !== -1) {
        const end = text.indexOf(ZW_MARK_NEW, start + 1);
        if (end !== -1) {
          const payload = decodeBase4(text.slice(start + 1, end));
          const visible = text.slice(0, start) + text.slice(end + 1);
          return { visible, payload };
        }
      }
      // Fall back to old binary format (U+200D markers)
      start = text.indexOf(ZW_MARK_OLD);
      if (start !== -1) {
        const end = text.indexOf(ZW_MARK_OLD, start + 1);
        if (end !== -1) {
          const payload = decodeOldBinary(text.slice(start + 1, end));
          const visible = text.slice(0, start) + text.slice(end + 1);
          return { visible, payload };
        }
      }
      return { visible: text, payload: null };
    }

    // Trim a percentage down to a clean, natural-looking number for display —
    // 10 stays "10", 12.5 stays "12.5", 12.50 becomes "12.5".
    function formatPercentForDisplay(percent: number): string {
      return (Math.round(percent * 100) / 100).toString();
    }

    function formatEntryForDisplay(entry: DiscountEntry, currencyCode?: string): string {
      if (typeof entry.percent === "number") {
        return `${entry.code} ${formatPercentForDisplay(entry.percent)}%`;
      }
      return currencyCode ? `${entry.code} ${entry.amount.toFixed(2)} ${currencyCode}` : entry.code;
    }

    function parseTaggedDescription(description?: string | null): { entries: DiscountEntry[]; label: string } {
      if (!description) return { entries: [], label: "" };
      const { visible, payload } = extractInvisiblePayload(description);
      if (!payload) return { entries: [], label: visible };
      const entries: DiscountEntry[] = payload
        .split("|")
        .filter(Boolean)
        .map((part) => {
          const [code, scope, amount, percent] = part.split(":");
          const entry: DiscountEntry = { code, scope: scope === "P" ? "P" : "O", amount: parseFloat(amount) || 0 };
          if (percent !== undefined && percent !== "") {
            const parsedPercent = parseFloat(percent);
            if (!Number.isNaN(parsedPercent)) entry.percent = parsedPercent;
          }
          return entry;
        });
      return { entries, label: visible };
    }
    function buildTaggedDescription(entries: DiscountEntry[], visibleLabel: string): string {
      const tag = entries
        .map((e) => `${e.code}:${e.scope}:${e.amount.toFixed(2)}:${e.percent != null ? e.percent.toFixed(2) : ""}`)
        .join("|");
      const full = `${visibleLabel}${encodeInvisiblePayload(tag)}`;
      // Shopify limits description to 255 characters — if the tagged version
      // still doesn't fit (e.g. many stacked codes), fall back to just the
      // visible label so the discount still applies (tracking data is lost but
      // the discount itself works).
      if (full.length > 255) {
        console.warn(`[order-discount] Tagged description too long (${full.length} chars), falling back to visible label only.`);
        return visibleLabel.slice(0, 255);
      }
      return full;
    }

    if (targetVariantIds) {
      const targetSet = new Set(targetVariantIds);
      lineItems = allLineItems.filter((item: LineItemNode) =>
        item.variant?.id && targetSet.has(item.variant.id),
      );

      if (lineItems.length === 0) {
        return cors(Response.json(
          { userErrors: [{ message: "The selected product(s) could not be found on this order." }] },
          { status: 422 }
        ));
      }
    }

    // ── Step 2b: Drop any targeted line items this code isn't eligible for ──
    // e.g. a "specific products" code configured for HP 15 and p1 should not
    // silently discount a T-shirt just because it was selected alongside them.
    const skipWarnings: string[] = [];
    if (eligibility.type === "restricted") {
      const eligibleItems: LineItemNode[] = [];
      const ineligibleItems: LineItemNode[] = [];
      for (const item of lineItems) {
        const variantId = item.variant?.id;
        const productId = item.variant?.product?.id;
        const isEligible =
          (!!variantId && eligibility.variantIds.has(variantId)) ||
          (!!productId && eligibility.productIds.has(productId));
        (isEligible ? eligibleItems : ineligibleItems).push(item);
      }

      if (ineligibleItems.length > 0) {
        const productTitles = Array.from(
          new Set(ineligibleItems.map((item) => item.variant?.product?.title || "a selected product")),
        );
        skipWarnings.push(
          `The discount code "${discountCode.trim().toUpperCase()}" is not available for: ${productTitles.join(", ")}.`,
        );
      }

      lineItems = eligibleItems;

      if (lineItems.length === 0) {
        return cors(Response.json(
          { userErrors: [{ message: skipWarnings[0] }] },
          { status: 422 }
        ));
      }
    }

    // ── Step 3: Work out what each targeted line item already has on it ─────
    // Shopify's order-edit API only allows ONE discount application to sit on
    // a line item at a time (orderEditAddLineItemDiscount is effectively a
    // "set", not an "add" — calling it twice replaces the first discount
    // rather than stacking it). That's fine when a line item has nothing on
    // it yet, but if it already carries a discount (e.g. an order-wide code
    // applied earlier) we do NOT want to silently throw that away just
    // because we can only attach one application. Instead, for each targeted
    // line item we calculate the dollar value of whatever is already applied
    // to it, and fold that into the new discount as a single combined
    // fixed-amount discount — so the customer keeps the benefit of both
    // codes on that item, applied sequentially (existing discount first,
    // new discount off the already-discounted subtotal), even though under
    // the hood it's now represented as one application instead of two.
    const existingDiscountApplicationIds = new Set<string>();
    const discountAppIdsByLineItemId = new Map<string, Set<string>>();
    const combineInfoByLineItemId = new Map<
      string,
      { entries: DiscountEntry[]; currencyCode: string; unremovableCheckoutDiscountTotal: number }
    >();
    const requestScope: "O" | "P" = targetVariantIds ? "P" : "O";

    for (const item of lineItems) {
      const allocations = item.calculatedDiscountAllocations ?? [];
      const entries: DiscountEntry[] = [];
      let currencyCode = item.originalUnitPriceSet?.shopMoney?.currencyCode ?? "";
      const itemRemovableAppIds = new Set<string>();
      let unremovableCheckoutDiscountTotal = 0;

      const originalUnit = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0");
      const originalLineTotal = originalUnit * item.quantity;

      for (const allocation of allocations) {
        const app = allocation.discountApplication;
        if (!app) continue;

        const allocatedAmount = parseFloat(allocation.allocatedAmountSet?.shopMoney?.amount ?? "0");

        if (allocation.allocatedAmountSet?.shopMoney?.currencyCode) {
          currencyCode = allocation.allocatedAmountSet.shopMoney.currencyCode;
        }

        const isRemovable = app.__typename === "OrderEditAppliedDiscount";
        if (isRemovable && app.id) {
          existingDiscountApplicationIds.add(app.id);
          itemRemovableAppIds.add(app.id);
        } else {
          unremovableCheckoutDiscountTotal += allocatedAmount;
        }

        const { entries: parsedEntries } = parseTaggedDescription(app.description);
        if (parsedEntries.length > 0) {
          entries.push(...parsedEntries);
        } else {
          // Checkout discount application — CalculatedDiscountApplication only
          // exposes `description`, not `code` or `title`.
          const code = (app.description || "CHECKOUT_DISCOUNT").trim().toUpperCase();
          const scope: "O" | "P" = app.targetSelection === "ALL" ? "O" : "P";
          let percent: number | undefined = undefined;
          if (app.value?.percentage != null) {
            percent = app.value.percentage;
          } else if (originalLineTotal > 0 && allocatedAmount > 0) {
            percent = Math.round((allocatedAmount / originalLineTotal) * 10000) / 100;
          }

          entries.push({
            code,
            scope,
            amount: allocatedAmount,
            percent,
            isCheckout: !isRemovable,
          });
        }
      }

      if (itemRemovableAppIds.size > 0) discountAppIdsByLineItemId.set(item.id, itemRemovableAppIds);

      if (entries.length > 0 || unremovableCheckoutDiscountTotal > 0) {
        combineInfoByLineItemId.set(item.id, {
          entries,
          currencyCode,
          unremovableCheckoutDiscountTotal,
        });
      }
    }

    // ── Step 3b: Block re-applying a code that's already active in this
    // request's scope ────────────────────────────────────────────────────────
    // - Order-level request (no product selected): if DIS10 is already sitting
    //   on ANY line item in the order, refuse — it's "already applied to this
    //   order," full stop, even if it only landed on one product earlier.
    // - Product-level request (specific product(s) selected): if DIS10 is
    //   already sitting on ANY of the selected line items, refuse for the
    //   same reason, scoped to those products.
    // Either way this is an all-or-nothing check done before any mutation is
    // made, so a duplicate never results in a partial/silent re-application.
    const normalizedRequestedCode = discountCode.trim().toUpperCase();
    const alreadyAppliedItemIds = new Set<string>();
    for (const [itemId, info] of combineInfoByLineItemId) {
      if (info.entries.some((e) => e.code.trim().toUpperCase() === normalizedRequestedCode)) {
        alreadyAppliedItemIds.add(itemId);
      }
    }

    if (alreadyAppliedItemIds.size > 0) {
      return cors(Response.json(
        {
          userErrors: [{
            message: targetVariantIds
              ? `The discount code "${discountCode}" is already applied to the selected product(s).`
              : `The discount code "${discountCode}" is already applied to this order.`,
          }],
        },
        { status: 422 }
      ));
    }

    // ── Step 3b2: Block product-level requests when the targeted line item(s)
    // already carry a product-level discount that came from the original
    // checkout ────────────────────────────────────────────────────────────────
    // Checkout-originating discounts are non-removable (we can't delete them
    // via orderEditRemoveDiscount) and are tagged with `isCheckout: true`
    // during the parsing loop above. If a customer selected specific
    // product(s) and any of those products already have a product-scoped
    // checkout discount (e.g. "PRO10 10%"), we refuse the request entirely —
    // we don't want to replace, stack, or override checkout discounts.
    if (requestScope === "P") {
      const checkoutBlockedProducts: string[] = [];
      for (const item of lineItems) {
        const combineInfo = combineInfoByLineItemId.get(item.id);
        if (!combineInfo) continue;

        const hasCheckoutProductDiscount = combineInfo.entries.some(
          (e) => e.isCheckout && e.scope === "P",
        );
        if (hasCheckoutProductDiscount) {
          const productTitle = item.variant?.product?.title || "a selected product";
          checkoutBlockedProducts.push(productTitle);
        }
      }

      if (checkoutBlockedProducts.length > 0) {
        const uniqueTitles = Array.from(new Set(checkoutBlockedProducts));
        return cors(Response.json(
          {
            userErrors: [{
              message: uniqueTitles.length === 1
                ? `"${uniqueTitles[0]}" already has a product discount applied from checkout. This discount cannot be replaced or overridden.`
                : `The following products already have a product discount applied from checkout and cannot be replaced or overridden: ${uniqueTitles.join(", ")}.`,
            }],
          },
          { status: 422 },
        ));
      }
    }

    // ── Step 3c: A new percentage code targeting a specific product must beat
    // whatever percentage discount is already sitting on that product ───────
    // This only kicks in for product-scoped requests (a specific product was
    // selected) where the new code is percentage-based AND the product's
    // existing product-level discount(s) are also all percentage-based (a
    // fixed-amount discount already on the product isn't comparable to a
    // percentage, so those fall back to the previous combine behavior).
    // - New % > existing best %: the existing product-level discount(s) get
    //   replaced (not stacked) by the new one further down.
    // - New % <= existing best %: skip this item entirely — leave its
    //   existing discount untouched and surface a warning instead.
    const skippedItemIds = new Set<string>();

    if (requestScope === "P" && typeof discountInput.percentValue === "number") {
      for (const item of lineItems) {
        const combineInfo = combineInfoByLineItemId.get(item.id);
        if (!combineInfo) continue;

        const productEntries = combineInfo.entries.filter((e) => e.scope === "P");
        if (productEntries.length === 0) continue;

        const allComparable = productEntries.every((e) => typeof e.percent === "number");
        if (!allComparable) continue;

        let bestExisting = productEntries[0];
        for (const entry of productEntries) {
          if ((entry.percent as number) > (bestExisting.percent as number)) bestExisting = entry;
        }
        const bestExistingPercent = bestExisting.percent as number;

        if (discountInput.percentValue <= bestExistingPercent) {
          skippedItemIds.add(item.id);
          skipWarnings.push(
            `The discount code "${normalizedRequestedCode}" (${discountInput.percentValue}%) is not greater than "${bestExisting.code}" (${bestExistingPercent}%), which is already applied to this product. The existing discount was kept.`,
          );
        }
      }
    }

    // Only remove discount applications for items that are actually being
    // replaced — items skipped above must keep their current discount intact.
    const removableDiscountApplicationIds = new Set<string>();
    for (const item of lineItems) {
      if (skippedItemIds.has(item.id)) continue;
      const ids = discountAppIdsByLineItemId.get(item.id);
      if (ids) for (const id of ids) removableDiscountApplicationIds.add(id);
    }

    // ── Step 4: Clear whatever was there, then apply the (possibly combined)
    // discount to each targeted line item ───────────────────────────────────
    let replacedDiscount = false;
    for (const discountApplicationId of removableDiscountApplicationIds) {
      const removeRes = await admin.graphql(
        `#graphql
        mutation removeDiscount($id: ID!, $discountApplicationId: ID!) {
          orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
            userErrors { field message }
          }
        }`,
        { variables: { id: calculatedOrderId, discountApplicationId } },
      );
      const removeJson = (await removeRes.json()) as {
        data?: { orderEditRemoveDiscount?: { userErrors?: { field?: string[]; message?: string }[] } };
        errors?: { message: string }[];
      };
      const removeErrors = removeJson.data?.orderEditRemoveDiscount?.userErrors ?? [];
      if (removeJson.errors?.length || removeErrors.length) {
        // Non-fatal: if we can't clear it, the apply step below will surface
        // a clear conflict message instead of failing silently.
        console.warn(
          `[order-discount] Could not remove existing discount ${discountApplicationId}:`,
          removeJson.errors ?? removeErrors,
        );
        continue;
      }
      replacedDiscount = true;
    }

    let combinedCount = 0;
    let appliedCount = 0;
    let replacedForHigherDiscountCount = 0;
    const applyFailures: string[] = [];

    for (const item of lineItems) {
      if (skippedItemIds.has(item.id)) continue; // lower/equal % — leave existing discount as-is

      const combineInfo = combineInfoByLineItemId.get(item.id);
      const originalUnit = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const newPercent = typeof discountInput.percentValue === "number" ? discountInput.percentValue : undefined;

      let itemDiscountInput: Record<string, unknown>;
      const unremovableCheckoutTotal = combineInfo?.unremovableCheckoutDiscountTotal ?? 0;

      if (combineInfo && combineInfo.entries.length > 0) {
        // For a product-scoped request, any prior product-level discount(s)
        // on this item are being taken over by the new (higher) code rather
        // than stacked with it — Step 3c already confirmed the new code beats
        // them, or that there weren't any comparable ones to begin with.
        // Order-level codes are untouched either way, since they aren't
        // "the discount on this product" the customer is replacing.
        const wasReplacingProductDiscount =
          requestScope === "P" && combineInfo.entries.some((e) => e.scope === "P");
        const survivingEntries: DiscountEntry[] =
          requestScope === "P" ? combineInfo.entries.filter((e) => e.scope === "O") : combineInfo.entries;

        const productLevelTotal = survivingEntries
          .filter((e) => e.scope === "P")
          .reduce((sum, e) => sum + e.amount, 0);
        const orderLevelTotal = survivingEntries
          .filter((e) => e.scope === "O")
          .reduce((sum, e) => sum + e.amount, 0);

        let newDiscountAmount = 0;

        if (requestScope === "O") {
          // Order-level discounts are each calculated against the subtotal
          // AFTER product-level discounts (not further reduced by other
          // order-level discounts already applied) and summed together —
          // e.g. PRO10 takes price to 100, then DIS10 (10%) and DIS20 (20%)
          // are each computed off that same 100, for 10 + 20 = 30 total off,
          // not DIS20 compounding on top of DIS10's already-discounted 90.
          const baseAfterProductLevel = Math.max(originalLineTotal - productLevelTotal, 0);
          const remainingOrderLevelBudget = Math.max(baseAfterProductLevel - orderLevelTotal, 0);

          if (typeof discountInput.percentValue === "number") {
            newDiscountAmount = baseAfterProductLevel * (discountInput.percentValue / 100);
          } else if (discountInput.fixedValue) {
            const fixedAmount = parseFloat((discountInput.fixedValue as { amount: string }).amount);
            newDiscountAmount = Math.min(fixedAmount, remainingOrderLevelBudget);
          }
          // A percentage order-level discount can still never take more than
          // what's left after everything else already applied.
          newDiscountAmount = Math.min(newDiscountAmount, remainingOrderLevelBudget);
        } else {
          // The new product-level discount is computed fresh off whatever's
          // left after any surviving order-level discounts — NOT stacked on
          // top of the product-level discount it's replacing.
          const remainingAfterExisting = Math.max(originalLineTotal - (productLevelTotal + orderLevelTotal), 0);
          if (typeof discountInput.percentValue === "number") {
            newDiscountAmount = remainingAfterExisting * (discountInput.percentValue / 100);
          } else if (discountInput.fixedValue) {
            const fixedAmount = parseFloat((discountInput.fixedValue as { amount: string }).amount);
            newDiscountAmount = Math.min(fixedAmount, remainingAfterExisting);
          }
        }

        const combinedEntries: DiscountEntry[] = [
          ...survivingEntries,
          { code: normalizedRequestedCode, scope: requestScope, amount: newDiscountAmount, percent: newPercent },
        ];
        const combinedTotal = combinedEntries.reduce((sum, e) => sum + e.amount, 0);
        // Rebuild the label from the entries actually surviving (with their
        // own % or amount), rather than reusing old description text, so a
        // replaced product discount's code drops out of the label too.
        const combinedLabel = combinedEntries
          .map((e) => formatEntryForDisplay(e, combineInfo.currencyCode))
          .join(" + ");

        const additionalDiscountAmount = Math.max(combinedTotal - unremovableCheckoutTotal, 0);

        if (additionalDiscountAmount <= 0) {
          if (wasReplacingProductDiscount) {
            replacedForHigherDiscountCount += 1;
          } else {
            combinedCount += 1;
          }
          appliedCount += 1;
          continue;
        }

        itemDiscountInput = {
          fixedValue: {
            amount: additionalDiscountAmount.toFixed(2),
            currencyCode: combineInfo.currencyCode,
          },
          description: buildTaggedDescription(combinedEntries, combinedLabel),
        };
        if (wasReplacingProductDiscount) {
          replacedForHigherDiscountCount += 1;
        } else {
          combinedCount += 1;
        }
      } else {
        // Fresh application: work out the dollar amount ourselves (even
        // though Shopify will independently compute the same thing from the
        // raw percent/fixed value) purely so it's recorded in the tag for
        // future combine math.
        let newDiscountAmount = 0;
        if (typeof discountInput.percentValue === "number") {
          newDiscountAmount = originalLineTotal * (discountInput.percentValue / 100);
        } else if (discountInput.fixedValue) {
          const fixedAmount = parseFloat((discountInput.fixedValue as { amount: string }).amount);
          newDiscountAmount = Math.min(fixedAmount, originalLineTotal);
        }

        const freshEntry: DiscountEntry = {
          code: normalizedRequestedCode,
          scope: requestScope,
          amount: newDiscountAmount,
          percent: newPercent,
        };
        const freshCurrencyCode =
          (discountInput.fixedValue as { currencyCode?: string } | undefined)?.currencyCode
          ?? item.originalUnitPriceSet?.shopMoney?.currencyCode;

        const additionalDiscountAmount = Math.max(newDiscountAmount - unremovableCheckoutTotal, 0);

        if (additionalDiscountAmount <= 0) {
          appliedCount += 1;
          continue;
        }

        const itemQty = (item as { editableQuantity?: number; quantity?: number }).editableQuantity
          ?? (item as { quantity?: number }).quantity
          ?? 1;
        const perUnitAdditionalAmount = Math.min(additionalDiscountAmount / itemQty, originalUnit);

        itemDiscountInput = {
          fixedValue: {
            amount: perUnitAdditionalAmount.toFixed(2),
            currencyCode: freshCurrencyCode || "USD",
          },
          description: buildTaggedDescription([freshEntry], formatEntryForDisplay(freshEntry, freshCurrencyCode)),
        };
      }

      const applyRes = await admin.graphql(
        `#graphql
        mutation applyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`,
        { variables: { id: calculatedOrderId, lineItemId: item.id, discount: itemDiscountInput } },
      );
      const applyJson = (await applyRes.json()) as {
        data?: {
          orderEditAddLineItemDiscount?: {
            calculatedLineItem?: { id: string };
            userErrors?: { field?: string[]; message?: string }[];
          };
        };
        errors?: { message: string }[];
      };

      // Top-level GraphQL errors (bad ID, permissions, etc.) don't show up in
      // userErrors — check for those separately or a bad lineItemId will fail
      // silently and leave nothing staged for the commit step.
      const topLevelErrors = applyJson.errors ?? [];
      const userErrors = applyJson.data?.orderEditAddLineItemDiscount?.userErrors ?? [];
      const stagedLineItem = applyJson.data?.orderEditAddLineItemDiscount?.calculatedLineItem;

      if (topLevelErrors.length || userErrors.length || !stagedLineItem) {
        const rawMessage =
          topLevelErrors[0]?.message ?? userErrors[0]?.message ?? "Unknown error";
        console.warn(`[order-discount] Could not apply to line item ${item.id}:`, rawMessage);

        const message = /discount which prevents applying additional discounts/i.test(rawMessage)
          ? "This order already has a discount that couldn't be automatically replaced. Please remove the existing discount from the order and try again."
          : rawMessage;

        applyFailures.push(message);
        continue;
      }

      appliedCount += 1;
    }

    if (appliedCount === 0) {
      const message = skipWarnings[0]
        ?? (applyFailures[0]
          ? `Could not apply the discount: ${applyFailures[0]}`
          : "Could not apply the discount to any of the selected item(s).");
      return cors(Response.json(
        { userErrors: [{ message }] },
        { status: 422 }
      ));
    }

    // ── Step 5: Commit ────────────────────────────────────────────────────────
    const commitRes = await admin.graphql(
      `#graphql
      mutation orderEditCommit($id: ID!, $staffNote: String) {
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
          staffNote:
            (targetVariantIds
              ? `Discount code applied to ${appliedCount} selected product(s) via customer account`
              : "Discount code applied to entire order via customer account") +
            (replacedForHigherDiscountCount > 0
              ? ` (replaced a lower discount with the new higher one on ${replacedForHigherDiscountCount} item(s))`
              : "") +
            (combinedCount > 0
              ? ` (combined with an existing discount on ${combinedCount} item(s))`
              : replacedDiscount
                ? " (replaced a previously applied discount)"
                : "") +
            (skipWarnings.length > 0
              ? ` (${skipWarnings.length} item(s) were skipped — see warnings)`
              : ""),
        },
      },
    );
    const commitJson = await commitRes.json();
    const commitErrors = commitJson.data?.orderEditCommit?.userErrors ?? [];
    if (commitErrors.length) {
      return cors(Response.json({ userErrors: commitErrors }, { status: 422 }));
    }

    const order = commitJson.data.orderEditCommit.order;
    const summary = codeDiscount?.shortSummary ?? discountCode;
    return cors(Response.json({
      order,
      summary,
      replacedDiscount,
      combinedCount,
      replacedForHigherDiscountCount,
      warnings: skipWarnings,
      userErrors: [],
    }));
  } catch (err: unknown) {
    console.error("[order-discount] Unexpected error:", err);
    return cors(Response.json(
      { userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] },
      { status: 500 }
    ));
  }
}