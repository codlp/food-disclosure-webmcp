"use strict";
(() => {
  // src/types.ts
  var PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/[0-9]+$/;
  var EMPTY_CART = {
    id: "",
    totalQuantity: 0,
    cost: { totalAmount: { amount: "0.00", currencyCode: "USD" } },
    lines: [],
    discountCodes: []
  };
  var TOOL_NOTICE = "Merchant-supplied declarations only. Compare them with the shopper's explicit request; this tool does not determine suitability.";
  var STORAGE_RECEIPTS = "food-disclosure:receipts:v1";
  var STORAGE_TAB = "food-disclosure:tab-session:v1";
  var STORAGE_LINE_MAP = "food-disclosure:line-map:v1";

  // src/validation.ts
  var MAX_INGREDIENT_CHARS = 2e3;
  var MAX_LABEL_STATEMENTS = 5;
  var MAX_LABEL_STATEMENT_CHARS = 240;
  function normalizeVariantGid(raw) {
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    const gid = trimmed.match(/gid:\/\/shopify\/ProductVariant\/[0-9]+/);
    if (gid?.[0]) return gid[0];
    if (/^[0-9]+$/.test(trimmed)) return `gid://shopify/ProductVariant/${trimmed}`;
    return null;
  }
  function isProductGid(value) {
    return typeof value === "string" && PRODUCT_GID_PATTERN.test(value);
  }
  function validateLabelStatements(value) {
    if (value === null) return null;
    if (!Array.isArray(value)) return { error: "LABEL_STATEMENTS_MALFORMED" };
    if (value.length > MAX_LABEL_STATEMENTS) return { error: "LABEL_STATEMENTS_MALFORMED" };
    const seen = /* @__PURE__ */ new Set();
    const label_statements = [];
    for (const item of value) {
      if (typeof item !== "string") return { error: "LABEL_STATEMENTS_MALFORMED" };
      const text2 = item.trim();
      if (!text2 || text2.length > MAX_LABEL_STATEMENT_CHARS) {
        return { error: "LABEL_STATEMENTS_MALFORMED" };
      }
      if (seen.has(text2)) return { error: "LABEL_STATEMENTS_MALFORMED" };
      seen.add(text2);
      label_statements.push(item);
    }
    return label_statements;
  }
  function validateIngredients(value) {
    if (value === null) return null;
    if (typeof value !== "string") return { error: "INGREDIENTS_MALFORMED" };
    if (!value.trim() || value.length > MAX_INGREDIENT_CHARS) {
      return { error: "INGREDIENTS_MALFORMED" };
    }
    return value;
  }
  function validateRenderedDisclosure(raw) {
    if (!raw || typeof raw !== "object") return { error: "PAYLOAD_MALFORMED" };
    const row = raw;
    if (!isProductGid(row.product_id)) return { error: "PAYLOAD_MALFORMED" };
    if (typeof row.handle !== "string" || !row.handle.trim()) return { error: "PAYLOAD_MALFORMED" };
    if (typeof row.title !== "string" || !row.title.trim()) return { error: "PAYLOAD_MALFORMED" };
    if (!Array.isArray(row.variant_ids) || row.variant_ids.length < 1) {
      return { error: "PAYLOAD_MALFORMED" };
    }
    const variant_ids = [];
    for (const id of row.variant_ids) {
      if (typeof id !== "string") return { error: "PAYLOAD_MALFORMED" };
      const normalized = normalizeVariantGid(id);
      if (!normalized) return { error: "PAYLOAD_MALFORMED" };
      variant_ids.push(normalized);
    }
    const ingredients = validateIngredients(row.ingredients);
    if (ingredients && typeof ingredients === "object") return { error: ingredients.error };
    const label_statements = validateLabelStatements(row.label_statements);
    if (label_statements && typeof label_statements === "object" && "error" in label_statements) {
      return { error: label_statements.error };
    }
    return {
      product_id: row.product_id,
      handle: row.handle,
      title: row.title,
      variant_ids,
      ingredients,
      label_statements
    };
  }
  function collectProductIdInputs(input) {
    if (!input || typeof input !== "object") return { error: "INVALID_ARGUMENTS" };
    const root = input;
    const nested = root.parameters && typeof root.parameters === "object" ? root.parameters : root;
    const raw = nested.product_ids ?? nested.productIds ?? root.product_ids ?? root.productIds;
    if (typeof raw === "string") return [raw];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      const values = Object.values(raw);
      if (values.length > 0) return values;
    }
    return { error: "INVALID_ARGUMENTS" };
  }
  function normalizeDisclosureId(value) {
    if (value && typeof value === "object") {
      const inner = value;
      const nested = inner.id ?? inner.product_id ?? inner.value ?? inner.handle;
      if (nested !== void 0) return normalizeDisclosureId(nested);
    }
    if (typeof value !== "string") return { error: "INVALID_PRODUCT_ID" };
    const trimmed = value.trim().replace(/^["']|["']$/g, "").split("?")[0] ?? "";
    if (PRODUCT_GID_PATTERN.test(trimmed)) return trimmed;
    const variant = trimmed.match(/^(gid:\/\/shopify\/ProductVariant\/[0-9]+)/);
    if (variant?.[1]) return variant[1];
    const opaqueProduct = trimmed.match(/^(gid:\/\/shopify\/p\/[A-Za-z0-9_-]+)/);
    if (opaqueProduct?.[1]) return opaqueProduct[1];
    if (/^[0-9]+$/.test(trimmed)) return `gid://shopify/Product/${trimmed}`;
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) && trimmed.length <= 80) return trimmed;
    return { error: "INVALID_PRODUCT_ID" };
  }
  function validateProductIdList(input) {
    const collected = collectProductIdInputs(input);
    if (!Array.isArray(collected)) return collected;
    if (collected.length < 1) return { error: "INVALID_ARGUMENTS" };
    if (collected.length > 4) return { error: "TOO_MANY_PRODUCTS" };
    const unique = /* @__PURE__ */ new Set();
    for (const id of collected) {
      const normalized = normalizeDisclosureId(id);
      if (typeof normalized !== "string") return normalized;
      if (unique.has(normalized)) return { error: "DUPLICATE_PRODUCT_ID" };
      unique.add(normalized);
    }
    return [...unique];
  }

  // src/disclosures.ts
  async function productVersion(record) {
    const payload = JSON.stringify({
      schema: 1,
      product_id: record.product_id,
      variant_ids: record.variant_ids,
      ingredients: record.ingredients,
      label_statements: record.label_statements
    });
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
  }
  function parseRegistry(rawJson) {
    if (!rawJson || !rawJson.trim()) return { error: "PAYLOAD_MISSING" };
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return { error: "PAYLOAD_MALFORMED" };
    }
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 12) {
      return { error: "PAYLOAD_MALFORMED" };
    }
    const list = [];
    const byProductId = /* @__PURE__ */ new Map();
    const byVariantId = /* @__PURE__ */ new Map();
    const byHandle = /* @__PURE__ */ new Map();
    for (const row of parsed) {
      const validated = validateRenderedDisclosure(row);
      if ("error" in validated) return { error: validated.error };
      if (byProductId.has(validated.product_id)) return { error: "PAYLOAD_MALFORMED" };
      if (byHandle.has(validated.handle)) return { error: "PAYLOAD_MALFORMED" };
      byProductId.set(validated.product_id, validated);
      byHandle.set(validated.handle, validated);
      for (const variantId of validated.variant_ids) {
        if (byVariantId.has(variantId)) return { error: "PAYLOAD_MALFORMED" };
        byVariantId.set(variantId, validated);
      }
      list.push(validated);
    }
    return { byProductId, byVariantId, byHandle, list };
  }

  // src/receipts.ts
  function randomId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      storage.removeItem(key);
      return fallback;
    }
  }
  function createReceiptStore(storage, registry) {
    let tabSessionId = storage.getItem(STORAGE_TAB);
    if (!tabSessionId || tabSessionId.length < 8) {
      tabSessionId = randomId();
      storage.setItem(STORAGE_TAB, tabSessionId);
    }
    const receipts = /* @__PURE__ */ new Map();
    const loaded = readJson(storage, STORAGE_RECEIPTS, []);
    if (Array.isArray(loaded)) {
      for (const row of loaded) {
        if (!row || typeof row !== "object") continue;
        const r = row;
        if (typeof r.receiptId !== "string" || typeof r.productId !== "string" || typeof r.productVersion !== "string" || typeof r.tabSessionId !== "string" || !Array.isArray(r.variantIds)) {
          continue;
        }
        if (r.tabSessionId !== tabSessionId) continue;
        receipts.set(r.productId, r);
      }
    }
    function persist() {
      const bounded = [...receipts.values()].filter((r) => registry.byProductId.has(r.productId));
      storage.setItem(STORAGE_RECEIPTS, JSON.stringify(bounded));
    }
    const store = {
      tabSessionId,
      get(productId) {
        return receipts.get(productId);
      },
      async issue(record) {
        const version = await productVersion(record);
        const existing = receipts.get(record.product_id);
        if (existing && existing.productVersion === version && existing.tabSessionId === tabSessionId) {
          return existing;
        }
        const next = {
          receiptId: existing?.receiptId ?? `rcpt_${randomId()}`,
          productId: record.product_id,
          variantIds: [...record.variant_ids],
          productVersion: version,
          tabSessionId,
          issuedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        receipts.set(record.product_id, next);
        persist();
        return next;
      },
      dropStale(current) {
        for (const [productId, receipt] of [...receipts.entries()]) {
          const record = current.byProductId.get(productId);
          if (!record) {
            receipts.delete(productId);
            continue;
          }
          void productVersion(record).then((version) => {
            if (receipt.productVersion !== version) receipts.delete(productId);
            persist();
          });
        }
      }
    };
    return store;
  }
  async function pruneStaleReceipts(storage, registry) {
    const tabSessionId = storage.getItem(STORAGE_TAB);
    const loaded = readJson(storage, STORAGE_RECEIPTS, []);
    if (!Array.isArray(loaded)) {
      storage.removeItem(STORAGE_RECEIPTS);
      return;
    }
    const kept = [];
    for (const row of loaded) {
      if (!row || typeof row !== "object") continue;
      const r = row;
      const record = registry.byProductId.get(r.productId);
      if (!record) continue;
      if (r.tabSessionId !== tabSessionId) continue;
      const version = await productVersion(record);
      if (r.productVersion !== version) continue;
      kept.push(r);
    }
    storage.setItem(STORAGE_RECEIPTS, JSON.stringify(kept));
  }
  function readLineMap(storage) {
    const raw = readJson(storage, STORAGE_LINE_MAP, {});
    const map = /* @__PURE__ */ new Map();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
    for (const [lineId, variantId] of Object.entries(raw)) {
      if (typeof variantId === "string") map.set(lineId, variantId);
    }
    return map;
  }
  function writeLineMap(storage, map) {
    storage.setItem(STORAGE_LINE_MAP, JSON.stringify(Object.fromEntries(map)));
  }

  // src/cart-shape.ts
  function isCartLineGid(value) {
    return typeof value === "string" && /gid:\/\/shopify\/CartLine\//.test(value);
  }
  function asString(value) {
    if (typeof value !== "string") return void 0;
    const trimmed = value.trim();
    return trimmed ? trimmed : void 0;
  }
  function asQuantity(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return void 0;
  }
  function fromUcpLine(row) {
    const rawId = asString(row.id);
    const cartLineId = rawId && isCartLineGid(rawId) ? rawId : void 0;
    const merchandiseId = asString(row.merchandiseId) ?? asString(row.item?.id) ?? (cartLineId ? void 0 : rawId);
    const handle = asString(row.handle) ?? asString(row.item?.handle);
    const query = asString(row.query) ?? asString(row.item?.query);
    const quantity = asQuantity(row.quantity);
    const line = {};
    if (cartLineId) line.id = cartLineId;
    if (merchandiseId) line.merchandiseId = merchandiseId;
    if (handle) line.handle = handle;
    if (query) line.query = query;
    if (quantity !== void 0) line.quantity = quantity;
    return line;
  }
  function rewriteOneLine(row, resolveVariant) {
    const item = row.item && typeof row.item === "object" ? row.item : void 0;
    const candidates = [
      asString(row.merchandiseId),
      asString(item?.id),
      asString(row.id),
      asString(row.handle),
      asString(item?.handle)
    ];
    let variantId;
    for (const candidate of candidates) {
      if (!candidate || isCartLineGid(candidate)) continue;
      variantId = resolveVariant(candidate);
      if (variantId) break;
    }
    if (!variantId) return;
    row.merchandiseId = variantId;
    if (item) item.id = variantId;
    const id = asString(row.id);
    if (id && !isCartLineGid(id)) row.id = "";
  }
  function rewriteUpdateCartPayload(raw, resolveVariant) {
    if (!raw || typeof raw !== "object") return;
    const payload = raw;
    const rewriteList = (value) => {
      if (!Array.isArray(value)) return;
      for (const row of value) {
        if (row && typeof row === "object")
          rewriteOneLine(row, resolveVariant);
      }
    };
    rewriteList(payload.lines);
    rewriteList(payload.line_items);
    if (payload.cart && typeof payload.cart === "object") {
      rewriteList(payload.cart.line_items);
    }
  }
  function copyKnownFields(payload) {
    const next = {};
    if (payload.cartId) next.cartId = payload.cartId;
    if (payload.note) next.note = payload.note;
    if (payload.discountCodes) next.discountCodes = payload.discountCodes;
    if (payload.attributes) next.attributes = payload.attributes;
    if (payload.lines) next.lines = payload.lines;
    return next;
  }
  function normalizeUpdateCartPayload(raw) {
    if (!raw || typeof raw !== "object") return {};
    const payload = raw;
    if (Array.isArray(payload.lines) && payload.lines.length > 0) {
      return copyKnownFields(payload);
    }
    const ucpLines = payload.cart?.line_items ?? payload.line_items;
    if (Array.isArray(ucpLines) && ucpLines.length > 0) {
      const next = copyKnownFields(payload);
      next.lines = ucpLines.map(fromUcpLine);
      return next;
    }
    return copyKnownFields(payload);
  }
  function normalizeCartSummary(raw) {
    if (!raw || typeof raw !== "object") return { ...EMPTY_CART, lines: [] };
    const cart = raw;
    const linesRaw = cart.lines ?? cart.line_items;
    let lines = [];
    if (Array.isArray(linesRaw)) {
      lines = linesRaw;
    } else if (linesRaw && typeof linesRaw === "object") {
      const conn = linesRaw;
      if (Array.isArray(conn.nodes)) {
        lines = conn.nodes;
      } else if (Array.isArray(conn.edges)) {
        lines = conn.edges.map((edge) => edge?.node).filter((node) => !!node && typeof node === "object");
      }
    }
    const cost = cart.cost;
    const totalAmount = cost && typeof cost === "object" ? cost.totalAmount : void 0;
    return {
      id: typeof cart.id === "string" ? cart.id : "",
      totalQuantity: typeof cart.totalQuantity === "number" ? cart.totalQuantity : 0,
      cost: {
        totalAmount: {
          amount: typeof totalAmount?.amount === "string" ? totalAmount.amount : EMPTY_CART.cost.totalAmount.amount,
          currencyCode: typeof totalAmount?.currencyCode === "string" ? totalAmount.currencyCode : EMPTY_CART.cost.totalAmount.currencyCode
        }
      },
      lines,
      discountCodes: Array.isArray(cart.discountCodes) ? cart.discountCodes : []
    };
  }
  function toActionCart(cart) {
    const lines = [...cart.lines];
    Object.defineProperty(lines, "nodes", { value: lines, enumerable: false });
    return {
      ...cart,
      id: cart.id || "gid://shopify/Cart/empty",
      lines
    };
  }

  // src/cart-gate.ts
  var RECOVERY_RETRIEVE = "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update.";
  var RECOVERY_STALE = "The page now contains a different disclosure version. Retrieve it again before increasing the cart quantity.";
  var RECOVERY_LINE = "This cart line could not be associated with a product version retrieved in this tab. Remove or decrease it, or retrieve the product again before an increase.";
  var RECOVERY_UNAVAILABLE = "The disclosure gate is not active in this browser. Do not assume retrieval is required or recorded.";
  function currentQty(cart, lineId) {
    return cart.lines.find((line) => line.id === lineId)?.quantity;
  }
  function resolveAddTarget(raw, registry) {
    if (!raw) return void 0;
    const trimmed = raw.trim().replace(/^["']|["']$/g, "").split("?")[0] ?? "";
    const variantMatch = trimmed.match(/gid:\/\/shopify\/ProductVariant\/[0-9]+/);
    if (variantMatch?.[0]) {
      const record = registry.byVariantId.get(variantMatch[0]);
      if (record) return { record, variantId: variantMatch[0] };
    }
    const productMatch = trimmed.match(/gid:\/\/shopify\/Product\/([0-9]+)/);
    if (productMatch?.[1]) {
      const gid = `gid://shopify/Product/${productMatch[1]}`;
      const record = registry.byProductId.get(gid);
      if (record?.variant_ids[0]) return { record, variantId: record.variant_ids[0] };
    }
    const byHandle = registry.byHandle.get(trimmed);
    if (byHandle?.variant_ids[0]) return { record: byHandle, variantId: byHandle.variant_ids[0] };
    if (/^[0-9]+$/.test(trimmed)) {
      const asVariant = `gid://shopify/ProductVariant/${trimmed}`;
      const variantRecord = registry.byVariantId.get(asVariant);
      if (variantRecord) return { record: variantRecord, variantId: asVariant };
      const asProduct = `gid://shopify/Product/${trimmed}`;
      const productRecord = registry.byProductId.get(asProduct);
      if (productRecord?.variant_ids[0]) {
        return { record: productRecord, variantId: productRecord.variant_ids[0] };
      }
    }
    return void 0;
  }
  function reject(cart, reason, field, message) {
    return {
      cart: toActionCart(cart ?? EMPTY_CART),
      userErrors: [{ code: "INVALID", field, message }],
      detail: { food_disclosure: { reason_code: reason } }
    };
  }
  async function evaluatePayload(payload, cart, deps) {
    const lines = payload.lines ?? [];
    if (lines.length > 10) {
      return {
        ok: false,
        reason: "DISCLOSURE_GATE_UNAVAILABLE",
        field: ["lines"],
        message: RECOVERY_UNAVAILABLE
      };
    }
    const lineMap = readLineMap(deps.storage);
    for (const [index, line] of lines.entries()) {
      const field = ["lines", String(index)];
      const decision = await evaluateLine(line, cart, deps, lineMap, field);
      if (!decision.ok) return decision;
    }
    return { ok: true };
  }
  async function evaluateLine(line, cart, deps, lineMap, field) {
    const quantity = line.quantity ?? 1;
    const cartLineId = isCartLineGid(line.id) ? line.id : void 0;
    const addRaw = line.merchandiseId ?? line.handle ?? (cartLineId ? void 0 : line.id);
    if (cartLineId && !addRaw) {
      const existing = currentQty(cart, cartLineId);
      if (existing === void 0) {
        return {
          ok: false,
          reason: "CART_LINE_ASSOCIATION_REQUIRED",
          field,
          message: RECOVERY_LINE
        };
      }
      if (quantity === 0 || quantity < existing) return { ok: true };
      return requireReceiptForVariant(
        lineMap.get(cartLineId) ?? cart.lines.find((l) => l.id === cartLineId)?.merchandiseId,
        deps,
        field,
        true
      );
    }
    if (addRaw) {
      const resolved = resolveAddTarget(addRaw, deps.registry);
      if (!resolved) {
        return {
          ok: false,
          reason: "UNKNOWN_PRODUCT_VARIANT",
          field,
          message: RECOVERY_RETRIEVE
        };
      }
      return requireReceiptForVariant(resolved.variantId, deps, field, false);
    }
    if (line.query) {
      return {
        ok: false,
        reason: "UNKNOWN_PRODUCT_VARIANT",
        field,
        message: RECOVERY_RETRIEVE
      };
    }
    return {
      ok: false,
      reason: "UNKNOWN_PRODUCT_VARIANT",
      field,
      message: RECOVERY_RETRIEVE
    };
  }
  async function requireReceiptForVariant(variantId, deps, field, association) {
    if (!variantId) {
      return {
        ok: false,
        reason: association ? "CART_LINE_ASSOCIATION_REQUIRED" : "UNKNOWN_PRODUCT_VARIANT",
        field,
        message: association ? RECOVERY_LINE : RECOVERY_RETRIEVE
      };
    }
    const record = deps.registry.byVariantId.get(variantId);
    if (!record) {
      return {
        ok: false,
        reason: "UNKNOWN_PRODUCT_VARIANT",
        field,
        message: RECOVERY_RETRIEVE
      };
    }
    const receipt = deps.receipts.get(record.product_id);
    if (!receipt) {
      return {
        ok: false,
        reason: "DISCLOSURE_RETRIEVAL_REQUIRED",
        field,
        message: RECOVERY_RETRIEVE
      };
    }
    const version = await productVersion(record);
    if (receipt.productVersion !== version || receipt.tabSessionId !== deps.receipts.tabSessionId) {
      return {
        ok: false,
        reason: "DISCLOSURE_VERSION_STALE",
        field,
        message: RECOVERY_STALE
      };
    }
    if (!receipt.variantIds.includes(variantId)) {
      return {
        ok: false,
        reason: "DISCLOSURE_VERSION_STALE",
        field,
        message: RECOVERY_STALE
      };
    }
    return { ok: true };
  }
  async function evaluateVariantAdd(raw, deps) {
    if (!deps.ready) {
      return {
        ok: false,
        reason: "DISCLOSURE_GATE_UNAVAILABLE",
        field: ["id"],
        message: RECOVERY_UNAVAILABLE
      };
    }
    const resolved = resolveAddTarget(raw, deps.registry);
    if (!resolved) {
      return {
        ok: false,
        reason: "UNKNOWN_PRODUCT_VARIANT",
        field: ["id"],
        message: RECOVERY_RETRIEVE
      };
    }
    return requireReceiptForVariant(resolved.variantId, deps, ["id"], false);
  }
  function reconcileLineMap(storage, before, after, payload) {
    const beforeCart = normalizeCartSummary(before);
    const afterCart = normalizeCartSummary(after);
    const map = readLineMap(storage);
    const beforeIds = new Set(beforeCart.lines.map((line) => line.id));
    const added = afterCart.lines.filter((line) => !beforeIds.has(line.id));
    const addLines = (payload.lines ?? []).filter((line) => line.merchandiseId && !line.id);
    if (added.length === 1 && addLines.length === 1) {
      const variantId = normalizeVariantGid(addLines[0]?.merchandiseId ?? "");
      const lineId = added[0]?.id;
      if (variantId && lineId) map.set(lineId, variantId);
    }
    for (const line of afterCart.lines) {
      if (line.merchandiseId) {
        const variantId = normalizeVariantGid(line.merchandiseId);
        if (variantId) map.set(line.id, variantId);
      }
    }
    const afterIds = new Set(afterCart.lines.map((line) => line.id));
    for (const lineId of [...map.keys()]) {
      if (!afterIds.has(lineId)) map.delete(lineId);
    }
    writeLineMap(storage, map);
  }
  var queue = Promise.resolve();
  function serializeCartCall(fn, signal) {
    const run = queue.then(async () => {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      return fn();
    });
    queue = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  async function handleUpdateCart(defaultHandler, payload, options, deps) {
    return serializeCartCall(async () => {
      if (options?.signal?.aborted) {
        throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const normalized = normalizeUpdateCartPayload(payload);
      let cart;
      try {
        cart = normalizeCartSummary(await deps.getCart());
      } catch {
        cart = EMPTY_CART;
      }
      const safeCart = cart ?? EMPTY_CART;
      const needsReceipt = (normalized.lines ?? []).some((line) => {
        if (line.merchandiseId && !isCartLineGid(line.id)) return true;
        if ((line.handle || line.query) && !isCartLineGid(line.id)) return true;
        if (line.id && !isCartLineGid(line.id)) return true;
        if (line.id && isCartLineGid(line.id)) {
          const existing = currentQty(safeCart, line.id) ?? 0;
          return (line.quantity ?? 1) >= existing && (line.quantity ?? 1) > 0;
        }
        return false;
      });
      if (!deps.ready && needsReceipt) {
        return reject(safeCart, "DISCLOSURE_GATE_UNAVAILABLE", ["lines"], RECOVERY_UNAVAILABLE);
      }
      if (!needsReceipt) {
        return defaultHandler();
      }
      const decision = await evaluatePayload(normalized, safeCart, deps);
      if (!decision.ok) {
        return reject(safeCart, decision.reason, decision.field, decision.message);
      }
      if (options?.signal?.aborted) {
        throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const resolveVariant = (raw) => resolveAddTarget(raw, deps.registry)?.variantId;
      rewriteUpdateCartPayload(payload, resolveVariant);
      rewriteUpdateCartPayload(normalized, resolveVariant);
      const result = await defaultHandler();
      if (result.userErrors && result.userErrors.length > 0) {
        return result;
      }
      try {
        reconcileLineMap(deps.storage, safeCart, result.cart ?? EMPTY_CART, normalized);
      } catch {
      }
      return result;
    }, options?.signal);
  }

  // src/cart-routes.ts
  function pathnameOf(url) {
    try {
      return new URL(url, "https://shop.example/").pathname;
    } catch {
      return url;
    }
  }
  function shopPath(url) {
    let path = pathnameOf(url);
    try {
      path = decodeURIComponent(path);
    } catch {
    }
    path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, "");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path;
  }
  function variantIdFromSearchParams(params) {
    const id = params.get("id");
    return id?.trim() || void 0;
  }
  function asQuantity2(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return void 0;
  }
  function asId(value) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return void 0;
  }
  function uniqueIds(ids) {
    return [...new Set(ids.filter(Boolean))];
  }
  function readObject(body) {
    if (body == null || typeof body !== "object") return void 0;
    if (Array.isArray(body)) return void 0;
    if (typeof FormData !== "undefined" && body instanceof FormData) return void 0;
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return void 0;
    return body;
  }
  function updatesFromRecord(raw) {
    const rec = readObject(raw);
    if (!rec) return void 0;
    const out = {};
    for (const [key, value] of Object.entries(rec)) {
      const quantity = asQuantity2(value);
      if (quantity === void 0) continue;
      out[key] = quantity;
    }
    return Object.keys(out).length > 0 ? out : void 0;
  }
  function updatesFromParams(params) {
    const out = {};
    params.forEach((value, key) => {
      const match = key.match(/^updates\[([^\]]+)\]$/i);
      if (!match?.[1] || typeof value !== "string") return;
      const quantity = asQuantity2(value);
      if (quantity === void 0) return;
      out[match[1]] = quantity;
    });
    return Object.keys(out).length > 0 ? out : void 0;
  }
  function idsFromParams(params) {
    const ids = [];
    const push = (value) => {
      const id = asId(value);
      if (id) ids.push(id);
    };
    if (params instanceof URLSearchParams) {
      push(params.get("id"));
      for (const value of params.getAll("items[][id]")) push(value);
    } else {
      for (const value of params.getAll("id")) push(value);
      for (const value of params.getAll("items[][id]")) push(value);
    }
    return ids;
  }
  function idsFromRecord(rec) {
    const ids = [];
    const id = asId(rec.id);
    if (id) ids.push(id);
    const items = rec.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const itemId = asId(item.id);
        if (itemId) ids.push(itemId);
      }
    }
    return ids;
  }
  function decodeBody(body) {
    if (body == null || body === "") return void 0;
    if (typeof FormData !== "undefined" && body instanceof FormData) return body;
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body;
    if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
      try {
        return decodeBody(new TextDecoder().decode(body));
      } catch {
        return void 0;
      }
    }
    if (typeof body === "string") {
      const trimmed = body.trim();
      if (!trimmed) return void 0;
      try {
        return JSON.parse(trimmed);
      } catch {
        return new URLSearchParams(body);
      }
    }
    if (typeof body === "object") return body;
    return void 0;
  }
  function variantIdsFromCartAddBody(body) {
    const decoded = decodeBody(body);
    if (decoded == null) return [];
    if (typeof FormData !== "undefined" && decoded instanceof FormData) {
      return uniqueIds(idsFromParams(decoded));
    }
    if (typeof URLSearchParams !== "undefined" && decoded instanceof URLSearchParams) {
      return uniqueIds(idsFromParams(decoded));
    }
    const rec = readObject(decoded);
    if (rec) return uniqueIds(idsFromRecord(rec));
    return [];
  }
  function changeSpecFromParams(params) {
    const spec = {};
    const line = asQuantity2(params instanceof URLSearchParams ? params.get("line") : params.get("line"));
    if (line !== void 0) spec.line = line;
    const variantId = asId(params instanceof URLSearchParams ? params.get("id") : params.get("id"));
    if (variantId) spec.variantId = variantId;
    const quantity = asQuantity2(
      params instanceof URLSearchParams ? params.get("quantity") : params.get("quantity")
    );
    if (quantity !== void 0) spec.quantity = quantity;
    const updates = updatesFromParams(params);
    if (updates) spec.updates = updates;
    return spec;
  }
  function changeSpecFromRecord(rec) {
    const spec = {};
    const line = asQuantity2(rec.line);
    if (line !== void 0) spec.line = line;
    const variantId = asId(rec.id);
    if (variantId) spec.variantId = variantId;
    const quantity = asQuantity2(rec.quantity);
    if (quantity !== void 0) spec.quantity = quantity;
    const updates = updatesFromRecord(rec.updates);
    if (updates) spec.updates = updates;
    return spec;
  }
  function mergeChangeSpec(base, extra) {
    const spec = { ...base };
    if (extra.line !== void 0) spec.line = extra.line;
    if (extra.variantId !== void 0) spec.variantId = extra.variantId;
    if (extra.quantity !== void 0) spec.quantity = extra.quantity;
    if (extra.updates !== void 0) spec.updates = extra.updates;
    return spec;
  }
  function changeSpecFromUrlAndBody(url, body) {
    let spec = {};
    try {
      spec = mergeChangeSpec(spec, changeSpecFromParams(new URL(url, "https://shop.example/").searchParams));
    } catch {
    }
    const decoded = decodeBody(body);
    if (typeof FormData !== "undefined" && decoded instanceof FormData) {
      return mergeChangeSpec(spec, changeSpecFromParams(decoded));
    }
    if (typeof URLSearchParams !== "undefined" && decoded instanceof URLSearchParams) {
      return mergeChangeSpec(spec, changeSpecFromParams(decoded));
    }
    const rec = readObject(decoded);
    if (rec) return mergeChangeSpec(spec, changeSpecFromRecord(rec));
    return spec;
  }
  function isExplicitRemove(spec) {
    if (spec.updates) {
      const quantities = Object.values(spec.updates);
      return quantities.length > 0 && quantities.every((quantity) => quantity === 0);
    }
    return spec.quantity === 0;
  }
  function permalinkVariantIds(path) {
    const match = path.match(/^\/cart\/(\d+:\d+(?:,\d+:\d+)*)$/i);
    if (!match?.[1]) return void 0;
    return uniqueIds(match[1].split(",").map((pair) => pair.split(":")[0] ?? ""));
  }
  function collectAddIds(url, body) {
    const ids = variantIdsFromCartAddBody(body);
    try {
      const fromUrl = variantIdFromSearchParams(new URL(url, "https://shop.example/").searchParams);
      if (fromUrl) ids.unshift(fromUrl);
    } catch {
    }
    return uniqueIds(ids);
  }
  function parseCartRequest(url, method = "GET", body) {
    const verb = method.toUpperCase();
    if (verb === "HEAD" || verb === "OPTIONS") return { type: "ignore" };
    const path = shopPath(url);
    const permalinkIds = permalinkVariantIds(path);
    if (permalinkIds) return { type: "check", variantIds: permalinkIds };
    if (/\/cart\/clear(?:\.js|\.json)?$/i.test(path)) return { type: "allow" };
    if (/\/cart\/add(?:\.js|\.json)?$/i.test(path)) {
      return { type: "check", variantIds: collectAddIds(url, body) };
    }
    if (/\/cart\/(?:change|update)(?:\.js|\.json)?$/i.test(path)) {
      const spec = changeSpecFromUrlAndBody(url, body);
      if (isExplicitRemove(spec)) return { type: "allow" };
      return { type: "mutate", spec };
    }
    return { type: "ignore" };
  }
  function cartLineIdForChange(item) {
    return item.key || String(item.variant_id ?? item.id);
  }
  function variantIdOf(item) {
    return String(item.variant_id ?? item.id);
  }
  function findCartItem(cart, spec, updateKey) {
    if (updateKey) {
      const byKey = cart.items.find((item) => item.key === updateKey);
      if (byKey) return byKey;
      const byId = cart.items.find(
        (item) => String(item.id) === updateKey || String(item.variant_id) === updateKey
      );
      if (byId) return byId;
      const prefix = updateKey.split(":")[0] ?? updateKey;
      return cart.items.find((item) => variantIdOf(item) === prefix);
    }
    if (spec.line != null) return cart.items[spec.line - 1];
    if (spec.variantId) {
      return cart.items.find((item) => variantIdOf(item) === spec.variantId);
    }
    return void 0;
  }
  function planMutate(spec, cart) {
    if (spec.updates) {
      const ids = [];
      for (const [key, quantity] of Object.entries(spec.updates)) {
        if (quantity === 0) continue;
        const item2 = findCartItem(cart, spec, key);
        if (!item2) {
          ids.push(key.split(":")[0] || key);
          continue;
        }
        if (quantity < item2.quantity) continue;
        ids.push(variantIdOf(item2));
      }
      return ids.length > 0 ? { type: "check", variantIds: uniqueIds(ids) } : { type: "allow" };
    }
    if (spec.quantity === 0) return { type: "allow" };
    const item = findCartItem(cart, spec);
    if (spec.quantity != null && item && spec.quantity < item.quantity) return { type: "allow" };
    const variantId = spec.variantId || (item ? variantIdOf(item) : void 0);
    return { type: "check", variantIds: variantId ? [variantId] : [] };
  }
  function resolveCartRequest(parsed, cart) {
    if (parsed.type === "ignore" || parsed.type === "allow") return { type: "allow" };
    if (parsed.type === "check") return parsed;
    if (!cart) return { type: "check", variantIds: [] };
    return planMutate(parsed.spec, cart);
  }

  // src/storefront-gate.ts
  function requestHref(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }
  function isProductAddForm(form) {
    if (form.querySelector('[name="add"]')) return true;
    const action = form.getAttribute("action") || form.action || "";
    const method = (form.getAttribute("method") || form.method || "POST").toUpperCase();
    const parsed = parseCartRequest(action, method);
    return parsed.type !== "ignore";
  }
  function variantIdFromForm(form) {
    const input = form.querySelector(
      'select[name="id"], input[name="id"]'
    );
    const value = input?.value?.trim();
    return value || void 0;
  }
  var BLOCKED_JSON = {
    status: 422,
    message: "DISCLOSURE_RETRIEVAL_REQUIRED",
    description: "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update."
  };
  function unknownDecision() {
    return {
      ok: false,
      reason: "UNKNOWN_PRODUCT_VARIANT",
      field: ["id"],
      message: "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update."
    };
  }
  async function decide(raw, options) {
    if (!raw) {
      options.onBlocked(unknownDecision());
      return false;
    }
    const decision = await options.evaluate(raw);
    if (!decision.ok) {
      options.onBlocked(decision);
      return false;
    }
    return true;
  }
  async function decideAll(ids, options) {
    if (ids.length === 0) return decide(void 0, options);
    for (const id of ids) {
      if (!await decide(id, options)) return false;
    }
    return true;
  }
  function blockedResponse() {
    return new Response(JSON.stringify(BLOCKED_JSON), {
      status: 422,
      headers: { "Content-Type": "application/json" }
    });
  }
  async function readCartSnapshot(nativeFetch) {
    try {
      const response = await nativeFetch("/cart.js", {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data || !Array.isArray(data.items)) return null;
      return data;
    } catch {
      return null;
    }
  }
  async function allowParsed(parsed, options, nativeFetch) {
    if (parsed.type === "ignore" || parsed.type === "allow") return true;
    const cart = parsed.type === "mutate" ? await readCartSnapshot(nativeFetch) : null;
    const resolved = resolveCartRequest(parsed, cart);
    if (resolved.type === "allow") return true;
    return decideAll(resolved.variantIds, options);
  }
  async function stripUnauthorizedCartLines(nativeFetch, evaluate) {
    const cart = await readCartSnapshot(nativeFetch);
    if (!cart || cart.items.length === 0) return false;
    let changed = false;
    for (const item of cart.items) {
      const variantId = String(item.variant_id ?? item.id);
      const decision = await evaluate(variantId);
      if (decision.ok) continue;
      try {
        const lineId = cartLineIdForChange(item);
        const response = await nativeFetch("/cart/change.js", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: lineId, quantity: 0 })
        });
        if (response.ok) changed = true;
      } catch {
      }
    }
    return changed;
  }
  async function bodyFromFetch(input, init) {
    if (init?.body) return init.body;
    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return void 0;
      }
    }
    return void 0;
  }
  function installStorefrontCartGuard(options) {
    const allowedForms = /* @__PURE__ */ new WeakSet();
    const nativeSubmit = HTMLFormElement.prototype.submit;
    const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    const nativeFetch = window.fetch.bind(window);
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const xhrUrl = /* @__PURE__ */ new WeakMap();
    const xhrMethod = /* @__PURE__ */ new WeakMap();
    const nativeAssignFn = Location.prototype.assign;
    const nativeReplaceFn = Location.prototype.replace;
    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
    const nativeOpen = window.open.bind(window);
    const nativeBeacon = navigator.sendBeacon?.bind(navigator);
    let queue2 = Promise.resolve();
    function serialize(fn) {
      const run = queue2.then(fn, fn);
      queue2 = run.then(
        () => void 0,
        () => void 0
      );
      return run;
    }
    function gatedParse(url, method, body) {
      return parseCartRequest(url, method, body);
    }
    async function submitIfAllowed(form) {
      if (!isProductAddForm(form)) {
        nativeSubmit.call(form);
        return;
      }
      const action = form.getAttribute("action") || form.action || "";
      const method = (form.getAttribute("method") || form.method || "POST").toUpperCase();
      const allowed = form.querySelector('[name="add"]') ? await serialize(() => decide(variantIdFromForm(form), options)) : await serialize(
        () => allowParsed(gatedParse(action, method, new FormData(form)), options, nativeFetch)
      );
      if (!allowed) return;
      allowedForms.add(form);
      try {
        nativeSubmit.call(form);
      } finally {
        allowedForms.delete(form);
      }
    }
    function interceptNavigation(url, proceed) {
      const parsed = gatedParse(url, "GET");
      if (parsed.type === "ignore" || parsed.type === "allow") {
        proceed();
        return;
      }
      void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
        if (allowed) proceed();
      });
    }
    HTMLFormElement.prototype.submit = function() {
      if (allowedForms.has(this) || !isProductAddForm(this)) {
        nativeSubmit.call(this);
        return;
      }
      void submitIfAllowed(this);
    };
    HTMLFormElement.prototype.requestSubmit = function(submitter) {
      if (allowedForms.has(this) || !isProductAddForm(this)) {
        nativeRequestSubmit.call(this, submitter ?? void 0);
        return;
      }
      void submitIfAllowed(this);
    };
    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !isProductAddForm(form)) return;
        if (allowedForms.has(form)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void submitIfAllowed(form);
      },
      true
    );
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const addButton = target.closest('button[name="add"], input[name="add"]');
        if (addButton?.form instanceof HTMLFormElement) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void submitIfAllowed(addButton.form);
          return;
        }
        const increase = target.closest("a[data-cart-increase]");
        if (increase) {
          const raw = increase.getAttribute("data-cart-increase")?.trim();
          event.preventDefault();
          event.stopImmediatePropagation();
          void serialize(() => decide(raw, options)).then((allowed) => {
            if (allowed && increase.href) nativeAssignFn.call(window.location, increase.href);
          });
          return;
        }
        const link = target.closest("a[href]");
        if (!link?.href) return;
        const parsed = gatedParse(link.href, "GET");
        if (parsed.type === "ignore" || parsed.type === "allow") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
          if (allowed) nativeAssignFn.call(window.location, link.href);
        });
      },
      true
    );
    window.fetch = async (input, init) => {
      const href = requestHref(input);
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const parsed = gatedParse(
        input instanceof Request ? input.url : href,
        method,
        await bodyFromFetch(input, init)
      );
      if (parsed.type === "ignore" || parsed.type === "allow") {
        return nativeFetch(input, init);
      }
      const allowed = await serialize(() => allowParsed(parsed, options, nativeFetch));
      if (!allowed) return blockedResponse();
      return nativeFetch(input, init);
    };
    XMLHttpRequest.prototype.open = function(method, url, async, username, password) {
      xhrMethod.set(this, method);
      xhrUrl.set(this, String(url));
      return xhrOpen.call(this, method, url, async ?? true, username, password);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const href = xhrUrl.get(this) ?? "";
      const method = xhrMethod.get(this) ?? "GET";
      const parsed = gatedParse(href, method, body);
      if (parsed.type === "ignore" || parsed.type === "allow") {
        xhrSend.call(this, body);
        return;
      }
      void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
        if (!allowed) {
          Object.defineProperty(this, "status", { configurable: true, value: 422 });
          Object.defineProperty(this, "responseText", {
            configurable: true,
            value: JSON.stringify({ status: 422, message: "DISCLOSURE_RETRIEVAL_REQUIRED" })
          });
          this.dispatchEvent(new Event("load"));
          return;
        }
        xhrSend.call(this, body);
      });
    };
    function patchLocation(loc) {
      try {
        loc.assign = (url) => {
          interceptNavigation(String(url), () => nativeAssignFn.call(loc, url));
        };
      } catch {
      }
      try {
        loc.replace = (url) => {
          interceptNavigation(String(url), () => nativeReplaceFn.call(loc, url));
        };
      } catch {
      }
      if (hrefDesc?.get && hrefDesc.set) {
        try {
          Object.defineProperty(loc, "href", {
            configurable: true,
            enumerable: hrefDesc.enumerable === true,
            get() {
              return hrefDesc.get.call(loc);
            },
            set(value) {
              interceptNavigation(String(value), () => hrefDesc.set.call(loc, value));
            }
          });
        } catch {
        }
      }
    }
    try {
      Location.prototype.assign = function(url) {
        interceptNavigation(String(url), () => nativeAssignFn.call(this, url));
      };
      Location.prototype.replace = function(url) {
        interceptNavigation(String(url), () => nativeReplaceFn.call(this, url));
      };
      if (hrefDesc?.get && hrefDesc.set) {
        Object.defineProperty(Location.prototype, "href", {
          configurable: true,
          enumerable: hrefDesc.enumerable === true,
          get() {
            return hrefDesc.get.call(this);
          },
          set(value) {
            interceptNavigation(String(value), () => hrefDesc.set.call(this, value));
          }
        });
      }
    } catch {
    }
    patchLocation(window.location);
    const navigation = window.navigation;
    if (navigation) {
      let bypassNavigation = false;
      navigation.addEventListener("navigate", (event) => {
        if (bypassNavigation) return;
        const navEvent = event;
        if (!navEvent.canIntercept || navEvent.hashChange || navEvent.downloadRequest) return;
        const url = navEvent.destination?.url;
        if (!url || !navEvent.intercept) return;
        const parsed = gatedParse(url, "GET");
        if (parsed.type === "ignore" || parsed.type === "allow") return;
        const originHref = window.location.href;
        navEvent.intercept({
          handler: async () => {
            const allowed = await serialize(() => allowParsed(parsed, options, nativeFetch));
            if (!allowed) {
              history.replaceState(history.state, "", originHref);
              return;
            }
            bypassNavigation = true;
            try {
              nativeAssignFn.call(window.location, url);
            } finally {
              bypassNavigation = false;
            }
          }
        });
      });
    }
    window.open = function(url, target, features) {
      if (url == null || url === "") return nativeOpen(url, target, features);
      const parsed = gatedParse(String(url), "GET");
      if (parsed.type === "ignore" || parsed.type === "allow") {
        return nativeOpen(String(url), target, features);
      }
      void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
        if (allowed) nativeOpen(String(url), target, features);
      });
      return null;
    };
    if (nativeBeacon) {
      navigator.sendBeacon = (url, data) => {
        const parsed = gatedParse(String(url), "POST", data);
        if (parsed.type === "ignore" || parsed.type === "allow") {
          return nativeBeacon(url, data);
        }
        return false;
      };
    }
    return {
      reconcile: () => serialize(() => stripUnauthorizedCartLines(nativeFetch, options.evaluate))
    };
  }

  // src/tool.ts
  var TOOL_NAME = "get_product_food_disclosures";
  var TOOL_TITLE = "Retrieve food disclosures";
  var TOOL_DESCRIPTION = "Retrieve merchant-supplied ingredient and label statements for 1-4 packaged-food products before an agent-initiated cart increase. Use Shopify Product GIDs from catalog or product tools. A ProductVariant GID from update_cart is also accepted. null means the merchant did not supply that disclosure and must not be treated as none. This tool does not judge suitability. It updates the visible review and records an in-session receipt used by the native cart gate.";
  var TOOL_INPUT_SCHEMA = {
    type: "object",
    properties: {
      product_ids: {
        type: "array",
        description: "Unique Shopify Product GIDs from search_catalog, browse_store, or get_product.",
        items: {
          type: "string",
          pattern: "^gid://shopify/Product/[0-9]+$"
        },
        minItems: 1,
        maxItems: 4,
        uniqueItems: true
      }
    },
    required: ["product_ids"],
    additionalProperties: false
  };
  var TOOL_ANNOTATIONS = {
    readOnlyHint: false,
    untrustedContentHint: true
  };
  async function executeDisclosureTool(input, registry, receipts, signal, onSuccess) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const ids = validateProductIdList(input);
    if (!Array.isArray(ids)) {
      return {
        ok: false,
        error: {
          code: ids.error,
          message: "Provide 1 to 4 unique Shopify Product GIDs.",
          recovery: "Call get_product or search_catalog, then retry with valid product_ids."
        }
      };
    }
    const records = [];
    for (const id of ids) {
      const record = registry.byProductId.get(id) ?? registry.byVariantId.get(normalizeVariantGid(id) ?? id) ?? registry.byHandle.get(id);
      if (!record) {
        return {
          ok: false,
          error: {
            code: "UNKNOWN_PRODUCT_ID",
            message: "One or more product IDs are not in the current page disclosure list.",
            recovery: "Use Product GIDs from this storefront page, then retry."
          }
        };
      }
      records.push(record);
    }
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const products = [];
    for (const record of records) {
      const receipt = await receipts.issue(record);
      const version = await productVersion(record);
      products.push({
        product_id: record.product_id,
        product_version: version,
        title: record.title,
        ingredients: record.ingredients,
        label_statements: record.label_statements,
        evidence_receipt_id: receipt.receiptId
      });
    }
    onSuccess(products);
    return { ok: true, products, notice: TOOL_NOTICE };
  }
  function toolContract() {
    return {
      name: TOOL_NAME,
      title: TOOL_TITLE,
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_INPUT_SCHEMA,
      annotations: TOOL_ANNOTATIONS
    };
  }

  // src/ui-state.ts
  function labelStatementsCopy(label_statements) {
    if (label_statements === null) return "Not supplied";
    if (label_statements.length === 0) {
      return "No separate label statement in the supplied demo record";
    }
    return label_statements.join(" ");
  }
  function ingredientsCopy(ingredients) {
    return ingredients === null ? "Not supplied" : ingredients;
  }
  function retrievedFromReceipts(list, getReceipt) {
    const products = [];
    for (const record of list) {
      const receipt = getReceipt(record.product_id);
      if (!receipt) continue;
      products.push({
        product_id: record.product_id,
        product_version: receipt.productVersion,
        title: record.title,
        ingredients: record.ingredients,
        label_statements: record.label_statements,
        evidence_receipt_id: receipt.receiptId
      });
    }
    return products;
  }
  function text(el, value) {
    if (el) el.textContent = value;
  }
  function setPanelActive(root, active) {
    root.getElementById("disclosure-review")?.classList.toggle("is-active", active);
  }
  function show(root, state) {
    const status = root.getElementById("food-disclosure-status");
    const list = root.getElementById("food-disclosure-results");
    if (!status) return;
    if (state.kind === "idle" || state.kind === "unsupported") {
      setPanelActive(root, false);
      text(
        status,
        state.kind === "idle" ? "No product has been retrieved yet." : "Site tools are not available in this browser. You can still browse and use the cart."
      );
      if (list) list.replaceChildren();
      return;
    }
    setPanelActive(root, true);
    if (state.kind === "gate_unavailable") {
      text(
        status,
        "The disclosure gate is not active. Do not assume retrieval is recorded before a cart increase."
      );
      return;
    }
    if (state.kind === "error") {
      text(status, state.message);
      return;
    }
    if (state.kind === "rejected") {
      text(status, `Cart update rejected. ${state.message}`);
      return;
    }
    if (state.kind === "accepted") {
      text(
        status,
        `Cart updated after current disclosures were retrieved. Items: ${state.quantity}.`
      );
      return;
    }
    text(status, "Retrieved for this product version in this tab.");
    if (!list) return;
    list.replaceChildren();
    for (const product of state.products) {
      const article = root.createElement("article");
      const title = root.createElement("h3");
      title.textContent = product.title;
      article.append(title);
      const ingredients = root.createElement("p");
      const ingredientsLabel = root.createElement("strong");
      ingredientsLabel.textContent = "Ingredients: ";
      ingredients.append(ingredientsLabel);
      ingredients.append(ingredientsCopy(product.ingredients));
      article.append(ingredients);
      const statements = root.createElement("p");
      const statementsLabel = root.createElement("strong");
      statementsLabel.textContent = "Label statements: ";
      statements.append(statementsLabel);
      statements.append(labelStatementsCopy(product.label_statements));
      article.append(statements);
      const marker = root.createElement("p");
      marker.textContent = "Retrieved for this product version in this tab.";
      article.append(marker);
      list.append(article);
    }
  }
  function renderReview(state, root = document) {
    show(root, state);
    const live = root.getElementById("food-disclosure-cart-status");
    if (!live) return;
    if (state.kind === "rejected") live.textContent = state.message;
    if (state.kind === "accepted") live.textContent = `Cart accepted. Items: ${state.quantity}.`;
    if (state.kind === "retrieved") live.textContent = "Disclosures retrieved.";
  }
  function updateCartBadge(quantity, root = document) {
    const badge = root.getElementById("cart-count");
    if (badge) badge.textContent = String(quantity);
  }
  var EVENTS = {
    retrieved: "food-disclosure:retrieved",
    rejected: "food-disclosure:cart-rejected",
    accepted: "food-disclosure:cart-accepted"
  };

  // src/cart-view.ts
  function updateCartChrome(quantity, total, root = document) {
    const badge = root.getElementById("cart-count");
    if (badge) badge.textContent = String(quantity);
    if (total === void 0) return;
    const totalEl = root.getElementById("cart-total");
    if (totalEl) totalEl.textContent = total;
  }
  function applyFetchedCartPage(html, root = document) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const count = doc.getElementById("cart-count")?.textContent?.trim();
    const total = doc.getElementById("cart-total")?.textContent?.trim();
    if (count) updateCartChrome(Number.parseInt(count, 10) || 0, total, root);
    const next = doc.getElementById("cart-page");
    const current = root.getElementById("cart-page");
    if (next && current) current.replaceWith(root.importNode(next, true));
  }
  var refreshSeq = 0;
  async function refreshCartView() {
    const seq = ++refreshSeq;
    try {
      const response = await fetch("/cart", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const html = await response.text();
      if (seq !== refreshSeq) return;
      applyFetchedCartPage(html);
    } catch {
      return;
    }
  }

  // src/bootstrap.ts
  function storageOrNull() {
    try {
      const probe = window.sessionStorage;
      probe.setItem("food-disclosure:probe", "1");
      probe.removeItem("food-disclosure:probe");
      return probe;
    } catch {
      return null;
    }
  }
  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }
  async function boot() {
    const payload = document.getElementById("food-disclosure-payload")?.textContent ?? "";
    const parsed = parseRegistry(payload);
    const storage = storageOrNull();
    const actions = window.Shopify?.actions;
    const eventTarget = () => document.getElementById("food-disclosure-cart-status");
    if ("error" in parsed || !storage || !actions?.updateCart || !actions.getCart) {
      renderReview({ kind: "gate_unavailable" });
      try {
        actions?.updateCart?.configure({
          eventTarget,
          handler: async (defaultHandler, payload2, options) => handleUpdateCart(defaultHandler, payload2, options, {
            registry: "error" in parsed ? { byProductId: /* @__PURE__ */ new Map(), byVariantId: /* @__PURE__ */ new Map(), byHandle: /* @__PURE__ */ new Map(), list: [] } : parsed,
            receipts: createReceiptStore(storage ?? window.sessionStorage, {
              byProductId: /* @__PURE__ */ new Map(),
              byVariantId: /* @__PURE__ */ new Map(),
              byHandle: /* @__PURE__ */ new Map(),
              list: []
            }),
            storage: storage ?? window.sessionStorage,
            getCart: actions?.getCart ?? (async () => null),
            ready: false
          })
        });
      } catch {
      }
      return;
    }
    await pruneStaleReceipts(storage, parsed);
    const receipts = createReceiptStore(storage, parsed);
    let ready = false;
    const deps = {
      registry: parsed,
      receipts,
      storage,
      getCart: () => actions.getCart(),
      ready
    };
    const configured = actions.updateCart.configure({
      eventTarget,
      handler: async (defaultHandler, payload2, options) => {
        const result = await handleUpdateCart(defaultHandler, payload2, options, deps);
        if (result.userErrors && result.userErrors.length > 0) {
          const reason = result.detail?.food_disclosure?.reason_code ?? "DISCLOSURE_RETRIEVAL_REQUIRED";
          renderReview({
            kind: "rejected",
            reason,
            message: result.userErrors[0]?.message ?? "Cart update rejected."
          });
          dispatch(EVENTS.rejected, result);
        } else {
          updateCartBadge(result.cart?.totalQuantity ?? 0);
          renderReview({ kind: "accepted", quantity: result.cart?.totalQuantity ?? 0 });
          dispatch(EVENTS.accepted, result);
          void refreshCartView();
        }
        return result;
      }
    });
    if (configured !== true) {
      renderReview({ kind: "gate_unavailable" });
      return;
    }
    ready = true;
    deps.ready = true;
    const guard = installStorefrontCartGuard({
      evaluate: (raw) => evaluateVariantAdd(raw, deps),
      onBlocked: (decision) => {
        renderReview({
          kind: "rejected",
          reason: decision.reason,
          message: decision.message
        });
        dispatch(EVENTS.rejected, {
          userErrors: [{ code: "INVALID", field: decision.field, message: decision.message }],
          detail: { food_disclosure: { reason_code: decision.reason } }
        });
      }
    });
    const runReconcile = () => {
      void guard.reconcile().then((changed) => {
        if (changed) void refreshCartView();
      });
    };
    runReconcile();
    window.addEventListener("pageshow", runReconcile);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") runReconcile();
    });
    if (typeof document.modelContext?.registerTool !== "function") {
      renderReview({ kind: "unsupported" });
      return;
    }
    const contract = toolContract();
    await document.modelContext.registerTool({
      name: contract.name,
      title: contract.title,
      description: contract.description,
      inputSchema: contract.inputSchema,
      annotations: { ...contract.annotations },
      async execute(input, extra) {
        const result = await executeDisclosureTool(
          input,
          parsed,
          receipts,
          extra?.signal,
          (products) => {
            renderReview({ kind: "retrieved", products });
            dispatch(EVENTS.retrieved, products);
          }
        );
        return result;
      }
    });
    const restored = retrievedFromReceipts(parsed.list, (productId) => receipts.get(productId));
    if (restored.length > 0) renderReview({ kind: "retrieved", products: restored });
    else renderReview({ kind: "idle" });
  }
  function start() {
    void boot().catch(() => {
      renderReview({ kind: "gate_unavailable" });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
