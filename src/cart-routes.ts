export type CartSnapshotItem = {
  id: number;
  variant_id?: number;
  quantity: number;
  key?: string;
};

export type CartSnapshot = {
  items: CartSnapshotItem[];
};

export type CartChangeSpec = {
  line?: number;
  variantId?: string;
  quantity?: number;
  updates?: Record<string, number>;
};

export type ParsedCartRequest =
  | { type: "ignore" }
  | { type: "allow" }
  | { type: "check"; variantIds: string[] }
  | { type: "mutate"; spec: CartChangeSpec };

export type ResolvedCartRequest =
  | { type: "allow" }
  | { type: "check"; variantIds: string[] };

function pathnameOf(url: string): string {
  try {
    return new URL(url, "https://shop.example/").pathname;
  } catch {
    return url;
  }
}

export function shopPath(url: string): string {
  let path = pathnameOf(url);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, "");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path;
}

export function isCartAddPath(url: string): boolean {
  return /\/cart\/add(?:\.js|\.json)?$/i.test(shopPath(url));
}

export function variantIdFromSearchParams(params: URLSearchParams): string | undefined {
  const id = params.get("id");
  return id?.trim() || undefined;
}

function asQuantity(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function readObject(body: unknown): Record<string, unknown> | undefined {
  if (body == null || typeof body !== "object") return undefined;
  if (Array.isArray(body)) return undefined;
  if (typeof FormData !== "undefined" && body instanceof FormData) return undefined;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return undefined;
  return body as Record<string, unknown>;
}

function updatesFromRecord(raw: unknown): Record<string, number> | undefined {
  const rec = readObject(raw);
  if (!rec) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(rec)) {
    const quantity = asQuantity(value);
    if (quantity === undefined) continue;
    out[key] = quantity;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function updatesFromParams(params: URLSearchParams | FormData): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  params.forEach((value, key) => {
    const match = key.match(/^updates\[([^\]]+)\]$/i);
    if (!match?.[1] || typeof value !== "string") return;
    const quantity = asQuantity(value);
    if (quantity === undefined) return;
    out[match[1]] = quantity;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function idsFromParams(params: URLSearchParams | FormData): string[] {
  const ids: string[] = [];
  const push = (value: FormDataEntryValue | string | null) => {
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

function idsFromRecord(rec: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const id = asId(rec.id);
  if (id) ids.push(id);
  const items = rec.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const itemId = asId((item as { id?: unknown }).id);
      if (itemId) ids.push(itemId);
    }
  }
  return ids;
}

function decodeBody(body: unknown): unknown {
  if (body == null || body === "") return undefined;
  if (typeof FormData !== "undefined" && body instanceof FormData) return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body;
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    try {
      return decodeBody(new TextDecoder().decode(body));
    } catch {
      return undefined;
    }
  }
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return new URLSearchParams(body);
    }
  }
  if (typeof body === "object") return body;
  return undefined;
}

