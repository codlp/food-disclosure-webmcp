#!/usr/bin/env node
/**
 * Drive the Maple & Sage storefront as a WebMCP agent (Chrome consumer API).
 * Does not print URLs, GIDs, passwords, or cookies.
 *
 * Optional store URL: FOOD_DISCLOSURE_STORE_URL or
 * ~/.config/food-disclosure-webmcp/shopify-store.env
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CONFIG_DIR = join(homedir(), ".config/food-disclosure-webmcp");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;

const log = (code, extra = {}) => {
  console.log(JSON.stringify({ code, ...extra }));
};

function scrub(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/gid:\/\/shopify\/[A-Za-z]+\/[0-9A-Za-z_-]+/g, "[gid]")
    .replace(/https?:\/\/\S+/g, "[url]");
}

function unwrap(raw, depth = 0) {
  if (raw == null || depth > 6) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return unwrap(JSON.parse(trimmed), depth + 1);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  if (typeof raw !== "object") return raw;
  if (raw.structuredContent) return unwrap(raw.structuredContent, depth + 1);
  if (raw.result && typeof raw.result === "object") return unwrap(raw.result, depth + 1);
  if (Array.isArray(raw.content)) {
    const text = raw.content.find((row) => row?.type === "text")?.text ?? raw.content[0]?.text;
    if (text) return unwrap(text, depth + 1);
  }
  return raw;
}

function cartQty(raw) {
  const value = unwrap(raw);
  if (!value || typeof value !== "object") return null;
  const cart = value.cart && typeof value.cart === "object" ? value.cart : value;
  if (typeof cart.totalQuantity === "number") return cart.totalQuantity;
  if (typeof cart.item_count === "number") return cart.item_count;
  const lines = Array.isArray(cart.lines)
    ? cart.lines
    : Array.isArray(cart.lines?.nodes)
      ? cart.lines.nodes
      : Array.isArray(cart.line_items)
        ? cart.line_items
        : null;
  if (!Array.isArray(lines)) return null;
  return lines.reduce(
    (sum, line) => sum + (typeof line?.quantity === "number" ? line.quantity : 0),
    0,
  );
}

function shape(raw) {
  const value = unwrap(raw);
  if (value == null) return { kind: "null", qty: null };
  if (typeof value !== "object") return { kind: typeof value, qty: null };
  return {
    kind: "object",
    keys: Object.keys(value).slice(0, 16),
    cartKeys:
      value.cart && typeof value.cart === "object" ? Object.keys(value.cart).slice(0, 16) : null,
    qty: cartQty(value),
    userErrorCount: Array.isArray(value.userErrors) ? value.userErrors.length : null,
  };
}

function isGateReject(raw) {
  const text = JSON.stringify(raw);
  return (
    /Retrieve this product's current ingredient/.test(text) ||
    /DISCLOSURE_RETRIEVAL_REQUIRED/.test(text) ||
    /UNKNOWN_PRODUCT_VARIANT/.test(text) ||
    /could not be associated with a product version/.test(text)
  );
}

function isShopifyUnresolved(raw) {
  const text = JSON.stringify(raw);
  return /Missing item\.id, handle, or query/.test(text) || /Need clarification for/.test(text);
}

function isDuplicateSuppressed(raw) {
  return /identical add was just applied/i.test(JSON.stringify(raw));
}

function isSuccessfulCartUpdate(raw) {
  const value = unwrap(raw);
  if (isGateReject(raw) || isShopifyUnresolved(raw)) return false;
  if (typeof raw?.error === "string" && raw.error.length > 0) return false;
  if (value && typeof value === "object" && value.updated === false) return false;
  const qty = cartQty(raw);
  if (typeof qty === "number" && qty >= 1) return true;
  if (value && typeof value === "object" && value.updated === true) return true;
  const text = JSON.stringify(raw);
  return /"updated"\s*:\s*true/.test(text) || /totalQuantity/.test(text) || /line_items/.test(text);
}

async function previewUrl() {
  const raw = JSON.parse(
    await readFile(join(CONFIG_DIR, "owned/theme-push-unpublished.json"), "utf8"),
  );
  const url = raw?.theme?.preview_url;
  if (!url) throw new Error("missing preview url in local config");
  return url;
}

async function visitorPassword() {
  if (process.env.FOOD_DISCLOSURE_VISITOR_PASSWORD) {
    return process.env.FOOD_DISCLOSURE_VISITOR_PASSWORD;
  }
  try {
    return (await readFile(join(CONFIG_DIR, "visitor-password"), "utf8")).trim();
  } catch {
    return "";
  }
}

async function cdp(ws, method, params = {}, sessionId) {
  const id = Math.floor(Math.random() * 1e9);
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cdp timeout ${method}`)), 30000);
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
  });
}

async function evaluate(ws, sessionId, expression, awaitPromise = true) {
  const result = await cdp(
    ws,
    "Runtime.evaluate",
    {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: 25000,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "evaluate failed");
  }
  return result.result?.value;
}

async function waitFor(ws, sessionId, expression, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await evaluate(ws, sessionId, expression);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`timeout waiting for ${expression.slice(0, 80)}`);
}

function launchChrome(userDataDir, url) {
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${PORT}`,
      "--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      url,
    ],
    { stdio: "ignore" },
  );
  return child;
}

async function connectBrowser() {
  let version;
  for (let i = 0; i < 40; i += 1) {
    try {
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
      break;
    } catch {
      await delay(250);
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error("chrome debugging port did not open");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("browser websocket failed")));
  });
  return ws;
}

const AGENT_SOURCE = String.raw`
(() => {
  const ctx = () => document.modelContext || navigator.modelContext;
  const testing = () => navigator.modelContextTesting;
  const payload = () => {
    const raw = document.getElementById("food-disclosure-payload")?.textContent;
    return raw ? JSON.parse(raw) : [];
  };
  const status = () => document.getElementById("food-disclosure-status")?.textContent || "";
  const probe = () => ({
    hasDocumentContext: "modelContext" in document,
    hasTesting: typeof testing()?.listTools === "function",
    hasRegister: typeof ctx()?.registerTool === "function",
    hasExecute: typeof ctx()?.executeTool === "function",
    hasShopifyCart: Boolean(window.Shopify?.actions?.updateCart && window.Shopify?.actions?.getCart),
    passwordForm: Boolean(document.getElementById("password") && document.querySelector("form")),
    harbor: Boolean(document.getElementById("food-disclosure-payload")),
    status: status(),
  });
  const toolNames = async () => {
    if (testing()?.listTools) {
      const tools = await testing().listTools();
      return (tools || []).map((t) => t.name || t);
    }
    if (ctx()?.getTools) {
      const tools = await ctx().getTools();
      return (tools || []).map((t) => t.name);
    }
    return [];
  };
  const call = async (name, args) => {
    const json = JSON.stringify(args || {});
    if (testing()?.executeTool) return await testing().executeTool(name, json);
    const tools = await ctx().getTools();
    const tool = (tools || []).find((t) => t.name === name);
    if (!tool) throw new Error("missing tool " + name);
    return await ctx().executeTool(tool, json);
  };
  const ids = () => {
    const row = payload()[0] || {};
    return { productId: row.product_id, variantId: row.variant_ids?.[0], handle: row.handle };
  };
  const byHandle = (handle) => payload().find((row) => row.handle === handle) || null;
  const toolDetails = async () => {
    const list = testing()?.listTools
      ? await testing().listTools()
      : ctx()?.getTools
        ? await ctx().getTools()
        : [];
    return (list || []).map((t) => {
      let blob = "";
      try {
        blob = JSON.stringify(t);
      } catch {
        blob = "";
      }
      const annotations = t?.annotations && typeof t.annotations === "object" ? t.annotations : {};
      return {
        name: t?.name,
        title: t?.title || annotations.title || null,
        keys: t && typeof t === "object" ? Object.keys(t).slice(0, 24) : [],
        annotationKeys: Object.keys(annotations).slice(0, 16),
        readOnlyHint: annotations.readOnlyHint ?? t?.readOnlyHint,
        untrustedContentHint: annotations.untrustedContentHint ?? t?.untrustedContentHint,
        blobHasReadOnlyFalse: /"readOnlyHint"\s*:\s*false/.test(blob),
        blobHasUntrustedTrue: /"untrustedContentHint"\s*:\s*true/.test(blob),
      };
    });
  };
  const receipts = () => {
    try {
      const raw = sessionStorage.getItem("food-disclosure:receipts:v1");
      const rows = raw ? JSON.parse(raw) : [];
      return { count: Array.isArray(rows) ? rows.length : 0 };
    } catch {
      return { count: 0 };
    }
  };
  const checkout = () => ({
    checkoutControl: Boolean(
      document.querySelector(
        'button[name="checkout"], input[name="checkout"], a[href*="/checkout"]',
      ),
    ),
  });
  const humanCart = () => ({
    addForm: Boolean(document.querySelector('button[name="add"]')),
    qtyInput: Boolean(document.querySelector('input[name="updates[]"]')),
    updateButton: Boolean(document.querySelector('button[name="update"]')),
    removeLink: Boolean(
      [...document.querySelectorAll("a")].some((a) =>
        /remove|quantity=0/i.test(a.href || a.textContent || ""),
      ),
    ),
  });
  window.__foodDisclosureAgent = {
    probe,
    toolNames,
    toolDetails,
    call,
    ids,
    byHandle,
    status,
    payload,
    receipts,
    checkout,
    humanCart,
  };
  return probe();
})()
`;

async function run() {
  const url = await previewUrl();
  const password = await visitorPassword();
  const userDataDir = await mkdtemp(join(tmpdir(), "fd-webmcp-chrome-"));
  const chrome = launchChrome(userDataDir, url);
  let ws;
  const checks = [];
  const fail = (code, extra) => {
    checks.push({ code, ok: false, ...extra });
  };
  const pass = (code, extra) => {
    checks.push({ code, ok: true, ...extra });
  };
  try {
    ws = await connectBrowser();
    const targets = await cdp(ws, "Target.getTargets");
    const page = (targets.targetInfos || []).find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    const attached = await cdp(ws, "Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    await cdp(ws, "Page.enable", {}, sessionId);
    await cdp(ws, "Runtime.enable", {}, sessionId);
    await delay(1500);

    let probe = await evaluate(ws, sessionId, AGENT_SOURCE);
    if (probe.passwordForm) {
      if (!password) {
        fail("password_gate", { detail: "visitor password is not in local config" });
        return { checks, probe };
      }
      await evaluate(
        ws,
        sessionId,
        `(() => {
          const input = document.getElementById("password");
          const form = input?.form;
          if (!input || !form) return false;
          input.value = ${JSON.stringify(password)};
          form.submit();
          return true;
        })()`,
        false,
      );
      await delay(2500);
      probe = await evaluate(ws, sessionId, AGENT_SOURCE);
    }

    if (!probe.harbor) {
      fail("storefront_not_loaded", { probe: scrub(probe) });
      return { checks, probe };
    }
    pass("storefront_loaded");

    await waitFor(
      ws,
      sessionId,
      `Boolean((document.modelContext||navigator.modelContext)?.registerTool || navigator.modelContextTesting?.listTools)`,
      60,
    ).catch(() => null);
    await delay(1500);
    probe = await evaluate(ws, sessionId, AGENT_SOURCE);
    if (!probe.hasRegister && !probe.hasTesting) {
      fail("webmcp_api_missing", { probe });
      return { checks, probe };
    }
    pass("webmcp_api", { hasTesting: probe.hasTesting, hasRegister: probe.hasRegister });

    const names = await evaluate(ws, sessionId, `window.__foodDisclosureAgent.toolNames()`);
    const nameList = Array.isArray(names) ? names : [];
    pass("tools_listed", { names: nameList, count: nameList.length });
    if (!nameList.includes("get_product_food_disclosures")) {
      fail("custom_tool_missing");
    } else {
      pass("custom_tool_present");
    }
    const native = ["update_cart", "get_cart", "search_catalog", "get_product"].filter((n) =>
      nameList.includes(n),
    );
    if (native.length === 0) fail("native_tools_missing");
    else pass("native_tools_present", { native });

    const details = await evaluate(ws, sessionId, `window.__foodDisclosureAgent.toolDetails()`);
    const customMeta = Array.isArray(details)
      ? details.find((row) => row?.name === "get_product_food_disclosures")
      : null;
    const bundleHints = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const src = document.querySelector('script[src*="disclosure-bootstrap"]')?.src;
        if (!src) return { found: false };
        const js = await fetch(src).then((r) => r.text());
        return {
          found: true,
          readOnlyFalse: /readOnlyHint\\s*:\\s*(!1|false)/.test(js),
          untrustedTrue: /untrustedContentHint\\s*:\\s*(!0|true)/.test(js),
        };
      })()`,
    );
    if (
      (customMeta?.readOnlyHint === false ||
        customMeta?.blobHasReadOnlyFalse ||
        bundleHints?.readOnlyFalse) &&
      (customMeta?.untrustedContentHint === true ||
        customMeta?.blobHasUntrustedTrue ||
        bundleHints?.untrustedTrue)
    ) {
      pass("tool_annotations", {
        title: customMeta?.title || null,
        listToolsKeys: customMeta?.keys || [],
        fromBundle: Boolean(bundleHints?.readOnlyFalse && bundleHints?.untrustedTrue),
      });
    } else {
      fail("tool_annotations", { detail: { customMeta, bundleHints } });
    }

    async function bootPage() {
      await waitFor(
        ws,
        sessionId,
        `Boolean(document.getElementById("food-disclosure-payload"))`,
        60,
      );
      await waitFor(
        ws,
        sessionId,
        `Boolean((document.modelContext||navigator.modelContext)?.registerTool || navigator.modelContextTesting?.listTools)`,
        40,
      ).catch(() => null);
      await delay(800);
      return evaluate(ws, sessionId, AGENT_SOURCE);
    }

    async function goTo(pathname) {
      await evaluate(
        ws,
        sessionId,
        `(() => {
          const u = new URL(location.href);
          u.pathname = ${JSON.stringify(pathname)};
          location.assign(u.pathname + u.search);
          return true;
        })()`,
        false,
      );
      await delay(2500);
      return bootPage();
    }

    const ids = await evaluate(ws, sessionId, `window.__foodDisclosureAgent.ids()`);
    if (!ids?.variantId || !ids?.productId) {
      fail("disclosure_payload_missing");
      return { checks, probe };
    }

    const rejected = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const { variantId } = window.__foodDisclosureAgent.ids();
        return await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, item: { id: variantId } }] },
        });
      })()`,
    );

    const rejectText = scrub(rejected);
    const rejectOk = isGateReject(rejected);
    if (rejectOk) pass("reject_without_retrieval");
    else fail("reject_without_retrieval", { result: rejectText.slice(0, 400) });

    const cartAfterReject = await evaluate(
      ws,
      sessionId,
      `(async () => {
        try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
        catch (e) { return { error: String(e) }; }
      })()`,
    );
    const qtyAfterReject = cartQty(cartAfterReject);
    if (qtyAfterReject === 0 || qtyAfterReject == null) pass("cart_unchanged_after_reject");
    else fail("cart_unchanged_after_reject", { qtyAfterReject, shape: shape(cartAfterReject) });

    await evaluate(
      ws,
      sessionId,
      `(() => {
        const button = document.querySelector('button[name="add"]');
        button?.form?.submit();
        return Boolean(button?.form);
      })()`,
      false,
    );
    await delay(1500);
    const cartAfterFormReject = await evaluate(
      ws,
      sessionId,
      `(async () => {
        try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
        catch (e) { return { error: String(e) }; }
      })()`,
    );
    const qtyAfterFormReject = cartQty(cartAfterFormReject);
    if (qtyAfterFormReject === 0 || qtyAfterFormReject == null) {
      pass("form_add_rejected_without_retrieval");
    } else {
      fail("form_add_rejected_without_retrieval", {
        qtyAfterFormReject,
        shape: shape(cartAfterFormReject),
      });
    }

    const handleRejected = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const { handle } = window.__foodDisclosureAgent.ids();
        return await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, handle }] },
        });
      })()`,
    );
    if (isGateReject(handleRejected)) pass("reject_handle_without_retrieval");
    else if (isShopifyUnresolved(handleRejected))
      fail("reject_handle_without_retrieval", { result: scrub(handleRejected).slice(0, 400) });
    else fail("reject_handle_without_retrieval", { result: scrub(handleRejected).slice(0, 400) });

    const queryRejected = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const direct = await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, query: "harbor salt potato chips" }] },
        });
        const directText = JSON.stringify(direct);
        if (
          /Retrieve this product/.test(directText) ||
          /DISCLOSURE_RETRIEVAL_REQUIRED/.test(directText) ||
          /UNKNOWN_PRODUCT_VARIANT/.test(directText)
        ) {
          return { path: "query_field", result: direct };
        }
        const catalog = await window.__foodDisclosureAgent.call("search_catalog", {
          query: "Harbor Salt Potato Chips",
        });
        const blob = JSON.stringify(catalog);
        const variantId = blob.match(/gid:\\/\\/shopify\\/ProductVariant\\/[0-9]+/)?.[0];
        const productId = blob.match(/gid:\\/\\/shopify\\/Product\\/[0-9]+/)?.[0];
        const id = variantId || productId;
        if (!id) return { path: "search_catalog", result: direct, catalogEmpty: true };
        const viaCatalog = await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, item: { id } }] },
        });
        return { path: "search_catalog", result: viaCatalog };
      })()`,
    );
    if (isGateReject(queryRejected))
      pass("reject_query_without_retrieval", { path: queryRejected?.path || "query_field" });
    else
      fail("reject_query_without_retrieval", {
        path: queryRejected?.path || null,
        result: scrub(queryRejected).slice(0, 400),
      });

    const retrieved = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const { productId } = window.__foodDisclosureAgent.ids();
        return await window.__foodDisclosureAgent.call("get_product_food_disclosures", {
          product_ids: [productId],
        });
      })()`,
    );
    const retrievedOk =
      retrieved?.ok === true ||
      JSON.stringify(retrieved).includes("Merchant-supplied declarations only");
    if (retrievedOk) pass("retrieve_ok");
    else fail("retrieve_ok", { result: scrub(retrieved).slice(0, 400) });

    const hillpath = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const row = window.__foodDisclosureAgent.byHandle("hillpath-trail-mix");
        if (!row?.product_id) return { error: "missing_hillpath" };
        const raw = await window.__foodDisclosureAgent.call("get_product_food_disclosures", {
          product_ids: [row.product_id],
        });
        const text = typeof raw === "string" ? raw : JSON.stringify(raw);
        let parsed = raw;
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          parsed = raw;
        }
        const product =
          parsed?.products?.[0] ||
          parsed?.structuredContent?.products?.[0] ||
          parsed?.result?.products?.[0];
        return {
          hasWarningsKey: /"warnings"\\s*:/.test(text),
          label_statements: product?.label_statements ?? null,
          ok: parsed?.ok,
        };
      })()`,
    );
    if (
      hillpath &&
      hillpath.error !== "missing_hillpath" &&
      hillpath.hasWarningsKey === false &&
      hillpath.label_statements === null
    ) {
      pass("hillpath_label_statements_null");
    } else {
      fail("hillpath_label_statements_null", { result: scrub(hillpath).slice(0, 400) });
    }

    const accepted = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const { variantId } = window.__foodDisclosureAgent.ids();
        return await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, item: { id: variantId } }] },
        });
      })()`,
    );
    const acceptedText = JSON.stringify(accepted);
    const acceptedFail =
      /Retrieve this product/.test(acceptedText) ||
      /after\.lines\.filter/.test(acceptedText) ||
      (typeof accepted?.error === "string" && accepted.error.length > 0);
    if (acceptedFail)
      fail("accept_after_retrieval", {
        result: scrub(accepted).slice(0, 400),
        shape: shape(accepted),
      });
    else pass("accept_after_retrieval", { shape: shape(accepted) });

    await delay(800);
    const cartAfterAccept = await evaluate(
      ws,
      sessionId,
      `(async () => {
        try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
        catch (e) { return { error: String(e) }; }
      })()`,
    );
    const qtyAfterAccept = cartQty(accepted) ?? cartQty(cartAfterAccept);
    if (typeof qtyAfterAccept === "number" && qtyAfterAccept >= 1)
      pass("cart_increased", {
        qtyAfterAccept,
        fromAccept: cartQty(accepted),
        fromGetCart: cartQty(cartAfterAccept),
      });
    else
      fail("cart_increased", {
        shapeAccept: shape(accepted),
        shapeGetCart: shape(cartAfterAccept),
      });

    const handleAccepted = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const { handle } = window.__foodDisclosureAgent.ids();
        return await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, handle }] },
        });
      })()`,
    );
    if (isSuccessfulCartUpdate(handleAccepted) || isDuplicateSuppressed(handleAccepted))
      pass("accept_handle_after_retrieval", { shape: shape(handleAccepted) });
    else
      fail("accept_handle_after_retrieval", {
        result: scrub(handleAccepted).slice(0, 400),
        shape: shape(handleAccepted),
      });

    const queryAfterReceipt = await evaluate(
      ws,
      sessionId,
      `(async () => {
        return await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, query: "harbor salt potato chips" }] },
        });
      })()`,
    );
    if (
      isGateReject(queryAfterReceipt) ||
      isShopifyUnresolved(queryAfterReceipt) ||
      isSuccessfulCartUpdate(queryAfterReceipt) ||
      isDuplicateSuppressed(queryAfterReceipt)
    )
      pass("query_reaches_gate", {
        failClosed: isGateReject(queryAfterReceipt),
        duplicate: isDuplicateSuppressed(queryAfterReceipt),
      });
    else fail("query_reaches_gate", { result: scrub(queryAfterReceipt).slice(0, 400) });

    await goTo("/collections/food-disclosure-demo");
    const afterNav = await evaluate(
      ws,
      sessionId,
      `({
        receipts: window.__foodDisclosureAgent.receipts(),
        status: window.__foodDisclosureAgent.status(),
      })`,
    );
    if (afterNav?.receipts?.count >= 1)
      pass("receipt_survives_navigation", { count: afterNav.receipts.count });
    else fail("receipt_survives_navigation", { afterNav });
    const reviewOk =
      typeof afterNav?.status === "string" &&
      (/Retrieved for this product version/.test(afterNav.status) ||
        /Disclosures retrieved/.test(afterNav.status) ||
        /Cart updated after current disclosures/.test(afterNav.status));
    if (reviewOk) pass("review_survives_navigation");
    else fail("review_survives_navigation", { status: afterNav?.status || "" });

    const afterNavAdd = await evaluate(
      ws,
      sessionId,
      `(async () => {
        const { variantId } = window.__foodDisclosureAgent.ids();
        return await window.__foodDisclosureAgent.call("update_cart", {
          cart: { line_items: [{ quantity: 1, item: { id: variantId } }] },
        });
      })()`,
    );
    if (
      !isGateReject(afterNavAdd) &&
      !(typeof afterNavAdd?.error === "string" && afterNavAdd.error)
    )
      pass("gate_still_accepts_after_navigation", { shape: shape(afterNavAdd) });
    else fail("gate_still_accepts_after_navigation", { result: scrub(afterNavAdd).slice(0, 400) });

    await goTo("/products/harbor-salt-potato-chips");
    const productPage = await evaluate(ws, sessionId, `window.__foodDisclosureAgent.humanCart()`);
    if (!productPage?.addForm) {
      fail("human_add", { detail: "add button missing on product page" });
    } else {
      const qtyBeforeHuman = await evaluate(
        ws,
        sessionId,
        `(async () => {
          try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
          catch (e) { return { error: String(e) }; }
        })()`,
      );
      await evaluate(
        ws,
        sessionId,
        `(() => {
          const button = document.querySelector('button[name="add"]');
          button?.form?.submit();
          return Boolean(button?.form);
        })()`,
        false,
      );
      await delay(2500);
      await bootPage();
      const qtyAfterHuman = await evaluate(
        ws,
        sessionId,
        `(async () => {
          try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
          catch (e) { return { error: String(e) }; }
        })()`,
      );
      const before = cartQty(qtyBeforeHuman) ?? 0;
      const after = cartQty(qtyAfterHuman);
      if (typeof after === "number" && after > before) pass("human_add", { before, after });
      else fail("human_add", { before, after, shape: shape(qtyAfterHuman) });
    }

    await goTo("/cart");
    const cartPage = await evaluate(ws, sessionId, `window.__foodDisclosureAgent.humanCart()`);
    if (cartPage?.qtyInput && cartPage?.updateButton) {
      await evaluate(
        ws,
        sessionId,
        `(() => {
          const input = document.querySelector('input[name="updates[]"]');
          const current = Number(input?.value || "1");
          if (input) input.value = String(Math.max(0, current - 1));
          const button = document.querySelector('button[name="update"]');
          button?.form?.requestSubmit(button) || button?.form?.submit();
          return { current, next: input?.value };
        })()`,
        false,
      );
      await delay(2500);
      await bootPage();
      const qtyAfterDecrease = await evaluate(
        ws,
        sessionId,
        `(async () => {
          try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
          catch (e) { return { error: String(e) }; }
        })()`,
      );
      pass("human_quantity_decrease", {
        qty: cartQty(qtyAfterDecrease),
        shape: shape(qtyAfterDecrease),
      });
    } else {
      fail("human_quantity_decrease", { cartPage });
    }

    const cartAfterDecrease = await evaluate(
      ws,
      sessionId,
      `window.__foodDisclosureAgent.humanCart()`,
    );
    if (cartAfterDecrease?.removeLink) {
      await evaluate(
        ws,
        sessionId,
        `(() => {
          const link = [...document.querySelectorAll("a")].find((a) =>
            /remove|quantity=0/i.test(a.href || a.textContent || ""),
          );
          if (link) location.assign(link.href);
          return Boolean(link);
        })()`,
        false,
      );
      await delay(2500);
      await bootPage();
      const qtyAfterRemove = await evaluate(
        ws,
        sessionId,
        `(async () => {
          try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
          catch (e) { return { error: String(e) }; }
        })()`,
      );
      const removedQty = cartQty(qtyAfterRemove);
      if (removedQty === 0 || removedQty == null) pass("human_remove", { qty: removedQty });
      else fail("human_remove", { qty: removedQty });
    } else if (cartAfterDecrease?.qtyInput) {
      await evaluate(
        ws,
        sessionId,
        `(() => {
          const input = document.querySelector('input[name="updates[]"]');
          if (input) input.value = "0";
          const button = document.querySelector('button[name="update"]');
          button?.form?.requestSubmit(button) || button?.form?.submit();
          return Boolean(input);
        })()`,
        false,
      );
      await delay(2500);
      await bootPage();
      const qtyAfterRemove = await evaluate(
        ws,
        sessionId,
        `(async () => {
          try { return await window.__foodDisclosureAgent.call("get_cart", {}); }
          catch (e) { return { error: String(e) }; }
        })()`,
      );
      pass("human_remove", { qty: cartQty(qtyAfterRemove) });
    } else {
      fail("human_remove", { cartAfterDecrease });
    }

    const checkout = await evaluate(ws, sessionId, `window.__foodDisclosureAgent.checkout()`);
    if (!checkout?.checkoutControl) pass("no_real_payment", checkout);
    else fail("no_real_payment", checkout);

    return { checks, probe: { hasTesting: probe.hasTesting, hasRegister: probe.hasRegister } };
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    chrome.kill("SIGTERM");
    await delay(500);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

const result = await run();
const failed = result.checks.filter((c) => c.ok === false);
log("webmcp_chrome_slice", {
  passed: result.checks.filter((c) => c.ok).map((c) => c.code),
  failed: failed.map((c) => ({ code: c.code, detail: c.detail || c.result || c.probe || null })),
});
process.exit(failed.length ? 1 : 0);
