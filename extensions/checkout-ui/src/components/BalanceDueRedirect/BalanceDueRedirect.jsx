import { formatMoney } from '../../utils/formatMoney';

/**
 * Shows a warning banner when a balance is due after order editing,
 * providing a link to complete payment on the status/checkout page.
 */
export function BalanceDueRedirect({ balanceDue, statusPageUrl }) {
  return (
    <s-banner tone="warning">
      {`Balance due of ${formatMoney(balanceDue)}. We've emailed you an invoice. `}
      {statusPageUrl && <s-link href={statusPageUrl} target="_top">Click here to complete payment</s-link>}
    </s-banner>
  );
}


