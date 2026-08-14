// TODO: replace with your app's deployed URL (must match SHOPIFY_APP_URL / application_url).
const APP_URL = 'https://orderease-production.up.railway.app';

/** 
 * Adds a product variant to the current order.
 *
 * This calls the app's backend, which runs the Order Editing API workflow
 * (orderEditBegin -> orderEditAddVariant -> orderEditCommit) using the
 * store's Admin API session. The extension itself never talks to the
 * Admin API directly.
 * 
 * The backend commits with notifyCustomer: true, so if the added item
 * raises the order total, Shopify automatically emails the customer an
 * invoice with a secure "pay now" link for the new balance due — the same
 * mechanism used for draft orders. No custom payment flow is needed here.
 *
 * @param {Object} params
 * @param {string} params.orderId - GID of the order being edited.
 * @param {string} params.variantId - GID of the product variant to add.
 * @param {number} params.quantity - Quantity to add.
 * @returns {Promise<{order: Object, balanceDue: Object|null}>}
 */
export async function addProductToOrder({ orderId, variantId, quantity }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order-edit/add-product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, variantId, quantity, source: 'customer_account_ui' }),
  });

  const result = await response.json();
 
  if (!response.ok || result.userErrors?.length) {
    const message =
      result.userErrors?.[0]?.message || 'Could not add product to order.';
    throw new Error(message);
  }

  return result;
}

export async function updateLineItemQuantity({ orderId, lineItemId, quantity }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order-edit/update-quantity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, lineItemId, quantity, source: 'customer_account_ui' }),
  });

  const result = await response.json();
 
  if (!response.ok || result.userErrors?.length) {
    const message =
      result.userErrors?.[0]?.message || 'Could not update product quantity.';
    throw new Error(message);
  }

  return result;
}

export async function cancelOrder({ orderId, reason = "CUSTOMER" }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, reason, source: 'customer_account_ui' }),
  });

  const result = await response.json();
 
  if (!response.ok || result.userErrors?.length) {
    const message =
      result.userErrors?.[0]?.message || 'Could not process cancellation request.';
    throw new Error(message);
  }

  return result;
}

export async function changeLineItemVariant({ orderId, oldLineItemId, newVariantId, quantity }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order-edit/change-variant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, oldLineItemId, newVariantId, quantity, source: 'customer_account_ui' }),
  });

  const result = await response.json();
 
  if (!response.ok || result.userErrors?.length) {
    const message =
      result.userErrors?.[0]?.message || 'Could not change product variant.';
    throw new Error(message);
  }

  return result;
}

export async function getOrderDetails({ orderId }) {
  const token = await shopify.sessionToken.get();
  
  const response = await fetch(`${APP_URL}/api/order-edit/get-order?orderId=${encodeURIComponent(orderId)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error || `Failed to fetch order details: ${response.statusText}`);
  }

  return response.json();
}

export async function getInvoiceLink({ orderId }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ orderId })
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    throw new Error(result.error || `Failed to get invoice link: ${response.statusText}`);
  }

  return result;
}

export async function updateContactInfo({ orderId, email, phone }){
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/contact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, email, phone, source: 'customer_account_ui' }),
  });

  const result = await response.json();

  if (!response.ok || result.userErrors?.length) {
    const message = result.userErrors?.[0]?.message || 'Could not update contact information.';
    throw new Error(message);
  }

  return result;
}

/**
 * Update the shipping (or billing) address on an order.
 * @param {Object} params
 * @param {string} params.orderId
 * @param {'shipping'|'billing'} params.addressType
 * @param {Object} params.address - MailingAddressInput fields
 */
export async function updateOrderAddress({ orderId, addressType, address }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/address`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, addressType, address, source: 'customer_account_ui' }),
  });

  const result = await response.json();

  if (!response.ok || result.userErrors?.length) {
    const message = result.userErrors?.[0]?.message || 'Could not update address.';
    throw new Error(message);
  }

  return result;
}

