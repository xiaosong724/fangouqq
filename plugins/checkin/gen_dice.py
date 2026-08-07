# -*- coding: utf-8 -*-
"""娱乐竞猜开奖结果卡片生成器（三颗骰子图形 + 各注输赢清单）
用法：python gen_dice.py --group 群号 --time 时间 --d1 3 --d2 5 --d3 2 --is-bao 0 --bets-json bets.json --out out.png
bets.json: [{"nick": "昵称", "bet": "大", "amount": 100, "win": true, "gain": 100}, ...]
"""
import argparse
import json

from PIL import Image, ImageDraw, ImageFont

FONT = r'C:\Windows\Fonts\msyh.ttc'
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
W = 620
BG_TOP = (246, 246, 250)
BG_BOTTOM = (226, 230, 240)
TITLE_C = (52, 52, 58)
SUB_C = (140, 140, 146)
TEXT_C = (60, 60, 66)
WIN_C = (34, 150, 84)    # 赢（绿）
LOSE_C = (200, 60, 60)   # 输（红）
BAO_C = (196, 120, 40)   # 押爆中奖（金）
HEAD_C = (150, 150, 156)

DICE_SIZE = 104
DICE_GAP = 26
DICE_Y = 168            # 骰子中心 y
SUM_Y = 300             # 和值/判定行 y
HEAD_Y = 372            # 表头 y
ROW_H = 46              # 每行高度


def load_font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def center_text(draw, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text(((W - w) / 2, y), text, font=font, fill=fill)


def draw_dice(draw, cx, cy, value):
    """绘制一颗白色圆角骰子（黑点按 1-6 标准布局）"""
    s = DICE_SIZE
    x0, y0 = cx - s // 2, cy - s // 2
    draw.rounded_rectangle([x0, y0, x0 + s, y0 + s], radius=16, fill=(255, 255, 255),
                           outline=(176, 180, 190), width=2)
    r = max(6, s // 10)   # 点半径
    u = s // 5            # 点偏移单位
    pts = {
        1: [(0, 0)],
        2: [(-1, -1), (1, 1)],
        3: [(-1, -1), (0, 0), (1, 1)],
        4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
        5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
        6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)],
    }
    for dx, dy in pts.get(value, [(0, 0)]):
        draw.ellipse([cx + dx * u - r, cy + dy * u - r, cx + dx * u + r, cy + dy * u + r],
                     fill=(40, 40, 48))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default="")
    ap.add_argument("--time", default="")
    ap.add_argument("--d1", type=int, default=1)
    ap.add_argument("--d2", type=int, default=1)
    ap.add_argument("--d3", type=int, default=1)
    ap.add_argument("--is-bao", type=int, default=0)
    ap.add_argument("--bets-json", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    bets = json.load(open(a.bets_json, encoding="utf-8"))
    n = len(bets)
    H = HEAD_Y + 34 + n * ROW_H + 48
    dices = [a.d1, a.d2, a.d3]
    total = sum(dices)

    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)

    # 标题 + 副标题
    center_text(draw, 28, "娱乐竞猜 · 开奖", load_font(34, True), TITLE_C)
    sub = "群 " + a.group + (" · " + a.time if a.time else "")
    center_text(draw, 86, sub, load_font(20, False), SUB_C)

    # 三颗骰子（横排居中）
    total_w = DICE_SIZE * 3 + DICE_GAP * 2
    x0 = (W - total_w) // 2
    for i, v in enumerate(dices):
        draw_dice(draw, x0 + DICE_SIZE // 2 + i * (DICE_SIZE + DICE_GAP), DICE_Y, v)

    # 和值 + 判定（围骰红字高亮）
    if a.is_bao:
        center_text(draw, SUM_Y, "和值 %d · 围骰！大/小/点数通吃" % total,
                    load_font(26, True), LOSE_C)
    else:
        verdict = "大" if total >= 11 else "小"
        center_text(draw, SUM_Y, "和值 %d（%s）" % (total, verdict),
                    load_font(30, True), TITLE_C)

    # 表头
    f_head = load_font(20, False)
    draw.text((30, HEAD_Y), "玩家", font=f_head, fill=HEAD_C)
    draw.text((210, HEAD_Y), "押注", font=f_head, fill=HEAD_C)
    r_head = "结果"
    draw.text((W - 30 - draw.textlength(r_head, font=f_head), HEAD_Y), r_head, font=f_head, fill=HEAD_C)
    draw.line([(30, HEAD_Y + 30), (W - 30, HEAD_Y + 30)], fill=(200, 202, 208), width=2)

    # 各注结算行
    f_nick = load_font(22, False)
    f_bet = load_font(22, False)
    f_res = load_font(22, True)
    for i, b in enumerate(bets):
        y = HEAD_Y + 34 + i * ROW_H
        nick = b.get("nick") or "群友"
        while len(nick) > 1 and draw.textlength(nick, font=f_nick) > 170:
            nick = nick[:-1]
        draw.text((30, y), nick, font=f_nick, fill=TEXT_C)
        bet_txt = "押%s %d 分" % (b.get("bet", ""), b.get("amount", 0))
        draw.text((210, y), bet_txt, font=f_bet, fill=TEXT_C)
        if b.get("win"):
            color = BAO_C if b.get("bet") == "爆" else WIN_C
            res_txt = "+%d" % b.get("gain", 0)
        else:
            color = LOSE_C
            res_txt = "-%d" % b.get("amount", 0)
        draw.text((W - 30 - draw.textlength(res_txt, font=f_res), y), res_txt, font=f_res, fill=color)

    # 底部总结：庄家净赚
    house = -sum((b.get("gain", 0) if b.get("win") else -b.get("amount", 0)) for b in bets)
    sign = "+" if house >= 0 else ""
    center_text(draw, H - 44, "共 %d 注 · 庄家净赚 %s%d 分" % (n, sign, house),
                load_font(20, False), SUB_C)

    img.save(a.out, "PNG")
    print("OK", a.out, img.size)


if __name__ == "__main__":
    main()
