# Card Compass

A single-page app that tells you which credit card to use for a purchase while traveling.

Pick a category (flights, hotels, dining, transit, ...), enter the amount, and say whether you're
paying abroad or booking through a card's travel portal. Cards in your wallet are ranked by
effective return:

    return % = points per $ × cents per point − foreign transaction fee (when abroad)

It also flags US-only bonuses (e.g. Amex Gold groceries), suggests a non-Amex backup abroad,
and tells you when a card's travel portal would earn more.

## Run

Open `index.html` in a browser. No build step or server needed. Your wallet, point values and
custom cards are saved in the browser's localStorage.

## Updating card data

Preset cards live in the `PRESETS` array in `index.html`. Earn rates change often, so check
issuer terms and edit as needed.
