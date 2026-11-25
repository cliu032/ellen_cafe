// Dinner reservation form. Daytime service is walk-in only, so the form only exists once
// dinner nights are set in assets/config.js; until then the page keeps its walk-in message.
// Guests, date and time are groups of radio buttons drawn as tiles, so the choices (and which
// nights have no dinner) are visible without opening a picker, and they work with a keyboard
// and a screen reader like any radio group.
(function () {
  const C = window.CAFE;
  const R = C.reservation;
  const { fmtTime, toMin, asUTC, addDays, cafeNow, takesBookings, dinnerFrom, dinnerOn } = window.CAFE_UTIL;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  if (!takesBookings) return; // nothing to reserve yet
  $("closed-view").hidden = true;
  $("form-view").hidden = false;

  const form = $("reserve-form");
  const error = $("error");
  const submitBtn = $("submit");
  const SUBMIT_LABEL = submitBtn.textContent;
  const emailInstead = $("email-instead");
  const SB = C.supabase || {};
  const useDb = Boolean(SB.url && SB.publishableKey);
  const DRAFT_KEY = "ellen.reserve.draft";

  const pad = (n) => String(n).padStart(2, "0");
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(asUTC(s)) && asUTC(s).toISOString().slice(0, 10) === s;
  const fmtDate = (s, opts) => asUTC(s).toLocaleDateString("en-AU", Object.assign({ timeZone: "UTC" }, opts));
  const prettyDate = (s) => fmtDate(s, { weekday: "long", day: "numeric", month: "long" });
  const guestsText = (n) => n + (Number(n) === 1 ? " guest" : " guests");

  // The bookable window: from today, or from the first night of dinner if that is still ahead.
  function bounds() {
    const today = cafeNow().date;
    const min = dinnerFrom && dinnerFrom > today ? dinnerFrom : today;
    return { min, max: addDays(min, R.maxDaysAhead) };
  }

  // null = date outside the bookable window; [] = no dinner that night, or nothing left today.
  function slotsFor(dateStr) {
    const { min, max } = bounds();
    if (!isDate(dateStr) || dateStr < min || dateStr > max) return null;
    const h = dinnerOn(dateStr);
    if (!h) return [];
    const now = cafeNow();
    const earliest = dateStr === now.date ? now.minutes + R.minNoticeMinutes : 0;
    const last = toMin(h.close) - R.lastSeatingBeforeCloseMinutes;
    const slots = [];
    for (let m = toMin(h.open); m <= last; m += R.slotMinutes) if (m >= earliest) slots.push(fromMin(m));
    return slots;
  }

  // One radio button drawn as a tile. `main` is the big text, `small` an optional line above it.
  function tile(name, value, main, small, label, disabled) {
    const wrap = el("label", null, "chip");
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.disabled = Boolean(disabled);
    if (label) input.setAttribute("aria-label", label);
    const face = el("span");
    if (small) face.append(el("small", small));
    face.append(el("b", main));
    wrap.append(input, face);
    return wrap;
  }
  const chosen = (name) => {
    const input = form.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : "";
  };

  // ---------------------------------------------------------------- guests

  const partyChips = $("party-chips");
  for (let i = 1; i <= R.maxParty; i++) {
    partyChips.append(tile("party", String(i), String(i), null, guestsText(i)));
  }
  const bigGroups = $("party-hint");
  bigGroups.append("More than " + R.maxParty + "? ");
  const groupMail = el("a", "Email us", "link");
  groupMail.href = "mailto:" + C.email + "?subject=" + encodeURIComponent("Dinner for a larger group");
  bigGroups.append(groupMail, " and we'll work it out.");

  // ---------------------------------------------------------------- dates

  const cal = $("cal");
  const moreDates = $("more-dates");
  const FIRST_ROWS = 3; // weeks shown before "show later dates"

  function buildCalendar() {
    const { min, max } = bounds();
    const today = cafeNow().date;
    const keep = chosen("date");
    cal.textContent = "";
    // Weeks run Monday to Sunday; pad the first week so today sits under its weekday.
    const lead = (asUTC(min).getUTCDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cal.append(el("span", null, "blank"));
    let cell = lead;
    let lastMonth = null;
    for (let d = min; d <= max; d = addDays(d, 1)) {
      const slots = slotsFor(d);
      const month = fmtDate(d, { month: "short" });
      const showMonth = month !== lastMonth;
      lastMonth = month;
      let label = prettyDate(d);
      if (d === today) label = "Today, " + label;
      if (!dinnerOn(d)) label += ", no dinner";
      else if (!slots.length) label += ", no times left";
      const t = tile("date", d, String(asUTC(d).getUTCDate()), d === today ? "today" : showMonth ? month : null, label, !slots || !slots.length);
      if (Math.floor(cell / 7) >= FIRST_ROWS) t.classList.add("later");
      if (d === keep && slots && slots.length) t.firstChild.checked = true;
      cal.append(t);
      cell++;
    }
    moreDates.hidden = cal.classList.contains("all") || !cal.querySelector(".later");
  }

  moreDates.addEventListener("click", () => {
    const firstNew = cal.querySelector(".later input:not(:disabled)");
    cal.classList.add("all");
    moreDates.hidden = true;
    if (firstNew) firstNew.focus();
  });

  // ---------------------------------------------------------------- times

  const timeChips = $("time-chips");
  const timeHint = $("time-hint");

  function buildTimes() {
    const date = chosen("date");
    const keep = chosen("time");
    timeChips.textContent = "";
    if (!date) {
      timeHint.textContent = "Pick a date to see times.";
      return;
    }
    const slots = slotsFor(date) || [];
    if (!slots.length) {
      timeHint.textContent = "No times left that night. Please pick another.";
      return;
    }
    timeHint.textContent = "";
    slots.forEach((s) => {
      const t = tile("time", s, fmtTime(s), null, null, false);
      if (s === keep) t.firstChild.checked = true;
      timeChips.append(t);
    });
  }

  // ---------------------------------------------------------------- summary and draft

  const summaryLine = $("summary-line");
  function refreshSummary() {
    const date = chosen("date");
    const time = chosen("time");
    summaryLine.textContent =
      date && time
        ? "Dinner for " + chosen("party") + " · " + prettyDate(date) + " · " + fmtTime(time)
        : "";
    summaryLine.hidden = !summaryLine.textContent;
  }

  const TEXT_FIELDS = ["name", "email", "phone", "notes"];
  function saveDraft() {
    try {
      const draft = { party: chosen("party"), date: chosen("date"), time: chosen("time") };
      TEXT_FIELDS.forEach((f) => (draft[f] = $(f).value));
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) { /* private browsing: nothing to keep */ }
  }
  function loadDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  const pick = (name, value) => {
    const input = Array.from(form.querySelectorAll('input[name="' + name + '"]')).find((i) => i.value === value && !i.disabled);
    if (input) input.checked = true;
    return Boolean(input);
  };

  // ---------------------------------------------------------------- start-up

  const draft = loadDraft();
  pick("party", draft.party) || pick("party", String(Math.min(2, R.maxParty)));
  buildCalendar();
  if (draft.date && pick("date", draft.date)) {
    const input = form.querySelector('input[name="date"]:checked');
    if (input.parentElement.classList.contains("later")) { cal.classList.add("all"); moreDates.hidden = true; }
  }
  buildTimes();
  if (draft.time) pick("time", draft.time);
  TEXT_FIELDS.forEach((f) => { if (typeof draft[f] === "string") $(f).value = draft[f]; });
  refreshSummary();

  $("fine-print").textContent =
    "This is a request, not a booking — it's confirmed once we email you back. We only use your details to arrange your table.";

  // ---------------------------------------------------------------- reacting to input

  const FIELD_ERRORS = { date: "date-error", time: "time-error", name: "name-error", email: "email-error", phone: "phone-error" };
  function clearError(name) {
    const box = $(FIELD_ERRORS[name]);
    if (box) box.textContent = "";
    const input = $(name);
    if (input) input.removeAttribute("aria-invalid");
  }

  form.addEventListener("change", (e) => {
    const name = e.target.name;
    if (name === "date") {
      buildTimes();
      clearError("date");
      if (!chosen("time")) clearError("time");
    }
    if (name === "time") clearError("time");
    refreshSummary();
    saveDraft();
  });
  form.addEventListener("input", (e) => {
    if (e.target.id) clearError(e.target.id);
    error.textContent = "";
    emailInstead.hidden = true;
    if (TEXT_FIELDS.includes(e.target.id)) saveDraft();
  });

  // Check one text field when the visitor leaves it, so a slip is caught while it is in view.
  const CHECKS = {
    name: (v) => (v ? "" : "Please tell us your name."),
    email: (v) =>
      !v ? "Please enter your email so we can confirm."
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "That email doesn't look right. Please check it.",
    phone: (v) => (!v || /^[0-9+() .-]{5,30}$/.test(v) ? "" : "Please use digits only, or leave this blank."),
  };
  function checkField(name) {
    const input = $(name);
    const message = CHECKS[name](input.value.trim().replace(/[ \t]+/g, " "));
    $(FIELD_ERRORS[name]).textContent = message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !message;
  }
  Object.keys(CHECKS).forEach((name) => {
    $(name).addEventListener("blur", () => { if ($(name).value.trim()) checkField(name); });
  });

  // Returns the first control that needs attention, or null when everything is in order.
  function validate(data) {
    let first = null;
    const flag = (name, message, focusEl) => {
      $(FIELD_ERRORS[name]).textContent = message;
      if (!first) first = focusEl;
    };
    const slots = slotsFor(data.date);
    if (!data.date || !slots || !slots.length) {
      flag("date", "Please pick a date.", cal.querySelector("input:not(:disabled)"));
    } else if (!slots.includes(data.time)) {
      flag("time", "Please pick a time.", timeChips.querySelector("input"));
    }
    ["name", "email", "phone"].forEach((name) => { if (!checkField(name) && !first) first = $(name); });
    const party = Number(data.party);
    if (!first && (!Number.isInteger(party) || party < 1 || party > R.maxParty)) first = partyChips.querySelector("input");
    return first;
  }

  // ---------------------------------------------------------------- sending

  function showDone(data, viaEmail) {
    const first = data.name.split(" ")[0];
    $("done-title").textContent = viaEmail ? "almost there" : "request sent";
    $("done-text").textContent = viaEmail
      ? "Your email app should have opened with your request. Press send there to finish — nothing has reached us yet."
      : "Thanks, " + first + ". Your request is with us. It isn't a booking yet: we'll email " + data.email + " to confirm.";
    const rows = [
      ["Guests", data.party],
      ["Date", prettyDate(data.date)],
      ["Time", fmtTime(data.time)],
      ["Name", data.name],
    ];
    const dl = $("summary");
    dl.textContent = "";
    rows.forEach(([k, v]) => {
      const row = el("div");
      row.append(el("dt", k), el("dd", v));
      dl.append(row);
    });
    const next = $("done-next");
    next.textContent = "";
    next.append(viaEmail ? "If nothing opened, write to " : "Need to change or cancel? Write to ");
    const mail = el("a", C.email, "link");
    mail.href = "mailto:" + C.email;
    next.append(mail, viaEmail ? " with the details above." : ".");
    $("form-view").hidden = true;
    $("done-view").hidden = false;
    $("done-title").focus();
    window.scrollTo(0, 0);
    if (!viaEmail) {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing stored */ }
    }
  }

  // The request as an email, used when the database is not configured or cannot be reached.
  function mailtoFor(data) {
    const body = [
      "Dinner reservation request",
      "",
      "Guests: " + data.party,
      "Date: " + prettyDate(data.date),
      "Time: " + fmtTime(data.time),
      "Name: " + data.name,
      "Email: " + data.email,
      data.phone ? "Phone: " + data.phone : null,
      data.notes ? "Notes: " + data.notes : null,
    ].filter((l) => l !== null).join("\r\n");
    const subject = "Dinner reservation request — " + prettyDate(data.date) + ", " + fmtTime(data.time) + ", " + guestsText(data.party);
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
    const data = { party: chosen("party"), date: chosen("date"), time: chosen("time") };
    TEXT_FIELDS.forEach((f) => (data[f] = $(f).value.trim().replace(/[ \t]+/g, " ")));
    const problem = validate(data);
    if (problem) {
      error.textContent = "Please check the highlighted details above.";
      problem.focus();
      const group = problem.closest(".group");
      if (group && group.scrollIntoView) group.scrollIntoView({ block: "start", behavior: "auto" });
      return;
    }

    if (!useDb) {
      window.location.href = mailtoFor(data);
      showDone(data, true);
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "sending…";
    try {
      const status = await saveRequest(data);
      if ((status >= 200 && status < 300) || status === 409) {
        // 409: this exact request (same id) is already stored — an earlier try got through.
        showDone(data, false);
      } else if (status === 429) {
        fail("We're getting a lot of requests right now. Please try again in a little while.", data);
      } else if (status === 400 || status === 401 || status === 403) {
        // The database turned the details down, e.g. the time has just passed.
        buildCalendar();
        buildTimes();
        refreshSummary();
        fail("We couldn't take that request. Please check the date and time, then try again.", data);
      } else {
        fail("Sorry, that didn't send. Please try again.", data);
      }
    } catch (err) {
      fail("Sorry, that didn't send. Check your connection and try again.", data);
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = SUBMIT_LABEL;
    }
  });
})();
