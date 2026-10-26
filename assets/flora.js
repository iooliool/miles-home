/* Miles 的小屋 · 窗台上的花盆和花，全是现画的 SVG，银白线条，花瓣里只浮一层很淡的色。
   花长什么样只看后台给的参数：p 瓣数、r 大小、t 形状、tone 底色、eye 花心有没有一圈黑。 */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  function petalPath(t, len, wid) {
    var L = len, W = wid;
    switch (t) {
      case "thin": return "M0 0 C" + (W * .45) + " " + (-L * .3) + " " + (W * .35) + " " + (-L * .9) + " 0 " + (-L) + " C" + (-W * .35) + " " + (-L * .9) + " " + (-W * .45) + " " + (-L * .3) + " 0 0Z";
      case "notch": return "M0 0 C" + W + " " + (-L * .3) + " " + W + " " + (-L * .95) + " " + (W * .35) + " " + (-L) + " L0 " + (-L * .86) + " L" + (-W * .35) + " " + (-L) + " C" + (-W) + " " + (-L * .95) + " " + (-W) + " " + (-L * .3) + " 0 0Z";
      case "frill": return "M0 0 C" + W + " " + (-L * .4) + " " + (W * 1.1) + " " + (-L * .8) + " " + (W * .5) + " " + (-L * .95) + " Q" + (W * .25) + " " + (-L * 1.08) + " 0 " + (-L * .95) + " Q" + (-W * .25) + " " + (-L * 1.08) + " " + (-W * .5) + " " + (-L * .95) + " C" + (-W * 1.1) + " " + (-L * .8) + " " + (-W) + " " + (-L * .4) + " 0 0Z";
      case "star": return "M0 0 L" + (W * .45) + " " + (-L * .45) + " L0 " + (-L) + " L" + (-W * .45) + " " + (-L * .45) + "Z";
      case "spur": return "M0 0 C" + (W * 1.1) + " " + (-L * .2) + " " + (W * .8) + " " + (-L * .8) + " 0 " + (-L * 1.15) + " C" + (-W * .8) + " " + (-L * .8) + " " + (-W * 1.1) + " " + (-L * .2) + " 0 0Z";
      case "iris": return "M0 0 C" + (W * 1.3) + " " + (-L * .2) + " " + (W * 1.2) + " " + (-L * 1) + " 0 " + (-L * 1.1) + " C" + (-W * 1.2) + " " + (-L * 1) + " " + (-W * 1.3) + " " + (-L * .2) + " 0 0Z";
      default: return "M0 0 C" + (W * 1.05) + " " + (-L * .25) + " " + (W * .9) + " " + (-L * .95) + " 0 " + (-L) + " C" + (-W * .9) + " " + (-L * .95) + " " + (-W * 1.05) + " " + (-L * .25) + " 0 0Z";
    }
  }
  // 一朵花，花心在 (cx, cy)
  function flowerHead(f, cx, cy, s) {
    s = s || 1;
    var p = Math.max(3, f.p || 5), R = 19 * (f.r || 1) * s, tone = f.tone || "#eee";
    var wid = f.t === "thin" ? R * Math.min(.5, 3.2 / p) : f.t === "star" ? R * .55 : R * Math.min(.9, 4.2 / p);
    var g = "<g transform='translate(" + cx + " " + cy + ")'>";
    if (f.t === "bell") {
      // 低头的铃：三两个小铃铛垂着
      for (var b = 0; b < 3; b++) {
        var bx = (b - 1) * R * .7, by = Math.abs(b - 1) * R * .25;
        g += "<path d='M" + bx + " " + (by - R * .5) + " q" + (R * .42) + " 0 " + (R * .42) + " " + (R * .62) + " l" + (-R * .14) + " " + (-R * .1) + " l" + (-R * .14) + " " + (R * .1) + " l" + (-R * .14) + " " + (-R * .1) + " l" + (-R * .14) + " " + (R * .1) + " l" + (-R * .14) + " " + (-R * .1) + " q0 " + (-R * .62) + " " + (R * .42) + " " + (-R * .62) + "Z' transform='translate(" + (-R * .21) + " 0)' fill='" + tone + "' fill-opacity='.28' stroke='#fff' stroke-width='1' stroke-opacity='.85'/>";
      }
      return g + "</g>";
    }
    for (var i = 0; i < p; i++) {
      var a = 360 / p * i + (f.t === "iris" ? 0 : 8);
      g += "<path d='" + petalPath(f.t, R, wid) + "' transform='rotate(" + a + ")' fill='" + tone + "' fill-opacity='.26' stroke='#fff' stroke-width='" + (p > 12 ? .7 : 1) + "' stroke-opacity='.85'/>";
    }
    g += "<circle r='" + (R * (f.t === "thin" ? .3 : .22)) + "' fill='" + (f.eye ? "#111" : "#fff") + "' fill-opacity='" + (f.eye ? .9 : .55) + "' stroke='#fff' stroke-width='1'/>";
    if (f.eye) g += "<circle r='" + (R * .08) + "' fill='#fff' fill-opacity='.7'/>";
    return g + "</g>";
  }
  var POT = "<path d='M28 92 L34 128 Q35 132 40 132 L80 132 Q85 132 86 128 L92 92Z' fill='rgba(255,255,255,.06)' stroke='#fff' stroke-opacity='.7' stroke-width='1.2'/>" +
    "<rect x='24' y='86' width='72' height='8' rx='2' fill='rgba(255,255,255,.1)' stroke='#fff' stroke-opacity='.7' stroke-width='1.2'/>";
  var SOIL = "<path d='M30 92 Q60 86 90 92' fill='none' stroke='#fff' stroke-opacity='.35' stroke-width='1'/>";
  // stage: empty | 0 刚种 | 1 出芽 | 2 长苞 | bloom
  function pot(stage, f, thirsty) {
    var s = "<svg xmlns='" + NS + "' viewBox='0 0 120 140' class='potsvg' aria-hidden='true'>";
    var droop = thirsty ? 1 : 0;
    if (stage === 0) s += "<ellipse cx='60' cy='88' rx='5' ry='3' fill='#fff' fill-opacity='.7'/><path d='M60 86 q1 -5 3 -6' stroke='#fff' stroke-width='1.2' fill='none' stroke-opacity='.8'/>";
    if (stage === 1) s += "<path d='M60 90 Q60 74 " + (60 + droop * 4) + " " + (66 + droop * 4) + "' stroke='#fff' stroke-width='1.4' fill='none'/>" +
      "<path d='M60 72 q-12 -8 -16 2 q10 4 16 -2Z M60 72 q12 -10 17 0 q-10 5 -17 0Z' fill='rgba(255,255,255,.18)' stroke='#fff' stroke-width='1' transform='rotate(" + droop * 12 + " 60 72)'/>";
    if (stage === 2) s += "<path d='M60 90 Q58 62 " + (61 + droop * 6) + " " + (44 + droop * 6) + "' stroke='#fff' stroke-width='1.4' fill='none'/>" +
      "<path d='M59 70 q-16 -6 -20 4 q12 4 20 -4Z M60 60 q15 -8 19 2 q-11 5 -19 -2Z' fill='rgba(255,255,255,.18)' stroke='#fff' stroke-width='1'/>" +
      "<path d='M" + (61 + droop * 6) + " " + (44 + droop * 6) + " q-6 -8 0 -16 q6 8 0 16Z' fill='rgba(255,255,255,.3)' stroke='#fff' stroke-width='1'/>";
    if (stage === "bloom" && f) {
      var tall = f.r > 1.2 ? 22 : 34;
      s += "<path d='M60 90 Q57 " + (tall + 30) + " 60 " + (tall + 8) + "' stroke='#fff' stroke-width='1.4' fill='none'/>" +
        "<path d='M59 74 q-17 -5 -21 5 q12 3 21 -5Z M60 64 q16 -7 20 3 q-12 4 -20 -3Z' fill='rgba(255,255,255,.18)' stroke='#fff' stroke-width='1'/>" +
        flowerHead(f, 60, tall + 6, 1);
    }
    return s + POT + SOIL + "</svg>";
  }
  function badge(f, size) {
    size = size || 64;
    return "<svg xmlns='" + NS + "' viewBox='0 0 64 64' width='" + size + "' height='" + size + "' aria-hidden='true'>" + flowerHead(f, 32, 32, .95) + "</svg>";
  }
  window.MilesFlora = { pot: pot, badge: badge };
})();
