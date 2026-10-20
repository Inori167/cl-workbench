'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const TERM_DIR = path.join(DATA_DIR, 'terminals');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const PSREADLINE_DIR = path.join(DATA_DIR, 'psreadline');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const PORT = Number(process.env.PORT || 4737);
const HOST = '127.0.0.1';

fs.mkdirSync(TERM_DIR, { recursive: true });
fs.mkdirSync(PSREADLINE_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function decodeBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  // heuristic: UTF-16LE text has a NUL in every other byte
  let nul = 0;
  const probe = Math.min(buf.length, 400);
  for (let i = 1; i < probe; i += 2) if (buf[i] === 0) nul++;
  if (probe > 8 && nul > probe / 4) return buf.toString('utf16le');
  return buf.toString('utf8');
}

function readTextSmart(file, maxBytes = 12 * 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    const size = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return { text: decodeBuffer(buf), truncated: st.size > maxBytes, bytes: st.size };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeFileAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function parseJsonlText(text, cap = 400000) {
  const out = [];
  let start = 0;
  let count = 0;
  while (start < text.length && count < cap) {
    let nl = text.indexOf('\n', start);
    if (nl === -1) nl = text.length;
    const line = text.slice(start, nl).trim();
    if (line) {
      try { out.push(JSON.parse(line)); } catch { /* partial / corrupt line */ }
    }
    start = nl + 1;
    count++;
  }
  return out;
}

function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeMs(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function snippetAround(text, index, length, radius = 100) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + raw + (end < text.length ? '…' : '');
}

/* ------------------------------------------------------------------ */
/* terminal sessions                                                   */
/* ------------------------------------------------------------------ */

const termCache = new Map();

function termPath(id, ext) {
  return path.join(TERM_DIR, `${id}.${ext}`);
}

function isValidTerminalId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(id);
}

function loadTermEvents(id) {
  const file = termPath(id, 'jsonl');
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const cached = termCache.get(id);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.events;
  const { text } = readTextSmart(file, 8 * 1024 * 1024);
  const events = parseJsonlText(text).filter((e) => e && typeof e === 'object');
  termCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, events });
  return events;
}

function readTermMeta(id) {
  return readJsonFile(termPath(id, 'meta.json'), null);
}

function summarizeTerminal(id) {
  const file = termPath(id, 'jsonl');
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const events = loadTermEvents(id);
  const meta = readTermMeta(id) || {};
  const commands = events.filter((e) => e && e.type === 'cmd' && typeof e.cmd === 'string');
  let errorCount = 0;
  for (const e of commands) {
    if (e.ok === false || (typeof e.exitCode === 'number' && e.exitCode !== 0)) errorCount++;
  }
  const firstTs = events.find((e) => e && e.ts)?.ts || null;
  const lastTs = [...events].reverse().find((e) => e && e.ts)?.ts || null;
  const startedAt = meta.startedAt || firstTs || st.birthtime.toISOString();
  const endedAt = meta.endedAt || lastTs || st.mtime.toISOString();
  const last = commands[commands.length - 1];
  const logStat = (() => { try { return fs.statSync(termPath(id, 'log')); } catch { return null; } })();
  return {
    id,
    title: meta.title || null,
    shell: meta.shell || 'Windows PowerShell',
    cwd: meta.cwd || commands.find((e) => e.cwd)?.cwd || null,
    source: meta.source || 'launcher',
    startedAt,
    endedAt,
    durationMs: Math.max(0, safeMs(endedAt) - safeMs(startedAt)),
    commandCount: commands.length,
    errorCount,
    lastCommand: last ? last.cmd : null,
    transcriptBytes: logStat ? logStat.size : 0,
    ended: Boolean(meta.endedAt),
    active: !meta.endedAt && st.mtimeMs > Date.now() - 3 * 60 * 1000,
    updatedAt: st.mtime.toISOString(),
  };
}

function listTerminalSessions() {
  let names = [];
  try { names = fs.readdirSync(TERM_DIR); } catch {}
  const ids = names.filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6));
  const items = [];
  for (const id of ids) {
    if (!isValidTerminalId(id)) continue;
    const item = summarizeTerminal(id);
    if (item) items.push(item);
  }
  items.sort((a, b) => safeMs(b.startedAt) - safeMs(a.startedAt));
  return items;
}

