# Ellen Cafe

Minimal static website: a landing page (`index.html`) and a table reservation page (`reserve.html`). No build step.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000.

## Edit the content

All café details — intro text, address, email, opening hours, menu, reservation rules — live in `assets/config.js`.
Values marked `SAMPLE` are placeholders and must be replaced.

## Reservations

Available times are derived from the opening hours in the config (closed days are blocked).

- If `reservation.endpoint` is set (any endpoint accepting a JSON POST, e.g. Formspree), requests are sent there.
- If it is empty, submitting opens the guest's email app with the request addressed to `email`.

## Deploy

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages) — publish the repository root.
