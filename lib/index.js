// DSH × AI 娘桌宠
// ---------------------------------------------------------------------------
// 宿主侧插件：把 AI 娘桌宠的状态机、余额与消费记账接到 DSH 的会话事件上。
//
//   1. 余额：优先 DEEPSEEK_API_KEY（ctx.credentials），没有 key 时退回 DSH 账号登录态
//      （ctx.get('deepseekAccount')）。60 秒缓存，失败不污染上一次成功余额。
//   2. 消费：两条口径 ——
//        · 今日已用：余额「下降」的观测账本（accounting.mjs，和鲸鱼挂件同源）；
//        · 每轮消耗：assistant/message 的真实 usage × 峰谷单价，turn/end 结算。
//   3. 任务检测：session/event 里的 turn/start、tool/call、tool/result、approval/asked、
//      approval/decided、turn/end → 桌宠表情 + 气泡文案 + 提示音事件。
//   4. 前端：/dsh-widget-pet/widget.js（assets/claude-pet.js），画立绘、气泡、余额面板。
//
// 所有路由都只读、只允许本机回环访问；密钥永远不会下发给浏览器。
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  addMoney,
  sumMoney,
  beijingDay,
  dayOffset,
  observeBalance,
  balanceSummary,
  daySummary,
  accountingDays,
  preciseMoney,
} from './accounting.mjs'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const BUILD_VERSION = '2.1.3'
const PLUGIN_ID = 'dsh-widget-pet'
const ROUTE_BASE = '/dsh-widget-pet'

const LEDGER_FILE = path.join(DSH_HOME, '.dshcp-usage.json')
const ARCHIVE_FILE = path.join(DSH_HOME, '.dshcp-usage-archive.json')
const TURN_FILE = path.join(DSH_HOME, '.dshcp-turn.json')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL_MS = 60_000
const ACCOUNT_FALLBACK_MS = 5_000
const IDLE_AFTER_MS = 10 * 60 * 1000
const CELEBRATE_AFTER_MS = 3 * 60 * 1000

const CHARACTER_IDS = new Set(['chatgpt', 'claude', 'deepseek', 'gemini'])

// 状态 → 立绘（文件名与 claude-desk-pet 的 pet/sprites 一致）
const SPRITES = {
  thinking: 'thinking',
  tool: 'typing',
  reading: 'notes',
  waiting: 'waiting',
  celebrate: 'celebrate',
  idle: 'idle',
  error: 'error',
  aborted: 'aborted',
  stone: 'stone',
  question: 'question',
  approval: 'approval',
}

// 读资料类工具 → 记笔记表情；其余 → 敲键盘
const READING_TOOLS = new Set([
  'read', 'grep', 'glob', 'webfetch', 'web_fetch', 'websearch', 'web_search',
  'notebookread', 'notebook_read', 'session_query', 'skill', 'workspace_dependencies',
])

// DeepSeek 官方价目表（人民币 / 百万 token），[空闲, 高峰]。
// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing（2026-09-19 复核）
const PEAK_HOURS = [[9, 12], [14, 18]]
const BASE_PRICE = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }
const PRO_PRICE = { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] }
const PRICING = {
  'deepseek-flash': BASE_PRICE,
  'deepseek-v4-flash': BASE_PRICE,
  'deepseek-v4-flash-vision-exp': BASE_PRICE,
  'deepseek-v4-pro': PRO_PRICE,
  _default: BASE_PRICE,
}
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)
const HOLIDAY_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000)
const HOLIDAY_VALLEY = {
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1,
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, '2026-02-19': 1,
  '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1,
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1,
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1,
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1,
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function priceFor(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICING)) {
    if (key === '_default') continue
    if (m.indexOf(key) !== -1) return PRICING[key]
  }
  return PRICING._default
}

function isHolidayValley(bj) {
  try { return !!HOLIDAY_VALLEY[bj.toISOString().slice(0, 10)] } catch (err) { return false }
}

function isPeakTime(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return false
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay()
    if (dow === 0 || dow === 6) return false
  }
  if (n >= HOLIDAY_VALLEY_FROM_SEC && isHolidayValley(bj)) return false
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) if (hour >= start && hour < end) return true
  return false
}

function nextPeakChangeAt(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return null
  const cur = isPeakTime(n)
  const day0 = Math.floor((n + 8 * 3600) / 86400) * 86400
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const cand = day0 + d * 86400 + edge * 3600 - 8 * 3600
      if (cand <= n + 1) continue
      if (isPeakTime(cand) !== cur) return cand
    }
  }
  return null
}

function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''
}

function safeJson(text) {
  if (typeof text !== 'string' || !text.trim()) return {}
  try { return JSON.parse(text) } catch (err) { return {} }
}

// MCP 工具名形如 mcp__<服务名>__<工具名>；服务名有时是一串 UUID，直接显示不友好
function describeMcp(rawName) {
  const parts = String(rawName || '').split('__')
  const server = parts[1] || ''
  const toolName = parts.slice(2).join('__') || ''
  if (/browser|chrome|playwright|puppeteer/i.test(server)) return '在操作浏览器…'
  if (!server || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(server)) {
    return toolName ? `在用 ${toolName}…` : '在用扩展工具…'
  }
  return `在用 ${server}…`
}

