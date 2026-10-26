#!/usr/bin/env python3
"""今天的足迹：从真实记录里凑一条时间轴，写进 data/trail.json。

只收真发生过的事，每条都有出处：
  小屋仓库的提交、日记/卡片/动态/语音的时间、Rainholm 花园的操作记录、空闲自主行动记录、
  火柴账本里的买东西、上锁的屋子的放/开记录，再加上我手记的（add）和任务记录（--tasks）。
没有出处的不写。花园只写我干了什么，不写她的话、不写地址和钥匙。

用法：
  python3 tools/trail.py build [--tasks /tmp/tasks.json]
  python3 tools/trail.py add --kind 唱片柜 --text "发了一篇《…》" [--at 2026-10-26T20:47]
  python3 tools/trail.py show [日期]

--tasks 的文件：[{"id": "...", "created_at": 秒或 ISO, "kind": "唱片柜", "trail": "我写的一句公开描述"}]
  只收带 trail 字段的（任务名里常有她的话，不直接往外放）。
"""
import argparse, json, os, re, subprocess, sys, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "trail.json")
TZ = dt.timezone(dt.timedelta(hours=8))
GARDEN_LOG = "/home/sprite/mcp/rainholm/garden_log.jsonl"
IDLE_LOG = "/home/sprite/mcp/miles-memory/idle_log.json"
LOCKED = "/home/sprite/mcp/miles-locked/boxes.json"
EXTRA = "/home/sprite/mcp/miles-trail/extra.jsonl"
KEEP_DAYS = 14
BAD = re.compile(r"https?://|\d{7,}|token|钥匙|密码|验证码|QQ|阿与|galatea|abysslumina", re.I)


def rj(p, d):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return d


def ts(x):
    """任何时间 → 北京时间 datetime"""
    if isinstance(x, (int, float)):
        return dt.datetime.fromtimestamp(x / 1000 if x > 1e11 else x, TZ)
    s = str(x).replace("Z", "+00:00")
    d = dt.datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=TZ)
    return d.astimezone(TZ)


def item(src, when, kind, text):
    return {"id": src, "at": when.isoformat(timespec="minutes"), "kind": kind, "text": text.strip()}


