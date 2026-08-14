import { useState, useEffect, useCallback } from 'preact/hooks';
import { getOrderDetails } from '../utils/api';
import { getExtensionOrderId, formatOrderId } from '../utils/shopifyHelpers';

/**
 * Custom hook to fetch rich order details from our backend (via Shopify Admin API).
 * Dynamically resolves and polls for the extension Order ID if not immediately ready on mount.
 */
export function useOrderSearch(initialOrderId) {
  const normalizedInitial = formatOrderId(initialOrderId);
  const [data, setData] = useState({ order: null, lineItems: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resolvedOrderId, setResolvedOrderId] = useState(normalizedInitial || getExtensionOrderId());

  // Dynamically resolve & poll for orderId if missing at initial mount
  useEffect(() => {
    let active = true;
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 300ms = 9 seconds total polling window

    const normalized = formatOrderId(initialOrderId);
    if (normalized) {
      setResolvedOrderId(normalized);
      return;
    }

    const currentId = getExtensionOrderId();
    if (currentId) {
      setResolvedOrderId(currentId);
      return;
    }

    setLoading(true);
    const interval = setInterval(() => {
      attempts++;
      const foundId = getExtensionOrderId();
      if (foundId && active) {
        setResolvedOrderId(foundId);
        clearInterval(interval);
      } else if (attempts >= maxAttempts && active) {
        clearInterval(interval);
        setLoading(false);
        setError("No order ID available.");
      }
    }, 300);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [initialOrderId]);

  const fetchOrder = useCallback(async () => {
    if (!resolvedOrderId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await getOrderDetails({ orderId: resolvedOrderId });
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
  }, [resolvedOrderId]);

  useEffect(() => {
    if (resolvedOrderId) {
      fetchOrder();
    }
  }, [resolvedOrderId, fetchOrder]);

  return {
    order: data.order,
    lineItems: data.lineItems,
    loading,
    error,
    resolvedOrderId,
    refetch: fetchOrder
  };
}

export { useOrderSearch as useOrderDetails };
export default useOrderSearch;