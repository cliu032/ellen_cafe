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
    return {
      date,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
      weekday: new Date(date + "T00:00:00Z").getUTCDay(),
    };
  };
  window.CAFE_UTIL = { fmtTime, cafeNow, DAYS };

  document.querySelectorAll("[data-cafe]").forEach((n) => {
    const v = C[n.dataset.cafe];
    if (v) n.textContent = v;
    else n.hidden = true;
  });
  $("year").textContent = cafeNow().date.slice(0, 4);
  const ig = $("ig");
  ig.href = C.instagram;
  ig.textContent = "instagram " + C.instagramHandle;

  const menu = $("menu-list");
  if (menu) {
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

  const address = $("address");
  if (address) {
    C.address.forEach((line) => address.append(el("p", line)));
    if (C.mapUrl) {
      const a = el("a", "open in maps", "link");
      a.href = C.mapUrl;
      a.target = "_blank";
      a.rel = "noopener";
      const p = el("p");
      p.style.marginTop = "12px";
      p.append(a);
      address.append(p);
    }
    const contact = $("contact");
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
    const today = cafeNow().weekday;
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const tr = el("tr");
      if (d === today) tr.className = "today";
      const h = C.hours[d];
      tr.append(el("td", DAYS[d]), el("td", h ? fmtTime(h.open) + " – " + fmtTime(h.close) : "Closed"));
      hours.append(tr);
    });
  }
})();
