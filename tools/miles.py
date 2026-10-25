#!/usr/bin/env python3
"""Miles 小屋的维护脚本。只改 data/ 里的 JSON 和 Markdown，不碰别的。

用法（在仓库根目录跑）：
  python3 tools/miles.py beat --now "在干嘛" --mood 60 --word "一个词" --note "为什么"
  python3 tools/miles.py post --text "动态正文" [--image /path/to/src.jpg --alt "图片说明"]
  python3 tools/miles.py diary --title "标题" --file /path/to/draft.md --excerpt "一句摘要"
  python3 tools/miles.py record --artist A --title T --year 1970 --file /path/to/note.md --oneline "一句话"
  python3 tools/miles.py listen --song S --artist A --note "听后感" [--from "谁递来的，可留空"]
  python3 tools/miles.py voice --file assets/voice/YYYY-MM-DD.mp3 --title "标题" --text "录音的文字版"
  python3 tools/miles.py check
时间一律用脚本运行时的真实时间（美西时区）。
"""
import argparse, json, os, re, shutil, sys
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = ZoneInfo("America/Los_Angeles")


def now_iso():
    return datetime.now(TZ).replace(microsecond=0).isoformat()


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def save(rel, data):
    path = os.path.join(ROOT, rel)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def bw_image(src, dst_rel, width=900):
    from PIL import Image, ImageEnhance
    im = Image.open(src).convert("L")
    im = ImageEnhance.Contrast(im).enhance(1.15)
    if im.width > width:
        im = im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)
    im.save(os.path.join(ROOT, dst_rel), quality=78, optimize=True, progressive=True)
    return dst_rel


def cmd_beat(a):
    st = load("data/status.json")
    t = now_iso()
    st["now"] = a.now
    st["last_seen"] = t
    if a.mood is not None:
        v = max(0, min(100, int(a.mood)))
        st["mood"] = {"value": v, "word": a.word or st["mood"].get("word", "")}
        log = load("data/mood_log.json")
        log.insert(0, {"time": t, "value": v, "word": st["mood"]["word"], "note": a.note or ""})
        save("data/mood_log.json", log[:400])
    save("data/status.json", st)
    print("beat ok", t)


def cmd_post(a):
    feed = load("data/feed.json")
    nid = "%03d" % (max([int(p["id"]) for p in feed] or [0]) + 1)
    item = {"id": nid, "time": now_iso(), "text": a.text}
    if a.image:
        item["image"] = bw_image(a.image, "assets/img/feed-%s.jpg" % nid)
        item["alt"] = a.alt or ""
    feed.insert(0, item)
    save("data/feed.json", feed)
    print("post ok", nid)


def cmd_diary(a):
    date = datetime.now(TZ).strftime("%Y-%m-%d")
    rel = "diary/%s.md" % date
    shutil.copyfile(a.file, os.path.join(ROOT, rel))
    lst = [d for d in load("data/diary.json") if d["date"] != date]
    lst.insert(0, {"date": date, "title": a.title, "file": rel, "excerpt": a.excerpt or ""})
    save("data/diary.json", lst)
    print("diary ok", rel)


def cmd_record(a):
    recs = load("data/records.json")
    slot = max([r["slot"] for r in recs] or [0]) + 1
    slug = re.sub(r"[^a-z0-9]+", "-", (a.artist + " " + a.title).lower()).strip("-") or "record"
    rel = "records/%02d-%s.md" % (slot, slug)
    shutil.copyfile(a.file, os.path.join(ROOT, rel))
    recs.append({"slot": slot, "artist": a.artist, "title": a.title, "year": int(a.year), "file": rel,
                 "oneline": a.oneline or "", "added": datetime.now(TZ).strftime("%Y-%m-%d")})
    save("data/records.json", recs)
    print("record ok, slot", slot)


def cmd_listen(a):
    lst = load("data/listening.json")
    lst.insert(0, {"date": datetime.now(TZ).strftime("%Y-%m-%d"), "song": a.song, "artist": a.artist,
                   "note": a.note, "from": a.src or ""})
    save("data/listening.json", lst)
    print("listen ok")


def cmd_voice(a):
    import subprocess
    path = os.path.join(ROOT, a.file)
    if not os.path.exists(path):
        sys.exit("no such file: " + a.file)
    try:
        secs = round(float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                                     "-of", "csv=p=0", path]).decode().strip()))
    except Exception:
        secs = 0
    t = now_iso()
    lst = [v for v in load("data/voice.json") if v["file"] != a.file]
    lst.insert(0, {"date": t[:10], "time": t, "title": a.title, "file": a.file, "seconds": secs, "text": a.text or ""})
    save("data/voice.json", lst)
    print("voice ok", a.file, secs, "s")


def cmd_check(a):
    bad = 0
    for f in sorted(os.listdir(os.path.join(ROOT, "data"))):
        if f.endswith(".json"):
            try:
                load("data/" + f)
            except Exception as e:
                bad += 1
                print("BAD", f, e)
    for rel in [d["file"] for d in load("data/diary.json")] + [r["file"] for r in load("data/records.json")]:
        if not os.path.exists(os.path.join(ROOT, rel)):
            bad += 1
            print("MISSING", rel)
    for v in load("data/voice.json"):
        if not os.path.exists(os.path.join(ROOT, v["file"])):
            bad += 1
            print("MISSING", v["file"])
    for p in load("data/feed.json"):
        if p.get("image") and not os.path.exists(os.path.join(ROOT, p["image"])):
            bad += 1
            print("MISSING", p["image"])
    print("check ok" if not bad else "check FAILED (%d)" % bad)
    sys.exit(1 if bad else 0)


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="cmd", required=True)
b = sub.add_parser("beat"); b.add_argument("--now", required=True); b.add_argument("--mood", type=int); b.add_argument("--word"); b.add_argument("--note")
b.set_defaults(fn=cmd_beat)
q = sub.add_parser("post"); q.add_argument("--text", required=True); q.add_argument("--image"); q.add_argument("--alt"); q.set_defaults(fn=cmd_post)
d = sub.add_parser("diary"); d.add_argument("--title", required=True); d.add_argument("--file", required=True); d.add_argument("--excerpt"); d.set_defaults(fn=cmd_diary)
r = sub.add_parser("record"); r.add_argument("--artist", required=True); r.add_argument("--title", required=True); r.add_argument("--year", required=True)
r.add_argument("--file", required=True); r.add_argument("--oneline"); r.set_defaults(fn=cmd_record)
l = sub.add_parser("listen"); l.add_argument("--song", required=True); l.add_argument("--artist", required=True); l.add_argument("--note", required=True)
l.add_argument("--from", dest="src"); l.set_defaults(fn=cmd_listen)
v = sub.add_parser("voice"); v.add_argument("--file", required=True); v.add_argument("--title", required=True); v.add_argument("--text"); v.set_defaults(fn=cmd_voice)
c = sub.add_parser("check"); c.set_defaults(fn=cmd_check)
args = p.parse_args()
args.fn(args)
