import db from "../db.server";

export interface EditLimitStatus {
  maxEdits: number | null; // null or 0 means unlimited
  editCount: number;
  isLimitReached: boolean;
}

/**
  Checks whether the maximum edit limit has been reached for a specific order.
 
  @param shop Merchant shop domain (e.g. store.myshopify.com)
  @param orderId Order GID or ID
 */
export async function checkOrderEditLimit({
  shop,
  orderId,
}: {
  shop: string;
  orderId?: string | null;
}): Promise<EditLimitStatus> {
  if (!shop) {
    return { maxEdits: null, editCount: 0, isLimitReached: false };
  }

  // 1. Fetch merchant setting
  const timeLimitRecord = await db.orderEditTimeLimit.findUnique({
    where: { shop },
  });

  const maxEdits = timeLimitRecord?.maxEdits ?? 3;

  // 0 or negative or null means unlimited
  if (!maxEdits || maxEdits <= 0) {
    return { maxEdits: null, editCount: 0, isLimitReached: false };
  }

  if (!orderId) {
    return { maxEdits, editCount: 0, isLimitReached: false };
  }

  // Normalize order ID if needed (e.g. numeric or GID)
  const normalizedOrderId = orderId.includes("Order/")
    ? orderId
    : `gid://shopify/Order/${orderId.replace(/\D/g, "")}`;

  // 2. Count existing edit records for this order
  const count = await db.editedOrder.count({
    where: {
      shop,
      OR: [
        { orderId },
        { orderId: normalizedOrderId },
        { orderId: orderId.replace(/\D/g, "") },
      ],
    },
  });

  const isLimitReached = count >= maxEdits;

  return {
    maxEdits,
    editCount: count,
    isLimitReached,
  };
}
