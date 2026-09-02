import type { DisclosureRegistry } from "./disclosures";
import { productVersion } from "./disclosures";
import type { ReceiptStore } from "./receipts";
import { TOOL_NOTICE, type DisclosureResult, type ToolResult } from "./types";
import { normalizeVariantGid, validateProductIdList } from "./validation";

export const TOOL_NAME = "get_product_food_disclosures";
export const TOOL_TITLE = "Retrieve food disclosures";

export const TOOL_DESCRIPTION =
  "Retrieve merchant-supplied ingredient and label statements for 1-4 packaged-food products before an agent-initiated cart increase. Use Shopify Product GIDs from catalog or product tools. A ProductVariant GID from update_cart is also accepted. null means the merchant did not supply that disclosure and must not be treated as none. This tool does not judge suitability. It updates the visible review and records an in-session receipt used by the native cart gate.";

export const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    product_ids: {
      type: "array",
      description: "Unique Shopify Product GIDs from search_catalog, browse_store, or get_product.",
      items: {
        type: "string",
        pattern: "^gid://shopify/Product/[0-9]+$",
      },
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
    },
  },
  required: ["product_ids"],
  additionalProperties: false,
} as const;

export const TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  untrustedContentHint: true,
} as const;

export async function executeDisclosureTool(
  input: unknown,
  registry: DisclosureRegistry,
  receipts: ReceiptStore,
  signal: AbortSignal | undefined,
  onSuccess: (products: DisclosureResult[]) => void,
): Promise<ToolResult> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const ids = validateProductIdList(input);
  if (!Array.isArray(ids)) {
    return {
      ok: false,
      error: {
        code: ids.error,
        message: "Provide 1 to 4 unique Shopify Product GIDs.",
        recovery: "Call get_product or search_catalog, then retry with valid product_ids.",
      },
    };
  }

  const records = [];
  for (const id of ids) {
    const record =
      registry.byProductId.get(id) ??
      registry.byVariantId.get(normalizeVariantGid(id) ?? id) ??
      registry.byHandle.get(id);
    if (!record) {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_PRODUCT_ID",
          message: "One or more product IDs are not in the current page disclosure list.",
          recovery: "Use Product GIDs from this storefront page, then retry.",
        },
      };
    }
    records.push(record);
  }

  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const products: DisclosureResult[] = [];
  for (const record of records) {
    const receipt = await receipts.issue(record);
    const version = await productVersion(record);
    products.push({
      product_id: record.product_id,
      product_version: version,
      title: record.title,
      ingredients: record.ingredients,
      label_statements: record.label_statements,
      evidence_receipt_id: receipt.receiptId,
    });
  }

  onSuccess(products);
  return { ok: true, products, notice: TOOL_NOTICE };
}

export function toolContract() {
  return {
    name: TOOL_NAME,
    title: TOOL_TITLE,
    description: TOOL_DESCRIPTION,
    inputSchema: TOOL_INPUT_SCHEMA,
    annotations: TOOL_ANNOTATIONS,
  };
}
