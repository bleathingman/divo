// ============================================================
// DIVO BROWSER — renderer/app.js
// ============================================================

window.onerror = (msg, src, line, col, err) => {
  const txt = `${msg} @ ${src}:${line}:${col}\n${err?.stack || ''}`
  console.error('[CRASH]', txt)
  try { window.bridge.rendererLog('onerror: ' + txt) } catch {}
}
window.addEventListener('unhandledrejection', e => {
  const txt = e.reason?.stack || String(e.reason)
  console.error('[UNHANDLED PROMISE]', txt)
  try { window.bridge.rendererLog('unhandledrejection: ' + txt) } catch {}
})

document.getElementById('btn-close').addEventListener('click', () => window.bridge.close())
document.getElementById('btn-minimize').addEventListener('click', () => window.bridge.minimize())
document.getElementById('btn-maximize').addEventListener('click', () => window.bridge.maximize())

const NEWTAB_URL = window.bridge.newtabUrl
const SETTINGS_URL = window.bridge.settingsUrl

// ── DOM
const webview = document.getElementById('webview')

// SEC-307 — fallback favicon : masque les <img> cassées sans onerror inline (bloqué par CSP)
document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') e.target.style.display = 'none'
}, true)
const updateBar           = document.getElementById('update-bar')
const updateMsg           = document.getElementById('update-msg')
const updateInstallBtn    = document.getElementById('update-install-btn')
const updateDismissBtn    = document.getElementById('update-dismiss-btn')
const defaultBrowserBar   = document.getElementById('default-browser-bar')
const defaultBrowserSet   = document.getElementById('default-browser-set')
const defaultBrowserDismiss = document.getElementById('default-browser-dismiss')
const miniPlayer       = document.getElementById('mini-player')
const miniPlayerFav    = document.getElementById('mini-player-favicon')
const miniPlayerTitle  = document.getElementById('mini-player-title')
const urlInput      = document.getElementById('url-input')
const btnBack       = document.getElementById('btn-back')
const btnForward    = document.getElementById('btn-forward')
const btnReload     = document.getElementById('btn-reload')
const btnMute       = document.getElementById('btn-mute')
const essentialsList = document.getElementById('essentials-list')
const tabsList      = document.getElementById('tabs-list')
const archiveList      = document.getElementById('archive-list')
const archiveSection   = document.getElementById('archive-section')
const favoritesList    = document.getElementById('favorites-list')
const favoritesSection = document.getElementById('favorites-section')
const spacesList    = document.getElementById('spaces-list')
const contextMenu   = document.getElementById('context-menu')
const progressBar   = document.getElementById('progress-bar')
const findBar       = document.getElementById('find-bar')
const findInput     = document.getElementById('find-input')
const findCount     = document.getElementById('find-count')
const historyPanel  = document.getElementById('history-panel')
const dlBar         = document.getElementById('dl-bar')
const dlList        = document.getElementById('dl-list')
const tabsSection   = document.querySelector('.tabs-section')
const sidebar       = document.querySelector('.sidebar')
const topUrlInput   = document.getElementById('top-url-input')
const topBtnBack    = document.getElementById('top-btn-back')
const topBtnForward = document.getElementById('top-btn-forward')
const topBtnReload  = document.getElementById('top-btn-reload')
const topBtnMute    = document.getElementById('top-btn-mute')
const topTabsList   = document.getElementById('top-tabs-list')
const permBar       = document.getElementById('permission-bar')
const permText      = document.getElementById('perm-text')
const appName       = document.getElementById('app-name')

// ── Icônes
const ICON_RELOAD = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`
const ICON_STOP   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
const ICON_AUDIO  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
const ICON_MUTED  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`
const ICON_LOCK   = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`

const ICO = {
  rename:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  pin:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  bookmark: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
  sleep:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
  openTab:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
  close:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  folder:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
  folderUp: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="12 12 12 8"></polyline><polyline points="10 10 12 8 14 10"></polyline></svg>`,
}

const SPACE_COLORS = ['#0a84ff', '#34c759', '#ff9f0a', '#bf5af2', '#ff453a', '#ff6b35', '#30d158', '#64d2ff']

// SEC-002 — helper anti-XSS pour innerHTML
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
// Valide une URL de favicon — n'autorise que http/https/data pour éviter les injections
// via src="javascript:..." ou src='" onerror="...' dans les innerHTML
function safeFavicon(u) {
  if (!u) return ''
  try {
    const p = new URL(u).protocol
    if (p !== 'http:' && p !== 'https:' && p !== 'data:') return ''
    return escapeHtml(u)
  } catch { return '' }
}
// Valide les URLs chargées depuis localStorage — bloque javascript:, data:, chrome:, etc.
const SAFE_TAB_PROTOS = new Set(['http:', 'https:', 'divo:', 'file:'])
function safeTabUrl(u) {
  if (!u) return NEWTAB_URL
  try {
    if (SAFE_TAB_PROTOS.has(new URL(u).protocol)) return u
  } catch {}
  return NEWTAB_URL
}
// Valide une couleur CSS avant interpolation dans style="..." ou .style.prop
// Accepte : #hex, rgb(), rgba(), hsl(), et noms CSS (blue, red…)
const CSS_COLOR_RE = /^#[0-9a-f]{3,8}$|^rgba?\([\d.,\s/%]+\)$|^hsla?\([\d.,\s/%]+\)$|^[a-z]{2,30}$/i
function safeColor(c) { return CSS_COLOR_RE.test(String(c || '')) ? c : '#0a84ff' }

function wv() {
  const key = activeEssentialId || activeTabId
  return (key && pageWebviews.get(key)) || webview
}

// ── Virtual list — rend uniquement les items visibles
const ITEM_H = 30

class VirtualList {
  constructor(scrollEl, listEl) {
    this.scrollEl = scrollEl
    this.listEl   = listEl
    this.items    = []
    this.buildFn  = null
    this._raf     = null
    this._key     = ''
    scrollEl.addEventListener('scroll', () => {
      if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this._flush() })
    }, { passive: true })
  }

  update(items, buildFn) {
    this.items   = items
    this.buildFn = buildFn
    this._key    = ''   // toujours forcer le re-render des items visibles
    this._flush()
  }

  _flush() {
    const n = this.items.length
    if (!n) { this.listEl.style.cssText = ''; this.listEl.replaceChildren(); return }
    const scrollTop = this.scrollEl.scrollTop
    const viewH     = this.scrollEl.clientHeight || 400
    const start     = Math.max(0, Math.floor(scrollTop / ITEM_H) - 5)
    const end       = Math.min(n, Math.ceil((scrollTop + viewH) / ITEM_H) + 5)
    const key       = `${start}:${end}:${n}`
    if (key === this._key) return
    this._key = key
    this.listEl.style.cssText = `position:relative;height:${n * ITEM_H}px`
    const frag = document.createDocumentFragment()
    for (let i = start; i < end; i++) {
      const el = this.buildFn(this.items[i])
      el.style.cssText = `position:absolute;top:${i * ITEM_H}px;left:0;right:0;height:${ITEM_H}px`
      frag.appendChild(el)
    }
    this.listEl.replaceChildren(frag)
  }
}

const DEFAULT_ESSENTIALS = [
  { id: 'e1', title: 'Google',  url: 'https://www.google.com',  favicon: 'https://www.google.com/favicon.ico' },
  { id: 'e2', title: 'YouTube', url: 'https://www.youtube.com', favicon: 'https://www.youtube.com/favicon.ico' },
  { id: 'e3', title: 'GitHub',  url: 'https://github.com',      favicon: 'https://github.com/favicon.ico' },
]

// ── Virtual list pour les onglets (seule liste pouvant devenir très longue)
const tabsVL = new VirtualList(tabsSection, tabsList)

// ── État
let essentials      = []
let favorites       = []
let tabs            = []
let spaces          = []
let activeTabId     = null
let activeSpaceId   = null
let activeEssentialId = null
let closedTabs      = []
let archiveTimer    = null
let webviewReady    = false
let isLoading       = false
let saveTimer       = null
let essClickTimer   = null
let ctxTargetId     = null
let ctxType         = null
let zoomLevel       = 1.0
let progressTimer   = null
let historyData     = []
let sidebarVisible  = true
let focusMode       = false
let downloads       = new Map()
let dragId          = null
let dragType        = null
let isResizing      = false
let resizeStartX    = 0
let resizeStartW    = 0
let globalMuted     = false
let globalPlaying   = false
let mediaTabId        = null   // onglet qui joue actuellement
let mediaEssentialId  = null   // essential qui joue actuellement
let pendingPermKey  = null

// Pool de webviews — une par onglet/essential, max MAX_POOL vivantes simultanément
const pageWebviews = new Map()
const MAX_POOL = 12
let currentTheme    = 'dark'
let currentLayout   = 'sidebar'


// ============================================================
// HELPERS
// ============================================================

function stripSlash(u) { return (u || '').replace(/\/+$/, '') }
// Comparaison stricte sur le protocole divo: — les includes() sur .html étaient bypassables
// par n'importe quelle page externe hébergée à une URL contenant "newtab.html" etc.
function isSpecial(url) {
  try { const u = new URL(url); return u.protocol === 'divo:' && ['newtab','settings','dino','extensions'].includes(u.hostname) }
  catch { return !url }
}
function isNewtab(url)   { try { const u = new URL(url); return u.protocol === 'divo:' && u.hostname === 'newtab'   } catch { return !url } }
function isSettings(url)    { try { const u = new URL(url); return u.protocol === 'divo:' && u.hostname === 'settings'   } catch { return false } }
function isDino(url)        { try { const u = new URL(url); return u.protocol === 'divo:' && u.hostname === 'dino'       } catch { return false } }
function isExtensions(url)  { try { const u = new URL(url); return u.protocol === 'divo:' && u.hostname === 'extensions' } catch { return false } }
function displayUrl(url) { return isSpecial(url) ? '' : url }

function getActiveTabs()   { return tabs.filter(t => t.spaceId === activeSpaceId && !t.archived) }
function getArchivedTabs() { return tabs.filter(t => t.spaceId === activeSpaceId && t.archived) }

function getSearchUrl(query) {
  const engine  = localStorage.getItem('divo-search-engine') || 'google'
  const engines = {
    google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=', qwant: 'https://www.qwant.com/?q=',
    brave: 'https://search.brave.com/search?q=',
  }
  return (engines[engine] || engines.google) + encodeURIComponent(query)
}

function getHomepageUrl() {
  const hp = localStorage.getItem('divo-homepage') || 'newtab'
  if (hp === 'google') return 'https://www.google.com'
  if (hp === 'duckduckgo') return 'https://duckduckgo.com'
  return NEWTAB_URL
}

function getArchiveThreshold() {
  const map = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '3d': 259200000, '7d': 604800000 }
  return map[localStorage.getItem('divo-auto-archive')] || 0
}

function activeTabIsPrivate() {
  if (activeEssentialId) return false
  return tabs.find(t => t.id === activeTabId)?.private || false
}

function updatePrivateUI() {
  const priv = activeTabIsPrivate()
  document.body.classList.toggle('private-active', priv)
  appName.textContent = priv ? 'Navigation privée' : 'Divo'
  appName.classList.toggle('private', priv)
}


// ============================================================
// PERSISTENCE
// ============================================================

function getCurrentState() {
  const curSpace = spaces.find(s => s.id === activeSpaceId)
  if (curSpace) curSpace.activeTabId = activeTabId
  return {
    essentials,
    favorites,
    tabs:             tabs.filter(t => !t.private),
    spaces,
    activeSpaceId:    activeSpaceId    || '',
    activeEssentialId: activeEssentialId || '',
  }
}

// Exposé globalement pour la sauvegarde synchrone à la fermeture (main.js)
window.__getState = () => JSON.stringify(getCurrentState())

function saveState() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const s = getCurrentState()
      localStorage.setItem('arc-essentials',   JSON.stringify(s.essentials))
      localStorage.setItem('arc-favorites',    JSON.stringify(s.favorites))
      localStorage.setItem('arc-tabs',         JSON.stringify(s.tabs))
      localStorage.setItem('arc-spaces',       JSON.stringify(s.spaces))
      localStorage.setItem('arc-active-space', s.activeSpaceId)
      localStorage.setItem('arc-active-ess',   s.activeEssentialId)
      window.bridge.stateSave(s).catch(() => {})
    } catch {}
  }, 400)
}

