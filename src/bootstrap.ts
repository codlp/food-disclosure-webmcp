import { handleUpdateCart, type GateDeps } from "./cart-gate";
import { parseRegistry } from "./disclosures";
import { createReceiptStore, pruneStaleReceipts } from "./receipts";
import { executeDisclosureTool, toolContract } from "./tool";
import type { CartSummary, DisclosureResult, UpdateCartPayload, UpdateCartResult } from "./types";
import { EVENTS, renderReview, retrievedFromReceipts, updateCartBadge } from "./ui-state";

type ShopifyActions = {
  getCart?: () => Promise<CartSummary | null | undefined>;
  updateCart?: {
    configure: (config: {
      eventTarget: (meta?: { type?: string; action?: string }) => EventTarget | null;
      handler: (
        defaultHandler: () => Promise<UpdateCartResult>,
        payload: UpdateCartPayload,
        options?: { signal?: AbortSignal },
      ) => Promise<UpdateCartResult>;
    }) => boolean;
  };
};

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title?: string;
        description: string;
        inputSchema: unknown;
        annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
        execute: (input: unknown, extra?: { signal?: AbortSignal }) => Promise<unknown>;
      }) => Promise<unknown> | unknown;
    };
  }
  interface Window {
    Shopify?: { actions?: ShopifyActions };
  }
}

function storageOrNull(): Storage | null {
  try {
    const probe = window.sessionStorage;
    probe.setItem("food-disclosure:probe", "1");
    probe.removeItem("food-disclosure:probe");
    return probe;
  } catch {
    return null;
  }
}

function dispatch(name: string, detail: unknown) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

async function boot() {
  const payload = document.getElementById("food-disclosure-payload")?.textContent ?? "";
  const parsed = parseRegistry(payload);
  const storage = storageOrNull();
  const actions = window.Shopify?.actions;
  const eventTarget = () => document.getElementById("food-disclosure-cart-status");

  if ("error" in parsed || !storage || !actions?.updateCart || !actions.getCart) {
    renderReview({ kind: "gate_unavailable" });
    try {
      actions?.updateCart?.configure({
        eventTarget,
        handler: async (defaultHandler, payload, options) =>
          handleUpdateCart(defaultHandler, payload, options, {
            registry:
              "error" in parsed
                ? { byProductId: new Map(), byVariantId: new Map(), byHandle: new Map(), list: [] }
                : parsed,
            receipts: createReceiptStore(storage ?? window.sessionStorage, {
              byProductId: new Map(),
              byVariantId: new Map(),
              byHandle: new Map(),
              list: [],
            }),
            storage: storage ?? window.sessionStorage,
            getCart: actions?.getCart ?? (async () => null),
            ready: false,
          }),
      });
    } catch {
      /* fail closed without a tool */
    }
    return;
  }

  await pruneStaleReceipts(storage, parsed);
  const receipts = createReceiptStore(storage, parsed);

  let ready = false;
  const deps: GateDeps = {
    registry: parsed,
    receipts,
    storage,
    getCart: () => actions.getCart!(),
    ready,
  };

  const configured = actions.updateCart.configure({
    eventTarget,
    handler: async (defaultHandler, payload, options) => {
      const result = await handleUpdateCart(defaultHandler, payload, options, deps);
      if (result.userErrors && result.userErrors.length > 0) {
        const reason =
          (result.detail as { food_disclosure?: { reason_code?: string } } | undefined)
            ?.food_disclosure?.reason_code ?? "DISCLOSURE_RETRIEVAL_REQUIRED";
        renderReview({
          kind: "rejected",
          reason: reason as never,
          message: result.userErrors[0]?.message ?? "Cart update rejected.",
        });
        dispatch(EVENTS.rejected, result);
      } else {
        updateCartBadge(result.cart?.totalQuantity ?? 0);
        renderReview({ kind: "accepted", quantity: result.cart?.totalQuantity ?? 0 });
        dispatch(EVENTS.accepted, result);
      }
      return result;
    },
  });

  if (configured !== true) {
    renderReview({ kind: "gate_unavailable" });
    return;
  }

  ready = true;
  deps.ready = true;

  if (typeof document.modelContext?.registerTool !== "function") {
    renderReview({ kind: "unsupported" });
    return;
  }

  const contract = toolContract();
  await document.modelContext.registerTool({
    name: contract.name,
    title: contract.title,
    description: contract.description,
    inputSchema: contract.inputSchema,
    annotations: { ...contract.annotations },
    async execute(input, extra) {
      const result = await executeDisclosureTool(
        input,
        parsed,
        receipts,
        extra?.signal,
        (products: DisclosureResult[]) => {
          renderReview({ kind: "retrieved", products });
          dispatch(EVENTS.retrieved, products);
        },
      );
      return result;
    },
  });

  const restored = retrievedFromReceipts(parsed.list, (productId) => receipts.get(productId));
  if (restored.length > 0) renderReview({ kind: "retrieved", products: restored });
  else renderReview({ kind: "idle" });
}

function start() {
  void boot().catch(() => {
    renderReview({ kind: "gate_unavailable" });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
