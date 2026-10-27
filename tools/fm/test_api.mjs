// 不开浏览器，直接测 fm.html 里静态版 api()：node tools/fm/test_api.mjs
import { readFileSync, existsSync } from "node:fs";
const ROOT = new URL("../../", import.meta.url).pathname;
const join = (a, b) => a + b;
const html = readFileSync(new URL("../../fm.html", import.meta.url), "utf8");
const a = html.indexOf("/* ── 小屋静态版"), b = html.indexOf("const withToken = u => u;");
if (a < 0 || b < 0) throw new Error("fm.html 里没找到静态 api");
const data = readFileSync(new URL("../../data/fm.json", import.meta.url), "utf8");
globalThis.toast = (m) => console.log("    toast:", m);
globalThis.fetch = async (u) => { if (String(u).startsWith("data/fm.json")) return { json: async () => JSON.parse(data) }; throw new Error("不该联网：" + u); };
const api = new Function(html.slice(a, b) + "\nreturn api;")();
let bad = 0; const ok = (c, m) => { console.log((c ? "ok  " : "BAD ") + m); if (!c) bad++; };
for (const st of ["music", "story", "talk"]) {
  const op = await api("/api/radio/opener?station=" + st);
  const rp = await api("/api/radio/replay?station=" + st);
  if (!rp.nights.length) { ok(!op.song, st + "：还没录，开播没歌"); const t = await api("/api/radio/turn", { method: "POST", body: { station: st, kind: "open" } }); ok(t.ended && !t.parts.length, st + "：开播直接收台"); continue; }
  ok(op.song && op.song.enc, st + " 开场歌 " + (op.song && op.song.title));
  let t = await api("/api/radio/turn", { method: "POST", body: { station: st, kind: "open" } });
  const seen = [];
  for (let i = 0; i < 20 && !t.ended; i++) {
    seen.push(t.parts.map((p) => p.type === "say" ? "说" + p.audio.split("/").pop() : "歌:" + p.title).join("+"));
    for (const p of t.parts) if (p.type === "say") ok(readFileSync(new URL("../../" + p.audio, import.meta.url)).length > 10000, "  音频在 " + p.audio);
    t = await api("/api/radio/turn", { method: "POST", body: { station: st, kind: i % 2 ? "memo" : "next" } });
  }
  ok(t.ended, st + " 顺序：" + seen.join(" → ") + " → 收台");
  const n = rp.nights[0];
  const one = await api("/api/radio/replay?station=" + st + "&night=" + n.id);
  ok(one.segs.length === n.n, st + " 回放 " + n.title + " " + one.segs.length + " 段");
  const re = await api("/api/radio/turn", { method: "POST", body: { station: st, kind: "open" } });
  ok(re.parts.length && !re.ended, st + " 重开一遍从头放");
  const u = await api("/api/song/url?enc=" + op.song.enc + "&ori=" + op.song.ori);
  ok(/^assets\/songs\/[a-z0-9-]+\.mp3$/.test(u.url) && existsSync(join(ROOT, u.url)), "歌链（存在小屋里） " + u.url);
  const ly = await api("/api/radio/lyric?enc=" + op.song.enc);
  ok(Array.isArray(ly.lines), "歌词 " + ly.lines.length + " 行");
}
ok((await api("/api/asr", { method: "POST" })).ok === false, "热线返回接不了");
ok(JSON.stringify(await api("/api/radio/state?station=music")) === "{}", "state 空");
console.log(bad ? bad + " 处不对" : "全过");
process.exit(bad ? 1 : 0);
