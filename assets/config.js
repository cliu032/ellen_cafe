// Everything specific to the café lives here. Edit this file; the pages update themselves.
// Lines marked CHECK come from public sources and should be confirmed by the café.
window.CAFE = {
  name: "ellen cafe & eatery",
  tagline: "cafe & eatery · alexandria, sydney",
  intro: "A neighbourhood cafe and eatery across the road from Sydney Park. Open Tuesday to Sunday.",
  menuNote: "",
  hoursNote: "",
  reserveIntro:
    "Send a request and we'll reply by email to confirm. Walk-ins are always welcome.",

  instagram: "https://www.instagram.com/ellen_cafe/",
  instagramHandle: "@ellen_cafe",

  email: "ellen18huntley@gmail.com",
  phone: "", // leave empty to hide
  address: ["153/18 Huntley St", "Alexandria NSW 2015"],
  mapUrl: "https://www.google.com/maps/search/?api=1&query=ellen+cafe+18+Huntley+St+Alexandria+NSW+2015",
  timezone: "Australia/Sydney",

  // 0 = Sunday … 6 = Saturday. Use null for a closed day. 24-hour times.
  // Tue–Sun is from the café's Instagram bio; the times are CHECK (2023 review).
  hours: {
    0: { open: "08:00", close: "14:30" },
    1: null,
    2: { open: "07:30", close: "14:30" },
    3: { open: "07:30", close: "14:30" },
    4: { open: "07:30", close: "14:30" },
    5: { open: "07:30", close: "14:30" },
    6: { open: "07:30", close: "14:30" },
  },

  // Each item: { name, price (optional), desc (optional) }
  menu: [],

  // Reservation requests are stored in the Supabase project below (table public.reservations).
  // Both values are safe to publish: the key can only add a request, never read one.
  // If either is empty, the form opens the guest's email app with the request instead.
  supabase: {
    url: "https://qgibakqqtmfbbafclnfo.supabase.co",
    publishableKey: "sb_publishable_P2HPVhGGKjtvWITaQQwDlg_lrpw5EyD",
  },

  reservation: {
    slotMinutes: 30, // 15, 30 or 60 — the database accepts quarter-hour times only
    minNoticeMinutes: 30,
    lastSeatingBeforeCloseMinutes: 60,
    maxParty: 8, // the database accepts up to 20
    maxDaysAhead: 60, // the database accepts up to a year ahead
  },
};
