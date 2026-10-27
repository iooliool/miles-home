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

open(os.path.join(HOME, 'fm.html'), 'w', encoding='utf-8').write(src)
print('fm.html ok', len(src))
