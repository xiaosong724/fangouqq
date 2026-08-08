# -*- coding: utf-8 -*-
"""签到海报生成器（NapCat 插件调用）
用法：python gen_poster.py --nick 昵称 --qq QQ号 --streak 连续天数 --total 累计 --rank 排名 --date 日期 --style 款式 --out 输出.png
款式：xianxia 仙侠紫(默认) / gold 鎏金 / ink 水墨 / frost 冰蓝
"""
import argparse
import io
import urllib.request

from PIL import Image, ImageDraw, ImageFont

FONT = r'C:\Windows\Fonts\msyh.ttc'
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
W, H = 620, 860

# ---------------------------------------------------------------- 款式定义
STYLES = {
    "xianxia": {  # 仙侠紫（默认）：深紫渐变 + 紫金光晕
        "bg_top": (30, 24, 60), "bg_bottom": (16, 30, 68),
        "glow": (128, 86, 210, 70), "title": (255, 216, 110),
        "card": (44, 50, 92), "text": (240, 240, 250), "sub": (190, 195, 220),
        "accent": (180, 120, 255),
    },
    "gold": {  # 鎏金：暗红褐 → 深蓝，金色标题，富贵渡劫感
        "bg_top": (58, 32, 18), "bg_bottom": (26, 18, 44),
        "glow": (255, 170, 60, 65), "title": (255, 214, 90),
        "card": (70, 48, 42), "text": (252, 244, 228), "sub": (200, 178, 150),
        "accent": (255, 190, 80),
    },
    "ink": {  # 水墨：浅灰纸底 + 墨色文字
        "bg_top": (238, 238, 232), "bg_bottom": (214, 218, 212),
        "glow": (150, 150, 150, 40), "title": (48, 48, 54),
        "card": (252, 252, 250), "text": (56, 56, 62), "sub": (130, 130, 136),
        "accent": (96, 96, 104),
    },
    "frost": {  # 冰蓝：深海蓝 → 青，冷色科技感
        "bg_top": (22, 44, 76), "bg_bottom": (12, 26, 52),
        "glow": (90, 180, 255, 60), "title": (165, 226, 255),
        "card": (38, 60, 98), "text": (236, 244, 252), "sub": (168, 186, 210),
        "accent": (110, 200, 255),
    },
    "sunset": {  # 落日：橙 → 紫渐变，暖色黄昏
        "bg_top": (92, 46, 54), "bg_bottom": (52, 28, 72),
        "glow": (255, 140, 90, 75), "title": (255, 205, 125),
        "card": (86, 56, 70), "text": (252, 240, 236), "sub": (214, 188, 182),
        "accent": (255, 150, 110),
    },
    "sakura": {  # 樱花：浅粉底 + 深玫红
        "bg_top": (251, 241, 245), "bg_bottom": (238, 219, 228),
        "glow": (255, 170, 200, 55), "title": (198, 76, 118),
        "card": (255, 250, 252), "text": (122, 72, 92), "sub": (182, 142, 156),
        "accent": (232, 122, 162),
    },
}


def load_font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def download_avatar(qq, size=200):
    if not qq:
        return None
    url = "https://q1.qlogo.cn/g?b=qq&nk=%s&s=640" % qq
    try:
        data = urllib.request.urlopen(url, timeout=8).read()
        return Image.open(io.BytesIO(data)).convert("RGB").resize((size, size))
    except Exception:
        return None