function loadState() {
  // Priorité : state.json chargé synchronement via preload → localStorage (migration)
  const file = window.bridge.initState ? JSON.parse(JSON.stringify(window.bridge.initState)) : null

  const VERSION = '3'
  if (!file && localStorage.getItem('arc-version') !== VERSION) {
    localStorage.clear(); localStorage.setItem('arc-version', VERSION)
  }

  const gj = k => { try { if (file) return file[k] ?? null; const v = localStorage.getItem('arc-' + k); return v ? JSON.parse(v) : null } catch { return null } }

  try {
    // Spaces
    const ss = gj('spaces')
    spaces = ss || []
    if (!spaces.length) spaces = [{ id: 'sp_default', name: 'Principal', color: SPACE_COLORS[0], activeTabId: null }]
    activeSpaceId = (file ? file.activeSpaceId : (localStorage.getItem('arc-active-space') || '')) || spaces[0].id
    if (!spaces.find(s => s.id === activeSpaceId)) activeSpaceId = spaces[0].id

    // Essentials
    const se = gj('essentials')
    essentials = se ? se.map(e => ({
      ...e,
      url:     safeTabUrl(e.url),
      favicon: safeFavicon(e.favicon) || null,
    })) : structuredClone(DEFAULT_ESSENTIALS)

    // Favorites — migration: ajoute spaceId si absent
    const sf = gj('favorites')
    favorites = sf ? sf.map(f => ({
      ...f,
      url:     safeTabUrl(f.url),
      favicon: safeFavicon(f.favicon) || null,
      spaceId: f.spaceId || spaces[0].id,
    })) : []

    // Tabs — migrate legacy tabs without spaceId / lastUsed
    const parsed = gj('tabs') || []
    tabs = parsed.map(t => ({
      ...t,
      url:      safeTabUrl(t.url),
      favicon:  safeFavicon(t.favicon) || null,
      spaceId:  t.spaceId  || spaces[0].id,
      lastUsed: t.lastUsed || Date.now(),
      archived: t.archived || false,
      scrollY:  t.scrollY  || 0,
      unloaded: t.unloaded || false,
      playing:  false,   // toujours réinitialiser au démarrage
    }))
    if (!tabs.length) {
      tabs = [{ id: 't_default', title: 'Nouvel onglet', url: NEWTAB_URL, favicon: null, spaceId: spaces[0].id, lastUsed: Date.now(), archived: false }]
    }

    // Active state
    const sae = file ? file.activeEssentialId : localStorage.getItem('arc-active-ess')
    const curSpace = spaces.find(s => s.id === activeSpaceId)
    if (sae && essentials.find(e => e.id === sae)) {
      activeEssentialId = sae; activeTabId = null
    } else {
      const activeTabs = getActiveTabs()
      const savedTabId = curSpace?.activeTabId || localStorage.getItem('arc-active-tab')
      activeTabId = (savedTabId && activeTabs.find(t => t.id === savedTabId))
        ? savedTabId
        : activeTabs[0]?.id || null
      if (!activeTabId) {
        const newTab = { id: 't' + Date.now(), title: 'Nouvel onglet', url: NEWTAB_URL, favicon: null, spaceId: activeSpaceId, lastUsed: Date.now(), archived: false }
        tabs.push(newTab); activeTabId = newTab.id
      }
    }
  } catch {
    spaces = [{ id: 'sp_default', name: 'Principal', color: SPACE_COLORS[0], activeTabId: null }]
    activeSpaceId = spaces[0].id
    essentials = structuredClone(DEFAULT_ESSENTIALS)
    tabs = [{ id: 't_default', title: 'Nouvel onglet', url: NEWTAB_URL, favicon: null, spaceId: activeSpaceId, lastUsed: Date.now(), archived: false }]
    activeTabId = 't_default'
  }
  const savedTheme = localStorage.getItem('divo-theme')
  if (savedTheme === 'light') applyTheme('light')
  const savedLayout = localStorage.getItem('divo-layout')
  if (savedLayout) { currentLayout = savedLayout; document.body.classList.toggle('layout-top', savedLayout === 'top') }
}

function syncUrlBars(val) {
  urlInput.value    = val
  topUrlInput.value = val
}

function renderTopTabs() {
  if (currentLayout !== 'top') return
  const frag = document.createDocumentFragment()
  for (const t of getActiveTabs()) {
    const li = document.createElement('li')
    li.className = 'top-tab' + (t.id === activeTabId ? ' active' : '') + (t.unloaded ? ' unloaded' : '')
    li.dataset.id = t.id
    const fav = safeFavicon(t.favicon)
      ? `<img class="top-tab-favicon" src="${safeFavicon(t.favicon)}" draggable="false">`
      : `<div class="top-tab-fav-placeholder"></div>`
    li.innerHTML = `${fav}<span class="top-tab-title">${escapeHtml(t.title) || 'Nouvel onglet'}</span><button class="top-tab-close" data-close="${t.id}">✕</button>`
    frag.appendChild(li)
  }
  topTabsList.replaceChildren(frag)
}

function applyLayout(layout) {
  currentLayout = layout
  document.body.classList.toggle('layout-top', layout === 'top')
  localStorage.setItem('divo-layout', layout)
  renderTabs()
}

function applyTheme(theme) {
  currentTheme = theme
  document.documentElement.classList.toggle('light', theme === 'light')
  document.body.classList.toggle('light', theme === 'light')
  localStorage.setItem('divo-theme', theme)
  window.bridge.setTheme(theme)
}

// ============================================================
// POOL DE WEBVIEWS
// ============================================================

function evictLRU(skipKey) {
  let oldest = null, oldestTime = Infinity
  for (const k of pageWebviews.keys()) {
    if (k === skipKey) continue
    const item = tabs.find(t => t.id === k) || essentials.find(e => e.id === k)
    const ts = item?.lastUsed || 0
    if (ts < oldestTime) { oldestTime = ts; oldest = k }
  }
  if (!oldest) return
  const el = pageWebviews.get(oldest)
  if (el) { try { el.src = 'about:blank' } catch {} el.remove() }
  pageWebviews.delete(oldest)
  const tab = tabs.find(t => t.id === oldest)
  if (tab) { tab.unloaded = true; renderTabs() }
}

function allocWebview(key) {
  if (pageWebviews.size >= MAX_POOL) evictLRU(key)
  const el = document.createElement('webview')
  el.setAttribute('allowpopups', '')
  el.setAttribute('disableblinkfeatures', 'AuxClick')
  const tab = tabs.find(t => t.id === key)
  el.setAttribute('partition', tab?.private ? 'private:incognito' : 'persist:divo')
  el.__key   = key
  el.__ready = false
  el.style.display = 'none'
  document.querySelector('.content').appendChild(el)
  wireWebviewEvents(el)
  pageWebviews.set(key, el)
  return el
}

function wireWebviewEvents(el) {
  el.__ready = false

  el.addEventListener('dom-ready', () => {
    el.__ready = true
    if (el === wv()) { webviewReady = true; updateNavButtons() }
    const domUrl = el.getURL()
    if (!domUrl || domUrl === 'about:blank') return
    // Empêcher les sites de détecter qu'ils sont en arrière-plan (évite YouTube qui se met en pause)
    el.executeJavaScript(
      'try{Object.defineProperty(document,"hidden",{get:()=>false,configurable:true});' +
      'Object.defineProperty(document,"visibilityState",{get:()=>"visible",configurable:true})}catch(e){}'
    ).catch(() => {})
  })

  el.addEventListener('did-start-loading', () => {
    if (el !== wv()) return
    isLoading = true; btnReload.innerHTML = ICON_STOP; btnReload.title = 'Arrêter'; startProgress()
  })

  el.addEventListener('did-stop-loading', () => {
    if (el !== wv()) return
    isLoading = false; btnReload.innerHTML = ICON_RELOAD; btnReload.title = 'Recharger'
    completeProgress(); updateNavButtons()
    const url = el.getURL()
    if (isNewtab(url)) {
      const engine = localStorage.getItem('divo-search-engine') || 'google'
      el.executeJavaScript(`
        window.__divoEngine = ${JSON.stringify(engine)};
        localStorage.setItem('divo-theme', ${JSON.stringify(currentTheme)});
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(currentTheme)});
      `).catch(() => {})
      // Focus le webview (nécessaire pour que le clavier soit capté),
      // puis focus l'input à l'intérieur
      el.focus()
      try { window.bridge.focusWebview(el.getWebContentsId()) } catch {}
      setTimeout(() => {
        el.executeJavaScript(
          '(function(){var s=document.getElementById("search");if(s){s.focus();s.select();}})()'
        ).catch(() => {})
      }, 80)
    }
    if (isSettings(url)) {
      el.executeJavaScript(`
        localStorage.setItem('divo-theme', ${JSON.stringify(currentTheme)});
        const t = document.getElementById('theme-select');
        if (t) t.value = ${JSON.stringify(currentTheme)};
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(currentTheme)});
        const l = document.getElementById('layout-select');
        if (l) l.value = ${JSON.stringify(currentLayout)};
      `).catch(() => {})
    }
    if (!isSpecial(url)) {
      const tab = tabs.find(t => t.id === el.__key)
      addToHistory(url, el.getTitle(), tab?.favicon || null)
      if (tab?._resumeScroll && tab.scrollY > 0) {
        tab._resumeScroll = false
        const y = Math.round(tab.scrollY)
        setTimeout(() => el.executeJavaScript(`window.scrollTo(0,${y})`).catch(() => {}), 200)
      } else if (tab) {
        tab._resumeScroll = false
      }
    }
  })

  el.addEventListener('did-navigate', e => {
    // Mise à jour URL même pour les onglets en arrière-plan
    const tab = tabs.find(t => t.id === el.__key)
    if (tab && !isSpecial(e.url)) {
      if (tab.url !== e.url) { tab.scrollY = 0; tab._resumeScroll = false }
      tab.url = e.url; saveState()
    }
    // Persistence URL pour les essentials
    const ess = essentials.find(x => x.id === el.__key)
    if (ess && !isSpecial(e.url)) { ess.url = e.url; saveState() }

    // Initialisation settings — toujours, peu importe si actif ou non
    if (isSettings(e.url)) {
      setTimeout(async () => {
        const se  = localStorage.getItem('divo-search-engine') || 'google'
        const hp  = localStorage.getItem('divo-homepage')      || 'newtab'
        const ss  = localStorage.getItem('divo-save-session')  || 'yes'
        const aa  = localStorage.getItem('divo-auto-archive')  || 'off'
        const ab  = await window.bridge.adblockStatus()
        const wdm = await window.bridge.webDarkModeStatus()
        const hu  = await window.bridge.httpsUpgradeStatus()
        const isDefault = await window.bridge.isDefaultBrowser()
        el.executeJavaScript(`
          document.getElementById('search-engine').value    = ${JSON.stringify(se)};
          document.getElementById('homepage').value         = ${JSON.stringify(hp)};
          document.getElementById('save-session').value     = ${JSON.stringify(ss)};
          document.getElementById('auto-archive').value     = ${JSON.stringify(aa)};
          document.getElementById('adblock-toggle').checked = ${!!ab};
          const wdt = document.getElementById('web-dark-toggle');
          if (wdt) wdt.checked = ${!!wdm};
          const hut = document.getElementById('https-upgrade-toggle');
          if (hut) hut.checked = ${!!hu};
          const defBtn = document.getElementById('default-browser-btn');
          const defStatus = document.getElementById('default-browser-status');
          if (defBtn && defStatus) {
            if (${!!isDefault}) {
              defStatus.textContent = 'Divo est votre navigateur par défaut';
              defStatus.style.color = '#34c759';
              defBtn.disabled = true;
            } else {
              defStatus.textContent = 'Divo n\\'est pas le navigateur par défaut';
              defStatus.style.color = '';
              defBtn.disabled = false;
            }
          }
          const _uBtn = document.getElementById('update-action-btn');
          const _uTxt = document.getElementById('update-status-text');
          if (_uBtn && _uTxt) {
            if (${!!pendingUpdate}) {
              _uTxt.textContent = 'v${pendingUpdate?.version ?? ''} disponible';
              _uBtn.textContent = 'Installer v${pendingUpdate?.version ?? ''}';
              _uBtn.dataset.state = 'available';
            } else {
              _uTxt.textContent = 'Divo est à jour';
              _uBtn.textContent = 'Vérifier';
              _uBtn.dataset.state = 'idle';
            }
          }
        `).catch(() => {})
      }, 300)
    }

    // Initialisation extensions — injecter la liste via executeJavaScript
    if (isExtensions(e.url)) {
      setTimeout(async () => {
        const exts = await window.bridge.getUserExtensions()
        if (!el.__ready) return
        el.executeJavaScript(`
          window.__divoExts = ${JSON.stringify(exts)};
          if (typeof window.__divoRefresh === 'function') window.__divoRefresh(${JSON.stringify(exts)});
        `).catch(() => {})
      }, 150)
    }

    if (el !== wv()) return
    syncUrlBars(displayUrl(e.url))
    globalPlaying = false; updateMuteBtn(); updateNavButtons()
    if (findBar.classList.contains('visible')) closeFind()
    permBar.classList.remove('visible')
  })

  el.addEventListener('did-navigate-in-page', e => {
    if (!e.isMainFrame) return
    const tab = tabs.find(t => t.id === el.__key)
    if (tab) { tab.url = e.url; saveState() }
    if (el !== wv()) return
    syncUrlBars(displayUrl(e.url))
    updateNavButtons()
  })

  el.addEventListener('page-title-updated', e => {
    const currentUrl = el.getURL()

    // Installation extension — autorisée depuis CWS uniquement (pas n'importe quelle page)
    if (e.title.startsWith('divo-action:install-extension:')) {
      try { if (new URL(currentUrl).hostname !== 'chromewebstore.google.com' && !isSpecial(currentUrl)) return } catch { return }
      const extId = e.title.split(':')[2]
      if (/^[a-z]{32}$/.test(extId)) {
        window.bridge.installExtById(extId).then(async res => {
          if (res.ok) {
            // Rafraîchir la page extensions si déjà ouverte, sinon l'ouvrir
            const extWebview = [...pageWebviews.values()].find(v => { try { return isExtensions(v.getURL()) } catch { return false } })
            if (extWebview && extWebview.__ready) {
              const exts = await window.bridge.getUserExtensions()
              extWebview.executeJavaScript(`if(window.__divoRefresh)window.__divoRefresh(${JSON.stringify(exts)});if(window.__divoToast)window.__divoToast(${JSON.stringify('"' + (res.name||extId) + '" installée')}, 'ok')`).catch(() => {})
              activateTab(tabs.find(t => isExtensions(t.url))?.id)
            } else {
              createTab('divo://extensions')
            }
          } else if (res.reason) {
            alert('Erreur d\'installation : ' + res.reason)
          }
        })
      }
      return
    }

    if (e.title.startsWith('divo-action:')) {
      if (isSpecial(currentUrl)) {
        const action = e.title.replace('divo-action:', '')
        if (action.startsWith('adblock:'))           window.bridge.adblockToggle(action.endsWith('true'))
        if (action.startsWith('theme:'))              applyTheme(action.replace('theme:', ''))
        if (action.startsWith('layout:'))             applyLayout(action.replace('layout:', ''))
        if (action.startsWith('web-dark:'))           window.bridge.webDarkModeToggle(action.endsWith('true'))
        if (action.startsWith('https-upgrade:'))      window.bridge.httpsUpgradeToggle(action.endsWith('true'))
        if (action.startsWith('pick-download-path')) {
          window.bridge.pickDownloadPath().then(newPath => {
            if (!newPath || !el.__ready) return
            const escaped = newPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
            el.executeJavaScript(`
              const elem = document.getElementById('download-path-display')
              if (elem) elem.textContent = '${escaped}'
            `).catch(() => {})
          })
        }
      }
      return
    }
    if (e.title === 'divo-settings-action:set-default-browser') {
      if (isSettings(currentUrl)) window.bridge.setDefaultBrowser()
      return
    }
    if (e.title === 'divo-settings-action:open-extensions') {
      if (isSettings(currentUrl)) createTab('divo://extensions')
      return
    }
    if (e.title === 'divo-settings-action:open-secret') {
      if (isSettings(currentUrl)) createTab('divo://secret')
      return
    }
    if (e.title === 'divo-ext-action:open-cws') {
      createTab('https://chromewebstore.google.com/')
      return
    }
    if (e.title.startsWith('divo-ext-action:toggle:')) {
      const parts = e.title.split(':')
      window.bridge.toggleUserExtension(parts[2], parts[3] === 'true')
      return
    }
    if (e.title.startsWith('divo-ext-action:remove:')) {
      window.bridge.removeUserExtension(e.title.split(':')[2])
      return
    }
    if (e.title.startsWith('divo-settings-action:check-update') && isSettings(currentUrl)) {
      el.executeJavaScript(`
        const b = document.getElementById('update-action-btn');
        if (b) { b.textContent = 'Vérification…'; b.disabled = true; }
      `).catch(() => {})
      window.bridge.checkUpdateNow().then(upd => {
        if (upd) {
          pendingUpdate = upd
          showUpdateBar(upd.version)
        }
        const vTxt  = upd ? `v${upd.version} disponible` : 'Divo est à jour'
        const bTxt  = upd ? `Installer v${upd.version}`  : 'Vérifier'
        const state = upd ? 'available' : 'idle'
        el.executeJavaScript(`
          const b = document.getElementById('update-action-btn');
          const t = document.getElementById('update-status-text');
          if (b) { b.textContent = ${JSON.stringify(bTxt)}; b.dataset.state = ${JSON.stringify(state)}; b.disabled = false; }
          if (t) t.textContent = ${JSON.stringify(vTxt)};
        `).catch(() => {})
      })
      return
    }
    if (e.title === 'divo-settings-action:install-update' && isSettings(currentUrl)) {
      if (pendingUpdate) updateInstallBtn.click()
      return
    }
    if (e.title.startsWith('divo-settings:')) {
      if (!isSpecial(currentUrl)) return
      try {
        const s = JSON.parse(e.title.replace('divo-settings:', ''))
        if (s.searchEngine) localStorage.setItem('divo-search-engine', s.searchEngine)
        if (s.homepage)     localStorage.setItem('divo-homepage',      s.homepage)
        if (s.saveSession)  localStorage.setItem('divo-save-session',  s.saveSession)
        if (s.autoArchive)  { localStorage.setItem('divo-auto-archive', s.autoArchive); startArchiveTimer() }
      } catch {}
      return
    }
    const tab = tabs.find(t => t.id === el.__key)
    if (tab && !isSpecial(tab.url)) {
      if (tab.title !== e.title) { tab.title = e.title; saveState(); renderTabs() }
    }
    // Titre dynamique pour les essentials
    const ess = essentials.find(x => x.id === el.__key)
    if (ess && e.title && e.title !== ess.title) { ess.title = e.title; saveState(); renderEssentials() }
  })

  el.addEventListener('page-favicon-updated', e => {
    if (!e.favicons?.length) return
    const fav = e.favicons[0]
    const tab = tabs.find(t => t.id === el.__key)
    if (tab && !isSpecial(tab.url) && tab.favicon !== fav) {
      tab.favicon = fav; saveState(); renderTabs()
      if (el === wv()) updateTitlebarFavicon()
    }
    const ess = essentials.find(x => x.id === el.__key)
    if (ess && ess.favicon !== fav) { ess.favicon = fav; saveState(); renderEssentials() }
  })

  el.addEventListener('found-in-page', e => {
    if (el !== wv()) return
    const { activeMatchOrdinal, matches } = e.result
    if (matches > 0) { findCount.textContent = `${activeMatchOrdinal}/${matches}`; findCount.classList.remove('no-result') }
    else { findCount.textContent = 'Introuvable'; findCount.classList.add('no-result') }
  })

  el.addEventListener('media-started-playing', () => {
    const key = el.__key
    const isEss = !!essentials.find(x => x.id === key)
    mediaTabId       = isEss ? null : key
    mediaEssentialId = isEss ? key  : null
    const tab = tabs.find(t => t.id === key)
    if (tab && !tab.playing) { tab.playing = true; renderTabs() }
    if (el === wv()) { globalPlaying = true; updateMuteBtn() }

    // Afficher le mini lecteur seulement pour un vrai lecteur :
    // — aucun <video> dans la page → audio pur (Spotify, podcasts…) → OK
    // — <video> présent mais tous petits (pubs, previews, thumbnails) → ignorer
    // — <video> avec au moins un élément ≥ 200×100 px → OK
    el.executeJavaScript(`(function(){
      const vids = Array.from(document.querySelectorAll('video')).filter(v => !v.paused && !v.ended)
      if (!vids.length) return true
      return vids.some(v => { const r = v.getBoundingClientRect(); return r.width >= 200 && r.height >= 100 })
    })()`).then(show => { if (show) updateMiniPlayer() }).catch(() => updateMiniPlayer())
  })

  el.addEventListener('media-paused', () => {
    const key = el.__key
    const tab = tabs.find(t => t.id === key)
    if (tab) { tab.playing = false; renderTabs() }
    // Ne cacher le mini lecteur que si c'est le webview actif qui a pausé.
    // Les webviews en arrière-plan peuvent recevoir un media-paused dû au masquage CSS
    // (YouTube détecte visibilitychange) — on garde le mini lecteur visible.
    if (el === wv()) {
      if (key === mediaTabId) mediaTabId = null
      if (key === mediaEssentialId) mediaEssentialId = null
      globalPlaying = false; updateMuteBtn()
      updateMiniPlayer()
    }
  })

  el.addEventListener('new-window', e => {
    if (e.disposition === 'save-to-disk') return
    e.preventDefault(); if (e.url) createTab(e.url)
  })

  el.addEventListener('enter-html-full-screen', () => {
    if (el !== wv()) return
    document.body.classList.add('webview-fullscreen')
  })

  el.addEventListener('leave-html-full-screen', () => {
    document.body.classList.remove('webview-fullscreen')
  })
}

