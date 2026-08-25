import db from "../db.server";

/**
 * Checks whether an order has reached the maximum allowed edit limit set by the merchant.
 *
 * @param shop The merchant shop domain (e.g. store.myshopify.com)
 * @param orderId Shopify Order GID or raw ID
 */
export async function checkOrderEditLimit({
  shop,
  orderId,
}: {
  shop: string;
  orderId: string;
}): Promise<{
  isLimitReached: boolean;
  currentEditCount: number;
  maxEdits: number | null;
}> {
  if (!shop || !orderId) {
    return { isLimitReached: false, currentEditCount: 0, maxEdits: null };
  }

  const normalizedOrderId = orderId.includes("gid://shopify/Order/")
    ? orderId
    : `gid://shopify/Order/${orderId}`;
  const rawId = orderId.replace(/^gid:\/\/shopify\/Order\//, "");

  // 1. Fetch merchant's maxEdits setting for this shop
  const timeLimitRecord = await db.orderEditTimeLimit.findUnique({
    where: { shop },
  });

  const maxEdits = timeLimitRecord?.maxEdits ?? 3; // Default 3 if not explicitly set

  // If maxEdits is null or <= 0, editing is unlimited
  if (maxEdits === null || maxEdits <= 0) {
    const currentEditCount = await db.editedOrder.count({
      where: {
        shop,
        orderId: { in: [normalizedOrderId, rawId] },
      },
    });
    return { isLimitReached: false, currentEditCount, maxEdits: null };
  }

  // 2. Count existing edit events recorded in EditedOrder table
  const currentEditCount = await db.editedOrder.count({
    where: {
      shop,
      orderId: { in: [normalizedOrderId, rawId] },
    },
  });

  const isLimitReached = currentEditCount >= maxEdits;

  return {
    isLimitReached,
    currentEditCount,
    maxEdits,
  };
}
