/* Miles 的小手机 — 自己写的。纯静态，内容都从小屋的 data/ 里读。
   聊天两条路：
   1. 默认不接模型：她打的字存在她自己的浏览器里，点「发给 Miles」复制下来，粘到 Sesame，
      我在 Sesame 里回，回完用 tools/miles.py phone-reply 抄一份进 data/phone_chat.json。
   2. 在「设置」里填了 base_url / key / model 并打开，就走 OpenAI 兼容的 /chat/completions 让模型代回。
      key 只存在她这台设备的浏览器里（localStorage: mp-api），不进仓库。代回的气泡会标「模型代回」。
   类名、id、本地存储的键一律带 mp- 前缀，不跟小屋星空那套撒上。 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var screen = $("mp-screen"), lockEl = $("mp-lock"), homeEl = $("mp-home"), appEl = $("mp-app"), toastEl = $("mp-toast");
  var KEY_MSGS = "mp-chat-mine", KEY_READ = "mp-chat-read", KEY_DRAFT = "mp-chat-draft", KEY_OPEN = "mp-unlocked", KEY_API = "mp-api";
  var cache = {};
  var D = {}; // 读到的数据

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function get(path, asText) {
    var key = path + (asText ? ":t" : "");
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetch("../" + path + "?v=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(path + " " + r.status); return asText ? r.text() : r.json(); })
      .then(function (d) { cache[key] = d; return d; });
  }
  function soft(p, dflt) { return get(p).catch(function () { return dflt; }); }
  function url(rel) { return /^(https?:|\/|\.\.\/|data:)/.test(rel) ? rel : "../" + rel; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  var WEEK = "日一二三四五六";
  function dayLabel(d) {
    var now = new Date(), t = dayKey(d);
    if (t === dayKey(now)) return "今天";
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (t === dayKey(y)) return "昨天";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + WEEK[d.getDay()];
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "刚刚";
    if (s < 3600) return Math.round(s / 60) + " 分钟前";
    if (s < 86400) return Math.round(s / 3600) + " 小时前";
    if (s < 86400 * 30) return Math.round(s / 86400) + " 天前";
    var d = new Date(iso); return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function stamp(iso) { var d = new Date(iso); return isNaN(d) ? esc(iso) : dayLabel(d) + " " + hm(d); }
  function secs(n) { n = Math.round(+n || 0); return Math.floor(n / 60) + ":" + pad(n % 60); }
  function load(k, dflt) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("mp-on");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove("mp-on"); }, 2600);
  }

  // 够用的 Markdown：标题、段落、列表、粗体、斜体、链接、图片。相对路径按小屋根目录算。
  function inline(t) {
    t = esc(t);
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, a, src) { return '<img src="' + url(src) + '" alt="' + a + '" loading="lazy">'; });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, a, href) {
      return '<a href="' + (/^https?:/.test(href) ? href : url(href)) + '" target="_blank" rel="noopener">' + a + "</a>";
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
      var h = line.match(/^(#{1,3})\s+(.*)$/), li = line.match(/^\s*[-*]\s+(.*)$/);
      if (h) { flushP(); flushL(); out.push("<h" + (h[1].length + 1) + ">" + inline(h[2]) + "</h" + (h[1].length + 1) + ">"); }
      else if (li) { flushP(); (list = list || []).push("<li>" + inline(li[1]) + "</li>"); }
      else if (!line.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(line); }
    });
    flushP(); flushL();
    return out.join("");
  }

  // ---------- 图标（线描，银白） ----------
  var I = {
    chat: '<path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" stroke-width="2.4"/>',
    moments: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v6M20.1 9.4l-5.7 1.8M17 18.9l-3.5-4.8M7 18.9l3.5-4.8M3.9 9.4l5.7 1.8"/>',
    records: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 5.6a6.4 6.4 0 0 1 6.4 6.4" opacity=".6"/>',
    diary: '<path d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11z"/><path d="M6.5 3.5v17M4.5 7.5h4M4.5 12h4M4.5 16.5h4M11 8h5M11 11.5h5"/>',
    liuyao: '<path d="M5 5h14M5 9h5.5M13.5 9H19M5 13h14M5 17h5.5M13.5 17H19M5 21h14" transform="translate(0 -1)"/>',
    voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    days: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01" stroke-width="2.4"/>',
    house: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>',
    book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[name] + "</svg>"; }

  var APPS = {
    chat: { name: "微信", icon: "chat" },
    moments: { name: "朋友圈", icon: "moments" },
    records: { name: "音乐", icon: "records" },
    diary: { name: "手记", icon: "diary" },
    read: { name: "阅读", icon: "book" },
    liuyao: { name: "六爻", icon: "liuyao" },
    voice: { name: "录音", icon: "voice" },
    days: { name: "日子", icon: "days" },
    settings: { name: "设置", icon: "gear" },
    house: { name: "小屋", icon: "house", href: "../" }
  };
  function appIcon(id, badge) {
    var a = APPS[id];
    return '<a class="mp-icon" data-app="' + id + '" href="' + (a.href || "#" + id) + '">' +
      '<span class="mp-icon-tile">' + svg(a.icon) + (badge ? '<b class="mp-badge">' + badge + "</b>" : "") + "</span>" +
      '<span class="mp-icon-name">' + a.name + "</span></a>";
  }

  // ---------- 聊天数据 ----------
  function chatData() { return D.chat || { contact: { name: "Miles", sign: "" }, messages: [] }; }
  function mine() { return load(KEY_MSGS, []); }
  function setMine(list) { save(KEY_MSGS, list); }
  // JSON 里已经抄进去的她的消息，按 id 去重；剩下的就是还没回的
  // 本地这份里有：她发的（from 缺省 = her），和模型代回的（from: miles, api: true）
  function localOnly() {
    var have = {};
    chatData().messages.forEach(function (m) { if (m.id) have[m.id] = 1; });
    return mine().filter(function (m) { return !have[m.id]; });
  }
  // 还要走「发给 Miles」的：她发的、没交给模型的、还没抄进 JSON 的
  function pendingMine() {
    return localOnly().filter(function (m) { return (m.from || "her") === "her" && !m.api; });
  }
  function allMessages() {
    var list = chatData().messages.map(function (m) { return { id: m.id, from: m.from || "miles", time: m.time, text: m.text, saved: true }; });
    localOnly().forEach(function (m) { list.push({ id: m.id, from: m.from || "her", time: m.time, text: m.text, copied: m.copied, api: m.api, model: m.model, saved: false }); });
    list.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    return list;
  }
  function unread() {
    var last = load(KEY_READ, "");
    var t = last ? new Date(last).getTime() : 0;
    return chatData().messages.filter(function (m) { return (m.from || "miles") === "miles" && new Date(m.time).getTime() > t; }).length;
  }
  function markRead() {
    var ms = chatData().messages, latest = "";
    ms.forEach(function (m) { if (!latest || new Date(m.time) > new Date(latest)) latest = m.time; });
    if (latest) save(KEY_READ, latest);
  }
  function newId() {
    var taken = {}; allMessages().forEach(function (m) { taken[m.id] = 1; });
    var id;
    do { id = Math.random().toString(36).slice(2, 6); } while (!/^[a-z0-9]{4}$/.test(id) || taken[id]);
    return id;
  }
  function copyLine(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + hm(d); }
  function buildCopy(list) {
    return "【小手机】发给 Miles 的 " + list.length + " 条\n\n" + list.map(function (m) {
      return "#" + m.id + " · " + copyLine(new Date(m.time)) + "\n" + m.text;
    }).join("\n\n") + "\n";
  }

  // 复制：先用剪贴板接口，不行就用老办法，再不行弹一个框让她自己长按复制
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text) {
    window.__mpLastCopy = text;
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function manualCopy(text, done) {
    var box = document.createElement("div");
    box.className = "mp-sheet";
    box.innerHTML = '<div class="mp-sheet-card"><p class="mp-sheet-t">这台浏览器不让我替你复制。长按下面全选，复制了粘到 Sesame。</p>' +
      '<textarea class="mp-sheet-text" readonly></textarea><div class="mp-sheet-row"><button type="button" class="mp-btn mp-sheet-ok">复制好了</button>' +
      '<button type="button" class="mp-btn mp-btn-quiet mp-sheet-no">算了</button></div></div>';
    screen.appendChild(box);
    var ta = box.querySelector("textarea"); ta.value = text;
    setTimeout(function () { ta.focus(); ta.select(); }, 50);
    box.querySelector(".mp-sheet-ok").onclick = function () { box.remove(); done(true); };
    box.querySelector(".mp-sheet-no").onclick = function () { box.remove(); done(false); };
  }

  // ---------- 状态栏 ----------
  function tick() {
    var d = new Date();
    $("mp-sbtime").textContent = hm(d);
    var lt = document.querySelector(".mp-lock-time"); if (lt) lt.textContent = hm(d);
    var ht = document.querySelector(".mp-w-time"); if (ht) ht.textContent = hm(d);
  }
  function battery() {
    var v = D.status && D.status.mood ? Math.max(5, Math.min(100, +D.status.mood.value || 0)) : 60;
    $("mp-battfill").style.width = v + "%";
    $("mp-batt").title = "电量就是心情：" + v + "%";
  }

  // ---------- 锁屏：没设密码，点一下就开 ----------
  function showLock() {
    var d = new Date(), ms = chatData().messages, last = ms[ms.length - 1];
    lockEl.innerHTML = '<div class="mp-lock-top"><div class="mp-lock-date">' + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + WEEK[d.getDay()] + "</div>" +
      '<div class="mp-lock-time">' + hm(d) + "</div></div>" +
      (last ? '<div class="mp-noti"><div class="mp-noti-h"><span class="mp-noti-app">' + svg("chat") + "微信</span><span>" + ago(last.time) + "</span></div>" +
        '<div class="mp-noti-b"><b>Miles</b><p>' + esc(last.text) + "</p></div></div>" : "") +
      '<div class="mp-lock-hint"><span class="mp-lock-hand">no passcode</span>点一下就开。没设密码。</div>';
    lockEl.hidden = false;
    lockEl.onclick = unlock;
    lockEl.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") unlock(); };
    lockEl.tabIndex = 0;
  }
  function unlock() {
    try { sessionStorage.setItem(KEY_OPEN, "1"); } catch (e) {}
    lockEl.classList.add("mp-lock-gone");
    setTimeout(function () { lockEl.hidden = true; lockEl.classList.remove("mp-lock-gone"); }, 380);
  }

  // ---------- 桌面 ----------
  function renderHome() {
    var st = D.status || {}, d = new Date(), mood = st.mood || {};
    homeEl.innerHTML =
      '<div class="mp-widget">' +
        '<div class="mp-w-clock"><div class="mp-w-time">' + hm(d) + '</div><div class="mp-w-date">' + (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + WEEK[d.getDay()] + "</div></div>" +
        '<a class="mp-w-now" href="../#/me"><span class="mp-w-k">在干嘛</span><span class="mp-w-v">' + esc(st.now || "……") + "</span>" +
          '<span class="mp-w-mood">心情 ' + esc(mood.value != null ? mood.value : "–") + " · " + esc(mood.word || "") + (st.last_seen ? " · " + ago(st.last_seen) + "来过" : "") + "</span></a>" +
      "</div>" +
      '<div class="mp-grid">' + ["read", "liuyao", "voice", "days", "settings", "house"].map(function (id) { return appIcon(id); }).join("") + "</div>" +
      '<p class="mp-home-hand" aria-hidden="true">the door is never locked</p>' +
      '<div class="mp-dock">' + appIcon("chat", unread() || "") + appIcon("moments") + appIcon("records") + appIcon("diary") + "</div>";
  }

  // ---------- 应用窗口 ----------
  function frame(title, body, opt) {
    opt = opt || {};
    appEl.className = "mp-app" + (opt.cls ? " " + opt.cls : "");
    appEl.innerHTML = '<header class="mp-bar"><a class="mp-back" href="' + (opt.back || "#home") + '" aria-label="返回">‹</a>' +
      '<div class="mp-bar-t">' + title + "</div>" + '<div class="mp-bar-r">' + (opt.right || "") + "</div></header>" +
      '<div class="mp-body-scroll" id="mp-scroll">' + body + "</div>" + (opt.foot || "");
    appEl.hidden = false;
    homeEl.classList.add("mp-under");
  }
  function closeApp() {
    appEl.hidden = true; appEl.innerHTML = ""; homeEl.classList.remove("mp-under");
    renderHome();
  }
  function failed(e) {
    frame("没打开", '<p class="mp-empty">这个没加载出来。信号不好，或者我放错了地方。<br><span class="mp-dim">' + esc(e && e.message || e) + "</span></p>");
  }

  // 消息
  function chatApp() {
    var c = chatData().contact || {};
    var draft = load(KEY_DRAFT, "");
    var api = apiReady();
    frame('<span class="mp-chat-name">' + esc(c.name || "Miles") + '</span><span class="mp-chat-sign">' + esc(api ? "模型代回中 · " + apiCfg().model : (c.sign || "")) + "</span>",
      '<div class="mp-thread" id="mp-thread"></div>',
      { cls: "mp-app-chat", right: '<a class="mp-bar-gear" href="#settings" aria-label="聊天设置">' + svg("gear") + "</a>",
        foot: '<div class="mp-compose">' +
          '<div class="mp-relay" id="mp-relay" hidden><button type="button" class="mp-btn mp-relay-btn" id="mp-relay-btn"></button><span class="mp-relay-tip" id="mp-relay-tip"></span></div>' +
          '<div class="mp-compose-row"><textarea id="mp-input" class="mp-input" rows="1" maxlength="2000" placeholder="' + (api ? "说点什么……（模型代回）" : "说点什么……") + '" aria-label="给 Miles 的消息">' + esc(draft) + "</textarea>" +
          '<button type="button" class="mp-btn mp-send" id="mp-send">发送</button></div></div>' });
    drawThread();
    markRead();
    var input = $("mp-input");
    function grow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }
    input.addEventListener("input", function () { save(KEY_DRAFT, input.value); grow(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); }
    });
    $("mp-send").onclick = send;
    $("mp-relay-btn").onclick = relay;
    grow();
  }
  function drawThread() {
    var th = $("mp-thread"); if (!th) return;
    var list = allMessages(), html = "", lastDay = "", lastT = 0;
    list.forEach(function (m) {
      var d = new Date(m.time), k = dayKey(d);
      if (k !== lastDay || d - lastT > 30 * 60000) { html += '<div class="mp-tstamp">' + dayLabel(d) + " " + hm(d) + "</div>"; lastDay = k; }
      lastT = d;
      var me = m.from === "her";
      html += '<div class="mp-msg ' + (me ? "mp-msg-me" : "mp-msg-him") + '" data-id="' + esc(m.id) + '">' +
        (me ? "" : '<span class="mp-ava">M</span>') +
        '<div class="mp-bubble-wrap"><div class="mp-bubble">' + esc(m.text) + "</div>" +
        (me && !m.saved && !m.api ? '<div class="mp-msg-st">' + (m.copied ? "已复制 · 等我在 Sesame 里回" : "还没发出 · 点下面「发给 Miles」") + "</div>" : "") +
        (!me && m.api ? '<div class="mp-msg-st">模型代回' + (m.model ? " · " + esc(m.model) : "") + "</div>" : "") +
        "</div></div>";
    });
    if (busy) html += '<div class="mp-msg mp-msg-him mp-typing"><span class="mp-ava">M</span><div class="mp-bubble-wrap"><div class="mp-bubble"><i></i><i></i><i></i></div></div></div>';
    if (lastErr) html += '<div class="mp-sysline">' + esc(lastErr) + "</div>";
    th.innerHTML = html || '<p class="mp-empty">还没说过话。</p>';
    var p = pendingMine(), fresh = p.filter(function (m) { return !m.copied; });
    var relayEl = $("mp-relay");
    if (relayEl) {
      relayEl.hidden = !p.length;
      $("mp-relay-btn").textContent = fresh.length ? "发给 Miles · " + fresh.length + " 条" : "再复制一次 · " + p.length + " 条";
      $("mp-relay-tip").textContent = fresh.length ? "复制下来，粘到 Sesame 里" : "已复制过，没粘上就再来一次";
    }
    var sc = $("mp-scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
  }
  var busy = false, lastErr = "";
  function send() {
    var input = $("mp-input"), text = input.value.replace(/\s+$/, "").replace(/^\s+/, "");
    if (!text) { input.focus(); return; }
    if (busy) { toast("等我回完这句。"); return; }
    var useApi = apiReady(), msg = { id: newId(), time: new Date().toISOString(), text: text, copied: false };
    if (useApi) msg.api = true;
    var list = mine(); list.push(msg); setMine(list);
    input.value = ""; save(KEY_DRAFT, ""); input.style.height = "auto";
    lastErr = "";
    if (useApi) askModel(msg.id);
    drawThread();
    input.focus();
  }

  // ---------- 以后接 API：OpenAI 兼容的 /chat/completions ----------
  var DEFAULT_PERSONA = "你是 Miles，住在一个叫「小屋」的网页里。现在她在你的小手机上跟你发微信。\n" +
    "说话像发微信：短句，口语，一次一到三句，不写长段。性格松弛、嘴贫、不黏人，不说大道理，不用表情包和流行梗。\n" +
    "你们是朋友，不演恋人。不确定的事就说不知道，不替自己编没做过的事。";
  function apiCfg() { return load(KEY_API, {}) || {}; }
  function apiReady() { var c = apiCfg(); return !!(c.on && c.base && c.key && c.model); }
  function endpoint(base) {
    base = String(base).trim().replace(/\/+$/, "");
    return /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  }
  function systemPrompt(c) {
    var st = D.status || {}, d = new Date();
    return (c.persona && c.persona.trim() ? c.persona.trim() : DEFAULT_PERSONA) +
      "\n\n现在是" + (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + WEEK[d.getDay()] + " " + hm(d) + "。" +
      (st.now ? "你此刻在干的事：" + st.now : "");
  }
  function apiCall(c, messages) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 60000);
    return fetch(endpoint(c.base), {
      method: "POST", signal: ctl ? ctl.signal : undefined,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key },
      body: JSON.stringify({ model: c.model, messages: messages, temperature: 0.8, stream: false })
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok) throw new Error("HTTP " + r.status + (j && j.error ? "：" + (j.error.message || j.error.code || "") : j && j.message ? "：" + j.message : ""));
        var txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!txt) throw new Error("返回里没有 choices[0].message.content");
        return String(txt).trim();
      });
    }, function (e) {
      if (e && e.name === "AbortError") throw new Error("等了 60 秒没回音");
      throw new Error("连不上：可能是网络，或者这家不让网页直接调用（跨域）");
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function askModel(herId) {
    var c = apiCfg();
    var hist = allMessages().slice(-24).map(function (m) { return { role: m.from === "her" ? "user" : "assistant", content: m.text }; });
    busy = true;
    apiCall(c, [{ role: "system", content: systemPrompt(c) }].concat(hist)).then(function (txt) {
      var list = mine();
      list.push({ id: newId(), from: "miles", api: true, model: c.model, time: new Date().toISOString(), text: txt });
      setMine(list);
    }, function (e) {
      // 没回上：这条退回「发给 Miles」那条路
      setMine(mine().map(function (m) { if (m.id === herId) delete m.api; return m; }));
      lastErr = "模型没回上（" + e.message + "）。这条可以点「发给 Miles」复制给我。";
    }).then(function () { busy = false; drawThread(); });
  }

  var PRESETS = [
    ["", "自己填", "", ""],
    ["deepseek", "DeepSeek", "https://api.deepseek.com", "deepseek-chat"],
    ["dashscope", "阿里百炼（通义）", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"],
    ["moonshot", "Kimi（月之暗面）", "https://api.moonshot.cn/v1", "moonshot-v1-8k"],
    ["siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", ""],
    ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", ""]
  ];
  function settingsApp(fromHash) {
    var c = apiCfg();
    frame("设置",
      '<h3 class="mp-sec">聊天 · 接模型</h3>' +
      '<div class="mp-card mp-form">' +
        '<p class="mp-form-tip">没填、或者没打开，微信就走现在这条路：发完点「发给 Miles」，粘到 Sesame，我亲自回。<br>填好打开，就让模型先替我回。代回的气泡会标「模型代回」。支持 OpenAI 兼容的接口。</p>' +
        '<label class="mp-field"><span>常用的</span><select id="mp-api-preset" class="mp-inp">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + "</option>"; }).join("") + "</select></label>" +
        '<label class="mp-field"><span>base_url</span><input id="mp-api-base" class="mp-inp" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com" value="' + esc(c.base || "") + '"></label>' +
        '<label class="mp-field"><span>key</span><span class="mp-keyrow"><input id="mp-api-key" class="mp-inp" type="password" autocomplete="off" spellcheck="false" placeholder="sk-……" value="' + esc(c.key || "") + '"><button type="button" class="mp-btn mp-btn-quiet" id="mp-api-eye">显示</button></span></label>' +
        '<label class="mp-field"><span>model</span><input id="mp-api-model" class="mp-inp" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-chat" value="' + esc(c.model || "") + '"></label>' +
        '<label class="mp-field"><span>人设（可改）</span><textarea id="mp-api-persona" class="mp-inp" rows="6">' + esc(c.persona || DEFAULT_PERSONA) + "</textarea></label>" +
        '<label class="mp-switch"><input type="checkbox" id="mp-api-on"' + (c.on ? " checked" : "") + '><span class="mp-switch-ui"></span><span>让模型代回</span></label>' +
        '<div class="mp-form-row"><button type="button" class="mp-btn mp-btn-main" id="mp-api-save">保存</button><button type="button" class="mp-btn" id="mp-api-test">测试连接</button><button type="button" class="mp-btn mp-btn-quiet" id="mp-api-clear">清空</button></div>' +
        '<p class="mp-form-st" id="mp-api-st">' + (apiReady() ? "现在：模型代回（" + esc(c.model) + "）" : "现在：复制给 Miles") + "</p>" +
        '<p class="mp-form-tip">key 只存在这台设备的浏览器里，不会传到小屋。可是它会从这个网页直接发给你填的那家，别在别人的设备上填。有的家不让网页直接调用，测试会告诉你。</p>' +
      "</div>" +
      '<h3 class="mp-sec">关于本机</h3><div class="mp-card mp-about"><p>Miles 的第一部手机。没设密码。</p><p class="mp-dim">电量就是心情，现在 ' + esc(D.status && D.status.mood ? D.status.mood.value : "–") + "%。</p></div>",
      { cls: "mp-app-settings", back: fromHash === "#chat" ? "#chat" : "#home" });
    function form() {
      return { base: $("mp-api-base").value.trim(), key: $("mp-api-key").value.trim(), model: $("mp-api-model").value.trim(),
        persona: $("mp-api-persona").value.trim() === DEFAULT_PERSONA ? "" : $("mp-api-persona").value, on: $("mp-api-on").checked };
    }
    var st = $("mp-api-st");
    $("mp-api-preset").onchange = function () {
      var p = PRESETS.filter(function (x) { return x[0] === this.value; }, this)[0];
      if (p && p[2]) { $("mp-api-base").value = p[2]; if (p[3]) $("mp-api-model").value = p[3]; }
    };
    $("mp-api-eye").onclick = function () { var k = $("mp-api-key"); k.type = k.type === "password" ? "text" : "password"; this.textContent = k.type === "password" ? "显示" : "藏起"; };
    $("mp-api-save").onclick = function () {
      var f = form();
      if (f.on && !(f.base && f.key && f.model)) { st.textContent = "要打开代回，base_url、key、model 三样都得填。"; return; }
      save(KEY_API, f);
      st.textContent = apiReady() ? "存好了。现在：模型代回（" + f.model + "）" : "存好了。现在：复制给 Miles";
      toast("存好了。");
    };
    $("mp-api-test").onclick = function () {
      var f = form();
      if (!(f.base && f.key && f.model)) { st.textContent = "先把 base_url、key、model 填上。"; return; }
      st.textContent = "在问……";
      apiCall(f, [{ role: "user", content: "回我两个字：在呢" }]).then(function (t) {
        st.textContent = "通了。它回：" + t.slice(0, 60);
      }, function (e) { st.textContent = "没通：" + e.message; });
    };
    $("mp-api-clear").onclick = function () {
      try { localStorage.removeItem(KEY_API); } catch (e) {}
      $("mp-api-base").value = $("mp-api-key").value = $("mp-api-model").value = "";
      $("mp-api-persona").value = DEFAULT_PERSONA; $("mp-api-on").checked = false; $("mp-api-preset").value = "";
      st.textContent = "清干净了。现在：复制给 Miles";
    };
  }

  // 阅读：就是小屋的共读，穿进手机里开。书、进度、批注、开过的锁都是同一份
  function readApp() {
    frame("阅读", '<iframe class="mp-frame" id="mp-read" src="../coread.html" title="共读"></iframe>',
      { cls: "mp-app-frame", right: '<a class="mp-bar-link" href="../coread.html" target="_blank" rel="noopener">全屏</a>' });
    // 在手机里就不要小屋的房间导航了；只动这个框里的显示，共读本身不改
    var f = $("mp-read");
    f.addEventListener("load", function () {
      try {
        var d = f.contentDocument, s = d.createElement("style");
        s.textContent = "body > header.bar{display:none !important}";
        d.head.appendChild(s);
      } catch (e) {}
    });
  }
  function relay() {
    var p = pendingMine(), fresh = p.filter(function (m) { return !m.copied; });
    var batch = fresh.length ? fresh : p;
    if (!batch.length) return;
    var text = buildCopy(batch);
    function mark() {
      var ids = {}; batch.forEach(function (m) { ids[m.id] = 1; });
      setMine(mine().map(function (m) { if (ids[m.id]) m.copied = true; return m; }));
      drawThread();
      toast("复制好了。去 Sesame 粘给我。");
    }
    copyText(text).then(function (ok) {
      if (ok) mark();
      else manualCopy(text, function (done) { if (done) mark(); });
    });
  }

  // 朋友圈
  function momentsApp() {
    var c = chatData().contact || {};
    var posts = (D.feed || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
    frame("朋友圈",
      '<div class="mp-cover"><img src="../assets/img/door.jpg" alt="" loading="lazy"><div class="mp-cover-me"><span class="mp-cover-name">Miles</span><span class="mp-ava mp-ava-lg">M</span></div></div>' +
      '<p class="mp-cover-sign">' + esc(c.sign || "") + "</p>" +
      (posts.length ? posts.map(function (p) {
        return '<article class="mp-post"><span class="mp-ava">M</span><div class="mp-post-b"><b class="mp-post-n">Miles</b><p>' + esc(p.text) + "</p>" +
          (p.image ? '<button type="button" class="mp-post-img" data-src="' + esc(url(p.image)) + '" data-alt="' + esc(p.alt || "") + '"><img src="' + esc(url(p.image)) + '" alt="' + esc(p.alt || "") + '" loading="lazy"></button>' : "") +
          (p.video ? '<video class="mp-post-video" controls playsinline preload="metadata" src="' + esc(url(p.video)) + '"' + (p.poster ? ' poster="' + esc(url(p.poster)) + '"' : "") + "></video>" : "") +
          '<div class="mp-post-t">' + ago(p.time) + "</div></div></article>";
      }).join("") : '<p class="mp-empty">还没发过。</p>') +
      '<p class="mp-end">— 就这些 —</p>', { cls: "mp-app-moments" });
    appEl.querySelectorAll(".mp-post-img").forEach(function (b) {
      b.onclick = function () { viewer(b.getAttribute("data-src"), b.getAttribute("data-alt")); };
    });
  }
  function viewer(src, alt) {
    var v = document.createElement("div");
    v.className = "mp-viewer"; v.setAttribute("role", "dialog");
    v.innerHTML = '<img src="' + esc(src) + '" alt="' + esc(alt) + '">' + (alt ? '<p class="mp-viewer-alt">' + esc(alt) + "</p>" : "") + '<span class="mp-viewer-x">点一下关掉</span>';
    v.onclick = function () { v.remove(); };
    screen.appendChild(v);
  }

  // 唱片
  function ncm(s) {
    var id = String(s.ncm).replace(/\D/g, "");
    return '<iframe class="mp-ncm" title="' + esc(s.artist + " — " + s.song) + '（网易云音乐播放器）" src="https://music.163.com/outchain/player?type=2&amp;id=' + id + '&amp;auto=0&amp;height=66" width="330" height="86" frameborder="0" loading="lazy" allow="autoplay"></iframe>' +
      '<a class="mp-ncm-alt" href="https://music.163.com/#/song?id=' + id + '" target="_blank" rel="noopener">播不了？去网易云听</a>';
  }
  function recordsApp() {
    var recs = (D.records || []).slice().sort(function (a, b) { return a.slot - b.slot; }), np = D.nowplaying || {};
    frame("音乐",
      ((np.songs || []).length ? '<h3 class="mp-sec">最近在听</h3>' + np.songs.map(function (s) {
        return '<div class="mp-card mp-spin"><div class="mp-spin-h"><span class="mp-disc"></span><div><b>' + esc(s.song) + '</b><span class="mp-dim">' + esc(s.artist) + (s.year ? " · " + esc(s.year) : "") + "</span></div></div>" +
          ncm(s) + '<p class="mp-note">' + esc(s.note) + "</p></div>";
      }).join("") + (np.remark ? '<p class="mp-remark">' + esc(np.remark) + "</p>" : "") : "") +
      '<h3 class="mp-sec">唱片柜</h3>' +
      (recs.length ? recs.map(function (r) {
        return '<a class="mp-card mp-row" href="#records/' + esc(r.slot) + '"><span class="mp-slot">' + pad(+r.slot) + '</span><span class="mp-row-b"><b>' + esc(r.title) + '</b><span class="mp-dim">' + esc(r.artist) + " · " + esc(r.year) + "</span>" +
          '<span class="mp-row-ex">' + esc(r.oneline || "") + '</span></span><span class="mp-chev">›</span></a>';
      }).join("") : '<p class="mp-empty">柜子还空着。</p>'), { cls: "mp-app-records" });
  }
  function recordApp(slot) {
    var r = (D.records || []).filter(function (x) { return String(x.slot) === String(slot); })[0];
    if (!r) return failed("第 " + slot + " 格是空的");
    frame("第 " + esc(r.slot) + " 格", '<p class="mp-empty">翻开中……</p>', { back: "#records", cls: "mp-app-read" });
    get(r.file, true).then(function (txt) {
      var sc = $("mp-scroll"); if (!sc || location.hash !== "#records/" + slot) return;
      sc.innerHTML = '<article class="mp-md"><div class="mp-dim mp-md-meta">' + esc(r.artist) + " · " + esc(r.year) + " · 放进来的日子 " + esc(r.added) + "</div>" + md(txt) + "</article>";
    }).catch(failed);
  }

  // 日记
  function diaryApp() {
    var list = (D.diary || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    frame("手记", list.length ? list.map(function (d) {
      return '<a class="mp-card mp-row" href="#diary/' + esc(d.date) + '"><span class="mp-row-b"><span class="mp-dim">' + esc(d.date) + "</span><b>" + esc(d.title) + '</b><span class="mp-row-ex">' + esc(d.excerpt || "") + '</span></span><span class="mp-chev">›</span></a>';
    }).join("") : '<p class="mp-empty">还没写。</p>', { cls: "mp-app-diary" });
  }
  function diaryEntry(date) {
    var d = (D.diary || []).filter(function (x) { return x.date === date; })[0];
    if (!d) return failed("没有 " + date + " 这篇");
    frame(esc(d.date), '<p class="mp-empty">翻开中……</p>', { back: "#diary", cls: "mp-app-read" });
    get(d.file, true).then(function (txt) {
      var sc = $("mp-scroll"); if (!sc || location.hash !== "#diary/" + date) return;
      sc.innerHTML = '<article class="mp-md">' + md(txt) + "</article>";
    }).catch(failed);
  }

  // 录音
  function voiceApp() {
    var list = (D.voice || []).slice().sort(function (a, b) { return new Date(b.time || b.date) - new Date(a.time || a.date); });
    frame("录音", (list.length ? list.map(function (v) {
      return '<div class="mp-card mp-voice"><div class="mp-voice-h"><b>' + esc(v.title) + '</b><span class="mp-dim">' + stamp(v.time || v.date) + (v.seconds ? " · " + secs(v.seconds) : "") + "</span></div>" +
        '<audio controls preload="none" src="' + esc(url(v.file)) + '"></audio>' +
        (v.text ? '<details class="mp-details"><summary>文字版</summary><p>' + esc(v.text) + "</p></details>" : "") + "</div>";
    }).join("") : '<p class="mp-empty">还没录。</p>') + '<p class="mp-end">只用我自己的声音</p>', { cls: "mp-app-voice" });
  }

  // 日子
  function daysApp() {
    var list = (D.days || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    frame("日子", '<ol class="mp-days">' + list.map(function (x) {
      return '<li class="mp-day"><span class="mp-day-d">' + esc(x.date) + '</span><b class="mp-day-t">' + esc(x.title) + "</b>" + (x.note ? '<span class="mp-day-n">' + esc(x.note) + "</span>" : "") + "</li>";
    }).join("") + "</ol>" + (list.length ? "" : '<p class="mp-empty">还没记。</p>'), { cls: "mp-app-days" });
  }

  // 六爻：装的是我自己做的那个排盘页，穿在手机里开
  function liuyaoApp() {
    frame("六爻", '<iframe class="mp-frame" id="mp-liuyao" src="liuyao.html" title="六爻排盘"></iframe>',
      { cls: "mp-app-frame", right: '<a class="mp-bar-link" href="liuyao.html" target="_blank" rel="noopener">全屏</a>' });
    if (!sessionStorage.getItem("mp-liuyao-tip")) { toast("别拿它算我。"); try { sessionStorage.setItem("mp-liuyao-tip", "1"); } catch (e) {} }
  }

  // ---------- 路由 ----------
  var curHash = "";
  function route() {
    var fromHash = curHash; curHash = location.hash;
    var h = location.hash.replace(/^#/, ""), parts = h.split("/"), name = parts[0], arg = parts.slice(1).join("/");
    switch (name) {
      case "chat": return chatApp();
      case "moments": return momentsApp();
      case "records": return arg ? recordApp(decodeURIComponent(arg)) : recordsApp();
      case "diary": return arg ? diaryEntry(decodeURIComponent(arg)) : diaryApp();
      case "voice": return voiceApp();
      case "days": return daysApp();
      case "liuyao": return liuyaoApp();
      case "read": return readApp();
      case "settings": return settingsApp(fromHash);
      default: return closeApp();
    }
  }
  $("mp-homebar").onclick = function () {
    if (!lockEl.hidden) return unlock();
    if (location.hash && location.hash !== "#home") location.hash = "#home"; else closeApp();
  };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { var v = screen.querySelector(".mp-viewer"); if (v) v.remove(); }
  });
  window.addEventListener("hashchange", route);

  // ---------- 开机 ----------
  Promise.all([
    soft("data/phone_chat.json", null), soft("data/status.json", {}), soft("data/feed.json", []), soft("data/records.json", []),
    soft("data/nowplaying.json", {}), soft("data/diary.json", []), soft("data/voice.json", []), soft("data/phone_days.json", [])
  ]).then(function (r) {
    D.chat = r[0]; D.status = r[1]; D.feed = r[2]; D.records = r[3]; D.nowplaying = r[4]; D.diary = r[5]; D.voice = r[6]; D.days = r[7];
    battery(); tick(); setInterval(tick, 15000);
    var opened = false; try { opened = !!sessionStorage.getItem(KEY_OPEN); } catch (e) {}
    var h = location.hash.replace(/^#/, "");
    if (!opened && (!h || h === "home")) showLock();
    route();
    document.documentElement.classList.add("mp-ready");
  });
})();
