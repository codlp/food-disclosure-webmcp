# Architecture

People with food restrictions should be able to send a shopping agent to a store. This storefront shows the contract that makes that possible: evidence before a native cart increase.

```text
merchant facts → structured disclosure retrieval → shopper-agent judgment
               → current receipt → native cart action → visible human review
```

## Pieces

1. **Liquid payload.** `theme/snippets/disclosure-data.liquid` renders the current collection as JSON. Missing metafields become JSON `null`. A JSON metafield whose value is `[]` stays an empty array.
2. **Early bootstrap.** `disclosure-bootstrap.js` loads before `{{ content_for_header }}`. It configures `Shopify.actions.updateCart` first.
3. **Custom tool.** `get_product_food_disclosures` reads the page payload, writes a tab `sessionStorage` receipt, and updates the review panel.
4. **Cart gate.** Increases on the native `update_cart` path need a current receipt for that product version. Decreases and removals pass through.
5. **Visible review.** The review panel shows retrieved facts, missing fields, rejections, and accepted cart quantity.

## Receipt

A receipt is a tab-session record that retrieval ran for this product version. It is not a safety verdict. It does not store shopper restrictions.

The version hash covers product id, variant ids, ingredients, and label statements. `label_statements: null` and `label_statements: []` produce different hashes.

## Fail closed

The gate rejects an increase when:

- initialization is not ready
- `configure` did not return `true`
- the registry is missing or malformed
- `sessionStorage` is not available
- the variant or handle is unknown
- a search `query` add arrives without a resolved variant id
- the receipt is missing or stale

Human product forms still work in those cases. The UI must not imply that retrieval was recorded.

## Add classification

Shopify’s native tool may add by variant id, product handle, or search query. The native layer is expected to resolve those inputs before it calls `updateCart`. This gate still classifies the action payload:

- variant `merchandiseId` → look up the registry by variant
- product `handle` without a variant id → look up the registry by handle
- search `query` without a variant id → reject. The client cannot uniquely resolve a search string.

Phase 4 must still prove all three native add forms in Chrome.

## What stays out

No backend. No allergen database. No medical model. No fake agent UI. No checkout.
