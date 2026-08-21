import { useState } from 'preact/hooks';
import { ProductSearchBar } from './ProductSearchBar.jsx';
import { ProductResults } from './ProductResults.jsx';
import { VariantPicker } from './VariantPicker.jsx';
import { useProductSearch } from '../../hooks/useProductSearch.js';
import { BalanceDueRedirect } from '../BalanceDueRedirect/BalanceDueRedirect.jsx';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

/**
 * Search-and-add flow for adding a new product to the current order.
 * Three states: searching -> picking a variant -> confirmation.
 */
export function AddProduct() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [quantityMessage, setQuantityMessage] = useState(null);
  const { notifyUpdateSuccess } = useOrderEdit();

  const { results, loading, error } = useProductSearch(
    selectedProduct ? '' : searchTerm,
  );

  const order = shopify.order.value;

  function handleSelectProduct(product) {
    setLastResult(null);
    setQuantityMessage(null);
    setSelectedProduct(product);
  }

  function handleBackToSearch() {
    setSelectedProduct(null);
  }

  function handleAdded(result, qtyMsg) {
    setLastResult(result);
    setQuantityMessage(qtyMsg || null);
    setSelectedProduct(null);
    setSearchTerm('');
    notifyUpdateSuccess(result?.order?.statusPageUrl);
  }

  const balanceDue = lastResult?.balanceDue;

  return (
    <s-stack direction="block" gap="base">
      {lastResult && (
        <s-stack direction="block" gap="small-200">
          {quantityMessage ? (
            <s-banner tone="warning">{quantityMessage}</s-banner>
          ) : null}
          {balanceDue?.amount > 0 ? (
            <BalanceDueRedirect
              balanceDue={balanceDue}
              statusPageUrl={lastResult?.order?.statusPageUrl}
            />
          ) : (
            <s-banner tone="success">Product successfully added to your existing package!</s-banner>
          )}
        </s-stack>
      )}

      {selectedProduct ? (
        <VariantPicker
          product={selectedProduct}
          orderId={order?.id}
          onBack={handleBackToSearch}
          onAdded={handleAdded}
        />
      ) : (
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-100">
            <s-text type="strong" size="medium">{lastResult ? 'Add another product' : 'Add extra items to your package'}</s-text>
            <s-text color="subdued" size="small">
              Search our catalog to add additional products directly to this shipment. Any price adjustments are handled instantly without requiring a separate shipping order.
            </s-text>
          </s-stack>

          <ProductSearchBar value={searchTerm} onChange={setSearchTerm} />

          <ProductResults
            results={results}
            loading={loading}
            error={error}
            searchTerm={searchTerm}
            onSelect={handleSelectProduct}
          />
        </s-stack>
      )}
    </s-stack>
  );
}
