import { formatMoney } from '../../utils/formatMoney';

/** Renders the list of products matching the current search term. */
export function ProductResults({ results, loading, error, searchTerm, onSelect }) {
  if (!searchTerm.trim()) {
    return null;
  }

  if (loading) {
    return (
      <s-stack direction="inline" alignItems="center" gap="small">
        <s-spinner size="small" />
        <s-text color="subdued">Searching…</s-text>
      </s-stack>
    );
  }

  if (error) {
    return <s-text tone="critical">{error}</s-text>;
  }

  if (results.length === 0) {
    return <s-text color="subdued">No products found for "{searchTerm}".</s-text>;
  }

  return (
    <s-scroll-box maxBlockSize="200px" accessibilityLabel="Product search results list">
      <s-stack direction="block" gap="small-300">
        {results.map((product, index) => {
          const startingPrice = product.variants?.nodes?.[0]?.price;

          return (
            <s-stack key={product.id} direction="block" gap="small-200">
              <s-clickable onClick={() => onSelect(product)}>
                <s-stack direction="inline" alignItems="center" gap="small" justifyContent="space-between">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-box inlineSize="48px">
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

                    <s-stack direction="block" gap="small-200">
                      <s-text type="strong">{product.title}</s-text>
                      {startingPrice ? (
                        <s-text color="subdued">From {formatMoney(startingPrice)}</s-text>
                      ) : null}
                    </s-stack>
                  </s-stack>

                  <s-icon type="chevron-right" size="small" tone="neutral" />
                </s-stack>
              </s-clickable>
              {index < results.length - 1 && <s-divider direction="inline"></s-divider>}
            </s-stack>
          );
        })}
      </s-stack>
    </s-scroll-box>
  );
}
