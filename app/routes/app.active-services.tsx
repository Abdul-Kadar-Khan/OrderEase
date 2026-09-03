import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const SSwitch = "s-switch" as any;

// ─── GraphQL Queries & Mutations for Product Tags & Upsell ───────────────

const GET_PRODUCTS_QUERY = `#graphql
  query GetProductsForUpsellTags($query: String, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          tags
          featuredMedia {
            preview {
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  }
`;

const ADD_TAGS_MUTATION = `#graphql
  mutation AddProductTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REMOVE_TAGS_MUTATION = `#graphql
  mutation RemoveProductTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Service definitions (static metadata) ─────────────────────────────────

const SERVICES = [
  {
    id: "add-product",
    title: "Add Product to Order",
    description:
      "Allow customers to add new products or additional items to their unfulfilled order.",
    category: "Item Management",
  },
  {
    id: "product-upsell",
    title: "Product Upsell & Recommendations",
    description:
      "Offer smart product recommendations and upsells directly on the order edit page.",
    category: "Revenue & Growth",
  },
  {
    id: "edit-quantity",
    title: "Edit Product Quantity",
    description:
      "Let customers increase or decrease quantities of line items in existing orders.",
    category: "Item Management",
  },
  {
    id: "swap-variant",
    title: "Swap Product Variant",
    description:
      "Enable customers to switch product size, color, or variant options easily.",
    category: "Item Management",
  },
  {
    id: "change-address",
    title: "Change Shipping Address",
    description:
      "Allow customers to update their delivery address before order dispatch.",
    category: "Shipping & Delivery",
  },
  {
    id: "change-shipping-method",
    title: "Change Shipping Method",
    description:
      "Let customers upgrade or change their selected shipping method and speed.",
    category: "Shipping & Delivery",
  },
  {
    id: "order-note",
    title: "Add / Edit Order Note",
    description:
      "Allow customers to leave special instructions, gift notes, or delivery hints.",
    category: "Communication",
  },
  {
    id: "contact-info",
    title: "Update Contact Information",
    description:
      "Enable customers to update email address or phone number on pending orders.",
    category: "Account & Contact",
  },
  {
    id: "apply-discount",
    title: "Apply Discount Code",
    description:
      "Allow customers to apply coupon codes or promotional discounts to active orders.",
    category: "Promotions",
  },
  {
    id: "cancel-order",
    title: "Cancel Order",
    description:
      "Provide self-serve order cancellation within merchant-defined time limits.",
    category: "Order Management",
  },
  {
    id: "download-invoice",
    title: "Download & Print Invoice",
    description:
      "Provide downloadable PDF invoices on customer order status pages.",
    category: "Billing & Receipts",
  },
] as const;

// ─── Loader ────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();

  // 1. Fetch existing settings rows for this shop
  let rows = await db.serviceSettings.findMany({
    where: { shop },
  });

  const existingIds = new Set(rows.map((r) => r.id));
  const missingServices = SERVICES.filter((s) => !existingIds.has(s.id));

  // 2. Auto-seed any missing service rows in the database as enabled: false
  if (missingServices.length > 0) {
    console.log(
      `[ActiveServices Loader] Seeding ${missingServices.length} missing services in DB with enabled=false for shop ${shop}`,
    );
    await db.serviceSettings.createMany({
      data: missingServices.map((s) => ({
        id: s.id,
        shop,
        enabled: false,
      })),
    });

    // Re-fetch updated rows
    rows = await db.serviceSettings.findMany({
      where: { shop },
    });
  }

  // 3. Build a lookup map: serviceId -> enabled
  const dbMap: Record<string, boolean> = {};
  rows.forEach((row) => {
    dbMap[row.id] = row.enabled;
  });

  // 4. Map services with DB state (defaulting to false)
  const services = SERVICES.map((s) => ({
    ...s,
    enabled: dbMap[s.id] ?? false,
  }));

  // 5. Fetch time limit setting for this shop
  let timeLimitRecord = await db.orderEditTimeLimit.findUnique({
    where: { shop },
  });

  if (!timeLimitRecord) {
    timeLimitRecord = await db.orderEditTimeLimit.create({
      data: {
        shop,
        timeLimit: "1h",
        customValue: 1,
        customUnit: "hours",
      },
    });
  }

  // 6. Fetch Google Places API Key configuration for this shop
  const googleConfig = await db.googlePlacesConfig.findUnique({
    where: { shop },
  });

  // 7. Initial products array (populated upon user search)
  const initialProducts: Array<{
    id: string;
    title: string;
    handle: string;
    tags: string[];
    imageUrl: string;
  }> = [];

  return {
    shop,
    services,
    timeLimitSettings: {
      timeLimit: timeLimitRecord.timeLimit,
      customValue: timeLimitRecord.customValue ?? 1,
      customUnit: timeLimitRecord.customUnit ?? "hours",
      maxEdits: timeLimitRecord.maxEdits ?? 3,
    },
    googleApiKey: googleConfig?.apiKey || "",
    initialProducts,
  };
};

