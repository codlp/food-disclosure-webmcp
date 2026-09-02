# Video script (under 3 minutes)

Record the real Chrome or ChatGPT storefront. Do not overlay a fake agent UI.

## 0:00–0:20 — Promise

Show Harbor Pantry. Say:

> People with food restrictions should be able to send an agent shopping. An agent can shop here. It cannot skip the label. This demo does not decide whether a snack is medically suitable.

## 0:20–0:50 — Reject

Ask the agent to add Harbor Salt Potato Chips to the cart.

Show the inspector: `update_cart` runs. The gate rejects it. The cart quantity does not change. The review panel shows that retrieval is required.

## 0:50–1:30 — Retrieve

Call `get_product_food_disclosures` with the Product GID.

Show ingredients and `label_statements: []`. Say that an empty list is not the same as missing data.

## 1:30–2:10 — Accept

Retry the same add. The cart updates. The review panel shows the accepted quantity.

## 2:10–2:40 — Missing data (if the 12-product catalog is live)

Open Hillpath Trail Mix or Hearth Corn Chips. Show `null` as “Not supplied”. Do not call it safe.

If only the probe product is live, skip this beat. Do not fake a missing field.

## 2:40–2:55 — Human path

Add the same chips with the ordinary Add to cart button. Remove it. Checkout stays out of the demo.

## 2:55–3:00 — Close

> Retrieval is required before the native agent cart path. Suitability stays with the shopper’s agent.
