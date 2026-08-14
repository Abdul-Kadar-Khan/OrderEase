/**
 * Helper utilities to safely access Shopify global variables and signals across
 * different UI Extension targets (Customer Account vs Checkout Thank You).
 */

function extractIdFromValue(obj) {
  if (!obj) return null;
  if (typeof obj === 'string' && obj.trim().length > 0) {
    return obj.trim();
  }
  if (typeof obj === 'number') {
    return String(obj);
  }
  if (typeof obj === 'object') {
    // 1. Check signal .value or .current
    if (obj.value) {
      const res = extractIdFromValue(obj.value);
      if (res) return res;
    }
    if (obj.current) {
      const res = extractIdFromValue(obj.current);
      if (res) return res;
    }
    // 2. Check nested .order property
    if (obj.order) {
      const res = extractIdFromValue(obj.order);
      if (res) return res;
    }
    // 3. Check direct .id property
    if (obj.id) {
      const res = extractIdFromValue(obj.id);
      if (res) return res;
    }
  }
  return null;
}

/**
 * Normalizes any order ID string to standard Shopify Admin GID format:
 * e.g., "gid://shopify/OrderIdentity/7844859511071" -> "gid://shopify/Order/7844859511071"
 * e.g., "7844859511071" -> "gid://shopify/Order/7844859511071"
 */
export function formatOrderId(id) {
  if (!id) return null;
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
 * Safely retrieve the current Order object from the global `shopify` namespace.
 */
export function getShopifyOrder() {
  if (typeof shopify === 'undefined') return null;

  if (shopify.order?.value) return shopify.order.value;
  if (shopify.orderConfirmation?.value?.order) return shopify.orderConfirmation.value.order;
  if (shopify.orderConfirmation?.value) return shopify.orderConfirmation.value;
  if (shopify.orderConfirmation?.order) return shopify.orderConfirmation.order;
  if (shopify.order) return shopify.order;
  if (shopify.checkout?.value?.order) return shopify.checkout.value.order;

  return null;
}

/**
 * Safely retrieve the Order ID string for API calls across all extension targets.
 */
export function getExtensionOrderId() {
  let rawId = null;

  if (typeof shopify !== 'undefined') {
    // Try orderConfirmation (primary object on Thank You page target)
    rawId = extractIdFromValue(shopify.orderConfirmation);
    if (!rawId) {
      // Try order (primary object on Customer Account order status block target)
      rawId = extractIdFromValue(shopify.order);
    }
    if (!rawId) {
      // Try checkout object if available
      rawId = extractIdFromValue(shopify.checkout);
    }
    if (!rawId) {
      // Direct shopify.orderId property check
      rawId = extractIdFromValue(shopify.orderId);
    }
  }

  // Fallback: check window URL query params or path if in browser/iframe
  if (!rawId && typeof window !== 'undefined' && window.location) {
    try {
      const href = window.location.href;
      const url = new URL(href);
      const searchParams = url.searchParams;
      const paramId = searchParams.get('order_id') || searchParams.get('orderId') || searchParams.get('id');
      if (paramId) {
        rawId = paramId;
      } else {
        const match = url.pathname.match(/orders\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          rawId = match[1];
        }
      }
    } catch (e) {
      // ignore URL parsing errors
    }
  }

  return formatOrderId(rawId);
}

/**
 * Safely retrieve line items signal from the global `shopify` namespace.
 */
export function getExtensionLines() {
  if (typeof shopify === 'undefined') return [];
  if (shopify.lines?.value && Array.isArray(shopify.lines.value)) {
    return shopify.lines.value;
  }
  if (Array.isArray(shopify.lines)) {
    return shopify.lines;
  }
  if (shopify.orderConfirmation?.value?.order?.lineItems?.nodes) {
    return shopify.orderConfirmation.value.order.lineItems.nodes;
  }
  return [];
}

/**
 * Safely navigates or reloads within the UI extension sandbox environment.
 * Prevents "Cannot set property href of [object WorkerLocation]" errors in Web Workers.
 */
export function safeNavigate(url) {
  const targetUrl = url || (typeof window !== 'undefined' && window.location ? window.location.href : null);

  // Strategy 1: Global shopify navigation API if provided by Shopify UI Extensions container
  if (typeof shopify !== 'undefined') {
    if (shopify.navigation && typeof shopify.navigation.navigate === 'function' && targetUrl) {
      try {
        shopify.navigation.navigate(targetUrl);
        return;
      } catch (e) {
        console.warn('[safeNavigate] shopify.navigation.navigate failed:', e);
      }
    }
    if (typeof shopify.open === 'function' && targetUrl) {
      try {
        shopify.open(targetUrl);
        return;
      } catch (e) {
        console.warn('[safeNavigate] shopify.open failed:', e);
      }
    }
  }

  // Strategy 2: window.open
  if (typeof window !== 'undefined' && typeof window.open === 'function' && targetUrl) {
    try {
      const opened = window.open(targetUrl, '_self') || window.open(targetUrl, '_blank');
      if (opened) return;
    } catch (e) {
      console.warn('[safeNavigate] window.open failed:', e);
    }
  }

  // Strategy 3: window.location methods
  if (typeof window !== 'undefined' && window.location) {
    // Try location.replace
    if (typeof window.location.replace === 'function' && targetUrl) {
      try {
        window.location.replace(targetUrl);
        return;
      } catch (e) {
        console.warn('[safeNavigate] window.location.replace failed:', e);
      }
    }
    // Try location.reload (if no specific url is passed, or as reload fallback)
    if (typeof window.location.reload === 'function') {
      try {
        window.location.reload();
        return;
      } catch (e) {
        console.warn('[safeNavigate] window.location.reload failed:', e);
      }
    }
    // Try location.assign
    if (typeof window.location.assign === 'function' && targetUrl) {
      try {
        window.location.assign(targetUrl);
        return;
      } catch (e) {
        console.warn('[safeNavigate] window.location.assign failed:', e);
      }
    }
    // Try setting window.location.href safely inside try...catch
    try {
      window.location.href = targetUrl;
      return;
    } catch (e) {
      console.warn('[safeNavigate] window.location.href assignment failed:', e);
    }
  }

  // Strategy 4: window.parent / window.top location fallback
  if (typeof window !== 'undefined') {
    try {
      if (window.top && window.top.location && window.top !== window && targetUrl) {
        window.top.location.href = targetUrl;
        return;
      }
    } catch (e) {
      console.warn('[safeNavigate] window.top.location failed:', e);
    }
    try {
      if (window.parent && window.parent.location && window.parent !== window && targetUrl) {
        window.parent.location.href = targetUrl;
        return;
      }
    } catch (e) {
      console.warn('[safeNavigate] window.parent.location failed:', e);
    }
  }
}

