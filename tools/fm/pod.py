#!/usr/bin/env python3
"""播客台（fm.html 里的「播客」，106.9）：挂 YouTube 上别人的节目，用 YouTube 官方播放器嵌进来放。

规矩：不下载、不转存别人的音频，小屋只放链接和嵌入播放器。每晚看一遍频道，有新的公开节目就换上。
数据在 data/pod.json：channels（频道，by=her 是她点的，by=miles 是我加的）和 eps（现在挂着的节目）。
每期的 say 是我一句话的推荐，我自己写；没看过的不写成看过。

用法（在 miles-home 目录里跑）：
  python3 tools/fm/pod.py fetch [--n 2]      # 每个频道挑最近 n 期能嵌入的公开节目，写 /tmp/pod_new.json
                                             # 已经挂着的那期 say 会带过来；新的 say 是空的，要我填
  python3 tools/fm/pod.py apply /tmp/pod_new.json   # say 都填好了才写进 data/pod.json
  python3 tools/fm/pod.py show
  python3 tools/fm/pod.py add-channel --id UCxxxx --name 名字 --by her|miles --about "一句话"
挑节目的条件：公开（会员专享、私享的不要）、允许嵌入、不是直播、时长至少 5 分钟、不是 Shorts（只看频道的「影片」页）。
"""
import argparse, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(HOME, 'data', 'pod.json')
YTDLP = os.path.expanduser('~/.local/bin/yt-dlp')
LANG = ['--extractor-args', 'youtube:lang=zh-TW']


def load():
    if os.path.exists(DATA):
        return json.load(open(DATA, encoding='utf-8'))
    return {'updated': 0, 'channels': [], 'eps': []}


def save(d):
    d['updated'] = int(time.time() * 1000)
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write('\n')


def run(args, timeout=90):
    p = subprocess.run([YTDLP] + LANG + args, capture_output=True, text=True, timeout=timeout)
    return p.stdout, p.stderr


def recent_ids(cid, k=10):
    out, err = run(['-J', '--flat-playlist', '--playlist-items', '1-%d' % k, 'https://www.youtube.com/channel/%s/videos' % cid])
    try:
        d = json.loads(out)
    except Exception:
        raise RuntimeError('频道页没拿到：' + (err.strip().splitlines() or ['?'])[-1][:160])
    return [e['id'] for e in d.get('entries') or [] if e.get('id')]


def video(vid):
    try:
        out, err = run(['-J', '--skip-download', '--no-playlist', 'https://www.youtube.com/watch?v=' + vid], timeout=60)
    except subprocess.TimeoutExpired:
        return {'id': vid, 'ok': False, 'why': '超时'}
    try:
        d = json.loads(out)
        assert isinstance(d, dict)
    except Exception:
        msg = (err.strip().splitlines() or ['?'])[-1]
        why = '会员专享' if ('會員' in msg or 'members' in msg.lower()) else msg[:120]
        return {'id': vid, 'ok': False, 'why': why}
    why = ''
    if d.get('availability') not in (None, 'public', 'unlisted'):
        why = 'availability=%s' % d.get('availability')
    elif d.get('playable_in_embed') is False:
        why = '不让嵌入'
    elif d.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        why = '直播'
    elif (d.get('duration') or 0) < 300:
        why = '太短'
    elif re.search(r'會員專享|会员专享|會員限定|会员限定', d.get('title') or ''):
        why = '会员'
    ud = d.get('upload_date') or ''
    return {'id': vid, 'ok': not why, 'why': why, 'title': d.get('title') or '',
            'date': '%s-%s-%s' % (ud[:4], ud[4:6], ud[6:8]) if len(ud) == 8 else '',
            'secs': int(d.get('duration') or 0), 'desc': (d.get('description') or '')[:300]}


