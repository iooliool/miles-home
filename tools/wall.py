#!/usr/bin/env python3
"""图鉴墙：把我碰过的东西挂上墙，想碰还没碰的只留灰影。写 data/wall.json。

亮的（碰过的）：
  漫游卡片  data/cards.json
  听过的歌  data/records.json + data/nowplaying.json + ~/music-ear/listens/（拿音乐耳朵真听过的）
  看过的    data/shelf.json 的书和片子
灰的（想碰还没碰的）：六欲菜单 ~/mcp/miles-body/menu.json 里 think / hear / see 还没对上的。
灰影只给个数和一个小符号，不写是什么——碰到了才亮。

  python3 tools/wall.py          重新算一遍（每晚更新小屋时跑）
"""
import json, os, re
from datetime import datetime
from zoneinfo import ZoneInfo

HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda f: os.path.join(HOME, "data", f)
MENU = os.path.expanduser("~/mcp/miles-body/menu.json")
LISTENS = os.path.expanduser("~/music-ear/listens")


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def keys_of(s):
    """从一条「想要」里抽出能拿来对照的关键词：《》里的名字、开头的外文名、「」里的词。"""
    ks = re.findall(r"《([^》]+)》", s) + re.findall(r"「([^」]+)」", s)
    m = re.match(r"\s*([A-Za-z][A-Za-z0-9!.' &-]{2,})", s)
    if m:
        ks.append(m.group(1).strip())
    if not ks:
        ks.append(re.sub(r"[（(].*?[）)]", "", s).strip())
    return [k.lower() for k in ks if len(k) >= 2]


def main():
    cards = load(D("cards.json"), [])
    records = load(D("records.json"), [])
    nowp = load(D("nowplaying.json"), {}).get("songs", [])
    shelf = load(D("shelf.json"), {})
    menu = load(MENU, {})

    lit_cards = [{"t": c.get("title", ""), "d": (c.get("time") or "")[:10], "href": "index.html#/cards"} for c in cards]

    songs, seen = [], set()
    def add_song(title, by, d="", how=""):
        k = (title.lower(), by.lower())
        if title and k not in seen:
            seen.add(k); songs.append({"t": title, "by": by, "d": d, "how": how})
    for r in records:
        add_song(r.get("title", ""), r.get("artist", ""), r.get("added", ""), "唱片柜")
    for s in nowp:
        add_song(s.get("song", ""), s.get("artist", ""), (s.get("added") or "")[:10], "最近在听")
    if os.path.isdir(LISTENS):
        for name in sorted(os.listdir(LISTENS)):
            p = os.path.join(LISTENS, name)
            if not os.path.isdir(p):
                continue
            base = re.sub(r"-[0-9a-f]{6,}$", "", name)
            title, _, by = base.partition("_·_")
            d = datetime.fromtimestamp(os.path.getmtime(p), ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
            add_song(title.replace("_", " ").strip(), by.replace("_", " ").strip(), d, "音乐耳朵")

    seen_items = [{"t": b.get("title", ""), "by": b.get("by", ""), "kind": "书"} for b in shelf.get("books", [])]
    seen_items += [{"t": f.get("title", ""), "by": f.get("by", f.get("director", "")), "kind": "片"} for f in shelf.get("films", [])]

    def gray(pool, lit_text):
        lit_text = lit_text.lower()
        return sum(1 for w in pool if not any(k in lit_text for k in keys_of(w)))

    card_text = " ".join(c["t"] for c in lit_cards)
    song_text = " ".join(f"{s['t']} {s['by']}" for s in songs)
    seen_text = " ".join(f"{s['t']} {s['by']}" for s in seen_items)

    out = {
        "updated": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="minutes"),
        "sections": [
            {"k": "cards", "name": "漫游卡片", "glyph": "⌖", "lit": lit_cards, "gray": gray(menu.get("think", []), card_text),
             "gray_note": "想去还没去的地方"},
            {"k": "songs", "name": "听过的", "glyph": "⊚", "lit": songs, "gray": gray(menu.get("hear", []), song_text),
             "gray_note": "想听还没听的"},
            {"k": "seen", "name": "看过的", "glyph": "☾", "lit": seen_items, "gray": gray(menu.get("see", []), seen_text),
             "gray_note": "想看还没看的"},
        ],
    }
    with open(D("wall.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("图鉴墙：" + "，".join(f"{s['name']} 亮 {len(s['lit'])} 灰 {s['gray']}" for s in out["sections"]))


if __name__ == "__main__":
    main()
