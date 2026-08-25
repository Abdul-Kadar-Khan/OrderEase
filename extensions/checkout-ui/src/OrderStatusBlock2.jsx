import { useState, useRef, useEffect } from "preact/hooks";
import { OrderLineItems } from "./components/OrderLineItems/OrderLineItems.jsx";
import { EditableQtyOrderLineItems } from "./components/EditableQtyOrderLineItems/EditableQtyOrderLineItems.jsx";
import { ReplaceOrderLineItems } from "./components/ReplaceOrderLineItems/ReplaceOrderLineItems.jsx";
import { AddProduct } from "./components/AddProduct/AddProduct.jsx";
import { ChangeProductOptions } from "./components/ChangeProductOptions/ChangeProductOptions.jsx";
import { CancelOrder } from './components/CancelOrder/CancelOrder.jsx';
import { DownloadInvoice } from './components/DownloadInvoice/DownloadInvoice.jsx';
import { ChangeContactInfo } from './components/ChangeContactInfo/ChangeContactInfo.jsx';
import { ChangeAddress } from './components/ChangeAddress/ChangeAddress.jsx';
import { ChangeShippingMethod } from './components/ChangeShippingMethod/ChangeShippingMethod.jsx';
import { AddOrderNote } from './components/AddOrderNote/AddOrderNote.jsx';
import { ApplyDiscountCode } from './components/ApplyDiscountCode/ApplyDiscountCode.jsx';
import { UpsellSlider } from './components/UpsellSlider/UpsellSlider.jsx';
import { getExtensionOrderId } from './utils/shopifyHelpers.js';
import { getServiceSettings, getOrderDetails } from './utils/api.js';

function ModalSection({ title, subtitle, iconType, tone = "neutral", children }) {
  const [open, setOpen] = useState(false);
  const modalRef = useRef(null);
  const modalId = "modal-" + title.toLowerCase().replace(/[^a-z0-9]/g, "-");

  const handleOpen = () => {
    setOpen(true);
    if (modalRef.current && typeof modalRef.current.showOverlay === "function") {
      modalRef.current.showOverlay();
    }
  };

  const handleClose = () => {
    setOpen(false);
    if (modalRef.current && typeof modalRef.current.hideOverlay === "function") {
      modalRef.current.hideOverlay();
    }
  };

  return (
    <s-box background="subdued" borderWidth="base" borderRadius="large" inlineSize="100%">
      <s-clickable
        padding="large"
        background="transparent"
        inlineSize="100%"
        accessibilityLabel={title}
        commandFor={modalId}
        command="--show"
        onClick={handleOpen}
      >
        <s-stack direction="block" gap="small-300" inlineSize="100%">
          <s-stack
            direction="inline"
            alignItems="center"
            justifyContent="space-between"
            gap="large"
            inlineSize="100%"
          >
            <s-stack direction="inline" alignItems="center" gap="base">
              <s-box padding="base" background="surface" borderRadius="base" borderWidth="base">
                <s-icon type={iconType} size="large" tone={tone} />
              </s-box>
              <s-text type="strong" size="medium">{title}</s-text>
            </s-stack>

            <s-box padding="small-200" background="surface" borderRadius="full" borderWidth="base">
              <s-icon type="chevron-right" size="base" tone="neutral" />
            </s-box>
          </s-stack>

          {subtitle ? (
            <s-text size="base" color="subdued">{subtitle}</s-text>
          ) : null}
        </s-stack>
      </s-clickable>

      <s-modal
        ref={modalRef}
        id={modalId}
        heading={title}
        size="large"
        padding="base"
        onShow={() => setOpen(true)}
        onHide={() => setOpen(false)}
      >
        {open && (
          <s-box paddingBlockStart="small-200" inlineSize="100%">
            <s-stack direction="block" gap="large" inlineSize="100%">
              {children}
            </s-stack>
          </s-box>
        )}
        <s-button
          slot="secondary-actions"
          commandFor={modalId}
          command="--hide"
          onClick={handleClose}
        >
          Close
        </s-button>
      </s-modal>
    </s-box>
  );
}

function SectionHeader({ title, description }) {
  return (
    <s-stack direction="block" gap="small-200" paddingBlockStart="base" paddingBlockEnd="small-200" inlineSize="100%">
      <s-text type="strong" size="large">{title}</s-text>
      {description ? (
        <s-text size="base" color="subdued">{description}</s-text>
      ) : null}
    </s-stack>
  );
}

