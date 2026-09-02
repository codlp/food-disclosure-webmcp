#!/usr/bin/env node
/**
 * Compare a captured storefront disclosure payload with fixtures/products.json.
 * Does not call Shopify. Pass a JSON array exported from #food-disclosure-payload.
 *
 * Usage: node scripts/compare-payload.mjs path/to/payload.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProducts } from "./products.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/compare-payload.mjs path/to/payload.json");
  process.exit(2);
}

const expected = new Map(loadProducts().map((row) => [row.handle, row]));
const live = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(live)) {
  console.error("Payload must be a JSON array.");
  process.exit(1);
}

const errors = [];
const liveHandles = new Set();
for (const row of live) {
  liveHandles.add(row.handle);
  const fixture = expected.get(row.handle);
  if (!fixture) {
    errors.push(`Unexpected live handle: ${row.handle}`);
    continue;
  }
  if (row.title !== fixture.title) errors.push(`${row.handle}: title mismatch`);
  if (row.ingredients !== fixture.ingredients) errors.push(`${row.handle}: ingredients mismatch`);
  if (JSON.stringify(row.label_statements) !== JSON.stringify(fixture.label_statements)) {
    errors.push(`${row.handle}: label_statements mismatch (null vs [] must stay distinct)`);
  }
}

for (const handle of expected.keys()) {
  if (!liveHandles.has(handle)) errors.push(`Missing live handle: ${handle}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `Matched ${live.length} products against ${join(dirname(fileURLToPath(import.meta.url)), "../fixtures/products.json")}.`,
);
