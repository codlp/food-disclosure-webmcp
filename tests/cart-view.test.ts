import { describe, expect, it } from "vitest";
import { updateCartChrome } from "../src/cart-view";

function fakeEl(text = "") {
  return { textContent: text };
}

function fakeDocument() {
  const count = fakeEl("1");
  const total = fakeEl("€4,50");
  const nodes = new Map<string, { textContent: string }>([
    ["cart-count", count],
    ["cart-total", total],
  ]);
  return {
    count,
    total,
    document: {
      getElementById(id: string) {
        return nodes.get(id) ?? null;
      },
    } as unknown as Document,
  };
}

describe("cart chrome", () => {
  it("updates the basket count and formatted total", () => {
    const { count, total, document } = fakeDocument();
    updateCartChrome(5, "€22,25", document);
    expect(count.textContent).toBe("5");
    expect(total.textContent).toBe("€22,25");
  });
});
