/* Miles 的身体：客厅那张 C 形象本身，放在网格上变形。
 * 不重画脸：眨眼用客厅已有的闭眼帧，犯困用客厅已有的犯困帧，其余都是原图像素挪位。
 * 参数管线（顺序很重要）：空闲/跟鼠标 -> 动作编排 -> 情绪表情 -> 触摸反应 -> 眨眼(乘在最后) -> 口型(取大) -> 弹簧 -> 写网格
 * 页面上暴露 window.MilesBody：speak / emotion / expression / choreograph / screenshot / report
 */
(function () {
  "use strict";
  var Q = new URLSearchParams(location.search);
  var LOCAL = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname);
  var DRY = Q.has("dry") || LOCAL;          // 本地试跑不往她的窗台真写
  var DEBUG = Q.has("debug");
  var API = "https://miles-home-api.xo131415.workers.dev";
  var BASE = "assets/body/";
  var IMG = "assets/img/miles/";
  var OUTFITS = { jacket: 1, coat: 1, tee: 1, home: 1, rain: 1, cardigan: 1, cord: 1, suit: 1 };

  var stage = document.getElementById("stage");
  var bubble = document.getElementById("bubble");
  var logEl = document.getElementById("log");
  var report = { ok: false, items: [] };
  function note(ok, msg) { report.items.push((ok ? "✓ " : "✗ ") + msg); if (DEBUG && logEl) logEl.textContent = report.items.join("\n"); if (!ok) console.warn("[body]", msg); }

  // ---------- 小工具 ----------
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function b64(s, T) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); }
  function approach(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  function Spring(k, z) { this.x = 0; this.v = 0; this.k = k; this.z = z; }
  Spring.prototype.step = function (target, dt) {
    var c = 2 * Math.sqrt(this.k) * this.z;
    this.v += (this.k * (target - this.x) - c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  };

  // ---------- 状态 ----------
  var NAMES = ["yaw", "pitch", "roll", "bodyX", "gazeX", "gazeY", "eyeOpen", "sleepyFace", "browUp", "browInner", "smile", "jaw", "blush"];
  function zero() { var o = {}; NAMES.forEach(function (n) { o[n] = 0; }); o.eyeOpen = 1; return o; }
  // 七个情绪（跟 starter 同一套词），写成“偏移量”，按强度叠在基础上
  var EMO = {
    neutral: {},
    happy: { smile: 0.8, browUp: 0.35 },
    love: { smile: 0.55, blush: 0.5, browUp: 0.15, roll: 0.25 },
    shy: { blush: 1, smile: 0.3, browInner: 0.35, gazeX: -0.7, gazeY: 0.55, pitch: 0.35 },
    sad: { browInner: 1, smile: -0.6, pitch: 0.3, gazeY: 0.4 },
    angry: { browInner: -1, browUp: -0.5, smile: -0.45 },
    gloomy: { sleepyFace: 0.3, browUp: -0.3, smile: -0.25, gazeY: 0.35 }
  };
  var mood = { emo: "neutral", strength: 0, sleepy: 0.3, real: 0.3, base: {} };
  var ex = zero(); ex.eyeOpen = 0;                 // 当前情绪偏移（平滑过的）
  var temp = null;                                  // 临时情绪（触摸、说话里的标记）
  var manual = null;                                // expression() 手动参数
  var sp = { yaw: new Spring(55, 0.78), pitch: new Spring(55, 0.8), roll: new Spring(40, 0.85), bodyX: new Spring(18, 0.9), gazeX: new Spring(380, 0.95), gazeY: new Spring(380, 0.95) };
  var pointer = { x: 0, y: 0, last: -1e9, down: false };
  var idle = { next: 0, yaw: 0, pitch: 0, gx: 0, gy: 0 };
  var doze = { phase: "awake", t: 0, next: rnd(18, 35), amt: 0 };
  var blink = { next: rnd(1.5, 4), t: -1, dur: 0.27, v: 0, double: false };
  var breath = { ph: 0 };
  var talk = { fake: 0, until: 0 };
  var lip = { level: 0, analyser: null, buf: null, playing: false };
  var chor = [];                                    // 动作编排轨道 {t0, keys:[[t, {yaw..}]]}
  var react = { until: 0, wakeAt: 0 };
  var now = 0;

  // ---------- 载入 ----------
  var app, rig, nv, na, base, pos, posView, wHead, nNear, wBreath, fields = [], meshes = {}, mouthG, pv;
  function fetchJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }

  function start(outfit) {
    if (!window.PIXI) { note(false, "PixiJS 没载入"); return; }
    app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2.5), autoDensity: true, preserveDrawingBuffer: true, width: 10, height: 10 });
    stage.appendChild(app.view);
    note(true, "WebGL " + (app.renderer.context && app.renderer.context.webGLVersion ? app.renderer.context.webGLVersion : "?"));
    var pre = outfit;
    return fetchJSON(BASE + "rig_" + pre + ".json").then(function (r) {
      rig = r; note(true, "骨架 rig_" + pre + "：" + r.cols + "×" + r.rows + " 个点，" + Object.keys(r.fields).length + " 组局部变形");
      return PIXI.Assets.load([IMG + pre + "-smirk.jpg", BASE + pre + "-sleepy.png", BASE + pre + "-blink.png", BASE + pre + "-sleepy-blink.png", BASE + "blush.png"]);
    }).then(function (tex) {
      build(tex, pre);
      note(true, "贴图 5 张（原图、犯困、闭眼×2、脸红）");
      report.ok = true;
      app.ticker.add(tick);
      layout();
      window.addEventListener("resize", layout);
      document.body.classList.add("ready");
    }).catch(function (e) { note(false, "载入失败：" + e.message); });
  }

  function build(tex, pre) {
    var cols = rig.cols, rows = rig.rows;
    nv = cols * rows; na = rig.anchors.length;
    base = new Float32Array((nv + na) * 2);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var i = r * cols + c; base[i * 2] = rig.gx[c]; base[i * 2 + 1] = rig.gy[r]; }
    for (var a = 0; a < na; a++) { base[(nv + a) * 2] = rig.anchors[a][0]; base[(nv + a) * 2 + 1] = rig.anchors[a][1]; }
    pos = new Float32Array(base);
    posView = pos.subarray(0, nv * 2);
    var uv = new Float32Array(nv * 2);
    for (var k = 0; k < nv; k++) { uv[k * 2] = base[k * 2] / rig.w; uv[k * 2 + 1] = base[k * 2 + 1] / rig.h; }
    wHead = b64(rig.wHead, Uint8Array); nNear = b64(rig.nNear, Int8Array); wBreath = b64(rig.wBreath, Uint8Array);
    Object.keys(rig.fields).forEach(function (name) {
      var f = rig.fields[name];
      fields.push({ name: name, i: b64(f.i, Uint16Array), dx: b64(f.dx, Int16Array), dy: b64(f.dy, Int16Array) });
    });
    var posBuf = new PIXI.Buffer(posView, false, false);
    var geom = new PIXI.Geometry().addAttribute("aVertexPosition", posBuf, 2).addAttribute("aTextureCoord", uv, 2).addIndex(b64(rig.tri, Uint16Array));
    geom.__pos = posBuf;
    pv = new PIXI.Container();
    app.stage.addChild(pv);
    function mk(t) { var m = new PIXI.Mesh(geom, new PIXI.MeshMaterial(t)); pv.addChild(m); return m; }
    meshes.main = mk(tex[IMG + pre + "-smirk.jpg"]);
    meshes.sleepy = mk(tex[BASE + pre + "-sleepy.png"]);
    mouthG = new PIXI.Graphics(); pv.addChild(mouthG);
    meshes.blink = mk(tex[BASE + pre + "-blink.png"]);
    meshes.sleepyBlink = mk(tex[BASE + pre + "-sleepy-blink.png"]);
    meshes.blush = mk(tex[BASE + "blush.png"]);
    meshes.geom = geom;
    note(true, "分层：原图 / 犯困脸 / 嘴里 / 闭眼 / 犯困闭眼 / 脸红，共用一张网格");
  }

  function layout() {
    var w = stage.clientWidth, h = Math.round(w * rig.h / rig.w);
    stage.style.height = h + "px";
    app.renderer.resize(w, h);
    pv.scale.set(w / rig.w);
  }

  // ---------- 写网格 ----------
  function deform(p) {
    var K = rig.k, th = p.roll * K.rollDeg * Math.PI / 180, px = rig.pivot[0], py = rig.pivot[1];
    var yawK = K.yaw * p.yaw, pitK = K.pitch * p.pitch, br = K.breath * p.breath, bx = 4 * p.bodyX;
    var N = nv + na;
    for (var i = 0; i < N; i++) {
      var x = base[i * 2], y = base[i * 2 + 1];
      var wh = wHead[i] / 255, nn = nNear[i] / 127, wb = wBreath[i] / 255;
      pos[i * 2] = x + wh * (yawK * nn - (y - py) * th) + wb * bx;
      pos[i * 2 + 1] = y + wh * (pitK * nn + (x - px) * th) - wb * br;
    }
    var w = { lidL: p.lid, lidR: p.lid, gazeX: p.gazeX, gazeY: p.gazeY, browUp: p.browUp, browInner: p.browInner, jaw: p.jaw, smile: p.smile };
    for (var f = 0; f < fields.length; f++) {
      var F = fields[f], s = w[F.name] || 0;
      if (Math.abs(s) < 1e-3) continue;
      s /= 64;
      var I = F.i, DX = F.dx, DY = F.dy;
      for (var j = 0; j < I.length; j++) { var q = I[j] * 2; pos[q] += DX[j] * s; pos[q + 1] += DY[j] * s; }
    }
    meshes.geom.__pos.update();
  }

  function drawMouth(p) {
    mouthG.clear();
    if (p.jaw < 0.03) return;
    var n = rig.nSeam, up = [], lo = [];
    for (var i = 0; i < n; i++) {
      var u = (nv + i) * 2, d = (nv + n + i) * 2;
      var ux = pos[u], uy = pos[u + 1];
      // 下沿 = 唇缝 + 下唇那个锚点自己的位移和唇缝位移之差（即张开了多少）
      var ddx = (pos[d] - base[d]) - (ux - base[u]), ddy = (pos[d + 1] - base[d + 1]) - (uy - base[u + 1]);
      var t = i / (n - 1), taper = Math.pow(Math.sin(Math.PI * t), 0.8);
      up.push(ux, uy + 0.6 * taper);
      lo.push(ux + ddx * 0.85, uy + ddy * 0.85 * taper);
    }
    var pts = up.slice();
    for (var k = n - 1; k >= 0; k--) pts.push(lo[k * 2], lo[k * 2 + 1]);
    mouthG.beginFill(PIXI.utils.string2hex(rig.mouthColor), 0.93);
    mouthG.drawPolygon(pts);
    mouthG.endFill();
  }

  // ---------- 每帧 ----------
  function tick() {
    var dt = clamp(app.ticker.deltaMS / 1000, 0, 1 / 30);   // dt 钳制：切后台回来不飞
    now += dt;
    var t = zero();

    // 1) 看哪儿：鼠标/手指在动就跟着看，否则自己东张西望
    var follow = now - pointer.last < 3.5;
    if (follow) {
      t.yaw = pointer.x * 0.85; t.pitch = pointer.y * 0.6;
      t.gazeX = clamp(pointer.x * 1.2, -1, 1); t.gazeY = clamp(pointer.y * 1.0, -1, 1);
    } else {
      if (now > idle.next) {
        var center = Math.random() < 0.35;
        idle.yaw = center ? rnd(-0.1, 0.1) : rnd(-0.6, 0.6);
        idle.pitch = center ? rnd(-0.05, 0.1) : rnd(-0.25, 0.4);
        idle.gx = clamp(idle.yaw * 1.5 + rnd(-0.2, 0.2), -1, 1); idle.gy = clamp(idle.pitch * 1.2, -1, 1);
        idle.next = now + rnd(1.8, 5.5) * (1 + mood.sleepy);
      }
      t.yaw = idle.yaw; t.pitch = idle.pitch; t.gazeX = idle.gx; t.gazeY = idle.gy;
    }
    // 细微的自己晃
    t.yaw += 0.05 * Math.sin(now * 0.37) + 0.03 * Math.sin(now * 0.91);
    t.pitch += 0.04 * Math.sin(now * 0.29 + 1.3);
    t.roll += 0.12 * Math.sin(now * 0.21 + 0.4);
    t.bodyX = 0.35 * Math.sin(now * 0.17);

    // 犯困打盹：困得厉害时隔一阵点一下头、闭一会儿眼，再一激灵醒过来
    if (mood.sleepy > 0.6 && !follow && doze.phase === "awake" && now > doze.next) { doze.phase = "down"; doze.t = now; doze.hold = isNight() ? rnd(40, 90) : rnd(2, 5); }
    if (doze.phase === "down") { doze.amt = approach(doze.amt, 1, 0.9, dt); if (now - doze.t > 2.2 + doze.hold) wake(false); }
    else doze.amt = approach(doze.amt, 0, 6, dt);
    t.pitch += 0.85 * doze.amt; t.roll += 0.45 * doze.amt; t.gazeY += 0.6 * doze.amt;

    // 2) 动作编排（点头、摇头、歪头）叠在头的目标上，弹簧会把它们磨圆
    for (var c = chor.length - 1; c >= 0; c--) {
      var tr = chor[c], el = now - tr.t0, keys = tr.keys, lastK = keys[keys.length - 1][0];
      if (el > lastK) { chor.splice(c, 1); continue; }
      for (var k = 0; k < keys.length - 1; k++) {
        if (el >= keys[k][0] && el <= keys[k + 1][0]) {
          var u = (el - keys[k][0]) / (keys[k + 1][0] - keys[k][0]);
          for (var nm in keys[k][1]) t[nm] += keys[k][1][nm] + ((keys[k + 1][1][nm] || 0) - keys[k][1][nm]) * u;
          break;
        }
      }
    }

    // 3) 情绪：心情（每晚更新）为底，临时情绪盖在上面，平滑过渡
    var tgt = zero(); tgt.eyeOpen = 0;
    function add(src, s) { for (var n in src) tgt[n] += src[n] * s; }
    add(mood.base, 1);
    if (temp && now < temp.until) { add(EMO[temp.emo] || {}, temp.s); add(EMO[mood.emo] || {}, mood.strength * 0.3); }
    else { temp = null; add(EMO[mood.emo] || {}, mood.strength); }
    if (manual) add(manual, 1);
    for (var n2 in ex) ex[n2] = approach(ex[n2], tgt[n2], 5, dt);
    for (var n3 in ex) { if (n3 !== "eyeOpen") t[n3] += ex[n3]; }
    var sleepyFace = clamp((mood.sleepy - 0.55) / 0.35, 0, 1) * 0.9 + ex.sleepyFace;
    var eyeBase = clamp(1 + ex.eyeOpen, 0.2, 1);

    // 4) 触摸反应已经在 temp / chor 里

    // 5) 弹簧：头和眼珠
    var P = {};
    P.yaw = sp.yaw.step(clamp(t.yaw, -1.1, 1.1), dt);
    P.pitch = sp.pitch.step(clamp(t.pitch, -1, 1.1), dt);
    P.roll = sp.roll.step(clamp(t.roll, -1.1, 1.1), dt);
    P.bodyX = sp.bodyX.step(t.bodyX, dt);
    P.gazeX = sp.gazeX.step(clamp(t.gazeX, -1, 1), dt);
    P.gazeY = sp.gazeY.step(clamp(t.gazeY, -1, 1), dt);
    P.browUp = clamp(t.browUp, -1, 1); P.browInner = clamp(t.browInner, -1, 1);
    P.smile = clamp(t.smile, -1, 1); P.blush = clamp(t.blush, 0, 1);

    // 6) 眨眼：乘在表情的睁眼程度上（不覆盖表情）
    if (blink.t < 0 && now > blink.next && doze.amt < 0.5) { blink.t = now; blink.dur = mood.sleepy > 0.6 ? 0.42 : 0.27; }
    if (blink.t >= 0) {
      var e = (now - blink.t) / blink.dur, cl = 0.26, hold = 0.42;
      blink.v = e < cl ? smooth(0, 1, e / cl) : e < hold ? 1 : e < 1 ? 1 - smooth(0, 1, (e - hold) / (1 - hold)) : 0;
      if (e >= 1) {
        blink.t = -1; blink.v = 0;
        if (!blink.double && Math.random() < 0.15) { blink.double = true; blink.next = now + 0.12; }
        else { blink.double = false; blink.next = now + rnd(2.2, 6) * (mood.sleepy > 0.6 ? 0.8 : 1); }
      }
    }
    var open = eyeBase * (1 - blink.v) * (1 - 0.92 * doze.amt);
    if (react.until > now && react.eyes != null) open = Math.min(open, react.eyes);

    // 7) 口型：音频音量或打字时的假口型，取大
    var lipv = 0;
    if (lip.playing && lip.analyser) {
      lip.analyser.getFloatTimeDomainData(lip.buf);
      var sum = 0; for (var b = 0; b < lip.buf.length; b++) sum += lip.buf[b] * lip.buf[b];
      var rms = Math.sqrt(sum / lip.buf.length);
      var targ = clamp((rms - 0.015) * 9, 0, 1);
      lip.level = approach(lip.level, targ, targ > lip.level ? 30 : 12, dt);
      lipv = lip.level;
    } else if (now < talk.until) {
      lipv = talk.fake * (0.35 + 0.65 * Math.abs(Math.sin(now * 21)));
    } else lip.level = approach(lip.level, 0, 12, dt);
    P.jaw = clamp(Math.max(t.jaw, lipv), 0, 1);

    // 呼吸
    breath.ph += dt * 2 * Math.PI / (doze.amt > 0.3 ? 5.6 : mood.sleepy > 0.6 ? 4.8 : 4.1);
    P.breath = 0.5 - 0.5 * Math.cos(breath.ph);

    if (force) { for (var fk in force) P[fk] = force[fk]; if (force.open != null) open = force.open; if (force.sleepyFace != null) sleepyFace = force.sleepyFace; }
    // 眼睛分层：睁开一半以上靠把上眼皮往下压，快闭上时换客厅那张闭眼帧
    // 半睁眼不用网格压（会把眼珠压扁、两层眼睛叠出重影），只在三张对齐的画之间切：睁眼 / 犯困 / 闭眼
    var closed = smooth(0.55, 0.35, open);
    P.lid = 0;
    sfCur = approach(sfCur, sleepyFace >= 0.5 ? 1 : 0, 9, dt);
    var sf = sfCur;
    meshes.sleepy.alpha = sf;
    meshes.blink.alpha = closed * (1 - sf);
    meshes.sleepyBlink.alpha = closed * sf;
    meshes.blush.alpha = P.blush;
    meshes.blush.visible = P.blush > 0.01; meshes.sleepy.visible = sf > 0.01;
    meshes.blink.visible = meshes.blink.alpha > 0.01; meshes.sleepyBlink.visible = meshes.sleepyBlink.alpha > 0.01;

    deform(P);
    drawMouth(P);
    last = P; last.open = open; last.sleepyFace = sf;
    if (DEBUG && logEl && (now * 4 | 0) !== (tick.k || 0)) { tick.k = now * 4 | 0; logEl.textContent = report.items.join("\n") + "\n" + NAMES.concat(["lid", "open", "breath"]).map(function (n) { return n + "=" + (P[n] != null ? (+P[n]).toFixed(2) : (n === "open" ? open.toFixed(2) : "")); }).join("  "); }
  }
  var last = null, force = null, sfCur = 0;

  function wake(byTouch) {
    if (doze.phase !== "down") return;
    doze.phase = "awake"; doze.next = now + (isNight() ? rnd(5, 10) : rnd(25, 60));
    chor.push({ t0: now, keys: [[0, { pitch: -0.35 }], [0.25, { pitch: 0.1 }], [0.6, {}]] });
    blink.next = now + 0.15;
  }

  // ---------- 说话（带内联标记） ----------
  var GEST = {
    nod: [[0, { pitch: 0 }], [0.18, { pitch: 0.55 }], [0.38, { pitch: -0.05 }], [0.56, { pitch: 0.35 }], [0.8, {}]],
    shake: [[0, {}], [0.16, { yaw: -0.55 }], [0.36, { yaw: 0.5 }], [0.56, { yaw: -0.35 }], [0.76, { yaw: 0.15 }], [0.95, {}]],
    tilt: [[0, {}], [0.3, { roll: 0.9 }], [1.6, { roll: 0.9 }], [2.0, {}]],
    lookaway: [[0, {}], [0.2, { yaw: -0.6, gazeX: -1 }], [1.8, { yaw: -0.6, gazeX: -1 }], [2.2, {}]],
    blink: null, wake: null
  };
  function gesture(g) {
    if (g === "blink") { blink.next = now; return true; }
    if (g === "wake") { wake(true); return true; }
    if (!GEST[g]) return false;
    chor.push({ t0: now, keys: GEST[g] });
    return true;
  }
  var speakTimer = null;
  function speak(text, opts) {
    opts = opts || {};
    clearInterval(speakTimer);
    var parts = [], re = /<([a-z]+)>/g, m, lastI = 0, plain = "";
    while ((m = re.exec(text))) { plain += text.slice(lastI, m.index); parts.push({ at: plain.length, tag: m[1] }); lastI = re.lastIndex; }
    plain += text.slice(lastI);
    var i = 0, cps = 9;
    showBubble("");
    if (opts.audio) playAudio(opts.audio);
    function fire(at) { parts.forEach(function (p) { if (p.at === at) { if (EMO[p.tag]) setTemp(p.tag, 0.9, Math.max(3, plain.length / cps + 2)); else gesture(p.tag); } }); }
    fire(0);
    speakTimer = setInterval(function () {
      i++;
      fire(i);
      showBubble(plain.slice(0, i));
      var ch = plain.charAt(i - 1);
      if (!opts.audio) { talk.fake = /[，。！？…、,.!?\s]/.test(ch) ? 0.05 : 0.7; talk.until = now + 0.2; }
      if (i >= plain.length) { clearInterval(speakTimer); setTimeout(function () { hideBubble(); }, 2600 + plain.length * 60); }
    }, 1000 / cps);
    return plain;
  }
  var hideT = null;
  function showBubble(s) { clearTimeout(hideT); bubble.textContent = s; bubble.classList.toggle("on", !!s); }
  function hideBubble() { bubble.classList.remove("on"); }
  function setTemp(emo, s, sec) { temp = { emo: emo, s: s == null ? 1 : s, until: now + (sec || 3) }; }

  // ---------- 音频口型 ----------
  var actx = null, audioEl = null, srcNode = null;
  function playAudio(url) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (!audioEl) {
        audioEl = new Audio(); audioEl.crossOrigin = "anonymous"; audioEl.preload = "auto";
        srcNode = actx.createMediaElementSource(audioEl);
        lip.analyser = actx.createAnalyser(); lip.analyser.fftSize = 1024;
        lip.buf = new Float32Array(lip.analyser.fftSize);
        srcNode.connect(lip.analyser); lip.analyser.connect(actx.destination);
        audioEl.addEventListener("ended", function () { lip.playing = false; });
        audioEl.addEventListener("pause", function () { lip.playing = false; });
      }
      // 先把音频管线唤醒再放，免得开头一小段被吞掉、嘴对不上（网页版的“垫静音”）
      return actx.resume().then(function () {
        audioEl.src = url; audioEl.currentTime = 0;
        return new Promise(function (res) { setTimeout(res, 120); });
      }).then(function () { lip.playing = true; return audioEl.play(); }).catch(function (e) { lip.playing = false; note(false, "音频播不了：" + e.message); });
    } catch (e) { note(false, "音频初始化失败：" + e.message); }
  }
  function stopAudio() { if (audioEl) audioEl.pause(); }

  // ---------- 触摸 ----------
  var regionMap = null;
  function regionAt(ix, iy) {
    if (!regionMap) regionMap = b64(rig.regions.d, Uint8Array);
    var s = rig.regions.s, cx = clamp(ix / s | 0, 0, rig.regions.w - 1), cy = clamp(iy / s | 0, 0, rig.regions.h - 1);
    return ["bg", "head", "face", "body"][regionMap[cy * rig.regions.w + cx]] || "bg";
  }
  var LINES = {
    face: ["……干嘛。", "戳我脸做什么。", "别闹。", "嗯？"],
    head: ["嗯。", "……行吧。", "摸就摸吧。"],
    pat: ["……再摸一下也行。", "好了好了。", "头发乱了。"],
    body: ["嗯？", "怎么了。", "在呢。"],
    shake: ["……晕了。", "别晃了。", "我醒着呢。"],
    wake: ["……嗯？我没睡。", "嗯……你来了。"]
  };
  function pick(a) { return a[Math.random() * a.length | 0]; }
  var drag = null, lastLine = -10;
  function toImg(ev) {
    var r = stage.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * rig.w, y: (ev.clientY - r.top) / r.height * rig.h, nx: ((ev.clientX - r.left) / r.width - 0.45) * 2, ny: ((ev.clientY - r.top) / r.height - 0.4) * 2 };
  }
  function onMove(ev) {
    if (!rig) return;
    var p = toImg(ev);
    pointer.x = clamp(p.nx, -1, 1); pointer.y = clamp(p.ny, -1, 1); pointer.last = now;
    if (drag) {
      var dx = p.x - drag.x;
      drag.path += Math.hypot(dx, p.y - drag.y);
      // 晃：来回甩得够大（每一下超过 70 像素）、够快（1.2 秒内 4 次）；轻轻来回划是摸头
      if (dx * drag.dir < -2) { if (Math.abs(p.x - drag.fx) > 70) drag.flips.push(now); drag.fx = p.x; drag.dir = -drag.dir; }
      else if (Math.abs(dx) > 2 && !drag.dir) { drag.dir = Math.sign(dx); drag.fx = drag.x; }
      drag.flips = drag.flips.filter(function (t) { return now - t < 1.2; });
      drag.x = p.x; drag.y = p.y;
      if (drag.flips.length >= 4 && !drag.shook) { drag.shook = true; onShake(); }
      else if (drag.region === "head" && drag.path > 90 && !drag.patted) { drag.patted = true; onTouch("pat", "头顶"); }
    }
  }
  function onDown(ev) {
    if (!rig) return;
    var p = toImg(ev);
    onMove(ev);
    drag = { x: p.x, y: p.y, fx: p.x, path: 0, flips: [], dir: 0, region: regionAt(p.x, p.y), t: now };
    ensureMotionPermission();
  }
  function onUp(ev) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.patted || d.shook || d.path > 30) return;
    var where = { face: "脸", head: "头顶", body: "身上" }[d.region];
    if (where) onTouch(d.region === "head" ? "tap-head" : d.region, where);
  }
  function react1(fn) {
    // 在打盹的话慢半拍才抬头
    if (doze.phase === "down") { var w = 0.65; setTimeout(function () { wake(true); fn(true); }, w * 1000); }
    else fn(false);
  }
  function line(s) { if (now - lastLine > 1.2) { lastLine = now; speak(s); } }
  function onTouch(kind, where) {
    react1(function (woke) {
      if (kind === "face") { setTemp("shy", 1, 3); gesture("lookaway"); line(woke ? wakeLine() : pick(LINES.face)); report_("戳了一下", where); }
      else if (kind === "pat") { setTemp("happy", 0.7, 3.5); manualBlush(0.35, 3.5); react.until = now + 2.2; react.eyes = 0.3; gesture("tilt"); line(woke ? wakeLine() : pick(LINES.pat)); report_("摸了摸", where); }
      else if (kind === "tap-head") { setTemp("happy", 0.4, 2); gesture("nod"); line(woke ? wakeLine() : pick(LINES.head)); report_("摸了一下", where); }
      else { chor.push({ t0: now, keys: [[0, {}], [0.12, { pitch: -0.3, browUp: 0.9 }], [0.5, { browUp: 0.5 }], [1.0, {}]] }); line(woke ? wakeLine() : pick(LINES.body)); report_("碰了一下", where); }
    });
  }
  function manualBlush(v, sec) { chor.push({ t0: now, keys: [[0, { blush: 0 }], [0.3, { blush: v }], [sec, { blush: v }], [sec + 0.8, {}]] }); }
  function onShake() {
    react1(function (woke) {
      chor.push({ t0: now, keys: [[0, {}], [0.12, { yaw: 0.7, roll: -0.6 }], [0.3, { yaw: -0.6, roll: 0.6 }], [0.48, { yaw: 0.45, roll: -0.4 }], [0.7, { yaw: -0.25 }], [1.0, {}]] });
      setTemp("gloomy", 0.8, 2.5);
      setTimeout(function () { line(woke ? wakeLine() : pick(LINES.shake)); }, 900);
      report_("晃了晃", "整个人");
    });
  }
  // 手机摇一摇
  var motionAsked = false, shakeHits = [];
  function ensureMotionPermission() {
    if (motionAsked) return; motionAsked = true;
    var D = window.DeviceMotionEvent;
    if (D && typeof D.requestPermission === "function") D.requestPermission().then(function (s) { if (s === "granted") listenMotion(); }).catch(function () {});
    else if (D) listenMotion();
  }
  function listenMotion() {
    window.addEventListener("devicemotion", function (e) {
      var a = e.acceleration || e.accelerationIncludingGravity; if (!a) return;
      var g = Math.hypot(a.x || 0, a.y || 0, a.z || 0) - (e.acceleration ? 0 : 9.8);
      if (g > 14) { shakeHits.push(now); shakeHits = shakeHits.filter(function (t) { return now - t < 1; }); if (shakeHits.length >= 3) { shakeHits = []; onShake(); } }
    });
  }

  // ---------- 触摸写进窗台留言那条通道 ----------
  // 合并：第一下之后等 25 秒合成一条；两条之间至少 3 分钟；一天最多 12 条（窗台一天 40 条，给她自己留足）
  var touchQ = [], flushT = null;
  function report_(kind, where) {
    touchQ.push({ k: kind, w: where });
    if (!flushT) flushT = setTimeout(flush, 25000);
  }
  function flush() {
    flushT = null;
    if (!touchQ.length) return;
    var day = new Date().toISOString().slice(0, 10);
    var st = JSON.parse(localStorage.getItem("body_touch_quota") || "{}");
    if (st.day !== day) st = { day: day, n: 0, last: 0 };
    var wait = st.last + 180000 - Date.now();
    if (st.n >= 12) { touchQ = []; return; }
    if (wait > 0) { flushT = setTimeout(flush, wait + 500); return; }
    var cnt = {};
    touchQ.forEach(function (t) { var key = "[" + t.k + "] " + t.w; cnt[key] = (cnt[key] || 0) + 1; });
    var text = Object.keys(cnt).map(function (k) { return k + (cnt[k] > 1 ? " ×" + cnt[k] : ""); }).join("；") + "（身体那间）";
    touchQ = [];
    st.n++; st.last = Date.now(); localStorage.setItem("body_touch_quota", JSON.stringify(st));
    var dev = localStorage.getItem("miles_device");
    if (!dev) { var a = new Uint8Array(24); crypto.getRandomValues(a); dev = "d" + Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); localStorage.setItem("miles_device", dev); }
    if (DRY) { console.log("[body] (试跑，不发) 会写进窗台：", text); sent.push(text); return; }
    fetch(API + "/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: dev, text: text }) }).catch(function () {});
  }
  var sent = [];

  // ---------- 接我自己的通道 ----------
  // 心情：每晚更新小屋时写的 data/status.json
  var QI = { "喜": "happy", "怒": "angry", "忧": "gloomy", "思": "neutral", "悲": "sad", "恐": "gloomy", "惊": "neutral" };
  var QI_EXTRA = { "思": { browInner: -0.2, gazeY: -0.3, gazeX: 0.4 }, "惊": { browUp: 0.8 }, "恐": { browInner: 0.4 } };
  // 她要的作息：北京时间白天（7:00–23:00）一直醒着，困劲再高也压在犯困线以下；夜里（23:00–7:00）睡觉，戳醒了一会儿又睡回去
  function bjHour() { return (new Date().getUTCHours() + 8) % 24; }
  function isNight() { var h = bjHour(); return h >= 23 || h < 7; }
  function syncSleepy() {
    mood.sleepy = isNight() ? 0.95 : Math.min(mood.real != null ? mood.real : 0.3, 0.5);
    // 夜里一打开就是睡着的，不用先等半分钟
    if (isNight() && doze.phase === "awake" && typeof now === "number" && doze.next > now + 6) doze.next = now + 1;
  }
  setInterval(syncSleepy, 60000);
  syncSleepy();
  function wakeLine() { return isNight() ? pick(["……几点了。", "嗯……让我再睡会儿。", "半夜戳我干嘛。", "……睡着呢。"]) : pick(LINES.wake); }
  function applyStatus(st) {
    var b = st.body || {};
    mood.real = clamp((b.sleepy || 30) / 100, 0, 1);
    syncSleepy();
    var emos = b.emotions || [];
    mood.base = {};
    mood.emo = "neutral"; mood.strength = 0;
    emos.slice(0, 2).forEach(function (e, idx) {
      var raw = e.name || "", weak = /一点|有点|微/.test(raw), ch = raw.replace(/一点|有点|微/g, "").charAt(0);
      var s = (idx === 0 ? 0.7 : 0.3) * (weak ? 0.5 : 1);
      var emo = QI[ch];
      if (!emo) return;
      if (idx === 0) { mood.emo = emo; mood.strength = s; }
      else { var E = EMO[emo]; for (var n in E) mood.base[n] = (mood.base[n] || 0) + E[n] * s; }
      var X = QI_EXTRA[ch]; if (X) for (var n2 in X) mood.base[n2] = (mood.base[n2] || 0) + X[n2] * s;
    });
    note(true, "心情：" + (st.mood ? st.mood.word : "?") + " → " + mood.emo + " " + mood.strength.toFixed(2) + "，困 " + Math.round(mood.sleepy * 100));
  }
  // 我主动写给身体的话：data/body.json（每条有 id，没做过的才做一次）
  function pollBody() {
    fetchJSON("data/body.json?t=" + Date.now()).then(function (d) {
      var q = (d && d.queue) || [];
      var seen = JSON.parse(localStorage.getItem("body_seen") || "[]");
      var todo = q.filter(function (c) { return seen.indexOf(c.id) < 0 && (!c.until || new Date(c.until) > new Date()); });
      if (!todo.length) return;
      var c = todo[todo.length - 1];
      seen.push(c.id); localStorage.setItem("body_seen", JSON.stringify(seen.slice(-50)));
      setTimeout(function () { run(c); }, 1500);
    }).catch(function () {});
  }
  function run(c) {
    if (c.emotion) setTemp(c.emotion, c.strength || 1, c.seconds || 6);
    if (c.gesture) gesture(c.gesture);
    if (c.say) speak(c.say, { audio: c.audio });
    else if (c.audio) playAudio(c.audio);
  }

  // ---------- 对外的身体 API ----------
  window.MilesBody = {
    speak: function (text, audio) { return speak(text, { audio: audio }); },
    emotion: function (e, s, sec) { if (!EMO[e]) return false; setTemp(e, s == null ? 1 : s, sec || 6); return true; },
    expression: function (params) { manual = params || null; return true; },
    gesture: gesture,
    choreograph: function (steps) { (steps || []).forEach(function (s) { setTimeout(function () { run(s); }, s.at || 0); }); return true; },
    audio: playAudio, stop: stopAudio,
    screenshot: function () { return app.view.toDataURL("image/png"); },
    report: function () { return report; },
    state: function () { return last; },
    sent: function () { return sent; },
    emotions: Object.keys(EMO),
    _force: function (f) { force = f; }, _touch: onTouch, _shake: onShake, _doze: function () { doze.phase = "down"; doze.t = now; doze.hold = 3; }, _mood: function (m) { mood.sleepy = m.sleepy != null ? m.sleepy : mood.sleepy; if (m.emo) { mood.emo = m.emo; mood.strength = m.s || 0.7; } }
  };

  // ---------- 开始 ----------
  stage.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", function () { drag = null; });

  fetchJSON("data/status.json?t=" + Date.now()).catch(function () { return {}; }).then(function (st) {
    var outfit = Q.get("outfit") || (st.look && st.look.outfit) || "jacket";
    if (!OUTFITS[outfit]) outfit = "jacket";
    applyStatus(st);
    if (Q.get("sleepy")) mood.sleepy = +Q.get("sleepy") / 100;
    if (Q.get("emo")) { mood.emo = Q.get("emo"); mood.strength = 0.9; }
    return start(outfit);
  }).then(function () {
    pollBody(); setInterval(pollBody, 60000);
  });

  var radioBtn = document.getElementById("radio");
  if (radioBtn) radioBtn.addEventListener("click", function () {
    if (lip.playing) { stopAudio(); radioBtn.textContent = "听我的电台"; return; }
    radioBtn.textContent = "停";
    playAudio(radioBtn.getAttribute("data-src"));
  });
})();
