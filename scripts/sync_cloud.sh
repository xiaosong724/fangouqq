#!/bin/bash
# ============================================================
# 云端 NapCat 插件一键同步脚本（Linux/腾讯云 Ubuntu）
# 用途：把 GitHub 仓库(xiaosong724/fangouqq)最新插件代码同步到
#       NapCat【实际加载目录】并重启 —— 固化手动步骤，避免再踩坑
# 用法：cd /home/ubuntu/Napcat && bash scripts/sync_cloud.sh
# 依赖：curl；GitHub 直连被墙 → 走 jsdelivr CDN（国内可达）
# ============================================================
set -e
cd "$(dirname "$0")/.."
NAPCAT_DIR="$(pwd)"
# ★★★ 关键：NapCat Linux 版实际加载的插件目录是这个，不是 $NAPCAT_DIR/plugins/！
PLUGIN_DIR="$NAPCAT_DIR/opt/QQ/resources/app/app_launcher/napcat/plugins"
BASE="https://cdn.jsdelivr.net/gh/xiaosong724/fangouqq@main"
# 备份目录（防误删）
BK_DIR="/home/ubuntu/backup_napcat"

echo "== 0/4 加载目录: $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR/checkin" "$PLUGIN_DIR/deepseek" "$BK_DIR"

echo "== 1/4 下载最新插件文件（jsdelivr）"
curl -L -o "$PLUGIN_DIR/checkin/index.mjs"   "$BASE/plugins/checkin/index.mjs"
curl -L -o "$PLUGIN_DIR/checkin/gen_dice.py" "$BASE/plugins/checkin/gen_dice.py"
curl -L -o "$PLUGIN_DIR/checkin/gen_poster.py"      "$BASE/plugins/checkin/gen_poster.py"
curl -L -o "$PLUGIN_DIR/checkin/gen_speech_card.py" "$BASE/plugins/checkin/gen_speech_card.py"
curl -L -o "$PLUGIN_DIR/checkin/gen_skin_grid.py"   "$BASE/plugins/checkin/gen_skin_grid.py"
curl -L -o "$PLUGIN_DIR/deepseek/index.mjs"  "$BASE/plugins/deepseek/index.mjs"

echo "== 2/4 适配（中文字体 Noto + python→python3）"
NOTO_REG="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
NOTO_BOLD="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
[ -f "$NOTO_BOLD" ] || NOTO_BOLD="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttf"
[ -f "$NOTO_REG" ] || NOTO_REG="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttf"
[ -f "$NOTO_REG" ] || { echo "错误: 找不到 Noto 中文字体（先装 fonts-noto-cjk）"; exit 1; }
for f in "$PLUGIN_DIR"/checkin/gen_*.py; do
  sed -i "s#r'C:\\\\Windows\\\\Fonts\\\\msyh.ttc'#r'$NOTO_REG'#g; s#r'C:\\\\Windows\\\\Fonts\\\\msyhbd.ttc'#r'$NOTO_BOLD'#g" "$f"
done
for f in "$PLUGIN_DIR"/checkin/index.mjs "$PLUGIN_DIR"/deepseek/index.mjs; do
  sed -i "s/execFile('python'/execFile('python3'/g" "$f"
done
# ★ 防呆：加载目录里不能有 *.bak* 子目录（NapCat 会把 plugins/ 下所有目录当插件扫，
#   曾因 checkin.bak.20260808 被加载导致 help 一直是旧指令！）
find "$PLUGIN_DIR" -maxdepth 1 -type d -name "*.bak*" -exec mv {} "$BK_DIR/" \; 2>/dev/null || true

echo "== 3/4 校验（以下应有输出）"
grep -c "娱乐竞猜" "$PLUGIN_DIR/checkin/index.mjs" || { echo "校验失败：下载的文件不对？"; exit 1; }

echo "== 4/4 重启 NapCat（root 的 screen 会话）"
sudo screen -S napcat -X quit || true
sleep 5
sudo screen -dmS napcat bash -c "xvfb-run -a -s '-screen 0 1280x720x24' $NAPCAT_DIR/opt/QQ/qq --no-sandbox"
echo "======================================================"
echo " 同步完成！NapCat 已重启，60-90 秒后插件生效。"
echo " 验证：群里发「help」看竞猜指令；发「搜索 测试」看联网搜索。"
echo " 说明：config(key) 与签到数据不随脚本同步，一直在原地不受影响。"
echo "======================================================"
