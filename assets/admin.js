// Owner area: sign in, answer reservation requests, pick the dinner dates, manage the photos,
// edit the lunch and dinner menus.
// Everything shown here comes from guests or from Supabase, so it is only ever written to the
// page as text (textContent) — never as HTML. What an account may do is decided by the
// database's row level security, not by this file.
(function () {
  const C = window.CAFE;
  const SB = C.supabase || {};
  const { fmtTime, toMin, addDays, fmtDate, shortDate, cafeNow, dinnerNow, tidyMenu, MENU_LIMITS, MENUS_KEY } = window.CAFE_UTIL;
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
    // The menus: back to "Loading…". Changes not yet saved stay in this browser (the kept
    // copies), to be picked up after the next sign-in.
    keepAll();
    loadingMenus++;
    menusLoaded = false;
    M = { lunch: blankMenu(), dinner: blankMenu() };
    KINDS.forEach((k) => {
      const list = $("m-list-" + k);
      list.replaceChildren();
      list.inert = false; // a save cut short by signing out must not leave the list dead
      list.removeAttribute("aria-busy");
    });
    $("m-wait").textContent = "Loading…";
    $("m-wait").hidden = false;
    $("m-body").hidden = true;
    pickMenu("lunch");
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
    loadMenus();
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
    if (KINDS.some(unsaved)) {
      keepAll();
      if (!window.confirm("Menu changes aren't saved. Sign out anyway?" + (canKeep ? " They stay on this device." : ""))) return;
    }
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

  const TABS = ["reservations", "dinner", "photos", "menu"];
  function selectTab(name, focus) {
    TABS.forEach((t) => {
      const on = t === name;
      $("tab-" + t).setAttribute("aria-selected", String(on));
      $("tab-" + t).tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
    });
    if (focus) $("tab-" + name).focus();
    drawMenuChrome(); // the save bar belongs to the menu tab
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
    loadMenus();
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
    drawMenuStatus(); // whether guests see the dinner menu depends on these dates
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

  // ---------------------------------------------------------------- menus

  // The lunch and dinner menus, one row each in public.menus. A menu is drawn as guests see
  // it; selecting a row opens it in place as a small form. Nothing reaches the site until
  // "save", which sends the whole menu with the version it was loaded at, so a menu changed
  // elsewhere in the meantime is never overwritten without the owner choosing to. Unsaved
  // changes are kept in this browser, so a call, a locked phone or a reload does not lose them.
  //
  //   saved copy    the menu as last loaded or saved, in its tidy form (CAFE_UTIL.tidyMenu)
  //   working copy  what is on screen; while a row is open it holds the text as typed
  //   unsaved       the tidied working copy differs from the saved copy
  //   kept copy     the working copy stored in this browser while it is unsaved
  const KINDS = ["lunch", "dinner"];
  const KEYS = ["name", "desc", "price"]; // the fields of a dish
  const ROW = "kind, note, sections, version, updated_at";
  const keptKey = (k) => "ellen.owner.menu." + k;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const squash = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const plural = (n) => n + (n === 1 ? " item" : " items");
  const blankMenu = () => ({
    saved: null, version: null, updatedAt: null, // as the database has it
    work: null, changedAt: null, // the working copy and when it last changed
    open: null, // the open editor: { type: "note" | "head" | "item", sec, item, isNew, before }
    bar: "none", // none | unsaved | saving | saved | failed | conflict
    restoredAt: null, // set while the bar should say "Changes from …"
    latest: null, // conflict: the newer row read from the database
    sent: null, // what a save sent that got no answer; it may have been stored all the same
    saving: false, savedTimer: null, refs: null,
    hasKept: false, // this page wrote or restored the kept copy, so it is this page's to remove
  });
  let M = { lunch: blankMenu(), dinner: blankMenu() };
  let menusLoaded = false;
  let loadingMenus = 0;
  let kind = "lunch"; // the menu on screen

  // Some private modes cannot store anything: editing still works, nothing survives a reload.
  let canKeep = true;
  try {
    localStorage.setItem("ellen.owner.test", "1");
    localStorage.removeItem("ellen.owner.test");
  } catch (e) {
    canKeep = false;
  }

  const hasDishes = (menu) => Boolean(menu && menu.sections.some((sec) => sec.items.length));
  // The tidy form drops a dish that has no name yet. One with a description or a price is
  // still the owner's typing, so it counts as a difference and is kept like any other.
  const halfTyped = (menu) => menu.sections.some((sec) => sec.items.some((it) => !squash(it.name) && (squash(it.desc) || squash(it.price))));
  const differs = (work, saved) => !same(tidyMenu(work, true), saved) || halfTyped(work);
  const unsaved = (k) => Boolean(M[k].work && differs(M[k].work, M[k].saved));
  const menuTabOpen = () => !$("panel-menu").hidden;
  let announcing = null;
  const announce = (message) => {
    const live = $("m-live");
    clearTimeout(announcing);
    live.textContent = "";
    if (message) announcing = setTimeout(() => (live.textContent = message), 30);
  };

  // A kept copy is the working copy as typed: unlike the tidy form it may hold a dish with
  // no name yet. Anything of the wrong shape is dropped.
  function loose(o) {
    const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, max) : "");
    const out = { note: str(o && o.note, MENU_LIMITS.note), sections: [] };
    (o && Array.isArray(o.sections) ? o.sections : []).slice(0, MENU_LIMITS.sections).forEach((sec) => {
      if (!sec || typeof sec !== "object") return;
      out.sections.push({
        title: str(sec.title, MENU_LIMITS.title),
        items: (Array.isArray(sec.items) ? sec.items : [])
          .filter((i) => i && typeof i === "object")
          .slice(0, MENU_LIMITS.items)
          .map((i) => ({ name: str(i.name, MENU_LIMITS.name), desc: str(i.desc, MENU_LIMITS.desc), price: str(i.price, MENU_LIMITS.price) })),
      });
    });
    return out;
  }
  const keepTimers = {};
  function keepNow(k) {
    clearTimeout(keepTimers[k]);
    const m = M[k];
    if (!canKeep || !m.work) return;
    try {
      if (unsaved(k)) {
        localStorage.setItem(keptKey(k), JSON.stringify({ v: 1, version: m.version, at: m.changedAt || Date.now(), note: m.work.note, sections: m.work.sections }));
        m.hasKept = true;
      } else if (m.hasKept) {
        // Only a copy this page put there: another tab's unsaved menu is not this page's to drop.
        localStorage.removeItem(keptKey(k));
        m.hasKept = false;
      }
    } catch (e) { /* storage full or gone: nothing more to do */ }
  }
  function keepSoon(k) {
    clearTimeout(keepTimers[k]);
    keepTimers[k] = setTimeout(() => keepNow(k), 300);
  }
  function readKept(k) {
    try {
      const o = JSON.parse(localStorage.getItem(keptKey(k)));
      return o && o.v === 1 && Number.isInteger(o.version) ? o : null;
    } catch (e) {
      return null;
    }
  }
  const keepAll = () => KINDS.forEach(keepNow);
  window.addEventListener("pagehide", keepAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keepAll();
  });
  // The browser's own "leave site?" prompt, registered only while something is unsaved.
  const warnOnLeave = (e) => {
    e.preventDefault();
    e.returnValue = "";
  };

  // -- loading

  async function loadMenus() {
    const ticket = ++loadingMenus;
    const { data, error } = await sb.from("menus").select(ROW);
    if (ticket !== loadingMenus) return; // a newer load, or sign-out
    const rows = {};
    if (!error && Array.isArray(data)) data.forEach((r) => { if (r && KINDS.includes(r.kind)) rows[r.kind] = r; });
    if (error || !rows.lunch || !rows.dinner) {
      // Never draw an editor from data that did not arrive.
      const message = "Couldn't load the menus. Use refresh to try again.";
      if (!menusLoaded) $("m-wait").textContent = message;
      say(message, true);
      return;
    }
    const first = !menusLoaded;
    menusLoaded = true;
    KINDS.forEach((k) => {
      if (takeRow(k, rows[k], first)) render(k);
    });
    $("m-wait").hidden = true;
    $("m-body").hidden = false;
    drawMenuChrome();
  }

  // Take a row read from the database. Returns true if the list needs drawing again.
  function takeRow(k, row, first) {
    const m = M[k];
    if (m.saving) return false; // the save's own answer will settle it
    const fresh = tidyMenu(row, true);
    const adopt = () => {
      m.saved = fresh;
      m.version = row.version;
      m.updatedAt = row.updated_at;
      m.latest = null;
      m.sent = null;
    };
    if (first) {
      adopt();
      m.work = clone(fresh);
      m.open = null;
      m.bar = "none";
      const kept = readKept(k);
      if (kept) {
        const mine = loose(kept);
        m.hasKept = true;
        if (!differs(mine, fresh)) {
          keepNow(k); // nothing in it that is not saved: drop it
        } else {
          // Changes made earlier on this device and never saved.
          m.work = mine;
          m.changedAt = kept.at;
          m.restoredAt = kept.at;
          m.bar = "unsaved";
          if (kept.version !== row.version) {
            // ...and the menu has been saved elsewhere since. The owner chooses.
            m.version = kept.version;
            m.latest = row;
            m.bar = "conflict";
          }
        }
      }
      return true;
    }
    // Versions only go up: an answer that was read before this page's own save, and arrives
    // after it, is older than what is held and must not be put back.
    if (row.version <= (m.latest ? m.latest.version : m.version)) return false;
    if (m.sent !== null && JSON.stringify(fresh) === m.sent && differs(m.work, fresh)) {
      // The newer row is this page's own save, whose answer was lost. Not another device.
      adopt();
      setBar(k, "unsaved");
      keepNow(k);
      return false;
    }
    if (!unsaved(k) || !differs(m.work, fresh)) {
      // Nothing of the owner's to protect: show the newer menu.
      adopt();
      m.work = clone(fresh);
      m.open = null;
      setBar(k, "none");
      keepNow(k);
      return true;
    }
    m.latest = row;
    setBar(k, "conflict");
    announce(barText(k));
    return false;
  }

  // -- unsaved changes

  // Call after every change to a working copy.
  function changed(k) {
    const m = M[k];
    m.changedAt = Date.now();
    m.restoredAt = null;
    clearTimeout(m.savedTimer);
    const dirty = unsaved(k);
    if (m.bar === "conflict") {
      // Typed back to what the database has: there is no conflict left.
      if (!differs(m.work, tidyMenu(m.latest, true))) {
        m.saved = tidyMenu(m.latest, true);
        m.version = m.latest.version;
        m.updatedAt = m.latest.updated_at;
        m.latest = null;
        m.bar = "none";
      }
    } else if (dirty && (m.bar === "none" || m.bar === "saved")) {
      m.bar = "unsaved";
      if (k === kind) announce("Not saved.");
    } else if (!dirty && m.bar !== "saving" && m.sent === null) {
      // (After a save with no answer the bar stays: the site may hold that save, and only
      // another save finds out.)
      if (m.bar !== "none" && k === kind) announce("");
      m.bar = "none";
    }
    keepSoon(k);
    drawMenuChrome();
  }
  function setBar(k, state) {
    const m = M[k];
    clearTimeout(m.savedTimer);
    m.bar = state;
    if (state === "saved") {
      m.savedTimer = setTimeout(() => {
        if (m.bar === "saved") {
          m.bar = "none";
          drawMenuChrome();
        }
      }, 4000);
    }
    drawMenuChrome();
  }
  const stamp = (t) => receivedAt(typeof t === "number" ? new Date(t).toISOString() : t);
  function barText(k) {
    const m = M[k];
    if (m.bar === "unsaved") return "Not saved." + (m.restoredAt ? " Changes from " + stamp(m.restoredAt) + "." : "");
    if (m.bar === "saving") return "Saving…";
    if (m.bar === "saved") return "Saved.";
    if (m.bar === "failed") return "Couldn't save. Try again." + (canKeep ? " Your changes are kept on this device." : "");
    if (m.bar === "conflict") return "Changed on another device, " + stamp(m.latest.updated_at) + ". Your changes aren't saved.";
    return "";
  }

  // Everything around the lists: the bar, the dots, the status lines.
  let leaveWarning = false;
  function drawMenuChrome() {
    const m = M[kind];
    const bar = $("m-bar");
    const state = m.work ? m.bar : "none";
    const hadFocus = bar.contains(document.activeElement);
    bar.hidden = state === "none";
    bar.classList.toggle("two", state === "conflict");
    $("m-bar-text").textContent = barText(kind);
    const save = $("m-save");
    $("m-discard").hidden = state !== "unsaved" && state !== "failed";
    $("m-latest").hidden = state !== "conflict";
    save.hidden = state === "saved" || state === "none";
    save.textContent = state === "saving" ? "saving…" : state === "conflict" ? "save mine" : "save";
    if (state === "saving") save.setAttribute("aria-disabled", "true");
    else save.removeAttribute("aria-disabled");
    $("m-bar-acts").hidden = state === "saved" || state === "none";
    // The button that had focus has gone: keep the owner's place without moving the page.
    if (hadFocus && (bar.hidden || !bar.contains(document.activeElement) || document.activeElement.hidden)) {
      const radio = document.querySelector('input[name="m-kind"]:checked');
      if (radio && menuTabOpen()) radio.focus({ preventScroll: true });
    }
    document.documentElement.classList.toggle("m-bar-on", !bar.hidden && menuTabOpen());

    const dirty = KINDS.filter(unsaved);
    KINDS.forEach((k) => ($("m-dot-" + k).hidden = !dirty.includes(k)));
    $("m-tab-dot").hidden = !dirty.length;
    if (Boolean(dirty.length) !== leaveWarning) {
      leaveWarning = Boolean(dirty.length);
      if (leaveWarning) window.addEventListener("beforeunload", warnOnLeave);
      else window.removeEventListener("beforeunload", warnOnLeave);
    }

    $("m-help").hidden = !(m.work && m.work.sections.length);
    drawMenuStatus();
  }

  // What guests can see of each menu right now. Also drawn whenever the dinner dates are.
  let statusDrawnFrom = null;
  function drawMenuStatus() {
    const status = $("m-status");
    const hint = $("dinner-menu-hint");
    if (!menusLoaded) {
      status.textContent = "";
      hint.hidden = true;
      statusDrawnFrom = null;
      return;
    }
    const listed = dinnerLoaded
      ? dinnerNow(dinners.map((d) => ({ date: d.service_date, first: hhmm(d.first_seating), last: hhmm(d.last_seating) }))).listed.length > 0
      : null;
    // What the site has: during a conflict that is the newer row, not this page's older copy.
    const onSite = (x) => (x.latest ? { menu: tidyMenu(x.latest, true), at: x.latest.updated_at } : { menu: x.saved, at: x.updatedAt });
    const here = onSite(M[kind]);
    const filled = hasDishes(here.menu);
    const savedAt = filled && here.at ? " Last saved " + stamp(here.at) + "." : "";
    let text;
    let seen = false;
    let bad = false;
    if (kind === "lunch") {
      text = filled ? "Shown on the home page." + savedAt : "Empty, so the home page points guests to Instagram.";
      seen = filled;
    } else {
      text = "Shown on the home page only while a dinner date is listed.";
      if (listed === true) {
        text += filled ? " One is listed now." : " One is listed now, and this menu is empty.";
        bad = !filled;
        seen = filled;
      } else if (listed === false) {
        text += " None is listed now.";
      }
      text += savedAt;
    }
    const evening = onSite(M.dinner);
    const dinnerFilled = hasDishes(evening.menu);
    const hintText = dinnerFilled
      ? "Guests see the dinner menu while a date is listed." + (evening.at ? " Last saved " + stamp(evening.at) + "." : "")
      : "The dinner menu is empty, so guests see none.";
    // Redrawn only when what they say changes, so a control in them is never replaced under the keyboard.
    const drawnFrom = JSON.stringify([kind, text, seen, bad, listed, hintText]);
    if (drawnFrom === statusDrawnFrom) return;
    statusDrawnFrom = drawnFrom;

    status.textContent = text;
    status.classList.toggle("bad", bad);
    if (seen) {
      const view = el("a", "view", "link");
      view.href = "index.html#" + (kind === "lunch" ? "menu" : "dinner-menu");
      view.target = "_blank";
      view.rel = "noopener";
      view.setAttribute("aria-label", "View the " + (kind === "lunch" ? "menu" : "dinner menu") + " on the home page");
      status.append(" ", view);
    }

    // On the dinner tab: adding a date makes whatever dinner menu was saved last public again.
    hint.hidden = listed !== true;
    hint.classList.toggle("bad", !dinnerFilled);
    hint.textContent = hintText;
    const go = el("button", "dinner menu", "textbtn");
    go.type = "button";
    go.addEventListener("click", () => {
      pickMenu("dinner");
      selectTab("menu", true);
    });
    hint.append(" ", go);
  }

  function pickMenu(k) {
    kind = k;
    document.querySelectorAll('input[name="m-kind"]').forEach((r) => (r.checked = r.value === k));
    KINDS.forEach((x) => ($("m-list-" + x).hidden = x !== k));
    drawMenuChrome();
  }
  document.querySelectorAll('input[name="m-kind"]').forEach((r) => r.addEventListener("change", () => pickMenu(r.value)));

  // -- drawing a menu

  // The whole list is rebuilt from the working copy and swapped in at once, so the page never
  // stands shorter in between and the scroll position holds. `focus` says where the keyboard
  // goes afterwards: { note } { head: sec } { item } { add: sec } { addSec } { field } { move }.
  function render(k, focus) {
    const m = M[k];
    const refs = { heads: new Map(), items: new Map(), adds: new Map(), fields: {} };
    m.refs = refs;
    const o = m.open;
    const frag = document.createDocumentFragment();

    if (o && o.type === "note") {
      frag.append(noteEditor(k, refs));
    } else {
      const row = el("button", null, "m-row m-note-row");
      row.type = "button";
      const text = el("span", null, "m-text");
      text.append(el("span", "note", "m-k"));
      text.append(m.work.note ? document.createTextNode(m.work.note) : el("span", "add a note", "m-add-note"));
      row.append(text);
      row.addEventListener("click", () => openRow(k, { type: "note" }, "note"));
      refs.note = row;
      frag.append(row);
    }

    m.work.sections.forEach((sec) => {
      const box = el("div", null, "m-sec");
      const title = squash(sec.title);
      if (o && o.type === "head" && o.sec === sec) {
        box.append(headEditor(k, sec, refs));
      } else {
        const h = el("h2");
        const row = el("button", null, "m-row m-head");
        row.type = "button";
        if (title) {
          row.append(el("span", title, "m-text"));
        } else {
          const text = el("span", null, "m-text");
          text.append(el("span", "no heading", "m-none"));
          row.append(text);
          row.setAttribute("aria-label", "Section with no heading");
        }
        row.addEventListener("click", () => openRow(k, { type: "head", sec }, "title"));
        refs.heads.set(sec, row);
        h.append(row);
        box.append(h);
        if (title && !sec.items.length) box.append(el("p", "No items yet. Guests don't see this section.", "hint"));
      }
      const ul = el("ul", null, "m-items");
      sec.items.forEach((item) => {
        const li = el("li");
        if (o && o.type === "item" && o.item === item) {
          li.append(itemEditor(k, sec, item, refs));
        } else {
          const row = el("button", null, "m-row");
          row.type = "button";
          const text = el("span", squash(item.name) || "(no name)", "m-text");
          if (squash(item.desc)) text.append(el("span", squash(item.desc), "m-desc"));
          row.append(text, el("span", squash(item.price), "m-side"));
          // A tap on the price opens the row with Price ready, on the description with that.
          row.addEventListener("click", (e) => {
            const on = e.target instanceof Element ? e.target : null;
            openRow(k, { type: "item", sec, item }, on && on.closest(".m-side") ? "price" : on && on.closest(".m-desc") ? "desc" : "name");
          });
          refs.items.set(item, row);
          li.append(row);
        }
        ul.append(li);
      });
      box.append(ul);
      if (sec.items.length >= MENU_LIMITS.items) {
        box.append(el("p", MENU_LIMITS.items + " items at most in a section.", "hint"));
      } else {
        const add = el("button", null, "m-add");
        add.type = "button";
        add.append(el("span", "add item"));
        add.setAttribute("aria-label", title ? "Add item to " + title : "Add item");
        add.addEventListener("click", () => addItem(k, sec));
        refs.adds.set(sec, add);
        box.append(add);
      }
      frag.append(box);
    });

    if (!m.work.sections.length) frag.append(el("p", "Nothing on this menu yet.", "empty"));
    if (m.work.sections.length >= MENU_LIMITS.sections) {
      frag.append(el("p", MENU_LIMITS.sections + " sections at most.", "hint"));
    } else {
      const add = el("button", null, "m-add m-add-sec");
      add.type = "button";
      add.append(el("span", "add section"));
      add.addEventListener("click", () => addSection(k));
      refs.addSec = add;
      frag.append(add);
    }

    $("m-list-" + k).replaceChildren(frag);
    Object.values(refs.fields).forEach((f) => {
      if (f.tagName === "TEXTAREA") grow(f);
    });
    if (focus) focusOn(k, focus);
  }

  function focusOn(k, f) {
    const refs = M[k].refs;
    let target = null;
    if (f.field) {
      target = refs.fields[f.field];
      if (target) {
        target.focus();
        // Selected, so typing replaces it and a tap inside places the caret.
        try { target.setSelectionRange(0, target.value.length); } catch (e) { /* not a text field */ }
      }
      return;
    }
    if (f.note) target = refs.note;
    else if (f.head) target = refs.heads.get(f.head);
    else if (f.item) target = refs.items.get(f.item);
    else if (f.add) target = refs.adds.get(f.add) || refs.addSec;
    if (f.addSec || !target) target = target || refs.addSec || refs.note;
    if (target) target.focus();
  }

  // -- the editors

  const grow = (t) => {
    t.style.height = "auto";
    t.style.height = t.scrollHeight + (t.offsetHeight - t.clientHeight) + "px";
  };

  // One labelled field of an editor. Typing is mirrored into the working copy by `set`.
  function editField(k, refs, key, label, optional, max, value, set, multiline) {
    const box = el("div", null, "field");
    const input = el(multiline ? "textarea" : "input");
    if (multiline) input.rows = 1;
    else input.type = "text";
    input.id = "m-f-" + key + "-" + k;
    input.maxLength = max;
    input.value = value;
    input.setAttribute("autocomplete", "off");
    if (key !== "note") {
      input.setAttribute("autocapitalize", "none");
      input.setAttribute("autocorrect", "off");
      input.spellcheck = false;
    }
    const lab = el("label", label);
    lab.htmlFor = input.id;
    if (optional) lab.append(" ", el("span", "optional", "optional"));
    const error = el("p", null, "field-error");
    error.id = "m-e-" + key + "-" + k;
    const count = el("p", null, "m-count");
    count.id = "m-c-" + key + "-" + k;
    input.setAttribute("aria-describedby", error.id + " " + count.id);
    const showCount = () => {
      // Typing stops at the limit; from ten characters before it, say how much room is left.
      count.textContent = max - input.value.length <= 10 ? input.value.length + " / " + max : "";
    };
    input.addEventListener("input", () => {
      // A line break is never kept: one that arrives (a paste, some keyboards) becomes a space.
      if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/\s*[\r\n]+\s*/g, " ");
      set(input.value);
      error.textContent = "";
      input.removeAttribute("aria-invalid");
      showCount();
      if (multiline) grow(input);
      changed(k);
    });
    showCount();
    box.append(lab, input, error, count);
    refs.fields[key] = input;
    return { box, input };
  }

  // Enter moves on through the fields and then closes the editor. It never adds a line and
  // never saves. Some phone keyboards send it only as a "line break" input, so both are heard.
  function onEnter(input, go) {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      go();
    });
    if (input.tagName === "TEXTAREA") {
      input.addEventListener("beforeinput", (e) => {
        if (e.inputType !== "insertLineBreak" && e.inputType !== "insertParagraph") return;
        e.preventDefault();
        go();
      });
    }
  }
  const toField = (k, key) => focusOn(k, { field: key });

  function editorBox(k, label) {
    const box = el("div", null, "m-edit");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", label);
    // Esc puts the row back as it was when it was opened.
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelEdit(k);
    });
    return box;
  }
  // "done" on the left; "up" and "down" on the right; "remove" alone on a row of its own.
  function editorActions(k, box, name, what, move, canMove, remove, removeLabel) {
    const acts = el("div", null, "m-acts");
    const doneBtn = el("button", "done", "btn");
    doneBtn.type = "button";
    // On a dish the button only closes it; carrying on to the next new dish is for Enter.
    doneBtn.addEventListener("click", () => (what === "item" ? done(k, { focus: true }) : finish(k)));
    acts.append(doneBtn);
    if (move) {
      const moves = el("div", null, "m-move");
      [["up", -1], ["down", 1]].forEach(([word, dir]) => {
        const b = el("button", word);
        b.type = "button";
        b.disabled = !canMove(dir);
        b.setAttribute("aria-label", ["Move", what === "section" ? "section" : "", name || (what === "section" ? "" : "item"), word].filter(Boolean).join(" "));
        b.addEventListener("click", () => move(dir));
        M[k].refs[word] = b;
        moves.append(b);
      });
      acts.append(moves);
    }
    box.append(acts);
    if (remove) {
      const last = el("div", null, "m-last");
      const b = el("button", removeLabel, "textbtn danger");
      b.type = "button";
      b.setAttribute("aria-label", ["Remove", what === "section" ? "section" : "", name || (what === "section" ? "" : "item")].filter(Boolean).join(" "));
      b.addEventListener("click", remove);
      last.append(b);
      box.append(last);
    }
  }

  function noteEditor(k, refs) {
    const m = M[k];
    const box = editorBox(k, "Edit note");
    const f = editField(k, refs, "note", "Note", true, MENU_LIMITS.note, m.work.note, (v) => (m.work.note = v), true);
    f.input.setAttribute("enterkeyhint", "done");
    onEnter(f.input, () => finish(k));
    box.append(f.box, el("p", "A short line above the menu.", "hint"));
    editorActions(k, box);
    return box;
  }

  function headEditor(k, sec, refs) {
    const m = M[k];
    const title = squash(sec.title);
    const box = editorBox(k, m.open.isNew ? "New section" : title ? "Edit heading " + title : "Edit heading");
    const f = editField(k, refs, "title", "Heading", true, MENU_LIMITS.title, sec.title, (v) => (sec.title = v));
    f.input.classList.add("m-title");
    f.input.setAttribute("enterkeyhint", "done");
    onEnter(f.input, () => finish(k));
    box.append(f.box);
    const secs = m.work.sections;
    editorActions(
      k, box, title, "section",
      (dir) => moveSection(k, dir),
      (dir) => (dir < 0 ? secs.indexOf(sec) > 0 : secs.indexOf(sec) < secs.length - 1),
      () => removeSection(k), "remove section"
    );
    return box;
  }

  function itemEditor(k, sec, item, refs) {
    const m = M[k];
    const name = squash(item.name);
    const title = squash(sec.title);
    const box = editorBox(k, m.open.isNew ? (title ? "New item in " + title : "New item") : "Edit " + (name || "item"));
    const n = editField(k, refs, "name", "Name", false, MENU_LIMITS.name, item.name, (v) => (item.name = v));
    const d = editField(k, refs, "desc", "Description", true, MENU_LIMITS.desc, item.desc, (v) => (item.desc = v), true);
    const p = editField(k, refs, "price", "Price", true, MENU_LIMITS.price, item.price, (v) => (item.price = v));
    p.input.classList.add("m-price");
    n.input.setAttribute("enterkeyhint", "next");
    d.input.setAttribute("enterkeyhint", "next");
    p.input.setAttribute("enterkeyhint", m.open.isNew ? "next" : "done");
    // In a new dish with nothing typed, Enter closes it: that is how a run of new dishes ends.
    const blankNew = () => m.open && m.open.isNew && !KEYS.some((key) => squash(item[key]));
    onEnter(n.input, () => (blankNew() ? finish(k) : toField(k, "desc")));
    onEnter(d.input, () => (blankNew() ? finish(k) : toField(k, "price")));
    onEnter(p.input, () => finish(k));
    box.append(n.box, d.box, p.box);
    editorActions(k, box, name, "item", (dir) => moveItem(k, dir), (dir) => canMoveItem(k, dir), () => removeItem(k), "remove");
    return box;
  }

  // -- opening and closing a row

  function openRow(k, o, field) {
    const m = M[k];
    if (m.saving) return;
    if (m.open && !done(k, {})) return; // the open dish needs a name first
    if (o.type === "head" && !m.work.sections.includes(o.sec)) return;
    if (o.type === "item" && !o.sec.items.includes(o.item)) return;
    o.before = o.type === "note" ? m.work.note : o.type === "head" ? o.sec.title : clone(o.item);
    m.open = o;
    render(k, { field });
  }

  // A section with no heading and no dishes is not kept.
  function dropIfBare(m, sec) {
    if (squash(sec.title) || sec.items.length) return false;
    m.work.sections.splice(m.work.sections.indexOf(sec), 1);
    return true;
  }

  // Tidy and close the open editor. Returns false, leaving it open, if a dish has a
  // description or price but no name. `opts.focus` puts the keyboard on what was closed;
  // `opts.chain` is the Enter key carrying on to the next new dish; `opts.keep` is a section
  // that is about to be given a dish, so it stays even if it is bare for the moment.
  function done(k, opts) {
    const m = M[k];
    const o = m.open;
    if (!o) return true;
    let focus;
    if (o.type === "note") {
      m.work.note = squash(m.work.note);
      focus = { note: true };
    } else if (o.type === "head") {
      o.sec.title = squash(o.sec.title);
      focus = { head: o.sec };
      // A new section is kept for the moment when its first dish is about to be typed.
      if (!(o.isNew && opts.chain) && o.sec !== opts.keep && dropIfBare(m, o.sec)) focus = { addSec: true };
    } else {
      const it = o.item;
      KEYS.forEach((key) => (it[key] = squash(it[key])));
      if (!it.name && (it.desc || it.price)) {
        if (!m.refs.fields.name) render(k);
        const input = m.refs.fields.name;
        $("m-e-name-" + k).textContent = "Add a name.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return false;
      }
      focus = { item: it };
      if (!it.name) {
        // Nothing typed: the dish goes, without asking.
        o.sec.items.splice(o.sec.items.indexOf(it), 1);
        focus = o.sec !== opts.keep && dropIfBare(m, o.sec) ? { addSec: true } : { add: o.sec };
      }
    }
    m.open = null;
    changed(k);
    render(k, opts.focus ? focus : null);
    return true;
  }
  // The "done" button, and Enter on the last field. From a new dish, Enter goes straight on
  // to the next new dish, so a whole section can be typed without leaving the keyboard; from
  // a new section it goes on to that section's first dish.
  function finish(k) {
    const m = M[k];
    const o = m.open;
    if (!o) return;
    const typed = o.type === "item" && KEYS.some((key) => squash(o.item[key]));
    if (!done(k, { focus: true, chain: true })) return;
    if (!o.isNew) return;
    if (o.type === "head" && m.work.sections.includes(o.sec)) addItem(k, o.sec);
    else if (o.type === "item" && typed && m.work.sections.includes(o.sec)) addItem(k, o.sec);
  }

  // Esc: the fields go back to what they were when the editor opened. A new dish or section
  // that was never closed goes.
  function cancelEdit(k) {
    const m = M[k];
    const o = m.open;
    if (!o) return;
    let focus;
    if (o.type === "note") {
      m.work.note = o.before;
      focus = { note: true };
    } else if (o.type === "head") {
      o.sec.title = o.before;
      focus = { head: o.sec };
      if (o.isNew) {
        m.work.sections.splice(m.work.sections.indexOf(o.sec), 1);
        focus = { addSec: true };
      }
    } else if (o.isNew) {
      o.sec.items.splice(o.sec.items.indexOf(o.item), 1);
      focus = dropIfBare(m, o.sec) ? { addSec: true } : { add: o.sec };
    } else {
      Object.assign(o.item, o.before);
      focus = { item: o.item };
    }
    m.open = null;
    changed(k);
    render(k, focus);
  }

  // -- add, move, remove

  function addItem(k, sec) {
    const m = M[k];
    if (m.saving) return;
    if (m.open && !done(k, { keep: sec })) return;
    if (!m.work.sections.includes(sec) || sec.items.length >= MENU_LIMITS.items) return;
    const item = { name: "", desc: "", price: "" };
    sec.items.push(item);
    m.open = { type: "item", sec, item, isNew: true };
    render(k, { field: "name" });
  }
  function addSection(k) {
    const m = M[k];
    if (m.saving) return;
    if (m.open && !done(k, {})) return;
    if (m.work.sections.length >= MENU_LIMITS.sections) return;
    const sec = { title: "", items: [] };
    m.work.sections.push(sec);
    m.open = { type: "head", sec, isNew: true };
    render(k, { field: "title" });
    drawMenuChrome();
  }

  // Redraw after a move with the pressed button still under the thumb: scroll by exactly the
  // distance it travelled, and keep the keyboard on it (or on its twin if it is now disabled).
  function redrawAfterMove(k, dir) {
    const m = M[k];
    const word = dir < 0 ? "up" : "down";
    const was = m.refs[word] ? m.refs[word].getBoundingClientRect().top : null;
    changed(k);
    render(k);
    let button = m.refs[word];
    if (button && button.disabled) button = m.refs[dir < 0 ? "down" : "up"];
    if (!button) return;
    if (was !== null) {
      const moved = button.getBoundingClientRect().top - was;
      if (moved) window.scrollBy({ top: moved, behavior: "instant" });
    }
    button.focus({ preventScroll: true });
  }

  function canMoveItem(k, dir) {
    const m = M[k];
    const o = m.open;
    const secs = m.work.sections;
    const si = secs.indexOf(o.sec);
    const ii = o.sec.items.indexOf(o.item);
    if (dir < 0) return ii > 0 || (si > 0 && secs[si - 1].items.length < MENU_LIMITS.items);
    return ii < o.sec.items.length - 1 || (si < secs.length - 1 && secs[si + 1].items.length < MENU_LIMITS.items);
  }
  // One place up or down. Past the edge of a section the dish moves into the next one.
  function moveItem(k, dir) {
    const m = M[k];
    const o = m.open;
    if (m.saving || !o || o.type !== "item" || !canMoveItem(k, dir)) return;
    const secs = m.work.sections;
    const items = o.sec.items;
    const ii = items.indexOf(o.item);
    const to = ii + dir;
    if (to >= 0 && to < items.length) {
      items.splice(ii, 1);
      items.splice(to, 0, o.item);
    } else {
      const from = o.sec;
      const next = secs[secs.indexOf(from) + dir];
      items.splice(ii, 1);
      if (dir < 0) next.items.push(o.item);
      else next.items.unshift(o.item);
      o.sec = next;
      dropIfBare(m, from);
    }
    redrawAfterMove(k, dir);
    const title = squash(o.sec.title);
    announce((squash(o.item.name) || "Item") + ", " + (o.sec.items.indexOf(o.item) + 1) + " of " + o.sec.items.length + (title ? " in " + title : "") + ".");
  }
  function moveSection(k, dir) {
    const m = M[k];
    const o = m.open;
    if (m.saving || !o || o.type !== "head") return;
    const secs = m.work.sections;
    const si = secs.indexOf(o.sec);
    const to = si + dir;
    if (to < 0 || to >= secs.length) return;
    secs.splice(si, 1);
    secs.splice(to, 0, o.sec);
    redrawAfterMove(k, dir);
    const title = squash(o.sec.title);
    announce((title ? title + ", section " : "Section ") + (to + 1) + " of " + secs.length + ".");
  }

  function removeItem(k) {
    const m = M[k];
    const o = m.open;
    if (m.saving || !o || o.type !== "item") return;
    const name = squash(o.item.name);
    const blank = !KEYS.some((key) => squash(o.item[key]));
    if (!blank && !window.confirm(name ? "Remove “" + name + "”?" : "Remove this item?")) return;
    const items = o.sec.items;
    const i = items.indexOf(o.item);
    items.splice(i, 1);
    const focus = items[i] ? { item: items[i] } : items[i - 1] ? { item: items[i - 1] } : dropIfBare(m, o.sec) ? { addSec: true } : { add: o.sec };
    m.open = null;
    changed(k);
    render(k, focus);
    announce(name ? "Removed " + name + "." : "Removed item.");
  }
  function removeSection(k) {
    const m = M[k];
    const o = m.open;
    if (m.saving || !o || o.type !== "head") return;
    const title = squash(o.sec.title);
    const n = o.sec.items.length;
    if (title || n) {
      const question = title
        ? "Remove “" + title + "”" + (n ? " and its " + plural(n) : "") + "?"
        : "Remove this section and its " + plural(n) + "?";
      if (!window.confirm(question)) return;
    }
    const secs = m.work.sections;
    const i = secs.indexOf(o.sec);
    secs.splice(i, 1);
    const focus = secs[i] ? { head: secs[i] } : secs[i - 1] ? { head: secs[i - 1] } : { addSec: true };
    m.open = null;
    changed(k);
    render(k, focus);
    announce(title ? "Removed " + title + "." : "Removed section.");
  }

  // -- saving

  // One request with a time limit; resolves to { data, error } like any other query here.
  async function within(ms, build) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await build().abortSignal(ctrl.signal);
    } catch (err) {
      return { data: null, error: err };
    } finally {
      clearTimeout(timer);
    }
  }

  // `mine` is "save mine": the owner has chosen to save over a newer menu.
  async function saveMenu(k, mine) {
    const m = M[k];
    if (m.saving || !m.work) return;
    const list = $("m-list-" + k);
    // Ctrl/Cmd+S can come from inside the list: keep the owner's place there.
    if (m.open && !done(k, { focus: list.contains(document.activeElement) })) return;
    // A dish with no name can only have come back from a kept copy: have it named first.
    for (const sec of m.work.sections) {
      const nameless = sec.items.find((it) => !squash(it.name) && (squash(it.desc) || squash(it.price)));
      if (nameless) {
        m.open = { type: "item", sec, item: nameless, before: clone(nameless) };
        render(k);
        return void done(k, {});
      }
    }
    if (mine && m.latest) {
      // From here the menu just read is the one being replaced. (Only now: had a check above
      // stopped the save, the choice between the two menus must still be on offer.)
      m.saved = tidyMenu(m.latest, true);
      m.version = m.latest.version;
      m.updatedAt = m.latest.updated_at;
      m.latest = null;
      m.bar = "unsaved";
    }
    // Nothing to send, unless an earlier save went unanswered: then only asking again tells
    // whether the site has it.
    if (!unsaved(k) && m.sent === null) return setBar(k, "none");

    const place = list.contains(document.activeElement) ? document.activeElement : null;
    m.saving = true;
    list.inert = true;
    list.setAttribute("aria-busy", "true");
    setBar(k, "saving");
    announce("Saving…");
    let outcome = "failed";
    let sentNow = null;
    try {
      // Twice at most: the second time only after finding that an earlier save, whose answer
      // was lost, had in fact been stored.
      for (let attempt = 0; attempt < 2; attempt++) {
        const sending = tidyMenu(m.work, true);
        sentNow = JSON.stringify(sending);
        const put = await within(15000, () =>
          sb.from("menus").update({ note: sending.note, sections: sending.sections }).eq("kind", k).eq("version", m.version).select(ROW)
        );
        if (M[k] !== m) return; // signed out meanwhile
        if (put.error) throw put.error;
        const take = (row) => {
          m.saved = tidyMenu(row, true);
          m.version = row.version;
          m.updatedAt = row.updated_at;
          m.latest = null;
          m.sent = null;
        };
        if (put.data && put.data.length === 1) {
          take(put.data[0]);
          outcome = "saved";
          break;
        }
        // Refused: the menu has a newer version, or this account may no longer change it.
        const got = await within(15000, () => sb.from("menus").select(ROW).eq("kind", k));
        if (M[k] !== m) return;
        if (got.error || !got.data || got.data.length !== 1) throw got.error || new Error("not read");
        const row = got.data[0];
        const theirs = JSON.stringify(tidyMenu(row, true));
        if (theirs === sentNow || (m.sent !== null && theirs === m.sent)) {
          // It is this page's own save, from a try whose answer never arrived.
          take(row);
          if (!unsaved(k)) {
            outcome = "saved";
            break;
          }
          continue; // changes made since then still need sending
        }
        if (row.version !== m.version) {
          m.latest = row;
          outcome = "conflict";
        }
        break;
      }
    } catch (err) {
      m.sent = sentNow; // no answer does not mean it was not stored
      outcome = "failed";
    }
    if (M[k] !== m) return;
    m.saving = false;
    list.inert = false;
    list.removeAttribute("aria-busy");
    if (outcome === "saved") {
      // The database's own form of what was sent; redraw only if it differs from the screen.
      if (!same(m.work, m.saved)) {
        m.work = clone(m.saved);
        render(k);
      }
      keepNow(k);
      // The home page in this browser would otherwise show its remembered menu for a moment.
      try { localStorage.removeItem(MENUS_KEY); } catch (e) { /* nothing stored */ }
    }
    setBar(k, outcome);
    announce(barText(k));
    // While it saved the list could not hold focus: put the keyboard back where it was.
    if (place && k === kind && menuTabOpen() && (!document.activeElement || document.activeElement === document.body)) {
      const to = place.isConnected ? place : document.querySelector('input[name="m-kind"]:checked');
      if (to) to.focus({ preventScroll: true });
    }
  }

  $("m-save").addEventListener("click", () => {
    const m = M[kind];
    if (m.saving) return;
    const mine = m.bar === "conflict";
    if (mine && !window.confirm("Save your menu over the latest? The other changes will be lost.")) return;
    saveMenu(kind, mine);
  });
  $("m-discard").addEventListener("click", () => {
    const m = M[kind];
    if (m.saving || !window.confirm("Discard your changes to the " + kind + " menu?")) return;
    const unanswered = m.sent !== null; // a save that may have been stored all the same
    m.work = clone(m.saved);
    m.open = null;
    m.sent = null;
    render(kind);
    setBar(kind, "none");
    keepNow(kind);
    announce("Changes discarded.");
    if (unanswered) loadMenus(); // show what the site really has
  });
  $("m-latest").addEventListener("click", () => {
    const m = M[kind];
    if (m.saving || !m.latest || !window.confirm("Load the latest menu? Your changes will be lost.")) return;
    m.saved = tidyMenu(m.latest, true);
    m.version = m.latest.version;
    m.updatedAt = m.latest.updated_at;
    m.latest = null;
    m.sent = null;
    m.work = clone(m.saved);
    m.open = null;
    render(kind);
    setBar(kind, "none");
    keepNow(kind);
    announce("Loaded the latest menu.");
  });
  // Ctrl/Cmd+S on the menu tab saves the menu on screen, and never opens the browser's own dialog.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || String(e.key).toLowerCase() !== "s") return;
    if ($("view-app").hidden || !menuTabOpen()) return;
    e.preventDefault();
    const m = M[kind];
    if (m.work && (m.bar === "unsaved" || m.bar === "failed")) saveMenu(kind);
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
    loadMenus(); // a menu with unsaved changes is never replaced, only compared
  });
})();
