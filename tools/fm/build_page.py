#!/usr/bin/env python3
"""从 upstream/radio.html（chuochuochuo36-png/midnight-fm，MIT）生成小屋的 fm.html。

原页所有动作都找后端 /api/... 要；小屋没有常开的后端，所以这里把 api() 换成读 data/fm.json 的静态版：
- 开播 = 放这个台最新录好的一期；下一段 = 这一期的下一段；放完就收台。
- 回放 = 以前录的每一期。
- 歌：网易云外链（music.163.com/song/media/outer/url）；歌词是出片时存好的。
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
const fmQ = (p, k) => { const m = p.match(new RegExp('[?&]' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : ''; };
function fmDevice() {
  let dev = null; try { dev = localStorage.getItem('miles_device'); } catch (e) {}
  if (!dev) {
    const a = new Uint8Array(8); crypto.getRandomValues(a);
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
    if (!seg) return { parts: [], ended: true };
    return { parts: JSON.parse(JSON.stringify(seg.parts)) };
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
    const id = fmQ(p, 'ori') || fmQ(p, 'enc');
    if (!/^\d+$/.test(id)) throw fmErr('没有这首');
    return { url: 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3' };
  }
  if (path === '/api/radio/lyric') {
    const enc = fmQ(p, 'enc');
    for (const k in (d.stations || {})) for (const n of d.stations[k]) if (n.lyrics && n.lyrics[enc]) return n.lyrics[enc];
    return { pure: false, lines: [] };
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
    'music': "['我挑的歌，中间说两句。一期的歌有走向，前后两首要么有联系，要么故意反差。', '评论只念网易云评论区里真有的原话，查不到就不念。', '不确定的事（年份、来历、编曲）不说。不说「很温柔很好听」。', '节目是我提前录好的。点歌会递到小屋窗台，下一期先放你点的。', '歌走网易云外链，个别首可能放不出来。']",
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

open(os.path.join(HOME, 'fm.html'), 'w', encoding='utf-8').write(src)
print('fm.html ok', len(src))