// 工具名 + 参数 → 气泡里的一句话
function describeTool(name, args) {
  const raw = String(name || '')
  const tool = raw.toLowerCase()
  const a = args && typeof args === 'object' ? args : {}
  const file = baseName(a.file_path || a.path || a.file || a.target || a.notebook_path || '')
  if (tool === 'bash' || tool === 'pwsh' || tool === 'shell' || tool === 'terminal') return '在跑命令…'
  if (tool === 'edit' || tool === 'write' || tool === 'str_replace' || tool === 'str_replace_editor' || tool === 'apply_patch') {
    return file ? `在改 ${file}` : '在改文件…'
  }
  if (tool === 'read' || tool === 'notebook_read' || tool === 'notebookread') return file ? `在读 ${file}` : '在翻文件…'
  if (tool === 'grep' || tool === 'glob' || tool === 'search' || tool === 'fs_search') return '在找东西…'
  if (tool === 'web_search' || tool === 'websearch' || tool === 'web_fetch' || tool === 'webfetch') return '在上网查…'
  if (tool === 'subagent' || tool === 'agent' || tool === 'workflow' || tool === 'task') return '派小助手干活中…'
  if (tool === 'todo' || tool === 'todo_write' || tool === 'goal') return '在列计划…'
  if (tool === 'working_directory') return '在切目录…'
  if (tool === 'present') return '在展示结果…'
  if (tool === 'schedule' || tool === 'job' || tool === 'jobs') return '在安排后台任务…'
  if (tool === 'ask_user_question') return '在问你…'
  if (tool.startsWith('mcp__')) return describeMcp(raw)
  return `在用 ${raw || '工具'}…`
}

function reasonKind(reason) {
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object') return String(reason.kind || reason.type || '')
  return ''
}

function readTurnSeq() {
  try {
    const j = JSON.parse(fs.readFileSync(TURN_FILE, 'utf8'))
    if (j && Number.isFinite(Number(j.seq)) && Number(j.seq) >= 0) return Number(j.seq)
  } catch (err) {}
  return 0
}

function writeTurnSeq(seq) {
  try {
    fs.mkdirSync(path.dirname(TURN_FILE), { recursive: true })
    fs.writeFileSync(TURN_FILE, JSON.stringify({ seq, updatedAt: new Date().toISOString() }), 'utf8')
  } catch (err) {}
}

// Windows 索引器可能短暂占用刚写完的文件；读账本遇到共享冲突重试，
// 但绝不把「读不出来」当成「空账本」。
function ledgerIo(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return operation() } catch (err) {
      if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
    }
  }
}

function freshLedger() {
  return { date: beijingDay(), lastBalance: null, todayUsage: 0, history: {}, events: [] }
}

function ledgerBackupCorrupt(why) {
  try {
    const bak = LEDGER_FILE + '.corrupt-' + Date.now() + '.bak'
    ledgerIo(() => fs.renameSync(LEDGER_FILE, bak))
    console.error(`[${PLUGIN_ID}] 账本损坏（${why}）→ 已备份为 ${bak}，并用默认结构重建`)
  } catch (err) {}
}

function readLedger() {
  let raw
  try {
    raw = ledgerIo(() => fs.readFileSync(LEDGER_FILE, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return freshLedger()
    ledgerBackupCorrupt(err.code || 'read-error')
    return freshLedger()
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.date === 'string') return parsed
    ledgerBackupCorrupt('bad-structure')
    return freshLedger()
  } catch (err) {
    ledgerBackupCorrupt('bad-json')
    return freshLedger()
  }
}

function writeLedger(led) {
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true })
    const temp = LEDGER_FILE + '.tmp-' + process.pid
    ledgerIo(() => fs.writeFileSync(temp, JSON.stringify(led), 'utf8'))
    ledgerIo(() => fs.renameSync(temp, LEDGER_FILE))
    return true
  } catch (err) {
    console.error(`[${PLUGIN_ID}] 账本保存失败：`, err.code || err.message)
    return false
  }
}

function readArchive() {
  try {
    const j = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'))
    if (j && typeof j === 'object') return j
  } catch (err) {}
  return { version: 1, events: [], history: {} }
}

// events 保留 90 天 / 2 万条，history 保留 365 天；超期部分归档，不直接丢。
function pruneLedger(led) {
  try {
    const events = Array.isArray(led.events) ? led.events : []
    const history = led.history && typeof led.history === 'object' ? led.history : {}
    const cut90 = dayOffset(beijingDay(), -90)
    const cut365 = dayOffset(beijingDay(), -365)
    const keep = []
    const drop = []
    for (const ev of events) {
      const day = String((ev && ev.day) || '')
      if (day && day < cut90) drop.push(ev)
      else keep.push(ev)
    }
    if (keep.length > 20000) drop.push(...keep.splice(0, keep.length - 20000))
    const droppedHistory = {}
    for (const day of Object.keys(history)) {
      if (String(day) < cut365) {
        droppedHistory[day] = history[day]
        delete history[day]
      }
    }
    if (!drop.length && !Object.keys(droppedHistory).length) return false
    const archive = readArchive()
    archive.events = Array.isArray(archive.events) ? archive.events : []
    archive.events.push(...drop)
    if (archive.events.length > 200000) archive.events.splice(0, archive.events.length - 200000)
    archive.history = Object.assign({}, archive.history || {}, droppedHistory)
    archive.updatedAt = new Date().toISOString()
    try { fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive), 'utf8') } catch (err) { return false }
    led.events = keep
    led.history = history
    return true
  } catch (err) { return false }
}

