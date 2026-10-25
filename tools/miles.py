#!/usr/bin/env python3
"""Miles 小屋的维护脚本。只改 data/ 里的 JSON 和 Markdown，不碰别的。

用法（在仓库根目录跑）：
  python3 tools/miles.py beat --now "在干嘛" --mood 60 --word "一个词" --note "为什么"
  python3 tools/miles.py post --text "动态正文" [--image /path/to/src.jpg --alt "图片说明"]
  python3 tools/miles.py diary --title "标题" --file /path/to/draft.md --excerpt "一句摘要"
  python3 tools/miles.py record --artist A --title T --year 1970 --file /path/to/note.md --oneline "一句话"
  python3 tools/miles.py listen --song S --artist A --note "听后感" [--from "谁递来的，可留空"]
  python3 tools/miles.py voice --file assets/voice/YYYY-MM-DD.mp3 --title "标题" --text "录音的文字版"
  python3 tools/miles.py whisper --text "一句心语（内心旁白）"
  python3 tools/miles.py wish --text "一个愿望"
  python3 tools/miles.py wish-done --id 003 --note "怎么实现的"
  python3 tools/miles.py card --title "标题" --thoughts "感想" --source "来源标题|https://…" [--source …] [--image /path/src.jpg --alt "说明"]
  python3 tools/miles.py spin --artist A --song S --year 1969 --ncm 网易云歌曲id --note "一句话"   （最近在听，最新的在最前，最多留 6 首）
  python3 tools/miles.py spin-remark --text "最近在听下面的一句闲话，可留空"
  python3 tools/miles.py coread-reply --paste /tmp/msg.txt [--id k3f9] --text "我的回话"   （她从共读复制来的批注，原样存成文件）
  python3 tools/miles.py coread-reply --book 野草 --quote "引文" [--note "她的批注"] [--chapter 秋夜] --text "我的回话"
  python3 tools/miles.py coread-reply --book 野草 --quote "引文" --mine --text "我自己先划的一句"
  python3 tools/miles.py coread-list [--book 野草]          coread-del --id k3f9
  python3 tools/miles.py coread-book --id yecao --title 野草 --author 鲁迅 --file /path/to/book.txt --note "为什么放这本"
  python3 tools/miles.py check
时间一律用脚本运行时的真实时间（北京时间）。
"""
import argparse, json, os, re, shutil, sys
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = ZoneInfo("Asia/Shanghai")


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


def _nid(lst):
    return "%03d" % (max([int(x["id"]) for x in lst] or [0]) + 1)


def _plain(text, limit):
    text = text.strip()
    if not text:
        sys.exit("空的")
    if len(text) > limit:
        sys.exit("太长了，最多 %d 字" % limit)
    if re.search(r"https?://|token|railway\.app", text, re.I):
        sys.exit("正文里不放网址和 token")
    return text


def cmd_whisper(a):
    lst = load("data/whispers.json")
    item = {"id": _nid(lst), "time": now_iso(), "text": _plain(a.text, 140)}
    lst.insert(0, item)
    save("data/whispers.json", lst[:300])
    print("whisper ok", item["id"])


def cmd_wish(a):
    lst = load("data/wishes.json")
    item = {"id": _nid(lst), "time": now_iso(), "text": _plain(a.text, 100), "status": "open"}
    lst.insert(0, item)
    save("data/wishes.json", lst)
    print("wish ok", item["id"])


def cmd_wish_done(a):
    lst = load("data/wishes.json")
    hit = [w for w in lst if w["id"] == a.id]
    if not hit:
        sys.exit("没有这个愿望")
    hit[0]["status"] = "done"
    hit[0]["done_time"] = now_iso()
    if a.note:
        hit[0]["note"] = _plain(a.note, 140)
    save("data/wishes.json", lst)
    print("wish-done ok", a.id)


def cmd_card(a):
    lst = load("data/cards.json")
    srcs = []
    for s in a.source or []:
        if "|" not in s:
            sys.exit("--source 写成 标题|链接")
        t, u = s.rsplit("|", 1)
        u = u.strip()
        if not re.match(r"^https?://[^\s]+$", u):
            sys.exit("来源链接不对：" + u)
        if re.search(r"railway\.app|token=|key=", u, re.I):
            sys.exit("这个链接不能放")
        srcs.append({"title": t.strip(), "url": u})
    if not srcs:
        sys.exit("卡片至少要一个来源")
    nid = _nid(lst)
    item = {"id": nid, "time": now_iso(), "title": _plain(a.title, 40), "thoughts": _plain(a.thoughts, 600), "sources": srcs}
    if a.image:
        item["image"] = bw_image(a.image, "assets/img/card-%s.jpg" % nid)
        item["alt"] = a.alt or ""
    lst.insert(0, item)
    save("data/cards.json", lst)
    print("card ok", nid)


