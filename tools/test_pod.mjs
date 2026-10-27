// 查播客台：node tools/test_pod.mjs <fm.html 的网址> <截图前缀>
// 调到「播客」台 → 看节目单画出来没有 → 点第一期封面 → 看 YouTube 播放器的 iframe 载没载进来。
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, pre = "/tmp/pod"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/home/sprite/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome";
const port = 9333 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), "pod-"));
const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = () => { try { ch.kill("SIGKILL"); } catch {} };
setTimeout(() => { console.error("timeout"); kill(); process.exit(2); }, 80000);
let target;
for (let i = 0; i < 50; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); if (target) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const frames = []; const errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Page.frameNavigated" && m.params.frame.parentId) frames.push(m.params.frame.url);
  if (m.method === "Log.entryAdded") errs.push("LOG " + m.params.entry.level + " " + m.params.entry.text + " " + (m.params.entry.url || ""));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push("CONSOLE " + JSON.stringify(m.params.args.map(a => a.value || a.description)).slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
const shot = async (f) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(f, Buffer.from(s.result.data, "base64")); };
await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true }); if (!process.env.NOBLOCK) await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.cn*", "*fonts.gstatic.cn*"] }); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__errs=[];addEventListener('error',e=>__errs.push(e.message+' @'+e.lineno+':'+e.colno));addEventListener('unhandledrejection',e=>__errs.push('rej '+(e.reason&&e.reason.stack||e.reason)))" }); await send("Page.bringToFront"); await send("Emulation.setFocusEmulationEnabled", { enabled: true }); await send("Page.navigate", { url });
await sleep(2500);
await ev("localStorage.setItem('radio-station', '" + (process.env.START || 'pod') + "')");
await send("Page.navigate", { url });
await sleep(4000);
console.log("dbg:", JSON.stringify((await send("Runtime.evaluate", { expression: "location.href + \" \" + typeof ST + \" \" + document.title", returnByValue: true })).result));
console.log("labels:", await ev("[...document.querySelectorAll('.tun-l')].map(t => t.textContent).join(' / ')"));
await ev("[...document.querySelectorAll('.tun-l')].find(t => t.textContent === '" + (process.env.LBL || '播客') + "').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
await sleep(3000);
console.log("state:", await ev("document.readyState + ' desc=' + document.getElementById('desc').textContent"));
console.log("pageerrs:", await ev("JSON.stringify(window.__errs)"));
console.log("raf:", await ev("Promise.race([new Promise(r => requestAnimationFrame(() => r('raf ok'))), new Promise(r => setTimeout(() => r('raf dead'), 2000))])"));
console.log("on:", await ev("(document.querySelector('.tun-l.on')||{}).textContent"), "notes:", await ev("document.getElementById('notes').innerText.slice(0,200)"));
console.log("lcd:", await ev("document.getElementById('lcdS').textContent"));
console.log("eps:", await ev("document.querySelectorAll('.pod-v').length"), "channels:", await ev("[...document.querySelectorAll('.pod-ch a')].map(a => a.textContent + (a.nextElementSibling && a.nextElementSibling.className === 'pod-mine' ? '*' : '')).join(' / ')"));
await shot(pre + "_list.png");
await ev("(() => { const b = document.querySelector('.pod-v'); b.scrollIntoView({ block: 'center' }); b.click(); })()");
await sleep(9000);
console.log("iframe:", await ev("(document.querySelector('.pod-v.on iframe') || {}).src || 'none'"));
console.log("frames navigated:", frames.filter((u) => /youtube/.test(u)).join(" | ") || "none");
const tl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map((t) => t.type + " " + t.url).filter((u) => /youtube/.test(u));
console.log("targets:", tl.join(" | ") || "none");
await shot(pre + "_play.png");
console.log("errors:", errs.length ? errs.join(" || ").slice(0, 600) : "none");
ws.close(); kill(); process.exit(0);