// ============================================================
// NAVIGATION
// ============================================================

function normalizeUrl(raw) {
  raw = raw.trim()
  if (!raw) return NEWTAB_URL
  if (raw === 'divo://settings') return SETTINGS_URL
  if (raw === 'divo://dino')     return 'divo://dino'
  if (raw.startsWith('divo://') || raw.startsWith('file://') ||
    raw.startsWith('http://') || raw.startsWith('https://')) return raw
  // Protocoles custom (steam://, discord://, epic://, etc.) → passés tels quels
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw
  if (/^[\w-]+\.[\w.-]+/.test(raw) && !raw.includes(' ')) return 'https://' + raw
  return getSearchUrl(raw)
}

// preserveContent=true : switch d'onglet — afficher sans recharger le contenu
// preserveContent=false (défaut) : navigation vers une URL — charger la page
function navigate(url, preserveContent = false) {
  url = normalizeUrl(url)
  syncUrlBars(displayUrl(url))

  const key = activeEssentialId || activeTabId
  if (!key) { saveState(); return }

  // Afficher uniquement le webview de cet onglet, cacher tous les autres
  for (const [k, v] of pageWebviews) v.style.display = k === key ? '' : 'none'

  const wvEl = pageWebviews.get(key)
  if (wvEl) {
    webviewReady = !!wvEl.__ready
    if (preserveContent) {
      // Switch d'onglet — le contenu est déjà là, juste l'afficher
      if (webviewReady) updateNavButtons()
      saveState(); return
    }
    // Navigation URL — charger la nouvelle page dans le webview existant
    if (wvEl.__ready) wvEl.loadURL(url).catch(() => {})
    else wvEl.src = url
    saveState(); return
  }

  // Pas encore dans le pool — allouer et charger
  const newWv = allocWebview(key)
  newWv.style.display = ''
  webviewReady = false
  newWv.src = url
  saveState()
}

function updateNavButtons() {
  if (!webviewReady) return
  const canBack = wv().canGoBack()
  const canFwd  = wv().canGoForward()
  btnBack.disabled    = !canBack;  topBtnBack.disabled    = !canBack
  btnForward.disabled = !canFwd;   topBtnForward.disabled = !canFwd
}

function updateTitlebarFavicon() {
  const el = document.getElementById('titlebar-favicon'); if (!el) return
  const favicon = activeEssentialId
    ? essentials.find(e => e.id === activeEssentialId)?.favicon
    : tabs.find(t => t.id === activeTabId)?.favicon
  if (favicon && !activeTabIsPrivate()) { el.src = safeFavicon(favicon); el.classList.add('shown') }
  else { el.src = ''; el.classList.remove('shown') }
}

function updateMuteBtn() {
  if (!btnMute) return
  if (globalMuted) {
    btnMute.innerHTML = ICON_MUTED; btnMute.style.color = '#ff453a'
    btnMute.style.opacity = '1'; btnMute.title = 'Activer le son'
  } else if (globalPlaying) {
    btnMute.innerHTML = ICON_AUDIO; btnMute.style.color = '#0a84ff'
    btnMute.style.opacity = '1'; btnMute.title = 'Couper le son'
  } else {
    btnMute.innerHTML = ICON_AUDIO; btnMute.style.color = ''
    btnMute.style.opacity = '0'; btnMute.title = 'Couper le son'
  }
}

function updateMiniPlayer() {
  const key = mediaEssentialId || mediaTabId
  if (!key) { miniPlayer.classList.remove('visible'); return }
  // Cacher le mini lecteur si on regarde déjà la source qui joue
  if (key === activeEssentialId || key === activeTabId) { miniPlayer.classList.remove('visible'); return }
  const item = essentials.find(e => e.id === key) || tabs.find(t => t.id === key)
  if (!item) { miniPlayer.classList.remove('visible'); return }
  miniPlayerFav.src = safeFavicon(item.favicon)
  miniPlayerFav.style.display = safeFavicon(item.favicon) ? '' : 'none'
  miniPlayerTitle.textContent = item.title || 'En cours de lecture'
  miniPlayer.dataset.playKey = key
  miniPlayer.classList.add('visible')
}


// ============================================================
// ONGLETS
// ============================================================

function activateTab(id) {
  const t = tabs.find(x => x.id === id); if (!t) return
  const wasEssential = !!activeEssentialId
  const wasArchived  = t.archived
  if (t.archived) t.archived = false
  t.lastUsed = Date.now()
  t._resumeScroll = !!(t.scrollY && t.scrollY > 0 && !t.unloaded)
  if (t.unloaded) t.unloaded = false

  activeTabId = id; activeEssentialId = null
  navigate(t.url, true)
  if (wasEssential) renderEssentials()
  renderTabs()
  if (wasArchived)  renderArchived()
  const wvEl = wv()
  if (wvEl.__ready) wvEl.setAudioMuted(t.muted || false)
  globalMuted = t.muted || false; globalPlaying = !!(t.playing)
  updateTitlebarFavicon(); updateMuteBtn(); updatePrivateUI(); updateMiniPlayer()
}

function unloadTab(id) {
  const tab = tabs.find(t => t.id === id)
  if (!tab || tab.private || isSpecial(tab.url)) return
  const wvEl = pageWebviews.get(id)

  function doUnload() {
    tab.unloaded = true
    if (wvEl) {
      try { wvEl.src = 'about:blank' } catch {}
      wvEl.remove()
      pageWebviews.delete(id)
    }
    saveState(); renderTabs()
  }

  if (wvEl?.__ready) {
    wvEl.executeJavaScript('window.scrollY').then(y => {
      if (typeof y === 'number' && y >= 0) tab.scrollY = y
      doUnload()
    }).catch(doUnload)
  } else {
    doUnload()
  }
}

// ── Auto-suspend : unload les onglets inactifs depuis AUTO_SUSPEND_MS (comme Arc Smart Tabs)
const AUTO_SUSPEND_MS = 30 * 60 * 1000  // 30 minutes

function autoSuspendCheck() {
  const now = Date.now()
  const candidates = tabs.filter(t =>
    t.id !== activeTabId &&
    !t.private &&
    !t.unloaded &&
    !t.playing &&
    !isSpecial(t.url) &&
    pageWebviews.has(t.id) &&
    (now - (t.lastUsed || 0)) >= AUTO_SUSPEND_MS
  )
  if (!candidates.length) return
  let remaining = candidates.length
  for (const tab of candidates) {
    const wvEl = pageWebviews.get(tab.id)
    const finish = (y) => {
      if (typeof y === 'number' && y >= 0) tab.scrollY = y
      tab.unloaded = true
      if (wvEl) { try { wvEl.src = 'about:blank' } catch {} wvEl.remove(); pageWebviews.delete(tab.id) }
      if (--remaining === 0) { saveState(); renderTabs() }
    }
    if (wvEl?.__ready) {
      wvEl.executeJavaScript('window.scrollY').then(finish).catch(() => finish(0))
    } else {
      finish(0)
    }
  }
}

function startScrollSaver() {
  setInterval(() => {
    const wvEl = wv()
    if (!wvEl?.__ready || !activeTabId || activeEssentialId) return
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab || isSpecial(tab.url) || tab.unloaded) return
    wvEl.executeJavaScript('window.scrollY').then(y => {
      if (typeof y === 'number' && y >= 0) tab.scrollY = y
    }).catch(() => {})
  }, 2000)
}

