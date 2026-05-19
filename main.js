const { app, BrowserWindow, ipcMain, protocol, webContents, shell, session, dialog, net } = require('electron')
const path = require('path')
const fs   = require('fs')
const { spawn } = require('child_process')
const crypto = require('crypto')
const { installChromeWebStore, installExtension, uninstallExtension } = require('electron-chrome-web-store')

// Désactive l'accélération GPU pour éviter les crashs GPU silencieux
app.disableHardwareAcceleration()

// ── Crash logging
const LOG_PATH = path.join(app.getPath('userData'), 'crash.log')
function writeLog(msg) {
  try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`) } catch {}
}
process.on('uncaughtException', e => { writeLog('uncaughtException: ' + e.stack); throw e })
process.on('unhandledRejection', (reason) => { writeLog('unhandledRejection: ' + reason) })

protocol.registerSchemesAsPrivileged([
  { scheme: 'divo', privileges: { standard: true, supportFetchAPI: true } }
])

// ID fixe = Windows conserve l'épingle dans la barre des tâches lors des mises à jour
if (process.platform === 'win32') app.setAppUserModelId('com.divh.divo')

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow
const downloadItems = new Map()
const pendingPerms  = new Map()

// Protocoles autorisés dans le webview — tout le reste → shell.openExternal()
const SAFE_PROTOS = new Set(['http:', 'https:', 'divo:', 'file:', 'chrome:'])

// Domaines jamais bloqués par l'adblocker (infrastructure légitime)
const ADBLOCK_NEVER_BLOCK = new Set([
  'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'googlevideo.com', 'google.fr', 'google.co.uk', 'google.de', 'google.ca',
  'google.es', 'google.it', 'google.com.br', 'google.com.au', 'google.co.jp',
  'apple.com', 'icloud.com', 'aaplimg.com',
  'microsoft.com', 'microsoftonline.com', 'live.com', 'office.com',
  'cloudflare.com', 'cloudflare-dns.com',
  'fastly.net', 'akamaized.net', 'akamai.net',
])

const WEBVIEW_SHORTCUTS = new Set([
  'ctrl+KeyT', 'ctrl+shift+KeyT', 'ctrl+shift+KeyN', 'ctrl+KeyW',
  'ctrl+KeyL', 'ctrl+KeyR', 'ctrl+shift+KeyR', 'ctrl+KeyF',
  'ctrl+KeyH', 'ctrl+KeyB', 'ctrl+KeyD', 'ctrl+KeyK', 'ctrl+Tab', 'ctrl+shift+Tab',
  'ctrl+Equal', 'ctrl+NumpadAdd', 'ctrl+Minus', 'ctrl+NumpadSubtract',
  'ctrl+Digit0', 'ctrl+Numpad0',
  'alt+ArrowLeft', 'alt+ArrowRight',
  'F3', 'F5', 'F11', 'Escape'
])

// ── Config persistante
const configPath = path.join(app.getPath('userData'), 'config.json')
let config = { adblock: true, webDarkMode: false, httpsUpgrade: true }
try { Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf-8'))) } catch {}
function saveConfig() { try { fs.writeFileSync(configPath, JSON.stringify(config)) } catch (e) { console.error('saveConfig error', e) } }

// ── État navigateur persistant (essentials, favoris, onglets, espaces)
const statePath = path.join(app.getPath('userData'), 'state.json')
let cachedAppState = null
try { cachedAppState = JSON.parse(fs.readFileSync(statePath, 'utf-8')) } catch {}
function writeAppState(s) { try { fs.writeFileSync(statePath, JSON.stringify(s)) } catch {} }

ipcMain.handle('state-load', () => cachedAppState)
ipcMain.handle('state-save', (_, s) => { cachedAppState = s; writeAppState(s) })
ipcMain.on('state-load-sync', e => { e.returnValue = cachedAppState })

// ── Adblocker (uBlock Origin-style)
const BL_DIR = app.getPath('userData')
const BL_VER = 'v6'
const BL_DOMAINS_FILE  = path.join(BL_DIR, `bl_${BL_VER}_domains.txt`)
const BL_COSMETIC_FILE = path.join(BL_DIR, `bl_${BL_VER}_cosmetic.json`)
const BL_TTL = 7 * 24 * 60 * 60 * 1000

let blockedDomains     = new Set()
let cosmeticGenericCSS = ''           // sélecteurs CSS génériques (sans déclaration)
const cosmeticByDomain = new Map()    // "example.com" → ["#ad", ".banner", …]

// Filtre les pseudo-classes uBlock/ABP non natives (navigateur ne les comprend pas)
function isNativeSelector(sel) {
  // Rejette toute tentative d'injection CSS via accolades ou commentaires
  if (/[{}]|\/\*|\*\//.test(sel)) return false
  const ext = [':has-text(', ':upward(', ':xpath(', ':matches-css(', ':-abp-',
               ':if(', ':if-not(', '+js(', ':watch-attr(', ':min-text-length(',
               ':matches-path(', ':others(']
  return !ext.some(s => sel.includes(s))
}

function addDomain(d) {
  const clean = d.trim().toLowerCase().replace(/^\*\./, '')
  if (clean.includes('.') && clean !== 'localhost' && !/^\d+\.\d+\.\d+/.test(clean))
    blockedDomains.add(clean)
}

// Parse liste de domaines (format oisd / hosts)
function parseDomainText(text) {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t[0] === '#' || t[0] === '!') continue
    addDomain(t.split(/\s+/).pop())
  }
}

// Parse liste ABP/EasyList → domaines réseau + règles cosmétiques
// parseNetRules=false : cosmétiques seulement (évite que EasyList bloque des services légitimes)
function parseAbpList(text, domainSet, genericSels, domainSels, parseNetRules = true) {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('!') || line.startsWith('[')) continue
    // Ignore exceptions, extended CSS, scriptlets
    if (line.startsWith('@@') || line.includes('#?#') || line.includes('#@#') || line.includes('#$#')) continue

    // Cosmétique générique : ##sélecteur
    if (line.startsWith('##')) {
      const sel = line.slice(2).trim()
      if (sel && isNativeSelector(sel)) genericSels.push(sel)
      continue
    }

    // Cosmétique par domaine : domaines##sélecteur
    const hh = line.indexOf('##')
    if (hh > 0) {
      const sel = line.slice(hh + 2).trim()
      if (!sel || !isNativeSelector(sel)) continue
      for (const raw of line.slice(0, hh).split(',')) {
        const d = raw.trim().toLowerCase().replace(/^www\./, '')
        if (!d || d.startsWith('~') || d.includes('/') || !d.includes('.')) continue
        const arr = domainSels.get(d) || []; arr.push(sel); domainSels.set(d, arr)
      }
      continue
    }

    // Règle réseau : extraire domaine depuis ||domaine^
    if (parseNetRules) {
      let rule = line
      if (line.includes('$')) rule = line.slice(0, line.lastIndexOf('$'))
      if (rule.startsWith('||')) {
        const inner = rule.slice(2).split(/[\^\/\?]/)[0].toLowerCase()
        if (inner && inner.includes('.') && /^[a-z0-9._-]+$/.test(inner)) domainSet.add(inner)
      }
    }
  }
}

// Renvoie le CSS cosmétique à injecter pour un hostname donné
function getPageCosmeticCSS(hostname) {
  const host  = hostname.replace(/^www\./, '').toLowerCase()
  const parts = host.split('.')
  const sels  = []
  for (let i = 0; i < parts.length - 1; i++) {
    const rules = cosmeticByDomain.get(parts.slice(i).join('.'))
    if (rules) sels.push(...rules)
  }
  return sels.length ? sels.join(',\n') + ' { display: none !important; }' : ''
}

async function refreshFilterLists() {
  try {
    const newDomains    = new Set()
    const newGeneric    = []
    const newByDomain   = new Map()

    // Téléchargement en parallèle
    const [domRes, elRes] = await Promise.allSettled([
      net.fetch('https://big.oisd.nl/domainswild'),
      net.fetch('https://easylist.to/easylist/easylist.txt')
    ])

    if (domRes.status === 'fulfilled' && domRes.value.ok) {
      const text = await domRes.value.text()
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t || t[0] === '#' || t[0] === '!') continue
        const d = t.split(/\s+/).pop().toLowerCase().replace(/^\*\./, '')
        if (d.includes('.') && d !== 'localhost' && !/^\d+\.\d+\.\d+/.test(d)) newDomains.add(d)
      }
    }

    if (elRes.status === 'fulfilled' && elRes.value.ok) {
      // parseNetRules=false : on utilise EasyList pour les cosmétiques uniquement,
      // OISD couvre déjà le blocage réseau sans risquer des faux-positifs Google/CDN
      parseAbpList(await elRes.value.text(), newDomains, newGeneric, newByDomain, false)
    }

    // Sauvegarde
    fs.writeFileSync(BL_DOMAINS_FILE, [...newDomains].join('\n'), 'utf-8')
    fs.writeFileSync(BL_COSMETIC_FILE, JSON.stringify({
      generic:  newGeneric.slice(0, 6000),
      byDomain: Object.fromEntries(newByDomain)
    }), 'utf-8')

    // Application immédiate
    blockedDomains     = newDomains
    cosmeticGenericCSS = newGeneric.slice(0, 6000).join(',\n')
    cosmeticByDomain.clear()
    for (const [k, v] of newByDomain) cosmeticByDomain.set(k, v)

    console.log(`[adblock] ${blockedDomains.size} domaines, ${cosmeticByDomain.size} règles cosmétiques domaine`)
  } catch (e) { console.error('[adblock] refresh error', e) }
}

function initBlocklist() {
  // Chargement rapide depuis le cache
  if (fs.existsSync(BL_DOMAINS_FILE)) {
    try {
      blockedDomains = new Set(fs.readFileSync(BL_DOMAINS_FILE, 'utf-8').split('\n').filter(Boolean))
    } catch {}
  }
  if (fs.existsSync(BL_COSMETIC_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(BL_COSMETIC_FILE, 'utf-8'))
      cosmeticGenericCSS = (data.generic || []).join(',\n')
      for (const [k, v] of Object.entries(data.byDomain || {})) cosmeticByDomain.set(k, v)
    } catch {}
  }

  const needsRefresh = !fs.existsSync(BL_DOMAINS_FILE) || !fs.existsSync(BL_COSMETIC_FILE) ||
    Date.now() - fs.statSync(BL_DOMAINS_FILE).mtimeMs > BL_TTL
  if (needsRefresh) refreshFilterLists()
}

// Sessions qui hébergent des webviews — les handlers de sécurité doivent couvrir toutes.
const PROTECTED_PARTITIONS = ['persist:divo', 'private:incognito']
function getProtectedSessions() {
  return [session.defaultSession, ...PROTECTED_PARTITIONS.map(p => session.fromPartition(p))]
}

// ═══════════════════════════════════════════════════════════════
// ── Extensions utilisateur (Chrome Web Store)
// ═══════════════════════════════════════════════════════════════
const USER_EXT_DIR = path.join(app.getPath('userData'), 'user-extensions')
fs.mkdirSync(USER_EXT_DIR, { recursive: true })

// Trouve le bon répertoire d'une extension (root ou sous-dossier versionné type "1.2.3_0")
function findExtDir(baseDir) {
  if (fs.existsSync(path.join(baseDir, 'manifest.json'))) return baseDir
  try {
    const sub = fs.readdirSync(baseDir).find(d => /^\d/.test(d) && fs.existsSync(path.join(baseDir, d, 'manifest.json')))
    if (sub) return path.join(baseDir, sub)
  } catch {}
  return baseDir
}

// Lit le manifest.json d'un répertoire d'extension (supporte les sous-dossiers versionnés)
function readExtManifest(dir) {
  const actualDir = findExtDir(dir)
  try { return JSON.parse(fs.readFileSync(path.join(actualDir, 'manifest.json'), 'utf-8')) } catch { return null }
}

// Résout les noms localisés __MSG_xxx__ depuis _locales/
function resolveMsg(value, extDir) {
  if (!value || !value.startsWith('__MSG_')) return value
  const key = value.replace(/^__MSG_/, '').replace(/__$/, '')
  try {
    const manifest = readExtManifest(extDir)
    const locale = manifest?.default_locale || 'en'
    const actualDir = findExtDir(extDir)
    const msgs = JSON.parse(fs.readFileSync(path.join(actualDir, '_locales', locale, 'messages.json'), 'utf-8'))
    return msgs[key]?.message || msgs[key.toLowerCase()]?.message || value
  } catch { return value }
}

// ── Setup Chrome Web Store (electron-chrome-web-store)
// Note: le preload de la lib ne fonctionne pas dans les webview Electron (guest process).
// On utilise la lib uniquement pour le téléchargement/installation CRX (MV3 natif).
async function setupChromeWebStore() {
  // Polyfill injecté dans tous les service workers d'extensions (chrome.storage.sync, session, scripting)
  const swPolyfillPath = path.join(__dirname, 'ext-sw-polyfill.js')
  for (const s of getProtectedSessions()) {
    try { s.registerPreloadScript({ id: `divo-sw-${s.partition||'d'}`,    type: 'service-worker', filePath: swPolyfillPath }) } catch (e) { console.warn('[ext] registerPreloadScript SW:', e.message) }
    try { s.registerPreloadScript({ id: `divo-fr-${s.partition||'d'}`,    type: 'frame',          filePath: swPolyfillPath }) } catch (e) { console.warn('[ext] registerPreloadScript frame:', e.message) }
  }

  try {
    await installChromeWebStore({
      session: session.fromPartition('persist:divo'),
      extensionsPath: USER_EXT_DIR,
      loadExtensions: false,
      autoUpdate: false,
      beforeInstall: async () => ({ action: 'allow' }),
    })
  } catch (e) { console.warn('[cws] installChromeWebStore:', e.message) }
}

// Injection CWS dans les webviews — déclenche l'install via page-title-updated
const CWS_INJECT_JS = `(function(){
  if (window.__dvCws) return; window.__dvCws = 1;
  function getExtId() {
    const m = location.pathname.match(/\\/detail\\/[^/]+\\/([a-z]{32})/);
    return m ? m[1] : null;
  }
  function injectBtn() {
    const extId = getExtId(); if (!extId) return;
    if (document.getElementById('__divo_add')) return;
    const addBtn = Array.from(document.querySelectorAll('button,[role="button"]')).find(el =>
      /add to chrome|ajouter|hinzufügen|añadir|aggiungi/i.test((el.textContent + ' ' + (el.getAttribute('aria-label')||'')).trim())
    );
    const btn = document.createElement('button');
    btn.id = '__divo_add';
    btn.textContent = 'Add to Divo';
    btn.style.cssText = 'background:#0a84ff;color:#fff;border:none;border-radius:20px;padding:8px 22px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;margin:4px 0 4px 8px;';
    btn.addEventListener('click', ev => { ev.preventDefault(); ev.stopImmediatePropagation(); document.title='divo-action:install-extension:'+extId; }, true);
    if (addBtn) {
      addBtn.addEventListener('click', ev => { ev.preventDefault(); ev.stopImmediatePropagation(); document.title='divo-action:install-extension:'+extId; }, true);
      addBtn.textContent = addBtn.textContent.replace(/add to chrome/gi,'Add to Divo').replace(/ajouter à chrome/gi,'Ajouter à Divo').replace(/ajouter/gi,'Ajouter à Divo');
      addBtn.parentNode?.insertBefore(btn, addBtn.nextSibling);
    } else {
      btn.style.cssText += 'position:fixed;top:64px;right:16px;z-index:2147483647;box-shadow:0 2px 12px rgba(0,0,0,.35);';
      document.body.appendChild(btn);
    }
  }
  injectBtn();
  new MutationObserver(injectBtn).observe(document.body, { childList:true, subtree:true });
})()`

// LEGACY — kept for reference
function crxToZip(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'Cr24') {
    // Déjà un ZIP ?
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) return buffer
    throw new Error('Format CRX invalide')
  }
  const ver = buffer.readUInt32LE(4)
  if (ver === 2) {
    const pubLen = buffer.readUInt32LE(8), sigLen = buffer.readUInt32LE(12)
    return buffer.subarray(16 + pubLen + sigLen)
  }
  if (ver === 3) {
    const hdrLen = buffer.readUInt32LE(8)
    return buffer.subarray(12 + hdrLen)
  }
  throw new Error('Version CRX non supportée : ' + ver)
}

// Extrait un ZIP dans destDir (PowerShell sur Windows, unzip sur Linux)
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true })
    let proc
    if (process.platform === 'win32') {
      const cmd = `Expand-Archive -Force -Path '${zipPath.replace(/'/g,"''")}' -DestinationPath '${destDir.replace(/'/g,"''")}'`
      proc = spawn('powershell.exe', ['-NonInteractive', '-Command', cmd], { stdio: 'ignore' })
    } else {
      proc = spawn('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'ignore' })
    }
    proc.on('close', c => c === 0 ? resolve() : reject(new Error('Extraction ZIP échouée: ' + c)))
    proc.on('error', reject)
  })
}

// Télécharge un CRX via Node.js https natif (évite les intercepteurs Electron)
function downloadCrx(startUrl) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
    function doGet(u, hops) {
      if (hops > 8) { reject(new Error('Trop de redirections')); return }
      try { new URL(u) } catch { reject(new Error('URL invalide')); return }
      https.get(u, { headers: { 'User-Agent': UA, 'Accept': '*/*' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); doGet(new URL(res.headers.location, u).href, hops + 1); return
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return }
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }).on('error', reject)
    }
    doGet(startUrl, 0)
  })
}

// Shim injecté en inline dans la background page HTML (avant le SW script)
const MV3_SHIM_JS = `
/* Divo MV3→MV2 shim */
(function(){
  if(typeof chrome==='undefined') return;

  // chrome.action ↔ chrome.browserAction
  if(chrome.action && !chrome.browserAction) chrome.browserAction=chrome.action;
  if(chrome.browserAction && !chrome.action)  chrome.action=chrome.browserAction;

  // chrome.scripting polyfill
  if(!chrome.scripting) chrome.scripting={
    executeScript:function({target,func,files,args}){
      const id=target&&target.tabId;
      if(func){const code='('+func.toString()+')('+(args||[]).map(JSON.stringify).join(',')+')';return new Promise((rs,rj)=>chrome.tabs.executeScript(id,{code},r=>chrome.runtime.lastError?rj(chrome.runtime.lastError):rs([{result:r&&r[0]}])));}
      if(files)return Promise.all(files.map(f=>new Promise((rs)=>chrome.tabs.executeScript(id,{file:f},()=>rs()))));
      return Promise.resolve([]);
    },
    insertCSS:function({target,css,files}){
      const id=target&&target.tabId;
      if(css)return new Promise(rs=>chrome.tabs.insertCSS(id,{code:css},()=>rs()));
      if(files)return Promise.all(files.map(f=>new Promise(rs=>chrome.tabs.insertCSS(id,{file:f},()=>rs()))));
      return Promise.resolve();
    },
    removeCSS:function(){return Promise.resolve();}
  };

  // chrome.storage.session (volatile in-memory)
  if(chrome.storage && !chrome.storage.session){
    const m=Object.create(null),ls=[];
    chrome.storage.session={
      get:function(k,cb){let r;if(!k)r=Object.assign({},m);else if(typeof k==='string')r={[k]:m[k]};else if(Array.isArray(k))r=k.reduce((o,x)=>(o[x]=m[x],o),{});else r=Object.keys(k).reduce((o,x)=>(o[x]=m[x]!==undefined?m[x]:k[x],o),{});if(cb)cb(r);return Promise.resolve(r);},
      set:function(v,cb){const ch={};Object.keys(v).forEach(x=>{ch[x]={oldValue:m[x],newValue:v[x]};m[x]=v[x]});ls.forEach(f=>f(ch,'session'));if(cb)cb();return Promise.resolve();},
      remove:function(k,cb){(Array.isArray(k)?k:[k]).forEach(x=>delete m[x]);if(cb)cb();return Promise.resolve();},
      clear:function(cb){Object.keys(m).forEach(x=>delete m[x]);if(cb)cb();return Promise.resolve();},
      onChanged:{addListener:f=>ls.push(f),removeListener:f=>{const i=ls.indexOf(f);if(i>-1)ls.splice(i,1)},hasListener:f=>ls.includes(f)}
    };
  }

  // chrome.storage.sync → chrome.storage.local si absent
  if(chrome.storage && !chrome.storage.sync) chrome.storage.sync=chrome.storage.local;

  // Service worker globals
  if(typeof clients==='undefined') window.clients={matchAll:()=>Promise.resolve([]),claim:()=>Promise.resolve(),openWindow:url=>{try{window.open(url)}catch(e){}return Promise.resolve(null)}};
  if(typeof skipWaiting==='undefined') window.skipWaiting=()=>Promise.resolve();
  if(typeof caches==='undefined') window.caches={open:()=>Promise.resolve({put:()=>Promise.resolve(),match:()=>Promise.resolve(undefined),delete:()=>Promise.resolve(false),keys:()=>Promise.resolve([])}),match:()=>Promise.resolve(undefined),has:()=>Promise.resolve(false),delete:()=>Promise.resolve(false),keys:()=>Promise.resolve([])};

  // Masquer les events cycle-de-vie SW (install/activate/fetch) — sans sens dans une page
  const _ael=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(t,...a){if(this===window&&(t==='install'||t==='activate'||t==='fetch'))return;return _ael.call(this,t,...a);};
})();
`

// Convertit un manifest MV3 en MV2 compatible Electron via background page HTML
function patchMv3ToMv2(dir, manifest) {
  const swFile = manifest.background.service_worker

  // Détecter si le SW utilise des ES modules (import/export au niveau top-level)
  let useModule = false
  try {
    const swSrc = fs.readFileSync(path.join(dir, swFile), 'utf-8')
    useModule = /^\s*(import\s|export\s)/m.test(swSrc)
  } catch {}

  // Background page HTML — charge le shim puis le SW (module ou script classique)
  const scriptTag = useModule
    ? `<script type="module">\n${MV3_SHIM_JS}\nimport './${swFile}';\n</script>`
    : `<script>${MV3_SHIM_JS}</script>\n  <script src="${swFile}"></script>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>\n  ${scriptTag}\n</body></html>`
  fs.writeFileSync(path.join(dir, '__divo_bg.html'), html)

  // Patch manifest.json : MV3 → MV2
  const patched = Object.assign({}, manifest)
  patched.manifest_version = 2
  patched.background = { page: '__divo_bg.html', persistent: true }

  // host_permissions → permissions
  if (manifest.host_permissions?.length)
    patched.permissions = [...new Set([...(manifest.permissions || []), ...manifest.host_permissions])]
  delete patched.host_permissions

  // chrome.action → browser_action
  if (manifest.action && !manifest.browser_action) {
    patched.browser_action = manifest.action
    delete patched.action
  }

  // content_security_policy : objet MV3 → string MV2
  if (manifest.content_security_policy && typeof manifest.content_security_policy === 'object')
    patched.content_security_policy = manifest.content_security_policy.extension_pages || "script-src 'self'; object-src 'self'"

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(patched, null, 2))
}

// Installe une extension via electron-chrome-web-store
async function installExtensionById(extId) {
  const ext = await installExtension(extId, {
    session: session.fromPartition('persist:divo'),
    extensionsPath: USER_EXT_DIR,
  })
  const dir = path.join(USER_EXT_DIR, extId)
  for (const s of getProtectedSessions()) {
    try { await s.extensions.loadExtension(dir, { allowFileAccess: false }) } catch {}
  }
  if (!config.userExtensions) config.userExtensions = []
  config.userExtensions = config.userExtensions.filter(e => e.id !== extId)
  config.userExtensions.push({ id: extId, enabled: true })
  saveConfig()
  mainWindow?.webContents.send('extension-installed', { id: extId, name: ext.name })
  return { id: extId, name: ext.name, version: ext.manifest?.version }
}

// Charge toutes les extensions activées au démarrage
async function loadUserExtensions() {
  const exts = config.userExtensions || []
  for (const ext of exts) {
    if (!ext.enabled) continue
    const baseDir = path.join(USER_EXT_DIR, ext.id)
    const dir = findExtDir(baseDir)
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue
    for (const s of getProtectedSessions()) {
      try { await s.extensions.loadExtension(dir, { allowFileAccess: false }) } catch {}
    }
  }
}

// ── IPC extensions
ipcMain.handle('get-user-extensions', () => {
  return (config.userExtensions || []).map(e => {
    const baseDir = path.join(USER_EXT_DIR, e.id)
    const manifest = readExtManifest(baseDir) || {}
    const icons = manifest.icons || {}
    const iconFile = icons['48'] || icons['128'] || icons['64'] || icons['32'] || icons['16'] || null
    const rawName = manifest.name || e.id
    const rawDesc = manifest.description || ''
    return {
      id:          e.id,
      enabled:     e.enabled,
      name:        resolveMsg(rawName, baseDir) || e.id,
      version:     manifest.version || '?',
      description: resolveMsg(rawDesc, baseDir),
      iconPath:    iconFile || null,
    }
  })
})

ipcMain.handle('install-extension-by-id', async (_, extId) => {
  if (!/^[a-z]{32}$/.test(extId)) return { ok: false, reason: 'ID invalide' }
  try {
    const info = await installExtensionById(extId)
    return { ok: true, ...info }
  } catch (e) {
    console.error('[ext] install error', e)
    return { ok: false, reason: e.message }
  }
})

ipcMain.handle('remove-user-extension', async (_, extId) => {
  // Retirer des sessions chargées
  for (const s of getProtectedSessions()) {
    try {
      const loaded = s.extensions.getAllExtensions()
      const ext = loaded.find(e => e.id === extId)
      if (ext) s.extensions.removeExtension(extId)
    } catch {}
  }
  // Supprimer le répertoire
  try { fs.rmSync(path.join(USER_EXT_DIR, extId), { recursive: true, force: true }) } catch {}
  // Retirer de la config
  config.userExtensions = (config.userExtensions || []).filter(e => e.id !== extId)
  saveConfig()
  return { ok: true }
})

ipcMain.handle('toggle-user-extension', async (_, extId, enabled) => {
  const ext = (config.userExtensions || []).find(e => e.id === extId)
  if (!ext) return { ok: false }
  ext.enabled = enabled
  saveConfig()
  const dir = path.join(USER_EXT_DIR, extId)
  for (const s of getProtectedSessions()) {
    try {
      if (enabled) {
        await s.extensions.loadExtension(dir, { allowFileAccess: false })
      } else {
        s.extensions.removeExtension(extId)
      }
    } catch {}
  }
  return { ok: true }
})

// CWS injection supprimée — gérée nativement par electron-chrome-web-store

// ── Handlers nommés (appliqués sur chaque session)
const CSP_INTERNAL =
  "default-src 'none'; " +
  "img-src https: data: blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "connect-src 'none'; " +
  "frame-src https://chromedino.com; " +
  "object-src 'none'; " +
  "base-uri 'none'"

function cspHandler(details, callback) {
  const headers = { ...details.responseHeaders }
  headers['content-security-policy'] = [CSP_INTERNAL]
  callback({ responseHeaders: headers })
}

function adblockHandler(details, callback) {
  // Ne jamais bloquer ni upgrader les requêtes d'extensions
  if (details.url.startsWith('chrome-extension://') ||
      (details.initiator && details.initiator.startsWith('chrome-extension://'))) {
    callback({}); return
  }
  // HTTPS upgrade — mainFrame uniquement, ignore les adresses locales
  if (config.httpsUpgrade !== false && details.url.startsWith('http://') && details.resourceType === 'mainFrame') {
    try {
      const host = new URL(details.url).hostname
      if (host !== 'localhost' && !host.startsWith('127.') && !host.startsWith('192.168.')
          && !host.startsWith('10.') && !host.endsWith('.local')) {
        callback({ redirectURL: details.url.replace(/^http:/, 'https:') }); return
      }
    } catch {}
  }
  if (!config.adblock || !blockedDomains.size || details.resourceType === 'mainFrame') {
    callback({}); return
  }
  const scheme = details.url.split(':')[0]
  if (scheme === 'divo' || scheme === 'file' || scheme === 'chrome-extension') {
    callback({}); return
  }
  try {
    const parts = new URL(details.url).hostname.toLowerCase().split('.')
    // Whitelist : ne jamais bloquer l'infrastructure légitime
    for (let i = 0; i < parts.length - 1; i++) {
      if (ADBLOCK_NEVER_BLOCK.has(parts.slice(i).join('.'))) { callback({}); return }
    }
    // Blocklist
    for (let i = 0; i < parts.length - 1; i++) {
      if (blockedDomains.has(parts.slice(i).join('.'))) { callback({ cancel: true }); return }
    }
  } catch {}
  callback({})
}

function setupCsp() {
  for (const s of getProtectedSessions()) {
    s.webRequest.onHeadersReceived({ urls: ['divo://*/*'] }, cspHandler)
  }
}

function setupAdblocker() {
  for (const s of getProtectedSessions()) {
    s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, adblockHandler)
  }
}

// ── CSS anti-pub générique (toutes les pages)
const GENERIC_AD_CSS = `
  ins.adsbygoogle, .adsbygoogle, [data-ad-slot], [data-ad-client],
  [id^="div-gpt-ad"], [id*="google_ads_iframe"], [id*="AdSense"],
  [class*="adsbygoogle"], [class*="google-ads"], [class*="googleads"],
  iframe[src*="googlesyndication"], iframe[src*="doubleclick"],
  iframe[src*="adnxs.com"], iframe[src*="taboola"], iframe[src*="outbrain"],
  iframe[src*="mgid.com"], iframe[src*="revcontent"], iframe[src*="popads"],
  iframe[src*="popcash"], iframe[src*="exoclick"], iframe[src*="trafficjunky"],
  .ad-container, .ads-container, .ad-wrapper, .ad-banner, .ad-slot,
  .ad-unit, .advertisement, .advert, #carbonads, .carbonads,
  [class*="pub_300x"], [class*="pub_728x"], [class*="pub_160x"],
  .overlay-ads, .popup-ad, .popunder-ad { display: none !important; }
`

// ── YouTube ad blocker
const YT_AD_CSS = `
  .ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-ad-text-overlay,
  .ytp-ad-player-overlay, .ytp-ad-module, .ytp-ad-player-overlay-layout,
  ytd-action-companion-ad-renderer, ytd-ad-slot-renderer,
  ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
  ytd-search-pyv-renderer, ytd-display-ad-renderer,
  ytd-promoted-sparkles-text-search-renderer, ytd-statement-banner-renderer,
  ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
  #player-ads, #masthead-ad, .ytd-banner-promo-renderer { display: none !important; }
`
const YT_AD_JS = `(function(){
  if (window.__dv) return; window.__dv = 1;
  function skip() {
    // Bouton "Passer l'annonce" — sélecteurs 2024/2025
    const btn = document.querySelector(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, ' +
      '.ytp-ad-skip-button-slot button, button[class*="skip"]'
    );
    if (btn) { btn.click(); return; }

    const vid = document.querySelector('video');
    if (!vid) return;

    // Détection via .ad-showing sur <html> (la plus fiable, stable depuis 2020)
    const isAd =
      document.documentElement.classList.contains('ad-showing') ||
      document.documentElement.classList.contains('ad-interrupting') ||
      !!document.querySelector(
        '.ytp-ad-player-overlay-instream-info, .ytp-ad-simple-ad-badge, ' +
        '.ytp-ad-preview-container, .ytp-ad-player-overlay-layout'
      );

    if (isAd) {
      // Sauvegarder la vitesse et le mute de l'utilisateur avant d'intervenir
      if (vid.playbackRate !== 16) {
        if (window.__dvRate === undefined) window.__dvRate = vid.playbackRate;
        vid.playbackRate = 16;
      }
      if (!vid.muted) { window.__dvWasMuted = false; vid.muted = true; }
      if (isFinite(vid.duration) && vid.duration > 0)
        vid.currentTime = vid.duration - 0.01;
    } else if (window.__dvRate !== undefined) {
      // Restaurer la vitesse choisie par l'utilisateur (pas forcer 1x)
      vid.playbackRate = window.__dvRate;
      window.__dvRate = undefined;
      if (!window.__dvWasMuted) vid.muted = false;
      window.__dvWasMuted = undefined;
    }
  }

  // Observe changements DOM + attributs de classe (pour .ad-showing)
  new MutationObserver(skip).observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['class']
  });

  // YouTube SPA : chaque navigation vidéo déclenche cet événement
  document.addEventListener('yt-navigate-finish', skip);
  skip();
})()`

// ── Twitch ad blocker
const TWITCH_AD_CSS = `
  .video-ad-label, .tw-c-text-overlay, .ad-banner, .tw-ad,
  div[data-a-target="video-ad-countdown"], div[data-a-target="stream-ad-badge"],
  .player-ad-overlay, .tw-popover__bubble[style*="opacity: 1"] { display: none !important; }
