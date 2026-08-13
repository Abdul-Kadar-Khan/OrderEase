import { useState } from 'preact/hooks';
import { getInvoiceLink } from '../../utils/api.js';

export function DownloadInvoice() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const order = shopify.order.value;

  const handleDownload = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getInvoiceLink({ orderId: order.id });
      const invoiceUrl = res.url || res.invoiceUrl;

      if (!invoiceUrl) {
        throw new Error('No invoice link was returned.');
      }
      
      // In Shopify UI Extensions, DOM creation and .click() are unsupported in the remote sandbox.
      // Open invoice in a new tab via window.open; if blocked by browser anti-popup rules, fall back to direct location navigation.
      const newTab = window.open(invoiceUrl, '_blank');
      if (!newTab || newTab.closed || typeof newTab.closed === 'undefined') {
        window.location.href = invoiceUrl;
      }
    } catch (err) {
      console.error('Failed to download invoice:', err);
      setError(err instanceof Error ? err.message : 'Could not generate official invoice PDF at this time.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <s-stack direction="block" gap="base">
      <s-box background="surface" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
            <s-stack direction="inline" alignItems="center" gap="small-300">
              <s-box padding="small-200" background="subdued" borderRadius="base">
                <s-icon type="order" size="base" tone="neutral" />
              </s-box>
              <s-text type="strong">Official Itemized Invoice PDF</s-text>
            </s-stack>

            <s-button
              variant="secondary"
              loading={loading}
              disabled={loading}
              onClick={handleDownload}
            >
              {loading ? 'Generating PDF...' : 'Download PDF'}
            </s-button>
          </s-stack>

          <s-text size="small" color="subdued">
            Generate a formatted, itemized commercial tax invoice and accounting receipt for your records.
          </s-text>
        </s-stack>
      </s-box>

      {error && <s-banner tone="critical">{error}</s-banner>}
    </s-stack>
  );
}