def rounded_avatar(av, size):
    if av is None:
        av = Image.new("RGB", (size, size), (110, 120, 150))
    else:
        av = av.resize((size, size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(av, (0, 0), mask)
    return out


def draw_bg(draw, st):
    for y in range(H):
        t = y / H
        c = tuple(int(st["bg_top"][i] + (st["bg_bottom"][i] - st["bg_top"][i]) * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)


def center_text(draw, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text(((W - w) / 2, y), text, font=font, fill=fill)


def render(nick, qq, streak, total, rank, date, style="xianxia", saying="", points=0, bonus=0):
    """渲染海报，返回 PIL Image；saying 为给成员的话（底部显示，可换行），points 为积分，bonus 为连续签到额外奖励"""
    st = STYLES.get(style, STYLES["xianxia"])

    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    draw_bg(draw, st)

    # 顶部光晕
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W // 2 - 270, -180, W // 2 + 270, 360), fill=st["glow"])
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(img)

    # 标题 + 标题下装饰线
    center_text(draw, 96, "签 到 成 功", load_font(54, True), st["title"])
    line_w = 200
    draw.rounded_rectangle(((W - line_w) / 2, 172, (W + line_w) / 2, 176),
                           radius=2, fill=st["accent"])
    center_text(draw, 196, date or "", load_font(24, False), st["sub"])

    # 头像
    av = rounded_avatar(download_avatar(qq), 148)
    img.paste(av, (W // 2 - 74, 248), av)
    draw = ImageDraw.Draw(img)

    # 昵称（超长截断）
    nick = nick or "群友"
    f_nick = load_font(32, True)
    while len(nick) > 1 and draw.textlength(nick, font=f_nick) > W - 90:
        nick = nick[:-1]
    center_text(draw, 430, nick, f_nick, st["text"])

    # 四张数据卡片：连续/累计/积分/排名
    stats = [("连续签到", "%d 天" % streak), ("累计签到", "%d 次" % total),
             ("积分", "%d" % points), ("群排名", "第 %d 名" % rank if rank else "暂无")]
    card_w, gap = 137, 12
    x0 = (W - card_w * 4 - gap * 3) / 2
    f_label = load_font(17, False)
    f_value = load_font(28, True)
    for i, (label, value) in enumerate(stats):
        x = x0 + i * (card_w + gap)
        y = 516
        draw.rounded_rectangle((x, y, x + card_w, y + 152), radius=16, fill=st["card"])
        lw = draw.textlength(label, font=f_label)
        draw.text((x + (card_w - lw) / 2, y + 20), label, font=f_label, fill=st["sub"])
        vw = draw.textlength(value, font=f_value)
        draw.text((x + (card_w - vw) / 2, y + 68), value, font=f_value, fill=st["title"])

    # 底部：连续签到奖励（第 3 天起显示）+ 随机给成员的话（可换行）+ 提示
    say_y = 700
    if bonus > 0:
        f_bonus = load_font(22, True)
        bonus_txt = "连续签到奖励 %d 积分" % bonus
        center_text(draw, 700, bonus_txt, f_bonus, st["accent"])
        say_y = 744
    if saying:
        f_say = load_font(22, False)
        max_w = W - 70
        lines = []
        cur = saying
        while cur and len(lines) < 2:
            # 按字符宽度截断到一行能放下的长度
            n = len(cur)
            while n > 1 and draw.textlength(cur[:n], font=f_say) > max_w:
                n -= 1
            lines.append(cur[:n])
            cur = cur[n:]
        y = say_y
        for ln in lines:
            lw = draw.textlength(ln, font=f_say)
            draw.text(((W - lw) / 2, y), ln, font=f_say, fill=st["sub"])
            y += 34
        center_text(draw, y + 14, "明日再来，保持连胜！", load_font(22, False), st["sub"])
    else:
        center_text(draw, say_y + 40, "明日再来，保持连胜！", load_font(24, False), st["sub"])
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nick", default="群友")
    ap.add_argument("--qq", default="")
    ap.add_argument("--streak", type=int, default=0)
    ap.add_argument("--total", type=int, default=0)
    ap.add_argument("--rank", type=int, default=0)
    ap.add_argument("--date", default="")
    ap.add_argument("--style", default="xianxia")
    ap.add_argument("--saying", default="")
    ap.add_argument("--bonus", type=int, default=0)
    ap.add_argument("--points", type=int, default=0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    img = render(a.nick, a.qq, a.streak, a.total, a.rank, a.date, a.style, a.saying, a.points, a.bonus)
    img.save(a.out, "PNG")
    print("OK", a.out, a.style)


if __name__ == "__main__":
    main()
