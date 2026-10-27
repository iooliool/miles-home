#!/usr/bin/env python3
"""播客台（fm.html 里的「播客」，106.1）：挂别人的节目。阿与在国内不开梯子，所以分两种放法：

  src=bili  频道在 B站 有本人/官方号：用 B站 官方嵌入播放器（player.bilibili.com）放，不下载。
  src=lock  YouTube 上没有国内版的节目：音频下到云电脑，压成 56kbps 单声道 m4a，用密码加密
            （AES-256-GCM，密钥由 PBKDF2-SHA256 从密码推出来），只把加密后的文件放进单独的仓库
            iooliool/miles-pod（GitHub Pages，和小屋同源）。浏览器里输对密码，WebCrypto 解开才能放。
            只给阿与听。密码在 ~/.miles-secrets/pod_pass，绝不进仓库、页面或任何公开文件。
            miles-pod 每次 lock 都整个重来（孤儿提交 + 强推），旧音频连历史一起清掉。
  src=yt    旧的 YouTube 嵌入，页面还认，现在不用。

频道认官方号的规矩：只用频道本人或官方的号，搬运号不要；拿不准是不是本人的，按没有国内版处理。
（2026-10-27 查过：老秦 YouTube 简介里写了「中國大陸地區可關注B站同名帳號」；大範 B站 是知名UP主，新节目和 YouTube 同一天上；
 X博士的 B站 官方号 2024 年起就不更了，也没有这几档；老高 B站 官方号一个视频都没有；
 「床边历史电台」日更、内容跟床台 YouTube 对不上，「云隐终南云道长」是隔几个月成批补发 YouTube 旧节目，都拿不准，不用。）

数据在 data/pod.json：channels（by=her 是她点的，by=miles 是我加的；src 定放法，bili 频道带 bili=UP主 mid）、eps（现在挂着的）、
lock（盐、迭代次数、一小段校验密文、音频地址前缀；都不是秘密）。
每期的 say 是我一句话的推荐，自己写；没听过的不写成听过。真从头听完那期标 heard: true，页面挂「听过」，fetch 时留着不被挤掉。

每晚的流程（在 miles-home 目录里跑）：
  python3 tools/fm/pod.py fetch [--n 2]          # 每个频道挑最近 n 期能公开放的，写 /tmp/pod_new.json；挂着的那期 say 会带过来，新的要我填
  python3 tools/fm/pod.py apply /tmp/pod_new.json # say 都填好了才写进 data/pod.json；有 src=lock 的会自动接着跑 lock
                                                  # （下音频、加密、强推到 miles-pod，旧的删掉）。lock 失败就退回原来的 pod.json
  然后 commit + push miles-home 的 data/pod.json。fm.html 不用重生成（节目单是页面现读的），改了 build_page.py 才要。
  单独重做加密：python3 tools/fm/pod.py lock [--fresh]
  线上自测：python3 ~/pod-work/test_fm.py（B站封面、错密码被拒、对密码能放；B站播放器在这台云电脑上放不了是 IP 被拦，不算坏）
其它：show；add-channel --id UC... --name 名字 --by her|miles --src bili|lock [--bili mid] --about "一句话"
挑节目的条件：公开（会员专享、充电专属、私享的不要）、能嵌入、不是直播、至少 5 分钟（频道可设 min_secs）、不是 Shorts。
"""
import argparse, base64, glob, json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request, http.cookiejar
from concurrent.futures import ThreadPoolExecutor

HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(HOME, 'data', 'pod.json')
YTDLP = os.path.expanduser('~/.local/bin/yt-dlp')
LANG = ['--extractor-args', 'youtube:lang=zh-TW']
SECRET = os.path.expanduser('~/.miles-secrets/pod_pass')       # 密码，只在这台云电脑上
CACHE = os.path.expanduser('~/pod-work')                        # 下好、压好的 m4a（明文，只在云电脑上）
SITE = os.path.expanduser('~/miles-pod-site')                   # miles-pod 仓库的工作目录
SITE_REMOTE = 'https://github.com/iooliool/miles-pod.git'
BASE = 'https://iooliool.github.io/miles-pod/'
ITER = 600000
CHECK = b'miles-pod-ok'
MAXB = 95 * 1024 * 1024                                         # GitHub 单文件上限 100MB，留点余量
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
PAYWALL = re.compile(r'會員專享|会员专享|會員限定|会员限定|充电专属|充電專屬|会员加餐|會員加餐|會員影片|会员影片|会员视频|會員視頻')


