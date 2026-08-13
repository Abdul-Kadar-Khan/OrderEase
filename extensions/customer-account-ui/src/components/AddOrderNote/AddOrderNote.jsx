import { useState, useEffect } from 'preact/hooks';
import { getOrderNote, updateOrderNote } from '../../utils/api.js';
import { useOrderEdit } from '../../context/OrderEditContext.jsx';

export function AddOrderNote() {
  const order = shopify.order.value;
  const orderId = order?.id;

  const [loading, setLoading] = useState(true);
  const [initialNote, setInitialNote] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { notifyUpdateSuccess } = useOrderEdit();

  useEffect(() => {
    async function loadNote() {
      if (!orderId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await getOrderNote({ orderId });
        if (data?.note !== undefined) {
          setInitialNote(data.note || '');
          setNote(data.note || '');
        }
      } catch (err) {
        console.warn('Could not load order note:', err);
      } finally {
        setLoading(false);
      }
    }
    loadNote();
  }, [orderId]);

  const hasChanged = note.trim() !== initialNote.trim();

  const handleSave = async () => {
    if (!orderId || !hasChanged) return;

    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await updateOrderNote({
        orderId,
        note: note.trim(),
      });

      setInitialNote(result.note || note.trim());
      setSuccess(true);
      notifyUpdateSuccess(result?.order?.statusPageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update order note.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <s-stack direction="block" gap="base">
      <s-box background="transparent" padding="base" borderRadius="base" borderWidth="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-100">
            <s-text type="strong">Add / Edit Order Note</s-text>
            <s-text color="subdued">
              Add delivery instructions, special requests, or comments for your order.
            </s-text>
          </s-stack>

          {loading ? (
            <s-stack direction="inline" alignItems="center" gap="small-200" justifyContent="center" padding="base">
              <s-spinner size="small" />
              <s-text color="subdued">Loading order note...</s-text>
            </s-stack>
          ) : (
            <>
              {success && (
                <s-banner tone="success">
                  Order note updated successfully!
                </s-banner>
              )}

              {error && <s-banner tone="critical">{error}</s-banner>}

              <s-text-field
                label="Order Note / Instructions"
                value={note}
                disabled={submitting}
                onInput={(e) => setNote(e.target.value)}
                placeholder="Type any instructions for delivery or order preparation..."
              />

              <s-stack direction="inline" justifyContent="end">
                <s-button
                  variant="primary"
                  disabled={submitting || !hasChanged}
                  loading={submitting}
                  onClick={handleSave}
                >
                  Save Order Note
                </s-button>
              </s-stack>
            </>
          )}
        </s-stack>
      </s-box>
    </s-stack>
  );
}
