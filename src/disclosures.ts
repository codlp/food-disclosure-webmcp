import type { RenderedDisclosure } from "./types";
import { validateRenderedDisclosure } from "./validation";

export type DisclosureRegistry = {
  byProductId: Map<string, RenderedDisclosure>;
  byVariantId: Map<string, RenderedDisclosure>;
  byHandle: Map<string, RenderedDisclosure>;
  list: RenderedDisclosure[];
};

export async function productVersion(record: RenderedDisclosure): Promise<string> {
  const payload = JSON.stringify({
    schema: 1,
    product_id: record.product_id,
    variant_ids: record.variant_ids,
    ingredients: record.ingredients,
    label_statements: record.label_statements,
  });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export function parseRegistry(
  rawJson: string | null | undefined,
): DisclosureRegistry | { error: string } {
  if (!rawJson || !rawJson.trim()) return { error: "PAYLOAD_MISSING" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: "PAYLOAD_MALFORMED" };
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 12) {
    return { error: "PAYLOAD_MALFORMED" };
  }
  const list: RenderedDisclosure[] = [];
  const byProductId = new Map<string, RenderedDisclosure>();
  const byVariantId = new Map<string, RenderedDisclosure>();
  const byHandle = new Map<string, RenderedDisclosure>();
  for (const row of parsed) {
    const validated = validateRenderedDisclosure(row);
    if ("error" in validated) return { error: validated.error };
    if (byProductId.has(validated.product_id)) return { error: "PAYLOAD_MALFORMED" };
    if (byHandle.has(validated.handle)) return { error: "PAYLOAD_MALFORMED" };
    byProductId.set(validated.product_id, validated);
    byHandle.set(validated.handle, validated);
    for (const variantId of validated.variant_ids) {
      if (byVariantId.has(variantId)) return { error: "PAYLOAD_MALFORMED" };
      byVariantId.set(variantId, validated);
    }
    list.push(validated);
  }
  return { byProductId, byVariantId, byHandle, list };
}
