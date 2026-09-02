# Step-by-step

`[x]` done. `[ ]` not done.

Submit by 2 September 2026, 21:00 London. 3 September is buffer only.

**Next:** Step 10 (submit) when you approve a public GitHub repo, a live demo video, and Devpost. Do not seed the catalog again.

---

## Step 0 — Environment

- [x] ChatGPT desktop installed and signed in (personal workspace, not Enterprise or Edu)
- [x] Site tools used in ChatGPT built-in browser. Model: GPT-5.6 Sol Léger. Not Luna
- [x] Chrome 151+ with `chrome://flags/#enable-webmcp-testing` Enabled
- [x] Devpost registration
- [x] Optional: OpenAI Discord. Skipped (31 August office hours)
- [x] One owned US Dev store (`demo-food-disclosure`). No second store

**Gate:** done.

---

## Step 1 — Original theme (local)

- [x] Hand-authored OS 2.0 theme (not Dawn, Horizon, Skeleton, or Slate)
- [x] JSON templates: home, collection, product, cart, search, 404
- [x] Sections, `config/`, `locales/en.default.json`, original CSS (44px targets)
- [x] Disclosure payload and bootstrap before `{{ content_for_header }}`
- [x] TypeScript: registry, receipts, tool, gate
- [x] Vitest, GraphQL files, Admin API `2026-01` validation
- [x] `npm ci`, typecheck, test, build, Theme Check

**Gate:** done.

---

## Step 2 — Store seed (probe only)

- [x] Ingredients metafield (`custom.ingredients`, storefront `PUBLIC_READ`)
- [x] Label statements metafield (`custom.label_statements`, storefront `PUBLIC_READ`)
- [x] Probe product Harbor Salt Potato Chips, $4.50, `label_statements: []`
- [x] Collection `food-disclosure-demo` with the probe product
- [x] Product and collection published to Online Store

**Gate:** done.

---

## Step 3 — Theme on the owned Dev store

- [x] Unpublished theme **Food Disclosure** on the owned store (not live `test-data`)
- [x] Harbor Pantry copy pushed
- [x] Storefront is password-protected

**Gate:** done.

---

## Step 4 — Chrome vertical slice

Core path (`npm run test:webmcp`, 30 August 2026):

- [x] Native tools (`search_catalog`, `get_product`, `update_cart`, `get_cart`)
- [x] Custom tool `get_product_food_disclosures`
- [x] Annotations `readOnlyHint: false`, `untrustedContentHint: true`
- [x] Add without retrieval rejected. Cart unchanged
- [x] Retrieve then add succeeds. Cart quantity increases
- [x] Add by product handle reaches the gate (reject without retrieval; same add after retrieval)
- [x] Add by search query reaches the gate
- [x] Same-tab navigation keeps receipt and review state
- [x] Human add, remove, and quantity decrease
- [x] No checkout control. Cart copy: checkout is outside this demo; store does not fulfill orders

**Gate:** done.

---

## Step 5 — ChatGPT vertical slice

- [x] Reject → retrieve → accept in ChatGPT desktop built-in browser (30 August 2026, GPT-5.6 Sol Léger)
- [x] First add without retrieval rejected
- [x] `get_product_food_disclosures` returned ingredients `Potatoes, sunflower oil, sea salt.` and `label_statements` `[]`
- [x] Second add increased cart from 0 to 1 (Harbor Salt Potato Chips, $4.50). Cart page shows quantity 1

**Gate:** done.

---

## Step 6 — Stable judge store

- [x] Owned US Dev store is the target. Old CLI preview store unused
- [x] Probe seed and unpublished theme on that store
- [x] Visitor password stored in local config (not in chat)
- [x] Short smoke test on this store after Step 4 and Step 5 pass

**Gate:** done.

---

## Step 7 — Twelve products (after Step 5)

- [x] Review fictional US labels in `docs/label-review.md`
- [x] Local `fixtures/products.json` (exactly 12)
- [x] Fixture generator run, then `npm run seed:catalog`
- [x] Live metafields: `label_statements: null` (Hillpath Trail Mix), `label_statements: []` (Harbor Salt Potato Chips), non-empty label statement (Millhouse Savory Crackers `Contains wheat.`). Missing ingredients: Hearth Corn Chips
- [x] Live payload matches fixture (`npm run capture:payload`, 12 of 12)

**Gate:** done. Do not seed again.

---

## Step 8 — Storefront design (mobile-first)

Clean Harbor Pantry look. Paper background, harbor teal, copper focus. Fluid type. 44px touch targets. One column below 40rem, two columns from 40rem, three columns from 64rem. Extra tightening at 320px (`24.375rem`). Review panel is in the page flow on small screens. On 64rem and up it sits in a side column.

- [x] Original CSS: `--paper`, `--harbor`, `--copper`, `--touch: 44px`, `clamp` type, wrap width
- [x] Header, hero, product cards, product page, cart, password page
- [x] Package silhouettes for chips, crackers, squares, and mix
- [x] Theme Check and unpublished theme push
- [x] Tests assert 44px targets and 320 / 40rem / 64rem breakpoints
- [x] Live 320px: one column, no horizontal overflow, 44px add control, review panel does not cover Add to cart
- [x] Live 390px: one column, hero request text wraps, cards readable
- [x] Live desktop (~1280px): three-column grid, side review panel, product and cart layouts

**Gate:** done.

---

## Step 9 — Storefront robustness

- [x] Harbor Pantry copy, review panel, empty collection state (theme pushed)
- [x] Automated tests, including 320px CSS extras
- [x] Live 320/390px check in the browser (with Step 8)
- [ ] One cold comprehension check
- [x] README: setup, tool contract, limits, how to test

**Gate:** not done (cold check only).

---

## Step 10 — Submit

- [ ] Re-read [official rules](https://webmcp.devpost.com/rules)
- [ ] Public GitHub (only when approved). First public commit keeps MIT `LICENSE` visible
- [ ] Demo video under three minutes. No fake agent UI
- [ ] Devpost: live URL, repo URL, test steps, why WebMCP is required
- [ ] Tag `v1.0.0-webmcp-submission`. Freeze the live theme

**Gate:** not done.

---

## Stop

After Step 4 plus two hours of fix attempts, stop the Shopify path if:

- Custom and native tools do not appear together
- `updateCart.configure` returns `false`
- Adds by id, handle, or query miss the gate
- ChatGPT cannot run the custom tool

Then switch once to the static fallback. Do not run both.
