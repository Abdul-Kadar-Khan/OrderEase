var _a;
import { jsx, jsxs } from "react/jsx-runtime";
import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, UNSAFE_withComponentProps, Meta, Links, Outlet, ScrollRestoration, Scripts, useLoaderData, useActionData, Form, redirect, UNSAFE_withErrorBoundaryProps, useRouteError, useFetcher } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import "@shopify/shopify-app-react-router/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion, LoginErrorType, boundary } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}
const prisma = global.prismaGlobal ?? new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: (_a = process.env.SCOPES) == null ? void 0 : _a.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true
  },
  ...process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}
});
ApiVersion.July26;
const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const authenticate = shopify.authenticate;
const unauthenticated = shopify.unauthenticated;
const login = shopify.login;
shopify.registerWebhooks;
shopify.sessionStorage;
const streamTimeout = 5e3;
async function handleRequest(request, responseStatusCode, responseHeaders, reactRouterContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(
        ServerRouter,
        {
          context: reactRouterContext,
          url: request.url
        }
      ),
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        }
      }
    );
    setTimeout(abort, streamTimeout + 1e3);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
const root = UNSAFE_withComponentProps(function App() {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [/* @__PURE__ */ jsxs("head", {
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "utf-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width,initial-scale=1"
      }), /* @__PURE__ */ jsx("link", {
        rel: "preconnect",
        href: "https://cdn.shopify.com/"
      }), /* @__PURE__ */ jsx("link", {
        rel: "stylesheet",
        href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
      }), /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {})]
    }), /* @__PURE__ */ jsxs("body", {
      children: [/* @__PURE__ */ jsx(Outlet, {}), /* @__PURE__ */ jsx(ScrollRestoration, {}), /* @__PURE__ */ jsx(Scripts, {})]
    })]
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: root
}, Symbol.toStringTag, { value: "Module" }));
const TAG_UPDATED = "Order-Updated";
const TAG_REFUND = "Refund";
async function getOrderTags(admin, orderId) {
  var _a2, _b;
  const res = await admin.graphql(
    `#graphql
    query GetOrderTags($id: ID!) {
      order(id: $id) {
        tags
      }
    }`,
    { variables: { id: orderId } }
  );
  const json = await res.json();
  return ((_b = (_a2 = json.data) == null ? void 0 : _a2.order) == null ? void 0 : _b.tags) ?? [];
}
async function addOrderTags(admin, orderId, owesRefund = false) {
  var _a2, _b;
  try {
    const existingTags = await getOrderTags(admin, orderId);
    const existingSet = new Set(existingTags.map((t) => t.toLowerCase()));
    const tagsToAdd = [];
    if (!existingSet.has(TAG_UPDATED.toLowerCase())) {
      tagsToAdd.push(TAG_UPDATED);
    }
    if (owesRefund && !existingSet.has(TAG_REFUND.toLowerCase())) {
      tagsToAdd.push(TAG_REFUND);
    }
    if (tagsToAdd.length === 0) {
      return;
    }
    const mergedTags = [...existingTags, ...tagsToAdd];
    const updateRes = await admin.graphql(
      `#graphql
      mutation AddOrderTags($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            tags
          }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: orderId, tags: mergedTags } } }
    );
    const updateJson = await updateRes.json();
    const errors = ((_b = (_a2 = updateJson.data) == null ? void 0 : _a2.orderUpdate) == null ? void 0 : _b.userErrors) ?? [];
    if (errors.length) {
      console.warn("[orderTagsHelper] Failed to update tags:", errors);
    }
  } catch (err) {
    console.error("[orderTagsHelper] Unexpected error while updating tags:", err);
  }
}
async function trackOrderEdit({
  shop,
  orderId,
  featureId,
  source = "customer_account_ui"
}) {
  try {
    if (!shop || !orderId) return;
    const validSource = source === "checkout_ui" ? "checkout_ui" : "customer_account_ui";
    await prisma.editedOrder.create({
      data: {
        shop,
        orderId,
        source: validSource
      }
    });
    if (featureId) {
      await trackFeatureUsage({ shop, featureId });
    }
  } catch (error) {
    console.error("[analyticsHelper] Error tracking order edit:", error);
  }
}
async function trackFeatureUsage({
  shop,
  featureId
}) {
  try {
    if (!shop || !featureId) return;
    await prisma.featureUsage.upsert({
      where: {
        shop_featureId: { shop, featureId }
      },
      create: {
        shop,
        featureId,
        usedCount: 1
      },
      update: {
        usedCount: { increment: 1 }
      }
    });
  } catch (error) {
    console.error("[analyticsHelper] Error tracking feature usage:", error);
  }
}
async function loader$r({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$o({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    lineItemId,
    quantity,
    source
  } = body || {};
  if (!orderId || !lineItemId || quantity === void 0) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId, lineItemId, or quantity."
      }]
    }, {
      status: 400
    }));
  }
  const calculatedLineItemId = lineItemId.replace("LineItem", "CalculatedLineItem");
  try {
    let actualQuantity = Number(quantity);
    let quantityMessage = null;
    if (actualQuantity > 0) {
      try {
        const lineItemRes = await admin.graphql(`#graphql
          query GetLineItemVariant($id: ID!) {
            order(id: $id) {
              lineItems(first: 100) {
                nodes {
                  id
                  currentQuantity
                  quantity
                  variant {
                    id
                    inventoryQuantity
                  }
                }
              }
            }
          }`, {
          variables: {
            id: orderId
          }
        });
        const lineItemJson = await lineItemRes.json();
        const rawLineItemId = lineItemId.replace("CalculatedLineItem", "LineItem");
        const node = (_d = (_c = (_b = (_a2 = lineItemJson.data) == null ? void 0 : _a2.order) == null ? void 0 : _b.lineItems) == null ? void 0 : _c.nodes) == null ? void 0 : _d.find((n) => n.id === rawLineItemId || n.id === lineItemId);
        const currentQty = (node == null ? void 0 : node.currentQuantity) ?? (node == null ? void 0 : node.quantity) ?? 0;
        const invQty = (_e = node == null ? void 0 : node.variant) == null ? void 0 : _e.inventoryQuantity;
        if (typeof invQty === "number") {
          const maxAllowed = currentQty + invQty;
          if (actualQuantity > maxAllowed) {
            if (invQty <= 0) {
              return cors(Response.json({
                userErrors: [{
                  message: `This product is not available in the required quantity of ${actualQuantity}. No additional stock is available in store (you already have all ${currentQty} units in your order).`
                }]
              }, {
                status: 422
              }));
            }
            return cors(Response.json({
              userErrors: [{
                message: `This product is not available in the required quantity of ${actualQuantity}. Only ${invQty} additional units are available in stock. The quantity has been adjusted to ${maxAllowed}. Click 'Save quantity' again to confirm.`
              }]
            }, {
              status: 422
            }));
          }
        }
      } catch (e) {
        console.warn("Server inventory check skipped:", e);
      }
    }
    const beginResponse = await admin.graphql(`#graphql
      mutation OrderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginResponse.json();
    const beginErrors = ((_g = (_f = beginJson.data) == null ? void 0 : _f.orderEditBegin) == null ? void 0 : _g.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;
    const updateResponse = await admin.graphql(`#graphql
      mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        lineItemId: calculatedLineItemId,
        quantity: actualQuantity,
        restock: true
      }
    });
    const updateJson = await updateResponse.json();
    const updateErrors = ((_i = (_h = updateJson.data) == null ? void 0 : _h.orderEditSetQuantity) == null ? void 0 : _i.userErrors) ?? [];
    if (updateErrors.length) {
      return cors(Response.json({
        userErrors: updateErrors
      }, {
        status: 422
      }));
    }
    const commitResponse = await admin.graphql(`#graphql
      mutation OrderEditCommit($id: ID!) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: "Quantity updated via customer account") {
          order {
            id
            name
            statusPageUrl
            totalOutstandingSet {
              shopMoney { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId
      }
    });
    const commitJson = await commitResponse.json();
    const commitErrors = ((_k = (_j = commitJson.data) == null ? void 0 : _j.orderEditCommit) == null ? void 0 : _k.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    const order = commitJson.data.orderEditCommit.order;
    const balanceDue = ((_l = order == null ? void 0 : order.totalOutstandingSet) == null ? void 0 : _l.shopMoney) ?? null;
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "edit-quantity",
      source
    });
    return cors(Response.json({
      order,
      balanceDue,
      quantityMessage,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-edit] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({
      userErrors: [{
        message
      }]
    }, {
      status: 500
    }));
  }
}
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$o,
  loader: loader$r
}, Symbol.toStringTag, { value: "Module" }));
async function loader$q({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$n({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    oldLineItemId,
    newVariantId,
    quantity,
    source
  } = body || {};
  if (!orderId || !oldLineItemId || !newVariantId || quantity === void 0) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId, oldLineItemId, newVariantId, or quantity."
      }]
    }, {
      status: 400
    }));
  }
  const calculatedLineItemId = oldLineItemId.replace("LineItem", "CalculatedLineItem");
  try {
    let actualQuantity = Number(quantity);
    let quantityMessage = null;
    try {
      const variantRes = await admin.graphql(`#graphql
        query GetVariantStock($id: ID!) {
          productVariant(id: $id) {
            id
            inventoryQuantity
          }
        }`, {
        variables: {
          id: newVariantId
        }
      });
      const variantJson = await variantRes.json();
      const invQty = (_b = (_a2 = variantJson.data) == null ? void 0 : _a2.productVariant) == null ? void 0 : _b.inventoryQuantity;
      if (typeof invQty === "number") {
        if (invQty <= 0) {
          return cors(Response.json({
            userErrors: [{
              message: "Selected replacement variant is out of stock."
            }]
          }, {
            status: 422
          }));
        }
        if (actualQuantity > invQty) {
          quantityMessage = `Only ${invQty} quantity available in stock. Swapped with ${invQty} quantity instead of ${actualQuantity}.`;
          actualQuantity = invQty;
        }
      }
    } catch (e) {
      console.warn("Server inventory check skipped:", e);
    }
    const beginResponse = await admin.graphql(`#graphql
      mutation OrderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginResponse.json();
    if ((_e = (_d = (_c = beginJson.data) == null ? void 0 : _c.orderEditBegin) == null ? void 0 : _d.userErrors) == null ? void 0 : _e.length) {
      return cors(Response.json({
        userErrors: beginJson.data.orderEditBegin.userErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;
    const removeResponse = await admin.graphql(`#graphql
      mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        lineItemId: calculatedLineItemId,
        quantity: 0,
        restock: true
      }
    });
    const removeJson = await removeResponse.json();
    if ((_h = (_g = (_f = removeJson.data) == null ? void 0 : _f.orderEditSetQuantity) == null ? void 0 : _g.userErrors) == null ? void 0 : _h.length) {
      return cors(Response.json({
        userErrors: removeJson.data.orderEditSetQuantity.userErrors
      }, {
        status: 422
      }));
    }
    const addResponse = await admin.graphql(`#graphql
      mutation OrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        variantId: newVariantId,
        quantity: actualQuantity
      }
    });
    const addJson = await addResponse.json();
    if ((_k = (_j = (_i = addJson.data) == null ? void 0 : _i.orderEditAddVariant) == null ? void 0 : _j.userErrors) == null ? void 0 : _k.length) {
      return cors(Response.json({
        userErrors: addJson.data.orderEditAddVariant.userErrors
      }, {
        status: 422
      }));
    }
    const commitResponse = await admin.graphql(`#graphql
      mutation OrderEditCommit($id: ID!) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: "Variant changed via customer account") {
          order {
            id
            name
            statusPageUrl
            totalOutstandingSet {
              shopMoney { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId
      }
    });
    const commitJson = await commitResponse.json();
    if ((_n = (_m = (_l = commitJson.data) == null ? void 0 : _l.orderEditCommit) == null ? void 0 : _m.userErrors) == null ? void 0 : _n.length) {
      return cors(Response.json({
        userErrors: commitJson.data.orderEditCommit.userErrors
      }, {
        status: 422
      }));
    }
    const order = commitJson.data.orderEditCommit.order;
    const balanceDue = ((_o = order == null ? void 0 : order.totalOutstandingSet) == null ? void 0 : _o.shopMoney) ?? null;
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "swap-variant",
      source
    });
    return cors(Response.json({
      order,
      balanceDue,
      quantityMessage,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-edit] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$n,
  loader: loader$q
}, Symbol.toStringTag, { value: "Module" }));
async function loader$p({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true,
    message: "Customer Account GET working!"
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$m({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    variantId,
    quantity,
    source
  } = body || {};
  if (!orderId || !variantId || !quantity) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId, variantId, or quantity."
      }]
    }, {
      status: 400
    }));
  }
  try {
    let actualQuantity = Number(quantity);
    let quantityMessage = null;
    try {
      const variantRes = await admin.graphql(`#graphql
        query GetVariantStock($id: ID!) {
          productVariant(id: $id) {
            id
            inventoryQuantity
          }
        }`, {
        variables: {
          id: variantId
        }
      });
      const variantJson = await variantRes.json();
      const invQty = (_b = (_a2 = variantJson.data) == null ? void 0 : _a2.productVariant) == null ? void 0 : _b.inventoryQuantity;
      if (typeof invQty === "number") {
        if (invQty <= 0) {
          return cors(Response.json({
            userErrors: [{
              message: "Product is currently out of stock."
            }]
          }, {
            status: 422
          }));
        }
        if (actualQuantity > invQty) {
          quantityMessage = `Only ${invQty} quantity available in stock. Added ${invQty} quantity to your order instead of ${actualQuantity}.`;
          actualQuantity = invQty;
        }
      }
    } catch (e) {
      console.warn("Server inventory check skipped:", e);
    }
    const beginResponse = await admin.graphql(`#graphql
      mutation OrderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginResponse.json();
    const beginErrors = ((_d = (_c = beginJson.data) == null ? void 0 : _c.orderEditBegin) == null ? void 0 : _d.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;
    const addResponse = await admin.graphql(`#graphql
      mutation OrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedOrder {
            addedLineItems(first: 1) { nodes { id quantity } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        variantId,
        quantity: actualQuantity
      }
    });
    const addJson = await addResponse.json();
    const addErrors = ((_f = (_e = addJson.data) == null ? void 0 : _e.orderEditAddVariant) == null ? void 0 : _f.userErrors) ?? [];
    if (addErrors.length) {
      return cors(Response.json({
        userErrors: addErrors
      }, {
        status: 422
      }));
    }
    const commitResponse = await admin.graphql(`#graphql
      mutation OrderEditCommit($id: ID!) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: "Product added via customer account") {
          order {
            id
            name
            statusPageUrl
            totalOutstandingSet {
              shopMoney { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId
      }
    });
    const commitJson = await commitResponse.json();
    const commitErrors = ((_h = (_g = commitJson.data) == null ? void 0 : _g.orderEditCommit) == null ? void 0 : _h.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    const order = commitJson.data.orderEditCommit.order;
    const balanceDue = ((_i = order == null ? void 0 : order.totalOutstandingSet) == null ? void 0 : _i.shopMoney) ?? null;
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "add-product",
      source
    });
    return cors(Response.json({
      order,
      balanceDue,
      quantityMessage,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-edit] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({
      userErrors: [{
        message
      }]
    }, {
      status: 500
    }));
  }
}
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$m,
  loader: loader$p
}, Symbol.toStringTag, { value: "Module" }));
const action$l = async ({
  request
}) => {
  const {
    payload,
    session,
    topic,
    shop
  } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;
  if (session) {
    await prisma.session.update({
      where: {
        id: session.id
      },
      data: {
        scope: current.toString()
      }
    });
  }
  return new Response();
};
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$l
}, Symbol.toStringTag, { value: "Module" }));
const GET_ORDER_DETAILS_QUERY = `#graphql
  query GetOrderLineItems($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      currencyCode
      currentSubtotalPriceSet {
        shopMoney { amount currencyCode }
      }
      currentTotalPriceSet {
        shopMoney { amount currencyCode }
      }
      lineItems(first: 100) {
        edges {
          node {
            id
            name
            title
            variantTitle
            currentQuantity
            quantity
            originalUnitPriceSet {
              shopMoney { amount currencyCode }
            }
            image {
              url
              altText
            }
            variant {
              id
              title
              product {
                id
                title
                vendor
              }
              selectedOptions {
                name
                value
              }
              media(first: 1) {
                edges {
                  node {
                    ... on MediaImage {
                      image { url altText }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
async function loader$o({
  request
}) {
  var _a2, _b, _c, _d, _e;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return cors(Response.json({
      error: "Missing orderId"
    }, {
      status: 400
    }));
  }
  try {
    const response = await admin.graphql(GET_ORDER_DETAILS_QUERY, {
      variables: {
        id: orderId
      }
    });
    const json = await response.json();
    if ((_a2 = json.errors) == null ? void 0 : _a2.length) {
      return cors(Response.json({
        error: json.errors[0].message
      }, {
        status: 400
      }));
    }
    const rawEdges = ((_d = (_c = (_b = json.data) == null ? void 0 : _b.order) == null ? void 0 : _c.lineItems) == null ? void 0 : _d.edges) ?? [];
    const lineItems = rawEdges.filter((edge) => edge.node && edge.node.currentQuantity > 0).map((edge) => {
      var _a3, _b2, _c2, _d2, _e2, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
      const node = edge.node;
      const unitPrice = Number(((_b2 = (_a3 = node.originalUnitPriceSet) == null ? void 0 : _a3.shopMoney) == null ? void 0 : _b2.amount) || 0);
      const currencyCode = ((_d2 = (_c2 = node.originalUnitPriceSet) == null ? void 0 : _c2.shopMoney) == null ? void 0 : _d2.currencyCode) || "USD";
      const totalAmount = {
        amount: (unitPrice * node.currentQuantity).toFixed(2),
        currencyCode
      };
      const image = node.image || ((_i = (_h = (_g = (_f = (_e2 = node.variant) == null ? void 0 : _e2.media) == null ? void 0 : _f.edges) == null ? void 0 : _g[0]) == null ? void 0 : _h.node) == null ? void 0 : _i.image) || null;
      const selectedOptions = ((_j = node.variant) == null ? void 0 : _j.selectedOptions) || [];
      const merchandise = {
        id: ((_k = node.variant) == null ? void 0 : _k.id) || "",
        title: node.title || node.name || "",
        image,
        selectedOptions,
        product: {
          id: ((_m = (_l = node.variant) == null ? void 0 : _l.product) == null ? void 0 : _m.id) || "",
          title: ((_o = (_n = node.variant) == null ? void 0 : _n.product) == null ? void 0 : _o.title) || node.title || node.name || "",
          vendor: ((_q = (_p = node.variant) == null ? void 0 : _p.product) == null ? void 0 : _q.vendor) || ""
        }
      };
      const cost = {
        totalAmount
      };
      return {
        id: node.id,
        name: node.name,
        title: node.title || node.name,
        variantTitle: node.variantTitle,
        currentQuantity: node.currentQuantity,
        quantity: node.currentQuantity,
        image,
        selectedOptions,
        price: totalAmount,
        cost,
        merchandise
      };
    });
    return cors(Response.json({
      order: ((_e = json.data) == null ? void 0 : _e.order) ?? null,
      lineItems
    }));
  } catch (err) {
    console.error("[get-order] Unexpected error:", err);
    return cors(Response.json({
      error: "Internal error"
    }, {
      status: 500
    }));
  }
}
async function action$k({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  return cors(Response.json({
    error: "Method not allowed"
  }, {
    status: 405
  }));
}
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$k,
  loader: loader$o
}, Symbol.toStringTag, { value: "Module" }));
const action$j = async ({
  request
}) => {
  const {
    shop,
    session,
    topic
  } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (session) {
    await prisma.session.deleteMany({
      where: {
        shop
      }
    });
  }
  return new Response();
};
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$j
}, Symbol.toStringTag, { value: "Module" }));
const ORDER_TAGS_QUERY = `#graphql
  query GetOrderLineItemTags($id: ID!) {
    order(id: $id) {
      lineItems(first: 50) {
        edges {
          node {
            currentQuantity
            product {
              tags
            }
          }
        }
      }
    }
  }
`;
async function loader$n({
  request
}) {
  var _a2, _b, _c, _d, _e;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return cors(Response.json({
      error: "orderId is required"
    }, {
      status: 400
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  try {
    const response = await admin.graphql(ORDER_TAGS_QUERY, {
      variables: {
        id: orderId
      }
    });
    const json = await response.json();
    if ((_a2 = json.errors) == null ? void 0 : _a2.length) {
      return cors(Response.json({
        error: json.errors[0].message
      }, {
        status: 400
      }));
    }
    const edges = ((_d = (_c = (_b = json.data) == null ? void 0 : _b.order) == null ? void 0 : _c.lineItems) == null ? void 0 : _d.edges) ?? [];
    const upsellTags = /* @__PURE__ */ new Set();
    for (const {
      node
    } of edges) {
      if (node.currentQuantity > 0 && ((_e = node.product) == null ? void 0 : _e.tags)) {
        for (const tag of node.product.tags) {
          upsellTags.add(`${tag}-ex`);
        }
      }
    }
    return cors(Response.json({
      tags: Array.from(upsellTags)
    }));
  } catch (err) {
    console.error("[upsell-tags] Unexpected error:", err);
    return cors(Response.json({
      error: "Internal error"
    }, {
      status: 500
    }));
  }
}
async function action$i({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  return cors(Response.json({
    error: "Method not allowed"
  }, {
    status: 405
  }));
}
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$i,
  loader: loader$n
}, Symbol.toStringTag, { value: "Module" }));
async function loader$m({
  request
}) {
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const rows = await prisma.serviceSettings.findMany({
    where: {
      shop: storeDomain
    },
    select: {
      id: true,
      enabled: true
    }
  });
  const timeLimitRecord = await prisma.orderEditTimeLimit.findUnique({
    where: {
      shop: storeDomain
    }
  });
  const settings = {};
  for (const row of rows) {
    settings[row.id] = row.enabled;
  }
  return cors(Response.json({
    settings,
    timeLimit: timeLimitRecord ? {
      preset: timeLimitRecord.timeLimit,
      customValue: timeLimitRecord.customValue,
      customUnit: timeLimitRecord.customUnit
    } : {
      preset: "1h",
      customValue: 1,
      customUnit: "hours"
    }
  }));
}
async function action$h({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  return cors(Response.json({
    error: "Method not allowed"
  }, {
    status: 405
  }));
}
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$h,
  loader: loader$m
}, Symbol.toStringTag, { value: "Module" }));
const TAG_PREFIX$3 = "@d2:";
const CHECKOUT_ORIGIN_TYPENAMES = /* @__PURE__ */ new Set(["DiscountCodeApplication", "AutomaticDiscountApplication", "ScriptDiscountApplication"]);
const APP_ORIGIN_TYPENAME$3 = "ManualDiscountApplication";
function decodeTag$3(description) {
  if (!description || !description.startsWith(TAG_PREFIX$3)) return null;
  const rest = description.slice(TAG_PREFIX$3.length);
  const closeIdx = rest.indexOf("}");
  if (closeIdx === -1) return null;
  const raw = rest.slice(0, closeIdx + 1);
  const label2 = rest.slice(closeIdx + 1).trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      checkoutAmount: parsed.c ?? 0,
      productAmount: parsed.p ?? 0,
      orderAmount: parsed.o ?? 0,
      label: label2
    };
  } catch {
    return null;
  }
}
function encodeTag$3(tag) {
  const raw = JSON.stringify({
    c: round2$3(tag.checkoutAmount),
    p: round2$3(tag.productAmount),
    o: round2$3(tag.orderAmount)
  });
  return `${TAG_PREFIX$3}${raw} ${tag.label}`.trim();
}
function round2$3(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function readLineItemDiscountState$3(item) {
  var _a2, _b, _c, _d, _e, _f;
  const allocations = item.calculatedDiscountAllocations ?? [];
  const currencyCode = ((_b = (_a2 = item.originalUnitPriceSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.currencyCode) ?? "";
  if (allocations.length === 0) {
    return {
      currencyCode,
      existingApplicationId: null,
      isCheckoutOrigin: false,
      tag: {
        checkoutAmount: 0,
        productAmount: 0,
        orderAmount: 0,
        label: ""
      }
    };
  }
  let existingApplicationId = null;
  let isCheckoutOrigin = false;
  let tag = {
    checkoutAmount: 0,
    productAmount: 0,
    orderAmount: 0,
    label: ""
  };
  let resolvedCurrency = currencyCode;
  for (const allocation of allocations) {
    const app2 = allocation.discountApplication;
    if (!app2) continue;
    existingApplicationId = app2.id;
    const allocatedAmount = parseFloat(((_d = (_c = allocation.allocatedAmountSet) == null ? void 0 : _c.shopMoney) == null ? void 0 : _d.amount) ?? "0");
    if ((_f = (_e = allocation.allocatedAmountSet) == null ? void 0 : _e.shopMoney) == null ? void 0 : _f.currencyCode) {
      resolvedCurrency = allocation.allocatedAmountSet.shopMoney.currencyCode;
    }
    if (app2.__typename === APP_ORIGIN_TYPENAME$3) {
      const decoded = decodeTag$3(app2.description);
      if (decoded) {
        tag = decoded;
      } else {
        tag = {
          checkoutAmount: 0,
          productAmount: allocatedAmount,
          orderAmount: 0,
          label: app2.description ?? ""
        };
      }
    } else if (CHECKOUT_ORIGIN_TYPENAMES.has(app2.__typename)) {
      isCheckoutOrigin = true;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: 0,
        orderAmount: 0,
        label: app2.description ?? "Checkout discount"
      };
    }
  }
  return {
    currencyCode: resolvedCurrency,
    existingApplicationId,
    isCheckoutOrigin,
    tag
  };
}
async function resolveDiscountCode$3(admin, code) {
  var _a2, _b, _c;
  const res = await admin.graphql(`#graphql
    query LookupDiscountCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            status
            title
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
          }
        }
      }
    }`, {
    variables: {
      code: code.trim().toUpperCase()
    }
  });
  const json = await res.json();
  const node = (_a2 = json.data) == null ? void 0 : _a2.codeDiscountNodeByCode;
  if (!node) {
    return {
      ok: false,
      message: `Discount code "${code}" was not found.`
    };
  }
  const codeDiscount = node.codeDiscount;
  if ((codeDiscount == null ? void 0 : codeDiscount.__typename) !== "DiscountCodeBasic") {
    return {
      ok: false,
      message: `Discount code "${code}" is not a supported type.`
    };
  }
  if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
    return {
      ok: false,
      message: `Discount code "${code}" is ${String(codeDiscount.status).toLowerCase()}.`
    };
  }
  const value = (_b = codeDiscount.customerGets) == null ? void 0 : _b.value;
  const label2 = codeDiscount.title || code.trim().toUpperCase();
  if ((value == null ? void 0 : value.percentage) != null) {
    return {
      ok: true,
      kind: "percentage",
      percentage: value.percentage * 100,
      label: label2
    };
  }
  if ((_c = value == null ? void 0 : value.amount) == null ? void 0 : _c.amount) {
    return {
      ok: true,
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode,
      label: label2
    };
  }
  return {
    ok: false,
    message: `Discount code "${code}" does not have a supported percentage or fixed value.`
  };
}
function discountAmountAgainst$3(resolved, base) {
  if (resolved.kind === "percentage") {
    return Math.max(base * (resolved.percentage / 100), 0);
  }
  return Math.min(Math.max(parseFloat(resolved.amount) || 0, 0), base);
}
async function loader$l({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$g({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode,
    variantId
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  const isProductLevel = typeof variantId === "string" && variantId.length > 0;
  try {
    const resolved = await resolveDiscountCode$3(admin, discountCode);
    if (!resolved.ok) {
      return cors(Response.json({
        userErrors: [{
          message: resolved.message
        }]
      }, {
        status: 422
      }));
    }
    const beginRes = await admin.graphql(`#graphql
      mutation BeginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 100) {
              nodes {
                id
                quantity
                variant { id }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    description
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_b = (_a2 = beginJson.data) == null ? void 0 : _a2.orderEditBegin) == null ? void 0 : _b.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const allLineItems = ((_c = calculatedOrder.lineItems) == null ? void 0 : _c.nodes) ?? [];
    if (allLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    const targetLineItems = isProductLevel ? allLineItems.filter((item) => {
      var _a3;
      return ((_a3 = item.variant) == null ? void 0 : _a3.id) === variantId;
    }) : allLineItems;
    if (isProductLevel && targetLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "That product could not be found on this order."
        }]
      }, {
        status: 422
      }));
    }
    const warnings = [];
    const skippedApplicationIds = [];
    let appliedCount = 0;
    for (const item of targetLineItems) {
      const state = readLineItemDiscountState$3(item);
      const originalUnit = parseFloat(((_e = (_d = item.originalUnitPriceSet) == null ? void 0 : _d.shopMoney) == null ? void 0 : _e.amount) ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const currencyCode = state.currencyCode || ((_g = (_f = item.originalUnitPriceSet) == null ? void 0 : _f.shopMoney) == null ? void 0 : _g.currencyCode) || "USD";
      if (isProductLevel) {
        if (state.isCheckoutOrigin) {
          warnings.push("This product already has a discount applied during checkout. Checkout discounts cannot be modified.");
          continue;
        }
        const newProductAmount = discountAmountAgainst$3(resolved.kind === "percentage" ? {
          kind: "percentage",
          percentage: resolved.percentage
        } : {
          kind: "fixed",
          amount: resolved.amount
        }, originalLineTotal);
        if (state.tag.productAmount > 0 && newProductAmount <= state.tag.productAmount) {
          warnings.push(`The existing product discount on this item is already greater than or equal to "${discountCode}". It was not replaced.`);
          continue;
        }
        if (state.existingApplicationId) {
          skippedApplicationIds.push(state.existingApplicationId);
          const removeRes = await admin.graphql(`#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`, {
            variables: {
              id: calculatedOrderId,
              discountApplicationId: state.existingApplicationId
            }
          });
          const removeJson = await removeRes.json();
          const removeErrors = ((_i = (_h = removeJson.data) == null ? void 0 : _h.orderEditRemoveDiscount) == null ? void 0 : _i.userErrors) ?? [];
          if (((_j = removeJson.errors) == null ? void 0 : _j.length) || removeErrors.length) {
            warnings.push(`Could not update the discount on this product: ${((_k = removeErrors[0]) == null ? void 0 : _k.message) ?? "unknown error"}.`);
            continue;
          }
        }
        const newTag = {
          checkoutAmount: 0,
          productAmount: newProductAmount,
          orderAmount: state.tag.orderAmount,
          label: resolved.label
        };
        const combinedAmount = newProductAmount + state.tag.orderAmount;
        const applyRes = await admin.graphql(`#graphql
          mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
            orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
              calculatedLineItem { id }
              userErrors { field message }
            }
          }`, {
          variables: {
            id: calculatedOrderId,
            lineItemId: item.id,
            discount: {
              fixedValue: {
                amount: combinedAmount.toFixed(2),
                currencyCode
              },
              description: encodeTag$3(newTag)
            }
          }
        });
        const applyJson = await applyRes.json();
        const applyErrors = ((_m = (_l = applyJson.data) == null ? void 0 : _l.orderEditAddLineItemDiscount) == null ? void 0 : _m.userErrors) ?? [];
        if (((_n = applyJson.errors) == null ? void 0 : _n.length) || applyErrors.length) {
          warnings.push(`Could not apply the product discount: ${((_p = (_o = applyJson.errors) == null ? void 0 : _o[0]) == null ? void 0 : _p.message) ?? ((_q = applyErrors[0]) == null ? void 0 : _q.message) ?? "unknown error"}.`);
          continue;
        }
        appliedCount += 1;
      } else {
        const baseAfterProductLevel = Math.max(originalLineTotal - state.tag.checkoutAmount - state.tag.productAmount, 0);
        const additionalOrderAmount = discountAmountAgainst$3(resolved.kind === "percentage" ? {
          kind: "percentage",
          percentage: resolved.percentage
        } : {
          kind: "fixed",
          amount: resolved.amount
        }, baseAfterProductLevel);
        if (additionalOrderAmount <= 0) {
          continue;
        }
        const newOrderAmount = state.tag.orderAmount + additionalOrderAmount;
        const newTag = {
          checkoutAmount: state.tag.checkoutAmount,
          productAmount: state.tag.productAmount,
          orderAmount: newOrderAmount,
          label: state.tag.label ? `${state.tag.label} + ${resolved.label}` : resolved.label
        };
        const combinedAmount = state.tag.checkoutAmount + state.tag.productAmount + newOrderAmount;
        if (state.existingApplicationId) {
          skippedApplicationIds.push(state.existingApplicationId);
          const removeRes = await admin.graphql(`#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`, {
            variables: {
              id: calculatedOrderId,
              discountApplicationId: state.existingApplicationId
            }
          });
          const removeJson = await removeRes.json();
          const removeErrors = ((_s = (_r = removeJson.data) == null ? void 0 : _r.orderEditRemoveDiscount) == null ? void 0 : _s.userErrors) ?? [];
          if (((_t = removeJson.errors) == null ? void 0 : _t.length) || removeErrors.length) {
            warnings.push(`Could not update the order discount on one item: ${((_u = removeErrors[0]) == null ? void 0 : _u.message) ?? "unknown error"}.`);
            continue;
          }
        }
        const applyRes = await admin.graphql(`#graphql
          mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
            orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
              calculatedLineItem { id }
              userErrors { field message }
            }
          }`, {
          variables: {
            id: calculatedOrderId,
            lineItemId: item.id,
            discount: {
              fixedValue: {
                amount: combinedAmount.toFixed(2),
                currencyCode
              },
              description: encodeTag$3(newTag)
            }
          }
        });
        const applyJson = await applyRes.json();
        const applyErrors = ((_w = (_v = applyJson.data) == null ? void 0 : _v.orderEditAddLineItemDiscount) == null ? void 0 : _w.userErrors) ?? [];
        if (((_x = applyJson.errors) == null ? void 0 : _x.length) || applyErrors.length) {
          warnings.push(`Could not apply the order discount to one item: ${((_z = (_y = applyJson.errors) == null ? void 0 : _y[0]) == null ? void 0 : _z.message) ?? ((_A = applyErrors[0]) == null ? void 0 : _A.message) ?? "unknown error"}.`);
          continue;
        }
        appliedCount += 1;
      }
    }
    if (appliedCount === 0) {
      return cors(Response.json({
        success: false,
        applied: false,
        warnings: warnings.length ? warnings : ["Nothing was eligible to be discounted."],
        userErrors: []
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation CommitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: isProductLevel ? `Product discount "${discountCode}" applied via customer account` : `Order discount "${discountCode}" applied via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_C = (_B = commitJson.data) == null ? void 0 : _B.orderEditCommit) == null ? void 0 : _C.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    return cors(Response.json({
      success: true,
      applied: true,
      order: commitJson.data.orderEditCommit.order,
      appliedCount,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount2] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({
      userErrors: [{
        message
      }]
    }, {
      status: 500
    }));
  }
}
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$g,
  loader: loader$l
}, Symbol.toStringTag, { value: "Module" }));
function isOrderLevelApplication$2(app2) {
  return !!app2 && app2.targetSelection === "ALL";
}
function isProductLevelApplication$2(app2) {
  return !!app2 && app2.targetSelection != null && app2.targetSelection !== "ALL";
}
function money$2(amount) {
  return Math.max(amount, 0).toFixed(2);
}
async function loader$k({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$f({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode,
    variantIds
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  const requestedVariantIds = Array.isArray(variantIds) && variantIds.length > 0 ? variantIds : null;
  const normalizedCode = String(discountCode).trim().toUpperCase();
  try {
    let hasCheckoutProductLevelDiscount = function(item) {
      return (item.calculatedDiscountAllocations ?? []).some((a) => isProductLevelApplication$2(a.discountApplication));
    };
    const codeRes = await admin.graphql(`#graphql
      query lookupDiscountCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              status
              shortSummary
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount currencyCode } }
                }
                items {
                  __typename
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts {
                    products(first: 250) { nodes { id } }
                    productVariants(first: 250) { nodes { id } }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) { nodes { id } }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy { status }
            ... on DiscountCodeFreeShipping { status }
          }
        }
      }`, {
      variables: {
        code: normalizedCode
      }
    });
    const codeJson = await codeRes.json();
    const codeDiscount = (_b = (_a2 = codeJson.data) == null ? void 0 : _a2.codeDiscountNodeByCode) == null ? void 0 : _b.codeDiscount;
    if (!codeDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" was not found.`
        }]
      }, {
        status: 404
      }));
    }
    if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" is ${String(codeDiscount.status).toLowerCase()}.`
        }]
      }, {
        status: 422
      }));
    }
    if (codeDiscount.__typename !== "DiscountCodeBasic") {
      return cors(Response.json({
        userErrors: [{
          message: "Only percentage and fixed-amount discount codes are supported."
        }]
      }, {
        status: 422
      }));
    }
    const value = (_c = codeDiscount.customerGets) == null ? void 0 : _c.value;
    const percentValue = (value == null ? void 0 : value.percentage) != null ? value.percentage * 100 : null;
    const fixedValue = ((_d = value == null ? void 0 : value.amount) == null ? void 0 : _d.amount) ? {
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode
    } : null;
    if (percentValue == null && fixedValue == null) {
      return cors(Response.json({
        userErrors: [{
          message: "This discount has no usable percentage or fixed amount."
        }]
      }, {
        status: 422
      }));
    }
    const items = (_e = codeDiscount.customerGets) == null ? void 0 : _e.items;
    const isOrderLevelCode = !items || items.__typename === "AllDiscountItems";
    let eligibleProductIds = /* @__PURE__ */ new Set();
    let eligibleVariantIds = /* @__PURE__ */ new Set();
    if (!isOrderLevelCode) {
      if ((items == null ? void 0 : items.__typename) === "DiscountProducts") {
        eligibleProductIds = new Set((((_f = items.products) == null ? void 0 : _f.nodes) ?? []).map((p) => p.id));
        eligibleVariantIds = new Set((((_g = items.productVariants) == null ? void 0 : _g.nodes) ?? []).map((v) => v.id));
      } else if ((items == null ? void 0 : items.__typename) === "DiscountCollections") {
        const collectionIds = (((_h = items.collections) == null ? void 0 : _h.nodes) ?? []).map((c) => c.id);
        for (const collectionId of collectionIds) {
          const collRes = await admin.graphql(`#graphql
            query collectionProducts($id: ID!) {
              collection(id: $id) {
                products(first: 250) { nodes { id } }
              }
            }`, {
            variables: {
              id: collectionId
            }
          });
          const collJson = await collRes.json();
          for (const p of ((_k = (_j = (_i = collJson.data) == null ? void 0 : _i.collection) == null ? void 0 : _j.products) == null ? void 0 : _k.nodes) ?? []) {
            eligibleProductIds.add(p.id);
          }
        }
      }
    }
    const beginRes = await admin.graphql(`#graphql
      mutation beginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 50) {
              nodes {
                id
                quantity
                variant { id product { id title } }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    __typename
                    targetSelection
                    targetType
                    allocationMethod
                    value {
                      ... on PricingPercentageValue { percentage }
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_m = (_l = beginJson.data) == null ? void 0 : _l.orderEditBegin) == null ? void 0 : _m.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;
    const lineItems = ((_n = beginJson.data.orderEditBegin.calculatedOrder.lineItems) == null ? void 0 : _n.nodes) ?? [];
    if (lineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    let checkoutOrderLevelApp = null;
    const checkoutOrderLevelAmountByLineItem = /* @__PURE__ */ new Map();
    for (const item of lineItems) {
      for (const alloc of item.calculatedDiscountAllocations ?? []) {
        if (isOrderLevelApplication$2(alloc.discountApplication)) {
          checkoutOrderLevelApp = alloc.discountApplication;
          checkoutOrderLevelAmountByLineItem.set(item.id, parseFloat(((_p = (_o = alloc.allocatedAmountSet) == null ? void 0 : _o.shopMoney) == null ? void 0 : _p.amount) ?? "0") || 0);
        }
      }
    }
    const hasCheckoutOrderLevelDiscount = checkoutOrderLevelApp !== null;
    const applyResults = [];
    const warnings = [];
    let currencyCode = (fixedValue == null ? void 0 : fixedValue.currencyCode) ?? ((_s = (_r = (_q = lineItems[0]) == null ? void 0 : _q.originalUnitPriceSet) == null ? void 0 : _r.shopMoney) == null ? void 0 : _s.currencyCode) ?? "USD";
    if (isOrderLevelCode) {
      if (hasCheckoutOrderLevelDiscount) {
        return cors(Response.json({
          userErrors: [{
            message: "This order already has an order-level discount applied at checkout. Another order-level discount code cannot be applied."
          }]
        }, {
          status: 422
        }));
      }
      for (const item of lineItems) {
        const unitPrice = parseFloat(((_u = (_t = item.originalUnitPriceSet) == null ? void 0 : _t.shopMoney) == null ? void 0 : _u.amount) ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;
        let discountAmount = 0;
        if (percentValue != null) {
          discountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          const orderTotal = lineItems.reduce((sum, li) => {
            var _a3, _b2;
            return sum + (parseFloat(((_b2 = (_a3 = li.originalUnitPriceSet) == null ? void 0 : _a3.shopMoney) == null ? void 0 : _b2.amount) ?? "0") || 0) * li.quantity;
          }, 0);
          const share = orderTotal > 0 ? lineTotal / orderTotal : 0;
          discountAmount = Math.min(parseFloat(fixedValue.amount) * share, lineTotal);
        }
        if (discountAmount <= 0) continue;
        applyResults.push({
          lineItemId: item.id,
          discount: {
            fixedValue: {
              amount: money$2(discountAmount),
              currencyCode
            },
            description: codeDiscount.shortSummary || normalizedCode
          }
        });
      }
      if (applyResults.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: "Could not apply the order-level discount to any line item."
          }]
        }, {
          status: 422
        }));
      }
    } else {
      const requestedVariantSet = requestedVariantIds ? new Set(requestedVariantIds) : null;
      const candidateItems = lineItems.filter((item) => {
        var _a3, _b2, _c2;
        const variantId = (_a3 = item.variant) == null ? void 0 : _a3.id;
        const productId = (_c2 = (_b2 = item.variant) == null ? void 0 : _b2.product) == null ? void 0 : _c2.id;
        const matchesEligibility = variantId && eligibleVariantIds.has(variantId) || productId && eligibleProductIds.has(productId);
        if (!matchesEligibility) return false;
        if (requestedVariantSet) return !!variantId && requestedVariantSet.has(variantId);
        return true;
      });
      if (candidateItems.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: `Discount code "${discountCode}" is not valid for the selected product(s).`
          }]
        }, {
          status: 422
        }));
      }
      for (const item of candidateItems) {
        const productTitle = ((_w = (_v = item.variant) == null ? void 0 : _v.product) == null ? void 0 : _w.title) ?? "This product";
        if (hasCheckoutProductLevelDiscount(item)) {
          warnings.push(`${productTitle} already has a product-level discount from checkout — the new discount was not applied to it.`);
          continue;
        }
        const unitPrice = parseFloat(((_y = (_x = item.originalUnitPriceSet) == null ? void 0 : _x.shopMoney) == null ? void 0 : _y.amount) ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;
        let productDiscountAmount = 0;
        if (percentValue != null) {
          productDiscountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          productDiscountAmount = Math.min(parseFloat(fixedValue.amount), lineTotal);
        }
        productDiscountAmount = Math.min(productDiscountAmount, lineTotal);
        const priceAfterProductDiscount = lineTotal - productDiscountAmount;
        let totalDesiredDiscount = productDiscountAmount;
        if (hasCheckoutOrderLevelDiscount && checkoutOrderLevelApp) {
          const alreadyAllocated = checkoutOrderLevelAmountByLineItem.get(item.id) ?? 0;
          let recomputedOrderLevelAmount = alreadyAllocated;
          if (((_z = checkoutOrderLevelApp.value) == null ? void 0 : _z.percentage) != null) {
            recomputedOrderLevelAmount = priceAfterProductDiscount * checkoutOrderLevelApp.value.percentage;
          }
          recomputedOrderLevelAmount = Math.min(recomputedOrderLevelAmount, priceAfterProductDiscount);
          totalDesiredDiscount = productDiscountAmount + recomputedOrderLevelAmount;
          const incrementalAmount = totalDesiredDiscount - alreadyAllocated;
          totalDesiredDiscount = Math.max(incrementalAmount, 0);
        }
        if (totalDesiredDiscount <= 0) continue;
        applyResults.push({
          lineItemId: item.id,
          discount: {
            fixedValue: {
              amount: money$2(totalDesiredDiscount),
              currencyCode: (fixedValue == null ? void 0 : fixedValue.currencyCode) ?? ((_B = (_A = item.originalUnitPriceSet) == null ? void 0 : _A.shopMoney) == null ? void 0 : _B.currencyCode) ?? currencyCode
            },
            description: codeDiscount.shortSummary || normalizedCode
          }
        });
      }
      if (applyResults.length === 0) {
        const message = warnings[0] ?? "Could not apply the product-level discount to any eligible product.";
        return cors(Response.json({
          userErrors: [{
            message
          }]
        }, {
          status: 422
        }));
      }
    }
    let appliedCount = 0;
    const applyFailures = [];
    for (const {
      lineItemId,
      discount
    } of applyResults) {
      const applyRes = await admin.graphql(`#graphql
        mutation applyLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId,
          discount
        }
      });
      const applyJson = await applyRes.json();
      const topLevelErrors = applyJson.errors ?? [];
      const userErrors = ((_D = (_C = applyJson.data) == null ? void 0 : _C.orderEditAddLineItemDiscount) == null ? void 0 : _D.userErrors) ?? [];
      const staged = (_F = (_E = applyJson.data) == null ? void 0 : _E.orderEditAddLineItemDiscount) == null ? void 0 : _F.calculatedLineItem;
      if (topLevelErrors.length || userErrors.length || !staged) {
        applyFailures.push(((_G = topLevelErrors[0]) == null ? void 0 : _G.message) ?? ((_H = userErrors[0]) == null ? void 0 : _H.message) ?? "Unknown error applying discount.");
        continue;
      }
      appliedCount += 1;
    }
    if (appliedCount === 0) {
      const message = applyFailures[0] ? `Could not apply the discount: ${applyFailures[0]}` : "Could not apply the discount.";
      return cors(Response.json({
        userErrors: [{
          message
        }]
      }, {
        status: 422
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation commitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: isOrderLevelCode ? `Order-level discount code "${normalizedCode}" applied via customer account` : `Product-level discount code "${normalizedCode}" applied to ${appliedCount} product(s) via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_J = (_I = commitJson.data) == null ? void 0 : _I.orderEditCommit) == null ? void 0 : _J.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    return cors(Response.json({
      order: commitJson.data.orderEditCommit.order,
      summary: codeDiscount.shortSummary ?? normalizedCode,
      appliedCount,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount3] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$f,
  loader: loader$k
}, Symbol.toStringTag, { value: "Module" }));
function isOrderLevelApplication$1(app2) {
  return !!app2 && app2.targetSelection === "ALL";
}
function isProductLevelApplication$1(app2) {
  return !!app2 && app2.targetSelection != null && app2.targetSelection !== "ALL";
}
function money$1(amount) {
  return Math.max(amount, 0).toFixed(2);
}
function existingAllocationsFor$1(item) {
  var _a2, _b;
  const out = [];
  for (const alloc of item.calculatedDiscountAllocations ?? []) {
    const app2 = alloc.discountApplication;
    if (!(app2 == null ? void 0 : app2.id)) continue;
    out.push({
      id: app2.id,
      amount: parseFloat(((_b = (_a2 = alloc.allocatedAmountSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.amount) ?? "0") || 0,
      isOrderLevel: isOrderLevelApplication$1(app2),
      isProductLevel: isProductLevelApplication$1(app2),
      app: app2
    });
  }
  return out;
}
async function loader$j({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$e({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode,
    variantIds
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  const requestedVariantIds = Array.isArray(variantIds) && variantIds.length > 0 ? variantIds : null;
  const normalizedCode = String(discountCode).trim().toUpperCase();
  try {
    const codeRes = await admin.graphql(`#graphql
      query lookupDiscountCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              status
              shortSummary
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount currencyCode } }
                }
                items {
                  __typename
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts {
                    products(first: 250) { nodes { id } }
                    productVariants(first: 250) { nodes { id } }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) { nodes { id } }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy { status }
            ... on DiscountCodeFreeShipping { status }
          }
        }
      }`, {
      variables: {
        code: normalizedCode
      }
    });
    const codeJson = await codeRes.json();
    const codeDiscount = (_b = (_a2 = codeJson.data) == null ? void 0 : _a2.codeDiscountNodeByCode) == null ? void 0 : _b.codeDiscount;
    if (!codeDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" was not found.`
        }]
      }, {
        status: 404
      }));
    }
    if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" is ${String(codeDiscount.status).toLowerCase()}.`
        }]
      }, {
        status: 422
      }));
    }
    if (codeDiscount.__typename !== "DiscountCodeBasic") {
      return cors(Response.json({
        userErrors: [{
          message: "Only percentage and fixed-amount discount codes are supported."
        }]
      }, {
        status: 422
      }));
    }
    const value = (_c = codeDiscount.customerGets) == null ? void 0 : _c.value;
    const percentValue = (value == null ? void 0 : value.percentage) != null ? value.percentage * 100 : null;
    const fixedValue = ((_d = value == null ? void 0 : value.amount) == null ? void 0 : _d.amount) ? {
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode
    } : null;
    if (percentValue == null && fixedValue == null) {
      return cors(Response.json({
        userErrors: [{
          message: "This discount has no usable percentage or fixed amount."
        }]
      }, {
        status: 422
      }));
    }
    const items = (_e = codeDiscount.customerGets) == null ? void 0 : _e.items;
    const isOrderLevelCode = !items || items.__typename === "AllDiscountItems";
    let eligibleProductIds = /* @__PURE__ */ new Set();
    let eligibleVariantIds = /* @__PURE__ */ new Set();
    if (!isOrderLevelCode) {
      if ((items == null ? void 0 : items.__typename) === "DiscountProducts") {
        eligibleProductIds = new Set((((_f = items.products) == null ? void 0 : _f.nodes) ?? []).map((p) => p.id));
        eligibleVariantIds = new Set((((_g = items.productVariants) == null ? void 0 : _g.nodes) ?? []).map((v) => v.id));
      } else if ((items == null ? void 0 : items.__typename) === "DiscountCollections") {
        const collectionIds = (((_h = items.collections) == null ? void 0 : _h.nodes) ?? []).map((c) => c.id);
        for (const collectionId of collectionIds) {
          const collRes = await admin.graphql(`#graphql
            query collectionProducts($id: ID!) {
              collection(id: $id) {
                products(first: 250) { nodes { id } }
              }
            }`, {
            variables: {
              id: collectionId
            }
          });
          const collJson = await collRes.json();
          for (const p of ((_k = (_j = (_i = collJson.data) == null ? void 0 : _i.collection) == null ? void 0 : _j.products) == null ? void 0 : _k.nodes) ?? []) {
            eligibleProductIds.add(p.id);
          }
        }
      }
    }
    const beginRes = await admin.graphql(`#graphql
      mutation beginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 50) {
              nodes {
                id
                quantity
                variant { id product { id title } }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    targetSelection
                    targetType
                    allocationMethod
                    value {
                      ... on PricingPercentageValue { percentage }
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_m = (_l = beginJson.data) == null ? void 0 : _l.orderEditBegin) == null ? void 0 : _m.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;
    const lineItems = ((_n = beginJson.data.orderEditBegin.calculatedOrder.lineItems) == null ? void 0 : _n.nodes) ?? [];
    if (lineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    const allAllocations = lineItems.flatMap((item) => existingAllocationsFor$1(item));
    const hasExistingOrderLevelDiscount = allAllocations.some((a) => a.isOrderLevel);
    const hasExistingProductLevelDiscount = allAllocations.some((a) => a.isProductLevel);
    if (isOrderLevelCode && hasExistingOrderLevelDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: "This order already has an order-level discount applied. Only one order-level discount code is allowed per order."
        }]
      }, {
        status: 422
      }));
    }
    if (!isOrderLevelCode && hasExistingProductLevelDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: "This order already has a product-level discount applied. Only one product-level discount code is allowed per order."
        }]
      }, {
        status: 422
      }));
    }
    const applyResults = [];
    const warnings = [];
    const defaultCurrencyCode = (fixedValue == null ? void 0 : fixedValue.currencyCode) ?? ((_q = (_p = (_o = lineItems[0]) == null ? void 0 : _o.originalUnitPriceSet) == null ? void 0 : _p.shopMoney) == null ? void 0 : _q.currencyCode) ?? "USD";
    if (isOrderLevelCode) {
      const remainingBaseByLineItem = /* @__PURE__ */ new Map();
      let remainingOrderTotal = 0;
      for (const item of lineItems) {
        const unitPrice = parseFloat(((_s = (_r = item.originalUnitPriceSet) == null ? void 0 : _r.shopMoney) == null ? void 0 : _s.amount) ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        const existingTotal = existingAllocationsFor$1(item).reduce((sum, a) => sum + a.amount, 0);
        const remainingBase = Math.max(lineTotal - existingTotal, 0);
        remainingBaseByLineItem.set(item.id, remainingBase);
        remainingOrderTotal += remainingBase;
      }
      for (const item of lineItems) {
        const remainingBase = remainingBaseByLineItem.get(item.id) ?? 0;
        if (remainingBase <= 0) continue;
        let newOrderLevelAmount = 0;
        if (percentValue != null) {
          newOrderLevelAmount = remainingBase * (percentValue / 100);
        } else if (fixedValue) {
          const share = remainingOrderTotal > 0 ? remainingBase / remainingOrderTotal : 0;
          newOrderLevelAmount = Math.min(parseFloat(fixedValue.amount) * share, remainingBase);
        }
        if (newOrderLevelAmount <= 0) continue;
        const existing = existingAllocationsFor$1(item);
        const existingTotal = existing.reduce((sum, a) => sum + a.amount, 0);
        const desiredTotal = existingTotal + newOrderLevelAmount;
        applyResults.push({
          lineItemId: item.id,
          removeIds: existing.map((a) => a.id),
          discount: {
            fixedValue: {
              amount: money$1(desiredTotal),
              currencyCode: defaultCurrencyCode
            },
            description: codeDiscount.shortSummary || normalizedCode
          }
        });
      }
      if (applyResults.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: "Could not apply the order-level discount to any line item."
          }]
        }, {
          status: 422
        }));
      }
    } else {
      const requestedVariantSet = requestedVariantIds ? new Set(requestedVariantIds) : null;
      const candidateItems = lineItems.filter((item) => {
        var _a3, _b2, _c2;
        const variantId = (_a3 = item.variant) == null ? void 0 : _a3.id;
        const productId = (_c2 = (_b2 = item.variant) == null ? void 0 : _b2.product) == null ? void 0 : _c2.id;
        const matchesEligibility = variantId && eligibleVariantIds.has(variantId) || productId && eligibleProductIds.has(productId);
        if (!matchesEligibility) return false;
        if (requestedVariantSet) return !!variantId && requestedVariantSet.has(variantId);
        return true;
      });
      if (candidateItems.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: `Discount code "${discountCode}" is not valid for any product on this order.`
          }]
        }, {
          status: 422
        }));
      }
      for (const item of candidateItems) {
        const unitPrice = parseFloat(((_u = (_t = item.originalUnitPriceSet) == null ? void 0 : _t.shopMoney) == null ? void 0 : _u.amount) ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;
        let productDiscountAmount = 0;
        if (percentValue != null) {
          productDiscountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          productDiscountAmount = Math.min(parseFloat(fixedValue.amount), lineTotal);
        }
        productDiscountAmount = Math.min(productDiscountAmount, lineTotal);
        const priceAfterProductDiscount = lineTotal - productDiscountAmount;
        const existing = existingAllocationsFor$1(item);
        const existingOrderLevel = existing.filter((a) => a.isOrderLevel);
        let recomputedOrderLevelAmount = existingOrderLevel.reduce((sum, a) => sum + a.amount, 0);
        const orderLevelPercentage = (_w = (_v = existingOrderLevel[0]) == null ? void 0 : _v.app.value) == null ? void 0 : _w.percentage;
        if (existingOrderLevel.length > 0 && orderLevelPercentage != null) {
          recomputedOrderLevelAmount = priceAfterProductDiscount * orderLevelPercentage;
        }
        recomputedOrderLevelAmount = Math.min(recomputedOrderLevelAmount, priceAfterProductDiscount);
        const desiredTotal = productDiscountAmount + recomputedOrderLevelAmount;
        if (desiredTotal <= 0) continue;
        applyResults.push({
          lineItemId: item.id,
          removeIds: existingOrderLevel.map((a) => a.id),
          discount: {
            fixedValue: {
              amount: money$1(desiredTotal),
              currencyCode: (fixedValue == null ? void 0 : fixedValue.currencyCode) ?? ((_y = (_x = item.originalUnitPriceSet) == null ? void 0 : _x.shopMoney) == null ? void 0 : _y.currencyCode) ?? defaultCurrencyCode
            },
            description: codeDiscount.shortSummary || normalizedCode
          }
        });
      }
      if (applyResults.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: "Could not apply the product-level discount to any eligible product."
          }]
        }, {
          status: 422
        }));
      }
    }
    const removeIds = /* @__PURE__ */ new Set();
    for (const {
      removeIds: ids
    } of applyResults) {
      for (const id of ids) removeIds.add(id);
    }
    for (const discountApplicationId of removeIds) {
      const removeRes = await admin.graphql(`#graphql
        mutation removeDiscount($id: ID!, $discountApplicationId: ID!) {
          orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          discountApplicationId
        }
      });
      const removeJson = await removeRes.json();
      const removeErrors = ((_A = (_z = removeJson.data) == null ? void 0 : _z.orderEditRemoveDiscount) == null ? void 0 : _A.userErrors) ?? [];
      if (((_B = removeJson.errors) == null ? void 0 : _B.length) || removeErrors.length) {
        console.warn(`[order-discount4] Could not remove discount ${discountApplicationId}:`, removeJson.errors ?? removeErrors);
      }
    }
    let appliedCount = 0;
    const applyFailures = [];
    for (const {
      lineItemId,
      discount
    } of applyResults) {
      const applyRes = await admin.graphql(`#graphql
        mutation applyLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId,
          discount
        }
      });
      const applyJson = await applyRes.json();
      const topLevelErrors = applyJson.errors ?? [];
      const userErrors = ((_D = (_C = applyJson.data) == null ? void 0 : _C.orderEditAddLineItemDiscount) == null ? void 0 : _D.userErrors) ?? [];
      const staged = (_F = (_E = applyJson.data) == null ? void 0 : _E.orderEditAddLineItemDiscount) == null ? void 0 : _F.calculatedLineItem;
      if (topLevelErrors.length || userErrors.length || !staged) {
        applyFailures.push(((_G = topLevelErrors[0]) == null ? void 0 : _G.message) ?? ((_H = userErrors[0]) == null ? void 0 : _H.message) ?? "Unknown error applying discount.");
        continue;
      }
      appliedCount += 1;
    }
    if (appliedCount === 0) {
      const message = applyFailures[0] ? `Could not apply the discount: ${applyFailures[0]}` : "Could not apply the discount.";
      return cors(Response.json({
        userErrors: [{
          message
        }]
      }, {
        status: 422
      }));
    }
    if (applyFailures.length > 0) {
      warnings.push(...applyFailures.map((m) => `A product could not be updated: ${m}`));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation commitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: isOrderLevelCode ? `Order-level discount code "${normalizedCode}" applied via customer account` : `Product-level discount code "${normalizedCode}" applied to ${appliedCount} product(s) via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_J = (_I = commitJson.data) == null ? void 0 : _I.orderEditCommit) == null ? void 0 : _J.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    return cors(Response.json({
      order: commitJson.data.orderEditCommit.order,
      summary: codeDiscount.shortSummary ?? normalizedCode,
      appliedCount,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount4] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$e,
  loader: loader$j
}, Symbol.toStringTag, { value: "Module" }));
function isOrderLevelApplication(app2) {
  return !!app2 && app2.targetSelection === "ALL";
}
function isProductLevelApplication(app2) {
  return !!app2 && app2.targetSelection != null && app2.targetSelection !== "ALL";
}
function money(amount) {
  return Math.max(amount, 0).toFixed(2);
}
function labelFor(app2) {
  return app2.description || app2.code || "Discount";
}
function combineLabels(labels) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const l of labels) {
    if (!l) continue;
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(l);
  }
  return out.join(" + ");
}
function existingAllocationsFor(item) {
  var _a2, _b;
  const out = [];
  for (const alloc of item.calculatedDiscountAllocations ?? []) {
    const app2 = alloc.discountApplication;
    if (!(app2 == null ? void 0 : app2.id)) continue;
    out.push({
      id: app2.id,
      amount: parseFloat(((_b = (_a2 = alloc.allocatedAmountSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.amount) ?? "0") || 0,
      isOrderLevel: isOrderLevelApplication(app2),
      isProductLevel: isProductLevelApplication(app2),
      label: labelFor(app2),
      app: app2
    });
  }
  return out;
}
async function loader$i({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$d({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode,
    variantIds
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  const requestedVariantIds = Array.isArray(variantIds) && variantIds.length > 0 ? variantIds : null;
  const normalizedCode = String(discountCode).trim().toUpperCase();
  try {
    const codeRes = await admin.graphql(`#graphql
      query lookupDiscountCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              status
              shortSummary
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount currencyCode } }
                }
                items {
                  __typename
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts {
                    products(first: 250) { nodes { id } }
                    productVariants(first: 250) { nodes { id } }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) { nodes { id } }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy { status }
            ... on DiscountCodeFreeShipping { status }
          }
        }
      }`, {
      variables: {
        code: normalizedCode
      }
    });
    const codeJson = await codeRes.json();
    const codeDiscount = (_b = (_a2 = codeJson.data) == null ? void 0 : _a2.codeDiscountNodeByCode) == null ? void 0 : _b.codeDiscount;
    if (!codeDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" was not found.`
        }]
      }, {
        status: 404
      }));
    }
    if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" is ${String(codeDiscount.status).toLowerCase()}.`
        }]
      }, {
        status: 422
      }));
    }
    if (codeDiscount.__typename !== "DiscountCodeBasic") {
      return cors(Response.json({
        userErrors: [{
          message: "Only percentage and fixed-amount discount codes are supported."
        }]
      }, {
        status: 422
      }));
    }
    const value = (_c = codeDiscount.customerGets) == null ? void 0 : _c.value;
    const percentValue = (value == null ? void 0 : value.percentage) != null ? value.percentage * 100 : null;
    const fixedValue = ((_d = value == null ? void 0 : value.amount) == null ? void 0 : _d.amount) ? {
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode
    } : null;
    if (percentValue == null && fixedValue == null) {
      return cors(Response.json({
        userErrors: [{
          message: "This discount has no usable percentage or fixed amount."
        }]
      }, {
        status: 422
      }));
    }
    const items = (_e = codeDiscount.customerGets) == null ? void 0 : _e.items;
    const isOrderLevelCode = !items || items.__typename === "AllDiscountItems";
    let eligibleProductIds = /* @__PURE__ */ new Set();
    let eligibleVariantIds = /* @__PURE__ */ new Set();
    if (!isOrderLevelCode) {
      if ((items == null ? void 0 : items.__typename) === "DiscountProducts") {
        eligibleProductIds = new Set((((_f = items.products) == null ? void 0 : _f.nodes) ?? []).map((p) => p.id));
        eligibleVariantIds = new Set((((_g = items.productVariants) == null ? void 0 : _g.nodes) ?? []).map((v) => v.id));
      } else if ((items == null ? void 0 : items.__typename) === "DiscountCollections") {
        const collectionIds = (((_h = items.collections) == null ? void 0 : _h.nodes) ?? []).map((c) => c.id);
        for (const collectionId of collectionIds) {
          const collRes = await admin.graphql(`#graphql
            query collectionProducts($id: ID!) {
              collection(id: $id) {
                products(first: 250) { nodes { id } }
              }
            }`, {
            variables: {
              id: collectionId
            }
          });
          const collJson = await collRes.json();
          for (const p of ((_k = (_j = (_i = collJson.data) == null ? void 0 : _i.collection) == null ? void 0 : _j.products) == null ? void 0 : _k.nodes) ?? []) {
            eligibleProductIds.add(p.id);
          }
        }
      }
    }
    const beginRes = await admin.graphql(`#graphql
      mutation beginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 50) {
              nodes {
                id
                quantity
                variant { id product { id title } }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    targetSelection
                    targetType
                    allocationMethod
                    value {
                      ... on PricingPercentageValue { percentage }
                      ... on MoneyV2 { amount currencyCode }
                    }
                    ... on CalculatedDiscountCodeApplication { code }
                    ... on CalculatedManualDiscountApplication { description }
                    ... on CalculatedScriptDiscountApplication { description }
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_m = (_l = beginJson.data) == null ? void 0 : _l.orderEditBegin) == null ? void 0 : _m.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrderId = beginJson.data.orderEditBegin.calculatedOrder.id;
    const lineItems = ((_n = beginJson.data.orderEditBegin.calculatedOrder.lineItems) == null ? void 0 : _n.nodes) ?? [];
    if (lineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    const allAllocations = lineItems.flatMap((item) => existingAllocationsFor(item));
    const hasExistingOrderLevelDiscount = allAllocations.some((a) => a.isOrderLevel);
    const hasExistingProductLevelDiscount = allAllocations.some((a) => a.isProductLevel);
    if (isOrderLevelCode && hasExistingOrderLevelDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: "This order already has an order-level discount applied. Only one order-level discount code is allowed per order."
        }]
      }, {
        status: 422
      }));
    }
    if (!isOrderLevelCode && hasExistingProductLevelDiscount) {
      return cors(Response.json({
        userErrors: [{
          message: "This order already has a product-level discount applied. Only one product-level discount code is allowed per order."
        }]
      }, {
        status: 422
      }));
    }
    const applyResults = [];
    const warnings = [];
    const defaultCurrencyCode = (fixedValue == null ? void 0 : fixedValue.currencyCode) ?? ((_q = (_p = (_o = lineItems[0]) == null ? void 0 : _o.originalUnitPriceSet) == null ? void 0 : _p.shopMoney) == null ? void 0 : _q.currencyCode) ?? "USD";
    const newCodeLabel = codeDiscount.shortSummary || normalizedCode;
    if (isOrderLevelCode) {
      const remainingBaseByLineItem = /* @__PURE__ */ new Map();
      let remainingOrderTotal = 0;
      for (const item of lineItems) {
        const unitPrice = parseFloat(((_s = (_r = item.originalUnitPriceSet) == null ? void 0 : _r.shopMoney) == null ? void 0 : _s.amount) ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        const existingTotal = existingAllocationsFor(item).reduce((sum, a) => sum + a.amount, 0);
        const remainingBase = Math.max(lineTotal - existingTotal, 0);
        remainingBaseByLineItem.set(item.id, remainingBase);
        remainingOrderTotal += remainingBase;
      }
      for (const item of lineItems) {
        const remainingBase = remainingBaseByLineItem.get(item.id) ?? 0;
        if (remainingBase <= 0) continue;
        let newOrderLevelAmount = 0;
        if (percentValue != null) {
          newOrderLevelAmount = remainingBase * (percentValue / 100);
        } else if (fixedValue) {
          const share = remainingOrderTotal > 0 ? remainingBase / remainingOrderTotal : 0;
          newOrderLevelAmount = Math.min(parseFloat(fixedValue.amount) * share, remainingBase);
        }
        if (newOrderLevelAmount <= 0) continue;
        const existing = existingAllocationsFor(item);
        const existingTotal = existing.reduce((sum, a) => sum + a.amount, 0);
        const desiredTotal = existingTotal + newOrderLevelAmount;
        const combinedDescription = combineLabels([...existing.map((a) => a.label), newCodeLabel]);
        applyResults.push({
          lineItemId: item.id,
          removeIds: existing.map((a) => a.id),
          discount: {
            fixedValue: {
              amount: money(desiredTotal),
              currencyCode: defaultCurrencyCode
            },
            description: combinedDescription
          }
        });
      }
      if (applyResults.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: "Could not apply the order-level discount to any line item."
          }]
        }, {
          status: 422
        }));
      }
    } else {
      const requestedVariantSet = requestedVariantIds ? new Set(requestedVariantIds) : null;
      const candidateItems = lineItems.filter((item) => {
        var _a3, _b2, _c2;
        const variantId = (_a3 = item.variant) == null ? void 0 : _a3.id;
        const productId = (_c2 = (_b2 = item.variant) == null ? void 0 : _b2.product) == null ? void 0 : _c2.id;
        const matchesEligibility = variantId && eligibleVariantIds.has(variantId) || productId && eligibleProductIds.has(productId);
        if (!matchesEligibility) return false;
        if (requestedVariantSet) return !!variantId && requestedVariantSet.has(variantId);
        return true;
      });
      if (candidateItems.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: `Discount code "${discountCode}" is not valid for any product on this order.`
          }]
        }, {
          status: 422
        }));
      }
      for (const item of candidateItems) {
        const unitPrice = parseFloat(((_u = (_t = item.originalUnitPriceSet) == null ? void 0 : _t.shopMoney) == null ? void 0 : _u.amount) ?? "0") || 0;
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal <= 0) continue;
        let productDiscountAmount = 0;
        if (percentValue != null) {
          productDiscountAmount = lineTotal * (percentValue / 100);
        } else if (fixedValue) {
          productDiscountAmount = Math.min(parseFloat(fixedValue.amount), lineTotal);
        }
        productDiscountAmount = Math.min(productDiscountAmount, lineTotal);
        const priceAfterProductDiscount = lineTotal - productDiscountAmount;
        const existing = existingAllocationsFor(item);
        const existingOrderLevel = existing.filter((a) => a.isOrderLevel);
        let recomputedOrderLevelAmount = existingOrderLevel.reduce((sum, a) => sum + a.amount, 0);
        const orderLevelPercentage = (_w = (_v = existingOrderLevel[0]) == null ? void 0 : _v.app.value) == null ? void 0 : _w.percentage;
        if (existingOrderLevel.length > 0 && orderLevelPercentage != null) {
          recomputedOrderLevelAmount = priceAfterProductDiscount * orderLevelPercentage;
        }
        recomputedOrderLevelAmount = Math.min(recomputedOrderLevelAmount, priceAfterProductDiscount);
        const desiredTotal = productDiscountAmount + recomputedOrderLevelAmount;
        if (desiredTotal <= 0) continue;
        const combinedDescription = combineLabels([newCodeLabel, ...existingOrderLevel.map((a) => a.label)]);
        applyResults.push({
          lineItemId: item.id,
          removeIds: existingOrderLevel.map((a) => a.id),
          discount: {
            fixedValue: {
              amount: money(desiredTotal),
              currencyCode: (fixedValue == null ? void 0 : fixedValue.currencyCode) ?? ((_y = (_x = item.originalUnitPriceSet) == null ? void 0 : _x.shopMoney) == null ? void 0 : _y.currencyCode) ?? defaultCurrencyCode
            },
            description: combinedDescription
          }
        });
      }
      if (applyResults.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: "Could not apply the product-level discount to any eligible product."
          }]
        }, {
          status: 422
        }));
      }
    }
    const removeIds = /* @__PURE__ */ new Set();
    for (const {
      removeIds: ids
    } of applyResults) {
      for (const id of ids) removeIds.add(id);
    }
    for (const discountApplicationId of removeIds) {
      const removeRes = await admin.graphql(`#graphql
        mutation removeDiscount($id: ID!, $discountApplicationId: ID!) {
          orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          discountApplicationId
        }
      });
      const removeJson = await removeRes.json();
      const removeErrors = ((_A = (_z = removeJson.data) == null ? void 0 : _z.orderEditRemoveDiscount) == null ? void 0 : _A.userErrors) ?? [];
      if (((_B = removeJson.errors) == null ? void 0 : _B.length) || removeErrors.length) {
        console.warn(`[order-discount4] Could not remove discount ${discountApplicationId}:`, removeJson.errors ?? removeErrors);
      }
    }
    let appliedCount = 0;
    const applyFailures = [];
    for (const {
      lineItemId,
      discount
    } of applyResults) {
      const applyRes = await admin.graphql(`#graphql
        mutation applyLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId,
          discount
        }
      });
      const applyJson = await applyRes.json();
      const topLevelErrors = applyJson.errors ?? [];
      const userErrors = ((_D = (_C = applyJson.data) == null ? void 0 : _C.orderEditAddLineItemDiscount) == null ? void 0 : _D.userErrors) ?? [];
      const staged = (_F = (_E = applyJson.data) == null ? void 0 : _E.orderEditAddLineItemDiscount) == null ? void 0 : _F.calculatedLineItem;
      if (topLevelErrors.length || userErrors.length || !staged) {
        applyFailures.push(((_G = topLevelErrors[0]) == null ? void 0 : _G.message) ?? ((_H = userErrors[0]) == null ? void 0 : _H.message) ?? "Unknown error applying discount.");
        continue;
      }
      appliedCount += 1;
    }
    if (appliedCount === 0) {
      const message = applyFailures[0] ? `Could not apply the discount: ${applyFailures[0]}` : "Could not apply the discount.";
      return cors(Response.json({
        userErrors: [{
          message
        }]
      }, {
        status: 422
      }));
    }
    if (applyFailures.length > 0) {
      warnings.push(...applyFailures.map((m) => `A product could not be updated: ${m}`));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation commitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: isOrderLevelCode ? `Order-level discount code "${normalizedCode}" applied via customer account` : `Product-level discount code "${normalizedCode}" applied to ${appliedCount} product(s) via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_J = (_I = commitJson.data) == null ? void 0 : _I.orderEditCommit) == null ? void 0 : _J.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    return cors(Response.json({
      order: commitJson.data.orderEditCommit.order,
      summary: codeDiscount.shortSummary ?? normalizedCode,
      appliedCount,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount4] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$d,
  loader: loader$i
}, Symbol.toStringTag, { value: "Module" }));
const TAG_PREFIX$2 = "@d2:";
function lineItemDisplayName$2(item) {
  var _a2, _b, _c;
  const productTitle = ((_b = (_a2 = item.variant) == null ? void 0 : _a2.product) == null ? void 0 : _b.title) || item.title || "this product";
  const variantTitle = (_c = item.variant) == null ? void 0 : _c.title;
  if (variantTitle && variantTitle !== "Default Title") {
    return `${productTitle} (${variantTitle})`;
  }
  return productTitle;
}
const APP_ORIGIN_TYPENAME$2 = "ManualDiscountApplication";
function decodeTag$2(description) {
  if (!description || !description.startsWith(TAG_PREFIX$2)) return null;
  const rest = description.slice(TAG_PREFIX$2.length);
  const closeIdx = rest.indexOf("}");
  if (closeIdx === -1) return null;
  const raw = rest.slice(0, closeIdx + 1);
  const label2 = rest.slice(closeIdx + 1).trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      checkoutAmount: parsed.c ?? 0,
      productAmount: parsed.p ?? 0,
      orderAmount: parsed.o ?? 0,
      label: label2
    };
  } catch {
    return null;
  }
}
function encodeTag$2(tag) {
  const raw = JSON.stringify({
    c: round2$2(tag.checkoutAmount),
    p: round2$2(tag.productAmount),
    o: round2$2(tag.orderAmount)
  });
  return `${TAG_PREFIX$2}${raw} ${tag.label}`.trim();
}
function round2$2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function readLineItemDiscountState$2(item) {
  var _a2, _b, _c, _d, _e, _f;
  const allocations = item.calculatedDiscountAllocations ?? [];
  const currencyCode = ((_b = (_a2 = item.originalUnitPriceSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.currencyCode) ?? "";
  if (allocations.length === 0) {
    return {
      currencyCode,
      existingApplicationId: null,
      existingIsOurs: false,
      blocked: false,
      tag: {
        checkoutAmount: 0,
        productAmount: 0,
        orderAmount: 0,
        label: ""
      }
    };
  }
  let existingApplicationId = null;
  let existingIsOurs = false;
  let blocked = false;
  let tag = {
    checkoutAmount: 0,
    productAmount: 0,
    orderAmount: 0,
    label: ""
  };
  let resolvedCurrency = currencyCode;
  for (const allocation of allocations) {
    const app2 = allocation.discountApplication;
    if (!app2) continue;
    existingApplicationId = app2.id;
    const allocatedAmount = parseFloat(((_d = (_c = allocation.allocatedAmountSet) == null ? void 0 : _c.shopMoney) == null ? void 0 : _d.amount) ?? "0");
    if ((_f = (_e = allocation.allocatedAmountSet) == null ? void 0 : _e.shopMoney) == null ? void 0 : _f.currencyCode) {
      resolvedCurrency = allocation.allocatedAmountSet.shopMoney.currencyCode;
    }
    if (app2.__typename === APP_ORIGIN_TYPENAME$2) {
      existingIsOurs = true;
      const decoded = decodeTag$2(app2.description);
      if (decoded) {
        tag = decoded;
      } else {
        tag = {
          checkoutAmount: 0,
          productAmount: allocatedAmount,
          orderAmount: 0,
          label: app2.description ?? ""
        };
      }
    } else if (app2.targetSelection === "ALL") {
      existingIsOurs = false;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: tag.productAmount,
        orderAmount: tag.orderAmount,
        label: app2.description || "Checkout discount"
      };
    } else {
      existingIsOurs = false;
      blocked = true;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: 0,
        orderAmount: 0,
        label: app2.description || "Checkout discount"
      };
    }
  }
  return {
    currencyCode: resolvedCurrency,
    existingApplicationId,
    existingIsOurs,
    blocked,
    tag
  };
}
async function resolveDiscountCode$2(admin, code) {
  var _a2, _b, _c, _d, _e, _f, _g;
  const res = await admin.graphql(`#graphql
    query LookupDiscountCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            status
            title
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
              items {
                __typename
                ... on AllDiscountItems {
                  allItems
                }
                ... on DiscountProducts {
                  productVariants(first: 250) { nodes { id } }
                  products(first: 250) { nodes { id } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { nodes { id } }
                }
              }
            }
          }
        }
      }
    }`, {
    variables: {
      code: code.trim().toUpperCase()
    }
  });
  const json = await res.json();
  const node = (_a2 = json.data) == null ? void 0 : _a2.codeDiscountNodeByCode;
  if (!node) {
    return {
      ok: false,
      message: `Discount code "${code}" was not found.`
    };
  }
  const codeDiscount = node.codeDiscount;
  if ((codeDiscount == null ? void 0 : codeDiscount.__typename) !== "DiscountCodeBasic") {
    return {
      ok: false,
      message: `Discount code "${code}" is not a supported type.`
    };
  }
  if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
    return {
      ok: false,
      message: `Discount code "${code}" is ${String(codeDiscount.status).toLowerCase()}.`
    };
  }
  const items = (_b = codeDiscount.customerGets) == null ? void 0 : _b.items;
  if (!items || items.__typename === "AllDiscountItems") {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`
    };
  }
  const variantIds = new Set((((_c = items.productVariants) == null ? void 0 : _c.nodes) ?? []).map((n) => n.id));
  const productIds = new Set((((_d = items.products) == null ? void 0 : _d.nodes) ?? []).map((n) => n.id));
  const collectionIds = new Set((((_e = items.collections) == null ? void 0 : _e.nodes) ?? []).map((n) => n.id));
  if (variantIds.size === 0 && productIds.size === 0 && collectionIds.size === 0) {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`
    };
  }
  const targeting = {
    type: "selection",
    variantIds,
    productIds,
    collectionIds
  };
  const value = (_f = codeDiscount.customerGets) == null ? void 0 : _f.value;
  const label2 = codeDiscount.title || code.trim().toUpperCase();
  if ((value == null ? void 0 : value.percentage) != null) {
    return {
      ok: true,
      kind: "percentage",
      percentage: value.percentage * 100,
      label: label2,
      targeting
    };
  }
  if ((_g = value == null ? void 0 : value.amount) == null ? void 0 : _g.amount) {
    return {
      ok: true,
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode,
      label: label2,
      targeting
    };
  }
  return {
    ok: false,
    message: `Discount code "${code}" does not have a supported percentage or fixed value.`
  };
}
function discountAmountAgainst$2(resolved, base) {
  if (resolved.kind === "percentage") {
    return Math.max(base * (resolved.percentage / 100), 0);
  }
  return Math.min(Math.max(parseFloat(resolved.amount) || 0, 0), base);
}
function lineItemMatchesTargeting$2(item, targeting) {
  var _a2, _b, _c, _d, _e, _f, _g;
  if (targeting.type === "order") return true;
  const variantId = (_a2 = item.variant) == null ? void 0 : _a2.id;
  const productId = (_c = (_b = item.variant) == null ? void 0 : _b.product) == null ? void 0 : _c.id;
  const collectionIds = ((_g = (_f = (_e = (_d = item.variant) == null ? void 0 : _d.product) == null ? void 0 : _e.collections) == null ? void 0 : _f.nodes) == null ? void 0 : _g.map((n) => n.id)) ?? [];
  if (variantId && targeting.variantIds.has(variantId)) return true;
  if (productId && targeting.productIds.has(productId)) return true;
  if (collectionIds.some((id) => targeting.collectionIds.has(id))) return true;
  return false;
}
async function loader$h({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$c({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  try {
    const resolved = await resolveDiscountCode$2(admin, discountCode);
    if (!resolved.ok) {
      return cors(Response.json({
        userErrors: [{
          message: resolved.message
        }]
      }, {
        status: 422
      }));
    }
    const beginRes = await admin.graphql(`#graphql
      mutation BeginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 100) {
              nodes {
                id
                quantity
                title
                variant {
                  id
                  title
                  product {
                    id
                    title
                    collections(first: 50) { nodes { id } }
                  }
                }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    description
                    targetSelection
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_b = (_a2 = beginJson.data) == null ? void 0 : _a2.orderEditBegin) == null ? void 0 : _b.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const allLineItems = ((_c = calculatedOrder.lineItems) == null ? void 0 : _c.nodes) ?? [];
    if (allLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    const targetLineItems = allLineItems.filter((item) => lineItemMatchesTargeting$2(item, resolved.targeting));
    if (targetLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: `No product eligible for discount code "${discountCode}" was found on this order.`
        }]
      }, {
        status: 422
      }));
    }
    const warnings = [];
    let appliedCount = 0;
    let replacedCount = 0;
    for (const item of targetLineItems) {
      const state = readLineItemDiscountState$2(item);
      const originalUnit = parseFloat(((_e = (_d = item.originalUnitPriceSet) == null ? void 0 : _d.shopMoney) == null ? void 0 : _e.amount) ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const currencyCode = state.currencyCode || ((_g = (_f = item.originalUnitPriceSet) == null ? void 0 : _f.shopMoney) == null ? void 0 : _g.currencyCode) || "USD";
      if (state.blocked) {
        warnings.push(`The product already has a discount applied.`);
        continue;
      }
      const newProductAmount = discountAmountAgainst$2(resolved.kind === "percentage" ? {
        kind: "percentage",
        percentage: resolved.percentage
      } : {
        kind: "fixed",
        amount: resolved.amount
      }, originalLineTotal);
      if (state.tag.productAmount > 0 && newProductAmount <= state.tag.productAmount) {
        const existingLabel = state.tag.label ? `"${state.tag.label}"` : "The existing discount";
        warnings.push(`"${lineItemDisplayName$2(item)}" already has ${existingLabel} applied, worth ${state.tag.productAmount.toFixed(2)} ${currencyCode}. "${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode} on this product, so it was not applied — the existing discount is greater than or equal and was kept as-is.`);
        continue;
      }
      const wasReplacement = state.tag.productAmount > 0;
      if (state.existingApplicationId && state.existingIsOurs) {
        const removeRes = await admin.graphql(`#graphql
          mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
            orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
              userErrors { field message }
            }
          }`, {
          variables: {
            id: calculatedOrderId,
            discountApplicationId: state.existingApplicationId
          }
        });
        const removeJson = await removeRes.json();
        const removeErrors = ((_i = (_h = removeJson.data) == null ? void 0 : _h.orderEditRemoveDiscount) == null ? void 0 : _i.userErrors) ?? [];
        if (((_j = removeJson.errors) == null ? void 0 : _j.length) || removeErrors.length) {
          const rawMessage = ((_k = removeErrors[0]) == null ? void 0 : _k.message) ?? ((_m = (_l = removeJson.errors) == null ? void 0 : _l[0]) == null ? void 0 : _m.message) ?? "unknown error";
          if (/discount code/i.test(rawMessage) && /can'?t be removed/i.test(rawMessage)) {
            warnings.push("This product already has a discount applied.");
          } else {
            warnings.push(`Could not update the discount on this product: ${rawMessage}.`);
          }
          continue;
        }
      }
      const newTag = {
        // Preserve the informational record of any order-wide checkout
        // discount amount present — it's not folded into our own
        // fixedValue, since that discount stays as its own separate
        // application; we're just tracking that it's there.
        checkoutAmount: state.tag.checkoutAmount,
        productAmount: newProductAmount,
        orderAmount: state.tag.orderAmount,
        label: resolved.label
      };
      const combinedAmount = newProductAmount + state.tag.orderAmount;
      const applyRes = await admin.graphql(`#graphql
        mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId: item.id,
          discount: {
            fixedValue: {
              amount: combinedAmount.toFixed(2),
              currencyCode
            },
            description: encodeTag$2(newTag)
          }
        }
      });
      const applyJson = await applyRes.json();
      const applyErrors = ((_o = (_n = applyJson.data) == null ? void 0 : _n.orderEditAddLineItemDiscount) == null ? void 0 : _o.userErrors) ?? [];
      if (((_p = applyJson.errors) == null ? void 0 : _p.length) || applyErrors.length) {
        const rawMessage = ((_r = (_q = applyJson.errors) == null ? void 0 : _q[0]) == null ? void 0 : _r.message) ?? ((_s = applyErrors[0]) == null ? void 0 : _s.message) ?? "unknown error";
        if (state.tag.checkoutAmount > 0 && /discount/i.test(rawMessage)) {
          warnings.push("This product already has an order-level discount applied from checkout, and Shopify would not allow an additional discount to be added on top of it here.");
        } else {
          warnings.push(`Could not apply the product discount: ${rawMessage}.`);
        }
        continue;
      }
      appliedCount += 1;
      if (wasReplacement) replacedCount += 1;
    }
    if (appliedCount === 0) {
      return cors(Response.json({
        success: false,
        applied: false,
        warnings: warnings.length ? warnings : ["Nothing was eligible to be discounted."],
        userErrors: []
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation CommitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: `Product discount "${discountCode}" applied via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_u = (_t = commitJson.data) == null ? void 0 : _t.orderEditCommit) == null ? void 0 : _u.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    return cors(Response.json({
      success: true,
      applied: true,
      order: commitJson.data.orderEditCommit.order,
      appliedCount,
      replacedCount,
      discountLabel: resolved.label,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount2] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({
      userErrors: [{
        message
      }]
    }, {
      status: 500
    }));
  }
}
const route13 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$c,
  loader: loader$h
}, Symbol.toStringTag, { value: "Module" }));
const TAG_PREFIX$1 = "@d2:";
function lineItemDisplayName$1(item) {
  var _a2, _b, _c;
  const productTitle = ((_b = (_a2 = item.variant) == null ? void 0 : _a2.product) == null ? void 0 : _b.title) || item.title || "this product";
  const variantTitle = (_c = item.variant) == null ? void 0 : _c.title;
  if (variantTitle && variantTitle !== "Default Title") {
    return `${productTitle} (${variantTitle})`;
  }
  return productTitle;
}
const APP_ORIGIN_TYPENAME$1 = "ManualDiscountApplication";
function decodeTag$1(description) {
  if (!description || !description.startsWith(TAG_PREFIX$1)) return null;
  const rest = description.slice(TAG_PREFIX$1.length);
  const closeIdx = rest.indexOf("}");
  if (closeIdx === -1) return null;
  const raw = rest.slice(0, closeIdx + 1);
  const label2 = rest.slice(closeIdx + 1).trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      checkoutAmount: parsed.c ?? 0,
      productAmount: parsed.p ?? 0,
      orderAmount: parsed.o ?? 0,
      label: label2
    };
  } catch {
    return null;
  }
}
function encodeTag$1(tag) {
  const raw = JSON.stringify({
    c: round2$1(tag.checkoutAmount),
    p: round2$1(tag.productAmount),
    o: round2$1(tag.orderAmount)
  });
  return `${TAG_PREFIX$1}${raw} ${tag.label}`.trim();
}
function round2$1(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function readLineItemDiscountState$1(item) {
  var _a2, _b, _c, _d, _e, _f;
  const allocations = item.calculatedDiscountAllocations ?? [];
  const currencyCode = ((_b = (_a2 = item.originalUnitPriceSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.currencyCode) ?? "";
  if (allocations.length === 0) {
    return {
      currencyCode,
      existingApplicationId: null,
      existingIsOurs: false,
      blocked: false,
      tag: {
        checkoutAmount: 0,
        productAmount: 0,
        orderAmount: 0,
        label: ""
      }
    };
  }
  let existingApplicationId = null;
  let existingIsOurs = false;
  let blocked = false;
  let tag = {
    checkoutAmount: 0,
    productAmount: 0,
    orderAmount: 0,
    label: ""
  };
  let resolvedCurrency = currencyCode;
  for (const allocation of allocations) {
    const app2 = allocation.discountApplication;
    if (!app2) continue;
    existingApplicationId = app2.id;
    const allocatedAmount = parseFloat(((_d = (_c = allocation.allocatedAmountSet) == null ? void 0 : _c.shopMoney) == null ? void 0 : _d.amount) ?? "0");
    if ((_f = (_e = allocation.allocatedAmountSet) == null ? void 0 : _e.shopMoney) == null ? void 0 : _f.currencyCode) {
      resolvedCurrency = allocation.allocatedAmountSet.shopMoney.currencyCode;
    }
    if (app2.__typename === APP_ORIGIN_TYPENAME$1) {
      if (!blocked) {
        existingIsOurs = true;
      }
      const decoded = decodeTag$1(app2.description);
      if (decoded) {
        tag = decoded;
      } else {
        tag = {
          checkoutAmount: 0,
          productAmount: allocatedAmount,
          orderAmount: 0,
          label: app2.description ?? ""
        };
      }
    } else if (app2.targetSelection === "ALL") {
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: tag.productAmount,
        orderAmount: tag.orderAmount,
        label: app2.description || "Checkout discount"
      };
    } else {
      existingIsOurs = false;
      blocked = true;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: 0,
        orderAmount: 0,
        label: app2.description || "Checkout discount"
      };
    }
  }
  return {
    currencyCode: resolvedCurrency,
    existingApplicationId,
    existingIsOurs,
    blocked,
    tag
  };
}
async function resolveDiscountCode$1(admin, code) {
  var _a2, _b, _c, _d, _e, _f, _g;
  const res = await admin.graphql(`#graphql
    query LookupDiscountCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            status
            title
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
              items {
                __typename
                ... on AllDiscountItems {
                  allItems
                }
                ... on DiscountProducts {
                  productVariants(first: 250) { nodes { id } }
                  products(first: 250) { nodes { id } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { nodes { id } }
                }
              }
            }
          }
        }
      }
    }`, {
    variables: {
      code: code.trim().toUpperCase()
    }
  });
  const json = await res.json();
  const node = (_a2 = json.data) == null ? void 0 : _a2.codeDiscountNodeByCode;
  if (!node) {
    return {
      ok: false,
      message: `Discount code "${code}" was not found.`
    };
  }
  const codeDiscount = node.codeDiscount;
  if ((codeDiscount == null ? void 0 : codeDiscount.__typename) !== "DiscountCodeBasic") {
    return {
      ok: false,
      message: `Discount code "${code}" is not a supported type.`
    };
  }
  if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
    return {
      ok: false,
      message: `Discount code "${code}" is ${String(codeDiscount.status).toLowerCase()}.`
    };
  }
  const items = (_b = codeDiscount.customerGets) == null ? void 0 : _b.items;
  if (!items || items.__typename === "AllDiscountItems") {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`
    };
  }
  const variantIds = new Set((((_c = items.productVariants) == null ? void 0 : _c.nodes) ?? []).map((n) => n.id));
  const productIds = new Set((((_d = items.products) == null ? void 0 : _d.nodes) ?? []).map((n) => n.id));
  const collectionIds = new Set((((_e = items.collections) == null ? void 0 : _e.nodes) ?? []).map((n) => n.id));
  if (variantIds.size === 0 && productIds.size === 0 && collectionIds.size === 0) {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`
    };
  }
  const targeting = {
    type: "selection",
    variantIds,
    productIds,
    collectionIds
  };
  const value = (_f = codeDiscount.customerGets) == null ? void 0 : _f.value;
  const label2 = codeDiscount.title || code.trim().toUpperCase();
  if ((value == null ? void 0 : value.percentage) != null) {
    return {
      ok: true,
      kind: "percentage",
      percentage: value.percentage * 100,
      label: label2,
      targeting
    };
  }
  if ((_g = value == null ? void 0 : value.amount) == null ? void 0 : _g.amount) {
    return {
      ok: true,
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode,
      label: label2,
      targeting
    };
  }
  return {
    ok: false,
    message: `Discount code "${code}" does not have a supported percentage or fixed value.`
  };
}
function discountAmountAgainst$1(resolved, base) {
  if (resolved.kind === "percentage") {
    return Math.max(base * (resolved.percentage / 100), 0);
  }
  return Math.min(Math.max(parseFloat(resolved.amount) || 0, 0), base);
}
function lineItemMatchesTargeting$1(item, targeting) {
  var _a2, _b, _c, _d, _e, _f, _g;
  if (targeting.type === "order") return true;
  const variantId = (_a2 = item.variant) == null ? void 0 : _a2.id;
  const productId = (_c = (_b = item.variant) == null ? void 0 : _b.product) == null ? void 0 : _c.id;
  const collectionIds = ((_g = (_f = (_e = (_d = item.variant) == null ? void 0 : _d.product) == null ? void 0 : _e.collections) == null ? void 0 : _f.nodes) == null ? void 0 : _g.map((n) => n.id)) ?? [];
  if (variantId && targeting.variantIds.has(variantId)) return true;
  if (productId && targeting.productIds.has(productId)) return true;
  if (collectionIds.some((id) => targeting.collectionIds.has(id))) return true;
  return false;
}
async function loader$g({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$b({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  try {
    const resolved = await resolveDiscountCode$1(admin, discountCode);
    if (!resolved.ok) {
      return cors(Response.json({
        userErrors: [{
          message: resolved.message
        }]
      }, {
        status: 422
      }));
    }
    const beginRes = await admin.graphql(`#graphql
      mutation BeginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 100) {
              nodes {
                id
                quantity
                title
                variant {
                  id
                  title
                  product {
                    id
                    title
                    collections(first: 50) { nodes { id } }
                  }
                }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    description
                    targetSelection
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_b = (_a2 = beginJson.data) == null ? void 0 : _a2.orderEditBegin) == null ? void 0 : _b.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const allLineItems = ((_c = calculatedOrder.lineItems) == null ? void 0 : _c.nodes) ?? [];
    if (allLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    const targetLineItems = allLineItems.filter((item) => lineItemMatchesTargeting$1(item, resolved.targeting));
    if (targetLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: `No product eligible for discount code "${discountCode}" was found on this order.`
        }]
      }, {
        status: 422
      }));
    }
    const warnings = [];
    const appliedProducts = [];
    const skippedProducts = [];
    let appliedCount = 0;
    let replacedCount = 0;
    for (const item of targetLineItems) {
      const displayName = lineItemDisplayName$1(item);
      const state = readLineItemDiscountState$1(item);
      const originalUnit = parseFloat(((_e = (_d = item.originalUnitPriceSet) == null ? void 0 : _d.shopMoney) == null ? void 0 : _e.amount) ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const currencyCode = state.currencyCode || ((_g = (_f = item.originalUnitPriceSet) == null ? void 0 : _f.shopMoney) == null ? void 0 : _g.currencyCode) || "USD";
      const newProductAmount = discountAmountAgainst$1(resolved.kind === "percentage" ? {
        kind: "percentage",
        percentage: resolved.percentage
      } : {
        kind: "fixed",
        amount: resolved.amount
      }, originalLineTotal);
      if (state.blocked) {
        const existingAmount = state.tag.checkoutAmount;
        if (newProductAmount <= existingAmount) {
          warnings.push(`"${displayName}" already has a checkout discount worth ${existingAmount.toFixed(2)} ${currencyCode}. "${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode}, so the existing discount was kept.`);
          skippedProducts.push(displayName);
          continue;
        }
        if (state.existingApplicationId) {
          const removeRes = await admin.graphql(`#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`, {
            variables: {
              id: calculatedOrderId,
              discountApplicationId: state.existingApplicationId
            }
          });
          const removeJson = await removeRes.json();
          const removeErrors = ((_i = (_h = removeJson.data) == null ? void 0 : _h.orderEditRemoveDiscount) == null ? void 0 : _i.userErrors) ?? [];
          if (((_j = removeJson.errors) == null ? void 0 : _j.length) || removeErrors.length) {
            const rawMessage = ((_k = removeErrors[0]) == null ? void 0 : _k.message) ?? ((_m = (_l = removeJson.errors) == null ? void 0 : _l[0]) == null ? void 0 : _m.message) ?? "unknown error";
            warnings.push(`"${displayName}" has a checkout discount (${existingAmount.toFixed(2)} ${currencyCode}). Tried to replace with "${discountCode}" (${newProductAmount.toFixed(2)} ${currencyCode}) but removal failed: ${rawMessage}`);
            skippedProducts.push(displayName);
            continue;
          }
        }
      } else {
        if (state.tag.productAmount > 0 && newProductAmount <= state.tag.productAmount) {
          const existingLabel = state.tag.label ? `"${state.tag.label}"` : "The existing discount";
          warnings.push(`"${displayName}" already has ${existingLabel} applied, worth ${state.tag.productAmount.toFixed(2)} ${currencyCode}. "${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode} on this product, so the existing discount was kept.`);
          skippedProducts.push(displayName);
          continue;
        }
        if (state.existingApplicationId && state.existingIsOurs) {
          const removeRes = await admin.graphql(`#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`, {
            variables: {
              id: calculatedOrderId,
              discountApplicationId: state.existingApplicationId
            }
          });
          const removeJson = await removeRes.json();
          const removeErrors = ((_o = (_n = removeJson.data) == null ? void 0 : _n.orderEditRemoveDiscount) == null ? void 0 : _o.userErrors) ?? [];
          if (((_p = removeJson.errors) == null ? void 0 : _p.length) || removeErrors.length) {
            const rawMessage = ((_q = removeErrors[0]) == null ? void 0 : _q.message) ?? ((_s = (_r = removeJson.errors) == null ? void 0 : _r[0]) == null ? void 0 : _s.message) ?? "unknown error";
            if (/discount code/i.test(rawMessage) && /can'?t be removed/i.test(rawMessage)) {
              warnings.push(`"${displayName}" already has a discount applied — skipped.`);
            } else {
              warnings.push(`Could not update the discount on "${displayName}": ${rawMessage}.`);
            }
            skippedProducts.push(displayName);
            continue;
          }
        }
      }
      const wasReplacement = state.blocked || state.tag.productAmount > 0;
      const newTag = {
        checkoutAmount: state.blocked ? 0 : state.tag.checkoutAmount,
        productAmount: newProductAmount,
        orderAmount: state.tag.orderAmount,
        label: resolved.label
      };
      const combinedAmount = newProductAmount + state.tag.orderAmount;
      const applyRes = await admin.graphql(`#graphql
        mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId: item.id,
          discount: {
            fixedValue: {
              amount: combinedAmount.toFixed(2),
              currencyCode
            },
            description: encodeTag$1(newTag)
          }
        }
      });
      const applyJson = await applyRes.json();
      const applyErrors = ((_u = (_t = applyJson.data) == null ? void 0 : _t.orderEditAddLineItemDiscount) == null ? void 0 : _u.userErrors) ?? [];
      if (((_v = applyJson.errors) == null ? void 0 : _v.length) || applyErrors.length) {
        const rawMessage = ((_x = (_w = applyJson.errors) == null ? void 0 : _w[0]) == null ? void 0 : _x.message) ?? ((_y = applyErrors[0]) == null ? void 0 : _y.message) ?? "unknown error";
        if (state.tag.checkoutAmount > 0 && /discount/i.test(rawMessage)) {
          warnings.push(`"${displayName}" already has an order-level discount from checkout — could not add another discount on top.`);
        } else {
          warnings.push(`Could not apply the discount to "${displayName}": ${rawMessage}.`);
        }
        skippedProducts.push(displayName);
        continue;
      }
      appliedCount += 1;
      appliedProducts.push(displayName);
      if (wasReplacement) replacedCount += 1;
    }
    if (appliedCount === 0) {
      return cors(Response.json({
        success: false,
        applied: false,
        appliedCount: 0,
        appliedProducts: [],
        skippedProducts,
        discountLabel: resolved.label,
        warnings: warnings.length ? warnings : ["No eligible products found for this discount code."],
        userErrors: []
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation CommitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: `Product discount "${discountCode}" applied via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_A = (_z = commitJson.data) == null ? void 0 : _z.orderEditCommit) == null ? void 0 : _A.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    return cors(Response.json({
      success: true,
      applied: true,
      order: commitJson.data.orderEditCommit.order,
      appliedCount,
      appliedProducts,
      replacedCount,
      skippedProducts,
      discountLabel: resolved.label,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount2] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({
      userErrors: [{
        message
      }]
    }, {
      status: 500
    }));
  }
}
const route14 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$b,
  loader: loader$g
}, Symbol.toStringTag, { value: "Module" }));
const TAG_PREFIX = "@d2:";
function lineItemDisplayName(item) {
  var _a2, _b, _c;
  const productTitle = ((_b = (_a2 = item.variant) == null ? void 0 : _a2.product) == null ? void 0 : _b.title) || item.title || "this product";
  const variantTitle = (_c = item.variant) == null ? void 0 : _c.title;
  if (variantTitle && variantTitle !== "Default Title") {
    return `${productTitle} (${variantTitle})`;
  }
  return productTitle;
}
const APP_ORIGIN_TYPENAME = "ManualDiscountApplication";
function decodeTag(description) {
  if (!description || !description.startsWith(TAG_PREFIX)) return null;
  const rest = description.slice(TAG_PREFIX.length);
  const closeIdx = rest.indexOf("}");
  if (closeIdx === -1) return null;
  const raw = rest.slice(0, closeIdx + 1);
  const label2 = rest.slice(closeIdx + 1).trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      checkoutAmount: parsed.c ?? 0,
      productAmount: parsed.p ?? 0,
      orderAmount: parsed.o ?? 0,
      label: label2
    };
  } catch {
    return null;
  }
}
function encodeTag(tag) {
  const raw = JSON.stringify({
    c: round2(tag.checkoutAmount),
    p: round2(tag.productAmount),
    o: round2(tag.orderAmount)
  });
  return `${TAG_PREFIX}${raw} ${tag.label}`.trim();
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function readLineItemDiscountState(item) {
  var _a2, _b, _c, _d, _e, _f;
  const allocations = item.calculatedDiscountAllocations ?? [];
  const currencyCode = ((_b = (_a2 = item.originalUnitPriceSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.currencyCode) ?? "";
  if (allocations.length === 0) {
    return {
      currencyCode,
      existingApplicationId: null,
      existingIsOurs: false,
      blocked: false,
      tag: {
        checkoutAmount: 0,
        productAmount: 0,
        orderAmount: 0,
        label: ""
      }
    };
  }
  let existingApplicationId = null;
  let existingIsOurs = false;
  let blocked = false;
  let tag = {
    checkoutAmount: 0,
    productAmount: 0,
    orderAmount: 0,
    label: ""
  };
  let resolvedCurrency = currencyCode;
  for (const allocation of allocations) {
    const app2 = allocation.discountApplication;
    if (!app2) continue;
    existingApplicationId = app2.id;
    const allocatedAmount = parseFloat(((_d = (_c = allocation.allocatedAmountSet) == null ? void 0 : _c.shopMoney) == null ? void 0 : _d.amount) ?? "0");
    if ((_f = (_e = allocation.allocatedAmountSet) == null ? void 0 : _e.shopMoney) == null ? void 0 : _f.currencyCode) {
      resolvedCurrency = allocation.allocatedAmountSet.shopMoney.currencyCode;
    }
    if (app2.__typename === APP_ORIGIN_TYPENAME) {
      if (!blocked) {
        existingIsOurs = true;
      }
      const decoded = decodeTag(app2.description);
      if (decoded) {
        tag = decoded;
      } else {
        tag = {
          checkoutAmount: 0,
          productAmount: allocatedAmount,
          orderAmount: 0,
          label: app2.description ?? ""
        };
      }
    } else if (app2.targetSelection === "ALL") {
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: tag.productAmount,
        orderAmount: tag.orderAmount,
        label: app2.description || "Checkout discount"
      };
    } else {
      existingIsOurs = false;
      blocked = true;
      tag = {
        checkoutAmount: allocatedAmount,
        productAmount: 0,
        orderAmount: 0,
        label: app2.description || "Checkout discount"
      };
    }
  }
  return {
    currencyCode: resolvedCurrency,
    existingApplicationId,
    existingIsOurs,
    blocked,
    tag
  };
}
async function resolveDiscountCode(admin, code) {
  var _a2, _b, _c, _d, _e, _f, _g;
  const res = await admin.graphql(`#graphql
    query LookupDiscountCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            status
            title
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
              items {
                __typename
                ... on AllDiscountItems {
                  allItems
                }
                ... on DiscountProducts {
                  productVariants(first: 250) { nodes { id } }
                  products(first: 250) { nodes { id } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { nodes { id } }
                }
              }
            }
          }
        }
      }
    }`, {
    variables: {
      code: code.trim().toUpperCase()
    }
  });
  const json = await res.json();
  const node = (_a2 = json.data) == null ? void 0 : _a2.codeDiscountNodeByCode;
  if (!node) {
    return {
      ok: false,
      message: `Discount code "${code}" was not found.`
    };
  }
  const codeDiscount = node.codeDiscount;
  if ((codeDiscount == null ? void 0 : codeDiscount.__typename) !== "DiscountCodeBasic") {
    return {
      ok: false,
      message: `Discount code "${code}" is not a supported type.`
    };
  }
  if (codeDiscount.status && codeDiscount.status !== "ACTIVE") {
    return {
      ok: false,
      message: `Discount code "${code}" is ${String(codeDiscount.status).toLowerCase()}.`
    };
  }
  const items = (_b = codeDiscount.customerGets) == null ? void 0 : _b.items;
  if (!items || items.__typename === "AllDiscountItems") {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`
    };
  }
  const variantIds = new Set((((_c = items.productVariants) == null ? void 0 : _c.nodes) ?? []).map((n) => n.id));
  const productIds = new Set((((_d = items.products) == null ? void 0 : _d.nodes) ?? []).map((n) => n.id));
  const collectionIds = new Set((((_e = items.collections) == null ? void 0 : _e.nodes) ?? []).map((n) => n.id));
  if (variantIds.size === 0 && productIds.size === 0 && collectionIds.size === 0) {
    return {
      ok: false,
      message: `"${code}" is an order-level discount code. Only product-level discount codes can be applied here.`
    };
  }
  const targeting = {
    type: "selection",
    variantIds,
    productIds,
    collectionIds
  };
  const value = (_f = codeDiscount.customerGets) == null ? void 0 : _f.value;
  const label2 = codeDiscount.title || code.trim().toUpperCase();
  if ((value == null ? void 0 : value.percentage) != null) {
    return {
      ok: true,
      kind: "percentage",
      percentage: value.percentage * 100,
      label: label2,
      targeting
    };
  }
  if ((_g = value == null ? void 0 : value.amount) == null ? void 0 : _g.amount) {
    return {
      ok: true,
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: value.amount.currencyCode,
      label: label2,
      targeting
    };
  }
  return {
    ok: false,
    message: `Discount code "${code}" does not have a supported percentage or fixed value.`
  };
}
function discountAmountAgainst(resolved, base) {
  if (resolved.kind === "percentage") {
    return Math.max(base * (resolved.percentage / 100), 0);
  }
  return Math.min(Math.max(parseFloat(resolved.amount) || 0, 0), base);
}
function lineItemMatchesTargeting(item, targeting) {
  var _a2, _b, _c, _d, _e, _f, _g;
  if (targeting.type === "order") return true;
  const variantId = (_a2 = item.variant) == null ? void 0 : _a2.id;
  const productId = (_c = (_b = item.variant) == null ? void 0 : _b.product) == null ? void 0 : _c.id;
  const collectionIds = ((_g = (_f = (_e = (_d = item.variant) == null ? void 0 : _d.product) == null ? void 0 : _e.collections) == null ? void 0 : _f.nodes) == null ? void 0 : _g.map((n) => n.id)) ?? [];
  if (variantId && targeting.variantIds.has(variantId)) return true;
  if (productId && targeting.productIds.has(productId)) return true;
  if (collectionIds.some((id) => targeting.collectionIds.has(id))) return true;
  return false;
}
async function loader$f({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$a({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    discountCode,
    source
  } = body || {};
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  try {
    const resolved = await resolveDiscountCode(admin, discountCode);
    if (!resolved.ok) {
      return cors(Response.json({
        userErrors: [{
          message: resolved.message
        }]
      }, {
        status: 422
      }));
    }
    const beginRes = await admin.graphql(`#graphql
      mutation BeginEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 100) {
              nodes {
                id
                quantity
                title
                variant {
                  id
                  title
                  product {
                    id
                    title
                    collections(first: 50) { nodes { id } }
                  }
                }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                calculatedDiscountAllocations {
                  allocatedAmountSet { shopMoney { amount currencyCode } }
                  discountApplication {
                    id
                    __typename
                    description
                    targetSelection
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_b = (_a2 = beginJson.data) == null ? void 0 : _a2.orderEditBegin) == null ? void 0 : _b.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const allLineItems = ((_c = calculatedOrder.lineItems) == null ? void 0 : _c.nodes) ?? [];
    if (allLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "This order has no line items to discount."
        }]
      }, {
        status: 422
      }));
    }
    const targetLineItems = allLineItems.filter((item) => lineItemMatchesTargeting(item, resolved.targeting));
    if (targetLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: `No product eligible for discount code "${discountCode}" was found on this order.`
        }]
      }, {
        status: 422
      }));
    }
    const warnings = [];
    const appliedProducts = [];
    const skippedProducts = [];
    let appliedCount = 0;
    let replacedCount = 0;
    for (const item of targetLineItems) {
      const displayName = lineItemDisplayName(item);
      const state = readLineItemDiscountState(item);
      const originalUnit = parseFloat(((_e = (_d = item.originalUnitPriceSet) == null ? void 0 : _d.shopMoney) == null ? void 0 : _e.amount) ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const currencyCode = state.currencyCode || ((_g = (_f = item.originalUnitPriceSet) == null ? void 0 : _f.shopMoney) == null ? void 0 : _g.currencyCode) || "USD";
      const newProductAmount = discountAmountAgainst(resolved.kind === "percentage" ? {
        kind: "percentage",
        percentage: resolved.percentage
      } : {
        kind: "fixed",
        amount: resolved.amount
      }, originalLineTotal);
      if (state.blocked) {
        const existingAmount = state.tag.checkoutAmount;
        if (newProductAmount <= existingAmount) {
          warnings.push(`"${displayName}" already has a checkout discount worth ${existingAmount.toFixed(2)} ${currencyCode}. "${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode}, so the existing discount was kept.`);
          skippedProducts.push(displayName);
          continue;
        }
        if (state.existingApplicationId) {
          const removeRes = await admin.graphql(`#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`, {
            variables: {
              id: calculatedOrderId,
              discountApplicationId: state.existingApplicationId
            }
          });
          const removeJson = await removeRes.json();
          const removeErrors = ((_i = (_h = removeJson.data) == null ? void 0 : _h.orderEditRemoveDiscount) == null ? void 0 : _i.userErrors) ?? [];
          if (((_j = removeJson.errors) == null ? void 0 : _j.length) || removeErrors.length) {
            const rawMessage = ((_k = removeErrors[0]) == null ? void 0 : _k.message) ?? ((_m = (_l = removeJson.errors) == null ? void 0 : _l[0]) == null ? void 0 : _m.message) ?? "unknown error";
            warnings.push(`"${displayName}" already has a discount that was applied during checkout and cannot be replaced or removed. Please contact support if you need to change the discount on this product.`);
            skippedProducts.push(displayName);
            continue;
          }
        }
      } else {
        if (state.tag.productAmount > 0 && newProductAmount <= state.tag.productAmount) {
          const existingLabel = state.tag.label ? `"${state.tag.label}"` : "The existing discount";
          warnings.push(`"${displayName}" already has ${existingLabel} applied, worth ${state.tag.productAmount.toFixed(2)} ${currencyCode}. "${discountCode}" would only be worth ${newProductAmount.toFixed(2)} ${currencyCode} on this product, so the existing discount was kept.`);
          skippedProducts.push(displayName);
          continue;
        }
        if (state.existingApplicationId && state.existingIsOurs) {
          const removeRes = await admin.graphql(`#graphql
            mutation RemoveDiscount($id: ID!, $discountApplicationId: ID!) {
              orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
                userErrors { field message }
              }
            }`, {
            variables: {
              id: calculatedOrderId,
              discountApplicationId: state.existingApplicationId
            }
          });
          const removeJson = await removeRes.json();
          const removeErrors = ((_o = (_n = removeJson.data) == null ? void 0 : _n.orderEditRemoveDiscount) == null ? void 0 : _o.userErrors) ?? [];
          if (((_p = removeJson.errors) == null ? void 0 : _p.length) || removeErrors.length) {
            const rawMessage = ((_q = removeErrors[0]) == null ? void 0 : _q.message) ?? ((_s = (_r = removeJson.errors) == null ? void 0 : _r[0]) == null ? void 0 : _s.message) ?? "unknown error";
            if (/discount code/i.test(rawMessage) && /can'?t be removed/i.test(rawMessage)) {
              warnings.push(`"${displayName}" already has a discount applied — skipped.`);
            } else {
              warnings.push(`Could not update the discount on "${displayName}": ${rawMessage}.`);
            }
            skippedProducts.push(displayName);
            continue;
          }
        }
      }
      const wasReplacement = state.blocked || state.tag.productAmount > 0;
      const newTag = {
        checkoutAmount: state.blocked ? 0 : state.tag.checkoutAmount,
        productAmount: newProductAmount,
        orderAmount: state.tag.orderAmount,
        label: resolved.label
      };
      const combinedAmount = newProductAmount + state.tag.orderAmount;
      const applyRes = await admin.graphql(`#graphql
        mutation ApplyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId: item.id,
          discount: {
            fixedValue: {
              amount: combinedAmount.toFixed(2),
              currencyCode
            },
            description: encodeTag(newTag)
          }
        }
      });
      const applyJson = await applyRes.json();
      const applyErrors = ((_u = (_t = applyJson.data) == null ? void 0 : _t.orderEditAddLineItemDiscount) == null ? void 0 : _u.userErrors) ?? [];
      if (((_v = applyJson.errors) == null ? void 0 : _v.length) || applyErrors.length) {
        const rawMessage = ((_x = (_w = applyJson.errors) == null ? void 0 : _w[0]) == null ? void 0 : _x.message) ?? ((_y = applyErrors[0]) == null ? void 0 : _y.message) ?? "unknown error";
        if (state.tag.checkoutAmount > 0 && /discount/i.test(rawMessage)) {
          warnings.push(`"${displayName}" already has an order-level discount from checkout — could not add another discount on top.`);
        } else {
          warnings.push(`Could not apply the discount to "${displayName}": ${rawMessage}.`);
        }
        skippedProducts.push(displayName);
        continue;
      }
      appliedCount += 1;
      appliedProducts.push(displayName);
      if (wasReplacement) replacedCount += 1;
    }
    if (appliedCount === 0) {
      return cors(Response.json({
        success: false,
        applied: false,
        appliedCount: 0,
        appliedProducts: [],
        skippedProducts,
        discountLabel: resolved.label,
        warnings: warnings.length ? warnings : ["No eligible products found for this discount code."],
        userErrors: []
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation CommitEdit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            statusPageUrl
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: `Product discount "${discountCode}" applied via customer account`
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_A = (_z = commitJson.data) == null ? void 0 : _z.orderEditCommit) == null ? void 0 : _A.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "apply-discount",
      source
    });
    return cors(Response.json({
      success: true,
      applied: true,
      order: commitJson.data.orderEditCommit.order,
      appliedCount,
      appliedProducts,
      replacedCount,
      skippedProducts,
      discountLabel: resolved.label,
      warnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount2] Unexpected error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return cors(Response.json({
      userErrors: [{
        message
      }]
    }, {
      status: 500
    }));
  }
}
const route15 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$a,
  loader: loader$f
}, Symbol.toStringTag, { value: "Module" }));
const LINK_TTL_MS = 5 * 60 * 1e3;
function getSecret() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("SHOPIFY_API_SECRET is not configured");
  }
  return secret;
}
function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}
function buildSignedInvoiceUrl(appUrl, params) {
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
function verifySignedInvoiceUrl(searchParams) {
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
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }
  return { shop, orderId, customerId, expires };
}
const ORDER_INVOICE_QUERY = `#graphql
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
function formatMoney(money2, fallbackCurrency) {
  if (!money2) return "";
  const amount = Number(money2.amount || 0).toFixed(2);
  return `${amount} ${money2.currencyCode || fallbackCurrency || ""}`.trim();
}
function formatAddress(address) {
  if (!address) return [];
  const lines = [];
  if (address.name) lines.push(address.name);
  if (address.address1) lines.push(address.address1);
  if (address.address2) lines.push(address.address2);
  const cityLine = [address.city, address.province, address.zip].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (address.country) lines.push(address.country);
  return lines;
}
function generateInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const currency = order.currencyCode;
      const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString(void 0, {
        year: "numeric",
        month: "long",
        day: "numeric"
      }) : "";
      doc.fontSize(22).font("Helvetica-Bold").text("Invoice", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica").text(`Order: ${order.name}`).text(orderDate ? `Date: ${orderDate}` : "");
      doc.moveDown();
      const customerName = [(_a2 = order.customer) == null ? void 0 : _a2.firstName, (_b = order.customer) == null ? void 0 : _b.lastName].filter(Boolean).join(" ");
      const customerEmail = ((_c = order.customer) == null ? void 0 : _c.email) || order.email || "";
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
      const tableTop = doc.y;
      const col = { name: 50, qty: 320, price: 390, total: 470 };
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Item", col.name, tableTop);
      doc.text("Qty", col.qty, tableTop);
      doc.text("Price", col.price, tableTop);
      doc.text("Total", col.total, tableTop);
      doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor("#cccccc").stroke();
      doc.font("Helvetica").fontSize(10);
      let rowY = tableTop + 22;
      const items = (((_d = order.lineItems) == null ? void 0 : _d.edges) ?? []).filter(
        ({ node }) => node.currentQuantity > 0
      );
      for (const { node } of items) {
        if (rowY > 720) {
          doc.addPage();
          rowY = 50;
        }
        const unitPrice = (_e = node.originalUnitPriceSet) == null ? void 0 : _e.shopMoney;
        const currentTotal = unitPrice ? {
          amount: (Number(unitPrice.amount) * node.currentQuantity).toFixed(2),
          currencyCode: unitPrice.currencyCode
        } : null;
        doc.text(node.name, col.name, rowY, { width: 260 });
        doc.text(String(node.currentQuantity), col.qty, rowY);
        doc.text(formatMoney(unitPrice, currency), col.price, rowY);
        doc.text(formatMoney(currentTotal, currency), col.total, rowY);
        rowY += 18;
      }
      doc.moveTo(50, rowY + 4).lineTo(545, rowY + 4).strokeColor("#cccccc").stroke();
      let totalsY = rowY + 16;
      const totalsRow = (label2, value, bold = false) => {
        if (!value) return;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        doc.text(label2, col.price - 60, totalsY);
        doc.text(formatMoney(value, currency), col.total, totalsY);
        totalsY += 16;
      };
      totalsRow("Subtotal", (_f = order.currentSubtotalPriceSet) == null ? void 0 : _f.shopMoney);
      totalsRow("Shipping", (_g = order.totalShippingPriceSet) == null ? void 0 : _g.shopMoney);
      totalsRow("Tax", (_h = order.currentTotalTaxSet) == null ? void 0 : _h.shopMoney);
      if (((_i = order.currentTotalDiscountsSet) == null ? void 0 : _i.shopMoney) && Number(order.currentTotalDiscountsSet.shopMoney.amount) > 0) {
        totalsRow("Discounts", (_j = order.currentTotalDiscountsSet) == null ? void 0 : _j.shopMoney);
      }
      totalsRow("Total", (_k = order.currentTotalPriceSet) == null ? void 0 : _k.shopMoney, true);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
async function loader$e({
  request
}) {
  var _a2, _b;
  const url = new URL(request.url);
  const verified = verifySignedInvoiceUrl(url.searchParams);
  if (!verified) {
    return new Response("This invoice link is invalid or has expired.", {
      status: 403,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
  const {
    shop,
    orderId,
    customerId
  } = verified;
  try {
    const {
      admin
    } = await unauthenticated.admin(shop);
    const response = await admin.graphql(ORDER_INVOICE_QUERY, {
      variables: {
        id: orderId
      }
    });
    const json = await response.json();
    const order = (_a2 = json.data) == null ? void 0 : _a2.order;
    if (!order) {
      return new Response("Order not found.", {
        status: 404,
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
    const numericId = (gidOrId) => {
      var _a3;
      return (_a3 = gidOrId == null ? void 0 : gidOrId.match(/\d+$/)) == null ? void 0 : _a3[0];
    };
    if (!((_b = order.customer) == null ? void 0 : _b.id) || numericId(order.customer.id) !== numericId(customerId)) {
      return new Response("Not authorized to access this order.", {
        status: 403,
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
    const pdfBuffer = await generateInvoicePdf(order);
    const filename = `invoice-${order.name.replace(/[^a-zA-Z0-9-_]/g, "")}.pdf`;
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // "inline" lets the browser open/preview it in the new tab rather
        // than forcing a save dialog, matching the previous window.open UX.
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("[invoice-link] Unexpected error:", err);
    return new Response("Failed to generate invoice.", {
      status: 500,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
}
const route16 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$e
}, Symbol.toStringTag, { value: "Module" }));
async function loader$d({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$9({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L, _M, _N, _O, _P, _Q;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const {
    orderId,
    discountCode,
    variantIds
  } = await request.json();
  if (!orderId || !discountCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or discountCode."
      }]
    }, {
      status: 400
    }));
  }
  const targetVariantIds = Array.isArray(variantIds) && variantIds.length > 0 ? variantIds : null;
  try {
    let encodeInvisiblePayload = function(payload) {
      const bytes = Array.from(new TextEncoder().encode(payload));
      const chars = [];
      for (const b of bytes) {
        chars.push(ZW_B4[b >> 6 & 3]);
        chars.push(ZW_B4[b >> 4 & 3]);
        chars.push(ZW_B4[b >> 2 & 3]);
        chars.push(ZW_B4[b & 3]);
      }
      return `${ZW_MARK_NEW}${chars.join("")}${ZW_MARK_NEW}`;
    }, decodeBase4 = function(zwChars) {
      const charArr = Array.from(zwChars);
      const byteCount = Math.floor(charArr.length / 4);
      const bytes = new Uint8Array(byteCount);
      for (let i = 0; i < byteCount; i++) {
        const a = ZW_B4_MAP[charArr[i * 4]] ?? 0;
        const b = ZW_B4_MAP[charArr[i * 4 + 1]] ?? 0;
        const c = ZW_B4_MAP[charArr[i * 4 + 2]] ?? 0;
        const d = ZW_B4_MAP[charArr[i * 4 + 3]] ?? 0;
        bytes[i] = a << 6 | b << 4 | c << 2 | d;
      }
      try {
        return new TextDecoder().decode(bytes);
      } catch {
        return null;
      }
    }, decodeOldBinary = function(zwChars) {
      const bits = Array.from(zwChars, (ch) => ch === "‌" ? "1" : "0").join("");
      const byteCount = Math.floor(bits.length / 8);
      const bytes = new Uint8Array(byteCount);
      for (let i = 0; i < byteCount; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
      try {
        return new TextDecoder().decode(bytes);
      } catch {
        return null;
      }
    }, extractInvisiblePayload = function(text2) {
      let start = text2.indexOf(ZW_MARK_NEW);
      if (start !== -1) {
        const end = text2.indexOf(ZW_MARK_NEW, start + 1);
        if (end !== -1) {
          const payload = decodeBase4(text2.slice(start + 1, end));
          const visible = text2.slice(0, start) + text2.slice(end + 1);
          return {
            visible,
            payload
          };
        }
      }
      start = text2.indexOf(ZW_MARK_OLD);
      if (start !== -1) {
        const end = text2.indexOf(ZW_MARK_OLD, start + 1);
        if (end !== -1) {
          const payload = decodeOldBinary(text2.slice(start + 1, end));
          const visible = text2.slice(0, start) + text2.slice(end + 1);
          return {
            visible,
            payload
          };
        }
      }
      return {
        visible: text2,
        payload: null
      };
    }, formatPercentForDisplay = function(percent) {
      return (Math.round(percent * 100) / 100).toString();
    }, formatEntryForDisplay = function(entry2, currencyCode) {
      if (typeof entry2.percent === "number") {
        return `${entry2.code} ${formatPercentForDisplay(entry2.percent)}%`;
      }
      return currencyCode ? `${entry2.code} ${entry2.amount.toFixed(2)} ${currencyCode}` : entry2.code;
    }, parseTaggedDescription = function(description) {
      if (!description) return {
        entries: [],
        label: ""
      };
      const {
        visible,
        payload
      } = extractInvisiblePayload(description);
      if (!payload) return {
        entries: [],
        label: visible
      };
      const entries = payload.split("|").filter(Boolean).map((part) => {
        const [code, scope, amount, percent] = part.split(":");
        const entry2 = {
          code,
          scope: scope === "P" ? "P" : "O",
          amount: parseFloat(amount) || 0
        };
        if (percent !== void 0 && percent !== "") {
          const parsedPercent = parseFloat(percent);
          if (!Number.isNaN(parsedPercent)) entry2.percent = parsedPercent;
        }
        return entry2;
      });
      return {
        entries,
        label: visible
      };
    }, buildTaggedDescription = function(entries, visibleLabel) {
      const tag = entries.map((e) => `${e.code}:${e.scope}:${e.amount.toFixed(2)}:${e.percent != null ? e.percent.toFixed(2) : ""}`).join("|");
      const full = `${visibleLabel}${encodeInvisiblePayload(tag)}`;
      if (full.length > 255) {
        console.warn(`[order-discount] Tagged description too long (${full.length} chars), falling back to visible label only.`);
        return visibleLabel.slice(0, 255);
      }
      return full;
    };
    const discountRes = await admin.graphql(`#graphql
      query validateDiscount($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          id
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              status
              shortSummary
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount currencyCode } }
                }
                items {
                  __typename
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts {
                    products(first: 250) { nodes { id } }
                    productVariants(first: 250) { nodes { id } }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) { nodes { id } }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy { status }
            ... on DiscountCodeFreeShipping { status }
          }
        }
      }`, {
      variables: {
        code: discountCode.trim().toUpperCase()
      }
    });
    const discountJson = await discountRes.json();
    const discountNode = (_a2 = discountJson.data) == null ? void 0 : _a2.codeDiscountNodeByCode;
    if (!discountNode) {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" not found.`
        }]
      }, {
        status: 404
      }));
    }
    const codeDiscount = discountNode.codeDiscount;
    if ((codeDiscount == null ? void 0 : codeDiscount.status) && codeDiscount.status !== "ACTIVE") {
      return cors(Response.json({
        userErrors: [{
          message: `Discount code "${discountCode}" is ${codeDiscount.status.toLowerCase()}.`
        }]
      }, {
        status: 422
      }));
    }
    let discountInput = null;
    if ((codeDiscount == null ? void 0 : codeDiscount.__typename) === "DiscountCodeBasic") {
      const value = (_b = codeDiscount.customerGets) == null ? void 0 : _b.value;
      if ((value == null ? void 0 : value.percentage) != null) {
        discountInput = {
          percentValue: value.percentage * 100,
          // API expects 0-100
          description: codeDiscount.shortSummary || discountCode.trim().toUpperCase()
        };
      } else if ((_c = value == null ? void 0 : value.amount) == null ? void 0 : _c.amount) {
        discountInput = {
          fixedValue: {
            amount: value.amount.amount,
            currencyCode: value.amount.currencyCode
          },
          description: codeDiscount.shortSummary || discountCode.trim().toUpperCase()
        };
      }
    }
    if (!discountInput) {
      return cors(Response.json({
        userErrors: [{
          message: "This discount type is not supported (only percentage and fixed-amount codes are accepted)."
        }]
      }, {
        status: 422
      }));
    }
    let eligibility = {
      type: "all"
    };
    if ((codeDiscount == null ? void 0 : codeDiscount.__typename) === "DiscountCodeBasic") {
      const items = (_d = codeDiscount.customerGets) == null ? void 0 : _d.items;
      if ((items == null ? void 0 : items.__typename) === "DiscountProducts") {
        eligibility = {
          type: "restricted",
          productIds: new Set((((_e = items.products) == null ? void 0 : _e.nodes) ?? []).map((p) => p.id)),
          variantIds: new Set((((_f = items.productVariants) == null ? void 0 : _f.nodes) ?? []).map((v) => v.id))
        };
      } else if ((items == null ? void 0 : items.__typename) === "DiscountCollections") {
        const collectionIds = (((_g = items.collections) == null ? void 0 : _g.nodes) ?? []).map((c) => c.id);
        const productIds = /* @__PURE__ */ new Set();
        for (const collectionId of collectionIds) {
          const collRes = await admin.graphql(`#graphql
            query collectionProducts($id: ID!) {
              collection(id: $id) {
                products(first: 250) { nodes { id } }
              }
            }`, {
            variables: {
              id: collectionId
            }
          });
          const collJson = await collRes.json();
          const productNodes = ((_j = (_i = (_h = collJson.data) == null ? void 0 : _h.collection) == null ? void 0 : _i.products) == null ? void 0 : _j.nodes) ?? [];
          for (const p of productNodes) productIds.add(p.id);
        }
        eligibility = {
          type: "restricted",
          productIds,
          variantIds: /* @__PURE__ */ new Set()
        };
      }
    }
    const beginRes = await admin.graphql(`#graphql
      mutation orderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            lineItems(first: 50) {
              nodes {
                id
                quantity
                variant { id product { id title } }
                originalUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                calculatedDiscountAllocations {
                  allocatedAmountSet {
                    shopMoney { amount currencyCode }
                  }
                  discountApplication {
                    __typename
                    id
                    description
                    allocationMethod
                    targetSelection
                    targetType
                    value {
                      ... on PricingPercentageValue {
                        percentage
                      }
                      ... on MoneyV2 {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_l = (_k = beginJson.data) == null ? void 0 : _k.orderEditBegin) == null ? void 0 : _l.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const allLineItems = ((_m = calculatedOrder.lineItems) == null ? void 0 : _m.nodes) ?? [];
    if (allLineItems.length === 0) {
      return cors(Response.json({
        userErrors: [{
          message: "No line items found to apply the discount to."
        }]
      }, {
        status: 422
      }));
    }
    let lineItems = allLineItems;
    const ZW_B4 = ["​", "‌", "⁠", "⁢"];
    const ZW_B4_MAP = {
      "​": 0,
      "‌": 1,
      "⁠": 2,
      "⁢": 3
    };
    const ZW_MARK_NEW = "\uFEFF";
    const ZW_MARK_OLD = "‍";
    if (targetVariantIds) {
      const targetSet = new Set(targetVariantIds);
      lineItems = allLineItems.filter((item) => {
        var _a3;
        return ((_a3 = item.variant) == null ? void 0 : _a3.id) && targetSet.has(item.variant.id);
      });
      if (lineItems.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: "The selected product(s) could not be found on this order."
          }]
        }, {
          status: 422
        }));
      }
    }
    const skipWarnings = [];
    if (eligibility.type === "restricted") {
      const eligibleItems = [];
      const ineligibleItems = [];
      for (const item of lineItems) {
        const variantId = (_n = item.variant) == null ? void 0 : _n.id;
        const productId = (_p = (_o = item.variant) == null ? void 0 : _o.product) == null ? void 0 : _p.id;
        const isEligible = !!variantId && eligibility.variantIds.has(variantId) || !!productId && eligibility.productIds.has(productId);
        (isEligible ? eligibleItems : ineligibleItems).push(item);
      }
      if (ineligibleItems.length > 0) {
        const productTitles = Array.from(new Set(ineligibleItems.map((item) => {
          var _a3, _b2;
          return ((_b2 = (_a3 = item.variant) == null ? void 0 : _a3.product) == null ? void 0 : _b2.title) || "a selected product";
        })));
        skipWarnings.push(`The discount code "${discountCode.trim().toUpperCase()}" is not available for: ${productTitles.join(", ")}.`);
      }
      lineItems = eligibleItems;
      if (lineItems.length === 0) {
        return cors(Response.json({
          userErrors: [{
            message: skipWarnings[0]
          }]
        }, {
          status: 422
        }));
      }
    }
    const existingDiscountApplicationIds = /* @__PURE__ */ new Set();
    const discountAppIdsByLineItemId = /* @__PURE__ */ new Map();
    const combineInfoByLineItemId = /* @__PURE__ */ new Map();
    const requestScope = targetVariantIds ? "P" : "O";
    for (const item of lineItems) {
      const allocations = item.calculatedDiscountAllocations ?? [];
      const entries = [];
      let currencyCode = ((_r = (_q = item.originalUnitPriceSet) == null ? void 0 : _q.shopMoney) == null ? void 0 : _r.currencyCode) ?? "";
      const itemRemovableAppIds = /* @__PURE__ */ new Set();
      let unremovableCheckoutDiscountTotal = 0;
      const originalUnit = parseFloat(((_t = (_s = item.originalUnitPriceSet) == null ? void 0 : _s.shopMoney) == null ? void 0 : _t.amount) ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      for (const allocation of allocations) {
        const app2 = allocation.discountApplication;
        if (!app2) continue;
        const allocatedAmount = parseFloat(((_v = (_u = allocation.allocatedAmountSet) == null ? void 0 : _u.shopMoney) == null ? void 0 : _v.amount) ?? "0");
        if ((_x = (_w = allocation.allocatedAmountSet) == null ? void 0 : _w.shopMoney) == null ? void 0 : _x.currencyCode) {
          currencyCode = allocation.allocatedAmountSet.shopMoney.currencyCode;
        }
        const isRemovable = app2.__typename === "OrderEditAppliedDiscount";
        if (isRemovable && app2.id) {
          existingDiscountApplicationIds.add(app2.id);
          itemRemovableAppIds.add(app2.id);
        } else {
          unremovableCheckoutDiscountTotal += allocatedAmount;
        }
        const {
          entries: parsedEntries
        } = parseTaggedDescription(app2.description);
        if (parsedEntries.length > 0) {
          entries.push(...parsedEntries);
        } else {
          const code = (app2.description || "CHECKOUT_DISCOUNT").trim().toUpperCase();
          const scope = app2.targetSelection === "ALL" ? "O" : "P";
          let percent = void 0;
          if (((_y = app2.value) == null ? void 0 : _y.percentage) != null) {
            percent = app2.value.percentage;
          } else if (originalLineTotal > 0 && allocatedAmount > 0) {
            percent = Math.round(allocatedAmount / originalLineTotal * 1e4) / 100;
          }
          entries.push({
            code,
            scope,
            amount: allocatedAmount,
            percent,
            isCheckout: !isRemovable
          });
        }
      }
      if (itemRemovableAppIds.size > 0) discountAppIdsByLineItemId.set(item.id, itemRemovableAppIds);
      if (entries.length > 0 || unremovableCheckoutDiscountTotal > 0) {
        combineInfoByLineItemId.set(item.id, {
          entries,
          currencyCode,
          unremovableCheckoutDiscountTotal
        });
      }
    }
    const normalizedRequestedCode = discountCode.trim().toUpperCase();
    const alreadyAppliedItemIds = /* @__PURE__ */ new Set();
    for (const [itemId, info] of combineInfoByLineItemId) {
      if (info.entries.some((e) => e.code.trim().toUpperCase() === normalizedRequestedCode)) {
        alreadyAppliedItemIds.add(itemId);
      }
    }
    if (alreadyAppliedItemIds.size > 0) {
      return cors(Response.json({
        userErrors: [{
          message: targetVariantIds ? `The discount code "${discountCode}" is already applied to the selected product(s).` : `The discount code "${discountCode}" is already applied to this order.`
        }]
      }, {
        status: 422
      }));
    }
    if (requestScope === "P") {
      const checkoutBlockedProducts = [];
      for (const item of lineItems) {
        const combineInfo = combineInfoByLineItemId.get(item.id);
        if (!combineInfo) continue;
        const hasCheckoutProductDiscount = combineInfo.entries.some((e) => e.isCheckout && e.scope === "P");
        if (hasCheckoutProductDiscount) {
          const productTitle = ((_A = (_z = item.variant) == null ? void 0 : _z.product) == null ? void 0 : _A.title) || "a selected product";
          checkoutBlockedProducts.push(productTitle);
        }
      }
      if (checkoutBlockedProducts.length > 0) {
        const uniqueTitles = Array.from(new Set(checkoutBlockedProducts));
        return cors(Response.json({
          userErrors: [{
            message: uniqueTitles.length === 1 ? `"${uniqueTitles[0]}" already has a product discount applied from checkout. This discount cannot be replaced or overridden.` : `The following products already have a product discount applied from checkout and cannot be replaced or overridden: ${uniqueTitles.join(", ")}.`
          }]
        }, {
          status: 422
        }));
      }
    }
    const skippedItemIds = /* @__PURE__ */ new Set();
    if (requestScope === "P" && typeof discountInput.percentValue === "number") {
      for (const item of lineItems) {
        const combineInfo = combineInfoByLineItemId.get(item.id);
        if (!combineInfo) continue;
        const productEntries = combineInfo.entries.filter((e) => e.scope === "P");
        if (productEntries.length === 0) continue;
        const allComparable = productEntries.every((e) => typeof e.percent === "number");
        if (!allComparable) continue;
        let bestExisting = productEntries[0];
        for (const entry2 of productEntries) {
          if (entry2.percent > bestExisting.percent) bestExisting = entry2;
        }
        const bestExistingPercent = bestExisting.percent;
        if (discountInput.percentValue <= bestExistingPercent) {
          skippedItemIds.add(item.id);
          skipWarnings.push(`The discount code "${normalizedRequestedCode}" (${discountInput.percentValue}%) is not greater than "${bestExisting.code}" (${bestExistingPercent}%), which is already applied to this product. The existing discount was kept.`);
        }
      }
    }
    const removableDiscountApplicationIds = /* @__PURE__ */ new Set();
    for (const item of lineItems) {
      if (skippedItemIds.has(item.id)) continue;
      const ids = discountAppIdsByLineItemId.get(item.id);
      if (ids) for (const id of ids) removableDiscountApplicationIds.add(id);
    }
    let replacedDiscount = false;
    for (const discountApplicationId of removableDiscountApplicationIds) {
      const removeRes = await admin.graphql(`#graphql
        mutation removeDiscount($id: ID!, $discountApplicationId: ID!) {
          orderEditRemoveDiscount(id: $id, discountApplicationId: $discountApplicationId) {
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          discountApplicationId
        }
      });
      const removeJson = await removeRes.json();
      const removeErrors = ((_C = (_B = removeJson.data) == null ? void 0 : _B.orderEditRemoveDiscount) == null ? void 0 : _C.userErrors) ?? [];
      if (((_D = removeJson.errors) == null ? void 0 : _D.length) || removeErrors.length) {
        console.warn(`[order-discount] Could not remove existing discount ${discountApplicationId}:`, removeJson.errors ?? removeErrors);
        continue;
      }
      replacedDiscount = true;
    }
    let combinedCount = 0;
    let appliedCount = 0;
    let replacedForHigherDiscountCount = 0;
    const applyFailures = [];
    for (const item of lineItems) {
      if (skippedItemIds.has(item.id)) continue;
      const combineInfo = combineInfoByLineItemId.get(item.id);
      const originalUnit = parseFloat(((_F = (_E = item.originalUnitPriceSet) == null ? void 0 : _E.shopMoney) == null ? void 0 : _F.amount) ?? "0");
      const originalLineTotal = originalUnit * item.quantity;
      const newPercent = typeof discountInput.percentValue === "number" ? discountInput.percentValue : void 0;
      let itemDiscountInput;
      const unremovableCheckoutTotal = (combineInfo == null ? void 0 : combineInfo.unremovableCheckoutDiscountTotal) ?? 0;
      if (combineInfo && combineInfo.entries.length > 0) {
        const wasReplacingProductDiscount = requestScope === "P" && combineInfo.entries.some((e) => e.scope === "P");
        const survivingEntries = requestScope === "P" ? combineInfo.entries.filter((e) => e.scope === "O") : combineInfo.entries;
        const productLevelTotal = survivingEntries.filter((e) => e.scope === "P").reduce((sum, e) => sum + e.amount, 0);
        const orderLevelTotal = survivingEntries.filter((e) => e.scope === "O").reduce((sum, e) => sum + e.amount, 0);
        let newDiscountAmount = 0;
        if (requestScope === "O") {
          const baseAfterProductLevel = Math.max(originalLineTotal - productLevelTotal, 0);
          const remainingOrderLevelBudget = Math.max(baseAfterProductLevel - orderLevelTotal, 0);
          if (typeof discountInput.percentValue === "number") {
            newDiscountAmount = baseAfterProductLevel * (discountInput.percentValue / 100);
          } else if (discountInput.fixedValue) {
            const fixedAmount = parseFloat(discountInput.fixedValue.amount);
            newDiscountAmount = Math.min(fixedAmount, remainingOrderLevelBudget);
          }
          newDiscountAmount = Math.min(newDiscountAmount, remainingOrderLevelBudget);
        } else {
          const remainingAfterExisting = Math.max(originalLineTotal - (productLevelTotal + orderLevelTotal), 0);
          if (typeof discountInput.percentValue === "number") {
            newDiscountAmount = remainingAfterExisting * (discountInput.percentValue / 100);
          } else if (discountInput.fixedValue) {
            const fixedAmount = parseFloat(discountInput.fixedValue.amount);
            newDiscountAmount = Math.min(fixedAmount, remainingAfterExisting);
          }
        }
        const combinedEntries = [...survivingEntries, {
          code: normalizedRequestedCode,
          scope: requestScope,
          amount: newDiscountAmount,
          percent: newPercent
        }];
        const combinedTotal = combinedEntries.reduce((sum, e) => sum + e.amount, 0);
        const combinedLabel = combinedEntries.map((e) => formatEntryForDisplay(e, combineInfo.currencyCode)).join(" + ");
        const additionalDiscountAmount = Math.max(combinedTotal - unremovableCheckoutTotal, 0);
        if (additionalDiscountAmount <= 0) {
          if (wasReplacingProductDiscount) {
            replacedForHigherDiscountCount += 1;
          } else {
            combinedCount += 1;
          }
          appliedCount += 1;
          continue;
        }
        itemDiscountInput = {
          fixedValue: {
            amount: additionalDiscountAmount.toFixed(2),
            currencyCode: combineInfo.currencyCode
          },
          description: buildTaggedDescription(combinedEntries, combinedLabel)
        };
        if (wasReplacingProductDiscount) {
          replacedForHigherDiscountCount += 1;
        } else {
          combinedCount += 1;
        }
      } else {
        let newDiscountAmount = 0;
        if (typeof discountInput.percentValue === "number") {
          newDiscountAmount = originalLineTotal * (discountInput.percentValue / 100);
        } else if (discountInput.fixedValue) {
          const fixedAmount = parseFloat(discountInput.fixedValue.amount);
          newDiscountAmount = Math.min(fixedAmount, originalLineTotal);
        }
        const freshEntry = {
          code: normalizedRequestedCode,
          scope: requestScope,
          amount: newDiscountAmount,
          percent: newPercent
        };
        const freshCurrencyCode = ((_G = discountInput.fixedValue) == null ? void 0 : _G.currencyCode) ?? ((_I = (_H = item.originalUnitPriceSet) == null ? void 0 : _H.shopMoney) == null ? void 0 : _I.currencyCode);
        const additionalDiscountAmount = Math.max(newDiscountAmount - unremovableCheckoutTotal, 0);
        if (additionalDiscountAmount <= 0) {
          appliedCount += 1;
          continue;
        }
        itemDiscountInput = {
          fixedValue: {
            amount: additionalDiscountAmount.toFixed(2),
            currencyCode: freshCurrencyCode || "USD"
          },
          description: buildTaggedDescription([freshEntry], formatEntryForDisplay(freshEntry, freshCurrencyCode))
        };
      }
      const applyRes = await admin.graphql(`#graphql
        mutation applyDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          lineItemId: item.id,
          discount: itemDiscountInput
        }
      });
      const applyJson = await applyRes.json();
      const topLevelErrors = applyJson.errors ?? [];
      const userErrors = ((_K = (_J = applyJson.data) == null ? void 0 : _J.orderEditAddLineItemDiscount) == null ? void 0 : _K.userErrors) ?? [];
      const stagedLineItem = (_M = (_L = applyJson.data) == null ? void 0 : _L.orderEditAddLineItemDiscount) == null ? void 0 : _M.calculatedLineItem;
      if (topLevelErrors.length || userErrors.length || !stagedLineItem) {
        const rawMessage = ((_N = topLevelErrors[0]) == null ? void 0 : _N.message) ?? ((_O = userErrors[0]) == null ? void 0 : _O.message) ?? "Unknown error";
        console.warn(`[order-discount] Could not apply to line item ${item.id}:`, rawMessage);
        const message = /discount which prevents applying additional discounts/i.test(rawMessage) ? "This order already has a discount that couldn't be automatically replaced. Please remove the existing discount from the order and try again." : rawMessage;
        applyFailures.push(message);
        continue;
      }
      appliedCount += 1;
    }
    if (appliedCount === 0) {
      const message = skipWarnings[0] ?? (applyFailures[0] ? `Could not apply the discount: ${applyFailures[0]}` : "Could not apply the discount to any of the selected item(s).");
      return cors(Response.json({
        userErrors: [{
          message
        }]
      }, {
        status: 422
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation orderEditCommit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: (targetVariantIds ? `Discount code applied to ${appliedCount} selected product(s) via customer account` : "Discount code applied to entire order via customer account") + (replacedForHigherDiscountCount > 0 ? ` (replaced a lower discount with the new higher one on ${replacedForHigherDiscountCount} item(s))` : "") + (combinedCount > 0 ? ` (combined with an existing discount on ${combinedCount} item(s))` : replacedDiscount ? " (replaced a previously applied discount)" : "") + (skipWarnings.length > 0 ? ` (${skipWarnings.length} item(s) were skipped — see warnings)` : "")
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_Q = (_P = commitJson.data) == null ? void 0 : _P.orderEditCommit) == null ? void 0 : _Q.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    const order = commitJson.data.orderEditCommit.order;
    const summary = (codeDiscount == null ? void 0 : codeDiscount.shortSummary) ?? discountCode;
    return cors(Response.json({
      order,
      summary,
      replacedDiscount,
      combinedCount,
      replacedForHigherDiscountCount,
      warnings: skipWarnings,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-discount] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route17 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$9,
  loader: loader$d
}, Symbol.toStringTag, { value: "Module" }));
async function loader$c({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return cors(Response.json({
      error: "Missing orderId"
    }, {
      status: 400
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin,
    session
  } = await unauthenticated.admin(storeDomain);
  try {
    const res = await admin.graphql(`#graphql
      query getOrderShippingMethod($id: ID!) {
        order(id: $id) {
          id
          currencyCode
          shippingLine {
            id
            title
            code
            originalPriceSet {
              presentmentMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const json = await res.json();
    const order = (_a2 = json.data) == null ? void 0 : _a2.order;
    const shippingLine = (order == null ? void 0 : order.shippingLine) ?? null;
    const currencyCode = (order == null ? void 0 : order.currencyCode) || "USD";
    const currentShipping = shippingLine ? {
      title: shippingLine.title,
      code: shippingLine.code,
      amount: ((_c = (_b = shippingLine.originalPriceSet) == null ? void 0 : _b.presentmentMoney) == null ? void 0 : _c.amount) || "0.00",
      currencyCode: ((_e = (_d = shippingLine.originalPriceSet) == null ? void 0 : _d.presentmentMoney) == null ? void 0 : _e.currencyCode) || currencyCode
    } : null;
    let availableMethods = [];
    const methodsMap = /* @__PURE__ */ new Map();
    try {
      const profilesRes = await admin.graphql(`#graphql
        query getStoreDeliveryProfiles {
          deliveryProfiles(first: 20) {
            nodes {
              profileLocationGroups {
                locationGroupZones(first: 20) {
                  nodes {
                    methodDefinitions(first: 20) {
                      nodes {
                        id
                        name
                        active
                        rateProvider {
                          __typename
                          ... on DeliveryRateDefinition {
                            price {
                              amount
                            }
                          }
                          ... on DeliveryParticipant {
                            id
                            fixedFee {
                              amount
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`);
      const profilesJson = await profilesRes.json();
      const profiles = ((_g = (_f = profilesJson.data) == null ? void 0 : _f.deliveryProfiles) == null ? void 0 : _g.nodes) || [];
      for (const profile of profiles) {
        const groups = profile.profileLocationGroups || [];
        for (const group of groups) {
          const zones = ((_h = group.locationGroupZones) == null ? void 0 : _h.nodes) || [];
          for (const zone of zones) {
            const defs = ((_i = zone.methodDefinitions) == null ? void 0 : _i.nodes) || [];
            for (const def of defs) {
              const name = def.name;
              let price = 0;
              if (((_j = def.rateProvider) == null ? void 0 : _j.__typename) === "DeliveryRateDefinition" && ((_k = def.rateProvider.price) == null ? void 0 : _k.amount)) {
                price = parseFloat(def.rateProvider.price.amount);
              } else if (((_l = def.rateProvider) == null ? void 0 : _l.__typename) === "DeliveryParticipant" && ((_m = def.rateProvider.fixedFee) == null ? void 0 : _m.amount)) {
                price = parseFloat(def.rateProvider.fixedFee.amount);
              }
              if (name && !methodsMap.has(name.toLowerCase())) {
                methodsMap.set(name.toLowerCase(), {
                  id: def.id || name.toLowerCase(),
                  title: name,
                  price
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[order-shipping-loader] GraphQL deliveryProfiles fetch error:", e);
    }
    if (methodsMap.size === 0 && (session == null ? void 0 : session.accessToken)) {
      try {
        const restRes = await fetch(`https://${storeDomain}/admin/api/2026-04/shipping_zones.json`, {
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
            "Content-Type": "application/json"
          }
        });
        if (restRes.ok) {
          const restJson = await restRes.json();
          const zones = restJson.shipping_zones || [];
          for (const zone of zones) {
            const priceRates = zone.price_based_shipping_rates || [];
            const weightRates = zone.weight_based_shipping_rates || [];
            const carrierProviders = zone.carrier_shipping_rate_providers || [];
            for (const rate of [...priceRates, ...weightRates]) {
              const name = rate.name;
              const price = parseFloat(rate.price || "0.00");
              if (name && !methodsMap.has(name.toLowerCase())) {
                methodsMap.set(name.toLowerCase(), {
                  id: String(rate.id || name.toLowerCase()),
                  title: name,
                  price
                });
              }
            }
            for (const provider of carrierProviders) {
              const name = provider.service_discovery_name || provider.carrier_service_id || "Carrier Shipping";
              const price = parseFloat(provider.flat_modifier || "0.00");
              if (name && !methodsMap.has(name.toLowerCase())) {
                methodsMap.set(name.toLowerCase(), {
                  id: String(provider.id || name.toLowerCase()),
                  title: name,
                  price
                });
              }
            }
          }
        }
      } catch (restErr) {
        console.warn("[order-shipping-loader] REST shipping_zones fetch error:", restErr);
      }
    }
    availableMethods = Array.from(methodsMap.values());
    return cors(Response.json({
      currentShipping,
      currencyCode,
      availableMethods
    }));
  } catch (err) {
    console.error("[order-shipping-loader] Error:", err);
    return cors(Response.json({
      currentShipping: null,
      currencyCode: "INR",
      availableMethods: []
    }));
  }
}
async function action$8({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const customerAccountId = sessionToken.sub;
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    title,
    price,
    currencyCode = "USD"
  } = body;
  if (!orderId || !title || price === void 0 || price === null) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId, title, or price."
      }]
    }, {
      status: 400
    }));
  }
  const ownerRes = await admin.graphql(`#graphql
    query getOrderOwnerForShipping($id: ID!) {
      order(id: $id) {
        id
        customer { id }
      }
    }`, {
    variables: {
      id: orderId
    }
  });
  const ownerJson = await ownerRes.json();
  const order = (_a2 = ownerJson.data) == null ? void 0 : _a2.order;
  if (!order) {
    return cors(Response.json({
      userErrors: [{
        message: "Order not found."
      }]
    }, {
      status: 404
    }));
  }
  const numericId = (gidOrId) => {
    var _a3;
    return (_a3 = gidOrId == null ? void 0 : gidOrId.match(/\d+$/)) == null ? void 0 : _a3[0];
  };
  if (!((_b = order.customer) == null ? void 0 : _b.id) || numericId(order.customer.id) !== numericId(customerAccountId)) {
    return cors(Response.json({
      userErrors: [{
        message: "Not authorized to update this order."
      }]
    }, {
      status: 403
    }));
  }
  try {
    const beginRes = await admin.graphql(`#graphql
      mutation OrderEditBeginForShipping($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            shippingLines {
              id
              title
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const beginJson = await beginRes.json();
    const beginErrors = ((_d = (_c = beginJson.data) == null ? void 0 : _c.orderEditBegin) == null ? void 0 : _d.userErrors) ?? [];
    if (beginErrors.length) {
      return cors(Response.json({
        userErrors: beginErrors
      }, {
        status: 422
      }));
    }
    const calculatedOrder = beginJson.data.orderEditBegin.calculatedOrder;
    const calculatedOrderId = calculatedOrder.id;
    const existingLines = calculatedOrder.shippingLines ?? [];
    for (const line of existingLines) {
      const removeRes = await admin.graphql(`#graphql
        mutation OrderEditRemoveShippingLine($id: ID!, $shippingLineId: ID!) {
          orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) {
            calculatedOrder { id }
            userErrors { field message }
          }
        }`, {
        variables: {
          id: calculatedOrderId,
          shippingLineId: line.id
        }
      });
      const removeJson = await removeRes.json();
      const removeErrors = ((_f = (_e = removeJson.data) == null ? void 0 : _e.orderEditRemoveShippingLine) == null ? void 0 : _f.userErrors) ?? [];
      if (removeErrors.length) {
        console.warn("[order-shipping] Warning removing line:", removeErrors);
      }
    }
    const numericPrice = typeof price === "number" ? price : parseFloat(String(price));
    const addRes = await admin.graphql(`#graphql
      mutation OrderEditAddShippingLine($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
        orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) {
          calculatedOrder { id }
          calculatedShippingLine {
            id
            title
            price {
              presentmentMoney {
                amount
                currencyCode
              }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        shippingLine: {
          title,
          price: {
            amount: numericPrice,
            currencyCode
          }
        }
      }
    });
    const addJson = await addRes.json();
    const addErrors = ((_h = (_g = addJson.data) == null ? void 0 : _g.orderEditAddShippingLine) == null ? void 0 : _h.userErrors) ?? [];
    if (addErrors.length) {
      return cors(Response.json({
        userErrors: addErrors
      }, {
        status: 422
      }));
    }
    const commitRes = await admin.graphql(`#graphql
      mutation OrderEditCommitShipping($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
          order {
            id
            name
            statusPageUrl
            totalOutstandingSet {
              shopMoney { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        id: calculatedOrderId,
        staffNote: "Shipping method updated by customer via Customer Account UI"
      }
    });
    const commitJson = await commitRes.json();
    const commitErrors = ((_j = (_i = commitJson.data) == null ? void 0 : _i.orderEditCommit) == null ? void 0 : _j.userErrors) ?? [];
    if (commitErrors.length) {
      return cors(Response.json({
        userErrors: commitErrors
      }, {
        status: 422
      }));
    }
    const updatedOrder = commitJson.data.orderEditCommit.order;
    const balanceDue = ((_k = updatedOrder == null ? void 0 : updatedOrder.totalOutstandingSet) == null ? void 0 : _k.shopMoney) ?? null;
    const owesRefund = balanceDue ? parseFloat(balanceDue.amount) < 0 : false;
    await addOrderTags(admin, orderId, owesRefund);
    const {
      source
    } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "change-shipping-method",
      source
    });
    return cors(Response.json({
      order: updatedOrder,
      balanceDue,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-shipping] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error updating shipping method"
      }]
    }, {
      status: 500
    }));
  }
}
const route18 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$8,
  loader: loader$c
}, Symbol.toStringTag, { value: "Module" }));
async function loader$b({
  request
}) {
  var _a2, _b;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return cors(Response.json({
      error: "Missing orderId"
    }, {
      status: 400
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  try {
    const res = await admin.graphql(`#graphql
      query getShippingAddress($id: ID!) {
        order(id: $id) {
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            countryCode
            phone
          }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const json = await res.json();
    const shippingAddress = ((_b = (_a2 = json.data) == null ? void 0 : _a2.order) == null ? void 0 : _b.shippingAddress) ?? null;
    return cors(Response.json({
      shippingAddress
    }));
  } catch (err) {
    return cors(Response.json({
      shippingAddress: null
    }));
  }
}
async function action$7({
  request
}) {
  var _a2, _b, _c, _d;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const customerAccountId = sessionToken.sub;
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    addressType,
    address
  } = body;
  if (!orderId || !addressType || !address) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId, addressType, or address."
      }]
    }, {
      status: 400
    }));
  }
  if (!["shipping", "billing"].includes(addressType)) {
    return cors(Response.json({
      userErrors: [{
        message: "addressType must be 'shipping' or 'billing'."
      }]
    }, {
      status: 400
    }));
  }
  if (!address.address1 || !address.city || !address.countryCode) {
    return cors(Response.json({
      userErrors: [{
        message: "Address line 1, city, and country are required."
      }]
    }, {
      status: 400
    }));
  }
  const ownerRes = await admin.graphql(`#graphql
    query getOrderOwner($id: ID!) {
      order(id: $id) {
        id
        customer { id }
      }
    }`, {
    variables: {
      id: orderId
    }
  });
  const ownerJson = await ownerRes.json();
  const order = (_a2 = ownerJson.data) == null ? void 0 : _a2.order;
  if (!order) {
    return cors(Response.json({
      userErrors: [{
        message: "Order not found."
      }]
    }, {
      status: 404
    }));
  }
  const numericId = (gidOrId) => {
    var _a3;
    return (_a3 = gidOrId == null ? void 0 : gidOrId.match(/\d+$/)) == null ? void 0 : _a3[0];
  };
  if (!((_b = order.customer) == null ? void 0 : _b.id) || numericId(order.customer.id) !== numericId(customerAccountId)) {
    return cors(Response.json({
      userErrors: [{
        message: "Not authorized to update this order."
      }]
    }, {
      status: 403
    }));
  }
  const mailingAddress = {
    firstName: address.firstName || "",
    lastName: address.lastName || "",
    address1: address.address1,
    address2: address.address2 || "",
    city: address.city,
    province: address.province || "",
    zip: address.zip || "",
    countryCode: address.countryCode,
    phone: address.phone || ""
  };
  const input2 = {
    id: orderId
  };
  if (addressType === "shipping") {
    input2.shippingAddress = mailingAddress;
  } else {
    return cors(Response.json({
      userErrors: [{
        message: "Billing address cannot be updated directly on a placed order. Please contact support to update your billing address."
      }]
    }, {
      status: 422
    }));
  }
  try {
    const updateRes = await admin.graphql(`#graphql
      mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            name
            statusPageUrl
            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              zip
              country
              phone
            }
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        input: input2
      }
    });
    const updateJson = await updateRes.json();
    const errors = ((_d = (_c = updateJson.data) == null ? void 0 : _c.orderUpdate) == null ? void 0 : _d.userErrors) ?? [];
    if (errors.length) {
      return cors(Response.json({
        userErrors: errors
      }, {
        status: 422
      }));
    }
    await addOrderTags(admin, orderId);
    const {
      source
    } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "change-address",
      source
    });
    return cors(Response.json({
      order: updateJson.data.orderUpdate.order,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-address] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route19 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$7,
  loader: loader$b
}, Symbol.toStringTag, { value: "Module" }));
async function loader$a({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$6({
  request
}) {
  var _a2, _b, _c, _d, _e;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const customerAccountId = sessionToken.sub;
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    email,
    phone
  } = body;
  if (!orderId) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId."
      }]
    }, {
      status: 400
    }));
  }
  if (!email && !phone) {
    return cors(Response.json({
      userErrors: [{
        message: "Provide at least one field to update (email or phone)."
      }]
    }, {
      status: 400
    }));
  }
  const ownerRes = await admin.graphql(`#graphql
    query getOrderOwner($id: ID!) {
      order(id: $id) {
        id
        customer { id }
      }
    }`, {
    variables: {
      id: orderId
    }
  });
  const ownerJson = await ownerRes.json();
  const order = (_a2 = ownerJson.data) == null ? void 0 : _a2.order;
  if (!order) {
    return cors(Response.json({
      userErrors: [{
        message: "Order not found."
      }]
    }, {
      status: 404
    }));
  }
  const numericId = (gidOrId) => {
    var _a3;
    return (_a3 = gidOrId == null ? void 0 : gidOrId.match(/\d+$/)) == null ? void 0 : _a3[0];
  };
  if (!((_b = order.customer) == null ? void 0 : _b.id) || numericId(order.customer.id) !== numericId(customerAccountId)) {
    return cors(Response.json({
      userErrors: [{
        message: "Not authorized to update this order."
      }]
    }, {
      status: 403
    }));
  }
  const numericOrderId = (_c = orderId.match(/\d+$/)) == null ? void 0 : _c[0];
  if (!numericOrderId) {
    return cors(Response.json({
      userErrors: [{
        message: "Invalid orderId format."
      }]
    }, {
      status: 400
    }));
  }
  const input2 = {
    id: orderId
  };
  if (email) input2.email = email;
  if (phone) input2.phone = phone;
  try {
    const updateRes = await admin.graphql(`#graphql
      mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            name
            email
            phone
            statusPageUrl
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        input: input2
      }
    });
    const updateJson = await updateRes.json();
    const errors = ((_e = (_d = updateJson.data) == null ? void 0 : _d.orderUpdate) == null ? void 0 : _e.userErrors) ?? [];
    if (errors.length) {
      return cors(Response.json({
        userErrors: errors
      }, {
        status: 422
      }));
    }
    await addOrderTags(admin, orderId);
    const {
      source
    } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "contact-info",
      source
    });
    return cors(Response.json({
      order: updateJson.data.orderUpdate.order,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-contact] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route20 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$6,
  loader: loader$a
}, Symbol.toStringTag, { value: "Module" }));
async function loader$9({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
const action$5 = async ({
  request
}) => {
  var _a2, _b;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const customerAccountId = sessionToken.sub;
  const body = await request.json();
  const orderId = body.orderId;
  if (!orderId) {
    return cors(Response.json({
      error: "Missing orderId"
    }, {
      status: 400
    }));
  }
  try {
    const {
      admin
    } = await unauthenticated.admin(storeDomain);
    const response = await admin.graphql(`#graphql
      query getOrderOwner($id: ID!) {
        order(id: $id) {
          id
          customer { id }
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const json = await response.json();
    const order = (_a2 = json.data) == null ? void 0 : _a2.order;
    if (!order) {
      return cors(Response.json({
        error: "Order not found"
      }, {
        status: 404
      }));
    }
    const numericId = (gidOrId) => {
      var _a3;
      return (_a3 = gidOrId == null ? void 0 : gidOrId.match(/\d+$/)) == null ? void 0 : _a3[0];
    };
    if (!((_b = order.customer) == null ? void 0 : _b.id) || numericId(order.customer.id) !== numericId(customerAccountId)) {
      return cors(Response.json({
        error: "Not authorized to access this order"
      }, {
        status: 403
      }));
    }
    const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const invoiceUrl = buildSignedInvoiceUrl(appUrl, {
      shop: storeDomain,
      orderId,
      customerId: customerAccountId
    });
    await trackFeatureUsage({
      shop: storeDomain,
      featureId: "download-invoice"
    });
    return cors(Response.json({
      url: invoiceUrl
    }));
  } catch (err) {
    console.error("[order-invoice] Unexpected error:", err);
    return cors(Response.json({
      error: "Internal error"
    }, {
      status: 500
    }));
  }
};
const route21 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$5,
  loader: loader$9
}, Symbol.toStringTag, { value: "Module" }));
async function loader$8({
  request
}) {
  const {
    cors
  } = await authenticate.public.customerAccount(request);
  return cors(new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
}
async function action$4({
  request
}) {
  var _a2, _b;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    reason,
    source
  } = body || {};
  if (!orderId) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId."
      }]
    }, {
      status: 400
    }));
  }
  try {
    const cancelResponse = await admin.graphql(`#graphql
      mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!) {
        orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: true, restock: true, refundMethod: { originalPaymentMethodsRefund: true }) {
          job { id }
          orderCancelUserErrors { field message }
        }
      }`, {
      variables: {
        orderId,
        reason: reason || "CUSTOMER"
      }
    });
    const cancelJson = await cancelResponse.json();
    const errors = ((_b = (_a2 = cancelJson.data) == null ? void 0 : _a2.orderCancel) == null ? void 0 : _b.orderCancelUserErrors) ?? [];
    if (errors.length) {
      return cors(Response.json({
        userErrors: errors
      }, {
        status: 422
      }));
    }
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "cancel-order",
      source
    });
    return cors(Response.json({
      success: true,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-cancel] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error"
      }]
    }, {
      status: 500
    }));
  }
}
const route22 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$4,
  loader: loader$8
}, Symbol.toStringTag, { value: "Module" }));
async function loader$7({
  request
}) {
  var _a2;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return cors(Response.json({
      error: "Missing orderId"
    }, {
      status: 400
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  try {
    const res = await admin.graphql(`#graphql
      query getOrderNote($id: ID!) {
        order(id: $id) {
          id
          note
        }
      }`, {
      variables: {
        id: orderId
      }
    });
    const json = await res.json();
    const order = (_a2 = json.data) == null ? void 0 : _a2.order;
    return cors(Response.json({
      note: (order == null ? void 0 : order.note) || ""
    }));
  } catch (err) {
    console.error("[order-note-loader] Error:", err);
    return cors(Response.json({
      note: ""
    }));
  }
}
async function action$3({
  request
}) {
  var _a2, _b, _c, _d, _e, _f, _g, _h, _i;
  const {
    sessionToken,
    cors
  } = await authenticate.public.customerAccount(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
  }
  const storeDomain = sessionToken.dest.replace(/^https?:\/\//, "");
  const customerAccountId = sessionToken.sub;
  const {
    admin
  } = await unauthenticated.admin(storeDomain);
  const body = await request.json();
  const {
    orderId,
    note
  } = body;
  if (!orderId || note === void 0) {
    return cors(Response.json({
      userErrors: [{
        message: "Missing orderId or note."
      }]
    }, {
      status: 400
    }));
  }
  const ownerRes = await admin.graphql(`#graphql
    query getOrderOwnerForNote($id: ID!) {
      order(id: $id) {
        id
        customer { id }
      }
    }`, {
    variables: {
      id: orderId
    }
  });
  const ownerJson = await ownerRes.json();
  const order = (_a2 = ownerJson.data) == null ? void 0 : _a2.order;
  if (!order) {
    return cors(Response.json({
      userErrors: [{
        message: "Order not found."
      }]
    }, {
      status: 404
    }));
  }
  const numericId = (gidOrId) => {
    var _a3;
    return (_a3 = gidOrId == null ? void 0 : gidOrId.match(/\d+$/)) == null ? void 0 : _a3[0];
  };
  if (!((_b = order.customer) == null ? void 0 : _b.id) || numericId(order.customer.id) !== numericId(customerAccountId)) {
    return cors(Response.json({
      userErrors: [{
        message: "Not authorized to update this order."
      }]
    }, {
      status: 403
    }));
  }
  try {
    const updateRes = await admin.graphql(`#graphql
      mutation updateOrderNote($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            note
            statusPageUrl
          }
          userErrors { field message }
        }
      }`, {
      variables: {
        input: {
          id: orderId,
          note: String(note).trim()
        }
      }
    });
    const updateJson = await updateRes.json();
    const userErrors = ((_d = (_c = updateJson.data) == null ? void 0 : _c.orderUpdate) == null ? void 0 : _d.userErrors) ?? [];
    if (userErrors.length > 0) {
      return cors(Response.json({
        userErrors
      }, {
        status: 422
      }));
    }
    await addOrderTags(admin, orderId, false);
    const {
      source
    } = body || {};
    await trackOrderEdit({
      shop: storeDomain,
      orderId,
      featureId: "order-note",
      source
    });
    return cors(Response.json({
      note: ((_g = (_f = (_e = updateJson.data) == null ? void 0 : _e.orderUpdate) == null ? void 0 : _f.order) == null ? void 0 : _g.note) || "",
      order: ((_i = (_h = updateJson.data) == null ? void 0 : _h.orderUpdate) == null ? void 0 : _i.order) || null,
      userErrors: []
    }));
  } catch (err) {
    console.error("[order-note-action] Unexpected error:", err);
    return cors(Response.json({
      userErrors: [{
        message: err instanceof Error ? err.message : "Internal error updating order note"
      }]
    }, {
      status: 500
    }));
  }
}
const route23 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$3,
  loader: loader$7
}, Symbol.toStringTag, { value: "Module" }));
function loginErrorMessage(loginErrors) {
  if ((loginErrors == null ? void 0 : loginErrors.shop) === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if ((loginErrors == null ? void 0 : loginErrors.shop) === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}
const loader$6 = async ({
  request
}) => {
  const errors = loginErrorMessage(await login(request));
  return {
    errors
  };
};
const action$2 = async ({
  request
}) => {
  const errors = loginErrorMessage(await login(request));
  return {
    errors
  };
};
const route$1 = UNSAFE_withComponentProps(function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const {
    errors
  } = actionData || loaderData;
  return /* @__PURE__ */ jsx(AppProvider, {
    embedded: false,
    children: /* @__PURE__ */ jsx("s-page", {
      children: /* @__PURE__ */ jsx(Form, {
        method: "post",
        children: /* @__PURE__ */ jsxs("s-section", {
          heading: "Log in",
          children: [/* @__PURE__ */ jsx("s-text-field", {
            name: "shop",
            label: "Shop domain",
            details: "example.myshopify.com",
            value: shop,
            onChange: (e) => setShop(e.currentTarget.value),
            autocomplete: "on",
            error: errors.shop
          }), /* @__PURE__ */ jsx("s-button", {
            type: "submit",
            children: "Log in"
          })]
        })
      })
    })
  });
});
const route24 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$2,
  default: route$1,
  loader: loader$6
}, Symbol.toStringTag, { value: "Module" }));
const index = "_index_12o3y_1";
const heading = "_heading_12o3y_11";
const text = "_text_12o3y_12";
const content = "_content_12o3y_22";
const form = "_form_12o3y_27";
const label = "_label_12o3y_35";
const input = "_input_12o3y_43";
const button = "_button_12o3y_47";
const list = "_list_12o3y_51";
const styles = {
  index,
  heading,
  text,
  content,
  form,
  label,
  input,
  button,
  list
};
const loader$5 = async ({
  request
}) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return {
    showForm: Boolean(login)
  };
};
const route = UNSAFE_withComponentProps(function App2() {
  const {
    showForm
  } = useLoaderData();
  return /* @__PURE__ */ jsx("div", {
    className: styles.index,
    children: /* @__PURE__ */ jsxs("div", {
      className: styles.content,
      children: [/* @__PURE__ */ jsx("h1", {
        className: styles.heading,
        children: "A short heading about [your app]"
      }), /* @__PURE__ */ jsx("p", {
        className: styles.text,
        children: "A tagline about [your app] that describes your value proposition."
      }), showForm && /* @__PURE__ */ jsxs(Form, {
        className: styles.form,
        method: "post",
        action: "/auth/login",
        children: [/* @__PURE__ */ jsxs("label", {
          className: styles.label,
          children: [/* @__PURE__ */ jsx("span", {
            children: "Shop domain"
          }), /* @__PURE__ */ jsx("input", {
            className: styles.input,
            type: "text",
            name: "shop"
          }), /* @__PURE__ */ jsx("span", {
            children: "e.g: my-shop-domain.myshopify.com"
          })]
        }), /* @__PURE__ */ jsx("button", {
          className: styles.button,
          type: "submit",
          children: "Log in"
        })]
      }), /* @__PURE__ */ jsxs("ul", {
        className: styles.list,
        children: [/* @__PURE__ */ jsxs("li", {
          children: [/* @__PURE__ */ jsx("strong", {
            children: "Product feature"
          }), ". Some detail about your feature and its benefit to your customer."]
        }), /* @__PURE__ */ jsxs("li", {
          children: [/* @__PURE__ */ jsx("strong", {
            children: "Product feature"
          }), ". Some detail about your feature and its benefit to your customer."]
        }), /* @__PURE__ */ jsxs("li", {
          children: [/* @__PURE__ */ jsx("strong", {
            children: "Product feature"
          }), ". Some detail about your feature and its benefit to your customer."]
        })]
      })]
    })
  });
});
const route25 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: route,
  loader: loader$5
}, Symbol.toStringTag, { value: "Module" }));
const loader$4 = async ({
  request
}) => {
  await authenticate.admin(request);
  return null;
};
const headers$4 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route26 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  headers: headers$4,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
const loader$3 = async ({
  request
}) => {
  await authenticate.admin(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || ""
  };
};
const app = UNSAFE_withComponentProps(function App3() {
  const {
    apiKey
  } = useLoaderData();
  return /* @__PURE__ */ jsxs(AppProvider, {
    embedded: true,
    apiKey,
    children: [/* @__PURE__ */ jsxs("s-app-nav", {
      children: [/* @__PURE__ */ jsx("s-link", {
        href: "/app",
        children: "Home"
      }), /* @__PURE__ */ jsx("s-link", {
        href: "/app/active-services",
        children: "Active Services"
      }), /* @__PURE__ */ jsx("s-link", {
        href: "/app/insights",
        children: "Insights"
      }), /* @__PURE__ */ jsx("s-link", {
        href: "/app/additional",
        children: "Additional page"
      })]
    }), /* @__PURE__ */ jsx(Outlet, {})]
  });
});
const ErrorBoundary = UNSAFE_withErrorBoundaryProps(function ErrorBoundary2() {
  return boundary.error(useRouteError());
});
const headers$3 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route27 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary,
  default: app,
  headers: headers$3,
  loader: loader$3
}, Symbol.toStringTag, { value: "Module" }));
const SSwitch = "s-switch";
const SERVICES = [{
  id: "add-product",
  title: "Add Product to Order",
  description: "Allow customers to add new products or additional items to their unfulfilled order.",
  category: "Item Management"
}, {
  id: "product-upsell",
  title: "Product Upsell & Recommendations",
  description: "Offer smart product recommendations and upsells directly on the order edit page.",
  category: "Revenue & Growth"
}, {
  id: "edit-quantity",
  title: "Edit Product Quantity",
  description: "Let customers increase or decrease quantities of line items in existing orders.",
  category: "Item Management"
}, {
  id: "swap-variant",
  title: "Swap Product Variant",
  description: "Enable customers to switch product size, color, or variant options easily.",
  category: "Item Management"
}, {
  id: "change-address",
  title: "Change Shipping Address",
  description: "Allow customers to update their delivery address before order dispatch.",
  category: "Shipping & Delivery"
}, {
  id: "change-shipping-method",
  title: "Change Shipping Method",
  description: "Let customers upgrade or change their selected shipping method and speed.",
  category: "Shipping & Delivery"
}, {
  id: "order-note",
  title: "Add / Edit Order Note",
  description: "Allow customers to leave special instructions, gift notes, or delivery hints.",
  category: "Communication"
}, {
  id: "contact-info",
  title: "Update Contact Information",
  description: "Enable customers to update email address or phone number on pending orders.",
  category: "Account & Contact"
}, {
  id: "apply-discount",
  title: "Apply Discount Code",
  description: "Allow customers to apply coupon codes or promotional discounts to active orders.",
  category: "Promotions"
}, {
  id: "cancel-order",
  title: "Cancel Order",
  description: "Provide self-serve order cancellation within merchant-defined time limits.",
  category: "Order Management"
}, {
  id: "download-invoice",
  title: "Download & Print Invoice",
  description: "Provide downloadable PDF invoices on customer order status pages.",
  category: "Billing & Receipts"
}];
const loader$2 = async ({
  request
}) => {
  const {
    session
  } = await authenticate.admin(request);
  const shop = session.shop;
  let rows = await prisma.serviceSettings.findMany({
    where: {
      shop
    }
  });
  const existingIds = new Set(rows.map((r) => r.id));
  const missingServices = SERVICES.filter((s) => !existingIds.has(s.id));
  if (missingServices.length > 0) {
    console.log(`[ActiveServices Loader] Seeding ${missingServices.length} missing services in DB with enabled=false for shop ${shop}`);
    await prisma.serviceSettings.createMany({
      data: missingServices.map((s) => ({
        id: s.id,
        shop,
        enabled: false
      }))
    });
    rows = await prisma.serviceSettings.findMany({
      where: {
        shop
      }
    });
  }
  const dbMap = {};
  rows.forEach((row) => {
    dbMap[row.id] = row.enabled;
  });
  const services = SERVICES.map((s) => ({
    ...s,
    enabled: dbMap[s.id] ?? false
  }));
  let timeLimitRecord = await prisma.orderEditTimeLimit.findUnique({
    where: {
      shop
    }
  });
  if (!timeLimitRecord) {
    timeLimitRecord = await prisma.orderEditTimeLimit.create({
      data: {
        shop,
        timeLimit: "1h",
        customValue: 1,
        customUnit: "hours"
      }
    });
  }
  return {
    shop,
    services,
    timeLimitSettings: {
      timeLimit: timeLimitRecord.timeLimit,
      customValue: timeLimitRecord.customValue ?? 1,
      customUnit: timeLimitRecord.customUnit ?? "hours"
    }
  };
};
const action$1 = async ({
  request
}) => {
  const {
    session
  } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "saveTimeLimit") {
    const timeLimit = formData.get("timeLimit") || "1h";
    const customValueStr = formData.get("customValue");
    const customUnit = formData.get("customUnit") || "hours";
    const customValue = customValueStr ? parseInt(customValueStr, 10) : null;
    console.log(`[ActiveServices Action] Saving time limit setting: shop=${shop}, timeLimit=${timeLimit}, customValue=${customValue}, customUnit=${customUnit}`);
    const timeLimitRecord = await prisma.orderEditTimeLimit.upsert({
      where: {
        shop
      },
      create: {
        shop,
        timeLimit,
        customValue,
        customUnit
      },
      update: {
        timeLimit,
        customValue,
        customUnit
      }
    });
    return {
      ok: true,
      type: "timeLimit",
      result: timeLimitRecord
    };
  }
  const serviceId = formData.get("serviceId");
  const enabledStr = formData.get("enabled");
  const enabled = enabledStr === "true";
  console.log(`[ActiveServices Action] Saving service setting: shop=${shop}, serviceId=${serviceId}, enabled=${enabled}`);
  if (!serviceId) {
    return {
      ok: false,
      error: "Missing serviceId"
    };
  }
  const result = await prisma.serviceSettings.upsert({
    where: {
      shop_id: {
        shop,
        id: serviceId
      }
    },
    create: {
      id: serviceId,
      shop,
      enabled
    },
    update: {
      enabled
    }
  });
  return {
    ok: true,
    type: "service",
    result
  };
};
const headers$2 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const app_activeServices = UNSAFE_withComponentProps(function ActiveServicesPage() {
  const {
    services,
    timeLimitSettings
  } = useLoaderData();
  return /* @__PURE__ */ jsxs("s-page", {
    heading: "Active Services",
    children: [/* @__PURE__ */ jsx("s-section", {
      heading: "Order Edit App Capabilities",
      children: /* @__PURE__ */ jsx("s-paragraph", {
        children: "Manage and monitor all active customer-facing services provided by your Order Edit App. Use the toggles on the right to enable or disable specific functionalities for your store customers."
      })
    }), /* @__PURE__ */ jsx(TimeLimitSection, {
      initialSettings: timeLimitSettings
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Services Overview",
      children: /* @__PURE__ */ jsx("s-stack", {
        direction: "block",
        gap: "base",
        children: services.map((service) => /* @__PURE__ */ jsx(ServiceRow, {
          id: service.id,
          title: service.title,
          description: service.description,
          category: service.category,
          enabled: service.enabled
        }, service.id))
      })
    })]
  });
});
const TIME_LIMIT_PRESETS = [{
  value: "30m",
  label: "30 Minutes"
}, {
  value: "1h",
  label: "1 Hour"
}, {
  value: "2h",
  label: "2 Hours"
}, {
  value: "1d",
  label: "1 Day"
}, {
  value: "2d",
  label: "2 Days"
}, {
  value: "custom",
  label: "Custom Time"
}];
function TimeLimitSection({
  initialSettings
}) {
  const fetcher = useFetcher();
  const [selectedPreset, setSelectedPreset] = useEffectState(initialSettings.timeLimit || "1h");
  const [customVal, setCustomVal] = useEffectState(initialSettings.customValue || 1);
  const [customUnitVal, setCustomUnitVal] = useEffectState(initialSettings.customUnit || "hours");
  const [isSaved, setIsSaved] = useEffectState(false);
  useEffect(() => {
    setSelectedPreset(initialSettings.timeLimit || "1h");
    setCustomVal(initialSettings.customValue || 1);
    setCustomUnitVal(initialSettings.customUnit || "hours");
  }, [initialSettings]);
  useEffect(() => {
    var _a2, _b;
    if (fetcher.state === "idle" && ((_a2 = fetcher.data) == null ? void 0 : _a2.ok) && ((_b = fetcher.data) == null ? void 0 : _b.type) === "timeLimit") {
      setIsSaved(true);
      const timer = setTimeout(() => setIsSaved(false), 3e3);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);
  const handleSave = (preset, cVal, cUnit) => {
    fetcher.submit({
      intent: "saveTimeLimit",
      timeLimit: preset,
      customValue: String(cVal ?? customVal),
      customUnit: cUnit ?? customUnitVal
    }, {
      method: "post"
    });
  };
  return /* @__PURE__ */ jsx("s-section", {
    heading: "Order Edit Time Limit",
    children: /* @__PURE__ */ jsx("s-box", {
      padding: "large",
      border: "base",
      borderRadius: "base",
      background: "subdued",
      children: /* @__PURE__ */ jsxs("s-stack", {
        direction: "block",
        gap: "large",
        children: [/* @__PURE__ */ jsxs("s-stack", {
          direction: "block",
          gap: "small",
          children: [/* @__PURE__ */ jsx("s-text", {
            type: "strong",
            children: "Maximum Allowed Time for Order Edits"
          }), /* @__PURE__ */ jsx("s-paragraph", {
            color: "subdued",
            children: "Set how long after placing an order a customer is permitted to edit their order. Once this time window expires, editing will be disabled."
          })]
        }), /* @__PURE__ */ jsxs("s-stack", {
          direction: "block",
          gap: "small",
          children: [/* @__PURE__ */ jsx("s-text", {
            type: "strong",
            children: "Preset Options"
          }), /* @__PURE__ */ jsx("s-grid", {
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "small",
            children: TIME_LIMIT_PRESETS.map((preset) => {
              const isActive = selectedPreset === preset.value;
              return /* @__PURE__ */ jsx("button", {
                type: "button",
                style: {
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: isActive ? "2px solid #008060" : "1px solid #c9cccf",
                  backgroundColor: isActive ? "#eaf4f0" : "#ffffff",
                  color: isActive ? "#004c3f" : "#202223",
                  fontWeight: isActive ? "600" : "400",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.15s ease-in-out"
                },
                onClick: () => {
                  setSelectedPreset(preset.value);
                  handleSave(preset.value);
                },
                children: preset.label
              }, preset.value);
            })
          })]
        }), selectedPreset === "custom" && /* @__PURE__ */ jsx("s-box", {
          padding: "base",
          border: "base",
          borderRadius: "base",
          children: /* @__PURE__ */ jsxs("s-stack", {
            direction: "block",
            gap: "base",
            children: [/* @__PURE__ */ jsx("s-text", {
              type: "strong",
              children: "Custom Duration"
            }), /* @__PURE__ */ jsxs("s-grid", {
              gridTemplateColumns: "1fr 1fr auto",
              gap: "base",
              alignItems: "center",
              children: [/* @__PURE__ */ jsxs("s-stack", {
                direction: "block",
                gap: "small",
                children: [/* @__PURE__ */ jsx("s-text", {
                  color: "subdued",
                  children: "Duration Value"
                }), /* @__PURE__ */ jsx("input", {
                  type: "number",
                  min: "1",
                  value: customVal,
                  onChange: (e) => setCustomVal(Math.max(1, parseInt(e.target.value, 10) || 1)),
                  style: {
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #c9cccf",
                    fontSize: "14px",
                    width: "100%"
                  }
                })]
              }), /* @__PURE__ */ jsxs("s-stack", {
                direction: "block",
                gap: "small",
                children: [/* @__PURE__ */ jsx("s-text", {
                  color: "subdued",
                  children: "Time Unit"
                }), /* @__PURE__ */ jsxs("select", {
                  value: customUnitVal,
                  onChange: (e) => setCustomUnitVal(e.target.value),
                  style: {
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #c9cccf",
                    fontSize: "14px",
                    width: "100%",
                    backgroundColor: "#ffffff"
                  },
                  children: [/* @__PURE__ */ jsx("option", {
                    value: "minutes",
                    children: "Minutes"
                  }), /* @__PURE__ */ jsx("option", {
                    value: "hours",
                    children: "Hours"
                  }), /* @__PURE__ */ jsx("option", {
                    value: "days",
                    children: "Days"
                  })]
                })]
              }), /* @__PURE__ */ jsxs("s-stack", {
                direction: "block",
                gap: "small",
                children: [/* @__PURE__ */ jsx("s-text", {
                  color: "subdued",
                  style: {
                    visibility: "hidden"
                  },
                  children: "Save"
                }), /* @__PURE__ */ jsx("button", {
                  type: "button",
                  onClick: () => handleSave("custom", customVal, customUnitVal),
                  style: {
                    padding: "9px 18px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "#008060",
                    color: "#ffffff",
                    fontWeight: "600",
                    cursor: "pointer"
                  },
                  children: "Save Custom Limit"
                })]
              })]
            })]
          })
        }), isSaved && /* @__PURE__ */ jsx("s-badge", {
          tone: "success",
          children: "Time limit settings saved successfully!"
        })]
      })
    })
  });
}
function useEffectState(initialValue) {
  const [val, setVal] = useState(initialValue);
  return [val, setVal];
}
function ServiceRow({
  id,
  title,
  description,
  category,
  enabled
}) {
  var _a2;
  const fetcher = useFetcher();
  const switchRef = useRef(null);
  const optimisticEnabled = fetcher.state !== "idle" ? ((_a2 = fetcher.formData) == null ? void 0 : _a2.get("enabled")) === "true" : enabled;
  const toggleService = (nextState) => {
    console.log(`[ServiceRow] Toggling service ${id} to ${nextState}`);
    fetcher.submit({
      serviceId: id,
      enabled: String(nextState)
    }, {
      method: "post"
    });
  };
  useEffect(() => {
    const el = switchRef.current;
    if (!el) return;
    const handleCustomEvent = (e) => {
      e.stopPropagation();
      const target = e.target;
      const newChecked = target.checked !== void 0 ? target.checked : !optimisticEnabled;
      toggleService(newChecked);
    };
    el.addEventListener("change", handleCustomEvent);
    return () => {
      el.removeEventListener("change", handleCustomEvent);
    };
  }, [id, optimisticEnabled]);
  return /* @__PURE__ */ jsx("s-box", {
    padding: "base",
    border: "base",
    borderRadius: "base",
    background: "subdued",
    children: /* @__PURE__ */ jsxs("s-grid", {
      gridTemplateColumns: "1fr auto",
      alignItems: "center",
      gap: "base",
      children: [/* @__PURE__ */ jsxs("s-stack", {
        direction: "block",
        gap: "base",
        children: [/* @__PURE__ */ jsxs("s-stack", {
          direction: "inline",
          alignItems: "center",
          gap: "base",
          children: [/* @__PURE__ */ jsx("s-text", {
            type: "strong",
            children: title
          }), /* @__PURE__ */ jsx("s-badge", {
            tone: optimisticEnabled ? "success" : "neutral",
            children: category
          })]
        }), /* @__PURE__ */ jsx("s-paragraph", {
          color: "subdued",
          children: description
        })]
      }), /* @__PURE__ */ jsx("s-badge", {
        tone: optimisticEnabled ? "success" : "neutral",
        children: /* @__PURE__ */ jsx(SSwitch, {
          tone: optimisticEnabled ? "success" : "neutral",
          ref: switchRef,
          label: optimisticEnabled ? "Active" : "Inactive",
          name: id,
          checked: optimisticEnabled,
          onClick: () => {
            if (fetcher.state === "idle") {
              toggleService(!optimisticEnabled);
            }
          }
        })
      })]
    })
  });
}
const route28 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1,
  default: app_activeServices,
  headers: headers$2,
  loader: loader$2
}, Symbol.toStringTag, { value: "Module" }));
const app_additional = UNSAFE_withComponentProps(function AdditionalPage() {
  return /* @__PURE__ */ jsxs("s-page", {
    heading: "Additional page",
    children: [/* @__PURE__ */ jsxs("s-section", {
      heading: "Multiple pages",
      children: [/* @__PURE__ */ jsxs("s-paragraph", {
        children: ["The app template comes with an additional page which demonstrates how to create multiple pages within app navigation using", " ", /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/apps/tools/app-bridge",
          target: "_blank",
          children: "App Bridge"
        }), "."]
      }), /* @__PURE__ */ jsxs("s-paragraph", {
        children: ["To create your own page and have it show up in the app navigation, add a page inside ", /* @__PURE__ */ jsx("code", {
          children: "app/routes"
        }), ", and a link to it in the", " ", /* @__PURE__ */ jsx("code", {
          children: "<ui-nav-menu>"
        }), " component found in", " ", /* @__PURE__ */ jsx("code", {
          children: "app/routes/app.jsx"
        }), "."]
      })]
    }), /* @__PURE__ */ jsx("s-section", {
      slot: "aside",
      heading: "Resources",
      children: /* @__PURE__ */ jsx("s-unordered-list", {
        children: /* @__PURE__ */ jsx("s-list-item", {
          children: /* @__PURE__ */ jsx("s-link", {
            href: "https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav",
            target: "_blank",
            children: "App nav best practices"
          })
        })
      })
    })]
  });
});
const route29 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: app_additional
}, Symbol.toStringTag, { value: "Module" }));
const ALL_SERVICES = [{
  id: "add-product",
  title: "Add Product to Order",
  category: "Item Management"
}, {
  id: "product-upsell",
  title: "Product Upsell & Recommendations",
  category: "Revenue & Growth"
}, {
  id: "edit-quantity",
  title: "Edit Product Quantity",
  category: "Item Management"
}, {
  id: "swap-variant",
  title: "Swap Product Variant",
  category: "Item Management"
}, {
  id: "change-address",
  title: "Change Shipping Address",
  category: "Shipping & Delivery"
}, {
  id: "change-shipping-method",
  title: "Change Shipping Method",
  category: "Shipping & Delivery"
}, {
  id: "order-note",
  title: "Add / Edit Order Note",
  category: "Communication"
}, {
  id: "contact-info",
  title: "Update Contact Information",
  category: "Account & Contact"
}, {
  id: "apply-discount",
  title: "Apply Discount Code",
  category: "Promotions"
}, {
  id: "cancel-order",
  title: "Cancel Order",
  category: "Order Management"
}, {
  id: "download-invoice",
  title: "Download & Print Invoice",
  category: "Billing & Receipts"
}];
const loader$1 = async ({
  request
}) => {
  var _a2, _b;
  const {
    admin,
    session
  } = await authenticate.admin(request);
  const shop = session.shop;
  let totalStoreOrders = 0;
  try {
    const ordersRes = await admin.graphql(`#graphql
      query getTotalOrdersCount {
        ordersCount(query: "status:open") {
          count
        }
      }`);
    const ordersJson = await ordersRes.json();
    totalStoreOrders = ((_b = (_a2 = ordersJson.data) == null ? void 0 : _a2.ordersCount) == null ? void 0 : _b.count) ?? 0;
  } catch (err) {
    console.error("[insights-loader] Error fetching orders count:", err);
  }
  const editedOrders = await prisma.editedOrder.findMany({
    where: {
      shop
    }
  });
  const uniqueOrdersSet = new Set(editedOrders.map((o) => o.orderId));
  const totalEditedOrders = uniqueOrdersSet.size;
  const customerAccountEditsCount = editedOrders.filter((o) => o.source === "customer_account_ui").length;
  const checkoutUiEditsCount = editedOrders.filter((o) => o.source === "checkout_ui").length;
  const serviceSettings = await prisma.serviceSettings.findMany({
    where: {
      shop
    }
  });
  const enabledMap = /* @__PURE__ */ new Map();
  serviceSettings.forEach((s) => enabledMap.set(s.id, s.enabled));
  const totalFeatures = ALL_SERVICES.length;
  const activeFeaturesCount = ALL_SERVICES.filter((s) => enabledMap.get(s.id) === true).length;
  const usageRecords = await prisma.featureUsage.findMany({
    where: {
      shop
    }
  });
  const usageMap = /* @__PURE__ */ new Map();
  usageRecords.forEach((u) => usageMap.set(u.featureId, u.usedCount));
  const featureUsageList = ALL_SERVICES.map((s) => ({
    id: s.id,
    title: s.title,
    category: s.category,
    active: enabledMap.get(s.id) ?? false,
    usageCount: usageMap.get(s.id) ?? 0
  }));
  return {
    shop,
    totalStoreOrders,
    totalEditedOrders,
    customerAccountEditsCount,
    checkoutUiEditsCount,
    activeFeaturesCount,
    totalFeatures,
    featureUsageList
  };
};
const headers$1 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const app_insights = UNSAFE_withComponentProps(function InsightsPage() {
  const {
    totalStoreOrders,
    totalEditedOrders,
    customerAccountEditsCount,
    checkoutUiEditsCount,
    activeFeaturesCount,
    totalFeatures,
    featureUsageList
  } = useLoaderData();
  const totalEditsCount = customerAccountEditsCount + checkoutUiEditsCount;
  const customerAccountPercent = totalEditsCount > 0 ? Math.round(customerAccountEditsCount / totalEditsCount * 100) : 0;
  const checkoutUiPercent = totalEditsCount > 0 ? Math.round(checkoutUiEditsCount / totalEditsCount * 100) : 0;
  return /* @__PURE__ */ jsxs("s-page", {
    heading: "Insights",
    children: [/* @__PURE__ */ jsx("s-section", {
      heading: "Analytics & Performance Overview",
      children: /* @__PURE__ */ jsx("s-paragraph", {
        color: "subdued",
        children: "Monitor your store's total order edits, entry-point channels (Customer Account UI vs Checkout UI), active capabilities, and usage frequency across all app features."
      })
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Key Metrics",
      children: /* @__PURE__ */ jsxs("s-grid", {
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "base",
        children: [/* @__PURE__ */ jsx("s-box", {
          padding: "large",
          border: "base",
          borderRadius: "base",
          children: /* @__PURE__ */ jsxs("s-stack", {
            direction: "block",
            gap: "small",
            children: [/* @__PURE__ */ jsx("s-text", {
              color: "subdued",
              children: "Total Open Orders"
            }), /* @__PURE__ */ jsx("div", {
              style: {
                fontSize: "32px",
                fontWeight: "700",
                color: "#1a1d1f"
              },
              children: totalStoreOrders
            })]
          })
        }), /* @__PURE__ */ jsx("s-box", {
          padding: "large",
          border: "base",
          borderRadius: "base",
          children: /* @__PURE__ */ jsxs("s-stack", {
            direction: "block",
            gap: "small",
            children: [/* @__PURE__ */ jsx("s-text", {
              color: "subdued",
              children: "Total Orders Edited"
            }), /* @__PURE__ */ jsx("div", {
              style: {
                fontSize: "32px",
                fontWeight: "700",
                color: "#008060"
              },
              children: totalEditedOrders
            })]
          })
        }), /* @__PURE__ */ jsx("s-box", {
          padding: "large",
          border: "base",
          borderRadius: "base",
          children: /* @__PURE__ */ jsxs("s-stack", {
            direction: "block",
            gap: "small",
            children: [/* @__PURE__ */ jsx("s-text", {
              color: "subdued",
              children: "Active Features"
            }), /* @__PURE__ */ jsxs("div", {
              style: {
                fontSize: "32px",
                fontWeight: "700",
                color: "#2c6ecb"
              },
              children: [activeFeaturesCount, " ", /* @__PURE__ */ jsxs("span", {
                style: {
                  fontSize: "18px",
                  color: "#6d7175",
                  fontWeight: "400"
                },
                children: ["/ ", totalFeatures, " Enabled"]
              })]
            })]
          })
        })]
      })
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Edit Location Breakdown",
      children: /* @__PURE__ */ jsx("s-box", {
        padding: "large",
        border: "base",
        borderRadius: "base",
        children: /* @__PURE__ */ jsxs("s-stack", {
          direction: "block",
          gap: "large",
          children: [/* @__PURE__ */ jsx("s-paragraph", {
            color: "subdued",
            children: "Shows which UI interface customers used to edit their orders."
          }), /* @__PURE__ */ jsxs("s-stack", {
            direction: "block",
            gap: "base",
            children: [/* @__PURE__ */ jsxs("s-stack", {
              direction: "block",
              gap: "small",
              children: [/* @__PURE__ */ jsxs("s-grid", {
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                children: [/* @__PURE__ */ jsx("s-text", {
                  type: "strong",
                  children: "Customer Account UI (Order Status Page)"
                }), /* @__PURE__ */ jsxs("s-text", {
                  type: "strong",
                  children: [customerAccountEditsCount, " edits (", customerAccountPercent, "%)"]
                })]
              }), /* @__PURE__ */ jsx("div", {
                style: {
                  height: "10px",
                  width: "100%",
                  backgroundColor: "#e1e3e5",
                  borderRadius: "5px",
                  overflow: "hidden"
                },
                children: /* @__PURE__ */ jsx("div", {
                  style: {
                    height: "100%",
                    width: `${customerAccountPercent}%`,
                    backgroundColor: "#008060",
                    borderRadius: "5px",
                    transition: "width 0.3s ease"
                  }
                })
              })]
            }), /* @__PURE__ */ jsxs("s-stack", {
              direction: "block",
              gap: "small",
              children: [/* @__PURE__ */ jsxs("s-grid", {
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                children: [/* @__PURE__ */ jsx("s-text", {
                  type: "strong",
                  children: "Checkout UI (Thank-You Page)"
                }), /* @__PURE__ */ jsxs("s-text", {
                  type: "strong",
                  children: [checkoutUiEditsCount, " edits (", checkoutUiPercent, "%)"]
                })]
              }), /* @__PURE__ */ jsx("div", {
                style: {
                  height: "10px",
                  width: "100%",
                  backgroundColor: "#e1e3e5",
                  borderRadius: "5px",
                  overflow: "hidden"
                },
                children: /* @__PURE__ */ jsx("div", {
                  style: {
                    height: "100%",
                    width: `${checkoutUiPercent}%`,
                    backgroundColor: "#2c6ecb",
                    borderRadius: "5px",
                    transition: "width 0.3s ease"
                  }
                })
              })]
            })]
          })]
        })
      })
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Feature Usage Frequency",
      children: /* @__PURE__ */ jsx("s-box", {
        padding: "large",
        border: "base",
        borderRadius: "base",
        children: /* @__PURE__ */ jsx("s-stack", {
          direction: "block",
          gap: "base",
          children: featureUsageList.map((item) => /* @__PURE__ */ jsx("s-box", {
            padding: "base",
            border: "base",
            borderRadius: "base",
            background: "subdued",
            children: /* @__PURE__ */ jsxs("s-grid", {
              gridTemplateColumns: "1fr auto auto",
              alignItems: "center",
              gap: "base",
              children: [/* @__PURE__ */ jsxs("s-stack", {
                direction: "block",
                gap: "small",
                children: [/* @__PURE__ */ jsxs("s-stack", {
                  direction: "inline",
                  alignItems: "center",
                  gap: "base",
                  children: [/* @__PURE__ */ jsx("s-text", {
                    type: "strong",
                    children: item.title
                  }), /* @__PURE__ */ jsx("s-badge", {
                    tone: item.active ? "success" : "neutral",
                    children: item.active ? "Active" : "Inactive"
                  })]
                }), /* @__PURE__ */ jsx("s-text", {
                  color: "subdued",
                  children: item.category
                })]
              }), /* @__PURE__ */ jsx("div", {
                style: {
                  textAlign: "right"
                },
                children: /* @__PURE__ */ jsxs("s-badge", {
                  tone: item.usageCount > 0 ? "info" : "neutral",
                  children: [item.usageCount, " ", item.usageCount === 1 ? "use" : "uses"]
                })
              })]
            })
          }, item.id))
        })
      })
    })]
  });
});
const route30 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: app_insights,
  headers: headers$1,
  loader: loader$1
}, Symbol.toStringTag, { value: "Module" }));
const loader = async ({
  request
}) => {
  await authenticate.admin(request);
  return null;
};
const action = async ({
  request
}) => {
  const {
    admin
  } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][Math.floor(Math.random() * 4)];
  const response = await admin.graphql(`#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
            demoInfo: metafield(namespace: "$app", key: "demo_info") {
              jsonValue
            }
          }
        }
      }`, {
    variables: {
      product: {
        title: `${color} Snowboard`,
        metafields: [{
          namespace: "$app",
          key: "demo_info",
          value: "Created by React Router Template"
        }]
      }
    }
  });
  const responseJson = await response.json();
  const product = responseJson.data.productCreate.product;
  const variantId = product.variants.edges[0].node.id;
  const variantResponse = await admin.graphql(`#graphql
    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`, {
    variables: {
      productId: product.id,
      variants: [{
        id: variantId,
        price: "100.00"
      }]
    }
  });
  const variantResponseJson = await variantResponse.json();
  const metaobjectResponse = await admin.graphql(`#graphql
    mutation shopifyReactRouterTemplateUpsertMetaobject($handle: MetaobjectHandleInput!, $values: JSON!) {
      metaobjectUpsert(handle: $handle, values: $values) {
        metaobject {
          id
          handle
          values
        }
        userErrors {
          field
          message
        }
      }
    }`, {
    variables: {
      handle: {
        type: "$app:example",
        handle: "demo-entry"
      },
      values: {
        title: "Demo Entry",
        description: "This metaobject was created by the Shopify app template to demonstrate the metaobject API."
      }
    }
  });
  const metaobjectResponseJson = await metaobjectResponse.json();
  return {
    product: responseJson.data.productCreate.product,
    variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
    metaobject: metaobjectResponseJson.data.metaobjectUpsert.metaobject
  };
};
const app__index = UNSAFE_withComponentProps(function Index() {
  var _a2, _b, _c, _d;
  const fetcher = useFetcher();
  const shopify2 = useAppBridge();
  const isLoading = ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";
  useEffect(() => {
    var _a3, _b2;
    if ((_b2 = (_a3 = fetcher.data) == null ? void 0 : _a3.product) == null ? void 0 : _b2.id) {
      shopify2.toast.show("Product created");
    }
  }, [(_b = (_a2 = fetcher.data) == null ? void 0 : _a2.product) == null ? void 0 : _b.id, shopify2]);
  const generateProduct = () => fetcher.submit({}, {
    method: "POST"
  });
  return /* @__PURE__ */ jsxs("s-page", {
    heading: "Shopify app template",
    children: [/* @__PURE__ */ jsx("s-button", {
      slot: "primary-action",
      onClick: generateProduct,
      children: "Generate a product"
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Congrats on creating a new Shopify app 🎉 fff",
      children: /* @__PURE__ */ jsxs("s-paragraph", {
        children: ["This embedded app template uses", " ", /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/apps/tools/app-bridge",
          target: "_blank",
          children: "App Bridge"
        }), " ", "interface examples like an", " ", /* @__PURE__ */ jsx("s-link", {
          href: "/app/additional",
          children: "additional page in the app nav"
        }), ", as well as an", " ", /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/api/admin-graphql",
          target: "_blank",
          children: "Admin GraphQL"
        }), " ", "mutation demo, to provide a starting point for app development."]
      })
    }), /* @__PURE__ */ jsxs("s-section", {
      heading: "Get started with products",
      children: [/* @__PURE__ */ jsxs("s-paragraph", {
        children: ["Generate a product with GraphQL and get the JSON output for that product. Learn more about the", " ", /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate",
          target: "_blank",
          children: "productCreate"
        }), " ", "mutation in our API references. Includes a product", " ", /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/apps/build/custom-data/metafields",
          target: "_blank",
          children: "metafield"
        }), " ", "and", " ", /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/apps/build/custom-data/metaobjects",
          target: "_blank",
          children: "metaobject"
        }), "."]
      }), /* @__PURE__ */ jsxs("s-stack", {
        direction: "inline",
        gap: "base",
        children: [/* @__PURE__ */ jsx("s-button", {
          onClick: generateProduct,
          ...isLoading ? {
            loading: true
          } : {},
          children: "Generate a product"
        }), ((_c = fetcher.data) == null ? void 0 : _c.product) && /* @__PURE__ */ jsx("s-button", {
          onClick: () => {
            var _a3, _b2, _c2, _d2;
            (_d2 = (_c2 = shopify2.intents).invoke) == null ? void 0 : _d2.call(_c2, "edit:shopify/Product", {
              value: (_b2 = (_a3 = fetcher.data) == null ? void 0 : _a3.product) == null ? void 0 : _b2.id
            });
          },
          target: "_blank",
          variant: "tertiary",
          children: "Edit product"
        })]
      }), ((_d = fetcher.data) == null ? void 0 : _d.product) && /* @__PURE__ */ jsx("s-section", {
        heading: "productCreate mutation",
        children: /* @__PURE__ */ jsxs("s-stack", {
          direction: "block",
          gap: "base",
          children: [/* @__PURE__ */ jsx("s-box", {
            padding: "base",
            borderWidth: "base",
            borderRadius: "base",
            background: "subdued",
            children: /* @__PURE__ */ jsx("pre", {
              style: {
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              },
              children: /* @__PURE__ */ jsx("code", {
                children: JSON.stringify(fetcher.data.product, null, 2)
              })
            })
          }), /* @__PURE__ */ jsx("s-heading", {
            children: "productVariantsBulkUpdate mutation"
          }), /* @__PURE__ */ jsx("s-box", {
            padding: "base",
            borderWidth: "base",
            borderRadius: "base",
            background: "subdued",
            children: /* @__PURE__ */ jsx("pre", {
              style: {
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              },
              children: /* @__PURE__ */ jsx("code", {
                children: JSON.stringify(fetcher.data.variant, null, 2)
              })
            })
          }), /* @__PURE__ */ jsx("s-heading", {
            children: "metaobjectUpsert mutation"
          }), /* @__PURE__ */ jsx("s-box", {
            padding: "base",
            borderWidth: "base",
            borderRadius: "base",
            background: "subdued",
            children: /* @__PURE__ */ jsx("pre", {
              style: {
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              },
              children: /* @__PURE__ */ jsx("code", {
                children: JSON.stringify(fetcher.data.metaobject, null, 2)
              })
            })
          })]
        })
      })]
    }), /* @__PURE__ */ jsxs("s-section", {
      slot: "aside",
      heading: "App template specs",
      children: [/* @__PURE__ */ jsxs("s-paragraph", {
        children: [/* @__PURE__ */ jsx("s-text", {
          children: "Framework: "
        }), /* @__PURE__ */ jsx("s-link", {
          href: "https://reactrouter.com/",
          target: "_blank",
          children: "React Router"
        })]
      }), /* @__PURE__ */ jsxs("s-paragraph", {
        children: [/* @__PURE__ */ jsx("s-text", {
          children: "Interface: "
        }), /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/api/app-home/using-polaris-components",
          target: "_blank",
          children: "Polaris web components"
        })]
      }), /* @__PURE__ */ jsxs("s-paragraph", {
        children: [/* @__PURE__ */ jsx("s-text", {
          children: "API: "
        }), /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/api/admin-graphql",
          target: "_blank",
          children: "GraphQL"
        })]
      }), /* @__PURE__ */ jsxs("s-paragraph", {
        children: [/* @__PURE__ */ jsx("s-text", {
          children: "Custom data: "
        }), /* @__PURE__ */ jsx("s-link", {
          href: "https://shopify.dev/docs/apps/build/custom-data",
          target: "_blank",
          children: "Metafields & metaobjects"
        })]
      }), /* @__PURE__ */ jsxs("s-paragraph", {
        children: [/* @__PURE__ */ jsx("s-text", {
          children: "Database: "
        }), /* @__PURE__ */ jsx("s-link", {
          href: "https://www.prisma.io/",
          target: "_blank",
          children: "Prisma"
        })]
      })]
    }), /* @__PURE__ */ jsx("s-section", {
      slot: "aside",
      heading: "Next steps",
      children: /* @__PURE__ */ jsxs("s-unordered-list", {
        children: [/* @__PURE__ */ jsxs("s-list-item", {
          children: ["Build an", " ", /* @__PURE__ */ jsx("s-link", {
            href: "https://shopify.dev/docs/apps/getting-started/build-app-example",
            target: "_blank",
            children: "example app"
          })]
        }), /* @__PURE__ */ jsxs("s-list-item", {
          children: ["Explore Shopify's API with", " ", /* @__PURE__ */ jsx("s-link", {
            href: "https://shopify.dev/docs/apps/tools/graphiql-admin-api",
            target: "_blank",
            children: "GraphiQL"
          })]
        })]
      })
    })]
  });
});
const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route31 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action,
  default: app__index,
  headers,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-D4gpF5ER.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/root-Bvta0r3e.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order-edit.update-quantity": { "id": "routes/api.order-edit.update-quantity", "parentId": "root", "path": "api/order-edit/update-quantity", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order-edit.update-quantity-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order-edit.change-variant": { "id": "routes/api.order-edit.change-variant", "parentId": "root", "path": "api/order-edit/change-variant", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order-edit.change-variant-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order-edit.add-product": { "id": "routes/api.order-edit.add-product", "parentId": "root", "path": "api/order-edit/add-product", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order-edit.add-product-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.app.scopes_update": { "id": "routes/webhooks.app.scopes_update", "parentId": "root", "path": "webhooks/app/scopes_update", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.scopes_update-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order-edit.get-order": { "id": "routes/api.order-edit.get-order", "parentId": "root", "path": "api/order-edit/get-order", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order-edit.get-order-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.app.uninstalled": { "id": "routes/webhooks.app.uninstalled", "parentId": "root", "path": "webhooks/app/uninstalled", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.uninstalled-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.upsell-tags": { "id": "routes/api.order.upsell-tags", "parentId": "root", "path": "api/order/upsell-tags", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.upsell-tags-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.service-settings": { "id": "routes/api.service-settings", "parentId": "root", "path": "api/service-settings", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.service-settings-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount2": { "id": "routes/api.order.discount2", "parentId": "root", "path": "api/order/discount2", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount2-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount3": { "id": "routes/api.order.discount3", "parentId": "root", "path": "api/order/discount3", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount3-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount4": { "id": "routes/api.order.discount4", "parentId": "root", "path": "api/order/discount4", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount4-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount5": { "id": "routes/api.order.discount5", "parentId": "root", "path": "api/order/discount5", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount5-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount6": { "id": "routes/api.order.discount6", "parentId": "root", "path": "api/order/discount6", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount6-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount7": { "id": "routes/api.order.discount7", "parentId": "root", "path": "api/order/discount7", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount7-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount8": { "id": "routes/api.order.discount8", "parentId": "root", "path": "api/order/discount8", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount8-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public.invoice-link": { "id": "routes/public.invoice-link", "parentId": "root", "path": "public/invoice-link", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/public.invoice-link-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.discount": { "id": "routes/api.order.discount", "parentId": "root", "path": "api/order/discount", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.discount-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.shipping": { "id": "routes/api.order.shipping", "parentId": "root", "path": "api/order/shipping", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.shipping-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.address": { "id": "routes/api.order.address", "parentId": "root", "path": "api/order/address", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.address-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.contact": { "id": "routes/api.order.contact", "parentId": "root", "path": "api/order/contact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.contact-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.invoice": { "id": "routes/api.order.invoice", "parentId": "root", "path": "api/order/invoice", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.invoice-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.cancel": { "id": "routes/api.order.cancel", "parentId": "root", "path": "api/order/cancel", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.cancel-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/api.order.note": { "id": "routes/api.order.note", "parentId": "root", "path": "api/order/note", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/api.order.note-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth.login": { "id": "routes/auth.login", "parentId": "root", "path": "auth/login", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/route-_An4tzd_.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js", "/assets/AppProxyLink-BkIxrOSH.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/_index": { "id": "routes/_index", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/route-BI6pnsbT.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": ["/assets/route-Xpdx9QZl.css"], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth.$": { "id": "routes/auth.$", "parentId": "root", "path": "auth/*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/auth._-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app": { "id": "routes/app", "parentId": "root", "path": "app", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/app-BlVHzouM.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js", "/assets/AppProxyLink-BkIxrOSH.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.active-services": { "id": "routes/app.active-services", "parentId": "routes/app", "path": "active-services", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app.active-services-CGSCNGBd.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.additional": { "id": "routes/app.additional", "parentId": "routes/app", "path": "additional", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app.additional-CO-TBlJg.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.insights": { "id": "routes/app.insights", "parentId": "routes/app", "path": "insights", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app.insights-DebMz80N.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app._index": { "id": "routes/app._index", "parentId": "routes/app", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app._index-BWKGwpOi.js", "imports": ["/assets/jsx-runtime-BtRgd1-Y.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-51f897b7.js", "version": "51f897b7", "sri": void 0 };
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "v8_passThroughRequests": false, "v8_trailingSlashAwareDataRequests": false, "unstable_previewServerPrerendering": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/api.order-edit.update-quantity": {
    id: "routes/api.order-edit.update-quantity",
    parentId: "root",
    path: "api/order-edit/update-quantity",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/api.order-edit.change-variant": {
    id: "routes/api.order-edit.change-variant",
    parentId: "root",
    path: "api/order-edit/change-variant",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/api.order-edit.add-product": {
    id: "routes/api.order-edit.add-product",
    parentId: "root",
    path: "api/order-edit/add-product",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/webhooks.app.scopes_update": {
    id: "routes/webhooks.app.scopes_update",
    parentId: "root",
    path: "webhooks/app/scopes_update",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/api.order-edit.get-order": {
    id: "routes/api.order-edit.get-order",
    parentId: "root",
    path: "api/order-edit/get-order",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/webhooks.app.uninstalled": {
    id: "routes/webhooks.app.uninstalled",
    parentId: "root",
    path: "webhooks/app/uninstalled",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/api.order.upsell-tags": {
    id: "routes/api.order.upsell-tags",
    parentId: "root",
    path: "api/order/upsell-tags",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "routes/api.service-settings": {
    id: "routes/api.service-settings",
    parentId: "root",
    path: "api/service-settings",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/api.order.discount2": {
    id: "routes/api.order.discount2",
    parentId: "root",
    path: "api/order/discount2",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/api.order.discount3": {
    id: "routes/api.order.discount3",
    parentId: "root",
    path: "api/order/discount3",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "routes/api.order.discount4": {
    id: "routes/api.order.discount4",
    parentId: "root",
    path: "api/order/discount4",
    index: void 0,
    caseSensitive: void 0,
    module: route11
  },
  "routes/api.order.discount5": {
    id: "routes/api.order.discount5",
    parentId: "root",
    path: "api/order/discount5",
    index: void 0,
    caseSensitive: void 0,
    module: route12
  },
  "routes/api.order.discount6": {
    id: "routes/api.order.discount6",
    parentId: "root",
    path: "api/order/discount6",
    index: void 0,
    caseSensitive: void 0,
    module: route13
  },
  "routes/api.order.discount7": {
    id: "routes/api.order.discount7",
    parentId: "root",
    path: "api/order/discount7",
    index: void 0,
    caseSensitive: void 0,
    module: route14
  },
  "routes/api.order.discount8": {
    id: "routes/api.order.discount8",
    parentId: "root",
    path: "api/order/discount8",
    index: void 0,
    caseSensitive: void 0,
    module: route15
  },
  "routes/public.invoice-link": {
    id: "routes/public.invoice-link",
    parentId: "root",
    path: "public/invoice-link",
    index: void 0,
    caseSensitive: void 0,
    module: route16
  },
  "routes/api.order.discount": {
    id: "routes/api.order.discount",
    parentId: "root",
    path: "api/order/discount",
    index: void 0,
    caseSensitive: void 0,
    module: route17
  },
  "routes/api.order.shipping": {
    id: "routes/api.order.shipping",
    parentId: "root",
    path: "api/order/shipping",
    index: void 0,
    caseSensitive: void 0,
    module: route18
  },
  "routes/api.order.address": {
    id: "routes/api.order.address",
    parentId: "root",
    path: "api/order/address",
    index: void 0,
    caseSensitive: void 0,
    module: route19
  },
  "routes/api.order.contact": {
    id: "routes/api.order.contact",
    parentId: "root",
    path: "api/order/contact",
    index: void 0,
    caseSensitive: void 0,
    module: route20
  },
  "routes/api.order.invoice": {
    id: "routes/api.order.invoice",
    parentId: "root",
    path: "api/order/invoice",
    index: void 0,
    caseSensitive: void 0,
    module: route21
  },
  "routes/api.order.cancel": {
    id: "routes/api.order.cancel",
    parentId: "root",
    path: "api/order/cancel",
    index: void 0,
    caseSensitive: void 0,
    module: route22
  },
  "routes/api.order.note": {
    id: "routes/api.order.note",
    parentId: "root",
    path: "api/order/note",
    index: void 0,
    caseSensitive: void 0,
    module: route23
  },
  "routes/auth.login": {
    id: "routes/auth.login",
    parentId: "root",
    path: "auth/login",
    index: void 0,
    caseSensitive: void 0,
    module: route24
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route25
  },
  "routes/auth.$": {
    id: "routes/auth.$",
    parentId: "root",
    path: "auth/*",
    index: void 0,
    caseSensitive: void 0,
    module: route26
  },
  "routes/app": {
    id: "routes/app",
    parentId: "root",
    path: "app",
    index: void 0,
    caseSensitive: void 0,
    module: route27
  },
  "routes/app.active-services": {
    id: "routes/app.active-services",
    parentId: "routes/app",
    path: "active-services",
    index: void 0,
    caseSensitive: void 0,
    module: route28
  },
  "routes/app.additional": {
    id: "routes/app.additional",
    parentId: "routes/app",
    path: "additional",
    index: void 0,
    caseSensitive: void 0,
    module: route29
  },
  "routes/app.insights": {
    id: "routes/app.insights",
    parentId: "routes/app",
    path: "insights",
    index: void 0,
    caseSensitive: void 0,
    module: route30
  },
  "routes/app._index": {
    id: "routes/app._index",
    parentId: "routes/app",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route31
  }
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr
};
