// 测「给你的歌」：node tools/test_songs.mjs <url带#slug> [out.png]
// 手机尺寸打开，确认锁定到那首、点圆按钮后音频真在走（currentTime 往前跳）、拿到的时长是整首，记下报错。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out = "/tmp/songs.png"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/home/sprite/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome";
const port = 9800 + Math.floor(Math.random() * 150);
const prof = mkdtempSync(join(tmpdir(), "songs-"));
const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = () => { try { ch.kill("SIGKILL"); } catch {} };
setTimeout(() => { console.log("TIMEOUT"); kill(); process.exit(2); }, 60000);
let target;
for (let i = 0; i < 100; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); if (target) break; } catch {} await sleep(200); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push(m.params.args.map((a) => a.value || a.description).join(" "));
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400) errs.push(m.params.response.status + " " + m.params.response.url);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });
await send("Page.navigate", { url });
await sleep(3500);
const slug = new URL(url).hash.slice(1);
console.log("锁定：", await ev(`(document.querySelector('.song.here')||{}).id || '无'`), "提示：", await ev(`document.getElementById('tip').textContent`));
// 按钮中心，用触摸点一下（算用户手势）
const pos = await ev(`(function(){var r=document.querySelector('#${slug} .play').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pos[0], y: pos[1] }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(800);
const t1 = await ev(`document.querySelector('#${slug}').classList.contains('on')`);
await sleep(4000);
const info = await ev(`(function(){var b=document.querySelector('#${slug} .t0').textContent,d=document.querySelector('#${slug} .t1').textContent;return b+' / '+d})()`);
console.log("点了以后在放：", t1, " 进度：", info, " 进度条：", await ev(`document.querySelector('#${slug} .track i').style.width`));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("报错：", errs.length ? errs.join(" | ") : "无");
kill(); process.exit(0);
