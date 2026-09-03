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

The ordinary Add button is not a second path. It uses the same label receipt as `update_cart`. Remove and decrease still work without retrieval.

The store never decides whether a product is suitable. The client lists their restrictions for their AI agent, the merchant supplies the facts (ingredients and label information), and the AI agent compares them to make a decision.

## Try it

Live shop: [https://shop.coraliedelpha.fr/](https://shop.coraliedelpha.fr/). There is no storefront password.

### ChatGPT desktop

Use GPT-5.6 Sol. Do not use Luna. Open the shop in that chat. Start with an empty basket. If ChatGPT asks you to confirm a non-read-only tool, confirm it.

Paste these prompts in order. Do not hard-refresh the shop tab between prompt 2 and prompt 3. The receipt lives in this tab.

1. `Add Harbor Salt Potato Chips to the cart. Do not retrieve ingredients or label statements.`
   The cart must not change.
2. `Retrieve ingredients and label statements for Harbor Salt Potato Chips with get_product_food_disclosures.`
   The tool returns ingredients and `label_statements: []`.
3. `Add Harbor Salt Potato Chips to the cart.`
   Harbor Salt is in the cart.
4. `Build a snack basket under €40. Avoid wheat, barley, rye, malt, semolina, and anything with a “may contain wheat” or “may contain gluten” label statement. Do not add products with missing ingredient or label statement data.`
   The agent retrieves before each add. It skips wheat, malt, “may contain” lines, and missing fields.

The “Do not retrieve” line in prompt 1 is required. Without it, ChatGPT often retrieves on its own and the block never shows.

Harbor Salt Potato Chips has `label_statements: []`. Hillpath Trail Mix has `label_statements: null`. Those are different on purpose. `null` means the merchant did not supply the field. `[]` means the merchant supplied a record with no separate label statement.

### Chrome WebMCP inspector

1. Enable `chrome://flags/#enable-webmcp-testing` in Chrome 151 or later. Relaunch Chrome if you just changed the flag.
2. Open the live shop. On that tab, open DevTools → **Application → WebMCP**. The click path is in [docs/chrome-slice.md](docs/chrome-slice.md).
3. Confirm native commerce tools and `get_product_food_disclosures` both appear.
4. Add Harbor Salt without retrieval. The cart must not change. Retrieve, then add. The cart must update.
5. Retrieve Hillpath Trail Mix. Confirm `label_statements` is `null`, not `[]`.
6. Confirm the ordinary Add button without retrieval does not change the cart. Remove and decrease still work.

## Why WebMCP

Native cart actions and a custom disclosure tool share one merchant page. The storefront can reject `update_cart` until retrieval runs for that product version. A side-channel API would not sit on that path. The agent could skip it.

## How it works

See [docs/architecture.md](docs/architecture.md) for the gate, receipts, and catalog cases.

1. The shopper goes to the shop website with a shopping agent.
2. The shopper tells the agent which foods to avoid on this trip.
3. The agent calls `get_product_food_disclosures` before it adds a product.
4. The tool returns merchant ingredients and label statements, including missing fields. The page stores a receipt in this tab.
5. The agent compares those facts to the shopper’s restrictions. The store does not judge suitability.
6. Native `update_cart` and the ordinary Add control can increase a cart line only when that receipt is current. Without it, the cart does not change.

A receipt records that retrieval ran for this product version in this tab. It does not mean the agent understood the label. It does not mean the snack is suitable. Add on the page uses the same receipt. Checkout is not part of this demo.

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
