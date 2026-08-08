// =============================================================================
// 群签到插件（NapCat 原生插件，纯签到 + 连续天数 + 群排行 + 图片海报）
// 指令：签到 / 我的签到 / 签到排行
// 数据：data/checkin.json（按群+QQ 隔离）
// 海报：调用 gen_poster.py（Python + PIL）生成，走 send_msg image 段发送
// =============================================================================
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'checkin.json');
const POSTER_DIR = path.join(DATA_DIR, 'posters');
const POSTER_SCRIPT = path.join(__dirname, 'gen_poster.py');
const RANK_LIMIT = 10;

// 签到皮肤（与 gen_poster.py / gen_skin_grid.py 的 SKIN_LIST 保持一致）
const SKIN_LIST = ['xianxia', 'gold', 'ink', 'frost', 'sunset', 'sakura'];
const SKIN_NAMES = { xianxia: '仙侠紫', gold: '鎏金', ink: '水墨', frost: '冰蓝', sunset: '落日', sakura: '樱花' };
const SKIN_DESC = {
  xianxia: '深紫渐变·紫金光晕', gold: '暗红褐底·金色标题', ink: '浅灰纸底·墨色文字',
  frost: '深海蓝·冷色科技', sunset: '橙紫渐变·暖色黄昏', sakura: '浅粉底·深玫红',
};
const SKIN_GRID_SCRIPT = path.join(__dirname, 'gen_skin_grid.py');
const SKIN_GRID_FILE = path.join(DATA_DIR, 'skins', 'grid.png');

// 发言统计
const SPEECH_FILE = path.join(DATA_DIR, 'speech.json');
const SPEECH_CARD_SCRIPT = path.join(__dirname, 'gen_speech_card.py');
const REPORT_STATE_FILE = path.join(DATA_DIR, 'report_state.json');
const SAYINGS_FILE = path.join(DATA_DIR, 'sayings.json');
let _sayings = null;

// 娱乐竞猜（掷骰子赌大小：局制，开启后 30 秒自动开奖/关闭）
const GAME_FILE = path.join(DATA_DIR, 'game.json');
const GAME_DICE_SCRIPT = path.join(__dirname, 'gen_dice.py');
const GAME_DURATION = 30;   // 开启后 30 秒自动开奖（无人下注则自动关闭）
const GAME_MIN_BET = 10;    // 单注下限
const GAME_BAO_ODDS = 24;   // 围骰赔率 1:24
// 猜点数赔率（按出现概率倒算）：{ 点数: 赔率倍数 }
const POINT_ODDS = {
  10: 7, 11: 7, 9: 7, 12: 7, 8: 9, 13: 9, 7: 13, 14: 13,
  6: 20, 15: 20, 5: 35, 16: 35, 4: 70, 17: 70, 3: 200, 18: 200,
};
let _games = null; // 内存态：{ 群号: { opener, open_at, bets, timer } }
let _speechCache = null;
let _reportState = null;
let _ctx = null; // 定时器发布用（plugin_init 注入）

// 皮肤顺序（与 gen_skin_grid.py 保持一致）

let logger = null;

// ---------------------------------------------------------------- 工具
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_FILE); // 原子替换
}

// ---------------------------------------------------------------- 核心逻辑
function doCheckin(groupId, userId, nick) {
  const data = load();
  const g = data[groupId] || (data[groupId] = {});
  const rec = g[userId] || { streak: 0, total: 0, last_date: '', nick: '' };
  const t = today();
  if (rec.last_date === t) {
    return { ok: false, streak: rec.streak, total: rec.total, last_date: rec.last_date };
  }
  rec.streak = rec.last_date === yesterday() ? rec.streak + 1 : 1;
  rec.total += 1;
  rec.last_date = t;
  if (nick) rec.nick = nick;
  if (!rec.skin) rec.skin = 'ink'; // 默认皮肤
  if (typeof rec.points !== 'number') rec.points = 0;
  const gain = 1 + Math.floor(Math.random() * 100); // 签到随机 1-100 积分
  rec.points += gain;
  // 连续签到奖励：连续第 3 天起（含第 3 天），只要不间断每天额外 +50 积分
  const bonus = rec.streak >= 3 ? 50 : 0;
  if (bonus > 0) rec.points += bonus;
  g[userId] = rec;
  save(data);
  return { ok: true, streak: rec.streak, total: rec.total, last_date: t, skin: rec.skin, points: rec.points, gain, bonus };
}
function getStatus(groupId, userId) {
  const rec = load()[groupId]?.[userId];
  if (!rec) return { signed: false, streak: 0, total: 0, last_date: '', skin: 'ink', points: 0 };
  return { signed: rec.last_date === today(), streak: rec.streak, total: rec.total, last_date: rec.last_date, skin: rec.skin || 'ink', points: rec.points || 0 };
}
function setSkin(groupId, userId, skin) {
  const data = load();
  const g = data[groupId] || (data[groupId] = {});
  const rec = g[userId] || (g[userId] = { streak: 0, total: 0, last_date: '', nick: '' });
  rec.skin = skin;
  save(data);
}
function transferPoints(groupId, from, to, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, msg: '积分必须为正整数' };
  }
  const data = load();
  const g = data[groupId] || (data[groupId] = {});
  const f = g[from] || (g[from] = { streak: 0, total: 0, last_date: '', points: 0 });
  f.points = f.points || 0;
  if (f.points < amount) {
    return { ok: false, msg: `积分不足（当前 ${f.points}）` };
  }
  const t = g[to] || (g[to] = { streak: 0, total: 0, last_date: '', points: 0 });
  t.points = t.points || 0;
  f.points -= amount;
  t.points += amount;
  save(data);
  return { ok: true, fromPoints: f.points, toNick: t.nick || '' };
}

