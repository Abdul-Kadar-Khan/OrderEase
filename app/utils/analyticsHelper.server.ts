import db from "../db.server";

/**
 * Records an order edit action and increments feature usage counts.
 *
 * @param shop The merchant shop domain (e.g. store.myshopify.com)
 * @param orderId Shopify Order GID or ID
 * @param featureId Service/Feature key (e.g. "add-product", "edit-quantity", "cancel-order")
 * @param source UI surface source ("customer_account_ui" or "checkout_ui")
 */
export async function trackOrderEdit({
  shop,
  orderId,
  featureId,
  source = "customer_account_ui",
}: {
  shop: string;
  orderId: string;
  featureId: string;
  source?: string;
}) {
  try {
    if (!shop || !orderId) return;

    const validSource = source === "checkout_ui" ? "checkout_ui" : "customer_account_ui";

    // 1. Record each edit event in EditedOrder table
    await db.editedOrder.create({
      data: {
        shop,
        orderId,
        source: validSource,
      },
    });

    // 2. Increment feature usage in FeatureUsage table
    if (featureId) {
      await trackFeatureUsage({ shop, featureId });
    }
  } catch (error) {
    console.error("[analyticsHelper] Error tracking order edit:", error);
  }
}

/**
 * Increments feature usage count without recording an order edit action.
 *
 * @param shop The merchant shop domain
 * @param featureId Service/Feature key (e.g. "download-invoice")
 */
export async function trackFeatureUsage({
  shop,
  featureId,
}: {
  shop: string;
  featureId: string;
}) {
  try {
    if (!shop || !featureId) return;

    await db.featureUsage.upsert({
      where: {
        shop_featureId: { shop, featureId },
      },
      create: {
        shop,
        featureId,
        usedCount: 1,
      },
      update: {
        usedCount: { increment: 1 },
      },
    });
  } catch (error) {
    console.error("[analyticsHelper] Error tracking feature usage:", error);
  }
}