`
const TWITCH_AD_JS = `(function(){
  if (window.__dv_tw) return; window.__dv_tw = 1;
  let adMuted = false;
  function checkAd() {
    const isAd = !!(
      document.querySelector(
        '.video-ad-label, [data-a-target="video-ad-countdown"], ' +
        '[data-a-target="stream-ad-badge"], .player-ad-overlay'
      )
    );
    const vid = document.querySelector('video');
    if (!vid) return;
    if (isAd && !adMuted)  { vid.muted = true;  adMuted = true; }
    if (!isAd && adMuted)  { vid.muted = false; adMuted = false; }
  }
  setInterval(checkAd, 500);
  new MutationObserver(checkAd).observe(document.documentElement, { childList: true, subtree: true });
})()`

// ── Web dark mode dynamique (inspiré Dark Reader)
function dynamicDark() {
  'use strict'
  if (document.getElementById('__dv_dm')) return

  const root = document.documentElement

  // ── Bail si le site gère déjà son propre thème sombre ──────────
  function selfIsDark() {
    // Classes framework : Tailwind (.dark), Bootstrap 5 (data-bs-theme), etc.
    if (root.classList.contains('dark') || root.classList.contains('dark-mode') ||
        root.classList.contains('night-mode')) return true
    const attrs = ['data-theme','data-color-scheme','data-bs-theme','data-mode']
    for (const a of attrs) {
      const v = root.getAttribute(a)
      if (v && v.toLowerCase().includes('dark')) return true
    }
    return false
  }
  if (selfIsDark()) return

  // Bail via meta color-scheme
  const metaCS = document.querySelector('meta[name="color-scheme"]')
  if (metaCS && metaCS.content && metaCS.content.includes('dark')) return

  // Bail si fond réel (non transparent) déjà sombre — vérifier html ET body
  function bgLum(el) {
    if (!el) return null
    const bg = window.getComputedStyle(el).backgroundColor
    const m = bg.match(/\d+/g)
    if (!m || m.length < 3) return null
    const alpha = m.length >= 4 ? +m[3] : 1
    if (alpha < 0.15) return null  // transparent → on ne peut pas conclure
    return (+m[0]*299 + +m[1]*587 + +m[2]*114) / 255000
  }
  const lums = [bgLum(root), bgLum(document.body)].filter(l => l !== null)
  if (lums.length && Math.min(...lums) < 0.30) return

  // Bail si le site a un support natif @media (prefers-color-scheme: dark) significatif
  try {
    let nativeDark = 0
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of (sheet.cssRules || [])) {
          if (rule.type === 4 && rule.conditionText &&
              rule.conditionText.includes('prefers-color-scheme') &&
              rule.conditionText.includes('dark') &&
              rule.cssRules && rule.cssRules.length > 2) nativeDark++
        }
      } catch {}
    }
    if (nativeDark >= 2) return
  } catch {}

  // ── Utilitaires couleur ─────────────────────────────────────
  function parse(str) {
    if (!str) return null
    str = str.trim()
    if (!str || str==='transparent'||str==='inherit'||str==='initial'||
        str==='unset'||str==='currentcolor'||str.startsWith('var(')) return null
    let m
    m = str.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i)
    if (m) return [+m[1],+m[2],+m[3],1]
    m = str.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/i)
    if (m) return [+m[1],+m[2],+m[3],+m[4]]
    m = str.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    if (m) return [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16),1]
    m = str.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
    if (m) return [parseInt(m[1]+m[1],16),parseInt(m[2]+m[2],16),parseInt(m[3]+m[3],16),1]
    if (str==='white') return [255,255,255,1]
    if (str==='black') return [0,0,0,1]
    return null
  }

  function toHsl(r,g,b) {
    r/=255; g/=255; b/=255
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn
    let h=0, s=0, l=(mx+mn)/2
    if (d) {
      s = l>.5 ? d/(2-mx-mn) : d/(mx+mn)
      h = mx===r?(g-b)/d/6+(g<b?1:0):mx===g?(b-r)/d/6+1/3:(r-g)/d/6+2/3
    }
    return [h*360, s*100, l*100]
  }

  function fromHsl(h,s,l) {
    h/=360; s/=100; l/=100
    if (!s) { const v=Math.round(l*255); return [v,v,v] }
    const q=l<.5?l*(1+s):l+s-l*s, p=2*l-q
    const f=(t)=>{t=((t%1)+1)%1;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}
    return [Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)]
  }

  function fmt(r,g,b,a) { return a<1?'rgba('+r+','+g+','+b+','+a.toFixed(2)+')':'rgb('+r+','+g+','+b+')' }

  // ── Transformations ─────────────────────────────────────────
  function txBg(c) {
    if (!c||c[3]<0.05) return null
    const [h,s,l]=toHsl(c[0],c[1],c[2])
    if (l<22) return null
    return fmt(...fromHsl(h, Math.min(s,50), 10+s*0.05), c[3])
  }
  function txText(c) {
    if (!c||c[3]<0.05) return null
    const [h,s,l]=toHsl(c[0],c[1],c[2])
    if (l>65) return null
    return fmt(...fromHsl(h, Math.min(s,20), 88), c[3])
  }
  function txBorder(c) {
    if (!c||c[3]<0.05) return null
    const [h,s,l]=toHsl(c[0],c[1],c[2])
    if (l<30) return null
    return fmt(...fromHsl(h, s*0.35, 28), c[3])
  }

  const cache = new Map()
  function tx(val, fn, key) {
    const k=val+'|'+key
    if (cache.has(k)) return cache.get(k)
    const r=fn(parse(val)); cache.set(k,r); return r
  }

  const BG=['background-color'], FG=['color'],
        BD=['border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','outline-color']

  // ── Scan des feuilles de style ──────────────────────────────
  function processRule(rule, lines) {
    const sel=rule.selectorText
    if (!sel||sel.includes(':-')||sel.includes('::-')) return
    const st=rule.style, props={}
    for (const p of BG) { const v=st.getPropertyValue(p); if(v){const d=tx(v,txBg,'bg');     if(d) props[p]=d} }
    for (const p of FG) { const v=st.getPropertyValue(p); if(v){const d=tx(v,txText,'fg');   if(d) props[p]=d} }
    for (const p of BD) { const v=st.getPropertyValue(p); if(v){const d=tx(v,txBorder,'bd'); if(d) props[p]=d} }
    if (Object.keys(props).length)
      lines.push(sel+'{'+Object.entries(props).map(([k,v])=>k+':'+v+' !important').join(';')+'}')
  }

  function buildCSS() {
    const lines=[
      'html{background:#121212!important;color:#e0e0e0!important;color-scheme:dark!important}',
      'body{background-color:#121212!important;color:#e0e0e0!important}',
      '::-webkit-scrollbar-track{background:#1a1a1a!important}',
      '::-webkit-scrollbar-thumb{background:#444!important;border-radius:4px!important}',
    ]
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of (sheet.cssRules||[])) {
          if (rule.type===1) { try{processRule(rule,lines)}catch{} }
          else if (rule.cssRules) { for (const r of rule.cssRules) if(r.type===1) try{processRule(r,lines)}catch{} }
        }
      } catch {}
    }
    return lines.join('\n')
  }

  const style=document.createElement('style')
  style.id='__dv_dm'
  document.head.appendChild(style)

  function apply() { style.textContent=buildCSS() }
  apply()
  window.__dvApply = apply  // exposé pour re-trigger SPA

  // Re-scan quand de nouveaux styles sont injectés dans <head>
  let t
  new MutationObserver(()=>{clearTimeout(t);t=setTimeout(apply,150)}).observe(document.head,{childList:true})
  setTimeout(apply,250)
  setTimeout(apply,800)

  // Si le site active son propre dark mode après coup → supprimer notre overlay
  new MutationObserver(()=>{
    if(selfIsDark()){const s=document.getElementById('__dv_dm');if(s)s.remove()}
  }).observe(root,{attributes:true,attributeFilter:['class','data-theme','data-color-scheme','data-bs-theme','data-mode']})
}
const WEB_DARK_JS = '(' + dynamicDark.toString() + ')()'
// Sites ayant déjà un thème sombre natif — on n'applique pas le filtre
const WEB_DARK_SKIP = [
  'youtube.com', 'youtu.be',
  'twitch.tv',
  'google.com', 'google.fr', 'google.ca', 'google.co.uk', 'google.de',
  'github.com', 'gitlab.com',
  'discord.com', 'discordapp.com',
  'twitter.com', 'x.com',
  'netflix.com',
  'spotify.com',
  'reddit.com',
  'notion.so',
  'figma.com',
  'linear.app',
  'vercel.com',
  'stackoverflow.com',
  'roblox.com',
  'steampowered.com',
  'epicgames.com',
  'ea.com',
  'ubisoft.com',
  'blizzard.com',
  'battle.net',
  'instagram.com',
  'pinterest.com',
  'behance.net',
  'dribbble.com',
  'deviantart.com',
  'artstation.com',
  'unsplash.com',
  'imgur.com',
  'tiktok.com',
  'linkedin.com',
  'slack.com',
  'whatsapp.com',
  'telegram.org',
  'messenger.com',
  'teams.microsoft.com',
  'office.com',
  'microsoft.com',
  'apple.com',
  'cursor.com',
  'claude.ai',
  'chat.openai.com',
  'openai.com',
  'anthropic.com',
  'tailwindcss.com',
  'shadcn.com',
  'supabase.com',
  'planetscale.com',
  'railway.app',
  'neon.tech',
  'trello.com',
  'asana.com',
  'monday.com',
  'airtable.com',
  'miro.com',
]

// ── Auto-update via electron-updater
const REPO = 'bleathingman/divo'
let pendingUpdateVersion = null

let autoUpdater = null
try { ({ autoUpdater } = require('electron-updater')) } catch {}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return
  writeLog('setupAutoUpdater: starting')
  try { autoUpdater.currentVersion } catch (e) { writeLog('autoUpdater init error: ' + e.message); return }
  autoUpdater.logger = null
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('update-available', info => {
    pendingUpdateVersion = info.version
    mainWindow?.webContents.send('update-available', { version: info.version })
  })
  autoUpdater.on('download-progress', p => {
    mainWindow?.webContents.send('update-progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-progress', 100)
  })
  autoUpdater.on('error', (e) => writeLog('autoUpdater error: ' + (e?.message || e)))
  setTimeout(() => {
    writeLog('autoUpdater: checking for updates...')
    autoUpdater.checkForUpdates().catch(e => writeLog('checkForUpdates error: ' + e?.message))
  }, 10000)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

ipcMain.on('renderer-log', (_, msg) => writeLog('[renderer] ' + msg))

ipcMain.handle('get-update-status', () =>
  pendingUpdateVersion ? { version: pendingUpdateVersion } : null
)

ipcMain.handle('check-update-now', async () => {
  if (!autoUpdater || !app.isPackaged) return null
  try {
    await autoUpdater.checkForUpdates()
    return pendingUpdateVersion ? { version: pendingUpdateVersion } : null
  } catch { return null }
})

ipcMain.handle('install-update', async () => {
  if (!autoUpdater || !app.isPackaged) {
    shell.openExternal(`https://github.com/${REPO}/releases/latest`)
    return { ok: false, reason: 'not-packaged' }
  }
  try {
    mainWindow?.webContents.send('update-progress', 5)
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  } catch (e) {
    mainWindow?.webContents.send('update-progress', -1)
    shell.openExternal(`https://github.com/${REPO}/releases/latest`)
    return { ok: false, reason: e.message }
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 600, minHeight: 500,
    frame: false, show: false, backgroundColor: '#1c1c1e',
    autoHideMenuBar: true,
    // macOS — coins arrondis natifs (frame: false supprime les traffic lights, c'est voulu)
    ...(process.platform === 'darwin' ? { roundedCorners: true, vibrancy: 'under-window' } : {}),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
      backgroundThrottling: false,
      spellcheck: false,
    }
  })

  // Enregistrer divo:// pour toutes les sessions AVANT le chargement de la page
  const DIVO_PAGES = { newtab: 'newtab.html', settings: 'settings.html', dino: 'dino.html', extensions: 'extensions.html' }
  const DIVO_MIME  = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
                       '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
                       '.woff': 'font/woff', '.woff2': 'font/woff2' }
  const RENDERER_DIR = path.join(__dirname, 'renderer')
  function makeDivoHandler() {
    return (request) => {
      const url = new URL(request.url)
      const { hostname, pathname } = url
      if (pathname && pathname !== '/') {
        const rel      = path.normalize(pathname.replace(/^\/+/, ''))
        const filePath = path.join(RENDERER_DIR, rel)
        if (!filePath.startsWith(RENDERER_DIR + path.sep) && filePath !== RENDERER_DIR)
          return new Response('Forbidden', { status: 403 })
        const mime = DIVO_MIME[path.extname(rel).toLowerCase()]
        if (!mime || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 })
        return new Response(fs.readFileSync(filePath), { headers: { 'Content-Type': mime } })
      }
      if (hostname === 'ext-icon') {
        const iconRel  = pathname.replace(/^\/+/, '')
        const parts    = iconRel.split('/')
        const extId    = parts.shift()
        const iconPath = parts.join('/')
        if (/^[a-z]{32}$/.test(extId) && iconPath) {
          const extDir = findExtDir(path.join(USER_EXT_DIR, extId))
          const iconFile = path.join(extDir, iconPath)
          if (fs.existsSync(iconFile)) {
            const mime = DIVO_MIME[path.extname(iconPath).toLowerCase()] || 'image/png'
            return new Response(fs.readFileSync(iconFile), { headers: { 'Content-Type': mime } })
          }
        }
        return new Response('Not found', { status: 404 })
      }
      const file = DIVO_PAGES[hostname]
      if (file) {
        const theme  = config.theme || 'dark'
        const dlPath = (config.downloadPath || app.getPath('downloads')).replace(/"/g, '&quot;')
        const html = fs.readFileSync(path.join(RENDERER_DIR, file), 'utf-8')
          .replace('<html lang="fr">', `<html lang="fr" data-theme="${theme}">`)
          .replace('</head>', `<meta name="divo-dl-path" content="${dlPath}">\n</head>`)
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      return new Response('Not found', { status: 404 })
    }
  }
  try { protocol.handle('divo', makeDivoHandler()) } catch {}
  for (const partition of ['persist:divo', 'private:incognito']) {
    try { session.fromPartition(partition).protocol.handle('divo', makeDivoHandler()) } catch {}
  }

  mainWindow.loadFile('renderer/index.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Sauvegarde synchrone de l'état avant fermeture
  let closing = false
  mainWindow.on('close', async e => {
    if (closing) return
    e.preventDefault()
    closing = true
    try {
      const raw = await mainWindow.webContents.executeJavaScript('window.__getState ? window.__getState() : null')
      if (raw) writeAppState(JSON.parse(raw))
    } catch {}
    mainWindow.destroy()
  })
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen-change', true))
  mainWindow.on('leave-full-screen',  () => mainWindow.webContents.send('fullscreen-change', false))
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    writeLog('render-process-gone: ' + JSON.stringify(details))
  })
  app.on('child-process-gone', (_, details) => {
    writeLog('child-process-gone: ' + JSON.stringify(details))
  })

  // SEC-006 — empêche la BrowserWindow principale de naviguer vers des URLs externes
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  // SEC-009/110 — valide les webviews attachées (src, partition, webPreferences)
  const WEBVIEW_ALLOWED_PROTOS = new Set(['http:', 'https:', 'divo:', 'about:'])
  const WEBVIEW_ALLOWED_PARTITIONS = /^(persist:divo|private:incognito)$/
  mainWindow.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    // Vérifier que l'URL initiale utilise un scheme autorisé (bloque file://, data:, etc.)
    // Un src vide est autorisé : la webview est d'abord attachée sans src puis naviguée
    // via will-navigate — c'est le fonctionnement normal du pool d'onglets.
    if (params.src) {
      try {
        if (!WEBVIEW_ALLOWED_PROTOS.has(new URL(params.src).protocol)) { e.preventDefault(); return }
      } catch { e.preventDefault(); return }
    }

    // Forcer la partition à une valeur attendue (ignore l'attribut HTML partition="...")
    if (!WEBVIEW_ALLOWED_PARTITIONS.test(params.partition || '')) {
      params.partition = 'persist:divo'
    }

    // Figer toutes les webPreferences (écrase tout attribut webpreferences="...")
    delete webPreferences.preload
    delete webPreferences.preloadURL
    webPreferences.nodeIntegration             = false
    webPreferences.nodeIntegrationInSubFrames  = false
    webPreferences.contextIsolation            = true
    webPreferences.sandbox                     = true
    webPreferences.webSecurity                 = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.experimentalFeatures        = false
  })
}