function terminalDetail(id) {
  const summary = summarizeTerminal(id);
  if (!summary) return null;
  const events = loadTermEvents(id);
  let transcript = null;
  try {
    const info = readTextSmart(termPath(id, 'log'), 2 * 1024 * 1024);
    const clean = info.text
      .replace(/\r\n/g, '\n')
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u0000+$/g, '');
    transcript = { text: clean, truncated: info.truncated, bytes: info.bytes };
  } catch {}
  return { session: summary, events, transcript };
}

function updateTerminalMeta(id, patch) {
  const meta = readTermMeta(id) || {};
  const next = { ...meta, ...patch, id };
  fs.writeFileSync(termPath(id, 'meta.json'), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/* ------------------------------------------------------------------ */
/* PowerShell history import                                           */
/* ------------------------------------------------------------------ */

function importPsReadlineHistory() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
  ].filter(Boolean);
  const historyFile = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!historyFile) {
    return { ok: false, error: '没有找到 PowerShell 历史文件 ConsoleHost_history.txt。' };
  }
  const info = readTextSmart(historyFile, 4 * 1024 * 1024);
  const lines = info.text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0).slice(-5000);
  if (!lines.length) return { ok: false, error: 'PowerShell 历史文件是空的。' };

  const contentHash = crypto.createHash('sha1').update(info.text).digest('hex');
  const id = 'psreadline-import';
  const meta = readTermMeta(id);
  if (meta && meta.contentHash === contentHash && fs.existsSync(termPath(id, 'jsonl'))) {
    return { ok: true, unchanged: true, sessionId: id, commandCount: meta.commandCount || lines.length };
  }
  const now = new Date().toISOString();
  const events = lines.map((cmd) => ({ ts: null, type: 'cmd', cmd, cwd: null, ok: null, imported: true }));
  const jsonl = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(termPath(id, 'jsonl'), jsonl, 'utf8');
  fs.writeFileSync(termPath(id, 'meta.json'), JSON.stringify({
    id,
    title: 'PowerShell 历史导入',
    shell: 'PowerShell (PSReadLine)',
    cwd: null,
    source: 'psreadline',
    startedAt: meta?.startedAt || now,
    endedAt: now,
    importedAt: now,
    commandCount: lines.length,
    contentHash,
    historyFile,
  }, null, 2), 'utf8');
  termCache.delete(id);
  return { ok: true, unchanged: false, sessionId: id, commandCount: lines.length };
}

/* ------------------------------------------------------------------ */
/* Claude Code archives                                                */
/* ------------------------------------------------------------------ */

const claudeCache = new Map();

function truncateJson(value, max = 4000) {
  let text;
  try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  if (typeof text !== 'string') text = String(text);
  if (text.length > max) return text.slice(0, max) + '\n… (已截断)';
  return text;
}

function cleanTitle(text) {
  return String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<[^>]{1,200}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function parseClaudeFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const cached = claudeCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.parsed;

  const info = readTextSmart(file, 32 * 1024 * 1024);
  const lines = parseJsonlText(info.text, 200000);
  const acc = {
    sessionId: path.basename(file, '.jsonl'),
    projectDir: path.basename(path.dirname(file)),
    cwd: null,
    title: null,
    summary: null,
    startedAt: null,
    endedAt: null,
    messages: [],
    models: new Set(),
    parsedLines: lines.length,
    truncated: info.truncated,
    bytes: info.bytes,
    mtimeMs: st.mtimeMs,
  };

  for (const obj of lines) {
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'summary' && obj.summary) {
      if (!acc.summary) acc.summary = String(obj.summary).trim();
      continue;
    }
    if (obj.isSidechain || obj.isMeta) continue;
    if (obj.cwd && !acc.cwd) acc.cwd = obj.cwd;
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg || typeof msg !== 'object') continue;
    const ts = typeof obj.timestamp === 'string' ? obj.timestamp : null;
    if (ts) {
      if (!acc.startedAt || safeMs(ts) < safeMs(acc.startedAt)) acc.startedAt = ts;
      if (!acc.endedAt || safeMs(ts) > safeMs(acc.endedAt)) acc.endedAt = ts;
    }
    const content = msg.content;
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: typeof content === 'string' ? content : '' }];
    const texts = [];
    const tools = [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      else if (b.type === 'tool_use') {
        tools.push({ name: String(b.name || 'tool'), input: truncateJson(b.input), id: b.id || null });
      }
    }
    const text = texts.join('\n\n').trim();
    if (obj.type === 'user') {
      if (!text) continue;
      if (text.startsWith('<local-command-caveat>')) continue;
      acc.messages.push({ role: 'user', ts, text });
    } else {
      if (!text && tools.length === 0) continue;
      if (msg.model) acc.models.add(String(msg.model));
      acc.messages.push({ role: 'assistant', ts, text, tools });
    }
  }

  const firstUser = acc.messages.find((m) => m.role === 'user');
  acc.title = acc.summary || (firstUser ? cleanTitle(firstUser.text) : '') || '未命名对话';
  acc.messageCount = acc.messages.length;
  acc.model = [...acc.models][0] || null;
  acc.models = [...acc.models];
  acc.mtime = new Date(st.mtimeMs).toISOString();

  const parsed = { meta: acc, messages: acc.messages };
  claudeCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, parsed });
  return parsed;
}

