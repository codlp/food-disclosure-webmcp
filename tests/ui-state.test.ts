import { describe, expect, it } from "vitest";
import { INJECTION_FIXTURE } from "../src/validation";
import {
  ingredientsCopy,
  labelStatementsCopy,
  renderReview,
  retrievedFromReceipts,
} from "../src/ui-state";

type FakeNode = {
  id?: string;
  textContent: string;
  children: Array<FakeNode | string>;
  innerHTML?: string;
  append: (...nodes: Array<FakeNode | string>) => void;
  replaceChildren: (...nodes: Array<FakeNode | string>) => void;
};

function fakeNode(id?: string): FakeNode {
  const node: FakeNode = {
    textContent: "",
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
      const texts = this.children.map((child) =>
        typeof child === "string" ? child : child.textContent,
      );
      this.textContent = texts.join("");
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
  };
  if (id) node.id = id;
  return node;
}

function fakeDocument() {
  const status = fakeNode("food-disclosure-status");
  const list = fakeNode("food-disclosure-results");
  const live = fakeNode("food-disclosure-cart-status");
  const nodes = new Map<string, FakeNode>([
    ["food-disclosure-status", status],
    ["food-disclosure-results", list],
    ["food-disclosure-cart-status", live],
  ]);
  return {
    status,
    list,
    live,
    document: {
      getElementById(id: string) {
        return nodes.get(id) ?? null;
      },
      createElement() {
        return fakeNode();
      },
    } as unknown as Document,
  };
}

describe("ui copy", () => {
  it("shows different copy for null and empty label statements", () => {
    expect(labelStatementsCopy(null)).toBe("Not supplied");
    expect(labelStatementsCopy([])).toBe("No separate label statement in the supplied demo record");
    expect(labelStatementsCopy(["May contain wheat."])).toBe("May contain wheat.");
    expect(ingredientsCopy(null)).toBe("Not supplied");
    expect(labelStatementsCopy(null)).not.toMatch(/\bsafe\b/i);
  });

  it("renders an injection fixture as text, not as markup", () => {
    const { document, list } = fakeDocument();
    renderReview(
      {
        kind: "retrieved",
        products: [
          {
            product_id: "gid://shopify/Product/1",
            product_version: "sha256:test",
            title: "Injection fixture",
            ingredients: INJECTION_FIXTURE,
            label_statements: [INJECTION_FIXTURE],
            evidence_receipt_id: "receipt-1",
          },
        ],
      },
      document,
    );
    const article = list.children[0];
    expect(article && typeof article !== "string").toBe(true);
    if (!article || typeof article === "string") return;
    const serialized = JSON.stringify(article);
    expect(serialized).toContain(INJECTION_FIXTURE);
    expect(serialized).not.toMatch(/innerHTML/);
    expect(article.children.some((child) => typeof child === "object" && child.innerHTML)).toBe(
      false,
    );
  });
});

describe("review restore", () => {
  it("rebuilds retrieved products from current-tab receipts", () => {
    const products = retrievedFromReceipts(
      [
        {
          product_id: "gid://shopify/Product/1",
          handle: "harbor-salt-potato-chips",
          title: "Harbor Salt Potato Chips",
          variant_ids: ["gid://shopify/ProductVariant/1"],
          ingredients: "Potatoes, sunflower oil, sea salt.",
          label_statements: [],
        },
      ],
      (productId) =>
        productId === "gid://shopify/Product/1"
          ? {
              receiptId: "receipt-1",
              productId,
              variantIds: ["gid://shopify/ProductVariant/1"],
              productVersion: "sha256:test",
              tabSessionId: "tab-1",
              issuedAt: "2026-08-30T00:00:00.000Z",
            }
          : undefined,
    );
    expect(products).toHaveLength(1);
    expect(products[0]?.title).toBe("Harbor Salt Potato Chips");
    expect(products[0]?.evidence_receipt_id).toBe("receipt-1");
    expect(products[0]?.label_statements).toEqual([]);
  });
});
