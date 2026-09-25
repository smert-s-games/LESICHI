(function () {
  var cfg = window.LESICHI_SUPABASE || {};
  if (!cfg.url || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  sb.from("sessions_with_seats").select("id,title,speaker_name,starts_at,seats_left,status")
    .in("status", ["open", "full"]).gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true }).limit(6)
    .then(function (res) {
      var box = document.getElementById("meet-list");
      if (!box || !res.data || !res.data.length) return;
      box.innerHTML = res.data.map(function (s) {
        var hot = s.seats_left != null && s.seats_left <= 2;
        return '<div class="event reveal visible"><div><h3>' + esc(s.title) + '</h3><div class="event-meta"><span>' +
          esc(when(s.starts_at)) + '</span><span class="spot' + (hot ? " hot" : "") + '">' +
          esc(s.seats_left == null ? "" : s.seats_left + " мест") + '</span></div></div><a href="cabinet.html" class="btn">Записаться</a></div>';
      }).join("");
    });

  sb.from("packages").select("code,title,sessions_count,price_byn").eq("is_active", true).order("price_byn")
    .then(function (res) {
      var box = document.getElementById("price-list");
      if (!box || !res.data || !res.data.length) return;
      box.innerHTML = res.data.map(function (p, i) {
        var hot = i === 1;
        return '<div class="price-card reveal visible' + (hot ? " hot" : "") + '">' +
          (hot ? '<div class="badge">Оптимально</div>' : "") +
          "<h3>" + esc(p.title) + '</h3><div class="price-num">' + esc(p.price_byn) +
          ' <span>BYN</span></div><div class="price-desc">' + esc(p.sessions_count) +
          ' созвон(а)</div><a href="order.html?pack=' + encodeURIComponent(p.code) +
          '" class="btn' + (hot ? "" : " btn-ghost") + '" style="width:100%;justify-content:center">' +
          (hot ? "Взять" : "Выбрать") + "</a></div>";
      }).join("");
    });
})();
