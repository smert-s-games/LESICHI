(function () {
  var cfg = window.LESICHI_SUPABASE || {};
  if (!cfg.url || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var box = document.getElementById("meet-list");
  var levelFilter = document.getElementById("meet-level");
  var dateFormat = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
  var columns = "id,title,speaker_name,starts_at,duration_min,seats_left,status";

  function fetchSchedule(fields) {
    return sb.from("sessions_with_seats").select(fields)
      .in("status", ["open", "full"]).gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true });
  }

  async function showSchedule() {
    try {
      var result = await fetchSchedule(columns + ",level");
      if (result.error && result.error.code === "42703") result = await fetchSchedule(columns);
      if (result.error) throw result.error;
      var rows = result.data || [];
      Array.from(new Set(rows.map(function (s) { return s.level; }).filter(Boolean))).sort()
        .forEach(function (level) { levelFilter.add(new Option(level, level)); });
      function render() {
        var visible = rows.filter(function (s) { return !levelFilter.value || s.level === levelFilter.value; });
        box.innerHTML = visible.map(function (s) {
          var start = new Date(s.starts_at);
          var end = new Date(start.getTime() + s.duration_min * 60000);
          var details = [dateFormat.formatRange(start, end) + " (Минск, UTC+3)", s.level || "Уровень уточняется", s.speaker_name].filter(Boolean);
          var available = s.status === "open" && s.seats_left > 0;
          var action = available
            ? '<a class="btn" href="cabinet.html?session=' + encodeURIComponent(s.id) + '">Записаться</a>'
            : '<span>Мест нет</span>';
          return '<article class="event reveal visible"><div><h3>' + esc(s.title) + '</h3><div class="event-meta">' +
            esc(details.join(" · ")) + (available ? " · Свободных мест: " + s.seats_left : "") +
            '</div></div>' + action + '</article>';
        }).join("") || "<p>Подходящих встреч пока нет.</p>";
      }
      levelFilter.addEventListener("change", render);
      render();
    } catch (error) {
      box.textContent = "Расписание не загрузилось. Обнови страницу и попробуй снова.";
    }
  }
  showSchedule();

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
