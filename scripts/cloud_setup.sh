#!/bin/bash
# ============================================================
# 云端 NapCat 部署脚本（Ubuntu，在 NapCat 目录运行：bash scripts/cloud_setup.sh）
# 功能：装依赖 → 适配 Linux（字体/python3）→ 打白名单补丁 → 启用插件 → 提示重启
# ============================================================
set -e
cd "$(dirname "$0")/.."
NAPCAT_DIR="$(pwd)"
echo "== NapCat 目录: $NAPCAT_DIR"

# 1. 依赖
echo "== 安装依赖 (python3-pil, fonts-noto-cjk)"
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-pil fonts-noto-cjk

# 2. 中文字体路径适配（Windows 字体 → Noto Sans CJK）
echo "== 适配中文字体路径"
NOTO_REG="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
NOTO_BOLD="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
[ -f "$NOTO_BOLD" ] || NOTO_BOLD="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttf"
[ -f "$NOTO_REG" ] || NOTO_REG="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttf"
[ -f "$NOTO_REG" ] || { echo "错误: 找不到 Noto 中文字体，请检查 fonts-noto-cjk 安装"; exit 1; }
for f in plugins/checkin/gen_poster.py plugins/checkin/gen_skin_grid.py plugins/checkin/gen_speech_card.py; do
  sed -i "s#r'C:\\\\Windows\\\\Fonts\\\\msyh.ttc'#r'$NOTO_REG'#g; s#r'C:\\\\Windows\\\\Fonts\\\\msyhbd.ttc'#r'$NOTO_BOLD'#g" "$f"
done
echo "  字体已指向 $NOTO_REG / $NOTO_BOLD"

# 3. python 命令 → python3
echo "== 适配 python 命令为 python3"
for f in plugins/checkin/index.mjs plugins/deepseek/index.mjs; do
  sed -i "s/execFile('python'/execFile('python3'/g" "$f"
done

# 4. 白名单补丁（幂等）
echo "== 打插件白名单补丁"
python3 scripts/add_whitelist.py napcat.mjs \
  napcat-plugin-checkin napcat-plugin-deepseek napcat-plugin-debug

# 5. plugins.json 启用
echo "== 启用插件"
python3 - <<'EOF'
import json, os
p = 'config/plugins.json'
d = {}
if os.path.exists(p):
    d = json.load(open(p, encoding='utf-8'))
for k in ('napcat-plugin-checkin', 'napcat-plugin-deepseek', 'napcat-plugin-debug'):
    d[k] = True
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('plugins.json:', d)
EOF

echo ""
echo "======================================================"
echo " 部署完成！还差两步："
echo " 1) 若首次部署，创建 DeepSeek 配置（含你的 API Key，不入 git）："
echo "    mkdir -p config/plugins/napcat-plugin-deepseek"
echo "    手动编辑 config/plugins/napcat-plugin-deepseek/config.json"
echo " 2) 重启 NapCat："
echo "    screen -S napcat -X quit"
echo "    screen -dmS napcat bash -c \"xvfb-run -a -s '-screen 0 1280x720x24' $NAPCAT_DIR/opt/QQ/qq --no-sandbox\""
echo " 3) 验证：curl http://127.0.0.1:8998 应有 WS 升级响应"
echo "======================================================"
