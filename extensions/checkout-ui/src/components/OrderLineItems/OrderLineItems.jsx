import { formatMoney } from '../../utils/formatMoney';
import useOrderSearch from '../../hooks/useorderSearch';
import { getShopifyOrder, getExtensionOrderId, formatOrderId } from '../../utils/shopifyHelpers';

function truncate(text, maxLength = 38) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

/** Render the current order's active line items fetched via Admin API with currentQuantity. */
export function OrderLineItems({ orderId: propOrderId }) {
  const orderId = formatOrderId(propOrderId) || getExtensionOrderId();
  const shopifyOrder = getShopifyOrder();
  const OrderSearchData = useOrderSearch(orderId);

  const { lineItems: lines, order, loading, error } = OrderSearchData;
  const displayOrder = order || shopifyOrder;

  if (loading) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center">
          <s-spinner size="small" />
          <s-text color="subdued">Loading currently confirmed items...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (error) {
    return (
      <s-banner tone="critical">{error}</s-banner>
    );
  }

  if (!lines || lines.length === 0) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-text color="subdued">No active items found in this order.</s-text>
      </s-box>
    );
  }

  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="block" gap="none">
        <s-text type="strong">Current items in order {displayOrder ? displayOrder.name : ''}</s-text>
        <s-text size="small" color="subdued">Below are the confirmed products already packaged in this order.</s-text>
      </s-stack>

      <s-scroll-box maxBlockSize="200px" accessibilityLabel="Order line items list">
        <s-stack direction="block" gap="small-200">
          {lines.map((line) => {
            const { id, title, variantTitle, currentQuantity, image, selectedOptions, price } = line;

            const optionsText = (selectedOptions || [])
              .filter((o) => o.value !== 'Default Title')
              .map((o) => `${o.name}: ${o.value}`)
              .join(' • ') || (variantTitle && variantTitle !== 'Default Title' ? variantTitle : '');

            const formattedPrice = price ? formatMoney(price) : '';

            return (
              <s-box key={id} background="subdued" padding="small-200" borderRadius="base" borderWidth="base">
                <s-stack direction="inline" alignItems="center" gap="base" justifyContent="space-between">
                  <s-stack direction="inline" alignItems="center" gap="base">
                    <s-box inlineSize="56px">
                      {image ? (
                        <s-image
                          src={image.url}
                          alt={image.altText || title}
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
                      {optionsText ? <s-text color="subdued">{truncate(optionsText, 40)}</s-text> : null}
                      <s-text color="subdued">Quantity ordered: {currentQuantity}</s-text>
                    </s-stack>
                  </s-stack>

                  {formattedPrice ? (
                    <s-box padding="small-100">
                      <s-text type="strong">{formattedPrice}</s-text>
                    </s-box>
                  ) : null}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-scroll-box>
    </s-stack>
  );
}

