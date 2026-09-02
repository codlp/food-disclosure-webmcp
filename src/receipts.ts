import {
  STORAGE_LINE_MAP,
  STORAGE_RECEIPTS,
  STORAGE_TAB,
  type DisclosureReceipt,
  type RenderedDisclosure,
} from "./types";
import { productVersion } from "./disclosures";
import type { DisclosureRegistry } from "./disclosures";

export type ReceiptStore = {
  tabSessionId: string;
  get(productId: string): DisclosureReceipt | undefined;
  issue(record: RenderedDisclosure): Promise<DisclosureReceipt>;
  dropStale(registry: DisclosureRegistry): void;
};

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    storage.removeItem(key);
    return fallback;
  }
}

export function createReceiptStore(storage: Storage, registry: DisclosureRegistry): ReceiptStore {
  let tabSessionId = storage.getItem(STORAGE_TAB);
  if (!tabSessionId || tabSessionId.length < 8) {
    tabSessionId = randomId();
    storage.setItem(STORAGE_TAB, tabSessionId);
  }

  const receipts = new Map<string, DisclosureReceipt>();
  const loaded = readJson<unknown>(storage, STORAGE_RECEIPTS, []);
  if (Array.isArray(loaded)) {
    for (const row of loaded) {
      if (!row || typeof row !== "object") continue;
      const r = row as DisclosureReceipt;
      if (
        typeof r.receiptId !== "string" ||
        typeof r.productId !== "string" ||
        typeof r.productVersion !== "string" ||
        typeof r.tabSessionId !== "string" ||
        !Array.isArray(r.variantIds)
      ) {
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

  const store: ReceiptStore = {
    tabSessionId,
    get(productId) {
      return receipts.get(productId);
    },
    async issue(record) {
      const version = await productVersion(record);
      const existing = receipts.get(record.product_id);
      if (
        existing &&
        existing.productVersion === version &&
        existing.tabSessionId === tabSessionId
      ) {
        return existing;
      }
      const next: DisclosureReceipt = {
        receiptId: existing?.receiptId ?? `rcpt_${randomId()}`,
        productId: record.product_id,
        variantIds: [...record.variant_ids],
        productVersion: version,
        tabSessionId,
        issuedAt: new Date().toISOString(),
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
    },
  };

  return store;
}

export async function pruneStaleReceipts(
  storage: Storage,
  registry: DisclosureRegistry,
): Promise<void> {
  const tabSessionId = storage.getItem(STORAGE_TAB);
  const loaded = readJson<unknown>(storage, STORAGE_RECEIPTS, []);
  if (!Array.isArray(loaded)) {
    storage.removeItem(STORAGE_RECEIPTS);
    return;
  }
  const kept: DisclosureReceipt[] = [];
  for (const row of loaded) {
    if (!row || typeof row !== "object") continue;
    const r = row as DisclosureReceipt;
    const record = registry.byProductId.get(r.productId);
    if (!record) continue;
    if (r.tabSessionId !== tabSessionId) continue;
    const version = await productVersion(record);
    if (r.productVersion !== version) continue;
    kept.push(r);
  }
  storage.setItem(STORAGE_RECEIPTS, JSON.stringify(kept));
}

export function readLineMap(storage: Storage): Map<string, string> {
  const raw = readJson<unknown>(storage, STORAGE_LINE_MAP, {});
  const map = new Map<string, string>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [lineId, variantId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof variantId === "string") map.set(lineId, variantId);
  }
  return map;
}

export function writeLineMap(storage: Storage, map: Map<string, string>): void {
  storage.setItem(STORAGE_LINE_MAP, JSON.stringify(Object.fromEntries(map)));
}
