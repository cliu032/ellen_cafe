(function () {
  const C = window.CAFE;
  const R = C.reservation;
  const { fmtTime, cafeNow } = window.CAFE_UTIL;
  const $ = (id) => document.getElementById(id);
  const form = $("reserve-form");
  const dateEl = $("date");
  const timeEl = $("time");
  const hint = $("date-hint");
  const error = $("error");
  const submitBtn = $("submit");
  const SUBMIT_LABEL = submitBtn.textContent;
  const emailInstead = $("email-instead");
  const SB = C.supabase || {};
  const useDb = Boolean(SB.url && SB.publishableKey);

  // Dates are handled as plain "YYYY-MM-DD" strings in the café's timezone; UTC is only
  // used as a neutral calendar so the visitor's own timezone can never shift the day.
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const asUTC = (s) => new Date(s + "T00:00:00Z");
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(asUTC(s)) && asUTC(s).toISOString().slice(0, 10) === s;
  const addDays = (s, n) => { const d = asUTC(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const prettyDate = (s) =>
    asUTC(s).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

  function bounds() {
    const today = cafeNow().date;
    return { min: today, max: addDays(today, R.maxDaysAhead) };
  }
  const b0 = bounds();
  dateEl.min = b0.min;
  dateEl.max = b0.max;

  for (let i = 1; i <= R.maxParty; i++) {
    $("party").add(new Option(i + (i === 1 ? " guest" : " guests"), i));
  }
  $("party").value = Math.min(2, R.maxParty);

  // null = date outside the bookable window; [] = closed or nothing left that day.
  function slotsFor(dateStr) {
    const { min, max } = bounds();
    if (!isDate(dateStr) || dateStr < min || dateStr > max) return null;
    const h = C.hours[asUTC(dateStr).getUTCDay()];
    if (!h) return [];
    const now = cafeNow();
    const earliest = dateStr === now.date ? now.minutes + R.minNoticeMinutes : 0;
    const last = toMin(h.close) - R.lastSeatingBeforeCloseMinutes;
    const slots = [];
    for (let m = toMin(h.open); m <= last; m += R.slotMinutes) if (m >= earliest) slots.push(fromMin(m));
    return slots;
  }

  function refreshTimes() {
    const previous = timeEl.value;
    const slots = slotsFor(dateEl.value);
    timeEl.length = 0;
    hint.textContent = "";
    if (slots === null) {
      timeEl.add(new Option(dateEl.value ? "Date unavailable" : "Choose a date first", ""));
      timeEl.disabled = true;
      if (dateEl.value) hint.textContent = "Please choose a date from today up to " + R.maxDaysAhead + " days ahead.";
    } else if (!slots.length) {
      timeEl.add(new Option("No times available", ""));
      timeEl.disabled = true;
      hint.textContent = C.hours[asUTC(dateEl.value).getUTCDay()]
        ? "No more tables for today — please pick another day."
        : "We're closed that day — please pick another.";
    } else {
      timeEl.add(new Option("Select a time", ""));
      slots.forEach((s) => timeEl.add(new Option(fmtTime(s), s)));
      timeEl.disabled = false;
      if (slots.includes(previous)) timeEl.value = previous;
    }
  }
  dateEl.addEventListener("change", refreshTimes);
  dateEl.addEventListener("input", refreshTimes);
  refreshTimes();

  form.addEventListener("input", (e) => {
    if (e.target.removeAttribute) e.target.removeAttribute("aria-invalid");
    error.textContent = "";
    emailInstead.hidden = true;
  });

  function validate(data) {
    const slots = slotsFor(data.date);
    if (!data.date) return ["Please choose a date.", dateEl];
    if (!slots || !slots.length) return ["Please choose an available date.", dateEl];
    if (!slots.includes(data.time)) return ["Please choose a time.", timeEl];
    const party = Number(data.party);
    if (!Number.isInteger(party) || party < 1 || party > R.maxParty) return ["Please choose the number of guests.", $("party")];
    if (!data.name) return ["Please enter your name.", $("name")];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return ["Please enter a valid email address.", $("email")];
    if (data.phone && !/^[0-9+() .-]{5,30}$/.test(data.phone)) return ["Please enter a valid phone number, or leave it blank.", $("phone")];
    return null;
  }

  function showDone(data, text) {
    $("done-text").textContent = text;
    const rows = [
      ["Date", prettyDate(data.date)],
      ["Time", fmtTime(data.time)],
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

  // The request as an email, used when the database is not configured or cannot be reached.
  function mailtoFor(data) {
    const guests = data.party + (data.party === "1" ? " guest" : " guests");
    const body = [
      "Reservation request",
      "",
      "Date: " + prettyDate(data.date),
      "Time: " + fmtTime(data.time),
      "Guests: " + data.party,
      "Name: " + data.name,
      "Email: " + data.email,
      data.phone ? "Phone: " + data.phone : null,
      data.notes ? "Notes: " + data.notes : null,
    ].filter((l) => l !== null).join("\r\n");
    const subject = "Reservation request — " + prettyDate(data.date) + " at " + fmtTime(data.time) + ", " + guests;
    return "mailto:" + C.email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  // Each distinct request gets an id made up here. Sending the same request again (a retry
  // after a dropped connection) reuses the id, so the database stores it only once.
  let lastBody = null;
  let lastId = null;
  function requestId(body) {
    if (body !== lastBody) {
      lastBody = body;
      lastId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : null;
    }
    return lastId;
  }

  // Stores the request in Supabase. Resolves to the HTTP status; rejects if the network fails.
  // The publishable key goes in the `apikey` header only — it is not a JWT.
  async function saveRequest(data) {
    const fields = {
      reservation_date: data.date,
      reservation_time: data.time,
      party_size: Number(data.party),
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      notes: data.notes || null,
    };
    const id = requestId(JSON.stringify(fields));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(SB.url.replace(/\/+$/, "") + "/rest/v1/reservations", {
        method: "POST",
        headers: { apikey: SB.publishableKey, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(id ? Object.assign({ id }, fields) : fields),
        signal: ctrl.signal,
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  }

  function fail(message, data) {
    error.textContent = message;
    emailInstead.href = mailtoFor(data);
    emailInstead.hidden = false;
  }

  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    error.textContent = "";
    emailInstead.hidden = true;
    const data = {};
    new FormData(form).forEach((v, k) => (data[k] = String(v).trim().replace(/[ \t]+/g, " ")));
    const problem = validate(data);
    if (problem) {
      error.textContent = problem[0];
      problem[1].setAttribute("aria-invalid", "true");
      problem[1].focus();
      return;
    }

    if (!useDb) {
      window.location.href = mailtoFor(data);
      showDone(
        data,
        "Your email app should have opened with the request — press send to complete it. It isn't confirmed until we reply. If nothing opened, email " + C.email + " with the details below."
      );
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "sending…";
    try {
      const status = await saveRequest(data);
      if ((status >= 200 && status < 300) || status === 409) {
        // 409: this exact request (same id) is already stored — an earlier try got through.
        showDone(data, "Your request is with us. It isn't confirmed yet — we'll reply to " + data.email + " to confirm.");
      } else if (status === 429) {
        fail("We're getting a lot of requests right now. Please try again later.", data);
      } else if (status === 400 || status === 401 || status === 403) {
        // The database turned the details down, e.g. the time has just passed.
        refreshTimes();
        fail("We couldn't take that request. Please check the date, time and your details, then try again.", data);
      } else {
        fail("Sorry, that didn't send. Please try again.", data);
      }
    } catch (err) {
      fail("Sorry, that didn't send. Please check your connection and try again.", data);
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = SUBMIT_LABEL;
    }
  });
})();
