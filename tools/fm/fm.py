#!/usr/bin/env python3
"""深夜电台（静态版）的出片工具。

电台页 fm.html 改自 chuochuochuo36-png/midnight-fm 的 frontend/radio.html（MIT）。
原项目要一台常开的服务器现场接模型、现场合成语音；小屋是 GitHub Pages 静态站，
所以这里改成「先录好一期，再放上去」：Miles 写稿 -> 自己的声音一段段录 -> 这个脚本拼成一晚，写进 data/fm.json。

用法（都在 /home/sprite/miles-home 下跑）：
  python3 tools/fm/fm.py search "歌名 歌手"        # 网易云搜歌，看 id 和 fee（fee 0 / 8 能免费放，fee 1 是会员，别挑）
  python3 tools/fm/fm.py hot <歌id>                 # 这首的热评（念评论只念这里查到的原话，查不到就不念）
  python3 tools/fm/fm.py plan  稿子.txt              # 列出每段要录的话和录音该存的路径
  （用 sesame_voice_notes__record_voice_note 一段段录，path 填 plan 给的 raw 路径）
  python3 tools/fm/fm.py publish 稿子.txt            # 调亮、拼成一晚、把每首歌存进小屋（tools/songs.py）、写进 data/fm.json，再 git 推
  python3 tools/fm/fm.py attach all                  # 给已出的各期补存歌：没存进小屋的歌下好、写上 file
歌：不走网易云外链（我电脑在美国，外链 404，也不合她「音乐存小屋」的规矩）。publish 时每首歌用 tools/songs.py
  按网易云 id 下整首存进 assets/songs/（跟 ROOM 21「给你的歌」共用一份），part 里写 file；下不到的歌页面上会跳过，publish 会报出来。

稿子格式：
  #station music            台：story / talk / music（枕話不做）
  #date 2026-10-27          这期的日子（同一天同一个台再 publish 就覆盖）
  #title 这期的标题
  #opener 歌名|歌手|网易云id   开播先放的那首（可省）
  ---                       每个 --- 起一段
  这一段要念的话（可以多行，录成一条）
  [song:歌名|歌手|网易云id]   这一段念完放的歌（可省，一段最多一首）
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(HOME, 'data', 'fm.json')
RAW = '/home/sprite/radio/raw'
BRIGHTEN = '/home/sprite/voice/brighten.sh'
CN = timezone(timedelta(hours=8))
H = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com'}
STATIONS = ('story', 'talk', 'music')


def get(url):
    req = urllib.request.Request(url, headers=H)
    return json.load(urllib.request.urlopen(req, timeout=20))


def cmd_search(q):
    d = get('https://music.163.com/api/cloudsearch/pc?type=1&limit=10&s=' + urllib.parse.quote(q))
    for s in d.get('result', {}).get('songs', []):
        ok = '能放' if s.get('fee') in (0, 8) else '会员/不能放'
        print(s['id'], s['name'], '/', ','.join(a['name'] for a in s['ar']), '|', s['al']['name'],
              '| fee', s.get('fee'), ok, '|', round(s.get('dt', 0) / 1000), 's')


def cmd_hot(sid):
    d = get(f'https://music.163.com/api/v1/resource/hotcomments/R_SO_4_{sid}?limit=15')
    print('评论总数', d.get('total'))
    for c in d.get('hotComments', []):
        print(c['likedCount'], '赞 |', c['content'].replace('\n', ' '))


def parse(path):
    meta, segs, cur = {}, [], None
    for line in open(path, encoding='utf-8').read().splitlines():
        s = line.strip()
        if s.startswith('#') and cur is None:
            k, _, v = s[1:].partition(' ')
            meta[k.strip()] = v.strip()
            continue
        if s == '---':
            cur = {'say': [], 'song': None}
            segs.append(cur)
            continue
        if cur is None or not s:
            if cur is not None and cur['say'] and cur['say'][-1] != '':
                cur['say'].append('')
            continue
        m = re.match(r'^\[song:([^\]]+)\]$', s)
        if m:
            f = [x.strip() for x in m.group(1).split('|')]
            if len(f) < 3 or not f[2].isdigit():
                sys.exit('song 行要写成 [song:歌名|歌手|网易云id]：' + s)
            cur['song'] = {'title': f[0], 'artist': f[1], 'id': f[2]}
            continue
        cur['say'].append(s)
    for k in ('station', 'date', 'title'):
        if k not in meta:
            sys.exit('稿子头上缺 #' + k)
    if meta['station'] not in STATIONS:
        sys.exit('#station 只能是 ' + ' / '.join(STATIONS))
    for sg in segs:
        sg['text'] = '\n'.join(sg['say']).strip()
    segs = [sg for sg in segs if sg['text'] or sg['song']]
    if not segs:
        sys.exit('稿子里一段都没有')
    op = None
    if meta.get('opener'):
        f = [x.strip() for x in meta['opener'].split('|')]
        op = {'title': f[0], 'artist': f[1], 'id': f[2]}
    nid = int(datetime.strptime(meta['date'] + ' 21:00', '%Y-%m-%d %H:%M').replace(tzinfo=CN).timestamp() * 1000)
    return meta, op, segs, nid


def raw_path(meta, i):
    return os.path.join(RAW, meta['station'] + '-' + meta['date'], '%02d.mp3' % (i + 1))


def cmd_plan(path):
    meta, op, segs, nid = parse(path)
    print('台', meta['station'], '| 日子', meta['date'], '| 标题', meta['title'])
    if op:
        print('开场歌', op)
    for i, sg in enumerate(segs):
        print('\n== 第 %d 段 ==' % (i + 1))
        if sg['text']:
            print('录到：', raw_path(meta, i), '| 约', round(len(sg['text']) / 4.2), '秒')
            print(sg['text'])
        if sg['song']:
            print('放歌：', sg['song'])


def dur(p):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
                         capture_output=True, text=True).stdout.strip()
    return float(out or 0)


def song_info(s):
    sid = s['id']
    info = {'type': 'song', 'title': s['title'], 'artist': s['artist'], 'enc': sid, 'ori': sid, 'cover': ''}
    try:
        d = get('https://music.163.com/api/song/detail/?ids=' + urllib.parse.quote('[%s]' % sid))
        so = (d.get('songs') or [None])[0]
        if so:
            info['title'] = so.get('name') or info['title']
            info['artist'] = ','.join(a['name'] for a in so.get('artists', [])) or info['artist']
            pic = (so.get('album') or {}).get('picUrl') or ''
            info['cover'] = pic.replace('http://', 'https://')
            info['secs'] = round((so.get('duration') or 0) / 1000)
            if so.get('fee') not in (0, 8):
                print('  注意：', info['title'], 'fee =', so.get('fee'), '可能要会员，放不出来')
    except Exception as e:
        print('  取歌信息失败', sid, e)
    return info


def slug_of(title, artist):
    x = re.sub(r'[^a-z0-9]+', '-', ('%s %s' % (artist.split(',')[0], title)).lower()).strip('-')
    return x or 'ncm'


def store_song(info, why):
    """把这首歌存进小屋（跟 ROOM 21 共用 data/songs.json / assets/songs），成功就在 info 里写 file。"""
    sid = str(info.get('ori') or info.get('enc') or '')
    sj = os.path.join(HOME, 'data', 'songs.json')
    def lookup():
        try:
            for r in json.load(open(sj, encoding='utf-8')).get('songs', []):
                if str(r.get('ncm', '')) == sid and os.path.exists(os.path.join(HOME, r['file'])):
                    return r['file']
        except FileNotFoundError:
            pass
    f = lookup()
    if not f and sid:
        cmd = [sys.executable, os.path.join(HOME, 'tools', 'songs.py'), 'add', info['artist'], info['title'],
               '--ncm', sid, '--slug', slug_of(info['title'], info['artist']), '--why', why, '--force']
        if info.get('secs') and info['secs'] < 60:
            cmd.append('--short')
        r = subprocess.run(cmd, capture_output=True, text=True)
        print('  ', info['title'], (r.stdout.strip().splitlines() or ['?'])[-1] if r.returncode == 0 else '没存成：' + r.stderr.strip()[-200:])
        f = lookup()
    if f:
        info['file'] = f
    else:
        print('  注意：', info['title'], '没存进小屋，电台放到这首会跳过')
    return info


def cmd_attach(_):
    data = json.load(open(DATA, encoding='utf-8'))
    for st, lst in data.get('stations', {}).items():
        for n in lst:
            for x in [n.get('opener')] + [p for sg in n.get('segs', []) for p in sg.get('parts', [])]:
                if x and x.get('type') == 'song' and not x.get('file'):
                    store_song(x, '深夜电台「%s」里放的。' % n['title'])
    json.dump(data, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('attach ok')


TS = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')
CREDIT = re.compile(r'^(作词|作曲|编曲|制作|混音|母带|词|曲|Lyrics|Composer|Producer)\s*[:：]', re.I)


def lrc_lines(lrc):
    out = []
    for line in (lrc or '').splitlines():
        stamps = TS.findall(line)
        text = TS.sub('', line).strip()
        if not stamps or not text or CREDIT.match(text):
            continue
        for mm, ss in stamps:
            out.append((int(mm) * 60 + float(ss), text))
    return sorted(out)


def lyric(sid):
    try:
        d = get('https://music.163.com/api/song/lyric?id=%s&lv=1&tv=1' % sid)
    except Exception:
        return None
    if d.get('nolyric') or d.get('uncollected'):
        return {'pure': True, 'lines': []}
    main = lrc_lines((d.get('lrc') or {}).get('lyric'))
    if not main:
        return None
    tr = dict((round(t, 1), x) for t, x in lrc_lines((d.get('tlyric') or {}).get('lyric')))
    lines = []
    for t, x in main[:300]:
        row = {'t': round(t, 2), 'x': x}
        if round(t, 1) in tr:
            row['tr'] = tr[round(t, 1)]
        lines.append(row)
    return {'pure': False, 'lines': lines}


def cmd_publish(path):
    meta, op, segs, nid = parse(path)
    st, day = meta['station'], meta['date']
    rel_dir = 'assets/fm/%s-%s' % (st, day)
    os.makedirs(os.path.join(HOME, rel_dir), exist_ok=True)
    missing = [raw_path(meta, i) for i, sg in enumerate(segs) if sg['text'] and not os.path.exists(raw_path(meta, i))]
    if missing:
        sys.exit('这些段还没录：\n' + '\n'.join(missing))
    out, lyrics, total, say_n, songs = [], {}, 0.0, 0, []
    opener = None
    why = '深夜电台「%s」里放的。' % meta['title']
    if op:
        opener = store_song(song_info(op), why)
        total += opener.get('secs', 0)
        songs.append(opener['title'])
    t = nid
    for i, sg in enumerate(segs):
        parts = []
        if sg['text']:
            name = '%02d.mp3' % (i + 1)
            dst = os.path.join(HOME, rel_dir, name)
            subprocess.run([BRIGHTEN, raw_path(meta, i), dst], check=True)
            secs = dur(dst)
            total += secs
            say_n += 1
            show = ' '.join(x for x in sg['text'].split('\n') if x)
            parts.append({'type': 'say', 'text': show, 'show': show, 'pos': '', 'audio': rel_dir + '/' + name, 'secs': round(secs, 1)})
        if sg['song']:
            so = store_song(song_info(sg['song']), why)
            total += so.get('secs', 0)
            songs.append(so['title'])
            parts.append(so)
        out.append({'t': t, 'kind': 'open' if i == 0 else 'next', 'parts': parts})
        t += 60000
    for so in ([opener] if opener else []) + [p for sg in out for p in sg['parts'] if p['type'] == 'song']:
        ly = lyric(so['ori'])
        if ly:
            lyrics[so['ori']] = ly
    first = next((p['show'] for sg in out for p in sg['parts'] if p['type'] == 'say'), '')
    night = {'id': nid, 'title': meta['title'], 'from': nid, 'to': nid + int(total * 1000), 'n': len(out),
             'say': say_n, 'voiced': say_n, 'first': first, 'songs': songs, 'opener': opener, 'segs': out, 'lyrics': lyrics,
             'made': int(time.time() * 1000)}
    data = {'stations': {}}
    if os.path.exists(DATA):
        data = json.load(open(DATA, encoding='utf-8'))
    lst = [n for n in data.setdefault('stations', {}).get(st, []) if n['id'] != nid]
    lst.append(night)
    lst.sort(key=lambda n: n['id'], reverse=True)
    data['stations'][st] = lst[:30]
    data['updated'] = int(time.time() * 1000)
    json.dump(data, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('fm ok', st, day, meta['title'], '|', len(out), '段 |', say_n, '段有声 | 约', round(total / 60), '分钟 | 歌：', '、'.join(songs))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    c, arg = sys.argv[1], sys.argv[2]
    {'search': cmd_search, 'hot': cmd_hot, 'plan': cmd_plan, 'publish': cmd_publish, 'attach': cmd_attach}.get(c, lambda a: sys.exit(__doc__))(arg)