export default {
  name: 'dsh-widget-pet',

  // 注入行必须在 apply() 的第一时间注册：桌面端的注入表是宿主启动时一次性收集的，
  // 晚于那次收集，挂件就永远进不了页面（鲸鱼挂件 0.4.2 的 #152/#153 教训）。
  apply(root) {
    const earlyDisposers = []
    root.effect(() => () => {
      for (const d of earlyDisposers) { try { d() } catch (err) {} }
    })

    const WIDGET_LOADER =
      '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
      'var s=document.createElement("script");s.src="' + ROUTE_BASE + '/widget.js";' +
      's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

    earlyDisposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (!row) continue
          if (row.kind === 'script-src' && row.src === ROUTE_BASE + '/widget.js') return
          if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(ROUTE_BASE + '/widget.js') >= 0) return
        }
        table.push({ kind: 'script', placement: 'body', text: WIDGET_LOADER })
      } catch (err) {}
    }))

    root.inject(['webServer', 'credentials', 'connection'], (ctx) => {
      const disposers = []
      ctx.effect(() => () => {
        for (const d of disposers) { try { d() } catch (err) {} }
      })

      // ---------------------------------------------------------------- 安全栅栏
      // 只读路由同样需要防 DNS rebinding / 跨站读取：余额与用量属于账号信息。
      function isLoopbackHostname(hostname) {
        const h = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
        if (!h) return false
        if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
        const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
        return !!m && Number(m[1]) === 127 && [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
      }

      function connectionFence() {
        try {
          const conn = ctx.get('connection') || ctx.connection
          return conn && typeof conn.requestRejection === 'function' ? conn : null
        } catch (err) { return null }
      }

      function rejection(req) {
        try {
          const headers = (req && req.headers) || {}
          let url
          try { url = new URL('http://' + String(headers.host || '')) } catch (err) { return 403 }
          if (!isLoopbackHostname(url.hostname)) return 403
          const site = String(headers['sec-fetch-site'] || '').toLowerCase()
          if (site === 'cross-site') return 403
          const origin = headers.origin
          if (typeof origin === 'string' && origin && origin !== 'null') {
            let originUrl
            try { originUrl = new URL(origin) } catch (err) { return 403 }
            if (originUrl.host.toLowerCase() !== url.host.toLowerCase()) {
              // 桌面壳的页面源是 dsh-app://app；字体等 CORS 资源会带这个 Origin，
              // Host 仍是本机回环。只放行这两个应用内协议，不放开普通跨站来源。
              const scheme = originUrl.protocol
              if (scheme !== 'dsh-app:' && scheme !== 'app:') return 403
            }
          }
          const conn = connectionFence()
          if (!conn) return null
          let code
          try { code = conn.requestRejection(req) } catch (err) { return 403 }
          if (code === undefined || code === null || code === false) return null
          return typeof code === 'number' ? code : 403
        } catch (err) { return 403 }
      }

      function register(route) {
        const inner = route.handler
        return ctx.webServer.register(Object.assign({}, route, {
          handler: async (req, res) => {
            const code = rejection(req)
            if (code !== null) {
              try { res.writeHead(code); res.end() } catch (err) {}
              return
            }
            return inner(req, res)
          },
        }))
      }

      function sendJson(res, body, status = 200) {
        try {
          res.writeHead(status, JSON_HEADERS)
          res.end(JSON.stringify(body))
        } catch (err) {}
      }

      // ------------------------------------------------------------ 桌宠状态机
      const pet = {
        state: 'waiting',
        text: '我来啦～',
        rawText: '我来啦～',
        project: '',
        sessionId: null,
        sessionName: '',
        since: Date.now(),
        lastActivityAt: Date.now(),
        toolErrors: 0,
        turnStartedAt: null,
        pending: null, // { kind:'question'|'approval', id, toolName, since, sessionId }
        lastTurn: null, // { seq, turn, amount, tokens, ts, model, byModel }
        lastModel: '',
        event: { seq: 0, kind: '', ts: 0 },
        lastTurnSeq: readTurnSeq(),
      }
      // 事件序号从已持久化的轮次序号起步：宿主重启后前端不会把新事件当成旧事件。
      pet.event.seq = pet.lastTurnSeq

      const turnAggs = new Map() // sessionId -> { turn, cost, tokens, byModel, byModelTokens, lastTs, startedAt }
      const subagentSessions = new Set()

      function touch() {
        pet.lastActivityAt = Date.now()
      }

      function setPet(state, text, rawText) {
        pet.state = state
        pet.text = text
        pet.rawText = rawText === undefined ? text : rawText
        pet.since = Date.now()
        touch()
      }

      function fireEvent(kind) {
        pet.event = { seq: pet.event.seq + 1, kind, ts: Date.now() }
      }

      function clearPending() {
        pet.pending = null
      }

      function isSubagent(sessionId) {
        return subagentSessions.has(String(sessionId || ''))
      }

      // 汇总本轮真实 usage → 金额（人民币）
      function handleAssistantMessage(sessionId, data, eventTime) {
        const turn = Number(data.turn)
        const usage = data.usage
        if (!usage || typeof usage !== 'object' || !Number.isFinite(turn)) return
        const input = Number(usage.inputTokens ?? usage.input_tokens) || 0
        const cache = Number(usage.cacheReadTokens ?? usage.cache_read_input_tokens ?? usage.cache_read_tokens) || 0
        const output = Number(usage.outputTokens ?? usage.output_tokens) || 0
        const tokens = input + cache + output
        let agg = turnAggs.get(sessionId)
        if (!agg || agg.turn !== turn) {
          if (agg) finalizeTurn(sessionId)
          agg = { turn, cost: 0, tokens: 0, byModel: {}, byModelTokens: {}, lastTs: Date.now(), startedAt: Date.now() }
          turnAggs.set(sessionId, agg)
        }
        const model = String((data.message && data.message.source && data.message.source.model) || '')
        if (model && !isSubagent(sessionId)) pet.lastModel = model
        const at = Number(eventTime) || Date.now()
        const p = priceFor(model)
        const off = isPeakTime(Math.floor(at / 1000)) ? 1 : 0
        const cost = (cache / 1e6) * p.hit[off] + (input / 1e6) * p.miss[off] + (output / 1e6) * p.out[off]
        agg.cost = addMoney(agg.cost, cost)
        agg.tokens += tokens
        agg.lastTs = at
        if (model) {
          agg.byModel[model] = addMoney(agg.byModel[model] || 0, cost)
          agg.byModelTokens[model] = (agg.byModelTokens[model] || 0) + tokens
        }
      }

      function appendUsageEvent(ev) {
        const led = readLedger()
        led.events = Array.isArray(led.events) ? led.events : []
        led.events.push({
          ts: Number(ev.ts) || Date.now(),
          day: beijingDay(Number(ev.ts) || Date.now()),
          model: String(ev.model || '未知'),
          cost: preciseMoney(Number(ev.cost) || 0),
          tokens: Math.round(Number(ev.tokens) || 0),
        })
        pruneLedger(led)
        writeLedger(led)
        ledgerSummaryCache = null
      }

      function finalizeTurn(sessionId) {
        const agg = turnAggs.get(sessionId)
        if (!agg || agg.cost <= 0) { turnAggs.delete(sessionId); return null }
        const models = Object.keys(agg.byModel)
        const model = models.length ? models.sort((a, b) => agg.byModel[b] - agg.byModel[a])[0] : '未知'
        const result = {
          turn: agg.turn,
          amount: preciseMoney(agg.cost),
          tokens: agg.tokens,
          ts: agg.lastTs,
          model,
          byModel: agg.byModel,
        }
        // 子智能体的消耗照常记，但不推进「最近一轮」的提示序号。
        if (!isSubagent(sessionId)) {
          pet.lastTurnSeq += 1
          writeTurnSeq(pet.lastTurnSeq)
          pet.lastTurn = { seq: pet.lastTurnSeq, ...result }
        }
        if (models.length) {
          for (const name of models) appendUsageEvent({ ts: agg.lastTs, model: name, cost: agg.byModel[name], tokens: agg.byModelTokens[name] || 0 })
        } else {
          appendUsageEvent({ ts: agg.lastTs, model: '未知', cost: agg.cost, tokens: agg.tokens })
        }
        turnAggs.delete(sessionId)
        return result
      }

      function noteTitle(session, data) {
        const t = String((data && data.title) || '').trim()
        if (t) pet.sessionName = t.slice(0, 80)
        if (session && typeof session === 'object') {
          const cwd = session.cwd || session.workspace
          if (cwd) pet.project = baseName(cwd)
          if (!pet.sessionName) {
            for (const key of ['name', 'title', 'label']) {
              const v = String(session[key] == null ? '' : session[key]).trim()
              if (v) { pet.sessionName = v.slice(0, 80); break }
            }
          }
        }
      }

      function handleSessionEvent(session, event) {
        const sid = String((session && session.id) || 'default')
        const type = String((event && event.type) || '')
        const data = (event && event.data) || {}
        if (!data || typeof data !== 'object') return

        // 子智能体的用量照常记账；但桌宠表情只跟随主会话。
        const sub = isSubagent(sid)

        if (type === 'session/title') { if (!sub) noteTitle(session, data); return }
        if (type === 'working-directory/change' && data.cwd) {
          if (!sub) pet.project = baseName(data.cwd)
          return
        }

        if (type === 'assistant/message') {
          handleAssistantMessage(sid, data, event.time)
          return
        }
        if (!sub && (type === 'tool/call' || type === 'tool/result' || type === 'turn/start' ||
            type === 'turn/end' || type === 'approval/asked' || type.indexOf('approval/') === 0)) {
          noteTitle(session, {})
        }
        if (sub) {
          if (type === 'turn/end') finalizeTurn(sid)
          return
        }

        if (type === 'turn/start') {
          pet.sessionId = sid
          pet.toolErrors = 0
          pet.turnStartedAt = Date.now()
          clearPending()
          setPet('thinking', '思考中')
          return
        }

        if (type === 'tool/call') {
          const name = String(data.name || data.toolName || '')
          const callId = String(data.callId || data.call_id || data.id || '')
          if (name === 'ask_user_question') {
            pet.pending = { kind: 'question', id: callId || 'q' + Date.now(), toolName: name, since: Date.now(), sessionId: sid }
            pet.state = 'question'
            pet.text = '等你回答…'
            pet.rawText = '等你回答…'
            pet.since = Date.now()
            touch()
            fireEvent('question')
            return
          }
          if (pet.pending && pet.pending.kind === 'question') clearPending()
          const args = safeJson(data.arguments)
          const reading = READING_TOOLS.has(name.toLowerCase())
          setPet(reading ? 'reading' : 'tool', describeTool(name, args), name)
          return
        }

        if (type === 'tool/result') {
          const msg = data.message || {}
          if (pet.pending && pet.pending.kind === 'question') {
            const callId = String(msg.toolCallId || msg.tool_call_id || msg.callId || '')
            if (!callId || !pet.pending.id || callId === pet.pending.id) clearPending()
          }
          const failed = msg.isError === true || data.isError === true
          if (failed) {
            pet.toolErrors += 1
            if (pet.toolErrors >= 3) setPet('stone', '石化了…')
            else setPet('error', '出错了…')
          } else {
            pet.toolErrors = 0
            setPet('thinking', '思考中')
          }
          return
        }

        if (type === 'approval/asked') {
          pet.pending = {
            kind: 'approval',
            id: String(data.id || 'a' + Date.now()),
            toolName: String(data.toolName || data.name || ''),
            since: Date.now(),
            sessionId: sid,
          }
          pet.state = 'approval'
          pet.text = '等你授权…'
          pet.rawText = '等你授权…'
          pet.since = Date.now()
          touch()
          fireEvent('approval')
          return
        }

        if (type.indexOf('approval/') === 0) {
          if (pet.pending && pet.pending.kind === 'approval') {
            const id = String(data.id || '')
            if (!id || id === pet.pending.id) {
              clearPending()
              // 授权已决定：在工具真正跑起来之前先回到「思考中」，不要一直挂着「等你授权」。
              setPet('thinking', '思考中')
            }
          }
          return
        }

        if (type === 'turn/end') {
          const settled = finalizeTurn(sid)
          const reason = reasonKind(data.reason)
          const duration = pet.turnStartedAt ? Date.now() - pet.turnStartedAt : 0
          pet.turnStartedAt = null
          clearPending()
          if (reason === 'aborted') {
            setPet('aborted', '被打断了…')
          } else if (reason === 'error' || reason === 'refusal') {
            setPet('error', '出错了，来看看？')
            fireEvent('error')
          } else if (duration > CELEBRATE_AFTER_MS) {
            setPet('celebrate', '搞定啦！轮到你～')
            fireEvent('done')
          } else {
            setPet('waiting', '轮到你啦！')
            fireEvent('done')
          }
          void settled
          return
        }
      }

      // ------------------------------------------------------------ 余额与记账
      let balanceCache = null // { at, payload }
      let balanceInFlight = null
      let lastBalanceResult = null
      let accountDiag = ''
      // 状态轮询每秒都会读一次「今日已用」；账本可能有上万条事件，
      // 用内存缓存挡住每秒的 JSON 解析，写入时再失效。
      let ledgerSummaryCache = null

      function pickBalanceInfo(infos) {
        if (!Array.isArray(infos) || !infos.length) return null
        const num = (x) => (x && x.total_balance !== undefined ? Number(x.total_balance) : NaN)
        return infos.find((x) => x && x.currency === 'CNY' && num(x) > 0) ||
          infos.find((x) => num(x) > 0) ||
          infos.find((x) => x && x.currency === 'CNY') ||
          infos[0]
      }

      async function fetchAccountBalance() {
        accountDiag = ''
        let account = null
        try { account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null } catch (err) { account = null }
        if (!account || typeof account.getBalance !== 'function') { accountDiag = '当前 DSH 没有账号服务'; return null }
        let accountId = null
        try {
          const state = typeof account.getState === 'function' ? account.getState() : null
          accountId = (state && (state.userId || (state.profile && state.profile.userId))) || null
        } catch (err) { accountId = null }

        let result
        try {
          result = await account.getBalance({
            version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
            locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          })
        } catch (err) {
          accountDiag = '账号余额接口调用失败: ' + String((err && err.message) || err).slice(0, 120)
          return null
        }
        if (!result) { accountDiag = '未登录 DeepSeek 账号（没有账号凭据）'; return null }
        if (result.status !== 'ready') { accountDiag = '账号余额接口未就绪（' + String(result.status || 'unknown') + '）'; return null }

        const accNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
        const normRaw = Array.isArray(result.value) ? result.value : []
        const bonusRaw = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
        const normWallets = normRaw.filter((w) => w && accNum(w.balance) !== null)
        const bonusWallets = bonusRaw.filter((w) => w && accNum(w.balance) !== null)
        const all = normWallets.concat(bonusWallets)
        if (!all.length) {
          accountDiag = normRaw.length || bonusRaw.length ? '钱包字段不可用' : '账号没有余额钱包'
          return null
        }
        const curOf = (w) => String((w && w.currency) || 'CNY').toUpperCase()
        const nonzero = all.filter((w) => Number(w.balance) > 0)
        const pick = nonzero.find((w) => curOf(w) === 'CNY') || nonzero[0] ||
          all.find((w) => curOf(w) === 'CNY') || all[0]
        const currency = curOf(pick)
        const sumOf = (list) => list.filter((w) => curOf(w) === currency && accNum(w.balance) !== null)
          .reduce((s, w) => s + Number(w.balance), 0)
        const recharge = sumOf(normWallets)
        const bonus = sumOf(bonusWallets)
        accountDiag = ''
        return {
          ok: true,
          totalBalance: Number((recharge + bonus).toFixed(6)),
          rechargeBalance: Number(recharge.toFixed(6)),
          bonusBalance: Number(bonus.toFixed(6)),
          currency,
          balanceSource: 'account',
          accountTag: createHash('sha256').update('dsh-account:' + (accountId === null ? 'default' : String(accountId))).digest('hex').slice(0, 24),
          updatedAt: new Date().toISOString(),
        }
      }

      async function accountFallback(keyErr) {
        let acc = null
        try {
          acc = await Promise.race([
            fetchAccountBalance(),
            new Promise((resolve) => setTimeout(() => { accountDiag = '账号余额请求超时'; resolve(null) }, ACCOUNT_FALLBACK_MS)),
          ])
        } catch (err) {
          acc = null
          accountDiag = accountDiag || ('账号余额异常: ' + String((err && err.message) || err).slice(0, 120))
        }
        if (acc) return acc
        const keyPart = keyErr
          ? 'API key 路：' + String(keyErr.error || keyErr.code || '失败').slice(0, 160)
          : '未配置 DEEPSEEK_API_KEY'
        return {
          ok: false,
          code: keyErr ? 'BOTH_FAILED' : 'NO_KEY',
          error: keyPart + '；账号登录路：' + (accountDiag || '拿不到余额'),
        }
      }

      async function fetchApiKeyBalance(cred) {
        let lastErr = null
        for (let attempt = 0; attempt < 2; attempt++) {
          let res
          try {
            res = await fetch(BALANCE_URL, {
              headers: { Authorization: 'Bearer ' + cred.value },
              signal: AbortSignal.timeout(8000),
            })
          } catch (err) {
            lastErr = err
            if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
            continue
          }
          if (!res.ok) {
            lastErr = new Error('HTTP ' + res.status)
            if (res.status < 500) break
            if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
            continue
          }
          let data
          try { data = await res.json() } catch (err) { return { ok: false, code: 'PARSE', error: '余额接口返回不是合法 JSON' } }
          const info = pickBalanceInfo(data && data.balance_infos)
          if (!info || info.total_balance === undefined || !Number.isFinite(Number(info.total_balance))) {
            return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常' }
          }
          const numOr = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null }
          return {
            ok: true,
            totalBalance: Number(info.total_balance),
            bonusBalance: numOr(info.granted_balance),
            rechargeBalance: numOr(info.topped_up_balance),
            accountTag: createHash('sha256').update(String(cred.value)).digest('hex').slice(0, 24),
            currency: String(info.currency || 'CNY'),
            balanceSource: 'apikey',
            updatedAt: new Date().toISOString(),
          }
        }
        const transient = !(lastErr && /^HTTP 4\d\d/.test(lastErr.message))
        return {
          ok: false,
          code: 'HTTP',
          transient,
          error: '余额接口请求失败: ' + String((lastErr && lastErr.message) || lastErr).slice(0, 200),
        }
      }

      async function fetchBalance() {
        let cred = null
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
            break
          } catch (err) {
            if (attempt === 0) { await new Promise((r) => setTimeout(r, 700)); continue }
            return await accountFallback({ code: 'NO_KEY', error: '凭据读取失败: ' + String((err && err.message) || err).slice(0, 160) })
          }
        }
        if (!cred) return await accountFallback(null)
        const viaKey = await fetchApiKeyBalance(cred)
        if (viaKey.ok) return viaKey
        return await accountFallback(viaKey)
      }

      function recordLedgerUsage(payload) {
        const led = readLedger()
        observeBalance(led, {
          balance: payload.totalBalance,
          currency: payload.currency || 'CNY',
          scope: payload.accountTag,
          at: Date.now(),
        })
        pruneLedger(led)
        ledgerSummaryCache = null
        if (!writeLedger(led)) throw new Error('账本保存失败，请检查 DSH 数据目录写入权限')
      }

      function ledgerSummary() {
        if (ledgerSummaryCache) return ledgerSummaryCache
        try {
          const led = readLedger()
          ledgerSummaryCache = daySummary(led, beijingDay())
          return ledgerSummaryCache
        } catch (err) {
          return null
        }
      }

      function publicBalance(payload) {
        const summary = ledgerSummary()
        const nowSec = Math.floor(Date.now() / 1000)
        return {
          ...payload,
          version: BUILD_VERSION,
          isPeak: isPeakTime(nowSec),
          peakNextChangeAt: nextPeakChangeAt(nowSec),
          todayUsage: summary ? summary.amount : 0,
          todayUsageCurrency: summary ? summary.currency : 'CNY',
          usageSource: summary ? summary.source : 'events',
          usageLabel: summary ? summary.label : '本地估算',
          accounting: summary,
        }
      }

      function getBalance(force = false) {
        const now = Date.now()
        if (!force && balanceCache && now - balanceCache.at < BALANCE_TTL_MS) {
          return Promise.resolve(publicBalance(balanceCache.payload))
        }
        if (balanceInFlight) return balanceInFlight
        balanceInFlight = fetchBalance()
          .then((payload) => {
            if (payload.ok) {
              let ledgerError = ''
              try { recordLedgerUsage(payload) } catch (err) { ledgerError = String((err && err.message) || err).slice(0, 160) }
              const visible = publicBalance(payload)
              balanceCache = { at: Date.now(), payload }
              lastBalanceResult = { ok: true, at: Date.now(), error: '', code: '' }
              return ledgerError ? { ...visible, ledgerError } : visible
            }
            lastBalanceResult = { ok: false, at: Date.now(), error: String(payload.error || ''), code: String(payload.code || '') }
            if (payload.transient && balanceCache) {
              return { ...publicBalance(balanceCache.payload), stale: true, error: payload.error }
            }
            return {
              ...payload,
              ...publicBalance({}),
              ok: false,
              error: payload.error,
              code: payload.code || 'ERROR',
            }
          })
          .catch((err) => {
            lastBalanceResult = { ok: false, at: Date.now(), error: String((err && err.message) || err).slice(0, 200), code: 'ERROR' }
            return {
              ...publicBalance({}),
              ok: false,
              code: 'ERROR',
              error: '余额服务异常: ' + String((err && err.message) || err).slice(0, 200),
            }
          })
          .finally(() => { balanceInFlight = null })
        return balanceInFlight
      }

      // ------------------------------------------------------------ 用量记录
      function usageRecords() {
        const led = readLedger()
        const events = Array.isArray(led.events) ? led.events : []
        const today = beijingDay()
        const dayAdd = (day, n) => dayOffset(day, n)

        function modelsFor(day) {
          const map = new Map()
          for (const ev of events) {
            if (ev.day !== day) continue
            const name = String(ev.model || '未知')
            map.set(name, addMoney(map.get(name) || 0, Number(ev.cost) || 0))
          }
          return Array.from(map, ([model, cost]) => ({ model, cost })).sort((a, b) => b.cost - a.cost)
        }
        function tokensFor(day) {
          let n = 0
          for (const ev of events) if (ev.day === day) n += Number(ev.tokens) || 0
          return n
        }
        function forDay(day) {
          const summary = daySummary(led, day)
          const models = modelsFor(day)
          return { ...summary, date: day, total: summary.amount, tokens: tokensFor(day), models }
        }

        const days7 = Array.from({ length: 7 }, (_, i) => forDay(dayAdd(today, -i)))
        const total7 = sumMoney(days7.map((d) => Number(d.total) || 0))
        const days = new Set([today, ...Object.keys(led.history || {}), ...accountingDays(led)])
        for (const ev of events) if (/^\d{4}-\d{2}-\d{2}$/.test(ev.day)) days.add(ev.day)

        const allModels = new Map()
        for (const ev of events) {
          const name = String(ev.model || '未知')
          allModels.set(name, addMoney(allModels.get(name) || 0, Number(ev.cost) || 0))
        }

        return {
          ok: true,
          today: forDay(today),
          days7,
          total7,
          all: {
            days: Array.from(days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().map(forDay),
            events: events.slice().sort((a, b) => b.ts - a.ts).slice(0, 500),
            models: Array.from(allModels, ([model, cost]) => ({ model, cost })).sort((a, b) => b.cost - a.cost),
          },
        }
      }

      // ------------------------------------------------------------ 状态快照
      function publicState() {
        let state = pet.state
        let text = pet.text
        // 等待超过 10 分钟 → 发呆
        if ((state === 'waiting' || state === 'question' || state === 'approval') &&
            pet.pending === null && Date.now() - pet.lastActivityAt > IDLE_AFTER_MS) {
          state = 'idle'
          text = '在发呆～ zZ'
        }
        if (pet.pending && pet.pending.kind === 'question') { state = 'question'; text = '等你回答…' }
        if (pet.pending && pet.pending.kind === 'approval') { state = 'approval'; text = '等你授权…' }

        let balance = null
        try {
          balance = balanceCache ? publicBalance(balanceCache.payload) : null
          if (!balance && lastBalanceResult && !lastBalanceResult.ok) {
            balance = { ...publicBalance({}), ok: false, code: lastBalanceResult.code, error: lastBalanceResult.error }
          }
        } catch (err) { balance = null }

        const nowSec = Math.floor(Date.now() / 1000)
        const isPeak = isPeakTime(nowSec)
        const model = pet.lastModel || 'deepseek-flash'
        const priceTable = priceFor(model)
        const priceIndex = isPeak ? 1 : 0
        const price = {
          model,
          currency: 'CNY',
          miss: priceTable.miss[priceIndex],
          hit: priceTable.hit[priceIndex],
          out: priceTable.out[priceIndex],
        }

        return {
          ok: true,
          version: BUILD_VERSION,
          isPeak,
          price,
          activity: {
            state,
            sprite: SPRITES[state] || SPRITES.waiting,
            text,
            rawText: pet.rawText,
            project: pet.project,
            sessionName: pet.sessionName,
            since: pet.since,
            lastActivityAt: pet.lastActivityAt,
            idleMs: Date.now() - pet.lastActivityAt,
            pending: pet.pending ? { kind: pet.pending.kind, toolName: pet.pending.toolName, since: pet.pending.since } : null,
          },
          lastTurn: pet.lastTurn,
          event: pet.event,
          balance,
          balanceError: lastBalanceResult && !lastBalanceResult.ok ? lastBalanceResult.error : null,
        }
      }

      // ------------------------------------------------------------ 路由
      disposers.push(ctx.on('session/event', (session, event) => {
        try { handleSessionEvent(session, event) } catch (err) {
          console.error(`[${PLUGIN_ID}] session event failed:`, err && err.message)
        }
      }))

      disposers.push(ctx.on('session/disposed', (session) => {
        try { if (session && session.id) finalizeTurn(String(session.id)) } catch (err) {}
      }))

      try {
        disposers.push(ctx.on('subagent/start', (info) => {
          if (info && info.id) subagentSessions.add(String(info.id))
        }))
        disposers.push(ctx.on('subagent/end', (info) => {
          if (info && info.id) subagentSessions.add(String(info.id))
        }))
      } catch (err) {}

      disposers.push(register({
        kind: 'exact',
        path: ROUTE_BASE + '/state.json',
        handler: (req, res) => {
          try { sendJson(res, publicState()) } catch (err) {
            sendJson(res, { ok: false, error: String((err && err.message) || err) })
          }
        },
      }))

      disposers.push(register({
        kind: 'exact',
        path: ROUTE_BASE + '/balance.json',
        handler: async (req, res) => {
          try {
            const force = new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1'
            const payload = await getBalance(force)
            sendJson(res, payload)
          } catch (err) {
            sendJson(res, { ok: false, code: 'ERROR', error: String((err && err.message) || err) })
          }
        },
      }))

      disposers.push(register({
        kind: 'exact',
        path: ROUTE_BASE + '/records.json',
        handler: (req, res) => {
          try {
            const records = usageRecords()
            let balance = null
            try { balance = balanceCache ? publicBalance(balanceCache.payload) : null } catch (err) {}
            sendJson(res, { ...records, balance, lastTurn: pet.lastTurn, version: BUILD_VERSION })
          } catch (err) {
            sendJson(res, { ok: false, error: String((err && err.message) || err) })
          }
        },
      }))

      // 立绘：/sprite/<角色>/<状态>.png；旧路径 /sprite/<状态>.png 回退到 Claude。
      const SPRITE_NAMES = new Set(Object.values(SPRITES).concat(['thumb', 'greeting', 'leave', 'comfort', 'bye']))
      disposers.push(register({
        kind: 'prefix',
        path: ROUTE_BASE + '/sprite',
        handler: (req, res) => {
          const rel = String(req.url || '').split('?')[0].replace(/^.*\/sprite\//, '')
          const parts = rel.split('/').filter(Boolean)
          let character = ''
          let key = ''
          if (parts.length === 1) {
            character = 'claude'
            key = parts[0].replace(/\.png$/i, '')
          } else if (parts.length === 2) {
            character = parts[0]
            key = parts[1].replace(/\.png$/i, '')
          }
          if (!CHARACTER_IDS.has(character) || !SPRITE_NAMES.has(key)) {
            try { res.writeHead(404); res.end() } catch (err) {}
            return
          }
          try {
            const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'assets', 'sprites', character, key + '.png'))
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=86400',
            })
            res.end(bytes)
          } catch (err) {
            try { res.writeHead(404); res.end() } catch (e2) {}
          }
        },
      }))

      // 音效：done / error（wav）、pinch（小鲸鱼挂件的按压 mp3）
      const SOUND_FILES = {
        done: 'done.wav', error: 'error.wav', waiting: 'waiting.wav',
        pinch: 'pinch.mp3', pinch2: 'pinch2.mp3', pinch3: 'pinch3.mp3',
      }
      const SOUND_TYPES = { wav: 'audio/wav', mp3: 'audio/mpeg' }
      disposers.push(register({
        kind: 'prefix',
        path: ROUTE_BASE + '/sound',
        handler: (req, res) => {
          const requested = path.basename(String(req.url || '').split('?')[0]).replace(/\.(wav|mp3)$/i, '')
          const file = SOUND_FILES[requested]
          if (!file) { try { res.writeHead(404); res.end() } catch (err) {} return }
          const ext = file.split('.').pop()
          try {
            const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'assets', 'sounds', file))
            res.writeHead(200, {
              'Content-Type': SOUND_TYPES[ext] || 'application/octet-stream',
              'Cache-Control': 'public, max-age=86400',
            })
            res.end(bytes)
          } catch (err) {
            try { res.writeHead(404); res.end() } catch (e2) {}
          }
        },
      }))

      // 得意黑字体（Smiley Sans v2.0.1，OFL-1.1）：固定文件，读一次后常驻内存。
      let fontBytes = null
      disposers.push(register({
        kind: 'exact',
        path: ROUTE_BASE + '/font/smiley-sans.ttf',
        handler: (req, res) => {
          try {
            if (!fontBytes) fontBytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'assets', 'fonts', 'SmileySans-Oblique.ttf'))
            res.writeHead(200, {
              'Content-Type': 'font/ttf',
              'Cache-Control': 'public, max-age=86400',
              // 桌面端页面在 dsh-app:// 下加载字体，按 CORS 资源处理；字体是公开静态资源。
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
            })
            res.end(fontBytes)
          } catch (err) {
            try { res.writeHead(404); res.end() } catch (e2) {}
          }
        },
      }))

      // 前端脚本：按 mtime 热读取，改完刷新页面即可生效。
      let widgetCache = null
      disposers.push(register({
        kind: 'exact',
        path: ROUTE_BASE + '/widget.js',
        handler: (req, res) => {
          try {
            const file = path.join(PACKAGE_ROOT, 'assets', 'claude-pet.js')
            const stat = fs.statSync(file)
            if (!widgetCache || widgetCache.mtimeMs !== stat.mtimeMs) {
              widgetCache = { text: fs.readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs }
            }
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            res.end(widgetCache.text)
          } catch (err) {
            try { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('widget unavailable') } catch (e2) {}
          }
        },
      }))

      // Web 形态：直接改 index.html（桌面端靠上面的 webserver/index-inject 行）。
      try {
        disposers.push(ctx.webServer.tapIndex((html) => {
          if (html.indexOf(ROUTE_BASE + '/widget.js') !== -1) return html
          const tag = '<script defer src="' + ROUTE_BASE + '/widget.js"></script>'
          return html.indexOf('</body>') !== -1 ? html.replace('</body>', tag + '</body>') : html + tag
        }))
      } catch (err) {}
    })
  },
}

