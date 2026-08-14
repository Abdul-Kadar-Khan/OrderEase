import { useState, useEffect } from 'preact/hooks';
import { formatMoney } from '../../utils/formatMoney';
import { changeLineItemVariant } from '../../utils/api';
import { ProductSearchBar } from '../AddProduct/ProductSearchBar.jsx';
import { useProductSearch } from '../../hooks/useProductSearch.js';
import { BalanceDueRedirect } from '../BalanceDueRedirect/BalanceDueRedirect.jsx';
import { getExtensionLines, getExtensionOrderId, formatOrderId, safeNavigate } from '../../utils/shopifyHelpers.js';
import useOrderSearch from '../../hooks/useorderSearch.js';

function truncate(text, maxLength = 38) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

function variantLabel(variant) {
  const options = (variant.selectedOptions || [])
    .filter((o) => o.value !== 'Default Title')
    .map((o) => `${o.name}: ${o.value}`)
    .join(' • ');
  return options || variant.title;
}

/** Countdown banner that navigates away after a successful replace. */
function SuccessReload({ message }) {
  return (
    <s-banner tone="success">
      {message}
    </s-banner>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 – Current order line items (pick which one to replace)
// ─────────────────────────────────────────────────────────────────────────────

function LineItemSelector({ lines, onSelect }) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="block" gap="small-100">
        <s-text type="strong">Select an item to exchange</s-text>
        <s-text size="small" color="subdued">
          Choose any product in your current shipment to replace with an alternative product or different model from our catalog.
        </s-text>
      </s-stack>

      <s-scroll-box maxBlockSize="200px" accessibilityLabel="Select item to exchange list">
        <s-stack direction="block" gap="small-200">
          {lines.map((line) => {
            const merchandise = line.merchandise || {
              title: line.title || line.name || '',
              image: line.image || null,
              selectedOptions: line.selectedOptions || [],
            };
            const quantity = line.quantity || line.currentQuantity || 1;
            const cost = line.cost || { totalAmount: line.price };
            const title = merchandise.title;
            const options = (merchandise.selectedOptions || [])
              .filter((o) => o.value !== 'Default Title')
              .map((o) => `${o.name}: ${o.value}`)
              .join(' • ');
            const price = cost?.totalAmount ? formatMoney(cost.totalAmount) : '';

            return (
              <s-box key={line.id} background="subdued" padding="small-200" borderRadius="base" borderWidth="base">
                <s-clickable onClick={() => onSelect(line)}>
                  <s-stack direction="inline" alignItems="center" gap="small" justifyContent="space-between" padding="small-200">
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
                        <s-stack direction="inline" gap="small-200">
                          <s-text color="subdued">Qty: {quantity}</s-text>
                          {price ? <s-text color="subdued">• {price}</s-text> : null}
                        </s-stack>
                      </s-stack>
                    </s-stack>

                    <s-box background="subdued" padding="small-100" borderRadius="base">
                      <s-stack direction="inline" alignItems="center" gap="small-100">
                        <s-text type="strong">Select to swap</s-text>
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 – Search for a replacement product and pick a variant
// ─────────────────────────────────────────────────────────────────────────────

function ReplacementPicker({ selectedLine, orderId, onBack, onReplaced }) {
  const selectedMerchandise = selectedLine?.merchandise || {
    title: selectedLine?.title || selectedLine?.name || '',
  };
  const selectedQuantity = selectedLine?.quantity || selectedLine?.currentQuantity || 1;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const { results, loading: searching, error: searchError } = useProductSearch(
    selectedProduct ? '' : searchTerm,
  );

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    const firstAvailable = product.variants?.nodes?.find((v) => v.availableForSale);
    setSelectedVariantId(firstAvailable?.id ?? product.variants?.nodes?.[0]?.id ?? null);
    setError(null);
  };

  const handleReplace = async () => {
    if (!selectedVariantId) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await changeLineItemVariant({
        orderId,
        oldLineItemId: selectedLine.id,
        newVariantId: selectedVariantId,
        quantity: selectedQuantity,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not replace product.');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const balanceDue = result.balanceDue;
    return (
      <s-stack direction="block" gap="base">
        {balanceDue?.amount > 0 ? (
          <BalanceDueRedirect
            balanceDue={balanceDue}
            statusPageUrl={result.order?.statusPageUrl}
          />
        ) : (
          <s-banner tone="success">
            Product exchanged successfully! Your order summary has been updated.
          </s-banner>
        )}
      </s-stack>
    );
  }

  const variants = selectedProduct?.variants?.nodes ?? [];
  const hasMultipleVariants = variants.length > 1;

  return (
    <s-stack direction="block" gap="base">
      <s-clickable onClick={selectedProduct ? () => { setSelectedProduct(null); setSelectedVariantId(null); } : onBack}>
        <s-stack direction="inline" alignItems="center" gap="small-200">
          <s-icon type="chevron-left" size="small" tone="neutral" />
          <s-text type="strong" size="small" color="interactive">
            {selectedProduct ? 'Back to product search' : 'Back to item selection'}
          </s-text>
        </s-stack>
      </s-clickable>

      {/* Currently replacing summary card */}
      <s-box background="subdued" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="inline" alignItems="center" gap="base">
          <s-box padding="small-200" background="surface" borderRadius="base">
            <s-icon type="edit" size="base" tone="neutral" />
          </s-box>
          <s-stack direction="block" gap="none">
            <s-text size="small" color="subdued">Swapping out from your shipment:</s-text>
            <s-text type="strong">{selectedMerchandise.title} (Qty: {selectedQuantity})</s-text>
          </s-stack>
        </s-stack>
      </s-box>

      {/* ── No product selected: search catalog ── */}
      {!selectedProduct && (
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="none">
            <s-text type="strong">Search replacement catalog</s-text>
            <s-text size="small" color="subdued">Enter a product name or keyword to select your replacement.</s-text>
          </s-stack>

          <ProductSearchBar value={searchTerm} onChange={setSearchTerm} />

          {searchTerm.trim().length >= 2 && (
            searching ? (
              <s-box padding="small-200" background="subdued" borderRadius="base">
                <s-stack direction="inline" alignItems="center" gap="small-200">
                  <s-spinner size="small" />
                  <s-text size="small" color="subdued">Searching store catalog…</s-text>
                </s-stack>
              </s-box>
            ) : searchError ? (
              <s-banner tone="critical">{searchError}</s-banner>
            ) : results.length === 0 ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-text color="subdued">No products found matching "{searchTerm}".</s-text>
              </s-box>
            ) : (
              <s-scroll-box maxBlockSize="200px" accessibilityLabel="Replacement product search results">
                <s-stack direction="block" gap="small-200">
                  {results.map((product) => {
                    const startingPrice = product.variants?.nodes?.[0]?.price;
                    return (
                      <s-box key={product.id} background="subdued" padding="small-200" borderRadius="base" borderWidth="base">
                        <s-clickable onClick={() => handleSelectProduct(product)}>
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
                                  <s-text color="subdued">From {formatMoney(startingPrice)}</s-text>
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
            )
          )}
        </s-stack>
      )}

      {/* ── Product selected: pick variant ── */}
      {selectedProduct && (
        <s-stack direction="block" gap="base">
          <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
            <s-stack direction="inline" alignItems="center" gap="base">
              <s-box inlineSize="64px">
                {selectedProduct.featuredImage ? (
                  <s-image
                    src={selectedProduct.featuredImage.url}
                    alt={selectedProduct.featuredImage.altText || selectedProduct.title}
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
                <s-text size="small" color="subdued">New replacement product</s-text>
                <s-text type="strong" size="medium">{selectedProduct.title}</s-text>
              </s-stack>
            </s-stack>
          </s-box>

          <s-stack direction="block" gap="small-200">
            <s-text type="strong">Choose replacement variant option:</s-text>
            {hasMultipleVariants ? (
              <s-scroll-box maxBlockSize="180px" accessibilityLabel="Replacement variant list">
                <s-stack direction="block" gap="small-200">
                  {variants.map((variant) => (
                    <s-box
                      key={variant.id}
                      padding="small-200"
                      background={selectedVariantId === variant.id ? 'subdued' : 'transparent'}
                      borderWidth="base"
                      borderRadius="base"
                    >
                      <s-clickable
                        disabled={!variant.availableForSale || submitting}
                        onClick={() => setSelectedVariantId(variant.id)}
                      >
                        <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
                          <s-stack direction="inline" alignItems="center" gap="small-200">
                            <s-icon
                              type={selectedVariantId === variant.id ? 'check-circle-filled' : 'circle'}
                              size="base"
                              tone={selectedVariantId === variant.id ? 'success' : 'neutral'}
                            />
                            <s-stack direction="block" gap="none">
                              <s-text type="strong" color={variant.availableForSale ? undefined : 'subdued'}>
                                {variantLabel(variant)}
                              </s-text>
                              {!variant.availableForSale && (
                                <s-text color="subdued">Sold out</s-text>
                              )}
                            </s-stack>
                          </s-stack>
                          <s-text type="strong" color="subdued">{formatMoney(variant.price)}</s-text>
                        </s-stack>
                      </s-clickable>
                    </s-box>
                  ))}
                </s-stack>
              </s-scroll-box>
            ) : (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-text color="subdued">
                  {variants[0] ? `Confirmed option: ${variantLabel(variants[0])} (${formatMoney(variants[0].price)})` : 'No variants available.'}
                </s-text>
              </s-box>
            )}
          </s-stack>

          {error && <s-banner tone="critical">{error}</s-banner>}

          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              disabled={!selectedVariantId || submitting}
              loading={submitting}
              onClick={handleReplace}
            >
              Confirm & Replace Item
            </s-button>
          </s-stack>
        </s-stack>
      )}
    </s-stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────

export function ReplaceOrderLineItems({ orderId: propOrderId }) {
  const orderId = formatOrderId(propOrderId) || getExtensionOrderId();
  // Always use apiLines — sdkLines from the checkout SDK have CartLine IDs
  // (gid://shopify/CartLine/...) which are invalid for Admin API order editing.
  const { lineItems: lines, loading } = useOrderSearch(orderId);
  const [selectedLine, setSelectedLine] = useState(null);

  if (loading && lines.length === 0) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center">
          <s-spinner size="small" />
          <s-text color="subdued">Loading items for replacement...</s-text>
        </s-stack>
      </s-box>
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
    <s-stack direction="block" gap="base">
      {selectedLine ? (
        <ReplacementPicker
          selectedLine={selectedLine}
          orderId={orderId}
          onBack={() => setSelectedLine(null)}
          onReplaced={() => setSelectedLine(null)}
        />
      ) : (
        <LineItemSelector lines={lines} onSelect={setSelectedLine} />
      )}
    </s-stack>
  );
}

