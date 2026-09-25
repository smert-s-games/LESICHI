(function () {
  var cfg = window.LESICHI_SUPABASE || {};
  var sb = cfg.url && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
  var tabs = [
    ["sessions", "Созвоны"],
    ["speakers", "Спикеры"],
    ["packages", "Цены"],
    ["bookings", "Записи"],
    ["people", "Люди"],
    ["leads", "Заявки"],
    ["payments", "Оплаты"]
  ];
  var current = "sessions";

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function msg(text, bad) {
    var el = document.getElementById("hint");
    el.textContent = text;
    el.className = bad ? "muted err" : "muted";
  }

  async function render() {
    var panel = document.getElementById("panel");
    panel.innerHTML = "Загрузка…";
    if (current === "sessions") {
      var rows = await sb.from("sessions").select("*").order("starts_at", { ascending: false });
      panel.innerHTML = sessionForm() + table(rows.data, ["title", "speaker_name", "starts_at", "status", "max_participants"], function (r) {
        return '<button class="btn" data-del="' + r.id + '">Удалить</button>';
      });
      panel.querySelector("#add-session").onsubmit = addSession;
      panel.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () { remove("sessions", b.dataset.del); };
      });
    } else if (current === "speakers") {
      var speakers = await sb.from("speakers").select("*").order("name");
      if (speakers.error) {
        panel.innerHTML = "<p class='err'>Таблица speakers ещё не создана. Выполни supabase/speakers.sql в SQL Editor.</p>";
        return;
      }
      panel.innerHTML = speakerForm() + (speakers.data || []).map(function (p) {
        return '<form class="card rowform" data-id="' + p.id + '">' +
          '<input name="name" value="' + esc(p.name) + '" required>' +
          '<input name="origin" value="' + esc(p.origin) + '" placeholder="Откуда">' +
          '<input name="topic" value="' + esc(p.topic) + '" placeholder="Тема">' +
          '<input name="bio" value="' + esc(p.bio) + '" placeholder="Коротко">' +
          '<label><input name="is_active" type="checkbox"' + (p.is_active ? " checked" : "") + '> на сайте</label>' +
          '<button class="btn primary" type="submit">Сохранить</button>' +
          '<button class="btn" type="button" data-del="' + p.id + '">Удалить</button></form>';
      }).join("") || "<p class='muted'>Спикеров пока нет</p>";
      panel.querySelector("#add-speaker").onsubmit = addSpeaker;
      panel.querySelectorAll("form[data-id]").forEach(function (f) {
        f.onsubmit = function (e) { e.preventDefault(); saveSpeaker(f); };
      });
      panel.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () { remove("speakers", b.dataset.del); };
      });
    } else if (current === "packages") {
      var packs = await sb.from("packages").select("*").order("price_byn");
      panel.innerHTML = (packs.data || []).map(function (p) {
        return '<form class="card rowform" data-id="' + p.id + '">' +
          '<input name="title" value="' + esc(p.title) + '">' +
          '<input name="price_byn" type="number" step="0.01" value="' + esc(p.price_byn) + '">' +
          '<input name="sessions_count" type="number" value="' + esc(p.sessions_count) + '">' +
          '<label><input name="is_active" type="checkbox"' + (p.is_active ? " checked" : "") + '> на сайте</label>' +
          '<button class="btn primary" type="submit">Сохранить</button></form>';
      }).join("") || "<p>Пакетов нет</p>";
      panel.querySelectorAll("form").forEach(function (f) {
        f.onsubmit = function (e) { e.preventDefault(); savePack(f); };
      });
    } else if (current === "bookings") {
      var b = await sb.from("bookings").select("id,status,created_at,profiles(full_name,email),sessions(title,starts_at)").order("created_at", { ascending: false });
      panel.innerHTML = "<div class='card'><table><tr><th>Кто</th><th>Созвон</th><th>Статус</th></tr>" +
        (b.data || []).map(function (r) {
          var who = (r.profiles && (r.profiles.full_name || r.profiles.email)) || "";
          var title = (r.sessions && r.sessions.title) || "";
          return "<tr><td>" + esc(who) + "</td><td>" + esc(title) + "</td><td><select data-book='" + r.id + "'>" +
            ["booked", "cancelled", "attended", "no_show"].map(function (s) {
              return "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>";
            }).join("") + "</select></td></tr>";
        }).join("") + "</table></div>";
      panel.querySelectorAll("[data-book]").forEach(function (sel) {
        sel.onchange = function () { sb.from("bookings").update({ status: sel.value }).eq("id", sel.dataset.book).then(done); };
      });
    } else if (current === "people") {
      var people = await sb.from("profiles").select("id,full_name,email,telegram,level").order("created_at", { ascending: false });
      panel.innerHTML = "<div class='card'><table><tr><th>Имя</th><th>Email</th><th>Telegram</th><th>Уровень</th><th></th></tr>" +
        (people.data || []).map(function (p) {
          return "<tr><td>" + esc(p.full_name) + "</td><td>" + esc(p.email) + "</td><td>" + esc(p.telegram) + "</td><td>" + esc(p.level) +
            "</td><td><button class='btn' data-gift='" + p.id + "'>+1 занятие</button></td></tr>";
        }).join("") + "</table></div>";
      panel.querySelectorAll("[data-gift]").forEach(function (btn) {
        btn.onclick = function () { gift(btn.dataset.gift); };
      });
    } else if (current === "leads") {
      var leads = await sb.from("leads").select("*").order("created_at", { ascending: false });
      panel.innerHTML = "<div class='card'><table><tr><th>Имя</th><th>Контакт</th><th>Текст</th><th>Статус</th></tr>" +
        (leads.data || []).map(function (r) {
          return "<tr><td>" + esc(r.name) + "</td><td>" + esc(r.contact) + "</td><td>" + esc(r.message) + "</td><td><select data-lead='" + r.id + "'>" +
            ["new", "contacted", "converted", "closed"].map(function (s) {
              return "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>";
            }).join("") + "</select></td></tr>";
        }).join("") + "</table></div>";
      panel.querySelectorAll("[data-lead]").forEach(function (sel) {
        sel.onchange = function () { sb.from("leads").update({ status: sel.value }).eq("id", sel.dataset.lead).then(done); };
      });
    } else if (current === "payments") {
      var pay = await sb.from("payments").select("id,amount_byn,status,provider,created_at,profiles(email)").order("created_at", { ascending: false });
      panel.innerHTML = "<div class='card'><table><tr><th>Кто</th><th>Сумма</th><th>Статус</th><th>Когда</th></tr>" +
        (pay.data || []).map(function (r) {
          return "<tr><td>" + esc(r.profiles && r.profiles.email) + "</td><td>" + esc(r.amount_byn) + " BYN</td><td><select data-pay='" + r.id + "'>" +
            ["pending", "paid", "failed", "refunded"].map(function (s) {
              return "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>";
            }).join("") + "</select></td><td>" + esc(new Date(r.created_at).toLocaleString("ru-RU")) + "</td></tr>";
        }).join("") + "</table></div>";
      panel.querySelectorAll("[data-pay]").forEach(function (sel) {
        sel.onchange = function () {
          var patch = { status: sel.value };
          if (sel.value === "paid") patch.paid_at = new Date().toISOString();
          sb.from("payments").update(patch).eq("id", sel.dataset.pay).then(done);
        };
      });
    }
    if (panel.innerHTML === "Загрузка…") panel.innerHTML = "<p class='err'>Нет доступа или пусто.</p>";
  }

  function table(rows, cols, extra) {
    rows = rows || [];
    return "<div class='card'><table><tr>" + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "<th></th></tr>" +
      rows.map(function (r) {
        return "<tr>" + cols.map(function (c) { return "<td>" + esc(c === "starts_at" ? new Date(r[c]).toLocaleString("ru-RU") : r[c]) + "</td>"; }).join("") +
          "<td>" + extra(r) + "</td></tr>";
      }).join("") + "</table></div>";
  }

  function sessionForm() {
    return '<form class="card rowform" id="add-session"><input name="title" placeholder="Название" required><input name="room" placeholder="Комната"><input name="speaker_name" placeholder="Спикер"><input name="starts_at" type="datetime-local" required><input name="duration_min" type="number" value="60" style="width:80px"><input name="max_participants" type="number" value="6" style="width:70px"><input name="zoom_url" placeholder="Zoom"><button class="btn primary" type="submit">Добавить созвон</button></form>';
  }

  function speakerForm() {
    return '<form class="card rowform" id="add-speaker"><input name="name" placeholder="Имя" required><input name="origin" placeholder="Откуда"><input name="topic" placeholder="Тема"><input name="bio" placeholder="Коротко"><button class="btn primary" type="submit">Добавить спикера</button></form>';
  }

  function speakerFields(f) {
    return {
      name: f.name.value.trim(),
      origin: f.origin.value.trim(),
      topic: f.topic.value.trim(),
      bio: f.bio.value.trim(),
      is_active: f.is_active ? f.is_active.checked : true
    };
  }

  async function addSpeaker(e) {
    e.preventDefault();
    done(await sb.from("speakers").insert(speakerFields(e.target)));
  }

  async function saveSpeaker(f) {
    done(await sb.from("speakers").update(speakerFields(f)).eq("id", f.dataset.id));
  }

  async function addSession(e) {
    e.preventDefault();
    var f = e.target;
    var res = await sb.from("sessions").insert({
      title: f.title.value,
      room: f.room.value,
      speaker_name: f.speaker_name.value,
      starts_at: new Date(f.starts_at.value).toISOString(),
      duration_min: Number(f.duration_min.value) || 60,
      max_participants: Number(f.max_participants.value) || 6,
      zoom_url: f.zoom_url.value
    });
    done(res);
  }

  async function savePack(f) {
    var res = await sb.from("packages").update({
      title: f.title.value,
      price_byn: Number(f.price_byn.value),
      sessions_count: Number(f.sessions_count.value),
      is_active: f.is_active.checked
    }).eq("id", f.dataset.id);
    done(res);
  }

  async function remove(tableName, id) {
    if (!confirm("Удалить?")) return;
    done(await sb.from(tableName).delete().eq("id", id));
  }

  async function gift(userId) {
    var pack = await sb.from("packages").select("id").eq("code", "single").maybeSingle();
    var res = await sb.from("user_packages").insert({
      user_id: userId,
      package_id: pack.data && pack.data.id,
      sessions_total: 1,
      sessions_left: 1,
      source: "admin"
    });
    done(res);
  }

  function done(res) {
    if (res && res.error) msg(res.error.message, true);
    else { msg("Сохранено"); render(); }
  }

  async function boot() {
    if (!sb) { deny(); return; }
    var session = await sb.auth.getSession();
    var user = session.data && session.data.session && session.data.session.user;
    if (!user) { location.replace("cabinet.html?next=admin.html"); return; }
    var admin = await sb.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!admin.data) { deny(); return; }
    document.getElementById("app").hidden = false;
    var box = document.getElementById("tabs");
    box.innerHTML = tabs.map(function (t) {
      return '<button type="button" data-tab="' + t[0] + '"' + (t[0] === current ? ' class="on"' : "") + ">" + t[1] + "</button>";
    }).join("");
    box.onclick = function (e) {
      var id = e.target.dataset && e.target.dataset.tab;
      if (!id) return;
      current = id;
      box.querySelectorAll("button").forEach(function (b) { b.className = b.dataset.tab === id ? "on" : ""; });
      render();
    };
    render();
  }

  function deny() {
    document.querySelector("h1").hidden = true;
    document.getElementById("hint").hidden = true;
    document.getElementById("denied").hidden = false;
  }

  boot();
})();