export function variantIdsFromCartAddBody(body: unknown): string[] {
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

export function variantIdFromCartAddBody(body: unknown): string | undefined {
  return variantIdsFromCartAddBody(body)[0];
}

function changeSpecFromParams(params: URLSearchParams | FormData): CartChangeSpec {
  const spec: CartChangeSpec = {};
  const line = asQuantity(params instanceof URLSearchParams ? params.get("line") : params.get("line"));
  if (line !== undefined) spec.line = line;
  const variantId = asId(params instanceof URLSearchParams ? params.get("id") : params.get("id"));
  if (variantId) spec.variantId = variantId;
  const quantity = asQuantity(
    params instanceof URLSearchParams ? params.get("quantity") : params.get("quantity"),
  );
  if (quantity !== undefined) spec.quantity = quantity;
  const updates = updatesFromParams(params);
  if (updates) spec.updates = updates;
  return spec;
}

function changeSpecFromRecord(rec: Record<string, unknown>): CartChangeSpec {
  const spec: CartChangeSpec = {};
  const line = asQuantity(rec.line);
  if (line !== undefined) spec.line = line;
  const variantId = asId(rec.id);
  if (variantId) spec.variantId = variantId;
  const quantity = asQuantity(rec.quantity);
  if (quantity !== undefined) spec.quantity = quantity;
  const updates = updatesFromRecord(rec.updates);
  if (updates) spec.updates = updates;
  return spec;
}

function mergeChangeSpec(base: CartChangeSpec, extra: CartChangeSpec): CartChangeSpec {
  const spec: CartChangeSpec = { ...base };
  if (extra.line !== undefined) spec.line = extra.line;
  if (extra.variantId !== undefined) spec.variantId = extra.variantId;
  if (extra.quantity !== undefined) spec.quantity = extra.quantity;
  if (extra.updates !== undefined) spec.updates = extra.updates;
  return spec;
}

function changeSpecFromUrlAndBody(url: string, body?: unknown): CartChangeSpec {
  let spec: CartChangeSpec = {};
  try {
    spec = mergeChangeSpec(spec, changeSpecFromParams(new URL(url, "https://shop.example/").searchParams));
  } catch {
    /* ignore malformed urls */
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

function isExplicitRemove(spec: CartChangeSpec): boolean {
  if (spec.updates) {
    const quantities = Object.values(spec.updates);
    return quantities.length > 0 && quantities.every((quantity) => quantity === 0);
  }
  return spec.quantity === 0;
}

function permalinkVariantIds(path: string): string[] | undefined {
  const match = path.match(/^\/cart\/(\d+:\d+(?:,\d+:\d+)*)$/i);
  if (!match?.[1]) return undefined;
  return uniqueIds(match[1].split(",").map((pair) => pair.split(":")[0] ?? ""));
}

function collectAddIds(url: string, body?: unknown): string[] {
  const ids = variantIdsFromCartAddBody(body);
  try {
    const fromUrl = variantIdFromSearchParams(new URL(url, "https://shop.example/").searchParams);
    if (fromUrl) ids.unshift(fromUrl);
  } catch {
    /* ignore */
  }
  return uniqueIds(ids);
}

export function parseCartRequest(url: string, method = "GET", body?: unknown): ParsedCartRequest {
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

export function cartLineIdForChange(item: CartSnapshotItem): string {
  return item.key || String(item.variant_id ?? item.id);
}

function variantIdOf(item: CartSnapshotItem): string {
  return String(item.variant_id ?? item.id);
}

function findCartItem(
  cart: CartSnapshot,
  spec: CartChangeSpec,
  updateKey?: string,
): CartSnapshotItem | undefined {
  if (updateKey) {
    const byKey = cart.items.find((item) => item.key === updateKey);
    if (byKey) return byKey;
    const byId = cart.items.find(
      (item) => String(item.id) === updateKey || String(item.variant_id) === updateKey,
    );
    if (byId) return byId;
    const prefix = updateKey.split(":")[0] ?? updateKey;
    return cart.items.find((item) => variantIdOf(item) === prefix);
  }
  if (spec.line != null) return cart.items[spec.line - 1];
  if (spec.variantId) {
    return cart.items.find((item) => variantIdOf(item) === spec.variantId);
  }
  return undefined;
}

function planMutate(spec: CartChangeSpec, cart: CartSnapshot): ResolvedCartRequest {
  if (spec.updates) {
    const ids: string[] = [];
    for (const [key, quantity] of Object.entries(spec.updates)) {
      if (quantity === 0) continue;
      const item = findCartItem(cart, spec, key);
      if (!item) {
        ids.push(key.split(":")[0] || key);
        continue;
      }
      if (quantity < item.quantity) continue;
      ids.push(variantIdOf(item));
    }
    return ids.length > 0 ? { type: "check", variantIds: uniqueIds(ids) } : { type: "allow" };
  }

  if (spec.quantity === 0) return { type: "allow" };

  const item = findCartItem(cart, spec);
  if (spec.quantity != null && item && spec.quantity < item.quantity) return { type: "allow" };

  const variantId = spec.variantId || (item ? variantIdOf(item) : undefined);
  return { type: "check", variantIds: variantId ? [variantId] : [] };
}

export function resolveCartRequest(
  parsed: ParsedCartRequest,
  cart: CartSnapshot | null,
): ResolvedCartRequest {
  if (parsed.type === "ignore" || parsed.type === "allow") return { type: "allow" };
  if (parsed.type === "check") return parsed;
  if (!cart) return { type: "check", variantIds: [] };
  return planMutate(parsed.spec, cart);
}
