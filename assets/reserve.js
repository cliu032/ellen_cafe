(function () {
  const C = window.CAFE;
  const R = C.reservation;
  const $ = (id) => document.getElementById(id);
  const form = $("reserve-form");
  const dateEl = $("date");
  const timeEl = $("time");
  const hint = $("date-hint");
  const error = $("error");

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const prettyDate = (s) =>
    parseDate(s).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const now = new Date();
  const max = new Date(now);
  max.setDate(max.getDate() + R.maxDaysAhead);
  dateEl.min = iso(now);
  dateEl.max = iso(max);

  for (let i = 1; i <= R.maxParty; i++) {
    $("party").add(new Option(i + (i === 1 ? " guest" : " guests"), i));
  }
  $("party").value = 2;

  function slotsFor(dateStr) {
    if (!dateStr || dateStr < dateEl.min || dateStr > dateEl.max) return null;
    const h = C.hours[parseDate(dateStr).getDay()];
    if (!h) return [];
    const slots = [];
    const last = toMin(h.close) - R.lastSeatingBeforeCloseMinutes;
    const current = new Date();
    const earliest = dateStr === iso(current) ? current.getHours() * 60 + current.getMinutes() + 30 : 0;
    for (let m = toMin(h.open); m <= last; m += R.slotMinutes) if (m >= earliest) slots.push(fromMin(m));
    return slots;
  }

  function refreshTimes() {
    const slots = slotsFor(dateEl.value);
    timeEl.length = 0;
    hint.textContent = "";
    if (slots === null) {
      timeEl.add(new Option(dateEl.value ? "Date unavailable" : "Choose a date first", ""));
      timeEl.disabled = true;
      if (dateEl.value) hint.textContent = "Please choose a date within the next " + R.maxDaysAhead + " days.";
    } else if (!slots.length) {
      timeEl.add(new Option("No times available", ""));
      timeEl.disabled = true;
      hint.textContent = C.hours[parseDate(dateEl.value).getDay()]
        ? "No more tables for today — please pick another day."
        : "We're closed that day — please pick another.";
    } else {
      timeEl.add(new Option("Select a time", ""));
      slots.forEach((s) => timeEl.add(new Option(s, s)));
      timeEl.disabled = false;
    }
  }
  dateEl.addEventListener("change", refreshTimes);

  function validate(data) {
    const slots = slotsFor(data.date);
    if (!slots || !slots.length) return ["Please choose an available date.", dateEl];
    if (!slots.includes(data.time)) return ["Please choose a time.", timeEl];
    if (!data.name) return ["Please enter your name.", $("name")];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return ["Please enter a valid email address.", $("email")];
    return null;
  }

  function showDone(data, text) {
    $("done-text").textContent = text;
    const rows = [
      ["Date", prettyDate(data.date)],
      ["Time", data.time],
      ["Guests", data.party],
      ["Name", data.name],
    ];
    const dl = $("summary");
    dl.textContent = "";
    rows.forEach(([k, v]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      row.append(dt, dd);
      dl.append(row);
    });
    $("form-view").hidden = true;
    $("done-view").hidden = false;
    $("done-title").focus();
    window.scrollTo(0, 0);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const data = Object.fromEntries(new FormData(form));
    Object.keys(data).forEach((k) => (data[k] = String(data[k]).trim()));
    const problem = validate(data);
    if (problem) {
      error.textContent = problem[0];
      problem[1].focus();
      return;
    }

    if (R.endpoint) {
      const btn = $("submit");
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const res = await fetch(R.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(res.status);
        showDone(data, "Your request is with us. We'll confirm by email at " + data.email + " shortly.");
      } catch (err) {
        error.textContent = "Sorry, that didn't send. Please try again or email " + C.email + ".";
      } finally {
        btn.disabled = false;
        btn.textContent = "Request reservation";
      }
      return;
    }

    // No endpoint configured: hand the request to the guest's email app.
    const body = [
      "Reservation request",
      "",
      "Date: " + prettyDate(data.date),
      "Time: " + data.time,
      "Guests: " + data.party,
      "Name: " + data.name,
      "Email: " + data.email,
      data.phone && "Phone: " + data.phone,
      data.notes && "Notes: " + data.notes,
    ].filter((l) => typeof l === "string").join("\n");
    const subject = "Reservation — " + data.date + " " + data.time + ", " + data.party + " guests";
    window.location.href =
      "mailto:" + C.email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    showDone(
      data,
      "Your email app should have opened with the request — press send to complete it. We'll reply to confirm. If nothing opened, email " + C.email + "."
    );
  });
})();
