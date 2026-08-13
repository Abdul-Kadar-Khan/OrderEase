import { useState } from 'preact/hooks';
import { formatMoney } from '../../utils/formatMoney';
import { addProductToOrder } from '../../utils/api';

/** Format a variant's selected options as "Size: M, Color: Blue". */
function variantLabel(variant) {
  const options = (variant.selectedOptions || [])
    .filter((o) => o.value !== 'Default Title')
    .map((o) => `${o.name}: ${o.value}`)
    .join(', ');
  return options || variant.title;
}

/**
 * Lets the customer pick a variant and quantity for the selected product,
 * then submits the add-to-order request.
 */
export function VariantPicker({ product, orderId, onBack, onAdded }) {
  const [selectedVariantId, setSelectedVariantId] = useState(
    product.variants?.nodes?.[0]?.id ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const variants = product.variants?.nodes ?? [];
  const hasMultipleVariants = variants.length > 1;

  async function handleAdd() {
    if (!selectedVariantId) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await addProductToOrder({
        orderId,
        variantId: selectedVariantId,
        quantity,
      });

      shopify.toast.show('Product added to order');
      onAdded(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err) || 'Failed to add product';
      setError(msg);
      shopify.toast.show(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <s-stack direction="block" gap="base">
      <s-clickable onClick={onBack}>
        <s-stack direction="inline" alignItems="center" gap="small-200">
          <s-icon type="chevron-left" size="small" tone="neutral" />
          <s-text color="subdued">Back to search</s-text>
        </s-stack>
      </s-clickable>

      <s-stack direction="inline" alignItems="center" gap="small">
        <s-box inlineSize="64px">
          {product.featuredImage ? (
            <s-image
              src={product.featuredImage.url}
              alt={product.featuredImage.altText || product.title}
              aspectRatio="1"
              borderRadius="base"
            />
          ) : (
            <s-icon type="image" size="large" tone="neutral" />
          )}
        </s-box>
        <s-text type="strong">{product.title}</s-text>
      </s-stack>

      {hasMultipleVariants && (
        <s-stack direction="block" gap="small-200">
          <s-text color="subdued">Choose an option</s-text>
          <s-scroll-box maxBlockSize="180px" accessibilityLabel="Product options list">
            <s-stack direction="block" gap="small-100">
              {variants.map((variant) => (
                <s-clickable
                  key={variant.id}
                  disabled={!variant.availableForSale}
                  onClick={() => setSelectedVariantId(variant.id)}
                >
                  <s-box padding="small-200" background={selectedVariantId === variant.id ? 'subdued' : 'transparent'} borderRadius="base">
                    <s-stack direction="inline" alignItems="center" justifyContent="space-between">
                      <s-stack direction="inline" alignItems="center" gap="small-200">
                        <s-icon
                          type={selectedVariantId === variant.id ? 'check-circle-filled' : 'circle'}
                          size="small"
                          tone={selectedVariantId === variant.id ? 'success' : 'neutral'}
                        />
                        <s-text color={variant.availableForSale ? undefined : 'subdued'}>
                          {variantLabel(variant)}
                          {!variant.availableForSale ? ' (sold out)' : ''}
                        </s-text>
                      </s-stack>
                      <s-text color="subdued">{formatMoney(variant.price)}</s-text>
                    </s-stack>
                  </s-box>
                </s-clickable>
              ))}
            </s-stack>
          </s-scroll-box>
        </s-stack>
      )}

      <s-number-field
        label="Quantity"
        value={String(quantity)}
        min={1}
        disabled={submitting}
        onInput={(e) => {
          const target = e.currentTarget;
          if (target && 'value' in target) {
            setQuantity(Math.max(1, Number(target.value)));
          }
        }}
      />

      {error ? <s-banner tone="critical">{error}</s-banner> : null}

      <s-stack direction="inline" justifyContent="end">
        <s-button
          variant="primary"
          disabled={!selectedVariantId || submitting}
          loading={submitting}
          onClick={handleAdd}
        >
          Add to order
        </s-button>
      </s-stack>
    </s-stack>
  );
}