import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkOrderEditLimit } from "../utils/editLimitHelper.server";

/**
 * GET /api/service-settings
 *
 * Called by Customer Account UI and Checkout UI extensions to find out which
 * features the merchant has enabled, the time limit, order edit limit, and if
 * Google Places API key is configured.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  let cors = (res: Response) => res;
  let storeDomain = "";

  try {
    const authResult = await authenticate.public.customerAccount(request);
    cors = authResult.cors;
    if (authResult.sessionToken?.dest) {
      storeDomain = authResult.sessionToken.dest.replace(/^https?:\/\//, "");
    }
  } catch (e) {
    cors = (res: Response) => {
      const newHeaders = new Headers(res.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders,
      });
    };
  }

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const shopParam = url.searchParams.get("shop");

  if (shopParam) storeDomain = shopParam;
  storeDomain = storeDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().trim();

  // Fetch service settings rows for this shop
  const rows = storeDomain
    ? await db.serviceSettings.findMany({
        where: { shop: storeDomain },
        select: { id: true, enabled: true },
      })
    : [];

  // Fetch order edit time limit setting for this shop
  const timeLimitRecord = storeDomain
    ? await db.orderEditTimeLimit.findUnique({ where: { shop: storeDomain } })
    : null;

  // Fetch Google Places API Key configuration for this specific shop
  const googleConfig = storeDomain
    ? await db.googlePlacesConfig.findUnique({ where: { shop: storeDomain } })
    : null;

  const hasGooglePlacesKey = Boolean(googleConfig?.apiKey && googleConfig.apiKey.trim().length > 0);

  // Check order edit limit if orderId is provided
  const editLimitInfo = orderId && storeDomain
    ? await checkOrderEditLimit({ shop: storeDomain, orderId })
    : { isLimitReached: false, currentEditCount: 0, maxEdits: timeLimitRecord?.maxEdits ?? 3 };

  const settings: Record<string, boolean> = {};
  for (const row of rows) {
    settings[row.id] = row.enabled;
  }

  return cors(
    Response.json({
      settings,
      hasGooglePlacesKey,
      timeLimit: timeLimitRecord
        ? {
            preset: timeLimitRecord.timeLimit,
            customValue: timeLimitRecord.customValue,
            customUnit: timeLimitRecord.customUnit,
          }
        : { preset: "1h", customValue: 1, customUnit: "hours" },
      editLimit: {
        maxEdits: editLimitInfo.maxEdits,
        currentEditCount: editLimitInfo.currentEditCount,
        isLimitReached: editLimitInfo.isLimitReached,
      },
    }),
  );
}

export async function action({ request }: LoaderFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return cors(Response.json({ error: "Method not allowed" }, { status: 405 }));
}
