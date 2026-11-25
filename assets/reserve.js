// Dinner reservation form. Dinner runs only on evenings the owner has picked, so the page
// lists those dates; with none, it keeps its walk-in message. Guests, date and time are groups
// of radio buttons drawn as tiles: every choice is visible at once, and they work with a
// keyboard and a screen reader like any radio group.
(function () {
  const C = window.CAFE;
  const R = C.reservation;
  const { fmtTime, toMin, fmtDate, shortDate, cafeNow, onDinner } = window.CAFE_UTIL;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const form = $("reserve-form");
  const error = $("error");
  const submitBtn = $("submit");
  const SUBMIT_LABEL = submitBtn.textContent;
  const emailInstead = $("email-instead");
  const SB = C.supabase || {};
  const DRAFT_KEY = "ellen.reserve.draft";
  const FIRST_DATES = 8; // dates shown before "more dates"

  const pad = (n) => String(n).padStart(2, "0");
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const longDate = (s) => fmtDate(s, { weekday: "long", day: "numeric", month: "long" });
  const guestsText = (n) => n + (Number(n) === 1 ? " guest" : " guests");

  // The evenings on offer, as read from Supabase: [{ date, first, last }].
  let dinners = [];
  const dinnerOn = (date) => dinners.find((d) => d.date === date) || null;

  // Times that can still be asked for on a date. On the day itself, only those far enough ahead.
  function slotsFor(date) {
    const d = dinnerOn(date);
    if (!d) return [];
    const now = cafeNow();
    if (date < now.date) return [];
    const earliest = date === now.date ? now.minutes + R.minNoticeMinutes : 0;
    const slots = [];
    for (let m = toMin(d.first); m <= toMin(d.last); m += R.slotMinutes) if (m >= earliest) slots.push(fromMin(m));
    return slots;
  }

  // One radio button drawn as a tile. `small` is an optional line above the main text.
  function tile(name, value, main, small, label) {
    const wrap = el("label", null, "chip");
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
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
  const pick = (name, value) => {
    const input = Array.from(form.querySelectorAll('input[name="' + name + '"]')).find((i) => i.value === value);
    if (input) input.checked = true;
    return Boolean(input);
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
  bigGroups.append(groupMail, ".");

  // ---------------------------------------------------------------- dates and times

  const dateChips = $("date-chips");
  const moreDates = $("more-dates");
  const timeChips = $("time-chips");
  const timeHint = $("time-hint");
  let showAllDates = false;

  function buildDates() {
    const keep = chosen("date");
    const today = cafeNow().date;
    const open = dinners.filter((d) => slotsFor(d.date).length);
    dateChips.textContent = "";
    open.forEach((d, i) => {
      const t = tile(
        "date", d.date,
        fmtDate(d.date, { day: "numeric", month: "short" }),
        d.date === today ? "Tonight" : fmtDate(d.date, { weekday: "short" }),
        (d.date === today ? "Tonight, " : "") + longDate(d.date)
      );
      if (i >= FIRST_DATES && !showAllDates && d.date !== keep) t.hidden = true;
      if (d.date === keep) t.firstChild.checked = true;
      dateChips.append(t);
    });
    moreDates.hidden = !dateChips.querySelector(".chip[hidden]");
  }

  moreDates.addEventListener("click", () => {
    const firstNew = dateChips.querySelector(".chip[hidden] input");
    showAllDates = true;
    dateChips.querySelectorAll(".chip[hidden]").forEach((t) => (t.hidden = false));
    moreDates.hidden = true;
    if (firstNew) firstNew.focus();
  });

  function buildTimes() {
    const date = chosen("date");
    const keep = chosen("time");
    timeChips.textContent = "";
    if (!date) {
      timeHint.textContent = "Select a date.";
      return;
    }
    const slots = slotsFor(date);
    if (!slots.length) {
      timeHint.textContent = "No times left. Select another date.";
      return;
    }
    timeHint.textContent = "";
    slots.forEach((s) => {
      const t = tile("time", s, fmtTime(s));
      if (s === keep) t.firstChild.checked = true;
      timeChips.append(t);
    });
  }

  // ---------------------------------------------------------------- summary and draft

  const summaryLine = $("summary-line");
  function refreshSummary() {
    const date = chosen("date");
    const time = chosen("time");
    summaryLine.textContent = date && time ? guestsText(chosen("party")) + " · " + shortDate(date) + " · " + fmtTime(time) : "";
    summaryLine.hidden = !summaryLine.textContent;
  }

  // What has been filled in is kept for this tab, so a reload or a trip back does not lose it.
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

  const draft = loadDraft();
  pick("party", draft.party) || pick("party", String(Math.min(2, R.maxParty)));
  TEXT_FIELDS.forEach((f) => { if (typeof draft[f] === "string") $(f).value = draft[f]; });
  let draftChoice = { date: draft.date, time: draft.time };

  // ---------------------------------------------------------------- which view

  const closedView = $("closed-view");
  const formView = $("form-view");
  const doneView = $("done-view");
  let done = false;

  // Until the dinner dates are known there is nothing true to show, so show nothing yet.
  closedView.hidden = true;

  onDinner((dates, settled) => {
    dinners = dates;
    if (done) return;
    const any = dinners.some((d) => slotsFor(d.date).length);
    if (!any && !settled) return; // still waiting for the current dates
    closedView.hidden = any;
    formView.hidden = !any;
    if (!any) return;
    buildDates();
    if (draftChoice.date && pick("date", draftChoice.date)) {
      const tileEl = form.querySelector('input[name="date"]:checked').parentElement;
      tileEl.hidden = false;
    }
    buildTimes();
    if (draftChoice.time) pick("time", draftChoice.time);
    draftChoice = {};
    refreshSummary();
  });

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

  // A text field is checked when the visitor leaves it, so a slip is caught while in view.
  const CHECKS = {
    name: (v) => (v ? "" : "Enter your name."),
    email: (v) => (!v ? "Enter your email." : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Check the email address."),
    phone: (v) => (!v || /^[0-9+() .-]{5,30}$/.test(v) ? "" : "Digits only, or leave blank."),
  };
  const clean = (v) => v.trim().replace(/[ \t]+/g, " ");
  function checkField(name) {
    const input = $(name);
    const message = CHECKS[name](clean(input.value));
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
    if (!data.date || !slots.length) {
      flag("date", "Select a date.", dateChips.querySelector(".chip:not([hidden]) input"));
    } else if (!slots.includes(data.time)) {
      flag("time", "Select a time.", timeChips.querySelector("input"));
    }
    ["name", "email", "phone"].forEach((name) => { if (!checkField(name) && !first) first = $(name); });
    const party = Number(data.party);
    if (!first && (!Number.isInteger(party) || party < 1 || party > R.maxParty)) first = partyChips.querySelector("input");
    return first;
  }

  // ---------------------------------------------------------------- sending

  function showDone(data) {
    done = true;
    $("done-text").textContent = "Thank you, " + data.name.split(" ")[0] + ". We'll confirm by email at " + data.email + ".";
    const dl = $("summary");
    dl.textContent = "";
    [["Guests", data.party], ["Date", longDate(data.date)], ["Time", fmtTime(data.time)], ["Name", data.name]].forEach(([k, v]) => {
      const row = el("div");
      row.append(el("dt", k), el("dd", v));
      dl.append(row);
    });
    const next = $("done-next");
    next.textContent = "";
    next.append("To change or cancel, email ");
    const mail = el("a", C.email, "link");
    mail.href = "mailto:" + C.email;
    next.append(mail, ".");
    formView.hidden = true;
    closedView.hidden = true;
    doneView.hidden = false;
    $("done-title").focus();
    window.scrollTo(0, 0);
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing stored */ }
  }

  // The request as an email, for when it cannot be stored.
  function mailtoFor(data) {
    const body = [
      "Dinner reservation request",
      "",
      "Guests: " + data.party,
      "Date: " + longDate(data.date),
      "Time: " + fmtTime(data.time),
      "Name: " + data.name,
      "Email: " + data.email,
      data.phone ? "Phone: " + data.phone : null,
      data.notes ? "Notes: " + data.notes : null,
    ].filter((l) => l !== null).join("\r\n");
    const subject = "Dinner reservation request: " + shortDate(data.date) + ", " + fmtTime(data.time) + ", " + guestsText(data.party);
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
    TEXT_FIELDS.forEach((f) => (data[f] = clean($(f).value)));
    const problem = validate(data);
    if (problem) {
      error.textContent = "Check the details above.";
      problem.focus();
      const group = problem.closest(".group");
      if (group && group.scrollIntoView) group.scrollIntoView({ block: "start", behavior: "auto" });
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "sending…";
    try {
      const status = await saveRequest(data);
      if ((status >= 200 && status < 300) || status === 409) {
        // 409: this exact request (same id) is already stored — an earlier try got through.
        showDone(data);
      } else if (status === 429) {
        fail("Too many requests just now. Try again shortly.", data);
      } else if (status === 400 || status === 401 || status === 403) {
        // The database turned it down: the time has passed, or the date is no longer offered.
        buildDates();
        buildTimes();
        refreshSummary();
        fail("That time is no longer available. Select another.", data);
      } else {
        fail("Couldn't send. Try again.", data);
      }
    } catch (err) {
      fail("Couldn't send. Check your connection and try again.", data);
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = SUBMIT_LABEL;
    }
  });
})();
