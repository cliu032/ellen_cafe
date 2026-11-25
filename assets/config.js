// Everything specific to the café lives here. Edit this file; the pages update themselves.
// Lines marked CHECK come from public sources and should be confirmed by the café.
window.CAFE = {
  name: "ellen cafe & eatery",
  tagline: "cafe & eatery · alexandria, sydney",
  intro: "A small neighbourhood cafe on Huntley St, near Sydney Park.",
  // The line under the intro: while there are no dinner dates, and once there are.
  walkInNote: "Breakfast and lunch, Tuesday to Sunday. Walk-in only.",
  dinnerNote: "Breakfast and lunch are walk-in only.",
  // Dinner wording lives here, not in the HTML, so a page with no dinner dates carries none of it.
  dinnerLabel: "dinner",
  dinnerMenuTitle: "dinner menu",
  dinnerBy: "By reservation.",
  dinnerCta: "dinner.",
  reserveTitle: "dinner",
  reserveIntro: "Request a table. We reply by email. Breakfast and lunch are walk-in only.",

  instagram: "https://www.instagram.com/ellen_cafe/",
  instagramHandle: "@ellen_cafe",

  email: "ellen18huntley@gmail.com",
  phone: "", // leave empty to hide
  address: ["153/18 Huntley St", "Alexandria NSW 2015"],
  mapUrl: "https://www.google.com/maps/search/?api=1&query=ellen+cafe+18+Huntley+St+Alexandria+NSW+2015",
  timezone: "Australia/Sydney",

  // Set to false to state only the open days ("Tuesday to Sunday") and hide the open-now line
  // until the times below have been confirmed.
  hoursConfirmed: true,

  // Daytime opening hours. Daytime service is walk-in only: these hours are never bookable.
  // 0 = Sunday … 6 = Saturday. Use null for a closed day. 24-hour times.
  // "Tue–Sun" is from the café's Instagram bio. CHECK the times: they come from current
  // third-party listings (Apple Maps and others), not from the café itself.
  hours: {
    0: { open: "08:00", close: "15:00" },
    1: null,
    2: { open: "07:30", close: "14:30" },
    3: { open: "07:30", close: "14:30" },
    4: { open: "07:30", close: "14:30" },
    5: { open: "07:30", close: "14:30" },
    6: { open: "07:30", close: "15:00" },
  },

  // The menus are not in this file: the owner edits them in the owner area (admin.html).

  // Reservation requests, dinner dates, menus and photos live in the Supabase project below.
  // Both values are safe to publish: with them the website can add a reservation request and
  // read the dinner dates, the menus and the photo list, and nothing else.
  supabase: {
    url: "https://qgibakqqtmfbbafclnfo.supabase.co",
    publishableKey: "sb_publishable_P2HPVhGGKjtvWITaQQwDlg_lrpw5EyD",
  },

  // Dinner is served on evenings the owner picks in the owner area (admin.html → dinner).
  // Those dates and their seating times live in Supabase, not here. These are the remaining
  // rules for the reservation form.
  reservation: {
    slotMinutes: 30, // 15 or 30. Owners pick seating times on the half hour; 60 could skip a last seating
    minNoticeMinutes: 60, // on the day, the earliest time offered is this far ahead
    sameDayCloses: null, // or e.g. "15:00": no requests for tonight after this time
    maxParty: 8, // the database accepts up to 20
  },
};
