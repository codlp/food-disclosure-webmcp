import {
  EMPTY_CART,
  type CartLineInput,
  type CartSummary,
  type GateReasonCode,
  type RenderedDisclosure,
  type UpdateCartPayload,
  type UpdateCartResult,
} from "./types";
import type { DisclosureRegistry } from "./disclosures";
import { productVersion } from "./disclosures";
import type { ReceiptStore } from "./receipts";
import { readLineMap, writeLineMap } from "./receipts";
import {
  isCartLineGid,
  normalizeCartSummary,
  normalizeUpdateCartPayload,
  rewriteUpdateCartPayload,
  toActionCart,
} from "./cart-shape";
import { normalizeVariantGid } from "./validation";

export type GateDeps = {
  registry: DisclosureRegistry;
  receipts: ReceiptStore;
  storage: Storage;
  getCart: () => Promise<CartSummary | null | undefined>;
  ready: boolean;
};

export type GateDecision =
  { ok: true } | { ok: false; reason: GateReasonCode; field: string[]; message: string };

const RECOVERY_RETRIEVE =
  "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update.";
const RECOVERY_STALE =
  "The page now contains a different disclosure version. Retrieve it again before increasing the cart quantity.";
const RECOVERY_LINE =
  "This cart line could not be associated with a product version retrieved in this tab. Remove or decrease it, or retrieve the product again before an increase.";
const RECOVERY_UNAVAILABLE =
  "The disclosure gate is not active in this browser. Do not assume retrieval is required or recorded.";

function currentQty(cart: CartSummary, lineId: string): number | undefined {
  return cart.lines.find((line) => line.id === lineId)?.quantity;
}

function resolveAddTarget(
  raw: string | undefined,
  registry: DisclosureRegistry,
): { record: RenderedDisclosure; variantId: string } | undefined {
  if (!raw) return undefined;
  const trimmed =
    raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("?")[0] ?? "";
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
  return undefined;
}

function reject(
  cart: CartSummary | null | undefined,
  reason: GateReasonCode,
  field: string[],
  message: string,
): UpdateCartResult {
  return {
    cart: toActionCart(cart ?? EMPTY_CART),
    userErrors: [{ code: "INVALID", field, message }],
    detail: { food_disclosure: { reason_code: reason } },
  };
}

