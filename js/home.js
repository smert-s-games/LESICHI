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

  sb.from("sessions_with_seats").select("id,title,speaker_name,room,starts_at,seats_left,status")
    .eq("status", "open").gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true }).limit(12)
    .then(function (res) {
      var box = document.getElementById("meet-list");
      var rows = (res.data || []).filter(function (s) { return s.seats_left == null || s.seats_left > 0; }).slice(0, 3);
      if (!box || !rows.length) return;
      box.innerHTML = rows.map(function (s) {
        var hot = s.seats_left != null && s.seats_left <= 2;
        var who = s.speaker_name ? " · " + esc(s.speaker_name) : "";
        return '<div class="event reveal visible"><div><h3>' + esc(s.title) + '</h3><div class="event-meta"><span>' +
          esc(when(s.starts_at)) + who + '</span><span class="spot' + (hot ? " hot" : "") + '">' +
          esc(s.seats_left == null ? "" : s.seats_left + " мест") + '</span></div></div><a href="cabinet.html" class="btn">Записаться</a></div>';
      }).join("");
    });

  sb.from("speakers").select("name,origin,bio,topic").eq("is_active", true)
    .then(function (res) {
      if (res.error) return fillSpeakersFromSessions();
      var people = (res.data || []).map(function (p) {
        return { name: p.name, room: p.origin || p.topic || "", bio: p.bio || "" };
      });
      if (!people.length) return fillSpeakersFromSessions();
      showSpeakers(people);
    });

  function showSpeakers(people) {
    var box = document.getElementById("speaker-list");
    if (!box || !people.length) return;
    for (var i = people.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = people[i];
      people[i] = people[j];
      people[j] = tmp;
    }
    var tones = ["s1", "s2", "s3"];
    box.innerHTML = people.slice(0, 3).map(function (p, i) {
      var letter = esc(p.name.charAt(0).toUpperCase());
      var room = p.room ? '<div class="from">' + esc(p.room) + "</div>" : "";
      var bio = p.bio ? "<p>" + esc(p.bio) + "</p>" : "";
      return '<div class="card speaker reveal visible"><div class="speaker-av ' + tones[i % 3] + '">' + letter +
        "</div><h3>" + esc(p.name) + "</h3>" + room + bio + "</div>";
    }).join("");
  }

  function fillSpeakersFromSessions() {
    sb.from("sessions").select("speaker_name,room").not("speaker_name", "is", null).then(function (res) {
      if (!res.data) return;
      var seen = {};
      var people = [];
      res.data.forEach(function (row) {
        var name = (row.speaker_name || "").trim();
        if (!name || seen[name.toLowerCase()]) return;
        seen[name.toLowerCase()] = true;
        people.push({ name: name, room: row.room || "", bio: "" });
      });
      showSpeakers(people);
    });
  }

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
