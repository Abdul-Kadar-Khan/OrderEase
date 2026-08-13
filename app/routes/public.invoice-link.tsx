import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { verifySignedInvoiceUrl } from "../utils/invoice-link.server";
import { generateInvoicePdf, ORDER_INVOICE_QUERY, type InvoiceOrder } from "../utils/invoice.server";

/**
 * Public (no session-token) endpoint that streams a real invoice PDF.
 *
 * This is opened directly by the browser (window.open) from the customer
 * account extension, so it can't carry an Authorization header — instead the
 * URL itself is signed and time-limited (see utils/invoice-link.server.ts),
 * and re-checks that the order belongs to the requesting customer.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const verified = verifySignedInvoiceUrl(url.searchParams);

  if (!verified) {
    return new Response("This invoice link is invalid or has expired.", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const { shop, orderId, customerId } = verified;

  try {
    const { admin } = await unauthenticated.admin(shop);

    const response = await admin.graphql(ORDER_INVOICE_QUERY, {
      variables: { id: orderId },
    });
    const json = await response.json();
    const order: InvoiceOrder | undefined = json.data?.order;

    if (!order) {
      return new Response("Order not found.", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const numericId = (gidOrId?: string | null) => gidOrId?.match(/\d+$/)?.[0];
    if (!order.customer?.id || numericId(order.customer.id) !== numericId(customerId)) {
      return new Response("Not authorized to access this order.", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const pdfBuffer = await generateInvoicePdf(order);
    const filename = `invoice-${order.name.replace(/[^a-zA-Z0-9-_]/g, "")}.pdf`;

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // "inline" lets the browser open/preview it in the new tab rather
        // than forcing a save dialog, matching the previous window.open UX.
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    console.error("[invoice-link] Unexpected error:", err);
    return new Response("Failed to generate invoice.", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
