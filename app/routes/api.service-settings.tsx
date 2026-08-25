import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkOrderEditLimit } from "../utils/editLimitHelper.server";

/**
 * GET /api/service-settings?orderId=...
 *
 * Called by the Customer Account UI extension to find out which features
 * the merchant has enabled.  Authentication is done via the customer-account
 * session token (same pattern as the other api.order-edit.* routes).
 *
 * Returns:
 *   { settings: { [serviceId: string]: boolean }, timeLimit: {...}, editLimit: {...} }
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  // Derive the store domain from the session token destination URL
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  // Use the store domain as the "shop" key (same value stored by the app's OAuth session)
  const rows = await db.serviceSettings.findMany({
    where: { shop: storeDomain },
    select: { id: true, enabled: true },
  });

  // Also fetch the order edit time limit setting for this shop
  const timeLimitRecord = await db.orderEditTimeLimit.findUnique({
    where: { shop: storeDomain },
  });

  const editLimitStatus = await checkOrderEditLimit({ shop: storeDomain, orderId });

  const settings: Record<string, boolean> = {};
  for (const row of rows) {
    settings[row.id] = row.enabled;
  }

  return cors(
    Response.json({
      settings,
      timeLimit: timeLimitRecord
        ? {
            preset: timeLimitRecord.timeLimit,
            customValue: timeLimitRecord.customValue,
            customUnit: timeLimitRecord.customUnit,
          }
        : { preset: "1h", customValue: 1, customUnit: "hours" },
      editLimit: editLimitStatus,
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
