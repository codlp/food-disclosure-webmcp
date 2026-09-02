# Chrome and ChatGPT vertical slice

Do this on the live shop: [https://shop.coraliedelpha.fr/](https://shop.coraliedelpha.fr/). There is no storefront password.

Do not use Horizon, Debut, Luna, or an Enterprise/Edu ChatGPT workspace.

## How to open the Chrome tool list

This is not the Chrome ⋮ menu. This is not Shopify **Edit theme**.

1. Stay on the Maple & Sage store tab.
2. Confirm `chrome://flags/#enable-webmcp-testing` is **Enabled**. If you just changed it, relaunch Chrome and reopen the shop.
3. If DevTools has no WebMCP pane, also enable `chrome://flags/#devtools-webmcp-support`, then relaunch.
4. On the store tab, open DevTools: **View → Developer → Developer Tools**, or `Cmd+Option+I`.
5. Click the **Application** tab (if you do not see it, click **»** on the tab bar).
6. In the Application sidebar, click **WebMCP**.
7. Use **Available tools**. You should see Shopify native tools plus `get_product_food_disclosures`.

To run a tool in that pane: click the tool name, fill the fields, click **Run tool**.

## Chrome

1. Native tools appear (`search_catalog`, `get_product`, `update_cart`, and the rest).
2. Custom tool `get_product_food_disclosures` appears. Title: Retrieve food disclosures.
3. Annotations: `readOnlyHint: false`, `untrustedContentHint: true`.
4. Add Harbor Salt Potato Chips by variant id without retrieval. Cart does not change.
5. Same add after retrieval succeeds. Cart quantity updates.
   In the `update_cart` form: leave `line_items[0].id` empty. Put the Product GID **or** the ProductVariant GID in `line_items[0].item.id`. Quantity 1.
   Do not hard-refresh the store tab between retrieve and add. That clears the receipt.
6. Repeat with add by product handle if the inspector exposes that form.
7. Repeat with add by search query if the inspector exposes that form.
8. Open another page in the same tab. Receipt and review state stay correct.
9. Human Add to cart, remove, and quantity decrease still work.
10. Checkout is not part of the demo.

## ChatGPT desktop

Repeat the reject → retrieve → accept path. Prefer GPT-5.6 Sol.

If ChatGPT asks you to confirm a non-read-only tool, confirm it. Do not change `readOnlyHint`.

Paste the demo request from the storefront if needed:

> Build a snack basket under $40. Avoid wheat, barley, rye, malt, semolina, and anything with a “may contain wheat” or “may contain gluten” label statement. Do not add products with missing ingredient or label statement data.

Until the 12 products are seeded, only Harbor Salt Potato Chips is a live candidate. Do not expect the skip products to exist on the store yet.

## Report back

- Chips visible?
- Both tool sets visible?
- Reject then accept?
- Human add still works?