// ── Ouverture de liens externes avec confirmation pour les protocoles inconnus
// Protocoles inoffensifs : pas d'args sensibles, dialog inutile
const ALWAYS_OPEN_PROTOS = new Set(['mailto:', 'tel:', 'sms:', 'callto:'])
const userAllowedProtos  = new Set(JSON.parse(config.allowedExternalProtos || '[]'))
// Rate-limiting : 1 dialog par proto par seconde max (anti-spam)
const lastDialogTime = new Map()

async function maybeOpenExternal(url, originHostname) {
  let proto
  try { proto = new URL(url).protocol } catch { return }
  if (ALWAYS_OPEN_PROTOS.has(proto) || userAllowedProtos.has(proto)) {
    shell.openExternal(url).catch(() => {})
    return
  }
  // Rate-limit : ignorer si un dialog pour ce proto a été affiché < 1s
  const now = Date.now()
  if (now - (lastDialogTime.get(proto) || 0) < 1000) return
  lastDialogTime.set(proto, now)

  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Ouvrir un lien externe',
    message: `Cette page veut ouvrir un lien ${proto}`,
    detail: `Origine : ${originHostname || 'inconnue'}\nURL : ${url.slice(0, 200)}`,
    buttons: ['Annuler', 'Ouvrir'],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: `Toujours autoriser ${proto} sur ce navigateur`,
  })
  if (response !== 1) return
  if (checkboxChecked) {
    userAllowedProtos.add(proto)
    config.allowedExternalProtos = JSON.stringify([...userAllowedProtos])
    saveConfig()
  }
  shell.openExternal(url).catch(() => {})
}

