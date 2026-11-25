# ellen cafe & eatery

Website for ellen cafe & eatery (153/18 Huntley St, Alexandria NSW). Plain HTML, CSS and
JavaScript with no build step, backed by a Supabase project for reservations and photos.

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: wordmark, photos, menu, address and hours |
| `reserve.html` | Table request form |
| `admin.html` | Owner area: answer reservation requests, manage the photos |

The look follows the café's logo: cream ground, rust-brown lowercase sans-serif, and the
"caf·elle·atery·n" wordmark as the hero.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. The pages talk to the live Supabase project named in
`assets/config.js`, so a request sent from a local copy is a real request.

## Edit the content

Café details — intro text, address, email, opening hours, menu, reservation rules — live in
`assets/config.js`. Lines marked `CHECK` come from public sources and should be confirmed.
The menu section stays hidden while `menu` is empty.

## Reservations

A guest picks a date and time and sends a request. It is stored in the Supabase table
`public.reservations` as `pending`; it is not a booking until an owner confirms it.

- Bookable times come from the opening hours in `assets/config.js`; closed days are blocked.
  Dates and "today" are worked out in the café's timezone, wherever the visitor is.
- The website can only add a request. It cannot read, change or delete any, so nobody can use
  it to see who has booked.
- The database accepts at most 5 requests an hour (15 a day) from one visitor and 60 an hour
  (300 a day) in total. To count per visitor it keeps the network address of each accepted
  request in `private.reservation_log` for two days.
- If a request cannot be stored, the form offers to send it by email instead. If the
  `supabase` block in the config is empty, the form only uses email.
- Opening hours, slot length, largest party and how far ahead guests can book are set in
  `assets/config.js`. The database only enforces wider safety limits (quarter-hour times,
  1–20 guests, up to a year ahead), so changing the config never needs a database change.

Nothing notifies the café when a request arrives. Someone has to open the owner area to see
it — see "Not built yet" below.

## Owner area

Open `admin.html` and sign in.

- **Reservations**: requests waiting for a reply are listed first. Confirm, decline, cancel or
  delete each one. "email guest" opens your own email app with a reply already written — the
  site does not send email itself, so the guest only hears back if you send it.
- **Photos**: add photos (they are scaled down and stripped of location data in your browser
  before upload), describe them, reorder them, delete them. The first 12 appear on the
  landing page.

### Giving someone access

Access needs two things: a Supabase login, and that login's email address on the owner list.

1. In the Supabase dashboard open **Authentication → Users → Add user → Create new user**.
   Enter the email and a password and leave **Auto Confirm User** ticked.
2. Add the address to the owner list. In **SQL Editor** run:

       insert into private.owners (email) values ('owner@example.com');

To remove access, delete that row (and the user). To change a password, use the user's menu
in **Authentication → Users**.

It is worth switching off **Allow new users to sign up** under **Authentication → Sign In /
Providers**. Self-registered accounts get no access either way, but there is no reason to
collect them.

## Database

`supabase/migrations/` holds the schema; `supabase/tests/` holds pgTAP tests for the access
rules (what a visitor, a signed-in non-owner and an owner can each do).

    supabase link --project-ref <project ref>
    supabase db push        # apply migrations
    supabase test db        # run the tests against a local stack (`supabase start` first)

What lives where:

| Object | Purpose |
| --- | --- |
| `public.reservations` | Table requests |
| `public.photos` | Which uploaded photos appear on the site, in what order, with what description |
| Storage bucket `photos` | The image files (public) |
| `private.owners` | Email addresses allowed into the owner area |
| `private.reservation_log` | Recent request times and visitor addresses, for rate limiting |

The Supabase URL and publishable key in `assets/config.js` are meant to be public. What they
can reach is decided by the row level security policies in the migrations, not by keeping
the key secret. Never put a secret (`sb_secret_…`) or `service_role` key in this repository.

## Deploy

`.github/workflows/pages.yml` publishes `index.html`, `reserve.html`, `admin.html` and
`assets/` to GitHub Pages on every push. Pages must be switched on once: **Settings → Pages →
Build and deployment → Source: GitHub Actions**.

## Not built yet

- **Notifications.** New requests do not email or message anyone. Until that exists, check
  the owner area regularly, or the "we'll reply to confirm" promise on the form is not kept.
- **Bot protection.** The rate limits cap abuse but there is no CAPTCHA.
- **Availability.** The form does not know how full the café is; every request is a request.
