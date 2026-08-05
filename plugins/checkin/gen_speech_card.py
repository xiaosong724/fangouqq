# -*- coding: utf-8 -*-
"""发言排行卡片生成器（表格格式：排名 | 成员 | 发言条数）
用法：python gen_speech_card.py --title 标题 --sub 副标题 --items-json items.json --out out.png
items.json: [{"nick": "昵称", "count": 12}, ...]（已按次数降序）
"""
import argparse
import json

from PIL import Image, ImageDraw, ImageFont

FONT = r'C:\Windows\Fonts\msyh.ttc'
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
W = 620
HEADER_H = 150
HEAD_ROW_H = 42
ROW_H = 52
PAD = 30
MAX_ROWS = 10

BG_TOP = (248, 248, 244)
BG_BOTTOM = (232, 234, 228)
TITLE_C = (52, 52, 58)
SUB_C = (140, 140, 146)
HEAD_C = (150, 150, 156)
TEXT_C = (60, 60, 66)
TOP_C = (196, 120, 40)  # Top1-3 强调色（金）
COL_RANK_X = PAD
COL_NAME_X = PAD + 120
COL_CNT_X = W - PAD - 130


def load_font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def center_text(draw, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text(((W - w) / 2, y), text, font=font, fill=fill)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", default="发言排行")
    ap.add_argument("--sub", default="")
    ap.add_argument("--col-name", default="发言条数")
    ap.add_argument("--items-json", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    items = json.load(open(a.items_json, encoding="utf-8"))[:MAX_ROWS]
    n = len(items)
    H = HEADER_H + HEAD_ROW_H + n * ROW_H + 28

    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)

    # 标题 + 副标题
    center_text(draw, 32, a.title, load_font(36, True), TITLE_C)
    center_text(draw, 92, a.sub, load_font(22, False), SUB_C)

    # 表头
    y0 = HEADER_H
    f_head = load_font(22, False)
    draw.text((COL_RANK_X, y0 + 8), "排名", font=f_head, fill=HEAD_C)
    draw.text((COL_NAME_X, y0 + 8), "成员", font=f_head, fill=HEAD_C)
    cnt_head = a.col_name
    draw.text((COL_CNT_X + 130 - draw.textlength(cnt_head, font=f_head), y0 + 8),
              cnt_head, font=f_head, fill=HEAD_C)
    draw.line([(PAD, y0 + HEAD_ROW_H - 2), (W - PAD, y0 + HEAD_ROW_H - 2)], fill=(200, 202, 198), width=2)

    # 数据行
    f_rank = load_font(24, True)
    f_nick = load_font(24, False)
    f_cnt = load_font(24, True)
    for i, it in enumerate(items):
        y = y0 + HEAD_ROW_H + i * ROW_H
        is_top = i < 3
        color = TOP_C if is_top else TEXT_C
        rank = f"Top{i + 1}"
        draw.text((COL_RANK_X, y + 10), rank, font=f_rank, fill=color)
        nick = it.get("nick") or "群友"
        while len(nick) > 1 and draw.textlength(nick, font=f_nick) > 250:
            nick = nick[:-1]
        draw.text((COL_NAME_X, y + 10), nick, font=f_nick, fill=TEXT_C)
        cnt = str(it["count"])
        draw.text((COL_CNT_X + 130 - draw.textlength(cnt, font=f_cnt), y + 10), cnt, font=f_cnt, fill=color)

    img.save(a.out, "PNG")
    print("OK", a.out, img.size)


if __name__ == "__main__":
    main()