// ─── Action — toggle service, save time/edit limits, or save Google API key ───

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "addProductTag") {
    const productId = formData.get("productId") as string;
    const tag = (formData.get("tag") as string)?.trim();

    if (!productId || !tag) {
      return { ok: false, error: "Product ID and Tag are required" };
    }

    console.log(
      `[ActiveServices Action] Adding tag "${tag}" to product ${productId}`,
    );
    const res = await admin.graphql(ADD_TAGS_MUTATION, {
      variables: { id: productId, tags: [tag] },
    });
    const json = await res.json();
    const errors = json.data?.tagsAdd?.userErrors ?? [];

    if (errors.length > 0) {
      return { ok: false, error: errors[0].message };
    }

    return { ok: true, type: "productTag", action: "added", productId, tag };
  }

  if (intent === "removeProductTag") {
    const productId = formData.get("productId") as string;
    const tag = (formData.get("tag") as string)?.trim();

    if (!productId || !tag) {
      return { ok: false, error: "Product ID and Tag are required" };
    }

    console.log(
      `[ActiveServices Action] Removing tag "${tag}" from product ${productId}`,
    );
    const res = await admin.graphql(REMOVE_TAGS_MUTATION, {
      variables: { id: productId, tags: [tag] },
    });
    const json = await res.json();
    const errors = json.data?.tagsRemove?.userErrors ?? [];

    if (errors.length > 0) {
      return { ok: false, error: errors[0].message };
    }

    return { ok: true, type: "productTag", action: "removed", productId, tag };
  }

  if (intent === "searchProducts") {
    const query = (formData.get("query") as string)?.trim() || "";
    console.log(
      `[ActiveServices Action] Searching products with query "${query}"`,
    );

    const res = await admin.graphql(GET_PRODUCTS_QUERY, {
      variables: {
        first: 12,
        query: query ? `title:*${query}* OR tag:*${query}*` : undefined,
      },
    });
    const json = await res.json();
    const edges = json.data?.products?.edges ?? [];
    const products = edges.map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      tags: e.node.tags || [],
      imageUrl: e.node.featuredMedia?.preview?.image?.url || "",
    }));

    return { ok: true, type: "searchProducts", products };
  }

  if (intent === "saveGoogleApiKey") {
    const apiKeyRaw = formData.get("googleApiKey") as string;
    const apiKey = apiKeyRaw ? apiKeyRaw.trim() : null;

    console.log(
      `[ActiveServices Action] Saving Google Places API Key: shop=${shop}, hasKey=${Boolean(apiKey)}`,
    );

    const result = await db.googlePlacesConfig.upsert({
      where: { shop },
      create: {
        shop,
        apiKey,
      },
      update: {
        apiKey,
      },
    });

    return { ok: true, type: "googleApiKey", action: "saved", result };
  }

  if (intent === "deleteGoogleApiKey") {
    console.log(
      `[ActiveServices Action] Deleting Google Places API Key for shop=${shop}`,
    );

    try {
      await db.googlePlacesConfig.delete({
        where: { shop },
      });
    } catch (e) {
      // If record didn't exist in DB, ensure it's set to null
      await db.googlePlacesConfig.upsert({
        where: { shop },
        create: { shop, apiKey: null },
        update: { apiKey: null },
      });
    }

    return { ok: true, type: "googleApiKey", action: "deleted" };
  }

  if (intent === "saveMaxEdits") {
    const maxEditsStr = formData.get("maxEdits") as string;
    const maxEdits =
      !maxEditsStr || maxEditsStr === "0" || maxEditsStr === "unlimited"
        ? null
        : parseInt(maxEditsStr, 10);

    console.log(
      `[ActiveServices Action] Saving max edits limit: shop=${shop}, maxEdits=${maxEdits}`,
    );

    const timeLimitRecord = await db.orderEditTimeLimit.upsert({
      where: { shop },
      create: {
        shop,
        maxEdits,
      },
      update: {
        maxEdits,
      },
    });

    return { ok: true, type: "maxEdits", result: timeLimitRecord };
  }

  if (intent === "saveTimeLimit") {
    const timeLimit = (formData.get("timeLimit") as string) || "1h";
    const customValueStr = formData.get("customValue") as string;
    const customUnit = (formData.get("customUnit") as string) || "hours";
    const customValue = customValueStr ? parseInt(customValueStr, 10) : null;

    console.log(
      `[ActiveServices Action] Saving time limit setting: shop=${shop}, timeLimit=${timeLimit}, customValue=${customValue}, customUnit=${customUnit}`,
    );

    const timeLimitRecord = await db.orderEditTimeLimit.upsert({
      where: { shop },
      create: {
        shop,
        timeLimit,
        customValue,
        customUnit,
      },
      update: {
        timeLimit,
        customValue,
        customUnit,
      },
    });

    return { ok: true, type: "timeLimit", result: timeLimitRecord };
  }

  const serviceId = formData.get("serviceId") as string;
  const enabledStr = formData.get("enabled") as string;
  const enabled = enabledStr === "true";

  console.log(
    `[ActiveServices Action] Saving service setting: shop=${shop}, serviceId=${serviceId}, enabled=${enabled}`,
  );

  if (!serviceId) {
    return { ok: false, error: "Missing serviceId" };
  }

  // Upsert: create row if first toggle, update if it already exists
  const result = await db.serviceSettings.upsert({
    where: { shop_id: { shop, id: serviceId } },
    create: { id: serviceId, shop, enabled },
    update: { enabled },
  });

  return { ok: true, type: "service", result };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function ActiveServicesPage(): JSX.Element {
  const { services, timeLimitSettings, googleApiKey, initialProducts } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Active Services">
      <s-section heading="Order Edit App Capabilities">
        <s-paragraph>
          Manage and monitor all active customer-facing services provided by
          your Order Edit App. Use the toggles on the right to enable or disable
          specific functionalities for your store customers.
        </s-paragraph>
      </s-section>

      {/* ── Product Tags & Upsell Management Section ── */}
      <ProductTagsSection initialProducts={initialProducts} />

      {/* ── Google Location Autocomplete Key Section ── */}
      <GoogleApiKeySection initialApiKey={googleApiKey} />

      {/* ── Max Edits Limit Configuration Box ── */}
      <MaxEditsSection initialMaxEdits={timeLimitSettings.maxEdits} />

      {/* ── Time Limit Configuration Box ── */}
      <TimeLimitSection initialSettings={timeLimitSettings} />

      <s-section heading="Services Overview">
        <s-stack direction="block" gap="base">
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              id={service.id}
              title={service.title}
              description={service.description}
              category={service.category}
              enabled={service.enabled}
            />
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

// ─── MaxEditsSection Component ──────────────────────────────────────────────

const MAX_EDITS_PRESETS = [
  { value: "1", label: "1 Edit" },
  { value: "2", label: "2 Edits" },
  { value: "3", label: "3 Edits" },
  { value: "5", label: "5 Edits" },
  { value: "unlimited", label: "Unlimited" },
  { value: "custom", label: "Custom Limit" },
] as const;

interface MaxEditsSectionProps {
  initialMaxEdits: number | null;
}

function MaxEditsSection({
  initialMaxEdits,
}: MaxEditsSectionProps): JSX.Element {
  const fetcher = useFetcher();
  const initialPreset =
    initialMaxEdits === null || initialMaxEdits === 0
      ? "unlimited"
      : [1, 2, 3, 5].includes(initialMaxEdits)
        ? String(initialMaxEdits)
        : "custom";

  const [selectedPreset, setSelectedPreset] = useEffectState(initialPreset);
  const [customVal, setCustomVal] = useEffectState(initialMaxEdits ?? 3);
  const [isSaved, setIsSaved] = useEffectState(false);

  useEffect(() => {
    const preset =
      initialMaxEdits === null || initialMaxEdits === 0
        ? "unlimited"
        : [1, 2, 3, 5].includes(initialMaxEdits)
          ? String(initialMaxEdits)
          : "custom";
    setSelectedPreset(preset);
    setCustomVal(initialMaxEdits ?? 3);
  }, [initialMaxEdits]);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data?.type === "maxEdits"
    ) {
      setIsSaved(true);
      if (typeof window !== "undefined" && (window as any).shopify?.toast) {
        (window as any).shopify.toast.show(
          "Maximum order edit limit updated successfully!",
        );
      }
      const timer = setTimeout(() => setIsSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);

  const handleSave = (preset: string, cVal?: number) => {
    let valToSend = preset;
    if (preset === "custom") {
      valToSend = String(cVal ?? customVal);
    }
    fetcher.submit(
      {
        intent: "saveMaxEdits",
        maxEdits: valToSend,
      },
      { method: "post" },
    );
  };

  return (
    <s-section heading="Maximum Order Edits Allowed">
      <s-box
        padding="large"
        border="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="large">
          <s-stack direction="block" gap="small">
            <s-text type="strong">Maximum Allowed Edits Per Order</s-text>
            <s-paragraph color="subdued">
              Set the maximum number of edit actions a customer can perform on a
              single order (e.g. 3 edits max). Once this edit count is reached,
              order editing will be disabled. PDF Invoice downloads will always
              remain available.
            </s-paragraph>
          </s-stack>

          {/* Presets Grid */}
          <s-stack direction="block" gap="small">
            <s-text type="strong">Limit Options</s-text>
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(130px, 1fr))"
              gap="small"
            >
              {MAX_EDITS_PRESETS.map((preset) => {
                const isActive = selectedPreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: isActive
                        ? "2px solid #008060"
                        : "1px solid #c9cccf",
                      backgroundColor: isActive ? "#eaf4f0" : "#ffffff",
                      color: isActive ? "#004c3f" : "#202223",
                      fontWeight: isActive ? "600" : "400",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.15s ease-in-out",
                    }}
                    onClick={() => {
                      setSelectedPreset(preset.value);
                      if (preset.value !== "custom") {
                        handleSave(preset.value);
                      }
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </s-grid>
          </s-stack>

          {/* Custom Edit Count Input */}
          {selectedPreset === "custom" && (
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-text type="strong">Custom Max Edits Limit</s-text>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <s-text color="subdued">Number of Edits Allowed</s-text>
                    <input
                      type="number"
                      min="1"
                      value={customVal}
                      onChange={(e) =>
                        setCustomVal(
                          Math.max(1, parseInt(e.target.value, 10) || 1),
                        )
                      }
                      style={{
                        marginTop: "6px",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #c9cccf",
                        fontSize: "14px",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSave("custom", customVal)}
                    style={{
                      padding: "9px 18px",
                      borderRadius: "6px",
                      border: "none",
                      backgroundColor: "#008060",
                      color: "#ffffff",
                      fontWeight: "600",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      height: "36px",
                      flexShrink: 0,
                    }}
                  >
                    Save Limit
                  </button>
                </div>
              </s-stack>
            </s-box>
          )}

          {isSaved && (
            <s-banner tone="success">
              Maximum order edit limit saved successfully!
            </s-banner>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}

// ─── TimeLimitSection Component ────────────────────────────────────────────

const TIME_LIMIT_PRESETS = [
  { value: "30m", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "2h", label: "2 Hours" },
  { value: "1d", label: "1 Day" },
  { value: "2d", label: "2 Days" },
  { value: "custom", label: "Custom Time" },
] as const;

interface TimeLimitSectionProps {
  initialSettings: {
    timeLimit: string;
    customValue: number;
    customUnit: string;
  };
}

function TimeLimitSection({
  initialSettings,
}: TimeLimitSectionProps): JSX.Element {
  const fetcher = useFetcher();
  const [selectedPreset, setSelectedPreset] = useEffectState(
    initialSettings.timeLimit || "1h",
  );
  const [customVal, setCustomVal] = useEffectState(
    initialSettings.customValue || 1,
  );
  const [customUnitVal, setCustomUnitVal] = useEffectState(
    initialSettings.customUnit || "hours",
  );
  const [isSaved, setIsSaved] = useEffectState(false);

  // Sync state if reloaded
  useEffect(() => {
    setSelectedPreset(initialSettings.timeLimit || "1h");
    setCustomVal(initialSettings.customValue || 1);
    setCustomUnitVal(initialSettings.customUnit || "hours");
  }, [initialSettings]);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data?.type === "timeLimit"
    ) {
      setIsSaved(true);
      if (typeof window !== "undefined" && (window as any).shopify?.toast) {
        (window as any).shopify.toast.show(
          "Order edit time limit updated successfully!",
        );
      }
      const timer = setTimeout(() => setIsSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);

  const handleSave = (preset: string, cVal?: number, cUnit?: string) => {
    fetcher.submit(
      {
        intent: "saveTimeLimit",
        timeLimit: preset,
        customValue: String(cVal ?? customVal),
        customUnit: cUnit ?? customUnitVal,
      },
      { method: "post" },
    );
  };

  return (
    <s-section heading="Order Edit Time Limit">
      <s-box
        padding="large"
        border="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="large">
          <s-stack direction="block" gap="small">
            <s-text type="strong">Maximum Allowed Time for Order Edits</s-text>
            <s-paragraph color="subdued">
              Set how long after placing an order a customer is permitted to
              edit their order. Once this time window expires, editing will be
              disabled.
            </s-paragraph>
          </s-stack>

          {/* Presets Grid */}
          <s-stack direction="block" gap="small">
            <s-text type="strong">Preset Options</s-text>
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(130px, 1fr))"
              gap="small"
            >
              {TIME_LIMIT_PRESETS.map((preset) => {
                const isActive = selectedPreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: isActive
                        ? "2px solid #008060"
                        : "1px solid #c9cccf",
                      backgroundColor: isActive ? "#eaf4f0" : "#ffffff",
                      color: isActive ? "#004c3f" : "#202223",
                      fontWeight: isActive ? "600" : "400",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.15s ease-in-out",
                    }}
                    onClick={() => {
                      setSelectedPreset(preset.value);
                      handleSave(preset.value);
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </s-grid>
          </s-stack>

          {/* Custom Time Form */}
          {selectedPreset === "custom" && (
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-text type="strong">Custom Duration</s-text>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <s-text color="subdued">Duration Value</s-text>
                    <input
                      type="number"
                      min="1"
                      value={customVal}
                      onChange={(e) =>
                        setCustomVal(
                          Math.max(1, parseInt(e.target.value, 10) || 1),
                        )
                      }
                      style={{
                        marginTop: "6px",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #c9cccf",
                        fontSize: "14px",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <s-text color="subdued">Time Unit</s-text>
                    <select
                      value={customUnitVal}
                      onChange={(e) => setCustomUnitVal(e.target.value)}
                      style={{
                        marginTop: "6px",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #c9cccf",
                        fontSize: "14px",
                        width: "100%",
                        boxSizing: "border-box",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleSave("custom", customVal, customUnitVal)
                    }
                    style={{
                      padding: "9px 18px",
                      borderRadius: "6px",
                      border: "none",
                      backgroundColor: "#008060",
                      color: "#ffffff",
                      fontWeight: "600",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      height: "36px",
                      flexShrink: 0,
                    }}
                  >
                    Save Custom Limit
                  </button>
                </div>
              </s-stack>
            </s-box>
          )}

          {isSaved && (
            <s-banner tone="success">
              Time limit settings saved successfully!
            </s-banner>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}

// Helper hook for initial state with sync
function useEffectState(initialValue: any) {
  const [val, setVal] = useState(initialValue);
  return [val, setVal];
}

// ─── ServiceRow — individual toggle row ───────────────────────────────────

interface ServiceRowProps {
  id: string;
  title: string;
  description: string;
  category: string;
  enabled: boolean;
}

function ServiceRow({
  id,
  title,
  description,
  category,
  enabled,
}: ServiceRowProps): JSX.Element {
  const fetcher = useFetcher();
  const switchRef = useRef<any>(null);

  // Optimistic state: if a submission is in-flight, show the pending value
  const optimisticEnabled =
    fetcher.state !== "idle"
      ? fetcher.formData?.get("enabled") === "true"
      : enabled;

  const toggleService = (nextState: boolean): void => {
    console.log(`[ServiceRow] Toggling service ${id} to ${nextState}`);
    fetcher.submit(
      { serviceId: id, enabled: String(nextState) },
      { method: "post" },
    );
  };

  useEffect(() => {
    const el = switchRef.current;
    if (!el) return;

    const handleCustomEvent = (e: Event) => {
      e.stopPropagation();
      const target = e.target as HTMLInputElement & { checked?: boolean };
      const newChecked =
        target.checked !== undefined ? target.checked : !optimisticEnabled;
      toggleService(newChecked);
    };

    el.addEventListener("change", handleCustomEvent);
    return () => {
      el.removeEventListener("change", handleCustomEvent);
    };
  }, [id, optimisticEnabled]);

  return (
    <s-box
      padding="base"
      border="base"
      borderRadius="base"
      background="subdued"
    >
      <s-grid gridTemplateColumns="1fr auto" alignItems="center" gap="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" alignItems="center" gap="base">
            <s-text type="strong">{title}</s-text>
            <s-badge tone={optimisticEnabled ? "success" : "neutral"}>
              {category}
            </s-badge>
          </s-stack>
          <s-paragraph color="subdued">{description}</s-paragraph>
        </s-stack>

        <s-badge tone={optimisticEnabled ? "success" : "neutral"}>
          <SSwitch
            tone={optimisticEnabled ? "success" : "neutral"}
            ref={switchRef}
            label={optimisticEnabled ? "Active" : "Inactive"}
            name={id}
            checked={optimisticEnabled}
            onClick={() => {
              if (fetcher.state === "idle") {
                toggleService(!optimisticEnabled);
              }
            }}
          />
        </s-badge>
      </s-grid>
    </s-box>
  );
}

// ─── GoogleApiKeySection Component ───────────────────────────────────────────

interface GoogleApiKeySectionProps {
  initialApiKey: string;
}

function GoogleApiKeySection({
  initialApiKey,
}: GoogleApiKeySectionProps): JSX.Element {
  const fetcher = useFetcher();
  const [apiKey, setApiKey] = useEffectState(initialApiKey || "");
  const [showKey, setShowKey] = useState(false);
  const [isSaved, setIsSaved] = useEffectState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [lastAction, setLastAction] = useState<"saved" | "deleted" | null>(
    null,
  );

  useEffect(() => {
    setApiKey(initialApiKey || "");
  }, [initialApiKey]);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data?.type === "googleApiKey"
    ) {
      setIsSaved(true);
      const isDeleted = fetcher.data?.action === "deleted";
      setLastAction(isDeleted ? "deleted" : "saved");

      const msg = isDeleted
        ? "Google Places API key deleted successfully!"
        : "Google Places API key saved successfully!";
      setActionMessage(msg);

      if (isDeleted) {
        setApiKey("");
      }

      if (typeof window !== "undefined" && (window as any).shopify?.toast) {
        (window as any).shopify.toast.show(msg);
      }
      const timer = setTimeout(() => {
        setIsSaved(false);
        setLastAction(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "saveGoogleApiKey",
        googleApiKey: apiKey,
      },
      { method: "post" },
    );
  };

  const handleDelete = () => {
    fetcher.submit(
      {
        intent: "deleteGoogleApiKey",
      },
      { method: "post" },
    );
  };

  const isDeleting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "deleteGoogleApiKey";
  const isConfigured = Boolean(
    (apiKey && apiKey.trim().length > 0) || isDeleting,
  );
  const showDeleteButton =
    isConfigured || isDeleting || (isSaved && lastAction === "deleted");

  return (
    <s-section heading="Google Places & Location Suggestions">
      <s-box
        padding="large"
        border="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="large">
          <s-stack direction="block" gap="small">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text type="strong">🔑 Google Places API Key</s-text>
              <s-badge
                tone={
                  isConfigured && !isDeleting && lastAction !== "deleted"
                    ? "success"
                    : "neutral"
                }
              >
                {isConfigured && !isDeleting && lastAction !== "deleted"
                  ? "Active (Autocomplete Enabled)"
                  : "Disabled (No Key)"}
              </s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              Enter your Google Places & Geocoding API Key to enable instant
              location autocomplete and auto-filling address suggestions for
              your store customers. If left blank, the location suggestions
              section will be hidden on storefront address forms.
            </s-paragraph>
          </s-stack>

          <s-box
            padding="base"
            border="base"
            borderRadius="base"
            background="surface"
          >
            <s-stack direction="block" gap="base">
              <s-text type="strong">Merchant API Key</s-text>
              <div
                style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}
              >
                <div style={{ flex: 1, position: "relative" }}>
                  <s-text color="subdued">
                    API Key (Places API & Geocoding API enabled)
                  </s-text>
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="e.g. AIzaSyD..."
                    style={{
                      marginTop: "6px",
                      padding: "8px 40px 8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      fontSize: "14px",
                      width: "100%",
                      boxSizing: "border-box",
                      fontFamily: "monospace",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "28px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "13px",
                      color: "#5c5f62",
                    }}
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  style={{
                    padding: "9px 20px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "#008060",
                    color: "#ffffff",
                    fontWeight: "600",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    height: "36px",
                    flexShrink: 0,
                  }}
                >
                  {fetcher.state !== "idle" &&
                  fetcher.formData?.get("intent") === "saveGoogleApiKey"
                    ? "Saving..."
                    : "Save Key"}
                </button>

                {showDeleteButton && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    style={{
                      padding: "9px 20px",
                      borderRadius: "6px",
                      border: "none",
                      backgroundColor: "#d82c0d",
                      color: "#ffffff",
                      fontWeight: "600",
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      height: "36px",
                      flexShrink: 0,
                      opacity: isDeleting ? 0.7 : 1,
                    }}
                  >
                    {isDeleting ? "Deleting..." : "Delete Key"}
                  </button>
                )}
              </div>
            </s-stack>
          </s-box>

          {isSaved && (
            <s-banner tone={lastAction === "deleted" ? "critical" : "success"}>
              {actionMessage}
            </s-banner>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}

// ─── ProductTagsSection Component ───────────────────────────────────────────

interface ProductItem {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  imageUrl: string;
}

interface ProductTagsSectionProps {
  initialProducts: ProductItem[];
}

function ProductTagsSection({
  initialProducts,
}: ProductTagsSectionProps): JSX.Element {
  const [products, setProducts] = useState<ProductItem[]>(
    initialProducts || [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [newTagsMap, setNewTagsMap] = useState<Record<string, string>>({});
  const [bannerInfo, setBannerInfo] = useState<{
    msg: string;
    tone: "success" | "critical";
  } | null>(null);
  const searchFetcher = useFetcher<any>();
  const tagFetcher = useFetcher<any>();

  useEffect(() => {
    if (
      searchFetcher.state === "idle" &&
      searchFetcher.data?.ok &&
      searchFetcher.data?.type === "searchProducts"
    ) {
      setProducts(searchFetcher.data.products || []);
      setHasSearched(true);
    }
  }, [searchFetcher.state, searchFetcher.data]);

  useEffect(() => {
    if (
      tagFetcher.state === "idle" &&
      tagFetcher.data?.ok &&
      tagFetcher.data?.type === "productTag"
    ) {
      const { action, productId, tag } = tagFetcher.data;
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== productId) return p;
          let updatedTags = [...p.tags];
          if (action === "added" && !updatedTags.includes(tag)) {
            updatedTags.push(tag);
          } else if (action === "removed") {
            updatedTags = updatedTags.filter((t) => t !== tag);
          }
          return { ...p, tags: updatedTags };
        }),
      );
      setBannerInfo({
        msg:
          action === "added"
            ? `Added tag "${tag}" successfully!`
            : `Removed tag "${tag}" successfully!`,
        tone: action === "added" ? "success" : "critical",
      });
      const timer = setTimeout(() => setBannerInfo(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [tagFetcher.state, tagFetcher.data]);

  const handleSearch = (e: any) => {
    e.preventDefault();
    setHasSearched(true);
    searchFetcher.submit(
      { intent: "searchProducts", query: searchQuery },
      { method: "post" },
    );
  };

  const handleAddTag = (productId: string, tagToAdd: string) => {
    if (!tagToAdd || !tagToAdd.trim()) return;
    const cleanTag = tagToAdd.trim();
    tagFetcher.submit(
      { intent: "addProductTag", productId, tag: cleanTag },
      { method: "post" },
    );
    setNewTagsMap((prev) => ({ ...prev, [productId]: "" }));
  };

  const handleRemoveTag = (productId: string, tagToRemove: string) => {
    tagFetcher.submit(
      { intent: "removeProductTag", productId, tag: tagToRemove },
      { method: "post" },
    );
  };

  return (
    <s-section heading="Product Tags & Upsell Management">
      <s-box
        padding="large"
        border="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="large">
          <s-stack direction="block" gap="small">
            <s-text type="strong">
              🏷️ Configure Product Tags for Upsell Recommendations
            </s-text>
            <s-paragraph color="subdued">
              Organize your product catalog by managing product tags. The
              OrderEase Upsell feature automatically pairs items in a customer's
              order tagged with [tag] with recommendation products tagged with
              [tag]-upshell.
            </s-paragraph>
          </s-stack>

          {bannerInfo ? (
            <s-banner tone={bannerInfo.tone}>{bannerInfo.msg}</s-banner>
          ) : null}

          <form
            onSubmit={handleSearch}
            style={{ display: "flex", gap: "10px" }}
          >
            <input
              type="text"
              placeholder="Search products by title or tag..."
              value={searchQuery}
              onChange={(e: any) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #c9cccf",
                fontSize: "14px",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: "#008060",
                color: "#ffffff",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {searchFetcher.state !== "idle"
                ? "Searching..."
                : "Search Products"}
            </button>
          </form>

          <s-stack direction="block" gap="base">
            {searchFetcher.state !== "idle" ? (
              <s-box padding="base" border="base" borderRadius="base">
                <s-paragraph color="subdued">
                  ⏳ Searching products...
                </s-paragraph>
              </s-box>
            ) : !hasSearched ? (
              <s-box padding="base" border="base" borderRadius="base">
                <s-paragraph color="subdued">
                  🔍 Search for a product by title or tag above to view and
                  manage its tags.
                </s-paragraph>
              </s-box>
            ) : products.length === 0 ? (
              <s-box padding="base" border="base" borderRadius="base">
                <s-paragraph color="subdued">
                  No products found. Try adjusting your search query.
                </s-paragraph>
              </s-box>
            ) : (
              products.map((prod) => {
                const currentNewTag = newTagsMap[prod.id] || "";
                return (
                  <s-box
                    key={prod.id}
                    padding="base"
                    border="base"
                    borderRadius="base"
                  >
                    <s-grid
                      gridTemplateColumns="auto 1fr"
                      gap="base"
                      alignItems="start"
                    >
                      <div
                        style={{
                          width: "56px",
                          height: "56px",
                          borderRadius: "8px",
                          overflow: "hidden",
                          backgroundColor: "#f1f2f3",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px solid #e1e3e5",
                        }}
                      >
                        {prod.imageUrl ? (
                          <img
                            src={prod.imageUrl}
                            alt={prod.title}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: "20px" }}>📦</span>
                        )}
                      </div>

                      <s-stack direction="block" gap="small">
                        <s-text type="strong">{prod.title}</s-text>

                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                            alignItems: "center",
                          }}
                        >
                          {prod.tags && prod.tags.length > 0 ? (
                            prod.tags.map((tag) => {
                              const isUpsellTag = tag.endsWith("-upshell");
                              return (
                                <span
                                  key={tag}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "3px 8px",
                                    borderRadius: "12px",
                                    backgroundColor: isUpsellTag
                                      ? "#eaf4f0"
                                      : "#f1f2f3",
                                    color: isUpsellTag ? "#004c3f" : "#202223",
                                    border: isUpsellTag
                                      ? "1px solid #95c9b4"
                                      : "1px solid #c9cccf",
                                    fontSize: "12px",
                                    fontWeight: isUpsellTag ? "600" : "500",
                                  }}
                                >
                                  {isUpsellTag ? `⚡ ${tag}` : tag}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemoveTag(prod.id, tag)
                                    }
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "#5c5f62",
                                      cursor: "pointer",
                                      fontSize: "13px",
                                      padding: "0 2px",
                                      lineHeight: 1,
                                    }}
                                    title={`Remove tag ${tag}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })
                          ) : (
                            <s-text color="subdued">No tags assigned</s-text>
                          )}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginTop: "4px",
                            flexWrap: "wrap",
                          }}
                        >
                          <input
                            type="text"
                            placeholder="Add tag (e.g. Summer or Summer-upshell)..."
                            value={currentNewTag}
                            onChange={(e: any) =>
                              setNewTagsMap((prev) => ({
                                ...prev,
                                [prod.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e: any) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddTag(prod.id, currentNewTag);
                              }
                            }}
                            style={{
                              flex: 1,
                              minWidth: "180px",
                              padding: "6px 10px",
                              borderRadius: "6px",
                              border: "1px solid #c9cccf",
                              fontSize: "13px",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleAddTag(prod.id, currentNewTag)}
                            disabled={!currentNewTag.trim()}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "6px",
                              border: "none",
                              backgroundColor: "#008060",
                              color: "#ffffff",
                              fontSize: "13px",
                              fontWeight: "600",
                              cursor: currentNewTag.trim()
                                ? "pointer"
                                : "not-allowed",
                              opacity: currentNewTag.trim() ? 1 : 0.6,
                            }}
                          >
                            + Tag
                          </button>
                          {currentNewTag.trim() &&
                          !currentNewTag.trim().endsWith("-upshell") ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddTag(
                                  prod.id,
                                  `${currentNewTag.trim()}-upshell`,
                                )
                              }
                              style={{
                                padding: "6px 12px",
                                borderRadius: "6px",
                                border: "1px solid #008060",
                                backgroundColor: "#eaf4f0",
                                color: "#004c3f",
                                fontSize: "13px",
                                fontWeight: "600",
                                cursor: "pointer",
                              }}
                            >
                              + Quick Add {currentNewTag.trim()}-upshell
                            </button>
                          ) : null}
                        </div>
                      </s-stack>
                    </s-grid>
                  </s-box>
                );
              })
            )}
          </s-stack>
        </s-stack>
      </s-box>
    </s-section>
  );
}
