#!/usr/bin/env python3
"""给她的歌：下整首 -> 转 mp3 -> 存进 assets/songs/ -> 记进 data/songs.json。

用法：
  python3 tools/songs.py add "艺人" "歌名" [--ncm 网易云id] [--slug sunday-morning] [--note "一句话"] [--why "为什么发"] [--url 指定YouTube来源] [--force]
  python3 tools/songs.py list

来源顺序：
  1. 网易云（先）：~/tools/ncm-api 里装的 NeteaseCloudMusicApi Enhanced（npm @neteasecloudmusicapienhanced/api），
     node ncm_url.js <歌id> 带 realIP（国内 IP）拿真实音频地址，再用 https 下载。我电脑在美国，不带国内 IP 一律 404；
     randomCNIP 试过拿不到，realIP 能拿到。会员歌（fee 1）或只给试听（freeTrialInfo 不为空）的不收。
     歌 id 用 --ncm 指定；不指定就用网易云搜索自己找（歌名、艺人都对得上才用）。
  2. 网易云拿不到才用 YouTube（优先唱片公司/艺人官方的 Topic 或 official 频道），yt-dlp 下载。
只收整首：时长短于 60 秒、或标题里带 preview/snippet/试听 的一律拒收。
转成 128k 单文件 mp3，超过 20MB 拒收（GitHub 单文件上限 100MB，仓库别塞太大）。
成功时最后一行打印小屋里的链接：https://iooliool.github.io/miles-home/songs.html#<slug>
下不到就退出码 1，照实说，不拿外链糊弄。
"""
import json, os, re, subprocess, sys, tempfile, datetime, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'assets', 'songs')
DATA = os.path.join(ROOT, 'data', 'songs.json')
BASE = 'https://iooliool.github.io/miles-home/songs.html#'
YTDLP = os.path.expanduser('~/.local/bin/yt-dlp')
NCM = os.path.expanduser('~/tools/ncm-api/ncm_url.js')
UA = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com'}
BAD = re.compile(r'preview|snippet|teaser|试听|片段|30\s*sec|karaoke|instrumental|cover|reaction|8d audio|slowed|sped up|nightcore', re.I)


def load():
    try:
        return json.load(open(DATA, encoding='utf-8'))
    except FileNotFoundError:
        return {'songs': []}


def save(d):
    json.dump(d, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def slugify(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s or 'song-' + datetime.datetime.now().strftime('%Y%m%d%H%M')


def candidates(artist, title):
    out = []
    for q in ['%s %s topic' % (artist, title), '%s %s official audio' % (artist, title), '%s %s' % (artist, title)]:
        r = subprocess.run([YTDLP, '--no-playlist', '--flat-playlist', '--skip-download', '--print',
                            '%(id)s\t%(title)s\t%(channel)s\t%(duration)s', 'ytsearch5:' + q],
                           capture_output=True, text=True, timeout=120)
        for line in r.stdout.splitlines():
            p = line.split('\t')
            if len(p) == 4 and p[0] not in [c[0] for c in out]:
                out.append(p)
    t = title.lower()
    a = artist.lower().split(',')[0].strip()

    def score(c):
        vid, name, ch, dur = c
        s = 0
        if t in name.lower(): s += 4
        else: s -= 6
        if a and (a in ch.lower() or a in name.lower()): s += 3
        elif a: s -= 6
        if ch.endswith('- Topic'): s += 3
        if 'official' in name.lower(): s += 1
        if 'live' in name.lower() and 'live' not in t: s -= 3
        if BAD.search(name): s -= 10
        try:
            if float(dur) < 60 or float(dur) > 1500: s -= 10
        except ValueError:
            pass
        return s
    out.sort(key=score, reverse=True)
    return [c for c in out if score(c) > 0]


def ncm_search(artist, title):
    import urllib.request, urllib.parse
    q = urllib.parse.quote('%s %s' % (title, artist.split(',')[0]))
    req = urllib.request.Request('https://music.163.com/api/cloudsearch/pc?type=1&limit=10&s=' + q, headers=UA)
    d = json.load(urllib.request.urlopen(req, timeout=20))
    t, a = title.lower(), artist.lower().split(',')[0].strip()
    for so in d.get('result', {}).get('songs', []):
        ars = ' '.join(x['name'].lower() for x in so.get('ar', []))
        if so['name'].lower().startswith(t) and (a in ars or ars in a) and 'live' not in so['name'].lower():
            return str(so['id']), so['name'], ','.join(x['name'] for x in so['ar'])
    return None


def ncm_fetch(sid, dst):
    r = subprocess.run(['node', NCM, sid], capture_output=True, text=True, timeout=120, cwd=os.path.dirname(NCM))
    line = [l for l in r.stdout.splitlines() if l.startswith('{')]
    info = json.loads(line[-1]) if line else {}
    if not info.get('url'):
        raise RuntimeError('网易云不给地址（可能是会员歌或下架）')
    if info.get('trial'):
        raise RuntimeError('网易云只给试听')
    if info.get('fee') == 1:
        raise RuntimeError('会员歌')
    tmp = tempfile.mkdtemp()
    raw = os.path.join(tmp, 'a.' + (info.get('type') or 'mp3'))
    url = info['url'].replace('http://', 'https://', 1)
    subprocess.run(['curl', '-sfL', '-m', '300', '-A', 'Mozilla/5.0', '-o', raw, url], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-vn', '-ac', '2', '-ar', '44100', '-b:a', '128k',
                    '-map_metadata', '-1', dst], check=True)
    secs = dur(dst)
    if info.get('time') and abs(secs - info['time'] / 1000) > 5:
        raise RuntimeError('下下来 %d 秒，跟网易云标的 %d 秒对不上' % (secs, info['time'] / 1000))
    return secs


def dur(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def fetch(url, dst):
    tmp = tempfile.mkdtemp()
    r = subprocess.run([YTDLP, '--no-playlist', '-f', 'bestaudio', '-o', os.path.join(tmp, 'a.%(ext)s'), url],
                       capture_output=True, text=True, timeout=400)
    src = [os.path.join(tmp, f) for f in os.listdir(tmp)]
    if r.returncode or not src:
        raise RuntimeError('下载失败：' + (r.stderr.strip().splitlines() or ['?'])[-1])
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src[0], '-vn', '-ac', '2', '-ar', '44100', '-b:a', '128k',
                    '-map_metadata', '-1', dst], check=True)
    return dur(dst)


