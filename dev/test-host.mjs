// Mock-host integration test for dsh-widget-pet.
// Run: node dev/test-host.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
// 测试账本写到系统临时目录，避免污染插件目录或真实 ~/.dsh
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dshcp-test-'))
process.env.DSH_HOME = TEST_HOME
process.on('exit', function () {
  try { fs.rmSync(TEST_HOME, { recursive: true, force: true }) } catch (err) {}
})

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('  ok  ', name)
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : extra) }
}

function makeRes() {
  return {
    status: 0, headers: null, body: '',
    writeHead(code, headers) { this.status = code; this.headers = headers || null },
    end(body) { this.body = body == null ? '' : String(body) },
  }
}

const routes = []
const injections = []
const listeners = new Map()
const taps = []

const accountState = {
  balance: 20,
  calls: 0,
}

const account = {
  getState() { return { userId: 'user-42' } },
  async getBalance() {
    accountState.calls++
    return {
      status: 'ready',
      value: [{ currency: 'CNY', balance: accountState.balance }],
      bonusWallets: [],
    }
  },
}

const connection = { requestRejection() { return undefined } }

const webServer = {
  register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1) } },
  tapIndex(fn) { taps.push(fn); return () => {} },
}

const ctx = {
  webServer,
  get(name) {
    if (name === 'connection') return connection
    if (name === 'deepseekAccount') return account
    return undefined
  },
  on(name, cb) {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(cb)
    return () => { const a = listeners.get(name); const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1) }
  },
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  credentials: {
    async resolve() { throw new Error('no api key in test') },
  },
  inject(_services, cb) { cb(ctx) },
}

const root = {
  effect(fn) { return ctx.effect(fn) },
  on(name, cb) { return ctx.on(name, cb) },
  inject(services, cb) { return ctx.inject(services, cb) },
}

function emit(name, ...args) {
  for (const cb of listeners.get(name) || []) cb(...args)
}

function matchRoute(pathname) {
  const exact = routes.find((r) => r.kind === 'exact' && r.path === pathname)
  if (exact) return exact
  let best
  for (const r of routes) {
    if (r.kind !== 'prefix') continue
    if (pathname === r.path || pathname.startsWith(r.path + '/')) {
      if (!best || r.path.length > best.path.length) best = r
    }
  }
  return best
}

async function call(pathname, opts = {}) {
  // 真实 webserver 用 URL.pathname 匹配；交给 handler 的 req.url 保留 query。
  const pathOnly = new URL(pathname, 'http://localhost').pathname
  const route = matchRoute(pathOnly)
  if (!route) return { status: 404, body: 'no route' }
  const res = makeRes()
  const req = {
    url: pathname,
    method: opts.method || 'GET',
    headers: Object.assign({
      host: '127.0.0.1:51898',
      origin: 'http://127.0.0.1:51898',
      'sec-fetch-site': 'same-origin',
    }, opts.headers || {}),
  }
  await route.handler(req, res)
  return res
}

function state() {
  return call('/dsh-widget-pet/state.json').then((r) => JSON.parse(r.body))
}

const session = { id: 'session-test', cwd: 'E:\\work\\demo' }

const plugin = (await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href)).default
check('plugin has name', plugin.name === 'dsh-widget-pet')
plugin.apply(root)

// ---------------------------------------------------------------- injection
check('web inject rows subscribed', (listeners.get('webserver/index-inject') || []).length === 1)
const table = []
emit('webserver/index-inject', table)
check('desktop injection row pushed', table.length === 1 && table[0].kind === 'script' && table[0].text.includes('/dsh-widget-pet/widget.js'), JSON.stringify(table))
check('tapIndex registered', taps.length === 1)
const tapped = taps[0]('<html><body><div id="root"></div></body></html>')
check('tapIndex appends widget script', tapped.includes('src="/dsh-widget-pet/widget.js"'))

// ---------------------------------------------------------------- security
const evil = await call('/dsh-widget-pet/state.json', { headers: { host: 'evil.example:51898', origin: 'http://evil.example:51898' } })
check('non-loopback host rejected', evil.status === 403, evil.status)
const cross = await call('/dsh-widget-pet/state.json', { headers: { 'sec-fetch-site': 'cross-site' } })
check('cross-site rejected', cross.status === 403, cross.status)

