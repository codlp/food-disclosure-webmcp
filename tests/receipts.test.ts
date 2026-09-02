import { describe, expect, it } from "vitest";
import { parseRegistry, productVersion } from "../src/disclosures";
import { createReceiptStore, pruneStaleReceipts } from "../src/receipts";
import { executeDisclosureTool } from "../src/tool";
import { createMemoryStorage } from "./memory-storage";

const sample = {
  product_id: "gid://shopify/Product/1" as const,
  handle: "harbor-salt-potato-chips",
  title: "Harbor Salt Potato Chips",
  variant_ids: ["gid://shopify/ProductVariant/11"] as [`gid://shopify/ProductVariant/${string}`],
  ingredients: "Potatoes, sunflower oil, sea salt.",
  label_statements: [] as string[] | null,
};

function registry(row = sample) {
  const parsed = parseRegistry(JSON.stringify([row]));
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

describe("receipts", () => {
  it("issues and reuses a receipt for the same product version", async () => {
    const storage = createMemoryStorage();
    const store = createReceiptStore(storage, registry());
    const first = await store.issue(sample);
    const second = await store.issue(sample);
    expect(first.receiptId).toBe(second.receiptId);
    expect(first.productVersion).toBe(await productVersion(sample));
  });

  it("does not store shopper restrictions", async () => {
    const storage = createMemoryStorage();
    const store = createReceiptStore(storage, registry());
    await store.issue(sample);
    expect(storage.getItem("food-disclosure:receipts:v1") ?? "").not.toMatch(
      /wheat|celiac|restriction/i,
    );
  });

  it("drops receipts after a version change", async () => {
    const storage = createMemoryStorage();
    const initial = registry();
    const store = createReceiptStore(storage, initial);
    await store.issue(sample);
    const updated = registry({ ...sample, ingredients: "Potatoes, oil." });
    await pruneStaleReceipts(storage, updated);
    const next = createReceiptStore(storage, updated);
    expect(next.get(sample.product_id)).toBeUndefined();
  });
});

describe("disclosure tool", () => {
  it("returns null label statements and empty label statements as distinct values", async () => {
    const missing = { ...sample, label_statements: null };
    const parsed = registry(missing);
    const store = createReceiptStore(createMemoryStorage(), parsed);
    const result = await executeDisclosureTool(
      { product_ids: [sample.product_id] },
      parsed,
      store,
      undefined,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.products[0]?.label_statements).toBeNull();
  });

  it("resolves a variant gid to the product record", async () => {
    const parsed = registry();
    const store = createReceiptStore(createMemoryStorage(), parsed);
    const result = await executeDisclosureTool(
      { product_ids: ["gid://shopify/ProductVariant/11"] },
      parsed,
      store,
      undefined,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.products[0]?.product_id).toBe(sample.product_id);
  });

  it("resolves a product handle to the product record", async () => {
    const parsed = registry();
    const store = createReceiptStore(createMemoryStorage(), parsed);
    const result = await executeDisclosureTool(
      { product_ids: ["harbor-salt-potato-chips"] },
      parsed,
      store,
      undefined,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.products[0]?.title).toBe(sample.title);
  });

  it("fails a mixed unknown batch without issuing receipts", async () => {
    const parsed = registry();
    const store = createReceiptStore(createMemoryStorage(), parsed);
    const result = await executeDisclosureTool(
      { product_ids: [sample.product_id, "gid://shopify/Product/99"] },
      parsed,
      store,
      undefined,
      () => undefined,
    );
    expect(result.ok).toBe(false);
    expect(store.get(sample.product_id)).toBeUndefined();
  });

  it("does not commit after abort", async () => {
    const parsed = registry();
    const store = createReceiptStore(createMemoryStorage(), parsed);
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeDisclosureTool(
        { product_ids: [sample.product_id] },
        parsed,
        store,
        controller.signal,
        () => undefined,
      ),
    ).rejects.toBeTruthy();
    expect(store.get(sample.product_id)).toBeUndefined();
  });

  it("updates visible state before returning", async () => {
    const parsed = registry();
    const store = createReceiptStore(createMemoryStorage(), parsed);
    let visible = false;
    const result = await executeDisclosureTool(
      { product_ids: [sample.product_id] },
      parsed,
      store,
      undefined,
      () => {
        visible = true;
      },
    );
    expect(visible).toBe(true);
    expect(result.ok).toBe(true);
  });
});