function randomSaying() {
  if (!_sayings) {
    try {
      _sayings = JSON.parse(fs.readFileSync(SAYINGS_FILE, 'utf-8'));
    } catch {
      _sayings = [];
    }
  }
  if (!_sayings.length) return '';
  return _sayings[Math.floor(Math.random() * _sayings.length)].text || '';
}

function pointsRank(groupId, limit = 10) {
  const g = load()[groupId] || {};
  return Object.entries(g)
    .map(([uid, r]) => ({ uid, nick: r.nick || '', points: r.points || 0 }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

// ---------------------------------------------------------------- 娱乐竞猜
function gameLoad() {
  if (_games) return _games;
  try {
    _games = JSON.parse(fs.readFileSync(GAME_FILE, 'utf-8'));
  } catch {
    _games = {};
  }
  return _games;
}
function gameSave() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const clean = {};
  for (const [gid, g] of Object.entries(_games || {})) {
    clean[gid] = { opener: g.opener, open_at: g.open_at, bets: g.bets };
  }
  const tmp = GAME_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf-8');
  fs.renameSync(tmp, GAME_FILE);
}
function gameRemainSec(g) {
  return Math.max(0, Math.ceil((g.open_at + GAME_DURATION * 1000 - Date.now()) / 1000));
}
function rollDice() {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}
function openGame(groupId, userId, nick) {
  const games = gameLoad();
  const old = games[groupId];
  if (old) {
    return { ok: false, msg: `已有竞猜进行中（剩余 ${gameRemainSec(old)} 秒），发「欧皇附体」可提前开奖` };
  }
  games[groupId] = { opener: userId, open_at: Date.now(), bets: [] };
  gameSave();
  scheduleGameEnd(groupId);
  return { ok: true };
}
function placeBet(groupId, userId, nick, type, point, amount) {
  const games = gameLoad();
  const g = games[groupId];
  if (!g) return { ok: false, msg: '本群还没开启竞猜，先发「开启娱乐竞猜」' };
  if (g.bets.some((b) => b.qq === userId)) return { ok: false, msg: '每人每局限一注，你已经下过注了' };
  if (!Number.isInteger(amount) || amount < GAME_MIN_BET) {
    return { ok: false, msg: `单注至少 ${GAME_MIN_BET} 积分` };
  }
  const data = load();
  const rec = data[groupId]?.[userId];
  const pts = rec?.points || 0;
  if (pts < amount) {
    return { ok: false, msg: `积分不足（当前 ${pts} 分），先去「签到」攒积分吧` };
  }
  rec.points -= amount; // 下注即扣积分，无需确认
  rec.game = rec.game || {};
  rec.game.played = (rec.game.played || 0) + 1;
  rec.game.maxBet = Math.max(rec.game.maxBet || 0, amount);
  save(data);
  g.bets.push({ qq: userId, nick: nick || userId, type, point, amount });
  gameSave();
  return { ok: true, points: rec.points };
}
function settleGame(groupId) {
  const games = gameLoad();
  const g = games[groupId];
  if (!g) return null;
  const dices = rollDice();
  const sum = dices[0] + dices[1] + dices[2];
  const isBao = dices[0] === dices[1] && dices[1] === dices[2]; // 围骰通吃
  const verdict = isBao ? '围骰' : (sum >= 11 ? '大' : '小');
  const results = g.bets.map((b) => {
    let win = false;
    let gain = 0;
    let label = '';
    if (b.type === 'big') {
      label = '大';
      win = !isBao && sum >= 11;
      gain = win ? b.amount : 0;
    } else if (b.type === 'small') {
      label = '小';
      win = !isBao && sum <= 10;
      gain = win ? b.amount : 0;
    } else if (b.type === 'bao') {
      label = '爆';
      win = isBao;
      gain = win ? b.amount * GAME_BAO_ODDS : 0;
    } else if (b.type === 'point') {
      label = `和 ${b.point}`;
      win = !isBao && sum === b.point;
      gain = win ? b.amount * (POINT_ODDS[b.point] || 7) : 0;
    }
    return { qq: b.qq, nick: b.nick, label, amount: b.amount, win, gain };
  });
  // 结算积分与战绩
  const data = load();
  for (const r of results) {
    const rec = data[groupId]?.[r.qq];
    if (!rec) continue;
    if (r.win) rec.points = (rec.points || 0) + r.amount + r.gain; // 退回本金 + 赔付
    rec.game = rec.game || {};
    if (r.win) rec.game.won = (rec.game.won || 0) + 1;
    rec.game.net = (rec.game.net || 0) + (r.win ? r.gain : -r.amount);
    rec.game.best = Math.max(rec.game.best || 0, r.gain);
  }
  save(data);
  delete games[groupId];
  gameSave();
  clearTimeout(g.timer);
  return { dices, sum, isBao, verdict, results };
}
function genDiceCard(groupId, settled) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(POSTER_DIR, { recursive: true });
    const out = path.join(POSTER_DIR, `dice_${Date.now()}.png`);
    const tmp = path.join(POSTER_DIR, `dice_${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(
      settled.results.map((r) => ({ nick: r.nick, bet: r.label, amount: r.amount, win: r.win, gain: r.gain })),
    ), 'utf-8');
    const d = new Date();
    const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    execFile('python', [
      GAME_DICE_SCRIPT,
      '--group', groupId,
      '--time', timeStr,
      '--d1', String(settled.dices[0]),
      '--d2', String(settled.dices[1]),
      '--d3', String(settled.dices[2]),
      '--is-bao', settled.isBao ? '1' : '0',
      '--bets-json', tmp,
      '--out', out,
    ], { timeout: 20000, windowsHide: true }, (err) => (err ? reject(err) : resolve(out)));
  });
}
async function finishGame(groupId) {
  const settled = settleGame(groupId);
  if (!settled) return;
  try {
    const img = await genDiceCard(groupId, settled);
    await sendGroupById(groupId, [{ type: 'image', data: { file: img } }]);
  } catch (e) {
    logger?.error('竞猜结果卡片生成失败，改用文本:', e);
    const lines = [`🎲 ${settled.dices.join(' · ')} = ${settled.sum}（${settled.verdict}${settled.isBao ? '！通吃' : ''}）`];
    for (const r of settled.results) {
      lines.push(`${r.nick || r.qq} 押${r.label} ${r.amount} 分 → ${r.win ? `🎉 +${r.gain}` : `💸 -${r.amount}`}`);
    }
    await sendGroupById(groupId, [lines.join('\n')]);
  }
}
async function onGameTimeout(groupId) {
  const games = gameLoad();
  const g = games[groupId];
  if (!g) return;
  if (!g.bets.length) {
    delete games[groupId];
    gameSave();
    await sendGroupById(groupId, ['🕳️ 30 秒无人参与，「娱乐竞猜」已自动关闭']);
    return;
  }
  await finishGame(groupId);
}
function scheduleGameEnd(groupId, delayMs = GAME_DURATION * 1000) {
  const g = gameLoad()[groupId];
  if (!g) return;
  clearTimeout(g.timer);
  g.timer = setTimeout(onGameTimeout, delayMs, groupId);
}

// ---------------------------------------------------------------- 发言统计
function speechLoad() {
  if (_speechCache) return _speechCache;
  try {
    _speechCache = JSON.parse(fs.readFileSync(SPEECH_FILE, 'utf-8'));
  } catch {
    _speechCache = {};
  }
  return _speechCache;
}
function speechSave() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SPEECH_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_speechCache, null, 2), 'utf-8');
  fs.renameSync(tmp, SPEECH_FILE);
}
function recordSpeech(groupId, userId, nick) {
  const d = speechLoad();
  const g = d[groupId] || (d[groupId] = { daily: {}, monthly: {} });
  const t = today();
  const ym = t.slice(0, 7);
  const day = g.daily[t] || (g.daily[t] = {});
  const mon = g.monthly[ym] || (g.monthly[ym] = {});
  const r1 = day[userId] || (day[userId] = { c: 0, nick });
  r1.c += 1;
  if (nick) r1.nick = nick;
  const r2 = mon[userId] || (mon[userId] = { c: 0, nick });
  r2.c += 1;
  if (nick) r2.nick = nick;
  speechSave();
}
function speechRank(mapObj, limit = 10) {
  return Object.entries(mapObj || {})
    .map(([uid, r]) => ({ uid, nick: r.nick || '', count: r.c || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
function reportStateLoad() {
  if (_reportState) return _reportState;
  try {
    _reportState = JSON.parse(fs.readFileSync(REPORT_STATE_FILE, 'utf-8'));
  } catch {
    _reportState = { daily: '', monthly: '' };
  }
  return _reportState;
}
function reportStateSave() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = REPORT_STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_reportState, null, 2), 'utf-8');
  fs.renameSync(tmp, REPORT_STATE_FILE);
}
function lastMonthYm() {
  const d = new Date();
  d.setDate(0); // 上个月最后一天
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function genSpeechCard(title, sub, items, out, colName = '发言条数') {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = path.join(DATA_DIR, 'posters', `speech_${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(items.map((i) => ({ nick: i.nick, count: i.count }))), 'utf-8');
    execFile('python', [SPEECH_CARD_SCRIPT, '--title', title, '--sub', sub, '--col-name', colName, '--items-json', tmp, '--out', out],
      { timeout: 20000, windowsHide: true }, (err) => (err ? reject(err) : resolve(out)));
  });
}
async function sendGroupById(groupId, segments) {
  if (!_ctx) return;
  try {
    await _ctx.actions.call('send_msg', {
      message: Array.isArray(segments)
        ? segments.map((s) => (typeof s === 'string' ? { type: 'text', data: { text: s } } : s))
        : segments,
      message_type: 'group',
      group_id: String(groupId),
    }, _ctx.adapterName, _ctx.pluginManager.config);
  } catch (e) {
    logger?.error(`向群 ${groupId} 发送失败:`, e);
  }
}
async function publishSpeechReport(groupId, title, sub, mapObj) {
  const rows = speechRank(mapObj);
  if (!rows.length) return;
  const out = path.join(DATA_DIR, 'posters', `speech_${Date.now()}.png`);
  try {
    await genSpeechCard(title, sub, rows, out);
    await sendGroupById(groupId, [
      { type: 'image', data: { file: out } },
    ]);
  } catch (e) {
    logger?.error('发言卡片生成/发送失败:', e);
    const lines = rows.map((r, i) => `${i + 1}. ${r.nick || r.uid} —— ${r.count} 次`);
    await sendGroupById(groupId, [`📣 ${title}\n${sub}\n` + lines.join('\n')]);
  }
}
// 昨日发言第一名奖励 50 积分（写入签到积分，未签过到也建记录）
function rewardTopSpeaker(groupId, dayMap) {
  const top = speechRank(dayMap, 1)[0];
  if (!top) return null;
  const data = load();
  const g = data[groupId] || (data[groupId] = {});
  const rec = g[top.uid] || (g[top.uid] = { streak: 0, total: 0, last_date: '', nick: top.nick });
  rec.points = (rec.points || 0) + 50;
  if (top.nick) rec.nick = top.nick;
  save(data);
  return top;
}
// 定时发布：每日 0 点发昨日榜（第一名奖励 50 积分），每月 1 号 0 点发上月榜
function startReportScheduler() {
  setInterval(async () => {
    try {
      const now = new Date();
      if (now.getHours() !== 0 || now.getMinutes() !== 0) return;
      const st = reportStateLoad();
      const yestDate = yesterday();
      const lm = lastMonthYm();
      const d = speechLoad();
      // 昨日日榜（第一名奖励 50 积分）
      if (st.daily !== yestDate) {
        for (const gid of Object.keys(d)) {
          const day = d[gid].daily?.[yestDate];
          if (day && Object.keys(day).length) {
            const top = rewardTopSpeaker(gid, day);
            const sub = top
              ? `${yestDate} · 群聊数据 · 🏆 第一名 ${top.nick || top.uid} +50 积分`
              : `${yestDate} · 群聊数据`;
            await publishSpeechReport(gid, '昨日发言排行', sub, day);
            if (top) {
              await sendGroupById(gid, [`🏆 昨日发言第一名 ${top.nick || top.uid}（${top.count} 条）获得 50 积分奖励！`]);
            }
          }
        }
        st.daily = yestDate;
        reportStateSave();
      }
      // 上月月榜（每月 1 号）
      if (now.getDate() === 1 && st.monthly !== lm) {
        for (const gid of Object.keys(d)) {
          const mon = d[gid].monthly?.[lm];
          if (mon && Object.keys(mon).length) {
            await publishSpeechReport(gid, `${lm} 发言排行`, `${lm} · 月度数据`, mon);
          }
        }
        st.monthly = lm;
        reportStateSave();
      }
    } catch (e) {
      logger?.error('定时发布发言统计失败:', e);
    }
  }, 60000);
}
function getRank(groupId) {
  const g = load()[groupId] || {};
  return Object.entries(g)
    .sort((a, b) => b[1].streak - a[1].streak || b[1].total - a[1].total)
    .map(([uid, r]) => ({ uid, nick: r.nick || '', streak: r.streak, total: r.total }));
}
function extractText(event) {
  if (Array.isArray(event.message)) {
    return event.message
      .filter((s) => s && s.type === 'text' && s.data)
      .map((s) => s.data.text || '')
      .join('')
      .trim();
  }
  return String(event.raw_message || '').trim();
}

