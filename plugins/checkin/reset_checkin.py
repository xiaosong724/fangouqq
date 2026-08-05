# -*- coding: utf-8 -*-
"""重置签到记录为可测试状态：把指定用户的 last_date 改为昨天（发「签到」即可触发海报）
用法：python reset_checkin.py [--qq 495538306] [--group 876859661]
默认：876859661 群的 495538306（半个六道）
"""
import argparse
import io
import json
from datetime import datetime, timedelta
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent / "data" / "checkin.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--qq", default="495538306")
    ap.add_argument("--group", default="876859661")
    a = ap.parse_args()

    d = json.load(io.open(DATA_FILE, encoding="utf-8"))
    group = d.get(a.group)
    if not group or a.qq not in group:
        print("未找到该用户记录，可签到一次后再重置")
        return

    rec = group[a.qq]
    rec["last_date"] = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    io.open(DATA_FILE, "w", encoding="utf-8", newline="\n").write(
        json.dumps(d, ensure_ascii=False, indent=2))
    print(f"已重置 {a.group}/{a.qq}: {rec['nick']} 的 last_date -> {rec['last_date']}"
          f"（streak {rec['streak']} / total {rec['total']}，发「签到」可触发海报）")


if __name__ == "__main__":
    main()
