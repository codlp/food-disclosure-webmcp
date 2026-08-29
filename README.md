# Food disclosure WebMCP demo

An original Shopify storefront for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/) (August–September 2026).

Shoppers already know the food restrictions they want their agent to follow. This demo lets that agent retrieve the merchant’s current ingredient and warning statements—including fields the merchant did not supply—before Shopify’s native WebMCP cart action changes the live cart.

## Promise

See the merchant’s label information before your shopping agent adds the product.

## What this is not

This is a fictional packaged-food demonstration. It does not decide whether a product is medically safe or suitable. The shopper supplies restrictions; the merchant supplies facts; the shopper’s agent compares the two. A retrieval receipt records that disclosures were fetched for the current product version in this tab—not that they were understood or applied correctly.

The demonstrated cart gate applies to Shopify’s native WebMCP `update_cart` path on this demo storefront. It is not a claim that every Cart API or caller is blocked.

## License

MIT. See [LICENSE](LICENSE). The theme and application source in this repository are original. Do not treat Shopify’s first-party themes as a dependency.

## Status

Public repository initialized 2026-08-29. Implementation of the original Online Store 2.0 theme and disclosure tool follows in later commits.

A live URL, setup steps, and testing instructions will be added when the vertical slice is deployed.
