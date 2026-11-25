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
      });
  }
  // Read the dates again (after the server has refused a request, say). Resolves when done.
  const refreshDinner = () => (hasBackend ? loadDinner() : Promise.resolve());
  if (hasBackend) loadDinner();

  window.CAFE_UTIL = {
    fmtTime, toMin, asUTC, addDays, weekdayOf, fmtDate, shortDate, cafeNow, DAYS,
    onDinner, refreshDinner, slots, dinnerNow,
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
  //   "Closed · dinner from 5:30pm" · "Dinner · last seating 9pm"
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
      return { open: true, text: "Dinner · last seating " + fmtTime(tonight.last) };
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
  const fromTime = (d) => "from " + fmtTime(d.first);
  function showDinner(dates) {
    const { listed, open, tonight } = dinnerNow(dates);
    const today = cafeNow().date;
    const next = open[0] || null;

    showStatus(tonight);

    // "reserve" appears only while something can be reserved; the walk-in sign-off only while
    // there is no dinner to speak of.
    document.querySelectorAll("[data-if]").forEach((n) => {
      n.hidden = n.dataset.if === "dinner" ? !open.length : listed.length > 0;
    });
    const closing = $("closing");
    if (closing) closing.hidden = !open.length && listed.length > 0;

    const note = $("service-note");
    if (note) note.textContent = (listed.length ? C.dinnerNote : C.walkInNote) || "";

    const dinnerNote = $("dinner-note");
    if (dinnerNote) {
      dinnerNote.hidden = !listed.length;
      dinnerNote.textContent = !next
        ? "Dinner tonight. Reservations have closed."
        : next.date === today
          ? "Dinner by reservation. Tonight " + fromTime(next) + "."
          : "Dinner by reservation. Next: " + shortDate(next.date) + ".";
    }

    // With dinner on offer "reserve" leads and directions becomes a plain link.
    const directions = $("hero-directions");
    if (directions) directions.className = open.length ? "link" : "btn";

    // The next few evenings, each a link straight to that date on the form.
    const list = $("dinner-dates");
    if (list) {
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

  // ---------------------------------------------------------------- menu

  const menu = $("menu-list");
  if (!C.menu.length) {
    // No menu published yet: hide the section and its links rather than show an empty heading.
    if (menu) $("menu").hidden = true;
    document.querySelectorAll('a[href$="#menu"]').forEach((a) => {
      (a.parentElement.tagName === "LI" ? a.parentElement : a).hidden = true;
    });
  } else if (menu) {
    C.menu.forEach((group) => {
      const box = el("div");
      box.append(el("h3", group.title));
      const ul = el("ul");
      group.items.forEach((item) => {
        const li = el("li");
        const row = el("span", null, "row");
        row.append(el("span", item.name));
        if (item.price) row.append(el("span", item.price, "price"));
        li.append(row);
        if (item.desc) li.append(el("span", item.desc, "desc"));
        ul.append(li);
      });
      box.append(ul);
      menu.append(box);
    });
  }

  // ---------------------------------------------------------------- photos

  // Photos the owner has uploaded (see admin.html). The section stays hidden if there are
  // none, or if they cannot be fetched.
  const gallery = $("gallery-list");
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
          // A photo that fails to load is dropped rather than left as a broken frame.
          img.addEventListener("error", () => {
            li.remove();
            if (!gallery.children.length) $("gallery").hidden = true;
          });
          img.src = base + "/storage/v1/object/public/photos/" + encodeURIComponent(p.path);
          li.append(img);
          gallery.append(li);
        });
        if (gallery.children.length) $("gallery").hidden = false;
      })
      .catch(() => {});
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

  onDinner(showDinner);
  if (!known && !settled) showDinner([]); // nothing remembered: start from the walk-in page
  setInterval(tell, 60000);
})();
