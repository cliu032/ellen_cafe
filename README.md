# ellen cafe & eatery

Website for ellen cafe & eatery (153/18 Huntley St, Alexandria NSW). Plain HTML, CSS and
JavaScript with no build step, backed by a Supabase project for reservations, dinner dates,
menus and photos.

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: wordmark, open-now line, photos, the menu (and the dinner menu), address and hours |
| `reserve.html` | Dinner reservations (a walk-in message while no dinner dates are set) |
| `admin.html` | Owner area: answer reservation requests, pick dinner dates, manage the photos, edit the menus |

The look follows the café's logo: cream ground, rust-brown lowercase sans-serif, and the
"caf·elle·atery·n" wordmark as the hero. The font (Inter) is served from `assets/fonts/`, so
the public pages load nothing from other sites except the dinner dates and photos from Supabase.

## How the café works, and what the site does about it

- **Breakfast and lunch are walk-in only.** The daytime opening hours are shown but can never
  be booked.
- **Dinner is by reservation, on evenings the owner picks.** Dinner dates and their seating
  times are set in the owner area and stored in Supabase. While there are none coming up, the
  site takes no reservations and does not mention dinner: the "reserve" links are hidden and
  `reserve.html` says "walk-in only". As soon as a date is added they appear, and the form
  offers exactly the dates and times the owner chose.
- **Two menus, edited by the owner.** "menu" on the home page is the lunch menu (breakfast
  lives in it too) and is always shown. The dinner menu appears below it only while a dinner
  date is listed and the menu has dishes, so the site never shows a dinner menu when no dinner
  is on offer. Both are edited in the owner area and stored in Supabase.
- **The site follows the clock.** The line under the wordmark says whether the café is open
  ("Open until 2:30pm", "Closed · dinner from 5:30pm"). When tonight's last bookable time has
  passed, tonight drops off the form, and the "reserve" links go once no evening is left.
  An open page updates itself every minute.

### Offering dinner

Sign in at `admin.html`, open **dinner**, set the first and last seating, and select dates on
the calendar. Select a date again (or use "remove") to take it off. Each date's times can be
changed in the list below the calendar. Removing a date that already has requests leaves
those requests in **reservations**, so the guests can be told.

The remaining rules for the form are in the `reservation` block of `assets/config.js`:

| Setting | Meaning |
| --- | --- |
| `slotMinutes` | Gap between offered times (30) |
| `minNoticeMinutes` | How far ahead a same-day time must be to be offered (60) |
| `sameDayCloses` | A time such as `"15:00"` after which tonight can no longer be requested; `null` for no cut-off |
| `maxParty` | Largest party the form takes (8); bigger groups are pointed to email |

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. The pages talk to the live Supabase project named in
`assets/config.js`, so a request sent from a local copy is a real request.

## Edit the content

Café details — the short lines of text, address, email, opening hours — live in
`assets/config.js`. Lines marked `CHECK` come from public sources and should be confirmed.
The menus and the photos are not in the code: the owner changes them in the owner area.

- `hoursConfirmed`: while `true` the site states exact opening times and an "open now" line.
  Set it to `false` to show only "Tuesday to Sunday" until the times have been confirmed.
- The address, email and "Tuesday to Sunday" are also written into `index.html` and
  `reserve.html` themselves, so they show even if JavaScript does not run. If any of those
  change, change them in both places.
- The pages load their files as `styles.css?v=8`, `site.js?v=8` and so on. After changing a
  file in `assets/`, raise that number in the three HTML files so returning visitors get the
  new version straight away.
