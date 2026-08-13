import { useState } from 'preact/hooks';
import { updateContactInfo } from '../../utils/api.js';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

// Basic email regex validation
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Basic phone validation — allow +, digits, spaces, dashes, parentheses
function isValidPhone(phone) {
  return /^[+\d\s\-()]{7,20}$/.test(phone.trim());
}

/**
 * Component to allow customers to edit email or mobile phone number associated with their order.
 */
export function ChangeContactInfo() {
  const order = shopify.order.value;

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { notifyUpdateSuccess } = useOrderEdit();

  const emailDirty = email.trim() !== '';
  const phoneDirty = phone.trim() !== '';

  function validate() {
    if (!emailDirty && !phoneDirty) {
      return 'Please fill in at least an email address or phone number to update.';
    }
    if (emailDirty && !isValidEmail(email.trim())) {
      return 'Please enter a valid email address format (e.g., name@example.com).';
    }
    if (phoneDirty && !isValidPhone(phone)) {
      return 'Please enter a valid telephone number format (7–20 digits).';
    }
    return null;
  }

  const handleSave = async () => {
    setError(null);
    setSuccess(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const result = await updateContactInfo({
        orderId: order.id,
        email: emailDirty ? email.trim() : undefined,
        phone: phoneDirty ? phone.trim() : undefined,
      });

      setSuccess(true);
      setEmail('');
      setPhone('');
      notifyUpdateSuccess(result?.order?.statusPageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update notification preferences.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <s-stack direction="block" gap="base">
      <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-100">
            <s-text type="strong">Customer Notification & Contact Preferences</s-text>
            <s-text size="small" color="subdued">
              We will send important shipping tracking alerts, out-for-delivery driver notices, and receipt updates directly to the new contact methods specified below. Leave any field blank to preserve existing details.
            </s-text>
          </s-stack>

          {success && (
            <s-banner tone="success">
              Notification and contact preferences updated successfully!
            </s-banner>
          )}

          {error && (
            <s-banner tone="critical">{error}</s-banner>
          )}

          <s-stack direction="block" gap="small-300">
            <s-text-field
              label="New Email Address for shipping receipts"
              value={email}
              disabled={submitting}
              placeholder="e.g., name@example.com"
              onInput={(e) => {
                const target = e.currentTarget;
                if (target && 'value' in target) {
                  setEmail(String(target.value));
                  setSuccess(false);
                  setError(null);
                }
              }}
            />

            <s-text-field
              label="New Mobile Phone Number for SMS dispatch alerts"
              value={phone}
              disabled={submitting}
              placeholder="e.g., +1 (555) 234-5678"
              onInput={(e) => {
                const target = e.currentTarget;
                if (target && 'value' in target) {
                  setPhone(String(target.value));
                  setSuccess(false); 
                  setError(null);
                }
              }}
            />
          </s-stack>

          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              disabled={submitting || (!emailDirty && !phoneDirty)}
              loading={submitting}
              onClick={handleSave}
            >
              Save Notification Preferences
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>
    </s-stack>
  );
}

