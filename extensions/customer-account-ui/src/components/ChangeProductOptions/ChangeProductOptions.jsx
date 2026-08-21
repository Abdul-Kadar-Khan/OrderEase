import { useState, useEffect } from 'preact/hooks';
import { formatMoney } from '../../utils/formatMoney';
import { changeLineItemVariant } from '../../utils/api';
import { BalanceDueRedirect } from '../BalanceDueRedirect/BalanceDueRedirect.jsx';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';
import useOrderSearch from '../../hooks/useorderSearch';

function truncate(text, maxLength = 38) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

const PRODUCT_VARIANTS_QUERY = `#graphql
  query getProductVariants($id: ID!) {
    product(id: $id) {
      id
      title
      featuredImage {
        url
        altText
      }
      variants(first: 50) {
        nodes {
          id
          title
          availableForSale
          selectedOptions {
            name
            value
          }
          price {
            amount
            currencyCode
          }
        }
      }
    }
  }
`;

function variantLabel(variant) {
  const options = (variant.selectedOptions || [])
    .filter((o) => o.value !== 'Default Title')
    .map((o) => `${o.name}: ${o.value}`)
    .join(' • ');
  return options || variant.title;
}

export function ChangeProductOptions() {
  const shopifyOrder = shopify.order.value;
  const { lineItems: lines, order, loading, error, refetch } = useOrderSearch(shopifyOrder?.id);
  const displayOrder = order || shopifyOrder;
  const [selectedLine, setSelectedLine] = useState(null);

  if (loading && (!lines || lines.length === 0)) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center">
          <s-spinner size="small" />
          <s-text color="subdued">Loading items...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (error) {
    return <s-banner tone="critical">{error}</s-banner>;
  }

  if (!lines || lines.length === 0) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-text color="subdued">No active items found in this order.</s-text>
      </s-box>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      {selectedLine ? (
        <ChangeVariantPicker
          line={selectedLine}
          orderId={displayOrder?.id || shopifyOrder?.id}
          onBack={() => setSelectedLine(null)}
          onChanged={() => {
            setSelectedLine(null);
            refetch();
          }}
        />
      ) : (
        <s-stack direction="block" gap="small-300">
          <s-stack direction="block" gap="small-100">
            <s-text type="strong">Select an item to customize</s-text>
            <s-text size="small" color="subdued">
              Choose an item in your order below to change its size, color, pattern, or other configured style options.
            </s-text>
          </s-stack>

          <s-scroll-box maxBlockSize="200px" accessibilityLabel="Select item to customize options">
            <s-stack direction="block" gap="small-200">
              {lines.map((line) => {
                const { merchandise } = line;
                const title = merchandise.product ? merchandise.title : merchandise.title;
                const options = (merchandise.selectedOptions || [])
                  .filter((o) => o.value !== 'Default Title')
                  .map((o) => `${o.name}: ${o.value}`)
                  .join(' • ');

                return (
                  <s-box key={line.id} background="subdued" padding="small-200" borderRadius="base" borderWidth="base">
                    <s-clickable onClick={() => setSelectedLine(line)}>
                      <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="small" padding="small-200">
                        <s-stack direction="inline" alignItems="center" gap="base">
                          <s-box inlineSize="56px">
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
                          <s-stack direction="block" gap="none">
                            <s-text type="strong">{truncate(title, 42)}</s-text>
                            {options ? <s-text color="subdued">{truncate(options, 40)}</s-text> : null}
                            <s-text color="subdued">Qty: {line.quantity}</s-text>
                          </s-stack>
                        </s-stack>

                        <s-box background="subdued" padding="small-100" borderRadius="base">
                          <s-stack direction="inline" alignItems="center" gap="small-100">
                            <s-text type="strong">Change options</s-text>
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
      )}
    </s-stack>
  );
}

function ChangeVariantPicker({ line, orderId, onBack, onChanged }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(line.merchandise.id);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [isCheaper, setIsCheaper] = useState(false);
  const { notifyUpdateSuccess } = useOrderEdit();

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setLoading(true);
        const productId = line.merchandise.product?.id;
        if (!productId) {
          throw new Error("Could not find product for this line item.");
        }
        
        const { data, errors } = await shopify.query(PRODUCT_VARIANTS_QUERY, {
          variables: { id: productId },
        });

        if (errors?.length) {
          throw new Error(errors[0].message);
        }

        setProduct(data.product);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load options');
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [line]);

  const handleUpdate = async () => {
    if (!selectedVariantId || selectedVariantId === line.merchandise.id) return;

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    setIsCheaper(false);

    try {
      const selectedVariant = product.variants.nodes.find(v => v.id === selectedVariantId);
      const newPrice = parseFloat(selectedVariant?.price?.amount || 0);
      const oldPrice = line.cost?.totalAmount?.amount 
        ? parseFloat(line.cost.totalAmount.amount) / line.quantity 
        : 0;
      const cheaper = newPrice < oldPrice;

      const result = await changeLineItemVariant({
        orderId,
        oldLineItemId: line.id,
        newVariantId: selectedVariantId,
        quantity: line.quantity,
      });
      setLastResult(result);
      notifyUpdateSuccess(result?.order?.statusPageUrl);

      if (result.balanceDue?.amount > 0) {
        // Balance due handled statically
      } else if (cheaper) {
        setIsCheaper(true);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not change product options');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center">
          <s-spinner size="small" />
          <s-text color="subdued">Loading available options...</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (error) {
    return (
      <s-stack direction="block" gap="base">
        <s-banner tone="critical">{error}</s-banner>
        <s-stack direction="inline" justifyContent="end">
          <s-button onClick={onBack}>Back to items</s-button>
        </s-stack>
      </s-stack>
    );
  }

  if (!product) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-text color="subdued">Product details could not be loaded.</s-text>
      </s-box>
    );
  }

  const variants = product.variants?.nodes ?? [];
  const hasMultipleVariants = variants.length > 1;

  return (
    <s-stack direction="block" gap="base">
      <s-clickable onClick={onBack}>
        <s-stack direction="inline" alignItems="center" gap="small-200">
          <s-icon type="chevron-left" size="small" tone="neutral" />
          <s-text type="strong" size="small" color="interactive">Back to items</s-text>
        </s-stack>
      </s-clickable>

      <s-box background="subdued" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="inline" alignItems="center" gap="base">
          <s-box inlineSize="64px">
            {product.featuredImage ? (
              <s-image
                src={product.featuredImage.url}
                alt={product.featuredImage.altText || product.title}
                aspectRatio="1"
                borderRadius="base"
              />
            ) : (
              <s-box padding="base" background="surface" borderRadius="base">
                <s-icon type="image" size="base" tone="neutral" />
              </s-box>
            )}
          </s-box>
          <s-stack direction="block" gap="none">
            <s-text size="small" color="subdued">Customizing item options:</s-text>
            <s-text type="strong" size="medium">{product.title}</s-text>
          </s-stack>
        </s-stack>
      </s-box>

      {hasMultipleVariants ? (
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">Choose a preferred option (e.g. size or color):</s-text>
          <s-scroll-box maxBlockSize="180px" accessibilityLabel="Product variant options list">
            <s-stack direction="block" gap="small-200">
              {variants.map((variant) => {
                const isCurrent = variant.id === line.merchandise.id;
                const isSelected = selectedVariantId === variant.id;
                return (
                  <s-box
                    key={variant.id}
                    padding="small-200"
                    background={isSelected ? 'subdued' : 'transparent'}
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-clickable
                      disabled={(!variant.availableForSale && !isCurrent) || submitting}
                      onClick={() => setSelectedVariantId(variant.id)}
                    >
                      <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
                        <s-stack direction="inline" alignItems="center" gap="small-200">
                          <s-icon
                            type={isSelected ? 'check-circle-filled' : 'circle'}
                            size="base"
                            tone={isSelected ? 'success' : 'neutral'}
                          />
                          <s-stack direction="block" gap="none">
                            <s-text type="strong" color={variant.availableForSale || isCurrent ? undefined : 'subdued'}>
                              {variantLabel(variant)}
                              {isCurrent ? ' (Current selection)' : ''}
                            </s-text>
                            {!variant.availableForSale && !isCurrent ? (
                              <s-text color="subdued">Out of stock</s-text>
                            ) : null}
                          </s-stack>
                        </s-stack>
                        <s-text type="strong" color="subdued">{formatMoney(variant.price)}</s-text>
                      </s-stack>
                    </s-clickable>
                  </s-box>
                );
              })}
            </s-stack>
          </s-scroll-box>
        </s-stack>
      ) : (
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-text color="subdued">This product has only one standard option configuration.</s-text>
        </s-box>
      )}

      {lastResult?.balanceDue?.amount > 0 ? (
        <BalanceDueRedirect
          balanceDue={lastResult.balanceDue}
          statusPageUrl={lastResult?.order?.statusPageUrl}
        />
      ) : isCheaper ? (
        <s-banner tone="success">
          Option updated successfully! Any remaining price difference will be credited directly to your account within 3 to 4 working days.
        </s-banner>
      ) : (
        <>
          {success && <s-banner tone="success">Product option changed successfully!</s-banner>}
          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              disabled={selectedVariantId === line.merchandise.id || submitting}
              loading={submitting}
              onClick={handleUpdate}
            >
              Save Option Changes
            </s-button>
          </s-stack>
        </>
      )}
    </s-stack>
  );
}
