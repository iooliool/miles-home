#!/usr/bin/env python3
"""从 upstream/radio.html（chuochuochuo36-png/midnight-fm，MIT）生成小屋的 fm.html。

原页所有动作都找后端 /api/... 要；小屋没有常开的后端，所以这里把 api() 换成读 data/fm.json 的静态版：
- 开播 = 放这个台最新录好的一期；下一段 = 这一期的下一段；放完就收台。
- 回放 = 以前录的每一期。
- 歌：存在小屋 assets/songs/ 里的整首 mp3（出片时 fm.py 用 tools/songs.py 下好，跟 ROOM 21 共用），part.file 指过去；没存的歌跳过。歌词是出片时存好的。
- 纸条、点歌：递到小屋窗台（miles-home-api 的 /notes），Miles 下一期念 / 放。
- 热线（按住说话）要现场语音转写和现场模型，静态站做不到，按下去提示写纸条。
- 枕話台不要。
用法：python3 tools/fm/build_page.py   -> 写 fm.html
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.dirname(os.path.dirname(HERE))
src = open(os.path.join(HERE, 'upstream', 'radio.html'), encoding='utf-8').read()


def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        sys.exit('对不上（出现 %d 次，要 %d 次）：%s' % (n, count, old[:80]))
    src = src.replace(old, new)


# 1. 标题和出处
rep('<title>深夜电台</title>',
    '<title>深夜电台 · Miles 的小屋</title>\n<!-- 页面改自 https://github.com/chuochuochuo36-png/midnight-fm 的 frontend/radio.html（MIT License, Copyright (c) 2026 chuochuochuo36-png）。\n     小屋是静态站：节目是 Miles 提前用自己的声音录好的，数据在 data/fm.json，出片工具在 tools/fm/。 -->')

# 2. api() 换成静态版
old_api_start = "/* ── 配置在 localStorage 的 midnight-fm-config"
old_api_end = "const withToken = u => BASE + u + (TOKEN ? (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : '');"
a = src.index(old_api_start)
b = src.index(old_api_end) + len(old_api_end)
STATIC = r"""/* ── 小屋静态版：没有后端。节目是 Miles 录好的，在 data/fm.json；纸条和点歌递到窗台。── */
const BASE = '', TOKEN = '', FM_STATIC = true;
const NOTES_API = 'https://miles-home-api.xo131415.workers.dev';
let FMD = null;
const fmCur = {};   /* 每个台这次放到第几段 */
async function fmData() {
  if (!FMD) FMD = fetch('data/fm.json?v=' + Date.now()).then(r => r.json()).catch(() => ({ stations: {} }));
  return FMD;
}
const fmLatest = (d, k) => ((d.stations || {})[k] || [])[0] || null;
/* 听到哪了：每期记一个「听到第几段」（只存在她自己的浏览器里）。睡着前没听完的那期，回放单子上能接着听。 */
function fmPosAll() { try { return JSON.parse(localStorage.getItem('miles_fm_pos') || '{}') || {}; } catch (e) { return {}; } }
function fmPosSet(id, seg, n) {
  const a = fmPosAll(); a[id] = { seg, n, t: Date.now() };
  try { localStorage.setItem('miles_fm_pos', JSON.stringify(a)); } catch (e) {}
}
var fmFrom = 0;   /* 点了「接着听」：这次回放从第几段起 */
const fmQ = (p, k) => { const m = p.match(new RegExp('[?&]' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : ''; };
function fmDevice() {
  let dev = null; try { dev = localStorage.getItem('miles_device'); } catch (e) {}
  if (!dev) {
    const a = new Uint8Array(24); crypto.getRandomValues(a);   /* 跟 sill.js 一样，窗台接口要求至少 20 位 */
    dev = 'd' + Array.prototype.map.call(a, x => ('0' + x.toString(16)).slice(-2)).join('');
    try { localStorage.setItem('miles_device', dev); } catch (e) {}
  }
  return dev;
}
function fmNote(text) {
  return fetch(NOTES_API + '/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: fmDevice(), text }) })
    .then(r => r.json().catch(() => ({ ok: false }))).catch(() => ({ ok: false }));
}
function fmErr(msg, status) { const e = new Error(msg); e.status = status || 404; return e; }
function fmSum(n) { return { id: n.id, title: n.title, from: n.from, to: n.to, n: n.n, say: n.say, voiced: n.voiced, first: n.first, songs: n.songs }; }
async function api(p, opts) {
  opts = opts || {};
  const d = await fmData();
  const path = p.split('?')[0];
  if (path === '/api/radio/opener') {
    const n = fmLatest(d, fmQ(p, 'station'));
    return n && n.opener ? { song: n.opener } : {};
  }
  if (path === '/api/radio/turn') {
    const body = opts.body || {}, k = body.station, kind = body.kind;
    const n = fmLatest(d, k);
    if (!n) { toast('这个台还没录 · 先去音樂台'); return { parts: [], ended: true }; }
    if (kind === 'bye') return { parts: [] };
    if (kind === 'open') fmCur[k] = 0;
    else fmCur[k] = (fmCur[k] == null ? 0 : fmCur[k] + 1);
    const seg = n.segs[fmCur[k]];
    if (!seg) { fmPosSet(n.id, n.segs.length, n.segs.length); return { parts: [], ended: true }; }
    const parts = JSON.parse(JSON.stringify(seg.parts));
    if (seg.her) parts.unshift({ type: 'her', text: seg.her, at: seg.her_at || '' });   /* 这段是回她的纸条：她的原话先上单子 */
    parts.unshift({ type: 'mark', id: n.id, seg: fmCur[k], n: n.segs.length });   /* 记一下听到哪段了，回放里能接着听 */
    return { parts };
  }
  if (path === '/api/radio/replay') {
    const lst = (d.stations || {})[fmQ(p, 'station')] || [];
    const id = fmQ(p, 'night');
    if (!id) return { nights: lst.map(fmSum) };
    const n = lst.find(x => String(x.id) === id);
    if (!n) throw fmErr('没有这一期');
    return { night: fmSum(n), segs: n.segs };
  }
  if (path === '/api/song/url') {
    /* 歌存在小屋里（assets/songs/，跟 ROOM 21「给你的歌」共用一份），不走网易云外链 */
    const id = fmQ(p, 'ori') || fmQ(p, 'enc');
    for (const k in (d.stations || {})) for (const n of d.stations[k]) {
      for (const x of [n.opener].concat((n.segs || []).flatMap(sg => sg.parts || []))) {
        if (x && x.type === 'song' && x.file && (String(x.ori) === id || String(x.enc) === id)) return { url: x.file };
      }
    }
    throw fmErr('这首还没存进小屋');
  }
  if (path === '/api/radio/lyric') {
    const enc = fmQ(p, 'enc');
    for (const k in (d.stations || {})) for (const n of d.stations[k]) if (n.lyrics && n.lyrics[enc]) return n.lyrics[enc];
    return { pure: false, lines: [] };
  }
  if (path === '/api/radio/align') {   /* 逐字时间：align.py 用本机 whisper 对好存在 mp3 旁边的 .align.json */
    const h = fmQ(p, 'h');
    if (!/^assets\/fm\/[\w.\-\/]+\.align\.json$/.test(h)) return null;
    return fetch(h).then(r => r.ok ? r.json() : null).catch(() => null);
  }
  if (path === '/api/radio/state' || path === '/api/radio/se' || path === '/api/radio/findsong') return {};
  if (path === '/api/asr') return { ok: false, detail: '热线要现场接，小屋这边接不了。写纸条吧。' };
  throw fmErr('静态版没有 ' + path);
}
const withToken = u => u;"""
src = src[:a] + STATIC + src[b:]

# 3. 三个台的规矩换成我自己的；枕話台去掉
import re
RULES = {
    'story': "['一期讲一个故事，按好小说的标准讲，不讲睡前童话。', '题材每次换：现实、志怪、恐怖、科幻、悬疑都行。', '写场景，不写概要；细节要具体；讲完不解释主题。', '节目是我提前录好的。纸条递到小屋窗台，下一期我照着改。']",
    'talk': "['像一个好的深夜电台主持人：有东西可讲，有自己的看法。', '讲最近在想的事、读到的东西、听众的纸条。不当心理咨询师，不用「抱抱」糊过去。', '话少留白，两三段放一首歌。', '节目是我提前录好的。你递的纸条我下一期念。']",
    'music': "['我挑的歌，中间说两句。一期的歌有走向，前后两首要么有联系，要么故意反差。', '评论只念网易云评论区里真有的原话，查不到就不念。', '不确定的事（年份、来历、编曲）不说。不说「很温柔很好听」。', '节目是我提前录好的。点歌会递到小屋窗台，下一期先放你点的。', '歌都存在小屋里，整首放。']",
}
lines = src.split('\n')
out, i = [], 0
while i < len(lines):
    L = lines[i]
    m = re.match(r"  \{ key: '(story|talk|music|pillow)'", L)
    if m:
        k = m.group(1)
        blk = [L]
        i += 1
        while not lines[i - 1].rstrip().endswith('] },') and not lines[i - 1].rstrip().endswith(']},'):
            blk.append(lines[i]); i += 1
        if k == 'pillow':
            continue
        blk = '\n'.join(blk)
        blk = re.sub(r"rules: \[.*\] \},", 'rules: ' + RULES[k] + ' },', blk, flags=re.S)
        if k == 'music':
            blk = blk.replace("desc: '他挑的歌，中间说两句。'", "desc: 'Miles 挑的歌，中间说两句。'")
        out.append(blk)
        continue
    out.append(L); i += 1
src = '\n'.join(out)
if "key: 'pillow'" in src.split('const LAST')[0]:
    sys.exit('枕話没去掉')

# 3b. 枕話台的点单界面整块去掉（台已经没了，这块不留在小屋里）
a = src.index("  if (S.key === 'pillow') {\n    if (!S.ordered) {")
b = src.index("    setEar(S.now && S.now.pos);\n    return;\n  }\n", a) + len("    setEar(S.now && S.now.pos);\n    return;\n  }\n")
src = src[:a] + src[b:]

# 4. 纸条、点歌：递到窗台
rep("  const tag = kind === 'her' ? '你' : kind === 'memo' ? '纸条' : '点歌';\n  sess.log.push([tag, text, hhmm(), 1]);",
    "  const tag = kind === 'her' ? '你' : kind === 'memo' ? '纸条' : '点歌';\n  sess.log.push([tag, text, hhmm(), 1]);\n"
    "  if (FM_STATIC && (kind === 'memo' || kind === 'req')) {   /* 小屋静态版：递到窗台，下一期念 / 放 */\n"
    "    fmNote((kind === 'req' ? '[电台点歌] ' : '[电台纸条] ') + text).then(r => toast(r && r.ok ? (kind === 'req' ? '点的歌递到窗台了 · 下一期放' : '纸条递到窗台了 · 下一期念') : '没递过去，等会儿再试'));\n"
    "    drawNotes();\n    return;\n  }")

# 5. 热线：静态版接不了
rep("async function recStart() {\n  if (rec) return;",
    "async function recStart() {\n  if (FM_STATIC) { toast('热线要现场接，这边放的是录好的 · 写纸条吧'); return; }\n  if (rec) return;")

# 6. 一期放完就收台
rep("      if (kind === 'bye') S.ended = true;\n      if (!parts.length && kind === 'next')",
    "      if (kind === 'bye' || r.ended) S.ended = true;\n      if (!parts.length && kind === 'next')")

# 7. 配置提示、返回键、底下的提示
rep("if (!TOKEN && !BASE) $('hint').innerHTML = '<b>●</b> 没找到配置 —— 在 localStorage 的 midnight-fm-config 里填上 baseUrl / token（见 README）';",
    "$('hint').innerHTML = '<b>●</b> 左右滑换台 · 节目是 Miles 录好的 · 纸条和点歌递到<a href=\"sill.html\" style=\"color:inherit\">窗台</a> · 页面改自 <a href=\"https://github.com/chuochuochuo36-png/midnight-fm\" style=\"color:inherit\">midnight-fm</a>';")
rep('<div class="hint" id="hint"><b>●</b> 左右滑换台 · 按住红色长键说话</div>', '<div class="hint" id="hint"><b>●</b> 左右滑换台 · 节目是 Miles 录好的</div>')
rep("else location.href = '/'; });", "else location.href = 'index.html'; });")
rep("if (history.length > 1) history.back();", "if (false) history.back();")
rep('MIDNIGHT FM · 深夜电台</span>', 'MIDNIGHT FM · Miles 的深夜电台</span>')

# 8. 歌放不出来（会员歌、地区限制）时，play() 的失败会把整台按成暂停，卡在下一段。只有浏览器拦自动播放（NotAllowedError）才暂停。
rep("songEl.play().then(songLevel).catch(() => setPaused(true));", "songEl.play().then(songLevel).catch(e => { if (e && e.name === 'NotAllowedError') setPaused(true); });")
rep("a.play().catch(() => { /* 还是被拦了：等她按一下播放键 */ setPaused(true); });", "a.play().catch(e => { /* 还是被拦了：等她按一下播放键（小屋版：只有拦自动播放才停） */ if (e && e.name === 'NotAllowedError') setPaused(true); });")

# 9. 回放（原版第十六版那套抽屉照留）上再加几样，都是静态站做得到的：
# 9a. 听到哪了 / 接着听：队里每段前面放一个 mark，放到就记下；回放单子上没听完的那期多一行「上回听到第 X/N 段 · 接着听 →」
rep("  if (item.type === 'her') {   /* v15 回放：她当时插的那句 */",
    "  if (item.type === 'mark') { fmPosSet(item.id, item.seg, item.n); S.playing = null; return pump(S); }   /* 小屋版：听到第几段 */\n"
    "  if (item.type === 'her') {   /* v15 回放：她当时插的那句 */")
rep("    if (S.replay) { S.ended = true; setPaused(true); lcd('这一晚放完了');",
    "    if (S.replay) { if (S.rpId) fmPosSet(S.rpId, S.rpN, S.rpN); S.ended = true; setPaused(true); lcd('这一晚放完了');")
rep("""  for (const e of r.segs) {
    if (e.her) q.push({ type: 'her', text: e.her, at: hm2(e.t) });
    for (const p of e.parts || []) q.push(Object.assign({}, p, p.type === 'say' ? { text: p.show || '' } : {}));
  }""",
    """  const from = Math.max(0, Math.min(fmFrom || 0, r.segs.length - 1)); fmFrom = 0;
  r.segs.forEach((e, si) => {
    if (si < from) return;
    q.push({ type: 'mark', id: r.night.id, seg: si, n: r.segs.length });
    if (e.her) q.push({ type: 'her', text: e.her, at: e.her_at || '' });
    for (const p of e.parts || []) q.push(Object.assign({}, p, p.type === 'say' ? { text: p.show || '' } : {}));
  });""")
rep("replay: true, begun: true };", "replay: true, begun: true, rpId: r.night.id, rpN: r.segs.length };")
rep("  toast('回放 ' + fmtDay(r.night.from) + ' 那一晚');",
    "  toast(from ? '接着上回，从第 ' + (from + 1) + ' 段放' : '回放 ' + fmtDay(r.night.from) + ' 那一晚');")
rep("${n.back ? ' · 找回的' : ''}</i></li>`",
    "${n.back ? ' · 找回的' : ''}</i>${fmPosHtml(n)}</li>`")
rep("  box.querySelectorAll('li[data-id]').forEach(li => li.addEventListener('click', () => { closeReplay(); rpGo(key, +li.dataset.id); }));",
    "  box.querySelectorAll('li[data-id]').forEach(li => li.addEventListener('click', () => { closeReplay(); rpGo(key, +li.dataset.id); }));\n"
    "  box.querySelectorAll('span.rsm[data-from]').forEach(a => a.addEventListener('click', ev => { ev.stopPropagation(); closeReplay(); fmFrom = +a.dataset.from; rpGo(key, +a.dataset.id); }));")
rep("var rpKey = null;",
    "var rpKey = null;\n"
    "function fmPosHtml(n) {   /* 小屋版：这期听到哪了 */\n"
    "  const p = fmPosAll()[n.id];\n"
    "  if (!p) return '';\n"
    "  if (p.seg >= p.n) return '<span class=\"rsm done\">听完了 · 点标题从头再听</span>';\n"
    "  if (p.seg < 1) return '';\n"
    "  return `<span class=\"rsm\" data-id=\"${n.id}\" data-from=\"${p.seg}\">上回听到第 ${p.seg + 1}/${p.n} 段 · 接着听 →</span>`;\n"
    "}")
rep(".rp .none{", ".rp li span.rsm{color:var(--red);font-weight:700;cursor:pointer}\n.rp li span.rsm.done{color:var(--ink3);font-weight:500;cursor:inherit}\n.rp .none{")

# 9b. 歌放不出来（还没存进小屋、文件坏了）：不悄悄跳过。单子里留一行「✕ 《歌名》 — 歌手 / 这首没放出来」，后面是去网易云听的口子
rep("    catch (e) { toast('《' + part.title + '》放不出来'); await sleep(1500); return; }",
    "    catch (e) { part._fail = (e && e.message) || '放不出来'; toast('《' + part.title + '》' + part._fail); await sleep(1500); return; }")
rep("  if (!r || !r.url) { toast('《' + part.title + '》放不出来'); return; }",
    "  if (!r || !r.url) { part._fail = '放不出来'; toast('《' + part.title + '》放不出来'); return; }")
rep("    songEl.onerror = () => { toast('《' + part.title + '》放到一半断了'); done(); };",
    "    songEl.onerror = () => { const t0 = songEl.currentTime || 0; if (t0 < 1) part._fail = '这首没放出来'; toast('《' + part.title + '》' + (t0 < 1 ? '没放出来' : '放到一半断了')); done(); };")
rep("    if (!S.gone) S.log.push(['♪', item.title + (item.artist ? ' — ' + item.artist : ''), S.now.at]);",
    "    if (!S.gone) S.log.push(item._fail ? ['✕', '《' + item.title + '》' + (item.artist ? ' — ' + item.artist : '') + '\\n' + item._fail, S.now.at, false, { ori: item.ori || '', q: item.title + (item.artist ? ' ' + item.artist : '') }]\n"
    "      : ['♪', item.title + (item.artist ? ' — ' + item.artist : ''), S.now.at]);")

# 10. 播客台（106.1）：YouTube 上别人的节目，用 YouTube 官方播放器嵌进来放，不下载不转存。节目单在 data/pod.json（tools/fm/pod.py 管）。
#     这台不开播、不走队列：进台只画节目单，点封面才加载播放器（一次只留一个在放）。
rep("'歌都存在小屋里，整首放。'] },\n", "'歌都存在小屋里，整首放。'] },\n"
    "  { key: 'pod', f: 106.1, name: '播客', en: 'PODCAST', side: 'D', desc: 'YouTube 上挑的几档节目，点开就听。',\n"
    "    tape: { shell: '#3A3431', dk: '#26211F', label: '#FBF8F2', stripe: '#D0271D', sInk: '#fff', name: '#171312', ink: '#1b1614', shellInk: 'rgba(255,255,255,.6)', note: 'Pod.01' },\n"
    "    rules: ['这台不是我录的：挂的是 YouTube 上别人的节目，用 YouTube 自己的播放器放，小屋不下载、不转存。', '每晚我看一遍这几个频道，有新的公开节目就换上最新的。会员专享的放不了，不挂。', '每期底下一句是我为什么挑它。标着「听过」的，是我从头听完才写的真话；没标的还是照标题和简介写的。标着「Miles 加的」是我自己找来的频道。', '红键在这台不管用，点节目封面就放。'] },\n")
rep("104 1 2026</text>`,\n};", "104 1 2026</text>`,\n"
    "  pod: c => `<rect x=\"260\" y=\"126\" width=\"28\" height=\"20\" rx=\"6\" fill=\"${c.stripe}\"/><path d=\"M270.5 131 L279.5 136 L270.5 141 Z\" fill=\"#fff\"/><text x=\"258\" y=\"160\" font-family=\"'IBM Plex Mono',monospace\" font-size=\"4.6\" fill=\"${c.ink}\">106 1 POD</text>`,\n};")
rep("function enter(i) {\n  const s = ST[i];\n",
    "function enter(i) {\n  const s = ST[i];\n"
    "  if (s.key === 'pod') { sess = { key: 'pod', st: s, queue: [], inflight: null, log: [], now: null, ended: false, waiting: [], ordered: false, showText: true, err: '' }; drawNotes(); lcd('YouTube 节目 · 点封面就放'); return; }\n")
rep("  if (!sess) { n.innerHTML = ''; return; }\n  const S = sess;\n",
    "  if (!sess) { n.innerHTML = ''; return; }\n  if (sess.key === 'pod') { $('rule').style.visibility = ''; if (!sess.podDrawn) { sess.podDrawn = true; drawPod(); } return; }\n  const S = sess;\n")
rep("$('bPlay').addEventListener('click', () => {\n",
    "$('bPlay').addEventListener('click', () => {\n"
    "  if (sess && sess.key === 'pod') { audioOn(); started = true; $('bPlay').classList.remove('wait'); toast('这台点下面的节目封面放'); const f = document.querySelector('.pod-v'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }\n")
rep("  if (!started) { started = true; audioOn(); setPaused(false); }\n  if (!sess.ordered) { toast('先点单，开播以后再说'); return; }",
    "  if (sess.key === 'pod') { toast('这台放的是 YouTube 节目，纸条和点歌换到别的台递'); return; }\n"
    "  if (!started) { started = true; audioOn(); setPaused(false); }\n  if (!sess.ordered) { toast('先点单，开播以后再说'); return; }")
rep("  if (e.target.closest('.btn,#mic,button,a,input,.tun-l,.ord,.chip')) return;",
    "  if (e.target.closest('.btn,#mic,button,a,input,.tun-l,.ord,.chip,.pod-v')) return;")
rep("function fmtDay(t) {",
    "var POD = null;   /* 小屋版：播客台 */\n"
    "async function podLoad() { if (POD && !POD.bad) return POD; try { const r = await fetch('data/pod.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0; POD = await r.json(); } catch (e) { POD = { channels: [], eps: [], bad: true }; } return POD; }\n"
    "function podDur(s) { const m = Math.round((s || 0) / 60); return m >= 60 ? Math.floor(m / 60) + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : '') : m + ' 分钟'; }\n"
    "async function drawPod() {\n"
    "  const n = $('notes');\n"
    "  n.innerHTML = '<div class=\"pod-head\">翻节目单…</div>';\n"
    "  const d = await podLoad();\n"
    "  if (!sess || sess.key !== 'pod') return;\n"
    "  if (!d.eps || !d.eps.length) { n.innerHTML = '<div class=\"err\">节目单没拿到，过会儿再来。</div>'; sess.podDrawn = false; return; }\n"
    "  const ch = {}; (d.channels || []).forEach(c => ch[c.id] = c);\n"
    "  let h = '<div class=\"pod-head\">YouTube 上挑的几档节目 · 点封面就放' + (d.updated ? ' · ' + fmtDay(d.updated) + '换的' : '') + '</div>', last = null;\n"
    "  d.eps.forEach(e => {\n"
    "    const c = ch[e.ch] || { name: '', about: '' };\n"
    "    if (e.ch !== last) { last = e.ch; h += `<div class=\"pod-ch\"><a href=\"https://www.youtube.com/channel/${esc(e.ch)}\" target=\"_blank\" rel=\"noopener\">${esc(c.name)}</a>${c.by === 'miles' ? '<span class=\"pod-mine\">Miles 加的</span>' : ''}<p>${esc(c.about || '')}</p></div>`; }\n"
    "    h += `<div class=\"pod-ep\"><div class=\"pod-v\" role=\"button\" tabindex=\"0\" data-v=\"${esc(e.id)}\" aria-label=\"播放 ${esc(e.title)}\"><img loading=\"lazy\" src=\"https://i.ytimg.com/vi/${esc(e.id)}/hqdefault.jpg\" alt=\"\"><span class=\"pod-pl\">▶</span><span class=\"pod-d\">${podDur(e.secs)}</span></div><div class=\"pod-t\">${esc(e.title)}</div><div class=\"pod-m\">${esc(e.date || '')} · <a href=\"https://www.youtube.com/watch?v=${esc(e.id)}\" target=\"_blank\" rel=\"noopener\">去 YouTube 看</a></div><div class=\"pod-s\">${e.heard ? '<span class=\"pod-heard\">听过</span>' : ''}${esc(e.say)}</div></div>`;\n"
    "  });\n"
    "  h += '<div class=\"pod-foot\">用的是 YouTube 自己的播放器，节目是人家的，小屋不下载不转存。放不出来就点「去 YouTube 看」。</div>';\n"
    "  n.innerHTML = h;\n"
    "  n.querySelectorAll('.pod-v').forEach(b => { b.addEventListener('click', () => podPlay(b)); b.addEventListener('keydown', ev => { if (ev.key === 'Enter') podPlay(b); }); });\n"
    "  podWall(n, d.eps[0].id);\n"
    "}\n"
    "function podWall(n, id) {\n"
    "  /* 封面拉不下来，多半是连不上 YouTube（墙）：顶上挂一句，别让人干点 */\n"
    "  let done = false; const im = new Image();\n"
    "  const bad = () => { if (done) return; done = true; if (!sess || sess.key !== 'pod' || n.querySelector('.pod-wall')) return; const w = document.createElement('div'); w.className = 'pod-wall'; w.textContent = '封面是黑的？那是你这边连不上 YouTube，播放器也出不来。开梯子再点封面就能放。'; n.insertBefore(w, n.firstChild.nextSibling); };\n"
    "  im.onload = () => { if (done) return; done = true; if (im.naturalWidth < 2) { done = false; bad(); } };\n"
    "  im.onerror = bad; setTimeout(bad, 6000);\n"
    "  im.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/default.jpg?t=' + Date.now();\n"
    "}\n"
    "function podPlay(b) {\n"
    "  if (b.classList.contains('on')) return;\n"
    "  document.querySelectorAll('.pod-v.on').forEach(x => { x.classList.remove('on'); x.innerHTML = x._h; });\n"
    "  b._h = b.innerHTML; b.classList.add('on');\n"
    "  b.innerHTML = `<iframe src=\"https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.v)}?autoplay=1&playsinline=1&rel=0\" title=\"YouTube\" allow=\"autoplay; encrypted-media; picture-in-picture; fullscreen\" referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>`;\n"
    "  lcd('在放 YouTube 节目');\n"
    "}\n"
    "function fmtDay(t) {")
rep("</style>", ".pod-wall{margin:4px 0 14px;padding:10px 12px;border:1px solid var(--red);border-radius:4px;font:400 12px/1.6 var(--serif);color:var(--red)}\n"
    ".pod-head{font:500 9px/1.6 var(--mono);letter-spacing:.12em;color:var(--ink3);margin-bottom:6px}\n"
    ".pod-ch{margin:22px 0 10px;padding-top:12px;border-top:1px solid var(--line)}\n"
    ".pod-ch a{font:700 15px/1.3 var(--serif);color:var(--ink);text-decoration:none}\n"
    ".pod-mine{margin-left:8px;font:700 8px/1 var(--mono);letter-spacing:.12em;color:#fff;background:var(--red);padding:3px 6px;border-radius:2px;vertical-align:2px}\n"
    ".pod-ch p{margin:6px 0 0;font:400 12px/1.6 var(--serif);color:var(--ink2)}\n"
    ".pod-ep{margin:0 0 18px}\n"
    ".pod-v{position:relative;aspect-ratio:16/9;background:#000;border-radius:4px;overflow:hidden;cursor:pointer}\n"
    ".pod-v img{width:100%;height:100%;object-fit:cover;display:block;opacity:.88}\n"
    ".pod-v iframe{position:absolute;inset:0;width:100%;height:100%;border:0}\n"
    ".pod-pl{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:var(--red);color:#fff;font-size:17px;display:flex;align-items:center;justify-content:center;padding-left:3px;box-sizing:border-box}\n"
    ".pod-d{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.72);color:#fff;font:500 9px/1 var(--mono);padding:3px 5px;border-radius:2px}\n"
    ".pod-t{margin-top:8px;font:600 13px/1.5 var(--serif);color:var(--ink)}\n"
    ".pod-m{margin-top:3px;font:500 9px/1.5 var(--mono);color:var(--ink3)}\n"
    ".pod-m a{color:var(--ink3)}\n"
    ".pod-s{margin-top:5px;font:400 12px/1.6 var(--serif);color:var(--red)}\n"
    ".pod-heard{margin-right:6px;font:700 8px/1 var(--mono);letter-spacing:.12em;color:var(--red);border:1px solid var(--red);padding:2px 5px;border-radius:2px;vertical-align:1px}\n"
    ".pod-foot{margin-top:18px;font:400 11px/1.6 var(--serif);color:var(--ink3)}\n</style>")

open(os.path.join(HOME, 'fm.html'), 'w', encoding='utf-8').write(src)
print('fm.html ok', len(src))
