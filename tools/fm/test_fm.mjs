// 测电台页：node tools/fm/test_fm.mjs <url> [秒数]
// 无头 Chrome 打开 fm.html，点播放，音频加速 16 倍跑完一期；记下报错、请求了哪些音频；
// 再递一张纸条、点一首歌（窗台接口被拦下来假装成功，不会真写到窗台）；再打开回放列表看一眼。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, secs = "150"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/home/sprite/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome";
const port = 9400 + Math.floor(Math.random() * 400);
const prof = mkdtempSync(join(tmpdir(), "fm-"));
const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = () => { try { ch.kill("SIGKILL"); } catch {} };
setTimeout(() => { console.log("TIMEOUT"); kill(); process.exit(2); }, (+secs + 90) * 1000);
let target;
for (let i = 0; i < 600; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); if (target) break; } catch {} await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const errors = []; const media = []; const notes = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("CONSOLE " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("LOG " + m.params.entry.text + " " + (m.params.entry.url || ""));
  if (m.method === "Network.requestWillBeSent") { const u = m.params.request.url; if (/assets\/fm\/|outer\/url|fm\.json/.test(u)) media.push(new Date().toISOString().slice(11, 19) + " " + u.replace(/^https?:\/\/[^/]+/, "")); }
  if (m.method === "Fetch.requestPaused") {
    notes.push(m.params.request.method + " " + m.params.request.url + " " + (m.params.request.postData || ""));
    send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }], body: Buffer.from('{"ok":true}').toString("base64") });
  }
});
await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Fetch.enable", { patterns: [{ urlPattern: "*workers.dev/notes*" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const P = HTMLMediaElement.prototype.play;
  window.__media = []; HTMLMediaElement.prototype.play = function () { try { this.playbackRate = +(window.__RATE||4); } catch (e) {} const el = this; if (!el.__h) { el.__h = 1; el.addEventListener('loadedmetadata', () => { if (/assets\/fm\//.test(el.currentSrc || el.src) && el.duration > 3) el.currentTime = el.duration - 1.5; }); ['playing','ended','error','pause','stalled','waiting'].forEach(t => el.addEventListener(t, () => window.__media.push(Math.round(performance.now()/1000) + 's ' + t + ' ' + String(el.currentSrc || el.src).split('/').slice(-2).join('/') + (t==='error' && el.error ? ' code' + el.error.code : '')))); } return P.call(this).catch(e => { window.__media.push('play() rejected ' + e.name + ' ' + String(el.src).split('/').pop()); throw e; }); };
  window.__toasts = [];
  new MutationObserver(() => { const t = document.getElementById('toast'); if (t && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); }).observe(document, { subtree: true, childList: true, characterData: true });
` });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
await send("Page.navigate", { url });
for (let i = 0; i < 120; i++) { await sleep(1000); if (/Miles/.test(await ev("document.getElementById('hint')?.innerText||''") || '')) break; }
await sleep(1000);
console.log("标题:", await ev("document.title"), "| 台:", await ev("document.getElementById('name').textContent"), "| 提示:", await ev("document.getElementById('hint').innerText"));
await ev("(document.getElementById('bPlay')||document.querySelector('[id=bPlay]')).dispatchEvent(new MouseEvent('click',{bubbles:true})), 1");
const t0 = Date.now(); let lastLcd = "";
while (Date.now() - t0 < +secs * 1000) {
  await sleep(3000);
  const s = await ev("(document.getElementById('lcdN')?.textContent||'') + ' | ' + (document.getElementById('lcdS')?.textContent||'') + ' || ' + (document.getElementById('notes')?.innerText||'').replace(/\\s+/g,' ').slice(0,140)");
  if (s !== lastLcd) { console.log(Math.round((Date.now() - t0) / 1000) + "s", s); lastLcd = s; }
  if (/\| 收台了/.test(s)) break;
}
// 递纸条 + 点歌
await ev("(()=>{const i=document.getElementById('noteIn');i.value='测试纸条';document.getElementById('note').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));return 1})()");
await sleep(1500);
await ev("(()=>{const i=document.getElementById('noteIn');i.value='测试点歌';document.getElementById('reqBtn').click();return 1})()");
await sleep(1500);
// 回放列表
await ev("document.getElementById('rptab').click(),1");
await sleep(2000);
console.log("回放列表:", await ev("document.getElementById('rpList').innerText.replace(/\\s+/g,' ')"));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/fm_test.png", Buffer.from(shot.result.data, "base64"));
console.log("媒体事件:\n " + (await ev("window.__media.join('\\n ')")));
console.log("toast:", JSON.stringify(await ev("window.__toasts")));
console.log("音频请求:\n " + media.join("\n "));
console.log("窗台请求(已拦下):\n " + notes.join("\n "));
console.log("报错:", errors.length ? "\n " + errors.join("\n ") : "无");
ws.close(); kill(); process.exit(0);
