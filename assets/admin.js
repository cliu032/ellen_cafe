// Owner area: sign in, answer reservation requests, pick the dinner dates, manage the photos.
// Everything shown here comes from guests or from Supabase, so it is only ever written to the
// page as text (textContent) — never as HTML. What an account may do is decided by the
// database's row level security, not by this file.
(function () {
  const C = window.CAFE;
  const SB = C.supabase || {};
  const { fmtTime, toMin, addDays, fmtDate, shortDate, cafeNow } = window.CAFE_UTIL;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  const VIEWS = ["loading", "signin", "denied", "error", "app"];
  function show(view, focusId) {
    VIEWS.forEach((v) => ($("view-" + v).hidden = v !== view));
    if (focusId) $(focusId).focus();
  }
  function fatal(message) {
    $("error-text").textContent = message;
    show("error", "error-h");
  }

  if (!SB.url || !SB.publishableKey || !window.supabase) {
    fatal("Not set up: assets/config.js has no Supabase project.");
    $("error-retry").hidden = true;
    return;
  }
  const sb = window.supabase.createClient(SB.url.replace(/\/+$/, ""), SB.publishableKey);

  const notice = $("notice");
  let noticeTimer;
  function say(message, bad) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.classList.toggle("bad", Boolean(bad));
    if (message && !bad) noticeTimer = setTimeout(() => (notice.textContent = ""), 6000);
  }

  // ---------------------------------------------------------------- signing in and out

  let currentUserId = null;
  // Each load takes a ticket; an answer that arrives after a newer load, or after sign-out, is dropped.
  let loadingReservations = 0;
  let loadingDinner = 0;
  let loadingPhotos = 0;

  // Guests' details must not stay in the page once nobody is signed in.
  function forgetEverything() {
    loadingReservations++;
    loadingDinner++;
    loadingPhotos++;
    ["res-list", "dinner-list", "dinner-cal", "photo-list", "who", "denied-who", "notice"].forEach((id) => ($(id).textContent = ""));
    $("pending-badge").hidden = true;
  }

  async function enter(session) {
    if (!session) {
      currentUserId = null;
      forgetEverything();
      $("account").hidden = true;
      show("signin");
      return;
    }
    if (session.user.id === currentUserId) return; // token refresh or tab refocus: nothing new
    currentUserId = session.user.id;
    $("who").textContent = session.user.email || "";
    $("denied-who").textContent = session.user.email || "this account";
    $("account").hidden = false;

    const { data, error } = await sb.rpc("is_owner");
    if (session.user.id !== currentUserId) return; // signed out or switched while we waited
    if (error) {
      currentUserId = null;
      fatal("Couldn't check this account. Try again.");
      return;
    }
    if (data !== true) {
      show("denied", "denied-h");
      return;
    }
    show("app");
    loadReservations();
    loadDinner();
    loadPhotos();
    checkSignUp();
  }

  // Only owners should have accounts on this project. If anyone can still register one, say
  // so every time the owner area opens, until it is switched off in Supabase.
  async function checkSignUp() {
    try {
      const res = await fetch(SB.url.replace(/\/+$/, "") + "/auth/v1/settings", { headers: { apikey: SB.publishableKey } });
      const settings = res.ok ? await res.json() : null;
      $("signup-warning").hidden = !(settings && settings.disable_signup === false);
    } catch (err) {
      // Couldn't check: say nothing rather than warn wrongly.
    }
  }

  // Supabase calls must not run inside this callback, so hand off to the next tick.
  sb.auth.onAuthStateChange((_event, session) => setTimeout(() => enter(session), 0));

  $("signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("signin-error");
    const button = $("signin-submit");
    const email = $("signin-email").value.trim();
    const password = $("signin-password").value;
    error.textContent = "";
    if (!email || !password) {
      error.textContent = "Enter your email and password.";
      (email ? $("signin-password") : $("signin-email")).focus();
      return;
    }
    button.disabled = true;
    try {
      const { error: failed } = await sb.auth.signInWithPassword({ email, password });
      if (failed) {
        error.textContent =
          failed.status === 400 || failed.status === 401
            ? "Email and password don't match."
            : "Couldn't sign in. Try again.";
      } else {
        $("signin-password").value = "";
      }
    } catch (err) {
      error.textContent = "Couldn't sign in. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  });

  // Signing out must work with no connection, so it only ends the session in this browser
  // (scope "local" needs no answer from the server). Sessions on other devices are untouched.
  async function signOut() {
    forgetEverything();
    try {
      await sb.auth.signOut({ scope: "local" });
    } catch (err) {
      // Nothing more to do: the page has already been cleared.
    }
  }
  $("signout").addEventListener("click", signOut);
  $("denied-signout").addEventListener("click", signOut);
  $("error-retry").addEventListener("click", async () => {
    show("loading");
    currentUserId = null;
    const { data } = await sb.auth.getSession();
    enter(data ? data.session : null);
  });

  // ---------------------------------------------------------------- tabs

  const TABS = ["reservations", "dinner", "photos"];
  function selectTab(name, focus) {
    TABS.forEach((t) => {
      const on = t === name;
      $("tab-" + t).setAttribute("aria-selected", String(on));
      $("tab-" + t).tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
    });
    if (focus) $("tab-" + name).focus();
  }
  TABS.forEach((t, i) => {
    $("tab-" + t).addEventListener("click", () => selectTab(t));
    $("tab-" + t).addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        selectTab(TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length], true);
      }
    });
  });

  // ---------------------------------------------------------------- reservations

  const asUTC = (s) => new Date(s + "T00:00:00Z");
  const longDate = (s) =>
    asUTC(s).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hhmm = (t) => String(t).slice(0, 5);
  const guests = (n) => n + (Number(n) === 1 ? " guest" : " guests");
  const receivedAt = (iso) =>
    new Date(iso).toLocaleString("en-AU", {
      timeZone: C.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    });

  // A guest's address is their own text: encode it so it can only ever be the recipient.
  const mailtoAddress = (email) => encodeURIComponent(email).replace(/'/g, "%27").replace(/%40/g, "@");

  function replyLink(r) {
    const first = String(r.name).split(" ")[0];
    const what = "dinner for " + guests(r.party_size) + " on " + longDate(r.reservation_date) + " at " + fmtTime(hhmm(r.reservation_time));
    let subject;
    let line;
    if (r.status === "confirmed") {
      subject = "Your reservation at ellen is confirmed";
      line = "Your reservation is confirmed: " + what + ". We look forward to seeing you.";
    } else if (r.status === "declined") {
      subject = "Your reservation request at ellen";
      line = "Thank you for your request: " + what + ". We're sorry, we can't offer a table at that time.";
    } else if (r.status === "cancelled") {
      subject = "Your reservation at ellen is cancelled";
      line = "Your reservation is cancelled: " + what + ".";
    } else {
      subject = "Your reservation request at ellen";
      line = "Thank you for your request: " + what + ".";
    }
    const body = ["Hi " + first + ",", "", line, "", C.name, C.address.join(", ")].join("\r\n");
    return "mailto:" + mailtoAddress(r.email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  const resList = $("res-list");
  const filter = $("res-filter");

  async function loadReservations() {
    const ticket = ++loadingReservations;
    const today = cafeNow().date;
    let q = sb.from("reservations").select("*");
    if (filter.value === "todo") {
      q = q.eq("status", "pending").gte("reservation_date", today);
    } else if (filter.value === "upcoming") {
      q = q.in("status", ["pending", "confirmed"]).gte("reservation_date", today);
    } else if (filter.value === "past") {
      q = q.lt("reservation_date", today);
    }
    const newestFirst = filter.value === "past" || filter.value === "all";
    q = q
      .order("reservation_date", { ascending: !newestFirst })
      .order("reservation_time", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(300);

    const [list, waiting] = await Promise.all([
      q,
      sb.from("reservations").select("id", { count: "exact", head: true }).eq("status", "pending").gte("reservation_date", today),
    ]);
    if (ticket !== loadingReservations) return; // a newer load has started

    const badge = $("pending-badge");
    if (!waiting.error && waiting.count > 0) {
      badge.textContent = waiting.count;
      badge.setAttribute("aria-label", waiting.count + " awaiting reply");
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    if (list.error) {
      say("Couldn't load reservations. Try again.", true);
      return;
    }
    renderReservations(list.data);
  }

  function renderReservations(rows) {
    resList.textContent = "";
    if (!rows.length) {
      const nothing = {
        todo: "Nothing awaiting reply.",
        upcoming: "No upcoming reservations.",
        past: "No past reservations.",
        all: "No reservations yet.",
      };
      resList.append(el("p", nothing[filter.value], "empty"));
      return;
    }
    let day = null;
    let group = null;
    rows.forEach((r) => {
      if (r.reservation_date !== day) {
        day = r.reservation_date;
        group = el("section", null, "day");
        group.append(el("h2", longDate(day)));
        resList.append(group);
      }
      group.append(reservationRow(r));
    });
  }

  function reservationRow(r) {
    const row = el("article", null, "res");

    const when = el("div", fmtTime(hhmm(r.reservation_time)), "when");
    when.append(el("span", guests(r.party_size)));

    const who = el("div");
    who.append(el("div", r.name, "who-name"));
    const contact = el("div", null, "contact");
    const mail = el("a", r.email, "link");
    mail.href = "mailto:" + mailtoAddress(r.email);
    contact.append(mail);
    if (r.phone) {
      contact.append(" · ");
      const tel = el("a", r.phone, "link");
      // "+61 (0)412 345 678": the bracketed zero is not dialled after a country code.
      tel.href = "tel:" + r.phone.replace(/^(\s*\+\d{1,3})\s*\(0\)/, "$1").replace(/[^\d+]/g, "");
      contact.append(tel);
    }
    who.append(contact);
    if (r.notes) who.append(el("p", r.notes, "notes"));
    who.append(el("div", "Requested " + receivedAt(r.created_at), "meta"));

    const side = el("div", null, "side");
    side.append(el("span", r.status, "chip " + r.status));
    const actions = el("div", null, "actions");
    const button = (label, status, cls) => {
      const b = el("button", label, cls);
      b.type = "button";
      b.addEventListener("click", () => setStatus(r, status, actions));
      return b;
    };
    if (r.status === "pending") {
      actions.append(button("confirm", "confirmed", "btn small"), button("decline", "declined", "textbtn"));
    } else if (r.status === "confirmed") {
      actions.append(button("cancel", "cancelled", "textbtn"));
    } else {
      actions.append(button("reopen", "pending", "textbtn"));
    }
    const reply = el("a", "email guest", "link");
    reply.href = replyLink(r);
    actions.append(reply);
    const del = el("button", "delete", "textbtn danger");
    del.type = "button";
    del.addEventListener("click", () => removeReservation(r, actions));
    actions.append(del);
    side.append(actions);

    row.append(when, who, side);
    return row;
  }

  const setBusy = (box, busy) => box.querySelectorAll("button").forEach((b) => (b.disabled = busy));

  async function setStatus(r, status, box) {
    setBusy(box, true);
    const { data, error } = await sb.from("reservations").update({ status }).eq("id", r.id).select("id");
    if (error || !data || data.length !== 1) {
      setBusy(box, false);
      say("Couldn't update. Try again.", true);
      return;
    }
    const outcome = {
      confirmed: "Confirmed. Email " + r.name + " to let them know.",
      declined: "Declined. Email " + r.name + " to let them know.",
      cancelled: "Cancelled.",
      pending: "Reopened.",
    };
    say(outcome[status]);
    // Keep a just-answered request on screen so the owner can email the guest from it.
    r.status = status;
    const fresh = reservationRow(r);
    box.closest(".res").replaceWith(fresh);
    refreshBadge();
    loadDinner(); // the request counts beside each dinner date have changed
  }

  async function removeReservation(r, box) {
    if (!window.confirm("Delete " + r.name + "'s request for " + longDate(r.reservation_date) + "? This can't be undone.")) return;
    setBusy(box, true);
    const { data, error } = await sb.from("reservations").delete().eq("id", r.id).select("id");
    if (error || !data || data.length !== 1) {
      setBusy(box, false);
      say("Couldn't delete. Try again.", true);
      return;
    }
    say("Deleted.");
    loadReservations();
    loadDinner();
  }

  async function refreshBadge() {
    const { count, error } = await sb
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("reservation_date", cafeNow().date);
    const badge = $("pending-badge");
    if (!error && count > 0) {
      badge.textContent = count;
      badge.setAttribute("aria-label", count + " awaiting reply");
      badge.hidden = false;
    } else if (!error) {
      badge.hidden = true;
    }
  }

  filter.addEventListener("change", loadReservations);
  $("res-refresh").addEventListener("click", () => {
    say("");
    loadReservations();
    loadDinner();
    if (!photosLoaded) loadPhotos();
  });

  // ---------------------------------------------------------------- dinner dates

  // Dinner runs only on the evenings picked here. Each is a row in public.dinner_services; the
  // website offers exactly these dates, and the database refuses a request for any other.
  const dinnerCal = $("dinner-cal");
  const dinnerList = $("dinner-list");
  const firstSel = $("dinner-first");
  const lastSel = $("dinner-last");
  const TIMES_KEY = "ellen.owner.seating";
  let dinners = []; // [{ service_date, first_seating, last_seating }] upcoming, soonest first
  let liveRequests = {}; // date -> requests awaiting reply or confirmed
  let dinnerWeeks = 8;
  let dinnerLoaded = false; // false until the dates have arrived at least once
  const dinnerSaving = new Set(); // dates with an add or remove in flight

  const pad2 = (n) => String(n).padStart(2, "0");
  const HALF_HOURS = [];
  for (let m = 16 * 60; m <= 23 * 60 + 30; m += 30) HALF_HOURS.push(pad2(Math.floor(m / 60)) + ":" + pad2(m % 60));
  function fillTimes(select, value, from) {
    select.textContent = "";
    HALF_HOURS.filter((t) => !from || toMin(t) >= toMin(from)).forEach((t) => select.add(new Option(fmtTime(t), t)));
    // A stored time off the half hour still needs to be shown as it is.
    if (value && !Array.from(select.options).some((o) => o.value === value)) select.add(new Option(fmtTime(value), value), 0);
    select.value = value;
    if (select.value !== value) select.selectedIndex = 0;
  }
  let usual = { first: "17:30", last: "20:30" };
  try {
    const saved = JSON.parse(localStorage.getItem(TIMES_KEY));
    if (saved && HALF_HOURS.includes(saved.first) && HALF_HOURS.includes(saved.last) && toMin(saved.last) >= toMin(saved.first)) usual = saved;
  } catch (e) { /* keep the defaults */ }
  fillTimes(firstSel, usual.first);
  fillTimes(lastSel, usual.last, usual.first);
  function usualChanged() {
    const first = firstSel.value;
    const last = toMin(lastSel.value) >= toMin(first) ? lastSel.value : first;
    fillTimes(lastSel, last, first);
    try { localStorage.setItem(TIMES_KEY, JSON.stringify({ first, last })); } catch (e) { /* nothing to keep */ }
  }
  firstSel.addEventListener("change", usualChanged);
  lastSel.addEventListener("change", usualChanged);

  async function loadDinner() {
    const ticket = ++loadingDinner;
    const today = cafeNow().date;
    const [services, requests] = await Promise.all([
      sb.from("dinner_services").select("service_date, first_seating, last_seating").gte("service_date", today).order("service_date", { ascending: true }),
      sb.from("reservations").select("reservation_date").in("status", ["pending", "confirmed"]).gte("reservation_date", today),
    ]);
    if (ticket !== loadingDinner) return; // a newer load, a change made meanwhile, or sign-out
    if (services.error) {
      say("Couldn't load dinner dates. Use refresh to try again.", true);
      return;
    }
    dinnerLoaded = true;
    dinners = services.data;
    liveRequests = {};
    if (!requests.error) requests.data.forEach((r) => (liveRequests[r.reservation_date] = (liveRequests[r.reservation_date] || 0) + 1));
    renderDinner();
  }

  function renderDinner(focusDate) {
    // A redraw must not take the keyboard away from the date the owner is on.
    const active = document.activeElement;
    if (!focusDate && active && dinnerCal.contains(active)) focusDate = active.dataset.date;
    const today = cafeNow().date;
    const on = {};
    dinners.forEach((d) => (on[d.service_date] = d));

    // Calendar: weeks run Monday to Sunday, starting with this week.
    dinnerCal.textContent = "";
    const lead = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
    for (let i = 0; i < lead; i++) dinnerCal.append(el("span", null, "blank"));
    let lastMonth = null;
    const days = dinnerWeeks * 7 - lead;
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      const month = fmtDate(date, { month: "short" });
      const b = el("button", null, "cal-day");
      b.type = "button";
      b.dataset.date = date;
      const row = on[date];
      b.setAttribute("aria-pressed", String(Boolean(row)));
      b.setAttribute(
        "aria-label",
        fmtDate(date, { weekday: "long", day: "numeric", month: "long" }) +
          (row ? ", dinner " + fmtTime(hhmm(row.first_seating)) + " to " + fmtTime(hhmm(row.last_seating)) : ", no dinner")
      );
      if (i === 0) b.append(el("small", "today"));
      else if (month !== lastMonth) b.append(el("small", month));
      lastMonth = month;
      b.append(el("span", String(new Date(date + "T00:00:00Z").getUTCDate())));
      b.addEventListener("click", () => toggleDinner(date));
      dinnerCal.append(b);
    }
    $("dinner-more").hidden = dinnerWeeks >= 52;

    dinnerList.textContent = "";
    if (!dinners.length) {
      dinnerList.append(el("li", "No dinner dates yet.", "empty"));
    }
    dinners.forEach((d) => {
      const li = el("li");
      const when = el("div", shortDate(d.service_date), "when");
      const n = liveRequests[d.service_date] || 0;
      when.append(el("span", n === 0 ? "no requests" : n === 1 ? "1 request" : n + " requests"));
      const field = (label, value, from, name) => {
        const box = el("div", null, "field");
        const select = el("select");
        select.id = name + "-" + d.service_date;
        const lab = el("label", label);
        lab.htmlFor = select.id;
        fillTimes(select, value, from);
        box.append(lab, select);
        return { box, select };
      };
      const first = field("First seating", hhmm(d.first_seating), null, "first");
      const last = field("Last seating", hhmm(d.last_seating), hhmm(d.first_seating), "last");
      const save = (e) => changeTimes(d, first.select.value, last.select.value, e.target.id);
      first.select.addEventListener("change", save);
      last.select.addEventListener("change", save);
      const remove = el("button", "remove", "textbtn danger");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove dinner on " + shortDate(d.service_date));
      remove.addEventListener("click", () => removeDinner(d.service_date));
      li.append(when, first.box, last.box, remove);
      dinnerList.append(li);
    });

    if (focusDate) {
      const again = dinnerCal.querySelector('[data-date="' + focusDate + '"]');
      if (again) again.focus();
    }
  }

  const sortDinners = () => dinners.sort((a, b) => (a.service_date < b.service_date ? -1 : 1));

  async function toggleDinner(date) {
    // The page may have sat open past midnight: never add an evening that has gone.
    if (date < cafeNow().date) return loadDinner();
    if (dinnerSaving.has(date)) return;
    if (dinners.some((d) => d.service_date === date)) return removeDinner(date, true);
    dinnerSaving.add(date);
    const first = firstSel.value;
    const last = lastSel.value;
    const { data, error } = await sb
      .from("dinner_services")
      .insert({ service_date: date, first_seating: first, last_seating: last })
      .select("service_date, first_seating, last_seating");
    dinnerSaving.delete(date);
    if (error && error.code === "23505") {
      // Added meanwhile from another tab or device.
      await loadDinner();
      say(shortDate(date) + " already has dinner.");
      return;
    }
    if (error || !data || data.length !== 1) {
      say("Couldn't add " + shortDate(date) + ". Try again.", true);
      return;
    }
    loadingDinner++; // an older load still in flight would not know about this date
    dinners.push(data[0]);
    sortDinners();
    renderDinner();
    say("Added " + shortDate(date) + ", " + fmtTime(first) + " to " + fmtTime(last) + ".");
  }

  async function removeDinner(date, fromCalendar) {
    if (dinnerSaving.has(date)) return;
    dinnerSaving.add(date);
    // Count this evening's requests now, not from when the page was loaded.
    const fresh = await sb
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("reservation_date", date)
      .in("status", ["pending", "confirmed"]);
    const n = fresh.error ? liveRequests[date] || 0 : fresh.count || 0;
    if (n) {
      const which = n === 1 ? "1 request for it stays" : n + " requests for it stay";
      if (!window.confirm("Remove dinner on " + shortDate(date) + "? " + which + " in Reservations.")) {
        dinnerSaving.delete(date);
        liveRequests[date] = n;
        renderDinner(fromCalendar ? date : null);
        return;
      }
    }
    const { data, error } = await sb.from("dinner_services").delete().eq("service_date", date).select("service_date");
    dinnerSaving.delete(date);
    if (error || !data || data.length !== 1) {
      await loadDinner();
      const gone = !error && !dinners.some((d) => d.service_date === date);
      say(gone ? shortDate(date) + " was already removed." : "Couldn't remove " + shortDate(date) + ". Try again.", !gone);
      return;
    }
    loadingDinner++;
    dinners = dinners.filter((d) => d.service_date !== date);
    renderDinner(fromCalendar ? date : null);
    say("Removed " + shortDate(date) + ".");
  }

  async function changeTimes(d, first, last, selectId) {
    if (toMin(last) < toMin(first)) last = first;
    const { data, error } = await sb
      .from("dinner_services")
      .update({ first_seating: first, last_seating: last })
      .eq("service_date", d.service_date)
      .select("service_date, first_seating, last_seating");
    const ok = !error && data && data.length === 1;
    if (ok) {
      loadingDinner++;
      Object.assign(d, data[0]);
    }
    renderDinner();
    // The list was redrawn: put the keyboard back on the select that was being changed.
    const again = $(selectId);
    if (again && (document.activeElement === document.body || !document.activeElement)) again.focus();
    if (ok) say(shortDate(d.service_date) + ": " + fmtTime(first) + " to " + fmtTime(last) + ".");
    else say("Couldn't save the times. Try again.", true);
  }

  $("dinner-more").addEventListener("click", () => {
    if (!dinnerLoaded) return loadDinner(); // never draw "no dinner dates" from data that did not arrive
    const firstNew = addDays(cafeNow().date, dinnerWeeks * 7 - ((new Date(cafeNow().date + "T00:00:00Z").getUTCDay() + 6) % 7));
    dinnerWeeks = Math.min(52, dinnerWeeks + 8);
    renderDinner(firstNew);
  });

  // ---------------------------------------------------------------- photos

  const BUCKET = "photos";
  const MAX_EDGE = 2000; // pixels on the long side; larger photos are scaled down before upload
  const photoList = $("photo-list");
  const photoInput = $("photo-input");
  const progress = $("photo-progress");
  let photos = [];

  const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  let photosLoaded = false;
  async function loadPhotos() {
    const ticket = ++loadingPhotos;
    const { data, error } = await sb
      .from("photos")
      .select("id, path, alt, sort_order, width, height, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (ticket !== loadingPhotos) return;
    if (error) {
      say("Couldn't load photos. Use refresh to try again.", true);
      return;
    }
    photosLoaded = true;
    photos = data;
    renderPhotos();
  }

  function renderPhotos() {
    photoList.textContent = "";
    if (!photos.length) {
      photoList.append(el("li", "No photos yet.", "empty"));
      return;
    }
    photos.forEach((p, i) => {
      const li = el("li");
      const img = el("img");
      img.src = publicUrl(p.path);
      img.alt = p.alt || "";
      img.loading = "lazy";
      li.append(img);

      const field = el("div", null, "field");
      const label = el("label", "Description");
      const input = el("input");
      input.type = "text";
      input.maxLength = 200;
      input.value = p.alt || "";
      input.id = "alt-" + p.id;
      label.htmlFor = input.id;
      input.addEventListener("change", () => saveAlt(p, input, img));
      field.append(label, input);
      li.append(field);

      const row = el("div", null, "row");
      const move = el("div", null, "move");
      const earlier = el("button", "earlier", "textbtn");
      earlier.type = "button";
      earlier.disabled = i === 0;
      earlier.setAttribute("aria-label", "Move photo " + (i + 1) + " earlier");
      earlier.addEventListener("click", () => movePhoto(i, -1));
      const later = el("button", "later", "textbtn");
      later.type = "button";
      later.disabled = i === photos.length - 1;
      later.setAttribute("aria-label", "Move photo " + (i + 1) + " later");
      later.addEventListener("click", () => movePhoto(i, 1));
      move.append(earlier, later);
      const del = el("button", "delete", "textbtn danger");
      del.type = "button";
      del.setAttribute("aria-label", "Delete photo " + (i + 1));
      del.addEventListener("click", () => removePhoto(p));
      row.append(move, del);
      li.append(row);

      photoList.append(li);
    });
  }

  async function saveAlt(p, input, img) {
    const alt = input.value.trim().replace(/\s+/g, " ");
    input.value = alt;
    if (alt === (p.alt || "")) return;
    const { data, error } = await sb.from("photos").update({ alt }).eq("id", p.id).select("id");
    if (error || !data || data.length !== 1) {
      say("Couldn't save the description. Try again.", true);
      return;
    }
    p.alt = alt;
    img.alt = alt;
    say("Description saved.");
  }

  let reordering = false;
  async function movePhoto(index, step) {
    const target = index + step;
    if (reordering || target < 0 || target >= photos.length) return;
    reordering = true;
    const next = photos.slice();
    next.splice(target, 0, next.splice(index, 1)[0]);
    // Renumber from 1; normally only the two photos that swapped places need saving.
    const changes = next
      .map((p, i) => ({ p, order: i + 1 }))
      .filter((c) => c.p.sort_order !== c.order);
    const results = await Promise.all(
      changes.map((c) => sb.from("photos").update({ sort_order: c.order }).eq("id", c.p.id).select("id"))
    );
    reordering = false;
    if (results.some((r) => r.error || !r.data || r.data.length !== 1)) {
      say("Couldn't save the order. Try again.", true);
      loadPhotos();
      return;
    }
    changes.forEach((c) => (c.p.sort_order = c.order));
    photos = next.concat(photos.filter((p) => !next.includes(p))); // plus any added while this was saving
    renderPhotos();
    const moved = photoList.children[target].querySelector(step < 0 ? ".move button:first-child" : ".move button:last-child");
    (moved && !moved.disabled ? moved : photoList.children[target].querySelector(".move button:not([disabled])") || photoInput).focus();
  }

  async function removePhoto(p) {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    const { data, error } = await sb.from("photos").delete().eq("id", p.id).select("id");
    if (error || !data || data.length !== 1) {
      say("Couldn't delete the photo. Try again.", true);
      return;
    }
    // The photo is off the site as soon as its row is gone; the file is tidied up after.
    const { error: fileError } = await sb.storage.from(BUCKET).remove([p.path]);
    photos = photos.filter((x) => x.id !== p.id);
    renderPhotos();
    say(fileError ? "Removed from the site, but the file couldn't be deleted from storage." : "Photo deleted.", Boolean(fileError));
  }

  // Decode, scale down and re-encode as JPEG. Re-encoding also drops embedded data such as
  // the location the photo was taken.
  async function prepare(file) {
    let source;
    let width;
    let height;
    let release = () => {};
    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
      width = source.width;
      height = source.height;
      release = () => source.close && source.close();
    } catch (err) {
      const url = URL.createObjectURL(file);
      release = () => URL.revokeObjectURL(url);
      source = new Image();
      source.src = url;
      try {
        await source.decode();
      } catch (err2) {
        release();
        throw new Error("unreadable");
      }
      width = source.naturalWidth;
      height = source.naturalHeight;
    }
    if (!width || !height) {
      release();
      throw new Error("unreadable");
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    release();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("unreadable");
    return { blob, width: w, height: h };
  }

  const newName = () =>
    (window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)) + ".jpg";

  let uploading = false;
  photoInput.addEventListener("change", async () => {
    const files = Array.from(photoInput.files || []);
    photoInput.value = "";
    if (!files.length || uploading) return;
    uploading = true;
    $("photo-add").setAttribute("aria-disabled", "true");
    photoInput.disabled = true;
    say("");
    const failed = [];
    let order = photos.reduce((max, p) => Math.max(max, p.sort_order), 0);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progress.textContent = "Uploading " + (i + 1) + " of " + files.length + "…";
      try {
        const image = await prepare(file);
        const path = newName();
        const up = await sb.storage.from(BUCKET).upload(path, image.blob, {
          contentType: "image/jpeg",
          cacheControl: "3600", // an hour: a deleted photo should not linger in caches for long
          upsert: false,
        });
        if (up.error) throw up.error;
        const row = await sb
          .from("photos")
          .insert({ path, alt: "", sort_order: ++order, width: image.width, height: image.height })
          .select("id, path, alt, sort_order, width, height, created_at");
        if (row.error || !row.data || row.data.length !== 1) {
          await sb.storage.from(BUCKET).remove([path]); // don't leave a file nothing points to
          throw row.error || new Error("not saved");
        }
        photos.push(row.data[0]);
      } catch (err) {
        failed.push(file.name + (err && err.message === "unreadable" ? " (not a readable photo)" : ""));
      }
    }
    progress.textContent = "";
    uploading = false;
    photoInput.disabled = false;
    $("photo-add").removeAttribute("aria-disabled");
    renderPhotos();
    const added = files.length - failed.length;
    if (failed.length) {
      say((added ? added + " added. " : "") + "Couldn't add: " + failed.join(", ") + ".", true);
    } else {
      say(added === 1 ? "Photo added. Add a description." : added + " photos added. Add descriptions.");
    }
  });

  // ---------------------------------------------------------------- keeping it fresh

  // New requests arrive while the page sits open: look again when the owner comes back to the tab.
  let lastLoad = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || $("view-app").hidden) return;
    if (Date.now() - lastLoad < 30000) return;
    lastLoad = Date.now();
    // Requests just confirmed or declined stay on screen until the guest has been emailed
    // (often from another app). Don't sweep them away on return; the badge still counts new ones.
    if (filter.value === "todo" && resList.querySelector(".chip:not(.pending)")) refreshBadge();
    else loadReservations();
    loadDinner(); // also moves "today" on when the page has sat open overnight
    if (!photosLoaded) loadPhotos();
  });
})();
