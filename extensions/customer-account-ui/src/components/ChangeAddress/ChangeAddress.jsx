import { useState, useEffect } from 'preact/hooks';
import { getShippingAddress, updateOrderAddress, getLocationSuggestions, getServiceSettings } from '../../utils/api.js';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

// Common country options — extended dynamically if another country is selected from Google suggestions
const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IN', name: 'India' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
];

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  address1: '',
  address2: '',
  city: '',
  province: '',
  zip: '',
  countryCode: 'US',
  phone: '',
};

export function ChangeAddress() {
  const order = shopify.order.value;

  const [form, setForm] = useState(EMPTY_FORM);
  const [countriesList, setCountriesList] = useState(COUNTRIES);
  const [loadingAddress, setLoadingAddress] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { notifyUpdateSuccess } = useOrderEdit();

  // Service Settings & Merchant Google Places API Key Check
  const [hasGoogleKey, setHasGoogleKey] = useState(false);

  // Location suggestions state (Google Places & Geocoding autocomplete dropdown)
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autoFillMsg, setAutoFillMsg] = useState(null);

  // ── Fetch Service Settings & check if Google API Key is configured ──────
  useEffect(() => {
    getServiceSettings(order?.id)
      .then((data) => {
        if (data?.hasGooglePlacesKey) {
          setHasGoogleKey(true);
        } else {
          setHasGoogleKey(false);
        }
      })
      .catch(() => setHasGoogleKey(false));
  }, [order?.id]);

  // ── Pre-fill from existing shipping address on mount ──────────────────
  useEffect(() => {
    if (!order?.id) {
      setLoadingAddress(false);
      return;
    }

    let cancelled = false;

    getShippingAddress({ orderId: order.id })
      .then((addr) => {
        if (cancelled || !addr) return;
        const code = (addr.countryCode || 'US').toUpperCase();

        setCountriesList((prev) => {
          if (code && !prev.some((c) => c.code === code)) {
            return [...prev, { code, name: code }];
          }
          return prev;
        });

        setForm({
          firstName:   addr.firstName   || '',
          lastName:    addr.lastName    || '',
          address1:    addr.address1    || '',
          address2:    addr.address2    || '',
          city:        addr.city        || '',
          province:    addr.province    || '',
          zip:         addr.zip         || '',
          countryCode: code,
          phone:       addr.phone       || '',
        });
      })
      .catch(() => {/* silent — form stays empty */})
      .finally(() => { if (!cancelled) setLoadingAddress(false); });

    return () => { cancelled = true; };
  }, [order?.id]);

  // ── Debounced Location Suggestions Fetcher ──────────────────────────────
  useEffect(() => {
    if (!hasGoogleKey) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    let cancelled = false;
    setLoadingSuggestions(true);

    const timer = setTimeout(() => {
      getLocationSuggestions(q)
        .then((items) => {
          if (!cancelled) {
            setSuggestions(items || []);
            setShowSuggestions((items || []).length > 0);
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingSuggestions(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, hasGoogleKey]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
    setSuccess(false);

    // Trigger location autocomplete dropdown if Google API key is configured
    if (hasGoogleKey) {
      if (field === 'city' && value.trim().length >= 2) {
        setSearchQuery(value);
        setShowSuggestions(true);
      } else if (field === 'address1' && value.trim().length >= 3) {
        setSearchQuery(value);
        setShowSuggestions(true);
      }
    }
  }

  function selectSuggestion(item) {
    if (!item) return;

    const cCode = (item.countryCode || form.countryCode || 'US').toUpperCase();

    // Ensure country code exists in dropdown list
    setCountriesList((prev) => {
      if (!prev.some((c) => c.code === cCode)) {
        return [...prev, { code: cCode, name: item.country || cCode }];
      }
      return prev;
    });

    const newAddress1 = item.address1 || item.mainText || form.address1;
    const newCity = item.city || item.mainText || form.city;
    const newProvince = item.province || form.province;
    const newZip = item.zip || form.zip;

    setForm((prev) => ({
      ...prev,
      address1: newAddress1,
      city: newCity,
      province: newProvince,
      zip: newZip,
      countryCode: cCode,
    }));

    setShowSuggestions(false);
    setSearchQuery('');
    setError(null);
    setSuccess(false);

    const filledDetails = [
      newAddress1,
      newCity,
      newProvince,
      item.country || cCode,
      newZip ? `ZIP: ${newZip}` : null
    ].filter(Boolean);

    setAutoFillMsg(`Auto-filled: ${filledDetails.join(', ')}`);
  }

  function validate() {
    if (!form.address1.trim()) return 'Address line 1 is required.';
    if (!form.city.trim())     return 'City is required.';
    if (!form.countryCode)     return 'Country is required.';
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }

    setSubmitting(true);
    setError(null);
    try {
      const result = await updateOrderAddress({ orderId: order.id, addressType: 'shipping', address: form });
      setSuccess(true);
      notifyUpdateSuccess(result?.order?.statusPageUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update shipping address.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingAddress) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center">
          <s-spinner size="small" />
          <s-text color="subdued">Loading current delivery destination…</s-text>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-100">
            <s-text type="strong">Shipping Destination Details</s-text>
            <s-text size="small" color="subdued">
              Ensure your exact street address, apartment/suite number, and delivery city are completely accurate prior to package dispatch.
            </s-text>
          </s-stack>

          {/* Location Autocomplete Input with Floating Dropdown (ONLY shown if merchant entered Google API Key) */}
          {hasGoogleKey && (
            <s-box background="subdued" padding="base" borderRadius="base">
              <s-stack direction="block" gap="small-100">
                <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                  <s-text type="strong" size="small">
                    📍 Google Location & City Autocomplete
                  </s-text>
                  {loadingSuggestions && <s-spinner size="small" />}
                </s-stack>

                <s-text-field
                  label="Search City, Place or Postal Code"
                  placeholder="Start typing e.g. Indore, 452007, Khargone..."
                  value={searchQuery}
                  disabled={submitting}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    if (target && 'value' in target) {
                      setSearchQuery(String(target.value));
                      setShowSuggestions(true);
                      setAutoFillMsg(null);
                    }
                  }}
                />

                {/* Floating Location Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <s-box background="surface" padding="none" borderRadius="base" borderWidth="base">
                    <s-stack direction="block" gap="none">
                      <s-box padding="small-200" background="subdued">
                        <s-text size="small" type="strong" color="subdued">
                          SELECT MATCHING LOCATION ({suggestions.length})
                        </s-text>
                      </s-box>

                      {suggestions.map((item, index) => (
                        <s-clickable
                          key={item.id || index}
                          onClick={(e) => {
                            if (e && typeof e.preventDefault === 'function') e.preventDefault();
                            selectSuggestion(item);
                          }}
                        >
                          <s-box
                            padding="base"
                            borderWidth={index > 0 ? "small" : "none"}
                            background="surface"
                          >
                            <s-stack direction="block" gap="extra-small">
                              <s-stack direction="inline" gap="small-100" alignItems="center">
                                <s-text type="strong">📍 {item.mainText}</s-text>
                                {item.zip && <s-badge tone="info">{item.zip}</s-badge>}
                              </s-stack>
                              <s-text size="small" color="subdued">
                                {item.secondaryText || item.description}
                              </s-text>
                            </s-stack>
                          </s-box>
                        </s-clickable>
                      ))}
                    </s-stack>
                  </s-box>
                )}

                {autoFillMsg && (
                  <s-banner tone="success">{autoFillMsg}</s-banner>
                )}
              </s-stack>
            </s-box>
          )}

          {success && (
            <s-banner tone="success">Shipping address updated successfully!</s-banner>
          )}
          {error && (
            <s-banner tone="critical">{error}</s-banner>
          )}

          {/* Name row */}
          <s-stack direction="inline" gap="base">
            <s-box inlineSize="100%">
              <s-text-field
                label="First name"
                value={form.firstName}
                disabled={submitting}
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('firstName', String(target.value));
                }}
              />
            </s-box>
            <s-box inlineSize="100%">
              <s-text-field
                label="Last name"
                value={form.lastName}
                disabled={submitting}
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('lastName', String(target.value));
                }}
              />
            </s-box>
          </s-stack>

          {/* Address line 1 */}
          <s-text-field
            label="Address line 1 *"
            value={form.address1}
            disabled={submitting}
            placeholder="Street address, building, P.O. Box"
            onInput={(e) => {
              const target = e.currentTarget;
              if (target && 'value' in target) handleChange('address1', String(target.value));
            }}
          />

          {/* Address line 2 & Phone */}
          <s-stack direction="inline" gap="base">
            <s-box inlineSize="100%">
              <s-text-field
                label="Address line 2"
                value={form.address2}
                disabled={submitting}
                placeholder="Apartment, suite, floor, etc."
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('address2', String(target.value));
                }}
              />
            </s-box>
            <s-box inlineSize="100%">
              <s-text-field
                label="Delivery Phone (optional)"
                type="tel"
                value={form.phone}
                disabled={submitting}
                placeholder="For delivery driver contact"
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('phone', String(target.value));
                }}
              />
            </s-box>
          </s-stack>

          {/* City + ZIP row */}
          <s-stack direction="inline" gap="base">
            <s-box inlineSize="100%">
              <s-text-field
                label="City *"
                value={form.city}
                disabled={submitting}
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('city', String(target.value));
                }}
              />
            </s-box>
            <s-box inlineSize="100%">
              <s-text-field
                label="Postal / ZIP code"
                value={form.zip}
                disabled={submitting}
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('zip', String(target.value));
                }}
              />
            </s-box>
          </s-stack>

          {/* State / Province & Country row */}
          <s-stack direction="inline" gap="base">
            <s-box inlineSize="100%">
              <s-select
                label="Country *"
                name="countryCode"
                value={form.countryCode}
                disabled={submitting}
                onChange={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('countryCode', String(target.value));
                }}
              >
                {countriesList.map((c) => (
                  <s-option key={c.code} value={c.code}>{c.name}</s-option>
                ))}
              </s-select>
            </s-box>
            <s-box inlineSize="100%">
              <s-text-field
                label="State / Province / Region"
                value={form.province}
                disabled={submitting}
                onInput={(e) => {
                  const target = e.currentTarget;
                  if (target && 'value' in target) handleChange('province', String(target.value));
                }}
              />
            </s-box>
          </s-stack>

          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              disabled={submitting || !form.address1.trim() || !form.city.trim()}
              loading={submitting}
              onClick={handleSave}
            >
              Save Shipping Address
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>
    </s-stack>
  );
}
