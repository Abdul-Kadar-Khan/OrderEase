import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkOrderEditLimit } from "../utils/editLimitHelper.server";

/**
 * GET /api/service-settings
 *
 * Called by Customer Account UI and Checkout UI extensions to find out which
 * features the merchant has enabled, the time limit, and the order edit limit.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  // Derive the store domain from the session token destination URL
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  // Fetch service settings rows for this shop
  const rows = await db.serviceSettings.findMany({
    where: { shop: storeDomain },
    select: { id: true, enabled: true },
  });

  // Fetch order edit time limit setting for this shop
  const timeLimitRecord = await db.orderEditTimeLimit.findUnique({
    where: { shop: storeDomain },
  });

  // Check order edit limit if orderId is provided
  const editLimitInfo = orderId
    ? await checkOrderEditLimit({ shop: storeDomain, orderId })
    : { isLimitReached: false, currentEditCount: 0, maxEdits: timeLimitRecord?.maxEdits ?? 3 };

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