// ---------------------------------------------------------------- initial state
let st = await state()
check('initial state waiting', st.ok && st.activity.state === 'waiting', st.activity)
check('initial sprite waiting', st.activity.sprite === 'waiting')
check('state includes isPeak', typeof st.isPeak === 'boolean', st.isPeak)
check('state includes token price', st.price && Number.isFinite(st.price.miss) && Number.isFinite(st.price.out), st.price)

// ---------------------------------------------------------------- thinking
emit('session/event', session, { type: 'turn/start', time: Date.now(), data: { turn: 1 } })
st = await state()
check('turn/start → thinking', st.activity.state === 'thinking' && st.activity.text === '思考中', st.activity)

// ---------------------------------------------------------------- reading tool
emit('session/event', session, {
  type: 'tool/call', time: Date.now(),
  data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: JSON.stringify({ file_path: 'E:\\work\\demo\\src\\main.js' }) },
})
st = await state()
check('read tool → reading / file name', st.activity.state === 'reading' && st.activity.text.includes('main.js'), st.activity)

// ---------------------------------------------------------------- tool error x3 → stone
for (let i = 0; i < 3; i++) {
  emit('session/event', session, {
    type: 'tool/result', time: Date.now(),
    data: { turn: 1, step: 1, message: { toolCallId: 'c' + i, isError: true } },
  })
}
st = await state()
check('3 tool errors → stone', st.activity.state === 'stone', st.activity)

