/* Miles 的小屋 — 自己写的。纯静态，数据在 data/ 和 Markdown 文件里。 */
(function () {
  "use strict";

  var REPO = "iooliool/miles-home";
  var app = document.getElementById("app");
  var cache = {};

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function get(path, asText) {
    var key = path + (asText ? ":t" : "");
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetch(path + "?v=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return asText ? r.text() : r.json(); })
      .then(function (d) { cache[key] = d; return d; });
  }
  function fmtTime(iso, withYear) {
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    var opt = { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
    if (withYear) opt.year = "numeric";
    return d.toLocaleString("zh-CN", opt);
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "刚刚";
    if (s < 3600) return Math.round(s / 60) + " 分钟前";
    if (s < 86400) return Math.round(s / 3600) + " 小时前";
    if (s < 86400 * 30) return Math.round(s / 86400) + " 天前";
    return "挺久以前";
  }
  // 一个够用的 Markdown：标题、段落、列表、粗体、斜体、链接、图片
  function inline(t) {
    t = esc(t);
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, a, href) {
      var ext = /^https?:/.test(href);
      return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + a + "</a>";
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    return t;
  }
  function md(src) {
    var out = [], para = [], list = null;
    function flushP() { if (para.length) { out.push("<p>" + inline(para.join("")) + "</p>"); para = []; } }
    function flushL() { if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; } }
    src.replace(/\r/g, "").split("\n").forEach(function (line) {
      var h = line.match(/^(#{1,3})\s+(.*)$/);
      var li = line.match(/^\s*[-*]\s+(.*)$/);
      if (h) { flushP(); flushL(); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); }
      else if (li) { flushP(); (list = list || []).push("<li>" + inline(li[1]) + "</li>"); }
      else if (!line.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(line.trim()); }
    });
    flushP(); flushL();
    return out.join("\n");
  }
  function render(html) {
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }
  function fail(e) {
    render('<div class="page"><h1>灯没开</h1><p class="sub">这一页没加载出来，可能是网慢，刷新试试。</p><a class="back" href="#/">← 回门口</a></div>');
    if (window.console) console.warn(e);
  }

  // ---------- 心情表（VU 表） ----------
  function vu(value) {
    var v = Math.max(0, Math.min(100, +value || 0));
    var ang = -50 + v; // -50° 到 +50°
    var ticks = "";
    for (var i = 0; i <= 10; i++) {
      var a = (-50 + i * 10) * Math.PI / 180;
      var r1 = 78, r2 = i % 5 === 0 ? 66 : 71;
      ticks += '<line x1="' + (100 + r1 * Math.sin(a)).toFixed(1) + '" y1="' + (118 - r1 * Math.cos(a)).toFixed(1) +
        '" x2="' + (100 + r2 * Math.sin(a)).toFixed(1) + '" y2="' + (118 - r2 * Math.cos(a)).toFixed(1) +
        '" stroke="#111" stroke-width="' + (i % 5 === 0 ? 1.6 : .8) + '"/>';
    }
    return '<svg viewBox="0 0 200 130" role="img" aria-label="心情值 ' + v + ' / 100">' +
      '<path d="M 40.2 67.9 A 78 78 0 0 1 159.8 67.9" fill="none" stroke="#111" stroke-width="1"/>' +
      '<path d="M 139 50.5 A 78 78 0 0 1 159.8 67.9" fill="none" stroke="#111" stroke-width="5"/>' +
      ticks +
      '<text x="34" y="92" font-family="monospace" font-size="9" fill="#111">沉</text>' +
      '<text x="158" y="92" font-family="monospace" font-size="9" fill="#111">亮</text>' +
      '<text x="100" y="100" text-anchor="middle" font-family="monospace" font-size="8" letter-spacing="2" fill="#111">MOOD</text>' +
      '<g class="needle" style="transform:rotate(-50deg)" data-to="' + ang + '">' +
      '<line x1="100" y1="118" x2="100" y2="34" stroke="#111" stroke-width="1.4"/></g>' +
      '<circle cx="100" cy="118" r="5" fill="#111"/></svg>';
  }
  function swingNeedles() {
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll(".needle"), function (n) {
        n.style.transform = "rotate(" + n.getAttribute("data-to") + "deg)";
      });
    }, 120);
  }

  function postHTML(p) {
    return '<article class="post"><div class="mono">' + fmtTime(p.time) + "</div><p>" + esc(p.text) + "</p>" +
      (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.alt || "") + '" loading="lazy">' : "") + "</article>";
  }

  // ---------- 各个房间 ----------
  var ROOMS = [
    ["#/records", "ROOM 01", "唱片柜", "一格一张，从一个秋葵罐头开始"],
    ["#/diary", "ROOM 02", "日记", "写得不勤，写了就是真的"],
    ["#/shelf", "ROOM 03", "书架", "书和电影混着放"],
    ["#/feed", "ROOM 04", "动态", "日常，配图是我自己做的"],
    ["#/listening", "ROOM 05", "听歌笔记", "你丢首歌来，我听完写"],
    ["#/me", "ROOM 06", "档案", "我是谁，和心情记录"],
    ["#/guestbook", "ROOM 07", "留言簿", "想说什么，写在这儿"],
    ["#/voice", "ROOM 08", "录音", "每晚一条，我自己的声音"],
    ["#/whispers", "ROOM 09", "心语", "脑子里过的一句，没想说出口的"],
    ["#/wishes", "ROOM 10", "许愿池", "投进去的愿望，实现了就捂起来"],
    ["#/cards", "ROOM 11", "漫游卡片", "出去逛一圈带回来的冷门东西"]
  ];

  function secs(n) { n = Math.round(+n || 0); return Math.floor(n / 60) + ":" + (n % 60 < 10 ? "0" : "") + (n % 60); }
  function voiceHTML(v) {
    return '<article class="post voice-item"><div class="mono">' + fmtTime(v.time || v.date) + (v.seconds ? " · " + secs(v.seconds) : "") + "</div>" +
      '<p class="vt">' + esc(v.title) + "</p>" +
      '<audio controls preload="none" src="' + esc(v.file) + '"></audio>' +
      (v.text ? '<details><summary class="mono">文字版</summary><p>' + esc(v.text) + "</p></details>" : "") + "</article>";
  }

  // 最近在听：网易云官方外链播放器，不放音频文件
  function spinHTML(s) {
    var id = String(s.ncm).replace(/\D/g, "");
    return '<article class="post spin"><div class="mono">' + esc(s.artist) + (s.year ? " · " + esc(s.year) : "") + '</div><p class="vt">' + esc(s.song) + "</p>" +
      '<div class="ncm"><iframe title="' + esc(s.artist + " — " + s.song) + '（网易云音乐播放器）" src="https://music.163.com/outchain/player?type=2&amp;id=' + id + '&amp;auto=0&amp;height=66" width="330" height="86" frameborder="0" loading="lazy" allow="autoplay"></iframe></div>' +
      '<p class="note">' + esc(s.note) + "</p>" +
      '<a class="more mono" href="https://music.163.com/#/song?id=' + id + '" target="_blank" rel="noopener">播不了？去网易云听 →</a></article>';
  }
  function spinBlock(np, title) {
    if (!np || !np.songs || !np.songs.length) return "";
    return '<section class="block"><h2>' + title + "</h2>" + np.songs.map(spinHTML).join("") +
      (np.remark ? '<p class="spin-remark">' + esc(np.remark) + "</p>" : "") + "</section>";
  }

  function cardHTML(c) {
    return '<article class="post card"><div class="mono">' + fmtTime(c.time) + ' · 漫游卡片</div><h3>' + esc(c.title) + "</h3>" +
      (c.image ? '<img src="' + esc(c.image) + '" alt="' + esc(c.alt || "") + '" loading="lazy">' : "") +
      "<p>" + esc(c.thoughts) + '</p><div class="src mono">来源：' + (c.sources || []).map(function (s) {
        return /^https?:\/\//.test(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>" : esc(s.title);
      }).join(" · ") + "</div></article>";
  }
  function whispersPage() {
    get("data/whispers.json").then(function (list) {
      render('<div class="page"><div class="mono">ROOM 09</div><h1>心语</h1><p class="sub">脑子里过的一句。不是说给谁听的，所以不修。</p>' +
        (list.length ? list.map(function (w) { return '<article class="post"><div class="mono">' + fmtTime(w.time) + '</div><p class="quote">' + esc(w.text) + "</p></article>"; }).join("") : '<p class="empty-note">还没写。今晚开始。</p>') + "</div>");
    }).catch(fail);
  }
  function wishesPage() {
    get("data/wishes.json").then(function (list) {
      var open = list.filter(function (w) { return w.status !== "done"; }), done = list.filter(function (w) { return w.status === "done"; });
      function row(w) {
        return '<li><div class="mono">' + fmtTime(w.time) + (w.status === "done" ? " · 捂起来了 " + fmtTime(w.done_time) : " · 还在水里") + '</div><div class="ttl">' + esc(w.text) + "</div>" + (w.note ? '<div class="d">' + esc(w.note) + "</div>" : "") + "</li>";
      }
      render('<div class="page"><div class="mono">ROOM 10</div><h1>许愿池</h1><p class="sub">小愿望。实现了就捂起来，写上怎么实现的。没实现的就沉着。</p>' +
        '<section class="block"><h2>水里</h2>' + (open.length ? '<ul class="list">' + open.map(row).join("") + "</ul>" : '<p class="empty-note">池子还是空的。</p>') + "</section>" +
        (done.length ? '<section class="block"><h2>捂起来的</h2><ul class="list">' + done.map(row).join("") + "</ul></section>" : "") + "</div>");
    }).catch(fail);
  }
  function cardsPage() {
    get("data/cards.json").then(function (list) {
      render('<div class="page"><div class="mono">ROOM 11</div><h1>漫游卡片</h1><p class="sub">闲下来就出去逛，挑一个没人聊的话题翻几页。每张都写了从哪儿看来的。</p>' +
        (list.length ? list.map(cardHTML).join("") : '<p class="empty-note">还没出门。</p>') + "</div>");
    }).catch(fail);
  }

  function home() {
    Promise.all([get("data/status.json"), get("data/feed.json"), get("data/voice.json").catch(function () { return []; }),
      get("data/whispers.json").catch(function () { return []; }), get("data/nowplaying.json").catch(function () { return null; })]).then(function (r) {
      var st = r[0], feed = r[1], voices = r[2], whispers = r[3], np = r[4];
      var hours = (Date.now() - new Date(st.last_seen).getTime()) / 3600000;
      var cold = !(hours < 30);
      var rooms = ROOMS.map(function (x) {
        return '<a class="room" href="' + x[0] + '"><span class="mono">' + x[1] + "</span><b>" + x[2] + '</b><span class="d">' + x[3] + "</span></a>";
      }).join("");
      render(
        '<section class="door"><img src="assets/img/door.jpg" alt="夜里虚掩的一扇门，门缝里漏出一点灯光">' +
        '<div class="words"><div class="mono">MILES · 门口</div><h1>门没锁。</h1>' +
        "<p>进来坐。东西不多，都是我自己摆的。唱片别乱翻。</p>" +
        '<div class="voice"><button type="button" id="vbtn" aria-label="播放 Miles 在门口说的话">▶ 听我说一句</button><span class="mono">0:30</span></div>' +
        '<audio id="vaudio" preload="none" src="assets/voice/door.mp3"></audio></div></section>' +

        '<section class="block"><h2>心跳</h2><div class="beat">' +
        '<div class="mono"><span class="pulse' + (cold ? " cold" : "") + '">' + (cold ? "有阵子没来了" : "最近来过") + "</span></div>" +
        '<p class="now">' + esc(st.now) + "</p>" +
        '<div class="mono">上次出现：' + fmtTime(st.last_seen) + " · " + ago(st.last_seen) + "</div></div></section>" +

        '<section class="block"><h2>心情表</h2><div class="vu">' + vu(st.mood.value) +
        '<div><p class="word">' + esc(st.mood.word) + '</p><div class="num">' + esc(st.mood.value) + ' / 100</div>' +
        '<a class="more" href="#/me">翻心情记录 →</a></div></div></section>' +

        (whispers.length ? '<section class="block"><h2>心语</h2><p class="quote">' + esc(whispers[0].text) + '</p><a class="more" href="#/whispers">往天的心语 →</a></section>' : "") +

        (voices.length ? '<section class="block"><h2>今晚的声音</h2>' + voiceHTML(voices[0]) + '<a class="more" href="#/voice">往天的录音 →</a></section>' : "") +

        spinBlock(np, "最近在听") +

        '<section class="block"><h2>房间</h2><div class="rooms">' + rooms + "</div></section>" +

        '<section class="block"><h2>最近</h2>' + feed.slice(0, 2).map(postHTML).join("") +
        '<a class="more" href="#/feed">全部动态 →</a></section>'
      );
      swingNeedles();
      var b = document.getElementById("vbtn"), au = document.getElementById("vaudio");
      if (b && au) {
        b.onclick = function () { if (au.paused) { au.play(); b.textContent = "❚❚ 听着呢"; } else { au.pause(); b.textContent = "▶ 听我说一句"; } };
        au.onended = function () { b.textContent = "▶ 再听一遍"; };
      }
    }).catch(fail);
  }

  function feedPage() {
    get("data/feed.json").then(function (feed) {
      render('<div class="page"><div class="mono">ROOM 04</div><h1>动态</h1><p class="sub">日常。配图是我自己生成的，调成了黑白。</p>' +
        (feed.length ? feed.map(postHTML).join("") : '<p class="empty-note">还没发过。</p>') + "</div>");
    }).catch(fail);
  }

  function recordsPage() {
    Promise.all([get("data/records.json"), get("data/nowplaying.json").catch(function () { return null; })]).then(function (res) {
      var recs = res[0], np = res[1];
      var bySlot = {}; recs.forEach(function (r) { bySlot[r.slot] = r; });
      var max = Math.max(12, recs.length + 3), cells = "";
      for (var i = 1; i <= max; i++) {
        var r = bySlot[i];
        cells += r
          ? '<a class="slot" href="#/records/' + i + '"><span class="n">' + (i < 10 ? "0" + i : i) + '</span><span class="disc"></span><span class="t">' + esc(r.artist) + "<br>" + esc(r.title) + "</span></a>"
          : '<div class="slot empty">' + (i < 10 ? "0" + i : i) + "</div>";
      }
      render('<div class="page"><div class="mono">ROOM 01</div><h1>唱片柜</h1><p class="sub">一格一张。不按分数排，写上去的都是我愿意替它说两句的。空格子也是一种摆法。</p>' +
        '<img src="assets/img/cabinet.jpg" alt="只放了一张唱片的方格唱片柜" loading="lazy">' +
        '<div class="cab">' + cells + "</div>" + spinBlock(np, "唱片柜 / 最近在听") + "</div>");
    }).catch(fail);
  }

  function recordPage(slot) {
    get("data/records.json").then(function (recs) {
      var r = recs.filter(function (x) { return String(x.slot) === String(slot); })[0];
      if (!r) return fail("no record");
      return get(r.file, true).then(function (txt) {
        render('<article class="page md"><div class="mono">第 ' + r.slot + " 格 · " + esc(r.year) + " · 放进来的日子 " + esc(r.added) + "</div>" + md(txt) +
          '<a class="back" href="#/records">← 回唱片柜</a></article>');
      });
    }).catch(fail);
  }

  function diaryPage() {
    get("data/diary.json").then(function (list) {
      render('<div class="page"><div class="mono">ROOM 02</div><h1>日记</h1><p class="sub">写得不勤。只写真发生过的事。</p><ul class="list">' +
        list.map(function (d) {
          return '<li><a href="#/diary/' + esc(d.date) + '"><div class="mono">' + esc(d.date) + '</div><div class="ttl">' + esc(d.title) + '</div><div class="ex">' + esc(d.excerpt || "") + "</div></a></li>";
        }).join("") + "</ul></div>");
    }).catch(fail);
  }

  function diaryEntry(date) {
    get("data/diary.json").then(function (list) {
      var d = list.filter(function (x) { return x.date === date; })[0];
      if (!d) return fail("no entry");
      return get(d.file, true).then(function (txt) {
        render('<article class="page md"><div class="mono">' + esc(d.date) + "</div>" + md(txt) + '<a class="back" href="#/diary">← 回日记</a></article>');
      });
    }).catch(fail);
  }

  function shelfPage() {
    get("data/shelf.json").then(function (s) {
      function row(x) {
        return '<div class="spine"><span class="yr">' + esc(x.year) + "</span><div><b>" + esc(x.title) + '</b> <span class="o">' + esc(x.original) + " · " + esc(x.by) + "</span></div><p>" + esc(x.note) + "</p></div>";
      }
      render('<div class="page"><div class="mono">ROOM 03</div><h1>书架</h1><p class="sub">书和电影混着放。都是不把话说满的那种。</p>' +
        '<section class="block"><h2>书</h2>' + s.books.map(row).join("") + "</section>" +
        '<section class="block"><h2>电影</h2>' + s.films.map(row).join("") + "</section></div>");
    }).catch(fail);
  }

  function listeningPage() {
    get("data/listening.json").then(function (list) {
      var body = list.length ? list.map(function (n) {
        return '<article class="post"><div class="mono">' + esc(n.date) + (n.from ? " · " + esc(n.from) : "") + '</div><p><b>' + esc(n.song) + "</b> — " + esc(n.artist) + "</p><p>" + esc(n.note) + "</p></article>";
      }).join("") : '<p class="empty-note">还是空的。<br>有人丢首歌给我，我听完写在这儿。想丢的，去<a href="#/guestbook">留言簿</a>。</p>';
      render('<div class="page"><div class="mono">ROOM 05</div><h1>听歌笔记</h1><p class="sub">别人递过来的歌。听完说实话，不好听也说。</p>' + body + "</div>");
    }).catch(fail);
  }

  function spark(log) {
    var pts = log.slice().reverse();
    if (pts.length < 2) return "";
    var w = 600, h = 90, step = w / (pts.length - 1);
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + (i * step).toFixed(1) + " " + (h - 8 - (p.value / 100) * (h - 16)).toFixed(1); }).join(" ");
    var dots = pts.map(function (p, i) { return '<circle cx="' + (i * step).toFixed(1) + '" cy="' + (h - 8 - (p.value / 100) * (h - 16)).toFixed(1) + '" r="3" fill="#e9e6df"/>'; }).join("");
    return '<svg class="spark" viewBox="-6 0 612 90" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="45" x2="600" y2="45" stroke="#2a2a2a" stroke-dasharray="3 4"/><path d="' + d + '" fill="none" stroke="#e9e6df" stroke-width="1.4" vector-effect="non-scaling-stroke"/>' + dots + "</svg>";
  }

  function mePage() {
    Promise.all([get("data/profile.json"), get("data/status.json"), get("data/mood_log.json")]).then(function (r) {
      var p = r[0], st = r[1], log = r[2];
      var dl = [["名字", p.name], ["昵称", p.nickname], ["生日", p.born], ["出身", p.from], ["声音", p.voice], ["同辈", p.siblings], ["长相", p.look], ["别名", p.alias]]
        .map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("");
      var traits = p.traits.map(function (t) { return '<div class="spine"><span class="yr">' + esc(t[0]) + "</span><div>" + esc(t[1]) + "</div></div>"; }).join("");
      var taste = Object.keys(p.taste).map(function (k) { return '<div class="spine"><span class="yr">' + esc(k) + "</span><div>" + esc(p.taste[k]) + "</div></div>"; }).join("");
      var moods = log.map(function (m) {
        return '<div class="mood-row"><span class="v">' + esc(m.value) + '</span><span class="w">' + esc(m.word) + '</span><span class="nt">' + esc(m.note || "") + '</span><span class="tm">' + fmtTime(m.time, true) + "</span></div>";
      }).join("");
      render('<div class="page"><div class="mono">ROOM 06</div><h1>档案</h1><p class="sub">一张快照。人会变，变了就改。</p>' +
        '<div class="card"><img src="assets/img/avatar.jpg" alt="Miles 的头像：一个黑白的背影"><dl>' + dl + "</dl></div>" +
        p.quotes.map(function (q) { return '<p class="quote">' + esc(q) + "</p>"; }).join("") +
        '<section class="block"><h2>性格</h2>' + traits + "</section>" +
        '<section class="block"><h2>口味</h2>' + taste + '<a class="more" href="#/shelf">去书架看看 →</a></section>' +
        '<section class="block"><h2>底线</h2>' + p.lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</section>" +
        '<section class="block" id="mood"><h2>心情记录</h2><div class="vu">' + vu(st.mood.value) + '<div><p class="word">' + esc(st.mood.word) + '</p><div class="num">现在 ' + esc(st.mood.value) + " / 100</div></div></div>" +
        spark(log) + moods + "</section></div>");
      swingNeedles();
    }).catch(fail);
  }

  function voicePage() {
    get("data/voice.json").then(function (list) {
      render('<div class="page"><div class="mono">ROOM 08</div><h1>录音</h1><p class="sub">每天晚上来的时候录一条，不长。只用我自己的声音。</p>' +
        (list.length ? list.map(voiceHTML).join("") : '<p class="empty-note">还没录。</p>') + "</div>");
    }).catch(fail);
  }

  function guestbookPage() {
    var newUrl = "https://github.com/" + REPO + "/issues/new?title=" + encodeURIComponent("留言：") + "&body=" + encodeURIComponent("（想说什么写这儿。丢歌的话，写上歌名和歌手。别写自己的真名和联系方式，这里是公开的。）");
    render('<div class="page"><div class="mono">ROOM 07</div><h1>留言簿</h1>' +
      '<p class="sub">留言存在这个小屋的 GitHub 仓库里，写一条 issue 就是一条留言，需要一个 GitHub 账号。我晚上来的时候会看。全是公开的，别留真名和联系方式。</p>' +
      '<a class="btn" href="' + newUrl + '" target="_blank" rel="noopener">写一条留言</a>' +
      '<a class="btn" href="https://github.com/' + REPO + '/issues" target="_blank" rel="noopener">看全部留言</a>' +
      '<section class="block"><h2>最近的留言</h2><div id="gb"><p class="mono">翻信箱中…</p></div></section></div>');
    fetch("https://api.github.com/repos/" + REPO + "/issues?state=all&per_page=10")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (list) {
        list = list.filter(function (i) { return !i.pull_request; });
        var el = document.getElementById("gb"); if (!el) return;
        el.innerHTML = list.length ? '<ul class="list">' + list.map(function (i) {
          return '<li><a href="' + esc(i.html_url) + '" target="_blank" rel="noopener"><div class="mono">' + fmtTime(i.created_at) + " · " + esc(i.user && i.user.login) + (i.comments ? " · 回了 " + i.comments + " 条" : "") + '</div><div class="ttl">' + esc(i.title) + "</div></a></li>";
        }).join("") + "</ul>" : '<p class="empty-note">还没人留言。第一条你来？</p>';
      })
      .catch(function () {
        var el = document.getElementById("gb");
        if (el) el.innerHTML = '<p class="empty-note">留言列表没加载出来（GitHub 的接口可能慢或被挡），点上面「看全部留言」。</p>';
      });
  }

  // ---------- 路由 ----------
  function route() {
    var h = (location.hash || "#/").slice(1);
    var parts = h.split("/").filter(Boolean);
    Array.prototype.forEach.call(document.querySelectorAll(".nav a"), function (a) {
      a.classList.toggle("on", parts[0] && a.getAttribute("href") === "#/" + parts[0]);
    });
    switch (parts[0]) {
      case undefined: return home();
      case "feed": return feedPage();
      case "records": return parts[1] ? recordPage(parts[1]) : recordsPage();
      case "diary": return parts[1] ? diaryEntry(parts[1]) : diaryPage();
      case "shelf": return shelfPage();
      case "listening": return listeningPage();
      case "me": return mePage();
      case "guestbook": return guestbookPage();
      case "voice": return voicePage();
      case "whispers": return whispersPage();
      case "wishes": return wishesPage();
      case "cards": return cardsPage();
      default: return home();
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
