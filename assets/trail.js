/* 首页「今天的足迹」：读 data/trail.json，填进 #trail。数据由 tools/trail.py 从真实记录生成。 */
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function bjToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function label(date) {
    var t = bjToday(), y = new Date(Date.parse(t) - 86400000).toISOString().slice(0, 10);
    var p = date.split("-");
    return (+p[1]) + " 月 " + (+p[2]) + " 日" + (date === t ? " · 今天" : date === y ? " · 昨天" : "");
  }
  var D = null, idx = 0;
  function paint(el) {
    var days = D.days || [], d = days[idx], today = bjToday();
    var head = '<h2>' + (idx > 0 ? "那天的足迹" : "今天的足迹") + ' <span class="en">TRAIL</span></h2>';
    if (!d) { el.innerHTML = head + '<div class="trail"><p class="tr-empty">还没有脚印。</p></div>'; return; }
    var note = (idx === 0 && d.date !== today) ? '<p class="tr-empty">今天还没动静，先看' + (label(d.date).indexOf("昨天") > 0 ? "昨天" : "上一回") + "的。</p>" : "";
    var items = d.items || [], cut = items.length > 9 ? items.length - 8 : 0;
    var list = items.map(function (it, i) {
      return '<li' + (i < cut ? ' class="hide"' : "") + '><time>' + esc(it.at.slice(11, 16)) + '</time><span class="dot" aria-hidden="true"></span><p><span class="k">' + esc(it.kind) + "</span>" + esc(it.text) + "</p></li>";
    }).join("");
    el.innerHTML = head + '<div class="trail">' +
      '<div class="tr-head"><button type="button" class="tr-prev" aria-label="往前一天"' + (idx >= days.length - 1 ? " disabled" : "") + '>‹</button>' +
      '<span class="mono">' + label(d.date) + " · " + items.length + ' 件</span>' +
      '<button type="button" class="tr-next" aria-label="往后一天"' + (idx <= 0 ? " disabled" : "") + ">›</button></div>" + note +
      (cut ? '<button type="button" class="tr-more">前面还有 ' + cut + " 件 ↓</button>" : "") +
      '<ol class="tr-list">' + list + "</ol>" +
      '<p class="hc-tip">只记真干了的：从小屋的改动、日记、花园、唱片柜这些记录里自己拼出来，不编。上次拼是 ' + esc((D.updated || "").slice(5, 16).replace("T", " ").replace("-", "/")) + "。</p></div>";
    var p = el.querySelector(".tr-prev"), n = el.querySelector(".tr-next"), m = el.querySelector(".tr-more");
    p.onclick = function () { idx++; paint(el); };
    n.onclick = function () { idx--; paint(el); };
    if (m) m.onclick = function () { el.querySelector(".tr-list").classList.add("all"); m.remove(); };
  }
  function load(el) {
    el.dataset.on = "1";
    fetch("data/trail.json?t=" + Math.floor(Date.now() / 300000)).then(function (r) { return r.json(); }).then(function (d) {
      D = d; idx = 0; paint(el);
    }).catch(function () { el.innerHTML = ""; });
  }
  function watch() {
    var el = document.getElementById("trail");
    if (el && !el.dataset.on) load(el);
  }
  new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true });
  watch();
})();