function closeTab(id) {
  const wvEl = pageWebviews.get(id)
  if (wvEl) { try { wvEl.src = 'about:blank' } catch {} wvEl.remove(); pageWebviews.delete(id) }
  const activeTabs = getActiveTabs()
  const activeIdx  = activeTabs.findIndex(t => t.id === id)
  const idx        = tabs.findIndex(t => t.id === id); if (idx === -1) return
  const tab = tabs[idx]
  if (!tab.private) {
    closedTabs.push({ url: tab.url, title: tab.title, favicon: tab.favicon, spaceId: tab.spaceId })
    if (closedTabs.length > 20) closedTabs.shift()
  }
  tabs.splice(idx, 1)
  const remaining = getActiveTabs()
  if (!remaining.length) { createTab(); return }
  if (activeTabId === id) activateTab(remaining[Math.max(0, activeIdx - 1)].id)
  else { saveState(); render() }
}

function createTab(url = null, isPrivate = false) {
  if (url === null) url = isPrivate ? NEWTAB_URL : getHomepageUrl()
  const id = 't' + Date.now()
  tabs.push({ id, title: isPrivate ? 'Navigation privée' : 'Nouvel onglet', url, favicon: null, private: isPrivate, spaceId: activeSpaceId, lastUsed: Date.now(), archived: false })
  activateTab(id)
}

function startRenameTab(id) {
  const tab = tabs.find(t => t.id === id); if (!tab) return
  const li  = tabsList.querySelector(`[data-id="${id}"]`); if (!li) return
  startRenameInline(li.querySelector('.tab-title'), tab, () => { saveState(); renderTabs() })
}

function restoreClosedTab() {
  if (!closedTabs.length) return
  const t  = closedTabs.pop()
  const id = 't' + Date.now()
  tabs.push({ id, title: t.title || 'Onglet restauré', url: t.url, favicon: t.favicon || null, spaceId: t.spaceId || activeSpaceId, lastUsed: Date.now(), archived: false })
  activateTab(id)
}

function pinTabAsEssential(id) {
  const tab = tabs.find(t => t.id === id)
  if (!tab || isSpecial(tab.url) || tab.private) return
  const url = normalizeUrl(tab.url)
  if (essentials.find(e => e.url === url)) return
  essentials.push({ id: 'e' + Date.now(), title: tab.title || url, url, favicon: tab.favicon })
  saveState(); renderEssentials()
}


// ============================================================
// ESSENTIALS
// ============================================================

function activateEssential(id) {
  const e = essentials.find(x => x.id === id); if (!e) return
  const wasTab = !!activeTabId
  activeEssentialId = id; activeTabId = null
  navigate(e.url, true)
  renderEssentials()
  if (wasTab) renderTabs()
  const wvEl = wv()
  if (wvEl.__ready) wvEl.setAudioMuted(false)
  globalMuted = false; globalPlaying = false
  updateTitlebarFavicon(); updateMuteBtn(); updatePrivateUI(); updateMiniPlayer()
}

function addCurrentPageAsEssential() {
  const url = normalizeUrl(urlInput.value)
  if (isSpecial(url) || essentials.find(e => e.url === url)) return
  let title  = (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return 'Page' } })()
  let favicon = null
  if (activeTabId && !activeEssentialId) {
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab) { title = tab.title || title; favicon = tab.favicon }
  }
  essentials.push({ id: 'e' + Date.now(), title, url, favicon })
  saveState(); renderEssentials()
}

function unloadEssential(id) {
  if (activeEssentialId !== id) return
  activeEssentialId = null
  const at = getActiveTabs()
  at.length ? activateTab(at[0].id) : createTab()
}

function removeEssential(id) {
  const idx = essentials.findIndex(e => e.id === id); if (idx === -1) return
  essentials.splice(idx, 1)
  const wvEl = pageWebviews.get(id)
  if (wvEl) { try { wvEl.src = 'about:blank' } catch {} wvEl.remove(); pageWebviews.delete(id) }
  if (activeEssentialId === id) {
    activeEssentialId = null
    const at = getActiveTabs()
    at.length ? activateTab(at[0].id) : createTab()
  }
  saveState(); renderEssentials()
}

function startRenameEssential(id) {
  const ess = essentials.find(e => e.id === id); if (!ess) return
  const li  = essentialsList.querySelector(`[data-id="${id}"]`); if (!li) return
  startRenameInline(li.querySelector('.tab-title'), ess, () => { saveState(); renderEssentials() })
}

function openEssentialInTab(id) {
  const e = essentials.find(x => x.id === id); if (e) createTab(e.url)
}


// ============================================================
// FAVORIS
// ============================================================

function addCurrentPageAsFavorite() {
  const url = normalizeUrl(urlInput.value)
  if (isSpecial(url) || favorites.find(f => f.url === url)) return
  let title  = (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return 'Page' } })()
  let favicon = null
  if (activeEssentialId) {
    const ess = essentials.find(e => e.id === activeEssentialId)
    if (ess) { title = ess.title || title; favicon = ess.favicon }
  } else if (activeTabId) {
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab) { title = tab.title || title; favicon = tab.favicon }
  }
  favorites.push({ id: 'f' + Date.now(), title, url, favicon, spaceId: activeSpaceId })
  saveState(); renderFavorites()
}

function removeFavorite(id) {
  favorites = favorites.filter(f => f.id !== id)
  saveState(); renderFavorites()
}

function openFavorite(id) {
  const f = favorites.find(x => x.id === id); if (!f) return
  createTab(f.url)
}

function addTabAsFavorite(tabId) {
  const tab = tabs.find(t => t.id === tabId); if (!tab || isSpecial(tab.url) || tab.private) return
  if (favorites.some(f => f.url === tab.url && f.spaceId === activeSpaceId)) return
  favorites.push({ id: 'f' + Date.now(), title: tab.title || tab.url, url: tab.url, favicon: tab.favicon || null, spaceId: activeSpaceId })
  saveState(); renderFavorites()
}

function moveTabToSpace(tabId, targetSpaceId) {
  const tab = tabs.find(t => t.id === tabId); if (!tab) return
  tab.spaceId = targetSpaceId
  if (activeTabId === tabId) {
    const remaining = getActiveTabs()
    if (remaining.length) activateTab(remaining[0].id)
    else createTab()
  } else {
    saveState(); renderTabs()
  }
}

function startRenameFavorite(id) {
  const fav = favorites.find(f => f.id === id); if (!fav) return
  const li  = favoritesList.querySelector(`[data-id="${id}"]`); if (!li) return
  startRenameInline(li.querySelector('.tab-title'), fav, () => { saveState(); renderFavorites() })
}

function buildFavRow(fav, indented) {
  const li = document.createElement('li')
  li.className = 'tab-item' + (indented ? ' fav-indented' : '')
  li.dataset.id = fav.id
  li.dataset.favType = 'url'
  const faviconHtml = safeFavicon(fav.favicon)
    ? `<img class="tab-favicon" src="${safeFavicon(fav.favicon)}" loading="lazy" draggable="false">`
    : `<div class="tab-favicon-placeholder"></div>`
  li.innerHTML = `${faviconHtml}<span class="tab-title">${escapeHtml(fav.title)}</span><button class="tab-close" data-remove-fav="${fav.id}">✕</button>`
  return li
}

function buildFolderRow(folder) {
  const li = document.createElement('li')
  li.className = 'tab-item fav-folder' + (folder.open ? ' open' : '')
  li.dataset.id = folder.id
  li.dataset.favType = 'folder'
  li.innerHTML = `
    <svg class="folder-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    <svg class="folder-icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
    <span class="tab-title">${escapeHtml(folder.title)}</span>
    <button class="tab-close" data-remove-folder="${folder.id}">✕</button>
  `
  return li
}

function renderFavorites() {
  const spaceItems = favorites.filter(f => f.spaceId === activeSpaceId)
  const frag = document.createDocumentFragment()
  for (const item of spaceItems) {
    if (item.folderId) continue  // rendu sous son dossier
    if (item.type === 'folder') {
      frag.appendChild(buildFolderRow(item))
      if (item.open) {
        for (const child of spaceItems.filter(c => c.folderId === item.id))
          frag.appendChild(buildFavRow(child, true))
      }
    } else {
      frag.appendChild(buildFavRow(item, false))
    }
  }
  favoritesList.replaceChildren(frag)
}

function createFolder() {
  const id = 'folder_' + Date.now()
  favorites.push({ id, type: 'folder', title: 'Nouveau dossier', spaceId: activeSpaceId, open: true })
  saveState(); renderFavorites()
  const li = favoritesList.querySelector(`[data-id="${id}"]`)
  if (li) startRenameInline(li.querySelector('.tab-title'), favorites.find(f => f.id === id), () => { saveState(); renderFavorites() })
}

function toggleFolder(id) {
  const folder = favorites.find(f => f.id === id); if (!folder) return
  folder.open = !folder.open
  saveState(); renderFavorites()
}

function deleteFolder(id) {
  favorites.forEach(f => { if (f.folderId === id) delete f.folderId })
  favorites = favorites.filter(f => f.id !== id)
  saveState(); renderFavorites()
}

function moveToFolder(favId, folderId) {
  const fav = favorites.find(f => f.id === favId); if (!fav) return
  if (folderId) fav.folderId = folderId; else delete fav.folderId
  saveState(); renderFavorites()
}


// ============================================================
// IMPORT FAVORIS CHROME / EDGE / BRAVE
// ============================================================

async function importBookmarksHtml() {
  const bookmarks = await window.bridge.importBookmarksHtml()
  if (bookmarks === null) return  // utilisateur a annulé la boîte de dialogue
  showImportModal(bookmarks)
}

async function importChromeBookmarks() {
  const bookmarks = await window.bridge.importChromeBookmarks()
  showImportModal(bookmarks || [])
}

function showImportModal(bookmarks) {
  const existing = document.querySelector('.import-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.className = 'import-overlay'

  const countLabel = bookmarks.length === 1 ? '1 trouvé' : `${bookmarks.length} trouvés`

  overlay.innerHTML = `
    <div class="import-modal">
      <div class="import-header">
        <span class="import-title">Importer des favoris</span>
        <span class="import-found">${countLabel}</span>
        <button class="import-close-btn">✕</button>
      </div>
      ${bookmarks.length > 0 ? `
      <div class="import-search-row">
        <input type="text" class="import-search" placeholder="Rechercher…">
        <label class="import-select-all-label"><input type="checkbox" class="import-chk-all"> Tout</label>
      </div>
      <div class="import-list-wrap">
        <ul class="import-list"></ul>
      </div>
      <div class="import-footer">
        <span class="import-count">0 sélectionné(s)</span>
        <button class="import-cancel-btn">Annuler</button>
        <button class="import-confirm-btn" disabled>Importer</button>
      </div>` : `
      <div class="import-empty-state">
        <p>Aucun favori trouvé.<br>Chrome, Edge ou Brave doit être installé.</p>
        <button class="import-cancel-btn">Fermer</button>
      </div>`}
    </div>
  `

  document.body.appendChild(overlay)

  function close() { overlay.remove() }
  overlay.querySelector('.import-close-btn').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  if (!bookmarks.length) {
    overlay.querySelector('.import-cancel-btn').addEventListener('click', close)
    return
  }

  const searchInput = overlay.querySelector('.import-search')
  const chkAll      = overlay.querySelector('.import-chk-all')
  const list        = overlay.querySelector('.import-list')
  const countEl     = overlay.querySelector('.import-count')
  const cancelBtn   = overlay.querySelector('.import-cancel-btn')
  const confirmBtn  = overlay.querySelector('.import-confirm-btn')

  const selected = new Set()

  function updateCount() {
    const n = selected.size
    countEl.textContent = `${n} sélectionné(s)`
    confirmBtn.disabled = n === 0
    confirmBtn.textContent = n > 0 ? `Importer (${n})` : 'Importer'
  }

  function getVisible() {
    const q = searchInput.value.toLowerCase()
    return q ? bookmarks.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) : bookmarks
  }

  function buildList() {
    const frag = document.createDocumentFragment()
    const visible = getVisible()
    for (const bk of visible) {
      const li = document.createElement('li')
      li.className = 'import-item'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.className = 'import-cb'
      cb.checked = selected.has(bk.url)
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(bk.url); else selected.delete(bk.url)
        updateCount()
      })
      const info = document.createElement('div')
      info.className = 'import-item-info'
      const safeTitle = bk.title.replace(/&/g,'&amp;').replace(/</g,'&lt;')
      const safeUrl   = bk.url.replace(/&/g,'&amp;').replace(/</g,'&lt;')
      info.innerHTML = `<div class="import-item-title">${safeTitle}</div><div class="import-item-url">${safeUrl}</div>`
      li.appendChild(cb)
      li.appendChild(info)
      li.addEventListener('click', e => { if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')) } })
      frag.appendChild(li)
    }
    if (!visible.length) {
      const li = document.createElement('li')
      li.className = 'import-empty'
      li.textContent = 'Aucun résultat'
      frag.appendChild(li)
    }
    list.replaceChildren(frag)
  }

  buildList()
  searchInput.addEventListener('input', buildList)

  chkAll.addEventListener('change', () => {
    const visible = getVisible()
    if (chkAll.checked) visible.forEach(b => selected.add(b.url))
    else visible.forEach(b => selected.delete(b.url))
    buildList()
    updateCount()
  })

  cancelBtn.addEventListener('click', close)

  confirmBtn.addEventListener('click', () => {
    const toImport = bookmarks.filter(b => selected.has(b.url))
    for (let i = 0; i < toImport.length; i++) {
      const bk = toImport[i]
      if (!isSpecial(bk.url) && !favorites.some(f => f.url === bk.url && f.spaceId === activeSpaceId)) {
        favorites.push({ id: 'f' + Date.now() + '_' + i, title: bk.title || bk.url, url: bk.url, favicon: null, spaceId: activeSpaceId })
      }
    }
    saveState(); renderFavorites()
    close()
  })
}

// ============================================================
// SPACES
// ============================================================