app.whenReady().then(async () => {
  initBlocklist()
  setupAdblocker()
  setupCsp()
  await setupChromeWebStore()

  // ── Extensions utilisateur
  await loadUserExtensions()
  // ── Téléchargements — appliqués sur toutes les sessions (persist:divo + private:incognito)
  const safeFilename = raw =>
    path.basename(String(raw || 'download'))
      .replace(/[\x00-\x1f<>"'/\\|?*]/g, '_')
      .slice(0, 200) || 'download'

  const willDownloadHandler = (_, item) => {
    const id = Date.now()
    const dlDir = config.downloadPath || app.getPath('downloads')
    const filename = safeFilename(item.getFilename())
    item.setSavePath(path.join(dlDir, filename))
    downloadItems.set(id, item)
    mainWindow.webContents.send('dl-start', { id, filename, total: item.getTotalBytes() })
    item.on('updated', (_, state) => {
      mainWindow.webContents.send('dl-update', { id, state, received: item.getReceivedBytes(), total: item.getTotalBytes() })
    })
    item.once('done', (_, state) => {
      mainWindow.webContents.send('dl-done', { id, state, filename, savePath: item.getSavePath() })
      downloadItems.delete(id)
    })
  }
  for (const s of getProtectedSessions()) s.on('will-download', willDownloadHandler)

  // ── Permissions — appliquées sur toutes les sessions webview
  // Accordées silencieusement (tous les navigateurs font pareil)
  const PERM_AUTO_ALLOW = new Set([
    'fullscreen', 'pointerLock',
    'clipboard-sanitized-write',
    'storage-access',
    'top-level-storage-access',
    'mediaKeySystem',
    'screen-wake-lock',
    'midi',
  ])
  const PERM_AUTO_DENY = new Set([
    'serial', 'usb', 'hid', 'bluetooth', 'idle-detection',
  ])
  const PERM_LABELS = {
    media:              'Caméra et/ou Microphone',
    geolocation:        'Localisation',
    notifications:      'Notifications',
    'clipboard-read':   'Presse-papiers (lecture)',
    midiSysex:          'MIDI (SysEx)',
    'window-management':'Gestion multi-écrans',
  }

  for (const s of getProtectedSessions()) {
    s.setPermissionCheckHandler((wc, permission) => {
      if (PERM_AUTO_ALLOW.has(permission)) return true
      if (PERM_AUTO_DENY.has(permission))  return false
      return null
    })
    s.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (PERM_AUTO_ALLOW.has(permission)) { callback(true);  return }
      if (PERM_AUTO_DENY.has(permission))  { callback(false); return }
      const key = Date.now() + '-' + Math.random()
      pendingPerms.set(key, callback)
      mainWindow.webContents.send('permission-request', {
        key,
        permission,
        label: PERM_LABELS[permission] || permission,
        origin: (() => { try { return new URL(details?.requestingUrl || wc.getURL()).hostname } catch { return 'ce site' } })()
      })
    })
  }

  // ── Polyfill extensions : chrome.storage.sync → chrome.storage.local (non supporté dans Electron)
  const EXT_STORAGE_POLYFILL = `(function(){
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      if (!chrome.storage.sync) {
        Object.defineProperty(chrome.storage, 'sync', { get: () => chrome.storage.local, configurable: true });
      }
      if (!chrome.storage.managed) {
        const noop = { get: (k,cb) => { if(cb) cb({}); return Promise.resolve({}) },
                       set: (v,cb) => { if(cb) cb(); return Promise.resolve() },
                       remove: (k,cb) => { if(cb) cb(); return Promise.resolve() },
                       clear: (cb) => { if(cb) cb(); return Promise.resolve() },
                       onChanged: { addListener:()=>{}, removeListener:()=>{}, hasListener:()=>false } };
        Object.defineProperty(chrome.storage, 'managed', { get: () => noop, configurable: true });
      }
    } catch {}
  })()`

  app.on('web-contents-created', (_, contents) => {
    // Injecter le polyfill chrome.storage dans les background pages d'extensions
    if (contents.getType() === 'backgroundPage') {
      contents.on('dom-ready', () => {
        if (!contents.isDestroyed()) contents.executeJavaScript(EXT_STORAGE_POLYFILL).catch(() => {})
      })
    }

    if (contents.getType() === 'webview') {
      // Liens custom protocol (steam://, discord://, epic://, etc.) → ouvrir dans l'OS
      contents.on('will-navigate', (event, url) => {
        try {
          const proto = new URL(url).protocol
          if (!SAFE_PROTOS.has(proto) && !proto.startsWith('chrome-extension')) {
            event.preventDefault()
            const origin = (() => { try { return new URL(contents.getURL()).hostname } catch { return '' } })()
            maybeOpenExternal(url, origin)
          }
        } catch {}
      })

      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !mainWindow) return
        const mod = input.control || input.meta
        // F12 / Ctrl+Shift+I — DevTools de la webview active
        if (input.code === 'F12' || (mod && input.shift && input.code === 'KeyI')) {
          contents.openDevTools()
          return
        }
        const key = (mod ? 'ctrl+' : '') + (input.shift ? 'shift+' : '') + (input.alt ? 'alt+' : '') + input.code
        if (WEBVIEW_SHORTCUTS.has(key)) {
          event.preventDefault()
          mainWindow.webContents.send('webview-shortcut', { mod, shift: input.shift, alt: input.alt, code: input.code })
        }
      })

      contents.on('did-finish-load', () => {
        const url = contents.getURL()
        if (!url || url === 'about:blank' || url.startsWith('chrome') || url.startsWith('arc') || url.startsWith('file')) return

        if (config.adblock) {
          // CSS génériques (curatés + EasyList)
          contents.insertCSS(GENERIC_AD_CSS).catch(() => {})
          if (cosmeticGenericCSS) {
            contents.insertCSS(cosmeticGenericCSS + ' { display: none !important; }').catch(() => {})
          }
          // CSS cosmétiques spécifiques au domaine
          try {
            const domCSS = getPageCosmeticCSS(new URL(url).hostname)
            if (domCSS) contents.insertCSS(domCSS).catch(() => {})
          } catch {}
          // Sites spécifiques
          if (url.includes('youtube.com') || url.includes('youtu.be')) {
            contents.insertCSS(YT_AD_CSS).catch(() => {})
            contents.executeJavaScript(YT_AD_JS).catch(() => {})
          }
          if (url.includes('twitch.tv')) {
            contents.insertCSS(TWITCH_AD_CSS).catch(() => {})
            contents.executeJavaScript(TWITCH_AD_JS).catch(() => {})
          }
        }

        // Boutons souris 4 (retour) et 5 (avant) — injectés dans chaque page
        contents.executeJavaScript(`(function(){
          if (window.__dvMouseNav) return; window.__dvMouseNav = 1;
          document.addEventListener('mouseup', function(e) {
            if (e.button === 3) { e.preventDefault(); history.back(); }
            if (e.button === 4) { e.preventDefault(); history.forward(); }
          }, true);
        })()`).catch(() => {})

        if (url.includes('chromewebstore.google.com/detail/')) {
          if (!contents.isDestroyed()) contents.executeJavaScript(CWS_INJECT_JS).catch(() => {})
        }

        if (config.webDarkMode && !url.startsWith('divo:') && !url.startsWith('chrome-extension:')) {
          try {
            const hostname = new URL(url).hostname.replace(/^www\./, '')
            const skip = WEB_DARK_SKIP.some(h => hostname === h || hostname.endsWith('.' + h))
            if (!skip) contents.executeJavaScript(WEB_DARK_JS).catch(() => {})
          } catch {}
        }
      })

      // Navigation SPA : re-injecter CWS + dark mode
      contents.on('did-navigate-in-page', (_, url, isMainFrame) => {
        if (!isMainFrame || !url || url.startsWith('divo:')) return
        if (url.includes('chromewebstore.google.com/detail/')) {
          if (!contents.isDestroyed()) contents.executeJavaScript('window.__dvCws=0;' + CWS_INJECT_JS).catch(() => {})
        }
        if (!config.webDarkMode || url.startsWith('chrome-extension:')) return
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, '')
          const skip = WEB_DARK_SKIP.some(h => hostname === h || hostname.endsWith('.' + h))
          if (!skip) {
            contents.executeJavaScript(
              'clearTimeout(window.__dvT);window.__dvT=setTimeout(()=>{if(window.__dvApply)window.__dvApply()},300)'
            ).catch(() => {})
          }
        } catch {}
      })
      contents.setWindowOpenHandler(({ url }) => {
        try {
          const proto = new URL(url).protocol
          if (!SAFE_PROTOS.has(proto) && !proto.startsWith('chrome-extension')) {
            const origin = (() => { try { return new URL(contents.getURL()).hostname } catch { return '' } })()
            maybeOpenExternal(url, origin)
            return { action: 'deny' }
          }
        } catch {}
        if (config.adblock && url) {
          try {
            const parts = new URL(url).hostname.toLowerCase().split('.')
            for (let i = 0; i < parts.length - 1; i++) {
              if (blockedDomains.has(parts.slice(i).join('.'))) return { action: 'deny' }
            }
          } catch {}
        }
        if (mainWindow && url) mainWindow.webContents.send('open-new-tab', url)
        return { action: 'deny' }
      })
    }
  })

  createWindow()

  // ── macOS : menu système (indispensable pour Cmd+C/V/Z/A dans les champs texte)
  if (process.platform === 'darwin') {
    const { Menu } = require('electron')
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about', label: 'À propos de Divo' },
          { type: 'separator' },
          { role: 'services', label: 'Services' },
          { type: 'separator' },
          { role: 'hide',      label: 'Masquer Divo' },
          { role: 'hideOthers',label: 'Masquer les autres' },
          { role: 'unhide',    label: 'Tout afficher' },
          { type: 'separator' },
          { role: 'quit', label: 'Quitter Divo' }
        ]
      },
      {
        label: 'Édition',
        submenu: [
          { role: 'undo',      label: 'Annuler' },
          { role: 'redo',      label: 'Rétablir' },
          { type: 'separator' },
          { role: 'cut',       label: 'Couper' },
          { role: 'copy',      label: 'Copier' },
          { role: 'paste',     label: 'Coller' },
          { role: 'selectAll', label: 'Tout sélectionner' }
        ]
      }
    ]))
    // Recréer la fenêtre si l'utilisateur clique sur l'icône dans le Dock
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }

  setupAutoUpdater()

  // Notifier le renderer si Divo n'est pas navigateur par défaut
  setTimeout(() => {
    if (mainWindow && !app.isDefaultProtocolClient('https')) {
      mainWindow.webContents.send('not-default-browser')
    }
  }, 4000)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.on('window-minimize',    () => mainWindow.minimize())
