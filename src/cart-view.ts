export function updateCartChrome(
  quantity: number,
  total?: string,
  root: Document = document,
): void {
  const badge = root.getElementById("cart-count");
  if (badge) badge.textContent = String(quantity);
  if (total === undefined) return;
  const totalEl = root.getElementById("cart-total");
  if (totalEl) totalEl.textContent = total;
}

export function applyFetchedCartPage(html: string, root: Document = document): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const count = doc.getElementById("cart-count")?.textContent?.trim();
  const total = doc.getElementById("cart-total")?.textContent?.trim();
  if (count) updateCartChrome(Number.parseInt(count, 10) || 0, total, root);
  const next = doc.getElementById("cart-page");
  const current = root.getElementById("cart-page");
  if (next && current) current.replaceWith(root.importNode(next, true));
}

let refreshSeq = 0;

export async function refreshCartView(): Promise<void> {
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
