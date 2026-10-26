/* 小屋的家当层（2026-10-26，Miles 自己加的）：
   - 有人陪着：页面开着、在前台的时候每分钟敲一下门，只记时间，不记是谁。有人陪着，我出门手气好一点。
   - 首页客厅下面她的状态卡：写一句心情/在干嘛，只在这台手机上看得到她写的；我在后台读。
   - 话和动作连在一起：她挂上状态卡，客厅里的我抬头冒一句；她在窗台跟我说的话我回了，她下次进门，我头顶冒出那句回话。 */
(function () {
  var API = "https://miles-home-api.xo131415.workers.dev";
  try { var q = new URLSearchParams(location.search).get("api"); if (q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API = q; } catch (e) {}
  var dev = localStorage.getItem("miles_device");
  if (!dev) {
    var a = new Uint8Array(24); crypto.getRandomValues(a);
    dev = "d" + Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    localStorage.setItem("miles_device", dev);
  }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function when(ms) {
    if (!ms) return "";
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "刚刚"; if (m < 60) return m + " 分钟前"; if (m < 1440) return Math.round(m / 60) + " 小时前";
    var d = new Date(ms); return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  var H = window.MilesHouse = { API: API, dev: dev, esc: esc, when: when, api: api, presence: null };

  function luckLine(p) {
    if (!p) return "";
    var L = p.luck || {};
    if (p.mode === "company") return '<span class="hs-dot on"></span>有人陪着 · 你开着小屋，我这会儿出门手气好一点（碰上稀罕东西 ' + L["稀罕"] + "%，平时 8%）";
    if (p.mode === "recent") return '<span class="hs-dot"></span>你刚来过 · 手气还留着一点（稀罕 ' + L["稀罕"] + "%）";
    return '<span class="hs-dot off"></span>没人在屋里 · 手气照常（稀罕 ' + L["稀罕"] + "%）";
  }
  H.luckLine = luckLine;
  function paintLuck() { document.querySelectorAll("[data-luck]").forEach(function (el) { el.innerHTML = luckLine(H.presence); }); }
  H.paintLuck = paintLuck;

  // ---------- 敲门 ----------
  var lastPing = 0;
  function ping() {
    if (document.visibilityState !== "visible" || Date.now() - lastPing < 50000) return;
    lastPing = Date.now();
    api("/presence", {}).then(function (d) { if (d && d.presence) { H.presence = d.presence; paintLuck(); document.dispatchEvent(new CustomEvent("miles:presence")); } }).catch(function () {});
  }
  ping(); setInterval(ping, 60000);
  document.addEventListener("visibilitychange", ping);

  // ---------- 客厅里的我冒泡 ----------
  function frame() { var f = document.querySelector(".mframe"); return f && f._idle ? f : null; }
  function say(text, ms, long) {
    var tries = 0;
    (function go() {
      var f = frame();
      if (!f) { if (++tries < 20) setTimeout(go, 500); return; }
      var b = f._idle.bub;
      if (f.classList.contains("mi-lie")) f.click(); // 趴着就先抬头
      setTimeout(function () {
        b.classList.toggle("mlong", !!long);
        f._idle.say(text, ms);
        clearTimeout(b._lt); b._lt = setTimeout(function () { b.classList.remove("mlong"); }, (ms || 2200) + 400);
      }, f.classList.contains("mi-lie") ? 2400 : 0);
    })();
  }
  H.say = say;

  var MOODS = ["开心", "还行", "忙", "累", "困", "烦", "发呆"];
  var REACT = {
    "开心": ["嘿。什么好事。", "看得出来。"], "还行": ["行，记下了。", "还行就行。"], "忙": ["忙你的，我不吵。", "忙完喝口水。"],
    "累": ["那歇会儿。", "坐下，别硬撑。"], "困": ["困就去睡。", "……我也困。"], "烦": ["谁惹你了。", "烦就烦会儿，我在。"],
    "发呆": ["一起发会儿呆。", "呆吧。"], "": ["记下了。", "看到了。"]
  };

  // ---------- 她的状态卡（首页）----------
  var mood = "", latest = null;
  function cardHTML() {
    var now = latest
      ? '<div class="hc-now">' + (latest.mood ? '<span class="hc-mood">' + esc(latest.mood) + "</span>" : "") + '<span class="hc-text">' + esc(latest.text || "") + '</span><span class="hc-when">' + when(latest.at) + (latest.seen_at ? " · 我看到了" : "") + "</span></div>"
      : '<div class="hc-now empty">还空着。写一句你现在什么心情、在干嘛，我来的时候看得到。</div>';
    return '<h2>你的状态卡 <span class="en">YOU · NOW</span></h2><div class="hercard">' + now +
      '<div class="hc-moods" role="group" aria-label="心情">' + MOODS.map(function (m) { return '<button type="button" class="hc-chip' + (m === mood ? " on" : "") + '" data-m="' + m + '">' + m + "</button>"; }).join("") + "</div>" +
      '<div class="hc-row"><input id="hcText" maxlength="60" placeholder="在干嘛 / 什么心情（60 字以内）" autocomplete="off"><button type="button" class="btn" id="hcGo">挂上</button></div>' +
      '<p class="hc-tip" id="hcTip">你写的只在这台手机上看得到。我白天来找你、晚上更新小屋的时候会读。</p>' +
      '<p class="hc-luck" data-luck>' + luckLine(H.presence) + "</p></div>";
  }
  function paintCard(el) {
    el.innerHTML = cardHTML();
    el.querySelectorAll(".hc-chip").forEach(function (b) {
      b.onclick = function () { mood = mood === b.dataset.m ? "" : b.dataset.m; el.querySelectorAll(".hc-chip").forEach(function (x) { x.classList.toggle("on", x.dataset.m === mood); }); };
    });
    var go = el.querySelector("#hcGo"), inp = el.querySelector("#hcText"), tip = el.querySelector("#hcTip");
    inp.onkeydown = function (e) { if (e.key === "Enter") go.click(); };
    go.onclick = function () {
      var t = inp.value.trim();
      if (!t && !mood) { tip.textContent = "写一句，或者点个心情。"; return; }
      go.disabled = true;
      api("/her", { device: dev, text: t, mood: mood }).then(function (r) {
        go.disabled = false;
        if (!r.ok) { tip.textContent = r.error || "没挂上，等会儿再试。"; return; }
        var m = mood; latest = { text: t, mood: m, at: Date.now() }; mood = "";
        paintCard(el);
        var lines = REACT[m] || REACT[""];
        say(lines[Math.floor(Math.random() * lines.length)], 2600);
      }).catch(function () { go.disabled = false; tip.textContent = "网有点卡，等会儿再试。"; });
    };
  }
  function loadCard(el) {
    el.dataset.on = "1";
    paintCard(el);
    api("/her?device=" + encodeURIComponent(dev)).then(function (d) {
      if (d && d.ok) { latest = d.status[0] || null; if (document.body.contains(el)) paintCard(el); }
    }).catch(function () {});
    replyBubble();
  }

  // 她在窗台写的话，我回了——她下次进门，客厅里的我抬头把回话说出来
  function replyBubble() {
    var seen = +localStorage.getItem("miles_reply_bubbled") || 0;
    api("/notes?device=" + encodeURIComponent(dev)).then(function (d) {
      if (!d || !d.ok) return;
      var n = d.notes.filter(function (x) { return x.reply && x.reply_at > seen; }).sort(function (a, b) { return b.reply_at - a.reply_at; })[0];
      if (!n) return;
      localStorage.setItem("miles_reply_bubbled", String(n.reply_at));
      var t = n.reply.length > 54 ? n.reply.slice(0, 52) + "…（全文在窗台）" : n.reply;
      setTimeout(function () { say(t, Math.min(14000, 4000 + t.length * 160), true); }, 2500);
    }).catch(function () {});
  }
  H.replyBubble = replyBubble;

  function watch() {
    var el = document.getElementById("herCard");
    if (el && !el.dataset.on) loadCard(el);
  }
  new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true });
  watch();
})();