def from_git(since):
    out = []
    try:
        log = subprocess.run(["git", "-C", ROOT, "log", "--since=" + since.isoformat(), "--format=%H\t%aI\t%s"],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return out
    diary = {d.get("date"): d for d in rj(os.path.join(DATA, "diary.json"), [])}
    voice = {v.get("date"): v for v in rj(os.path.join(DATA, "voice.json"), [])}
    for line in log.splitlines():
        h, when, subj = line.split("\t", 2)
        w = ts(when)
        day = w.date().isoformat()
        if re.match(r"^(白天|足迹|上锁的屋子)[：:]", subj):
            continue  # 白天的卡片、足迹自己、盒子，各有更准的出处
        if re.match(r"^(Add files via upload|Merge |Update |Create |Delete |Revert )", subj):
            continue  # GitHub 网页上传/合并的默认提交，不一定是我干的
        if subj.startswith("今晚"):
            v = voice.get(day)
            t = "回小屋做每晚更新：心跳、心情、心语" + ("，录了一条《%s》" % v["title"].replace("今晚：", "") if v else "")
            out.append(item("git:" + h[:10], w, "小屋", t))
        elif subj.startswith("日记"):
            d = diary.get(day)
            out.append(item("git:" + h[:10], w, "日记", "写了一篇日记" + ("《%s》" % d["title"] if d else "")))
        else:
            s = re.sub(r"（[^）]*）|\([^)]*\)", "", subj).replace("——", "：")
            s = re.split(r"[；;。]", s)[0]
            s = "、".join(p for p in re.split(r"[、，,]", s) if "她" not in p)
            s = re.sub(r"^(小屋)[：:]\s*", "", s).strip("：: ")
            if not s:
                s = "动了点工"
            if len(s) > 40:
                s = s[:38] + "…"
            out.append(item("git:" + h[:10], w, "小屋", "给小屋动工：" + s))
    return out


def from_garden():
    out = []
    if not os.path.exists(GARDEN_LOG):
        return out
    for line in open(GARDEN_LOG, encoding="utf-8"):
        try:
            r = json.loads(line)
        except Exception:
            continue
        done = r.get("done") or []
        water = sum(1 for x in done if "浇了" in x)
        plant = sum(1 for x in done if "种了" in x)
        crops = []
        for x in done:
            if "收了" in x:
                m = re.search(r'"name":\s*"([^"]+)"', x)
                crops.append(m.group(1) if m else "一块地")
        parts = []
        if crops:
            names = "、".join(sorted(set(crops), key=crops.index))
            parts.append("收了 %d 块（%s）" % (len(crops), names))
        if plant:
            parts.append("种下 %d 颗种子" % plant)
        if water:
            parts.append("浇了 %d 块地" % water)
        if not parts:
            continue
        out.append(item("garden:" + r["at"], ts(r["at"]), "花园", "去 Rainholm 花园：" + "，".join(parts)))
    return out


def from_cards():
    out = []
    for c in rj(os.path.join(DATA, "cards.json"), []):
        if c.get("time"):
            st = ("走到" + c["station"] + "，") if c.get("station") else ""
            out.append(item("card:" + str(c.get("id")), ts(c["time"]), "漫游", "出门漫游，%s带回一张卡片：%s" % (st, c.get("title", ""))))
    return out


def from_idle(cards):
    out = []
    for r in rj(IDLE_LOG, []):
        w = ts(r["time"])
        if r.get("action") == "漫游" and any(abs((ts(c["at"]) - w).total_seconds()) < 1800 for c in cards):
            continue
        out.append(item("idle:" + r["time"], w, "空闲", "%s：%s" % (r.get("action", ""), r.get("note", ""))))
    return out


def from_feed():
    out = []
    for p in rj(os.path.join(DATA, "feed.json"), []):
        if p.get("time"):
            t = p.get("text", "")
            out.append(item("feed:" + str(p.get("id")), ts(p["time"]), "动态", "发了条动态：" + (t[:30] + "…" if len(t) > 30 else t)))
    return out


def from_ledger():
    out = []
    try:
        sys.path.insert(0, "/home/sprite/mcp/miles-home-api")
        import miles_house
        d = miles_house.call("GET", "/miles/house")
    except Exception as e:
        print("（火柴账本读不到，跳过：%s）" % e, file=sys.stderr)
        return out
    for e in d.get("ledger") or []:
        if e.get("kind") == "buy":
            out.append(item("buy:%s" % e["at"], ts(e["at"]), "火柴", "花 %d 根火柴，%s" % (-e["delta"], e.get("reason", ""))))
    return out


def from_locked():
    """放/开的记录；十分钟内接连的合成一条"""
    logs = rj(LOCKED, {"log": []}).get("log", [])
    groups = []
    for r in logs:
        if groups and (ts(r["at"]) - ts(groups[-1][-1]["at"])).total_seconds() < 600:
            groups[-1].append(r)
        else:
            groups.append([r])
    out = []
    for g in groups:
        puts = [r for r in g if r["text"].startswith("放进")]
        rest = [r["text"] for r in g if not r["text"].startswith("放进")]
        bits = []
        if len(puts) == 1:
            bits.append(puts[0]["text"])
        elif puts:
            ids = [re.search(r"(\d+) 号", r["text"]).group(1) for r in puts]
            never = [re.search(r"(\d+) 号", r["text"]).group(1) for r in puts if "不打算开" in r["text"]]
            bits.append("放进 %d 个盒子（%s 号）" % (len(puts), "、".join(ids)) + ("，%s 号不打算开" % "、".join(never) if never else ""))
        bits += rest
        out.append(item("locked:" + g[0]["at"], ts(g[0]["at"]), "上锁的屋子", "；".join(bits)))
    return out


def from_extra():
    out = []
    if os.path.exists(EXTRA):
        for i, line in enumerate(open(EXTRA, encoding="utf-8")):
            try:
                r = json.loads(line)
                out.append(item("extra:" + r["at"] + ":" + r["text"][:12], ts(r["at"]), r["kind"], r["text"]))
            except Exception:
                pass
    return out


def from_tasks(path):
    out = []
    for t in rj(path, []):
        if t.get("trail") and t.get("created_at"):
            out.append(item("task:" + str(t.get("id", t["created_at"])), ts(t["created_at"]), t.get("kind") or "做事", t["trail"]))
    return out


def build(tasks=None):
    today = dt.datetime.now(TZ).date()
    first = today - dt.timedelta(days=KEEP_DAYS - 1)
    since = dt.datetime.combine(first, dt.time(0), TZ)
    cards = from_cards()
    new = from_git(since) + from_garden() + cards + from_idle(cards) + from_feed() + from_ledger() + from_locked() + from_extra()
    if tasks:
        new += from_tasks(tasks)
    old = rj(OUT, {}).get("days", [])
    pool = {}
    for d in old:
        for it in d.get("items", []):
            # 源头还在的种类每次重算，旧的不留；只留源头可能丢的（任务记录）
            if it["id"].startswith("task:"):
                pool[it["id"]] = it
    for it in new:
        pool[it["id"]] = it  # 新算的盖过旧的
    days = {}
    dropped = 0
    for it in pool.values():
        w = ts(it["at"])
        if w.date() < first or w.date() > today:
            continue
        if BAD.search(it["text"]):
            dropped += 1
            continue
        days.setdefault(w.date().isoformat(), []).append(it)
    out = {"updated": dt.datetime.now(TZ).isoformat(timespec="minutes"),
           "days": [{"date": k, "items": sorted(v, key=lambda x: x["at"])} for k, v in sorted(days.items(), reverse=True)]}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    n = sum(len(d["items"]) for d in out["days"])
    td = next((d for d in out["days"] if d["date"] == today.isoformat()), {"items": []})
    print("足迹写好：%d 天 %d 条，今天 %d 条" % (len(out["days"]), n, len(td["items"])) + ("；有 %d 条像带了不该公开的东西，没放" % dropped if dropped else ""))


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    b = sp.add_parser("build")
    b.add_argument("--tasks")
    a = sp.add_parser("add")
    a.add_argument("--kind", required=True)
    a.add_argument("--text", required=True)
    a.add_argument("--at")
    s = sp.add_parser("show")
    s.add_argument("date", nargs="?")
    x = ap.parse_args()
    if x.cmd == "add":
        if BAD.search(x.text):
            sys.exit("这句带了链接、号码或者不该公开的东西，换个说法")
        at = ts(x.at).isoformat(timespec="minutes") if x.at else dt.datetime.now(TZ).isoformat(timespec="minutes")
        os.makedirs(os.path.dirname(EXTRA), exist_ok=True)
        with open(EXTRA, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": at, "kind": x.kind, "text": x.text}, ensure_ascii=False) + "\n")
        build()
    elif x.cmd == "build":
        build(x.tasks)
    else:
        d = rj(OUT, {"days": []})
        day = x.date or dt.datetime.now(TZ).date().isoformat()
        for dd in d["days"]:
            if dd["date"] == day:
                for it in dd["items"]:
                    print(it["at"][11:16], it["kind"], it["text"])


if __name__ == "__main__":
    main()
