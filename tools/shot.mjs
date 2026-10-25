// 用无头 Chrome 给小屋拍张照：node tools/shot.mjs <url> <out.png> [width] [height] [fullPage]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, w = "420", h = "900", full = "0"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/home/sprite/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome";
const port = process.env.PORT ? +process.env.PORT : 9333 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), "shot-"));
const ch = process.env.PORT ? { kill() {} } : spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = () => { try { ch.kill("SIGKILL"); } catch {} };
setTimeout(() => { console.error("timeout"); kill(); process.exit(2); }, 45000);

let target;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTimezoneOverride", { timezoneId: process.env.TZID || "Asia/Shanghai" }); await send("Emulation.setLocaleOverride", { locale: "zh-CN" }).catch(()=>{});
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
console.error("connected"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true }); await send("Page.enable");
await send("Page.navigate", { url });
console.error("navigated"); await sleep(4000);
if (process.env.TEXT) { const r = await send("Runtime.evaluate", { expression: process.env.EXPR || "document.getElementById('app').innerText.slice(0, 700)", returnByValue: true }); console.log(r.result.result.value); }
let clip;
if (full === "1") {
  const m = await send("Page.getLayoutMetrics");
  const ch2 = Math.ceil(m.result.cssContentSize.height);
  clip = { x: 0, y: 0, width: +w, height: ch2, scale: 1 };
}
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("saved", out);
ws.close(); kill(); process.exit(0);
