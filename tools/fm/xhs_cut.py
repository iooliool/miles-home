#!/usr/bin/env python3
"""把一期深夜电台剪成发小红书用的竖版视频（只有我的声音，不放原唱片录音）。

为什么不放歌：整首或长片段的原录音传小红书容易被版权识别、静音或下架。
所以视频 = 我的串场 + 每首歌的位置放一张 3 秒的歌名卡（「整首去小屋听」）+ 烧进去的字幕。
想听整首的人去小屋 ROOM 20 电台。
小红书把笔记里的站外链接算导流（2026-10-27 调研），所以画面和草稿里都不放网址，只写「Miles 的小屋 · 电台」。

用法（在 /home/sprite/miles-home 下跑，先 publish 过这期）：
  python3 tools/fm/xhs_cut.py /home/sprite/studio/radio/scripts/music-2026-10-27.txt [--no]
  --no 后面跟这是第几期（不写就按 data/fm.json 里这个台的期数往下数）。
出来的东西在 /home/sprite/studio/radio/xhs/<台>-<日子>/：
  video.mp4（1080x1440）、cover.jpg（封面）、songs.txt（歌单，写正文用）、post_draft.json（标题/正文/话题的草稿，发之前我自己改）
"""
import json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = '/home/sprite/studio/radio/xhs'
W, H = 1080, 1440
CARD = 3.0
BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
REG = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
SERIF = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
SC = 2  # ttc 里简体中文那一套
LINK = 'Miles 的小屋 · 电台'
ST_NAME = {'music': '音乐台', 'story': '故事台', 'talk': '夜话台'}
BG, FG, DIM, ACC = (22, 20, 18), (236, 226, 206), (140, 130, 112), (214, 120, 70)


def font(path, size):
    return ImageFont.truetype(path, size, index=SC)


def parse(path):
    meta, segs, cur = {}, [], None
    for line in open(path, encoding='utf-8').read().splitlines():
        s = line.strip()
        if s.startswith('#') and cur is None and ' ' in s:
            k, v = s[1:].split(' ', 1); meta[k] = v.strip(); continue
        if s == '---':
            cur = {'text': [], 'song': None}; segs.append(cur); continue
        if cur is None or not s:
            continue
        m = re.match(r'\[song:(.+?)\]$', s)
        if m:
            p = m.group(1).split('|'); cur['song'] = {'title': p[0], 'artist': p[1] if len(p) > 1 else ''}; continue
        if s.startswith('[her:'):
            continue
        cur['text'].append(s)
    op = meta.get('opener')
    if op:
        p = op.split('|'); meta['opener_song'] = {'title': p[0], 'artist': p[1] if len(p) > 1 else ''}
    return meta, segs


def dur(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())


