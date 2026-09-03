# Label Check

## Problem

Great news: AI made so much progress in the last few months that we can now **have agents shop online for us**.

Unfortunately, for people with **dietary restrictions** (gluten free, dairy free, vegan, etc.) or with **severe allergies**, this agent-led online shopping is **not yet possible**.

Why?

Because what an agent treats as gluten free, dairy free, or nut free is often only what showed up in the product title or description. If the listing says “gluten free”, the agent is likely to treat that as the answer and move on. It does not automatically read the pack the way a person would.

There are several issues with this:

- **Human mistakes**: a product can be presented as gluten free in the listing and still have a thickening ingredient that contains gluten. An agent that only reads the title will miss that.
- **Missing information**: products that are not labelled gluten free in the title, but actually are, get ignored by the agent. The shopper misses options they could have bought. The merchant misses the sale.
- **Cross-contact**: if you know someone with a dietary restriction, you know they don’t only read the ingredients. They also check the “may contain” / “made in a facility” lines very carefully. A gluten-free recipe prepared in a factory that also handles gluten is a different situation for someone with celiac disease. Same idea for a product with no seafood in the ingredients, made in a factory that also processes seafood. An agent that never retrieves those lines is not shopping the way they shop.

## Vision

The idea is to make it easier for people with dietary restrictions or severe allergies to shop online with AI agents.

How?

By giving these AI agents access to the product's full list of ingredients and disclosures so it can make an informed and safe purchased decision. 

## Solution

Maple & Sage is a working grocery storefront where this idea, Label Check, is live.

Label Check makes an agent retrieve a product’s ingredients and label statements before it can add that product to the cart. Maple & Sage is the grocery shop where that rule is live.

An agent can search through the product catalog and build a cart the same way it would on any online store. What it has to retrieve is the ingredients and the label statements, including when a field is missing. "null" is not the same as an empty list and it is not treated as "none".

Alongside the agent’s WebMCP path, the client can still use the ordinary "add" button to add products to their cart.

The store never decides whether a product is suitable. The client lists their restrictions for their AI agent, the merchant supplies the facts (ingredients and label information), and the AI agent compares them to make a decision.

## Try it

1. Enable `chrome://flags/#enable-webmcp-testing` in Chrome 151 or later. Relaunch Chrome if you just changed the flag.
2. Open [the live storefront](https://shop.coraliedelpha.fr/). There is no storefront password.
3. On the store tab, open DevTools. Open **Application → WebMCP**. The click path is in [docs/chrome-slice.md](docs/chrome-slice.md).
4. Confirm native commerce tools and `get_product_food_disclosures` both appear.
5. Ask the agent to add Harbor Salt Potato Chips without retrieval. The cart must not change.
6. Call `get_product_food_disclosures` for that product. Then retry the add. The cart must update.
7. Retrieve Hillpath Trail Mix. Confirm `label_statements` is `null`, not `[]`.
8. Repeat in ChatGPT desktop. Do not use the Luna model.
9. Confirm a human can still add and remove items with the ordinary product form.

Harbor Salt Potato Chips has `label_statements: []`. Hillpath Trail Mix has `label_statements: null`. Those are different on purpose. `null` means the merchant did not supply the field. `[]` means the merchant supplied a record with no separate label statement.

## Why WebMCP

Native cart actions and a custom disclosure tool share one merchant page. The storefront can reject `update_cart` until retrieval runs for that product version. A side-channel API would not sit on that path. The agent could skip it.

## How it works

See [docs/architecture.md](docs/architecture.md) for the gate, receipts, and catalog cases.

1. The shopper goes to the shop website with a shopping agent.
2. The shopper tells the agent which foods to avoid on this trip.
3. The agent calls `get_product_food_disclosures` before it adds a product.
4. The tool returns merchant ingredients and label statements, including missing fields. The page stores a receipt in this tab.
5. The agent compares those facts to the shopper’s restrictions. The store does not judge suitability.
6. Native `update_cart` can increase a cart line only when that receipt is current. Without it, the cart does not change.

A receipt records that retrieval ran for this product version in this tab. It does not mean the agent understood the label. It does not mean the snack is suitable. A human can still use the ordinary product form. Checkout is not part of this demo.

## Custom tool

| Field                  | Value                           |
| ---------------------- | ------------------------------- |
| Name                   | `get_product_food_disclosures`  |
| Title                  | Retrieve food disclosures       |
| Input                  | 1–4 unique Shopify Product GIDs |
| `readOnlyHint`         | `false`                         |
| `untrustedContentHint` | `true`                          |

Returned fields:

- `ingredients`: `string` or `null`
- `label_statements`: `string[]` or `null`

## License

MIT. See [LICENSE](LICENSE). The theme and application source in this repository are original.
