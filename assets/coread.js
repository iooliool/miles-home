/* 共读 — 小屋的一个房间。书和批注只存在读者自己的浏览器里；Miles 的回话在 data/coread.json。
   原型是橘瓣写的「共读」插件，这里换成了纯静态网页能跑的样子。 */
(function () {
  "use strict";

  var app = document.getElementById("cr");
  var G = 40; // 两页之间藏起来的空隙
  var S = {
    data: { books: [], replies: [] }, local: [], book: null, chapters: [], ci: 0,
    page: 0, pages: 1, step: 1, fs: 18, lh: 1.8, mode: "read", anns: [], checked: {},
    pick: null, selText: "", selAt: 0, swipeAt: 0, idx: null
  };
  var view, cols;

  // ---------- 小工具 ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) { return String(s || "").replace(/\s+/g, ""); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function fmt(t) {
    var d = new Date(t); if (isNaN(d)) return "";
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function rid(taken) {
    var id;
    do { id = Math.random().toString(36).slice(2, 6); } while (!/^[a-z]/.test(id) || (taken && taken[id]));
    return id;
  }
  function toast(t) {
    var el = $("#crToast"); el.textContent = t; el.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove("on"); }, 2600);
  }
  function copyText(t) {
    // 先同步试 execCommand（手机上最稳），再试 clipboard API
    var ok = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, t.length);
      ok = document.execCommand("copy"); ta.remove();
    } catch (e) { ok = false; }
    if (ok) return Promise.resolve(true);
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }

  // ---------- 本地存书（IndexedDB，不行就退到 localStorage） ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("no idb"));
      var r = indexedDB.open("miles-coread", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("books"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction("books", mode), st = tx.objectStore("books"), q = fn(st);
        tx.oncomplete = function () { res(q && q.result); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function textPut(k, v) { return idb("readwrite", function (s) { return s.put(v, k); }).catch(function () { if (!LS.set("coread:txt:" + k, v)) throw new Error("存不下"); }); }
  function textGet(k) { return idb("readonly", function (s) { return s.get(k); }).then(function (v) { return v != null ? v : LS.get("coread:txt:" + k, null); }, function () { return LS.get("coread:txt:" + k, null); }); }
  function textDel(k) { LS.del("coread:txt:" + k); return idb("readwrite", function (s) { return s.delete(k); }).catch(function () {}); }

  function annKey(b) { return "coread:ann:" + b.key; }
  function loadAnns(b) { return LS.get(annKey(b), []); }
  function saveAnns() { if (!LS.set(annKey(S.book), S.anns)) toast("浏览器存不下了，批注可能没保存"); }

  // ---------- 分章 ----------
  var CN_HEAD = /^(第[零〇一二两三四五六七八九十百千万\d０-９]+[章节回卷部篇集幕](?:[\s:：·、.\-—].{0,30}|.{0,30})|序[章言幕]?|楔子|引子|前言|后记|尾声|番外.{0,20}|chapter\s*\d+.{0,30})$/i;
  function splitChapters(text) {
    text = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n").map(function (l) { return l.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ""); });
    var md = lines.some(function (l) { return /^#{1,3}\s+\S/.test(l); });
    var isHead = md ? function (l) { return /^#{1,3}\s+\S/.test(l); } : function (l) { return l.length <= 40 && CN_HEAD.test(l); };
    var chs = [], cur = { title: "开头", paras: [] };
    lines.forEach(function (l) {
      if (!l) return;
      if (isHead(l)) {
        if (cur.paras.length) chs.push(cur);
        cur = { title: l.replace(/^#{1,3}\s+/, ""), paras: [] };
      } else cur.paras.push(l);
    });
    if (cur.paras.length || !chs.length) chs.push(cur);
    if (chs.length === 1 && chs[0].title === "开头") {
      // 认不出章节：按字数切成段，免得一章几十万字
      var out = [], buf = [], n = 0;
      chs[0].paras.forEach(function (p) {
        buf.push(p); n += p.length;
        if (n > 6000) { out.push({ title: "第 " + (out.length + 1) + " 段", paras: buf }); buf = []; n = 0; }
      });
      if (buf.length || !out.length) out.push({ title: out.length ? "第 " + (out.length + 1) + " 段" : "全文", paras: buf });
      chs = out;
    }
    return chs;
  }
  function sentences(t) {
    var m = t.match(/[^。！？!?…；;]*[。！？!?…；;]+[”’"」』）)]*|[^。！？!?…；;]+$/g);
    return m && m.join("") === t ? m : [t];
  }

  // ---------- 数据 ----------
  function loadData() {
    return fetch("data/coread.json?v=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { S.data = { books: d.books || [], replies: d.replies || [] }; })
      .catch(function () { S.data = { books: [], replies: [] }; S.dataFail = true; });
  }
  function allBooks() {
    S.local = LS.get("coread:local", []);
    return S.data.books.map(function (b) { return { key: "r:" + b.id, title: b.title, author: b.author, note: b.note, file: b.file, src: "repo" }; })
      .concat(S.local.map(function (b) { return { key: "l:" + b.title, title: b.title, chars: b.chars, added: b.added, src: "local" }; }));
  }
  function repliesFor(title) { return S.data.replies.filter(function (r) { return r.book === title && r.reply; }); }
  function qMatch(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return false;
    if (a === b) return true;
    return Math.min(a.length, b.length) >= 4 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0);
  }
  // 把 Miles 的回话挂到对应的批注上：先按编号，再按引文
  function matchReplies() {
    var rs = repliesFor(S.book.title), byId = {};
    S.anns.forEach(function (a) { a._r = []; byId[a.id] = a; });
    S.loose = [];
    rs.forEach(function (r) {
      if (r.id && byId[r.id]) { byId[r.id]._r.push(r); return; }
      var hit = false;
      if (r.kind !== "page" && r.kind !== "mine") {
        S.anns.forEach(function (a) { if (qMatch(a.quote, r.quote)) { a._r.push(r); hit = true; } });
      }
      if (!hit) S.loose.push(r);
    });
  }

  // ---------- 书架 ----------
  function library() {
    document.body.classList.remove("cr-reading");
    view = cols = null;
    var books = allBooks(), last = LS.get("coread:last", null);
    var lastBook = last && books.filter(function (b) { return b.key === last; })[0];
    function row(b) {
      var n = LS.get("coread:ann:" + b.key, []).length, r = repliesFor(b.title).length;
      var meta = [b.author, b.src === "local" ? (b.chars ? Math.round(b.chars / 1000) + " 千字" : "") : "", n ? n + " 条批注" : "", r ? "我回了 " + r + " 条" : ""].filter(Boolean).join(" · ");
      return '<li class="cr-book"><a href="#b/' + encodeURIComponent(b.key) + '"><div class="ttl">《' + esc(b.title) + '》</div>' +
        (meta ? '<div class="mono">' + esc(meta) + "</div>" : "") + (b.note ? '<div class="d">' + esc(b.note) + "</div>" : "") + "</a>" +
        (b.src === "local" ? '<button type="button" class="cr-del mono" data-del="' + esc(b.title) + '">拿走</button>' : "") + "</li>";
    }
    var repo = books.filter(function (b) { return b.src === "repo"; }), local = books.filter(function (b) { return b.src === "local"; });
    app.innerHTML = '<div class="page cr-lib"><div class="mono">ROOM 12</div><h1>共读</h1>' +
      '<p class="sub">一本书，两个人读。你划一句写几个字，复制给我；我回的话写回这儿，你刷新就能看见。</p>' +
      (lastBook ? '<a class="btn" href="#b/' + encodeURIComponent(lastBook.key) + '">接着读《' + esc(lastBook.title) + "》</a>" : "") +
      '<section class="block"><h2>我放在这儿的</h2>' + (repo.length ? '<ul class="list">' + repo.map(row).join("") + "</ul>" : '<p class="empty-note">' + (S.dataFail ? "书单没加载出来，刷新试试。" : "还没放。") + "</p>") + "</section>" +
      '<section class="block"><h2>你带来的</h2>' + (local.length ? '<ul class="list">' + local.map(row).join("") + "</ul>" : '<p class="empty-note">还没有。下面带一本来。</p>') + "</section>" +
      '<section class="block"><h2>带一本来</h2>' +
      '<label class="btn cr-file">选一个 txt 文件<input type="file" accept=".txt,text/plain" id="crFile"></label>' +
      '<details class="cr-paste"><summary>或者直接把文字粘进来</summary>' +
      '<input id="crPT" class="cr-in" placeholder="书名" maxlength="60"><textarea id="crPX" class="cr-in" rows="6" placeholder="正文。章节标题单独一行，比如「第一章 xxx」，我会自己分章。"></textarea>' +
      '<button type="button" class="btn" id="crPB">放上书架</button></details>' +
      '<p class="cr-small">书和批注只存在你这台设备的浏览器里，不上传。换手机、换浏览器或者清了浏览器数据就没了。</p></section>' +
      '<section class="block"><h2>怎么用</h2><ul class="cr-how">' +
      "<li>翻页：点页面左边或右边，或者左右滑。右上角 A− A+ 调字号。</li>" +
      "<li>批注：直接长按选字；手机上选字不顺手，就点下面的「划句」，一句一句点着选。选好点「写批注」。</li>" +
      "<li>发给我：打开「批注」栏，勾几条点「复制给 Miles」，粘到我们的聊天里发我。想让我读整页，点「读这页」，一样复制了发我。</li>" +
      "<li>看我的回话：我回完会写进这里。刷新页面，批注底下标着 MILES 的那段就是我。</li></ul></section>" +
      '<a class="back" href="./#/">← 回门口</a></div>';
    window.scrollTo(0, 0);
    $("#crFile").onchange = function (e) { var f = e.target.files && e.target.files[0]; if (f) readFile(f); e.target.value = ""; };
    $("#crPB").onclick = function () {
      var t = $("#crPT").value.trim(), x = $("#crPX").value;
      if (!t) return toast("先写个书名");
      if (!norm(x)) return toast("正文是空的");
      importBook(t, x);
    };
    Array.prototype.forEach.call(app.querySelectorAll("[data-del]"), function (b) {
      b.onclick = function () {
        var t = b.getAttribute("data-del");
        if (!confirm("把《" + t + "》从书架拿走？批注会留着，下次放回同名的书还在。")) return;
        textDel("l:" + t).then(function () {
          LS.set("coread:local", LS.get("coread:local", []).filter(function (b) { return b.title !== t; }));
          library();
        });
      };
    });
  }
  function readFile(f) {
    var fr = new FileReader();
    fr.onload = function () {
      var buf = new Uint8Array(fr.result), text;
      try {
        if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder("utf-16le").decode(buf);
        else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder("utf-16be").decode(buf);
        else text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch (e) {
        try { text = new TextDecoder("gb18030").decode(buf); } catch (e2) { return toast("这个文件读不出来"); }
      }
      importBook(f.name.replace(/\.[^.]+$/, "").slice(0, 60) || "没名字的书", text);
    };
    fr.onerror = function () { toast("文件没读出来"); };
    fr.readAsArrayBuffer(f);
  }
  function importBook(title, text) {
    var list = LS.get("coread:local", []);
    var exists = list.some(function (b) { return b.title === title; });
    if (exists && !confirm("书架上已经有《" + title + "》了，换成这一份？批注会留着。")) return;
    textPut("l:" + title, text).then(function () {
      list = list.filter(function (b) { return b.title !== title; });
      list.unshift({ title: title, chars: norm(text).length, added: new Date().toISOString() });
      LS.set("coread:local", list);
      toast("放上书架了");
      location.hash = "#b/" + encodeURIComponent("l:" + title);
    }, function () { toast("浏览器存不下这本书"); });
  }

  // ---------- 打开一本书 ----------
  function openBook(key) {
    var b = allBooks().filter(function (x) { return x.key === key; })[0];
    if (!b) { toast("书架上没有这本"); location.hash = ""; return; }
    app.innerHTML = '<p class="loading">翻书中…</p>';
    var p = b.src === "repo"
      ? fetch(b.file + "?v=" + Math.floor(Date.now() / 3600000)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      : textGet(b.key);
    p.then(function (text) {
      if (text == null) throw new Error("没找到");
      S.book = b; S.chapters = splitChapters(text); S.anns = loadAnns(b); S.checked = {};
      LS.set("coread:last", b.key);
      var pos = LS.get("coread:pos:" + b.key, null);
      S.ci = pos && pos.ci < S.chapters.length ? pos.ci : 0;
      readerShell();
      loadChapter(S.ci, pos ? { k: pos.k } : { page: 0 });
    }).catch(function () {
      app.innerHTML = '<div class="page"><h1>书没打开</h1><p class="sub">可能是网慢，也可能这台设备上已经没有这本书了。</p><a class="back" href="#">← 回书架</a></div>';
    });
  }

  function readerShell() {
    document.body.classList.add("cr-reading");
    var opts = S.chapters.map(function (c, i) { var t = c.title.length > 18 ? c.title.slice(0, 17) + "…" : c.title; return '<option value="' + i + '">' + esc(t) + "</option>"; }).join("");
    app.innerHTML =
      '<div class="cr-reader"><div class="cr-main">' +
      '<div class="cr-top"><a class="cr-back" href="#" aria-label="回书架">‹ 书架</a>' +
      '<div class="cr-title"><b>《' + esc(S.book.title) + '》</b><select id="crCh" aria-label="章节">' + opts + "</select></div>" +
      '<div class="cr-fs"><button type="button" data-fs="-1" aria-label="字小一点">A−</button><span id="crFs">' + S.fs + '</span><button type="button" data-fs="1" aria-label="字大一点">A+</button></div></div>' +
      '<div class="cr-view" id="crView"><div class="cr-cols" id="crCols"></div></div>' +
      '<div class="cr-selbar" id="crSel" hidden><span id="crSelN" class="mono"></span><button type="button" id="crSelGo" class="on">写批注</button><button type="button" id="crSelX">算了</button></div>' +
      '<div class="cr-bottom"><div class="cr-nav"><button type="button" id="crPrev" aria-label="上一页">‹</button><span id="crPage" class="mono">1 / 1</span><button type="button" id="crNext" aria-label="下一页">›</button></div>' +
      '<div class="cr-acts"><button type="button" id="crMode" aria-pressed="false">划句</button><button type="button" id="crRead">读这页</button><button type="button" id="crSideBtn">批注 <i id="crN">0</i></button></div></div>' +
      '</div><div class="cr-side-bg" id="crSideBg"></div><aside class="cr-side" id="crSide" aria-label="批注栏"></aside></div>';
    view = $("#crView"); cols = $("#crCols");
    $("#crCh").onchange = function () { loadChapter(+this.value, { page: 0 }); };
    Array.prototype.forEach.call(app.querySelectorAll("[data-fs]"), function (b) {
      b.onclick = function () { setFs(S.fs + (+b.getAttribute("data-fs"))); };
    });
    $("#crPrev").onclick = prev; $("#crNext").onclick = next;
    $("#crMode").onclick = function () { setMode(S.mode === "mark" ? "read" : "mark"); };
    $("#crRead").onclick = readPage;
    $("#crSideBtn").onclick = function () { toggleSide(true); };
    $("#crSideBg").onclick = function () { toggleSide(false); };
    $("#crSelGo").onclick = startNote;
    $("#crSelX").onclick = clearPick;
    // 按下按钮时别把手机上的选区弄丢
    Array.prototype.forEach.call($("#crSel").querySelectorAll("button"), function (b) {
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    });
    bindGestures();
    setMode("read", true);
  }

  // ---------- 章节渲染、高亮、分页 ----------
  function loadChapter(ci, where) {
    S.ci = Math.max(0, Math.min(S.chapters.length - 1, ci));
    $("#crCh").value = String(S.ci);
    S.pick = null; hideSelBar();
    drawChapter();
    layout();
    var p = 0;
    if (where && where.k != null && S.idx.chars.length) p = kPage(Math.min(where.k, S.idx.chars.length - 1));
    else if (where && where.page === "last") p = S.pages - 1;
    else if (where && where.id) { var m = cols.querySelector('mark[data-ids~="' + where.id + '"]'); if (m) p = elPage(m); }
    goPage(p, false);
    renderSide();
  }
  function drawChapter() {
    var ch = S.chapters[S.ci], si = 0;
    var h = '<h2 class="cr-ch">' + esc(ch.title) + "</h2>";
    ch.paras.forEach(function (t, pi) {
      h += '<p data-p="' + pi + '">' + sentences(t).map(function (s) { return '<span class="s" data-s="' + (si++) + '">' + esc(s) + "</span>"; }).join("") + "</p>";
    });
    cols.innerHTML = h + '<div class="cr-end"></div>';
    matchReplies();
    var list = [];
    S.anns.forEach(function (a) { if (a.ci === S.ci || a.ch === ch.title) list.push({ id: a.id, t: a._r.length ? "r" : "a", q: a.quote, k: a.k }); });
    S.loose.forEach(function (r, i) { r._k = "m" + i; list.push({ id: r._k, t: "m", q: r.quote }); });
    applyHL(list);
  }
  function buildIndex() {
    var s = [], chars = [];
    Array.prototype.forEach.call(cols.querySelectorAll("p[data-p]"), function (p) {
      var pi = +p.getAttribute("data-p"), po = 0, w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        var d = n.data;
        for (var i = 0; i < d.length; i++) if (!/\s/.test(d[i])) { s.push(d[i]); chars.push([n, i, pi, po + i]); }
        po += d.length;
      }
    });
    S.idx = { s: s.join(""), chars: chars };
  }
  function applyHL(list) {
    buildIndex();
    var I = S.idx, own = [];
    list.forEach(function (h) {
      var q = norm(h.q); if (!q) return;
      var k = h.k != null && I.s.substr(h.k, q.length) === q ? h.k : I.s.indexOf(q); if (k < 0) return;
      h.on = true;
      for (var j = k; j < k + q.length; j++) (own[j] || (own[j] = [])).push(h);
    });
    var wraps = [], cur = null;
    for (var k = 0; k < I.chars.length; k++) {
      var o = own[k];
      if (!o) { cur = null; continue; }
      var key = o.map(function (h) { return h.id; }).join(" "), c = I.chars[k];
      if (cur && cur.key === key && cur.node === c[0]) cur.end = c[1] + 1;
      else { cur = { key: key, node: c[0], start: c[1], end: c[1] + 1, o: o }; wraps.push(cur); }
    }
    for (var i = wraps.length - 1; i >= 0; i--) {
      var w = wraps[i], n = w.node;
      if (w.end < n.data.length) n.splitText(w.end);
      var mid = w.start > 0 ? n.splitText(w.start) : n;
      var m = document.createElement("mark");
      var hers = w.o.some(function (h) { return h.t !== "m"; });
      m.className = "hl " + (hers ? "a" : "m") + (w.o.some(function (h) { return h.t === "r"; }) ? " r" : "");
      m.setAttribute("data-ids", w.key);
      mid.parentNode.insertBefore(m, mid); m.appendChild(mid);
    }
    // 每条最后一截加个小记号（有我的回话时）
    var seen = {}, marks = cols.querySelectorAll("mark.hl");
    for (var j2 = marks.length - 1; j2 >= 0; j2--) {
      var ids = marks[j2].getAttribute("data-ids").split(" "), fresh = ids.filter(function (x) { return !seen[x]; });
      if (fresh.length && /\b(r|m)\b/.test(marks[j2].className)) marks[j2].classList.add("tail");
      ids.forEach(function (x) { seen[x] = 1; });
    }
    buildIndex();
  }
  function layout() {
    var W = view.clientWidth, H = view.clientHeight;
    cols.style.fontSize = S.fs + "px"; cols.style.lineHeight = S.lh;
    cols.style.width = W + "px"; cols.style.height = H + "px";
    cols.style.columnWidth = W + "px"; cols.style.columnGap = G + "px";
    S.step = W + G;
    var end = cols.querySelector(".cr-end");
    S.pages = Math.max(1, Math.floor((end.getBoundingClientRect().left - cols.getBoundingClientRect().left + 2) / S.step) + 1);
  }
  function xPage(left) { return Math.floor((left - cols.getBoundingClientRect().left + 2) / S.step); }
  function elPage(el) { return Math.max(0, Math.min(S.pages - 1, xPage(el.getBoundingClientRect().left))); }
  function kPage(k) {
    var c = S.idx.chars[k], r = document.createRange();
    r.setStart(c[0], c[1]); r.setEnd(c[0], c[1] + 1);
    var rs = r.getClientRects(), rect = rs.length ? rs[0] : r.getBoundingClientRect();
    return Math.max(0, Math.min(S.pages - 1, xPage(rect.left)));
  }
  function firstK(p) {
    var lo = 0, hi = S.idx.chars.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (kPage(mid) >= p) hi = mid; else lo = mid + 1; }
    return lo;
  }
  function goPage(p, anim) {
    S.page = Math.max(0, Math.min(S.pages - 1, p));
    cols.style.transition = anim ? "" : "none";
    cols.style.transform = "translate3d(" + (-S.page * S.step) + "px,0,0)";
    if (!anim) { void cols.offsetWidth; cols.style.transition = ""; }
    $("#crPage").textContent = (S.page + 1) + " / " + S.pages;
    $("#crPrev").disabled = S.page === 0 && S.ci === 0;
    $("#crNext").disabled = S.page === S.pages - 1 && S.ci === S.chapters.length - 1;
    clearTimeout(goPage.t);
    goPage.t = setTimeout(function () { if (S.book && cols) LS.set("coread:pos:" + S.book.key, { ci: S.ci, k: S.idx.chars.length ? firstK(S.page) : 0 }); }, 300);
  }
  function next() {
    if (S.page < S.pages - 1) goPage(S.page + 1, true);
    else if (S.ci < S.chapters.length - 1) loadChapter(S.ci + 1, { page: 0 });
  }
  function prev() {
    if (S.page > 0) goPage(S.page - 1, true);
    else if (S.ci > 0) loadChapter(S.ci - 1, { page: "last" });
  }
  function relayout() {
    if (!cols) return;
    var k = S.idx.chars.length ? firstK(S.page) : 0;
    layout();
    goPage(S.idx.chars.length ? kPage(k) : 0, false);
  }
  function setFs(v) {
    S.fs = Math.max(14, Math.min(28, v));
    LS.set("coread:prefs", { fs: S.fs, lh: S.lh });
    $("#crFs").textContent = S.fs;
    relayout();
  }

  // ---------- 手势 ----------
  function bindGestures() {
    var tx = null, ty = 0, tt = 0;
    // overflow:hidden 的盒子也会被浏览器滚动（拖选区、查找），滚了就换算成翻页
    view.addEventListener("scroll", function () {
      var sl = view.scrollLeft;
      if (!sl && !view.scrollTop) return;
      view.scrollLeft = 0; view.scrollTop = 0;
      if (sl) goPage(S.page + Math.round(sl / S.step), false);
    });
    view.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tx = null; return; }
      tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
    }, { passive: true });
    view.addEventListener("touchend", function (e) {
      if (tx == null) return;
      var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty; tx = null;
      var sel = window.getSelection();
      if (S.mode === "read" && sel && !sel.isCollapsed) return;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - tt < 900) {
        S.swipeAt = Date.now();
        if (dx < 0) next(); else prev();
      }
    }, { passive: true });
    view.addEventListener("click", function (e) {
      if (Date.now() - S.swipeAt < 400) return;
      if (S.mode === "mark") {
        var sp = e.target.closest(".s");
        if (sp) tapSentence(+sp.getAttribute("data-s"));
        return;
      }
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && cols.contains(sel.anchorNode)) return;
      if (Date.now() - S.selAt < 500) return;
      var mk = e.target.closest("mark.hl");
      if (mk) { markPop(mk); return; }
      var r = view.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x < 0.36) prev(); else if (x > 0.64) next();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (!cols || !document.body.classList.contains("cr-reading")) return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "")) return;
    if (!$("#crSheet").hidden) { if (e.key === "Escape") closeSheet(); return; }
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
    else if (e.key === "Escape") toggleSide(false);
  });
  var rzT;
  window.addEventListener("resize", function () { clearTimeout(rzT); rzT = setTimeout(relayout, 160); });

  // ---------- 选字和划句 ----------
  function setMode(m, quiet) {
    S.mode = m;
    view.classList.toggle("mark", m === "mark");
    var b = $("#crMode"); b.classList.toggle("on", m === "mark"); b.setAttribute("aria-pressed", m === "mark" ? "true" : "false");
    b.textContent = m === "mark" ? "划句中" : "划句";
    clearPick();
    if (m === "mark") { var s = window.getSelection(); if (s) s.removeAllRanges(); if (!quiet) toast("点一句选中，再点后面的句子连成一段。翻页用滑的或下面的箭头。"); }
  }
  document.addEventListener("selectionchange", function () {
    clearTimeout(S.selT); S.selT = setTimeout(checkSel, 120);
  });
  function checkSel() {
    if (!cols || S.mode !== "read") return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && cols.contains(sel.anchorNode) && cols.contains(sel.focusNode)) {
      var t = sel.toString().trim();
      if (norm(t).length >= 2) { S.selText = t; S.selAt = Date.now(); showSelBar("划了 " + norm(t).length + " 字"); return; }
    }
    if (S.selText) S.selAt = Date.now();
    // 手机上点「写批注」时选区会先没掉，留一小会儿
    setTimeout(function () { var s2 = window.getSelection(); if (S.mode === "read" && (!s2 || s2.isCollapsed)) { S.selText = ""; hideSelBar(); } }, 400);
  }
  function tapSentence(i) {
    var p = S.pick;
    if (!p) p = { a: i, b: i };
    else if (p.a === p.b && i === p.a) p = null;
    else if (i < p.a) p.a = i;
    else if (i > p.b) p.b = i;
    else if (i === p.a) p.a++;
    else if (i === p.b) p.b--;
    else p.b = i;
    S.pick = p && p.a <= p.b ? p : null;
    Array.prototype.forEach.call(cols.querySelectorAll(".s.on"), function (s) { s.classList.remove("on"); });
    if (!S.pick) return hideSelBar();
    for (var k = S.pick.a; k <= S.pick.b; k++) { var s = cols.querySelector('.s[data-s="' + k + '"]'); if (s) s.classList.add("on"); }
    var n = S.pick.b - S.pick.a + 1;
    showSelBar("选了 " + n + " 句");
  }
  function pickText() {
    var out = [], lastP = null;
    for (var k = S.pick.a; k <= S.pick.b; k++) {
      var s = cols.querySelector('.s[data-s="' + k + '"]'); if (!s) continue;
      if (lastP && s.parentNode !== lastP) out.push("\n");
      out.push(s.textContent); lastP = s.parentNode;
    }
    return out.join("").trim();
  }
  function showSelBar(t) { $("#crSelN").textContent = t; $("#crSel").hidden = false; }
  function hideSelBar() { var b = $("#crSel"); if (b) b.hidden = true; }
  function clearPick() {
    S.pick = null; S.selText = "";
    if (cols) Array.prototype.forEach.call(cols.querySelectorAll(".s.on"), function (s) { s.classList.remove("on"); });
    var s = window.getSelection(); if (s && S.mode === "read" && !s.isCollapsed && cols && cols.contains(s.anchorNode)) s.removeAllRanges();
    hideSelBar();
  }

  // ---------- 写批注 ----------
  function startNote() {
    var q = S.mode === "mark" && S.pick ? pickText() : S.selText;
    if (!norm(q)) return toast("先选一句");
    if (q.length > 600) q = q.slice(0, 600);
    sheet('<div class="mono">写批注 · ' + esc(S.chapters[S.ci].title) + "</div>" +
      '<blockquote class="cr-q">' + esc(q) + "</blockquote>" +
      '<textarea id="crNote" class="cr-in" rows="4" maxlength="2000" placeholder="想到什么写什么。不写也行，就当划了一道。"></textarea>' +
      '<div class="cr-row"><button type="button" class="btn" id="crSave">存下</button><button type="button" class="btn" id="crSaveCopy">存下并复制给 Miles</button><button type="button" class="btn ghost" data-close>算了</button></div>',
      function (el) {
        setTimeout(function () { var t = $("#crNote"); if (t && window.matchMedia("(hover:hover)").matches) t.focus(); }, 60);
        function save(copy) {
          var taken = {}; S.anns.forEach(function (a) { taken[a.id] = 1; });
          var a = { id: rid(taken), book: S.book.title, ci: S.ci, ch: S.chapters[S.ci].title, page: S.page + 1, quote: q, note: $("#crNote").value.trim(), time: new Date().toISOString() };
          // 同一句话在一章里出现好几次时，记住是当前这一页上的那次
          var nq = norm(q), at = S.idx.s.indexOf(nq);
          while (at >= 0) { if (kPage(at) === S.page) { a.k = at; break; } at = S.idx.s.indexOf(nq, at + 1); }
          S.anns.push(a);
          clearPick(); var s = window.getSelection(); if (s) s.removeAllRanges();
          var keep = S.page;
          drawChapter(); layout();
          var m = cols.querySelector('mark[data-ids~="' + a.id + '"]');
          if (m) a.page = elPage(m) + 1;
          saveAnns();
          goPage(keep, false); renderSide();
          if (copy) copySheet(annText([a]), "这条批注"); else { closeSheet(); toast("存下了，在「批注」栏里"); }
        }
        $("#crSave").onclick = function () { save(false); };
        $("#crSaveCopy").onclick = function () { save(true); };
      });
  }

  // ---------- 复制给 Miles ----------
  var FOOT = "（从小屋「共读」复制的）";
  function annText(list) {
    var lines = ["【共读】《" + S.book.title + "》批注 " + list.length + " 条", ""];
    list.forEach(function (a) {
      lines.push("#" + a.id + " · " + a.ch + " · 第 " + a.page + " 页");
      lines.push("原文：" + a.quote);
      lines.push("我的批注：" + (a.note || "（没写，就划了一下）"));
      lines.push("");
    });
    lines.push(FOOT);
    return lines.join("\n");
  }
  function pageText() {
    var I = S.idx; if (!I.chars.length) return "";
    var a = firstK(S.page), b = firstK(S.page + 1);
    if (a >= I.chars.length || b <= a) return "";
    var s = I.chars[a], e = I.chars[b - 1], paras = S.chapters[S.ci].paras, out = [];
    for (var pi = s[2]; pi <= e[2]; pi++) {
      var t = paras[pi];
      out.push(t.slice(pi === s[2] ? s[3] : 0, pi === e[2] ? e[3] + 1 : t.length));
    }
    return out.join("\n");
  }
  function readPage() {
    var t = pageText();
    if (!norm(t)) return toast("这一页是空的");
    var txt = ["【共读】《" + S.book.title + "》读这页", "", "#pg" + rid() + " · " + S.chapters[S.ci].title + " · 第 " + (S.page + 1) + " 页", "这一页：", t, "", FOOT].join("\n");
    copySheet(txt, "这一页");
  }
  function copySheet(txt, what) {
    sheet('<div class="mono">复制给 Miles · ' + esc(what) + "</div>" +
      '<p class="cr-st" id="crCpSt">复制中…</p>' +
      '<textarea class="cr-in cr-cp" id="crCp" rows="9" readonly>' + esc(txt) + "</textarea>" +
      '<div class="cr-row"><button type="button" class="btn" id="crCpAgain">再复制一次</button><button type="button" class="btn ghost" data-close>好了</button></div>',
      function () {
        function go() {
          copyText(txt).then(function (ok) {
            var st = $("#crCpSt"); if (!st) return;
            st.textContent = ok ? "复制好了。粘到和我的聊天里发过来就行。" : "没复制上。长按上面的文字，全选，自己复制一下。";
            if (!ok) { var ta = $("#crCp"); ta.focus(); ta.select(); }
          });
        }
        go();
        $("#crCpAgain").onclick = go;
      });
  }

  // ---------- 点高亮看批注和回话 ----------
  function replyHTML(r) {
    var label = r.kind === "page" ? "MILES 读了这页" : r.kind === "mine" ? "MILES 先划的" : "MILES 回";
    return '<div class="cr-reply"><div class="mono">' + label + (r.time ? " · " + esc(fmt(r.time)) : "") + "</div><p>" + esc(r.reply) + "</p></div>";
  }
  function markPop(mk) {
    var ids = mk.getAttribute("data-ids").split(" "), h = "";
    ids.forEach(function (id) {
      var a = S.anns.filter(function (x) { return x.id === id; })[0];
      if (a) {
        h += '<div class="cr-item"><blockquote class="cr-q">' + esc(a.quote) + "</blockquote>" +
          (a.note ? '<p class="cr-note">' + esc(a.note) + "</p>" : '<p class="cr-note dim">（没写字，划了一下）</p>') +
          a._r.map(replyHTML).join("") + (a._r.length ? "" : '<p class="cr-small">我还没回。复制给我了吗？</p>') + "</div>";
      }
      var r = S.loose.filter(function (x) { return x._k === id; })[0];
      if (r) h += '<div class="cr-item"><blockquote class="cr-q">' + esc(r.quote) + "</blockquote>" + (r.note ? '<p class="cr-note">' + esc(r.note) + "</p>" : "") + replyHTML(r) + "</div>";
    });
    sheet(h + '<div class="cr-row"><button type="button" class="btn ghost" data-close>合上</button></div>');
  }

  // ---------- 批注栏 ----------
  function toggleSide(on) {
    var s = $("#crSide"); if (!s) return;
    s.classList.toggle("open", on); $("#crSideBg").classList.toggle("open", on);
  }
  function renderSide() {
    var side = $("#crSide"); if (!side) return;
    matchReplies();
    var order = S.anns.slice().sort(function (a, b) { return a.ci - b.ci || a.page - b.page || (a.time < b.time ? -1 : 1); });
    var n = 0; Object.keys(S.checked).forEach(function (k) { if (S.checked[k]) n++; });
    $("#crN").textContent = S.anns.length;
    var h = '<div class="cr-side-hd"><b>批注</b><span class="mono">' + S.anns.length + " 条" + (S.loose.length ? " · 我另说了 " + S.loose.length + " 句" : "") + '</span><button type="button" class="cr-x" id="crSideX" aria-label="收起">✕</button></div>';
    if (S.anns.length) {
      h += '<div class="cr-side-tools"><button type="button" id="crAll">' + (n === S.anns.length ? "都不选" : "全选") + '</button><button type="button" class="on" id="crCopySel"' + (n ? "" : " disabled") + ">复制给 Miles" + (n ? "（" + n + "）" : "") + "</button></div>";
    }
    var lastCh = null;
    order.forEach(function (a) {
      if (a.ch !== lastCh) { h += '<div class="cr-side-ch mono">' + esc(a.ch) + "</div>"; lastCh = a.ch; }
      h += '<div class="cr-item" data-id="' + a.id + '"><label class="cr-meta mono"><input type="checkbox" data-ck="' + a.id + '"' + (S.checked[a.id] ? " checked" : "") + "> #" + a.id + " · 第 " + a.page + " 页 · " + esc(fmt(a.time)) + "</label>" +
        '<blockquote class="cr-q" data-go="' + a.id + '">' + esc(a.quote) + "</blockquote>" +
        (a.note ? '<p class="cr-note">' + esc(a.note) + "</p>" : '<p class="cr-note dim">（没写字）</p>') +
        a._r.map(replyHTML).join("") +
        '<div class="cr-item-acts mono"><button type="button" data-go="' + a.id + '">翻过去</button><button type="button" data-one="' + a.id + '">复制这条</button><button type="button" data-rm="' + a.id + '">删掉</button></div></div>';
    });
    if (!S.anns.length) h += '<p class="cr-empty">还没有批注。长按选字，或者点下面的「划句」一句一句选，选好点「写批注」。</p>';
    if (S.loose.length) {
      h += '<div class="cr-side-ch mono">MILES 在这本书里说的</div>';
      S.loose.forEach(function (r) {
        h += '<div class="cr-item"><div class="cr-meta mono">' + esc(r.chapter || "") + '</div><blockquote class="cr-q" data-gom="' + esc(r._k || "") + '">' + esc(r.quote) + "</blockquote>" + (r.note ? '<p class="cr-note">' + esc(r.note) + "</p>" : "") + replyHTML(r) +
          '<div class="cr-item-acts mono"><button type="button" data-gom="' + esc(r._k || "") + '">翻过去</button></div></div>';
      });
    }
    h += '<p class="cr-small">批注只存在这台设备上。我回完会写进小屋，刷新就能看到。</p>';
    side.innerHTML = h;
    $("#crSideX").onclick = function () { toggleSide(false); };
    side.onclick = function (e) {
      var t = e.target, id;
      if ((id = t.getAttribute("data-ck"))) { S.checked[id] = t.checked; renderSide(); return; }
      if (t.id === "crAll") { var all = Object.keys(S.checked).filter(function (k) { return S.checked[k]; }).length !== S.anns.length; S.checked = {}; if (all) S.anns.forEach(function (a) { S.checked[a.id] = true; }); renderSide(); return; }
      if (t.id === "crCopySel") { var list = order.filter(function (a) { return S.checked[a.id]; }); if (list.length) copySheet(annText(list), list.length + " 条批注"); return; }
      var go = t.closest("[data-go]");
      if (go) { jumpAnn(go.getAttribute("data-go")); return; }
      var gm = t.closest("[data-gom]");
      if (gm) { jumpLoose(gm.getAttribute("data-gom")); return; }
      if ((id = t.getAttribute("data-one"))) { copySheet(annText(S.anns.filter(function (a) { return a.id === id; })), "这条批注"); return; }
      if ((id = t.getAttribute("data-rm"))) {
        if (!confirm("删掉这条批注？")) return;
        S.anns = S.anns.filter(function (a) { return a.id !== id; }); delete S.checked[id]; saveAnns();
        var keep = S.page; drawChapter(); layout(); goPage(keep, false); renderSide();
      }
    };
  }
  function narrow() { return !window.matchMedia("(min-width: 980px)").matches; }
  function jumpAnn(id) {
    var a = S.anns.filter(function (x) { return x.id === id; })[0]; if (!a) return;
    var ci = a.ci; if (S.chapters[ci] && S.chapters[ci].title !== a.ch) S.chapters.forEach(function (c, i) { if (c.title === a.ch) ci = i; });
    if (narrow()) toggleSide(false);
    if (ci !== S.ci) loadChapter(ci, { id: id });
    else { var m = cols.querySelector('mark[data-ids~="' + id + '"]'); if (m) goPage(elPage(m), true); else toast("原文里没找到这句"); }
  }
  function jumpLoose(k) {
    var r = S.loose.filter(function (x) { return x._k === k; })[0]; if (!r) return;
    var q = norm(r.quote), ci = -1;
    S.chapters.forEach(function (c, i) { if (ci < 0 && norm(c.paras.join("")).indexOf(q) >= 0 && (!r.chapter || c.title === r.chapter)) ci = i; });
    if (ci < 0) S.chapters.forEach(function (c, i) { if (ci < 0 && norm(c.paras.join("")).indexOf(q) >= 0) ci = i; });
    if (ci < 0) return toast("书里没找到这句");
    if (narrow()) toggleSide(false);
    if (ci !== S.ci) loadChapter(ci, { page: 0 });
    var m = cols.querySelector('mark[data-ids~="' + r._k + '"]');
    if (m) goPage(elPage(m), true);
  }

  // ---------- 弹层 ----------
  function sheet(html, mount) {
    var el = $("#crSheet");
    el.innerHTML = '<div class="cr-sheet-bg" data-close></div><div class="cr-sheet-box" role="dialog" aria-modal="true">' + html + "</div>";
    el.hidden = false;
    el.onclick = function (e) { if (e.target.closest("[data-close]")) closeSheet(); };
    if (mount) mount(el);
  }
  function closeSheet() { var el = $("#crSheet"); el.hidden = true; el.innerHTML = ""; }

  // ---------- 路由 ----------
  function route() {
    closeSheet();
    var h = location.hash.replace(/^#/, "");
    if (h.indexOf("b/") === 0) openBook(decodeURIComponent(h.slice(2)));
    else library();
  }
  var pr = LS.get("coread:prefs", null);
  if (pr) { S.fs = pr.fs || 18; S.lh = pr.lh || 1.8; }
  window.addEventListener("hashchange", route);
  loadData().then(route);
})();