function listClaudeGroups() {
  const groups = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return groups;
  }
  for (const dir of dirs) {
    const dirPath = path.join(CLAUDE_DIR, dir.name);
    let files = [];
    try {
      files = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.jsonl') && !f.name.startsWith('.'))
        .map((f) => path.join(dirPath, f.name));
    } catch { continue; }
    const sessions = [];
    for (const file of files) {
      const parsed = parseClaudeFile(file);
      if (!parsed) continue;
      const m = parsed.meta;
      const { messages, ...meta } = m;
      sessions.push({
        ...meta,
        title: m.title,
        messageCount: m.messageCount,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        file,
      });
    }
    if (!sessions.length) continue;
    sessions.sort((a, b) => safeMs(b.endedAt || b.mtime) - safeMs(a.endedAt || a.mtime));
    groups.push({
      projectDir: dir.name,
      projectPath: sessions.find((s) => s.cwd)?.cwd || dir.name,
      count: sessions.length,
      lastAt: sessions[0]?.endedAt || sessions[0]?.mtime || null,
      sessions,
    });
  }
  groups.sort((a, b) => safeMs(b.lastAt) - safeMs(a.lastAt));
  return groups;
}

function findClaudeSession(projectDir, sessionId) {
  if (!/^[A-Za-z0-9._-]+$/.test(projectDir || '') || !/^[A-Za-z0-9._-]+$/.test(sessionId || '')) return null;
  const file = path.join(CLAUDE_DIR, projectDir, sessionId + '.jsonl');
  if (!file.startsWith(CLAUDE_DIR + path.sep)) return null;
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch { return null; }
  const parsed = parseClaudeFile(file);
  if (!parsed) return null;
  return { ...parsed.meta, title: parsed.meta.title, messages: parsed.messages.slice(0, 2000) };
}

/* ------------------------------------------------------------------ */
/* notes                                                               */
/* ------------------------------------------------------------------ */

const WELCOME_NOTE = `# 欢迎使用 CL 工作台

这是一个本地运行的「历史记录保险箱」：终端命令、Claude Code 对话、工作笔记，全部保存在 \`F:\\cl\\data\`，即使 cmd 窗口崩溃也不会丢。

## 三个入口

- **终端历史** — 点击右上角「打开记录终端」，以后的工作都在这个终端里做。每条命令会实时写入磁盘，输出会持续写入会话日志；窗口崩溃最多丢最后一行。
- **AI 对话** — 自动读取 Claude Code 的会话存档，不需要手动导入，实时更新。
- **工作笔记** — 支持 Markdown 编辑与预览，适合记录待办、常用命令、踩坑经验。

## 防丢原理

1. 命令记录采用「追加写入」的 JSONL 文件，每条命令执行完立刻落盘。
2. PowerShell 的输入历史设置为逐条保存（SaveIncrementally），崩溃后上方向键历史仍在。
3. 输出通过 Start-Transcript 持续写入会话日志。
4. Claude Code 会话本身由 Claude Code 写入 \`~/.claude/projects\`，这里是只读展示。

## 小技巧

- \`Ctrl + K\` 打开全局搜索。
- 在笔记页 \`Ctrl + S\` 保存。
- 数据目录：\`F:\\cl\\data\`。备份时整个文件夹复制即可。
`;

