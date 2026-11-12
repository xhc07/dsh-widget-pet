// Mock DSH page + plugin API server, for visual checks with headless Edge.
// Run: node dev/preview-server.mjs [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PORT = Number(process.argv[2] || 51977)

const scenarios = {
  waiting: {
    activity: { state: 'waiting', sprite: 'waiting', text: '我来啦～', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 1200, pending: null },
    event: { seq: 3, kind: 'done', ts: Date.now() },
    lastTurn: { seq: 3, turn: 7, amount: 0.0123, tokens: 13820, ts: Date.now(), model: 'deepseek-flash' },
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: false, peakNextChangeAt: Math.floor(Date.now() / 1000) + 5400, todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  reading: {
    activity: { state: 'reading', sprite: 'notes', text: '在读 register.ts', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 0, pending: null },
    event: { seq: 4, kind: '', ts: 0 },
    lastTurn: { seq: 3, turn: 7, amount: 0.0123, tokens: 13820, ts: Date.now(), model: 'deepseek-flash' },
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: false, peakNextChangeAt: Math.floor(Date.now() / 1000) + 5400, todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  thinking: {
    activity: { state: 'thinking', sprite: 'thinking', text: '思考中', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 0, pending: null },
    event: { seq: 5, kind: '', ts: 0 },
    lastTurn: null,
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: true, peakNextChangeAt: Math.floor(Date.now() / 1000) + 1800, todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  approval: {
    activity: { state: 'approval', sprite: 'approval', text: '等你授权…', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 0, pending: { kind: 'approval', toolName: 'pwsh', since: Date.now() } },
    event: { seq: 6, kind: 'approval', ts: Date.now() },
    lastTurn: null,
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: false, peakNextChangeAt: Math.floor(Date.now() / 1000) + 5400, todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  error: {
    activity: { state: 'error', sprite: 'error', text: '出错了，来看看？', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 0, pending: null },
    event: { seq: 7, kind: 'error', ts: Date.now() },
    lastTurn: null,
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: false, peakNextChangeAt: Math.floor(Date.now() / 1000) + 5400, todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  celebrate: {
    activity: { state: 'celebrate', sprite: 'celebrate', text: '搞定啦！轮到你～', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 0, pending: null },
    event: { seq: 8, kind: 'done', ts: Date.now() },
    lastTurn: { seq: 8, turn: 9, amount: 0.2381, tokens: 421000, ts: Date.now(), model: 'deepseek-flash' },
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: false, peakNextChangeAt: Math.floor(Date.now() / 1000) + 5400, todayUsage: 0.7, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  idle: {
    activity: { state: 'idle', sprite: 'idle', text: '在发呆～ zZ', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now() - 11 * 60000, idleMs: 11 * 60000, pending: null },
    event: { seq: 9, kind: '', ts: 0 },
    lastTurn: null,
    balance: { ok: true, totalBalance: 18.74, rechargeBalance: 18.74, bonusBalance: 0, currency: 'CNY', balanceSource: 'account', updatedAt: new Date().toISOString(), isPeak: false, peakNextChangeAt: Math.floor(Date.now() / 1000) + 5400, todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
  nobalance: {
    activity: { state: 'waiting', sprite: 'waiting', text: '我来啦～', project: 'deepseek-harness', sessionName: '把 Claude 娘做成 DSH 余额挂件', since: Date.now(), lastActivityAt: Date.now(), idleMs: 0, pending: null },
    event: { seq: 10, kind: '', ts: 0 },
    lastTurn: null,
    balance: { ok: false, code: 'NO_KEY', error: '未配置 DEEPSEEK_API_KEY；账号登录路：未登录 DeepSeek 账号（没有账号凭据）', todayUsage: 0.46, todayUsageCurrency: 'CNY', usageSource: 'balance-observed', usageLabel: '已观测消费', version: '1.0.0' },
  },
}

let scenario = 'waiting'

const records = {
  ok: true,
  today: {
    date: new Date().toISOString().slice(0, 10), total: 0.46, amount: 0.46, label: '已观测消费', currency: 'CNY',
    tokens: 1284000,
    models: [
      { model: 'deepseek-flash', cost: 0.4021 },
      { model: 'qwen/qwen3.8-27b', cost: 0.0579 },
    ],
  },
  days7: [0.46, 1.69, 0.71, 0, 2.34, 0.88, 0.12].map((v, i) => {
    const d = new Date(Date.now() - i * 86400000)
    return { date: d.toISOString().slice(0, 10), total: v, amount: v, label: '已观测消费', currency: 'CNY', models: [] }
  }),
  total7: 6.2,
  all: { days: [], events: [], models: [] },
  lastTurn: { seq: 3, turn: 7, amount: 0.0123, tokens: 13820, model: 'deepseek-flash' },
  version: '1.0.0',
}

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH × Claude 娘桌宠 · 预览</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,"Segoe UI","Microsoft YaHei UI",sans-serif; background:#f7f6f3; color:#222; height:100vh; overflow:hidden; }
  .app { display:flex; height:100vh; }
  .side { width:236px; background:#202024; color:#bbb; padding:14px 10px; flex:none; }
  .side h1 { font-size:13px; color:#fff; margin:4px 8px 18px; font-weight:600; }
  .side .item { padding:8px 10px; border-radius:8px; font-size:12px; margin-bottom:4px; color:#aaa; }
  .side .item.on { background:#33333a; color:#fff; }
  .main { flex:1; display:flex; flex-direction:column; min-width:0; }
  .top { height:46px; border-bottom:1px solid #e6e2da; display:flex; align-items:center; padding:0 18px; font-size:12px; color:#777; }
  .chat { flex:1; overflow:auto; padding:28px 12%; }
  .msg { max-width:640px; margin:0 auto 18px; font-size:13px; line-height:1.6; color:#333; }
  .msg.me { text-align:right; }
  .msg .who { font-size:11px; color:#999; margin-bottom:4px; }
  .msg .bubble { display:inline-block; background:#fff; border:1px solid #e8e3d9; border-radius:10px; padding:10px 14px; text-align:left; }
  .msg.me .bubble { background:#eae6de; border-color:#e0dbd0; }
  .composer-wrap { padding:12px 12% 26px; }
  .composer { max-width:680px; margin:0 auto; background:#fff; border:1px solid #ddd7cb; border-radius:14px; padding:12px 14px; box-shadow:0 2px 8px rgba(0,0,0,.03); }
  .composer textarea { width:100%; border:0; outline:0; resize:none; height:26px; font:inherit; font-size:13px; background:transparent; }
  .composer .bar { display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:11px; color:#aaa; }
  .send { background:#e8743b; color:#fff; border:0; border-radius:8px; padding:5px 12px; font-size:12px; }
</style></head>
<body>
<div class="app" id="root">
  <aside class="side"><h1>DeepSeek Harness</h1>
    <div class="item on">把 Claude 娘做成 DSH 余额挂件</div>
    <div class="item">红果短剧下载器排错</div>
    <div class="item">Office 报告生成</div>
  </aside>
  <main class="main">
    <div class="top">deepseek-flash · workspace-write · 预览页面</div>
    <div class="chat">
      <div class="msg"><div class="who">你</div><div class="bubble">把 Claude 娘桌宠移植成 DSH 的余额小插件，保留余额、消费计算和任务检测。</div></div>
      <div class="msg me"><div class="who">Claude 娘</div><div class="bubble">收到～我会盯着余额和每一轮消耗，干活的时候在右下角陪着你。</div></div>
    </div>
    <div class="composer-wrap"><div class="composer">
      <textarea data-composer-input placeholder="给 DSH 发消息…"></textarea>
      <div class="bar"><span>@ 引用 · / 命令</span><button class="send">发送</button></div>
    </div></div>
  </main>
</div>
<script>
  // 在挂件脚本之前写入本地设置，方便预览不同尺寸 / 状态
  (function(){
    var q = new URLSearchParams(location.search);
    if (q.get('reset') === '1') {
      localStorage.removeItem('dshcp-settings-v1');
      localStorage.removeItem('dshcp-pos-v1');
    }
    if (q.get('size') || q.get('animate') || q.get('bubbleMode') || q.get('badgeMode') || q.get('font') || q.get('fontBubbleOnly') || q.get('character') || q.get('opening') || q.get('peak') != null) {
      var charIds = ['chatgpt', 'claude', 'deepseek', 'gemini']
      localStorage.setItem('dshcp-settings-v1', JSON.stringify({
        size: q.get('size') || 'medium', sound: true, eventSound: true, pinchSound: true, hidden: false,
        animate: q.get('animate') !== '0', switchAnim: true,
        openingAnim: q.get('opening') !== '0', openingPop: true, openingSway: true,
        bubbleMode: ['auto', 'none', 'always'].indexOf(q.get('bubbleMode')) >= 0 ? q.get('bubbleMode') : 'auto',
        badgeMode: ['auto', 'none', 'always'].indexOf(q.get('badgeMode')) >= 0 ? q.get('badgeMode') : 'always',
        character: charIds.indexOf(q.get('character')) >= 0 ? q.get('character') : 'claude',
        greetingDuration: 10, greetingDurationVersion: 1,
        peakReminder: true, peakReminderDuration: q.get('peak') != null ? Math.max(0, Math.min(16, Number(q.get('peak')) || 0)) : 10,
        font: q.get('font') === 'default' ? 'default' : 'smiley',
        fontBubbleOnly: q.get('fontBubbleOnly') !== '0',
        fontBubbleOnlyVersion: 1,
        fontDefaultVersion: 2
      }));
    }
    if (q.get('clean') === '1') {
      var st = document.createElement('style');
      st.textContent = '.chat { visibility: hidden; }';
      document.head.appendChild(st);
    }
    document.title = 'DSH × AI 娘 · ' + (q.get('scenario') || 'waiting');
  })();
</script>
<script src="/dsh-widget-pet/widget.js"></script>
<script>
  (function(){
    var q = new URLSearchParams(location.search);
    setTimeout(function(){
      var host = document.getElementById('dsh-widget-pet-host');
      if (!host || !host.shadowRoot) return;
      var img = host.shadowRoot.querySelector('.sprite');
      if (!img) return;
      if (q.get('panel') === '1' || q.get('settings') === '1') img.click();
      if (q.get('settings') === '1') {
        var gear = host.shadowRoot.querySelector('[data-act="settings"]');
        if (gear) gear.click();
      }
      if (q.get('tab')) {
        var wantedTab = host.shadowRoot.querySelector('[data-act="settings-tab"][data-value="' + q.get('tab') + '"]');
        if (wantedTab) wantedTab.click();
      }
      if (q.get('anim') === '1') {
        setTimeout(function () {
          var animBtn = host.shadowRoot.querySelector('[data-act="toggle-anim-group"]');
          if (animBtn) animBtn.click();
        }, 1700)
      }
      if (q.get('open') === '1') {
        setTimeout(function () {
          var b = host.shadowRoot.querySelector('[data-act="toggle-opening-group"]');
          if (b) b.click();
        }, 1800)
      }
      if (q.get('reminder') === '1') {
        setTimeout(function () {
          var b = host.shadowRoot.querySelector('[data-act="toggle-reminder-group"]');
          if (b) b.click();
        }, 1800)
      }
      if (q.get('dialog') === '1') {
        setTimeout(function () {
          var b = host.shadowRoot.querySelector('[data-act="toggle-dialog-group"]');
          if (b) b.click();
        }, 1700)
      }
      if (q.get('soundgroup') === '1') {
        setTimeout(function () {
          var b = host.shadowRoot.querySelector('[data-act="toggle-event-sound-group"]');
          if (b) b.click();
        }, 1800)
      }

      if (q.get('dots') === '1') {
        setTimeout(function () {
          var b = host.shadowRoot.querySelector('[data-act="toggle-dots-group"]');
          if (b) b.click();
        }, 1800)
      }
      if (q.get('scroll') === '1') {
        setTimeout(function () {
          var sc = host.shadowRoot.querySelector('.settings-scroll');
          if (sc) sc.scrollTop = sc.scrollHeight;
        }, 2100)
      }
      if (q.get('close') === '1') {
        setTimeout(function () {
          var cb = host.shadowRoot.querySelector('[data-act="close"]');
          if (cb) cb.click();
        }, 2400)
      }
      if (q.get('slider')) {
        setTimeout(function () {
          var r = host.shadowRoot.querySelector('#bubbleRange');
          if (r) { r.value = q.get('slider'); r.dispatchEvent(new Event('input', { bubbles: true })) }
        }, 1600)
      }
      if (q.get('charclick')) {
        setTimeout(function () {
          var card = host.shadowRoot.querySelector('[data-act="set-character"][data-value="' + q.get('charclick') + '"]');
          if (card) card.click();
        }, 900)
      }
      if (q.get('menubtn') === '1') {
        var mb = host.shadowRoot.querySelector('[data-act="show-menu"]');
        if (mb) mb.click();
      }
      if (q.get('menu') === '1') {
        try {
          img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1000, clientY: 500 }))
        } catch (e) {}
      }
      if (q.get('leave') === '1' || q.get('leaveback') === '1' || q.get('leavebye') === '1') {
        setTimeout(function () {
          var leaveBtn = host.shadowRoot.querySelector('[data-act="leave"]');
          if (leaveBtn) leaveBtn.click();
          if (q.get('leaveback') === '1' || q.get('leavebye') === '1') {
            setTimeout(function () {
              var answer = host.shadowRoot.querySelector('[data-act="' + (q.get('leaveback') === '1' ? 'leave-back' : 'leave-confirm') + '"]');
              if (answer) answer.click();
            }, 350)
          }
        }, 1900)
      }
      if (q.get('peakclick') === '1') {
        var pr = host.shadowRoot.querySelector('.peak-row');
        if (pr) pr.click();
      }
      if (q.get('peakhover') === '1') {
        // 等记录加载完、面板重绘后再模拟悬停，避免被重绘清掉
        setTimeout(function () {
          var row = host.shadowRoot.querySelector('.peak-row');
          if (row) row.dispatchEvent(new MouseEvent('mouseenter'))
        }, 2800)
      }
      if (q.get('hover') === '1') {
        setTimeout(function () {
          try { img.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })) } catch (e) {}
        }, 5000)
      }
    }, 1400);
  })();
</script>
</body></html>`

const types = { '.png': 'image/png', '.wav': 'audio/wav', '.js': 'application/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' }

function scenarioOf(req) {
  try {
    const ref = new URL(req.headers.referer || '')
    const s = ref.searchParams.get('scenario')
    if (s && scenarios[s]) return s
  } catch (e) {}
  return scenario
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(HTML)
    return
  }
  if (p === '/set') {
    scenario = url.searchParams.get('scenario') || 'waiting'
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('scenario=' + scenario)
    return
  }
  if (p === '/dsh-widget-pet/state.json') {
    const s = scenarios[scenarioOf(req)] || scenarios.waiting
    const peak = !!(s.balance && s.balance.isPeak)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({
      ok: true, version: '2.1.3', isPeak: peak,
      price: { model: 'deepseek-flash', currency: 'CNY', miss: peak ? 2 : 1, hit: peak ? 0.04 : 0.02, out: peak ? 8 : 4 },
      activity: s.activity, lastTurn: s.lastTurn, event: s.event,
      balance: s.balance, balanceError: s.balance && s.balance.ok === false ? s.balance.error : null,
    }))
    return
  }
  if (p === '/dsh-widget-pet/balance.json') {
    const s = scenarios[scenarioOf(req)] || scenarios.waiting
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(s.balance))
    return
  }
  if (p === '/dsh-widget-pet/records.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(records))
    return
  }
  if (p === '/dsh-widget-pet/widget.js') {
    res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' })
    res.end(fs.readFileSync(path.join(ROOT, 'assets', 'claude-pet.js')))
    return
  }
  if (p.startsWith('/dsh-widget-pet/sprite/')) {
    const parts = p.slice('/dsh-widget-pet/sprite/'.length).split('/')
    const characters = new Set(['chatgpt', 'claude', 'deepseek', 'gemini'])
    let character = 'claude'
    let key = ''
    if (parts.length === 1) {
      key = parts[0].replace(/\.png$/i, '')
    } else if (parts.length === 2) {
      character = parts[0]
      key = parts[1].replace(/\.png$/i, '')
    }
    try {
      if (!characters.has(character) || !/^[a-z-]+$/.test(key)) throw new Error('bad sprite')
      const data = fs.readFileSync(path.join(ROOT, 'assets', 'sprites', character, key + '.png'))
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(data)
    } catch (e) { res.writeHead(404); res.end() }
    return
  }
  if (p.startsWith('/dsh-widget-pet/sound/')) {
    const name = path.basename(p)
    try {
      const data = fs.readFileSync(path.join(ROOT, 'assets', 'sounds', name))
      res.writeHead(200, { 'Content-Type': /\.mp3$/i.test(name) ? 'audio/mpeg' : 'audio/wav' })
      res.end(data)
    } catch (e) { res.writeHead(404); res.end() }
    return
  }
  if (p === '/dsh-widget-pet/font/smiley-sans.ttf') {
    try {
      const data = fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'SmileySans-Oblique.ttf'))
      res.writeHead(200, { 'Content-Type': 'font/ttf' })
      res.end(data)
    } catch (e) { res.writeHead(404); res.end() }
    return
  }
  res.writeHead(404); res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('preview http://127.0.0.1:' + PORT + '/')
})


