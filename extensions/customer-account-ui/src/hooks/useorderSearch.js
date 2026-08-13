import { useState, useEffect, useCallback } from 'preact/hooks';
import { getOrderDetails } from '../utils/api';

/**
 * Custom hook to fetch rich order details from our backend (via Shopify Admin API).
 * Returns real-time line items with updated currentQuantity and pricing after order edits.
 */
export function useOrderSearch(orderID) {
  const [data, setData] = useState({ order: null, lineItems: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Default to current extension order context if ID isn't explicitly passed
  const targetOrderId = orderID || shopify.order.value?.id;

  const fetchOrder = useCallback(async () => {
    if (!targetOrderId) {
      setError("No order ID available.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getOrderDetails({ orderId: targetOrderId });
      setData({
        order: result.order ?? null,
        lineItems: result.lineItems ?? [],
      });
    } catch (err) {
      console.error("[useOrderSearch] Error fetching order details:", err);
      setError(err.message || "Failed to load order details.");
    } finally {
      setLoading(false);
    }
  }, [targetOrderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  return { order: data.order, lineItems: data.lineItems, loading, error, refetch: fetchOrder };
}

export { useOrderSearch as useOrderDetails };
export default useOrderSearch;