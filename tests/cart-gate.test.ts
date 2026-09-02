import { describe, expect, it, vi } from "vitest";
import { parseRegistry } from "../src/disclosures";
import { createReceiptStore } from "../src/receipts";
import {
  evaluatePayload,
  handleUpdateCart,
  resetCartQueue,
  serializeCartCall,
} from "../src/cart-gate";
import { EMPTY_CART, type CartSummary, type UpdateCartResult } from "../src/types";
import { createMemoryStorage } from "./memory-storage";
import { TOOL_ANNOTATIONS, TOOL_NAME, TOOL_TITLE, toolContract } from "../src/tool";

const sample = {
  product_id: "gid://shopify/Product/1" as const,
  handle: "harbor-salt-potato-chips",
  title: "Harbor Salt Potato Chips",
  variant_ids: ["gid://shopify/ProductVariant/11"] as [`gid://shopify/ProductVariant/${string}`],
  ingredients: "Potatoes, sunflower oil, sea salt.",
  label_statements: [] as string[] | null,
};

function deps(receiptsReady = false) {
  const parsed = parseRegistry(JSON.stringify([sample]));
  if ("error" in parsed) throw new Error(parsed.error);
  const storage = createMemoryStorage();
  const receipts = createReceiptStore(storage, parsed);
  return { registry: parsed, receipts, storage, parsed };
}

const emptyCart: CartSummary = EMPTY_CART;

describe("webmcp contract", () => {
  it("exposes the frozen tool name, title, and honest annotations", () => {
    const contract = toolContract();
    expect(contract.name).toBe(TOOL_NAME);
    expect(contract.name.length).toBeLessThanOrEqual(30);
    expect(contract.title).toBe(TOOL_TITLE);
    expect(contract.description.length).toBeLessThanOrEqual(500);
    expect(contract.annotations).toEqual(TOOL_ANNOTATIONS);
    expect(contract.annotations.readOnlyHint).toBe(false);
    expect(contract.annotations.untrustedContentHint).toBe(true);
  });
});

