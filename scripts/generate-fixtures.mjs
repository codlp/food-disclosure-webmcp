import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProducts, productSetVariables, validateProducts } from "./products.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const products = loadProducts();
const errors = validateProducts(products);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const outDir = join(root, "fixtures/generated");
await mkdir(outDir, { recursive: true });
const lines = products.map((row) => JSON.stringify(productSetVariables(row)));
await writeFile(join(outDir, "product-set.variables.jsonl"), `${lines.join("\n")}\n`);

for (const row of products) {
  const variables = productSetVariables(row);
  await writeFile(
    join(outDir, `${row.handle}.variables.json`),
    `${JSON.stringify(variables, null, 2)}\n`,
  );
}

const first = products[0];
if (!first) {
  console.error("Catalog is empty.");
  process.exit(1);
}
const firstVariables = productSetVariables(first);
await writeFile(
  join(root, "fixtures/probe-product.variables.json"),
  `${JSON.stringify(firstVariables, null, 2)}\n`,
);

await writeFile(
  join(outDir, "handles.json"),
  `${JSON.stringify(
    products.map((row) => ({ handle: row.handle, expected_case: row.expected_case })),
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${products.length} productSet variable files.`);
