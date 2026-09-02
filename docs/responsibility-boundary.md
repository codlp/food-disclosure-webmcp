# Responsibility boundary

## Why

People with food restrictions, including allergies, need the merchant’s current label. They do not need a medical verdict from the store. The shopper’s agent compares the shopper’s restrictions with those facts.

## Roles

| Role            | Supplies                                                             |
| --------------- | -------------------------------------------------------------------- |
| Shopper         | Explicit food restrictions for this trip                             |
| Merchant        | Ingredient string and label statement list, including missing values |
| Shopper’s agent | Comparison of those two inputs                                       |
| Storefront      | Retrieval before the native `update_cart` increase                   |

## Allowed wording

- Disclosure retrieved for this product version.
- Ingredient statement not supplied.
- Label-statement data not supplied.
- Cart update rejected until disclosures are retrieved.
- The agent skipped this product because it conflicted with the shopper’s explicit request.

## Forbidden wording

Do not say:

- safe, unsafe, allergy-safe, celiac-safe, or approved
- verified ingredients, except as schema validation
- prevents every unsafe purchase
- works on all Shopify stores
- secure receipt or tamper-proof gate

## Missing data

`null` means the merchant did not supply the field. `[]` means the merchant supplied an empty label statement list. Do not collapse those two values.

## Receipt meaning

The receipt means the custom tool completed for the current page version in this tab. It does not mean the agent understood the label. It does not mean the product is suitable.

## Claimed path

Claim only the tested native `update_cart` path on this demo storefront.
