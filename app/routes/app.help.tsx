import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function HelpPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<
    "overview" | "features" | "settings" | "faq"
  >("overview");

  return (
    <s-page heading="OrderEase Help & Merchant Guide">
      <s-button slot="primary-action" href="/app/active-services">
        Manage Active Services
      </s-button>

      <s-section heading="Merchant Guide & Documentation">
        <s-paragraph color="subdued">
          Learn how OrderEase works, explore available order editing features,
          configure security controls, and maximize post-purchase customer
          satisfaction.
        </s-paragraph>
      </s-section>

      {/* Navigation Tabs */}
      <s-section>
        <s-box
          padding="base"
          border="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button
              variant={activeTab === "overview" ? "primary" : "secondary"}
              onClick={() => setActiveTab("overview")}
            >
              Overview & How It Works
            </s-button>
            <s-button
              variant={activeTab === "features" ? "primary" : "secondary"}
              onClick={() => setActiveTab("features")}
            >
              Features Catalog (11 Services)
            </s-button>
            <s-button
              variant={activeTab === "settings" ? "primary" : "secondary"}
              onClick={() => setActiveTab("settings")}
            >
              Controls & Security Rules
            </s-button>
            <s-button
              variant={activeTab === "faq" ? "primary" : "secondary"}
              onClick={() => setActiveTab("faq")}
            >
              FAQ & Troubleshooting
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <s-stack direction="block" gap="base">
          <s-section heading="What is OrderEase?">
            <s-box padding="large" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-banner tone="info">
                  OrderEase is an all-in-one self-serve order editing solution
                  built for Shopify merchants. It empowers your customers to
                  update their unfulfilled orders directly from your store
                  without needing support assistance.
                </s-banner>
                <s-paragraph>
                  By enabling customers to fix shipping addresses, change item
                  sizes/colors, add forgotten items, or apply missed discount
                  codes immediately after purchase, OrderEase eliminates
                  support tickets, prevents wrong delivery shipments, and boosts
                  customer retention.
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-section>

          <s-section heading="How It Works (Step-by-Step Flow)">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
              gap="base"
            >
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-badge tone="info">Step 1</s-badge>
                  <s-text type="strong">Order Placement</s-text>
                  <s-paragraph color="subdued">
                    Customer places an order on your Shopify store. The order
                    edit countdown timer immediately begins.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-badge tone="info">Step 2</s-badge>
                  <s-text type="strong">Customer Access</s-text>
                  <s-paragraph color="subdued">
                    Customer views their order status on the Checkout Thank-You
                    page or Customer Account order details page.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-badge tone="info">Step 3</s-badge>
                  <s-text type="strong">Self-Serve Edit</s-text>
                  <s-paragraph color="subdued">
                    The OrderEase UI displays all active enabled capabilities
                    (quantity change, variant swap, address update, note, PDF
                    invoice, etc.).
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-badge tone="info">Step 4</s-badge>
                  <s-text type="strong">Real-Time Validation & Sync</s-text>
                  <s-paragraph color="subdued">
                    Edits are validated against time window limits, edit count
                    limits, and inventory levels before updating Shopify Admin
                    instantly.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>

          <s-section heading="Key Storefront Touchpoints">
            <s-box padding="large" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-grid gridTemplateColumns="1fr 1fr" gap="large">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">
                      1. Checkout Thank-You Page (Checkout UI)
                    </s-text>
                    <s-paragraph color="subdued">
                      Appears immediately after checkout confirmation. Ideal for
                      customers who realize they picked the wrong size or typoed
                      their address seconds after completing purchase.
                    </s-paragraph>
                  </s-stack>
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">
                      2. Customer Account (Order Status Block)
                    </s-text>
                    <s-paragraph color="subdued">
                      Appears when customers review past or active orders in
                      their customer account portal. Gives customers convenient
                      post-purchase control over pending orders.
                    </s-paragraph>
                  </s-stack>
                </s-grid>
              </s-stack>
            </s-box>
          </s-section>
        </s-stack>
      )}

      {/* TAB 2: FEATURES CATALOG */}
      {activeTab === "features" && (
        <s-stack direction="block" gap="base">
          <s-section heading="Comprehensive Feature Catalog (11 Services)">
            <s-paragraph color="subdued">
              OrderEase comes equipped with 11 specialized self-serve order
              editing modules. You can independently enable or disable any
              module on the Active Services page.
            </s-paragraph>
          </s-section>

          {/* Category: Item Management */}
          <s-section heading="Item Management">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
              gap="base"
            >
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Add Product to Order</s-text>
                    <s-badge tone="success">Active Service</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Allows customers to browse store products and add extra
                    items directly to their unfulfilled order without placing a
                    second separate order.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Edit Product Quantity</s-text>
                    <s-badge tone="success">Active Service</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Enables customers to increase or decrease quantities of line
                    items in existing orders with real-time stock validation and
                    automatic inventory release.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Swap Product Variant</s-text>
                    <s-badge tone="success">Active Service</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Lets customers switch options like shirt size (e.g. Medium to
                    Large) or color variants seamlessly without canceling the
                    whole order.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>

          {/* Category: Revenue & Growth */}
          <s-section heading="Revenue & Upsells">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
              gap="base"
            >
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">
                      Product Upsell & Recommendations
                    </s-text>
                    <s-badge tone="success">Revenue & Growth</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Displays smart product recommendations directly inside the
                    order edit module, prompting customers to add complimentary
                    products to their pending order.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>

          {/* Category: Shipping & Delivery */}
          <s-section heading="Shipping & Delivery">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
              gap="base"
            >
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Change Shipping Address</s-text>
                    <s-badge tone="info">Shipping</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Allows customers to update street address, apartment, city,
                    zip code, or country before dispatch to prevent delivery
                    failures.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Change Shipping Method</s-text>
                    <s-badge tone="info">Shipping</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Lets customers switch or upgrade their shipping rate (e.g.
                    from Standard Shipping to Express Delivery).
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>

          {/* Category: Communication & Contact */}
          <s-section heading="Communication & Contact">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
              gap="base"
            >
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Add / Edit Order Note</s-text>
                    <s-badge tone="neutral">Communication</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Permits customers to append gift instructions, gate access
                    codes, or custom order notes for your fulfillment team.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Update Contact Information</s-text>
                    <s-badge tone="neutral">Account</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Enables updating email address or phone number on pending
                    orders so tracking updates reach the customer properly.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>

          {/* Category: Discounts, Invoices & Orders */}
          <s-section heading="Discounts, Invoices & Cancellation">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
              gap="base"
            >
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Apply Discount Code</s-text>
                    <s-badge tone="warning">Promotions</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Allows customers to apply valid promo codes or coupon
                    discounts to active line items post-checkout.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Download & Print Invoice</s-text>
                    <s-badge tone="success">PDF Billing</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Generates clean, branded PDF invoices reflecting itemized
                    totals, active applied discounts, shipping costs, and tax
                    breakdowns.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" alignItems="center" gap="small">
                    <s-text type="strong">Cancel Order</s-text>
                    <s-badge tone="critical">Order Management</s-badge>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Provides self-service order cancellation within your
                    designated time window, automatically restocking inventory
                    back to your store.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>
        </s-stack>
      )}

      {/* TAB 3: CONTROLS & SECURITY RULES */}
      {activeTab === "settings" && (
        <s-stack direction="block" gap="base">
          <s-section heading="Merchant Control & Security Rules">
            <s-paragraph color="subdued">
              OrderEase provides store owners with full control over when and
              how order modifications can be made, preventing fulfillment
              conflicts and protecting inventory.
            </s-paragraph>
          </s-section>

          <s-section heading="1. Order Edit Time Window Limit">
            <s-box padding="large" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-text type="strong">Restricting Edits Before Fulfillment</s-text>
                <s-paragraph color="subdued">
                  Set a maximum elapsed time after order placement (e.g. 30
                  minutes, 1 hour, 2 hours, 1 day, or custom duration). Once
                  this time limit expires, all self-serve edit buttons are
                  disabled automatically to ensure your fulfillment warehouse
                  can pack and ship orders without mid-process changes.
                </s-paragraph>
                <s-banner tone="info">
                  Configurable on the Active Services tab.
                </s-banner>
              </s-stack>
            </s-box>
          </s-section>

          <s-section heading="2. Maximum Order Edits Limit">
            <s-box padding="large" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-text type="strong">
                  Preventing Excessive Modification Loops
                </s-text>
                <s-paragraph color="subdued">
                  Limit the total number of edit actions allowed per order (e.g.,
                  maximum 3 edit events). When an order reaches the set edit
                  limit, an Edit Limit Reached banner informs the customer.
                </s-paragraph>
                <s-banner tone="success">
                  PDF Invoice downloads always remain available to customers even
                  after the edit limit is reached.
                </s-banner>
              </s-stack>
            </s-box>
          </s-section>

          <s-section heading="3. Granular Service Toggles & Inventory Protection">
            <s-box padding="large" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-grid gridTemplateColumns="1fr 1fr" gap="large">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">One-Click Feature Toggles</s-text>
                    <s-paragraph color="subdued">
                      Every feature can be toggled ON or OFF independently on the
                      Active Services page. Disabled features are instantly
                      hidden from storefront UI extensions.
                    </s-paragraph>
                  </s-stack>
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">
                      Automatic Inventory Restocking
                    </s-text>
                    <s-paragraph color="subdued">
                      When items are removed, quantity is decreased, or an order
                      is canceled, released stock is automatically returned to
                      your store inventory via Shopify Admin GraphQL APIs.
                    </s-paragraph>
                  </s-stack>
                </s-grid>
              </s-stack>
            </s-box>
          </s-section>
        </s-stack>
      )}

      {/* TAB 4: FAQ & TROUBLESHOOTING */}
      {activeTab === "faq" && (
        <s-stack direction="block" gap="base">
          <s-section heading="Frequently Asked Questions (FAQ)">
            <s-stack direction="block" gap="base">
              <s-box padding="large" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    Q: What happens when an order is partially or fully fulfilled?
                  </s-text>
                  <s-paragraph color="subdued">
                    Once an order status changes to partially fulfilled or
                    fulfilled in Shopify Admin, OrderEase automatically locks
                    order modifications to avoid shipping discrepancies.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box padding="large" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    Q: Does downloading a PDF invoice count as an edit action?
                  </s-text>
                  <s-paragraph color="subdued">
                    No. Downloading or printing a PDF invoice is a read-only
                    operation and does not count towards the merchant-defined
                    maximum edit count limit.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box padding="large" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    Q: How are out-of-stock items handled when swapping or
                    adding products?
                  </s-text>
                  <s-paragraph color="subdued">
                    OrderEase verifies real-time product variant inventory
                    before allowing customers to select or commit changes.
                    Out-of-stock options are disabled with clear stock warnings.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box padding="large" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    Q: Where can I view analytics on how many orders have been
                    edited?
                  </s-text>
                  <s-paragraph color="subdued">
                    Navigate to the Insights page from the top navigation bar.
                    There you can review total open orders, total edited
                    orders, channel breakdown (Customer Account UI vs Checkout
                    UI), and individual feature usage frequency.
                  </s-paragraph>
                </s-stack>
              </s-box>

              <s-box padding="large" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    Q: How do I change the time limit or max edit limit?
                  </s-text>
                  <s-paragraph color="subdued">
                    Go to the Active Services page. At the top of the page, you
                    will find configuration blocks for setting Maximum Order
                    Edits Limit (e.g. 1, 2, 3, 5, unlimited, or custom) and
                    Order Edit Time Limit (e.g. 30m, 1h, 2h, 1d, 2d, or custom
                    duration).
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-stack>
          </s-section>
        </s-stack>
      )}

      {/* Footer Resources */}
      <s-section slot="aside" heading="Quick Links">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/active-services">
              Active Services & Controls
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/insights">Insights & Analytics</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app">Dashboard</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
