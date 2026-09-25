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
    if (m === "timeout") return "Сервер не ответил. Нажми ещё раз.";
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

  var loadGen = 0;

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  async function loadApp() {
    var gen = ++loadGen;
    setMsg(appMsg, "Загружаю…", false);
    try {
      var uid = user.id;
      var profileRes = await withTimeout(sb.from("profiles").select("*").eq("id", uid).maybeSingle(), 12000);
      if (gen !== loadGen) return;
      if (profileRes.error) throw profileRes.error;
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

      var packs = await withTimeout(sb.from("user_packages").select("sessions_left, sessions_total, source").eq("user_id", uid), 12000);
      if (gen !== loadGen) return;
      if (packs.error) throw packs.error;
      var left = 0;
      (packs.data || []).forEach(function (p) { left += p.sessions_left || 0; });
      document.getElementById("balance").textContent = String(left);
      var admin = await withTimeout(sb.from("admin_users").select("user_id").eq("user_id", uid).maybeSingle(), 12000);
      var link = document.getElementById("admin-link");
      if (link && admin.data) link.hidden = false;

      var nowIso = new Date().toISOString();
      var sessions = await withTimeout(sb.from("sessions_with_seats")
        .select("id, title, room, speaker_name, starts_at, duration_min, seats_left, status, zoom_url")
        .gte("starts_at", nowIso)
        .in("status", ["open", "full"])
        .order("starts_at", { ascending: true }), 12000);
      if (gen !== loadGen) return;
      if (sessions.error) throw sessions.error;

      var mine = await withTimeout(sb.from("bookings")
        .select("id, status, session_id, sessions(title, speaker_name, starts_at, zoom_url)")
        .eq("user_id", uid)
        .eq("status", "booked")
        .order("created_at", { ascending: false }), 12000);
      if (gen !== loadGen) return;
      if (mine.error) throw mine.error;

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
        btn.addEventListener("click", function () { book(s.id, btn); });
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
        btn.addEventListener("click", function () { cancel(b.id, btn); });
        row.appendChild(btn);
        my.appendChild(row);
      });
      if (!my.children.length) {
        my.innerHTML = "<p class='muted'>Записей пока нет. Первый созвон уже на балансе.</p>";
      }
      if (gen === loadGen) setMsg(appMsg, "", false);
    } catch (e) {
      if (gen === loadGen) setMsg(appMsg, mapError(e), true);
      return false;
    }
    return true;
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function book(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Записываю…"; }
    try {
      var res = await withTimeout(sb.rpc("book_session", { p_session_id: id }), 12000);
      var ok = await loadApp();
      if (res.error) setMsg(appMsg, mapError(res.error), true);
      else if (ok) setMsg(appMsg, "Ты в группе. Место списано с пакета.", false);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Записаться"; }
      setMsg(appMsg, mapError(e), true);
    }
  }

  async function cancel(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Отменяю…"; }
    try {
      var res = await withTimeout(sb.rpc("cancel_booking", { p_booking_id: id }), 12000);
      var ok = await loadApp();
      if (res.error) setMsg(appMsg, mapError(res.error), true);
      else if (ok) setMsg(appMsg, "Запись отменена, занятие вернулось на баланс.", false);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Отменить"; }
      setMsg(appMsg, mapError(e), true);
    }
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
    if (next.indexOf("order.html?pack=") === 0 || next === "admin.html") {
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
      if (next.indexOf("order.html?pack=") === 0 || next === "admin.html") {
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
