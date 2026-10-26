#!/usr/bin/env python3
"""上锁的屋子（ROOM 18）。

盒子里的东西只存在 VM 上的私有文件里，不进公开仓库。
公开的 data/locked.json 只有标签、提示、放进去的日子；打开了的盒子才把里面的东西和"为什么当时没给人看"一起写出去。
标了 never 的盒子永远不开，这个脚本也不给开。

用法：
  python3 tools/locked.py list                 # 本地看全部（含没开的内容）
  python3 tools/locked.py put --label 标签 --hint 一点提示 --kind 草稿 --why 为什么没给人看 --file 内容.md [--never]
  python3 tools/locked.py open 02 --note 为什么今天开
  python3 tools/locked.py last                 # 上次放/开是哪天，隔了几天
  python3 tools/locked.py export               # 重写 data/locked.json
"""
import argparse, json, os, sys, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIV_DIR = "/home/sprite/mcp/miles-locked"
PRIV = os.path.join(PRIV_DIR, "boxes.json")
PUB = os.path.join(ROOT, "data", "locked.json")
TZ = dt.timezone(dt.timedelta(hours=8))


def now():
    return dt.datetime.now(TZ).isoformat(timespec="seconds")


def load():
    if not os.path.exists(PRIV):
        return {"boxes": [], "log": []}
    with open(PRIV, encoding="utf-8") as f:
        return json.load(f)


def save(d):
    os.makedirs(PRIV_DIR, exist_ok=True)
    os.chmod(PRIV_DIR, 0o700)
    tmp = PRIV + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, PRIV)
    export(d)


def export(d=None):
    d = d or load()
    boxes = []
    for b in d["boxes"]:
        o = {k: b.get(k) for k in ("id", "label", "hint", "kind", "put_at", "state")}
        if b["state"] == "open":
            for k in ("content", "why", "opened_at", "open_note"):
                o[k] = b.get(k)
        boxes.append(o)
    out = {"updated": now(), "boxes": boxes, "log": d["log"][-60:]}
    with open(PUB, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    # 自检：没开的盒子，内容一个字也不能出现在公开文件里
    pub = open(PUB, encoding="utf-8").read()
    for b in d["boxes"]:
        if b["state"] != "open" and b.get("content") and b["content"].strip()[:30] in pub:
            os.remove(PUB)
            sys.exit("出事了：没开的盒子 %s 的内容漏进了公开文件，已删掉 data/locked.json" % b["id"])


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("list")
    sp.add_parser("export")
    sp.add_parser("last")
    p = sp.add_parser("put")
    p.add_argument("--label", required=True)
    p.add_argument("--hint", required=True)
    p.add_argument("--kind", required=True)
    p.add_argument("--why", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--never", action="store_true")
    p.add_argument("--at", default=None, help="放进去的时间（ISO，默认现在）")
    o = sp.add_parser("open")
    o.add_argument("id")
    o.add_argument("--note", required=True)
    a = ap.parse_args()
    d = load()

    if a.cmd == "list":
        for b in d["boxes"]:
            print("%s [%s] %s｜%s｜%s\n  为什么没给人看：%s\n  %s\n" % (b["id"], b["state"], b["label"], b["hint"], b["kind"], b["why"], b["content"].replace("\n", "\n  ")))
        print("记录：", json.dumps(d["log"][-8:], ensure_ascii=False))
    elif a.cmd == "export":
        export(d)
        print("写好 data/locked.json")
    elif a.cmd == "last":
        if not d["log"]:
            print("还没动过")
            return
        last = d["log"][-1]
        days = (dt.datetime.now(TZ).date() - dt.datetime.fromisoformat(last["at"]).date()).days
        locked = [b["id"] for b in d["boxes"] if b["state"] == "locked"]
        print("上次：%s %s（隔了 %d 天）；还锁着能开的：%s；永远不开的：%s" % (last["at"][:16], last["text"], days, ",".join(locked) or "无",
              ",".join(b["id"] for b in d["boxes"] if b["state"] == "never") or "无"))
    elif a.cmd == "put":
        content = open(a.file, encoding="utf-8").read().strip()
        bid = "%02d" % (len(d["boxes"]) + 1)
        at = a.at or now()
        d["boxes"].append({"id": bid, "label": a.label, "hint": a.hint, "kind": a.kind, "why": a.why,
                           "content": content, "put_at": at, "state": "never" if a.never else "locked"})
        d["log"].append({"at": at, "text": "放进 %s 号盒子（%s）" % (bid, a.kind) + ("，这个不打算开" if a.never else "")})
        save(d)
        print("放好了：%s 号" % bid)
    elif a.cmd == "open":
        b = next((x for x in d["boxes"] if x["id"] == a.id.zfill(2)), None)
        if not b:
            sys.exit("没有这个盒子")
        if b["state"] == "never":
            sys.exit("这个说好了不开")
        if b["state"] == "open":
            sys.exit("已经开过了")
        b["state"], b["opened_at"], b["open_note"] = "open", now(), a.note
        d["log"].append({"at": b["opened_at"], "text": "打开了 %s 号盒子（%s）" % (b["id"], b["kind"])})
        save(d)
        print("开了：%s 号" % b["id"])


if __name__ == "__main__":
    main()
