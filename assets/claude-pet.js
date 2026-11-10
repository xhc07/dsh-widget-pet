// DSH × AI 娘桌宠 —— 前端挂件
// ---------------------------------------------------------------------------
// 由宿主注入到 DSH 页面。只跟宿主的三条只读接口打交道：
//   GET /dsh-widget-pet/state.json    每秒轮询：桌宠状态 / 挂起 / 最近一轮 / 余额快照
//   GET /dsh-widget-pet/balance.json  60 秒刷新：余额 + 今日已用（余额观测账本）
//   GET /dsh-widget-pet/records.json  打开面板时：今日 / 近 7 天 / 全部记录
// 立绘与音效也由宿主提供：/sprite/<name>.png、/sound/done.wav、/sound/error.wav
// 所有设置只存浏览器 localStorage，不上传、不写配置。
// ---------------------------------------------------------------------------
(function () {
  'use strict'

  if (window.__dshWidgetPet) return
  window.__dshWidgetPet = true

  var API = '/dsh-widget-pet'
  var VERSION = '2.0.1-beta'
  var CHARACTERS = [
    { id: 'chatgpt', name: 'ChatGPT娘' },
    { id: 'claude', name: 'Claude娘' },
    { id: 'deepseek', name: 'DeepSeek娘' },
    { id: 'gemini', name: 'Gemini娘' },
  ]
  var THEMES = {
    chatgpt: {
      accent: '#a78bfa', strong: '#6d4fc4', light: '#c9b8ff',
      soft: '#f1ecff', softStrong: '#e7deff', surface: '#fbf9ff', surfaceSoft: '#f6f1ff',
      surfaceRgb: '251, 249, 255', ink: '#3b2f4a', inkStrong: '#55456b', inkMid: '#6b5a80',
      muted: '#8a7b9e', mutedSoft: '#a294b4', accentRgb: '167, 139, 250',
      inkRgb: '59, 47, 74', shadowRgb: '60, 40, 90',
    },
    claude: {
      accent: '#e8743b', strong: '#c4571f', light: '#f0a06a',
      soft: '#ffeede', softStrong: '#fff0e2', surface: '#fffaf3', surfaceSoft: '#fff8f0',
      surfaceRgb: '255, 250, 243', ink: '#3a2a1a', inkStrong: '#5c4632', inkMid: '#6b5540',
      muted: '#8a7562', mutedSoft: '#a08a76', accentRgb: '232, 116, 59',
      inkRgb: '58, 42, 26', shadowRgb: '90, 45, 12',
    },
    deepseek: {
      accent: '#4da6e8', strong: '#226fa8', light: '#8cc8f5',
      soft: '#e2f3ff', softStrong: '#d2ecff', surface: '#f7fbff', surfaceSoft: '#eff8ff',
      surfaceRgb: '247, 251, 255', ink: '#1f3548', inkStrong: '#2f4b63', inkMid: '#3f617c',
      muted: '#6b879c', mutedSoft: '#87a0b3', accentRgb: '77, 166, 232',
      inkRgb: '31, 53, 72', shadowRgb: '20, 60, 90',
    },
    gemini: {
      accent: '#7c6cf0', strong: '#5544c8', light: '#a99bff',
      soft: '#ece9ff', softStrong: '#e2ddff', surface: '#faf9ff', surfaceSoft: '#f4f1ff',
      surfaceRgb: '250, 249, 255', ink: '#2f2a4a', inkStrong: '#453e68', inkMid: '#5a5280',
      muted: '#817aa0', mutedSoft: '#9a94b3', accentRgb: '124, 108, 240',
      inkRgb: '47, 42, 74', shadowRgb: '45, 35, 90',
    },
  }
  var POLL_MS = 1000
  var BALANCE_MS = 60000
  var IDLE_AFTER_MS = 10 * 60 * 1000
  var SIZES = { small: 148, medium: 196, large: 258 }
  var STORAGE_SETTINGS = 'dshcp-settings-v1'
  var STORAGE_POS = 'dshcp-pos-v1'
  var AUTO_HIDE_MS = 5000

  var defaults = {
    size: 'medium', sound: true, eventSound: true, pinchSound: true, hidden: false,
    animate: true, switchAnim: true, floatAnim: true, petAnim: true, bubbleAnim: true,
    bubbleMode: 'auto', badgeMode: 'always', clickPanel: true,
    character: 'claude',
    font: 'smiley', fontBubbleOnly: true, fontBubbleOnlyVersion: 1, fontDefaultVersion: 2,
  }
  var settings = loadJson(STORAGE_SETTINGS, defaults) || defaults
  if (!SIZES[settings.size]) settings.size = 'medium'
  if (typeof settings.sound !== 'boolean') settings.sound = true
  if (typeof settings.eventSound !== 'boolean') settings.eventSound = true
  if (typeof settings.pinchSound !== 'boolean') settings.pinchSound = true
  if (typeof settings.hidden !== 'boolean') settings.hidden = false
  if (typeof settings.animate !== 'boolean') settings.animate = true
  if (typeof settings.switchAnim !== 'boolean') settings.switchAnim = true
  if (typeof settings.floatAnim !== 'boolean') settings.floatAnim = true
  if (typeof settings.petAnim !== 'boolean') settings.petAnim = true
  if (typeof settings.bubbleAnim !== 'boolean') settings.bubbleAnim = true
  if (typeof settings.clickPanel !== 'boolean') settings.clickPanel = true
  if (!CHARACTERS.some(function (c) { return c.id === settings.character })) settings.character = 'claude'
  if (typeof settings.fontBubbleOnly !== 'boolean') settings.fontBubbleOnly = true
  if (settings.font !== 'smiley' && settings.font !== 'default') settings.font = 'smiley'
  // 1.2.1 起默认字体改为得意黑：旧设置没有版本标记时迁移一次，之后仍可手动切回默认字体。
  if (settings.fontDefaultVersion !== 2) {
    settings.font = 'smiley'
    settings.fontDefaultVersion = 2
    try { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings)) } catch (e) {}
  }
  // 2.0.1-beta 起默认启用「仅对话框」得意黑：旧设置迁移一次，之后仍可手动关闭。
  if (settings.fontBubbleOnlyVersion !== 1) {
    settings.font = 'smiley'
    settings.fontBubbleOnly = true
    settings.fontBubbleOnlyVersion = 1
    try { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings)) } catch (e) {}
  }
  if (['auto', 'none', 'always'].indexOf(settings.bubbleMode) === -1) settings.bubbleMode = 'auto'
  if (['auto', 'none', 'always'].indexOf(settings.badgeMode) === -1) settings.badgeMode = 'always'

  var state = {
    activity: null,
    lastTurn: null,
    event: null,
    balance: null,
    balanceError: null,
    records: null,
    lastEventSeq: 0,
    lastTurnSeq: 0,
    firstState: true,
    fails: 0,
    online: false,
    lastBalanceAt: 0,
    dragging: false,
    moved: false,
    panelOpen: false,
    panelView: 'main',
    settingsTab: 'character',
    menuOpen: false,
    costTimer: 0,
    squishTimer: 0,
    switchTimer: 0,
    fontFacePromise: null,
    fontFaceReady: false,
    fontFaceError: null,
    hovering: false,
    hoverOutTimer: 0,
    bubbleAutoHidden: false,
    bubbleHideTimer: 0,
    badgeAutoHidden: false,
    badgeHideTimer: 0,
    notice: null,
    noticeTimer: 0,
    lastPeak: null,
    peakHover: false,
    peakAbsoluteUntil: 0,
    peakTicker: 0,
    peakAbsoluteTimer: 0,
  }

  var el = {}
  var audio = {}
  var started = false
  var pollTimer = 0
  var balanceTimer = 0
  var balanceAbort = null

  // ------------------------------------------------------------------ 工具
  function $(sel, root) { return (root || document).querySelector(sel) }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
      if (!raw) return fallback
      var v = JSON.parse(raw)
      return v && typeof v === 'object' ? v : fallback
    } catch (e) { return fallback }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
  }
  function characterInfo(id) {
    var cid = id || settings.character
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (CHARACTERS[i].id === cid) return CHARACTERS[i]
    }
    return CHARACTERS[1]
  }
  function characterName(id) { return characterInfo(id).name }
  function spriteUrl(key) {
    return API + '/sprite/' + settings.character + '/' + (key || 'smile') + '.png'
  }
  function thumbUrl(id) {
    return API + '/sprite/' + (id || settings.character) + '/thumb.png'
  }
  function fmtMoney(n, digits) {
    var x = Number(n)
    if (!isFinite(x)) return '—'
    return x.toFixed(digits == null ? 2 : digits)
  }
  function fmtPrice(n) {
    var x = Number(n)
    if (!isFinite(x)) return '—'
    return Number.isInteger(x) ? String(x) : x.toFixed(2)
  }
  function moneySymbol(currency) {
    var c = String(currency || 'CNY').toUpperCase()
    if (c === 'CNY') return '¥'
    if (c === 'USD') return '$'
    return c + ' '
  }
  function fmtTokens(n) {
    var x = Number(n) || 0
    if (x >= 1e6) return (x / 1e6).toFixed(1) + 'M'
    if (x >= 1e3) return (x / 1e3).toFixed(1) + 'k'
    return String(Math.round(x))
  }
  function shortModel(m) {
    var s = String(m || '')
    if (!s) return '未知模型'
    return s.replace(/^deepseek-/, 'DeepSeek-').replace(/-/g, ' ')
  }
  function timeText(ts) {
    if (!ts) return ''
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) } catch (e) { return '' }
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n) }
  function peakLabelHtml(b) {
    if (!b || b.isPeak === undefined) return '—'
    return b.isPeak
      ? '<span class="peak-hot">高峰时段</span>'
      : '<span class="peak-cool">空闲时段</span>'
  }
  function formatPeakHM(sec) {
    var s = Math.max(0, Math.floor(sec))
    var d = Math.floor(s / 86400)
    var h = Math.floor((s % 86400) / 3600)
    var m = Math.floor((s % 3600) / 60)
    return d > 0 ? d + '天' + h + '小时' + m + '分钟' : h + '小时' + m + '分钟'
  }
  function formatPeakHMS(sec) {
    var s = Math.max(0, Math.floor(sec))
    var d = Math.floor(s / 86400)
    var h = Math.floor((s % 86400) / 3600)
    var m = Math.floor((s % 3600) / 60)
    return d > 0
      ? d + '天' + h + '小时' + m + '分钟' + (s % 60) + '秒'
      : h + '时' + m + '分钟' + (s % 60) + '秒'
  }
  function formatPeakAbsolute(atSec) {
    var d = new Date(atSec * 1000)
    return d.getFullYear() + '年' + pad2(d.getMonth() + 1) + '月' + pad2(d.getDate()) + '日' +
      pad2(d.getHours()) + '时' + pad2(d.getMinutes()) + '分' + pad2(d.getSeconds()) + '秒'
  }
  function peakCountdownText(b) {
    var at = Number(b && b.peakNextChangeAt)
    if (!isFinite(at) || at <= 0) return ''
    if (state.peakAbsoluteUntil > Date.now()) return formatPeakAbsolute(at)
    var left = Math.max(0, at - Date.now() / 1000)
    return state.peakHover ? formatPeakHMS(left) : formatPeakHM(left)
  }

  // ------------------------------------------------------------- 启动检测
  // 只在主聊天界面初始化，避免在插件市场等 React 门户页面里和渲染树抢 DOM。
  function chatRoot() {
    var root = document.getElementById('root')
    if (!root) return null
    var hasComposer = root.querySelector('[data-composer-input], textarea, [contenteditable="true"], [data-composer-seat], [data-composer-card]')
    return hasComposer ? root : null
  }

  function waitForChat() {
    var startedAt = Date.now()
    var obs = new MutationObserver(function () {
      if (chatRoot()) { obs.disconnect(); start() }
    })
    function check() {
      if (started) return
      if (chatRoot()) { obs.disconnect(); start(); return }
      // 非聊天页（设置 / 插件市场）也允许出现余额挂件：5 秒后 #root 在就启动
      if (Date.now() - startedAt > 5000 && document.getElementById('root')) {
        obs.disconnect()
        start()
      }
    }
    try { obs.observe(document.documentElement, { childList: true, subtree: true }) } catch (e) {}
    check()
    setTimeout(check, 1200)
  }

  // ------------------------------------------------------------------ 构建
  var CSS = `
@font-face {
  font-family: 'SmileySans';
  src: url('/dsh-widget-pet/font/smiley-sans.ttf') format('truetype');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
:host {
  all: initial;
  --accent: #e8743b;
  --accent-strong: #c4571f;
  --accent-light: #f0a06a;
  --accent-soft: #ffeede;
  --accent-soft-strong: #fff0e2;
  --surface: #fffaf3;
  --surface-soft: #fff8f0;
  --surface-rgb: 255, 250, 243;
  --ink: #3a2a1a;
  --ink-strong: #5c4632;
  --ink-mid: #6b5540;
  --muted: #8a7562;
  --muted-soft: #a08a76;
  --accent-rgb: 232, 116, 59;
  --ink-rgb: 58, 42, 26;
  --shadow-rgb: 90, 45, 12;
}
* { box-sizing: border-box; }
:host(.font-smiley) .pet,
:host(.font-smiley) .menu,
:host(.font-smiley) .restore {
  font-family: 'SmileySans', -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif !important;
}
:host(.font-smiley-bubble) .bubble {
  font-family: 'SmileySans', -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif !important;
}
.pet, .pet * { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.pet {
  position: fixed; right: 22px; bottom: 118px; width: 276px;
  height: calc(var(--h) + var(--badgeH) + 118px);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif;
  color: var(--ink); pointer-events: none; z-index: 2147483000;
  --h: 196px; --spriteW: 143px; --badgeH: 26px;
}
.pet[data-hidden="1"] { display: none; }
.anchor { position: absolute; left: 50%; bottom: var(--badgeH); width: var(--spriteW); height: var(--h); transform: translateX(-50%); }
.bob { width: 100%; height: 100%; animation: cp-bob 3.2s ease-in-out infinite; will-change: transform; }
.bob.anim-typing { animation: cp-typing .14s linear infinite alternate; }
.bob.anim-panic { animation: cp-panic .09s linear infinite; }
.bob.anim-none { animation: none; }
.bob.anim-confetti { animation-duration: 2.2s; }
.hop { width: 100%; height: 100%; }
.hop.jump { animation: cp-hop .34s cubic-bezier(.3,.8,.4,1); }
.sprite {
  display: block; height: 100%; width: auto; margin: 0 auto;
  filter: drop-shadow(0 8px 12px rgba(var(--shadow-rgb), .22));
  -webkit-user-drag: none; cursor: grab; pointer-events: auto;
  touch-action: none; transform-origin: 50% 100%;
}
.sprite:active { cursor: grabbing; }
.shadow {
  position: absolute; left: 50%; bottom: 3px; width: 62%; height: 13px;
  transform: translateX(-50%); border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(var(--shadow-rgb),.28), rgba(var(--shadow-rgb),0) 70%);
  opacity: .9; pointer-events: none; transition: opacity .3s;
}
.anchor.moving .shadow { opacity: .35; }

.badge {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; white-space: nowrap;
  max-width: 268px; padding: 4px 11px; border-radius: 999px;
  background: rgba(var(--surface-rgb), .94); border: 1.5px solid rgba(var(--accent-rgb), .75);
  box-shadow: 0 3px 10px rgba(var(--shadow-rgb), .14), inset 0 1px 0 rgba(255,255,255,.8);
  font-size: 11px; line-height: 1.25; font-variant-numeric: tabular-nums;
  cursor: pointer; pointer-events: auto; backdrop-filter: blur(4px);
  transition: opacity .3s ease, transform .3s ease;
}
.badge.hidden { opacity: 0; transform: translateX(-50%) translateY(4px); pointer-events: none; }
.badge:hover { border-color: var(--accent); background: var(--surface); }
.badge .bal { font-weight: 700; color: var(--accent-strong); }
.badge .sep { color: rgba(var(--ink-rgb),.28); }
.badge .today { color: var(--ink-mid); }
.badge .peak-sep { display: none; }
.badge .peak-mark { font-weight: 700; }
.badge .peak-mark.peak { color: #e0433f; }
.badge .peak-mark.valley { color: #2fa24c; }
.badge.offline { opacity: .62; }
.badge.offline .bal { color: var(--muted); }

.pending-dot {
  position: absolute; right: -4px; top: -4px; width: 9px; height: 9px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 0 0 rgba(var(--accent-rgb),.6);
  display: none; animation: cp-pulse 1.4s ease-out infinite;
}
.badge.pending .pending-dot { display: block; }

.bubble {
  position: absolute; left: 50%; bottom: calc(var(--badgeH) + var(--h) + 4px);
  transform: translateX(-50%); width: max-content; max-width: 258px; min-width: 92px;
  padding: 8px 13px 9px; border-radius: 14px;
  background: var(--surface); border: 2px solid var(--accent);
  box-shadow: 0 5px 16px rgba(var(--shadow-rgb), .16), inset 0 1px 0 #fff;
  font-size: 14.5px; line-height: 1.45; text-align: center; color: var(--ink);
  pointer-events: auto; cursor: default; overflow-wrap: anywhere;
  transform-origin: 50% 100%; transition: opacity .15s ease, transform .15s ease;
}
.bubble.hidden { opacity: 0; transform: translateX(-50%) scale(.92) translateY(4px); pointer-events: none; }
.pet.panel-open .bubble { opacity: 0; transform: translateX(-50%) scale(.94) translateY(6px); pointer-events: none; }
.pet.no-anim .bob, .pet.no-anim .hop.jump, .pet.no-anim .zz,
.pet.no-anim .sprite.pet-squish, .pet.no-anim .sprite.character-switch { animation: none !important; }
.pet.no-anim .bubble, .pet.no-bubble-anim .bubble { transition: none !important; }
.pet.no-anim .bubble .dots i, .pet.no-bubble-anim .bubble .dots i { animation: none !important; opacity: 1; }
.pet.no-float .bob:not(.anim-typing):not(.anim-panic), .pet.no-float .hop.jump { animation: none !important; }
.sprite.pet-squish { animation: cp-squish .32s cubic-bezier(.3, .7, .4, 1); }
.sprite.character-switch { animation: cp-character-switch .55s cubic-bezier(.3, .8, .4, 1); }
@keyframes cp-squish {
  0% { transform: scale(1, 1); }
  30% { transform: scale(1.08, .9); }
  62% { transform: scale(.97, 1.04); }
  100% { transform: scale(1, 1); }
}
@keyframes cp-character-switch {
  0% { transform: scale(.82, .86) translateY(7px); opacity: .45; }
  42% { transform: scale(1.12, .9) translateY(-5px); opacity: 1; }
  68% { transform: scale(.96, 1.05) translateY(1px); }
  84% { transform: scale(1.03, .98) translateY(-1px); }
  100% { transform: scale(1, 1) translateY(0); }
}
.bubble::after, .bubble::before {
  content: ""; position: absolute; left: 50%; border-style: solid;
}
.bubble::before {
  bottom: -12px; margin-left: -8px; border-width: 10px 8px 0 8px;
  border-color: var(--accent) transparent transparent transparent;
}
.bubble::after {
  bottom: -8px; margin-left: -5px; border-width: 7px 5px 0 5px;
  border-color: var(--surface) transparent transparent transparent;
}
.bubble .dots { display: inline-block; width: 15px; text-align: left; }
.bubble .dots i { font-style: normal; opacity: 0; animation: cp-dot 1.2s infinite; }
.bubble .dots i:nth-child(2) { animation-delay: .18s; }
.bubble .dots i:nth-child(3) { animation-delay: .36s; }
.bubble .cost-line {
  display: none; margin-top: 5px; padding-top: 5px; border-top: 1px dashed rgba(var(--accent-rgb),.35);
  font-size: 11.5px; color: var(--accent-strong); font-variant-numeric: tabular-nums;
}
.bubble.has-cost .cost-line { display: block; }
.bubble .hint { display: block; margin-top: 2px; font-size: 10.5px; color: var(--muted-soft); }
.bubble.notice { border-color: #e0433f; max-width: 280px; }
.bubble .notice-title {
  display: block; color: #e0433f; font-size: 17px; font-weight: 800; line-height: 1.3;
}
.bubble .notice-price {
  display: block; margin-top: 3px; color: #2b2b2b; font-size: 12.5px; font-weight: 400; line-height: 1.4;
}

.zz {
  position: absolute; right: -6px; top: -4px;
  font-size: 15px; font-weight: 700; color: var(--muted); opacity: 0;
  pointer-events: none; transition: opacity .4s;
}
.pet[data-state="idle"] .zz { opacity: .9; animation: cp-zz 2.6s ease-in-out infinite; }

/* 用量 / 余额面板 */
.panel {
  position: fixed; right: 320px; top: 50%; transform: translateY(-50%);
  width: 318px; max-height: 76vh; overflow: auto;
  background: var(--surface); border: 1.5px solid rgba(var(--accent-rgb),.55); border-radius: 16px;
  box-shadow: 0 14px 40px rgba(var(--shadow-rgb), .22), inset 0 1px 0 #fff;
  padding: 13px 14px 12px; pointer-events: auto; display: none;
  font-size: 12px; line-height: 1.45;
}
.panel.open { display: block; }
.panel::-webkit-scrollbar { width: 6px; }
.panel::-webkit-scrollbar-thumb { background: rgba(var(--accent-rgb),.3); border-radius: 3px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.panel-title { font-size: 12px; font-weight: 700; color: var(--accent-strong); letter-spacing: .3px; }
.panel-close {
  border: 0; background: transparent; font-size: 16px; line-height: 1; color: var(--muted-soft);
  cursor: pointer; padding: 2px 4px; border-radius: 6px;
}
.panel-close:hover { background: rgba(var(--accent-rgb),.12); color: var(--accent-strong); }
.settings-tabs {
  display: flex; gap: 4px; margin: 2px 0 6px;
  border-bottom: 1px solid rgba(var(--accent-rgb),.2);
}
.settings-tabs button {
  flex: 1; border: 0; background: transparent; color: var(--muted-soft);
  font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer;
  padding: 7px 0 8px; border-bottom: 2px solid transparent;
}
.settings-tabs button:hover { color: var(--accent-strong); }
.settings-tabs button.on { color: var(--accent-strong); border-bottom-color: var(--accent); }
.character-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px; }
.character-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 7px 5px 6px; border: 1px solid rgba(var(--accent-rgb),.35); border-radius: 10px;
  background: var(--surface-soft); color: var(--ink-strong); font: inherit; cursor: pointer;
}
.character-card:hover { background: var(--accent-soft); border-color: var(--accent); }
.character-card.on { background: var(--accent-soft-strong); border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.character-thumb { width: 76px; height: 76px; object-fit: contain; filter: drop-shadow(0 3px 4px rgba(var(--shadow-rgb),.16)); }
.character-name { font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.character-check {
  position: absolute; top: 5px; right: 7px; color: var(--accent);
  font-size: 11px; font-weight: 800; opacity: 0;
}
.character-card.on .character-check { opacity: 1; }
.big-money { font-size: 28px; font-weight: 800; color: var(--accent-strong); letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.big-money small { font-size: 12px; font-weight: 600; color: var(--accent-strong); margin-left: 6px; letter-spacing: .4px; }
.sub-money { font-size: 10.5px; color: var(--muted); margin-top: 1px; }
.rows { margin-top: 9px; border-top: 1px dashed rgba(var(--accent-rgb),.3); }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px dashed rgba(var(--accent-rgb),.16); }
.row:last-child { border-bottom: 0; }
.row .k { color: var(--muted); font-size: 11px; flex: none; }
.row .v { color: var(--ink); font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.row .v small { font-weight: 500; color: var(--muted); }
.row.peak-row { cursor: pointer; }
.row.peak-row .v { font-size: 10.5px; }
.peak-hot { color: #e0433f; font-weight: 700; }
.peak-cool { color: #2fa24c; font-weight: 700; }
.peak-countdown { font-weight: 600; }
.tag { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 9.5px; font-weight: 600; background: rgba(var(--accent-rgb),.12); color: var(--accent-strong); margin-left: 4px; vertical-align: 1px; }
.tag.warn { background: rgba(224,67,63,.12); color: #c0392b; }
.section { margin-top: 10px; }
.section-title { font-size: 10.5px; color: var(--muted); margin-bottom: 5px; display: flex; justify-content: space-between; }
.bars { display: flex; align-items: flex-end; gap: 5px; height: 54px; padding: 2px 0 0; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.bar-wrap { width: 100%; height: 40px; display: flex; align-items: flex-end; }
.bar { width: 100%; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg, var(--accent-light), var(--accent)); min-height: 2px; }
.bar.today { background: linear-gradient(180deg, var(--accent-light), var(--accent)); }
.bar-label { font-size: 8.5px; color: var(--muted-soft); white-space: nowrap; }
.model-row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; font-size: 10.5px; color: var(--ink-mid); }
.model-row .m { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-row .c { color: var(--accent-strong); font-variant-numeric: tabular-nums; flex: none; }
.panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.panel-note { font-size: 9.5px; color: var(--muted-soft); line-height: 1.3; }
.btn {
  border: 1.5px solid rgba(var(--accent-rgb),.6); background: var(--surface-soft); color: var(--accent-strong);
  border-radius: 9px; font-size: 11px; font-weight: 700; padding: 4px 10px; cursor: pointer;
  font-family: inherit;
}
.btn:hover { background: var(--accent-soft); border-color: var(--accent); }
.btn:active { transform: translateY(1px); }

/* 二级设置页 */
.panel-head-right { display: flex; align-items: center; gap: 2px; flex: none; }
.panel-icon, .panel-back {
  border: 0; background: transparent; color: var(--muted-soft); cursor: pointer;
  border-radius: 6px; font-family: inherit; line-height: 1;
}
.panel-icon { font-size: 14px; padding: 3px 5px; }
.panel-back { font-size: 10.5px; padding: 4px 6px; }
.panel-icon:hover, .panel-back:hover { background: rgba(var(--accent-rgb),.12); color: var(--accent-strong); }
.set-row { padding: 9px 0; border-bottom: 1px dashed rgba(var(--accent-rgb),.16); }
.set-row:last-of-type { border-bottom: 0; }
.set-row.flex { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.set-text { min-width: 0; }
.set-label { font-size: 11.5px; font-weight: 700; color: var(--ink-strong); }
.set-hint { margin-top: 2px; font-size: 9.5px; line-height: 1.35; color: var(--muted-soft); }
.set-control { flex: none; }
.set-controls { display: flex; align-items: center; gap: 8px; flex: none; }
.set-head-flex { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.set-sub { margin: 0 0 0 4px; padding-left: 10px; border-left: 2px solid rgba(var(--accent-rgb),.18); }
.set-sub .set-row { padding: 7px 0; }
.mini-btn {
  border: 1px solid rgba(var(--accent-rgb),.45); background: var(--surface-soft); color: var(--accent-strong);
  border-radius: 8px; padding: 4px 8px; font: inherit; font-size: 10px;
  cursor: pointer; white-space: nowrap;
}
.mini-btn:hover { background: var(--accent-soft); border-color: var(--accent); }
.mini-btn.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.mini-btn:disabled { opacity: .42; cursor: not-allowed; }
.mini-btn:disabled:hover { background: var(--surface-soft); border-color: rgba(var(--accent-rgb),.45); }
.switch:disabled { opacity: .45; cursor: not-allowed; }
.seg { display: flex; gap: 5px; margin-top: 7px; }
.seg button {
  flex: 1; min-width: 0; border: 1px solid rgba(var(--accent-rgb),.45); background: var(--surface-soft);
  color: var(--accent-strong); border-radius: 8px; padding: 5px 6px; font: inherit; font-size: 10.5px;
  cursor: pointer; white-space: nowrap;
}
.seg button:hover { background: var(--accent-soft); border-color: var(--accent); }
.seg button.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.seg button:disabled { opacity: .42; cursor: not-allowed; }
.seg button:disabled:hover { background: var(--surface-soft); border-color: rgba(var(--accent-rgb),.45); }
.switch {
  position: relative; width: 40px; height: 22px; flex: none; padding: 0; cursor: pointer;
  border-radius: 999px; border: 1.5px solid rgba(var(--ink-rgb), .28); background: rgba(var(--ink-rgb), .14);
  transition: background .18s ease, border-color .18s ease;
}
.switch .knob {
  position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(var(--shadow-rgb), .3);
  transition: left .18s ease;
}
.switch.on { background: var(--accent); border-color: var(--accent); }
.switch.on .knob { left: 20px; }
.set-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; }

/* 右键菜单 */
.menu {
  position: fixed; min-width: 168px; padding: 6px; display: none;
  background: var(--surface); border: 1.5px solid rgba(var(--accent-rgb),.5); border-radius: 12px;
  box-shadow: 0 12px 34px rgba(var(--shadow-rgb),.24); pointer-events: auto; z-index: 2147483001;
  font-size: 12px; color: var(--ink);
}
.menu.open { display: block; }
.menu button {
  display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px;
  border: 0; background: transparent; color: inherit; font: inherit; text-align: left;
  padding: 6px 8px; border-radius: 8px; cursor: pointer;
}
.menu button:hover { background: rgba(var(--accent-rgb),.12); }
.menu .sep { height: 1px; background: rgba(var(--accent-rgb),.18); margin: 5px 6px; }
.menu .check { color: var(--accent); font-weight: 800; opacity: 0; }
.menu button[data-on="1"] .check { opacity: 1; }
.menu .sizes { display: flex; align-items: center; gap: 4px; padding: 4px 8px 6px; }
.menu .sizes span { color: var(--muted); font-size: 11px; margin-right: 2px; }
.menu .sizes button { width: auto; flex: 1; justify-content: center; padding: 3px 0; border: 1px solid rgba(var(--accent-rgb),.35); }
.menu .sizes button[data-on="1"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.menu .ver { padding: 5px 8px 2px; text-align: center; font-size: 9px; color: var(--muted-soft); }

/* 隐藏后的召回按钮 */
.restore {
  position: fixed; right: 16px; bottom: 78px; width: 46px; height: 46px; border-radius: 50%;
  border: 2px solid rgba(var(--accent-rgb),.65); background: var(--surface); cursor: pointer;
  display: none; align-items: center; justify-content: center; pointer-events: auto;
  box-shadow: 0 6px 18px rgba(var(--shadow-rgb),.22); z-index: 2147483000; padding: 0; overflow: hidden;
}
.restore.show { display: flex; }
.restore img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 18%; }
.restore:hover { border-color: var(--accent); transform: scale(1.05); }

@keyframes cp-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes cp-typing { from { transform: translateY(0) } to { transform: translateY(-2.5px) } }
@keyframes cp-panic { 0% { transform: translate(0,0) rotate(0) } 25% { transform: translate(-2px,1px) rotate(-1.2deg) } 50% { transform: translate(2px,0) rotate(1.2deg) } 75% { transform: translate(-1px,-1px) rotate(-.6deg) } 100% { transform: translate(1px,1px) rotate(.6deg) } }
@keyframes cp-hop { 0% { transform: translateY(0) } 38% { transform: translateY(-18px) } 70% { transform: translateY(2px) } 100% { transform: translateY(0) } }
@keyframes cp-dot { 0%, 60%, 100% { opacity: 0 } 30% { opacity: 1 } }
@keyframes cp-zz { 0%, 100% { transform: translateY(0); opacity: .65 } 50% { transform: translateY(-4px); opacity: 1 } }
@keyframes cp-pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb),.55) } 70% { box-shadow: 0 0 0 7px rgba(var(--accent-rgb),0) } 100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb),0) } }
@media (max-width: 780px) {
  .panel { left: 12px; right: 12px; width: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .bob, .bob.anim-typing, .bob.anim-panic, .zz, .badge.pending .pending-dot { animation: none !important; }
}
`

  function build() {
    var host = document.createElement('div')
    host.id = 'dsh-widget-pet-host'
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none;'
    document.body.appendChild(host)
    var shadow = host.attachShadow({ mode: 'open' })
    var style = document.createElement('style')
    style.textContent = CSS
    shadow.appendChild(style)

    var pet = document.createElement('div')
    pet.className = 'pet'
    pet.setAttribute('data-hidden', settings.hidden ? '1' : '0')
    pet.innerHTML =
      '<div class="anchor">' +
        '<div class="shadow"></div>' +
        '<div class="bob">' +
          '<div class="hop">' +
            '<img class="sprite" alt="' + esc(characterName()) + '" draggable="false">' +
          '</div>' +
        '</div>' +
        '<div class="zz">z Z</div>' +
      '</div>' +
      '<div class="bubble" role="status">' +
        '<span class="txt">我来啦～</span><span class="dots"><i>.</i><i>.</i><i>.</i></span>' +
        '<span class="cost-line"></span>' +
      '</div>' +
      '<button class="badge" type="button" title="点击查看余额与用量">' +
        '<span class="bal">余额读取中…</span><span class="sep">·</span><span class="today">今日 —</span>' +
        '<span class="sep peak-sep">·</span><span class="peak-mark"></span>' +
        '<span class="pending-dot"></span>' +
      '</button>' +
      '<div class="panel" role="dialog" aria-label="余额与用量"></div>' +
      '<div class="menu" role="menu"></div>'
    shadow.appendChild(pet)

    var restore = document.createElement('button')
    restore.className = 'restore'
    restore.type = 'button'
    restore.title = '召回 ' + characterName()
    restore.innerHTML = '<img alt="' + esc(characterName()) + '" src="' + thumbUrl() + '" draggable="false">'
    shadow.appendChild(restore)

    el.host = host
    el.shadow = shadow
    el.pet = pet
    el.anchor = pet.querySelector('.anchor')
    el.bob = pet.querySelector('.bob')
    el.hop = pet.querySelector('.hop')
    el.sprite = pet.querySelector('.sprite')
    el.bubble = pet.querySelector('.bubble')
    el.bubbleText = pet.querySelector('.bubble .txt')
    el.dots = pet.querySelector('.dots')
    el.costLine = pet.querySelector('.cost-line')
    el.badge = pet.querySelector('.badge')
    el.bal = pet.querySelector('.badge .bal')
    el.today = pet.querySelector('.badge .today')
    el.peakSep = pet.querySelector('.badge .peak-sep')
    el.peakMark = pet.querySelector('.badge .peak-mark')
    el.panel = pet.querySelector('.panel')
    el.menu = pet.querySelector('.menu')
    el.restore = restore
    el.restoreImg = restore.querySelector('img')

    applyCharacterTheme()
    applySize()
    applyPosition()
    bindEvents()
    renderMenu()

    el.sprite.src = spriteUrl('smile')
    applyDisplaySettings()
    restore.classList.toggle('show', settings.hidden)
    if (!settings.hidden) startPolling()
    // 预热当前角色其余立绘，切换状态时不闪白
    setTimeout(preloadSprites, 900)
  }

  // ------------------------------------------------------------------ 尺寸
  function applySize() {
    var h = SIZES[settings.size] || SIZES.medium
    var w = Math.round(h * 0.73)
    el.pet.style.setProperty('--h', h + 'px')
    el.pet.style.setProperty('--spriteW', w + 'px')
  }

  function currentSpriteKey() {
    return (state.activity && state.activity.sprite) || 'smile'
  }

  function preloadSprites() {
    ;['smile', 'smile-closed', 'typing', 'notes', 'knock', 'confetti', 'panic', 'guilty', 'stone'].forEach(function (n) {
      var im = new Image()
      im.src = spriteUrl(n)
    })
  }

  function applyCharacterTheme() {
    var t = THEMES[settings.character] || THEMES.claude
    var s = el.host.style
    s.setProperty('--accent', t.accent)
    s.setProperty('--accent-strong', t.strong)
    s.setProperty('--accent-light', t.light)
    s.setProperty('--accent-soft', t.soft)
    s.setProperty('--accent-soft-strong', t.softStrong)
    s.setProperty('--surface', t.surface)
    s.setProperty('--surface-soft', t.surfaceSoft)
    s.setProperty('--surface-rgb', t.surfaceRgb)
    s.setProperty('--ink', t.ink)
    s.setProperty('--ink-strong', t.inkStrong)
    s.setProperty('--ink-mid', t.inkMid)
    s.setProperty('--muted', t.muted)
    s.setProperty('--muted-soft', t.mutedSoft)
    s.setProperty('--accent-rgb', t.accentRgb)
    s.setProperty('--ink-rgb', t.inkRgb)
    s.setProperty('--shadow-rgb', t.shadowRgb)
  }

  function applyCharacterSetting(animateSwitch) {
    applyCharacterTheme()
    el.sprite.src = spriteUrl(currentSpriteKey())
    el.sprite.alt = characterName()
    el.restore.title = '召回 ' + characterName()
    el.restoreImg.src = thumbUrl()
    el.restoreImg.alt = characterName()
    if (animateSwitch) playCharacterSwitch()
    preloadSprites()
  }

  // ------------------------------------------------------------------ 位置
  function defaultPos() {
    var w = 276
    var h = (SIZES[settings.size] || 196) + 26 + 118
    return { x: Math.max(8, innerWidth - w - 22), y: Math.max(8, innerHeight - h - 118) }
  }

  function applyPosition() {
    var pos = loadJson(STORAGE_POS, null)
    var p = pos && isFinite(pos.x) && isFinite(pos.y) ? pos : defaultPos()
    p = clampPos(p.x, p.y)
    el.pet.style.right = 'auto'
    el.pet.style.bottom = 'auto'
    el.pet.style.left = p.x + 'px'
    el.pet.style.top = p.y + 'px'
  }

  function clampPos(x, y) {
    var w = (el.pet && el.pet.offsetWidth) || 276
    var h = (el.pet && el.pet.offsetHeight) || ((SIZES[settings.size] || 196) + 26 + 118)
    return {
      x: Math.min(Math.max(0, x), Math.max(0, innerWidth - w)),
      y: Math.min(Math.max(0, y), Math.max(0, innerHeight - h)),
    }
  }

  function savePosition() {
    var rect = el.pet.getBoundingClientRect()
    saveJson(STORAGE_POS, { x: Math.round(rect.left), y: Math.round(rect.top) })
  }

  // ------------------------------------------------------------------ 事件
  function bindEvents() {
    bindHover(el.sprite)
    bindHover(el.bubble)
    bindHover(el.badge)

    // 拖动：按下后超过 4px 才算拖，避免和“点击看面板”冲突
    var drag = null
    el.sprite.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return
      var rect = el.pet.getBoundingClientRect()
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, sx: e.clientX, sy: e.clientY, moved: false }
      state.dragging = false
      state.moved = false
      try { el.sprite.setPointerCapture(e.pointerId) } catch (err) {}
      e.preventDefault()
    })
    el.sprite.addEventListener('pointermove', function (e) {
      if (!drag) return
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 4) return
      drag.moved = true
      state.dragging = true
      el.anchor.classList.add('moving')
      var p = clampPos(e.clientX - drag.dx, e.clientY - drag.dy)
      el.pet.style.left = p.x + 'px'
      el.pet.style.top = p.y + 'px'
    })
    function endDrag(e) {
      if (!drag) return
      var wasMoved = drag.moved
      drag = null
      el.anchor.classList.remove('moving')
      if (wasMoved) {
        savePosition()
        state.moved = true
        state.dragging = false
        setTimeout(function () { state.moved = false }, 60)
      }
      try { el.sprite.releasePointerCapture(e.pointerId) } catch (err) {}
    }
    el.sprite.addEventListener('pointerup', endDrag)
    el.sprite.addEventListener('pointercancel', endDrag)

    el.sprite.addEventListener('click', function (e) {
      if (state.moved) { e.stopPropagation(); return }
      petSquish()
      if (settings.clickPanel) togglePanel()
    })
    el.sprite.addEventListener('contextmenu', function (e) {
      e.preventDefault()
      openMenu(e.clientX, e.clientY)
    })
    el.bubble.addEventListener('click', function (e) {
      e.stopPropagation()
      togglePanel()
    })
    el.badge.addEventListener('click', function (e) {
      e.stopPropagation()
      togglePanel()
    })
    el.badge.addEventListener('contextmenu', function (e) {
      e.preventDefault()
      openMenu(e.clientX, e.clientY)
    })

    el.panel.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-act]') : null
      if (!t) return
      var act = t.getAttribute('data-act')
      if (act === 'close') closePanel()
      if (act === 'refresh') { refreshBalance(true); loadRecords() }
      if (act === 'settings') openPanel('settings')
      if (act === 'back') openPanel('main')
      if (act === 'set-animate') {
        settings.animate = !settings.animate
        saveSettings()
        applyAnimationSetting()
        renderPanel()
      }
      if (act === 'settings-tab') {
        var tabValue = t.getAttribute('data-value')
        state.settingsTab = tabValue === 'sound' ? 'sound' : tabValue === 'character' ? 'character' : 'display'
        renderPanel()
      }
      if (act === 'set-character') {
        var charId = t.getAttribute('data-value')
        if (CHARACTERS.some(function (c) { return c.id === charId })) {
          settings.character = charId
          saveSettings()
          applyCharacterSetting(true)
          renderPanel()
        }
      }
      if (act === 'set-sound') {
        settings.sound = !settings.sound
        saveSettings()
        renderPanel()
      }
      if (act === 'set-event-sound') {
        settings.eventSound = !settings.eventSound
        saveSettings()
        renderPanel()
      }
      if (act === 'set-pinch-sound') {
        settings.pinchSound = !settings.pinchSound
        saveSettings()
        renderPanel()
      }
      if (act === 'set-switch-anim') {
        settings.switchAnim = !settings.switchAnim
        saveSettings()
        renderPanel()
      }
      if (act === 'set-float') {
        settings.floatAnim = !settings.floatAnim
        saveSettings()
        applyAnimationSetting()
        renderPanel()
      }
      if (act === 'set-pet') {
        settings.petAnim = !settings.petAnim
        saveSettings()
        applyAnimationSetting()
        renderPanel()
      }
      if (act === 'set-bubble-anim') {
        settings.bubbleAnim = !settings.bubbleAnim
        saveSettings()
        applyAnimationSetting()
        renderPanel()
      }
      if (act === 'set-font') {
        settings.font = t.getAttribute('data-value') === 'smiley' ? 'smiley' : 'default'
        saveSettings()
        applyFontSetting()
        renderPanel()
      }
      if (act === 'set-font-bubble-only') {
        if (settings.font !== 'smiley') return
        settings.fontBubbleOnly = !settings.fontBubbleOnly
        saveSettings()
        applyFontSetting()
        renderPanel()
      }
      if (act === 'set-click-panel') {
        settings.clickPanel = !settings.clickPanel
        saveSettings()
        renderPanel()
      }
      if (act === 'show-menu') {
        var r = t.getBoundingClientRect()
        renderMenu()
        openMenu(r.left, r.bottom + 6)
      }
      if (act === 'set-bubble-mode') {
        var bm = t.getAttribute('data-value')
        settings.bubbleMode = (bm === 'auto' || bm === 'none') ? bm : 'always'
        saveSettings()
        applyBubbleSetting()
        renderPanel()
      }
      if (act === 'set-badge-mode') {
        var gm = t.getAttribute('data-value')
        settings.badgeMode = (gm === 'auto' || gm === 'none') ? gm : 'always'
        saveSettings()
        applyBadgeSetting()
        renderPanel()
      }
      if (act === 'reset-settings') {
        settings.animate = true
        settings.switchAnim = true
        settings.floatAnim = true
        settings.petAnim = true
        settings.bubbleAnim = true
        settings.sound = true
        settings.eventSound = true
        settings.pinchSound = true
        settings.bubbleMode = 'auto'
        settings.badgeMode = 'always'
        settings.clickPanel = true
        settings.font = 'smiley'
        settings.fontBubbleOnly = true
        settings.fontBubbleOnlyVersion = 1
        saveSettings()
        applyDisplaySettings()
        renderPanel()
      }
    })

    el.menu.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null
      if (!t) return
      var act = t.getAttribute('data-act')
      var size = t.getAttribute('data-size')
      if (size) {
        settings.size = size
        saveSettings()
        applySize()
        applyPosition()
        renderMenu()
        return
      }
      if (act === 'detail') { closeMenu(); openPanel('main') }
      if (act === 'settings') { closeMenu(); openPanel('settings') }
      if (act === 'refresh') { closeMenu(); refreshBalance(true); loadRecords() }
      if (act === 'hide') {
        settings.hidden = true
        saveSettings()
        el.pet.setAttribute('data-hidden', '1')
        el.restore.classList.add('show')
        closeMenu()
        closePanel()
      }
    })

    el.restore.addEventListener('click', function () {
      settings.hidden = false
      saveSettings()
      el.pet.setAttribute('data-hidden', '0')
      el.restore.classList.remove('show')
      applyDisplaySettings()
      startPolling()
    })

    // 点空白处关闭菜单 / 面板
    document.addEventListener('pointerdown', function (e) {
      if (!state.menuOpen && !state.panelOpen) return
      var path = e.composedPath ? e.composedPath() : []
      if (path.indexOf(el.host) !== -1) return
      closeMenu()
      closePanel()
    }, true)

    window.addEventListener('resize', function () {
      var rect = el.pet.getBoundingClientRect()
      var p = clampPos(rect.left, rect.top)
      el.pet.style.left = p.x + 'px'
      el.pet.style.top = p.y + 'px'
      if (location) savePosition()
    })

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - state.lastBalanceAt > BALANCE_MS) refreshBalance(false)
    })
  }

  function saveSettings() { saveJson(STORAGE_SETTINGS, settings) }

  // ------------------------------------------------------------------ 显示设置
  function applyAnimationSetting() {
    var master = !!settings.animate
    el.pet.classList.toggle('no-anim', !master)
    el.pet.classList.toggle('no-float', !(master && settings.floatAnim))
    el.pet.classList.toggle('no-bubble-anim', !(master && settings.bubbleAnim))
  }

  // 点击角色时捏一下：底部为原点做一次压缩 / 回弹（参考小鲸鱼的按压 Q 弹效果）
  function petSquish() {
    if (!settings.animate || !settings.petAnim) return
    var s = el.sprite
    s.classList.remove('pet-squish')
    void s.offsetWidth // 重排，保证连续点击也能重播
    s.classList.add('pet-squish')
    if (settings.sound && settings.pinchSound) play('pinch', 0.5)
    if (state.squishTimer) clearTimeout(state.squishTimer)
    state.squishTimer = setTimeout(function () {
      s.classList.remove('pet-squish')
      state.squishTimer = 0
    }, 380)
  }

  function playCharacterSwitch() {
    if (!settings.animate || !settings.switchAnim) return
    var s = el.sprite
    s.classList.remove('character-switch')
    void s.offsetWidth // 重排，保证连续切换也能重播
    s.classList.add('character-switch')
    if (state.switchTimer) clearTimeout(state.switchTimer)
    state.switchTimer = setTimeout(function () {
      s.classList.remove('character-switch')
      state.switchTimer = 0
    }, 560)
  }

  function refreshBubbleVisibility() {
    var hidden = settings.bubbleMode === 'none' || (state.bubbleAutoHidden && !state.notice)
    el.bubble.classList.toggle('hidden', hidden)
  }

  function clearBubbleTimer() {
    if (state.bubbleHideTimer) { clearTimeout(state.bubbleHideTimer); state.bubbleHideTimer = 0 }
  }

  function scheduleBubbleHide() {
    clearBubbleTimer()
    if (settings.bubbleMode !== 'auto') return
    if (state.notice) return
    if (state.hovering || state.panelOpen) return
    state.bubbleHideTimer = setTimeout(function () {
      state.bubbleHideTimer = 0
      if (state.hovering || state.panelOpen) return
      state.bubbleAutoHidden = true
      refreshBubbleVisibility()
    }, AUTO_HIDE_MS)
  }

  function applyBubbleSetting() {
    if (settings.bubbleMode === 'none') {
      state.bubbleAutoHidden = true
      clearBubbleTimer()
    } else if (settings.bubbleMode === 'auto') {
      state.bubbleAutoHidden = false
      scheduleBubbleHide()
    } else {
      state.bubbleAutoHidden = false
      clearBubbleTimer()
    }
    refreshBubbleVisibility()
  }

  function refreshBadgeVisibility() {
    el.badge.classList.toggle('hidden', settings.badgeMode === 'none' || state.badgeAutoHidden)
  }

  function clearBadgeTimer() {
    if (state.badgeHideTimer) { clearTimeout(state.badgeHideTimer); state.badgeHideTimer = 0 }
  }

  function scheduleBadgeHide() {
    clearBadgeTimer()
    if (settings.badgeMode !== 'auto') return
    if (state.hovering || state.panelOpen) return
    state.badgeHideTimer = setTimeout(function () {
      state.badgeHideTimer = 0
      if (state.hovering || state.panelOpen) return
      state.badgeAutoHidden = true
      refreshBadgeVisibility()
    }, AUTO_HIDE_MS)
  }

  function applyBadgeSetting() {
    if (settings.badgeMode === 'none') {
      state.badgeAutoHidden = true
      clearBadgeTimer()
    } else if (settings.badgeMode === 'auto') {
      state.badgeAutoHidden = false
      scheduleBadgeHide()
    } else {
      state.badgeAutoHidden = false
      clearBadgeTimer()
    }
    refreshBadgeVisibility()
  }

  // 桌面端页面在 dsh-app:// 下用 @font-face URL 取字体可能被跨域/CSP 拦掉；
  // 直接 fetch 字体二进制再注册 FontFace，走的是和 state.json 同一条桥接路径。
  function ensureSmileyFont() {
    if (state.fontFacePromise) return state.fontFacePromise
    if (typeof FontFace !== 'function' || !document.fonts || typeof document.fonts.add !== 'function') {
      return Promise.resolve(null)
    }
    state.fontFacePromise = fetch(API + '/font/smiley-sans.ttf', {
      credentials: 'same-origin',
      cache: 'force-cache',
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.arrayBuffer()
      })
      .then(function (buffer) {
        var face = new FontFace('SmileySans', buffer, { style: 'normal', weight: '400' })
        return face.load().then(function (loaded) {
          document.fonts.add(loaded)
          state.fontFaceReady = true
          return loaded
        })
      })
      .catch(function (err) {
        state.fontFaceError = String((err && err.message) || err)
        try {
          console.warn('[dsh-widget-pet] Smiley Sans 加载失败，使用 @font-face 兜底：' + state.fontFaceError)
        } catch (e) {}
        return null
      })
    return state.fontFacePromise
  }

  function applyFontSetting() {
    var smiley = settings.font === 'smiley'
    var bubbleOnly = smiley && settings.fontBubbleOnly
    var smileyFamily = '"SmileySans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    // 同时写行内样式：不依赖 :host() 选择器，旧版 Chromium / 自定义协议下也稳。
    var family = smiley && !bubbleOnly ? smileyFamily : ''
    el.host.classList.toggle('font-smiley', smiley && !bubbleOnly)
    el.host.classList.toggle('font-smiley-bubble', bubbleOnly)
    el.pet.style.fontFamily = family
    if (el.menu) el.menu.style.fontFamily = family
    el.bubble.style.fontFamily = bubbleOnly ? smileyFamily : ''
    if (smiley) ensureSmileyFont()
  }

  function applyDisplaySettings() {
    applyFontSetting()
    applyAnimationSetting()
    applyBubbleSetting()
    applyBadgeSetting()
  }

  // 鼠标移到角色 / 气泡 / 徽章上时，把自动收起的显示再叫回来。
  function onHoverEnter() {
    state.hovering = true
    if (state.hoverOutTimer) { clearTimeout(state.hoverOutTimer); state.hoverOutTimer = 0 }
    if (settings.bubbleMode === 'auto') {
      state.bubbleAutoHidden = false
      clearBubbleTimer()
      refreshBubbleVisibility()
    }
    if (settings.badgeMode === 'auto') {
      state.badgeAutoHidden = false
      clearBadgeTimer()
      refreshBadgeVisibility()
    }
  }

  function onHoverLeave() {
    if (state.hoverOutTimer) clearTimeout(state.hoverOutTimer)
    state.hoverOutTimer = setTimeout(function () {
      state.hoverOutTimer = 0
      state.hovering = false
      if (settings.bubbleMode === 'auto') {
        state.bubbleAutoHidden = true
        clearBubbleTimer()
        refreshBubbleVisibility()
      }
      if (settings.badgeMode === 'auto') {
        state.badgeAutoHidden = true
        clearBadgeTimer()
        refreshBadgeVisibility()
      }
    }, 160)
  }

  function bindHover(node) {
    if (!node) return
    node.addEventListener('pointerenter', onHoverEnter)
    node.addEventListener('pointerleave', onHoverLeave)
  }

  // ------------------------------------------------------------------ 面板
  function openPanel(view) {
    state.panelOpen = true
    state.panelView = view === 'settings' ? 'settings' : 'main'
    el.panel.classList.add('open')
    el.pet.classList.add('panel-open')
    renderPanel()
    startPeakTicker()
    loadRecords()
  }
  function closePanel() {
    state.panelOpen = false
    state.panelView = 'main'
    stopPeakTicker()
    el.panel.classList.remove('open')
    el.pet.classList.remove('panel-open')
    // 关闭面板后让自动收起的显示重新计时，避免一关面板就什么都不见了。
    if (settings.bubbleMode === 'auto') applyBubbleSetting()
    if (settings.badgeMode === 'auto') applyBadgeSetting()
  }
  function togglePanel() {
    if (state.panelOpen) closePanel()
    else openPanel('main')
  }

  function renderPanel() {
    if (state.panelView === 'settings') { renderSettingsPanel(); return }
    var b = state.balance || {}
    var ok = b.ok !== false && b.totalBalance != null
    var src = b.balanceSource === 'account' ? 'DSH 账号' : b.balanceSource === 'apikey' ? 'API key' : ''
    var html = ''
    html += '<div class="panel-head"><div class="panel-title">' + esc(characterName()) + ' · 余额与用量</div>' +
      '<div class="panel-head-right">' +
        '<button class="panel-icon" data-act="settings" title="设置">⚙</button>' +
        '<button class="panel-close" data-act="close" title="关闭">×</button>' +
      '</div></div>'
    var sym = moneySymbol(b.currency)
    var todaySym = moneySymbol(b.todayUsageCurrency)
    html += '<div class="big-money">' + (ok ? esc(sym + fmtMoney(b.totalBalance)) : '—') +
      '<small>' + (ok ? esc(b.currency || 'CNY') : '') + '</small></div>'
    if (ok) {
      var recharge = b.rechargeBalance != null ? esc(sym + fmtMoney(b.rechargeBalance)) : '—'
      var bonus = b.bonusBalance != null ? esc(sym + fmtMoney(b.bonusBalance)) : '—'
      html += '<div class="sub-money">充值 ' + recharge + ' · 赠金 ' + bonus + '</div>'
    } else if (state.balanceError) {
      html += '<div class="sub-money">' + esc(state.balanceError) + '</div>'
    }
    html += '<div class="rows">'
    var partial = b.accounting && b.accounting.partialDay && String(b.usageSource || '').indexOf('balance') === 0
    html += row('今日已用', esc(todaySym + fmtMoney(b.todayUsage)) +
      (b.usageLabel ? '<small> · ' + esc(b.usageLabel) + '</small>' : '') +
      (partial ? ' <span class="tag warn">部分数据</span>' : ''))
    if (state.records && state.records.today && state.records.today.tokens) {
      html += row('今日Tokens', '<span style="font-size:11px">' + esc(fmtTokens(state.records.today.tokens)) + '</span>')
    }
    if (state.lastTurn) {
      html += row('最近一轮', '¥' + esc(fmtMoney(state.lastTurn.amount, 4)) +
        '<small> · ' + esc(fmtTokens(state.lastTurn.tokens)) + ' tokens</small>')
      html += row('模型', '<span style="font-size:10.5px">' + esc(shortModel(state.lastTurn.model)) + '</span>')
    }
    var peakLeft = peakCountdownText(b)
    html += '<div class="row peak-row" title="悬停显示秒数；点击显示下一次切换时间">' +
      '<span class="k">峰谷</span><span class="v">' + peakLabelHtml(b) +
      (peakLeft ? ' · <span class="peak-countdown">' + esc(peakLeft) + '</span>' : '') +
      '</span></div>'
    if (b.updatedAt) html += row('余额更新', '<span style="font-size:10.5px">' + esc(timeText(Date.parse(b.updatedAt))) +
      (b.stale ? ' <span class="tag warn">缓存</span>' : '') + '</span>')
    if (src) html += row('数据来源', '<span style="font-size:10.5px">' + esc(src) + '</span>')
    if (state.activity && state.activity.sessionName) {
      html += row('当前对话', '<span style="font-size:10.5px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(state.activity.sessionName) + '</span>')
    }
    html += '</div>'

    // 近 7 天柱状
    var rec = state.records
    if (rec && rec.days7 && rec.days7.length) {
      var days = rec.days7.slice().reverse()
      var max = 0
      for (var i = 0; i < days.length; i++) max = Math.max(max, Number(days[i].total) || 0)
      html += '<div class="section"><div class="section-title"><span>近 7 天</span><span>合计 ' +
        esc(moneySymbol(rec.today && rec.today.currency) + fmtMoney(rec.total7)) + '</span></div><div class="bars">'
      for (var j = 0; j < days.length; j++) {
        var d = days[j]
        var val = Number(d.total) || 0
        var hh = max > 0 ? Math.max(3, Math.round((val / max) * 40)) : 3
        var isToday = j === days.length - 1
        var label = String(d.date || '').slice(5)
        html += '<div class="bar-col" title="' + esc(d.date + ' ' + moneySymbol(d.currency) + fmtMoney(val)) + '">' +
          '<div class="bar-wrap"><div class="bar' + (isToday ? ' today' : '') + '" style="height:' + hh + 'px"></div></div>' +
          '<div class="bar-label">' + esc(label) + '</div></div>'
      }
      html += '</div></div>'
    }

    if (rec && rec.today && rec.today.models && rec.today.models.length) {
      html += '<div class="section"><div class="section-title"><span>今日模型</span><span>' +
        esc(rec.today.models.length) + ' 个</span></div>'
      for (var k = 0; k < rec.today.models.length; k++) {
        var m = rec.today.models[k]
        html += '<div class="model-row"><span class="m">' + esc(shortModel(m.model)) + '</span>' +
          '<span class="c">¥' + esc(fmtMoney(m.cost, 4)) + '</span></div>'
      }
      html += '</div>'
    }

    html += '<div class="panel-foot"><div class="panel-note">' +
      (b.usageSource === 'balance-observed' || b.usageSource === 'balance-corrected' || b.usageSource === 'balance-needs-review'
        ? '今日已用按余额下降观测' : '今日已用按本机用量估算') +
      '<br>数据只在本机</div><button class="btn" data-act="refresh">刷新</button></div>'
    el.panel.innerHTML = html
    bindPeakRow()
  }

  function bindPeakRow() {
    var row = el.panel.querySelector('.peak-row')
    if (!row) return
    state.peakHover = row.matches ? row.matches(':hover') : false
    row.addEventListener('mouseenter', function () {
      state.peakHover = true
      updatePeakRow()
    })
    row.addEventListener('mouseleave', function () {
      state.peakHover = false
      updatePeakRow()
    })
    row.addEventListener('click', function () {
      state.peakAbsoluteUntil = Date.now() + 5000
      updatePeakRow()
      if (state.peakAbsoluteTimer) clearTimeout(state.peakAbsoluteTimer)
      state.peakAbsoluteTimer = setTimeout(function () {
        state.peakAbsoluteTimer = 0
        updatePeakRow()
      }, 5100)
    })
    updatePeakRow()
  }

  function updatePeakRow() {
    var node = el.panel && el.panel.querySelector('.peak-countdown')
    if (!node) return
    node.textContent = peakCountdownText(state.balance || {})
  }

  function startPeakTicker() {
    if (state.peakTicker) return
    state.peakTicker = setInterval(updatePeakRow, 500)
  }

  function stopPeakTicker() {
    if (!state.peakTicker) return
    clearInterval(state.peakTicker)
    state.peakTicker = 0
  }

  function renderSettingsPanel() {
    var tab = state.settingsTab === 'sound' ? 'sound' : state.settingsTab === 'character' ? 'character' : 'display'
    var html = ''
    html += '<div class="panel-head"><div class="panel-title">设置</div>' +
      '<div class="panel-head-right">' +
        '<button class="panel-back" data-act="back" title="返回余额与用量">返回</button>' +
        '<button class="panel-close" data-act="close" title="关闭">×</button>' +
      '</div></div>'

    html += '<div class="settings-tabs">' +
      '<button data-act="settings-tab" data-value="character" class="' + (tab === 'character' ? 'on' : '') + '">角色</button>' +
      '<button data-act="settings-tab" data-value="display" class="' + (tab === 'display' ? 'on' : '') + '">显示</button>' +
      '<button data-act="settings-tab" data-value="sound" class="' + (tab === 'sound' ? 'on' : '') + '">声音</button>' +
    '</div>'

    if (tab === 'character') {
      html += '<div class="set-row">' +
        '<div class="set-label">角色</div>' +
        '<div class="set-hint">选择要显示的 AI 娘</div>' +
        '<div class="character-grid">'
      for (var ci = 0; ci < CHARACTERS.length; ci++) {
        var c = CHARACTERS[ci]
        var on = settings.character === c.id
        html += '<button class="character-card' + (on ? ' on' : '') + '" data-act="set-character" data-value="' + c.id + '"' +
          ' title="切换到' + esc(c.name) + '">' +
          '<span class="character-check">✓</span>' +
          '<img class="character-thumb" src="' + thumbUrl(c.id) + '" alt="' + esc(c.name) + '" draggable="false">' +
          '<span class="character-name">' + esc(c.name) + '</span>' +
        '</button>'
      }
      html += '</div></div>'
    } else if (tab === 'display') {
      html += '<div class="set-row flex">' +
        '<div class="set-text"><div class="set-label">启用动画</div></div>' +
        '<div class="set-controls">' +
          '<button class="mini-btn" data-act="show-menu">显示与大小</button>' +
          switchButton('set-animate', settings.animate, false, settings.animate ? '关闭动画' : '启用动画') +
        '</div>' +
      '</div>'

      html += '<div class="set-sub">' +
        subSwitchRow('启用角色切换动画', 'set-switch-anim', settings.switchAnim, !settings.animate) +
        subSwitchRow('启用角色悬浮动画', 'set-float', settings.floatAnim, !settings.animate) +
        subSwitchRow('启用角色捏捏动画', 'set-pet', settings.petAnim, !settings.animate) +
        subSwitchRow('启用对话框动画', 'set-bubble-anim', settings.bubbleAnim, !settings.animate) +
      '</div>'

      html += '<div class="set-row">' +
        '<div class="set-label">对话框显示方式</div>' +
        '<div class="set-hint">自动模式：新对话显示 5 秒后收起；悬停角色可再次显示</div>' +
        '<div class="seg">' +
          segButton('set-bubble-mode', 'auto', '自动', settings.bubbleMode === 'auto') +
          segButton('set-bubble-mode', 'none', '不显示', settings.bubbleMode === 'none') +
          segButton('set-bubble-mode', 'always', '一直显示', settings.bubbleMode === 'always') +
        '</div></div>'

      html += '<div class="set-row">' +
        '<div class="set-label">余额用量气泡显示方式</div>' +
        '<div class="set-hint">自动模式：余额或今日已用变化时显示 5 秒；悬停角色可再次显示</div>' +
        '<div class="seg">' +
          segButton('set-badge-mode', 'auto', '自动', settings.badgeMode === 'auto') +
          segButton('set-badge-mode', 'none', '不显示', settings.badgeMode === 'none') +
          segButton('set-badge-mode', 'always', '一直显示', settings.badgeMode === 'always') +
        '</div></div>'

      html += '<div class="set-row">' +
        '<div class="set-head-flex">' +
          '<div class="set-label">字体</div>' +
          '<button class="mini-btn' +
            (settings.font === 'smiley' && settings.fontBubbleOnly ? ' on' : '') +
            '" data-act="set-font-bubble-only"' +
            (settings.font !== 'smiley' ? ' disabled' : '') +
            ' title="仅在得意黑字体下可用">仅对话框</button>' +
        '</div>' +
        '<div class="set-hint">GitHub@atelier-anchor/smiley-sans 得意黑v2.0.1</div>' +
        '<div class="seg">' +
          segButton('set-font', 'default', '默认字体', settings.font === 'default') +
          segButton('set-font', 'smiley', '得意黑', settings.font === 'smiley') +
        '</div></div>'

      html += '<div class="set-row flex">' +
        '<div class="set-text"><div class="set-label">点击角色显示余额与用量窗口</div></div>' +
        switchButton('set-click-panel', settings.clickPanel, false,
          settings.clickPanel ? '关闭点击角色打开窗口' : '启用点击角色打开窗口') +
      '</div>'
    } else {
      html += '<div class="set-row flex">' +
        '<div class="set-text"><div class="set-label">提示音</div>' +
        '<div class="set-hint">关闭后下面两项都不播放</div></div>' +
        switchButton('set-sound', settings.sound, false, settings.sound ? '关闭提示音' : '启用提示音') +
      '</div>'

      html += '<div class="set-sub">' +
        subSwitchRow('完成 / 出错 / 等待回答提示音', 'set-event-sound', settings.eventSound, !settings.sound) +
        subSwitchRow('捏捏提示音', 'set-pinch-sound', settings.pinchSound, !settings.sound) +
      '</div>'
    }

    html += '<div class="set-footer"><span class="panel-note">设置只保存在本机</span>' +
      '<button class="btn" data-act="reset-settings">恢复默认</button></div>'
    el.panel.innerHTML = html
  }

  function segButton(act, value, label, on, disabled) {
    return '<button data-act="' + act + '" data-value="' + value + '" class="' + (on ? 'on' : '') + '"' +
      (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>'
  }

  function switchButton(act, on, disabled, title) {
    return '<button class="switch' + (on ? ' on' : '') + '" data-act="' + act + '" ' +
      'role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') +
      ' title="' + esc(title) + '"><span class="knob"></span></button>'
  }

  function subSwitchRow(label, act, on, disabled) {
    return '<div class="set-row flex">' +
      '<div class="set-text"><div class="set-label">' + esc(label) + '</div></div>' +
      switchButton(act, on, disabled, label) +
    '</div>'
  }

  function row(k, v) {
    return '<div class="row"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>'
  }

  function loadRecords() {
    fetch(API + '/records.json', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data && data.ok) {
          state.records = data
          if (state.panelOpen && state.panelView === 'main') renderPanel()
        }
      })
      .catch(function () {})
  }

  // ------------------------------------------------------------------ 菜单
  function renderMenu() {
    var m = el.menu
    m.innerHTML =
      '<button data-act="detail"><span>余额与用量</span><span>›</span></button>' +
      '<button data-act="settings"><span>设置</span><span>⚙</span></button>' +
      '<button data-act="refresh"><span>刷新余额</span><span>↻</span></button>' +
      '<div class="sep"></div>' +
      '<div class="sizes"><span>大小</span>' +
        '<button data-size="small" data-on="' + (settings.size === 'small' ? 1 : 0) + '">小</button>' +
        '<button data-size="medium" data-on="' + (settings.size === 'medium' ? 1 : 0) + '">中</button>' +
        '<button data-size="large" data-on="' + (settings.size === 'large' ? 1 : 0) + '">大</button>' +
      '</div>' +
      '<div class="sep"></div>' +
      '<button data-act="hide"><span>隐藏桌宠</span><span>—</span></button>' +
      '<div class="ver">v' + VERSION + '</div>'
    m.classList.remove('open')
    state.menuOpen = false
  }

  function openMenu(x, y) {
    if (!el.menu.classList.contains('open')) renderMenu()
    el.menu.classList.add('open')
    state.menuOpen = true
    var rect = el.menu.getBoundingClientRect()
    var left = Math.min(x, innerWidth - rect.width - 8)
    var top = Math.min(y, innerHeight - rect.height - 8)
    el.menu.style.left = Math.max(8, left) + 'px'
    el.menu.style.top = Math.max(8, top) + 'px'
  }

  function closeMenu() {
    if (!el.menu) return
    el.menu.classList.remove('open')
    state.menuOpen = false
  }

  // ------------------------------------------------------------------ 渲染
  function renderBubbleText() {
    if (state.notice) {
      el.bubbleText.innerHTML = state.notice.html
      el.dots.style.display = 'none'
      return
    }
    var act = state.activity || {}
    var text = String(act.text || '')
    el.bubbleText.textContent = text
    el.dots.style.display = (act.state === 'thinking' && /中$/.test(text)) ? 'inline-block' : 'none'
  }

  function showPeakNotice(price) {
    if (settings.bubbleMode === 'none') return
    var miss = price && price.miss != null ? fmtPrice(price.miss) : '2'
    var out = price && price.out != null ? fmtPrice(price.out) : '8'
    state.notice = {
      html: '<span class="notice-title">高峰时段</span>' +
        '<span class="notice-price">输入 ¥' + esc(miss) + ' · 输出 ¥' + esc(out) + ' / 百万 tokens</span>',
    }
    if (state.noticeTimer) clearTimeout(state.noticeTimer)
    el.bubble.classList.add('notice')
    el.bubble.classList.remove('has-cost')
    state.bubbleAutoHidden = false
    clearBubbleTimer()
    refreshBubbleVisibility()
    renderBubbleText()
    state.noticeTimer = setTimeout(clearPeakNotice, 10000)
  }

  function clearPeakNotice() {
    if (state.noticeTimer) { clearTimeout(state.noticeTimer); state.noticeTimer = 0 }
    state.notice = null
    el.bubble.classList.remove('notice')
    renderBubbleText()
    if (settings.bubbleMode === 'auto') applyBubbleSetting()
    else refreshBubbleVisibility()
  }

  function setActivity(act) {
    if (!act) return
    var prev = state.activity
    var stateChanged = !prev || prev.state !== act.state
    var textChanged = !prev || prev.text !== act.text
    state.activity = act
    el.pet.setAttribute('data-state', act.state || 'waiting')

    if (el.sprite.getAttribute('src') !== spriteUrl(act.sprite || 'smile')) {
      el.sprite.src = spriteUrl(act.sprite || 'smile')
    }

    renderBubbleText()

    var cls = 'bob'
    if (act.state === 'tool') cls += ' anim-typing'
    else if (act.state === 'error') cls += ' anim-panic'
    else if (act.state === 'stone') cls += ' anim-none'
    else if (act.state === 'celebrate') cls += ' anim-confetti'
    if (el.bob.className !== cls) el.bob.className = cls

    if ((stateChanged || textChanged) && !state.firstState) {
      if (stateChanged) hop()
      // 自动隐藏模式下，每次状态 / 台词变化都重新显示 5 秒。
      if (settings.bubbleMode === 'auto') {
        state.bubbleAutoHidden = false
        clearBubbleTimer()
        refreshBubbleVisibility()
        scheduleBubbleHide()
      }
    }
    el.badge.classList.toggle('pending', !!act.pending)
    if (act.pending) {
      el.badge.title = act.pending.kind === 'approval' ? '等待授权' : '等待回答'
    } else {
      el.badge.title = '点击查看余额与用量'
    }
  }

  function hop() {
    el.hop.classList.remove('jump')
    // 强制重排后再加，保证连续换状态也能重播
    void el.hop.offsetWidth
    el.hop.classList.add('jump')
    setTimeout(function () { el.hop.classList.remove('jump') }, 360)
  }

  function setBalance(b) {
    if (!b) return
    var prev = state.balance
    state.balance = b
    state.lastBalanceAt = Date.now()
    state.balanceError = b.ok === false ? (b.error || '余额读取失败') : null
    var ok = b.ok !== false && b.totalBalance != null
    el.bal.textContent = ok ? moneySymbol(b.currency) + fmtMoney(b.totalBalance) : '余额 —'
    el.today.textContent = '今日 ' + moneySymbol(b.todayUsageCurrency) + fmtMoney(b.todayUsage)
    var peakState = b.isPeak === true ? 'peak' : b.isPeak === false ? 'valley' : ''
    if (peakState) {
      el.peakMark.textContent = peakState === 'peak' ? '峰' : '谷'
      el.peakMark.className = 'peak-mark ' + peakState
      el.peakSep.style.display = ''
    } else {
      el.peakMark.textContent = ''
      el.peakMark.className = 'peak-mark'
      el.peakSep.style.display = 'none'
    }
    var peakTitle = peakState === 'peak' ? ' · 高峰时段' : peakState === 'valley' ? ' · 空闲时段' : ''
    el.badge.classList.toggle('offline', !ok)
    el.badge.title = (ok
      ? '余额更新于 ' + timeText(Date.parse(b.updatedAt)) + ' · 点击查看明细'
      : (b.error || '余额读取失败') + ' · 点击查看明细') + peakTitle
    // 状态轮询每秒都会带余额快照；只有数字变化时才重绘面板，避免滚动位置被重置。
    var valueChanged = !prev || prev.totalBalance !== b.totalBalance || prev.todayUsage !== b.todayUsage || prev.ok !== b.ok
    var changed = valueChanged || prev.updatedAt !== b.updatedAt || prev.isPeak !== b.isPeak
    if (valueChanged && settings.badgeMode === 'auto') {
      state.badgeAutoHidden = false
      clearBadgeTimer()
      refreshBadgeVisibility()
      scheduleBadgeHide()
    }
    if (state.panelOpen && changed && state.panelView === 'main') renderPanel()
  }

  function showCost(turn) {
    if (!turn || !turn.amount) return
    if (state.notice) return
    el.costLine.textContent = '本轮 ¥' + fmtMoney(turn.amount, 4) + ' · ' + fmtTokens(turn.tokens) + ' tokens'
    el.bubble.classList.add('has-cost')
    clearTimeout(state.costTimer)
    state.costTimer = setTimeout(function () { el.bubble.classList.remove('has-cost') }, 8000)
  }

  // ------------------------------------------------------------------ 轮询
  function startPolling() {
    if (pollTimer) return
    pollOnce()
    pollTimer = setInterval(pollOnce, POLL_MS)
    refreshBalance(false)
    if (!balanceTimer) balanceTimer = setInterval(function () { refreshBalance(false) }, BALANCE_MS)
  }

  function pollOnce() {
    if (document.hidden && state.fails > 2) return
    fetch(API + '/state.json', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(function (st) {
        if (!st || !st.ok) throw new Error('bad state')
        state.fails = 0
        state.online = true
        applyState(st)
      })
      .catch(function () {
        state.fails += 1
        if (state.fails >= 3) {
          state.online = false
          el.badge.classList.add('offline')
          if (!state.balance) {
            el.bal.textContent = '连接中断'
            el.today.textContent = ''
          }
        }
      })
  }

  function applyState(st) {
    setActivity(st.activity)
    if (st.balance) setBalance(st.balance)
    else if (st.balanceError) {
      state.balanceError = st.balanceError
      el.bal.textContent = '余额 —'
      el.badge.classList.add('offline')
    }

    var peak = st.isPeak === true || (st.balance && st.balance.isPeak === true)
    if (peak && state.lastPeak !== true) showPeakNotice(st.price)
    state.lastPeak = peak

    // 第一次状态只“对齐序号”，不补播旧提示音 / 旧消费
    if (state.firstState) {
      state.firstState = false
      state.lastEventSeq = st.event ? st.event.seq : 0
      state.lastTurnSeq = st.lastTurn ? st.lastTurn.seq : 0
      state.lastTurn = st.lastTurn || null
      return
    }

    var ev = st.event
    if (ev && ev.seq > state.lastEventSeq) {
      state.lastEventSeq = ev.seq
      if (settings.sound && settings.eventSound && !settings.hidden) {
        if (ev.kind === 'error') play('error', 0.55)
        else if (ev.kind === 'done' || ev.kind === 'question' || ev.kind === 'approval') play('done', ev.kind === 'done' ? 0.5 : 0.42)
      }
      if (ev.kind === 'done') {
        // 余额扣减通常落后于 turn/end，等几秒再强刷两次
        setTimeout(function () { refreshBalance(true) }, 4000)
        setTimeout(function () { refreshBalance(true) }, 15000)
      }
    }

    if (st.lastTurn && st.lastTurn.seq > state.lastTurnSeq) {
      state.lastTurnSeq = st.lastTurn.seq
      state.lastTurn = st.lastTurn
      showCost(st.lastTurn)
      if (state.panelOpen && state.panelView === 'main') renderPanel()
    } else if (st.lastTurn) {
      state.lastTurn = st.lastTurn
    }
  }

  function refreshBalance(force) {
    if (balanceAbort) {
      if (!force) return
      try { balanceAbort.abort() } catch (e) {}
    }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null
    balanceAbort = ctrl
    var timer = setTimeout(function () { try { ctrl && ctrl.abort() } catch (e) {} }, 25000)
    fetch(API + '/balance.json' + (force ? '?refresh=1' : ''), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) { return r.json() })
      .then(function (b) { if (b) setBalance(b) })
      .catch(function () {
        if (!state.balance) {
          el.bal.textContent = '余额读取失败'
          el.badge.classList.add('offline')
        }
      })
      .finally(function () {
        clearTimeout(timer)
        if (balanceAbort === ctrl) balanceAbort = null
      })
  }

  function play(kind, volume) {
    try {
      var a = audio[kind]
      if (!a) {
        // pinch 使用小鲸鱼挂件的按压 mp3，其余仍是随包的 wav
        var ext = kind === 'pinch' ? 'mp3' : 'wav'
        a = audio[kind] = new Audio(API + '/sound/' + kind + '.' + ext)
        a.preload = 'auto'
      }
      a.volume = Math.max(0, Math.min(1, volume == null ? 0.5 : volume))
      try { a.currentTime = 0 } catch (e) {}
      var p = a.play()
      if (p && p.catch) p.catch(function () {})
    } catch (e) {}
  }

  // ------------------------------------------------------------------ 启动
  function start() {
    if (started) return
    started = true
    try {
      build()
    } catch (err) {
      // 挂件自身出错绝不能影响 DSH 页面
      try { console.warn('[dsh-widget-pet] init failed', err) } catch (e) {}
    }
  }

  waitForChat()
})()
