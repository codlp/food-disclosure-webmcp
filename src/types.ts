export const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/[0-9]+$/;
export const VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/[0-9]+/;

export type RenderedDisclosure = {
  product_id: `gid://shopify/Product/${string}`;
  handle: string;
  title: string;
  variant_ids: `gid://shopify/ProductVariant/${string}`[];
  ingredients: string | null;
  label_statements: string[] | null;
};

export type DisclosureReceipt = {
  receiptId: string;
  productId: string;
  variantIds: string[];
  productVersion: string;
  tabSessionId: string;
  issuedAt: string;
};

export type DisclosureResult = {
  product_id: string;
  product_version: string;
  title: string;
  ingredients: string | null;
  label_statements: string[] | null;
  evidence_receipt_id: string;
};

export type ToolSuccess = {
  ok: true;
  products: DisclosureResult[];
  notice: string;
};

export type ToolFailure = {
  ok: false;
  error: { code: string; message: string; recovery?: string };
};

export type ToolResult = ToolSuccess | ToolFailure;

export type GateReasonCode =
  | "DISCLOSURE_RETRIEVAL_REQUIRED"
  | "DISCLOSURE_VERSION_STALE"
  | "UNKNOWN_PRODUCT_VARIANT"
  | "CART_LINE_ASSOCIATION_REQUIRED"
  | "DISCLOSURE_GATE_UNAVAILABLE";

export type CartLineInput = {
  id?: string;
  merchandiseId?: string;
  handle?: string;
  query?: string;
  quantity?: number;
  attributes?: { key: string; value: string }[];
  sellingPlanId?: string;
};

export type UpdateCartPayload = {
  cartId?: string;
  lines?: CartLineInput[];
  note?: string;
  discountCodes?: string[];
  attributes?: { key: string; value: string }[];
};

export type CartSummary = {
  id: string;
  totalQuantity: number;
  cost: { totalAmount: { amount: string; currencyCode: string } };
  lines: Array<{
    id: string;
    quantity: number;
    cost: { totalAmount: { amount: string; currencyCode: string } };
    merchandiseId?: string;
  }>;
  discountCodes: Array<{ applicable: boolean; code: string }>;
};

export type CartMutationUserError = {
  code?: string;
  field?: string[];
  message: string;
};

export type UpdateCartResult = {
  cart: CartSummary;
  userErrors?: CartMutationUserError[];
  warnings?: Array<{ code?: string; message: string; target?: string }>;
  detail?: Record<string, unknown>;
};

export const EMPTY_CART: CartSummary = {
  id: "",
  totalQuantity: 0,
  cost: { totalAmount: { amount: "0.00", currencyCode: "USD" } },
  lines: [],
  discountCodes: [],
};

export const TOOL_NOTICE =
  "Merchant-supplied declarations only. Compare them with the shopper's explicit request; this tool does not determine suitability.";

export const STORAGE_RECEIPTS = "food-disclosure:receipts:v1";
export const STORAGE_TAB = "food-disclosure:tab-session:v1";
export const STORAGE_LINE_MAP = "food-disclosure:line-map:v1";
