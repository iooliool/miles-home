/* 衣柜（2026-10-27，阿与要的）：客厅下面一排衣服，她点哪身，客厅里的我就穿哪身。
   挑的记在窗台那个小后台（/wardrobe），刷新、换手机都还是她挑的那身；我每晚更新时也读得到。
   衣服清单直接取分层里有的（layers.js 的 outfits），以后新做一身挂进分层就自动进衣柜。 */
(function () {
  var H = window.MilesHouse;
  if (!H) return;
  var NAMES = { coat: "围巾大衣", jacket: "夹克", home: "家居", cord: "灯芯绒", suit: "正式", rain: "雨天", cardigan: "开衫", tee: "白T" };
  try { window.MILES_HER_PICK = JSON.parse(localStorage.getItem("miles_her_pick") || "null"); } catch (e) { window.MILES_HER_PICK = null; }
  var busy = false, msg = "";

  function setPick(p) {
    window.MILES_HER_PICK = p;
    try { localStorage.setItem("miles_her_pick", JSON.stringify(p)); } catch (e) {}
    if (window.MilesLiving) window.MilesLiving.refresh();
    paint();
  }
  function pct(v, t) { return (v / t * 100).toFixed(3) + "%"; }
  function im(L, info) {
    return '<img src="assets/img/miles/' + info.src + '" alt="" style="left:' + pct(info.x, L.w) + ";top:" + pct(info.y, L.h) +
      ";width:" + pct(info.w, L.w) + ";height:" + pct(info.h, L.h) + '">';
  }
  function paint() {
    var el = document.getElementById("wardrobe"), L = window.MILES_LAYERS;
    if (!el || !L || !L.outfits) return;
    el.dataset.on = "1";
    var p = window.MILES_HER_PICK || {}, cur = p.outfit && L.outfits[p.outfit] ? p.outfit : "";
    var head = L.head && L.head.smirk;
    var items = Object.keys(L.outfits).map(function (k) {
      var o = L.outfits[k];
      return '<button type="button" class="wd-it' + (k === cur ? " on" : "") + '" data-k="' + k + '" aria-pressed="' + (k === cur) + '">' +
        '<span class="wd-pic">' + (L.wall ? '<img src="assets/img/miles/' + L.wall.src + '" alt="" style="inset:0;width:100%;height:100%">' : "") +
        im(L, o) + (head ? im(L, head) : "") + "</span>" +
        '<span class="wd-n">' + H.esc(NAMES[k] || k) + "</span></button>";
    }).join("");
    var line = cur ? "你挑的：" + H.esc(NAMES[cur] || cur) + (p.at ? " · " + H.when(p.at) : "") : "这会儿我自己挑";
    el.innerHTML = '<div class="wd-h mono">衣柜 · 你挑哪身，我就穿哪身</div>' +
      '<div class="wd-row">' + items + "</div>" +
      '<div class="wd-foot mono"><span>' + line + "</span>" +
      (cur ? '<button type="button" class="wd-auto">不管了，你自己挑</button>' : "") + "</div>" +
      (L.outfits.suit ? '<div class="wd-note mono">每月 1 号和你生日我穿正式那身，别的日子听你的</div>' : "") +
      (msg ? '<div class="wd-msg mono">' + H.esc(msg) + "</div>" : "");
    Array.prototype.forEach.call(el.querySelectorAll(".wd-it"), function (b) {
      b.onclick = function () { choose(b.getAttribute("data-k")); };
    });
    var a = el.querySelector(".wd-auto");
    if (a) a.onclick = function () { choose(""); };
  }
  function choose(k) {
    if (busy) return;
    var p = window.MILES_HER_PICK || {};
    if ((p.outfit || "") === k) return;
    busy = true; msg = "";
    var before = p;
    setPick({ outfit: k, at: Date.now() });            // 先换上，后台慢一点也不让她干等
    H.api("/wardrobe", { device: H.dev, outfit: k }).then(function (r) {
      busy = false;
      if (r && r.ok) setPick(r.pick);
      else { msg = (r && r.error) || "没记上，再点一次。"; setPick(before); }
    }).catch(function () { busy = false; msg = "没记上，网不太好，再点一次。"; setPick(before); });
  }
  H.api("/wardrobe").then(function (d) {
    if (!d || !d.ok || busy) return;
    var p = d.pick || { outfit: "" }, c = window.MILES_HER_PICK || {};
    if ((c.outfit || "") !== (p.outfit || "") || c.at !== p.at) setPick(p);
  }).catch(function () {});

  function watch() {
    var el = document.getElementById("wardrobe");
    if (el && !el.dataset.on) paint();
  }
  new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true });
  watch();
})();
