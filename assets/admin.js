// Owner area: sign in, manage reservation requests, manage the photos on the home page.
// Everything shown here comes from guests or from Supabase, so it is only ever written to the
// page as text (textContent) — never as HTML. What an account may do is decided by the
// database's row level security, not by this file.
(function () {
  const C = window.CAFE;
  const SB = C.supabase || {};
  const { fmtTime, cafeNow } = window.CAFE_UTIL;
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
    fatal("The owner area is not set up yet: assets/config.js has no Supabase project.");
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

  async function enter(session) {
    if (!session) {
      currentUserId = null;
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
      fatal("Couldn't check this account. Please try again.");
      return;
    }
    if (data !== true) {
      show("denied", "denied-h");
      return;
    }
    show("app");
    loadReservations();
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
      error.textContent = "Please enter your email and password.";
      (email ? $("signin-password") : $("signin-email")).focus();
      return;
    }
    button.disabled = true;
    try {
      const { error: failed } = await sb.auth.signInWithPassword({ email, password });
      if (failed) {
        error.textContent =
          failed.status === 400 || failed.status === 401
            ? "That email and password don't match an account."
            : "Couldn't sign in. Please try again.";
      } else {
        $("signin-password").value = "";
      }
    } catch (err) {
      error.textContent = "Couldn't sign in. Please check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  });

  async function signOut() {
    // signOut() reports a failure in its result rather than throwing. Whatever happens with
    // the server (offline, an error), the session must be forgotten in this browser.
    let failed;
    try {
      failed = (await sb.auth.signOut()).error;
    } catch (err) {
      failed = err;
    }
    if (failed) await sb.auth.signOut({ scope: "local" }).catch(() => {});
    $("res-list").textContent = "";
    $("photo-list").textContent = "";
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

  const TABS = ["reservations", "photos"];
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
  const mailtoAddress = (email) => encodeURIComponent(email).replace(/%40/g, "@");

  function replyLink(r) {
    const first = String(r.name).split(" ")[0];
    const when = longDate(r.reservation_date) + " at " + fmtTime(hhmm(r.reservation_time));
    const sign = ["", C.name, C.address.join(", ")];
    let subject;
    let lines;
    if (r.status === "confirmed") {
      subject = "Your dinner reservation at ellen is confirmed";
      lines = ["Hi " + first + ",", "", "Your table for " + guests(r.party_size) + " on " + when + " is confirmed. See you then!"];
    } else if (r.status === "declined") {
      subject = "About your dinner reservation request at ellen";
      lines = ["Hi " + first + ",", "", "Thanks for asking about a table for " + guests(r.party_size) + " on " + when + ". Sorry, we can't fit you in at that time."];
    } else if (r.status === "cancelled") {
      subject = "Your dinner reservation at ellen has been cancelled";
      lines = ["Hi " + first + ",", "", "Your table for " + guests(r.party_size) + " on " + when + " has been cancelled."];
    } else {
      subject = "About your dinner reservation request at ellen";
      lines = ["Hi " + first + ",", "", "Thanks for your request for a table for " + guests(r.party_size) + " on " + when + "."];
    }
    return (
      "mailto:" + mailtoAddress(r.email) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.concat(sign).join("\r\n"))
    );
  }

  const resList = $("res-list");
  const filter = $("res-filter");
  let loadingReservations = 0;

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
      badge.setAttribute("aria-label", waiting.count + " waiting for a reply");
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    if (list.error) {
      say("Couldn't load reservations. Please try again.", true);
      return;
    }
    renderReservations(list.data);
  }

  function renderReservations(rows) {
    resList.textContent = "";
    if (!rows.length) {
      const nothing = {
        todo: "Nothing is waiting for a reply.",
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
      tel.href = "tel:" + r.phone.replace(/[^\d+]/g, "");
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
      actions.append(button("cancel booking", "cancelled", "textbtn"));
    } else {
      actions.append(button("back to waiting", "pending", "textbtn"));
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
      say(
        error && error.code === "23505"
          ? "That guest already has another live request for the same time."
          : "Couldn't update that reservation. Please try again.",
        true
      );
      return;
    }
    const outcome = {
      confirmed: "Confirmed. Use “email guest” to let " + r.name + " know.",
      declined: "Declined. Use “email guest” to let " + r.name + " know.",
      cancelled: "Booking cancelled.",
      pending: "Moved back to waiting.",
    };
    say(outcome[status]);
    // Keep a just-answered request on screen so the owner can email the guest from it.
    r.status = status;
    const fresh = reservationRow(r);
    box.closest(".res").replaceWith(fresh);
    refreshBadge();
  }

  async function removeReservation(r, box) {
    if (!window.confirm("Delete the request from " + r.name + " for " + longDate(r.reservation_date) + "? This can't be undone.")) return;
    setBusy(box, true);
    const { data, error } = await sb.from("reservations").delete().eq("id", r.id).select("id");
    if (error || !data || data.length !== 1) {
      setBusy(box, false);
      say("Couldn't delete that reservation. Please try again.", true);
      return;
    }
    say("Deleted.");
    loadReservations();
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
      badge.setAttribute("aria-label", count + " waiting for a reply");
      badge.hidden = false;
    } else if (!error) {
      badge.hidden = true;
    }
  }

  filter.addEventListener("change", loadReservations);
  $("res-refresh").addEventListener("click", () => {
    say("");
    loadReservations();
  });

  // ---------------------------------------------------------------- photos

  const BUCKET = "photos";
  const MAX_EDGE = 2000; // pixels on the long side; larger photos are scaled down before upload
  const photoList = $("photo-list");
  const photoInput = $("photo-input");
  const progress = $("photo-progress");
  let photos = [];

  const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  async function loadPhotos() {
    const { data, error } = await sb
      .from("photos")
      .select("id, path, alt, sort_order, width, height, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      say("Couldn't load photos. Please try again.", true);
      return;
    }
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
      say("Couldn't save that description. Please try again.", true);
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
      say("Couldn't save the new order. Please try again.", true);
      loadPhotos();
      return;
    }
    changes.forEach((c) => (c.p.sort_order = c.order));
    photos = next;
    renderPhotos();
    const moved = photoList.children[target].querySelector(step < 0 ? ".move button:first-child" : ".move button:last-child");
    (moved && !moved.disabled ? moved : photoList.children[target].querySelector(".move button:not([disabled])") || photoInput).focus();
  }

  async function removePhoto(p) {
    if (!window.confirm("Delete this photo from the website? This can't be undone.")) return;
    const { data, error } = await sb.from("photos").delete().eq("id", p.id).select("id");
    if (error || !data || data.length !== 1) {
      say("Couldn't delete that photo. Please try again.", true);
      return;
    }
    // The photo is off the site as soon as its row is gone; the file is tidied up after.
    const { error: fileError } = await sb.storage.from(BUCKET).remove([p.path]);
    photos = photos.filter((x) => x.id !== p.id);
    renderPhotos();
    say(fileError ? "Photo removed from the website, but its file couldn't be deleted from storage." : "Photo deleted.", Boolean(fileError));
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
        failed.push(file.name + (err && err.message === "unreadable" ? " (not a photo this browser can read)" : ""));
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
      say(added === 1 ? "Photo added. Give it a description below." : added + " photos added. Give each a description below.");
    }
  });

  // ---------------------------------------------------------------- keeping it fresh

  // New requests arrive while the page sits open: reload when the owner comes back to the tab.
  let lastLoad = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || $("view-app").hidden) return;
    if (Date.now() - lastLoad < 30000) return;
    lastLoad = Date.now();
    loadReservations();
  });
})();
