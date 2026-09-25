(function () {
  var cfg = window.LESICHI_SUPABASE || {};
  var sb = null;
  var user = null;

  var setupEl = document.getElementById("setup");
  var authEl = document.getElementById("auth");
  var appEl = document.getElementById("app");
  var authMsg = document.getElementById("auth-msg");
  var appMsg = document.getElementById("app-msg");

  function show(el) {
    setupEl.hidden = el !== "setup";
    authEl.hidden = el !== "auth";
    appEl.hidden = el !== "app";
  }

  function setMsg(node, text, isError) {
    node.textContent = text || "";
    node.style.color = isError ? "#B42318" : "#2B1B5E";
  }

  function mapError(err) {
    var m = (err && err.message) || "Что-то пошло не так";
    if (m.indexOf("no seats") !== -1) return "Мест больше нет";
    if (m.indexOf("already booked") !== -1) return "Ты уже записан на этот созвон";
    if (m.indexOf("no sessions left") !== -1) return "Закончились занятия в пакете";
    if (m.indexOf("already started") !== -1) return "Созвон уже начался, отменить нельзя";
    if (m.indexOf("Invalid login") !== -1) return "Неверная почта или пароль";
    if (m.indexOf("User already registered") !== -1) return "Такой email уже зарегистрирован";
    return m;
  }

  function fmt(iso, tz) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("ru-RU", {
        timeZone: tz || "Europe/Minsk",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return new Date(iso).toLocaleString("ru-RU");
    }
  }

  function ready() {
    return cfg.url && cfg.anonKey && window.supabase;
  }

  async function loadApp() {
    setMsg(appMsg, "Загружаю…", false);
    var uid = user.id;
    var profileRes = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
    var profile = profileRes.data || {
      full_name: "",
      telegram: "",
      level: "unknown",
      timezone: "Europe/Minsk",
      email: user.email
    };
    document.getElementById("f-name").value = profile.full_name || "";
    document.getElementById("f-tg").value = profile.telegram || "";
    document.getElementById("f-level").value = profile.level || "unknown";
    document.getElementById("f-tz").value = profile.timezone || "Europe/Minsk";
    document.getElementById("who").textContent = profile.full_name || user.email;

    var packs = await sb.from("user_packages").select("sessions_left, sessions_total, source").eq("user_id", uid);
    var left = 0;
    (packs.data || []).forEach(function (p) { left += p.sessions_left || 0; });
    document.getElementById("balance").textContent = String(left);

    var nowIso = new Date().toISOString();
    var sessions = await sb.from("sessions_with_seats")
      .select("id, title, room, speaker_name, starts_at, duration_min, seats_left, status, zoom_url")
      .gte("starts_at", nowIso)
      .in("status", ["open", "full"])
      .order("starts_at", { ascending: true });

    var mine = await sb.from("bookings")
      .select("id, status, session_id, sessions(title, speaker_name, starts_at, zoom_url)")
      .eq("user_id", uid)
      .eq("status", "booked")
      .order("created_at", { ascending: false });

    var bookedIds = {};
    (mine.data || []).forEach(function (b) { bookedIds[b.session_id] = true; });

    var list = document.getElementById("sessions");
    list.innerHTML = "";
    (sessions.data || []).forEach(function (s) {
      var row = document.createElement("div");
      row.className = "row";
      var seats = s.seats_left == null ? "" : " · мест " + s.seats_left;
      var btn = document.createElement("button");
      btn.className = "btn btn-orange";
      btn.type = "button";
      btn.textContent = bookedIds[s.id] ? "Уже записан" : (s.seats_left > 0 ? "Записаться" : "Мест нет");
      btn.disabled = !!bookedIds[s.id] || !(s.seats_left > 0);
      btn.addEventListener("click", function () { book(s.id); });
      row.innerHTML = "<div><strong>" + escapeHtml(s.title) + "</strong><div class='muted'>" +
        escapeHtml(fmt(s.starts_at, profile.timezone)) + " · " + escapeHtml(s.speaker_name || "") + seats + "</div></div>";
      row.appendChild(btn);
      list.appendChild(row);
    });
    if (!list.children.length) {
      list.innerHTML = "<p class='muted'>Ближайших созвонов пока нет.</p>";
    }

    var my = document.getElementById("bookings");
    my.innerHTML = "";
    (mine.data || []).forEach(function (b) {
      var s = b.sessions || {};
      var row = document.createElement("div");
      row.className = "row";
      var zoom = s.zoom_url ? "<a href='" + escapeHtml(s.zoom_url) + "' target='_blank' rel='noopener'>Zoom</a>" : "";
      row.innerHTML = "<div><strong>" + escapeHtml(s.title || "Созвон") + "</strong><div class='muted'>" +
        escapeHtml(fmt(s.starts_at, profile.timezone)) + " " + zoom + "</div></div>";
      var btn = document.createElement("button");
      btn.className = "btn ghost";
      btn.type = "button";
      btn.textContent = "Отменить";
      btn.addEventListener("click", function () { cancel(b.id); });
      row.appendChild(btn);
      my.appendChild(row);
    });
    if (!my.children.length) {
      my.innerHTML = "<p class='muted'>Записей пока нет. Первый созвон уже на балансе.</p>";
    }
    setMsg(appMsg, "", false);
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function book(id) {
    setMsg(appMsg, "", false);
    var res = await sb.rpc("book_session", { p_session_id: id });
    if (res.error) setMsg(appMsg, mapError(res.error), true);
    else setMsg(appMsg, "Ты в группе. Место списано с пакета.", false);
    await loadApp();
  }

  async function cancel(id) {
    setMsg(appMsg, "", false);
    var res = await sb.rpc("cancel_booking", { p_booking_id: id });
    if (res.error) setMsg(appMsg, mapError(res.error), true);
    else setMsg(appMsg, "Запись отменена, занятие вернулось на баланс.", false);
    await loadApp();
  }

  function setTab(mode) {
    var login = mode === "login";
    document.getElementById("reg-extra").hidden = login;
    document.getElementById("auth-submit").textContent = login ? "Войти" : "Создать аккаунт";
    document.getElementById("auth-mode").value = mode;
    document.getElementById("tab-login").className = login ? "on" : "";
    document.getElementById("tab-reg").className = login ? "" : "on";
  }
  document.getElementById("tab-login").onclick = function () { setTab("login"); };
  document.getElementById("tab-reg").onclick = function () { setTab("register"); };

  document.getElementById("auth-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    setMsg(authMsg, "", false);
    var email = document.getElementById("email").value.trim();
    var password = document.getElementById("password").value;
    var mode = document.getElementById("auth-mode").value;
    var res;
    if (mode === "register") {
      res = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: document.getElementById("reg-name").value.trim() } }
      });
    } else {
      res = await sb.auth.signInWithPassword({ email: email, password: password });
    }
    if (res.error) {
      setMsg(authMsg, mapError(res.error), true);
      return;
    }
    if (mode === "register" && res.data && !res.data.session) {
      setMsg(authMsg, "Аккаунт создан. Если включено подтверждение почты — открой письмо и войди ещё раз.", false);
      return;
    }
    user = res.data.user || (res.data.session && res.data.session.user);
    var next = new URLSearchParams(location.search).get("next") || "";
    if (next.indexOf("order.html?pack=") === 0) {
      location.href = next;
      return;
    }
    show("app");
    loadApp();
  });

  document.getElementById("profile-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var patch = {
      full_name: document.getElementById("f-name").value.trim(),
      telegram: document.getElementById("f-tg").value.trim(),
      level: document.getElementById("f-level").value,
      timezone: document.getElementById("f-tz").value.trim() || "Europe/Minsk"
    };
    var res = await sb.from("profiles").update(patch).eq("id", user.id);
    if (res.error) setMsg(appMsg, mapError(res.error), true);
    else {
      setMsg(appMsg, "Профиль сохранён.", false);
      document.getElementById("who").textContent = patch.full_name || user.email;
    }
  });

  document.getElementById("logout").addEventListener("click", async function () {
    await sb.auth.signOut();
    user = null;
    show("auth");
  });

  async function boot() {
    if (!ready()) {
      show("setup");
      return;
    }
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    var session = await sb.auth.getSession();
    user = session.data && session.data.session && session.data.session.user;
    if (user) {
      var next = new URLSearchParams(location.search).get("next") || "";
      if (next.indexOf("order.html?pack=") === 0) {
        location.href = next;
        return;
      }
      show("app");
      loadApp();
    } else {
      show("auth");
    }
  }

  boot();
})();
