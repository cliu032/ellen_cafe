// Shared by every page: small helpers, then everything on the page that is filled in from
// assets/config.js or from Supabase. Text is only ever written with textContent, never as HTML.
(function () {
  const C = window.CAFE;
  const R = C.reservation || {};
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // "14:30" -> "2:30pm"
  const fmtTime = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return ((h + 11) % 12) + 1 + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm");
  };
  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);

  // Dates are plain "YYYY-MM-DD" strings in the café's timezone. UTC is only used as a neutral
  // calendar for arithmetic, so the visitor's own timezone can never shift a day.
  const asUTC = (s) => new Date(s + "T00:00:00Z");
  const addDays = (s, n) => {
    const d = asUTC(s);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekdayOf = (s) => asUTC(s).getUTCDay();
  const fmtDate = (s, opts) => asUTC(s).toLocaleDateString("en-AU", Object.assign({ timeZone: "UTC" }, opts));
  // "Fri 4 Dec"
  const shortDate = (s) => fmtDate(s, { weekday: "short" }) + " " + fmtDate(s, { day: "numeric", month: "short" });

  // Current date and time at the café, whatever the visitor's own timezone is.
  const cafeNow = () => {
    const parts = {};
    try {
      new Intl.DateTimeFormat("en-CA", {
        timeZone: C.timezone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).formatToParts(new Date()).forEach((p) => (parts[p.type] = p.value));
    } catch (e) {
      const d = new Date();
      Object.assign(parts, {
        year: d.getFullYear(), month: pad(d.getMonth() + 1), day: pad(d.getDate()),
        hour: d.getHours(), minute: d.getMinutes(),
      });
    }
    const date = parts.year + "-" + parts.month + "-" + parts.day;
    return { date, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayOf(date) };
  };

  // ---------------------------------------------------------------- dinner dates

  // Daytime service is walk-in only. Dinner runs on evenings the owner picks in the owner
  // area; those dates and their seating times are read from Supabase. The last answer is
  // remembered in this browser so a returning visitor sees the right page at once.
  const SB = C.supabase || {};
  const hasBackend = Boolean(SB.url && SB.publishableKey);
  const base = hasBackend ? SB.url.replace(/\/+$/, "") : "";
  const DINNER_KEY = "ellen.dinner";
  const TIME = /^([01]\d|2[0-3]):[0-5]\d/;

  // Rows as the API returns them -> [{ date, first, last }], from today on, soonest first.
  function tidyDinner(rows) {
    if (!Array.isArray(rows)) return [];
    const today = cafeNow().date;
    const seen = {};
    return rows
      .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.service_date) && TIME.test(r.first_seating) && TIME.test(r.last_seating))
      .map((r) => ({ date: r.service_date, first: r.first_seating.slice(0, 5), last: r.last_seating.slice(0, 5) }))
      .filter((r) => r.date >= today && toMin(r.last) >= toMin(r.first) && !seen[r.date] && (seen[r.date] = true))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // The times that can still be asked for on one evening: every slotMinutes from its first
  // seating to its last. For tonight, only times far enough ahead, and none at all once the
  // optional same-day closing time has passed. This one rule decides, on every page, whether
  // an evening is still "on offer".
  function slots(row) {
    if (!row) return [];
    const now = cafeNow();
    if (row.date < now.date) return [];
    let earliest = 0;
    if (row.date === now.date) {
      if (R.sameDayCloses && now.minutes >= toMin(R.sameDayCloses)) return [];
      earliest = now.minutes + (R.minNoticeMinutes || 0);
    }
    const step = R.slotMinutes || 30;
    const out = [];
    for (let m = toMin(row.first); m <= toMin(row.last); m += step) if (m >= earliest) out.push(fromMin(m));
    return out;
  }

  // What the dates mean right now.
  //   listed  — evenings still to come (tonight counts until its last seating has passed)
  //   open    — listed evenings that can still be requested
  //   tonight — tonight's evening, while listed
  function dinnerNow(dates) {
    const now = cafeNow();
    const listed = dates.filter((d) => d.date > now.date || (d.date === now.date && now.minutes <= toMin(d.last)));
    return {
      listed,
      open: listed.filter((d) => slots(d).length),
      tonight: listed.find((d) => d.date === now.date) || null,
    };
  }

  function rememberedDinner() {
    try {
      const saved = JSON.parse(localStorage.getItem(DINNER_KEY));
      return saved && Array.isArray(saved.rows) ? tidyDinner(saved.rows) : null;
    } catch (e) {
      return null;
    }
  }
  async function fetchDinner() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        base + "/rest/v1/dinner_services?select=service_date,first_seating,last_seating" +
          "&service_date=gte." + cafeNow().date + "&order=service_date.asc&limit=200",
        { headers: { apikey: SB.publishableKey }, signal: ctrl.signal }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error("not a list");
      try {
        localStorage.setItem(DINNER_KEY, JSON.stringify({ rows }));
      } catch (e) { /* private browsing: nothing to keep */ }
      return tidyDinner(rows);
    } finally {
      clearTimeout(timer);
    }
  }

  // onDinner(fn): fn(dates, settled, failed).
  //   - runs at once with the remembered dates, if this browser has any (settled = false);
  //   - runs again when the current dates arrive (settled = true);
  //   - if they cannot be fetched, the remembered ones stand; with none remembered,
  //     failed = true, which is not the same as "there are no dinner dates";
  //   - runs once a minute after that, because what is on offer changes as time passes.
  const listeners = [];
  let known = rememberedDinner();
  let settled = !hasBackend;
  let failed = false;
  if (settled) known = [];
  const tell = () => {
    if (known || settled) listeners.forEach((fn) => fn(known || [], settled, failed));
  };
  const onDinner = (fn) => {
    listeners.push(fn);
    if (known || settled) fn(known || [], settled, failed);
  };
  function loadDinner() {
    return fetchDinner()
      .then((rows) => {
        known = rows;
        failed = false;
      })
      .catch(() => {
        failed = !known;
      })
      .then(() => {
        settled = true;
        tell();
        calm();
      });
  }
  // Read the dates again (after the server has refused a request, say). Resolves when done.
  const refreshDinner = () => (hasBackend ? loadDinner() : Promise.resolve());
  if (hasBackend) loadDinner();

  // ---------------------------------------------------------------- menus: reading

  // The lunch and dinner menus are edited in the owner area (admin.html) and read from
  // Supabase. As with the dinner dates, the last answer is remembered in this browser, so a
  // returning visitor sees a menu at once. The database hands out the dinner menu only while
  // a dinner date is coming up.
  const MENUS_KEY = "ellen.menus";
  const MENU_LIMITS = { sections: 12, items: 40, title: 40, name: 80, desc: 200, price: 24, note: 200 };
  const oneLine = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

  // One menu in its tidy form: { note, sections: [{ title, items: [{ name, desc, price }] }] },
  // keys always in this order and every value a string ("" for none). Dishes without a name
  // are dropped, and so are sections left with none (the editor keeps those that have a
  // heading). Menus are only ever compared in this form: the database does not keep key order.
  function tidyMenu(row, keepEmptySections) {
    const out = { note: "", sections: [] };
    if (!row || typeof row !== "object") return out;
    out.note = oneLine(row.note, MENU_LIMITS.note);
    if (!Array.isArray(row.sections)) return out;
    row.sections.forEach((sec) => {
      if (!sec || typeof sec !== "object" || out.sections.length >= MENU_LIMITS.sections) return;
      const title = oneLine(sec.title, MENU_LIMITS.title);
      const items = (Array.isArray(sec.items) ? sec.items : [])
        .filter((i) => i && typeof i === "object" && oneLine(i.name, MENU_LIMITS.name))
        .slice(0, MENU_LIMITS.items)
        .map((i) => ({
          name: oneLine(i.name, MENU_LIMITS.name),
          desc: oneLine(i.desc, MENU_LIMITS.desc),
          price: oneLine(i.price, MENU_LIMITS.price),
        }));
      if (items.length || (keepEmptySections && title)) out.sections.push({ title, items });
    });
    return out;
  }
  // Rows as the API returns them -> { lunch, dinner }. A row that was not sent is an empty menu.
  function menusFrom(rows) {
    const find = (kind) => tidyMenu(rows.find((r) => r && r.kind === kind));
    return { lunch: find("lunch"), dinner: find("dinner") };
  }
  function rememberedMenus() {
    try {
      const saved = JSON.parse(localStorage.getItem(MENUS_KEY));
      return saved && Array.isArray(saved.rows) ? menusFrom(saved.rows) : null;
    } catch (e) {
      return null;
    }
  }
  async function fetchMenus() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(base + "/rest/v1/menus?select=kind,note,sections", {
        headers: { apikey: SB.publishableKey },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error("not a list");
      try {
        localStorage.setItem(MENUS_KEY, JSON.stringify({ rows }));
      } catch (e) { /* private browsing: nothing to keep */ }
      return menusFrom(rows);
    } finally {
      clearTimeout(timer);
    }
  }

  window.CAFE_UTIL = {
    fmtTime, toMin, asUTC, addDays, weekdayOf, fmtDate, shortDate, cafeNow, DAYS,
    onDinner, refreshDinner, slots, dinnerNow, tidyMenu, MENU_LIMITS, MENUS_KEY,
  };

  // ---------------------------------------------------------------- text from the config

  document.querySelectorAll("[data-cafe]").forEach((n) => {
    const v = C[n.dataset.cafe];
    if (v) n.textContent = v;
    else n.hidden = true;
  });
  if ($("year")) $("year").textContent = cafeNow().date.slice(0, 4);
  const ig = $("ig");
  if (ig) {
    ig.href = C.instagram;
    ig.textContent = "instagram " + C.instagramHandle;
  }
  document.querySelectorAll("[data-instagram]").forEach((a) => {
    a.href = C.instagram;
    a.textContent = "instagram " + C.instagramHandle;
  });
  if (C.mapUrl) document.querySelectorAll("[data-directions]").forEach((a) => (a.href = C.mapUrl));

  // ---------------------------------------------------------------- open now?

  // One line, in the café's own time. Daytime hours come from the config (and are only stated
  // once the café has confirmed them); dinner comes from the owner's dates.
  //   "Open until 2:30pm" · "Closed · opens 7:30am" · "Closed · opens tomorrow, 7:30am"
  //   "Closed · dinner from 5:30pm" · "Dinner · last seating 9pm" · "Dinner · reserved tables only"
  function openStatus(tonight) {
    const now = cafeNow();
    const sure = C.hoursConfirmed !== false;
    const today = C.hours[now.weekday];
    if (sure && today && now.minutes >= toMin(today.open) && now.minutes < toMin(today.close)) {
      return { open: true, text: "Open until " + fmtTime(today.close) };
    }
    if (sure && today && now.minutes < toMin(today.open)) {
      return { open: false, text: "Closed · opens " + fmtTime(today.open) };
    }
    if (tonight && now.minutes >= toMin(tonight.first)) {
      // Dinner is under way. Once tonight can no longer be requested, do not let the line read
      // as an invitation to walk in.
      return slots(tonight).length
        ? { open: true, text: "Dinner · last seating " + fmtTime(tonight.last) }
        : { open: false, text: "Dinner · reserved tables only" };
    }
    if (!sure) return null;
    if (tonight) return { open: false, text: "Closed · dinner from " + fmtTime(tonight.first) };
    for (let i = 1; i <= 7; i++) {
      const day = C.hours[(now.weekday + i) % 7];
      if (day) {
        return {
          open: false,
          text: "Closed · opens " + (i === 1 ? "tomorrow" : DAYS[(now.weekday + i) % 7]) + ", " + fmtTime(day.open),
        };
      }
    }
    return null;
  }
  const status = $("open-status");
  function showStatus(tonight) {
    if (!status) return;
    const s = openStatus(tonight);
    // The line's space is kept while the page loads; give it up only when there is nothing to say.
    status.classList.toggle("no-status", !s);
    status.hidden = !s;
    if (!s) return;
    status.textContent = s.text;
    status.classList.toggle("is-open", s.open);
  }

  // ---------------------------------------------------------------- with and without dinner

  // Everything that differs between "walk-in only" and "dinner by reservation on some evenings".
  // Runs when the dates arrive and once a minute, so a page left open keeps telling the truth.
  // "from 5:30pm": an evening's first seating, or tonight the first time that can still be requested.
  const fromTime = (d) => "from " + fmtTime((d.date === cafeNow().date && slots(d)[0]) || d.first);
  let heroLeads = false; // "reserve" leads the hero actions (the page starts without it)
  let datesShown = null; // what the list of dinner dates was last drawn from
  let lastDates = []; // the dates showDinner last ran with
  function showDinner(dates) {
    lastDates = dates;
    const { listed, open, tonight } = dinnerNow(dates);
    const today = cafeNow().date;
    const next = open[0] || null;

    showStatus(tonight);

    // "reserve" appears only while something can be reserved; the dinner menu while an
    // evening is listed and the menu has dishes; the walk-in sign-off only while there is no
    // dinner to speak of.
    const dinnerMenuOn = listed.length > 0 && Boolean(menus && menus.dinner.sections.length);
    document.querySelectorAll("[data-if]").forEach((n) => {
      const kind = n.dataset.if;
      const hide = kind === "dinner" ? !open.length : kind === "dinner-menu" ? !dinnerMenuOn : listed.length > 0;
      if (n.hidden === hide) return;
      // The dinner menu sits above "visit": someone reading there must not be moved.
      const section = n.closest("#dinner-menu");
      if (section) keepPlace(section, () => (n.hidden = hide));
      else n.hidden = hide;
      if (n.id === "dinner-menu" && !hide) arriveAtDinnerMenu();
    });
    const closing = $("closing");
    if (closing) closing.hidden = !open.length && listed.length > 0;

    const note = $("service-note");
    if (note) note.textContent = (listed.length ? C.dinnerNote : C.walkInNote) || "";

    const dinnerNote = $("dinner-note");
    if (dinnerNote) {
      dinnerNote.hidden = !listed.length;
      dinnerNote.textContent = !next
        ? "Dinner tonight is by reservation. Reservations have closed."
        : next.date === today
          ? "Dinner by reservation. Tonight " + fromTime(next) + "."
          : "Dinner by reservation. Next: " + shortDate(next.date) + ".";
    }

    // With dinner on offer "reserve" leads and directions becomes a plain link. If that
    // happens on a page already in view (a slow first visit), a tap aimed at the old button
    // must not land on the new one: the row ignores taps for a moment.
    const directions = $("hero-directions");
    if (directions) {
      const leads = open.length > 0;
      if (leads !== heroLeads) {
        heroLeads = leads;
        const actions = directions.parentElement;
        actions.classList.add("settling");
        setTimeout(() => actions.classList.remove("settling"), 700);
      }
      directions.className = leads ? "link" : "btn";
    }

    // The next few evenings, each a link straight to that date on the form.
    const list = $("dinner-dates");
    const drawnFrom = JSON.stringify([today, open.length, open.slice(0, 6).map((d) => [d.date, fromTime(d)])]);
    if (list && drawnFrom !== datesShown) {
      datesShown = drawnFrom;
      list.textContent = "";
      open.slice(0, 6).forEach((d) => {
        const a = el("a");
        a.href = "reserve.html#" + d.date;
        a.append(el("span", d.date === today ? "Tonight" : shortDate(d.date), "when"), el("span", fromTime(d), "from"));
        const li = el("li");
        li.append(a);
        list.append(li);
      });
      const all = $("dinner-all");
      if (all) all.textContent = open.length > 6 ? "all " + open.length + " dates" : "reserve";
    }

    const closingLine = $("closing-dinner");
    if (closingLine && next) {
      closingLine.textContent =
        next.date === today ? "Tonight " + fromTime(next) + "." : "Next: " + shortDate(next.date) + ", " + fromTime(next) + ".";
    }

    showToday();
  }

  // ---------------------------------------------------------------- menus: drawing

  // "menu" is the lunch menu and is always there. "dinner menu" follows it only while dinner
  // is listed and has dishes, so the lunch menu never moves when dinner comes or goes.
  const wantsMenus = Boolean($("menu-list") || document.querySelector('[data-if="dinner-menu"]'));
  let menus = null; // { lunch, dinner } as last known; null until something is known
  let menusSettled = false; // the request has been answered, or has failed
  const drawn = { lunch: null, dinner: null }; // what each list was last drawn from

  // Run a change to a section's height without moving anyone who is reading below it. Some
  // browsers hold the reader's place themselves; this does it for the ones that do not.
  function keepPlace(section, change) {
    let next = section ? section.nextElementSibling : null;
    while (next && (next.tagName !== "SECTION" || next.hidden)) next = next.nextElementSibling;
    if (!next) return change();
    const before = next.getBoundingClientRect().top;
    change();
    if (before > 64) return; // the reader is at or above what changed
    const moved = next.getBoundingClientRect().top - before;
    if (moved) window.scrollBy({ top: moved, behavior: "instant" });
  }

  function drawMenu(list, note, menu) {
    list.textContent = "";
    menu.sections.forEach((sec) => {
      const box = el("div");
      if (sec.title) box.append(el("h3", sec.title));
      const ul = el("ul");
      sec.items.forEach((item) => {
        const li = el("li");
        const row = el("span", null, "row");
        row.append(el("span", item.name));
        if (item.price) row.append(el("span", item.price, "price"));
        li.append(row);
        if (item.desc) li.append(el("span", item.desc, "desc"));
        ul.append(li);
      });
      box.append(ul);
      list.append(box);
    });
    note.textContent = menu.note;
    note.hidden = !menu.note || !menu.sections.length;
  }

  // Draw what is known. A menu is redrawn only when it differs from what is on the page.
  function showMenus() {
    const lunchList = $("menu-list");
    if (lunchList && menus) {
      const sig = JSON.stringify(menus.lunch);
      if (sig !== drawn.lunch) {
        drawn.lunch = sig;
        keepPlace($("menu"), () => {
          drawMenu(lunchList, $("menu-note"), menus.lunch);
          $("menu-wait").textContent = "";
          $("menu-none").hidden = menus.lunch.sections.length > 0;
        });
      }
    } else if (lunchList && menusSettled && drawn.lunch !== "none") {
      // It could not be read and none is remembered: point to where the menu can be seen.
      drawn.lunch = "none";
      keepPlace($("menu"), () => {
        $("menu-wait").textContent = "";
        $("menu-none").hidden = false;
      });
    }
    const dinnerList = $("dinner-menu-list");
    if (dinnerList && menus) {
      const sig = JSON.stringify(menus.dinner);
      if (sig !== drawn.dinner) {
        drawn.dinner = sig;
        keepPlace($("dinner-menu"), () => drawMenu(dinnerList, $("dinner-menu-note"), menus.dinner));
      }
    }
    showDinner(lastDates); // shows or hides the dinner menu and the links to it
  }

  // A link straight to the dinner menu (from the reservation form) on a first visit: the
  // section did not exist when the browser looked for it, so go there when it appears.
  let arrived = false;
  function arriveAtDinnerMenu() {
    if (arrived || window.location.hash !== "#dinner-menu") return;
    arrived = true;
    if (window.scrollY === 0) $("dinner-menu").scrollIntoView({ behavior: "instant" });
  }

  function startMenus() {
    if (!wantsMenus) return;
    const none = $("menu-none-link");
    if (none) none.href = C.instagram;
    if (!hasBackend) {
      menusSettled = true;
      showMenus();
      return calm();
    }
    menus = rememberedMenus();
    if (menus) showMenus();
    else {
      // A first visit: say nothing for a moment, then that it is on its way.
      setTimeout(() => {
        const wait = $("menu-wait");
        if (wait && !menus && !menusSettled) keepPlace($("menu"), () => (wait.textContent = "Loading…"));
      }, 600);
    }
    fetchMenus()
      .then((fresh) => {
        menus = fresh;
      })
      .catch(() => {}) // the remembered menus stand; with none, the page says where to look
      .then(() => {
        menusSettled = true;
        showMenus();
        calm();
      });
  }

  // ---------------------------------------------------------------- photos

  // Photos the owner has uploaded (see admin.html). The section stays hidden if there are
  // none, or if they cannot be fetched.
  const gallery = $("gallery-list");
  let photosSettled = !(gallery && hasBackend);
  if (gallery && hasBackend) {
    fetch(base + "/rest/v1/photos?select=path,alt,width,height&order=sort_order.asc,created_at.asc&limit=12", {
      headers: { apikey: SB.publishableKey },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        rows.forEach((p) => {
          if (!p || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p.path)) return;
          const img = el("img");
          img.alt = typeof p.alt === "string" ? p.alt : "";
          img.loading = "lazy";
          img.decoding = "async";
          if (p.width > 0 && p.height > 0) {
            img.width = p.width;
            img.height = p.height;
          }
          const li = el("li");
          // A photo with no description says nothing to a screen reader: leave it out of the list it hears.
          if (!img.alt) li.setAttribute("aria-hidden", "true");
          // A photo that fails to load is dropped rather than left as a broken frame.
          img.addEventListener("error", () => {
            keepPlace($("gallery"), () => {
              li.remove();
              if (!gallery.children.length) $("gallery").hidden = true;
            });
            tidyGallery();
          });
          img.src = base + "/storage/v1/object/public/photos/" + encodeURIComponent(p.path);
          li.append(img);
          gallery.append(li);
        });
        // The strip arrives late and sits above the menus: do not push a reader down by its height.
        if (gallery.children.length) keepPlace($("gallery"), () => ($("gallery").hidden = false));
        tidyGallery();
      })
      .catch(() => {})
      .then(() => {
        photosSettled = true;
        calm();
      });
    window.addEventListener("resize", tidyGallery);
  }
  // On a phone the photos are one row to swipe; the row takes keyboard focus only where it
  // really scrolls, so arrow keys can move it. With no described photo the whole section is
  // decoration and is kept from screen readers.
  function tidyGallery() {
    const described = gallery.querySelector("li:not([aria-hidden])");
    const section = $("gallery");
    if (described) section.removeAttribute("aria-hidden");
    else section.setAttribute("aria-hidden", "true");
    if (described && gallery.scrollWidth > gallery.clientWidth + 1) gallery.tabIndex = 0;
    else gallery.removeAttribute("tabindex");
  }

  // ---------------------------------------------------------------- visit: address, contact, hours

  const address = $("address");
  if (address) {
    address.textContent = "";
    C.address.forEach((line) => address.append(el("p", line)));
    const contact = $("contact");
    contact.textContent = "";
    const mail = el("a", C.email, "link");
    mail.href = "mailto:" + C.email;
    contact.append(mail);
    if (C.phone) {
      contact.append(el("br"));
      const tel = el("a", C.phone, "link");
      tel.href = "tel:" + C.phone.replace(/[^\d+]/g, "");
      contact.append(tel);
    }
  }

  // The hours table lists each day once the café has confirmed its times; until then the page
  // keeps the plain "Tuesday to Sunday · Open" rows written into the HTML.
  const hours = $("hours");
  if (hours && C.hoursConfirmed !== false) {
    hours.textContent = "";
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const tr = el("tr");
      tr.dataset.day = d;
      const th = el("th", DAYS[d]);
      th.scope = "row";
      th.append(el("span", " (today)", "sr-only"));
      const day = C.hours[d];
      tr.append(th, el("td", day ? fmtTime(day.open) + " – " + fmtTime(day.close) : "Closed"));
      hours.append(tr);
    });
  }
  function showToday() {
    if (!hours) return;
    const today = String(cafeNow().weekday);
    hours.querySelectorAll("tr[data-day]").forEach((tr) => tr.classList.toggle("today", tr.dataset.day === today));
  }

  // ---------------------------------------------------------------- keep it current

  // Links to a section scroll smoothly (styles.css, html.settled), but only once everything
  // that arrives late is in. Before that the browser's jump to "#visit" must be instant: a
  // smooth scroll still under way when the menus or photos land would end in the wrong place.
  function calm() {
    if (settled && (menusSettled || !wantsMenus) && photosSettled) document.documentElement.classList.add("settled");
  }

  onDinner(showDinner);
  if (!known && !settled) showDinner([]); // nothing remembered: start from the walk-in page
  startMenus();
  calm();
  setInterval(tell, 60000);
})();
