import { formatMoney } from '../../utils/formatMoney';

/**
 * Shows a banner indicating a balance is due on the order.
 */
export function BalanceDueRedirect({ balanceDue, statusPageUrl }) {
  return (
    <s-banner tone="warning">
      {`Balance due of ${formatMoney(balanceDue)}. We've emailed you an invoice.`}
    </s-banner>
  );
}