function switchSpace(id) {
  if (id === activeSpaceId) return
  const curSpace = spaces.find(s => s.id === activeSpaceId)
  if (curSpace) curSpace.activeTabId = activeTabId
  activeSpaceId = id; activeEssentialId = null
  renderSpaces()
  renderFavorites()
  const newSpace = spaces.find(s => s.id === id)
  const at = getActiveTabs()
  if (newSpace?.activeTabId && at.find(t => t.id === newSpace.activeTabId)) {
    activateTab(newSpace.activeTabId)
  } else if (at.length) {
    activateTab(at[0].id)
  } else {
    createTab()
  }
  saveState()
}

function createSpace() {
  const color = SPACE_COLORS[spaces.length % SPACE_COLORS.length]
  const id    = 'sp_' + Date.now()
  spaces.push({ id, name: 'Espace ' + (spaces.length + 1), color, activeTabId: null })
  switchSpace(id)
  requestAnimationFrame(() => startRenameSpace(id))
}

function renameSpace(id) { startRenameSpace(id) }

function deleteSpace(id) {
  if (spaces.length <= 1) return
  const idx = spaces.findIndex(s => s.id === id); if (idx === -1) return
  for (const t of tabs.filter(x => x.spaceId === id)) {
    const wvEl = pageWebviews.get(t.id)
    if (wvEl) { try { wvEl.src = 'about:blank' } catch {} wvEl.remove(); pageWebviews.delete(t.id) }
  }
  tabs      = tabs.filter(t => t.spaceId !== id)
  favorites = favorites.filter(f => f.spaceId !== id)
  spaces.splice(idx, 1)
  if (activeSpaceId === id) {
    activeSpaceId = spaces[Math.max(0, idx - 1)].id
    const at = getActiveTabs()
    if (at.length) { activeTabId = at[0].id; navigate(at[0].url, true) }
    else createTab()
  }
  saveState(); render()
}

let dragSpaceId = null

function renderSpaces() {
  const frag = document.createDocumentFragment()
  for (const space of spaces) {
    const btn = document.createElement('button')
    btn.className = 'space-pill' + (space.id === activeSpaceId ? ' active' : '')
    btn.dataset.spaceId = space.id
    btn.title = space.name
    btn.draggable = true
    const dot = document.createElement('span')
    dot.className = 'space-color-dot'
    dot.style.background = safeColor(space.color)
    const lbl = document.createElement('span')
    lbl.className = 'space-pill-name'
    lbl.textContent = space.name
    btn.appendChild(dot); btn.appendChild(lbl)
    btn.addEventListener('click', () => { if (!dragSpaceId) switchSpace(space.id) })
    btn.addEventListener('dblclick', e => { e.preventDefault(); if (space.id === activeSpaceId) startRenameSpace(space.id) })
    btn.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, space.id, 'space') })
    btn.addEventListener('dragstart', e => {
      dragSpaceId = space.id
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => btn.classList.add('dragging'), 0)
    })
    btn.addEventListener('dragend', () => {
      dragSpaceId = null
      spacesList.querySelectorAll('.space-pill').forEach(el => el.classList.remove('dragging', 'drag-over-left', 'drag-over-right'))
    })
    btn.addEventListener('dragover', e => {
      if (!dragSpaceId || dragSpaceId === space.id) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      spacesList.querySelectorAll('.space-pill').forEach(el => el.classList.remove('drag-over-left', 'drag-over-right'))
      const rect = btn.getBoundingClientRect()
      const mid  = rect.left + rect.width / 2
      btn.classList.add(e.clientX < mid ? 'drag-over-left' : 'drag-over-right')
    })
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over-left', 'drag-over-right'))
    btn.addEventListener('drop', e => {
      e.preventDefault()
      if (!dragSpaceId || dragSpaceId === space.id) return
      const fromIdx = spaces.findIndex(s => s.id === dragSpaceId)
      const toIdx   = spaces.findIndex(s => s.id === space.id)
      if (fromIdx === -1 || toIdx === -1) return
      const rect = btn.getBoundingClientRect()
      const insertAfter = e.clientX >= rect.left + rect.width / 2
      const [moved] = spaces.splice(fromIdx, 1)
      const newIdx  = spaces.findIndex(s => s.id === space.id)
      spaces.splice(insertAfter ? newIdx + 1 : newIdx, 0, moved)
      saveState(); renderSpaces()
    })
    frag.appendChild(btn)
  }
  spacesList.replaceChildren(frag)
}

function startRenameSpace(id) {
  const space = spaces.find(s => s.id === id); if (!space) return
  const btn   = spacesList.querySelector(`[data-space-id="${id}"]`); if (!btn) return
  const nameEl = btn.querySelector('.space-pill-name'); if (!nameEl) return
  const input  = document.createElement('input')
  input.type = 'text'; input.value = space.name; input.className = 'space-rename-input'
  nameEl.replaceWith(input); input.focus(); input.select()
  btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  let done = false
  function commit() {
    if (done) return; done = true
    const v = input.value.trim(); if (v) space.name = v
    saveState(); renderSpaces()
  }
  input.addEventListener('blur', commit)
  input.addEventListener('click', e => e.stopPropagation())
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter') { input.blur(); return }
    if (e.key === 'Escape') { done = true; renderSpaces() }
  })
}


// ============================================================
// AUTO-ARCHIVE
// ============================================================

function checkAutoArchive() {
  const threshold = getArchiveThreshold(); if (!threshold) return
  const now = Date.now(); let changed = false
  for (const tab of tabs) {
    if (tab.archived || tab.private || tab.id === activeTabId) continue
    if (tab.lastUsed && now - tab.lastUsed > threshold) { tab.archived = true; changed = true }
  }
  if (changed) { saveState(); renderTabs(); renderArchived() }
}

function startArchiveTimer() {
  clearInterval(archiveTimer)
  if (getArchiveThreshold()) archiveTimer = setInterval(checkAutoArchive, 5 * 60 * 1000)
}

function unarchiveTab(id) {
  const tab = tabs.find(t => t.id === id); if (!tab) return
  tab.archived  = false
  tab.lastUsed  = Date.now()
  activateTab(id)
}

function renderArchived() {
  const archived = getArchivedTabs()
  if (!archived.length) { archiveSection.style.display = 'none'; return }
  archiveSection.style.display = ''
  const label = archiveSection.querySelector('.section-label')
  if (label) label.textContent = `Archivés (${archived.length})`
  const frag = document.createDocumentFragment()
  for (const t of archived) {
    const li = document.createElement('li')
    li.className = 'tab-item archived-tab'
    li.dataset.id = t.id
    const faviconHtml = safeFavicon(t.favicon)
      ? `<img class="tab-favicon" src="${safeFavicon(t.favicon)}" loading="lazy" draggable="false">`
      : `<div class="tab-favicon-placeholder"></div>`
    li.innerHTML = `${faviconHtml}<span class="tab-title">${escapeHtml(t.title)}</span><button class="tab-close" data-del="${t.id}">✕</button>`
    li.addEventListener('click', e => { if (!e.target.closest('[data-del]')) unarchiveTab(t.id) })
    li.querySelector('[data-del]').addEventListener('click', () => {
      tabs = tabs.filter(x => x.id !== t.id); saveState(); renderArchived()
    })
    frag.appendChild(li)
  }
  archiveList.replaceChildren(frag)
}


// ============================================================
// RENAME INLINE
// ============================================================

function startRenameInline(titleEl, obj, onDone) {
  if (!titleEl) return
  const input = document.createElement('input')
  input.type = 'text'; input.value = obj.title; input.className = 'rename-input'
  titleEl.replaceWith(input); input.focus(); input.select()
  let done = false
  function commit() {
    if (done) return; done = true
    const v = input.value.trim(); if (v) obj.title = v; onDone()
  }
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter') { input.blur(); return }
    if (e.key === 'Escape') { done = true; onDone() }
  })
}


// ============================================================
// AFFICHAGE
// ============================================================

function renderEssentials() {
  const frag = document.createDocumentFragment()
  for (const e of essentials) {
    const btn = document.createElement('button')
    btn.className = 'ess-icon' + (activeEssentialId === e.id ? ' active' : '')
    btn.dataset.id = e.id
    btn.draggable = true
    btn.title = e.title || e.url
    const fav = safeFavicon(e.favicon)
    if (fav) {
      const img = document.createElement('img')
      img.src = fav; img.loading = 'lazy'; img.draggable = false
      btn.appendChild(img)
    } else {
      const ph = document.createElement('div')
      ph.className = 'ess-placeholder'
      btn.appendChild(ph)
    }
    const rm = document.createElement('button')
    rm.className = 'ess-remove'
    rm.dataset.unloadEss = e.id
    rm.textContent = '✕'
    rm.title = 'Fermer'
    btn.appendChild(rm)
    frag.appendChild(btn)
  }
  essentialsList.replaceChildren(frag)
}

function buildTabItem(t) {
  if (t.__separator) {
    const li = document.createElement('li')
    li.className = 'tab-sleep-separator'
    li.innerHTML = `<span class="tab-sleep-label">En veille · ${t.count}</span>`
    return li
  }
  const li = document.createElement('li')
  li.className = 'tab-item'
    + (activeTabId === t.id && !activeEssentialId ? ' active' : '')
    + (t.playing ? ' playing' : '') + (t.muted ? ' muted' : '')
    + (t.private ? ' private' : '') + (t.unloaded ? ' unloaded' : '')
  li.dataset.id = t.id; li.draggable = true
  const faviconHtml = t.private
    ? `<div class="tab-favicon-private">${ICON_LOCK}</div>`
    : safeFavicon(t.favicon)
      ? `<img class="tab-favicon" src="${safeFavicon(t.favicon)}" loading="lazy" draggable="false">`
      : `<div class="tab-favicon-placeholder"></div>`
  li.innerHTML = `
    ${faviconHtml}
    <span class="tab-title">${escapeHtml(t.title)}</span>
    <button class="tab-mute" data-mute="${t.id}" title="${t.muted ? 'Activer le son' : 'Couper le son'}">${t.muted ? ICON_MUTED : ICON_AUDIO}</button>
    <button class="tab-close" data-close="${t.id}">✕</button>
  `
  return li
}

function renderTabs() {
  const all = getActiveTabs()
  const loaded   = all.filter(t => !t.unloaded)
  const sleeping = all.filter(t =>  t.unloaded)
  const items = sleeping.length
    ? [...loaded, { __separator: true, count: sleeping.length }, ...sleeping]
    : loaded
  tabsVL.update(items, buildTabItem)
  renderTopTabs()
}

function render() { renderSpaces(); renderEssentials(); renderFavorites(); renderTabs(); renderArchived() }


// ============================================================
// CONTEXT MENU
// ============================================================

function buildContextMenu(type) {
  if (type === 'space') {
    const only = spaces.length <= 1
    contextMenu.innerHTML = `
      <button class="ctx-item" data-action="rename-space">${ICO.rename} Renommer</button>
      <div class="ctx-divider"></div>
      <button class="ctx-item danger" data-action="delete-space" ${only ? 'disabled style="opacity:.4;pointer-events:none"' : ''}>${ICO.close} Supprimer l'espace</button>
    `
    return
  }
  if (type === 'folder') {
    contextMenu.innerHTML = `
      <button class="ctx-item" data-action="rename">${ICO.rename} Renommer</button>
      <div class="ctx-divider"></div>
      <button class="ctx-item danger" data-action="delete-folder">${ICO.close} Supprimer le dossier</button>
    `
    return
  }
  if (type === 'favorite') {
    const fav = favorites.find(f => f.id === ctxTargetId)
    const folders = favorites.filter(f => f.type === 'folder' && f.spaceId === activeSpaceId)
    let html = `<button class="ctx-item" data-action="rename">${ICO.rename} Renommer</button>`
    if (fav && fav.folderId) {
      html += `<div class="ctx-divider"></div><button class="ctx-item" data-action="remove-from-folder">${ICO.folderUp} Retirer du dossier</button>`
    }
    const moveable = folders.filter(f => f.id !== (fav && fav.folderId))
    if (moveable.length) {
      html += `<div class="ctx-divider"></div><div class="ctx-label">Déplacer dans</div>`
      for (const folder of moveable)
        html += `<button class="ctx-item" data-action="move-to-folder" data-folder-id="${folder.id}">${ICO.folder} ${escapeHtml(folder.title)}</button>`
    }
    html += `<div class="ctx-divider"></div><button class="ctx-item danger" data-action="remove-favorite">${ICO.close} Retirer des favoris</button>`
    contextMenu.innerHTML = html
    return
  }
  if (type === 'tab') {
    const tab = tabs.find(t => t.id === ctxTargetId)
    const alreadyFav = !!(tab && !isSpecial(tab.url) && !tab.private && favorites.some(f => f.url === tab.url && f.spaceId === activeSpaceId))
    const otherSpaces = spaces.filter(s => s.id !== activeSpaceId)
    let html = `
      <button class="ctx-item" data-action="rename">${ICO.rename} Renommer</button>
      <button class="ctx-item" data-action="pin">${ICO.pin} Épingler en Essential</button>
    `
    if (!alreadyFav && tab && !isSpecial(tab.url) && !tab.private) {
      html += `<button class="ctx-item" data-action="add-favorite">${ICO.bookmark} Ajouter aux favoris</button>`
    }
    if (tab && !tab.private && !isSpecial(tab.url) && !tab.unloaded) {
      html += `<button class="ctx-item" data-action="unload-tab">${ICO.sleep} Décharger l'onglet</button>`
    }
    if (otherSpaces.length) {
      html += `<div class="ctx-divider"></div><div class="ctx-label">Déplacer vers</div>`
      for (const s of otherSpaces) {
        html += `<button class="ctx-item" data-action="move-space" data-target-space="${s.id}"><span class="ctx-space-dot" style="background:${safeColor(s.color)}"></span>${escapeHtml(s.name)}</button>`
      }
    }
    html += `<div class="ctx-divider"></div><button class="ctx-item danger" data-action="close">${ICO.close} Fermer l'onglet</button>`
    contextMenu.innerHTML = html
    return
  }
  let essCurrentUrl = null
  try { const essWv = pageWebviews.get(ctxTargetId); if (essWv) essCurrentUrl = essWv.getURL() } catch {}
  const canUpdateUrl = essCurrentUrl && !isSpecial(essCurrentUrl)
  contextMenu.innerHTML = `
    <button class="ctx-item" data-action="rename">${ICO.rename} Renommer</button>
    <button class="ctx-item" data-action="open-tab">${ICO.openTab} Ouvrir dans un onglet</button>
    ${canUpdateUrl ? `<button class="ctx-item" data-action="update-essential-url">${ICO.url} Utiliser la page actuelle</button>` : ''}
    <div class="ctx-divider"></div>
    <button class="ctx-item danger" data-action="remove-essential">${ICO.close} Retirer des Essentials</button>
  `
}

