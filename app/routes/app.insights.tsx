import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Static metadata list matching app.active-services.tsx
const ALL_SERVICES = [
  { id: "add-product", title: "Add Product to Order", category: "Item Management" },
  { id: "product-upsell", title: "Product Upsell & Recommendations", category: "Revenue & Growth" },
  { id: "edit-quantity", title: "Edit Product Quantity", category: "Item Management" },
  { id: "swap-variant", title: "Swap Product Variant", category: "Item Management" },
  { id: "change-address", title: "Change Shipping Address", category: "Shipping & Delivery" },
  { id: "change-shipping-method", title: "Change Shipping Method", category: "Shipping & Delivery" },
  { id: "order-note", title: "Add / Edit Order Note", category: "Communication" },
  { id: "contact-info", title: "Update Contact Information", category: "Account & Contact" },
  { id: "apply-discount", title: "Apply Discount Code", category: "Promotions" },
  { id: "cancel-order", title: "Cancel Order", category: "Order Management" },
  { id: "download-invoice", title: "Download & Print Invoice", category: "Billing & Receipts" },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Fetch total open orders count from Shopify Admin GraphQL API (matches Shopify sidebar)
  let totalStoreOrders = 0;
  try {
    const ordersRes = await admin.graphql(
      `#graphql
      query getTotalOrdersCount {
        ordersCount(query: "status:open") {
          count
        }
      }`
    );
    const ordersJson = await ordersRes.json();
    totalStoreOrders = ordersJson.data?.ordersCount?.count ?? 0;
  } catch (err) {
    console.error("[insights-loader] Error fetching orders count:", err);
  }

  // 2. Fetch edited orders stats from SQLite (EditedOrder)
  const editedOrders = await db.editedOrder.findMany({
    where: { shop },
  });

  // Count unique orders edited
  const uniqueOrdersSet = new Set(editedOrders.map((o) => o.orderId));
  const totalEditedOrders = uniqueOrdersSet.size;

  const customerAccountEditsCount = editedOrders.filter(
    (o) => o.source === "customer_account_ui"
  ).length;
  const checkoutUiEditsCount = editedOrders.filter(
    (o) => o.source === "checkout_ui"
  ).length;

  // 3. Fetch active features count from ServiceSettings
  const serviceSettings = await db.serviceSettings.findMany({
    where: { shop },
  });

  const enabledMap = new Map<string, boolean>();
  serviceSettings.forEach((s) => enabledMap.set(s.id, s.enabled));

  const totalFeatures = ALL_SERVICES.length;
  const activeFeaturesCount = ALL_SERVICES.filter(
    (s) => enabledMap.get(s.id) === true
  ).length;

  // 4. Fetch feature usage frequency from FeatureUsage
  const usageRecords = await db.featureUsage.findMany({
    where: { shop },
  });

  const usageMap = new Map<string, number>();
  usageRecords.forEach((u) => usageMap.set(u.featureId, u.usedCount));

  const featureUsageList = ALL_SERVICES.map((s) => ({
    id: s.id,
    title: s.title,
    category: s.category,
    active: enabledMap.get(s.id) ?? false,
    usageCount: usageMap.get(s.id) ?? 0,
  }));

  return {
    shop,
    totalStoreOrders,
    totalEditedOrders,
    customerAccountEditsCount,
    checkoutUiEditsCount,
    activeFeaturesCount,
    totalFeatures,
    featureUsageList,
  };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function InsightsPage(): JSX.Element {
  const {
    totalStoreOrders,
    totalEditedOrders,
    customerAccountEditsCount,
    checkoutUiEditsCount,
    activeFeaturesCount,
    totalFeatures,
    featureUsageList,
  } = useLoaderData<typeof loader>();

  const totalEditsCount = customerAccountEditsCount + checkoutUiEditsCount;
  const customerAccountPercent =
    totalEditsCount > 0
      ? Math.round((customerAccountEditsCount / totalEditsCount) * 100)
      : 0;
  const checkoutUiPercent =
    totalEditsCount > 0
      ? Math.round((checkoutUiEditsCount / totalEditsCount) * 100)
      : 0;

  return (
    <s-page heading="Insights">
      <s-section heading="Analytics & Performance Overview">
        <s-paragraph color="subdued">
          Monitor your store's total order edits, entry-point channels (Customer Account UI vs Checkout UI), active capabilities, and usage frequency across all app features.
        </s-paragraph>
      </s-section>

      {/* ── Metric Stat Cards ── */}
      <s-section heading="Key Metrics">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          <s-box padding="large" border="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Total Open Orders</s-text>

              <div style={{ fontSize: "32px", fontWeight: "700", color: "#1a1d1f" }}>
                {totalStoreOrders}
              </div>
            </s-stack>
          </s-box>

          <s-box padding="large" border="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Total Orders Edited</s-text>
              <div style={{ fontSize: "32px", fontWeight: "700", color: "#008060" }}>
                {totalEditedOrders}
              </div>
            </s-stack>
          </s-box>

          <s-box padding="large" border="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Active Features</s-text>
              <div style={{ fontSize: "32px", fontWeight: "700", color: "#2c6ecb" }}>
                {activeFeaturesCount} <span style={{ fontSize: "18px", color: "#6d7175", fontWeight: "400" }}>/ {totalFeatures} Enabled</span>
              </div>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {/* ── Edit Location Source Breakdown ── */}
      <s-section heading="Edit Location Breakdown">
        <s-box padding="large" border="base" borderRadius="base">
          <s-stack direction="block" gap="large">
            <s-paragraph color="subdued">
              Shows which UI interface customers used to edit their orders.
            </s-paragraph>

            <s-stack direction="block" gap="base">
              {/* Customer Account UI Item */}
              <s-stack direction="block" gap="small">
                <s-grid gridTemplateColumns="1fr auto" alignItems="center">
                  <s-text type="strong">Customer Account UI (Order Status Page)</s-text>
                  <s-text type="strong">{customerAccountEditsCount} edits ({customerAccountPercent}%)</s-text>
                </s-grid>
                <div style={{ height: "10px", width: "100%", backgroundColor: "#e1e3e5", borderRadius: "5px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${customerAccountPercent}%`,
                      backgroundColor: "#008060",
                      borderRadius: "5px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </s-stack>

              {/* Checkout UI Item */}
              <s-stack direction="block" gap="small">
                <s-grid gridTemplateColumns="1fr auto" alignItems="center">
                  <s-text type="strong">Checkout UI (Thank-You Page)</s-text>
                  <s-text type="strong">{checkoutUiEditsCount} edits ({checkoutUiPercent}%)</s-text>
                </s-grid>
                <div style={{ height: "10px", width: "100%", backgroundColor: "#e1e3e5", borderRadius: "5px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${checkoutUiPercent}%`,
                      backgroundColor: "#2c6ecb",
                      borderRadius: "5px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      {/* ── Feature Usage Frequency Table ── */}
      <s-section heading="Feature Usage Frequency">
        <s-box padding="large" border="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            {featureUsageList.map((item) => (
              <s-box
                key={item.id}
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-grid gridTemplateColumns="1fr auto auto" alignItems="center" gap="base">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" alignItems="center" gap="base">
                      <s-text type="strong">{item.title}</s-text>
                      <s-badge tone={item.active ? "success" : "neutral"}>
                        {item.active ? "Active" : "Inactive"}
                      </s-badge>
                    </s-stack>
                    <s-text color="subdued">{item.category}</s-text>
                  </s-stack>

                  <div style={{ textAlign: "right" }}>
                    <s-badge tone={item.usageCount > 0 ? "info" : "neutral"}>
                      {item.usageCount} {item.usageCount === 1 ? "use" : "uses"}
                    </s-badge>
                  </div>
                </s-grid>
              </s-box>
            ))}
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}