let notesWriteChain = Promise.resolve();

function readNotes() {
  const data = readJsonFile(NOTES_FILE, null);
  if (data && Array.isArray(data.notes)) return data;
  return null;
}

async function ensureNotes() {
  if (fs.existsSync(NOTES_FILE)) return;
  const now = new Date().toISOString();
  const notes = [{
    id: crypto.randomUUID(),
    title: '欢迎使用 CL 工作台',
    content: WELCOME_NOTE,
    tags: ['使用说明'],
    pinned: true,
    createdAt: now,
    updatedAt: now,
  }];
  await writeFileAtomic(NOTES_FILE, JSON.stringify({ version: 1, notes }, null, 2));
}

function saveNotes(notes) {
  const payload = JSON.stringify({ version: 1, notes }, null, 2);
  notesWriteChain = notesWriteChain.then(() => writeFileAtomic(NOTES_FILE, payload));
  return notesWriteChain;
}

/* ------------------------------------------------------------------ */
/* overview & search                                                   */
/* ------------------------------------------------------------------ */

function buildOverview() {
  const terminals = listTerminalSessions();
  const groups = listClaudeGroups();
  const notesData = readNotes() || { notes: [] };
  const notes = notesData.notes;

  const todayKey = localDateKey(new Date());
  const activityMap = new Map();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    days.push(key);
    activityMap.set(key, 0);
  }

  let totalCommands = 0;
  let todayCommands = 0;
  let firstAt = null;
  for (const s of terminals) {
    totalCommands += s.commandCount;
    if (s.startedAt && (!firstAt || safeMs(s.startedAt) < safeMs(firstAt))) firstAt = s.startedAt;
    if (s.source === 'psreadline') continue;
    for (const e of loadTermEvents(s.id)) {
      if (!e || e.type !== 'cmd' || !e.ts) continue;
      const key = localDateKey(e.ts);
      if (key && activityMap.has(key)) activityMap.set(key, activityMap.get(key) + 1);
      if (key === todayKey) todayCommands++;
    }
  }

  const claudeSessions = groups.flatMap((g) => g.sessions);
  for (const s of claudeSessions) {
    if (s.startedAt && (!firstAt || safeMs(s.startedAt) < safeMs(firstAt))) firstAt = s.startedAt;
  }

  const recentTerminals = terminals.slice(0, 4);
  const recentClaude = claudeSessions
    .filter((s) => s.messageCount > 0)
    .sort((a, b) => safeMs(b.endedAt || b.mtime) - safeMs(a.endedAt || a.mtime))
    .slice(0, 4);
  const recentNotes = [...notes].sort((a, b) => safeMs(b.updatedAt) - safeMs(a.updatedAt)).slice(0, 3);

  let spanDays = 0;
  if (firstAt) {
    spanDays = Math.max(1, Math.ceil((Date.now() - safeMs(firstAt)) / 86400000));
  }

  return {
    stats: {
      totalCommands,
      todayCommands,
      terminalSessions: terminals.length,
      activeTerminals: terminals.filter((s) => s.active).length,
      errorCommands: terminals.reduce((n, s) => n + s.errorCount, 0),
      claudeSessions: claudeSessions.length,
      claudeMessages: claudeSessions.reduce((n, s) => n + (s.messageCount || 0), 0),
      notes: notes.length,
      pinnedNotes: notes.filter((n) => n.pinned).length,
      spanDays,
      firstAt,
    },
    activity: days.map((date) => ({ date, commands: activityMap.get(date) || 0 })),
    recentTerminals,
    recentClaude,
    recentNotes,
  };
}