function showContextMenu(x, y, id, type) {
  ctxTargetId = id; ctxType = type; buildContextMenu(type)
  contextMenu.classList.add('visible')
  requestAnimationFrame(() => {
    const w = contextMenu.offsetWidth, h = contextMenu.offsetHeight
    contextMenu.style.left = Math.max(4, Math.min(x, window.innerWidth  - w - 4)) + 'px'
    contextMenu.style.top  = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px'
  })
}

function hideContextMenu() { contextMenu.classList.remove('visible'); ctxTargetId = null; ctxType = null }


// ============================================================
// HISTORIQUE
// ============================================================

function loadHistory() {
  try {
    const h = window.bridge.initHistory
    historyData = Array.isArray(h) ? h : []
    // Migration : si history.json est vide mais localStorage a des données
    if (!historyData.length) {
      const local = JSON.parse(localStorage.getItem('arc-history') || '[]')
      if (local.length) { historyData = local; saveHistory() }
    }
  } catch { historyData = [] }
}

function saveHistory() {
  window.bridge.historySave(historyData.slice(0, 5000)).catch(() => {})
}

function addToHistory(url, title, favicon) {
  if (isSpecial(url) || !url || activeTabIsPrivate()) return
  historyData = historyData.filter(h => h.url !== url)
  historyData.unshift({ url, title: title || url, favicon: favicon || null, time: Date.now() })
  saveHistory()
}

function renderHistory(filter) {
  const list = document.getElementById('history-list')
  const q = (filter || '').trim().toLowerCase()
  const items = q
    ? historyData.filter(h => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
    : historyData
  if (!items.length) {
    list.innerHTML = `<div class="history-empty">${q ? 'Aucun résultat' : 'Aucun historique'}</div>`
    return
  }
  const frag = document.createDocumentFragment()
  let lastDay = ''
  for (const item of items) {
    const d = new Date(item.time); const dayKey = d.toDateString()
    if (dayKey !== lastDay && !q) {
      lastDay = dayKey
      const lbl = document.createElement('div'); lbl.className = 'history-day'
      const today = new Date().toDateString(); const yest = new Date(Date.now() - 86400000).toDateString()
      lbl.textContent = dayKey === today ? "Aujourd'hui" : dayKey === yest ? 'Hier'
        : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      frag.appendChild(lbl)
    }
    const el = document.createElement('div'); el.className = 'history-item'
    el.innerHTML = `
      ${safeFavicon(item.favicon) ? `<img src="${safeFavicon(item.favicon)}">` : '<div style="width:15px"></div>'}
      <div class="history-item-info">
        <div class="history-item-title">${escapeHtml(item.title)}</div>
        <div class="history-item-url">${escapeHtml(item.url)}</div>
      </div>
      <div class="history-item-time">${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
    `
    el.addEventListener('click', () => { navigate(item.url); closeHistory() })
    frag.appendChild(el)
  }
  list.replaceChildren(frag)
}

function openHistory() {
  renderHistory()
  historyPanel.classList.add('visible')
  document.getElementById('history-search').value = ''
  setTimeout(() => document.getElementById('history-search').focus(), 50)
}
function closeHistory()  { historyPanel.classList.remove('visible') }
function toggleHistory() { historyPanel.classList.contains('visible') ? closeHistory() : openHistory() }


// ============================================================
// TÉLÉCHARGEMENTS
// ============================================================

function renderDownloads() {
  if (downloads.size === 0) { dlBar.classList.remove('visible'); document.getElementById('btn-downloads').classList.remove('active'); return }
  dlBar.classList.add('visible')
  const frag = document.createDocumentFragment()
  for (const [id, dl] of downloads) {
    const pct  = dl.total ? Math.round(dl.received / dl.total * 100) : 0
    const done = dl.state === 'completed'
    const fail = dl.state === 'cancelled' || dl.state === 'interrupted'
    const el   = document.createElement('div'); el.className = 'dl-item'; el.dataset.id = id
    const fname = escapeHtml(dl.filename)
    el.innerHTML = `
      <div class="dl-item-top">
        <span class="dl-name" title="${fname}">${fname}</span>
        <span class="dl-status ${done ? 'done' : fail ? 'error' : ''}">${done ? 'Terminé' : fail ? 'Annulé' : pct + '%'}</span>
      </div>
      ${!done && !fail ? `<div class="dl-progress-track"><div class="dl-progress-fill" style="width:${pct}%"></div></div>` : ''}
    `
    if (done) el.addEventListener('click', () => window.bridge.openFile(dl.savePath))
    frag.appendChild(el)
  }
  dlList.replaceChildren(frag)
}


// ============================================================
// PROGRESSION
// ============================================================

function startProgress() {
  clearTimeout(progressTimer)
  progressBar.style.transition = 'none'; progressBar.style.width = '0%'
  progressBar.classList.add('active')
  let val = 0
  function tick() {
    val += (88 - val) * 0.18 + Math.random() * 4; val = Math.min(val, 88)
    progressBar.style.transition = 'width .35s ease-out'; progressBar.style.width = val + '%'
    progressTimer = setTimeout(tick, 350 + Math.random() * 300)
  }
  setTimeout(tick, 60)
}

function completeProgress() {
  clearTimeout(progressTimer)
  progressBar.style.transition = 'width .15s ease-out'; progressBar.style.width = '100%'
  setTimeout(() => {
    progressBar.style.transition = 'opacity .3s'
    progressBar.classList.remove('active')
    setTimeout(() => { progressBar.style.width = '0%' }, 350)
  }, 200)
}


// ============================================================
// RECHERCHE DANS LA PAGE
// ============================================================

function openFind() { findBar.classList.add('visible'); findInput.focus(); if (findInput.value) findInput.select() }
function closeFind() {
  findBar.classList.remove('visible'); findCount.textContent = ''
  findCount.classList.remove('no-result')
  if (webviewReady) wv().stopFindInPage('clearSelection')
}
function doFind(fwd = true) {
  const text = findInput.value.trim(); if (!text || !webviewReady) return
  wv().findInPage(text, { forward: fwd, findNext: true })
}


// ============================================================
// ZOOM
// ============================================================

function applyZoom(f) {
  zoomLevel = Math.max(0.25, Math.min(5, Math.round(f * 10) / 10))
  if (webviewReady) wv().setZoomFactor(zoomLevel)
}
function zoomIn()    { applyZoom(zoomLevel + 0.1) }
function zoomOut()   { applyZoom(zoomLevel - 0.1) }
function zoomReset() { applyZoom(1.0) }


// ============================================================
// SIDEBAR
// ============================================================

function toggleSidebar() {
  sidebarVisible = !sidebarVisible
  sidebar.classList.toggle('collapsed', !sidebarVisible)
  localStorage.setItem('arc-sidebar-visible', sidebarVisible)
}

function toggleFocusMode() {
  focusMode = !focusMode
  document.body.classList.toggle('focus-mode', focusMode)
  const btn = document.getElementById('btn-focus-mode')
  if (btn) btn.classList.toggle('active', focusMode)
}


// ============================================================
// DRAG & DROP
// ============================================================

function clearDragStyles() {
  document.querySelectorAll('.dragging, .drag-over-top, .drag-over-bottom')
    .forEach(el => el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'))
}
function applyDragOver(targetEl, clientY) {
  clearDragStyles(); if (!targetEl) return
  const rect = targetEl.getBoundingClientRect()
  targetEl.classList.add(clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom')
}
function reorder(arr, srcId, tgtId, clientY, tgtEl) {
  const rect = tgtEl.getBoundingClientRect(); const after = clientY >= rect.top + rect.height / 2
  const srcIdx = arr.findIndex(x => x.id === srcId); const [item] = arr.splice(srcIdx, 1)
  const newTgt = arr.findIndex(x => x.id === tgtId); arr.splice(after ? newTgt + 1 : newTgt, 0, item)
}


// ============================================================
// RACCOURCIS CLAVIER
// ============================================================

function handleShortcut(mod, shift, alt, code) {
  if (mod && !shift && code === 'KeyT') { createTab(); return true }
  if (mod && shift && code === 'KeyT') { restoreClosedTab(); return true }
  if (mod && shift && code === 'KeyN') { createTab(null, true); return true }
  if (mod && code === 'KeyW') { if (!activeEssentialId && activeTabId) closeTab(activeTabId); return true }
  if (mod && code === 'KeyL') { const inp = currentLayout === 'top' ? topUrlInput : urlInput; setTimeout(() => { wv().blur(); inp.focus(); inp.select() }, 50); return true }
  if (mod && code === 'KeyR') { if (webviewReady) shift ? wv().reloadIgnoringCache() : wv().reload(); return true }
  if (mod && code === 'KeyF') { setTimeout(() => { wv().blur(); openFind() }, 50); return true }
  if (mod && code === 'KeyK') { openPalette(); return true }
  if (mod && code === 'KeyH') { toggleHistory(); return true }
  if (mod && code === 'KeyB') { toggleSidebar(); return true }
  if (mod && code === 'KeyD') { addCurrentPageAsEssential(); return true }
  if (code === 'F3')  { openFind(); return true }
  if (code === 'F5')  { if (webviewReady) wv().reload(); return true }
  if (code === 'F8')  { toggleFocusMode(); return true }
  if (code === 'F11') { window.bridge.toggleFullscreen(); return true }
  if (code === 'F12') { if (webviewReady) wv().openDevTools(); return true }
  if (mod && shift && code === 'KeyI') { if (webviewReady) wv().openDevTools(); return true }
  if (alt && code === 'ArrowLeft')  { if (webviewReady && wv().canGoBack())    wv().goBack();    return true }
  if (alt && code === 'ArrowRight') { if (webviewReady && wv().canGoForward()) wv().goForward(); return true }
  if (mod && (code === 'Equal'  || code === 'NumpadAdd'))      { zoomIn();    return true }
  if (mod && (code === 'Minus'  || code === 'NumpadSubtract')) { zoomOut();   return true }
  if (mod && (code === 'Digit0' || code === 'Numpad0'))        { zoomReset(); return true }
  if (code === 'Escape') {
    if (document.getElementById('cmd-overlay')?.style.display === 'flex') { closePalette(); return true }
    if (permBar.classList.contains('visible'))    { permBar.classList.remove('visible'); return true }
    if (findBar.classList.contains('visible'))    { closeFind();   return true }
    if (historyPanel.classList.contains('visible')) { closeHistory(); return true }
    if (document.activeElement === urlInput || document.activeElement === topUrlInput) { document.activeElement.blur(); return true }
    if (isLoading && webviewReady) { wv().stop(); return true }
  }
  if (mod && code === 'Tab' && !activeEssentialId) {
    const at = getActiveTabs()
    if (at.length > 1) {
      const idx = at.findIndex(t => t.id === activeTabId)
      activateTab(at[shift ? (idx - 1 + at.length) % at.length : (idx + 1) % at.length].id)
      return true
    }
  }
  return false
}


// ============================================================
// ÉVÉNEMENTS — SIDEBAR
// ============================================================

essentialsList.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-unload-ess]')
  if (closeBtn) { e.stopPropagation(); unloadEssential(closeBtn.dataset.unloadEss); return }
  const item = e.target.closest('.ess-icon'); if (!item) return
  clearTimeout(essClickTimer)
  essClickTimer = setTimeout(() => activateEssential(item.dataset.id), 0)
})
essentialsList.addEventListener('dblclick', e => {
  clearTimeout(essClickTimer)
  const item = e.target.closest('.ess-icon'); if (item) startRenameEssential(item.dataset.id)
})
essentialsList.addEventListener('contextmenu', e => {
  e.preventDefault()
  const item = e.target.closest('.ess-icon')
  if (item) showContextMenu(e.clientX, e.clientY, item.dataset.id, 'essential')
})

favoritesList.addEventListener('click', e => {
  const removeFolderBtn = e.target.closest('[data-remove-folder]')
  if (removeFolderBtn) { deleteFolder(removeFolderBtn.dataset.removeFolder); return }
  const removeBtn = e.target.closest('[data-remove-fav]')
  if (removeBtn) { removeFavorite(removeBtn.dataset.removeFav); return }
  const item = e.target.closest('.tab-item'); if (!item) return
  if (item.dataset.favType === 'folder') { toggleFolder(item.dataset.id); return }
  openFavorite(item.dataset.id)
})
favoritesList.addEventListener('dblclick', e => {
  const item = e.target.closest('.tab-item'); if (item) startRenameFavorite(item.dataset.id)
})
favoritesList.addEventListener('contextmenu', e => {
  e.preventDefault()
  const item = e.target.closest('.tab-item'); if (!item) return
  const menuType = item.dataset.favType === 'folder' ? 'folder' : 'favorite'
  showContextMenu(e.clientX, e.clientY, item.dataset.id, menuType)
})

