// =============================================================================
// DeepSeek 群聊插件（NapCat 原生插件）
// 触发：群里 @机器人 + 内容 → 调 DeepSeek OpenAI 兼容 API → 回复
// 配置：config/plugins/napcat-plugin-deepseek/config.json
//   { "apiKey": "sk-xxx", "systemPrompt": "可选，机器人人设" }
//   key 每次调用实时读取，改完立即生效（无需热重载/重启）
// =============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat'; // 可选 deepseek-reasoner（更聪明但烧钱）
const DEFAULT_SYSTEM = '你是群里公认的毒舌AI，风格无厘头、欠揍但有梗。吐槽要犀利有趣，但绝不人身攻击、不越界。回复控制在100字内。';
const TIMEOUT_MS = 30000;
const MAX_REPLY = 4000;
const DEFAULT_MAX_TOKENS = 800; // 输出 token 上限（config 可调）
const DEFAULT_BUDGET_YUAN = 0.5; // 每日费用上限（元），0 = 不限
const DEFAULT_MAX_INPUT_CHARS = 800; // 用户消息最长字符数，超长截断（防贴长文烧输入 token）
const DEFAULT_HISTORY_ROUNDS = 0; // 多轮对话轮数（0=关；5=记住最近 5 轮问答，成本约 2-3 倍）
const REASONER_MIN_TOKENS = 4000; // reasoner 的 max_tokens 含思维链，太小会导致无最终答案
const INPUT_PRICE_PER_M = 2;   // deepseek-chat 输入 ¥/1M tokens
const OUTPUT_PRICE_PER_M = 8;  // deepseek-chat 输出 ¥/1M tokens
// 联网搜索：Serper（Google 搜索，默认，免费 2500 次/月）/ 博查（备选）
// key 填 config 的 searchApiKey，provider 填 serper 或 bochai，改完实时生效
const SERPER_URL = 'https://google.serper.dev/search';
const BOCHAI_URL = 'https://api.bochaai.com/v1/web-search';
const SEARCH_TIMEOUT_MS = 15000;
const DEFAULT_SEARCH_PREFIX = '搜索'; // 消息以该词开头才联网（如「搜索 今天的新闻」）
const DEFAULT_SEARCH_PROVIDER = 'serper';

let logger = null;
let _ctx = null;

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(_ctx.configPath, 'utf-8'));
    return {
      apiKey: cfg.apiKey || '',
      model: cfg.model || DEFAULT_MODEL,
      systemPrompt: cfg.systemPrompt || DEFAULT_SYSTEM,
      maxTokens: Number.isInteger(cfg.maxTokens) && cfg.maxTokens > 0 ? cfg.maxTokens : DEFAULT_MAX_TOKENS,
      maxInputChars: Number.isInteger(cfg.maxInputChars) && cfg.maxInputChars > 0 ? cfg.maxInputChars : DEFAULT_MAX_INPUT_CHARS,
      historyRounds: Number.isInteger(cfg.historyRounds) && cfg.historyRounds >= 0 ? cfg.historyRounds : DEFAULT_HISTORY_ROUNDS,
      dailyBudgetYuan: typeof cfg.dailyBudgetYuan === 'number' && cfg.dailyBudgetYuan >= 0 ? cfg.dailyBudgetYuan : DEFAULT_BUDGET_YUAN,
      ownerQq: cfg.ownerQq ? String(cfg.ownerQq) : '', // 群主 QQ（空则自动获取）
      searchApiKey: cfg.searchApiKey ? String(cfg.searchApiKey) : '', // 搜索服务 key（空=不联网）
      searchProvider: cfg.searchProvider === 'bochai' ? 'bochai' : 'serper', // serper（默认）/ bochai
      searchPrefix: cfg.searchPrefix ? String(cfg.searchPrefix) : DEFAULT_SEARCH_PREFIX, // 消息以该词开头才联网
    };
  } catch {
    return { apiKey: '', model: DEFAULT_MODEL, systemPrompt: DEFAULT_SYSTEM, maxTokens: DEFAULT_MAX_TOKENS, dailyBudgetYuan: DEFAULT_BUDGET_YUAN, ownerQq: '', maxInputChars: DEFAULT_MAX_INPUT_CHARS, historyRounds: DEFAULT_HISTORY_ROUNDS, searchApiKey: '', searchProvider: DEFAULT_SEARCH_PROVIDER, searchPrefix: DEFAULT_SEARCH_PREFIX };
  }
}