// ---------------------------------------------------------------- assistant usage + turn end
// 固定在“今天北京时间 20:00”这条空闲时段消息上，避免测试在高峰时段跑时金额翻倍
const todayBj = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const before = Date.parse(todayBj + 'T20:00:00+08:00')
emit('session/event', session, {
  type: 'assistant/message', time: before,
  data: {
    turn: 1, step: 1,
    message: { role: 'assistant', source: { model: 'deepseek-flash' } },
    usage: { inputTokens: 10000, cacheReadTokens: 5000, outputTokens: 2000 },
  },
})
emit('session/event', session, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
st = await state()
check('turn/end → waiting', st.activity.state === 'waiting', st.activity)
check('lastTurn seq advanced', st.lastTurn && st.lastTurn.seq === 1, st.lastTurn)
check('lastTurn tokens counted', st.lastTurn.tokens === 17000, st.lastTurn)
check('lastTurn cost ≈ 0.0181', Math.abs(st.lastTurn.amount - 0.0181) < 1e-6, st.lastTurn.amount)
check('done sound event fired', st.event.kind === 'done' && st.event.seq === 1, st.event)

const ledgerFile = path.join(TEST_HOME, '.dshcp-usage.json')
check('ledger file written', fs.existsSync(ledgerFile))
const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
check('ledger has one usage event', ledger.events.length === 1 && ledger.events[0].model === 'deepseek-flash', ledger.events)

// ---------------------------------------------------------------- approval
emit('session/event', session, { type: 'approval/asked', time: Date.now(), data: { id: 'a1', toolName: 'pwsh', callId: 'c9' } })
st = await state()
check('approval/asked → approval', st.activity.state === 'approval' && st.activity.pending && st.activity.pending.kind === 'approval', st.activity)
check('approval event fired', st.event.kind === 'approval', st.event)
emit('session/event', session, { type: 'approval/decided', time: Date.now(), data: { id: 'a1', outcome: 'allowed-once' } })
st = await state()
check('approval/decided clears pending', st.activity.pending === null, st.activity)

// ---------------------------------------------------------------- question
emit('session/event', session, { type: 'turn/start', time: Date.now(), data: { turn: 2 } })
emit('session/event', session, {
  type: 'tool/call', time: Date.now(),
  data: { turn: 2, step: 1, callId: 'q1', name: 'ask_user_question', arguments: '{}' },
})
st = await state()
check('ask_user_question → question', st.activity.state === 'question' && st.activity.pending.kind === 'question', st.activity)
check('question event fired', st.event.kind === 'question' && st.event.seq === 3, st.event)
emit('session/event', session, {
  type: 'tool/result', time: Date.now(),
  data: { turn: 2, step: 1, message: { toolCallId: 'q1', isError: false } },
})
st = await state()
check('question result clears pending', st.activity.pending === null, st.activity)
emit('session/event', session, { type: 'turn/end', time: Date.now(), data: { turn: 2, reason: { kind: 'aborted' } } })
st = await state()
check('aborted → aborted', st.activity.state === 'aborted', st.activity)

// ---------------------------------------------------------------- balance
accountState.balance = 20
let bal = await call('/dsh-widget-pet/balance.json?refresh=1')
let bj = JSON.parse(bal.body)
check('balance ok via account', bj.ok === true && bj.totalBalance === 20 && bj.balanceSource === 'account', bj)
check('balance records opening (today 0)', bj.todayUsage === 0, { today: bj.todayUsage, label: bj.usageLabel })

accountState.balance = 19.5
bal = await call('/dsh-widget-pet/balance.json?refresh=1')
bj = JSON.parse(bal.body)
check('balance drop → today usage 0.5', Math.abs(bj.todayUsage - 0.5) < 1e-9, { today: bj.todayUsage, label: bj.usageLabel })
check('balance source label observed', bj.usageSource === 'balance-observed', bj.usageSource)

st = await state()
check('state carries cached balance', st.balance && st.balance.totalBalance === 19.5, st.balance && st.balance.totalBalance)

// ---------------------------------------------------------------- records
const rec = JSON.parse((await call('/dsh-widget-pet/records.json')).body)
check('records ok', rec.ok === true)
check('records today total 0.5', Math.abs(rec.today.total - 0.5) < 1e-9, rec.today.total)
check('records 7 days', rec.days7.length === 7)
check('records model split', rec.today.models.some((m) => m.model === 'deepseek-flash'), rec.today.models)

// ---------------------------------------------------------------- assets
const sprite = await call('/dsh-widget-pet/sprite/chatgpt/thinking.png')
check('sprite route 200 png', sprite.status === 200 && sprite.headers['Content-Type'] === 'image/png' && sprite.body.length > 1000)
const thumb = await call('/dsh-widget-pet/sprite/gemini/thumb.png')
check('character thumb 200 png', thumb.status === 200 && thumb.headers['Content-Type'] === 'image/png' && thumb.body.length > 1000)
const bye = await call('/dsh-widget-pet/sprite/gemini/bye.png')
check('goodbye sprite 200 png', bye.status === 200 && bye.headers['Content-Type'] === 'image/png' && bye.body.length > 1000)
const legacySprite = await call('/dsh-widget-pet/sprite/waiting.png')
check('legacy sprite falls back to claude', legacySprite.status === 200, legacySprite.status)
const badCharacter = await call('/dsh-widget-pet/sprite/unknown/smile.png')
check('unknown character blocked', badCharacter.status === 404, badCharacter.status)
const badSprite = await call('/dsh-widget-pet/sprite/../../etc/passwd')
check('sprite path traversal blocked', badSprite.status === 404, badSprite.status)
const sound = await call('/dsh-widget-pet/sound/done.wav')
check('sound route 200 wav', sound.status === 200 && sound.headers['Content-Type'] === 'audio/wav')
const pinch = await call('/dsh-widget-pet/sound/pinch.mp3')
check('pinch sound route 200 mp3', pinch.status === 200 && pinch.headers['Content-Type'] === 'audio/mpeg' && pinch.body.length > 5000)
const font = await call('/dsh-widget-pet/font/smiley-sans.ttf')
check('font route 200 ttf', font.status === 200 && font.headers['Content-Type'] === 'font/ttf' && font.body.length > 1000000 && font.headers['Access-Control-Allow-Origin'] === '*')
const fontApp = await call('/dsh-widget-pet/font/smiley-sans.ttf', { headers: { origin: 'dsh-app://app' } })
check('font accepts desktop app origin', fontApp.status === 200, fontApp.status)
const fontEvil = await call('/dsh-widget-pet/font/smiley-sans.ttf', { headers: { origin: 'https://evil.example' } })
check('font rejects web origin', fontEvil.status === 403, fontEvil.status)
const widget = await call('/dsh-widget-pet/widget.js')
check('widget.js route 200', widget.status === 200 && widget.body.includes('__dshWidgetPet'))

// ---------------------------------------------------------------- files
check('turn seq persisted', fs.existsSync(path.join(TEST_HOME, '.dshcp-turn.json')))
const seq = JSON.parse(fs.readFileSync(path.join(TEST_HOME, '.dshcp-turn.json'), 'utf8'))
check('turn seq value 1', seq.seq === 1, seq)

console.log('')
if (failures) { console.log(failures + ' check(s) failed'); process.exit(1) }
console.log('all checks passed')
