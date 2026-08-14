import { useState } from 'preact/hooks';
import { cancelOrder } from '../../utils/api';
import { getExtensionOrderId, formatOrderId, safeNavigate } from '../../utils/shopifyHelpers.js';

export function CancelOrder({ orderId: propOrderId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const orderId = formatOrderId(propOrderId) || getExtensionOrderId();

  const handleCancel = async () => {
    try {
      setLoading(true);
      setError(null);
      await cancelOrder({ orderId });
      setSuccess(true);
    } catch (err) {
      console.error('Failed to cancel order:', err);
      setError(err instanceof Error ? err.message : 'Could not submit order cancellation request at this time.');
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <s-stack direction="block" gap="base">
      {!showConfirm ? (
        <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
              <s-stack direction="inline" alignItems="center" gap="small-300">
                <s-box padding="small-200" background="subdued" borderRadius="base">
                  <s-icon type="x" size="base" tone="critical" />
                </s-box>
                <s-text type="strong">Request Entire Order Cancellation</s-text>
              </s-stack>

              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => setShowConfirm(true)}
                disabled={loading || success}
              >
                Cancel Order
              </s-button>
            </s-stack>

            <s-text size="small" color="subdued">
              Canceling will halt all packaging and shipment processing immediately and initiate an automated full refund to your payment method.
            </s-text>
          </s-stack>
        </s-box>
      ) : (
        <s-box background="subdued" padding="base" borderRadius="base" borderWidth="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-icon type="x" size="base" tone="critical" />
              <s-stack direction="block" gap="none">
                <s-text type="strong">Are you completely sure you want to cancel this order?</s-text>
                <s-text size="small" color="subdued">
                  This destructive action cannot be undone once confirmed. Your full refund will appear on your card statement within 3 to 5 business days.
                </s-text>
              </s-stack>
            </s-stack>

            <s-stack direction="inline" gap="small-200" justifyContent="end">
              <s-button
                variant="secondary"
                onClick={() => setShowConfirm(false)}
                disabled={loading}
              >
                No, keep my shipment
              </s-button>
              <s-button
                variant="primary"
                tone="critical"
                loading={loading}
                disabled={loading}
                onClick={handleCancel}
              >
                Yes, confirm cancellation
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      )}

      {error && <s-banner tone="critical">{error}</s-banner>}
      {success && (
        <s-banner tone="success">
          Your order has been successfully cancelled and your full automated refund has been processed.
        </s-banner>
      )}
    </s-stack>
  );
}