// ---------------------------------------------------------------- 海报
function genPoster(params) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(POSTER_DIR, { recursive: true });
    const out = path.join(POSTER_DIR, `poster_${params.qq}_${Date.now()}.png`);
    const args = [
      POSTER_SCRIPT,
      '--nick', params.nick,
      '--qq', params.qq,
      '--streak', String(params.streak),
      '--total', String(params.total),
      '--rank', String(params.rank),
      '--date', params.date,
      '--style', params.style || 'ink',
      '--saying', params.saying || '',
      '--bonus', String(params.bonus || 0),
      '--points', String(params.points || 0),
      '--out', out,
    ];
    execFile('python', args, { timeout: 20000, windowsHide: true }, (err) => {
      if (err) return reject(err);
      resolve(out);
    });
  });
}

function genSkinGrid() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(SKIN_GRID_FILE), { recursive: true });
    execFile('python', [SKIN_GRID_SCRIPT, '--out', SKIN_GRID_FILE],
      { timeout: 30000, windowsHide: true }, (err) => (err ? reject(err) : resolve(SKIN_GRID_FILE)));
  });
}

// ---------------------------------------------------------------- 发送
async function sendGroup(ctx, event, segments) {
  try {
    // 规范化：字符串元素 → 标准 text 消息段（NapCat 要求数组元素必须是对象）
    const msg = Array.isArray(segments)
      ? segments.map((s) => (typeof s === 'string' ? { type: 'text', data: { text: s } } : s))
      : segments;
    await ctx.actions.call('send_msg', {
      message: msg,
      message_type: 'group',
      group_id: String(event.group_id),
    }, ctx.adapterName, ctx.pluginManager.config);
  } catch (e) {
    logger?.error('发送消息失败:', e);
  }
}

