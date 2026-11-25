// Shared by every page: small helpers, then everything on the page that is filled in from
// assets/config.js. Text is only ever written with textContent, never as HTML.
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

  // Daytime service is walk-in only; dinner is by reservation. Dinner exists once the config
  // lists at least one night, and from `dinner.from` if a first night is given.
  const dinner = C.dinner || {};
  const dinnerNights = dinner.hours || {};
  const dinnerFrom = /^\d{4}-\d{2}-\d{2}$/.test(dinner.from || "") ? dinner.from : "";
  const takesBookings = Object.keys(dinnerNights).some((d) => dinnerNights[d]);
  const dinnerOn = (date) =>
    takesBookings && (!dinnerFrom || date >= dinnerFrom) ? dinnerNights[weekdayOf(date)] || null : null;

  // What is served on a date, in order through the day.
  const servicesOn = (date) => {
    const list = [];
    const day = C.hours[weekdayOf(date)];
    if (day) list.push({ dinner: false, open: day.open, close: day.close });
    const night = dinnerOn(date);
    if (night) list.push({ dinner: true, open: night.open, close: night.close });
    return list.sort((a, b) => toMin(a.open) - toMin(b.open));
  };

  window.CAFE_UTIL = { fmtTime, toMin, asUTC, addDays, weekdayOf, cafeNow, DAYS, takesBookings, dinnerFrom, dinnerOn };

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

  // Parts of a page that only apply while reservations exist, or only while they do not.
  document.querySelectorAll("[data-if]").forEach((n) => {
    n.hidden = (n.dataset.if === "bookings") !== takesBookings;
  });
  if (C.mapUrl) document.querySelectorAll("[data-directions]").forEach((a) => (a.href = C.mapUrl));

  // ---------------------------------------------------------------- open now?

  // "Open now until 2:30pm" / "Closed now · opens tomorrow at 7:30am", in the café's own time.
  function openStatus() {
    const now = cafeNow();
    const today = servicesOn(now.date);
    const current = today.find((s) => now.minutes >= toMin(s.open) && now.minutes < toMin(s.close));
    if (current) {
      return { open: true, text: (current.dinner ? "Open for dinner until " : "Open now until ") + fmtTime(current.close) };
    }
    const opens = (s, day) => "Closed now · opens " + day + " at " + fmtTime(s.open) + (s.dinner ? " for dinner" : "");
    const later = today.find((s) => now.minutes < toMin(s.open));
    if (later) return { open: false, text: opens(later, "today") };
    for (let i = 1; i <= 7; i++) {
      const date = addDays(now.date, i);
      const first = servicesOn(date)[0];
      if (first) return { open: false, text: opens(first, i === 1 ? "tomorrow" : DAYS[weekdayOf(date)]) };
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

  // ---------------------------------------------------------------- landing page: actions

  // With reservations: "reserve for dinner" leads, directions follow. Without: directions lead.
  const primary = $("hero-primary");
  const secondary = $("hero-secondary");
  if (primary && secondary && takesBookings) {
    primary.textContent = "reserve for dinner";
    primary.href = "reserve.html";
    primary.removeAttribute("target");
    primary.removeAttribute("rel");
    secondary.textContent = "get directions";
    secondary.href = C.mapUrl || secondary.href;
    secondary.target = "_blank";
    secondary.rel = "noopener";
  } else if (secondary && !C.menu.length) {
    secondary.hidden = true;
  }

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
  const SB = C.supabase || {};
  if (gallery && SB.url && SB.publishableKey) {
    const base = SB.url.replace(/\/+$/, "");
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
    const dinnerRunning = takesBookings && (!dinnerFrom || now.date >= dinnerFrom);
    hours.textContent = "";
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const tr = el("tr");
      const th = el("th", DAYS[d]);
      th.scope = "row";
      if (d === now.weekday) {
        tr.className = "today";
        th.append(el("span", " (today)", "sr-only"));
      }
      const td = el("td");
      const day = C.hours[d];
      const night = dinnerRunning ? dinnerNights[d] : null;
      if (!day && !night) td.textContent = "Closed";
      if (day) td.append(el("span", fmtTime(day.open) + " – " + fmtTime(day.close), "line"));
      if (night) td.append(el("span", "dinner " + fmtTime(night.open) + " – " + fmtTime(night.close), "line"));
      tr.append(th, td);
      hours.append(tr);
    });
    const note = $("hours-note");
    if (note) {
      let text = takesBookings
        ? "Breakfast and lunch are walk-in only. Dinner is by reservation."
        : "Walk-ins only. No bookings needed.";
      if (takesBookings && !dinnerRunning) {
        text += " Dinner starts " + asUTC(dinnerFrom).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }) + ".";
      }
      note.textContent = text;
    }
  }
})();
