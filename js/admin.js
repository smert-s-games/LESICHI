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
    ["clients", "CRM"],
    ["payments", "Оплаты"]
  ];
  var current = "sessions";
  var renderVersion = 0;
  var clientPage = 0;
  var clientPageSize = 30;
  var clientStages = {
    registered: "Зарегистрирован",
    new: "Новая заявка",
    contacted: "Связались",
    trial_booked: "Записан на пробное",
    trial_attended: "Посетил пробное",
    awaiting_payment: "Ожидает оплаты",
    paid: "Оплатил",
    active: "Активный клиент",
    lapsed: "Не продлил",
    returned: "Вернулся"
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    var version = ++renderVersion;
    var target = document.getElementById("panel");
    var panel = document.createElement("div");
    target.textContent = "Загрузка…";
    try {
      await renderTab(panel, current);
      if (version === renderVersion) target.replaceChildren(...panel.childNodes);
    } catch (error) {
      if (version === renderVersion) target.textContent = "Раздел не загрузился. Попробуй открыть его ещё раз.";
    }
  }

  async function renderTab(panel, tab) {
    if (tab === "sessions") {
      var rows = await sb.from("sessions").select("*").order("starts_at", { ascending: false });
      var booked = await sb.from("bookings").select("session_id,status,profiles(full_name,email,telegram)").eq("status", "booked");
      var linkRes = await sb.from("session_links").select("session_id,zoom_url");
      var zoomBy = {};
      (linkRes.data || []).forEach(function (l) { zoomBy[l.session_id] = l.zoom_url; });
      var by = {};
      (booked.data || []).forEach(function (b) {
        if (!by[b.session_id]) by[b.session_id] = [];
        by[b.session_id].push(b);
      });
      var list = (rows.data || []).map(function (r) {
        var people = by[r.id] || [];
        var who = people.length ? people.map(function (p) {
          var pr = p.profiles || {};
          var name = pr.full_name || pr.email || "Без имени";
          return "<div>" + esc(name) +
            (pr.email && pr.full_name ? " · " + esc(pr.email) : "") +
            (pr.telegram ? " · " + esc(pr.telegram) : "") + "</div>";
        }).join("") : "<div class='muted'>Никто не записан</div>";
        return '<div class="card"><strong>' + esc(r.title) + "</strong>" +
          '<div class="muted">' + esc(new Date(r.starts_at).toLocaleString("ru-RU")) +
          " · " + esc(r.speaker_name || "без спикера") +
          " · " + people.length + "/" + esc(r.max_participants) + " · " + esc(r.status) + "</div>" +
          who +
          '<form class="rowform" data-zoom="' + esc(r.id) + '" style="margin-top:8px"><input name="zoom_url" placeholder="Zoom-ссылка" value="' + esc(zoomBy[r.id] || "") + '" style="min-width:260px">' +
          '<button class="btn" type="submit">Сохранить ссылку</button>' +
          '<button class="btn" type="button" data-del="' + esc(r.id) + '">Удалить</button></form></div>';
      }).join("");
      if (booked.error) list = "<p class='err'>" + esc(booked.error.message) + "</p>" + list;
      panel.innerHTML = sessionForm() + (list || "<p>Созвонов нет</p>");
      panel.querySelector("#add-session").onsubmit = addSession;
      panel.querySelectorAll("form[data-zoom]").forEach(function (f) {
        f.onsubmit = function (e) { e.preventDefault(); saveZoom(f.dataset.zoom, f.zoom_url.value); };
      });
      panel.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () { removeSession(b.dataset.del); };
      });
    } else if (tab === "speakers") {
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
    } else if (tab === "packages") {
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
    } else if (tab === "bookings") {
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
        sel.onchange = function () { sb.rpc("admin_set_booking_status", { p_booking_id: sel.dataset.book, p_status: sel.value }).then(done); };
      });
    } else if (tab === "people") {
      var people = await sb.from("profiles").select("id,full_name,email,telegram,level").order("created_at", { ascending: false });
      panel.innerHTML = "<div class='card'><table><tr><th>Имя</th><th>Email</th><th>Telegram</th><th>Уровень</th><th></th></tr>" +
        (people.data || []).map(function (p) {
          return "<tr><td>" + esc(p.full_name) + "</td><td>" + esc(p.email) + "</td><td>" + esc(p.telegram) + "</td><td>" + esc(p.level) +
            "</td><td><button class='btn' data-gift='" + p.id + "'>+1 занятие</button></td></tr>";
        }).join("") + "</table></div>";
      panel.querySelectorAll("[data-gift]").forEach(function (btn) {
        btn.onclick = function () { gift(btn.dataset.gift); };
      });
    } else if (tab === "leads") {
      var leads = await sb.from("leads").select("*").order("created_at", { ascending: false });
      if (leads.error) throw leads.error;
      panel.innerHTML = '<form class="card rowform" id="add-lead">' +
        '<input name="lead_name" aria-label="Имя" placeholder="Имя" maxlength="100">' +
        '<input name="contact" aria-label="Email или Telegram" placeholder="Email или Telegram" maxlength="200" required>' +
        '<button class="btn primary" type="submit">Добавить заявку</button></form>' +
        "<div class='card'><table><tr><th>Имя</th><th>Контакт</th><th>Текст</th><th>Статус</th></tr>" +
        (leads.data || []).map(function (r) {
          return "<tr><td>" + esc(r.name) + "</td><td>" + esc(r.contact) + "</td><td>" + esc(r.message) + "</td><td><select data-lead='" + r.id + "'>" +
            ["new", "contacted", "converted", "closed"].map(function (s) {
              return "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>";
            }).join("") + "</select></td></tr>";
        }).join("") + "</table></div>";
      panel.querySelector("#add-lead").onsubmit = addLead;
      panel.querySelectorAll("[data-lead]").forEach(function (sel) {
        sel.onchange = function () { sb.from("leads").update({ status: sel.value }).eq("id", sel.dataset.lead).then(done); };
      });
    } else if (tab === "clients") {
      await renderClients(panel);
    } else if (tab === "payments") {
      var pay = await sb.from("payments").select("id,amount_byn,status,provider,created_at,profiles(email),packages(title)").order("created_at", { ascending: false });
      panel.innerHTML = "<p class='muted'>Статус paid автоматически добавляет занятия пользователю (один раз). refunded и failed — снимают их.</p>" +
        "<div class='card'><table><tr><th>Кто</th><th>Пакет</th><th>Сумма</th><th>Статус</th><th>Когда</th></tr>" +
        (pay.data || []).map(function (r) {
          return "<tr><td>" + esc(r.profiles && r.profiles.email) + "</td><td>" + esc(r.packages && r.packages.title) + "</td><td>" + esc(r.amount_byn) + " BYN</td><td><select data-pay='" + esc(r.id) + "'>" +
            ["pending", "paid", "failed", "refunded"].map(function (s) {
              return "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>";
            }).join("") + "</select></td><td>" + esc(new Date(r.created_at).toLocaleString("ru-RU")) + "</td></tr>";
        }).join("") + "</table></div>";
      panel.querySelectorAll("[data-pay]").forEach(function (sel) {
        sel.onchange = function () {
          sb.from("payments").update({ status: sel.value }).eq("id", sel.dataset.pay).then(done);
        };
      });
    }
  }

  async function addLead(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var contact = form.elements.contact.value.trim();
    if (!contact) { msg("Укажи Email или Telegram.", true); return; }
    var button = form.querySelector("button");
    button.disabled = true;
    try {
      done(await sb.from("leads").insert({
        name: form.elements.lead_name.value.trim(),
        contact: contact,
        source: "admin"
      }));
    } catch (error) {
      msg("Заявка не сохранилась. Попробуй ещё раз.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function renderClients(panel) {
    var start = clientPage * clientPageSize;
    var results = await Promise.all([
      sb.from("crm_client_overview").select("*")
        .order("created_at", { ascending: false }).order("profile_id").range(start, start + clientPageSize),
      sb.from("leads").select("id,name,contact,crm_clients(profile_id)").is("crm_clients", null)
        .order("created_at", { ascending: false }).limit(100)
    ]);
    var clients = results[0];
    var leads = results[1];
    if (clients.error) throw clients.error;
    if (leads.error) throw leads.error;

    var options = leads.data.map(function (lead) {
      return '<option value="' + esc(lead.id) + '">' + esc([lead.name, lead.contact].filter(Boolean).join(" · ")) + '</option>';
    }).join("");
    panel.innerHTML = '<p class="crm-heading muted">Свяжи заявку с аккаунтом по знакомому контакту. Оплаты подтверждаются на вкладке «Оплаты».</p>' +
      clients.data.slice(0, clientPageSize).map(function (client) { return clientCard(client, options); }).join("") +
      (clients.data.length ? "" : '<p class="muted">Зарегистрированных клиентов пока нет.</p>') +
      '<div class="crm-pages">' +
      (clientPage > 0 ? '<button class="btn ghost" type="button" data-client-page="-1">Назад</button>' : '') +
      (clients.data.length > clientPageSize ? '<button class="btn ghost" type="button" data-client-page="1">Дальше</button>' : '') + '</div>';

    panel.querySelectorAll("form[data-crm-profile]").forEach(function (form) { form.onsubmit = saveClient; });
    panel.querySelectorAll("[data-client-page]").forEach(function (button) {
      button.onclick = function () { clientPage += Number(button.dataset.clientPage); render(); };
    });
  }

  function clientCard(client, availableLeads) {
    var profileId = esc(client.profile_id);
    var override = client.stage_override;
    var bookingLabels = { booked: "Записан", attended: "Посетил", no_show: "Не пришёл", cancelled: "Отменено" };
    var paymentLabels = { pending: "Ожидает оплаты", paid: "Оплачено", failed: "Не прошло", refunded: "Возвращено" };
    var levelLabels = { unknown: "Не указан", beginner: "Начальный", intermediate: "Средний", advanced: "Уверенный" };
    var trial = client.trial_status ? [client.trial_title, client.trial_speaker, bookingLabels[client.trial_status]].filter(Boolean).join(" · ") : "—";
    var payment = client.payment_status ? [client.package_title, client.amount_byn + " BYN", paymentLabels[client.payment_status]].filter(Boolean).join(" · ") : "—";
    var stageOptions = Object.keys(clientStages).map(function (value) {
      return '<option value="' + value + '"' + (override === value ? " selected" : "") + '>' + clientStages[value] + '</option>';
    }).join("");
    var linkedLead = client.lead_id ? '<option selected value="' + esc(client.lead_id) + '">' + esc(client.lead_contact) + '</option>' : "";
    var leadDisabled = !client.lead_id && !availableLeads;
    var emptyLeadLabel = client.lead_id ? "Отвязать заявку" : (availableLeads ? "Выбрать заявку" : "Нет свободных заявок");
    return '<article class="card"><h2>' + esc(client.full_name || client.email || "Без имени") + '</h2>' +
      '<p class="muted">' + esc([client.email, client.telegram, levelLabels[client.level] || client.level].filter(Boolean).join(" · ")) + '</p>' +
      '<dl class="crm-facts"><div><dt>Дата заявки</dt><dd>' + esc(client.lead_created_at ? new Date(client.lead_created_at).toLocaleDateString("ru-RU") : "—") + '</dd></div>' +
      '<div><dt>Последнее пробное</dt><dd>' + esc(trial) + '</dd></div>' +
      '<div><dt>Последний заказ</dt><dd>' + esc(payment) + '</dd></div></dl>' +
      '<form class="rowform crm-form" data-crm-profile="' + profileId + '">' +
      '<div><label for="lead-' + profileId + '">Заявка</label><select class="crm-select" id="lead-' + profileId + '" name="lead_id"' + (leadDisabled ? ' disabled' : '') + '>' +
      '<option value="">' + emptyLeadLabel + '</option>' + linkedLead + availableLeads + '</select></div>' +
      '<div><label for="stage-' + profileId + '">Этап</label><select class="crm-select" id="stage-' + profileId + '" name="stage">' +
      '<option value="">Авто · ' + esc(clientStages[client.suggested_stage]) + '</option>' + stageOptions + '</select></div>' +
      '<button class="btn primary" type="submit">Сохранить</button></form></article>';
  }

  async function saveClient(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button");
    button.disabled = true;
    try {
      var result = await sb.from("crm_clients").upsert({
        profile_id: form.dataset.crmProfile,
        lead_id: form.elements.lead_id.value || null,
        stage: form.elements.stage.value || null
      }, { onConflict: "profile_id" });
      if (result.error && result.error.code === "23505") {
        msg("Эту заявку уже связали с другим аккаунтом. Обнови список.", true);
      } else {
        done(result);
      }
    } catch (error) {
      msg("Изменения не сохранились. Попробуй ещё раз.", true);
    } finally {
      button.disabled = false;
    }
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
    return '<form class="card rowform" id="add-session"><input name="title" placeholder="Название" required><input name="room" placeholder="Комната"><input name="level" placeholder="Уровень (например B1)"><input name="speaker_name" placeholder="Спикер"><input name="starts_at" type="datetime-local" required><input name="duration_min" type="number" value="60" style="width:80px"><input name="max_participants" type="number" value="6" style="width:70px"><input name="zoom_url" placeholder="Zoom"><button class="btn primary" type="submit">Добавить созвон</button></form>';
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
      ...(f.level.value.trim() ? { level: f.level.value.trim() } : {}),
      max_participants: Number(f.max_participants.value) || 6
    }).select("id").single();
    if (!res.error && f.zoom_url.value.trim()) {
      res = await sb.from("session_links").insert({ session_id: res.data.id, zoom_url: f.zoom_url.value.trim() });
    }
    done(res);
  }

  async function saveZoom(sessionId, url) {
    url = (url || "").trim();
    if (url && !/^https?:\/\//i.test(url)) { msg("Ссылка должна начинаться с http:// или https://", true); return; }
    if (!url) done(await sb.from("session_links").delete().eq("session_id", sessionId));
    else done(await sb.from("session_links").upsert({ session_id: sessionId, zoom_url: url, updated_at: new Date().toISOString() }));
  }

  async function removeSession(id) {
    if (!confirm("Удалить созвон? Все записанные получат занятие обратно на баланс.")) return;
    var res = await sb.rpc("admin_delete_session", { p_session_id: id });
    if (res.error) { msg(res.error.message, true); return; }
    await render();
    msg("Удалено. Возвращено занятий: " + res.data);
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
    if (admin.error) { msg("Сервис временно недоступен. Обнови страницу через несколько минут.", true); return; }
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

  boot().catch(function () {
    msg("Сервис временно недоступен. Обнови страницу через несколько минут.", true);
  });
})();