// ---------------------------------------------------------------- 事件处理
const plugin_onmessage = async (ctx, event) => {
  if (event.post_type !== 'message' || event.message_type !== 'group') return;
  const text = extractText(event);
  const groupId = String(event.group_id);
  const userId = String(event.user_id);
  const sender = event.sender || {};
  const nick = sender.card || sender.nickname || '';

  // 发言统计（排除机器人自己）
  if (String(event.self_id) !== userId) {
    recordSpeech(groupId, userId, nick);
  }

  if (!text) return;

  try {
    // 帮助
    if (text === 'help' || text === '帮助' || text === '菜单') {
      await sendGroup(ctx, event, [
        '📖 指令帮助\n'
        + '签到 — 每日签到（海报 + 随机 1-100 积分）\n'
        + '我的签到 — 查看签到状态\n'
        + '积分 — 查询我的积分\n'
        + '积分排行 — 本群积分排行榜\n'
        + '转账积分 N @某人 — 转账积分给别人\n'
        + '开启娱乐竞猜 — 开启一局竞猜（30 秒自动开奖）\n'
        + '猜大/猜小/猜爆 金额 — 竞猜下注（豹子 1:24）\n'
        + '猜 点数 金额 — 猜点数和 3-18（高赔）\n'
        + '欧皇附体 — 截止竞猜立即开奖\n'
        + '我的战绩 — 竞猜战绩查询\n'
        + '签到排行 — 本群签到排行榜\n'
        + '查看签到皮肤 — 6 款海报皮肤预览\n'
        + '选择签到皮肤N — 切换你的皮肤（N=1-6）\n'
        + '发言排行 — 今日发言排行榜\n'
        + '发言排行月 — 本月发言排行榜\n'
        + 'help / 帮助 — 查看指令帮助',
      ]);
      return;
    }

    // 发言排行（今日）
    if (text === '发言排行' || text === '发言排行日') {
      const todayStr = today();
      const day = speechLoad()[groupId]?.daily?.[todayStr];
      const rows = speechRank(day);
      if (!rows.length) {
        await sendGroup(ctx, event, ['📣 今天还没有发言数据，多说两句吧']);
        return;
      }
      const total = rows.reduce((s, r) => s + r.count, 0);
      const out = path.join(DATA_DIR, 'posters', `speech_${Date.now()}.png`);
      try {
        await genSpeechCard('今日发言排行', `${todayStr} · 共 ${total} 人次`, rows, out);
        await sendGroup(ctx, event, [{ type: 'image', data: { file: out } }]);
      } catch (e) {
        logger?.error('发言排行卡片生成失败:', e);
        await sendGroup(ctx, event, [`📣 今日发言排行（${todayStr}）\n` + rows.map((r, i) => `${i + 1}. ${r.nick || r.uid} —— ${r.count} 次`).join('\n')]);
      }
      return;
    }

    // 发言排行（本月）
    if (text === '发言排行月') {
      const ym = today().slice(0, 7);
      const mon = speechLoad()[groupId]?.monthly?.[ym];
      const rows = speechRank(mon);
      if (!rows.length) {
        await sendGroup(ctx, event, ['📣 本月还没有发言数据，多说两句吧']);
        return;
      }
      const total = rows.reduce((s, r) => s + r.count, 0);
      const out = path.join(DATA_DIR, 'posters', `speech_${Date.now()}.png`);
      try {
        await genSpeechCard(`${ym} 发言排行`, `${ym} · 共 ${total} 人次`, rows, out);
        await sendGroup(ctx, event, [{ type: 'image', data: { file: out } }]);
      } catch (e) {
        logger?.error('发言排行卡片生成失败:', e);
        await sendGroup(ctx, event, [`📣 ${ym} 发言排行\n` + rows.map((r, i) => `${i + 1}. ${r.nick || r.uid} —— ${r.count} 次`).join('\n')]);
      }
      return;
    }

    // 积分排行
    if (text === '积分排行' || text === '积分榜') {
      const rows = pointsRank(groupId);
      if (!rows.length) {
        await sendGroup(ctx, event, ['💰 还没有人获得积分，快去「签到」吧']);
        return;
      }
      const total = rows.reduce((s, r) => s + r.points, 0);
      const out = path.join(DATA_DIR, 'posters', `points_${Date.now()}.png`);
      const items = rows.map((r) => ({ nick: r.nick || r.uid, count: r.points }));
      try {
        await genSpeechCard('积分排行', `本群 · 共 ${rows.length} 人 · 合计 ${total} 分`, items, out, '积分');
        await sendGroup(ctx, event, [{ type: 'image', data: { file: out } }]);
      } catch (e) {
        logger?.error('积分排行卡片生成失败:', e);
        await sendGroup(ctx, event, ['💰 积分排行\n' + items.map((r, i) => `${i + 1}. ${r.nick} —— ${r.count} 分`).join('\n')]);
      }
      return;
    }

    // 积分查询
    if (text === '积分' || text === '我的积分') {
      const st = getStatus(groupId, userId);
      await sendGroup(ctx, event, [`💰 当前积分：${st.points}`]);
      return;
    }

    // 转账积分
    const tm = text.match(/^(转账积分|转账)\s*(\d+)$/);
    if (tm) {
      const amount = parseInt(tm[2], 10);
      const atSeg = (Array.isArray(event.message) ? event.message : [])
        .find((s) => s && s.type === 'at' && s.data && s.data.qq);
      const target = atSeg ? String(atSeg.data.qq) : '';
      if (!target) {
        await sendGroup(ctx, event, ['⚠️ 格式：转账积分 100 @目标成员']);
        return;
      }
      if (target === userId) {
        await sendGroup(ctx, event, ['⚠️ 不能给自己转账']);
        return;
      }
      const r = transferPoints(groupId, userId, target, amount);
      if (!r.ok) {
        await sendGroup(ctx, event, [`⚠️ ${r.msg}`]);
        return;
      }
      await sendGroup(ctx, event, [`✅ 已转账 ${amount} 积分给 ${r.toNick || target}\n你的剩余积分：${r.fromPoints}`]);
      return;
    }

    // 开启娱乐竞猜
    if (text === '开启娱乐竞猜' || text === '开启竞猜') {
      const r = openGame(groupId, userId, nick);
      if (!r.ok) {
        await sendGroup(ctx, event, [`⚠️ ${r.msg}`]);
        return;
      }
      await sendGroup(ctx, event, [
        '🎲 娱乐竞猜已开启！\n'
        + `⏱️ ${GAME_DURATION} 秒后自动开奖（无人下注则自动关闭）\n\n`
        + '📖 下注方式（每人限一注，下注即扣积分）：\n'
        + `猜大 100   —— 押大（和值 11-17，1:1）\n`
        + `猜小 100   —— 押小（和值 4-10，1:1）\n`
        + `猜爆 100   —— 押豹子（三骰相同，1:${GAME_BAO_ODDS}）\n`
        + '猜 11 100  —— 猜点数和 3-18（高赔）\n\n'
        + '🚀 提前开奖：欧皇附体',
      ]);
      return;
    }

    // 下注：猜大/猜小/猜爆/猜点数 金额（玩法开启后直接下注，无需确认）
    const betMatch = text.match(/^猜(大|小|爆|(\d{1,2}))\s*(\d+)$/);
    if (betMatch) {
      const kind = betMatch[1];
      const amount = parseInt(betMatch[3], 10);
      let type, point = 0, label;
      if (kind === '大') {
        type = 'big'; label = '大';
      } else if (kind === '小') {
        type = 'small'; label = '小';
      } else if (kind === '爆') {
        type = 'bao'; label = '爆';
      } else {
        const p = parseInt(kind, 10);
        if (p < 3 || p > 18) {
          await sendGroup(ctx, event, ['⚠️ 猜点数范围为 3-18，例如：猜 11 100']);
          return;
        }
        type = 'point'; point = p; label = `和 ${p}`;
      }
      const r = placeBet(groupId, userId, nick, type, point, amount);
      if (!r.ok) {
        await sendGroup(ctx, event, [`⚠️ ${r.msg}`]);
        return;
      }
      await sendGroup(ctx, event, [`✅ 已下注：猜${label} ${amount} 分（当前 ${r.points} 分）`]);
      return;
    }

    // 欧皇附体：截止下注立即开奖
    if (text === '欧皇附体') {
      const g = gameLoad()[groupId];
      if (!g) {
        await sendGroup(ctx, event, ['⚠️ 本群没有进行中的竞猜，先发「开启娱乐竞猜」']);
        return;
      }
      if (!g.bets.length) {
        const games = gameLoad();
        delete games[groupId];
        gameSave();
        await sendGroup(ctx, event, ['🕳️ 无人下注，竞猜已关闭']);
        return;
      }
      await sendGroup(ctx, event, ['🏁 已截止下注，开奖中……']);
      await finishGame(groupId);
      return;
    }

    // 我的战绩
    if (text === '我的战绩' || text === '战绩') {
      const rec = load()[groupId]?.[userId];
      const g = rec?.game;
      if (!g || !g.played) {
        await sendGroup(ctx, event, ['📊 还没有竞猜战绩，发「开启娱乐竞猜」参与吧']);
        return;
      }
      const winRate = Math.round(((g.won || 0) / g.played) * 100);
      const net = g.net || 0;
      await sendGroup(ctx, event, [
        '📊 我的竞猜战绩\n'
        + `下注次数：${g.played}\n`
        + `赢的次数：${g.won || 0}（胜率 ${winRate}%）\n`
        + `净盈亏：${net >= 0 ? '+' : ''}${net}\n`
        + `单次最大赢：${g.best || 0}\n`
        + `单次最大下注：${g.maxBet || 0}`,
      ]);
      return;
    }

    // 查看签到皮肤
    if (text === '查看签到皮肤') {
      const cur = getStatus(groupId, userId).skin || 'ink';
      const lines = ['🎨 签到皮肤一览（发「选择签到皮肤N」切换，N=1-6）'];
      SKIN_LIST.forEach((k, i) => {
        lines.push(`${i + 1}. ${SKIN_NAMES[k]}${k === cur ? '（当前）' : ''} —— ${SKIN_DESC[k]}`);
      });
      try {
        await genSkinGrid();
        await sendGroup(ctx, event, [
          { type: 'image', data: { file: SKIN_GRID_FILE } },
          { type: 'text', data: { text: lines.join('\n') } },
        ]);
      } catch (e) {
        logger?.error('皮肤预览生成失败:', e);
        await sendGroup(ctx, event, [lines.join('\n')]);
      }
      return;
    }

    // 选择签到皮肤N
    const skinMatch = text.match(/^选择签到皮肤\s*(\d+)$/);
    if (skinMatch) {
      const idx = parseInt(skinMatch[1], 10);
      const skin = SKIN_LIST[idx - 1];
      if (!skin) {
        await sendGroup(ctx, event, [`⚠️ 没有编号 ${idx} 的皮肤，可用 1-${SKIN_LIST.length}（发「查看签到皮肤」看预览）`]);
        return;
      }
      setSkin(groupId, userId, skin);
      await sendGroup(ctx, event, [`🎨 已选择皮肤 ${idx}：${SKIN_NAMES[skin]}，下次签到海报生效`]);
      return;
    }

    // 签到排行
    if (text === '签到排行') {
      const rows = getRank(groupId);
      if (!rows.length) {
        await sendGroup(ctx, event, ['📊 本群还没有人签到，快来抢首签！']);
        return;
      }
      const lines = ['📊 本群签到排行（按连续天数）'];
      let myRank = 0;
      rows.forEach((r, i) => {
        if (r.uid === userId) myRank = i + 1;
        if (i < RANK_LIMIT) {
          const mark = r.uid === userId ? '（你）' : '';
          lines.push(`${i + 1}. ${r.nick || r.uid} —— 连续 ${r.streak} 天（累计 ${r.total} 次）${mark}`);
        }
      });
      if (!myRank) {
        const st = getStatus(groupId, userId);
        lines.push(`你还没上榜，连续 ${st.streak} 天 —— 发送「签到」吧`);
      } else if (myRank > RANK_LIMIT) {
        lines.push(`你的名次：#${myRank}`);
      }
      await sendGroup(ctx, event, [lines.join('\n')]);
      return;
    }

    // 我的签到
    if (text === '我的签到') {
      const st = getStatus(groupId, userId);
      if (!st.signed) {
        const tail = st.last_date ? `上次签到：${st.last_date}\n发送「签到」开始今天的签到吧` : '还没签过到，发送「签到」抢首签吧';
        await sendGroup(ctx, event, [`📋 签到状态\n今日未签到 ❌（连续 ${st.streak} 天，累计 ${st.total} 次）\n${tail}`]);
      } else {
        await sendGroup(ctx, event, [`📋 签到状态\n今日已签到 ✅（连续 ${st.streak} 天，累计 ${st.total} 次）\n上次签到：${st.last_date}`]);
      }
      return;
    }

    // 签到
    if (text === '签到') {
      const res = doCheckin(groupId, userId, nick);
      if (!res.ok) {
        await sendGroup(ctx, event, [`⏰ 今天已经签到过啦\n当前连续：${res.streak} 天 ｜ 累计：${res.total} 次\n明天再来~`]);
        return;
      }
      const rank = getRank(groupId).findIndex((r) => r.uid === userId) + 1;
      const bonusTxt = res.bonus > 0 ? `\n🎉 连续签到奖励 +${res.bonus} 积分（连续第 ${res.streak} 天）` : '';
      try {
        const poster = await genPoster({
          nick: nick || userId,
          qq: userId,
          streak: res.streak,
          total: res.total,
          rank,
          date: res.last_date,
          style: res.skin || 'ink',
          saying: randomSaying(),
          points: res.points,
          bonus: res.bonus || 0,
        });
        await sendGroup(ctx, event, [
          { type: 'image', data: { file: poster } },
          { type: 'text', data: { text: `✅ 签到成功！+${res.gain} 积分，当前 ${res.points} 分${bonusTxt}` } },
        ]);
      } catch (e) {
        logger?.error('生成海报失败，改用文本:', e);
        await sendGroup(ctx, event, [`✅ 签到成功！+${res.gain} 积分（当前 ${res.points} 分）${bonusTxt}\n连续签到：${res.streak} 天\n累计签到：${res.total} 次`]);
      }
      return;
    }
  } catch (e) {
    logger?.error('签到插件处理消息出错:', e);
  }
};

const plugin_init = async (ctx) => {
  logger = ctx.logger;
  _ctx = ctx;
  fs.mkdirSync(POSTER_DIR, { recursive: true });
  startReportScheduler();
  // 恢复插件重载/重启前未结束的竞猜局（按剩余时间重挂定时器）
  const games = gameLoad();
  for (const gid of Object.keys(games)) {
    const remainMs = gameRemainSec(games[gid]) * 1000;
    scheduleGameEnd(gid, Math.max(remainMs, 1000));
    logger.info(`恢复竞猜局 群 ${gid}（剩余 ${Math.ceil(remainMs / 1000)} 秒，${games[gid].bets.length} 注）`);
  }
  logger.info('签到插件已初始化（data: ' + DATA_FILE + '）');
};

export { plugin_init, plugin_onmessage };
