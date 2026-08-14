import { formatMoney } from '../../utils/formatMoney';

/**
 * Renders recommended upsell products derived from the tags of existing items in the order.
 */
export function UpsellRecommendations({ products, loading, error, onSelect }) {
  if (loading) {
    return (
      <s-box padding="small-200" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200">
          <s-spinner size="small" />
          <s-text color="subdued" size="small">Finding pairing recommendations tailored to your order...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (error || !products || products.length === 0) {
    return null;
  }

  return (
    <s-stack direction="block" gap="small-300" paddingBlockStart="small-200">
      <s-stack direction="inline" alignItems="center" gap="small-200">
        <s-box padding="small-100" background="subdued" borderRadius="base">
          <s-icon type="star" size="small" tone="neutral" />
        </s-box>
        <s-stack direction="block" gap="none">
          <s-text type="strong">Frequently paired with your order</s-text>
          <s-text size="small" color="subdued">Curated add-ons matching items in your current package</s-text>
        </s-stack>
      </s-stack>

      <s-scroll-box maxBlockSize="200px" accessibilityLabel="Recommended pairing products list">
        <s-stack direction="block" gap="small-200">
          {products.map((product) => {
            const startingPrice = product.variants?.nodes?.[0]?.price;

            return (
              <s-box key={product.id} background="subdued" padding="small-200" borderRadius="base" borderWidth="base">
                <s-clickable onClick={() => onSelect(product)}>
                  <s-stack direction="inline" alignItems="center" gap="small" justifyContent="space-between">
                    <s-stack direction="inline" alignItems="center" gap="base">
                      <s-box inlineSize="48px">
                        {product.featuredImage ? (
                          <s-image
                            src={product.featuredImage.url}
                            alt={product.featuredImage.altText || product.title}
                            aspectRatio="1"
                            borderRadius="base"
                          />
                        ) : (
                          <s-box padding="small-200" background="subdued" borderRadius="base">
                            <s-icon type="image" size="base" tone="neutral" />
                          </s-box>
                        )}
                      </s-box>

                      <s-stack direction="block" gap="none">
                        <s-text type="strong">{product.title}</s-text>
                        {startingPrice ? (
                          <s-text color="subdued">{formatMoney(startingPrice)}</s-text>
                        ) : null}
                      </s-stack>
                    </s-stack>

                    <s-box background="subdued" padding="small-100" borderRadius="base">
                      <s-stack direction="inline" alignItems="center" gap="small-100">
                        <s-text type="strong">Select</s-text>
                        <s-icon type="chevron-right" size="small" tone="neutral" />
                      </s-stack>
                    </s-box>
                  </s-stack>
                </s-clickable>
              </s-box>
            );
          })}
        </s-stack>
      </s-scroll-box>
    </s-stack>
  );
}