describe("cart gate", () => {
  it("classifies handle adds the same as variant id adds", async () => {
    const { registry, receipts, storage } = deps();
    const without = await evaluatePayload(
      { lines: [{ handle: "harbor-salt-potato-chips", quantity: 1 }] },
      emptyCart,
      { registry, receipts, storage },
    );
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.reason).toBe("DISCLOSURE_RETRIEVAL_REQUIRED");
    await receipts.issue(sample);
    const withReceipt = await evaluatePayload(
      { lines: [{ handle: "harbor-salt-potato-chips", quantity: 1 }] },
      emptyCart,
      { registry, receipts, storage },
    );
    expect(withReceipt.ok).toBe(true);
  });

  it("fails closed on an unresolved search query add", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const decision = await evaluatePayload(
      { lines: [{ query: "harbor salt", quantity: 1 }] },
      emptyCart,
      { registry, receipts, storage },
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("UNKNOWN_PRODUCT_VARIANT");
  });

  it("fails closed on a line with no variant, handle, or existing line id", async () => {
    const { registry, receipts, storage } = deps();
    const decision = await evaluatePayload({ lines: [{ quantity: 1 }] }, emptyCart, {
      registry,
      receipts,
      storage,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("UNKNOWN_PRODUCT_VARIANT");
  });

  it("runs concurrent cart calls in order", async () => {
    resetCartQueue();
    const order: string[] = [];
    const first = serializeCartCall(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("first");
      return 1;
    });
    const second = serializeCartCall(async () => {
      order.push("second");
      return 2;
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    resetCartQueue();
  });

  it("rejects an add without a receipt", async () => {
    const { registry, receipts, storage } = deps();
    const decision = await evaluatePayload(
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
      emptyCart,
      { registry, receipts, storage },
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("DISCLOSURE_RETRIEVAL_REQUIRED");
  });

  it("accepts an add after a current receipt, including null label statements", async () => {
    const missing = { ...sample, label_statements: null };
    const parsed = parseRegistry(JSON.stringify([missing]));
    if ("error" in parsed) throw new Error(parsed.error);
    const storage = createMemoryStorage();
    const receipts = createReceiptStore(storage, parsed);
    await receipts.issue(missing);
    const decision = await evaluatePayload(
      { lines: [{ merchandiseId: "11", quantity: 1 }] },
      emptyCart,
      { registry: parsed, receipts, storage },
    );
    expect(decision.ok).toBe(true);
  });

  it("rejects a stale receipt", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const stale = parseRegistry(
      JSON.stringify([{ ...sample, ingredients: "Potatoes, olive oil, sea salt." }]),
    );
    if ("error" in stale) throw new Error(stale.error);
    const decision = await evaluatePayload(
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
      emptyCart,
      { registry: stale, receipts, storage },
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("DISCLOSURE_VERSION_STALE");
  });

  it("rejects unknown variants and mixed batches atomically", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const decision = await evaluatePayload(
      {
        lines: [
          { merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 },
          { merchandiseId: "gid://shopify/ProductVariant/99", quantity: 1 },
        ],
      },
      emptyCart,
      { registry, receipts, storage },
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("UNKNOWN_PRODUCT_VARIANT");
  });

  it("allows decrease and removal without a receipt", async () => {
    const { registry, receipts, storage } = deps();
    const cart: CartSummary = {
      ...EMPTY_CART,
      totalQuantity: 2,
      lines: [
        {
          id: "gid://shopify/CartLine/1",
          quantity: 2,
          cost: { totalAmount: { amount: "9.00", currencyCode: "USD" } },
        },
      ],
    };
    const down = await evaluatePayload(
      { lines: [{ id: "gid://shopify/CartLine/1", quantity: 1 }] },
      cart,
      { registry, receipts, storage },
    );
    const remove = await evaluatePayload(
      { lines: [{ id: "gid://shopify/CartLine/1", quantity: 0 }] },
      cart,
      { registry, receipts, storage },
    );
    expect(down.ok).toBe(true);
    expect(remove.ok).toBe(true);
  });

  it("accepts a UCP add by Product GID after retrieval and rewrites item.id to a variant", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const lineItem = {
      id: "",
      quantity: 1,
      item: { id: "gid://shopify/Product/1" },
    };
    const payload = {
      cart: {
        line_items: [lineItem],
      },
    };
    const defaultHandler = vi.fn(async () => ({
      cart: {
        ...EMPTY_CART,
        totalQuantity: 1,
        lines: [
          {
            id: "gid://shopify/CartLine/1",
            quantity: 1,
            cost: { totalAmount: { amount: "4.50", currencyCode: "USD" } },
            merchandiseId: "gid://shopify/ProductVariant/11",
          },
        ],
      },
    }));
    const result = await handleUpdateCart(defaultHandler, payload, undefined, {
      registry,
      receipts,
      storage,
      getCart: async () => EMPTY_CART,
      ready: true,
    });
    expect(result.userErrors).toBeUndefined();
    expect(defaultHandler).toHaveBeenCalledOnce();
    expect(lineItem.item.id).toBe("gid://shopify/ProductVariant/11");
  });

  it("accepts a variant GID placed in line_items[].id after retrieval", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const lineItem: { id: string; quantity: number; merchandiseId?: string } = {
      id: "gid://shopify/ProductVariant/11",
      quantity: 1,
    };
    const payload = {
      cart: {
        line_items: [lineItem],
      },
    };
    const defaultHandler = vi.fn(async () => ({
      cart: {
        ...EMPTY_CART,
        totalQuantity: 1,
        lines: [
          {
            id: "gid://shopify/CartLine/1",
            quantity: 1,
            cost: { totalAmount: { amount: "4.50", currencyCode: "USD" } },
            merchandiseId: "gid://shopify/ProductVariant/11",
          },
        ],
      },
    }));
    const result = await handleUpdateCart(defaultHandler, payload, undefined, {
      registry,
      receipts,
      storage,
      getCart: async () => EMPTY_CART,
      ready: true,
    });
    expect(result.userErrors).toBeUndefined();
    expect(defaultHandler).toHaveBeenCalledOnce();
    expect(lineItem.id).toBe("");
    expect(lineItem.merchandiseId).toBe("gid://shopify/ProductVariant/11");
  });

  it("rejects a UCP line_items add without calling defaultHandler", async () => {
    const { registry, receipts, storage } = deps();
    const defaultHandler = vi.fn(async () => {
      throw new Error("Cannot read properties of undefined (reading 'nodes')");
    });
    const result = await handleUpdateCart(
      defaultHandler,
      {
        cart: {
          line_items: [
            {
              id: "",
              quantity: 1,
              item: { id: "gid://shopify/ProductVariant/11" },
            },
          ],
        },
      },
      undefined,
      { registry, receipts, storage, getCart: async () => EMPTY_CART, ready: true },
    );
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(result.userErrors?.[0]?.code).toBe("INVALID");
    expect(
      (result.detail as { food_disclosure?: { reason_code?: string } }).food_disclosure
        ?.reason_code,
    ).toBe("DISCLOSURE_RETRIEVAL_REQUIRED");
    expect(result.cart.totalQuantity).toBe(0);
  });

  it("does not call defaultHandler on a rejected add", async () => {
    const { registry, receipts, storage } = deps();
    const defaultHandler = vi.fn(async () => ({ cart: EMPTY_CART }) as UpdateCartResult);
    const result = await handleUpdateCart(
      defaultHandler,
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
      undefined,
      {
        registry,
        receipts,
        storage,
        getCart: async () => EMPTY_CART,
        ready: true,
      },
    );
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(result.userErrors?.[0]?.code).toBe("INVALID");
    expect(result.cart.totalQuantity).toBe(0);
    expect(result.cart).not.toBeNull();
  });

  it("fails closed while initialization is not ready", async () => {
    const { registry, receipts, storage } = deps();
    const defaultHandler = vi.fn(async () => ({ cart: EMPTY_CART }) as UpdateCartResult);
    const result = await handleUpdateCart(
      defaultHandler,
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
      undefined,
      {
        registry,
        receipts,
        storage,
        getCart: async () => EMPTY_CART,
        ready: false,
      },
    );
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(result.detail).toMatchObject({
      food_disclosure: { reason_code: "DISCLOSURE_GATE_UNAVAILABLE" },
    });
  });

  it("does not poison the queue after a rejected call", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const defaultHandler = vi.fn(async () => ({
      cart: {
        ...EMPTY_CART,
        totalQuantity: 1,
        lines: [
          {
            id: "gid://shopify/CartLine/1",
            quantity: 1,
            cost: { totalAmount: { amount: "4.50", currencyCode: "USD" } },
          },
        ],
      },
    }));
    await handleUpdateCart(
      async () => ({ cart: EMPTY_CART, userErrors: [{ message: "nope", code: "INVALID" }] }),
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/99", quantity: 1 }] },
      undefined,
      { registry, receipts, storage, getCart: async () => EMPTY_CART, ready: true },
    );
    const accepted = await handleUpdateCart(
      defaultHandler,
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
      undefined,
      { registry, receipts, storage, getCart: async () => EMPTY_CART, ready: true },
    );
    expect(accepted.userErrors).toBeUndefined();
    expect(defaultHandler).toHaveBeenCalledOnce();
  });

  it("does not throw when Shopify returns cart.lines as a nodes connection", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const defaultHandler = vi.fn(async () => ({
      cart: {
        id: "gid://shopify/Cart/1",
        totalQuantity: 1,
        cost: { totalAmount: { amount: "4.50", currencyCode: "USD" } },
        discountCodes: [],
        lines: {
          nodes: [
            {
              id: "gid://shopify/CartLine/1",
              quantity: 1,
              cost: { totalAmount: { amount: "4.50", currencyCode: "USD" } },
              merchandiseId: "gid://shopify/ProductVariant/11",
            },
          ],
        },
      },
    }));
    const result = await handleUpdateCart(
      defaultHandler as unknown as () => Promise<UpdateCartResult>,
      { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
      undefined,
      { registry, receipts, storage, getCart: async () => EMPTY_CART, ready: true },
    );
    expect(result.userErrors).toBeUndefined();
    expect(result.cart.totalQuantity).toBe(1);
  });

  it("does not call defaultHandler after abort", async () => {
    const { registry, receipts, storage } = deps();
    await receipts.issue(sample);
    const defaultHandler = vi.fn(async () => ({ cart: EMPTY_CART }) as UpdateCartResult);
    const controller = new AbortController();
    controller.abort();
    await expect(
      handleUpdateCart(
        defaultHandler,
        { lines: [{ merchandiseId: "gid://shopify/ProductVariant/11", quantity: 1 }] },
        { signal: controller.signal },
        { registry, receipts, storage, getCart: async () => EMPTY_CART, ready: true },
      ),
    ).rejects.toBeTruthy();
    expect(defaultHandler).not.toHaveBeenCalled();
  });
});
