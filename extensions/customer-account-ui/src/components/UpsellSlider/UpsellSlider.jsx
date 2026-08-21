import { useState, useRef, useEffect } from 'preact/hooks';
import { useUpsellProducts } from '../../hooks/useUpsellProducts.js';
import { formatMoney } from '../../utils/formatMoney.js';
import { VariantPicker } from '../AddProduct/VariantPicker.jsx';
import { BalanceDueRedirect } from '../BalanceDueRedirect/BalanceDueRedirect.jsx';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

/**
 * Standalone Upsell Recommendations carousel block designed to be displayed outside the Manage Order section.
 * Presents product pairing suggestions one slide at a time and opens a popup modal for effortless customization and inclusion.
 */
export function UpsellSlider() {
  const order = shopify.order.value;
  const { products, loading, error } = useUpsellProducts(order?.id);
  const { notifyUpdateSuccess, needsRefresh, startRefreshCountdown } = useOrderEdit();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const modalRef = useRef(null);
  const modalId = "modal-upsell-recommendation-carousel";

  // Automatically cycle through recommended items every 4 seconds
  useEffect(() => {
    if (!products || products.length <= 1 || modalOpen) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % products.length);
    }, 4000);

    return () => clearInterval(timer);
  }, [products, modalOpen, currentIndex]);

  const handleNext = () => {
    if (products && products.length > 0) {
      setCurrentIndex((prev) => (prev + 1) % products.length);
    }
  };

  const handlePrev = () => {
    if (products && products.length > 0) {
      setCurrentIndex((prev) => (prev - 1 + products.length) % products.length);
    }
  };

  const handleSelectProduct = (product) => {
    setLastResult(null);
    setSelectedProduct(product);
    setModalOpen(true);
    if (modalRef.current && typeof modalRef.current.showOverlay === "function") {
      modalRef.current.showOverlay();
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedProduct(null);
    if (needsRefresh) {
      startRefreshCountdown();
    }
  };

  const [quantityMessage, setQuantityMessage] = useState(null);

  const handleAdded = (result, qtyMsg) => {
    setLastResult(result);
    setQuantityMessage(qtyMsg || null);
    setSelectedProduct(null);
    notifyUpdateSuccess(result?.order?.statusPageUrl);
  };

  if (loading) {
    return (
      <s-section heading="Frequently paired with your order">
        <s-box padding="large" background="subdued" borderRadius="large" borderWidth="base" inlineSize="100%">
          <s-stack direction="inline" alignItems="center" gap="base">
            <s-spinner size="base" />
            <s-text size="medium" color="subdued">Finding personalized product recommendations for your package...</s-text>
          </s-stack>
        </s-box>
      </s-section>
    );
  }

  if (error || !products || products.length === 0) {
    return null;
  }

  const balanceDue = lastResult?.balanceDue;
  // Ensure index remains in bounds if products list mutates
  const activeIndex = Math.min(currentIndex, products.length - 1);
  const currentProduct = products[activeIndex];
  const startingPrice = currentProduct?.variants?.nodes?.[0]?.price;

  return (
    <s-section heading="Frequently paired with your order">
      <s-stack direction="block" gap="large" inlineSize="100%">
        <s-text color="subdued" size="base">
          Curated add-ons tailored to items in your current package. Add items directly to your shipment before it leaves the warehouse.
        </s-text>

        {lastResult && (
          <s-box padding="base" inlineSize="100%">
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
                <s-banner tone="success">Recommended item successfully added to your package!</s-banner>
              )}
            </s-stack>
          </s-box>
        )}

        {/* ── Carousel Navigation Toolbar ── */}
        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="space-between"
          gap="base"
          inlineSize="100%"
        >
          <s-stack direction="inline" alignItems="center" gap="small-200">
            <s-box padding="small-100" background="subdued" borderRadius="base">
              <s-icon type="star" size="small" tone="neutral" />
            </s-box>
            <s-text type="strong" size="medium">Featured Add-on Recommendations</s-text>
          </s-stack>

          {products.length > 1 && (
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-text size="small" color="subdued">
                {activeIndex + 1} of {products.length}
              </s-text>

              <s-clickable
                padding="small-200"
                background="surface"
                borderRadius="full"
                borderWidth="base"
                accessibilityLabel="Previous recommendation"
                onClick={handlePrev}
              >
                <s-icon type="chevron-left" size="small" tone="neutral" />
              </s-clickable>

              <s-clickable
                padding="small-200"
                background="surface"
                borderRadius="full"
                borderWidth="base"
                accessibilityLabel="Next recommendation"
                onClick={handleNext}
              >
                <s-icon type="chevron-right" size="small" tone="neutral" />
              </s-clickable>
            </s-stack>
          )}
        </s-stack>

        {/* ── Carousel Slide Card ── */}
        {currentProduct && (
          <s-box
            key={currentProduct.id}
            background="subdued"
            padding="large"
            borderRadius="large"
            borderWidth="base"
            inlineSize="100%"
          >
            <s-clickable
              padding="none"
              background="transparent"
              inlineSize="100%"
              commandFor={modalId}
              command="--show"
              onClick={() => handleSelectProduct(currentProduct)}
            >
              <s-stack
                direction="inline"
                alignItems="center"
                justifyContent="space-between"
                gap="large"
                inlineSize="100%"
              >
                <s-stack direction="inline" alignItems="center" gap="large">
                  <s-box inlineSize="80px" background="surface" borderRadius="base" borderWidth="base" padding="small-200">
                    {currentProduct.featuredImage ? (
                      <s-image
                        src={currentProduct.featuredImage.url}
                        alt={currentProduct.featuredImage.altText || currentProduct.title}
                        aspectRatio="1"
                        borderRadius="base"
                      />
                    ) : (
                      <s-icon type="image" size="large" tone="neutral" />
                    )}
                  </s-box>

                  <s-stack direction="block" gap="small-100">
                    <s-stack direction="inline" alignItems="center" gap="small-200">
                      <s-text type="strong" size="large">{currentProduct.title}</s-text>
                      <s-box background="surface" padding="small-100" borderRadius="small" borderWidth="base">
                        <s-text size="small" color="subdued">Recommended</s-text>
                      </s-box>
                    </s-stack>
                    {startingPrice ? (
                      <s-text size="medium" type="strong">{formatMoney(startingPrice)}</s-text>
                    ) : null}
                    <s-text size="base" color="subdued">Tap to select variant option and quantity</s-text>
                  </s-stack>
                </s-stack>

                <s-box background="surface" padding="base" paddingInline="large" borderRadius="full" borderWidth="base">
                  <s-stack direction="inline" alignItems="center" gap="small-200">
                    <s-text type="strong" size="medium">Select</s-text>
                    <s-icon type="chevron-right" size="base" tone="neutral" />
                  </s-stack>
                </s-box>
              </s-stack>
            </s-clickable>
          </s-box>
        )}

        {/* ── Carousel Indicator Pills ── */}
        {products.length > 1 && (
          <s-stack
            direction="inline"
            alignItems="center"
            justifyContent="center"
            gap="small-200"
            paddingBlockStart="small-200"
            inlineSize="100%"
          >
            {products.map((_, index) => (
              <s-clickable
                key={index}
                padding="none"
                background="transparent"
                accessibilityLabel={`Go to recommendation slide ${index + 1}`}
                onClick={() => setCurrentIndex(index)}
              >
                <s-box
                  inlineSize={index === activeIndex ? "32px" : "10px"}
                  blockSize="8px"
                  background={index === activeIndex ? "base" : "subdued"}
                  borderRadius="full"
                  borderWidth="base"
                />
              </s-clickable>
            ))}
          </s-stack>
        )}

        {/* ── Add to Order Popup Modal ── */}
        <s-modal
          ref={modalRef}
          id={modalId}
          heading={selectedProduct ? selectedProduct.title : "Add product to order"}
          size="large"
          padding="base"
          onHide={handleCloseModal}
        >
          {selectedProduct && (
            <s-box paddingBlockStart="small-200" inlineSize="100%">
              <VariantPicker
                product={selectedProduct}
                orderId={order?.id}
                onBack={handleCloseModal}
                onAdded={(res) => {
                  handleAdded(res);
                  handleCloseModal();
                }}
              />
            </s-box>
          )}
          <s-button
            slot="secondary-actions"
            commandFor={modalId}
            command="--hide"
          >
            Close
          </s-button>
        </s-modal>
      </s-stack>
    </s-section>
  );
}