tabsList.addEventListener('click', e => {
  const muteBtn  = e.target.closest('[data-mute]')
  const closeBtn = e.target.closest('[data-close]')
  const item     = e.target.closest('.tab-item')
  if (muteBtn) {
    const tab = tabs.find(t => t.id === muteBtn.dataset.mute)
    if (tab) {
      tab.muted = !tab.muted
      if (activeTabId === tab.id && webviewReady) wv().setAudioMuted(tab.muted)
      if (activeTabId === tab.id) { globalMuted = tab.muted; updateMuteBtn() }
      saveState(); renderTabs()
    }
    return
  }
  if (closeBtn) { closeTab(closeBtn.dataset.close); return }
  if (item) { activateTab(item.dataset.id) }
})
tabsList.addEventListener('contextmenu', e => {
  e.preventDefault()
  const item = e.target.closest('.tab-item')
  if (item) showContextMenu(e.clientX, e.clientY, item.dataset.id, 'tab')
})

document.addEventListener('click', e => { if (!contextMenu.contains(e.target)) hideContextMenu() })
document.addEventListener('contextmenu', e => {
  if (!contextMenu.contains(e.target) && !tabsList.contains(e.target) && !essentialsList.contains(e.target) && !favoritesList.contains(e.target) && !spacesList.contains(e.target))
    hideContextMenu()
})
contextMenu.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]'); if (!btn || !ctxTargetId) return
  const action = btn.dataset.action, targetId = ctxTargetId, type = ctxType
  hideContextMenu()
  switch (action) {
    case 'rename':
      if (type === 'tab')                          startRenameTab(targetId)
      else if (type === 'essential')               startRenameEssential(targetId)
      else if (type === 'favorite' || type === 'folder') startRenameFavorite(targetId)
      break
    case 'pin':              pinTabAsEssential(targetId); break
    case 'add-favorite':    addTabAsFavorite(targetId); break
    case 'unload-tab':      unloadTab(targetId); break
    case 'move-space':      moveTabToSpace(targetId, btn.dataset.targetSpace); break
    case 'open-tab':         openEssentialInTab(targetId); break
    case 'update-essential-url': {
      const ess = essentials.find(e => e.id === targetId)
      const ev  = pageWebviews.get(targetId)
      if (ess && ev && !ev.isDestroyed()) {
        const newUrl = ev.getURL()
        if (newUrl && !isSpecial(newUrl)) { ess.url = newUrl; saveState(); renderEssentials() }
      }
      break
    }
    case 'close':            closeTab(targetId); break
    case 'remove-essential': removeEssential(targetId); break
    case 'remove-favorite':    removeFavorite(targetId); break
    case 'delete-folder':      deleteFolder(targetId); break
    case 'move-to-folder':     moveToFolder(targetId, btn.dataset.folderId); break
    case 'remove-from-folder': moveToFolder(targetId, null); break
    case 'rename-space':       renameSpace(targetId); break
    case 'delete-space':     deleteSpace(targetId); break
  }
})

document.getElementById('btn-settings').addEventListener('click', () => {
  if (activeTabIsPrivate()) { createTab(SETTINGS_URL); return }
  navigate(SETTINGS_URL)
  if (activeTabId && !activeEssentialId) {
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab) { tab.url = SETTINGS_URL; saveState() }
  }
})
document.getElementById('btn-add-space').addEventListener('click', createSpace)
document.getElementById('history-close').addEventListener('click', closeHistory)
document.getElementById('history-clear').addEventListener('click', () => { historyData = []; saveHistory(); renderHistory() })
document.getElementById('history-search').addEventListener('input', e => renderHistory(e.target.value))

window.bridge.onDlStart(d => {
  downloads.set(d.id, { filename: d.filename, received: 0, total: d.total, state: 'progressing', savePath: '' })
  renderDownloads()
})
window.bridge.onDlUpdate(d => {
  const dl = downloads.get(d.id); if (!dl) return
  dl.received = d.received; dl.total = d.total; dl.state = d.state; renderDownloads()
})
window.bridge.onDlDone(d => {
  const dl = downloads.get(d.id); if (!dl) return
  dl.state = d.state; dl.savePath = d.savePath; renderDownloads()
  if (d.state === 'completed') setTimeout(() => { downloads.delete(d.id); renderDownloads() }, 8000)
})
document.getElementById('dl-folder-btn').addEventListener('click', () => window.bridge.openDlFolder())
document.getElementById('dl-close-btn').addEventListener('click', () => {
  downloads.clear(); renderDownloads()
  document.getElementById('btn-downloads').classList.remove('active')
})

urlInput.addEventListener('focus', () => urlInput.select())
urlInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const url = normalizeUrl(urlInput.value)
  if (activeTabId && !activeEssentialId) {
    const tab = tabs.find(t => t.id === activeTabId); if (tab) tab.url = url
  }
  navigate(url)
})

btnBack.addEventListener('click',    () => { if (webviewReady && wv().canGoBack())    wv().goBack() })
btnForward.addEventListener('click', () => { if (webviewReady && wv().canGoForward()) wv().goForward() })
btnReload.addEventListener('click',  () => { if (!webviewReady) return; isLoading ? wv().stop() : wv().reload() })
btnMute.addEventListener('click', () => {
  globalMuted = !globalMuted
  if (webviewReady) wv().setAudioMuted(globalMuted)
  if (activeTabId && !activeEssentialId) {
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab) { tab.muted = globalMuted; saveState(); renderTabs() }
  }
  updateMuteBtn()
})

document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar)
document.getElementById('btn-focus-mode').addEventListener('click', toggleFocusMode)
document.getElementById('btn-new-private').addEventListener('click', () => createTab(null, true))
document.getElementById('btn-downloads').addEventListener('click', () => {
  const btn = document.getElementById('btn-downloads')
  const visible = dlBar.classList.toggle('visible')
  btn.classList.toggle('active', visible)
})
// ── Top bar event listeners
topUrlInput.addEventListener('focus', () => topUrlInput.select())
topUrlInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const url = normalizeUrl(topUrlInput.value)
  if (activeTabId && !activeEssentialId) { const tab = tabs.find(t => t.id === activeTabId); if (tab) tab.url = url }
  navigate(url)
})
topBtnBack.addEventListener('click',    () => { if (webviewReady && wv().canGoBack())    wv().goBack() })
topBtnForward.addEventListener('click', () => { if (webviewReady && wv().canGoForward()) wv().goForward() })
topBtnReload.addEventListener('click',  () => { if (!webviewReady) return; isLoading ? wv().stop() : wv().reload() })
topBtnMute.addEventListener('click',    () => btnMute.click())

// Boutons souris supplémentaires (retour = 3, avant = 4)
window.addEventListener('mouseup', e => {
  if (e.button === 3) { if (webviewReady && wv().canGoBack())    wv().goBack() }
  if (e.button === 4) { if (webviewReady && wv().canGoForward()) wv().goForward() }
})
document.getElementById('top-btn-new-tab').addEventListener('click', () => createTab())
topTabsList.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-close]')
  if (closeBtn) { closeTab(closeBtn.dataset.close); return }
  const item = e.target.closest('.top-tab'); if (!item) return
  activateTab(item.dataset.id)
})

document.getElementById('btn-add-essential').addEventListener('click', addCurrentPageAsEssential)
document.getElementById('btn-add-favorite').addEventListener('click', addCurrentPageAsFavorite)
document.getElementById('btn-import-bookmarks').addEventListener('click', importBookmarksHtml)
document.getElementById('btn-add-folder').addEventListener('click', createFolder)

const resizeHandle = document.getElementById('resize-handle')
resizeHandle.addEventListener('mousedown', e => {
  if (!sidebarVisible) return
  isResizing = true; resizeStartX = e.clientX; resizeStartW = sidebar.offsetWidth
  sidebar.classList.add('resizing'); resizeHandle.classList.add('active')
  document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault()
})
document.addEventListener('mousemove', e => {
  if (!isResizing) return
  const newW = Math.max(160, Math.min(420, resizeStartW + e.clientX - resizeStartX))
  sidebar.style.width = newW + 'px'; sidebar.style.minWidth = newW + 'px'
})
document.addEventListener('mouseup', () => {
  if (!isResizing) return
  isResizing = false; sidebar.classList.remove('resizing'); resizeHandle.classList.remove('active')
  document.body.style.cursor = ''; document.body.style.userSelect = ''
  localStorage.setItem('arc-sidebar-width', sidebar.offsetWidth)
})

findInput.addEventListener('input', () => {
  const text = findInput.value.trim(); if (!webviewReady) return
  if (text) wv().findInPage(text)
  else { wv().stopFindInPage('clearSelection'); findCount.textContent = '' }
})
findInput.addEventListener('keydown', e => {
  e.stopPropagation()
  if (e.key === 'Enter')  { doFind(!e.shiftKey); return }
  if (e.key === 'Escape') { closeFind(); return }
})
document.getElementById('find-prev').addEventListener('click',  () => doFind(false))
document.getElementById('find-next').addEventListener('click',  () => doFind(true))
document.getElementById('find-close').addEventListener('click', closeFind)

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey
  if ((document.activeElement === urlInput || document.activeElement === topUrlInput) && !mod && !e.altKey && e.code !== 'Escape') return
  if (document.activeElement === findInput) return
  if (handleShortcut(mod, e.shiftKey, e.altKey, e.code)) e.preventDefault()
})
window.bridge.onWebviewShortcut(({ mod, shift, alt, code }) => {
  handleShortcut(mod, shift, alt, code)
})

window.bridge.onPermissionRequest(data => {
  pendingPermKey = data.key
  permText.textContent = `${data.origin} demande accès à : ${data.label}`
  permBar.classList.add('visible')
})
document.getElementById('perm-allow').addEventListener('click', () => {
  if (pendingPermKey) { window.bridge.answerPermission(pendingPermKey, true); pendingPermKey = null }
  permBar.classList.remove('visible')
})
document.getElementById('perm-deny').addEventListener('click', () => {
  if (pendingPermKey) { window.bridge.answerPermission(pendingPermKey, false); pendingPermKey = null }
  permBar.classList.remove('visible')
})
document.getElementById('perm-dismiss').addEventListener('click', () => {
  if (pendingPermKey) { window.bridge.answerPermission(pendingPermKey, false); pendingPermKey = null }
  permBar.classList.remove('visible')
})


// ============================================================
// ÉVÉNEMENTS — DRAG & DROP
// ============================================================

tabsList.addEventListener('dragstart', e => {
  const item = e.target.closest('.tab-item'); if (!item) return
  dragId = item.dataset.id; dragType = 'tab'
  e.dataTransfer.effectAllowed = 'move'
  requestAnimationFrame(() => item.classList.add('dragging'))
})
tabsList.addEventListener('dragover', e => {
  if (dragType !== 'tab') return
  e.preventDefault(); applyDragOver(e.target.closest('.tab-item'), e.clientY)
})
tabsList.addEventListener('drop', e => {
  e.preventDefault(); clearDragStyles()
  const target = e.target.closest('.tab-item')
  if (!target || !dragId || target.dataset.id === dragId) return
  reorder(tabs, dragId, target.dataset.id, e.clientY, target); saveState(); renderTabs()
})
tabsList.addEventListener('dragend', () => { clearDragStyles(); dragId = null; dragType = null })

essentialsList.addEventListener('dragstart', e => {
  clearTimeout(essClickTimer)
  const item = e.target.closest('.ess-icon'); if (!item) return
  dragId = item.dataset.id; dragType = 'essential'
  e.dataTransfer.effectAllowed = 'move'
  requestAnimationFrame(() => item.classList.add('dragging'))
})
essentialsList.addEventListener('dragover', e => {
  if (dragType !== 'essential' && dragType !== 'tab') return
  e.preventDefault(); essentialsList.classList.add('drag-target')
  applyDragOver(e.target.closest('.ess-icon'), e.clientY)
})
essentialsList.addEventListener('dragleave', e => {
  if (!essentialsList.contains(e.relatedTarget)) { essentialsList.classList.remove('drag-target'); clearDragStyles() }
})
essentialsList.addEventListener('drop', e => {
  e.preventDefault(); essentialsList.classList.remove('drag-target'); clearDragStyles()
  const targetItem = e.target.closest('.ess-icon')
  if (dragType === 'essential') {
    if (!targetItem || !dragId || targetItem.dataset.id === dragId) return
    reorder(essentials, dragId, targetItem.dataset.id, e.clientY, targetItem); saveState(); renderEssentials()
  } else if (dragType === 'tab') {
    const tab = tabs.find(t => t.id === dragId); if (!tab || isSpecial(tab.url) || tab.private) return
    const url = normalizeUrl(tab.url)
    if (!essentials.find(ess => ess.url === url)) {
      const newEss = { id: 'e' + Date.now(), title: tab.title || url, url, favicon: tab.favicon }
      if (targetItem) {
        const rect   = targetItem.getBoundingClientRect()
        const tgtIdx = essentials.findIndex(ess => ess.id === targetItem.dataset.id)
        essentials.splice(e.clientY >= rect.top + rect.height / 2 ? tgtIdx + 1 : tgtIdx, 0, newEss)
      } else { essentials.push(newEss) }
    }
    const wasActive = activeTabId === dragId
    const tabIdx    = tabs.findIndex(t => t.id === dragId)
    if (tabIdx !== -1) tabs.splice(tabIdx, 1)
    // Nettoyer le webview de l'onglet supprimé du pool
    const oldWv = pageWebviews.get(dragId)
    if (oldWv) { try { oldWv.src = 'about:blank' } catch {} oldWv.remove(); pageWebviews.delete(dragId) }
    if (wasActive) {
      const pinned = essentials.find(ess => ess.url === url)
      if (pinned) { activeEssentialId = pinned.id; activeTabId = null }
      else { const at = getActiveTabs(); at.length ? activateTab(at[0].id) : createTab() }
    }
    const at = getActiveTabs()
    if (!at.length) tabs.push({ id: 't' + Date.now(), title: 'Nouvel onglet', url: NEWTAB_URL, favicon: null, spaceId: activeSpaceId, lastUsed: Date.now(), archived: false })
    saveState(); render()
  }
})
essentialsList.addEventListener('dragend', () => { essentialsList.classList.remove('drag-target'); clearDragStyles(); dragId = null; dragType = null })


