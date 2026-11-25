// Shared by every page: small helpers, then everything on the page that is filled in from
// assets/config.js or from Supabase. Text is only ever written with textContent, never as HTML.
(function () {
  const C = window.CAFE;
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
      const pad = (n) => String(n).padStart(2, "0");
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

  // Rows as the API returns them -> [{ date, first, last }], upcoming only, soonest first.
  function tidyDinner(rows) {
    if (!Array.isArray(rows)) return [];
    const today = cafeNow().date;
    return rows
      .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.service_date) && TIME.test(r.first_seating) && TIME.test(r.last_seating))
      .map((r) => ({ date: r.service_date, first: r.first_seating.slice(0, 5), last: r.last_seating.slice(0, 5) }))
      .filter((r) => r.date >= today && toMin(r.last) >= toMin(r.first))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
      try {
        localStorage.setItem(DINNER_KEY, JSON.stringify({ rows }));
      } catch (e) { /* private browsing: nothing to keep */ }
      return tidyDinner(rows);
    } finally {
      clearTimeout(timer);
    }
  }

  // onDinner(fn): fn(dates, settled) runs with the remembered dates straight away (if any),
  // then again once the current dates are known. `settled` is true on that last call. If the
  // dates cannot be fetched, the remembered ones stand; with none remembered, there are none.
  const listeners = [];
  let known = rememberedDinner();
  let settled = !hasBackend;
  if (settled) known = [];
  const onDinner = (fn) => {
    listeners.push(fn);
    if (known || settled) fn(known || [], settled);
  };
  if (hasBackend) {
    fetchDinner()
      .then((rows) => { known = rows; })
      .catch(() => { known = known || []; })
      .then(() => {
        settled = true;
        listeners.forEach((fn) => fn(known, true));
      });
  }

  window.CAFE_UTIL = { fmtTime, toMin, asUTC, addDays, weekdayOf, fmtDate, shortDate, cafeNow, DAYS, onDinner };

  // ---------------------------------------------------------------- text from the config

  document.querySelectorAll("[data-cafe]").forEach((n) => {
    const v = C[n.dataset.cafe];
    if (v) n.textContent = v;
    else n.hidden = true;
  });
  $("year").textContent = cafeNow().date.slice(0, 4);
  const ig = $("ig");
  ig.href = C.instagram;
  ig.textContent = "instagram " + C.instagramHandle;
  if (C.mapUrl) document.querySelectorAll("[data-directions]").forEach((a) => (a.href = C.mapUrl));

  // ---------------------------------------------------------------- open now?

  // "Open until 2:30pm" / "Closed · opens tomorrow, 7:30am", for the daytime walk-in hours and
  // in the café's own time.
  function openStatus() {
    const now = cafeNow();
    const today = C.hours[now.weekday];
    if (today && now.minutes >= toMin(today.open) && now.minutes < toMin(today.close)) {
      return { open: true, text: "Open until " + fmtTime(today.close) };
    }
    if (today && now.minutes < toMin(today.open)) {
      return { open: false, text: "Closed · opens " + fmtTime(today.open) };
    }
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
  function showStatus() {
    const s = openStatus();
    status.hidden = !s;
    if (!s) return;
    status.textContent = s.text;
    status.classList.toggle("is-open", s.open);
  }
  if (status) {
    showStatus();
    setInterval(showStatus, 60000);
  }

  // ---------------------------------------------------------------- with and without dinner

  // Everything that differs between "walk-in only" and "dinner by reservation on some evenings".
  onDinner((dates) => {
    const dinner = dates.length > 0;
    document.querySelectorAll("[data-if]").forEach((n) => {
      n.hidden = (n.dataset.if === "dinner") !== dinner;
    });

    const note = $("service-note");
    if (note) note.textContent = (dinner ? C.dinnerNote : C.walkInNote) || "";

    // The hero leads with "reserve" when there is dinner to reserve, with directions otherwise.
    const primary = $("hero-primary");
    const secondary = $("hero-secondary");
    if (primary && secondary) {
      const link = (a, text, href, external) => {
        a.textContent = text;
        a.href = href;
        if (external) {
          a.target = "_blank";
          a.rel = "noopener";
        } else {
          a.removeAttribute("target");
          a.removeAttribute("rel");
        }
        a.hidden = false;
      };
      if (dinner) {
        link(primary, "reserve", "reserve.html", false);
        link(secondary, "directions", C.mapUrl, true);
      } else {
        link(primary, "directions", C.mapUrl, true);
        if (C.menu.length) link(secondary, "menu", "#menu", false);
        else secondary.hidden = true;
      }
    }

    // "Dinner tonight from 5:30pm", while tonight's last seating is still ahead.
    const tonight = $("tonight");
    if (tonight) {
      const now = cafeNow();
      const row = dates.find((d) => d.date === now.date && now.minutes <= toMin(d.last));
      tonight.hidden = !row;
      if (row) tonight.textContent = "Dinner tonight from " + fmtTime(row.first) + ".";
    }

    const hoursNote = $("hours-note");
    if (hoursNote) hoursNote.textContent = dinner ? "Breakfast and lunch are walk-in only." : "Walk-in only. No bookings.";

    // The next few dinner dates, under the hours.
    const list = $("dinner-dates");
    if (list) {
      list.textContent = "";
      dates.slice(0, 6).forEach((d) => {
        const li = el("li");
        li.append(el("span", shortDate(d.date)), el("span", "from " + fmtTime(d.first)));
        list.append(li);
      });
    }
  });

  // ---------------------------------------------------------------- menu

  const menu = $("menu-list");
  if (!C.menu.length) {
    // No menu published yet: hide the section and its nav link rather than show an empty heading.
    if (menu) $("menu").hidden = true;
    document.querySelectorAll('a[href$="#menu"]').forEach((a) => {
      if (a.parentElement.tagName === "LI") a.parentElement.hidden = true;
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

  const hours = $("hours");
  if (hours) {
    const now = cafeNow();
    hours.textContent = "";
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const tr = el("tr");
      const th = el("th", DAYS[d]);
      th.scope = "row";
      if (d === now.weekday) {
        tr.className = "today";
        th.append(el("span", " (today)", "sr-only"));
      }
      const day = C.hours[d];
      tr.append(th, el("td", day ? fmtTime(day.open) + " – " + fmtTime(day.close) : "Closed"));
      hours.append(tr);
    });
  }
})();
