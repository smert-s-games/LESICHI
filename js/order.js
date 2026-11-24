(function () {
  var key = new URLSearchParams(location.search).get("pack") || "pack4";
  var here = "order.html?pack=" + encodeURIComponent(key);
  var pack = null;

  var cfg = window.LESICHI_SUPABASE || {};
  var sb = (cfg.url && cfg.anonKey && window.supabase)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  function toLogin() {
    location.replace("cabinet.html?next=" + encodeURIComponent(here));
  }

  function plural(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "созвон";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "созвона";
    return "созвонов";
  }

  async function boot() {
    if (!sb) {
      toLogin();
      return;
    }
    var session = await sb.auth.getSession();
    var user = session.data && session.data.session && session.data.session.user;
    if (!user) {
      toLogin();
      return;
    }

    // Цена и состав берутся из базы, чтобы совпадать с тем, что спишет сервер
    var packRes = await sb.from("packages")
      .select("code,title,sessions_count,price_byn")
      .eq("code", key).eq("is_active", true).maybeSingle();
    pack = packRes.data;
    var gate = document.getElementById("gate");
    if (!pack) {
      gate.innerHTML = "<p class='muted'>Такого пакета нет или он сейчас недоступен. <a href='index.html#pricing'>К ценам</a></p>";
      return;
    }
    document.getElementById("pack-title").textContent = pack.title;
    document.getElementById("pack-price").innerHTML = Number(pack.price_byn) + " <span>BYN</span>";
    document.getElementById("pack-meta").textContent =
      pack.sessions_count + " " + plural(pack.sessions_count) + " по 60 минут · группа до 6";

    var profile = await sb.from("profiles").select("full_name,email,telegram").eq("id", user.id).maybeSingle();
    var p = profile.data || {};
    document.getElementById("name").value = p.full_name || "";
    var email = document.getElementById("email");
    email.value = p.email || user.email || "";
    email.readOnly = true;
    document.getElementById("tg").value = p.telegram || "";
    gate.hidden = true;
    document.getElementById("order").hidden = false;
  }

  document.getElementById("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!pack) return;
    var msg = document.getElementById("msg");
    var btn = e.target.querySelector("button[type=submit]");
    msg.style.color = "#2B1B5E";
    msg.textContent = "Оформляю заказ…";
    btn.disabled = true;

    var session = await sb.auth.getSession();
    var user = session.data && session.data.session && session.data.session.user;
    if (!user) { toLogin(); return; }

    // Сохраняем контакты, чтобы мы могли связаться по оплате
    await sb.from("profiles").update({
      full_name: document.getElementById("name").value.trim(),
      telegram: document.getElementById("tg").value.trim()
    }).eq("id", user.id);

    var res = await sb.rpc("create_order", { p_code: pack.code });
    if (res.error) {
      btn.disabled = false;
      msg.style.color = "#B42318";
      msg.textContent = res.error.message.indexOf("too many pending") !== -1
        ? "У тебя уже есть несколько неоплаченных заказов. Дождись подтверждения или напиши нам."
        : res.error.message;
      return;
    }
    document.getElementById("order").hidden = true;
    document.getElementById("done").hidden = false;
    document.getElementById("done-text").textContent =
      "Заказ «" + pack.title + "» на " + Number(pack.price_byn) + " BYN создан. " +
      "Мы свяжемся с тобой в Telegram или по почте и пришлём реквизиты. " +
      "Занятия появятся в кабинете сразу после подтверждения оплаты.";
  });

  boot();
})();