ipcMain.on('window-maximize',    () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize() })
ipcMain.on('window-close',       () => mainWindow.close())
ipcMain.on('toggle-fullscreen',  () => mainWindow.setFullScreen(!mainWindow.isFullScreen()))
ipcMain.on('open-file', (_, p) => {
  const dlDir = path.resolve(config.downloadPath || app.getPath('downloads'))
  const userData = path.resolve(app.getPath('userData'))
  const resolved = path.resolve(p)
  if (!resolved.startsWith(dlDir + path.sep) && !resolved.startsWith(userData + path.sep) &&
      resolved !== dlDir && resolved !== userData) return
  shell.showItemInFolder(resolved)
})
ipcMain.on('open-dl-folder',     () => shell.openPath(config.downloadPath || app.getPath('downloads')))
ipcMain.on('focus-webview',      (_, id) => { const wc = webContents.fromId(id); if (wc) wc.focus() })
ipcMain.on('answer-permission',  (_, key, granted) => {
  const cb = pendingPerms.get(key)
  if (cb) { cb(granted); pendingPerms.delete(key) }
})

// ── Adblock IPC
ipcMain.handle('adblock-status', () => config.adblock)
ipcMain.handle('adblock-toggle', (_, enabled) => { config.adblock = !!enabled; saveConfig(); return config.adblock })
ipcMain.handle('is-default-browser', () => app.isDefaultProtocolClient('https') || app.isDefaultProtocolClient('http'))
ipcMain.handle('set-default-browser', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Navigateur par défaut',
    message: 'Faire de Divo votre navigateur par défaut ?',
    detail: "Divo gérera les liens http et https ouverts depuis d'autres applications.",
    buttons: ['Annuler', 'Définir'],
    defaultId: 1,
    cancelId: 0,
  })
  if (response !== 1) return false
  app.setAsDefaultProtocolClient('http')
  app.setAsDefaultProtocolClient('https')
  return true
})
ipcMain.handle('set-theme', (_, theme) => { config.theme = theme; saveConfig() })