def cmd_add(a):
    os.makedirs(DIR, exist_ok=True)
    slug = a.slug or slugify(a.title)
    d = load()
    if any(s['slug'] == slug for s in d['songs']) and not a.force:
        print('已经在小屋里了'); print(BASE + slug); return
    dst = os.path.join(DIR, slug + '.mp3')
    tried = []
    sid = a.ncm
    if not sid and not a.url:
        try:
            hit = ncm_search(a.artist, a.title)
            if hit:
                sid = hit[0]; print('网易云搜到：%s / %s（%s）' % (hit[1], hit[2], sid))
        except Exception as e:
            tried.append('网易云搜索：%s' % e)
    if sid and not a.url:
        try:
            secs = ncm_fetch(sid, dst)
            if secs >= 60 or a.short:
                return done(d, a, slug, dst, secs, '网易云 %s' % sid, 'https://music.163.com/song?id=%s' % sid)
            tried.append('网易云：只有 %d 秒' % secs)
        except Exception as e:
            tried.append('网易云 %s：%s' % (sid, e))
        print('网易云没拿到，换 YouTube：' + tried[-1])
    if a.url:
        cands = [[a.url, a.url, '', '']]
    else:
        cands = candidates(a.artist, a.title)[:4]
    if not cands:
        print('一个像样的来源都没搜到（排掉了试听、翻唱、现场、太短的）。', file=sys.stderr); sys.exit(1)
    got = None
    for c in cands:
        url = c[0] if c[0].startswith('http') else 'https://www.youtube.com/watch?v=' + c[0]
        try:
            secs = fetch(url, dst)
        except Exception as e:
            tried.append('%s：%s' % (c[1], e)); continue
        if secs < 60 and not a.short:
            tried.append('%s：只有 %d 秒，不像整首' % (c[1], secs)); os.remove(dst); continue
        if os.path.getsize(dst) > 20 * 1024 * 1024:
            tried.append('%s：转完超过 20MB' % c[1]); os.remove(dst); continue
        got = (c, url, secs); break
    if not got:
        print('没下成：\n' + '\n'.join(tried), file=sys.stderr); sys.exit(1)
    c, url, secs = got
    done(d, a, slug, dst, secs, 'YouTube %s（%s）' % (c[1], c[2]) if c[2] else 'YouTube ' + url, url)


def done(d, a, slug, dst, secs, source, source_url):
    if os.path.getsize(dst) > 20 * 1024 * 1024:
        os.remove(dst); print('转完超过 20MB，不放', file=sys.stderr); sys.exit(1)
    row = {'slug': slug, 'artist': a.artist, 'title': a.title, 'file': 'assets/songs/%s.mp3' % slug,
           'secs': round(secs), 'note': a.note or '', 'why': a.why or '', 'source': source, 'source_url': source_url,
           'added': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')}
    if a.ncm: row['ncm'] = a.ncm
    d['songs'] = [x for x in d['songs'] if x['slug'] != slug]
    d['songs'].insert(0, row)
    save(d)
    print('来源：%s | %d 秒 | %.1f MB' % (source, secs, os.path.getsize(dst) / 1048576))
    print(BASE + slug)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    ad = sub.add_parser('add')
    ad.add_argument('artist'); ad.add_argument('title')
    ad.add_argument('--slug'); ad.add_argument('--note'); ad.add_argument('--why'); ad.add_argument('--url'); ad.add_argument('--ncm', help='网易云歌 id')
    ad.add_argument('--short', action='store_true', help='本来就短于 60 秒的曲子'); ad.add_argument('--force', action='store_true', help='已有也重下覆盖')
    sub.add_parser('list')
    a = p.parse_args()
    if a.cmd == 'add':
        cmd_add(a)
    else:
        for s in load()['songs']:
            print(s['added'][:10], s['artist'], '-', s['title'], BASE + s['slug'])


if __name__ == '__main__':
    main()
