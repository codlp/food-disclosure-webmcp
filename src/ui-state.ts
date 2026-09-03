import type {
  DisclosureReceipt,
  DisclosureResult,
  GateReasonCode,
  RenderedDisclosure,
} from "./types";

export type ReviewState =
  | { kind: "idle" }
  | { kind: "unsupported" }
  | { kind: "gate_unavailable" }
  | { kind: "retrieved"; products: DisclosureResult[] }
  | { kind: "rejected"; reason: GateReasonCode; message: string }
  | { kind: "accepted"; quantity: number }
  | { kind: "error"; message: string };

export function labelStatementsCopy(label_statements: string[] | null): string {
  if (label_statements === null) return "Not supplied";
  if (label_statements.length === 0) {
    return "No separate label statement in the supplied demo record";
  }
  return label_statements.join(" ");
}

export function ingredientsCopy(ingredients: string | null): string {
  return ingredients === null ? "Not supplied" : ingredients;
}

export function retrievedFromReceipts(
  list: RenderedDisclosure[],
  getReceipt: (productId: string) => DisclosureReceipt | undefined,
): DisclosureResult[] {
  const products: DisclosureResult[] = [];
  for (const record of list) {
    const receipt = getReceipt(record.product_id);
    if (!receipt) continue;
    products.push({
      product_id: record.product_id,
      product_version: receipt.productVersion,
      title: record.title,
      ingredients: record.ingredients,
      label_statements: record.label_statements,
      evidence_receipt_id: receipt.receiptId,
    });
  }
  return products;
}

function text(el: Element | null, value: string) {
  if (el) el.textContent = value;
}

function setPanelActive(root: Document, active: boolean) {
  root.getElementById("disclosure-review")?.classList.toggle("is-active", active);
}

function show(root: Document, state: ReviewState) {
  const status = root.getElementById("food-disclosure-status");
  const list = root.getElementById("food-disclosure-results");
  if (!status) return;

  if (state.kind === "idle" || state.kind === "unsupported") {
    setPanelActive(root, false);
    text(
      status,
      state.kind === "idle"
        ? "No product has been retrieved by the agent yet."
        : "Site tools are not available in this browser. You can still browse and use the human cart.",
    );
    if (list) list.replaceChildren();
    return;
  }
  setPanelActive(root, true);
  if (state.kind === "gate_unavailable") {
    text(
      status,
      "The disclosure gate is not active. Do not assume retrieval is recorded before a cart increase.",
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
      `Cart updated after current disclosures were retrieved. Items: ${state.quantity}.`,
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

export function renderReview(state: ReviewState, root: Document = document): void {
  show(root, state);
  const live = root.getElementById("food-disclosure-cart-status");
  if (!live) return;
  if (state.kind === "rejected") live.textContent = state.message;
  if (state.kind === "accepted") live.textContent = `Cart accepted. Items: ${state.quantity}.`;
  if (state.kind === "retrieved") live.textContent = "Disclosures retrieved.";
}

export function updateCartBadge(quantity: number, root: Document = document): void {
  const badge = root.getElementById("cart-count");
  if (badge) badge.textContent = String(quantity);
}

export const EVENTS = {
  retrieved: "food-disclosure:retrieved",
  rejected: "food-disclosure:cart-rejected",
  accepted: "food-disclosure:cart-accepted",
} as const;
