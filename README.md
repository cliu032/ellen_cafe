# ellen cafe & eatery

Website for ellen cafe & eatery (153/18 Huntley St, Alexandria NSW). Plain HTML, CSS and
JavaScript with no build step, backed by a Supabase project for reservations and photos.

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: wordmark, open-now line, photos, menu, address and hours |
| `reserve.html` | Dinner reservations (a walk-in message until dinner nights are set) |
| `admin.html` | Owner area: answer reservation requests, manage the photos |

The look follows the café's logo: cream ground, rust-brown lowercase sans-serif, and the
"caf·elle·atery·n" wordmark as the hero.

## How the café works, and what the site does about it

- **Breakfast and lunch are walk-in only.** The daytime opening hours are shown but can never
  be booked.
- **Dinner is by reservation.** Until dinner nights are set in `assets/config.js`, the site
  takes no reservations and does not mention dinner: the "reserve" links are hidden and
  `reserve.html` says "walk-ins only".

### Switching dinner reservations on

In `assets/config.js`, fill in the `dinner` block:

    dinner: {
      from: "2027-02-05",   // first night; leave "" if dinner is already running
      hours: {
        4: { open: "17:30", close: "21:30" },   // Thursday
        5: { open: "17:30", close: "22:00" },   // Friday
        6: { open: "17:30", close: "22:00" },   // Saturday
      },
    },

That one change makes the "reserve for dinner" button and the "reserve" nav link appear, shows
the dinner hours once dinner has started, and opens the form for those nights. Clear `hours`
again to stop taking reservations. The `reservation` block beside it sets the slot length,
notice period, last seating, largest party and how far ahead guests can book.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. The pages talk to the live Supabase project named in
`assets/config.js`, so a request sent from a local copy is a real request.

## Edit the content

Café details — intro text, address, email, opening hours, menu — live in `assets/config.js`.
Lines marked `CHECK` come from public sources and should be confirmed. The menu section stays
hidden while `menu` is empty.

The address, email and "open Tuesday to Sunday" are also written into `index.html` itself, so
they show even if JavaScript does not run. If any of those change, change them in both places.

## Reservations

A guest picks the number of guests, a night and a time, and sends a request. It is stored in
the Supabase table `public.reservations` as `pending`; it is not a booking until an owner
confirms it.

- Bookable nights and times come from the `dinner` block; nights without dinner are shown
  crossed out. Dates and "today" are worked out in the café's timezone, wherever the visitor is.
- The website can only add a request. It cannot read, change or delete any, so nobody can use
  it to see who has booked.
- The database accepts at most 5 requests an hour (15 a day) from one visitor and 60 an hour
  (300 a day) in total. To count per visitor it keeps the network address of each accepted
  request in `private.reservation_log`; entries older than two days are cleared whenever a new
  request is accepted.
- If a request cannot be stored, the form offers to send it by email instead.
- The database itself only enforces wider safety limits: times from 4pm onward on the quarter
  hour, 1–20 guests, up to a year ahead. So changing the config never needs a database change.

Nothing notifies the café when a request arrives. Someone has to open the owner area to see
it — see "Not built yet" below.

## Owner area

Open `admin.html` and sign in.

- **Reservations**: requests waiting for a reply are listed first. Confirm, decline, cancel or
  delete each one. "email guest" opens your own email app with a reply already written — the
  site does not send email itself, so the guest only hears back if you send it.
- **Photos**: add photos (they are scaled down and stripped of location data in your browser
  before upload), describe them, reorder them, delete them. The first 12 appear on the
  landing page. A deleted photo leaves the page at once; its direct address can keep working
  for up to an hour.

### Giving someone access

Do these in order.

1. **Switch off public sign-up.** In the Supabase dashboard: Authentication → Sign In /
   Providers → turn off "Allow new users to sign up". Only owners should have accounts on this
   project. The owner area shows a warning while this is still on.
2. **Create the account.** Authentication → Users → Add user → Create new user. Enter the email
   and a password and leave "Auto Confirm User" ticked.
3. **Put the account on the owner list.** In SQL Editor run, with the same email:

       insert into private.owners (user_id)
       select id from auth.users where email = 'owner@example.com';

   It should report one row inserted.

To remove access, delete the user (Authentication → Users); their owner entry goes with it.
To change a password, delete the user and repeat steps 2 and 3.

If the site is served from `<account>.github.io/<repo>`, the owner's sign-in is stored in the
browser under an address shared with that account's other GitHub Pages sites. A custom domain
for this site avoids that.

## Database

`supabase/migrations/` holds the schema, named with the versions recorded in the Supabase
project, so the folder and the project agree. `supabase/tests/` holds pgTAP tests for the
access rules: what a visitor, a signed-in account that is not an owner, and an owner can each
do. New schema changes go in a new migration file; apply it with the Supabase CLI or paste it
into the dashboard's SQL Editor.

| Object | Purpose |
| --- | --- |
| `public.reservations` | Dinner reservation requests |
| `public.photos` | Which uploaded photos appear on the site, in what order, with what description |
| Storage bucket `photos` | The image files (public) |
| `private.owners` | Accounts allowed into the owner area |
| `private.reservation_log` | Recent request times and visitor addresses, for rate limiting |

The Supabase URL and publishable key in `assets/config.js` are meant to be public. With them
the website can add a reservation request and read the photo list, and nothing else; that is
decided by the row level security policies in the migrations, not by keeping the key secret.
Never put a secret (`sb_secret_…`) or `service_role` key in this repository.

## Deploy

`.github/workflows/pages.yml` publishes `index.html`, `reserve.html`, `admin.html` and
`assets/` to GitHub Pages on every push. Pages must be switched on once: Settings → Pages →
Build and deployment → Source: GitHub Actions.

## Not built yet

- **Notifications.** New requests do not email or message anyone. Until that exists, check
  the owner area regularly, or the "we'll email you to confirm" promise on the form is not kept.
- **Bot protection.** The rate limits cap abuse but there is no CAPTCHA; someone with many
  network addresses could still fill the hourly allowance and make real guests wait.
- **Availability.** The form does not know how full dinner is; every request is a request.
