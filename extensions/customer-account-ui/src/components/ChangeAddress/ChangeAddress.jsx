import { useState, useEffect } from 'preact/hooks';
import { getShippingAddress, updateOrderAddress } from '../../utils/api.js';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

// Country options — common subset; extend as needed
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
  const [loadingAddress, setLoadingAddress] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { notifyUpdateSuccess } = useOrderEdit();

  // ── Pre-fill from the existing shipping address on mount ──────────────────
  useEffect(() => {
    if (!order?.id) {
      setLoadingAddress(false);
      return;
    }

    let cancelled = false;

    getShippingAddress({ orderId: order.id })
      .then((addr) => {
        if (cancelled || !addr) return;
        setForm({
          firstName:   addr.firstName   || '',
          lastName:    addr.lastName    || '',
          address1:    addr.address1    || '',
          address2:    addr.address2    || '',
          city:        addr.city        || '',
          province:    addr.province    || '',
          zip:         addr.zip         || '',
          countryCode: addr.countryCode || 'US',
          phone:       addr.phone       || '',
        });
      })
      .catch(() => {/* silent — form stays empty */})
      .finally(() => { if (!cancelled) setLoadingAddress(false); });

    return () => { cancelled = true; };
  }, [order?.id]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
    setSuccess(false);
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
                {COUNTRIES.map((c) => (
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

