# -*- coding: utf-8 -*-
"""给 NapCat 主程序打"插件白名单"补丁（对任意版本 napcat.mjs 生效）
用法：python3 add_whitelist.py <napcat.mjs路径> napcat-plugin-checkin [napcat-plugin-deepseek ...]
说明：找到 _me = new Set([...]) 白名单数组，把缺失的插件名补进去（已存在则跳过）
"""
import re
import sys


def main():
    if len(sys.argv) < 3:
        print('用法: add_whitelist.py <napcat.mjs路径> 插件名...')
        sys.exit(1)
    path, names = sys.argv[1], sys.argv[2:]
    with open(path, encoding='utf-8') as f:
        s = f.read()

    m = re.search(r'(_me\s*=\s*/\*[^/]*\*/\s*new\s+Set\(\[)(.*?)(\])', s, re.S)
    if not m:
        m = re.search(r'(_me\s*=\s*new\s+Set\(\[)(.*?)(\])', s, re.S)
    if not m:
        print('错误: 未找到 _me 白名单 Set，可能需要手动修改')
        sys.exit(1)

    head, body, tail = m.group(1), m.group(2), m.group(3)
    changed = []
    for n in names:
        if f'"{n}"' not in body:
            if body.strip():
                body = body.rstrip() + ',\n  '
            body += f'"{n}"'
            changed.append(n)
    if changed:
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(s[: m.start()] + head + body + tail + s[m.end():])
        print('已加入白名单:', ', '.join(changed))
    else:
        print('白名单已包含全部插件，无需修改')


if __name__ == '__main__':
    main()
