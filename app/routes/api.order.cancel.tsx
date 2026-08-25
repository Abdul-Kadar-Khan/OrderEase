import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { trackOrderEdit } from "../utils/analyticsHelper.server";
import { checkOrderEditLimit } from "../utils/editLimitHelper.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { cors } = await authenticate.public.customerAccount(request);
  return cors(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  if (request.method === "OPTIONS") {
    return cors(
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const { admin } = await unauthenticated.admin(storeDomain);

  const body = await request.json();
  const { orderId, reason, source } = body || {};

  if (!orderId) {
    return cors(
      Response.json(
        { userErrors: [{ message: "Missing orderId." }] },
        { status: 400 },
      ),
    );
  }

  // Check edit limit guard
  const editLimitCheck = await checkOrderEditLimit({ shop: storeDomain, orderId });
  if (editLimitCheck.isLimitReached) {
    return cors(
      Response.json(
        {
          userErrors: [
            {
              message: `You have reached the maximum allowed edits (${editLimitCheck.maxEdits} edits) for this order.`,
            },
          ],
        },
        { status: 422 },
      ),
    );
  }

  try {
    // For a real app you might want to create a return or just tag the order, 
    // but here we demonstrate the orderCancel mutation.
    const cancelResponse = await admin.graphql(
      `#graphql
      mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!) {
        orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: true, restock: true, refundMethod: { originalPaymentMethodsRefund: true }) {
          job { id }
          orderCancelUserErrors { field message }
        }
      }`,
      { 
        variables: { 
          orderId,
          reason: reason || "CUSTOMER"
        } 
      },
    );

    const cancelJson = await cancelResponse.json();
    const errors = cancelJson.data?.orderCancel?.orderCancelUserErrors ?? [];
    if (errors.length) {
      return cors(Response.json({ userErrors: errors }, { status: 422 }));
    }

    // Track order edit and feature usage
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "cancel-order",
      source,
    });

    return cors(Response.json({ success: true, userErrors: [] }));
  } catch (err: unknown) {
    console.error("[order-cancel] Unexpected error:", err);
    return cors(Response.json({ userErrors: [{ message: err instanceof Error ? err.message : "Internal error" }] }, { status: 500 }));
  }
}

