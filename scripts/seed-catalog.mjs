#!/usr/bin/env node
/**
 * Upsert the 12 fictional snacks, add them to food-disclosure-demo, publish to Online Store.
 * Writes numeric ids only to local config. Does not print GIDs, tokens, or URLs.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProducts, productSetVariables, validateProducts } from "./products.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(homedir(), ".config/food-disclosure-webmcp");
const outDir = join(configDir, "owned");

function scrub(text) {
  return String(text)
    .replace(/gid:\/\/shopify\/[A-Za-z]+\/[0-9A-Za-z_-]+/g, "[gid]")
    .replace(/https?:\/\/\S+/g, "[url]");
}

function extractJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json in cli output");
  return JSON.parse(raw.slice(start, end + 1));
}

function numericId(gid) {
  const match = String(gid || "").match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "@shopify/cli@4.7.0", ...args], {
      cwd: root,
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function storeExecute({ queryFile, variables, allowMutations }) {
  const variablePath = join(outDir, "tmp-variables.json");
  await writeFile(variablePath, `${JSON.stringify(variables)}\n`, { mode: 0o600 });
  const args = [
    "store",
    "execute",
    "--store",
    process.env.SHOPIFY_STORE,
    "--query-file",
    queryFile,
    "--variable-file",
    variablePath,
    "--version",
    "2026-01",
  ];
  if (allowMutations) args.push("--allow-mutations");
  const { code, out } = await cli(args);
  let json;
  try {
    json = extractJson(out);
  } catch (error) {
    throw new Error(`${error.message}: ${scrub(out).slice(0, 400)}`);
  }
  if (code !== 0 && json.errors) {
    throw new Error(scrub(JSON.stringify(json.errors)));
  }
  return json;
}

function payload(json) {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") {
    return json.data;
  }
  return json;
}

function userErrors(raw) {
  const rows = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.userErrors)) rows.push(...value.userErrors);
    for (const child of Object.values(value)) walk(child);
  };
  walk(payload(raw));
  return rows.filter((row) => row?.message);
}

async function main() {
  const products = loadProducts();
  const errors = validateProducts(products);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  const owned = JSON.parse(await readFile(join(configDir, "owned-store.json"), "utf8"));
  const collectionGid = `gid://shopify/Collection/${owned.collection.id}`;
  const publicationGid = `gid://shopify/Publication/${owned.onlineStorePublicationId}`;

  const listed = await storeExecute({
    queryFile: join(root, "graphql/list-metafield-definitions.graphql"),
    variables: JSON.parse(
      await readFile(join(root, "fixtures/list-metafield-label-statements.json"), "utf8"),
    ),
  });
  const definitions = payload(listed)?.metafieldDefinitions?.nodes ?? [];
  const hasLabelStatements = definitions.some((node) => node.key === "label_statements");
  if (!hasLabelStatements) {
    const created = await storeExecute({
      queryFile: join(root, "graphql/create-metafield-definition.graphql"),
      variables: JSON.parse(
        await readFile(join(root, "fixtures/metafield-label-statements.json"), "utf8"),
      ),
      allowMutations: true,
    });
    const createErrors = userErrors(created);
    if (createErrors.length) {
      console.error("label_statements metafield", scrub(JSON.stringify(createErrors)));
      process.exit(1);
    }
    console.log("created label_statements metafield");
  }

  const seeded = [];
  for (const row of products) {
    const existing = await storeExecute({
      queryFile: join(root, "graphql/get-product-by-handle.graphql"),
      variables: { identifier: { handle: row.handle } },
    });
    const current = payload(existing)?.product;
    const variables = productSetVariables(row);
    const variantId = current?.variants?.nodes?.[0]?.id;
    if (variantId) variables.input.variants[0].id = variantId;
    const result = await storeExecute({
      queryFile: join(root, "graphql/upsert-product.graphql"),
      variables,
      allowMutations: true,
    });
    const setErrors = userErrors(result);
    if (setErrors.length) {
      console.error(row.handle, scrub(JSON.stringify(setErrors)));
      process.exit(1);
    }
    const product = payload(result)?.productSet?.product;
    if (!product?.id) {
      console.error(row.handle, "upsert returned no product");
      process.exit(1);
    }
    const ingredients = current?.ingredients?.value ?? null;
    const statementsType = current?.label_statements?.type;
    seeded.push({
      handle: row.handle,
      productId: numericId(product.id),
      variantId: numericId(product.variants?.nodes?.[0]?.id),
      expected_case: row.expected_case,
    });
    console.log(`upserted ${row.handle}`);
    void ingredients;
    void statementsType;
  }

  const add = await storeExecute({
    queryFile: join(root, "graphql/collection-add-products.graphql"),
    variables: {
      id: collectionGid,
      productIds: seeded.map((row) => `gid://shopify/Product/${row.productId}`),
    },
    allowMutations: true,
  });
  const addErrors = userErrors(add).filter(
    (row) => !/already/i.test(row.message || "") && !/duplicate/i.test(row.message || ""),
  );
  if (addErrors.length) {
    console.error("collection add", scrub(JSON.stringify(addErrors)));
    process.exit(1);
  }
  console.log("collection updated");

  for (const row of seeded) {
    const published = await storeExecute({
      queryFile: join(root, "graphql/publish-resource.graphql"),
      variables: {
        id: `gid://shopify/Product/${row.productId}`,
        input: [{ publicationId: publicationGid }],
      },
      allowMutations: true,
    });
    const publishErrors = userErrors(published);
    if (publishErrors.length) {
      console.error(row.handle, "publish", scrub(JSON.stringify(publishErrors)));
      process.exit(1);
    }
    console.log(`published ${row.handle}`);
  }

  const collection = await storeExecute({
    queryFile: join(root, "graphql/get-collection-by-handle.graphql"),
    variables: { identifier: { handle: "food-disclosure-demo" } },
  });
  const live = payload(collection)?.collection?.products?.nodes ?? [];
  const liveHandles = live.map((node) => node.handle).sort();
  const expectedHandles = products.map((row) => row.handle).sort();
  const missing = expectedHandles.filter((handle) => !liveHandles.includes(handle));
  if (missing.length) {
    console.error("missing from collection", missing.join(", "));
    process.exit(1);
  }

  const byHandle = new Map(live.map((node) => [node.handle, node]));
  const chips = byHandle.get("harbor-salt-potato-chips");
  const trail = byHandle.get("hillpath-trail-mix");
  const corn = byHandle.get("hearth-corn-chips");
  const millhouse = byHandle.get("millhouse-savory-crackers");
  const chipsStatements = chips?.label_statements?.jsonValue;
  const trailStatements = trail?.label_statements;
  const cornIngredients = corn?.ingredients;
  const millhouseStatements = millhouse?.label_statements?.jsonValue;
  if (!Array.isArray(chipsStatements) || chipsStatements.length !== 0) {
    console.error("chips label_statements must be []");
    process.exit(1);
  }
  if (trailStatements != null && trailStatements.value != null) {
    console.error("trail mix label_statements must be null");
    process.exit(1);
  }
  if (cornIngredients != null && cornIngredients.value != null) {
    console.error("corn chips ingredients must be null");
    process.exit(1);
  }
  if (!Array.isArray(millhouseStatements) || millhouseStatements[0] !== "Contains wheat.") {
    console.error("millhouse must keep Contains wheat.");
    process.exit(1);
  }

  await writeFile(
    join(outDir, "catalog-seed.json"),
    `${JSON.stringify({ seededAt: new Date().toISOString().slice(0, 10), products: seeded }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`seeded ${seeded.length} products`);
  console.log(
    "live metafields: label_statements [] / label_statements null / ingredients null / non-empty label statement",
  );
}

await main();
