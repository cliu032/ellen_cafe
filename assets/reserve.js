// Dinner reservations. Dinner runs only on evenings the owner has picked, so this page offers
// exactly those dates; with none it says "walk-in only". Guests, date and time are groups of
// radio buttons drawn as tiles: every choice is visible at once, and they work with a keyboard
// and a screen reader like any radio group.
(function () {
  const C = window.CAFE;
  const R = C.reservation;
  const { fmtTime, fmtDate, shortDate, cafeNow, onDinner, refreshDinner, slots, dinnerNow } = window.CAFE_UTIL;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const form = $("reserve-form");
  const error = $("error");
  const errorEnd = $("error-end");
  const errorBox = error.parentElement;
  const afterEmail = $("after-email");
  const submitBtn = $("submit");
  const SUBMIT_LABEL = submitBtn.textContent;
  const emailInstead = $("email-instead");
  const formStatus = $("form-status");
  const SB = C.supabase || {};
  const DRAFT_KEY = "ellen.reserve.draft";
  const RECORD_KEY = "ellen.requests";
  const FIRST_DATES = 8; // dates shown before "more dates"

  const longDate = (s) => fmtDate(s, { weekday: "long", day: "numeric", month: "long" });
  const guestsText = (n) => n + (Number(n) === 1 ? " guest" : " guests");
  const TONIGHT_NOTE = "For tonight, wait for our email before you come.";

  // ---------------------------------------------------------------- which view

  // loading → one of: closed (walk-in only) · failed (couldn't find out) · tonight (dinner
  // tonight, too late to ask) · form → done.
  const TITLES = {
    loading: C.name,
    failed: C.name,
    closed: "Walk-in only — " + C.name,
    tonight: "Reservations — " + C.name,
    form: "Reservations — " + C.name,
    done: "Request sent — " + C.name,
  };
  let view = "loading";
  function show(next) {
    const previous = view;
    view = next;
    Object.keys(TITLES).forEach((v) => ($(v + "-view").hidden = v !== next));
    $("closed-view").classList.toggle("on", next === "closed"); // see the note in styles.css
    document.title = TITLES[next];
    if (next === "form" || next === "done") unsent("");
    // When a view replaces the form under someone, or reports a failure, take them to it.
    if (next !== previous && (previous === "form" || next === "failed")) {
      const heading = $(next + "-view").querySelector("h1");
      if (heading) heading.focus();
    }
  }
  // Said in the view that takes over when a request could not go: without it the guest cannot
  // tell whether they asked for a table.
  function unsent(message) {
    document.querySelectorAll("[data-unsent]").forEach((p) => {
      p.textContent = message;
      p.hidden = !message;
    });
  }
  const UNSENT = "Your request was not sent. That date is no longer offered.";
  setTimeout(() => {
    if (view === "loading") $("loading-text").textContent = "Loading…";
  }, 500);
  $("try-again").addEventListener("click", () => window.location.reload());
  document.querySelectorAll("[data-mail]").forEach((a) => {
    a.href = "mailto:" + C.email;
    a.textContent = C.email;
  });

  // ---------------------------------------------------------------- tiles

  // One radio button drawn as a tile. The input carries the spoken name, which always starts
  // with the words on the tile; the drawn face is hidden from screen readers, so each choice
  // is read once.
  function tile(name, value, main, small, label) {
    const wrap = el("label", null, "chip");
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    // The tiles come and go with the clock. A browser that restores form state after Back
    // would re-tick them by position, not by value; the saved draft restores them instead.
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-label", label || main);
    const face = el("span");
    face.setAttribute("aria-hidden", "true");
    if (small) face.append(el("small", small));
    face.append(el("b", main));
    wrap.append(input, face);
    return wrap;
  }
  const inputs = (name) => Array.from(form.querySelectorAll('input[name="' + name + '"]'));
  const chosen = (name) => {
    const input = form.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : "";
  };
  const pick = (name, value) => {
    const input = inputs(name).find((i) => i.value === value);
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
  let dinners = []; // every evening from today on: [{ date, first, last }]
  let openDates = []; // those that can still be requested
  let showAllDates = false;
  const rowFor = (date) => dinners.find((d) => d.date === date) || null;
  const slotsFor = (date) => slots(rowFor(date));
  // Tonight is still a dinner night, but it is too late to ask for it.
  const tonightClosed = () => {
    const tonight = dinnerNow(dinners).tonight;
    return Boolean(tonight && !slots(tonight).length);
  };
  // Everything the tiles and their notes are drawn from. While it is unchanged the form is left alone.
  const signature = () => JSON.stringify([cafeNow().date, tonightClosed(), openDates.map((d) => [d.date, slots(d)])]);

  function buildDates() {
    const keep = chosen("date");
    const today = cafeNow().date;
    dateChips.textContent = "";
    openDates.forEach((d, i) => {
      const dayMonth = fmtDate(d.date, { day: "numeric", month: "short" });
      const over = d.date === today ? "Tonight" : fmtDate(d.date, { weekday: "short" });
      // Spoken as "Sat 28 Nov, Saturday": what is on the tile, then the day in full.
      const t = tile("date", d.date, dayMonth, over, over + " " + dayMonth + ", " + fmtDate(d.date, { weekday: "long" }));
      if (i >= FIRST_DATES && !showAllDates && d.date !== keep) t.hidden = true;
      if (d.date === keep) t.firstChild.checked = true;
      dateChips.append(t);
    });
    syncMoreDates();
    $("date-hint").textContent = tonightClosed() ? "Tonight's reservations have closed." : "";
  }
  const syncMoreDates = () => (moreDates.hidden = !dateChips.querySelector(".chip[hidden]"));
  function reveal(date) {
    const input = inputs("date").find((i) => i.value === date);
    if (input) input.parentElement.hidden = false;
    syncMoreDates();
  }
  moreDates.addEventListener("click", () => {
    const firstNew = dateChips.querySelector(".chip[hidden] input");
    showAllDates = true;
    dateChips.querySelectorAll(".chip[hidden]").forEach((t) => (t.hidden = false));
    syncMoreDates();
    if (firstNew) firstNew.focus();
  });

  // `dropped` is a time the guest had chosen that the newly chosen date does not offer.
  function buildTimes(dropped) {
    const date = chosen("date");
    const keep = chosen("time");
    timeChips.textContent = "";
    formStatus.textContent = "";
    if (!date) {
      timeHint.textContent = "Select a date first.";
      return;
    }
    const list = slotsFor(date);
    if (!list.length) {
      timeHint.textContent = "No times left. Select another date.";
      return;
    }
    list.forEach((s) => {
      const t = tile("time", s, fmtTime(s));
      if (s === keep) t.firstChild.checked = true;
      timeChips.append(t);
    });
    const tonight = date === cafeNow().date;
    timeHint.textContent = !dropped || list.includes(dropped)
      ? tonight ? TONIGHT_NOTE : ""
      : tonight && dropped < list[0]
        ? "That time has passed. Select another."
        : fmtTime(dropped) + " isn't offered " + (tonight ? "tonight" : "on " + shortDate(date)) + ". Select a time.";
    formStatus.textContent = list.length + (list.length === 1 ? " time for " : " times for ") + shortDate(date) + ".";
  }

  // ---------------------------------------------------------------- summary, draft, record

  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const clean = (v) => v.trim().replace(/[ \t]+/g, " ");
  const summaryLine = $("summary-line");
  const replyTo = $("reply-to");
  function refreshSummary() {
    const date = chosen("date");
    const time = chosen("time");
    summaryLine.textContent = date && time ? guestsText(chosen("party")) + " · " + shortDate(date) + " · " + fmtTime(time) : "";
    summaryLine.hidden = !summaryLine.textContent;
    // The reply goes to one address: show it again where it will be read before sending.
    const email = clean($("email").value);
    replyTo.textContent = EMAIL_OK.test(email) ? "Reply to " + email : "";
    replyTo.hidden = !replyTo.textContent;
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

  // A short note of requests already sent from this browser — guests, date and time only, no
  // name or contact details — so a guest who comes back can see they have already asked.
  function sentRequests() {
    try {
      const list = JSON.parse(localStorage.getItem(RECORD_KEY));
      return Array.isArray(list) ? list.filter((r) => r && r.date && r.time && r.party) : [];
    } catch (e) {
      return [];
    }
  }
  function noteRequest(data) {
    try {
      const list = [{ party: data.party, date: data.date, time: data.time }].concat(sentRequests()).slice(0, 5);
      localStorage.setItem(RECORD_KEY, JSON.stringify(list));
    } catch (e) { /* nothing to keep */ }
  }
  function showRecord() {
    const listed = dinnerNow(dinners).listed;
    const still = sentRequests().filter((r) => listed.some((d) => d.date === r.date));
    const text = still.length
      ? "Already requested: " + still.map((r) => guestsText(r.party) + " · " + shortDate(r.date) + " · " + fmtTime(r.time)).join("; ") + ". We reply by email."
      : "";
    document.querySelectorAll("[data-record]").forEach((p) => {
      p.textContent = text;
      p.hidden = !text;
    });
  }

  // ---------------------------------------------------------------- the dates arrive

  let done = false;
  let started = false; // the form has been drawn once
  let lastSignature = null;

  // A link from the home page names its date in the address (reserve.html#2026-11-28). It is
  // used once, on arrival, and then taken out of the address: left there it would undo the
  // guest's own later choice every time the page reloaded.
  let linkDate = /^#\d{4}-\d{2}-\d{2}$/.test(window.location.hash) ? window.location.hash.slice(1) : "";
  let choseDate = false; // the guest has picked a date themselves
  function forgetLink() {
    linkDate = "";
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (e) { /* the address keeps its fragment; nothing reads it again */ }
  }
  // With nothing left to request: the walk-in page, unless tonight is still a dinner night.
  const restView = () => (dinnerNow(dinners).listed.length ? "tonight" : "closed");

  onDinner((dates, settled, failed) => {
    if (done) return;
    dinners = dates;
    openDates = dates.filter((d) => slots(d).length);
    showRecord();
    if (!openDates.length) {
      lastSignature = null;
      if (restView() === "tonight") show("tonight"); // dinner tonight, but too late to ask
      else if (settled && failed) show("failed"); // could not find out: not the same as "no dates"
      else show("closed"); // no dinner dates: walk-in only
      return;
    }

    // The linked date is not among the current dates: there is nothing to apply.
    if (linkDate && settled && !openDates.some((d) => d.date === linkDate)) forgetLink();

    // Nothing has changed since the form was last drawn: leave it, and the guest's focus, alone.
    const sig = signature();
    if (view === "form" && sig === lastSignature) return;
    lastSignature = sig;

    const active = document.activeElement;
    const held = active && form.contains(active) && (active.name === "date" || active.name === "time")
      ? { name: active.name, value: active.value } : null;
    const hadDate = chosen("date");
    const hadTime = chosen("time");
    show("form");
    buildDates();

    // The linked date wins over a saved draft. If the dates first shown were remembered ones
    // that lack it, it is tried again when the current dates arrive.
    let viaLink = false;
    if (linkDate && !choseDate) {
      viaLink = pick("date", linkDate);
      if (viaLink || settled) forgetLink();
    }

    if (!started) {
      started = true;
      if (!viaLink && !pick("date", draft.date) && openDates.length === 1) pick("date", openDates[0].date);
      reveal(chosen("date"));
      buildTimes();
      if (draft.time && chosen("date") === draft.date) pick("time", draft.time);
      if (chosen("time") && chosen("date") === cafeNow().date) timeHint.textContent = TONIGHT_NOTE;
      if (viaLink) saveDraft();
    } else {
      if (viaLink) {
        reveal(linkDate || chosen("date"));
        clearError("date");
      } else if (hadDate && !chosen("date")) {
        $("date-error").textContent = "That date is no longer offered.";
      }
      buildTimes(hadTime);
      if (viaLink) saveDraft();
      if (held) {
        const group = inputs(held.name).filter((i) => !i.parentElement.hidden);
        const again = group.find((i) => i.value === held.value) || group[0] || inputs("date").find((i) => !i.parentElement.hidden);
        if (again) again.focus();
      }
    }
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
  function clearSendError() {
    error.textContent = "";
    errorEnd.textContent = "";
    emailInstead.hidden = true;
    errorBox.hidden = false;
    afterEmail.hidden = true;
  }

  form.addEventListener("change", (e) => {
    const name = e.target.name;
    if (name === "date") {
      choseDate = true;
      const had = chosen("time");
      buildTimes(had);
      clearError("date");
      if (!chosen("time")) clearError("time");
    }
    if (name === "time") {
      clearError("time");
      timeHint.textContent = chosen("date") === cafeNow().date ? TONIGHT_NOTE : "";
    }
    refreshSummary();
    saveDraft();
  });
  form.addEventListener("input", (e) => {
    if (e.target.id) clearError(e.target.id);
    if (e.target.id === "email") {
      clearSuggestion();
      refreshSummary();
    }
    clearSendError();
    if (TEXT_FIELDS.includes(e.target.id)) saveDraft();
  });

  // Enter chooses a tile or moves to the next field. Only the button sends the request.
  const NEXT_FIELD = { name: "email", email: "phone", phone: "notes" };
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const t = e.target;
    if (t.type === "radio") {
      e.preventDefault();
      if (!t.checked) {
        t.checked = true;
        t.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (NEXT_FIELD[t.id]) {
      e.preventDefault();
      $(NEXT_FIELD[t.id]).focus();
    }
  });
  // Pressing the button must not first move focus off a field: its check on leaving could
  // shift the button from under the tap, and the tap would be lost.
  submitBtn.addEventListener("mousedown", (e) => e.preventDefault());

  // ---------------------------------------------------------------- checking the details

  const CHECKS = {
    name: (v) => (v ? "" : "Enter your name."),
    email: (v) => (!v ? "Enter your email." : EMAIL_OK.test(v) ? "" : "Check the email address."),
    phone: (v) => (!v || (/^[0-9+() .-]{5,30}$/.test(v) && v.replace(/\D/g, "").length >= 8) ? "" : "Check the phone number."),
  };
  function checkField(name) {
    const input = $(name);
    const message = CHECKS[name](clean(input.value));
    $(FIELD_ERRORS[name]).textContent = message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !message;
  }

  // The reply depends on one address. Catch the common slips and offer the fix; never insist.
  const DOMAIN_SLIPS = {
    "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
    "gmal.com": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com",
    "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.con": "hotmail.com",
    "outlok.com": "outlook.com", "outlook.con": "outlook.com",
    "icould.com": "icloud.com", "iclould.com": "icloud.com", "icloud.con": "icloud.com",
    "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com",
  };
  const ENDING_SLIPS = [[/\.con\.au$/, ".com.au"], [/\.com\.a$/, ".com.au"], [/\.con$/, ".com"], [/\.cmo$/, ".com"]];
  function likelyEmail(email) {
    if (!EMAIL_OK.test(email)) return null;
    const at = email.lastIndexOf("@");
    const domain = email.slice(at + 1).toLowerCase();
    let fixed = DOMAIN_SLIPS[domain];
    if (!fixed) {
      const ending = ENDING_SLIPS.find(([from]) => from.test(domain));
      if (ending) fixed = domain.replace(ending[0], ending[1]);
    }
    return fixed && fixed !== domain ? email.slice(0, at + 1) + fixed : null;
  }
  const suggestBox = $("email-suggest");
  let suggestedFor = null; // the address the send button has already stopped for
  let suggestionShown = null; // the correction on screen now
  function clearSuggestion() {
    suggestBox.textContent = "";
    suggestionShown = null;
  }
  function suggestEmail() {
    const better = likelyEmail(clean($("email").value));
    if (!better) {
      clearSuggestion();
      return false;
    }
    // Already on screen: leave it be. Rebuilding it as the field loses focus would take the
    // button out from under the very tap that was aimed at it.
    if (better === suggestionShown) return true;
    clearSuggestion();
    suggestionShown = better;
    const use = el("button", better, "textbtn");
    use.type = "button";
    use.addEventListener("click", () => {
      $("email").value = better;
      clearSuggestion();
      clearError("email");
      clearSendError();
      refreshSummary();
      saveDraft();
      formStatus.textContent = "Email changed to " + better + ".";
      $("phone").focus();
    });
    suggestBox.append("Did you mean ", use, "?");
    return true;
  }

  ["name", "email", "phone"].forEach((name) => {
    $(name).addEventListener("blur", () => {
      if (!$(name).value.trim()) return;
      const ok = checkField(name);
      if (name === "email") {
        refreshSummary();
        if (ok) suggestEmail();
      }
    });
  });

  // ---------------------------------------------------------------- sending

  function showDone(data) {
    done = true;
    noteRequest(data);
    $("done-text").textContent =
      "Thank you. We'll reply to " + data.email + "." + (data.date === cafeNow().date ? " " + TONIGHT_NOTE : "");
    const dl = $("summary");
    dl.textContent = "";
    [["Guests", data.party], ["Date", longDate(data.date)], ["Time", fmtTime(data.time)], ["Name", data.name]].forEach(([k, v]) => {
      const row = el("div");
      row.append(el("dt", k), el("dd", v));
      dl.append(row);
    });
    const next = $("done-next");
    next.textContent = "";
    next.append("Reserved once we confirm. No automatic email is sent, and our reply may land in junk. To change or cancel, email ");
    const mail = el("a", C.email, "link");
    mail.href = "mailto:" + C.email;
    next.append(mail, ".");
    show("done");
    window.scrollTo({ top: 0, behavior: "instant" });
    $("done-title").focus();
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing stored */ }
  }

  // The request as an email, for when it cannot be stored.
  function mailtoFor(data) {
    const body = [
      "Guests: " + data.party,
      "Date: " + longDate(data.date),
      "Time: " + fmtTime(data.time),
      "Name: " + data.name,
      "Email: " + data.email,
      data.phone ? "Phone: " + data.phone : null,
      data.notes ? "Notes: " + data.notes : null,
    ].filter((l) => l !== null).join("\r\n");
    const subject = "Dinner request · " + guestsText(data.party) + " · " + shortDate(data.date) + " · " + fmtTime(data.time);
    return "mailto:" + C.email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }
  // "Couldn't send. Try again, or email it instead." — the last words are the link.
  function fail(before, data) {
    error.textContent = before + ", or ";
    emailInstead.href = mailtoFor(data);
    emailInstead.hidden = false;
    errorEnd.textContent = ".";
  }
  emailInstead.addEventListener("click", () => {
    // The page cannot know whether an email app opened: say what to do either way.
    afterEmail.textContent = "Send the email to finish. If no email opened, write to " + C.email + ".";
    afterEmail.hidden = false;
    afterEmail.focus(); // the link is about to be hidden; keep the guest's place
    errorBox.hidden = true;
  });

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

  // Draw the tiles again from the clock. Returns false if nothing can be requested any more
  // (the page has then moved to another view).
  function redrawFromClock(droppedTime) {
    openDates = dinners.filter((d) => slots(d).length);
    if (!openDates.length) {
      lastSignature = null;
      show(restView());
      return false;
    }
    lastSignature = signature();
    buildDates();
    buildTimes(droppedTime);
    refreshSummary();
    saveDraft();
    return true;
  }
  const firstTile = (name) => inputs(name).find((i) => !i.parentElement.hidden) || null;

  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    clearSendError();

    // Time may have moved on since the tiles were drawn: a chosen time, or the whole evening,
    // can have gone. Redraw first, then say exactly what needs choosing again.
    const before = { date: chosen("date"), time: chosen("time") };
    if (!redrawFromClock()) {
      unsent(UNSENT);
      return;
    }
    const data = { party: chosen("party"), date: chosen("date"), time: chosen("time") };
    TEXT_FIELDS.forEach((f) => (data[f] = clean($(f).value)));

    let first = null;
    const flag = (name, message, focusEl) => {
      $(FIELD_ERRORS[name]).textContent = message;
      if (!first) first = focusEl || submitBtn;
    };
    if (!data.date) flag("date", "Select a date.", firstTile("date"));
    else if (!data.time) flag("time", before.time ? "That time has passed. Select another." : "Select a time.", firstTile("time"));
    ["name", "email", "phone"].forEach((name) => { if (!checkField(name) && !first) first = $(name); });
    // A likely slip in the address stops the send once, whether or not the suggestion was
    // already on screen (it may not have been seen or heard); sending again with the address
    // unchanged goes ahead.
    if (!first && suggestedFor !== data.email && suggestEmail()) {
      suggestedFor = data.email;
      first = $("email");
    }
    const party = Number(data.party);
    if (!first && (!Number.isInteger(party) || party < 1 || party > R.maxParty)) first = firstTile("party");
    if (first) {
      error.textContent = "Check the details above.";
      first.focus();
      const group = first.closest(".group");
      if (group && group.scrollIntoView) group.scrollIntoView({ block: "start", behavior: "instant" });
      return;
    }

    sending = true;
    // aria-disabled rather than disabled: the button keeps focus and its full colour.
    submitBtn.setAttribute("aria-disabled", "true");
    submitBtn.textContent = "sending…";
    formStatus.textContent = "Sending…";
    try {
      const status = await saveRequest(data);
      if ((status >= 200 && status < 300) || status === 409) {
        // 409: this exact request (same id) is already stored — an earlier try got through.
        showDone(data);
      } else if (status === 429) {
        fail("Couldn't send right now. Try again later", data);
      } else if (status === 400 || status === 401 || status === 403) {
        // The database turned it down: the time has passed, or the owner has changed the dates.
        // Read the dates again and ask for a fresh choice. Emailing the same request would not help.
        await refreshDinner();
        if (view !== "form") {
          unsent(UNSENT);
        } else if (slotsFor(data.date).includes(data.time)) {
          // Still on offer as far as this page can tell (this device's clock may be wrong, for
          // one): choosing again would not help, so offer the email instead.
          fail("Couldn't send. Try again", data);
        } else {
          inputs("time").forEach((i) => (i.checked = false));
          if (!redrawFromClock()) {
            unsent(UNSENT);
            return;
          }
          // Say it beside the tiles as well: on a phone the line by the button is off screen.
          if (chosen("date")) $("time-error").textContent = fmtTime(data.time) + " is no longer offered. Select another.";
          else $("date-error").textContent = "That date is no longer offered.";
          error.textContent = "That date or time is no longer offered. Select another.";
          (firstTile(chosen("date") ? "time" : "date") || submitBtn).focus();
        }
      } else {
        fail("Couldn't send. Try again", data);
      }
    } catch (err) {
      fail("Couldn't send. Check your connection and try again", data);
    } finally {
      sending = false;
      submitBtn.removeAttribute("aria-disabled");
      submitBtn.textContent = SUBMIT_LABEL;
      if (formStatus.textContent === "Sending…") formStatus.textContent = "";
    }
  });

  // Tells the script in the page head that this one is up and running. Set last: if anything
  // above failed, the head script gives the page's plain message back after a few seconds.
  window.RESERVE_STARTED = true;
  document.documentElement.className = "js";
})();