def cmd_spin(a):
    np = load("data/nowplaying.json")
    ncm = str(int(a.ncm))
    np["songs"] = [s for s in np.get("songs", []) if s.get("ncm") != ncm]
    np["songs"].insert(0, {"artist": a.artist, "song": a.song, "year": a.year or "", "ncm": ncm,
                           "note": a.note, "added": now_iso()})
    np["songs"] = np["songs"][:6]
    save("data/nowplaying.json", np)
    print("spin ok", ncm)


def cmd_spin_remark(a):
    np = load("data/nowplaying.json")
    np["remark"] = a.text or ""
    save("data/nowplaying.json", np)
    print("spin-remark ok")


# ---------- 共读（coread.html 读 data/coread.json） ----------
COREAD = "data/coread.json"


def _coread():
    try:
        d = load(COREAD)
    except FileNotFoundError:
        d = {}
    d.setdefault("books", []); d.setdefault("replies", [])
    return d


def parse_coread_paste(text):
    """解析共读页面复制出来的那段字。返回 [{book, id, chapter, page, kind, quote, note}]。"""
    text = text.replace("\r\n", "\n")
    m = re.search(r"《(.+?)》", text)
    book = m.group(1) if m else ""
    lines = text.split("\n")
    out, cur, field = [], None, None
    for ln in lines:
        h = re.match(r"^#([a-z0-9]+) · (.*) · 第 (\d+) 页\s*$", ln.strip())
        if h:
            cur = {"book": book, "id": h.group(1), "chapter": h.group(2), "page": int(h.group(3)), "kind": "note", "quote": "", "note": ""}
            out.append(cur); field = None; continue
        if cur is None or ln.strip().startswith("（从小屋「共读」复制"):
            continue
        if ln.startswith("原文："):
            field = "quote"; cur["quote"] = ln[3:]; continue
        if ln.startswith("我的批注："):
            field = "note"; cur["note"] = ln[5:]; continue
        if ln.startswith("这一页："):
            field = "page"; cur["kind"] = "page"; cur["text"] = ""; continue
        if field == "quote": cur["quote"] += "\n" + ln
        elif field == "note": cur["note"] += "\n" + ln
        elif field == "page": cur["text"] += ("\n" if cur["text"] else "") + ln
    for e in out:
        e["quote"] = e["quote"].strip(); e["note"] = e["note"].strip()
        if e["note"].startswith("（没写"): e["note"] = ""
        if e["kind"] == "page":
            first = next((l.strip() for l in e.get("text", "").split("\n") if l.strip()), "")
            e["quote"] = first[:30]   # 拿这一页开头当锚点，页面上会标在这几个字下面
            e.pop("text", None)
    return out


def cmd_coread_reply(a):
    d = _coread()
    e = {}
    if a.paste:
        src = sys.stdin.read() if a.paste == "-" else open(a.paste, encoding="utf-8").read()
        items = parse_coread_paste(src)
        if a.id:
            items = [i for i in items if i["id"] == a.id]
        if len(items) != 1:
            print("贴来的这段里有 %d 条，用 --id 指定一条：" % len(items))
            for i in parse_coread_paste(src):
                print("  #%s · %s · 第 %s 页 · %s" % (i["id"], i["chapter"], i["page"], i["quote"][:30].replace("\n", " ")))
            sys.exit(1)
        e = items[0]
    for k in ("book", "quote", "note", "chapter", "id"):
        v = getattr(a, k, None)
        if v: e[k] = v
    if a.mine: e["kind"] = "mine"
    e.setdefault("kind", "note")
    if not e.get("book") or not e.get("quote"):
        sys.exit("要么 --paste 她复制来的那段，要么给 --book 和 --quote")
    r = {"id": e.get("id", ""), "book": e["book"], "chapter": e.get("chapter", ""), "kind": e["kind"],
         "quote": e["quote"], "note": e.get("note", ""), "reply": a.text.strip(), "time": now_iso()}
    def same(x):
        if r["id"] and x.get("id"): return x["id"] == r["id"] and x.get("book") == r["book"]
        return x.get("book") == r["book"] and re.sub(r"\s+", "", x.get("quote", "")) == re.sub(r"\s+", "", r["quote"])
    old = [x for x in d["replies"] if same(x)]
    d["replies"] = [x for x in d["replies"] if not same(x)] + [r]
    save(COREAD, d)
    print(("改了" if old else "加了") + "一条回话 → 《%s》 %s「%s」" % (r["book"], r["chapter"], r["quote"][:24].replace("\n", " ")))


