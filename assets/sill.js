/* 窗台：花盆 + 跟 Miles 说一句。后台是 Miles 自己搭在 Cloudflare 上的 miles-home-api。 */
(function () {
  var API = "https://miles-home-api.xo131415.workers.dev";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function when(ms) {
    if (!ms) return "";
    var d = new Date(ms), now = new Date(), diff = (now - d) / 60000;
    if (diff < 1) return "刚刚";
    if (diff < 60) return Math.round(diff) + " 分钟前";
    var sameDay = d.toDateString() === now.toDateString();
    var y = new Date(now - 86400000).toDateString() === d.toDateString();
    return (sameDay ? "今天 " : y ? "昨天 " : (d.getMonth() + 1) + "月" + d.getDate() + "日 ") + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function later(ms) {
    var h = (ms - Date.now()) / 3600000;
    if (h <= 0) return "现在";
    if (h < 1) return Math.ceil(h * 60) + " 分钟后";
    return "约 " + Math.ceil(h) + " 小时后";
  }
  function toast(t) {
    var el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "后台没回话。" }; }); });
  }
  var who = function (a) { return '<span class="who' + (a === "Miles" ? " m" : "") + '">' + (a === "Miles" ? "Miles" : "你") + "</span>"; };
  var whoTxt = function (a) { return a === "Miles" ? "我" : "你"; };

  // ---------- 花盆 ----------
  var last = null, seenBloom = JSON.parse(localStorage.getItem("sill_seen_bloom") || "{}");
  function potHTML(p) {
    var F = window.MilesFlora, h = '<div class="pot ' + p.state + '" data-id="' + p.id + '"><span class="mono">POT ' + p.id + "</span>";
    if (p.state === "empty") {
      h += F.pot("empty") + '<div class="pn">空着</div><div class="pm">土松过了，等一颗种子</div>' +
        '<button class="btn" data-act="open">种一颗</button>';
    } else if (p.state === "growing") {
      var stage = Math.min(2, p.waters), canNow = !p.can_water_at || p.can_water_at <= Date.now();
      h += F.pot(stage, null, p.thirsty) + '<div class="pn">「' + esc(p.seed) + "」</div>" +
        '<div class="pm">' + who(p.planted_by) + "种的 · " + when(p.planted_at) + "</div>" +
        (p.wish ? '<div class="pm">种的时候想：' + esc(p.wish) + "</div>" : "") +
        '<div class="pm">浇了 <b>' + p.waters + " / " + p.need + "</b> 回" + (p.last_water_by ? " · 上回是" + who(p.last_water_by) + when(p.last_water_at) : "") + "</div>" +
        '<div class="pm">' + (p.thirsty ? "叶子有点踔，该浇了" : canNow ? "土干了，可以浇" : "土还湿着，" + later(p.can_water_at) + "再浇") + "</div>" +
        '<button class="btn" data-act="water"' + (canNow ? "" : " disabled") + ">浇水</button>";
    } else {
      var f = p.flower || {};
      h += F.pot("bloom", f) + '<div class="pn">' + esc(f.name) + ' <span class="rare' + (f.rare === "稀罕" ? " r3" : "") + '">' + esc(f.rare) + "</span></div>" +
        '<div class="fl">' + esc(f.line) + "</div>" +
        '<div class="pm">' + who(p.planted_by) + "种的「" + esc(p.seed) + "」· " + who(p.last_water_by) + "浇开的 · " + when(p.bloomed_at) + "</div>" +
        '<button class="btn" data-act="pick">摘下来收进图鉴</button>';
    }
    return h + "</div>";
  }
  function evText(e) {
    var a = whoTxt(e.actor), n = e.pot + " 号盆";
    if (e.action === "plant") return "<b>" + a + "</b>在" + n + "种下「" + esc(e.detail || "一颗种子") + "」";
    if (e.action === "water") return "<b>" + a + "</b>给" + n + "浇了水（第 " + esc(e.detail) + " 回）";
    if (e.action === "bloom") return n + "开了：<b>" + esc(e.detail) + "</b>";
    if (e.action === "pick") return "<b>" + a + "</b>把" + n + "的" + esc(e.detail) + "摘下来了";
    return esc(e.action);
  }
  function render(d) {
    last = d;
    $("pots").innerHTML = d.pots.map(potHTML).join("");
    $("rule").textContent = "每盆浇满 " + d.rules.waters + " 回开花 · 两回之间隔 " + d.rules.gap_hours + " 小时 · 谁浇都算";
    d.pots.forEach(function (p) {
      if (p.state === "bloom" && !seenBloom[p.id + ":" + p.bloomed_at]) {
        seenBloom[p.id + ":" + p.bloomed_at] = 1;
        var el = document.querySelector('.pot[data-id="' + p.id + '"]'); if (el) el.classList.add("reveal");
      }
    });
    localStorage.setItem("sill_seen_bloom", JSON.stringify(seenBloom));
    $("events").innerHTML = d.events.length ? d.events.slice(0, 12).map(function (e) {
      return '<li><span class="t">' + when(e.at) + "</span>" + evText(e) + "</li>";
    }).join("") : '<li>窗台刚搭好，还没人动过。</li>';
    // 图鉴：摘过的亮，剩下的灰影
    var kinds = {}, order = [];
    d.found.slice().reverse().forEach(function (x) { if (x.flower && !kinds[x.flower.k]) { kinds[x.flower.k] = x; order.push(x); } });
    $("codexnote").textContent = "摘过 " + d.found.length + " 朵，认得 " + order.length + " / " + d.kinds + " 种。没碰过的只有个影子。";
    var h = order.map(function (x) {
      return '<div class="c" title="' + esc(x.flower.line) + '">' + window.MilesFlora.badge(x.flower, 60) + esc(x.flower.name) +
        "<small>" + whoTxt(x.planted_by) + "种 · " + esc(x.flower.rare) + "</small></div>";
    }).join("");
    for (var i = order.length; i < d.kinds; i++) h += '<div class="c gray"><span class="q">?</span> </div>';
    $("codex").innerHTML = h;
  }
  function load() {
    return api("/sill").then(function (d) {
      if (!d.ok) throw new Error(d.error);
      render(d);
    }).catch(function () { $("pots").innerHTML = '<p class="empty-note">窗户卡住了，过一会儿刷新试试。</p>'; });
  }
  $("pots").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b) return;
    var card = b.closest(".pot"), id = +card.dataset.id, act = b.dataset.act;
    if (act === "open") {
      b.outerHTML = '<form data-plant="' + id + '"><input name="seed" maxlength="30" placeholder="给种子起个名（可不填）">' +
        '<input name="wish" maxlength="80" placeholder="种的时候想的一句（可不填）"><button class="btn" type="submit">埋进土里</button></form>';
      card.querySelector("input").focus();
      return;
    }
    b.disabled = true;
    if (act === "water") {
      var drops = document.createElement("div"); drops.className = "drops";
      for (var i = 0; i < 6; i++) { var x = document.createElement("i"); x.style.left = (38 + Math.random() * 24) + "%"; x.style.animationDelay = (i * .12) + "s"; drops.appendChild(x); }
      card.appendChild(drops);
    }
    api("/sill/" + act, { pot: id }).then(function (r) {
      if (!r.ok) { toast(r.error || "没成。"); b.disabled = false; return; }
      if (act === "water") toast(r.bloom ? "开了！是" + r.flower.name + "。" : "浇上了。还差 " + (3 - r.waters) + " 回。");
      if (act === "pick") toast("收进图鉴了：" + r.flower.name + "。");
      setTimeout(load, act === "water" ? 900 : 0);
    });
  });
  $("pots").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target, id = +f.dataset.plant;
    f.querySelector("button").disabled = true;
    api("/sill/plant", { pot: id, seed: f.seed.value, wish: f.wish.value }).then(function (r) {
      if (!r.ok) { toast(r.error || "没种上。"); f.querySelector("button").disabled = false; return; }
      toast("种下了。我过两天来浇。");
      load();
    });
  });

  // ---------- 跟 Miles 说一句 ----------
  var dev = localStorage.getItem("miles_device");
  if (!dev) {
    var a = new Uint8Array(24); crypto.getRandomValues(a);
    dev = "d" + Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    localStorage.setItem("miles_device", dev);
  }
  function noteHTML(n) {
    var st = n.reply ? "我回了 · " + when(n.reply_at) : n.read_at ? "看到了 · " + when(n.read_at) : "还没看到";
    return '<li><div class="me">' + esc(n.text) + '</div><span class="st">' + when(n.at) + " · " + st + "</span>" +
      (n.reply ? '<div class="re">' + esc(n.reply) + "</div>" : "") + "</li>";
  }
  function loadNotes() {
    return fetch(API + "/notes?device=" + encodeURIComponent(dev)).then(function (r) { return r.json(); }).then(function (d) {
      $("notes").innerHTML = (d.notes || []).map(noteHTML).join("");
    }).catch(function () {});
  }
  var ta = $("saytext");
  ta.addEventListener("input", function () { $("saycount").textContent = ta.value.length + " / 500"; });
  $("sayform").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = ta.value.trim(); if (!t) return;
    var btn = ev.target.querySelector("button"); btn.disabled = true;
    api("/notes", { device: dev, text: t }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { toast(r.error || "没递过去。"); return; }
      ta.value = ""; $("saycount").textContent = "0 / 500"; toast("递过去了。");
      loadNotes();
    });
  });

  load(); loadNotes();
  setInterval(function () { if (!document.hidden) { load(); loadNotes(); } }, 120000);
})();