function searchAll(query) {
  const needle = query.toLowerCase();
  const results = { commands: [], outputs: [], notes: [], claude: [] };

  const terminals = listTerminalSessions();
  outer:
  for (const s of terminals) {
    const events = loadTermEvents(s.id);
    for (const e of events) {
      if (e && e.type === 'cmd' && typeof e.cmd === 'string' && e.cmd.toLowerCase().includes(needle)) {
        results.commands.push({
          sessionId: s.id,
          sessionTitle: s.title || s.cwd || '终端会话',
          cmd: e.cmd,
          ts: e.ts || s.startedAt,
          cwd: e.cwd || s.cwd,
        });
        if (results.commands.length >= 60) break outer;
      }
    }
  }

  for (const s of terminals) {
    if (results.outputs.length >= 20) break;
    if (!s.transcriptBytes) continue;
    try {
      const info = readTextSmart(termPath(s.id, 'log'), 1.5 * 1024 * 1024);
      const idx = info.text.toLowerCase().indexOf(needle);
      if (idx !== -1) {
        results.outputs.push({
          sessionId: s.id,
          sessionTitle: s.title || s.cwd || '终端会话',
          snippet: snippetAround(info.text, idx, needle.length),
          ts: s.startedAt,
        });
      }
    } catch {}
  }

  const notes = (readNotes() || { notes: [] }).notes;
  for (const n of notes) {
    const hay = `${n.title}\n${n.content}\n${(n.tags || []).join(' ')}`;
    const idx = hay.toLowerCase().indexOf(needle);
    if (idx !== -1) {
      results.notes.push({
        id: n.id,
        title: n.title,
        tags: n.tags || [],
        snippet: snippetAround(hay, idx, needle.length),
        updatedAt: n.updatedAt,
      });
      if (results.notes.length >= 40) break;
    }
  }

  const groups = listClaudeGroups();
  let scanned = 0;
  outer2:
  for (const g of groups) {
    for (const s of g.sessions) {
      if (scanned++ > 150) break outer2;
      const parsed = claudeCache.get(s.file)?.parsed;
      if (!parsed) continue;
      if (s.title && s.title.toLowerCase().includes(needle)) {
        results.claude.push({
          projectDir: g.projectDir,
          sessionId: s.sessionId,
          title: s.title,
          projectPath: g.projectPath,
          role: 'title',
          snippet: s.title,
          ts: s.startedAt,
        });
      }
      for (const m of parsed.messages) {
        if (!m.text) continue;
        const idx = m.text.toLowerCase().indexOf(needle);
        if (idx === -1) continue;
        results.claude.push({
          projectDir: g.projectDir,
          sessionId: s.sessionId,
          title: s.title,
          projectPath: g.projectPath,
          role: m.role,
          snippet: snippetAround(m.text, idx, needle.length),
          ts: m.ts,
        });
        break; // one hit per session keeps the result list readable
      }
      if (results.claude.length >= 40) break outer2;
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* AI 对话：后台调 claude CLI，把流式输出推给页面                          */
/* ------------------------------------------------------------------ */

// 这个端点能让 Claude 在这台机器上改文件、跑命令，所以校验要比别处严：
//   Host  必须是本机  → 挡 DNS rebinding
//   Origin 必须存在且是本页 → 挡别的网站偷偷发请求
function chatOriginOk(req) {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === String(PORT);
  } catch {
    return false;
  }
}

// 直接定位原生可执行文件：绕开 .cmd/.bat，spawn 时就不需要 shell，
// 用户输入也就永远进不了命令行解析器。
function claudeBin() {
  const candidates = [
    process.env.CLAUDE_BIN,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return 'claude';
}

const CHAT = { child: null, sessionId: null, startedAt: 0, timer: null };
const CHAT_MAX_MS = 10 * 60 * 1000; // 兜底：最多跑 10 分钟，防止挂死占着不放

function sseSend(res, payload) {
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {}
}

function stopChat() {
  const child = CHAT.child;
  const timer = CHAT.timer;
  CHAT.child = null;
  CHAT.timer = null;
  if (timer) clearTimeout(timer);
  if (!child) return false;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch {}
  return true;
}

// 对话是在 ROOT 里跑的，Claude Code 按 cwd 给存档目录命名（非字母数字都换成 -）
function chatProjectDir() {
  return ROOT.replace(/[^A-Za-z0-9]/g, '-');
}

function toolHint(input) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input.slice(0, 200);
  try {
    const json = JSON.stringify(input);
    return json.length > 200 ? json.slice(0, 200) + '…' : json;
  } catch {
    return '';
  }
}

// 把 claude 的 stream-json 事件翻译成页面好渲染的几种消息
function relayClaudeEvent(obj, res) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.type === 'system' && obj.subtype === 'init') {
    CHAT.sessionId = obj.session_id || CHAT.sessionId;
    return sseSend(res, {
      t: 'init',
      sessionId: obj.session_id || null,
      model: obj.model || null,
      permissionMode: obj.permissionMode || null,
    });
  }
  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    const texts = [];
    for (const block of obj.message.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) texts.push(block.text);
      else if (block.type === 'tool_use') sseSend(res, { t: 'tool', name: String(block.name || 'tool'), hint: toolHint(block.input) });
    }
    if (texts.length) sseSend(res, { t: 'text', text: texts.join('\n\n') });
    return;
  }
  if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
    for (const block of obj.message.content) {
      if (block && block.type === 'tool_result') sseSend(res, { t: 'toolResult', ok: block.is_error !== true });
    }
    return;
  }
  if (obj.type === 'result') {
    CHAT.sessionId = obj.session_id || CHAT.sessionId;
    const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage : {};
    // total_cost_usd 是 CLI 拿 Anthropic 价目表估的。模型名不在它的价目表里时
    // 它会自己标 costBasis: "unknown"，这个美元数就不能信——真实账单在网关那边。
    const modelKey = obj.modelUsage && typeof obj.modelUsage === 'object' ? Object.keys(obj.modelUsage)[0] : null;
    const modelUsage = modelKey ? obj.modelUsage[modelKey] : null;
    return sseSend(res, {
      t: 'result',
      ok: obj.is_error !== true,
      sessionId: obj.session_id || null,
      ms: typeof obj.duration_ms === 'number' ? obj.duration_ms : null,
      ttftMs: typeof obj.ttft_ms === 'number' ? obj.ttft_ms : null,
      turns: typeof obj.num_turns === 'number' ? obj.num_turns : null,
      // token 数是网关真实返回的，可信
      usage: {
        input: Number(usage.input_tokens) || 0,
        cacheRead: Number(usage.cache_read_input_tokens) || 0,
        cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
        output: Number(usage.output_tokens) || 0,
      },
      cost: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null,
      costBasis: (modelUsage && modelUsage.costBasis) || 'unknown',
      model: modelKey || null,
    });
  }
}

