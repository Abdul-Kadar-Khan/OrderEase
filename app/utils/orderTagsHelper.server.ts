/**
 * orderTagsHelper.server.ts
 *
 * Shared utility to add order tags after a successful order modification.
 *
 * Tags added:
 * - "Order-Updated": applied after any successful order edit (always).
 * - "Refund": applied when `owesRefund` is true (i.e. the merchant owes the
 *   customer money — e.g. a quantity decrease or variant downgrade resulted
 *   in a negative outstanding balance).
 *
 * The helper fetches current tags first and only sends new tags to avoid
 * duplicates and to preserve any tags the merchant already added.
 */

const TAG_UPDATED = "Order-Updated";
const TAG_REFUND = "Refund";

interface AdminGraphQL {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

/**
 * Fetches the current tags on an order.
 */
async function getOrderTags(admin: AdminGraphQL, orderId: string): Promise<string[]> {
  const res = await admin.graphql(
    `#graphql
    query GetOrderTags($id: ID!) {
      order(id: $id) {
        tags
      }
    }`,
    { variables: { id: orderId } },
  );
  const json = await res.json();
  return (json.data?.order?.tags as string[]) ?? [];
}

/**
 * Adds the specified tags to an order while preserving existing tags.
 * Skips the mutation entirely if all desired tags already exist.
 *
 * @param admin       - Shopify Admin GraphQL client
 * @param orderId     - GID of the order (e.g. "gid://shopify/Order/123")
 * @param owesRefund  - Pass `true` when the edit results in the merchant
 *                      owing the customer a refund (negative balance due).
 */
export async function addOrderTags(
  admin: AdminGraphQL,
  orderId: string,
  owesRefund = false,
): Promise<void> {
  try {
    const existingTags = await getOrderTags(admin, orderId);
    const existingSet = new Set(existingTags.map((t) => t.toLowerCase()));

    const tagsToAdd: string[] = [];

    if (!existingSet.has(TAG_UPDATED.toLowerCase())) {
      tagsToAdd.push(TAG_UPDATED);
    }

    if (owesRefund && !existingSet.has(TAG_REFUND.toLowerCase())) {
      tagsToAdd.push(TAG_REFUND);
    }

    if (tagsToAdd.length === 0) {
      // Nothing new to add — skip the mutation.
      return;
    }

    // Merge with existing tags and send the full list (Shopify replaces all tags).
    const mergedTags = [...existingTags, ...tagsToAdd];

    const updateRes = await admin.graphql(
      `#graphql
      mutation AddOrderTags($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            tags
          }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: orderId, tags: mergedTags } } },
    );

    const updateJson = await updateRes.json();
    const errors = updateJson.data?.orderUpdate?.userErrors ?? [];
    if (errors.length) {
      console.warn("[orderTagsHelper] Failed to update tags:", errors);
    }
  } catch (err) {
    // Tag updates are best-effort — don't let a tagging failure bubble up
    // and invalidate an otherwise successful order edit.
    console.error("[orderTagsHelper] Unexpected error while updating tags:", err);
  }
}