def cmd_fetch(a):
    d = load()
    old = {e['id']: e for e in d['eps']}
    res = {'channels': [], 'eps': [], 'errors': []}
    for ch in d['channels']:
        try:
            ids = recent_ids(ch['id'], 30)
        except Exception as ex:
            res['errors'].append({'ch': ch['name'], 'err': str(ex)})
            # 频道这次没查到：先把它原来挂着的留着
            res['eps'] += [e for e in d['eps'] if e['ch'] == ch['id']]
            continue
        infos = []
        for i in range(0, len(ids), 8):  # 一批批往下翻，够 n 期就停
            with ThreadPoolExecutor(5) as ex:
                infos += list(ex.map(video, ids[i:i + 8]))
            if sum(v['ok'] for v in infos) >= a.n:
                break
        picks = [v for v in infos if v['ok']][:a.n]
        skipped = [(v['id'], v['why']) for v in infos if not v['ok']]
        res['channels'].append({'ch': ch['name'], 'picked': len(picks), 'skipped': skipped})
        if not picks:
            res['errors'].append({'ch': ch['name'], 'err': '最近 %d 期里没有能嵌入的公开节目' % len(ids)})
            res['eps'] += [e for e in d['eps'] if e['ch'] == ch['id']]
            continue
        for v in picks:
            o = old.get(v['id'])
            res['eps'].append({'ch': ch['id'], 'id': v['id'], 'title': v['title'], 'date': v['date'], 'secs': v['secs'],
                               'say': o['say'] if o else '', 'new': not o, 'desc': v['desc']})
    out = a.out
    json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    new = [e for e in res['eps'] if e.get('new')]
    print('fetch ok -> %s：挂 %d 期，新的 %d 期（say 要填），出错 %d 个频道' % (out, len(res['eps']), len(new), len(res['errors'])))
    names = {c['id']: c['name'] for c in d['channels']}
    for e in res['eps']:
        print(('  [新] ' if e.get('new') else '  ') + names.get(e['ch'], e['ch']) + ' | ' + e['id'] + ' | ' + e['date'] + ' | ' + e['title'][:60])
    for c in res['channels']:
        if c['skipped']:
            from collections import Counter
            print('  跳过 %s：%s' % (c['ch'], '，'.join('%s %d 期' % kv for kv in Counter(w for _, w in c['skipped']).items())))
    for e in res['errors']:
        print('  !! %s：%s' % (e['ch'], e['err']))


def cmd_apply(a):
    d = load()
    r = json.load(open(a.file, encoding='utf-8'))
    chs = {c['id'] for c in d['channels']}
    eps = []
    for e in r['eps']:
        say = (e.get('say') or '').strip()
        if not say:
            sys.exit('还有没写推荐的：%s %s' % (e['id'], e['title'][:40]))
        if len(say) > 80 or re.search(r'https?://|www\.', say):
            sys.exit('推荐太长或带了链接：%s' % say)
        if e['ch'] not in chs or not re.fullmatch(r'[\w-]{11}', e['id']):
            sys.exit('对不上的条目：%s' % e)
        eps.append({k: e[k] for k in ('ch', 'id', 'title', 'date', 'secs')} | {'say': say})
    if not eps:
        sys.exit('一期都没有，不写')
    d['eps'] = eps
    save(d)
    print('apply ok：%d 期' % len(eps))


def cmd_show(a):
    d = load()
    names = {c['id']: c['name'] + ('（我加的）' if c.get('by') == 'miles' else '') for c in d['channels']}
    print('updated', time.strftime('%Y-%m-%d %H:%M', time.localtime(d['updated'] / 1000)) if d['updated'] else '-')
    for e in d['eps']:
        print('%s | %s | %s | %s\n    %s' % (names.get(e['ch']), e['date'], e['id'], e['title'][:60], e['say']))


def cmd_add(a):
    d = load()
    if any(c['id'] == a.id for c in d['channels']):
        sys.exit('已经有了')
    d['channels'].append({'id': a.id, 'name': a.name, 'by': a.by, 'about': a.about})
    save(d)
    print('add ok')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest='c', required=True)
    f = s.add_parser('fetch'); f.add_argument('--n', type=int, default=2); f.add_argument('--out', default='/tmp/pod_new.json'); f.set_defaults(fn=cmd_fetch)
    f = s.add_parser('apply'); f.add_argument('file'); f.set_defaults(fn=cmd_apply)
    f = s.add_parser('show'); f.set_defaults(fn=cmd_show)
    f = s.add_parser('add-channel'); f.add_argument('--id', required=True); f.add_argument('--name', required=True)
    f.add_argument('--by', choices=['her', 'miles'], required=True); f.add_argument('--about', default=''); f.set_defaults(fn=cmd_add)
    a = p.parse_args(); a.fn(a)