// ---------------------------------------------------------------- 多轮会话记忆（文件持久化，重启不丢）
function historyFile() {
  return path.join(path.dirname(_ctx.configPath), 'memory.json');
}
function loadHistoryAll() {
  try {
    return JSON.parse(fs.readFileSync(historyFile(), 'utf-8'));
  } catch {
    return {};
  }
}
function saveHistory(key, history) {
  const all = loadHistoryAll();
  if (history.length) {
    all[key] = history;
  } else {
    delete all[key];
  }
  fs.mkdirSync(path.dirname(historyFile()), { recursive: true });
  const tmp = historyFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf-8');
  fs.renameSync(tmp, historyFile());
}

// ---------------------------------------------------------------- 费用记账
function costFile() {
  return path.join(path.dirname(_ctx.configPath), 'costs.json');
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadCosts() {
  try {
    return JSON.parse(fs.readFileSync(costFile(), 'utf-8'));
  } catch {
    return {};
  }
}
function saveCosts(c) {
  fs.mkdirSync(path.dirname(costFile()), { recursive: true });
  const tmp = costFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), 'utf-8');
  fs.renameSync(tmp, costFile());
}
function todayCost() {
  return loadCosts()[todayKey()] || 0;
}
function totalCost() {
  return Object.values(loadCosts()).reduce((s, v) => s + (v || 0), 0);
}
function addCost(promptTokens, completionTokens) {
  const yuan = promptTokens / 1e6 * INPUT_PRICE_PER_M + completionTokens / 1e6 * OUTPUT_PRICE_PER_M;
  const c = loadCosts();
  const k = todayKey();
  c[k] = Math.round(((c[k] || 0) + yuan) * 1e6) / 1e6;
  saveCosts(c);
  return yuan;
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

function isAtBot(event) {
  if (!Array.isArray(event.message)) return false;
  const self = String(event.self_id);
  return event.message.some((s) => s && s.type === 'at' && s.data && String(s.data.qq) === self);
}

async function getBalance(apiKey) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const cny = (data.balance_infos || []).find((i) => i.currency === 'CNY');
    const v = parseFloat(cny?.total_balance);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function sendGroup(groupId, segments) {
  try {
    const msg = Array.isArray(segments)
      ? segments.map((s) => (typeof s === 'string' ? { type: 'text', data: { text: s } } : s))
      : segments;
    await _ctx.actions.call('send_msg', {
      message: msg,
      message_type: 'group',
      group_id: String(groupId),
    }, _ctx.adapterName, _ctx.pluginManager.config);
  } catch (e) {
    logger?.error('发送消息失败:', e);
  }
}

async function sendPrivate(userId, message) {
  try {
    const msg = Array.isArray(message)
      ? message.map((s) => (typeof s === 'string' ? { type: 'text', data: { text: s } } : s))
      : message;
    await _ctx.actions.call('send_msg', {
      message: msg,
      message_type: 'private',
      user_id: String(userId),
    }, _ctx.adapterName, _ctx.pluginManager.config);
  } catch (e) {
    logger?.error('私聊发送失败:', e);
  }
}

async function getGroupOwner(groupId) {
  try {
    const r = await _ctx.actions.call('get_group_member_list', { group_id: String(groupId) }, _ctx.adapterName, _ctx.pluginManager.config);
    const list = (r && r.data) || r || [];
    const owner = (Array.isArray(list) ? list : []).find((m) => m && m.role === 'owner');
    return owner ? String(owner.user_id) : '';
  } catch (e) {
    logger?.error('获取群主失败:', e);
    return '';
  }
}

async function askDeepSeek(apiKey, model, messages, maxTokens) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const isReasoner = model === 'deepseek-reasoner';
  try {
    const body = {
      model, // deepseek-chat（默认）/ deepseek-reasoner（更聪明但烧钱）
      messages,
      // reasoner 不支持 temperature，传了会被忽略；max_tokens 含思维链需设下限
      ...(isReasoner ? {} : { temperature: 0.6 }),
      max_tokens: isReasoner ? Math.max(maxTokens, REASONER_MIN_TOKENS) : maxTokens,
    };
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, msg: `API 错误 ${res.status}: ${data.error?.message || res.statusText}` };
    }
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { ok: false, msg: 'DeepSeek 没有返回内容' };
    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
    return { ok: true, content, usage };
  } catch (e) {
    return { ok: false, msg: e.name === 'AbortError' ? '请求超时（30 秒）' : `请求失败: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 联网搜索（博查 AI Search）
const SEARCH_USAGE_FILE = () => path.join(path.dirname(_ctx.configPath), 'search_usage.json');
function loadSearchUsage() {
  try {
    return JSON.parse(fs.readFileSync(SEARCH_USAGE_FILE(), 'utf-8'));
  } catch {
    return {};
  }
}
function addSearchUsage() {
  const u = loadSearchUsage();
  const k = todayKey();
  u[k] = (u[k] || 0) + 1;
  u.total = (u.total || 0) + 1;
  fs.mkdirSync(path.dirname(SEARCH_USAGE_FILE()), { recursive: true });
  const tmp = SEARCH_USAGE_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(u, null, 2), 'utf-8');
  fs.renameSync(tmp, SEARCH_USAGE_FILE());
}
function monthSearchUsage() {
  const u = loadSearchUsage();
  const ym = todayKey().slice(0, 7); // 如 "2026-08"
  return Object.entries(u)
    .filter(([k]) => k.startsWith(ym))
    .reduce((s, [, v]) => s + (v || 0), 0);
}
async function searchWeb(query, apiKey, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    // Serper（Google）：POST google.serper.dev/search，X-API-KEY 鉴权
    if (provider === 'serper') {
      const res = await fetch(SERPER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({ q: query, num: 8, gl: 'cn' }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, msg: data.message || `搜索失败 ${res.status}` };
      const org = (data.organic || []).slice(0, 8);
      if (!org.length) return { ok: false, msg: '没有搜到相关内容' };
      const items = org.map((p, i) =>
        `${i + 1}. ${p.title || ''}\n${p.snippet || ''}\n来源: ${p.link || ''}`);
      return { ok: true, items: items.join('\n\n') };
    }
    // 博查（备选）：POST api.bochaai.com/v1/web-search，Bearer 鉴权
    const res = await fetch(BOCHAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, summary: true, count: 8 }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, msg: data.msg || `搜索失败 ${res.status}` };
    }
    const pages = data?.data?.webPages?.value || data?.data?.webpages || [];
    if (!pages.length) return { ok: false, msg: '没有搜到相关内容' };
    const items = pages.slice(0, 8).map((p, i) =>
      `${i + 1}. ${p.name || ''}\n${p.summary || p.snippet || ''}\n来源: ${p.url || ''}`);
    return { ok: true, items: items.join('\n\n') };
  } catch (e) {
    return { ok: false, msg: e.name === 'AbortError' ? '搜索超时' : `搜索失败: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

const plugin_onmessage = async (ctx, event) => {
  if (event.post_type !== 'message' || event.message_type !== 'group') return;
  const text = extractText(event);
  if (!text) return;
  const cfg = loadConfig();
  // 触发条件：@机器人，或消息以「搜索」开头（无需 @，用前缀区分联网搜索）
  const isSearchCmd = text.startsWith(cfg.searchPrefix);
  if (!isAtBot(event) && !isSearchCmd) return;

  // 搜索用量查询（本地统计，不调用 AI）
  if (text === '搜索用量' || text === '搜索统计') {
    const u = loadSearchUsage();
    const t = todayKey();
    await sendGroup(String(event.group_id), [
      '🔍 搜索用量（本地统计）\n'
      + `今日已搜：${u[t] || 0} 次\n`
      + `累计已搜：${u.total || 0} 次\n\n`
      + '剩余额度请到搜索服务商控制台查看',
    ]);
    return;
  }

  // 独立搜索：消息以「搜索」开头（无需 @），直接回复搜索结果，不经过 DeepSeek
  if (isSearchCmd) {
    if (!cfg.searchApiKey) {
      await sendGroup(String(event.group_id), ['🔍 管理员还没配置搜索 API Key（config 的 searchApiKey），填上即可用']);
      return;
    }
    const query = text.slice(cfg.searchPrefix.length).trim() || text;
    const s = await searchWeb(query, cfg.searchApiKey, cfg.searchProvider);
    if (s.ok) {
      addSearchUsage(); // 本地统计搜索次数
      logger?.info(`联网搜索成功（群 ${event.group_id}）：${query.slice(0, 30)}`);
      const lines = s.items.split('\n\n').slice(0, 5).join('\n\n');
      await sendGroup(String(event.group_id), [`🔍 「${query}」搜索结果\n\n${lines}\n\n（本月已消耗 ${monthSearchUsage()} 次搜索额度）`]);
    } else {
      await sendGroup(String(event.group_id), [`🔍 搜索失败：${s.msg}`]);
    }
    return;
  }

  if (!cfg.apiKey) {
    await sendGroup(String(event.group_id), ['🤖 管理员还没配置 DeepSeek API Key，填入后即可使用']);
    return;
  }

  // 每日费用上限检查
  if (cfg.dailyBudgetYuan > 0 && todayCost() >= cfg.dailyBudgetYuan) {
    await sendGroup(String(event.group_id), [`🤖 今日 AI 费用已达上限（¥${cfg.dailyBudgetYuan}），明天再来吧`]);
    return;
  }

  let userText = text.slice(0, cfg.maxInputChars);
  const memKey = `${event.group_id}_${event.user_id}`;
  // 组装消息：system（人设）+ 历史（最近 N 轮）+ 本次提问
  const messages = [{ role: 'system', content: cfg.systemPrompt }];
  if (cfg.historyRounds > 0) {
    const history = loadHistoryAll()[memKey] || [];
    messages.push(...history);
  }
  messages.push({ role: 'user', content: userText });

  const r = await askDeepSeek(cfg.apiKey, cfg.model, messages, cfg.maxTokens);
  // 成功后写入会话记忆（截断到 rounds*2 条）
  if (r.ok && cfg.historyRounds > 0) {
    const history = loadHistoryAll()[memKey] || [];
    history.push({ role: 'user', content: userText }, { role: 'assistant', content: r.content });
    if (history.length > cfg.historyRounds * 2) {
      saveHistory(memKey, history.slice(-cfg.historyRounds * 2));
    } else {
      saveHistory(memKey, history);
    }
  }
  if (r.ok && r.usage) {
    const usage = r.usage;
    const yuan = addCost(usage.prompt_tokens || 0, usage.completion_tokens || 0);
    logger?.info(`DeepSeek 本次费用 +¥${yuan.toFixed(4)}，今日累计 ¥${todayCost().toFixed(4)}`);
    // 向群主私聊发送用量通知
    try {
      const owner = cfg.ownerQq || await getGroupOwner(String(event.group_id));
      if (owner) {
        const todayC = todayCost();
        const remain = cfg.dailyBudgetYuan > 0 ? Math.max(0, cfg.dailyBudgetYuan - todayC) : -1;
        const remainTxt = remain < 0 ? '不限' : `¥${remain.toFixed(4)}`;
        const balance = await getBalance(cfg.apiKey);
        const balTxt = balance === null ? '查询失败' : `¥${balance.toFixed(2)}`;
        await sendPrivate(owner, [
          '🤖 DeepSeek 用量通知\n'
          + `钱包余额：${balTxt}\n`
          + `本次：输入 ${usage.prompt_tokens} / 输出 ${usage.completion_tokens} token（+¥${yuan.toFixed(4)}）\n`
          + `今日已用：¥${todayC.toFixed(4)}（剩余 ${remainTxt}）\n`
          + `累计总消耗：¥${totalCost().toFixed(4)}`,
        ]);
      }
    } catch (e) {
      logger?.error('群主用量通知失败:', e);
    }
  }
  const reply = r.ok ? r.content : `🤖 ${r.msg}`;
  const finalMsg = reply.length > MAX_REPLY ? reply.slice(0, MAX_REPLY) + '…' : reply;
  await sendGroup(String(event.group_id), [finalMsg]);
};

const plugin_init = async (ctx) => {
  logger = ctx.logger;
  _ctx = ctx;
  // 生成默认配置（不含 key，用户后填）
  try {
    if (!fs.existsSync(ctx.configPath)) {
      fs.mkdirSync(path.dirname(ctx.configPath), { recursive: true });
      fs.writeFileSync(ctx.configPath, JSON.stringify({ apiKey: '', model: DEFAULT_MODEL, systemPrompt: DEFAULT_SYSTEM, maxTokens: DEFAULT_MAX_TOKENS, dailyBudgetYuan: DEFAULT_BUDGET_YUAN, searchApiKey: '', searchProvider: DEFAULT_SEARCH_PROVIDER, searchPrefix: DEFAULT_SEARCH_PREFIX }, null, 2), 'utf-8');
    }
  } catch (e) {
    logger?.error('初始化配置失败:', e);
  }
  logger.info('DeepSeek 群聊插件已初始化（config: ' + ctx.configPath + '）');
};

export { plugin_init, plugin_onmessage };