async function handleChat(req, res) {
  if (CHAT.child) return sendError(res, 409, '上一条还在跑，先点「停止」再发。');

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendError(res, 400, err.message);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return sendError(res, 400, '消息不能为空。');

  // 只认两档权限，页面传什么都不越界
  const mode = body.mode === 'readonly' ? 'plan' : 'bypassPermissions';
  const resume = typeof body.sessionId === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(body.sessionId) ? body.sessionId : null;

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode];
  if (resume) args.push('--resume', resume);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');

  let child;
  try {
    child = spawn(claudeBin(), args, { cwd: ROOT, windowsHide: true, env: process.env });
  } catch (err) {
    sseSend(res, { t: 'error', message: '启动 claude 失败：' + err.message });
    res.end();
    return;
  }

  CHAT.child = child;
  CHAT.startedAt = Date.now();
  CHAT.timer = setTimeout(() => {
    sseSend(res, { t: 'error', message: '超过 10 分钟，已自动停止。' });
    stopChat();
  }, CHAT_MAX_MS);

  // 消息走 stdin：不进命令行，既没有转义问题也没有长度限制
  try {
    child.stdin.write(message);
    child.stdin.end();
  } catch {}

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try { relayClaudeEvent(JSON.parse(line), res); } catch {}
    }
  });

  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
  });

  const finish = (payload) => {
    if (CHAT.child === child) {
      CHAT.child = null;
      if (CHAT.timer) { clearTimeout(CHAT.timer); CHAT.timer = null; }
    }
    sseSend(res, payload);
    sseSend(res, { t: 'done' });
    try { res.end(); } catch {}
  };

  child.on('error', (err) => {
    sseSend(res, { t: 'error', message: '无法启动 claude：' + err.message });
    finish({ t: 'close', ok: false });
  });

  child.on('close', (code) => {
    // 过滤掉已知的无害告警，别每条消息都刷一遍
    const useful = stderrTail
      .split('\n')
      .filter((line) => line.trim() && !line.includes('unrecognized_model'))
      .join('\n');
    if (useful.trim()) sseSend(res, { t: 'stderr', text: useful.trim().slice(-1200) });
    finish({ t: 'close', ok: code === 0, code });
  });

  // 页面关了 / 刷新了，就别让它在后台继续跑
  res.on('close', () => {
    if (CHAT.child === child) stopChat();
  });
}