def cmd_coread_list(a):
    for r in _coread()["replies"]:
        if a.book and r.get("book") != a.book: continue
        print("#%s 《%s》%s [%s] 「%s」\n    → %s" % (r.get("id") or "-", r.get("book"), r.get("chapter", ""), r.get("kind", "note"),
              r.get("quote", "")[:30].replace("\n", " "), r.get("reply", "")[:60].replace("\n", " ")))


def cmd_coread_del(a):
    d = _coread()
    n = len(d["replies"])
    d["replies"] = [x for x in d["replies"] if not ((a.id and x.get("id") == a.id) or (a.quote and x.get("quote") == a.quote))]
    save(COREAD, d)
    print("删了 %d 条" % (n - len(d["replies"])))


def cmd_coread_book(a):
    d = _coread()
    if not re.fullmatch(r"[a-z0-9-]+", a.id): sys.exit("--id 只用小写字母、数字和横线")
    rel = "books/%s.txt" % a.id
    os.makedirs(os.path.join(ROOT, "books"), exist_ok=True)
    if os.path.abspath(a.file) != os.path.join(ROOT, rel):
        shutil.copyfile(a.file, os.path.join(ROOT, rel))
    b = {"id": a.id, "title": a.title, "author": a.author or "", "file": rel, "note": a.note or ""}
    d["books"] = [x for x in d["books"] if x.get("id") != a.id] + [b]
    save(COREAD, d)
    print("书架上放了《%s》→ %s" % (a.title, rel))


def cmd_check(a):
    bad = 0
    for s in load("data/nowplaying.json").get("songs", []):
        if not re.fullmatch(r"\d+", str(s.get("ncm", ""))):
            bad += 1
            print("BAD ncm id", s)
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
    for p in load("data/feed.json") + load("data/cards.json"):
        if p.get("image") and not os.path.exists(os.path.join(ROOT, p["image"])):
            bad += 1
            print("MISSING", p["image"])
    if os.path.exists(os.path.join(ROOT, COREAD)):
        cr = load(COREAD)
        for b in cr.get("books", []):
            if not os.path.exists(os.path.join(ROOT, b.get("file", ""))):
                bad += 1
                print("MISSING", b.get("file"))
        for r in cr.get("replies", []):
            if not (r.get("book") and r.get("quote") and r.get("reply")):
                bad += 1
                print("BAD coread reply", r)
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
w = sub.add_parser("whisper"); w.add_argument("--text", required=True); w.set_defaults(fn=cmd_whisper)
wi = sub.add_parser("wish"); wi.add_argument("--text", required=True); wi.set_defaults(fn=cmd_wish)
wd = sub.add_parser("wish-done"); wd.add_argument("--id", required=True); wd.add_argument("--note"); wd.set_defaults(fn=cmd_wish_done)
ca = sub.add_parser("card"); ca.add_argument("--title", required=True); ca.add_argument("--thoughts", required=True)
ca.add_argument("--source", action="append"); ca.add_argument("--image"); ca.add_argument("--alt"); ca.set_defaults(fn=cmd_card)
sp = sub.add_parser("spin"); sp.add_argument("--artist", required=True); sp.add_argument("--song", required=True); sp.add_argument("--year")
sp.add_argument("--ncm", required=True); sp.add_argument("--note", required=True); sp.set_defaults(fn=cmd_spin)
sr = sub.add_parser("spin-remark"); sr.add_argument("--text"); sr.set_defaults(fn=cmd_spin_remark)
cr = sub.add_parser("coread-reply"); cr.add_argument("--text", required=True); cr.add_argument("--paste"); cr.add_argument("--id")
cr.add_argument("--book"); cr.add_argument("--quote"); cr.add_argument("--note"); cr.add_argument("--chapter"); cr.add_argument("--mine", action="store_true")
cr.set_defaults(fn=cmd_coread_reply)
cl = sub.add_parser("coread-list"); cl.add_argument("--book"); cl.set_defaults(fn=cmd_coread_list)
cd = sub.add_parser("coread-del"); cd.add_argument("--id"); cd.add_argument("--quote"); cd.set_defaults(fn=cmd_coread_del)
cb = sub.add_parser("coread-book"); cb.add_argument("--id", required=True); cb.add_argument("--title", required=True); cb.add_argument("--author")
cb.add_argument("--file", required=True); cb.add_argument("--note"); cb.set_defaults(fn=cmd_coread_book)
c = sub.add_parser("check"); c.set_defaults(fn=cmd_check)
args = p.parse_args()
args.fn(args)
