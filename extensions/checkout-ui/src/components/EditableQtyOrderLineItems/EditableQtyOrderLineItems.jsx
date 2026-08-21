import { useState, useEffect } from 'preact/hooks';
import { formatMoney } from '../../utils/formatMoney';
import { updateLineItemQuantity, checkVariantQuantity } from '../../utils/api';
import { BalanceDueRedirect } from '../BalanceDueRedirect/BalanceDueRedirect.jsx';
import { getExtensionLines, getExtensionOrderId, formatOrderId, safeNavigate } from '../../utils/shopifyHelpers';
import useOrderSearch from '../../hooks/useorderSearch';

/** Countdown banner that navigates away after a successful mutation. */
function SuccessReload({ message }) {
  return (
    <s-banner tone="success">
      {message}
    </s-banner>
  );
}

function truncate(text, maxLength = 38) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

/** Render the current order's line items with editable quantity controls. */
export function EditableQtyOrderLineItems({ orderId: propOrderId }) {
  const orderId = formatOrderId(propOrderId) || getExtensionOrderId();
  // Always use apiLines — sdkLines from the checkout SDK have CartLine IDs
  // (gid://shopify/CartLine/...) which are invalid for Admin API order editing.
  const { lineItems: lines, loading } = useOrderSearch(orderId);
  const [activeLineId, setActiveLineId] = useState(null);

  if (loading && lines.length === 0) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center">
          <s-spinner size="small" />
          <s-text color="subdued">Loading items for quantity adjustment...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (!lines || lines.length === 0) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-text color="subdued">No items found in this order.</s-text>
      </s-box>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-100">
        <s-text type="strong">Modify ordered item quantities</s-text>
        <s-text size="small" color="subdued">
          Increase or reduce product counts below. Decreasing item counts initiates an automated balance refund or credit, while increases will generate an instant secure payment confirmation.
        </s-text>
      </s-stack>

      <s-scroll-box maxBlockSize="220px" accessibilityLabel="Editable order line items list">
        <s-stack direction="block" gap="small-200">
          {lines.map((line) => (
            <EditableLineItem
              key={line.id}
              line={line}
              orderId={orderId}
              activeLineId={activeLineId}
              setActiveLineId={setActiveLineId}
            />
          ))}
        </s-stack>
      </s-scroll-box>
    </s-stack>
  );
}

