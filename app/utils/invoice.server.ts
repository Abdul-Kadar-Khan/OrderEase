import PDFDocument from "pdfkit";

export const ORDER_INVOICE_QUERY = `#graphql
  query getOrderInvoice($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      email
      currencyCode
      customer {
        id
        firstName
        lastName
        email
      }
      billingAddress {
        name
        address1
        address2
        city
        province
        zip
        country
      }
      shippingAddress {
        name
        address1
        address2
        city
        province
        zip
        country
      }
      lineItems(first: 100) {
        edges {
          node {
            name
            quantity
            currentQuantity
            originalUnitPriceSet {
              shopMoney { amount currencyCode }
            }
            originalTotalSet {
              shopMoney { amount currencyCode }
            }
          }
        }
      }
      currentSubtotalPriceSet {
        shopMoney { amount currencyCode }
      }
      totalShippingPriceSet {
        shopMoney { amount currencyCode }
      }
      currentTotalTaxSet {
        shopMoney { amount currencyCode }
      }
      currentTotalDiscountsSet {
        shopMoney { amount currencyCode }
      }
      currentTotalPriceSet {
        shopMoney { amount currencyCode }
      }
    }
  }
`;

interface Money {
  amount: string;
  currencyCode: string;
}

export interface InvoiceOrder {
  id: string;
  name: string;
  createdAt: string;
  email?: string | null;
  currencyCode: string;
  customer?: {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
  billingAddress?: {
    name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        name: string;
        quantity: number;
        currentQuantity: number;
        originalUnitPriceSet: { shopMoney: Money };
        originalTotalSet: { shopMoney: Money };
      };
    }>;
  };
  currentSubtotalPriceSet?: { shopMoney: Money } | null;
  totalShippingPriceSet?: { shopMoney: Money } | null;
  currentTotalTaxSet?: { shopMoney: Money } | null;
  currentTotalDiscountsSet?: { shopMoney: Money } | null;
  currentTotalPriceSet?: { shopMoney: Money } | null;
}

function formatMoney(money?: Money | null, fallbackCurrency?: string): string {
  if (!money) return "";
  const amount = Number(money.amount || 0).toFixed(2);
  return `${amount} ${money.currencyCode || fallbackCurrency || ""}`.trim();
}

function formatAddress(address?: InvoiceOrder["billingAddress"]): string[] {
  if (!address) return [];
  const lines: string[] = [];
  if (address.name) lines.push(address.name);
  if (address.address1) lines.push(address.address1);
  if (address.address2) lines.push(address.address2);
  const cityLine = [address.city, address.province, address.zip]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  if (address.country) lines.push(address.country);
  return lines;
}

/**
 * Renders an order into a real PDF invoice and resolves with the PDF bytes.
 */
export function generateInvoicePdf(order: InvoiceOrder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const currency = order.currencyCode;
      const orderDate = order.createdAt
        ? new Date(order.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "";

      // Header
      doc.fontSize(22).font("Helvetica-Bold").text("Invoice", { align: "left" });
      doc.moveDown(0.5);
      doc
        .fontSize(11)
        .font("Helvetica")
        .text(`Order: ${order.name}`)
        .text(orderDate ? `Date: ${orderDate}` : "");

      doc.moveDown();

      // Billing / customer info
      const customerName = [order.customer?.firstName, order.customer?.lastName]
        .filter(Boolean)
        .join(" ");
      const customerEmail = order.customer?.email || order.email || "";

      const billingLines = formatAddress(order.billingAddress);

      const infoTop = doc.y;
      doc.font("Helvetica-Bold").text("Billed To", 50, infoTop);
      doc.font("Helvetica");
      let infoY = infoTop + 16;
      if (customerName) {
        doc.text(customerName, 50, infoY);
        infoY += 14;
      }
      if (customerEmail) {
        doc.text(customerEmail, 50, infoY);
        infoY += 14;
      }
      for (const line of billingLines) {
        doc.text(line, 50, infoY);
        infoY += 14;
      }

      doc.y = Math.max(doc.y, infoY) + 10;
      doc.moveDown();

      // Line items table
      const tableTop = doc.y;
      const col = { name: 50, qty: 320, price: 390, total: 470 };

      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Item", col.name, tableTop);
      doc.text("Qty", col.qty, tableTop);
      doc.text("Price", col.price, tableTop);
      doc.text("Total", col.total, tableTop);

      doc
        .moveTo(50, tableTop + 15)
        .lineTo(545, tableTop + 15)
        .strokeColor("#cccccc")
        .stroke();

      doc.font("Helvetica").fontSize(10);
      let rowY = tableTop + 22;

      // Only include items that are still active in the order (not removed by edits)
      const items = (order.lineItems?.edges ?? []).filter(
        ({ node }) => node.currentQuantity > 0
      );
      for (const { node } of items) {
        if (rowY > 720) {
          doc.addPage();
          rowY = 50;
        }
        // Use currentQuantity (reflects edits) and recalculate line total
        const unitPrice = node.originalUnitPriceSet?.shopMoney;
        const currentTotal: Money | null = unitPrice
          ? {
              amount: (Number(unitPrice.amount) * node.currentQuantity).toFixed(2),
              currencyCode: unitPrice.currencyCode,
            }
          : null;
        doc.text(node.name, col.name, rowY, { width: 260 });
        doc.text(String(node.currentQuantity), col.qty, rowY);
        doc.text(formatMoney(unitPrice, currency), col.price, rowY);
        doc.text(formatMoney(currentTotal, currency), col.total, rowY);
        rowY += 18;
      }

      doc
        .moveTo(50, rowY + 4)
        .lineTo(545, rowY + 4)
        .strokeColor("#cccccc")
        .stroke();

      // Totals
      let totalsY = rowY + 16;
      const totalsRow = (label: string, value?: Money | null, bold = false) => {
        if (!value) return;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        doc.text(label, col.price - 60, totalsY);
        doc.text(formatMoney(value, currency), col.total, totalsY);
        totalsY += 16;
      };

      totalsRow("Subtotal", order.currentSubtotalPriceSet?.shopMoney);
      totalsRow("Shipping", order.totalShippingPriceSet?.shopMoney);
      totalsRow("Tax", order.currentTotalTaxSet?.shopMoney);
      if (order.currentTotalDiscountsSet?.shopMoney && Number(order.currentTotalDiscountsSet.shopMoney.amount) > 0) {
        totalsRow("Discounts", order.currentTotalDiscountsSet?.shopMoney);
      }
      totalsRow("Total", order.currentTotalPriceSet?.shopMoney, true);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
