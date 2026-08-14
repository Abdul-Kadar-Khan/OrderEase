import { useState, useEffect } from 'preact/hooks';
import { formatMoney } from '../../utils/formatMoney.js';
import { getShippingMethod, updateShippingMethod } from '../../utils/api.js';
import { getExtensionOrderId, formatOrderId, safeNavigate } from '../../utils/shopifyHelpers.js';
import { BalanceDueRedirect } from '../BalanceDueRedirect/BalanceDueRedirect.jsx';

export function ChangeShippingMethod({ orderId: propOrderId }) {
  const orderId = formatOrderId(propOrderId) || getExtensionOrderId();

  const [loading, setLoading] = useState(true);
  const [currentShipping, setCurrentShipping] = useState(null);
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    async function loadShipping() {
      if (!orderId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await getShippingMethod({ orderId });
        if (data) {
          if (data.currentShipping) {
            setCurrentShipping(data.currentShipping);
          }
          if (data.currencyCode) {
            setCurrencyCode(data.currencyCode);
          }
          if (data.availableMethods) {
            let methods = [...data.availableMethods];
            if (data.currentShipping) {
              const currentTitle = data.currentShipping.title?.toLowerCase();
              const hasCurrent = methods.some((opt) => opt.title.toLowerCase() === currentTitle);
              if (!hasCurrent) {
                methods.unshift({
                  id: 'current-order-shipping',
                  title: data.currentShipping.title,
                  price: parseFloat(data.currentShipping.amount || 0),
                });
              }
            }
            setShippingOptions(methods);
            const currentTitle = data.currentShipping?.title?.toLowerCase();
            const matched = methods.find(
              (opt) => opt.title.toLowerCase() === currentTitle
            );
            if (matched) {
              setSelectedOptionId(matched.id);
            } else if (methods.length > 0) {
              setSelectedOptionId(methods[0].id);
            }
          }
        }
      } catch (err) {
        console.warn('Could not load shipping method details:', err);
        setShippingOptions([]);
        setSelectedOptionId(null);
      } finally {
        setLoading(false);
      }
    }
    loadShipping();
  }, [orderId]);

  const selectedOption = shippingOptions.find((opt) => opt.id === selectedOptionId) || null;

  const normalizeTitle = (str) => (str || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  const isSameAsCurrent = Boolean(
    currentShipping &&
    selectedOption &&
    (
      normalizeTitle(currentShipping.title) === normalizeTitle(selectedOption.title) ||
      normalizeTitle(currentShipping.title).includes(normalizeTitle(selectedOption.title)) ||
      normalizeTitle(selectedOption.title).includes(normalizeTitle(currentShipping.title))
    )
  );

  const handleSave = async () => {
    if (!orderId || !selectedOption || isSameAsCurrent) return;

    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await updateShippingMethod({
        orderId,
        title: selectedOption.title,
        price: selectedOption.price,
        currencyCode,
      });

      setLastResult(result);

      if (result.balanceDue?.amount > 0) {
        // BalanceDueRedirect handles user redirect
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update shipping method.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <s-stack direction="block" gap="base">
      <s-box background="transparent" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-100">
            <s-text type="strong">Change Shipping Method</s-text>
            <s-text color="subdued">
              Select a shipping method configured for your order delivery.
            </s-text>
          </s-stack>

          {loading ? (
            <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center" padding="base">
              <s-spinner size="small" />
              <s-text color="subdued">Loading shipping method details...</s-text>
            </s-stack>
          ) : (
            <>
              {currentShipping ? (
                <s-box background="subdued" padding="small-200" borderRadius="base">
                  <s-stack direction="inline" alignItems="center" justifyContent="space-between">
                    <s-stack direction="block" gap="none">
                      <s-text color="subdued">Current Selected Shipping:</s-text>
                      <s-text type="strong">{currentShipping.title}</s-text>
                    </s-stack>
                    <s-text type="strong">
                      {parseFloat(currentShipping.amount) === 0
                        ? 'FREE'
                        : formatMoney({ amount: currentShipping.amount, currencyCode })}
                    </s-text>
                  </s-stack>
                </s-box>
              ) : null}

              {success && (
                <s-banner tone="success">
                  Shipping method updated successfully!
                </s-banner>
              )}

              {error && <s-banner tone="critical">{error}</s-banner>}

              {shippingOptions.length === 0 ? (
                <s-banner tone="info">
                  No additional shipping options could be retrieved for this order.
                </s-banner>
              ) : (
                <>
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">Available Delivery Methods:</s-text>

                    <s-scroll-box maxBlockSize="200px" accessibilityLabel="Available shipping methods list">
                      <s-stack direction="block" gap="small-200">
                        {shippingOptions.map((option) => {
                          const isSelected = option.id === selectedOptionId;
                          const isCurrentMethod = currentShipping && (
                            normalizeTitle(currentShipping.title) === normalizeTitle(option.title) ||
                            normalizeTitle(currentShipping.title).includes(normalizeTitle(option.title)) ||
                            normalizeTitle(option.title).includes(normalizeTitle(currentShipping.title))
                          );
                          const formattedPrice =
                            option.price === 0
                              ? 'FREE'
                              : formatMoney({ amount: option.price, currencyCode });

                          return (
                            <s-box
                              key={option.id}
                              padding="small-200"
                              background={isSelected ? 'subdued' : 'transparent'}
                              borderWidth="base"
                              borderRadius="base"
                            >
                              <s-clickable
                                disabled={submitting}
                                onClick={() => setSelectedOptionId(option.id)}
                              >
                                <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
                                  <s-stack direction="inline" alignItems="center" gap="small-200">
                                    <s-icon
                                      type={isSelected ? 'check-circle-filled' : 'circle'}
                                      size="base"
                                      tone={isSelected ? 'success' : 'neutral'}
                                    />
                                    <s-text type="strong">
                                      {option.title}
                                      {isCurrentMethod ? ' (Already Applied)' : ''}
                                    </s-text>
                                  </s-stack>
                                  <s-text type="strong" color="subdued">
                                    {formattedPrice}
                                  </s-text>
                                </s-stack>
                              </s-clickable>
                            </s-box>
                          );
                        })}
                      </s-stack>
                    </s-scroll-box>
                  </s-stack>

                  {lastResult?.balanceDue?.amount > 0 ? (
                    <BalanceDueRedirect
                      balanceDue={lastResult.balanceDue}
                      statusPageUrl={lastResult?.order?.statusPageUrl}
                    />
                  ) : (
                    <s-stack direction="inline" justifyContent="end">
                      <s-button
                        variant="primary"
                        disabled={submitting || isSameAsCurrent || !selectedOption}
                        loading={submitting}
                        onClick={handleSave}
                      >
                        Update Shipping Method
                      </s-button>
                    </s-stack>
                  )}
                </>
              )}
            </>
          )}
        </s-stack>
      </s-box>
    </s-stack>
  );
}