/**
 * Apply a product-level discount code to an order.
 *
 * This calls the app's backend, which validates the code via the Admin API,
 * figures out on its own which product(s) on the order the code is
 * eligible for (no product selection is sent from the client), then runs
 * the Order Editing API workflow (orderEditBegin ->
 * orderEditAddLineItemDiscount for the eligible line item(s) ->
 * orderEditCommit) using the store's Admin API session. The extension
 * itself never talks to the Admin API directly.
 *
 * Order-level discount codes (codes that discount the whole order/cart)
 * are rejected by the backend with a clear error — only product-level
 * discount codes are supported here.
 *
 * The backend commits with notifyCustomer: true, so the customer is emailed
 * an updated invoice reflecting the new total.
 *
 * @param {Object} params
 * @param {string} params.orderId - GID of the order being edited.
 * @param {string} params.discountCode - The discount code to validate and apply.
 * @returns {Promise<{applied: boolean, appliedCount?: number, replacedCount?: number, discountLabel?: string, warnings: string[], order?: Object}>}
 */
export async function applyDiscountCode({ orderId, discountCode }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/discount8`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, discountCode, source: 'customer_account_ui' }),
  });

  const result = await response.json();

  if (!response.ok || result.userErrors?.length) {
    const message = result.userErrors?.[0]?.message || 'Could not apply discount code.';
    throw new Error(message);
  }

  return result;
}

/**
 * Fetch the current shipping address for an order (used to pre-fill the form).
 */
export async function getShippingAddress({ orderId }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(
    `${APP_URL}/api/order/address?orderId=${encodeURIComponent(orderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) return null;

  const result = await response.json();
  return result.shippingAddress ?? null;
}

/**
 * Fetch recommendation tags for upsell products based on current active order line items.
 */
export async function getUpsellTags({ orderId }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(
    `${APP_URL}/api/order/upsell-tags?orderId=${encodeURIComponent(orderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to load recommendation tags.');
  }

  return response.json();
}

/**
 * Fetch current shipping method details for an order.
 */
export async function getShippingMethod({ orderId }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(
    `${APP_URL}/api/order/shipping?orderId=${encodeURIComponent(orderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) return null;

  return response.json();
}

/**
 * Update shipping method on an order.
 * @param {Object} params
 * @param {string} params.orderId
 * @param {string} params.title - Shipping rate title (e.g. "Express Shipping (1-2 Days)")
 * @param {number} params.price - Shipping price amount
 * @param {string} [params.currencyCode] - Currency code
 */
export async function updateShippingMethod({ orderId, title, price, currencyCode = 'USD' }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/shipping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, title, price, currencyCode, source: 'customer_account_ui' }),
  });

  const result = await response.json();

  if (!response.ok || result.userErrors?.length) {
    const message = result.userErrors?.[0]?.message || 'Could not update shipping method.';
    throw new Error(message);
  }

  return result;
}

/**
 * Fetch current order note.
 */
export async function getOrderNote({ orderId }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(
    `${APP_URL}/api/order/note?orderId=${encodeURIComponent(orderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) return null;

  return response.json();
}

/**
 * Update order note.
 * @param {Object} params
 * @param {string} params.orderId
 * @param {string} params.note - The updated order note content
 */
export async function updateOrderNote({ orderId, note }) {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/order/note`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId, note, source: 'customer_account_ui' }),
  });

  const result = await response.json();

  if (!response.ok || result.userErrors?.length) {
    const message = result.userErrors?.[0]?.message || 'Could not update order note.';
    throw new Error(message);
  }

  return result;
}

/**
 * Fetch the merchant's service settings (which features are enabled/disabled).
 * Used by the Customer Account UI to conditionally render features.
 *
 * @returns {Promise<{ settings: Record<string, boolean> }>}
 */
export async function getServiceSettings() {
  const token = await shopify.sessionToken.get();

  const response = await fetch(`${APP_URL}/api/service-settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    // If the call fails, default to showing all features
    return { settings: {} };
  }

  return response.json();
}