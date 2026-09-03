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
4. **Cart gate.** A keep-or-increase needs a current receipt for that product version. The gate covers native `update_cart`, the Add form, `/cart/add`, `/cart/change`, `/cart/update`, cart permalinks, and in-page navigation. Decreases, removals, and `/cart/clear` pass through. After load, the gate removes lines that have no current receipt. The ordinary Add button is not a second path.
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
- a keep-or-increase of an existing cart line without a current receipt, including when the product is already in the cart
- a cart permalink, `/cart/change`, or `/cart/update` keep-or-increase without a current receipt
- a `fetch`, `XHR`, form, click, `location`, or `window.open` write to those URLs without a current receipt

When the gate is not active, the UI must not imply that retrieval was recorded. When the gate is active, the storefront Add control uses the same receipt. It is not a bypass.

Shopify’s native tool may add by variant id, product handle, or search query. The gate classifies those payloads. A search `query` without a resolved variant id is rejected.

## Catalog cases

These 12 records are fictional. They exist so the demo can show `null`, `[]`, ingredient conflicts, and extra label statements.

| Handle                    | Case                                            |
| ------------------------- | ----------------------------------------------- |
| harbor-salt-potato-chips  | Complete; `label_statements: []`                |
| meadow-herb-rice-crackers | Complete                                        |
| sunlit-chickpea-curls     | Complete                                        |
| orchard-fruit-squares     | Complete                                        |
| red-lentil-scoops         | Complete                                        |
| lantern-chocolate-bites   | Ingredient includes barley malt extract         |
| millhouse-savory-crackers | Ingredient includes wheat flour; Contains wheat |
| golden-tea-biscuits       | Ingredient includes semolina                    |
| cedar-cocoa-nut-bar       | May contain wheat                               |
| cocoa-grove-clusters      | May contain gluten                              |
| hillpath-trail-mix        | `label_statements: null`                        |
| hearth-corn-chips         | `ingredients: null`                             |

Titles and descriptions do not announce the conflict. The agent must retrieve the disclosure fields.

`null` means the merchant did not supply the field. `[]` means the merchant supplied an empty label statement list. Do not collapse those two values.

## Responsibility

The shopper names restrictions. The merchant supplies ingredients and label statements, including missing values. The shopper’s agent compares those two inputs. The storefront only requires retrieval before a cart increase, including the ordinary Add control.

Do not say a snack is safe, unsafe, verified, or medically suitable. A receipt means the custom tool completed for the current page version in this tab. It does not mean the agent understood the label.

## What stays out

No backend. No allergen database. No medical model. No fake agent UI. No checkout.
