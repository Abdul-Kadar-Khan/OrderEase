import { useState } from 'preact/hooks';
import { getInvoiceLink } from '../../utils/api.js';
import { getExtensionOrderId, formatOrderId, safeNavigate } from '../../utils/shopifyHelpers.js';

export function DownloadInvoice({ orderId: propOrderId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [invoiceUrl, setInvoiceUrl] = useState(null);
  const orderId = formatOrderId(propOrderId) || getExtensionOrderId();

  const handleDownload = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getInvoiceLink({ orderId });
      const url = res.url || res.invoiceUrl;

      if (!url) {
        throw new Error('No invoice link was returned.');
      }
      
      setInvoiceUrl(url);
      safeNavigate(url);
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

            {invoiceUrl ? (
              <s-button
                variant="primary"
                href={invoiceUrl}
                target="_blank"
              >
                Open Invoice PDF
              </s-button>
            ) : (
              <s-button
                variant="secondary"
                loading={loading}
                disabled={loading}
                onClick={handleDownload}
              >
                {loading ? 'Generating PDF...' : 'Download PDF'}
              </s-button>
            )}
          </s-stack>

          <s-text size="small" color="subdued">
            Generate a formatted, itemized commercial tax invoice and accounting receipt for your records.
          </s-text>

          {invoiceUrl && (
            <s-banner tone="success">
              Invoice PDF generated!{' '}
              <s-link href={invoiceUrl} target="_blank">Click here to view or download PDF</s-link>.
            </s-banner>
          )}
        </s-stack>
      </s-box>

      {error && <s-banner tone="critical">{error}</s-banner>}
    </s-stack>
  );
}