- Link previews (`og:url`, `og:image` in each page's `<head>`) use the full
  `cliu032.github.io/ellen_cafe` address. Change them if the site moves to its own domain.

## Reservations

A guest picks the number of guests, one of the dinner dates and a time, and sends a request.
It is stored in the Supabase table `public.reservations` as `pending`; it is not a booking
until an owner confirms it.

- Only the owner's dinner dates are offered, with times every 30 minutes from the first
  seating to the last. Dates and "tonight" are worked out in the café's timezone, wherever the
  visitor is.
- The database checks every request against those dates and times itself, so nothing can be
  requested for breakfast, lunch, or an evening without dinner, even by going around the site.
- The website can only add a request. It cannot read, change or delete any, so nobody can use
  it to see who has booked.
- The database accepts at most 5 requests an hour (15 a day) from one visitor and 60 an hour
  (300 a day) in total. To count per visitor it keeps the network address of each accepted
  request in `private.reservation_log`; entries older than two days are cleared whenever a new
  request is accepted.
- If a request cannot be stored, the form offers to send it by email instead.
- The guest's browser keeps a half-filled form until the tab closes, and a note of what was
  requested (party, date and time only), so a reload neither loses their typing nor hides
  that they have already asked.

Nothing notifies the café when a request arrives. Someone has to open the owner area to see
it — see "Not built yet" below.

## Owner area

Open `admin.html` and sign in.

- **Reservations**: requests awaiting reply are listed first. Confirm, decline, cancel or
  delete each one. "email guest" opens your own email app with a reply already written — the
  site does not send email itself, so the guest only hears back if you send it.
- **Dinner**: pick the evenings dinner is served and their seating times (see "Offering
  dinner" above).
- **Photos**: add photos (they are scaled down and stripped of location data in your browser
  before upload), describe them, reorder them, delete them. The first 12 appear on the
  landing page. A deleted photo leaves the page at once; its direct address can keep working
  for up to an hour.
- **Menu**: pick **lunch** or **dinner**. The menu is drawn as guests see it; select a dish, a
  heading or the note to change it, use "add item" and "add section", and "up", "down" and
  "remove" inside an open row. Nothing reaches the site until **save**.
  - Changes that are not saved yet are kept in that browser, so a reload, a locked phone or
    signing out does not lose them. They are not on your other devices.
  - If the same menu was saved somewhere else in the meantime, save is held back and you
    choose: "load latest" (drop your changes) or "save mine" (replace the other ones). There
    is no history, so the replaced version cannot be brought back.
  - The dinner menu can be prepared at any time. Guests see it only while a dinner date is
    listed; the dinner tab reminds you of this when you add a date.
  - If the lunch menu is empty, or cannot be loaded by a first-time visitor, the home page
    says "For the menu, see Instagram."

### Giving someone access

Do these in order.

1. **Switch off public sign-up.** In the Supabase dashboard: Authentication → Sign In /
   Providers → turn off "Allow new users to sign up". Only owners should have accounts on this
   project. The owner area shows a warning while this is still on.
2. **Create the account.** Authentication → Users → Add user → Create new user. Enter the email
   and a password and leave "Auto Confirm User" ticked.
3. **Put the account on the owner list.** In SQL Editor run, with the same email:

       insert into private.owners (user_id)
       select id from auth.users where email = lower('owner@example.com')
       returning user_id;

   It should show one row. If it shows none, the email does not match the account.

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
| `public.dinner_services` | The evenings dinner is served, with first and last seating |
| `public.menus` | The lunch and dinner menus, one row each: a note and a list of sections with their dishes |
| `public.photos` | Which uploaded photos appear on the site, in what order, with what description |
| Storage bucket `photos` | The image files (public) |
| `private.owners` | Accounts allowed into the owner area |
| `private.reservation_log` | Recent request times and visitor addresses, for rate limiting |

The Supabase URL and publishable key in `assets/config.js` are meant to be public. With them
the website can add a reservation request and read the dinner dates, the menus and the photo
list, and nothing else; that is decided by the row level security policies in the migrations,
not by keeping the key secret.
Never put a secret (`sb_secret_…`) or `service_role` key in this repository.

## Deploy

`.github/workflows/pages.yml` publishes `index.html`, `reserve.html`, `admin.html` and
`assets/` to GitHub Pages. Pages must be switched on once: Settings → Pages → Build and
deployment → Source: GitHub Actions.

- The site is published on every push to the repository's **default branch**. GitHub Pages
  refuses deployments from any other branch unless it is allowed under Settings →
  Environments → github-pages → Deployment branches.
- The default branch is currently `claude/bold-goodall-qtbk6b`; `main` holds the same commits
  and is built on each push, but not published. To publish from `main` instead: make `main`
  the default branch (Settings → General) and add it to the allowed deployment branches.

## Not built yet

- **Notifications.** New requests do not email or message anyone. Until that exists, check
  the owner area regularly, or the "We reply by email" promise on the form is not kept.
- **Bot protection.** The rate limits cap abuse but there is no CAPTCHA; someone with many
  network addresses could still fill the hourly allowance and make real guests wait.
- **Availability.** The form does not know how full dinner is; every request is a request.
- **Menu history.** A save replaces the menu that was there; earlier versions are not kept.
