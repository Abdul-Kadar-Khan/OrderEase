import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useRef } from "preact/hooks";
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
import { getServiceSettings } from './utils/api.js';
import { OrderEditContext, useOrderEdit } from './context/OrderEditContext.jsx';
import { useEffect } from "preact/hooks";
import useOrderSearch from './hooks/useorderSearch.js';

export default async () => {
  render(<Extension />, document.body);
};

function ModalSection({ title, subtitle, iconType, tone = "neutral", children }) {
  const modalId = "modal-" + title.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const { needsRefresh, startRefreshCountdown } = useOrderEdit();

  const handleClose = () => {
    if (needsRefresh) {
      startRefreshCountdown();
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
        id={modalId}
        heading={title}
        size="large"
        padding="base"
        onHide={handleClose}
      >
        <s-box paddingBlockStart="small-200" inlineSize="100%">
          <s-stack direction="block" gap="large" inlineSize="100%">
            {children}
          </s-stack>
        </s-box>
        <s-button
          slot="secondary-actions"
          commandFor={modalId}
          command="--hide"
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

function getSectionElement(sectionId) {
  if (typeof document === 'undefined' || !document || !sectionId) return null;

  if (typeof document.querySelector === 'function') {
    try {
      const el = document.querySelector('#' + sectionId);
      if (el) return el;
    } catch (e) {}
  }

  if (typeof document.getElementById === 'function') {
    try {
      const el = document.getElementById(sectionId);
      if (el) return el;
    } catch (e) {}
  }

  return null;
}

function QuickNavigation() {
  const handleNavigate = (e, sectionId) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    try {
      const url = typeof window !== 'undefined' && window?.location?.href;
      const region_country = url ? url.split("/")?.[1] : '';

      const orderID = shopify?.order?.value?.id;
      const numberOrderId = orderID ? orderID.split("/")[4] : '';
    
      const orderStatusPath = `shopify:customer-account/orders/${numberOrderId}${region_country}`;

      if (shopify && shopify.navigation && typeof shopify.navigation.navigate === 'function') {
        shopify.navigation.navigate(`${orderStatusPath}#${sectionId}`);
      }
    } catch (err) {}

    // Scroll to target section element safely
    const element = getSectionElement(sectionId);
    if (element && typeof element.scrollIntoView === 'function') {
      try {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {}
    }
  };

  return (
    <s-box
      background="subdued"
      padding="large"
      borderRadius="large"
      borderWidth="base"
      inlineSize="100%"
    >
      <s-stack direction="block" gap="base" inlineSize="100%">
        <s-stack direction="inline" alignItems="center" gap="small-200">
          <s-icon type="order" size="base" tone="neutral" />
          <s-text type="strong">Quick Navigation</s-text>
        </s-stack>

        <s-stack direction="inline" gap="small-300" inlineSize="100%">
          <s-clickable
            onClick={(e) => handleNavigate(e, "items-customization")}
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
            onClick={(e) => handleNavigate(e, "delivery-contact-details")}
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
            onClick={(e) => handleNavigate(e, "promotions-billing")}
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
            onClick={(e) => handleNavigate(e, "order-cancellation")}
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

function Extension() {
  const { order } = useOrderSearch();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [targetStatusUrl, setTargetStatusUrl] = useState(null);
  const [topPageCountdown, setTopPageCountdown] = useState(null);
  // serviceSettings: map of serviceId → enabled (true/false)
  // Defaults to null while loading — features are shown by default.
  const [serviceSettings, setServiceSettings] = useState(null);
  const [isExpired, setIsExpired] = useState(null);
  const [timeLimit, setTimeLimit] = useState(null);
  const [editLimit, setEditLimit] = useState(null);
  const [remainingTime, setRemainingTime] = useState("--:--:--");

  useEffect((()=>{
    console.log("isExpired: ", isExpired);
  }),[isExpired])

  // Helper: returns true only when the service is explicitly enabled.
  // While loading (null), isEnabled is never called because we show the spinner.
  const isEnabled = (serviceId) => serviceSettings !== null && serviceSettings[serviceId] === true;

  // Category-level visibility — only show a category if at least one of its services is enabled
  const showItemsCategory     = isEnabled('add-product') || isEnabled('edit-quantity') || isEnabled('swap-variant');
  const showDeliveryCategory  = isEnabled('change-address') || isEnabled('contact-info') || isEnabled('change-shipping-method') || isEnabled('order-note');
  const showPromotionsCategory = isEnabled('apply-discount') || isEnabled('download-invoice');
  const showCancellationCategory = isEnabled('cancel-order');

  // Fetch merchant service settings once on mount
  useEffect(() => {
    const currentOrderId = order?.id || shopify?.order?.value?.id;
    getServiceSettings(currentOrderId)
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
  }, [order?.id]);

  useEffect(() => {
    const createdAtStr = order?.createdAt || shopify?.order?.value?.createdAt;
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
  }, [order?.createdAt, timeLimit]);

  useEffect(() => {
    const handleHashScroll = () => {
      const hash = typeof window !== 'undefined' && window.location?.hash?.replace('#', '');
      if (hash) {
        const element = getSectionElement(hash);
        if (element && typeof element.scrollIntoView === 'function') {
          setTimeout(() => {
            try {
              element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) {}
          }, 100);
        }
      }
    };

    handleHashScroll();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', handleHashScroll);
      return () => window.removeEventListener('hashchange', handleHashScroll);
    }
  }, []);

  const notifyUpdateSuccess = (url) => {
    setNeedsRefresh(true);
    if (url) {
      setTargetStatusUrl(url);
    }
  };

  const performReload = (urlParam) => {
    const destinationUrl = urlParam || targetStatusUrl || (typeof window !== 'undefined' && window.location ? window.location.href : null);

    // Strategy 1: shopify.navigation.navigate
    if (typeof shopify !== 'undefined' && shopify.navigation && typeof shopify.navigation.navigate === 'function' && destinationUrl) {
      try {
        shopify.navigation.navigate(destinationUrl);
        return;
      } catch (e) {
        console.warn('shopify.navigation.navigate failed:', e);
      }
    }

    // Strategy 2: window.location navigation
    if (typeof window !== 'undefined' && window.location && destinationUrl) {
      try {
        window.location.href = destinationUrl;
        return;
      } catch (e) {
        console.warn('window.location.href failed:', e);
      }
      try {
        if (typeof window.location.replace === 'function') {
          window.location.replace(destinationUrl);
          return;
        }
      } catch (e) {
        console.warn('window.location.replace failed:', e);
      }
      try {
        if (typeof window.location.reload === 'function') {
          window.location.reload();
          return;
        }
      } catch (e) {
        console.warn('window.location.reload failed:', e);
      }
    }

    // Strategy 3: Parent / Top window location
    if (typeof window !== 'undefined' && destinationUrl) {
      try {
        if (window.top && window.top.location) {
          window.top.location.href = destinationUrl;
          return;
        }
      } catch (e) {
        console.warn('window.top.location.href failed:', e);
      }
      try {
        if (window.parent && window.parent.location) {
          window.parent.location.href = destinationUrl;
          return;
        }
      } catch (e) {
        console.warn('window.parent.location.href failed:', e);
      }
    }
  };

  const startRefreshCountdown = () => {
    setNeedsRefresh(false);
    if (topPageCountdown !== null) return;
    setTopPageCountdown(3);

    let current = 3;
    
    const interval = setInterval(() => {
      current -= 1;
      setTopPageCountdown(current);
      if (current <= 0) {
        clearInterval(interval);
        performReload(targetStatusUrl);
      }
    }, 1000);
  };
  

  const isLimitReached = Boolean(editLimit?.isLimitReached);
  const canEdit = !isExpired && !isLimitReached;

  // Show a loader until service settings have been fetched and expiry calculations are completed
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
    <OrderEditContext.Provider value={{ notifyUpdateSuccess, needsRefresh, startRefreshCountdown, topPageCountdown }}>

      {topPageCountdown !== null ? (
        <s-box inlineSize="100%" padding="large">
          <s-stack direction="block" alignItems="center" gap="large" inlineSize="100%">
            <s-spinner size="large" accessibilityLabel="Refreshing order details..." />
            <s-stack direction="block" alignItems="center" gap="small-200">
              <s-text type="strong" size="medium">Order updated successfully!</s-text>
              <s-text color="subdued">
                Please wait while we refresh the page to show the latest details.
              </s-text>
              <s-text type="strong">
                {topPageCountdown > 0
                  ? `Refreshing page in ${topPageCountdown} second${topPageCountdown !== 1 ? 's' : ''}...`
                  : 'Refreshing now...'}
              </s-text>
            </s-stack>
          </s-stack>
        </s-box>
      ) : (
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
            return <UpsellSlider />;
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
                <DownloadInvoice />
              </s-stack>
            </ModalSection>
          </s-section>
        )}

        {canEdit && (
        <s-section heading="Manage orders">
          {/* ── Welcome & Status Banner ── */}

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
              {(() => {
                if (isEnabled('add-product')) {
                  return (
                    <ModalSection
                      title="Add items to your order"
                      subtitle="Browse our store catalog or view recommendations to combine with your package"
                      iconType="order"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <OrderLineItems />
                        <s-divider />
                        <AddProduct />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('edit-quantity')) {
                  return (
                    <ModalSection
                      title="Adjust item quantities"
                      subtitle="Increase or decrease item counts; price differences and credits are calculated instantly"
                      iconType="edit"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <EditableQtyOrderLineItems />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('swap-variant')) {
                  return (
                    <ModalSection
                      title="Exchange or replace items"
                      subtitle="Swap a currently ordered item for a different product or model in our catalog"
                      iconType="edit"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ReplaceOrderLineItems />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('swap-variant')) {
                  return (
                    <ModalSection
                      title="Change options (size, color, or style)"
                      subtitle="Select a different variant or option for items already included in your order"
                      iconType="edit"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeProductOptions />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}
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
              {(() => {
                if (isEnabled('change-address')) {
                  return (
                    <ModalSection
                      title="Update shipping address"
                      subtitle="Correct delivery street address, apartment number, city, or postal code"
                      iconType="location"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeAddress />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('contact-info')) {
                  return (
                    <ModalSection
                      title="Update contact information"
                      subtitle="Change your email address or mobile phone number for shipping status updates and tracking"
                      iconType="profile"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeContactInfo />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('change-shipping-method')) {
                  return (
                    <ModalSection
                      title="Change shipping method"
                      subtitle="Select standard, express, overnight, or local pickup options for your order package"
                      iconType="delivery"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ChangeShippingMethod />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('order-note')) {
                  return (
                    <ModalSection
                      title="Add / edit order note"
                      subtitle="Add special instructions, delivery preferences, or comments to your order"
                      iconType="note"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <AddOrderNote />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}
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
              {(() => {
                if (isEnabled('apply-discount')) {
                  return (
                    <ModalSection
                      title="Apply a discount code"
                      subtitle="Add a promo code or voucher to eligible products in your placed order"
                      iconType="discount"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <ApplyDiscountCode />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}

              {(() => {
                if (isEnabled('download-invoice')) {
                  return (
                    <ModalSection
                      title="Download official invoice"
                      subtitle="Generate an itemized tax receipt and commercial PDF invoice for your records"
                      iconType="order"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <DownloadInvoice />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}
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
              {(() => {
                if (isEnabled('cancel-order')) {
                  return (
                    <ModalSection
                      title="Request order cancellation"
                      subtitle="Immediately cancel shipment processing and request an automated full refund"
                      iconType="x"
                      tone="critical"
                    >
                      <s-stack direction="block" gap="large" inlineSize="100%">
                        <CancelOrder />
                      </s-stack>
                    </ModalSection>
                  );
                }
              })()}
            </s-stack>
          </s-stack>
          )}
          </s-stack>
        </s-section>
        )}

      </s-stack>
      )}
    </OrderEditContext.Provider>
  );
}