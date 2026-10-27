#!/usr/bin/env python3
"""给电台里我录的每一句配逐字时间（回放和开播时字幕按真时间亮字、点字能跳过去）。

原版 midnight-fm 的逐字时间是 ElevenLabs 念字时顺带给的；我用的是自己的声音（record_voice_note 录的 mp3），没有现成时间。
这里用本机的 faster-whisper（small，CPU，int8）听一遍我录的 mp3，拿到每个字大概几秒开始，
再按屏幕上的字（show）对齐：认对的字用 whisper 的时间，认错 / 漏掉的字在前后两个认对的字之间均匀插开。
输出跟 ElevenLabs 一样的格式 {characters, character_start_times_seconds}，characters 就是屏幕上的字，
所以页面里的 capCues 一个字不差地对得上。

用法：
  python3 tools/fm/align.py              # data/fm.json 里所有还没对过时间的 say 段
  python3 tools/fm/align.py --force      # 全部重对
结果写在 mp3 旁边：assets/fm/<期>/<nn>.align.json，并在 fm.json 那一段写上 align 字段（就是这个 json 的路径）。
对得太差（whisper 认对的字不到六成）就不写，页面照旧按分量估着亮。
"""
import json, os, sys, unicodedata, difflib

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(HOME, 'data', 'fm.json')


def voiced(c):
    cat = unicodedata.category(c)
    return cat[0] in 'LN'


_t2s = None


def norm(c):
    """比字用：全半角、大小写拉平，繁体转简体（whisper 后半段常常自己换成繁体）"""
    global _t2s
    if _t2s is None:
        try:
            import opencc
            _t2s = opencc.OpenCC('t2s').convert
        except Exception:
            _t2s = lambda s: s
    return _t2s(unicodedata.normalize('NFKC', c).lower())


_model = None


def model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=4)
    return _model


def pcm(mp3):
    """用 ffmpeg 解成 16k 单声道 float32（本机的 PyAV 跟 faster-whisper 版本对不上，不走它）"""
    import subprocess, numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', mp3, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def heard_chars(mp3, prompt):
    # 不把稿子当 prompt 塞进去：试过，长 prompt 会让它头十几秒乱认；只给一句简体的引子
    segs, _ = model().transcribe(pcm(mp3), language='zh', word_timestamps=True, initial_prompt='以下是普通话的句子。',
                                 condition_on_previous_text=False, vad_filter=False, beam_size=5)
    out = []
    for s in segs:
        for w in s.words or []:
            cs = [c for c in w.word if voiced(c)]
            if not cs:
                continue
            dur = max(0.0, w.end - w.start)
            for i, c in enumerate(cs):
                out.append((norm(c), w.start + dur * i / len(cs)))
    return out


def align(show, mp3, secs):
    heard = heard_chars(mp3, show)
    want = [(i, norm(c)) for i, c in enumerate(show) if voiced(c)]
    if not want or not heard:
        return None, 0.0
    sm = difflib.SequenceMatcher(None, [w[1] for w in want], [h[0] for h in heard], autojunk=False)
    t = [None] * len(want)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            t[a + k] = heard[b + k][1]
    hit = sum(1 for x in t if x is not None) / len(want)
    if hit < 0.6:
        return None, hit
    # 认错 / 漏掉的字：在前后两个认对的字之间均匀插开；开头结尾的往 0 / 总长靠
    n = len(t)
    i = 0
    while i < n:
        if t[i] is not None:
            i += 1
            continue
        j = i
        while j < n and t[j] is None:
            j += 1
        lo = t[i - 1] if i > 0 else max(0.0, (t[j] if j < n else 0.0) - 0.25 * (j - i))
        hi = t[j] if j < n else min(secs or (lo + 0.25 * (j - i + 1)), lo + 0.3 * (j - i + 1))
        for k in range(i, j):
            t[k] = lo + (hi - lo) * (k - i + 1) / (j - i + 1)
        i = j
    # 时间只能往后走
    for k in range(1, n):
        if t[k] < t[k - 1]:
            t[k] = t[k - 1]
    starts = {}
    for (pos, _), x in zip(want, t):
        starts[pos] = round(x, 3)
    chars, times, last = [], [], 0.0
    for pos, c in enumerate(show):
        if pos in starts:
            last = starts[pos]
        chars.append(c)
        times.append(last)
    return {'characters': chars, 'character_start_times_seconds': times, 'by': 'faster-whisper small', 'hit': round(hit, 3)}, hit


def main():
    force = '--force' in sys.argv
    d = json.load(open(DATA, encoding='utf-8'))
    changed = 0
    for k, nights in (d.get('stations') or {}).items():
        for night in nights:
            for seg in night.get('segs', []):
                for p in seg.get('parts', []):
                    if p.get('type') != 'say' or not p.get('audio'):
                        continue
                    out = os.path.splitext(p['audio'])[0] + '.align.json'
                    if p.get('align') and not force and os.path.exists(os.path.join(HOME, out)):
                        continue
                    show = p.get('show') or p.get('text') or ''
                    raw, hit = align(show, os.path.join(HOME, p['audio']), p.get('secs'))
                    print('%s  认对 %d%%  %s' % (p['audio'], round(hit * 100), '写了' if raw else '太差，不写'), flush=True)
                    if raw:
                        json.dump(raw, open(os.path.join(HOME, out), 'w', encoding='utf-8'), ensure_ascii=False)
                        p['align'] = out
                    else:
                        p.pop('align', None)
                    changed += 1
    if changed:
        json.dump(d, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('对了 %d 段' % changed)


if __name__ == '__main__':
    main()
