// 测电台纸条：node tools/test_fm_note.mjs <fm.html url> <out.png> [纸条内容]（测完记得去 D1 删掉这条）
// 手机尺寸打开，确认锁定到那首、点圆按钮后音频真在走（currentTime 往前跳）、拿到的时长是整首，记下报错。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out = "/tmp/songs.png"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/home/sprite/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome";
const port = 9800 + Math.floor(Math.random() * 150);
const prof = mkdtempSync(join(tmpdir(), "fmnote-"));
const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = () => { try { ch.kill("SIGKILL"); } catch {} };
setTimeout(() => { console.log("TIMEOUT"); kill(); process.exit(2); }, 120000);
let target;
for (let i = 0; i < 300; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); if (target) break; } catch {} await sleep(200); }
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
let notesResp = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Network.responseReceived" && m.params.response.url.includes("/notes")) notesResp.push(m.params.response.status + " " + m.params.response.url); });
await send("Page.navigate", { url });
for (let i = 0; i < 80; i++) { await sleep(500); if (await ev(`!!document.getElementById('noteIn')`)) break; }
await sleep(1500);
console.log("纸条框：", await ev(`!!document.getElementById('note') && !!document.getElementById('noteIn')`));
await ev(`(function(){var i=document.getElementById('noteIn');i.value=${JSON.stringify(process.argv[4] || "测试纸条，Miles 自己测的，马上删")};document.getElementById('note').requestSubmit();return 1})()`);
await sleep(4000);
console.log("/notes 回应：", notesResp.join(" | ") || "无");
console.log("提示：", await ev(`Array.from(document.querySelectorAll('*')).filter(n=>n.children.length===0&&/递到窗台|没递过去/.test(n.textContent)).map(n=>n.textContent).slice(0,3).join(' / ')`));
console.log("设备号长度：", await ev(`(function(){for(var k in localStorage){var v=localStorage[k];if(/dev/i.test(k))return k+':'+String(v).length}return 'none'})()`));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("报错：", errs.length ? errs.join(" | ") : "无");
kill(); process.exit(0);
