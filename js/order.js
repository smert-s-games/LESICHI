(function () {
  var packs = {
    single: { code: "single", title: "Разовый", sessions: 1, price: 15 },
    pack4: { code: "pack4", title: "4 созвона", sessions: 4, price: 50 },
    pack8: { code: "pack8", title: "8 созвонов", sessions: 8, price: 90 }
  };
  var key = new URLSearchParams(location.search).get("pack") || "pack4";
  var pack = packs[key] || packs.pack4;

  document.getElementById("pack-title").textContent = pack.title;
  document.getElementById("pack-price").innerHTML = pack.price + " <span>BYN</span>";
  document.getElementById("pack-meta").textContent = pack.sessions + " созвон(а) по 60 минут · группа до 6";

  var cfg = window.LESICHI_SUPABASE || {};
  var sb = (cfg.url && cfg.anonKey && window.supabase)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  document.getElementById("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var msg = document.getElementById("msg");
    var name = document.getElementById("name").value.trim();
    var email = document.getElementById("email").value.trim();
    var tg = document.getElementById("tg").value.trim();
    msg.style.color = "#B42318";
    if (!sb) {
      msg.textContent = "База не подключена. Напиши в Telegram @lesichi.";
      return;
    }
    msg.style.color = "#2B1B5E";
    msg.textContent = "Сохраняю…";
    var lead = await sb.from("leads").insert({
      name: name,
      contact: email,
      source: "order",
      message: pack.code + " · " + pack.price + " BYN" + (tg ? " · " + tg : "")
    });
    if (lead.error) {
      msg.style.color = "#B42318";
      msg.textContent = lead.error.message;
      return;
    }
    var session = await sb.auth.getSession();
    var user = session.data && session.data.session && session.data.session.user;
    if (user) {
      var pkg = await sb.from("packages").select("id").eq("code", pack.code).maybeSingle();
      if (pkg.data) {
        await sb.from("payments").insert({
          user_id: user.id,
          package_id: pkg.data.id,
          amount_byn: pack.price,
          status: "pending",
          provider: "manual"
        });
      }
    }
    document.getElementById("order").hidden = true;
    document.getElementById("done").hidden = false;
    document.getElementById("done-text").textContent =
      name + ", пакет «" + pack.title + "» за " + pack.price + " BYN сохранён. Мы напишем на " + email + ".";
  });
})();
