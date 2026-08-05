# -*- coding: utf-8 -*-
"""生成 6 款签到皮肤网格预览图（供「查看签到皮肤」使用）
用法：python gen_skin_grid.py --out 输出.png
"""
import argparse
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_poster import render  # noqa: E402

# 皮肤顺序（与 index.mjs 的 SKIN_LIST 保持一致）
SKIN_LIST = ["xianxia", "gold", "ink", "frost", "sunset", "sakura"]
SKIN_NAMES = {
    "xianxia": "仙侠紫", "gold": "鎏金", "ink": "水墨",
    "frost": "冰蓝", "sunset": "落日", "sakura": "樱花",
}

CELL_W, CELL_H = 300, 416
FONT = r'C:\Windows\Fonts\msyhbd.ttc'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    cols, rows = 3, 2
    grid = Image.new("RGB", (CELL_W * cols, CELL_H * rows), (250, 250, 248))
    draw = ImageDraw.Draw(grid)
    f_num = ImageFont.truetype(FONT, 30)

    for i, key in enumerate(SKIN_LIST):
        x = (i % cols) * CELL_W
        y = (i // cols) * CELL_H
        # 渲染小图（QQ 留空，用占位头像）
        img = render("预览", "", 3, 12, 1, "2026-08-05", key, "", 88).resize((CELL_W, CELL_H))
        grid.paste(img, (x, y))
        # 左上角编号圆 + 名称条
        draw.ellipse((x + 12, y + 12, x + 62, y + 62), fill=(0, 0, 0, 0), outline=None)
        # 半透明黑圆需要单独层，简化：深色圆 + 白字
        badge = Image.new("RGBA", (56, 56), (0, 0, 0, 0))
        bd = ImageDraw.Draw(badge)
        bd.ellipse((0, 0, 56, 56), fill=(0, 0, 0, 150))
        grid.paste(badge, (x + 12, y + 12), badge)
        draw = ImageDraw.Draw(grid)
        num = str(i + 1)
        w = draw.textlength(num, font=f_num)
        draw.text((x + 40 - w / 2, y + 18), num, font=f_num, fill=(255, 255, 255))
        # 底部名称条
        name = SKIN_NAMES[key]
        nw = draw.textlength(name, font=f_num)
        draw.text((x + (CELL_W - nw) / 2, y + CELL_H - 44), name, font=f_num, fill=(255, 255, 255))

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    grid.save(a.out, "PNG")
    print("OK", a.out, grid.size)


if __name__ == "__main__":
    main()