// ============================================================
// ÉVÉNEMENTS — WEBVIEW (gérés via wireWebviewEvents par le pool)
// ============================================================






// ============================================================
// INIT
// ============================================================

if (localStorage.getItem('arc-sidebar-visible') === 'false') {
  sidebarVisible = false; sidebar.classList.add('collapsed')
}
const savedWidth = localStorage.getItem('arc-sidebar-width')
if (savedWidth) { sidebar.style.width = savedWidth + 'px'; sidebar.style.minWidth = savedWidth + 'px' }

window.bridge.onFullscreenChange(isFS => document.body.classList.toggle('fullscreen', isFS))
window.bridge.onOpenNewTab(url => { if (url) createTab(url) })

loadState(); loadHistory(); render(); startArchiveTimer(); startScrollSaver()
setInterval(autoSuspendCheck, 5 * 60 * 1000)

const activeItem = activeEssentialId
  ? essentials.find(e => e.id === activeEssentialId)
  : tabs.find(t => t.id === activeTabId)

if (activeItem) {
  const initKey = activeEssentialId || activeTabId
  // Réutiliser le #webview statique comme première entrée du pool
  webview.__key   = initKey
  webview.style.display = ''
  wireWebviewEvents(webview)
  pageWebviews.set(initKey, webview)
  webview.src = normalizeUrl(activeItem.url)
  syncUrlBars(displayUrl(activeItem.url))
}

// ── Auto-update
let pendingUpdate  = null   // { version } ou null
let snoozeTimer    = null

function showUpdateBar(version) {
  updateMsg.textContent = `Divo ${version} disponible`
  updateBar.classList.add('visible')
}

window.bridge.onUpdateAvailable(({ version }) => {
  pendingUpdate = { version }
  showUpdateBar(version)
})

window.bridge.onUpdateProgress(pct => {
  if (pct < 0) {
    // Erreur signalée par main
    updateInstallBtn.disabled = false
    updateInstallBtn.textContent = 'Installer'
    updateMsg.textContent = 'Erreur — réessayer plus tard'
    return
  }
  updateInstallBtn.textContent = pct < 100 ? `${pct}%` : 'Installation…'
})

updateInstallBtn.addEventListener('click', async () => {
  if (!pendingUpdate) return
  updateInstallBtn.disabled = true
  updateInstallBtn.textContent = 'Téléchargement…'
  const result = await window.bridge.installUpdate()
  // result.ok = true → app.exit() dans 200ms, on ne revient jamais ici
  // result.ok = false → erreur, le renderer reçoit aussi update-progress:-1
  if (!result?.ok) {
    updateInstallBtn.disabled = false
    updateInstallBtn.textContent = 'Installer'
    updateMsg.textContent = `Erreur : ${result?.reason || 'réessayer plus tard'}`
  }
})

// "Plus tard" — masque la barre et la réaffiche après 2h si la mise à jour est toujours là
updateDismissBtn.addEventListener('click', () => {
  updateBar.classList.remove('visible')
  clearTimeout(snoozeTimer)
  snoozeTimer = setTimeout(() => {
    if (pendingUpdate) showUpdateBar(pendingUpdate.version)
  }, 2 * 60 * 60 * 1000)
})

// ── Navigateur par défaut
window.bridge.onNotDefaultBrowser(() => {
  if (!localStorage.getItem('default-browser-dismissed')) defaultBrowserBar.classList.add('visible')
})
defaultBrowserSet.addEventListener('click', () => {
  window.bridge.setDefaultBrowser()
  defaultBrowserBar.classList.remove('visible')
})
defaultBrowserDismiss.addEventListener('click', () => {
  localStorage.setItem('default-browser-dismissed', '1')
  defaultBrowserBar.classList.remove('visible')
})

// ── Mini player controls
document.getElementById('mini-player-pip').addEventListener('click', () => {
  const key = miniPlayer.dataset.playKey
  const playingWv = (key && pageWebviews.get(key)) || wv()
  if (!playingWv?.__ready) return
  playingWv.executeJavaScript(`(function(){
    try {
      const v = Array.from(document.querySelectorAll('video')).find(v => !v.paused) || document.querySelector('video')
      if (v && document.pictureInPictureEnabled) v.requestPictureInPicture().catch(function(){})
    } catch(e) {}
  })()`, true).catch(() => {})
})
document.getElementById('mini-player-go').addEventListener('click', () => {
  const key = miniPlayer.dataset.playKey
  if (!key) return
  if (essentials.find(e => e.id === key)) activateEssential(key)
  else activateTab(key)
})

// ── Drag onglets → favoris
favoritesList.addEventListener('dragover', e => {
  if (dragType !== 'tab') return
  e.preventDefault()
  favoritesList.classList.add('drag-target')
})
favoritesList.addEventListener('dragleave', e => {
  if (!favoritesList.contains(e.relatedTarget)) favoritesList.classList.remove('drag-target')
})
favoritesList.addEventListener('drop', e => {
  e.preventDefault()
  favoritesList.classList.remove('drag-target')
  clearDragStyles()
  if (dragType !== 'tab') return
  const tab = tabs.find(t => t.id === dragId)
  if (!tab || isSpecial(tab.url) || tab.private) return
  if (!favorites.find(f => f.url === tab.url && f.spaceId === activeSpaceId)) {
    favorites.push({ id: 'f' + Date.now(), title: tab.title || tab.url, url: tab.url, favicon: tab.favicon || null, spaceId: activeSpaceId })
    saveState()
    renderFavorites()
  }
})

// ═══════════════════════════════════════════════
// ── COMMAND PALETTE (Ctrl+K)
// ═══════════════════════════════════════════════
;(function() {
  const overlay  = document.getElementById('cmd-overlay')
  const backdrop = document.getElementById('cmd-backdrop')
  const input    = document.getElementById('cmd-input')
  const results  = document.getElementById('cmd-results')

  let activeIdx  = -1
  let items      = []   // liste plate des items renderisés

  // ── Actions statiques
  const ACTIONS = [
    { type:'action', title:'Nouvel onglet',              icon:'new-tab',    kbd:'Ctrl+T',   run:() => createTab() },
    { type:'action', title:'Navigation privée',          icon:'private',    kbd:'Ctrl+⇧N',  run:() => createTab(null, true) },
    { type:'action', title:'Paramètres',                 icon:'settings',   kbd:'',         run:() => createTab(SETTINGS_URL) },
    { type:'action', title:'Historique',                 icon:'history',    kbd:'Ctrl+H',   run:() => toggleHistory() },
    { type:'action', title:'Téléchargements',            icon:'downloads',  kbd:'',         run:() => document.getElementById('btn-downloads')?.click() },
    { type:'action', title:'Recharger la page',          icon:'reload',     kbd:'Ctrl+R',   run:() => { if (webviewReady) wv().reload() } },
    { type:'action', title:'Fermer l\'onglet',           icon:'close-tab',  kbd:'Ctrl+W',   run:() => { if (activeTabId && !activeEssentialId) closeTab(activeTabId) } },
    { type:'action', title:'Plein écran',                icon:'fullscreen', kbd:'F11',      run:() => window.bridge.toggleFullscreen() },
    { type:'action', title:'Afficher / masquer sidebar', icon:'sidebar',    kbd:'Ctrl+B',   run:() => toggleSidebar() },
    { type:'action', title:'Mode focus',                 icon:'focus',      kbd:'F8',       run:() => toggleFocusMode() },
    { type:'action', title:'Outils développeur',         icon:'devtools',   kbd:'F12',      run:() => { if (webviewReady) wv().openDevTools() } },
    { type:'action', title:'Épingler en Essential',      icon:'pin',        kbd:'Ctrl+D',   run:() => addCurrentPageAsEssential() },
    { type:'action', title:'Focus barre URL',            icon:'url',        kbd:'Ctrl+L',   run:() => { const inp = currentLayout === 'top' ? topUrlInput : urlInput; inp.focus(); inp.select() } },
  ]

  const ICONS = {
    'new-tab':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    'private':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    'settings':   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>',
    'history':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    'downloads':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    'reload':     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    'close-tab':  '<svg width="12" height="12" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>',
    'fullscreen': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    'sidebar':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
    'pin':        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    'url':        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'focus':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    'devtools':   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    'globe':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  }

  // ── Helpers
  function getHistory() {
    try { return JSON.parse(localStorage.getItem('arc-history') || '[]') } catch { return [] }
  }

  function match(q, title, url) {
    if (!q) return true
    const lq = q.toLowerCase()
    return (title || '').toLowerCase().includes(lq) || (url || '').toLowerCase().includes(lq)
  }

  function highlight(text, q) {
    if (!q || !text) return escapeHtml(text || '')
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    if (i === -1) return escapeHtml(text)
    return escapeHtml(text.slice(0, i)) +
      `<mark>${escapeHtml(text.slice(i, i + q.length))}</mark>` +
      escapeHtml(text.slice(i + q.length))
  }

  // ── Rendu
  function render(q) {
    const html  = []
    items = []

    function section(label, list, builder) {
      if (!list.length) return
      html.push(`<div class="cmd-section"><div class="cmd-section-label">${label}</div>`)
      list.forEach(it => { builder(it); })
      html.push('</div>')
    }

    function addItem(item, titleHtml, urlText, kbdText, iconHtml) {
      const idx = items.length
      items.push(item)
      const kbd = kbdText ? `<span class="cmd-kbd">${escapeHtml(kbdText)}</span>` : ''
      const url = urlText ? `<div class="cmd-url">${escapeHtml(urlText)}</div>` : ''
      html.push(`<div class="cmd-item" data-idx="${idx}">
        <div class="cmd-icon">${iconHtml}</div>
        <div class="cmd-info"><div class="cmd-title">${titleHtml}</div>${url}</div>
        ${kbd}
      </div>`)
    }

    // Si query non vide : toujours proposer "Ouvrir / Rechercher" en tête
    if (q) {
      const nav = { type: 'navigate', url: normalizeUrl(q) }
      const isUrl = /^https?:\/\/|^[\w-]+\.[\w.-]{2,}/.test(q)
      const label = isUrl ? `Ouvrir  ${q}` : `Rechercher  "${q}"`
      addItem(nav, `<span style="color:#0a84ff">${escapeHtml(label)}</span>`, '', '', ICONS.globe)
    }

    // Actions
    const actFiltered = ACTIONS.filter(a => match(q, a.title, ''))
    section('Actions', actFiltered, a => addItem(a, highlight(a.title, q), '', a.kbd, ICONS[a.icon] || ICONS.globe))

    // Onglets ouverts (essentials + tabs du space courant)
    const openTabs = [...essentials.map(e => ({ ...e, _ess: true })), ...tabs.filter(t => !t.archived)]
      .filter(t => match(q, t.title, t.url))
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
      .slice(0, 10)
    section('Onglets ouverts', openTabs, t => {
      const fav = safeFavicon(t.favicon)
      const ico = fav ? `<img class="cmd-favicon" src="${fav}">` : ICONS.globe
      const badge = t._ess ? ' <span style="font-size:10px;color:#48484a">Essential</span>' : ''
      addItem({ type: t._ess ? 'essential' : 'tab', id: t.id }, highlight(t.title || t.url, q) + badge, t.url, '', ico)
    })

    // Favoris
    const favFiltered = favorites.filter(f => match(q, f.title, f.url)).slice(0, 6)
    section('Favoris', favFiltered, f => {
      const fav = safeFavicon(f.favicon)
      const ico = fav ? `<img class="cmd-favicon" src="${fav}">` : ICONS.globe
      addItem({ type: 'open', url: f.url }, highlight(f.title || f.url, q), f.url, '', ico)
    })

    // Historique (seulement si query non vide)
    if (q) {
      const hist = getHistory().filter(h => match(q, h.title, h.url)).slice(0, 8)
      section('Historique', hist, h => {
        const fav = safeFavicon(h.favicon)
        const ico = fav ? `<img class="cmd-favicon" src="${fav}">` : ICONS.globe
        addItem({ type: 'open', url: h.url }, highlight(h.title || h.url, q), h.url, '', ico)
      })
    }

    if (!items.length) {
      html.push(`<div class="cmd-empty">Aucun résultat pour « ${escapeHtml(q)} »</div>`)
    }

    results.innerHTML = html.join('')

    // Attacher les événements
    results.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.addEventListener('mouseenter', () => setActive(i, false))
      el.addEventListener('click',      () => run(items[i]))
    })

    // Sélectionner le premier par défaut
    activeIdx = items.length ? 0 : -1
    highlight_active()
  }

  function setActive(idx, scroll = true) {
    activeIdx = idx
    highlight_active(scroll)
  }

  function highlight_active(scroll = true) {
    results.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIdx)
    })
    if (scroll) {
      const el = results.querySelector('.cmd-item.active')
      if (el) el.scrollIntoView({ block: 'nearest' })
    }
  }

  function run(item) {
    if (!item) return
    close()
    switch (item.type) {
      case 'action':    item.run(); break
      case 'tab':       activateTab(item.id); break
      case 'essential': activateEssential(item.id); break
      case 'open':
      case 'navigate':  createTab(item.url); break
    }
  }

  // ── Open / Close
  function open() {
    overlay.style.display = 'flex'
    input.value = ''
    render('')
    requestAnimationFrame(() => input.focus())
  }

  function close() {
    overlay.style.display = 'none'
    try { wv().focus() } catch {}
  }

  // ── Événements
  input.addEventListener('input', () => { activeIdx = 0; render(input.value.trim()) })

  input.addEventListener('keydown', e => {
    switch (e.key) {
      case 'Escape':    e.preventDefault(); close(); break
      case 'ArrowDown': e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); break
      case 'ArrowUp':   e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); break
      case 'Enter':     e.preventDefault(); run(items[activeIdx]); break
    }
  })

  backdrop.addEventListener('click', close)

  // ── Export vers handleShortcut
  window.openPalette  = open
  window.closePalette = close
})()