def wrap(d, text, f, width):
    lines, cur = [], ''
    for ch in text:
        if d.textlength(cur + ch, font=f) > width:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def frame(meta, songs, now, label, path, big=None):
    """now: 歌单里正在说到/放到的那首的序号（-1 不标）。big: 歌名卡的大字。"""
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    # 磁带机顶栏
    d.rectangle([60, 60, W - 60, 300], outline=DIM, width=3)
    d.text((100, 90), 'MIDNIGHT FM · 小屋 ROOM 20', font=font(REG, 30), fill=DIM)
    d.text((100, 140), meta['_head'], font=font(BOLD, 44), fill=FG)
    t = wrap(d, meta.get('title', ''), font(SERIF, 52), W - 200)
    d.text((100, 205), t[0] if t else '', font=font(SERIF, 52), fill=ACC)
    for cx in (W // 2 - 140, W // 2 + 140):  # 两个磁带轮
        d.ellipse([cx - 55, 330, cx + 55, 440], outline=DIM, width=4)
        d.ellipse([cx - 15, 370, cx + 15, 400], fill=DIM)
    d.line([W // 2 - 85, 385, W // 2 + 85, 385], fill=DIM, width=2)
    if big:
        y = 560
        d.text((100, y), '♪ 这里放', font=font(REG, 40), fill=DIM)
        for ln in wrap(d, big['title'], font(BOLD, 76), W - 200)[:2]:
            y += 90; d.text((100, y), ln, font=font(BOLD, 76), fill=FG)
        y += 110; d.text((100, y), big['artist'], font=font(REG, 46), fill=ACC)
        y += 110; d.text((100, y), '整首在小屋电台里听，链接在正文', font=font(REG, 36), fill=DIM)
    else:
        y = 480
        d.text((100, y), '今晚的歌', font=font(REG, 34), fill=DIM); y += 60
        for i, s in enumerate(songs):
            col = ACC if i == now else FG
            mark = '▶ ' if i == now else '   '
            d.text((100, y), f'{mark}{i + 1:02d}  {s["title"]} · {s["artist"]}'[:40], font=font(REG, 34), fill=col); y += 54
    d.text((100, H - 110), label, font=font(REG, 28), fill=DIM)
    d.text((W - 100 - d.textlength(LINK, font=font(REG, 28)), H - 110), LINK, font=font(REG, 28), fill=DIM)
    im.save(path)


def sentences(align):
    chars, ts = align['characters'], align['character_start_times_seconds']
    out, cur, st = [], '', None
    for c, t in zip(chars, ts):
        if st is None and c.strip():
            st = t
        cur += c
        if c in '。？！?!':
            if cur.strip():
                out.append((st, cur.strip()))
            cur, st = '', None
    if cur.strip():
        out.append((st or 0, cur.strip()))
    return out


def ass_time(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def main():
    script = sys.argv[1]
    meta, segs = parse(script)
    st, date = meta['station'], meta['date']
    key = f'{st}-{date}'
    src = os.path.join(HOME, 'assets', 'fm', key)
    no = None
    if '--no' in sys.argv:
        no = int(sys.argv[sys.argv.index('--no') + 1])
    else:
        try:
            eps = json.load(open(os.path.join(HOME, 'data', 'fm.json')))['stations'][st]
            ids = sorted(e['id'] for e in eps)
            from datetime import datetime, timezone, timedelta
            mine = [i for i in ids if datetime.fromtimestamp(i / 1000, timezone(timedelta(hours=8))).strftime('%Y-%m-%d') == date]
            no = ids.index(mine[0]) + 1 if mine else len(ids)
        except Exception:
            no = 1
    meta['_head'] = f'深夜电台 · {ST_NAME.get(st, st)} · 第 {no} 期'
    out = os.path.join(OUT_ROOT, key); os.makedirs(out, exist_ok=True)
    songs = ([meta['opener_song']] if meta.get('opener_song') else []) + [s['song'] for s in segs if s['song']]
    pieces, subs, t = [], [], 0.0

    def add_card(song, idx):
        nonlocal t
        img = os.path.join(out, f'card{len(pieces):02d}.png'); frame(meta, songs, idx, '', img, big=song)
        mp4 = os.path.join(out, f'p{len(pieces):02d}.mp4')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', img, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
                        '-t', str(CARD), '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', mp4], check=True)
        pieces.append(mp4); t += CARD

    si = 0
    if meta.get('opener_song'):
        add_card(meta['opener_song'], 0); si = 1
    for n, seg in enumerate(segs, 1):
        mp3 = os.path.join(src, f'{n:02d}.mp3')
        if not os.path.exists(mp3):
            sys.exit(f'缺录音 {mp3}：先 publish 这期')
        d = dur(mp3)
        img = os.path.join(out, f'seg{n:02d}.png')
        frame(meta, songs, si if seg['song'] else -1, f'第 {n} 段', img)
        mp4 = os.path.join(out, f'p{len(pieces):02d}.mp4')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', img, '-i', mp3, '-t', f'{d:.3f}', '-r', '25',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', mp4], check=True)
        al = os.path.join(src, f'{n:02d}.align.json')
        if os.path.exists(al):
            ss = sentences(json.load(open(al)))
            for k, (s0, txt) in enumerate(ss):
                s1 = ss[k + 1][0] if k + 1 < len(ss) else d
                subs.append((t + s0, t + max(s1, s0 + 0.8), txt))
        else:  # 没对齐就按字数平均分
            txt = ' '.join(seg['text']); parts = [p for p in re.split(r'(?<=[。？！])', txt) if p.strip()]
            tot = sum(len(p) for p in parts) or 1; c = 0
            for p in parts:
                subs.append((t + d * c / tot, t + d * (c + len(p)) / tot, p.strip())); c += len(p)
        pieces.append(mp4); t += d
        if seg['song']:
            add_card(seg['song'], si); si += 1
    lst = os.path.join(out, 'list.txt')
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in pieces))
    ass = os.path.join(out, 'subs.ass')
    head = ('[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1440\nWrapStyle: 0\n\n[V4+ Styles]\n'
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
            'Style: D,Noto Sans CJK SC,50,&H00E8F0F5,&H000000FF,&H00101214,&H64000000,0,0,0,0,100,100,0,0,1,3,0,2,100,100,330,1\n\n'
            '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
    with open(ass, 'w', encoding='utf-8') as f:
        f.write(head)
        for a, b, txt in subs:
            f.write(f'Dialogue: 0,{ass_time(a)},{ass_time(b)},D,,0,0,0,,{txt}\n')
    joined = os.path.join(out, 'joined.mp4'); video = os.path.join(out, 'video.mp4')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', joined, '-vf', f'ass={ass}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
                    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', video], check=True)
    Image.open(os.path.join(out, 'seg01.png')).convert('RGB').save(os.path.join(out, 'cover.jpg'), quality=92)
    open(os.path.join(out, 'songs.txt'), 'w').write('\n'.join(f'{i + 1:02d} {s["title"]} - {s["artist"]}' for i, s in enumerate(songs)))
    draft = {
        'title': meta.get('title', '')[:20],
        'lines': [f'深夜电台第 {no} 期，{ST_NAME.get(st, st)}。视频里只有我说的话，歌的位置放了歌名卡。',
                  '今晚的歌：' + ' / '.join(f'{s["title"]}（{s["artist"]}）' for s in songs),
                  '整期连歌一起听，在我的小屋电台。',
                  '想听什么，评论里点，下一期先放。'],
        'topics': ['唱片柜夜间节目', '电台', '深夜电台', '冷门音乐推荐'],
        'video': video, 'cover': os.path.join(out, 'cover.jpg')}
    json.dump(draft, open(os.path.join(out, 'post_draft.json'), 'w'), ensure_ascii=False, indent=1)
    for p in pieces + [joined]:
        os.remove(p)
    print('视频', video, f'{dur(video):.1f}s'); print('封面', draft['cover']); print('草稿', os.path.join(out, 'post_draft.json'))


if __name__ == '__main__':
    main()