export async function evaluatePayload(
  payload: UpdateCartPayload,
  cart: CartSummary,
  deps: Omit<GateDeps, "getCart" | "ready">,
): Promise<GateDecision> {
  const lines = payload.lines ?? [];
  if (lines.length > 10) {
    return {
      ok: false,
      reason: "DISCLOSURE_GATE_UNAVAILABLE",
      field: ["lines"],
      message: RECOVERY_UNAVAILABLE,
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

async function evaluateLine(
  line: CartLineInput,
  cart: CartSummary,
  deps: Omit<GateDeps, "getCart" | "ready">,
  lineMap: Map<string, string>,
  field: string[],
): Promise<GateDecision> {
  const quantity = line.quantity ?? 1;
  const cartLineId = isCartLineGid(line.id) ? line.id : undefined;
  const addRaw = line.merchandiseId ?? line.handle ?? (cartLineId ? undefined : line.id);

  if (cartLineId && !addRaw) {
    const existing = currentQty(cart, cartLineId);
    if (existing === undefined) {
      return {
        ok: false,
        reason: "CART_LINE_ASSOCIATION_REQUIRED",
        field,
        message: RECOVERY_LINE,
      };
    }
    if (quantity === 0 || quantity < existing) return { ok: true };
    return requireReceiptForVariant(
      lineMap.get(cartLineId) ?? cart.lines.find((l) => l.id === cartLineId)?.merchandiseId,
      deps,
      field,
      true,
    );
  }

  if (addRaw) {
    const resolved = resolveAddTarget(addRaw, deps.registry);
    if (!resolved) {
      return {
        ok: false,
        reason: "UNKNOWN_PRODUCT_VARIANT",
        field,
        message: RECOVERY_RETRIEVE,
      };
    }
    return requireReceiptForVariant(resolved.variantId, deps, field, false);
  }

  if (line.query) {
    return {
      ok: false,
      reason: "UNKNOWN_PRODUCT_VARIANT",
      field,
      message: RECOVERY_RETRIEVE,
    };
  }

  return {
    ok: false,
    reason: "UNKNOWN_PRODUCT_VARIANT",
    field,
    message: RECOVERY_RETRIEVE,
  };
}

async function requireReceiptForVariant(
  variantId: string | null | undefined,
  deps: Omit<GateDeps, "getCart" | "ready">,
  field: string[],
  association: boolean,
): Promise<GateDecision> {
  if (!variantId) {
    return {
      ok: false,
      reason: association ? "CART_LINE_ASSOCIATION_REQUIRED" : "UNKNOWN_PRODUCT_VARIANT",
      field,
      message: association ? RECOVERY_LINE : RECOVERY_RETRIEVE,
    };
  }
  const record = deps.registry.byVariantId.get(variantId);
  if (!record) {
    return {
      ok: false,
      reason: "UNKNOWN_PRODUCT_VARIANT",
      field,
      message: RECOVERY_RETRIEVE,
    };
  }
  const receipt = deps.receipts.get(record.product_id);
  if (!receipt) {
    return {
      ok: false,
      reason: "DISCLOSURE_RETRIEVAL_REQUIRED",
      field,
      message: RECOVERY_RETRIEVE,
    };
  }
  const version = await productVersion(record);
  if (receipt.productVersion !== version || receipt.tabSessionId !== deps.receipts.tabSessionId) {
    return {
      ok: false,
      reason: "DISCLOSURE_VERSION_STALE",
      field,
      message: RECOVERY_STALE,
    };
  }
  if (!receipt.variantIds.includes(variantId)) {
    return {
      ok: false,
      reason: "DISCLOSURE_VERSION_STALE",
      field,
      message: RECOVERY_STALE,
    };
  }
  return { ok: true };
}

export async function evaluateVariantAdd(raw: string, deps: GateDeps): Promise<GateDecision> {
  if (!deps.ready) {
    return {
      ok: false,
      reason: "DISCLOSURE_GATE_UNAVAILABLE",
      field: ["id"],
      message: RECOVERY_UNAVAILABLE,
    };
  }
  const resolved = resolveAddTarget(raw, deps.registry);
  if (!resolved) {
    return {
      ok: false,
      reason: "UNKNOWN_PRODUCT_VARIANT",
      field: ["id"],
      message: RECOVERY_RETRIEVE,
    };
  }
  return requireReceiptForVariant(resolved.variantId, deps, ["id"], false);
}

export function reconcileLineMap(
  storage: Storage,
  before: CartSummary,
  after: CartSummary,
  payload: UpdateCartPayload,
): void {
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

let queue: Promise<void> = Promise.resolve();

export function resetCartQueue(): void {
  queue = Promise.resolve();
}

export function serializeCartCall<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = queue.then(async () => {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function handleUpdateCart(
  defaultHandler: () => Promise<UpdateCartResult>,
  payload: unknown,
  options: { signal?: AbortSignal } | undefined,
  deps: GateDeps,
): Promise<UpdateCartResult> {
  return serializeCartCall(async () => {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const normalized = normalizeUpdateCartPayload(payload);
    let cart: CartSummary | null | undefined;
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

    const resolveVariant = (raw: string) => resolveAddTarget(raw, deps.registry)?.variantId;
    rewriteUpdateCartPayload(payload, resolveVariant);
    rewriteUpdateCartPayload(normalized, resolveVariant);

    const result = await defaultHandler();
    if (result.userErrors && result.userErrors.length > 0) {
      return result;
    }
    try {
      reconcileLineMap(deps.storage, safeCart, result.cart ?? EMPTY_CART, normalized);
    } catch {
      // Line mapping is operational. Do not fail a cart that Shopify already updated.
    }
    return result;
  }, options?.signal);
}
