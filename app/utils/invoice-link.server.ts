import crypto from "node:crypto";

const LINK_TTL_MS = 5 * 60 * 1000; // 5 minutes — plenty of time to open the download

function getSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("SHOPIFY_API_SECRET is not configured");
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export interface SignedInvoiceParams {
  shop: string;
  orderId: string;
  customerId: string;
}

/**
 * Builds a short-lived, tamper-proof URL that can be opened directly by the
 * browser (e.g. via window.open) without needing an Authorization header,
 * since simple top-level navigations can't carry custom headers.
 */
export function buildSignedInvoiceUrl(appUrl: string, params: SignedInvoiceParams): string {
  const expires = Date.now() + LINK_TTL_MS;
  const payload = `${params.shop}|${params.orderId}|${params.customerId}|${expires}`;
  const signature = sign(payload);

  const url = new URL("/public/invoice-link", appUrl);
  url.searchParams.set("shop", params.shop);
  url.searchParams.set("orderId", params.orderId);
  url.searchParams.set("customerId", params.customerId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);

  return url.toString();
}

export interface VerifiedInvoiceParams extends SignedInvoiceParams {
  expires: number;
}

/**
 * Verifies a signed invoice URL's query params. Returns the verified params
 * on success, or null if the link is missing data, expired, or tampered with.
 */
export function verifySignedInvoiceUrl(searchParams: URLSearchParams): VerifiedInvoiceParams | null {
  const shop = searchParams.get("shop");
  const orderId = searchParams.get("orderId");
  const customerId = searchParams.get("customerId");
  const expiresRaw = searchParams.get("expires");
  const signature = searchParams.get("signature");

  if (!shop || !orderId || !customerId || !expiresRaw || !signature) {
    return null;
  }

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || Date.now() > expires) {
    return null;
  }

  const payload = `${shop}|${orderId}|${customerId}|${expires}`;
  const expectedSignature = sign(payload);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  return { shop, orderId, customerId, expires };
}