function EditableLineItem({ line, orderId, activeLineId, setActiveLineId }) {
  const merchandise = line.merchandise || {
    title: line.title || line.name || '',
    image: line.image || null,
    selectedOptions: line.selectedOptions || [],
  };
  const initialQuantity = line.quantity || line.currentQuantity || 1;
  const cost = line.cost || { totalAmount: line.price };

  const [quantity, setQuantity] = useState(initialQuantity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [isCheaper, setIsCheaper] = useState(false);
  const [quantityMsg, setQuantityMsg] = useState(null);
  const [currentSavedQuantity, setCurrentSavedQuantity] = useState(initialQuantity);

  const clearMessages = () => {
    setLastResult(null);
    setSuccess(false);
    setIsCheaper(false);
    setQuantityMsg(null);
    setError(null);
  };

  // Clear messages when another line item becomes active/edited
  useEffect(() => {
    if (activeLineId && activeLineId !== line.id) {
      clearMessages();
    }
  }, [activeLineId, line.id]);

  const title = merchandise.title;

  const options = (merchandise.selectedOptions || [])
    .filter((o) => o.value !== 'Default Title')
    .map((o) => `${o.name}: ${o.value}`)
    .join(' • ');

  const unitAmount = cost?.totalAmount?.amount ? Number(cost.totalAmount.amount) / (initialQuantity || 1) : 0;
  const currentTotalMoney = cost?.totalAmount ? {
    amount: (unitAmount * (quantity || 0)).toFixed(2),
    currencyCode: cost.totalAmount.currencyCode,
  } : null;
  const priceDisplay = currentTotalMoney ? formatMoney(currentTotalMoney) : '';

  const handleUpdate = async () => {
    if (setActiveLineId) setActiveLineId(line.id);
    clearMessages();
    try {
      setLoading(true);

      const variantId = merchandise?.id;
      // Only perform stock availability check if increasing item quantity
      if (variantId && quantity > currentSavedQuantity) {
        const inventory = await checkVariantQuantity(variantId);
        if (inventory) {
          if (!inventory.availableForSale && inventory.quantityAvailable !== null && inventory.quantityAvailable <= 0) {
            setQuantity(currentSavedQuantity);
            setError(
              `This product is not available in the required quantity of ${quantity}. No additional stock is available in store (you already have all ${currentSavedQuantity} units in your order).`,
            );
            return;
          }
          if (inventory.quantityAvailable !== null) {
            const availInStore = inventory.quantityAvailable;
            const maxAllowed = currentSavedQuantity + availInStore;

            if (quantity > maxAllowed) {
              if (availInStore <= 0) {
                setQuantity(currentSavedQuantity);
                setError(
                  `This product is not available in the required quantity of ${quantity}. No additional stock is available in store (you already have all ${currentSavedQuantity} units in your order).`,
                );
                return;
              } else {
                setQuantity(maxAllowed);
                setQuantityMsg(
                  `This product is not available in the required quantity of ${quantity}. Only ${availInStore} additional units are available in stock. The quantity has been adjusted to ${maxAllowed}. Click 'Save quantity' again to confirm.`,
                );
                return;
              }
            }
          }
        }
      }

      const targetQty = quantity;
      const cheaper = targetQty < currentSavedQuantity;
      const result = await updateLineItemQuantity({ orderId, lineItemId: line.id, quantity: targetQty });

      if (result.userErrors && result.userErrors.length > 0) {
        const errMsg = result.userErrors[0].message;
        if (errMsg.includes("The quantity has been adjusted to")) {
          const match = errMsg.match(/adjusted to (\d+)/);
          if (match && match[1]) {
            setQuantity(Number(match[1]));
          }
          setQuantityMsg(errMsg);
          return;
        }
        throw new Error(errMsg);
      }

      const serverMsg = result.quantityMessage;
      setLastResult(result);
      setCurrentSavedQuantity(targetQty);
      if (serverMsg) {
        setQuantityMsg(serverMsg);
      }

      if (result.balanceDue?.amount > 0) {
        // Auto-redirect to payment page handled by BalanceDueRedirect
      } else if (cheaper) {
        setIsCheaper(true);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : 'Could not update quantity';
      if (errMsg.includes("The quantity has been adjusted to")) {
        const match = errMsg.match(/adjusted to (\d+)/);
        if (match && match[1]) {
          setQuantity(Number(match[1]));
        }
        setQuantityMsg(errMsg);
      } else {
        setError(errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setQuantity(currentSavedQuantity);
    clearMessages();
  };

  const hasChanges = quantity !== currentSavedQuantity;

  return (
    <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" alignItems="center" gap="base" justifyContent="space-between">
          <s-stack direction="inline" alignItems="center" gap="base">
            <s-box inlineSize="64px">
              {merchandise.image ? (
                <s-image
                  src={merchandise.image.url}
                  alt={merchandise.image.altText || title}
                  aspectRatio="1"
                  borderRadius="base"
                />
              ) : (
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-icon type="image" size="base" tone="neutral" />
                </s-box>
              )}
            </s-box>

            <s-stack direction="block" gap="small-100">
              <s-text type="strong">{truncate(title, 42)}</s-text>
              {options ? <s-text size="small" color="subdued">{truncate(options, 40)}</s-text> : null}
              <s-text size="small" color="subdued">Unit cost: {cost?.totalAmount ? formatMoney({ amount: unitAmount.toFixed(2), currencyCode: cost.totalAmount.currencyCode }) : 'N/A'}</s-text>
            </s-stack>
          </s-stack>

          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="end">
            <s-number-field
              label="Qty"
              value={String(quantity)}
              onInput={(e) => {
                const target = e.currentTarget;
                if (target && 'value' in target) {
                  setQuantity(Number(target.value));
                  if (setActiveLineId) setActiveLineId(line.id);
                  clearMessages();
                }
              }}
              step={1}
              min={1}
              max={100}
              disabled={loading}
            ></s-number-field>

            {priceDisplay ? (
              <s-box padding="small-100">
                <s-text type="strong">
                  {priceDisplay}
                </s-text>
              </s-box>
            ) : null}
          </s-stack>
        </s-stack>

        {/* Unsaved changes control bar */}
        {hasChanges && !lastResult && !isCheaper && !success && (
          <s-box background="subdued" padding="small-200" borderRadius="base">
            <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
              <s-text size="small" tone="warning">
                Unsaved change: set to {quantity} (originally {currentSavedQuantity}).
              </s-text>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="tertiary" disabled={loading} onClick={handleReset}>
                  Reset
                </s-button>
                <s-button variant="primary" disabled={loading} onClick={handleUpdate}>
                  {loading ? 'Updating...' : 'Save quantity'}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        )}
        
        {quantityMsg && <s-banner tone="warning">{quantityMsg}</s-banner>}
        {error && <s-banner tone="critical">{error}</s-banner>}
        
        {lastResult?.balanceDue?.amount > 0 ? (
          <BalanceDueRedirect
            balanceDue={lastResult.balanceDue}
            statusPageUrl={lastResult?.order?.statusPageUrl}
          />
        ) : isCheaper ? (
          <s-banner tone="success">
            Quantity reduced successfully! Your remaining balance will be credited back to your account within 3 to 4 working days.
          </s-banner>
        ) : (
          success && <s-banner tone="success">Quantity updated successfully! Your order has been adjusted.</s-banner>
        )}
      </s-stack>
    </s-box>
  );
}