function QuickNavigation() {
  const handleNavigate = (sectionId) => {
    try {
      const element =
        document.getElementById(sectionId) ||
        document.querySelector(`#${sectionId}`) ||
        document.querySelector(`[id="${sectionId}"]`);
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.warn('Navigation error:', err);
    }
  };

  return (
    <s-box background="subdued" padding="large" borderRadius="large" borderWidth="base" inlineSize="100%">
      <s-stack direction="block" gap="base" inlineSize="100%">
        <s-stack direction="inline" alignItems="center" gap="small-200">
          <s-icon type="order" size="base" tone="neutral" />
          <s-text type="strong">Quick Navigation</s-text>
        </s-stack>

        <s-stack direction="inline" gap="small-300" inlineSize="100%">
          <s-clickable
            onClick={() => handleNavigate("items-customization")}
            padding="base"
            paddingInline="large"
            background="subdued"
            borderRadius="large"
            borderWidth="base"
            accessibilityLabel="Navigate to Items & Customization"
          >
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-icon type="order" size="small" tone="neutral" />
              <s-text type="strong">Items & Customization</s-text>
            </s-stack>
          </s-clickable>

          <s-clickable
            onClick={() => handleNavigate("delivery-contact-details")}
            padding="base"
            paddingInline="large"
            background="subdued"
            borderRadius="large"
            borderWidth="base"
            accessibilityLabel="Navigate to Delivery & Contact Details"
          >
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-icon type="location" size="small" tone="neutral" />
              <s-text type="strong">Delivery & Contact Details</s-text>
            </s-stack>
          </s-clickable>

          <s-clickable
            onClick={() => handleNavigate("promotions-billing")}
            padding="base"
            paddingInline="large"
            background="subdued"
            borderRadius="large"
            borderWidth="base"
            accessibilityLabel="Navigate to Promotions & Billing"
          >
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-icon type="discount" size="small" tone="neutral" />
              <s-text type="strong">Promotions & Billing</s-text>
            </s-stack>
          </s-clickable>

          <s-clickable
            onClick={() => handleNavigate("order-cancellation")}
            padding="base"
            paddingInline="large"
            background="subdued"
            borderRadius="large"
            borderWidth="base"
            accessibilityLabel="Navigate to Order Cancellation"
          >
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-icon type="x" size="small" tone="critical" />
              <s-text type="strong">Order Cancellation</s-text>
            </s-stack>
          </s-clickable>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function getLimitInMs(timeLimit) {
  if (!timeLimit) return 3600 * 1000;
  const { preset, customValue, customUnit } = timeLimit;
  if (preset === "15m") return 15 * 60 * 1000;
  if (preset === "30m") return 30 * 60 * 1000;
  if (preset === "1h") return 60 * 60 * 1000;
  if (preset === "2h") return 2 * 60 * 60 * 1000;
  if (preset === "1d") return 24 * 60 * 60 * 1000;
  if (preset === "2d") return 48 * 60 * 60 * 1000;
  if (preset === "custom" && customValue) {
    const val = Number(customValue) || 1;
    if (customUnit === "minutes") return val * 60 * 1000;
    if (customUnit === "hours") return val * 60 * 60 * 1000;
    if (customUnit === "days") return val * 24 * 60 * 60 * 1000;
  }
  return 60 * 60 * 1000;
}

function formatRemainingTime(remainingMs) {
  if (remainingMs <= 0) return "00:00:00";
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');

  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export default function OrderStatusBlock2() {
  const orderId = getExtensionOrderId();
  const [serviceSettings, setServiceSettings] = useState(null);
  const [timeLimit, setTimeLimit] = useState(null);
  const [editLimit, setEditLimit] = useState(null);
  const [isExpired, setIsExpired] = useState(null);
  const [remainingTime, setRemainingTime] = useState("--:--:--");
  const [createdAtStr, setCreatedAtStr] = useState(null);

  // Helper: returns true only when the service is explicitly enabled.
  const isEnabled = (serviceId) => serviceSettings !== null && serviceSettings[serviceId] === true;

  // Category-level visibility
  const showItemsCategory     = isEnabled('add-product') || isEnabled('edit-quantity') || isEnabled('swap-variant');
  const showDeliveryCategory  = isEnabled('change-address') || isEnabled('contact-info') || isEnabled('change-shipping-method') || isEnabled('order-note');
  const showPromotionsCategory = isEnabled('apply-discount') || isEnabled('download-invoice');
  const showCancellationCategory = isEnabled('cancel-order');

  // Fetch merchant service settings once on mount
  useEffect(() => {
    getServiceSettings(orderId)
      .then(({ settings, timeLimit: dbTimeLimit, editLimit: dbEditLimit }) => {
        setServiceSettings(settings || {});
        setTimeLimit(dbTimeLimit || null);
        setEditLimit(dbEditLimit || { isLimitReached: false, maxEdits: null, editCount: 0 });
      })
      .catch(() => { 
        setServiceSettings({});
        setTimeLimit(null);
        setEditLimit({ isLimitReached: false, maxEdits: null, editCount: 0 });
      });
  }, [orderId]);

  // Fetch order created timestamp
  useEffect(() => {
    if (!orderId) return;
    getOrderDetails({ orderId })
      .then((data) => {
        if (data?.createdAt) {
          setCreatedAtStr(data.createdAt);
        } else if (data?.order?.createdAt) {
          setCreatedAtStr(data.order.createdAt);
        }
      })
      .catch((err) => console.warn("Failed to fetch order created date:", err));
  }, [orderId]);

  // Timer & expiration calculation
  useEffect(() => {
    if (!createdAtStr) return;

    const createdAt = new Date(createdAtStr).getTime();
    const limitMs = getLimitInMs(timeLimit);
    const expiryTime = createdAt + limitMs;

    const updateTimer = () => {
      const now = Date.now();
      const diff = expiryTime - now;
      if (diff <= 0) {
        setIsExpired(true);
        setRemainingTime("Expired");
      } else {
        setIsExpired(false);
        setRemainingTime(formatRemainingTime(diff));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [createdAtStr, timeLimit]);

  const isLimitReached = Boolean(editLimit?.isLimitReached);
  const canEdit = !isExpired && !isLimitReached;

  // Render loader until calculations and settings are completed
  if (serviceSettings === null || isExpired === null || editLimit === null) {
    return (
      <s-box inlineSize="100%" padding="large">
        <s-stack direction="block" alignItems="center" gap="base" inlineSize="100%">
          <s-spinner size="large" accessibilityLabel="Loading order management options..." />
          <s-text color="subdued">Loading order management options...</s-text>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-stack direction="block" gap="large" inlineSize="100%">

      {isLimitReached ? (
        <s-banner tone="critical" title="Maximum Edits Reached">
          You have reached the maximum allowed edits ({editLimit.maxEdits} {editLimit.maxEdits === 1 ? 'edit' : 'edits'}) for this order. You can still download your order invoice.
        </s-banner>
      ) : isExpired ? (
        <s-banner tone="critical" title="Order Editing Window Expired">
          The time window configured by the merchant to edit this order has ended.
        </s-banner>
      ) : (
        <s-box background="subdued" padding="base" paddingInline="large" borderRadius="large" borderWidth="base">
          <s-stack direction="inline" alignItems="center" gap="small-300">
            <s-icon type="clock" size="base" tone="critical" />
            <s-text color="subdued">Time remaining to edit order: </s-text>
            <s-text type="strong">{remainingTime}</s-text>
          </s-stack>
        </s-box>
      )}

      {/* ── Standalone Upsell Feature Outside Manage Order ── */}
      {(() => {
        if (canEdit && isEnabled('product-upsell')) {
          return <UpsellSlider orderId={orderId} />;
        }
      })()}

      {!canEdit && isEnabled('download-invoice') && (
        <s-section heading="Order Invoice">
          <ModalSection
            title="Download official invoice"
            subtitle="Generate an itemized tax receipt and commercial PDF invoice for your records"
            iconType="order"
          >
            <s-stack direction="block" gap="large" inlineSize="100%">
              <DownloadInvoice orderId={orderId} />
            </s-stack>
          </ModalSection>
        </s-section>
      )}

      {canEdit && (
        <s-section heading="Manage order">
          {/* ── Quick Navigation Section ── */}
          <QuickNavigation />

          <s-stack direction="block" gap="large" paddingBlock="base" inlineSize="100%">
            {/* ── Category 1: Items & Customization ── */}
            {showItemsCategory && (
              <s-stack id="items-customization" direction="block" gap="base" inlineSize="100%">
                <SectionHeader
                  title="Items & Customization"
                  description="Modify existing products, add new additions, adjust quantities, or change options."
                />
                <s-stack direction="block" gap="base" inlineSize="100%">
                  {isEnabled('add-product') && (
                    <ModalSection
                      title="Add items to your order"
                      subtitle="Browse our store catalog or view recommendations to combine with your package"
                      iconType="order"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <OrderLineItems orderId={orderId} />
                        <s-divider />
                        <AddProduct orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('edit-quantity') && (
                    <ModalSection
                      title="Adjust item quantities"
                      subtitle="Increase or decrease item counts; price differences and credits are calculated instantly"
                      iconType="edit"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <EditableQtyOrderLineItems orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('swap-variant') && (
                    <ModalSection
                      title="Exchange or replace items"
                      subtitle="Swap a currently ordered item for a different product or model in our catalog"
                      iconType="edit"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ReplaceOrderLineItems orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('swap-variant') && (
                    <ModalSection
                      title="Change options (size, color, or style)"
                      subtitle="Select a different variant or option for items already included in your order"
                      iconType="edit"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeProductOptions orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}
                </s-stack>
              </s-stack>
            )}

            {showItemsCategory && showDeliveryCategory && <s-divider />}

            {/* ── Category 2: Delivery & Contact Details ── */}
            {showDeliveryCategory && (
              <s-stack id="delivery-contact-details" direction="block" gap="base" inlineSize="100%">
                <SectionHeader
                  title="Delivery & Contact Details"
                  description="Ensure your delivery destination and notification details are completely accurate."
                />
                <s-stack direction="block" gap="base" inlineSize="100%">
                  {isEnabled('change-address') && (
                    <ModalSection
                      title="Update shipping address"
                      subtitle="Correct delivery street address, apartment number, city, or postal code"
                      iconType="location"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeAddress orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('contact-info') && (
                    <ModalSection
                      title="Update contact information"
                      subtitle="Change your email address or mobile phone number for shipping status updates and tracking"
                      iconType="profile"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeContactInfo orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('change-shipping-method') && (
                    <ModalSection
                      title="Change shipping method"
                      subtitle="Select standard, express, overnight, or local pickup options for your order package"
                      iconType="delivery"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeShippingMethod orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('order-note') && (
                    <ModalSection
                      title="Add / edit order note"
                      subtitle="Add special instructions, delivery preferences, or comments to your order"
                      iconType="note"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <AddOrderNote orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}
                </s-stack>
              </s-stack>
            )}

            {showDeliveryCategory && showPromotionsCategory && <s-divider />}

            {/* ── Category 3: Promotions & Billing ── */}
            {showPromotionsCategory && (
              <s-stack id="promotions-billing" direction="block" gap="base" inlineSize="100%">
                <SectionHeader
                  title="Promotions & Billing"
                  description="Apply discount coupons and access formal accounting records."
                />
                <s-stack direction="block" gap="base" inlineSize="100%">
                  {isEnabled('apply-discount') && (
                    <ModalSection
                      title="Apply a discount code"
                      subtitle="Add a promo code or voucher to eligible products in your placed order"
                      iconType="discount"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ApplyDiscountCode orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}

                  {isEnabled('download-invoice') && (
                    <ModalSection
                      title="Download official invoice"
                      subtitle="Generate an itemized tax receipt and commercial PDF invoice for your records"
                      iconType="order"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <DownloadInvoice orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}
                </s-stack>
              </s-stack>
            )}

            {showPromotionsCategory && showCancellationCategory && <s-divider />}

            {/* ── Category 4: Order Cancellation ── */}
            {showCancellationCategory && (
              <s-stack id="order-cancellation" direction="block" gap="base" inlineSize="100%">
                <SectionHeader
                  title="Order Cancellation"
                  description="Destructive actions regarding your placed order."
                />
                <s-stack direction="block" gap="base" inlineSize="100%">
                  {isEnabled('cancel-order') && (
                    <ModalSection
                      title="Request order cancellation"
                      subtitle="Immediately cancel shipment processing and request an automated full refund"
                      iconType="x"
                      tone="critical"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <CancelOrder orderId={orderId} />
                      </s-stack>
                    </ModalSection>
                  )}
                </s-stack>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}
    </s-stack>
  );
}