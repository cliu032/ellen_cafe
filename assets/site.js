(function () {
  const C = window.CAFE;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    return n;
  };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  document.querySelectorAll("[data-cafe]").forEach((n) => (n.textContent = C[n.dataset.cafe]));
  $("year").textContent = new Date().getFullYear();
  const ig = $("ig");
  ig.href = C.instagram;
  ig.textContent = "Instagram " + C.instagramHandle;

  const menu = $("menu-list");
  if (menu) {
    C.menu.forEach((group) => {
      const box = el("div");
      box.append(el("h3", group.title));
      const ul = el("ul");
      group.items.forEach(([name, price]) => {
        const li = el("li");
        li.append(el("span", name), el("span", price));
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
      const a = el("a", "Open in Maps");
      a.className = "link";
      a.href = C.mapUrl;
      a.target = "_blank";
      a.rel = "noopener";
      const p = el("p");
      p.style.marginTop = "12px";
      p.append(a);
      address.append(p);
    }
    const contact = $("contact");
    const mail = el("a", C.email);
    mail.className = "link";
    mail.href = "mailto:" + C.email;
    contact.append(mail);
    if (C.phone) {
      contact.append(el("br"));
      const tel = el("a", C.phone);
      tel.href = "tel:" + C.phone.replace(/[^\d+]/g, "");
      contact.append(tel);
    }
  }

  const hours = $("hours");
  if (hours) {
    const today = new Date().getDay();
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const tr = el("tr");
      if (d === today) tr.className = "today";
      const h = C.hours[d];
      tr.append(el("td", DAYS[d]), el("td", h ? h.open + " – " + h.close : "Closed"));
      hours.append(tr);
    });
  }
})();