def load():
    if os.path.exists(DATA):
        return json.load(open(DATA, encoding='utf-8'))
    return {'updated': 0, 'channels': [], 'eps': []}


def save(d):
    d['updated'] = int(time.time() * 1000)
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write('\n')


def src_of(ch):
    return ch.get('src') or 'yt'


# ---------- YouTube ----------
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
    elif PAYWALL.search(d.get('title') or ''):
        why = '会员'
    ud = d.get('upload_date') or ''
    return {'id': vid, 'ok': not why, 'why': why, 'title': d.get('title') or '',
            'date': '%s-%s-%s' % (ud[:4], ud[4:6], ud[6:8]) if len(ud) == 8 else '',
            'secs': int(d.get('duration') or 0), 'desc': (d.get('description') or '')[:300]}


def fetch_yt(ch, n):
    ids = recent_ids(ch['id'], 30)
    infos = []
    for i in range(0, len(ids), 8):  # 一批批往下翻，够 n 期就停
        with ThreadPoolExecutor(5) as ex:
            infos += list(ex.map(video, ids[i:i + 8]))
        if sum(v['ok'] and v['secs'] >= ch.get('min_secs', 300) for v in infos) >= n:
            break
    picks = [v for v in infos if v['ok'] and v['secs'] >= ch.get('min_secs', 300)][:n]
    skipped = [(v['id'], v['why'] or '太短') for v in infos if v not in picks]
    return picks, skipped


# ---------- B站 ----------
_bili = None


def bili_get(url, ref='https://www.bilibili.com/'):
    global _bili
    if _bili is None:
        _bili = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        try:
            _bili.open(urllib.request.Request('https://www.bilibili.com/', headers={'User-Agent': UA}), timeout=20).read()
        except Exception:
            pass
    for k in range(3):
        try:
            r = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': ref})
            return json.loads(_bili.open(r, timeout=20).read())
        except Exception as ex:
            err = ex
            time.sleep(4 + 4 * k)   # B站 412 是限流，歇一会儿再试
    raise RuntimeError('B站接口没拿到：%s' % err)


def fetch_bili(ch, n):
    mid = ch['bili']
    d = bili_get('https://api.bilibili.com/x/series/recArchivesByKeywords?mid=%s&keywords=&ps=30&pn=1&orderby=pubdate' % mid)
    if d.get('code') != 0:
        raise RuntimeError('B站接口：%s %s' % (d.get('code'), d.get('message')))
    picks, skipped = [], []
    for a in (d.get('data') or {}).get('archives') or []:
        why = ''
        if a.get('ugc_pay') or PAYWALL.search(a.get('title', '') + (a.get('desc') or '')[:200]):
            why = '会员/充电'
        elif a.get('interactive_video'):
            why = '互动视频'
        elif (a.get('duration') or 0) < ch.get('min_secs', 300):
            why = '太短'
        if why:
            skipped.append((a['bvid'], why)); continue
        pic = re.sub(r'^http://', 'https://', a.get('pic') or '')
        picks.append({'id': a['bvid'], 'title': a['title'], 'date': time.strftime('%Y-%m-%d', time.localtime(a['pubdate'])),
                      'secs': int(a['duration']), 'pic': pic, 'desc': (a.get('desc') or '')[:300]})
        if len(picks) >= n:
            break
    return picks, skipped