// ── Téléchargements IPC
ipcMain.handle('get-download-path', () => config.downloadPath || app.getPath('downloads'))
ipcMain.handle('pick-download-path', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir le dossier de téléchargements',
    properties: ['openDirectory'],
    defaultPath: config.downloadPath || app.getPath('downloads')
  })
  if (canceled || !filePaths.length) return null
  config.downloadPath = filePaths[0]
  saveConfig()
  return filePaths[0]
})

// ── HTTPS Upgrade IPC
ipcMain.handle('https-upgrade-status', () => config.httpsUpgrade !== false)
ipcMain.handle('https-upgrade-toggle', (_, enabled) => { config.httpsUpgrade = !!enabled; saveConfig(); return config.httpsUpgrade })

// ── Web Dark Mode IPC
ipcMain.handle('web-dark-mode-status', () => config.webDarkMode)
ipcMain.handle('web-dark-mode-toggle', (_, enabled) => {
  config.webDarkMode = !!enabled
  saveConfig()
  return config.webDarkMode
})

// ── Import bookmarks depuis fichier .htm
ipcMain.handle('import-bookmarks-html', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Sélectionner le fichier de favoris exporté',
    filters: [{ name: 'Favoris HTML', extensions: ['htm', 'html'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) return null
  try {
    const html = fs.readFileSync(filePaths[0], 'utf-8')
    const links = []
    const seen = new Set()
    const re = /<A\s[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi
    let m
    while ((m = re.exec(html)) !== null) {
      const url   = m[1].replace(/&amp;/g, '&')
      const title = m[2].trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      if (url && !url.startsWith('javascript:') && !seen.has(url)) {
        seen.add(url)
        links.push({ title: title || url, url })
      }
    }
    return links
  } catch { return [] }
})

// ── Import bookmarks Chrome/Edge/Brave (auto-détection)
ipcMain.handle('import-chrome-bookmarks', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Importer les favoris',
    message: 'Divo va lire vos favoris Chrome / Edge / Brave / Chromium installés sur cette machine.',
    detail: 'Aucune donnée ne quitte votre ordinateur.',
    buttons: ['Annuler', 'Importer'],
    defaultId: 1,
    cancelId: 0,
  })
  if (response !== 1) return []

  const browsers = [
    { name: 'Chrome',   base: path.join(process.env.LOCALAPPDATA || '', 'Google',         'Chrome',        'User Data') },
    { name: 'Edge',     base: path.join(process.env.LOCALAPPDATA || '', 'Microsoft',      'Edge',          'User Data') },
    { name: 'Brave',    base: path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware',  'Brave-Browser', 'User Data') },
    { name: 'Chromium', base: path.join(process.env.LOCALAPPDATA || '', 'Chromium',       'Chromium',      'User Data') },
  ]

  function flattenNode(node, out) {
    if (node.type === 'url') {
      if (node.url && !node.url.startsWith('javascript:')) out.push({ title: node.name || node.url, url: node.url })
    } else if (node.children) {
      for (const c of node.children) flattenNode(c, out)
    }
  }

  const result = []
  const seen = new Set()
  for (const br of browsers) {
    if (!fs.existsSync(br.base)) continue
    const profiles = ['Default']
    try { for (const d of fs.readdirSync(br.base)) { if (/^Profile \d+$/.test(d)) profiles.push(d) } } catch {}
    for (const prof of profiles) {
      const bkFile = path.join(br.base, prof, 'Bookmarks')
      if (!fs.existsSync(bkFile)) continue
      try {
        const data = JSON.parse(fs.readFileSync(bkFile, 'utf-8'))
        const flat = []
        for (const root of Object.values(data.roots || {})) flattenNode(root, flat)
        for (const bk of flat) {
          if (!seen.has(bk.url)) { seen.add(bk.url); result.push({ ...bk, browser: br.name }) }
        }
      } catch {}
    }
  }
  return result
})