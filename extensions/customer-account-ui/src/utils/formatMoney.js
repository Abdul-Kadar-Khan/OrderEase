/**
 * Format a Money object ({ amount, currencyCode }) as a locale currency
 * string, e.g. { amount: "29.99", currencyCode: "USD" } -> "$29.99".
 */
export function formatMoney(money) {
  if (!money) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: money.currencyCode,
  }).format(money.amount);
}