/* ------------------------------------------------------------------ */
/* http plumbing                                                       */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON 格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

async function serveStatic(req, res, pathname) {
  let file;
  if (pathname === '/vendor/marked.umd.js') {
    file = path.join(ROOT, 'node_modules', 'marked', 'lib', 'marked.umd.js');
  } else {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
    file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
      return sendError(res, 403, 'forbidden');
    }
  }
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('not a file');
    // 安全响应头已由 createServer 统一设置，这里必须在 writeHead 之前完成
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    sendError(res, 404, 'not found');
  }
}

function openRecordingTerminal() {
  const script = path.join(ROOT, 'scripts', 'record-terminal.ps1');
  if (!fs.existsSync(script)) return { ok: false, error: '找不到 scripts/record-terminal.ps1' };
  const child = spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { ok: true };
}

function openDataFolder() {
  const child = spawn('explorer.exe', [DATA_DIR], { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, pathname, query) {
  const method = req.method || 'GET';

  if (method !== 'GET' && !originAllowed(req)) return sendError(res, 403, 'forbidden origin');

  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, name: 'cl-workbench', version: 1 });

  if (pathname === '/api/overview' && method === 'GET') {
    return sendJson(res, 200, buildOverview());
  }

  if (pathname === '/api/terminals' && method === 'GET') {
    return sendJson(res, 200, { sessions: listTerminalSessions() });
  }

  if (pathname === '/api/terminals/import' && method === 'POST') {
    try {
      return sendJson(res, 200, importPsReadlineHistory());
    } catch (err) {
      return sendError(res, 500, '导入失败：' + err.message);
    }
  }

  const termMatch = pathname.match(/^\/api\/terminals\/([^/]+)$/);
  if (termMatch) {
    const id = decodeURIComponent(termMatch[1]);
    if (!isValidTerminalId(id)) return sendError(res, 400, 'bad id');
    if (method === 'GET') {
      const detail = terminalDetail(id);
      if (!detail) return sendError(res, 404, '会话不存在');
      return sendJson(res, 200, detail);
    }
    if (method === 'PATCH') {
      const body = await readBody(req);
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
      updateTerminalMeta(id, { title: title || null });
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      for (const ext of ['jsonl', 'meta.json', 'log']) {
        try { await fsp.unlink(termPath(id, ext)); } catch {}
      }
      termCache.delete(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/claude/groups' && method === 'GET') {
    const groups = listClaudeGroups();
    const safe = groups.map((g) => ({
      projectDir: g.projectDir,
      projectPath: g.projectPath,
      count: g.count,
      lastAt: g.lastAt,
      sessions: g.sessions.map((s) => ({
        ...s,
        file: undefined,
        title: s.title,
        messageCount: s.messageCount,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
    }));
    return sendJson(res, 200, { groups: safe });
  }

  if (pathname === '/api/claude/session' && method === 'GET') {
    const projectDir = query.get('project') || '';
    const sessionId = query.get('id') || '';
    const session = findClaudeSession(projectDir, sessionId);
    if (!session) return sendError(res, 404, '对话不存在');
    return sendJson(res, 200, session);
  }

  if (pathname === '/api/notes' && method === 'GET') {
    const data = readNotes() || { notes: [] };
    return sendJson(res, 200, data);
  }

  if (pathname === '/api/notes' && method === 'POST') {
    const body = await readBody(req);
    const now = new Date().toISOString();
    const note = {
      id: crypto.randomUUID(),
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : '无标题笔记',
      content: typeof body.content === 'string' ? body.content : '',
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [],
      pinned: Boolean(body.pinned),
      createdAt: now,
      updatedAt: now,
    };
    const data = readNotes() || { version: 1, notes: [] };
    data.notes.push(note);
    await saveNotes(data.notes);
    return sendJson(res, 200, { ok: true, note });
  }

  const noteMatch = pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (noteMatch) {
    const id = decodeURIComponent(noteMatch[1]);
    const data = readNotes() || { version: 1, notes: [] };
    const index = data.notes.findIndex((n) => n.id === id);
    if (index === -1) return sendError(res, 404, '笔记不存在');
    if (method === 'PUT') {
      const body = await readBody(req);
      const note = data.notes[index];
      if (typeof body.title === 'string') note.title = body.title.trim().slice(0, 120) || '无标题笔记';
      if (typeof body.content === 'string') note.content = body.content;
      if (Array.isArray(body.tags)) note.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
      if (typeof body.pinned === 'boolean') note.pinned = body.pinned;
      note.updatedAt = new Date().toISOString();
      data.notes[index] = note;
      await saveNotes(data.notes);
      return sendJson(res, 200, { ok: true, note });
    }
    if (method === 'DELETE') {
      data.notes.splice(index, 1);
      await saveNotes(data.notes);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/search' && method === 'GET') {
    const q = (query.get('q') || '').trim();
    if (q.length < 1) return sendJson(res, 200, { commands: [], outputs: [], notes: [], claude: [] });
    return sendJson(res, 200, searchAll(q.slice(0, 100)));
  }

  if (pathname === '/api/chat' && method === 'POST') {
    if (!chatOriginOk(req)) return sendError(res, 403, 'forbidden origin');
    return handleChat(req, res);
  }

  if (pathname === '/api/chat/stop' && method === 'POST') {
    if (!chatOriginOk(req)) return sendError(res, 403, 'forbidden origin');
    return sendJson(res, 200, { ok: true, stopped: stopChat() });
  }

  if (pathname === '/api/chat/history' && method === 'GET') {
    // 刷新页面后靠这个把上一轮对话接回来：真身是 Claude Code 的存档，
    // 不是浏览器内存，所以关掉页面、重启服务都还在。
    const wanted = (query.get('id') || CHAT.sessionId || '').trim();
    if (!/^[0-9a-fA-F-]{8,64}$/.test(wanted)) return sendJson(res, 200, { ok: true, session: null });
    const projectDir = chatProjectDir();
    const session = findClaudeSession(projectDir, wanted);
    if (!session) return sendJson(res, 200, { ok: true, session: null });
    return sendJson(res, 200, {
      ok: true,
      session: {
        sessionId: wanted,
        projectDir,
        title: session.title || null,
        startedAt: session.startedAt || null,
        endedAt: session.endedAt || null,
        messages: (session.messages || []).slice(0, 2000).map((m) => ({
          role: m.role,
          ts: m.ts,
          text: m.text,
          tools: (m.tools || []).map((t) => ({ name: t.name, hint: t.input })),
        })),
      },
    });
  }

  if (pathname === '/api/chat/status' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      running: Boolean(CHAT.child),
      sessionId: CHAT.sessionId,
      startedAt: CHAT.startedAt || null,
    });
  }

  if (pathname === '/api/actions/open-terminal' && method === 'POST') {
    return sendJson(res, 200, openRecordingTerminal());
  }

  if (pathname === '/api/actions/open-folder' && method === 'POST') {
    return sendJson(res, 200, openDataFolder());
  }

  return sendError(res, 404, 'not found');
}

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = parsed.pathname;
  securityHeaders(res);
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsed.searchParams);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method not allowed');
    await serveStatic(req, res, pathname);
  } catch (err) {
    if (!res.headersSent) sendError(res, 500, err.message || 'server error');
    else try { res.end(); } catch {}
  }
});

// 服务退出时别把 claude 子进程留成孤儿
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopChat();
    process.exit(0);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。可能工作台已经在运行：http://${HOST}:${PORT}\n`);
    process.exit(1);
  }
  throw err;
});

ensureNotes().then(() => {
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  CL 工作台已启动');
    console.log(`  http://${HOST}:${PORT}`);
    console.log(`  数据目录: ${DATA_DIR}`);
    console.log('');
  });
});