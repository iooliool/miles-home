/* Miles 的小屋 · 天色（昼夜 + 雪）
   用的是打开页面那台手机/电脑自己的钟，所以她那边几点就是几点，不用我给地址。
   雪：她那边天气写着「雪」就下得密一点；12、1、2 月平时也飘几片；网址后面加 ?snow=1 可以先看看。
   天气从 data/status.json 的 body.sky 读（每晚更新小屋时取的），只有「晴/雨/雪」这种字，不带地方。 */
(function () {
  var root = document.documentElement;
  var q = new URLSearchParams(location.search);

  function tod(d) {
    var force = q.get("tod");
    if (force) return force;
    var h = d.getHours() + d.getMinutes() / 60;
    if (h >= 5 && h < 7) return "dawn";
    if (h >= 7 && h < 17.5) return "day";
    if (h >= 17.5 && h < 19) return "dusk";
    return "night";
  }
  function apply() { root.setAttribute("data-tod", tod(new Date())); }
  apply();
  setTimeout(function () { root.classList.add("tod-anim"); }, 800);
  setInterval(apply, 60000);
  window.MilesAmbient = { tod: function () { return tod(new Date()); } };

  // ---- 雪 ----
  function snowLevel(sky) {
    if (q.get("snow") === "0") return 0;
    if (q.get("snow")) return Math.max(1, Math.min(3, +q.get("snow") || 1));
    if (/雪/.test(sky || "")) return /大|暴/.test(sky) ? 3 : 2;
    var m = new Date().getMonth();
    return (m === 11 || m <= 1) ? 1 : 0;
  }
  function startSnow(level) {
    var sky = document.querySelector(".sky");
    if (!sky || !level || sky.querySelector("canvas.snow")) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv = document.createElement("canvas"); cv.className = "snow"; sky.appendChild(cv);
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), flakes = [];
    function size() { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); addEventListener("resize", size);
    var n = Math.round((W * H) / 26000 * [0, 0.6, 1.4, 2.6][level]);
    function flake(top) { return { x: Math.random() * W, y: top ? -10 : Math.random() * H, r: 0.6 + Math.random() * (level > 1 ? 2.2 : 1.6),
      vy: 0.25 + Math.random() * 0.6, sway: Math.random() * Math.PI * 2, sw: 0.004 + Math.random() * 0.01, a: 0.35 + Math.random() * 0.5 }; }
    for (var i = 0; i < n; i++) flakes.push(flake(false));
    var last = performance.now(), hidden = false;
    document.addEventListener("visibilitychange", function () { hidden = document.hidden; last = performance.now(); if (!hidden) requestAnimationFrame(tick); });
    function tick(t) {
      if (hidden) return;
      var dt = Math.min(50, t - last) / 16.7; last = t;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.sway += f.sw * dt; f.y += f.vy * dt * (0.6 + f.r * 0.25); f.x += Math.sin(f.sway) * 0.35 * dt;
        if (f.y > H + 6) flakes[i] = flake(true);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255," + f.a + ")"; ctx.shadowColor = "rgba(255,255,255,.6)"; ctx.shadowBlur = f.r * 2; ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    window.MilesAmbient.snow = level;
  }
  function go() {
    fetch("data/status.json?t=" + Date.now()).then(function (r) { return r.json(); })
      .then(function (s) { startSnow(snowLevel(s && s.body && s.body.sky)); })
      .catch(function () { startSnow(snowLevel("")); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
