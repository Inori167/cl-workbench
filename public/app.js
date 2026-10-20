/* CL 工作台 — 前端应用
   原生 JS，无构建步骤。依赖 window.marked 渲染 Markdown（/vendor/marked.umd.js）。
   结构与样式由 index.html + styles.css 定好，这里只负责取数与渲染。 */
'use strict';

(() => {
  /* ================================================================ */
  /* 基础工具                                                          */
  /* ================================================================ */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const view = $('#view');
  const viewport = $('#view');
  const titleEl = $('#page-title');
  const subtitleEl = $('#page-subtitle');
  const modalRoot = $('#modal-root');
  const toastWrap = $('#toast-wrap');

  const pad2 = (n) => String(n).padStart(2, '0');

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function icon(name, cls = 'icon') {
    return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
  }

  function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtTime(value) {
    const d = toDate(value);
    if (!d) return '—';
    const now = new Date();
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return hm;
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`;
    if (d.getFullYear() === now.getFullYear()) return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hm}`;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function fmtFull(value) {
    const d = toDate(value);
    if (!d) return '—';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function fmtRel(value) {
    const d = toDate(value);
    if (!d) return '—';
    const sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 0) return fmtTime(value);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} 天前`;
    return fmtTime(value);
  }

  function fmtDuration(ms) {
    const sec = Math.max(0, Math.round((ms || 0) / 1000));
    if (sec < 60) return `${sec} 秒`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟`;
    const hour = Math.floor(min / 60);
    const rest = min % 60;
    if (hour < 24) return rest ? `${hour} 小时 ${rest} 分` : `${hour} 小时`;
    return `${Math.floor(hour / 24)} 天 ${hour % 24} 小时`;
  }

  function fmtBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  function num(n) {
    return (Number(n) || 0).toLocaleString('zh-CN');
  }

  /* token 数通常很大，缩写显示；小于一千的保留原值 */
  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v < 1000) return String(v);
    if (v < 1000000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return (v / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }

  function truncate(text, max = 120) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  /* ---------------- Markdown ---------------- */

  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form').forEach((el) => el.remove());
    tpl.content.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*(javascript|data:text\/html)/i.test(value)) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return tpl.innerHTML;
  }

  function md(text) {
    const src = String(text === null || text === undefined ? '' : text);
    if (!src.trim()) return '';
    if (!window.marked || typeof window.marked.parse !== 'function') {
      return `<p>${esc(src).replace(/\n/g, '<br>')}</p>`;
    }
    try {
      return sanitize(window.marked.parse(src, { gfm: true, breaks: true }));
    } catch {
      return `<p>${esc(src).replace(/\n/g, '<br>')}</p>`;
    }
  }

  function highlight(text, needle) {
    const src = String(text === null || text === undefined ? '' : text);
    if (!needle) return esc(src);
    const hay = src.toLowerCase();
    const nd = needle.toLowerCase();
    let out = '';
    let i = 0;
    for (;;) {
      const idx = hay.indexOf(nd, i);
      if (idx === -1) { out += esc(src.slice(i)); break; }
      out += esc(src.slice(i, idx)) + '<mark>' + esc(src.slice(idx, idx + nd.length)) + '</mark>';
      i = idx + nd.length;
    }
    return out;
  }

  /* ================================================================ */
  /* 取数                                                              */
  /* ================================================================ */

  async function api(path, options = {}) {
    const init = { method: options.method || 'GET' };
    if (options.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch {
      throw new Error('连不上本地服务，请确认工作台还在运行');
    }
    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
    if (!res.ok) {
      const msg = data && (data.error || data.message);
      throw new Error(msg || `请求失败（${res.status}）`);
    }
    return data;
  }

  /* ================================================================ */
  /* 提示与弹窗                                                        */
  /* ================================================================ */

  function toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    const iconName = kind === 'bad' ? 'x' : kind === 'good' ? 'check' : 'message';
    el.innerHTML = icon(iconName) + `<span>${esc(message)}</span>`;
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 260);
    }, kind === 'bad' ? 4200 : 2600);
  }

  let modalEscHandler = null;

  function closeModal() {
    modalRoot.innerHTML = '';
    if (modalEscHandler) {
      document.removeEventListener('keydown', modalEscHandler, true);
      modalEscHandler = null;
    }
  }

  function openModal({ title, body, foot = '', onMount, width }) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true"${width ? ` style="width:min(${width}px,100%)"` : ''}>
        <div class="modal-head">
          <span class="modal-title">${esc(title)}</span>
          <button class="icon-btn" data-modal-close title="关闭">${icon('x')}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
      </div>`;
    modalRoot.appendChild(overlay);

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-modal-close]')) closeModal();
    });

    modalEscHandler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    };
    document.addEventListener('keydown', modalEscHandler, true);

    if (typeof onMount === 'function') onMount(overlay);
    return overlay;
  }

  function confirmModal({ title, message, confirmText = '确定', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const overlay = openModal({
        title,
        body: `<p style="margin:0">${esc(message)}</p>`,
        foot: `
          <button class="btn ghost" data-modal-close>取消</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${esc(confirmText)}</button>`,
        onMount(root) {
          root.querySelector('[data-confirm]').addEventListener('click', () => {
            done = true;
            closeModal();
            resolve(true);
          });
        },
      });
      // 关闭（点遮罩 / Esc / 取消）都算放弃
      const observer = new MutationObserver(() => {
        if (!overlay.isConnected) {
          observer.disconnect();
          if (!done) resolve(false);
        }
      });
      observer.observe(modalRoot, { childList: true });
    });
  }

  async function copyText(text, label = '已复制') {
    const value = String(text === null || text === undefined ? '' : text);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(label, 'good');
    } catch {
      toast('复制失败，请手动选择', 'bad');
    }
  }

  /* ================================================================ */
  /* 全局状态与路由                                                    */
  /* ================================================================ */

  const state = {
    route: { name: 'overview', arg: '' },
    overview: null,
    terminals: { sessions: [], filter: '', selectedId: null, tab: 'cmds', detail: null },
    claude: { groups: [], openProjects: new Set(), selected: null, detail: null, onlyUser: false },
    notes: { list: [], selectedId: null, draft: null, dirty: false, preview: true },
    chat: {
      sessionId: null, mode: 'work', running: false, items: [], streaming: null,
      controller: null, draft: '', model: null, costBasis: null,
      historyLoading: false, restored: false,
      totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, ms: 0 },
    },
    search: { query: '', results: null, loading: false },
    poll: null,
    searchTimer: null,
  };

  const PAGES = {
    overview: { title: '总览', subtitle: '所有终端、对话与笔记，一处回看' },
    terminals: { title: '终端历史', subtitle: '命令与输出在执行的当下就写进了磁盘' },
    claude: { title: 'AI 对话', subtitle: '自动读取 Claude Code 会话存档，只读不改' },
    chat: { title: '对话', subtitle: '直接和 Claude 说话，聊完的记录自动进「AI 对话」' },
    notes: { title: '工作笔记', subtitle: 'Markdown 编辑与预览，Ctrl + S 保存' },
    search: { title: '全局搜索', subtitle: '命令、输出、笔记、对话一次搜完' },
  };

  function setHead(name) {
    const page = PAGES[name] || PAGES.overview;
    titleEl.textContent = page.title;
    subtitleEl.textContent = page.subtitle;
    document.title = `${page.title} · CL 工作台`;
    $$('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === name);
    });
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
    const name = parts[0] || 'overview';
    if (!PAGES[name]) return { name: 'overview', arg: '' };
    return { name, arg: parts.slice(1).join('/') };
  }

  function go(hash) {
    if (location.hash === hash) return;
    location.hash = hash;
  }

  function setCount(key, value) {
    const el = $(`.nav-count[data-count="${key}"]`);
    if (el) el.textContent = num(value);
  }

  function setNavCountsFromOverview(overview) {
    if (!overview || !overview.stats) return;
    setCount('terminals', overview.stats.terminalSessions);
    setCount('claude', overview.stats.claudeSessions);
    setCount('notes', overview.stats.notes);
  }

  const emptyState = ({ icon: iconName = 'layers', title, text, actions = '' }) => `
    <div class="empty">
      <span class="empty-icon">${icon(iconName)}</span>
      <h3>${esc(title)}</h3>
      <p>${text}</p>
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </div>`;

  const loadingState = (label = '读取中…') => `
    <div class="detail-loading">
      <div class="skeleton" style="height:14px;width:32%"></div>
      <div class="skeleton" style="height:22px;width:58%"></div>
      <div class="skeleton" style="height:12px;width:44%"></div>
      <span class="card-sub" style="padding-top:4px">${esc(label)}</span>
    </div>`;

  /* ================================================================ */
  /* 总览                                                              */
  /* ================================================================ */

  function chartSvg(activity) {
    const W = 640;
    const H = 172;
    const padT = 18;
    const padB = 26;
    const padL = 34;
    const padR = 10;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = activity.length || 1;
    const slot = innerW / n;
    const barW = Math.min(24, slot * 0.56);
    const maxCount = Math.max(1, ...activity.map((d) => d.commands || 0));
    const total = activity.reduce((sum, d) => sum + (d.commands || 0), 0);
    const todayKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    })();

    const parts = [];
    parts.push(`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="最近 14 天命令活跃度">`);

    // 横向网格线 + 刻度
    for (let i = 0; i <= 2; i++) {
      const value = Math.round((maxCount / 2) * i);
      const y = padT + innerH - (innerH / 2) * i;
      parts.push(`<line class="chart-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`);
      parts.push(`<text class="chart-axis-text" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${value}</text>`);
    }

    if (total === 0) {
      parts.push(`<text class="chart-empty-note" x="${padL + innerW / 2}" y="${padT + innerH / 2}" text-anchor="middle">还没有命令记录，用「打开记录终端」开始干活</text>`);
    }

    activity.forEach((day, i) => {
      const count = day.commands || 0;
      const x = padL + slot * i + (slot - barW) / 2;
      const h = count > 0 ? Math.max(3, (count / maxCount) * innerH) : 2;
      const y = padT + innerH - h;
      const label = `${day.date.slice(5)} · ${count} 条命令`;
      parts.push(`<rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, barW / 3).toFixed(1)}" tabindex="0" data-tip="${esc(label)}" opacity="${count > 0 ? 1 : 0.35}"/>`);
      if (count > 0) {
        parts.push(`<text class="chart-bar-value" x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${count}</text>`);
      }
      if (i % 2 === 1 || n <= 8) {
        const today = day.date === todayKey;
        parts.push(`<text class="chart-axis-text${today ? ' today' : ''}" x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${day.date.slice(5)}</text>`);
      }
    });

    parts.push('</svg>');
    return parts.join('');
  }

  function miniTerminal(session) {
    return `
      <button class="mini-item" data-open-terminal-session="${esc(session.id)}">
        <span class="mini-icon">${icon('terminal')}</span>
        <span class="mini-main">
          <span class="mini-title">${esc(session.title || truncate(session.cwd || '', 46) || '终端会话')}</span>
          <span class="mini-sub">${num(session.commandCount)} 条命令${session.errorCount ? ` · <span class="err">${num(session.errorCount)} 失败</span>` : ''}</span>
        </span>
        <span class="mini-time">${esc(fmtRel(session.startedAt))}</span>
      </button>`;
  }

  function miniClaude(session) {
    return `
      <button class="mini-item" data-open-claude="${esc(session.projectDir || '')}|${esc(session.sessionId)}">
        <span class="mini-icon">${icon('spark')}</span>
        <span class="mini-main">
          <span class="mini-title">${esc(truncate(session.title || '未命名对话', 62))}</span>
          <span class="mini-sub">${num(session.messageCount)} 条消息${session.model ? ` · <code>${esc(session.model)}</code>` : ''}</span>
        </span>
        <span class="mini-time">${esc(fmtRel(session.endedAt || session.mtime))}</span>
      </button>`;
  }

  function miniNote(note) {
    return `
      <button class="mini-item" data-open-note="${esc(note.id)}">
        <span class="mini-icon">${icon('note')}</span>
        <span class="mini-main">
          <span class="mini-title">${esc(note.title || '无标题笔记')}</span>
          <span class="mini-sub">${esc(truncate((note.content || '').replace(/[#*`>\-]/g, ' ').trim(), 60) || '空笔记')}</span>
        </span>
        <span class="mini-time">${esc(fmtRel(note.updatedAt))}</span>
      </button>`;
  }

  async function renderOverview() {
    viewport.innerHTML = `<div class="view">${loadingState('正在汇总本地记录…')}</div>`;
    let data;
    try {
      data = await api('/api/overview');
    } catch (err) {
      viewport.innerHTML = `<div class="view">${emptyState({
        icon: 'terminal-off',
        title: '读不到总览数据',
        text: esc(err.message),
        actions: `<button class="btn ghost" data-action="retry">${icon('refresh')}重试</button>`,
      })}</div>`;
      return;
    }
    if (state.route.name !== 'overview') return;
    state.overview = data;
    setNavCountsFromOverview(data);

    const s = data.stats;
    const hasAny = s.terminalSessions > 0 || s.claudeSessions > 0 || s.notes > 0;
    const todayCount = (data.activity.find((d) => d.commands > 0 && d.date === data.activity[data.activity.length - 1].date) || {}).commands || 0;

    const heroText = s.terminalSessions
      ? `命令在敲下的那一刻就写进了 <span class="accent">F:\\cl\\data</span>，PowerShell 输入历史逐条落盘，输出持续写日志。窗口崩了，记录还在。`
      : `现在还没有终端记录。点「打开记录终端」开一个录制终端，之后的每条命令都会实时落盘，cmd 崩溃也不丢。`;

    const tiles = [
      { label: '终端会话', icon: 'terminal', value: num(s.terminalSessions), hint: s.activeTerminals ? `${num(s.activeTerminals)} 个正在录制` : '还没有进行中的会话' },
      { label: '累计命令', icon: 'layers', value: num(s.totalCommands), hint: s.firstAt ? `最早一条 ${fmtTime(s.firstAt)}` : '暂无记录' },
      { label: '失败命令', icon: 'x', value: num(s.errorCommands), hint: s.errorCommands ? '可在终端历史里按会话回看' : '全部正常退出' },
      { label: 'AI 对话', icon: 'spark', value: num(s.claudeSessions), hint: `${num(s.claudeMessages)} 条消息 · ${num(s.notes)} 条笔记` },
    ];

    const recentTerminals = data.recentTerminals.length
      ? data.recentTerminals.map(miniTerminal).join('')
      : `<div class="empty" style="padding:22px 12px"><p>还没有终端会话</p></div>`;
    const recentClaude = data.recentClaude.length
      ? data.recentClaude.map(miniClaude).join('')
      : `<div class="empty" style="padding:22px 12px"><p>还没有对话记录</p></div>`;
    const recentNotes = data.recentNotes.length
      ? data.recentNotes.map(miniNote).join('')
      : `<div class="empty" style="padding:22px 12px"><p>还没有笔记</p></div>`;

    viewport.innerHTML = `
      <div class="view">
        <section class="hero">
          <div>
            <span class="eyebrow"><span class="live-dot"></span>本地运行 · 数据实时落盘</span>
            <h2>历史记录不再随窗口一起消失</h2>
            <p>${heroText}</p>
            <div class="hero-actions">
              <button class="btn primary" data-action="open-terminal">${icon('play')}打开记录终端</button>
              <a class="btn ghost" href="#/terminals">${icon('terminal')}查看终端历史</a>
            </div>
          </div>
          <div class="hero-figure">
            <div class="hero-number">${num(s.totalCommands)}</div>
            <div class="hero-label">累计记录的命令</div>
            <div class="hero-delta">今天 ${num(todayCount)} 条 · 记录 ${num(s.spanDays)} 天</div>
          </div>
        </section>

        <div class="tiles">
          ${tiles.map((t) => `
            <div class="tile">
              <div class="tile-label">${icon(t.icon)}${esc(t.label)}</div>
              <div class="tile-value">${t.value}</div>
              <div class="tile-hint">${esc(t.hint)}</div>
            </div>`).join('')}
        </div>

        <div class="grid-main">
          <section class="card">
            <div class="card-head">
              <div class="card-title">${icon('grid')}最近 14 天活跃度</div>
              <div class="card-sub">按命令落盘时间统计</div>
            </div>
            <div class="chart-wrap">
              ${chartSvg(data.activity)}
              <div class="chart-tip" id="chart-tip" hidden></div>
            </div>
            <details class="table-view">
              <summary>${icon('layers')}按天查看</summary>
              <table>
                <thead><tr><th>日期</th><th>命令数</th></tr></thead>
                <tbody>
                  ${data.activity.slice().reverse().map((d) => `<tr><td>${esc(d.date)}</td><td>${num(d.commands)}</td></tr>`).join('')}
                </tbody>
              </table>
            </details>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="card-title">${icon('terminal')}最近终端</div>
              <a class="card-sub" href="#/terminals">全部</a>
            </div>
            <div class="mini-list">${recentTerminals}</div>
          </section>
        </div>

        <div class="grid-half">
          <section class="card">
            <div class="card-head">
              <div class="card-title">${icon('spark')}最近 AI 对话</div>
              <a class="card-sub" href="#/claude">全部</a>
            </div>
            <div class="mini-list">${recentClaude}</div>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="card-title">${icon('note')}最近笔记</div>
              <a class="card-sub" href="#/notes">全部</a>
            </div>
            <div class="mini-list">${recentNotes}</div>
          </section>
        </div>

        ${hasAny ? '' : `<div class="card" style="margin-top:14px">${emptyState({
          icon: 'help',
          title: '从「打开记录终端」开始',
          text: '所有功能都是本地读写，不联网。想先看看旧记录，可以直接导入已有的 PowerShell 历史。',
          actions: `<button class="btn primary" data-action="open-terminal">${icon('play')}打开记录终端</button>
                    <button class="btn ghost" data-action="import-psreadline">${icon('arrow-up')}导入 PowerShell 历史</button>`,
        })}</div>`}
      </div>`;

    bindChartTip();
  }

  function bindChartTip() {
    const wrap = $('.chart-wrap', viewport);
    const tip = $('#chart-tip', viewport);
    if (!wrap || !tip) return;

    const show = (target) => {
      const text = target.getAttribute('data-tip');
      if (!text) return;
      tip.textContent = text;
      const wrapRect = wrap.getBoundingClientRect();
      const barRect = target.getBoundingClientRect();
      tip.hidden = false;
      const left = barRect.left - wrapRect.left + barRect.width / 2;
      tip.style.left = `${Math.max(40, Math.min(wrapRect.width - 40, left))}px`;
      tip.style.top = `${barRect.top - wrapRect.top - 6}px`;
    };

    wrap.addEventListener('mouseover', (e) => {
      const bar = e.target.closest('.chart-bar');
      if (bar) show(bar);
    });
    wrap.addEventListener('mouseout', (e) => {
      if (e.target.closest('.chart-bar')) tip.hidden = true;
    });
    wrap.addEventListener('focusin', (e) => {
      const bar = e.target.closest('.chart-bar');
      if (bar) show(bar);
    });
    wrap.addEventListener('focusout', () => { tip.hidden = true; });
  }

  /* ================================================================ */
  /* 终端历史                                                          */
  /* ================================================================ */

  function sessionItem(session, activeId) {
    const badges = [];
    if (session.active) badges.push('<span class="live-pill">录制中</span>');
    else if (!session.ended && session.source !== 'psreadline') badges.push('<span class="badge bad">异常结束</span>');
    if (session.source === 'psreadline') badges.push('<span class="badge neutral">导入</span>');

    const stats = [`<span>${num(session.commandCount)} 条命令</span>`];
    if (session.errorCount) stats.push(`<span class="err"><span class="err-dot"></span>${num(session.errorCount)} 失败</span>`);
    if (session.transcriptBytes) stats.push(`<span>输出 ${esc(fmtBytes(session.transcriptBytes))}</span>`);

    return `
      <button class="session-item${session.id === activeId ? ' active' : ''}" data-terminal="${esc(session.id)}">
        <div class="session-top">
          <span class="session-title">${esc(session.title || truncate(session.cwd || '', 40) || '终端会话')}</span>
          ${badges.join('')}
          <span class="session-time">${esc(fmtTime(session.startedAt))}</span>
        </div>
        ${session.cwd ? `<div class="session-sub"><code>${esc(truncate(session.cwd, 52))}</code></div>` : ''}
        <div class="session-stats">${stats.join('')}</div>
      </button>`;
  }

  function terminalDetailHtml(detail, tab) {
    const s = detail.session;
    const events = (detail.events || []).filter((e) => e && e.type === 'cmd' && typeof e.cmd === 'string');
    const transcript = detail.transcript;

    const head = `
      <div class="detail-head">
        <div class="detail-head-row">
          <div style="min-width:0">
            <span class="eyebrow">${icon('terminal')}终端会话</span>
            <h2 class="detail-title">${esc(s.title || '未命名会话')}</h2>
            <div class="meta-chips">
              <span class="meta-chip">${icon('clock')}开始 ${esc(fmtFull(s.startedAt))}</span>
              <span class="meta-chip">${icon('layers')}时长 ${esc(fmtDuration(s.durationMs))}</span>
              <span class="meta-chip">${icon('terminal')}${esc(s.shell)}</span>
              ${s.cwd ? `<span class="meta-chip hide-sm">${icon('folder')}<code>${esc(truncate(s.cwd, 46))}</code></span>` : ''}
              ${s.active ? '<span class="meta-chip"><span class="live-dot"></span>录制中</span>' : ''}
            </div>
          </div>
          <div class="detail-actions">
            <button class="btn ghost small" data-action="rename-terminal" data-id="${esc(s.id)}">${icon('edit')}重命名</button>
            <button class="btn ghost small" data-action="copy-terminal-cmds" data-id="${esc(s.id)}">${icon('copy')}复制命令</button>
            <button class="btn ghost small" data-action="open-folder">${icon('folder')}数据目录</button>
            <button class="btn danger small" data-action="delete-terminal" data-id="${esc(s.id)}">${icon('trash')}删除</button>
          </div>
        </div>
      </div>`;

    const tabs = `
      <div class="tabs">
        <button class="tab${tab === 'cmds' ? ' active' : ''}" data-tab="cmds">${icon('terminal')}命令<span class="tab-count">${num(events.length)}</span></button>
        <button class="tab${tab === 'output' ? ' active' : ''}" data-tab="output">${icon('layers')}输出${transcript ? `<span class="tab-count">${esc(fmtBytes(transcript.bytes))}</span>` : ''}</button>
        <button class="tab${tab === 'meta' ? ' active' : ''}" data-tab="meta">${icon('clock')}时间线</button>
      </div>`;

    let body = '';
    if (tab === 'cmds') {
      if (!events.length) {
        body = emptyState({
          icon: 'terminal-off',
          title: '这个会话没有记录到命令',
          text: '可能是刚打开还没执行过命令。在记录终端里敲一条命令，回到这里刷新就能看到。',
          actions: `<button class="btn ghost" data-action="refresh-terminals">${icon('refresh')}刷新</button>`,
        });
      } else {
        body = `
          <div class="cmd-toolbar">
            <div class="search-mini" style="max-width:320px">
              ${icon('search')}
              <input class="input" data-cmd-filter placeholder="筛选命令…" value="${esc(state.terminals.cmdFilter || '')}">
            </div>
            <span class="card-sub" style="margin-left:auto">${num(events.length)} 条</span>
          </div>
          <div class="cmd-list" id="cmd-list">${cmdRows(events, s.id)}</div>`;
      }
    } else if (tab === 'output') {
      if (!transcript || !transcript.text.trim()) {
        body = emptyState({
          icon: 'layers',
          title: '没有捕获到输出',
          text: '输出由 Start-Transcript 记录。如果这个会话刚启动，日志可能还是空的。',
        });
      } else {
        body = `
          ${transcript.truncated ? `<p class="transcript-note">日志较大，这里只显示开头的一部分（共 ${esc(fmtBytes(transcript.bytes))}）。完整内容见 <code>data\\terminals\\${esc(s.id)}.log</code>。</p>` : ''}
          <pre class="transcript">${esc(transcript.text)}</pre>`;
      }
    } else {
      const first = events[0];
      const last = events[events.length - 1];
      body = `
        <div class="meta-chips" style="margin-bottom:14px">
          <span class="meta-chip">${icon('clock')}首条命令 ${esc(first ? fmtFull(first.ts) : '—')}</span>
          <span class="meta-chip">${icon('clock')}末条命令 ${esc(last ? fmtFull(last.ts) : '—')}</span>
          <span class="meta-chip">${icon('check')}正常 ${num(events.length - s.errorCount)} 条</span>
          ${s.errorCount ? `<span class="meta-chip">${icon('x')}失败 ${num(s.errorCount)} 条</span>` : ''}
        </div>
        <div class="cmd-list">${events.map((e, i) => {
          const bad = e.ok === false || (typeof e.exitCode === 'number' && e.exitCode !== 0);
          return `
            <div class="cmd-row">
              <span class="cmd-index">${i + 1}</span>
              <div class="cmd-main">
                <code class="cmd-text">${esc(e.cmd)}</code>
                <div class="cmd-sub">
                  <span>${esc(fmtFull(e.ts))}</span>
                  ${e.cwd ? `<code>${esc(truncate(e.cwd, 48))}</code>` : ''}
                  ${typeof e.exitCode === 'number' && e.exitCode !== 0 ? `<span class="err">exit ${esc(e.exitCode)}</span>` : ''}
                </div>
              </div>
              <span class="badge ${bad ? 'bad' : 'good'}"><span class="dot"></span>${bad ? '失败' : '正常'}</span>
              <button class="icon-btn" data-action="copy-cmd" data-cmd="${esc(e.cmd)}" title="复制命令">${icon('copy')}</button>
            </div>`;
        }).join('')}</div>`;
    }

    return `${head}${tabs}<div class="tab-body">${body}</div>`;
  }

  function cmdRows(events, sessionId) {
    const filter = (state.terminals.cmdFilter || '').toLowerCase();
    const list = filter ? events.filter((e) => String(e.cmd).toLowerCase().includes(filter)) : events;
    if (!list.length) {
      return `<div class="empty" style="padding:26px 12px"><p>没有匹配「${esc(state.terminals.cmdFilter || '')}」的命令</p></div>`;
    }
    return list.map((e, i) => {
      const bad = e.ok === false || (typeof e.exitCode === 'number' && e.exitCode !== 0);
      const imported = e.imported === true;
      return `
        <div class="cmd-row" data-session="${esc(sessionId)}">
          <span class="cmd-index">${i + 1}</span>
          <div class="cmd-main">
            <code class="cmd-text">${highlight(e.cmd, state.terminals.cmdFilter || '')}</code>
            <div class="cmd-sub">
              ${imported ? '<span>来自 PowerShell 历史</span>' : `<span>${esc(fmtTime(e.ts))}</span>`}
              ${e.cwd ? `<code>${esc(truncate(e.cwd, 48))}</code>` : ''}
            </div>
          </div>
          <span class="badge ${imported ? 'neutral' : bad ? 'bad' : 'good'}"><span class="dot"></span>${imported ? '导入' : bad ? '失败' : '正常'}</span>
          <button class="icon-btn" data-action="copy-cmd" data-cmd="${esc(e.cmd)}" title="复制命令">${icon('copy')}</button>
        </div>`;
    }).join('');
  }

  function filteredSessions() {
    const t = state.terminals;
    const filter = (t.filter || '').toLowerCase();
    if (!filter) return t.sessions;
    return t.sessions.filter((s) => [s.title, s.cwd, s.lastCommand, s.id, s.shell]
      .filter(Boolean).join(' ').toLowerCase().includes(filter));
  }

  function termListHtml() {
    const t = state.terminals;
    const sessions = filteredSessions();
    if (sessions.length) return sessions.map((s) => sessionItem(s, t.selectedId)).join('');
    if (t.sessions.length) return `<div class="empty" style="padding:26px 12px"><p>没有匹配「${esc(t.filter)}」的会话</p></div>`;
    return emptyState({
      icon: 'terminal-off',
      title: '还没有终端记录',
      text: '用「打开记录终端」启动的 PowerShell，每条命令都会实时落盘。也可以先把已有的 PowerShell 历史导进来。',
      actions: `<button class="btn primary small" data-action="open-terminal">${icon('play')}打开记录终端</button>
                <button class="btn ghost small" data-action="import-psreadline">${icon('arrow-up')}导入历史</button>`,
    });
  }

  /* 只刷新左侧列表，输入框不会因为整体重绘而丢焦点 */
  function renderTermList() {
    const holder = $('#term-list', viewport);
    if (holder) holder.innerHTML = termListHtml();
    const countEl = $('.pane-title-row .count', viewport);
    if (countEl) {
      const activeCount = state.terminals.sessions.filter((s) => s.active).length;
      countEl.textContent = `${num(filteredSessions().length)}${activeCount ? ` · ${num(activeCount)} 录制中` : ''}`;
    }
  }

  function renderTerminalPane() {
    const t = state.terminals;
    const sessions = filteredSessions();
    const listHtml = termListHtml();

    let detailHtml;
    if (!t.selectedId) {
      detailHtml = `
        <div class="detail-pane">
          <div class="tab-body" style="display:flex;align-items:center;justify-content:center">${emptyState({
            icon: 'terminal',
            title: '选一个会话看详情',
            text: '左边列出所有录制过的会话，点进去可以看每条命令、成败状态和完整输出日志。',
          })}</div>
        </div>`;
    } else if (!t.detail) {
      detailHtml = `<div class="detail-pane">${loadingState('正在读取会话记录…')}</div>`;
    } else {
      detailHtml = `<div class="detail-pane">${terminalDetailHtml(t.detail, t.tab)}</div>`;
    }

    const activeCount = t.sessions.filter((s) => s.active).length;

    viewport.innerHTML = `
      <div class="view">
        <div class="split">
          <div class="pane">
            <div class="pane-head">
              <div class="search-mini">
                ${icon('search')}
                <input class="input" data-term-filter placeholder="筛选会话…" value="${esc(t.filter)}">
              </div>
              <div class="pane-tools">
                <button class="btn ghost small" data-action="open-terminal">${icon('play')}记录终端</button>
                <button class="btn ghost small" data-action="import-psreadline">${icon('arrow-up')}导入历史</button>
                <button class="icon-btn" data-action="refresh-terminals" title="刷新">${icon('refresh')}</button>
              </div>
              <div class="pane-title-row">
                <span>会话</span>
                <span class="count">${num(sessions.length)}${activeCount ? ` · ${num(activeCount)} 录制中` : ''}</span>
              </div>
            </div>
            <div class="pane-body" id="term-list">${listHtml}</div>
          </div>
          ${detailHtml}
        </div>
      </div>`;

    const filterInput = $('[data-term-filter]', viewport);
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        state.terminals.filter = e.target.value;
        renderTermList();
      });
    }
  }

  async function loadTerminals({ silent } = {}) {
    try {
      const data = await api('/api/terminals');
      state.terminals.sessions = data.sessions || [];
      setCount('terminals', state.terminals.sessions.length);
      return true;
    } catch (err) {
      if (!silent) toast(err.message, 'bad');
      return false;
    }
  }

  async function renderTerminals(arg) {
    if (!state.terminals.sessions.length) {
      viewport.innerHTML = `<div class="view"><div class="split"><div class="pane"><div class="pane-body">${loadingState('正在读取终端记录…')}</div></div><div class="detail-pane"></div></div></div>`;
    }
    await loadTerminals({ silent: true });

    state.terminals.selectedId = arg || null;
    state.terminals.detail = null;
    renderTerminalPane();

    if (state.terminals.selectedId) await loadTerminalDetail(state.terminals.selectedId);
  }

  async function loadTerminalDetail(id) {
    try {
      const detail = await api(`/api/terminals/${encodeURIComponent(id)}`);
      if (state.route.name !== 'terminals' || state.terminals.selectedId !== id) return;
      state.terminals.detail = detail;
      renderTerminalPane();
    } catch (err) {
      if (state.route.name !== 'terminals' || state.terminals.selectedId !== id) return;
      state.terminals.detail = null;
      state.terminals.selectedId = null;
      renderTerminalPane();
      toast(err.message, 'bad');
    }
  }

  /* ================================================================ */
  /* AI 对话                                                           */
  /* ================================================================ */

  function claudeSessionItem(session, projectDir, selected) {
    const active = selected && selected.projectDir === projectDir && selected.sessionId === session.sessionId;
    return `
      <button class="session-item${active ? ' active' : ''}" data-claude-session="${esc(projectDir)}|${esc(session.sessionId)}">
        <div class="session-top">
          <span class="session-title">${esc(truncate(session.title || '未命名对话', 44))}</span>
          <span class="session-time">${esc(fmtTime(session.endedAt || session.mtime || session.startedAt))}</span>
        </div>
        <div class="session-stats">
          <span>${num(session.messageCount)} 条消息</span>
          ${session.model ? `<span><code>${esc(session.model)}</code></span>` : ''}
          ${session.truncated ? '<span class="err">文件较大，已截断</span>' : ''}
        </div>
      </button>`;
  }

  function claudeMessagesHtml(detail) {
    const onlyUser = state.claude.onlyUser;
    const messages = (detail.messages || []).filter((m) => (onlyUser ? m.role === 'user' : true));
    if (!messages.length) {
      return emptyState({
        icon: 'spark',
        title: onlyUser ? '这一段里没有你的提问' : '这个会话没有可显示的消息',
        text: '存档里可能只有工具调用或系统提示。',
      });
    }
    return `<div class="msg-list">${messages.map((m) => {
      const isUser = m.role === 'user';
      const tools = (m.tools || []).map((t) => `
        <details class="tool-use">
          <summary>${icon('layers')}<span class="tool-name">${esc(t.name)}</span><span class="tool-hint">${esc(truncate(t.input || '', 96))}</span></summary>
          <pre>${esc(t.input || '')}</pre>
        </details>`).join('');
      const body = m.text ? `<div class="msg-body md">${md(m.text)}</div>` : '';
      return `
        <div class="msg${isUser ? ' user' : ''}">
          <span class="avatar">${isUser ? '你' : 'AI'}</span>
          <div class="msg-main">
            <div class="msg-head">
              <span class="msg-role">${isUser ? '你' : 'Claude'}</span>
              <span class="msg-time">${esc(fmtFull(m.ts))}</span>
            </div>
            ${body}
            ${tools}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  function renderClaudePane() {
    const c = state.claude;
    const groups = c.groups;

    const tree = groups.length
      ? groups.map((g) => {
        const open = c.openProjects.has(g.projectDir) || groups.length === 1;
        return `
          <details class="tree-group" ${open ? 'open' : ''} data-project-dir="${esc(g.projectDir)}">
            <summary class="tree-project">
              <svg class="chev"><use href="#i-chevron"/></svg>
              ${icon('folder')}
              <span class="path" title="${esc(g.projectPath)}">${esc(g.projectPath)}</span>
              <span class="tree-count">${num(g.count)}</span>
            </summary>
            <div class="tree-sessions">
              ${g.sessions.map((s) => claudeSessionItem(s, g.projectDir, c.selected)).join('')}
            </div>
          </details>`;
      }).join('')
      : emptyState({
        icon: 'spark',
        title: '还没有找到 Claude Code 会话存档',
        text: `工作台会读取 <code>~/.claude/projects</code>。用 Claude Code 在这个目录里聊过之后，这里会自动出现记录。`,
      });

    let detailHtml;
    if (!c.selected) {
      detailHtml = `<div class="detail-pane"><div class="tab-body" style="display:flex;align-items:center;justify-content:center">${emptyState({
        icon: 'spark',
        title: '选一段对话',
        text: '左边按项目分组列出所有会话，点开可以看完整的来回消息和工具调用。这里是只读展示，不影响 Claude Code 自己的存档。',
      })}</div></div>`;
    } else if (!c.detail) {
      detailHtml = `<div class="detail-pane">${loadingState('正在解析会话存档…')}</div>`;
    } else {
      const d = c.detail;
      const total = (d.messages || []).length;
      detailHtml = `
        <div class="detail-pane">
          <div class="detail-head">
            <div class="detail-head-row">
              <div style="min-width:0">
                <span class="eyebrow">${icon('spark')}AI 对话</span>
                <h2 class="detail-title">${esc(d.title || '未命名对话')}</h2>
                <div class="meta-chips">
                  <span class="meta-chip">${icon('clock')}开始 ${esc(fmtFull(d.startedAt))}</span>
                  <span class="meta-chip">${icon('clock')}最后 ${esc(fmtFull(d.endedAt))}</span>
                  <span class="meta-chip">${icon('message')}${num(total)} 条消息</span>
                  ${d.model ? `<span class="meta-chip hide-sm"><code>${esc(d.model)}</code></span>` : ''}
                  ${d.cwd ? `<span class="meta-chip hide-sm">${icon('folder')}<code>${esc(truncate(d.cwd, 40))}</code></span>` : ''}
                </div>
              </div>
              <div class="detail-actions">
                <button class="btn ghost small ${c.onlyUser ? 'on' : ''}" data-action="toggle-only-user">${icon('eye')}${c.onlyUser ? '显示全部' : '只看我的提问'}</button>
                <button class="btn ghost small" data-action="copy-claude-id" data-id="${esc(d.sessionId)}">${icon('copy')}复制会话 ID</button>
              </div>
            </div>
          </div>
          <div class="tab-body">${claudeMessagesHtml(d)}</div>
        </div>`;
    }

    viewport.innerHTML = `
      <div class="view">
        <div class="split">
          <div class="pane">
            <div class="pane-head">
              <div class="search-mini">
                ${icon('search')}
                <input class="input" data-claude-filter placeholder="筛选对话…" value="${esc(c.filter || '')}">
              </div>
              <div class="pane-tools">
                <button class="icon-btn" data-action="refresh-claude" title="重新读取">${icon('refresh')}</button>
                <span class="pane-title-row" style="flex:1"><span>项目 / 会话</span><span class="count">${num(groups.reduce((n, g) => n + g.count, 0))}</span></span>
              </div>
            </div>
            <div class="pane-body" id="claude-tree">${tree}</div>
          </div>
          ${detailHtml}
        </div>
      </div>`;

    $$('.tree-group', viewport).forEach((el) => {
      el.addEventListener('toggle', () => {
        if (el.open) state.claude.openProjects.add(el.dataset.projectDir);
        else state.claude.openProjects.delete(el.dataset.projectDir);
      });
    });

    const filterInput = $('[data-claude-filter]', viewport);
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        state.claude.filter = e.target.value;
        applyClaudeFilter();
      });
    }
  }

  function applyClaudeFilter() {
    const needle = (state.claude.filter || '').trim().toLowerCase();
    $$('#claude-tree .tree-group', viewport).forEach((group) => {
      const path = ($('.path', group)?.textContent || '').toLowerCase();
      let visible = 0;
      $$('.session-item', group).forEach((item) => {
        const text = item.textContent.toLowerCase();
        const hit = !needle || text.includes(needle) || path.includes(needle);
        item.style.display = hit ? '' : 'none';
        if (hit) visible++;
      });
      group.style.display = visible ? '' : 'none';
      if (needle && visible) group.open = true;
    });
  }

  async function loadClaudeGroups() {
    const data = await api('/api/claude/groups');
    state.claude.groups = data.groups || [];
    setCount('claude', state.claude.groups.reduce((n, g) => n + g.count, 0));
  }

  async function renderClaude(arg) {
    viewport.innerHTML = `<div class="view"><div class="split"><div class="pane"><div class="pane-body">${loadingState('正在读取 Claude Code 存档…')}</div></div><div class="detail-pane"></div></div></div>`;
    try {
      await loadClaudeGroups();
    } catch (err) {
      viewport.innerHTML = `<div class="view">${emptyState({
        icon: 'spark',
        title: '读不到会话存档',
        text: esc(err.message),
        actions: `<button class="btn ghost" data-action="retry">${icon('refresh')}重试</button>`,
      })}</div>`;
      return;
    }
    if (state.route.name !== 'claude') return;

    if (arg) {
      const [projectDir, sessionId] = arg.split('/');
      if (projectDir && sessionId) state.claude.selected = { projectDir, sessionId };
      if (projectDir) state.claude.openProjects.add(projectDir);
    } else {
      state.claude.selected = null;
    }
    state.claude.detail = null;
    renderClaudePane();
    if (state.claude.selected) await loadClaudeSession(state.claude.selected);
  }

  async function loadClaudeSession(sel) {
    try {
      const detail = await api(`/api/claude/session?project=${encodeURIComponent(sel.projectDir)}&id=${encodeURIComponent(sel.sessionId)}`);
      if (state.route.name !== 'claude') return;
      if (!state.claude.selected || state.claude.selected.sessionId !== sel.sessionId) return;
      state.claude.detail = detail;
      renderClaudePane();
    } catch (err) {
      toast(err.message, 'bad');
      state.claude.detail = null;
      renderClaudePane();
    }
  }

  /* ================================================================ */
  /* 工作笔记                                                          */
  /* ================================================================ */

  function sortedNotes() {
    return state.notes.list.slice().sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
  }

  function noteItem(note) {
    const active = note.id === state.notes.selectedId;
    const preview = (note.content || '').replace(/[#*`>\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    return `
      <button class="session-item note-item${active ? ' active' : ''}" data-note="${esc(note.id)}">
        <div class="session-top">
          <span class="session-title">
            ${note.pinned ? `<span class="pin-mark">${icon('pin')}</span>` : ''}
            ${esc(note.title || '无标题笔记')}
          </span>
          <span class="session-time">${esc(fmtTime(note.updatedAt))}</span>
        </div>
        <div class="session-sub"><span>${esc(truncate(preview, 54) || '空笔记')}</span></div>
        ${(note.tags || []).length ? `<div class="session-stats">${note.tags.map((t) => `<span class="badge neutral">${esc(t)}</span>`).join('')}</div>` : ''}
      </button>`;
  }

  function currentNote() {
    return state.notes.list.find((n) => n.id === state.notes.selectedId) || null;
  }

  function setDirty(dirty) {
    state.notes.dirty = dirty;
    const el = $('.save-status', viewport);
    if (!el) return;
    el.classList.toggle('dirty', dirty);
    el.innerHTML = dirty
      ? `${icon('clock')}未保存 · Ctrl + S`
      : `${icon('check')}已保存`;
  }

  function renderNotes() {
    const list = sortedNotes();
    const note = currentNote();

    const listHtml = list.length
      ? list.map(noteItem).join('')
      : emptyState({
        icon: 'note',
        title: '还没有笔记',
        text: '建一条笔记记下常用命令、待办和踩坑经验，Ctrl + S 保存。',
        actions: `<button class="btn primary small" data-action="new-note">${icon('plus')}新建笔记</button>`,
      });

    let detailHtml;
    if (!note) {
      detailHtml = `<div class="detail-pane"><div class="tab-body" style="display:flex;align-items:center;justify-content:center">${emptyState({
        icon: 'note',
        title: '选一条笔记，或新建一条',
        text: '左边是全部笔记，置顶的排在最上面。右侧编辑区左边写 Markdown，右边实时预览。',
        actions: `<button class="btn primary small" data-action="new-note">${icon('plus')}新建笔记</button>`,
      })}</div></div>`;
    } else {
      detailHtml = `
        <div class="detail-pane">
          <div class="note-editor">
            <div class="note-head">
              <input class="note-title-input" data-note-title placeholder="无标题笔记" value="${esc(note.title || '')}">
              <div class="note-meta-row">
                <input class="input tag-input" data-note-tags placeholder="标签，用逗号分隔" value="${esc((note.tags || []).join(', '))}">
                <button class="icon-btn ${note.pinned ? 'on' : ''}" data-action="toggle-pin" data-id="${esc(note.id)}" title="${note.pinned ? '取消置顶' : '置顶'}">${icon('pin')}</button>
                <button class="icon-btn" data-action="toggle-preview" title="显示 / 隐藏预览">${icon('eye')}</button>
                <button class="btn ghost small" data-action="save-note" data-id="${esc(note.id)}">${icon('save')}保存</button>
                <button class="icon-btn danger" data-action="delete-note" data-id="${esc(note.id)}" title="删除笔记">${icon('trash')}</button>
                <span class="save-status${state.notes.dirty ? ' dirty' : ''}">${state.notes.dirty ? `${icon('clock')}未保存 · Ctrl + S` : `${icon('check')}已保存`}</span>
              </div>
              <div class="card-sub" style="margin-top:8px">
                创建 ${esc(fmtFull(note.createdAt))} · 更新 ${esc(fmtRel(note.updatedAt))}
              </div>
            </div>
            <div class="editor-grid${state.notes.preview ? '' : ' preview-hidden'}">
              <textarea class="note-textarea" data-note-body placeholder="# 标题&#10;&#10;写点什么… 支持 Markdown，Ctrl + S 保存">${esc(note.content || '')}</textarea>
              <div class="note-preview md${state.notes.preview ? '' : ' hidden'}" data-note-preview>${previewHtml(note.content)}</div>
            </div>
          </div>
        </div>`;
    }

    viewport.innerHTML = `
      <div class="view">
        <div class="split">
          <div class="pane">
            <div class="pane-head">
              <div class="search-mini">
                ${icon('search')}
                <input class="input" data-note-filter placeholder="筛选笔记…" value="${esc(state.notes.filter || '')}">
              </div>
              <div class="pane-tools">
                <button class="btn ghost small" data-action="new-note">${icon('plus')}新建</button>
                <button class="icon-btn" data-action="refresh-notes" title="刷新">${icon('refresh')}</button>
              </div>
              <div class="pane-title-row"><span>笔记</span><span class="count">${num(list.length)}</span></div>
            </div>
            <div class="pane-body" id="note-list">${listHtml}</div>
          </div>
          ${detailHtml}
        </div>
      </div>`;

    const filterInput = $('[data-note-filter]', viewport);
    if (filterInput) filterInput.addEventListener('input', (e) => {
      state.notes.filter = e.target.value;
      applyNoteFilter();
    });
    applyNoteFilter();

    const body = $('[data-note-body]', viewport);
    if (body) {
      body.addEventListener('input', () => {
        const note2 = currentNote();
        if (!note2) return;
        note2.content = body.value;
        updatePreview();
        setDirty(true);
      });
      body.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          saveCurrentNote();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = body.selectionStart;
          const end = body.selectionEnd;
          body.value = body.value.slice(0, start) + '  ' + body.value.slice(end);
          body.selectionStart = body.selectionEnd = start + 2;
          body.dispatchEvent(new Event('input'));
        }
      });
    }

    const titleInput = $('[data-note-title]', viewport);
    if (titleInput) {
      titleInput.addEventListener('input', () => {
        const note2 = currentNote();
        if (!note2) return;
        note2.title = titleInput.value;
        setDirty(true);
        const item = $(`[data-note="${CSS.escape(note2.id)}"] .session-title`, viewport);
        if (item) item.innerHTML = `${note2.pinned ? `<span class="pin-mark">${icon('pin')}</span>` : ''}${esc(note2.title || '无标题笔记')}`;
      });
      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveCurrentNote(); }
      });
    }

    const tagInput = $('[data-note-tags]', viewport);
    if (tagInput) {
      tagInput.addEventListener('input', () => {
        const note2 = currentNote();
        if (!note2) return;
        note2.tags = tagInput.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        setDirty(true);
      });
    }
  }

  function applyNoteFilter() {
    const needle = (state.notes.filter || '').trim().toLowerCase();
    $$('#note-list .session-item', viewport).forEach((item) => {
      const hit = !needle || item.textContent.toLowerCase().includes(needle);
      item.style.display = hit ? '' : 'none';
    });
  }

  function previewHtml(content) {
    const html = md(content);
    if (!html.trim()) return '<span class="preview-placeholder">左边开始写，这里实时预览</span>';
    return html;
  }

  function updatePreview() {
    const note = currentNote();
    const el = $('[data-note-preview]', viewport);
    if (!el || !note) return;
    el.innerHTML = previewHtml(note.content);
  }

  async function loadNotes() {
    const data = await api('/api/notes');
    state.notes.list = data.notes || [];
    setCount('notes', state.notes.list.length);
  }

  async function saveCurrentNote({ silent } = {}) {
    const note = currentNote();
    if (!note) return;
    try {
      const res = await api(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: 'PUT',
        body: { title: note.title, content: note.content, tags: note.tags || [], pinned: Boolean(note.pinned) },
      });
      if (res && res.note) {
        const index = state.notes.list.findIndex((n) => n.id === note.id);
        if (index !== -1) state.notes.list[index] = res.note;
      }
      setDirty(false);
      if (!silent) toast('笔记已保存', 'good');
      const pane = $('#note-list', viewport);
      if (pane && state.route.name === 'notes') {
        pane.innerHTML = sortedNotes().map(noteItem).join('');
        applyNoteFilter();
      }
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function renderNotesView(arg) {
    viewport.innerHTML = `<div class="view"><div class="split"><div class="pane"><div class="pane-body">${loadingState('正在读取笔记…')}</div></div><div class="detail-pane"></div></div></div>`;
    try {
      await loadNotes();
    } catch (err) {
      viewport.innerHTML = `<div class="view">${emptyState({
        icon: 'note',
        title: '读不到笔记文件',
        text: `${esc(err.message)}（数据文件：<code>F:\\cl\\data\\notes.json</code>）`,
        actions: `<button class="btn ghost" data-action="retry">${icon('refresh')}重试</button>`,
      })}</div>`;
      return;
    }
    if (state.route.name !== 'notes') return;

    if (arg) state.notes.selectedId = arg;
    else if (!state.notes.list.some((n) => n.id === state.notes.selectedId)) {
      state.notes.selectedId = sortedNotes()[0]?.id || null;
    }
    state.notes.dirty = false;
    renderNotes();
  }

  async function createNote(body = {}) {
    try {
      const res = await api('/api/notes', {
        method: 'POST',
        body: { title: body.title || '无标题笔记', content: body.content || '', tags: body.tags || [], pinned: false },
      });
      await loadNotes();
      state.notes.selectedId = res.note.id;
      state.notes.dirty = false;
      if (state.route.name === 'notes') renderNotes();
      else go(`#/notes/${encodeURIComponent(res.note.id)}`);
      if (!body.silent) {
        toast('已新建笔记', 'good');
        setTimeout(() => $('[data-note-title]', viewport)?.focus(), 60);
      }
      return res.note;
    } catch (err) {
      toast(err.message, 'bad');
      return null;
    }
  }

  /* ================================================================ */
  /* 全局搜索                                                          */
  /* ================================================================ */

  function resultRow({ iconName, title, titleMono, subs = [], snippet, snippetMono, attrs = {} }) {
    const attrText = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    return `
      <a class="result-row" ${attrText}>
        <span class="result-icon">${icon(iconName)}</span>
        <span class="result-main">
          <span class="result-title${titleMono ? ' mono' : ''}">${title}</span>
          ${subs.length ? `<span class="result-sub">${subs.map((s) => `<span>${s}</span>`).join('')}</span>` : ''}
          ${snippet ? `<span class="result-snippet${snippetMono ? ' mono' : ''}">${snippet}</span>` : ''}
        </span>
      </a>`;
  }

  function renderSearch(arg) {
    const s = state.search;
    // 支持 #/search/关键词，搜索结果是可直接收藏的链接
    if (arg && arg !== s.query) {
      s.query = arg;
      s.results = null;
    }
    let resultsHtml = '';

    if (s.loading) {
      resultsHtml = `<div class="card result-group">${loadingState('正在搜索本地记录…')}</div>`;
    } else if (!s.query.trim()) {
      resultsHtml = searchPlaceholderHtml();
    } else if (s.results) {
      resultsHtml = searchResultsHtmlOnly();
    }

    viewport.innerHTML = `
      <div class="view">
        <div class="search-shell">
          <div class="search-big">
            ${icon('search')}
            <input class="input" data-search-input placeholder="搜索命令、输出、笔记、对话…" value="${esc(s.query)}" autocomplete="off" spellcheck="false">
          </div>
          <div class="search-hint">
            <span><kbd>Ctrl</kbd><kbd>K</kbd> 随时回到这里</span>
            <span><kbd>Esc</kbd> 清空</span>
            <span>结果全部来自本地磁盘</span>
          </div>
          <div data-search-results>${resultsHtml}</div>
        </div>
      </div>`;

    const input = $('[data-search-input]', viewport);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', (e) => {
      state.search.query = e.target.value;
      state.search.results = null;
      syncSearchHash();
      scheduleSearch();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        state.search.query = '';
        state.search.results = null;
        syncSearchHash();
        input.value = '';
        renderSearchResults();
      }
    });

    // 带着关键词进来（收藏链接 / 刷新）时自动搜一次
    if (s.query.trim() && !s.results && !s.loading) {
      s.loading = true;
      renderSearchResults();
      runSearch();
    }
  }

  function syncSearchHash() {
    const q = state.search.query.trim();
    history.replaceState(null, '', q ? `#/search/${encodeURIComponent(q)}` : '#/search');
  }

  function scheduleSearch() {
    clearTimeout(state.searchTimer);
    if (!state.search.query.trim()) {
      state.search.results = null;
      renderSearchResults();
      return;
    }
    state.search.loading = true;
    renderSearchResults();
    state.searchTimer = setTimeout(runSearch, 220);
  }

  const searchPlaceholderHtml = () => `<div class="card search-empty">${emptyState({
    icon: 'search',
    title: '搜点什么',
    text: '命令、输出日志、笔记内容、AI 对话全文都能搜。全部在本地完成，不联网。',
  })}</div>`;

  /* 只换结果区，输入框与焦点不动 */
  function renderSearchResults() {
    const holder = $('[data-search-results]', viewport);
    if (!holder) return;
    const s = state.search;
    if (!s.query.trim()) holder.innerHTML = searchPlaceholderHtml();
    else if (s.loading || !s.results) holder.innerHTML = `<div class="card result-group">${loadingState('正在搜索…')}</div>`;
    else holder.innerHTML = searchResultsHtmlOnly();
  }

  async function runSearch() {
    const query = state.search.query.trim();
    if (!query) return;
    try {
      const results = await api(`/api/search?q=${encodeURIComponent(query.slice(0, 100))}`);
      if (state.route.name !== 'search' || state.search.query.trim() !== query) return;
      state.search.results = results;
      state.search.loading = false;
      renderSearchResults();
    } catch (err) {
      state.search.loading = false;
      renderSearchResults();
      toast(err.message, 'bad');
    }
  }

  function searchResultsHtmlOnly() {
    const s = state.search;
    const r = s.results;
    if (!r) return '';
    const groups = [];

    if (r.commands.length) {
      groups.push(`
        <section class="card result-group">
          <div class="result-group-head">${icon('terminal')}命令<span class="n">${num(r.commands.length)}</span></div>
          ${r.commands.map((c) => resultRow({
            iconName: 'terminal',
            title: highlight(c.cmd, s.query),
            titleMono: true,
            subs: [esc(c.sessionTitle), esc(fmtTime(c.ts)), c.cwd ? `<code>${esc(truncate(c.cwd, 40))}</code>` : ''].filter(Boolean),
            attrs: { 'data-open-terminal-session': c.sessionId },
          })).join('')}
        </section>`);
    }

    if (r.outputs.length) {
      groups.push(`
        <section class="card result-group">
          <div class="result-group-head">${icon('layers')}输出日志<span class="n">${num(r.outputs.length)}</span></div>
          ${r.outputs.map((o) => resultRow({
            iconName: 'layers',
            title: esc(o.sessionTitle),
            subs: [esc(fmtTime(o.ts))],
            snippet: highlight(o.snippet, s.query),
            snippetMono: true,
            attrs: { 'data-open-terminal-session': o.sessionId },
          })).join('')}
        </section>`);
    }

    if (r.notes.length) {
      groups.push(`
        <section class="card result-group">
          <div class="result-group-head">${icon('note')}笔记<span class="n">${num(r.notes.length)}</span></div>
          ${r.notes.map((n) => resultRow({
            iconName: 'note',
            title: highlight(n.title, s.query),
            subs: [esc(fmtTime(n.updatedAt)), ...(n.tags || []).map((t) => `<span class="badge neutral">${esc(t)}</span>`)],
            snippet: highlight(n.snippet, s.query),
            attrs: { 'data-open-note': n.id },
          })).join('')}
        </section>`);
    }

    if (r.claude.length) {
      groups.push(`
        <section class="card result-group">
          <div class="result-group-head">${icon('spark')}AI 对话<span class="n">${num(r.claude.length)}</span></div>
          ${r.claude.map((c) => resultRow({
            iconName: 'spark',
            title: highlight(c.title || '未命名对话', s.query),
            subs: [c.role === 'title' ? '标题命中' : c.role === 'user' ? '你的提问' : 'Claude 回复', esc(c.projectPath), esc(fmtTime(c.ts))],
            snippet: highlight(c.snippet, s.query),
            attrs: { 'data-open-claude': `${c.projectDir}|${c.sessionId}` },
          })).join('')}
        </section>`);
    }

    return groups.length
      ? `<div class="search-results">${groups.join('')}</div>`
      : `<div class="card search-empty">${emptyState({
        icon: 'search',
        title: `没有找到「${esc(s.query)}」`,
        text: '换个关键词试试，或者确认那段记录是不是还没被工作台采集到。',
      })}</div>`;
  }

  /* 结果行是 <a>，点击由全局委托处理（data-open-* 属性） */

  /* ================================================================ */
  /* 对话（实时调本机 claude）                                          */
  /* ================================================================ */

  function chatMode() {
    return state.chat.mode === 'readonly' ? 'readonly' : 'work';
  }

  /* 只把「上次是哪个会话」记在本地；对话内容本身以 Claude Code 存档为准 */
  function rememberChatSession(id) {
    try { if (id) localStorage.setItem('cl.chat.session', id); } catch {}
  }

  function forgetChatSession() {
    try { localStorage.removeItem('cl.chat.session'); } catch {}
  }

  async function restoreChatHistory() {
    const c = state.chat;
    if (c.running || c.restored || c.items.length) return;
    let saved = null;
    try { saved = localStorage.getItem('cl.chat.session'); } catch { /* 隐私模式 */ }
    c.restored = true;
    if (!saved) return;

    c.sessionId = saved;
    c.historyLoading = true;
    if (state.route.name === 'chat') renderChat();

    try {
      const data = await api(`/api/chat/history?id=${encodeURIComponent(saved)}`);
      if (state.route.name !== 'chat') return;
      const session = data && data.session;
      if (!session || !session.messages || !session.messages.length) {
        // 存档已经被清掉了，别让页面继续指着一个不存在的会话
        c.sessionId = null;
        forgetChatSession();
        c.historyLoading = false;
        renderChat();
        return;
      }
      c.items = session.messages.map((m) => ({
        role: m.role,
        text: m.text || '',
        tools: m.tools || [],
        ts: m.ts,
      }));
      c.historyLoading = false;
      renderChat();
      scrollChatToEnd();
    } catch {
      if (state.route.name === 'chat') {
        c.historyLoading = false;
        renderChat();
      }
    }
  }

  async function renderChatView() {
    renderChat();
    await restoreChatHistory();
  }

  function setChatMode(mode) {
    state.chat.mode = mode === 'readonly' ? 'readonly' : 'work';
    try { localStorage.setItem('cl.chat.mode', state.chat.mode); } catch {}
  }

  function chatMessageHtml(msg, streaming) {
    if (msg.role === 'system') {
      return `<details class="sys-msg"${msg.bad ? ' open' : ''}>
        <summary>${esc(msg.summary || '系统提示')}</summary>
        <div class="sys-content">${esc(msg.text || '')}</div>
      </details>`;
    }

    const isUser = msg.role === 'user';
    const tools = (msg.tools || []).map((t) => `
      <details class="tool-use">
        <summary>${icon('layers')}<span class="tool-name">${esc(t.name)}</span><span class="tool-hint">${esc(t.hint || '(无参数)')}</span></summary>
        <pre>${esc(t.hint || '(无参数)')}</pre>
      </details>`).join('');

    let body = '';
    if (msg.text) body = `<div class="msg-body md">${md(msg.text)}${streaming ? '<span class="chat-caret"></span>' : ''}</div>`;
    else if (streaming) body = `<div class="msg-body"><span class="chat-thinking">正在思考…</span></div>`;

    return `
      <div class="msg${isUser ? ' user' : ''}"${streaming ? ' data-streaming="1"' : ''}>
        <span class="avatar">${isUser ? '你' : 'AI'}</span>
        <div class="msg-main">
          <div class="msg-head">
            <span class="msg-role">${isUser ? '你' : 'Claude'}</span>
            <span class="msg-time">${esc(fmtTime(msg.ts))}</span>
          </div>
          ${body}
          ${tools}
          ${chatUsageHtml(msg)}
        </div>
      </div>`;
  }

  /* token 数是网关真实返回的；美元数只有价目表认识这个模型时才显示 */
  function chatUsageHtml(msg) {
    const u = msg.usage;
    if (!u) return '';
    return `
      <div class="chat-usage">
        <span title="这次请求新发过去的 token">输入 ${fmtTokens(u.input)}</span>
        <span class="cheap" title="命中缓存的部分，单价约为正常输入的一成——这是省钱的来源">缓存读 ${fmtTokens(u.cacheRead)}</span>
        ${u.cacheWrite ? `<span class="costly" title="写入缓存的部分，单价比正常输入还略高">缓存写 ${fmtTokens(u.cacheWrite)}</span>` : ''}
        <span title="模型生成的 token">输出 ${fmtTokens(u.output)}</span>
        ${typeof msg.ms === 'number' ? `<span class="dim">${(msg.ms / 1000).toFixed(1)}s</span>` : ''}
        ${typeof msg.cost === 'number' && msg.costBasis && msg.costBasis !== 'unknown'
          ? `<span class="dim" title="Claude Code 按 Anthropic 价目表估算">≈$${msg.cost.toFixed(4)}</span>`
          : ''}
      </div>`;
  }

  function scrollChatToEnd() {
    const el = $('#chat-scroll', viewport);
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderChat() {
    const c = state.chat;
    const mode = chatMode();
    const messages = c.items.map((m) => chatMessageHtml(m, m === c.streaming && c.running)).join('');

    const t = c.totals;
    const totalLine = t.calls > 0 ? `
      <div class="chat-usage chat-usage-total">
        <strong>本对话累计</strong>
        <span>输入 <b>${fmtTokens(t.input)}</b></span>
        <span class="cheap" title="单价约为正常输入的一成">缓存读 <b>${fmtTokens(t.cacheRead)}</b></span>
        ${t.cacheWrite ? `<span class="costly">缓存写 <b>${fmtTokens(t.cacheWrite)}</b></span>` : ''}
        <span>输出 <b>${fmtTokens(t.output)}</b></span>
        <span class="dim">${num(t.calls)} 次调用 · ${Math.round(t.ms / 1000)}s</span>
      </div>` : '';

    const body = c.historyLoading
      ? loadingState('正在从存档里接回上次的对话…')
      : c.items.length
        ? `<div class="msg-list">${messages}</div>`
        : emptyState({
          icon: 'message',
          title: '在这里直接和 Claude 说话',
          text: '消息发给本机的 Claude Code，回复流式显示。聊完的对话会写进 Claude Code 存档——刷新页面、关掉浏览器都还在，会自动接回来。',
        });

    viewport.innerHTML = `
      <div class="view">
        <div class="chat-shell">
          <div class="chat-scroll" id="chat-scroll">
            ${mode === 'work' ? `<div class="danger-banner">${icon('help')}
              <div><strong>当前是「能干活」模式。</strong>Claude 以 <code>bypassPermissions</code> 运行，<strong>可以不经确认就改这台机器上的文件、执行命令</strong>。不确定的时候切到「只读」。</div>
            </div>` : ''}
            ${body}
          </div>
          <div class="chat-composer">
            <textarea class="chat-input" data-chat-input placeholder="说点什么…（Ctrl + Enter 发送，Enter 换行）"${c.running ? ' disabled' : ''}>${esc(c.draft || '')}</textarea>
            <div class="chat-bar">
              <span class="chips">
                <button class="chip${mode === 'work' ? ' active' : ''}" data-action="chat-mode" data-mode="work">能干活</button>
                <button class="chip${mode === 'readonly' ? ' active' : ''}" data-action="chat-mode" data-mode="readonly">只读</button>
              </span>
              ${c.sessionId ? `<button class="btn ghost small" data-action="new-chat">${icon('plus')}新对话</button>` : ''}
              <span class="spacer"></span>
              ${c.running
                ? `<button class="btn danger small" data-action="stop-chat">${icon('x')}停止</button>`
                : `<button class="btn primary small" data-action="send-chat">${icon('play')}发送</button>`}
            </div>
            <div class="chat-hint" style="margin-top:7px">
              ${c.sessionId ? `会话 <code>${esc(c.sessionId.slice(0, 8))}</code>，后续消息会接上下文` : '还没开始对话'}
              ${c.costBasis === 'unknown' ? ' · 当前模型不在 Claude Code 价目表里，不显示美元估算，真实账单看网关控制台' : ''}
            </div>
            ${totalLine}
          </div>
        </div>
      </div>`;

    const input = $('[data-chat-input]', viewport);
    if (input) {
      input.addEventListener('input', () => { state.chat.draft = input.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          sendChat();
        }
      });
      if (!c.running) input.focus();
    }
    scrollChatToEnd();
  }

  /* 流式期间只换那一条消息，不整页重绘（否则输入框会失焦） */
  function updateChatStream() {
    const msg = state.chat.streaming;
    if (!msg) return;
    const node = $('[data-streaming]', viewport);
    if (!node) { renderChat(); return; }
    const holder = document.createElement('div');
    holder.innerHTML = chatMessageHtml(msg, true);
    const fresh = holder.firstElementChild;
    if (fresh) node.replaceWith(fresh);
    scrollChatToEnd();
  }

  function handleChatEvent(evt) {
    const c = state.chat;
    const streaming = c.streaming;
    switch (evt && evt.t) {
      case 'init':
        if (evt.sessionId) { c.sessionId = evt.sessionId; rememberChatSession(evt.sessionId); }
        if (evt.model) c.model = evt.model;
        break;
      case 'text':
        if (!streaming) break;
        streaming.text = streaming.text ? streaming.text + '\n\n' + evt.text : evt.text;
        updateChatStream();
        break;
      case 'tool':
        if (!streaming) break;
        streaming.tools.push({ name: evt.name, hint: evt.hint });
        updateChatStream();
        break;
      case 'result': {
        if (evt.sessionId) { c.sessionId = evt.sessionId; rememberChatSession(evt.sessionId); }
        if (evt.costBasis) c.costBasis = evt.costBasis;
        if (streaming) {
          if (typeof evt.ms === 'number') streaming.ms = evt.ms;
          if (typeof evt.cost === 'number') streaming.cost = evt.cost;
          if (evt.costBasis) streaming.costBasis = evt.costBasis;
          if (evt.usage) {
            streaming.usage = evt.usage;
            c.totals.input += evt.usage.input || 0;
            c.totals.cacheRead += evt.usage.cacheRead || 0;
            c.totals.cacheWrite += evt.usage.cacheWrite || 0;
            c.totals.output += evt.usage.output || 0;
            c.totals.calls += 1;
            c.totals.ms += typeof evt.ms === 'number' ? evt.ms : 0;
          }
        }
        break;
      }
      case 'stderr':
        c.items.push({ role: 'system', summary: '运行输出（stderr）', text: evt.text });
        break;
      case 'error':
        c.items.push({ role: 'system', summary: '出错了', text: evt.message, bad: true });
        break;
      default:
        break;
    }
  }

  async function sendChat() {
    const c = state.chat;
    if (c.running) return;
    const input = $('[data-chat-input]', viewport);
    const message = String((input ? input.value : c.draft) || '').trim();
    if (!message) {
      toast('先说点什么', 'bad');
      return;
    }

    c.items.push({ role: 'user', text: message, ts: new Date().toISOString() });
    c.streaming = { role: 'assistant', text: '', tools: [], ts: new Date().toISOString() };
    c.items.push(c.streaming);
    c.running = true;
    c.draft = '';
    renderChat();

    const controller = new AbortController();
    c.controller = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId: c.sessionId, mode: chatMode() }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let text = `请求失败（${res.status}）`;
        try {
          const data = await res.json();
          if (data && data.error) text = data.error;
        } catch { /* 非 JSON 响应 */ }
        throw new Error(text);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try { handleChatEvent(JSON.parse(line.slice(6))); } catch { /* 忽略坏行 */ }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        c.items.push({ role: 'system', summary: '已停止', text: '这次回答被你中断了。' });
      } else {
        c.items.push({ role: 'system', summary: '出错了', text: err.message, bad: true });
      }
    } finally {
      const streamed = c.streaming;
      if (streamed && !streamed.text.trim() && !streamed.tools.length) {
        const index = c.items.indexOf(streamed);
        if (index !== -1) c.items.splice(index, 1);
      }
      c.running = false;
      c.streaming = null;
      c.controller = null;
      if (state.route.name === 'chat') renderChat();
    }
  }

  async function stopChatRun() {
    const c = state.chat;
    try { await api('/api/chat/stop', { method: 'POST', body: {} }); } catch { /* 服务端可能已结束 */ }
    if (c.controller) c.controller.abort();
    toast('已停止');
  }

  /* ================================================================ */
  /* 视图调度                                                          */
  /* ================================================================ */

  const renderers = {
    overview: renderOverview,
    terminals: renderTerminals,
    claude: renderClaude,
    chat: renderChatView,
    notes: renderNotesView,
    search: renderSearch,
  };

  async function render({ preserveScroll } = {}) {
    const route = parseHash();
    const changed = route.name !== state.route.name || route.arg !== state.route.arg;
    state.route = route;
    setHead(route.name);
    stopPolling();
    if (changed) viewport.scrollTop = 0;
    void preserveScroll;
    await renderers[route.name](route.arg);
    startPolling();
  }

  /* 轮询：有录制中的会话时，自动刷新列表 */
  function startPolling() {
    if (state.route.name !== 'terminals' && state.route.name !== 'overview') return;
    state.poll = setInterval(async () => {
      if (document.hidden || modalRoot.children.length) return;
      if (state.route.name === 'terminals') {
        const before = state.terminals.sessions.map((s) => `${s.id}:${s.commandCount}:${s.updatedAt}`).join('|');
        const ok = await loadTerminals({ silent: true });
        const after = state.terminals.sessions.map((s) => `${s.id}:${s.commandCount}:${s.updatedAt}`).join('|');
        if (ok && before !== after) {
          renderTerminalPane();
          if (state.terminals.selectedId) await loadTerminalDetail(state.terminals.selectedId);
        }
      } else if (state.route.name === 'overview') {
        try {
          const data = await api('/api/overview');
          setNavCountsFromOverview(data);
        } catch { /* 轮询失败静默 */ }
      }
    }, 10000);
  }

  function stopPolling() {
    if (state.poll) {
      clearInterval(state.poll);
      state.poll = null;
    }
  }

  /* ================================================================ */
  /* 全局动作                                                          */
  /* ================================================================ */

  async function handleOpenTerminal() {
    try {
      const res = await api('/api/actions/open-terminal', { method: 'POST', body: {} });
      if (res && res.ok === false) throw new Error(res.error || '打开失败');
      toast('记录终端已启动，在那边干活就会实时落盘', 'good');
      if (state.route.name === 'terminals') {
        setTimeout(async () => {
          await loadTerminals({ silent: true });
          renderTerminalPane();
        }, 2500);
      }
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function handleOpenFolder() {
    try {
      const res = await api('/api/actions/open-folder', { method: 'POST', body: {} });
      if (res && res.ok === false) throw new Error(res.error || '打开失败');
      toast('已打开数据目录');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function handleImportPsreadline() {
    try {
      const res = await api('/api/terminals/import', { method: 'POST', body: {} });
      if (res && res.ok === false) {
        toast(res.error || '导入失败', 'bad');
        return;
      }
      if (res.unchanged) {
        toast(`历史没有变化，仍是 ${num(res.commandCount)} 条命令`);
      } else {
        toast(`已导入 ${num(res.commandCount)} 条 PowerShell 历史`, 'good');
      }
      await loadTerminals({ silent: true });
      if (state.route.name === 'terminals') {
        if (!state.terminals.selectedId && res.sessionId) {
          go(`#/terminals/${encodeURIComponent(res.sessionId)}`);
        } else {
          renderTerminalPane();
        }
      } else if (state.route.name === 'overview') {
        render();
      }
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function handleRenameTerminal(id) {
    const session = state.terminals.sessions.find((s) => s.id === id);
    openModal({
      title: '重命名会话',
      body: `
        <label class="modal-label" for="rename-input">给这个会话起个认得出来的名字</label>
        <input class="input" id="rename-input" value="${esc(session?.title || '')}" placeholder="例如：部署博客、整理素材…">`,
      foot: `
        <button class="btn ghost" data-modal-close>取消</button>
        <button class="btn primary" data-rename-save>保存</button>`,
      onMount(root) {
        const input = root.querySelector('#rename-input');
        input.focus();
        input.select();
        const save = async () => {
          const title = input.value.trim();
          try {
            await api(`/api/terminals/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } });
            closeModal();
            toast('已重命名', 'good');
            await loadTerminals({ silent: true });
            if (state.terminals.selectedId === id) {
              state.terminals.detail = await api(`/api/terminals/${encodeURIComponent(id)}`);
            }
            renderTerminalPane();
          } catch (err) {
            toast(err.message, 'bad');
          }
        };
        root.querySelector('[data-rename-save]').addEventListener('click', save);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
      },
    });
  }

  async function handleDeleteTerminal(id) {
    const ok = await confirmModal({
      title: '删除这个会话记录？',
      message: '命令记录、输出日志和元数据会一起从 F:\\cl\\data\\terminals 里删掉，不能撤销。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('已删除', 'good');
      state.terminals.selectedId = null;
      state.terminals.detail = null;
      await loadTerminals({ silent: true });
      go('#/terminals');
      renderTerminalPane();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function handleDeleteNote(id) {
    const note = state.notes.list.find((n) => n.id === id);
    const ok = await confirmModal({
      title: '删除这条笔记？',
      message: `「${note?.title || '无标题笔记'}」会被永久删除，不能撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('已删除', 'good');
      const index = state.notes.list.findIndex((n) => n.id === id);
      if (index !== -1) state.notes.list.splice(index, 1);
      state.notes.selectedId = sortedNotes()[0]?.id || null;
      setCount('notes', state.notes.list.length);
      renderNotes();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function openHelp() {
    openModal({
      title: '使用说明',
      width: 620,
      body: `
        <div class="help-section">
          <h4><span class="step">1</span>先开一个记录终端</h4>
          <p>点右上角「打开记录终端」，或双击 <code>F:\\cl\\打开记录终端.cmd</code>。以后干活都在这个窗口里做。</p>
          <ul>
            <li>每条命令执行完立刻追加写入 <code>data\\terminals\\&lt;会话&gt;.jsonl</code></li>
            <li>输出通过 Start-Transcript 持续写 <code>.log</code></li>
            <li>PowerShell 输入历史逐条保存，崩溃后上方向键仍在</li>
          </ul>
          <div class="help-actions">
            <button class="btn primary small" data-action="open-terminal">${icon('play')}打开记录终端</button>
          </div>
        </div>
        <div class="help-section">
          <h4><span class="step">2</span>回看历史</h4>
          <p>左侧「终端历史」按会话列出全部命令、成败状态和完整输出；「AI 对话」自动读取 Claude Code 存档，只读不改。</p>
        </div>
        <div class="help-section">
          <h4><span class="step">3</span>记点东西</h4>
          <p>「工作笔记」支持 Markdown 编辑与预览，<kbd>Ctrl</kbd> + <kbd>S</kbd> 保存；<kbd>Ctrl</kbd> + <kbd>K</kbd> 随时全局搜索。</p>
        </div>
        <div class="help-section">
          <h4><span class="step">4</span>防丢与备份</h4>
          <p>所有数据都在 <code>F:\\cl\\data</code>，备份时整个文件夹复制即可。窗口崩了最多丢最后一行命令。</p>
          <div class="help-actions">
            <button class="btn ghost small" data-action="open-folder">${icon('folder')}打开数据目录</button>
            <button class="btn ghost small" data-action="import-psreadline">${icon('arrow-up')}导入 PowerShell 历史</button>
          </div>
        </div>`,
    });
  }

  /* 事件委托 */
  document.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      switch (action) {
        case 'help': return openHelp();
        case 'open-terminal': return handleOpenTerminal();
        case 'open-folder': return handleOpenFolder();
        case 'import-psreadline': return handleImportPsreadline();
        case 'new-note': return createNote({ title: '无标题笔记', content: '' });
        case 'refresh-terminals':
          await loadTerminals({ silent: true });
          renderTerminalPane();
          if (state.terminals.selectedId) await loadTerminalDetail(state.terminals.selectedId);
          return;
        case 'rename-terminal': return handleRenameTerminal(actionEl.dataset.id);
        case 'delete-terminal': return handleDeleteTerminal(actionEl.dataset.id);
        case 'delete-note': return handleDeleteNote(actionEl.dataset.id);
        case 'copy-cmd': return copyText(actionEl.dataset.cmd, '命令已复制');
        case 'copy-claude-id': return copyText(actionEl.dataset.id, '会话 ID 已复制');
        case 'copy-terminal-cmds': {
          const detail = state.terminals.detail;
          const cmds = (detail?.events || []).filter((x) => x && x.type === 'cmd' && x.cmd).map((x) => x.cmd).join('\n');
          return copyText(cmds, `已复制 ${cmds ? cmds.split('\n').length : 0} 条命令`);
        }
        case 'save-note': return saveCurrentNote();
        case 'toggle-pin': {
          const note = state.notes.list.find((n) => n.id === actionEl.dataset.id);
          if (!note) return;
          note.pinned = !note.pinned;
          await saveCurrentNote({ silent: true });
          renderNotes();
          return;
        }
        case 'toggle-preview':
          state.notes.preview = !state.notes.preview;
          renderNotes();
          return;
        case 'refresh-notes':
          await loadNotes();
          renderNotes();
          return;
        case 'refresh-claude':
          try {
            await loadClaudeGroups();
            renderClaudePane();
            if (state.claude.selected) await loadClaudeSession(state.claude.selected);
          } catch (err) { toast(err.message, 'bad'); }
          return;
        case 'toggle-only-user':
          state.claude.onlyUser = !state.claude.onlyUser;
          renderClaudePane();
          return;
        case 'retry':
          return render();
        case 'send-chat': return sendChat();
        case 'stop-chat': return stopChatRun();
        case 'chat-mode':
          setChatMode(actionEl.dataset.mode);
          renderChat();
          return;
        case 'new-chat':
          state.chat.sessionId = null;
          state.chat.items = [];
          state.chat.streaming = null;
          state.chat.costBasis = null;
          state.chat.restored = true;
          state.chat.totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, ms: 0 };
          forgetChatSession();
          renderChat();
          return;
        default: break;
      }
    }

    const tabEl = e.target.closest('[data-tab]');
    if (tabEl && state.route.name === 'terminals') {
      state.terminals.tab = tabEl.dataset.tab;
      renderTerminalPane();
      return;
    }

    const termEl = e.target.closest('[data-terminal]');
    if (termEl) {
      e.preventDefault();
      go(`#/terminals/${encodeURIComponent(termEl.dataset.terminal)}`);
      return;
    }

    const termJump = e.target.closest('[data-open-terminal-session]');
    if (termJump) {
      e.preventDefault();
      go(`#/terminals/${encodeURIComponent(termJump.dataset.openTerminalSession)}`);
      return;
    }

    const claudeEl = e.target.closest('[data-claude-session]');
    if (claudeEl) {
      e.preventDefault();
      const [projectDir, sessionId] = claudeEl.dataset.claudeSession.split('|');
      go(`#/claude/${encodeURIComponent(projectDir)}/${encodeURIComponent(sessionId)}`);
      return;
    }

    const claudeJump = e.target.closest('[data-open-claude]');
    if (claudeJump) {
      e.preventDefault();
      const [projectDir, sessionId] = claudeJump.dataset.openClaude.split('|');
      go(`#/claude/${encodeURIComponent(projectDir)}/${encodeURIComponent(sessionId)}`);
      return;
    }

    const noteEl = e.target.closest('[data-note]');
    if (noteEl) {
      e.preventDefault();
      if (state.notes.dirty) await saveCurrentNote({ silent: true });
      go(`#/notes/${encodeURIComponent(noteEl.dataset.note)}`);
      return;
    }

    const noteJump = e.target.closest('[data-open-note]');
    if (noteJump) {
      e.preventDefault();
      go(`#/notes/${encodeURIComponent(noteJump.dataset.openNote)}`);
      return;
    }
  });

  /* 命令筛选输入框：用委托监听，避免每次重渲染重新绑定 */
  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-cmd-filter]')) {
      state.terminals.cmdFilter = e.target.value;
      const list = $('#cmd-list', viewport);
      const detail = state.terminals.detail;
      if (list && detail) {
        const events = (detail.events || []).filter((x) => x && x.type === 'cmd' && typeof x.cmd === 'string');
        list.innerHTML = cmdRows(events, detail.session.id);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'k') {
      e.preventDefault();
      if (state.route.name === 'search') {
        $('[data-search-input]', viewport)?.focus();
      } else {
        go('#/search');
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 's') {
      if (state.route.name === 'notes' && currentNote()) {
        e.preventDefault();
        saveCurrentNote();
      }
    }
  });

  window.addEventListener('hashchange', () => {
    if (state.route.name === 'notes' && state.notes.dirty) saveCurrentNote({ silent: true });
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (state.route.name === 'terminals' || state.route.name === 'overview')) {
      // 回到页面时立刻补一次数据
      if (state.route.name === 'terminals') {
        loadTerminals({ silent: true }).then(() => {
          if (state.route.name === 'terminals') {
            renderTerminalPane();
            if (state.terminals.selectedId) loadTerminalDetail(state.terminals.selectedId);
          }
        });
      }
    }
  });

  /* ================================================================ */
  /* 启动                                                              */
  /* ================================================================ */

  async function boot() {
    try {
      const saved = localStorage.getItem('cl.chat.mode');
      if (saved === 'readonly' || saved === 'work') state.chat.mode = saved;
    } catch { /* 隐私模式下读不到 */ }
    try {
      const data = await api('/api/overview');
      setNavCountsFromOverview(data);
    } catch { /* 首页自己会报错 */ }
    await render();
  }

  boot();
})();