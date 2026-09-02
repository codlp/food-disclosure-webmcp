# Devpost draft

Public repo: https://github.com/codlp/food-disclosure-webmcp
Tag: `v1.0.0-webmcp-submission`

Do not submit until ChatGPT desktop (not Luna) is re-proved and the video is public.

## Project name

TrustCart (working title). Public shop name: Harbor Pantry.

## Elevator pitch

People with food restrictions, including allergies, should be able to send a shopping agent to a grocery store. Harbor Pantry requires that agent to retrieve merchant ingredients and label statements, including missing data. Only then can Shopify’s native WebMCP cart path add a line.

## Inspiration

Agents can already search a catalog and add a line. For someone who avoids wheat or nuts, a title is not enough. Missing label statement data can look like “no statement.” The store must force retrieval of the merchant’s current label before the live cart changes.

## What it does

- Exposes one custom tool, `get_product_food_disclosures`.
- Returns merchant-supplied `ingredients` and `label_statements`, including `null`.
- Records a tab receipt for that product version.
- Rejects a native `update_cart` increase until that receipt exists.
- Shows the same facts to the human on the page.

## How we built it

An original Online Store 2.0 theme. Disclosure JSON in Liquid. A blocking bootstrap before `content_for_header`. Shopify’s native WebMCP tools plus one custom tool. No backend.

## Challenges

Preview stores, development themes, and password gates are easy to confuse. JSON metafields must keep `null` and `[]` distinct. Honest `readOnlyHint: false` may add a confirm step in ChatGPT.

## Accomplishments

A fail-closed gate on the native cart path. Visible retrieval and rejection. Twelve live snacks with distinct missing, empty, and non-empty disclosure cases.

## What we learned

Evidence before action is a storefront contract, not a medical engine. The receipt must stay narrow.

## What's next

Talk to independent used-food or specialty grocers only if this interaction pattern is useful beyond the hackathon. Do not turn this demo into a diagnostic product.

## Built with

Shopify Liquid, Shopify WebMCP, TypeScript, Vitest, original theme CSS.

## Try it

1. Open the live HTTPS storefront. Use the documented visitor password if asked.
2. Enable Chrome WebMCP testing, or use ChatGPT desktop with site tools.
3. Attempt an add without retrieval. It must fail.
4. Retrieve disclosures. Retry the add. It must succeed.
5. Confirm a human add still works.

## Why WebMCP is required

The native `update_cart` action and the custom disclosure tool share one page. The gate can reject the same cart path the agent already uses. A side-channel API would not sit on that path.