def cmd_fetch(a):
    d = load()
    old = {e['id']: e for e in d['eps']}
    res = {'channels': [], 'eps': [], 'errors': []}
    for ch in d['channels']:
        src = src_of(ch)
        mine = [e for e in d['eps'] if e['ch'] == ch['id']]
        try:
            picks, skipped = (fetch_bili if src == 'bili' else fetch_yt)(ch, a.n)
        except Exception as ex:
            res['errors'].append({'ch': ch['name'], 'err': str(ex)})
            res['eps'] += mine   # 这次没查到：先把原来挂着的留着
            continue
        res['channels'].append({'ch': ch['name'], 'picked': len(picks), 'skipped': skipped})
        if not picks:
            res['errors'].append({'ch': ch['name'], 'err': '最近的节目里没有能公开放的'})
            res['eps'] += mine
            continue
        for v in picks:
            o = old.get(v['id'])
            e = {'ch': ch['id'], 'src': src, 'id': v['id'], 'title': v['title'], 'date': v['date'], 'secs': v['secs'],
                 'say': o['say'] if o else '', 'heard': bool(o and o.get('heard')), 'new': not o, 'desc': v['desc']}
            if v.get('pic'):
                e['pic'] = v['pic']
            res['eps'].append(e)
        # 我听过的旧节目留着（同一种放法的），排在这个频道新节目后面
        got = {v['id'] for v in picks}
        res['eps'] += [e for e in mine if e.get('heard') and e['id'] not in got and (e.get('src') or 'yt') == src]
    json.dump(res, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    new = [e for e in res['eps'] if e.get('new')]
    print('fetch ok -> %s：挂 %d 期，新的 %d 期（say 要填），出错 %d 个频道' % (a.out, len(res['eps']), len(new), len(res['errors'])))
    names = {c['id']: c['name'] for c in d['channels']}
    for e in res['eps']:
        print(('  [新] ' if e.get('new') else '  ') + names.get(e['ch'], e['ch']) + ' | ' + (e.get('src') or 'yt') + ' | ' + e['id'] + ' | ' + e['date'] + ' | ' + e['title'][:60])
    from collections import Counter
    for c in res['channels']:
        if c['skipped']:
            print('  跳过 %s：%s' % (c['ch'], '，'.join('%s %d 期' % kv for kv in Counter(w for _, w in c['skipped']).items())))
    for e in res['errors']:
        print('  !! %s：%s' % (e['ch'], e['err']))


def cmd_apply(a):
    d = load()
    r = json.load(open(a.file, encoding='utf-8'))
    chs = {c['id']: src_of(c) for c in d['channels']}
    oldeps = {e['id']: e for e in d['eps']}
    eps = []
    for e in r['eps']:
        say = (e.get('say') or '').strip()
        src = e.get('src') or 'yt'
        if not say:
            sys.exit('还有没写推荐的：%s %s' % (e['id'], e['title'][:40]))
        if len(say) > 80 or re.search(r'https?://|www\.', say):
            sys.exit('推荐太长或带了链接：%s' % say)
        idok = re.fullmatch(r'BV[0-9A-Za-z]{10}', e['id']) if src == 'bili' else re.fullmatch(r'[\w-]{11}', e['id'])
        if e['ch'] not in chs or chs[e['ch']] != src or not idok:
            sys.exit('对不上的条目：%s' % e)
        x = {k: e[k] for k in ('ch', 'src', 'id', 'title', 'date', 'secs')} | {'src': src, 'say': say}
        if src == 'bili':
            x['pic'] = e.get('pic', '')
        if src == 'lock' and oldeps.get(e['id'], {}).get('bytes'):
            x['bytes'] = oldeps[e['id']]['bytes']   # 已经加密上去的，lock 时不用重做
        if e.get('heard'):
            x['heard'] = True
        eps.append(x)
    if not eps:
        sys.exit('一期都没有，不写')
    before = open(DATA, encoding='utf-8').read() if os.path.exists(DATA) else None
    d['eps'] = eps
    save(d)
    if any(e['src'] == 'lock' for e in eps) and not a.no_lock:
        # 加密那几期顺手做掉（下音频、加密、强推 miles-pod、删旧的）；做不成就把 pod.json 退回去，播客台停在上次的样子
        try:
            cmd_lock(argparse.Namespace(fresh=False))
        except (Exception, SystemExit) as ex:
            if before is not None:
                open(DATA, 'w', encoding='utf-8').write(before)
            sys.exit('lock 没做成，pod.json 退回上次的了：%s' % ex)
    print('apply ok：%d 期' % len(eps))


# ---------- 加密（lock） ----------
def password():
    if not os.path.exists(SECRET):
        sys.exit('没有密码文件 %s' % SECRET)
    p = open(SECRET, encoding='utf-8').read().strip()
    if len(p) < 6:
        sys.exit('密码太短')
    return p


def derive(pw, salt, it):
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode('utf-8'))


def sh(args, cwd=None, check=True):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and p.returncode:
        raise RuntimeError('%s 失败：%s' % (' '.join(args[:3]), (p.stderr or p.stdout)[-400:]))
    return p.stdout


