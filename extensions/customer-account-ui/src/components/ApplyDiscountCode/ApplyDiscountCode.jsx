import { useState } from 'preact/hooks';
import { applyDiscountCode } from '../../utils/api.js';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

export function ApplyDiscountCode() {
  const order = shopify.order.value;

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const { notifyUpdateSuccess } = useOrderEdit();

  async function handleApply() {
    const trimmed = code.trim();
    if (!trimmed) { setError('Please enter a valid promotion code.'); return; }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await applyDiscountCode({
        orderId: order.id,
        discountCode: trimmed,
      });
      setResult(res);
      if (res?.applied) {
        setCode('');
        notifyUpdateSuccess(res?.order?.statusPageUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply discount code.');
    } finally {
      setSubmitting(false);
    }
  }

  const hasSkipped = result?.skippedProducts?.length > 0;
  const hasApplied = result?.appliedProducts?.length > 0;

  return (
    <s-stack direction="block" gap="base">
      <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" alignItems="center" gap="small-200">
            <s-box padding="small-100" background="subdued" borderRadius="base">
              <s-icon type="discount" size="small" tone="neutral" />
            </s-box>
            <s-stack direction="block" gap="none">
              <s-text type="strong">Promotion & Voucher Center</s-text>
              <s-text size="small" color="subdued">
                Enter a discount code below. Eligible promotions are automatically calculated and any resulting price reductions will be credited directly to your original payment method.
              </s-text>
            </s-stack>
          </s-stack>

          <s-text-field
            label="Promotional discount code"
            name="discountCode"
            value={code}
            disabled={submitting}
            placeholder="e.g., SUMMER20"
            onInput={(e) => {
              const target = e.currentTarget;
              if (target && 'value' in target) {
                setCode(String(target.value).toUpperCase());
                setError(null);
                setResult(null);
              }
            }}
          />

          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              disabled={submitting || !code.trim()}
              loading={submitting}
              onClick={handleApply}
            >
              Apply Code
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>

      {/* ── Success: at least one product was discounted ── */}
      {result?.applied && (
        <s-banner tone="success">
          Discount "{result.discountLabel}" applied to {result.appliedCount}{' '}
          product{result.appliedCount === 1 ? '' : 's'}
          {hasApplied ? ` (${result.appliedProducts.join(', ')})` : ''}.
          {' '}Your order totals have been adjusted.
          {result.replacedCount > 0
            ? ` Note: This promotion automatically upgraded and replaced a lower discount on ${result.replacedCount === 1 ? 'an item' : `${result.replacedCount} items`}.`
            : ''}
        </s-banner>
      )}

      {/* ── Partial success: some products were skipped ── */}
      {result?.applied && hasSkipped && (
        <s-banner tone="warning">
          {result.warnings?.length > 0
            ? result.warnings.join(' ')
            : `Some items in your shipment were skipped because they already benefit from a higher discount.`}
        </s-banner>
      )}

      {/* ── Failure: no products were discounted ── */}
      {result && !result.applied && (
        <s-banner tone="warning">
          {result.warnings?.length > 0
            ? result.warnings.join(' ')
            : 'The entered discount code could not be applied to the items in this order.'}
        </s-banner>
      )}

      {error && <s-banner tone="critical">{error}</s-banner>}
    </s-stack>
  );
}