// Everything specific to the café lives here. Edit this file; the pages update themselves.
// Lines marked CHECK come from public sources and should be confirmed by the café.
window.CAFE = {
  name: "ellen cafe & eatery",
  tagline: "cafe & eatery · alexandria, sydney",
  intro: "A small neighbourhood cafe and eatery near Sydney Park. Open Tuesday to Sunday.",
  walkInNote: "Walk-ins only for breakfast and lunch. No booking needed.",
  menuNote: "A sample of the menu. Dishes and prices change often, and there are specials most days.", // CHECK
  hoursNote: "",
  reserveIntro: "Dinner is by reservation. Send a request and we'll email you to confirm. Breakfast and lunch stay walk-in only.",

  instagram: "https://www.instagram.com/ellen_cafe/",
  instagramHandle: "@ellen_cafe",

  email: "ellen18huntley@gmail.com",
  phone: "", // leave empty to hide
  address: ["153/18 Huntley St", "Alexandria NSW 2015"],
  mapUrl: "https://www.google.com/maps/search/?api=1&query=ellen+cafe+18+Huntley+St+Alexandria+NSW+2015",
  timezone: "Australia/Sydney",

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

  // Dinner is by reservation. While `hours` below is empty, the website takes no reservations
  // and says nothing about dinner. To start taking them, list the nights dinner is served.
  dinner: {
    // First night of dinner service, "YYYY-MM-DD". Guests can reserve from this date on.
    // Leave empty once dinner is already running.
    from: "",
    // 0 = Sunday … 6 = Saturday, 24-hour times. For example, Thursday to Saturday nights:
    //   4: { open: "17:30", close: "21:30" },
    //   5: { open: "17:30", close: "22:00" },
    //   6: { open: "17:30", close: "22:00" },
    hours: {},
  },

  // Each item: { name, price (optional), desc (optional) }. Leave the list empty to hide the menu.
  // CHECK: taken from customers' photos of the printed menu, which are undated. Replace with
  // the current menu before going live.
  menu: [
    {
      title: "coffee & drinks",
      items: [
        { name: "white, black", price: "5 / 5.5" },
        { name: "filter", price: "6 / 6.5" },
        { name: "honeycomb espresso", price: "9" },
        { name: "tea", price: "6", desc: "breakfast, earl grey, jasmine, oolong" },
        { name: "hot chocolate", price: "5.5" },
        { name: "cold press seasonal juice", price: "8" },
        { name: "grapefruit soda", price: "9" },
      ],
    },
    {
      title: "before 11am",
      items: [
        { name: "black forest bacon & egg roll", price: "13", desc: "bacon XO, bbq sauce, pickle" },
        { name: "scrambled egg & sourdough", price: "18", desc: "tomato, sautéed mushrooms" },
      ],
    },
    {
      title: "brunch",
      items: [
        { name: "fries, seaweed seasoning", price: "7" },
        { name: "poached chicken sandwich", price: "18", desc: "roasted garlic aioli, jalapeño, rocket" },
        { name: "strawberry & pistachio", price: "19", desc: "muesli, greek yoghurt, buckwheat, basil" },
        { name: "fish burger", price: "19", desc: "pickle, mustard, cheddar, horseradish mayo, lettuce" },
        { name: "avocado & soft boiled egg", price: "23", desc: "cashew, crouton, pecorino, salsa verde" },
        { name: "green peas & steam prawn", price: "26", desc: "63c egg, horseradish mayonnaise, sourdough" },
        { name: "prawn pasta", price: "32", desc: "shellfish bisque, grape tomato, prawn oil vinaigrette, tarragon" },
      ],
    },
    {
      title: "after 11am & sweets",
      items: [
        { name: "kransky sausage", price: "25", desc: "sauerkraut, hash brown, yellow mustard, fried egg" },
        { name: "wagyu rump cap steak", price: "47", desc: "pepper purée, turkish chilli, green peppercorn jus" },
        { name: "canelé", price: "7" },
        { name: "custard, grand marnier", price: "9" },
      ],
    },
  ],

  // Reservation requests and photos live in the Supabase project below. Both values are safe
  // to publish: with them the website can add a reservation request and read the photo list,
  // and nothing else. If either is empty, the form opens the guest's email app instead.
  supabase: {
    url: "https://qgibakqqtmfbbafclnfo.supabase.co",
    publishableKey: "sb_publishable_P2HPVhGGKjtvWITaQQwDlg_lrpw5EyD",
  },

  // Rules for dinner reservations.
  reservation: {
    slotMinutes: 30, // 15, 30 or 60 — the database accepts quarter-hour times only
    minNoticeMinutes: 60, // same-day requests need at least this much notice
    lastSeatingBeforeCloseMinutes: 90, // the last bookable time is this long before closing
    maxParty: 8, // the database accepts up to 20
    maxDaysAhead: 60, // the database accepts up to a year ahead
  },
};
