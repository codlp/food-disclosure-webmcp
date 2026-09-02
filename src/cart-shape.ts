import { EMPTY_CART, type CartLineInput, type CartSummary, type UpdateCartPayload } from "./types";

type UcpLine = {
  id?: unknown;
  quantity?: unknown;
  merchandiseId?: unknown;
  handle?: unknown;
  query?: unknown;
  item?: {
    id?: unknown;
    handle?: unknown;
    query?: unknown;
  };
};

export function isCartLineGid(value: string | undefined): boolean {
  return typeof value === "string" && /gid:\/\/shopify\/CartLine\//.test(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asQuantity(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function fromUcpLine(row: UcpLine): CartLineInput {
  const rawId = asString(row.id);
  const cartLineId = rawId && isCartLineGid(rawId) ? rawId : undefined;
  const merchandiseId =
    asString(row.merchandiseId) ?? asString(row.item?.id) ?? (cartLineId ? undefined : rawId);
  const handle = asString(row.handle) ?? asString(row.item?.handle);
  const query = asString(row.query) ?? asString(row.item?.query);
  const quantity = asQuantity(row.quantity);
  const line: CartLineInput = {};
  if (cartLineId) line.id = cartLineId;
  if (merchandiseId) line.merchandiseId = merchandiseId;
  if (handle) line.handle = handle;
  if (query) line.query = query;
  if (quantity !== undefined) line.quantity = quantity;
  return line;
}

function rewriteOneLine(
  row: Record<string, unknown>,
  resolveVariant: (raw: string) => string | undefined,
): void {
  const item =
    row.item && typeof row.item === "object" ? (row.item as Record<string, unknown>) : undefined;
  const candidates = [
    asString(row.merchandiseId),
    asString(item?.id),
    asString(row.id),
    asString(row.handle),
    asString(item?.handle),
  ];
  let variantId: string | undefined;
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

export function rewriteUpdateCartPayload(
  raw: unknown,
  resolveVariant: (raw: string) => string | undefined,
): void {
  if (!raw || typeof raw !== "object") return;
  const payload = raw as Record<string, unknown>;
  const rewriteList = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const row of value) {
      if (row && typeof row === "object")
        rewriteOneLine(row as Record<string, unknown>, resolveVariant);
    }
  };
  rewriteList(payload.lines);
  rewriteList(payload.line_items);
  if (payload.cart && typeof payload.cart === "object") {
    rewriteList((payload.cart as { line_items?: unknown }).line_items);
  }
}

function copyKnownFields(payload: UpdateCartPayload): UpdateCartPayload {
  const next: UpdateCartPayload = {};
  if (payload.cartId) next.cartId = payload.cartId;
  if (payload.note) next.note = payload.note;
  if (payload.discountCodes) next.discountCodes = payload.discountCodes;
  if (payload.attributes) next.attributes = payload.attributes;
  if (payload.lines) next.lines = payload.lines;
  return next;
}

export function normalizeUpdateCartPayload(raw: unknown): UpdateCartPayload {
  if (!raw || typeof raw !== "object") return {};
  const payload = raw as UpdateCartPayload & {
    cart?: { line_items?: UcpLine[] };
    line_items?: UcpLine[];
  };
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

export function normalizeCartSummary(raw: unknown): CartSummary {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CART, lines: [] };
  const cart = raw as Record<string, unknown>;
  const linesRaw = cart.lines ?? cart.line_items;
  let lines: CartSummary["lines"] = [];
  if (Array.isArray(linesRaw)) {
    lines = linesRaw as CartSummary["lines"];
  } else if (linesRaw && typeof linesRaw === "object") {
    const conn = linesRaw as { nodes?: unknown; edges?: Array<{ node?: unknown }> };
    if (Array.isArray(conn.nodes)) {
      lines = conn.nodes as CartSummary["lines"];
    } else if (Array.isArray(conn.edges)) {
      lines = conn.edges
        .map((edge) => edge?.node)
        .filter((node): node is CartSummary["lines"][number] => !!node && typeof node === "object");
    }
  }
  const cost = cart.cost;
  const totalAmount =
    cost && typeof cost === "object"
      ? (cost as { totalAmount?: { amount?: unknown; currencyCode?: unknown } }).totalAmount
      : undefined;
  return {
    id: typeof cart.id === "string" ? cart.id : "",
    totalQuantity: typeof cart.totalQuantity === "number" ? cart.totalQuantity : 0,
    cost: {
      totalAmount: {
        amount:
          typeof totalAmount?.amount === "string"
            ? totalAmount.amount
            : EMPTY_CART.cost.totalAmount.amount,
        currencyCode:
          typeof totalAmount?.currencyCode === "string"
            ? totalAmount.currencyCode
            : EMPTY_CART.cost.totalAmount.currencyCode,
      },
    },
    lines,
    discountCodes: Array.isArray(cart.discountCodes)
      ? (cart.discountCodes as CartSummary["discountCodes"])
      : [],
  };
}

export function toActionCart(cart: CartSummary): CartSummary {
  const lines = [...cart.lines];
  Object.defineProperty(lines, "nodes", { value: lines, enumerable: false });
  return {
    ...cart,
    id: cart.id || "gid://shopify/Cart/empty",
    lines,
  };
}
