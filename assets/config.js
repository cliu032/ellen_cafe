// Everything specific to the café lives here. Edit this file; the pages update themselves.
// Values marked SAMPLE are placeholders — replace them with the real details.
window.CAFE = {
  name: "Ellen Cafe",
  tagline: "Coffee, quietly.",
  intro:
    "A small neighbourhood café. Slow mornings, carefully made coffee, and something baked each day.", // SAMPLE
  instagram: "https://www.instagram.com/ellen_cafe",
  instagramHandle: "@ellen_cafe",

  email: "hello@example.com", // SAMPLE — reservation requests are sent here
  phone: "", // SAMPLE — e.g. "+1 555 010 0000"; leave empty to hide
  address: ["Street address", "City, Postcode"], // SAMPLE
  mapUrl: "", // optional Google Maps link

  // 0 = Sunday … 6 = Saturday. Use null for a closed day. SAMPLE hours.
  hours: {
    0: { open: "09:00", close: "17:00" },
    1: null,
    2: { open: "08:00", close: "18:00" },
    3: { open: "08:00", close: "18:00" },
    4: { open: "08:00", close: "18:00" },
    5: { open: "08:00", close: "18:00" },
    6: { open: "09:00", close: "17:00" },
  },

  // SAMPLE menu
  menu: [
    {
      title: "Coffee",
      items: [
        ["Espresso", "3.0"],
        ["Flat white", "4.5"],
        ["Filter, single origin", "5.0"],
        ["Iced latte", "5.0"],
      ],
    },
    {
      title: "Not coffee",
      items: [
        ["Matcha latte", "5.5"],
        ["Hojicha", "5.0"],
        ["Seasonal soda", "4.5"],
      ],
    },
    {
      title: "Bakes",
      items: [
        ["Butter croissant", "4.0"],
        ["Basque cheesecake", "6.5"],
        ["Banana loaf", "4.5"],
      ],
    },
  ],

  reservation: {
    // Optional: a form endpoint that accepts a JSON POST (e.g. Formspree).
    // If empty, the form opens the guest's email app with the request addressed to `email`.
    endpoint: "",
    slotMinutes: 30,
    lastSeatingBeforeCloseMinutes: 60,
    maxParty: 8,
    maxDaysAhead: 60,
  },
};