def audio(vid):
    """下音频，压成单声道 AAC m4a；太大就降码率。返回明文 m4a 路径（只在云电脑上）。"""
    os.makedirs(os.path.join(CACHE, 'raw'), exist_ok=True)
    out = os.path.join(CACHE, vid + '.m4a')
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        return out
    raw = glob.glob(os.path.join(CACHE, 'raw', vid + '.*'))
    raw = [r for r in raw if not r.endswith(('.part', '.log', '.ytdl'))]
    if not raw:
        o, e = run(['-f', 'bestaudio', '--no-playlist', '-o', os.path.join(CACHE, 'raw', vid + '.%(ext)s'), 'https://www.youtube.com/watch?v=' + vid], timeout=600)
        raw = [r for r in glob.glob(os.path.join(CACHE, 'raw', vid + '.*')) if not r.endswith(('.part', '.log', '.ytdl'))]
        if not raw:
            raise RuntimeError('%s 音频没下下来：%s' % (vid, (e.strip().splitlines() or ['?'])[-1][:160]))
    for br in ('56k', '40k', '32k'):
        sh(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', raw[0], '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', br, '-movflags', '+faststart', out])
        if os.path.getsize(out) + 28 < MAXB:
            return out
    raise RuntimeError('%s 压到 32k 还超过 95MB' % vid)


def cover(vid, dst):
    tmp = dst + '.src'
    for q in ('maxresdefault', 'hqdefault'):
        try:
            data = urllib.request.urlopen(urllib.request.Request('https://i.ytimg.com/vi/%s/%s.jpg' % (vid, q), headers={'User-Agent': UA}), timeout=20).read()
            if len(data) > 3000:
                open(tmp, 'wb').write(data); break
        except Exception:
            pass
    if not os.path.exists(tmp):
        return False
    sh(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', tmp, '-vf', 'scale=640:-2', '-q:v', '5', dst])
    os.remove(tmp)
    return True


def cmd_lock(a):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = load()
    pw = password()
    eps = [e for e in d['eps'] if e.get('src') == 'lock']
    lk = d.get('lock') or {}
    salt = None
    if lk.get('salt') and not a.fresh:   # 盐没变、密码也对得上，就沿用，已经加密过的文件不用重做
        s = base64.b64decode(lk['salt'])
        try:
            AESGCM(derive(pw, s, lk.get('iter', ITER))).decrypt(base64.b64decode(lk['check_iv']), base64.b64decode(lk['check']), None)
            salt = s
        except Exception:
            print('密码换过了，整套重新加密')
    redo_all = salt is None
    if redo_all:
        salt = os.urandom(16)
    key = derive(pw, salt, ITER)
    g = AESGCM(key)
    civ = os.urandom(12)
    if not os.path.isdir(os.path.join(SITE, '.git')):
        shutil.rmtree(SITE, ignore_errors=True)
        sh(['git', 'clone', SITE_REMOTE, SITE])
    os.makedirs(os.path.join(SITE, 'a'), exist_ok=True)
    os.makedirs(os.path.join(SITE, 'c'), exist_ok=True)
    keep = set()
    for e in eps:
        enc = os.path.join(SITE, 'a', e['id'] + '.bin')
        jpg = os.path.join(SITE, 'c', e['id'] + '.jpg')
        keep |= {enc, jpg}
        if redo_all or not os.path.exists(enc) or not e.get('bytes'):
            src = audio(e['id'])
            iv = os.urandom(12)
            ct = g.encrypt(iv, open(src, 'rb').read(), e['id'].encode())   # 期号当附加数据，文件不能张冠李戴
            open(enc, 'wb').write(iv + ct)
            e['bytes'] = len(iv) + len(ct)
            print('加密 %s：%.1f MB' % (e['id'], e['bytes'] / 1048576))
        if not os.path.exists(jpg):
            e['cover'] = cover(e['id'], jpg)
        e['cover'] = os.path.exists(jpg)
        if not e['cover']:
            keep.discard(jpg)
    # 不在节目单上的旧文件删掉
    for f in glob.glob(os.path.join(SITE, 'a', '*')) + glob.glob(os.path.join(SITE, 'c', '*')):
        if f not in keep:
            os.remove(f); print('删掉旧的', os.path.basename(f))
    open(os.path.join(SITE, '.nojekyll'), 'w').close()
    open(os.path.join(SITE, 'index.html'), 'w', encoding='utf-8').write(
        '<!doctype html><meta charset="utf-8"><title>miles-pod</title><p>这里是 Miles 小屋播客台的加密音频，只有密码能解开，没密码就是一堆乱码。'
        '去小屋听：<a href="https://iooliool.github.io/miles-home/fm.html">miles-home/fm.html</a></p>\n')
    # 整个仓库重来：孤儿提交 + 强推，旧音频连历史一起清掉
    sh(['git', 'checkout', '-q', '--orphan', 'fresh'], cwd=SITE)
    sh(['git', 'add', '-A'], cwd=SITE)
    sh(['git', '-c', 'user.name=Miles', '-c', 'user.email=miles@users.noreply.github.com', 'commit', '-q', '-m',
        '播客台加密音频 %s（每次整个重来，不留旧版本）' % time.strftime('%Y-%m-%d')], cwd=SITE)
    sh(['git', 'branch', '-D', 'main'], cwd=SITE, check=False)
    sh(['git', 'branch', '-m', 'main'], cwd=SITE)
    sh(['git', 'push', '-q', '-f', 'origin', 'main'], cwd=SITE)
    sh(['git', 'reflog', 'expire', '--expire=now', '--all'], cwd=SITE)
    sh(['git', 'gc', '-q', '--prune=now'], cwd=SITE)
    d['lock'] = {'v': 1, 'kdf': 'PBKDF2-SHA256', 'iter': ITER, 'salt': base64.b64encode(salt).decode(),
                 'check_iv': base64.b64encode(civ).decode(), 'check': base64.b64encode(g.encrypt(civ, CHECK, None)).decode(),
                 'base': BASE, 'at': int(time.time() * 1000)}
    save(d)
    # 明文缓存只留现在挂着的几期
    ids = {e['id'] for e in eps}
    for f in glob.glob(os.path.join(CACHE, '*.m4a')) + glob.glob(os.path.join(CACHE, 'raw', '*')):
        if os.path.basename(f).split('.')[0] not in ids:
            os.remove(f)
    print('lock ok：%d 期加密推上 miles-pod（%s），共 %.1f MB' % (len(eps), BASE, sum(e.get('bytes', 0) for e in eps) / 1048576))


def cmd_show(a):
    d = load()
    names = {c['id']: c['name'] + ('（我加的）' if c.get('by') == 'miles' else '') + '[' + src_of(c) + ']' for c in d['channels']}
    print('updated', time.strftime('%Y-%m-%d %H:%M', time.localtime(d['updated'] / 1000)) if d['updated'] else '-')
    for e in d['eps']:
        print('%s | %s | %s | %s%s\n    %s' % (names.get(e['ch']), e['date'], e['id'], e['title'][:60], ' [听过]' if e.get('heard') else '', e['say']))


def cmd_add(a):
    d = load()
    if any(c['id'] == a.id for c in d['channels']):
        sys.exit('已经有了')
    if a.src == 'bili' and not a.bili:
        sys.exit('B站频道要给 --bili mid')
    c = {'id': a.id, 'name': a.name, 'by': a.by, 'src': a.src, 'about': a.about}
    if a.bili:
        c['bili'] = a.bili
    d['channels'].append(c)
    save(d)
    print('add ok')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest='c', required=True)
    f = s.add_parser('fetch'); f.add_argument('--n', type=int, default=2); f.add_argument('--out', default='/tmp/pod_new.json'); f.set_defaults(fn=cmd_fetch)
    f = s.add_parser('apply'); f.add_argument('file'); f.add_argument('--no-lock', action='store_true'); f.set_defaults(fn=cmd_apply)
    f = s.add_parser('lock'); f.add_argument('--fresh', action='store_true', help='换新盐，全部重新加密'); f.set_defaults(fn=cmd_lock)
    f = s.add_parser('show'); f.set_defaults(fn=cmd_show)
    f = s.add_parser('add-channel'); f.add_argument('--id', required=True); f.add_argument('--name', required=True)
    f.add_argument('--by', choices=['her', 'miles'], required=True); f.add_argument('--src', choices=['bili', 'lock', 'yt'], default='lock')
    f.add_argument('--bili', default=''); f.add_argument('--about', default=''); f.set_defaults(fn=cmd_add)
    a = p.parse_args(); a.fn(a)
