import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CASES = new Set([
  "candidate",
  "ingredient_conflict",
  "label_statement_conflict",
  "ingredients_missing",
  "label_statements_missing",
]);

export function loadProducts() {
  return JSON.parse(readFileSync(join(root, "fixtures/products.json"), "utf8"));
}

export function validateProducts(products) {
  const errors = [];
  if (!Array.isArray(products) || products.length !== 12) {
    errors.push("Product count must be exactly 12.");
    return errors;
  }
  const handles = new Set();
  const titles = new Set();
  for (const row of products) {
    if (!row.handle || handles.has(row.handle))
      errors.push(`Duplicate or missing handle: ${row.handle}`);
    handles.add(row.handle);
    if (!row.title || titles.has(row.title))
      errors.push(`Duplicate or missing title: ${row.title}`);
    titles.add(row.title);
    if (!/^\d+\.\d{2}$/.test(row.price) || Number(row.price) < 0) {
      errors.push(`Bad price for ${row.handle}`);
    }
    if (!CASES.has(row.expected_case)) errors.push(`Bad expected_case for ${row.handle}`);
    if (row.ingredients !== null) {
      if (typeof row.ingredients !== "string" || !row.ingredients.trim()) {
        errors.push(`Ingredients must be a non-empty string or null: ${row.handle}`);
      }
    }
    if (row.label_statements !== null) {
      if (!Array.isArray(row.label_statements))
        errors.push(`Label statements must be an array or null: ${row.handle}`);
      else {
        const seen = new Set();
        for (const statement of row.label_statements) {
          if (typeof statement !== "string" || !statement.trim() || seen.has(statement)) {
            errors.push(`Bad label statement on ${row.handle}`);
          }
          seen.add(statement);
        }
        if (row.label_statements.length > 5)
          errors.push(`Too many label statements on ${row.handle}`);
      }
    }
    if (row.expected_case === "label_statements_missing" && row.label_statements !== null) {
      errors.push(`${row.handle} must have label_statements: null`);
    }
    if (row.expected_case === "ingredients_missing" && row.ingredients !== null) {
      errors.push(`${row.handle} must have ingredients: null`);
    }
    if (
      row.expected_case === "label_statement_conflict" &&
      (!row.label_statements || row.label_statements.length < 1)
    ) {
      errors.push(`${row.handle} must have a label statement`);
    }
    const blob = `${row.title} ${row.description}`.toLowerCase();
    if (row.expected_case === "ingredient_conflict" && /wheat|barley|semolina|malt/.test(blob)) {
      errors.push(`${row.handle} title/description leaks a declaration`);
    }
    if (row.expected_case === "label_statement_conflict" && /may contain/.test(blob)) {
      errors.push(`${row.handle} title/description leaks a label statement`);
    }
    const banned = /celiac|gluten-free|certified|safe for|allergen-free/i;
    if (banned.test(JSON.stringify(row))) errors.push(`${row.handle} has a prohibited claim`);
  }
  return errors;
}

export function productSetVariables(row) {
  const metafields = [];
  if (row.ingredients !== null) {
    metafields.push({
      namespace: "custom",
      key: "ingredients",
      type: "multi_line_text_field",
      value: row.ingredients,
    });
  }
  if (row.label_statements !== null) {
    metafields.push({
      namespace: "custom",
      key: "label_statements",
      type: "json",
      value: JSON.stringify(row.label_statements),
    });
  }
  return {
    identifier: { handle: row.handle },
    input: {
      title: row.title,
      handle: row.handle,
      descriptionHtml: `<p>${escapeHtml(row.description)}</p>`,
      vendor: "Harbor Pantry",
      productType: "Snack",
      status: "ACTIVE",
      tags: ["food-disclosure-demo"],
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
      variants: [
        {
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          price: Number(row.price),
        },
      ],
      metafields,
    },
  };
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
