// TODO: replace with your app's deployed URL (must match SHOPIFY_APP_URL / application_url).
const APP_URL = 'https://spy-index-son-pond.trycloudflare.com';

/**
 * Normalizes any order ID string to standard Shopify Admin GID format:
 * e.g., "gid://shopify/OrderIdentity/7844859511071" -> "gid://shopify/Order/7844859511071"
 */
export function formatOrderId(id) {
  if (!id) return '';
  const str = String(id).trim();
  if (str.includes('OrderIdentity')) {
    return str.replace(/gid:\/\/shopify\/OrderIdentity\//g, 'gid://shopify/Order/');
  }
  if (str.startsWith('gid://shopify/Order/')) {
    return str;
  }
  if (/^\d+$/.test(str)) {
    return `gid://shopify/Order/${str}`;
  }
  const numericMatch = str.match(/\d+/);
  if (numericMatch && !str.startsWith('gid://shopify/')) {
    return `gid://shopify/Order/${numericMatch[0]}`;
  }
  return str;
}

/** 
 * Adds a product variant to the current order.
 */
export async function addProductToOrder({ orderId, variantId, quantity }) {
  const token = await shopify.sessionToken.get();
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order-edit/add-product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, variantId, quantity, source: 'checkout_ui' }),
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order-edit/update-quantity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, lineItemId, quantity, source: 'checkout_ui' }),
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, reason, source: 'checkout_ui' }),
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order-edit/change-variant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, oldLineItemId, newVariantId, quantity, source: 'checkout_ui' }),
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
  const formattedOrderId = formatOrderId(orderId);
  
  const response = await fetch(`${APP_URL}/api/order-edit/get-order?orderId=${encodeURIComponent(formattedOrderId)}`, {
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
  const formattedOrderId = formatOrderId(orderId);
  
  const response = await fetch(`${APP_URL}/api/order/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ orderId: formattedOrderId })
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    throw new Error(result.error || `Failed to get invoice link: ${response.statusText}`);
  }

  return result;
}

export async function updateContactInfo({ orderId, email, phone }){
  const token = await shopify.sessionToken.get();
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order/contact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, email, phone, source: 'checkout_ui' }),
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
 */
export async function updateOrderAddress({ orderId, addressType, address }) {
  const token = await shopify.sessionToken.get();
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order/address`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, addressType, address, source: 'checkout_ui' }),
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
 */
export async function applyDiscountCode({ orderId, discountCode }) {
  const token = await shopify.sessionToken.get();
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order/discount8`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, discountCode, source: 'checkout_ui' }),
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(
    `${APP_URL}/api/order/address?orderId=${encodeURIComponent(formattedOrderId)}`,
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(
    `${APP_URL}/api/order/upsell-tags?orderId=${encodeURIComponent(formattedOrderId)}`,
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(
    `${APP_URL}/api/order/shipping?orderId=${encodeURIComponent(formattedOrderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) return null;

  return response.json();
}

/**
 * Update shipping method on an order.
 */
export async function updateShippingMethod({ orderId, title, price, currencyCode = 'USD' }) {
  const token = await shopify.sessionToken.get();
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order/shipping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, title, price, currencyCode, source: 'checkout_ui' }),
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
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(
    `${APP_URL}/api/order/note?orderId=${encodeURIComponent(formattedOrderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) return null;

  return response.json();
}

/**
 * Update order note.
 */
export async function updateOrderNote({ orderId, note }) {
  const token = await shopify.sessionToken.get();
  const formattedOrderId = formatOrderId(orderId);

  const response = await fetch(`${APP_URL}/api/order/note`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: formattedOrderId, note, source: 'checkout_ui' }),
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
 * Used by the Checkout UI / Customer Account UI to conditionally render features.
 *
 * @returns {Promise<{ settings: Record<string, boolean>, timeLimit: Object|null }>}
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

/**
 * Checks the available quantity for a product variant using the Storefront API.
 * @param {string} variantId - GID of the product variant
 * @returns {Promise<{ availableForSale: boolean, quantityAvailable: number|null }|null>}
 */
export async function checkVariantQuantity(variantId) {
  if (!variantId) return null;
  const QUERY = `#graphql
    query GetVariantQuantity($id: ID!) {
      node(id: $id) {
        ... on ProductVariant {
          id
          title
          availableForSale
        }
      }
    }
  `;
  try {
    if (typeof shopify === 'undefined' || !shopify.query) return null;
    const { data, errors } = await shopify.query(QUERY, {
      variables: { id: variantId },
    });
    if (errors?.length || !data?.node) return null;
    return {
      availableForSale: Boolean(data.node.availableForSale),
      quantityAvailable: null,
    };
  } catch (err) {
    console.warn('Inventory check failed:', err);
    return null;
  }
}