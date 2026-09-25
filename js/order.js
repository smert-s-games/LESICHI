(function () {
  var packs = {
    single: { code: "single", title: "Разовый", sessions: 1, price: 15 },
    pack4: { code: "pack4", title: "4 созвона", sessions: 4, price: 50 },
    pack8: { code: "pack8", title: "8 созвонов", sessions: 8, price: 90 }
  };
  var key = new URLSearchParams(location.search).get("pack") || "pack4";
  var pack = packs[key] || packs.pack4;
  var here = "order.html?pack=" + encodeURIComponent(pack.code);

  document.getElementById("pack-title").textContent = pack.title;
  document.getElementById("pack-price").innerHTML = pack.price + " <span>BYN</span>";
  document.getElementById("pack-meta").textContent = pack.sessions + " созвон(а) по 60 минут · группа до 6";

  var cfg = window.LESICHI_SUPABASE || {};
  var sb = (cfg.url && cfg.anonKey && window.supabase)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  function toLogin() {
    location.replace("cabinet.html?next=" + encodeURIComponent(here));
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
    var profile = await sb.from("profiles").select("full_name,email,telegram").eq("id", user.id).maybeSingle();
    var p = profile.data || {};
    document.getElementById("name").value = p.full_name || "";
    document.getElementById("email").value = p.email || user.email || "";
    document.getElementById("tg").value = p.telegram || "";
    document.getElementById("gate").hidden = true;
    document.getElementById("order").hidden = false;
  }

  document.getElementById("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var msg = document.getElementById("msg");
    msg.style.color = "#2B1B5E";
    msg.textContent = "Проводим оплату…";
    var res = await sb.rpc("purchase_package", { p_code: pack.code });
    if (res.error) {
      msg.style.color = "#B42318";
      msg.textContent = res.error.message.indexOf("purchase_package") !== -1
        ? "Функция покупки ещё не создана в базе. Нужно один раз выполнить её в SQL Editor."
        : res.error.message;
      return;
    }
    document.getElementById("order").hidden = true;
    document.getElementById("done").hidden = false;
    document.getElementById("done-text").textContent =
      "Имитация оплаты прошла. На баланс добавлено занятий: " + (res.data || pack.sessions) + ".";
  });

  boot();
})();
