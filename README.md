# ellen cafe & eatery

Minimal static website for ellen cafe & eatery (18 Huntley St, Alexandria NSW): a landing page
(`index.html`) and a table reservation page (`reserve.html`). Plain HTML, CSS and JavaScript — no build step.

The look follows the café's logo: cream ground, rust-brown lowercase sans-serif, and the
"caf·elle·atery·n" wordmark as the hero.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000.

## Edit the content

All café details — intro text, address, email, opening hours, menu, reservation rules — live in
`assets/config.js`. Lines marked `CHECK` come from public sources and should be confirmed.

## Reservations

- Bookable times are derived from the opening hours in the config; closed days are blocked.
- Dates and "today" are worked out in the café's timezone (`timezone` in the config), so the
  form behaves the same for a visitor anywhere.
- If `reservation.endpoint` is set (any endpoint accepting a JSON POST, e.g. Formspree), requests
  are sent there. If it is empty, submitting opens the guest's email app with the request
  addressed to `email`.
- A request is not a confirmed booking: the café replies by email to confirm.

## Deploy

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages) — publish the repository root.
