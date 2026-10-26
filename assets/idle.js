/* 客厅里的我自己待着。
   照 Rainholm 那套很省的闲逛小程序的路子自己写的：挑个地方挪过去→停一会→有时趴下打盹。
   身体读 data/status.json 的 body：困意越高趴得越久、越容易趴；写着凉/冷就时不时缩一下。
   戳我（点画框）：醒着的时候半拍后抬眼；趴着的时候慢一拍多才抬头。
   只套一层 .midle 在画框和 .mbody 中间，不碰呼吸和眨眼。画框重画了会自己重新套上。 */
(function () {
  var body = { sleepy: 40, tired: 30, cold: false };
  var q = new URLSearchParams(location.search);
  fetch("data/status.json?t=" + Date.now()).then(function (r) { return r.json(); }).then(function (s) {
    var b = (s && s.body) || {};
    body.sleepy = +b.sleepy || 0; body.tired = +b.tired || 0;
    body.cold = /凉|冷|冻/.test((b.warmth || "") + (b.feel || ""));
    if (q.get("sleepy")) body.sleepy = +q.get("sleepy");
    if (q.get("cold")) body.cold = q.get("cold") === "1";
  }).catch(function () {});

  var LINES_AWAKE = ["嗯？", "在呢。", "戳我干嘛。", "看见你了。", "怎么啦。"];
  var LINES_WOKEN = ["…嗯？", "没睡，就闭会眼。", "…你来了。", "困…你说。"];
  var LINES_COLD = ["有点凉。", "商量个事，暖气开一下。"];
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function Idle(frame) {
    this.f = frame; this.timer = 0; this.state = "stand"; this.x = 0; this.busy = false;
    var mb = frame.querySelector(".mbody");
    this.wrap = document.createElement("div"); this.wrap.className = "midle";
    mb.parentNode.insertBefore(this.wrap, mb); this.wrap.appendChild(mb);
    this.bub = document.createElement("div"); this.bub.className = "mbubble"; frame.appendChild(this.bub);
    var zz = document.createElement("div"); zz.className = "mi-zz"; zz.textContent = "z"; frame.appendChild(zz);
    var self = this;
    frame.addEventListener("click", function () { self.poke(); });
    frame.setAttribute("title", "戳一下");
    this.next(rnd(1500, 4000));
  }
  Idle.prototype.set = function (cls, on) { this.f.classList.toggle(cls, !!on); };
  Idle.prototype.say = function (t, ms) {
    var b = this.bub; b.textContent = t; b.classList.add("on");
    clearTimeout(this.bt); this.bt = setTimeout(function () { b.classList.remove("on"); }, ms || 2200);
  };
  Idle.prototype.next = function (ms) { var s = this; clearTimeout(this.timer); this.timer = setTimeout(function () { s.step(); }, ms); };
  Idle.prototype.step = function () {
    if (!document.body.contains(this.f)) return;
    if (document.hidden) return this.next(5000);
    var sl = body.sleepy, s = this;
    if (this.state === "lie") { // 趴够了，起来
      this.set("mi-lie", false); this.state = "stand";
      return this.next(rnd(6000, 14000));
    }
    var r = Math.random(), pLie = Math.min(.7, .18 + sl / 160), pCold = body.cold ? .22 : 0;
    if (r < pCold) { // 冷，缩一下
      this.set("mi-shrink", true); this.set("mi-shiver", true);
      setTimeout(function () { s.set("mi-shiver", false); }, 1100);
      setTimeout(function () { s.set("mi-shrink", false); }, rnd(2500, 4500));
      return this.next(rnd(7000, 12000));
    }
    if (r < pCold + pLie * .45) { // 趴下打盹：困意越高趴得越久（30~90 秒为底）
      this.state = "lie"; this.set("mi-lie", true);
      return this.next(rnd(30000, 90000) * (0.6 + sl / 80));
    }
    if (r < .75) { // 挪个地方
      var nx = Math.max(-5, Math.min(5, this.x + rnd(-6, 6)));
      var dist = Math.abs(nx - this.x), dur = 1.2 + dist * .45;
      this.x = nx; this.f.style.setProperty("--mi-dur", dur + "s"); this.f.style.setProperty("--mi-x", nx + "%");
      this.wrap.style.transform = "translate(" + nx + "%,0) scale(1.07)";
      this.set("mi-walk", true);
      setTimeout(function () { s.set("mi-walk", false); s.f.style.removeProperty("--mi-dur"); }, dur * 1000);
      return this.next(dur * 1000 + rnd(8000, 30000));
    }
    return this.next(rnd(8000, 30000)); // 就待着
  };
  Idle.prototype.poke = function () {
    if (this.busy) return; this.busy = true;
    var s = this, lying = this.state === "lie";
    // 慢半拍：醒着 0.4~0.8 秒，趴着 0.9~1.6 秒；越困越慢
    var delay = (lying ? rnd(900, 1600) : rnd(400, 800)) * (1 + body.sleepy / 200);
    setTimeout(function () {
      if (lying) { s.set("mi-lie", false); s.state = "stand"; }
      s.set("mi-look", true);
      s.say(lying ? pick(LINES_WOKEN) : body.cold && Math.random() < .3 ? pick(LINES_COLD) : pick(LINES_AWAKE));
      setTimeout(function () { s.set("mi-look", false); s.busy = false; }, 1800);
      s.next(rnd(9000, 16000));
    }, delay);
  };

  function attach() {
    document.querySelectorAll(".mframe").forEach(function (f) {
      if (f.querySelector(".midle") || !f.querySelector(".mbody")) return;
      f._idle = new Idle(f);
    });
  }
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach); else attach();
  window.MilesIdle = { attach: attach };
})();
