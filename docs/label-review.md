# Fictional label records

These 12 records are **fictional**. They are not copied from a real package. They are not a legal US food label. They exist so the demo can show `null`, `[]`, ingredient conflicts, and extra label statements.

Do not present them as FDA-reviewed or as medical advice.

## How the fields are used

| Field                                        | Meaning in this demo                              |
| -------------------------------------------- | ------------------------------------------------- |
| `ingredients` string                         | Merchant supplied an ingredient statement         |
| `ingredients: null`                          | Merchant did not supply that field                |
| `label_statements: []`                       | Merchant supplied an empty label statement list   |
| `label_statements: null`                     | Merchant did not supply label statement data      |
| `Contains wheat.`                            | A supplied Contains-style line in the demo record |
| `May contain wheat.` / `May contain gluten.` | A supplied advisory line in the demo record       |

US packaged foods commonly carry an ingredient list. Advisory “may contain” statements are not the same as a missing field. This demo preserves that distinction. It does not classify allergens for the shopper.

## Catalog map

| Handle                    | Case                                                            |
| ------------------------- | --------------------------------------------------------------- |
| harbor-salt-potato-chips  | Complete; `label_statements: []`                                |
| meadow-herb-rice-crackers | Complete                                                        |
| sunlit-chickpea-curls     | Complete                                                        |
| orchard-fruit-squares     | Complete                                                        |
| lantern-chocolate-bites   | Ingredient includes barley malt extract                         |
| millhouse-savory-crackers | Ingredient includes wheat flour; label statement Contains wheat |
| golden-tea-biscuits       | Ingredient includes semolina                                    |
| cedar-cocoa-nut-bar       | Label statement May contain wheat                               |
| cocoa-grove-clusters      | Label statement May contain gluten                              |
| hillpath-trail-mix        | `label_statements: null`                                        |
| hearth-corn-chips         | `ingredients: null`                                             |
| red-lentil-scoops         | Complete alternative                                            |

Titles and descriptions do not announce the conflict. The agent must retrieve the disclosure fields.

## What this file does not do

It does not cite package weights, nutrition facts, or real manufacturer names. If a claim in marketing copy needs a real FDA rule, research that rule before you publish it. Do not invent a threshold or a legal definition here.
