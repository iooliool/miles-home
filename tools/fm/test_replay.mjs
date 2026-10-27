// 测回放那几样：node tools/fm/test_replay.mjs <url> [秒数]
// 无头 Chrome，手机尺寸。data/fm.json 在浏览器里被改一份（不动文件）：第 2 段假装是回她的纸条，第 2 段的歌指到一个不存在的文件。
// 看：① 我录的那段字幕有没有按真时间亮（.rv.timed）、点字能不能跳；② 她的纸条有没有以「你」上单子；③ 放不出来的歌有没有留 ✕ 一行；
//     ④ 听到一半走了，回放单子上有没有「上回听到第 X 段 · 接着听」，点了是不是从那段放；⑤ 放完以后写不写「听完了」。
// 窗台接口拦下来假装成功，不写窗台。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, secs = "400"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/home/sprite/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome";
const port = 9400 + Math.floor(Math.random() * 400);
const prof = mkdtempSync(join(tmpdir(), "fmr-"));
const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = () => { try { ch.kill("SIGKILL"); } catch {} };
setTimeout(() => { console.log("TIMEOUT"); report().then(() => { kill(); process.exit(2); }); }, (+secs + 600) * 1000);
let target;
for (let i = 0; i < 2400; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); if (target) break; } catch {} await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const errors = []; const media = []; const notes = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ok = [], bad = [];
const check = (cond, msg) => { (cond ? ok : bad).push(msg); console.log((cond ? "✓ " : "✗ ") + msg); };
ws.addEventListener("message", async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("CONSOLE " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Network.requestWillBeSent") { const u = m.params.request.url; if (/assets\/(fm|songs)\//.test(u)) media.push(u.replace(/^https?:\/\/[^/]+/, "").replace(/^\/miles-home/, "")); }
  if (m.method === "Fetch.requestPaused") {
    const u = m.params.request.url;
    if (/data\/fm\.json/.test(u)) {
      const r = await fetch(u.replace(/\?.*$/, "") + "?t=" + Date.now()); const d = await r.json();
      const n = d.stations.music[0];
      n.segs[1].her = "测试纸条：放首 Neu! 吧"; n.segs[1].her_at = "10-26 23:10";
      for (const p of n.segs[1].parts) if (p.type === "song") { p.file = "assets/songs/__no_such_song__.mp3"; p.title = "测试坏歌"; }
      send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(d)).toString("base64") });
      return;
    }
    notes.push(m.params.request.method + " " + u);
    send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }], body: Buffer.from('{"ok":true}').toString("base64") });
  }
});
await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Fetch.enable", { patterns: [{ urlPattern: "*workers.dev/*" }, { urlPattern: "*data/fm.json*" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const P = HTMLMediaElement.prototype.play;
  window.__media = []; window.__els = []; HTMLMediaElement.prototype.play = function () { const el = this; if (!window.__els.includes(el)) window.__els.push(el); try { el.playbackRate = window.__fast ? 16 : 4; } catch (e) {} if (!el.__h) { el.__h = 1;
    const sk = () => { const u = el.currentSrc || el.src; if (/assets\\/songs\\//.test(u) && el.duration > 3 && el.__sk !== u && el.currentTime < el.duration - 3) { el.__sk = u; el.currentTime = el.duration - 1.5; } }; el.addEventListener('loadedmetadata', sk); el.addEventListener('playing', sk); el.addEventListener('timeupdate', sk);
    ['playing','ended','error'].forEach(t => el.addEventListener(t, () => window.__media.push(Math.round(performance.now()/1000) + 's ' + t + ' ' + String(el.currentSrc || el.src).split('/').slice(-2).join('/')))); }
    return P.call(this).catch(e => { window.__media.push('play() rejected ' + e.name); throw e; }); };
  window.__toasts = [];
  new MutationObserver(() => { const t = document.getElementById('toast'); if (t && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); }).observe(document, { subtree: true, childList: true, characterData: true });
` });
const ev = async (expr) => {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }), sleep(20000).then(() => null)]);
  if (!r) { console.log("ev 超时:", expr.slice(0, 80)); return undefined; }
  if (r.result && r.result.exceptionDetails) console.log("ev 抛错:", expr.slice(0, 60), r.result.exceptionDetails.exception?.description?.slice(0, 120));
  return r.result?.result?.value;
};
const notesText = () => ev("(document.getElementById('notes')?.innerText||'').replace(/\\s+/g,' ')");
async function report() {
  console.log("toast:", JSON.stringify(await ev("window.__toasts")));
  console.log("音频请求:\n " + media.join("\n "));
  console.log("窗台请求(已拦下):", notes.length ? notes.join(" | ") : "无");
  console.log("报错:", errors.length ? "\n " + errors.join("\n ") : "无");
  console.log(`结果：${ok.length} 过，${bad.length} 没过`);
}
await send("Page.navigate", { url });
for (let i = 0; i < 120; i++) { await sleep(1000); if (/Miles/.test(await ev("document.getElementById('hint')?.innerText||''") || '')) break; }
await sleep(1000);
// —— 开播（最新一期）
await ev("document.getElementById('bPlay').dispatchEvent(new MouseEvent('click',{bubbles:true})), 1");
let timed = false, jumped = null, sawHer = false, sawFail = false;
const t0 = Date.now();
let lastP = '';
while (Date.now() - t0 < 420000) {
  await sleep(1500);
  const pr = await ev("(document.getElementById('lcdN')?.textContent||'') + ' | ' + (document.getElementById('lcdS')?.textContent||'')");
  if (pr !== lastP) { console.log(Math.round((Date.now()-t0)/1000)+'s', pr); lastP = pr; }
  if (!timed && await ev("!!document.querySelector('.now .rv.timed')")) {
    timed = true;
    // 点第 30 个字，看声音跳到了第几秒
    const jr = await Promise.race([sleep(20000).then(() => ({ result: { result: { value: 'timeout' } } })), send("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: `(async()=>{
      const voice = window.__els.find(x => /assets\\/fm\\/.*\\.mp3/.test(x.currentSrc||x.src) && !x.paused);
      if (!voice) return {err:'没找到正在念的声音'};
      const src = (voice.currentSrc||voice.src).replace(/\\.mp3.*$/, '.align.json');
      const raw = await (await fetch(src)).json();
      const times = raw.characters.map((c,i)=>[c,raw.character_start_times_seconds[i]]).filter(x=>x[0]!=='\\n').map(x=>x[1]);
      const w=document.querySelectorAll('.now .rv .w'); const k=Math.min(60,w.length-1);
      voice.playbackRate = 1; w[k].dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await new Promise(r=>setTimeout(r,1000));
      const v2 = window.__els.find(x => /assets\\/fm\\/|^blob:/.test(x.currentSrc||x.src) && !x.paused) || voice;
      return {n:w.length, chars:times.length, k, t:+v2.currentTime.toFixed(2), rate: v2.playbackRate, want:+times[k].toFixed(2), on: document.querySelectorAll('.now .rv .w.on').length};
    })()` })]);
    jumped = jr.result.result?.value ?? jr.result;
    console.log('点字:', JSON.stringify(jumped));
    await ev("window.__fast = 1; window.__els.forEach(x => { try { x.playbackRate = 16; } catch (e) {} }), 1");
  }
  const nt = await notesText();
  if (!sawHer && /测试纸条/.test(nt)) sawHer = true;
  if (!sawFail && /✕/.test(nt) && /测试坏歌/.test(nt)) sawFail = true;
  const pos = await ev("localStorage.getItem('miles_fm_pos')");
  if (sawHer && sawFail && timed && pos && JSON.parse(pos)[Object.keys(JSON.parse(pos))[0]].seg >= 2) break;
}
check(timed, "我录的那段字幕按真时间亮（.rv.timed）");
check(jumped && jumped.t != null && jumped.want != null && jumped.t - jumped.want > -0.5 && jumped.t - jumped.want < 3, "点字跳过去：" + JSON.stringify(jumped));
check(sawHer, "她的纸条以「你」上了单子");
check(sawFail, "放不出来的歌留了 ✕ 一行");
console.log("单子:", (await notesText()).slice(0, 300));
const pos1 = await ev("localStorage.getItem('miles_fm_pos')");
console.log("听到哪:", pos1);
// —— 中途走人：打开回放抽屉
await ev("document.getElementById('rptab').click(),1");
await sleep(1500);
const list = await ev("document.getElementById('rpList').innerText.replace(/\\s+/g,' ')");
console.log("回放单子:", list);
check(/上回听到第 \d+\/\d+ 段/.test(list), "单子上有「上回听到第 X/N 段 · 接着听」");
let shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/fm_replay_list.png", Buffer.from(shot.result.data, "base64"));
const from = await ev("(document.querySelector('#rpList span.rsm[data-from]')||{}).dataset?.from");
const before = media.length;
await ev("document.querySelector('#rpList span.rsm[data-from]').click(),1");
await sleep(5000);
const toasts = await ev("window.__toasts");
check(toasts.some((t) => /接着上回，从第/.test(t)), "点「接着听」弹了「接着上回，从第 N 段放」");
const firstAfter = media.slice(before).find((u) => /assets\/fm\/.*\.mp3/.test(u));
console.log("接着听后第一个声音:", firstAfter, "| 应从第", +from + 1, "段");
check(firstAfter && new RegExp(String(+from + 1).padStart(2, "0") + "\\.mp3").test(firstAfter), "接着听从那一段的声音开始");
// —— 放完
const t1 = Date.now();
while (Date.now() - t1 < +secs * 1000) { await sleep(2000); if (/这一晚放完了/.test(await ev("document.getElementById('lcdN')?.textContent + document.getElementById('lcdS')?.textContent") || "")) break; }
if (+secs === 0) {   // 赶时间：不等放完，直接把「听到哪」写成放完了，只看单子怎么显示
  await ev("(()=>{const a=JSON.parse(localStorage.getItem('miles_fm_pos')||'{}');for(const k in a){a[k].seg=a[k].n;}localStorage.setItem('miles_fm_pos',JSON.stringify(a));})(),1");
}
await ev("document.getElementById('rptab').click(),1");
await sleep(1500);
const list2 = await ev("document.getElementById('rpList').innerText.replace(/\\s+/g,' ')");
console.log("放完后的回放单子:", list2);
check(/听完了/.test(list2), "放完以后单子上写「听完了」");
shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/fm_replay_done.png", Buffer.from(shot.result.data, "base64"));
await report();
ws.close(); kill(); process.exit(bad.length ? 1 : 0);
