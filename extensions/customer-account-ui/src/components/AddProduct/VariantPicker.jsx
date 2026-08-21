import { useState, useEffect } from 'preact/hooks';
import { formatMoney } from '../../utils/formatMoney';
import { addProductToOrder, checkVariantQuantity } from '../../utils/api';

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
  const variants = product.variants?.nodes ?? [];
  const [selectedVariantId, setSelectedVariantId] = useState(
    variants[0]?.id ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [liveInventory, setLiveInventory] = useState(null);

  const hasMultipleVariants = variants.length > 1;
  const selectedVariant = variants.find((v) => v.id === selectedVariantId) || variants[0];

  // Fetch real-time inventory whenever selected variant changes
  useEffect(() => {
    if (!selectedVariantId) return;

    let isCurrent = true;
    checkVariantQuantity(selectedVariantId).then((res) => {
      if (isCurrent && res && typeof res.quantityAvailable === 'number') {
        setLiveInventory(res.quantityAvailable);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [selectedVariantId, selectedVariant]);

  const availableStock = liveInventory;
  const isOutOfStock = selectedVariant?.availableForSale === false;
  const isQuantityExceeded = availableStock !== null && availableStock > 0 && quantity > availableStock;

  async function handleAdd() {
    if (!selectedVariantId) return;

    setSubmitting(true);
    setError(null);

    try {
      let qtyToAdd = quantity;
      let qtyMessage = null;

      const inventory = await checkVariantQuantity(selectedVariantId);
      const avail = inventory?.quantityAvailable ?? availableStock;

      if (inventory) {
        if (!inventory.availableForSale) {
          throw new Error('This item is currently out of stock.');
        }
        if (avail !== null && avail !== undefined) {
          if (avail <= 0) {
            throw new Error('This item is currently out of stock.');
          }
          if (quantity > avail) {
            qtyToAdd = avail;
            qtyMessage = `This product is not available in the required quantity of ${quantity}. Only ${avail} units are available in stock. Added ${avail} quantity to your order.`;
          }
        }
      }

      const result = await addProductToOrder({
        orderId,
        variantId: selectedVariantId,
        quantity: qtyToAdd,
      });

      const messageToToast = qtyMessage || 'Product added to order';
      shopify.toast.show(messageToToast);
      onAdded(result, qtyMessage || result.quantityMessage || null);
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
        <s-stack direction="block" gap="none">
          <s-text type="strong">{product.title}</s-text>
          {availableStock !== null && availableStock !== undefined ? (
            <s-text color={availableStock <= 0 ? 'critical' : 'subdued'}>
              {availableStock <= 0 ? 'Out of stock' : `Available in stock: ${availableStock} units`}
            </s-text>
          ) : null}
        </s-stack>
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
        max={availableStock && availableStock > 0 ? availableStock : 999}
        disabled={submitting || isOutOfStock}
        onInput={(e) => {
          const target = e.currentTarget;
          if (target && 'value' in target) {
            setQuantity(Math.max(1, Number(target.value)));
          }
        }}
      />

      {isQuantityExceeded ? (
        <s-banner tone="warning">
          This product is not available in the required quantity of {quantity}. Only {availableStock} unitss are available in stock. Adding to order will set quantity to {availableStock}.
        </s-banner>
      ) : null}

      {isOutOfStock ? (
        <s-banner tone="critical">
          This product is currently out of stock and cannot be added.
        </s-banner>
      ) : null}

      {error ? <s-banner tone="critical">{error}</s-banner> : null}

      <s-stack direction="inline" justifyContent="end">
        <s-button
          variant="primary"
          disabled={!selectedVariantId || submitting || isOutOfStock}
          loading={submitting}
          onClick={handleAdd}
        >
          Add to order
        </s-button>
      </s-stack>
    </s-stack>
  );
}