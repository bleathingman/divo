const { app, BrowserWindow, ipcMain, protocol, webContents, shell, session, dialog, net, safeStorage, clipboard } = require('electron')
const path = require('path')
const fs   = require('fs')
const crypto = require('crypto')
const { pathToFileURL } = require('url')

// ── Crash logging
const LOG_PATH = path.join(app.getPath('userData'), 'crash.log')
function writeLog(msg) {
  try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`) } catch {}
}

// Écriture atomique : fichier temporaire puis rename. Un crash / une coupure pendant l'écriture
// laisse l'ancien fichier intact au lieu d'un JSON tronqué (perte d'onglets, config, mots de passe).
function writeFileAtomic(file, data, encoding) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data, encoding)
  fs.renameSync(tmp, file)
}
// Copie de sécurité horodatée avant une opération qui rendrait un fichier irrécupérable
function backupFile(file, reason) {
  try {
    if (!fs.existsSync(file)) return
    const bak = `${file}.bak-${Date.now()}`
    fs.copyFileSync(file, bak)
    writeLog(`backup ${path.basename(file)} → ${path.basename(bak)} (${reason})`)
  } catch {}
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
let rendererReady = false

// ── Instance unique : un lien/fichier ouvert depuis une autre app (Divo navigateur par défaut)
// arrive dans un nouvel onglet de la fenêtre existante au lieu de lancer un 2e Divo.
if (!app.requestSingleInstanceLock()) app.exit(0)

const OPENABLE_FILE_RE = /\.(html?|xhtml|shtml|xht)$/i
function urlFromArgv(argv) {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    if (/^https?:\/\//i.test(arg)) return arg
    if (OPENABLE_FILE_RE.test(arg)) {
      try { const p = path.resolve(arg); if (fs.existsSync(p)) return pathToFileURL(p).href } catch {}
    }
  }
  return null
}

// URLs reçues avant que la fenêtre principale soit prête (lancement à froid, sélecteur de profil, open-url macOS)
const pendingOpenUrls = []
function openUrlInNewTab(url) {
  if (!url) return
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('open-new-tab', url)
  else pendingOpenUrls.push(url)
}
openUrlInNewTab(urlFromArgv(process.argv))

app.on('second-instance', (_, argv) => {
  const win = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : profileSelectorWin
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show(); win.focus()
  }
  openUrlInNewTab(urlFromArgv(argv))
})
// macOS : liens et fichiers transmis par le système
app.on('open-url',  (e, url) => { e.preventDefault(); if (/^https?:\/\//i.test(url)) openUrlInNewTab(url) })
app.on('open-file', (e, p)   => { e.preventDefault(); if (OPENABLE_FILE_RE.test(p)) openUrlInNewTab(pathToFileURL(p).href) })

// Relance (changement de profil, import) sans les URLs/fichiers du lancement initial — sinon rouverts
function relaunchApp() {
  app.relaunch({ args: process.argv.slice(1).filter(a => !urlFromArgv(['', a])) })
}

const downloadItems = new Map()
const pendingPerms  = new Map()
const peekWindows   = new Set()

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
  // GitHub — requis pour electron-updater (api.github.com, releases, assets)
  'github.com', 'api.github.com', 'githubusercontent.com', 'github-releases.githubusercontent.com',
  'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
])

// SEC-009/110 — valide toute <webview> attachée (fenêtre principale et popups "Peek") :
// src, partition et webPreferences forcés, peu importe ce que la page demande.
// file: requis pour ouvrir les .html locaux (association de fichiers / argv)
const WEBVIEW_ALLOWED_PROTOS = new Set(['http:', 'https:', 'divo:', 'about:', 'file:'])
function attachWebviewSecurity(webContents) {
  webContents.on('will-attach-webview', (e, webPreferences, params) => {
    // Vérifier que l'URL initiale utilise un scheme autorisé (bloque file://, data:, etc.)
    // Un src vide est autorisé : la webview est d'abord attachée sans src puis naviguée
    // via will-navigate — c'est le fonctionnement normal du pool d'onglets.
    if (params.src) {
      try {
        if (!WEBVIEW_ALLOWED_PROTOS.has(new URL(params.src).protocol)) { e.preventDefault(); return }
      } catch { e.preventDefault(); return }
    }

    // Partition imposée par le main (ignore l'attribut HTML partition="...") :
    // navigation privée, sinon la partition du profil actif — c'est ce qui isole les profils.
    params.partition = params.partition === 'private:incognito' ? 'private:incognito' : activePartition()

    // Figer toutes les webPreferences (écrase tout attribut webpreferences="...")
    delete webPreferences.preload
    delete webPreferences.preloadURL
    // Preload de confiance : injection anticipée du patch YouTube (avant les scripts de la page)
    webPreferences.preload = path.join(__dirname, 'renderer', 'page-preload.js')
    webPreferences.nodeIntegration             = false
    webPreferences.nodeIntegrationInSubFrames  = false
    webPreferences.contextIsolation            = true
    webPreferences.sandbox                     = true
    webPreferences.webSecurity                 = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.experimentalFeatures        = false
  })
}

const WEBVIEW_SHORTCUTS = new Set([
  'ctrl+KeyT', 'ctrl+shift+KeyT', 'ctrl+shift+KeyN', 'ctrl+KeyW',
  'ctrl+KeyL', 'ctrl+KeyR', 'ctrl+shift+KeyR', 'ctrl+KeyF',
  'ctrl+KeyH', 'ctrl+KeyB', 'ctrl+KeyD', 'ctrl+KeyK', 'ctrl+Backslash', 'ctrl+Tab', 'ctrl+shift+Tab',
  'ctrl+Equal', 'ctrl+NumpadAdd', 'ctrl+Minus', 'ctrl+NumpadSubtract',
  'ctrl+Digit0', 'ctrl+Numpad0',
  'alt+ArrowLeft', 'alt+ArrowRight',
  'F3', 'F5', 'F11', 'Escape'
])

// ── Profils
const PROFILES_DIR   = path.join(app.getPath('userData'), 'profiles')
const PROFILES_INDEX      = path.join(app.getPath('userData'), 'profiles.json')
const LAUNCH_PROFILE_FILE = path.join(app.getPath('userData'), '.launch-profile')
let profilesIndex   = { lastUsedId: null, profiles: [] }
let activeProfileId = null
let pendingProfileSelectResolve = null
let profileSelectorWin = null

function profileDir(id) { return path.join(PROFILES_DIR, id || activeProfileId) }
function saveProfilesIndex() { try { writeFileAtomic(PROFILES_INDEX, JSON.stringify(profilesIndex)) } catch {} }

// ── Isolation des profils
// Chaque profil a sa propre partition Chromium (cookies, comptes connectés, localStorage /
// IndexedDB des sites, cache), son propre historique et ses propres mots de passe.
// La partition est mémorisée dans profiles.json (champ "partition") : elle ne change jamais,
// même si l'ordre des profils change ou qu'un autre profil est supprimé.
const LEGACY_PARTITION = 'persist:divo'
function partitionForNewProfile(id) {
  return 'persist:divo-' + String(id).toLowerCase().replace(/[^a-z0-9_-]/g, '')
}
function activePartition() {
  return profilesIndex.profiles.find(p => p.id === activeProfileId)?.partition || LEGACY_PARTITION
}
function partitionDir(partition) {
  return path.join(app.getPath('userData'), 'Partitions', partition.replace(/^persist:/, ''))
}
function historyFile()   { return activeProfileId ? path.join(profileDir(), 'history.json')   : LEGACY_HISTORY_PATH }
function passwordsFile() { return activeProfileId ? path.join(profileDir(), 'passwords.json') : PASSWORDS_PATH }

// Contenu d'une partition qui n'est que du cache (régénéré au besoin) — jamais copié
const PARTITION_CACHE_ENTRIES = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Shared Dictionary', 'VideoDecodeStats', 'blob_storage'])
function copyPartitionData(fromPartition, toPartition) {
  const src = partitionDir(fromPartition), dst = partitionDir(toPartition)
  if (!fs.existsSync(src) || fs.existsSync(dst)) return
  const swCaches = [path.join('Service Worker', 'CacheStorage'), path.join('Service Worker', 'ScriptCache')]
  try {
    fs.cpSync(src, dst, {
      recursive: true,
      filter: s => {
        const rel = path.relative(src, s)
        if (!rel) return true
        if (PARTITION_CACHE_ENTRIES.has(rel.split(path.sep)[0])) return false
        return !swCaches.some(c => rel === c || rel.startsWith(c + path.sep))
      },
    })
    writeLog(`partition copiée : ${fromPartition} → ${toPartition}`)
  } catch (e) { writeLog(`copie partition ${toPartition} échouée : ${e.message}`) }
}

// Migration (< 5.3.0) : tous les profils partageaient persist:divo + historique et mots de passe
// globaux. Le premier profil garde persist:divo tel quel ; chaque autre profil existant reçoit une
// COPIE des connexions / historique / mots de passe actuels (personne n'est déconnecté), puis
// chacun évolue séparément. Les profils créés ensuite démarrent vierges.
function migrateProfileIsolation() {
  const pending = profilesIndex.profiles.filter(p => !p.partition)
  if (!pending.length) return
  let legacyTaken = profilesIndex.profiles.some(p => p.partition === LEGACY_PARTITION)
  for (const p of pending) {
    try { fs.mkdirSync(profileDir(p.id), { recursive: true }) } catch {}
    if (!legacyTaken) { p.partition = LEGACY_PARTITION; legacyTaken = true }
    else { p.partition = partitionForNewProfile(p.id); copyPartitionData(LEGACY_PARTITION, p.partition) }
    for (const [legacy, name] of [[LEGACY_HISTORY_PATH, 'history.json'], [PASSWORDS_PATH, 'passwords.json']]) {
      const dst = path.join(profileDir(p.id), name)
      try { if (fs.existsSync(legacy) && !fs.existsSync(dst)) fs.copyFileSync(legacy, dst) } catch {}
    }
  }
  saveProfilesIndex()
  writeLog(`isolation profils : ${pending.length} profil(s) migré(s)`)
}

// ── Config persistante (par profil)
let config = { adblock: true, webDarkMode: false, httpsUpgrade: true }
function saveConfig() {
  try { writeFileAtomic(path.join(profileDir(), 'config.json'), JSON.stringify(config)) } catch (e) { console.error('saveConfig error', e) }
}

// ── État navigateur persistant (par profil)
let cachedAppState = null
function writeAppState(s) { try { writeFileAtomic(path.join(profileDir(), 'state.json'), JSON.stringify(s)) } catch {} }

ipcMain.handle('state-load', () => cachedAppState)
ipcMain.handle('state-save', (_, s) => { cachedAppState = s; writeAppState(s) })
ipcMain.on('state-load-sync', e => { e.returnValue = cachedAppState })

// ── Gestionnaire de mots de passe (AES-256-GCM)
const VAULT_KEY_PATH = path.join(app.getPath('userData'), 'vault.key')
const PASSWORDS_PATH = path.join(app.getPath('userData'), 'passwords.json')
let _vaultKey = null
function getVaultKey() {
  if (_vaultKey) return _vaultKey
  if (!safeStorage.isEncryptionAvailable()) {
    // Headless fallback (Linux sans keyring) — comportement identique à l'ancien
    try {
      const hex = fs.readFileSync(VAULT_KEY_PATH, 'utf-8').trim()
      _vaultKey = Buffer.from(hex, 'hex')
      if (_vaultKey.length !== 32) throw new Error('bad key length')
    } catch {
      backupVaultBeforeNewKey('clé illisible (sans keyring)')
      _vaultKey = crypto.randomBytes(32)
      try { writeFileAtomic(VAULT_KEY_PATH, _vaultKey.toString('hex'), 'utf-8') } catch {}
    }
    return _vaultKey
  }
  try {
    const data = fs.readFileSync(VAULT_KEY_PATH)
    try {
      // Format actuel : Buffer chiffré par safeStorage (DPAPI/Keychain)
      const hex = safeStorage.decryptString(data)
      _vaultKey = Buffer.from(hex, 'hex')
      if (_vaultKey.length !== 32) throw new Error('bad length')
      return _vaultKey
    } catch {}
    // Migration depuis l'ancien format : hex en clair
    const hex = data.toString('utf-8').trim()
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      _vaultKey = Buffer.from(hex, 'hex')
      try { writeFileAtomic(VAULT_KEY_PATH, safeStorage.encryptString(hex)) } catch {}
      return _vaultKey
    }
  } catch {}
  // Première utilisation (ou clé indéchiffrable) : générer et stocker chiffré.
  // Si une clé existait, on la sauvegarde avec passwords.json : sinon ils seraient perdus à jamais.
  backupVaultBeforeNewKey('clé indéchiffrable')
  _vaultKey = crypto.randomBytes(32)
  try { writeFileAtomic(VAULT_KEY_PATH, safeStorage.encryptString(_vaultKey.toString('hex'))) } catch {}
  return _vaultKey
}
function backupVaultBeforeNewKey(reason) {
  if (!fs.existsSync(VAULT_KEY_PATH)) return   // vraie première utilisation
  backupFile(VAULT_KEY_PATH, reason)
  // La clé est commune à tous les profils : sauvegarder les mots de passe de chacun
  backupFile(PASSWORDS_PATH, reason)
  for (const p of profilesIndex.profiles) backupFile(path.join(profileDir(p.id), 'passwords.json'), reason)
}
function encryptPwd(plain) {
  try {
    const key = getVaultKey(), iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([c.update(plain, 'utf-8'), c.final()])
    return iv.toString('hex') + ':' + enc.toString('hex') + ':' + c.getAuthTag().toString('hex')
  } catch { return '' }
}
function decryptPwd(enc) {
  try {
    const parts = (enc || '').split(':')
    if (parts.length !== 3) return ''
    const key = getVaultKey()
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'))
    d.setAuthTag(Buffer.from(parts[2], 'hex'))
    return d.update(Buffer.from(parts[1], 'hex')) + d.final('utf-8')
  } catch { return '' }
}
let cachedPasswords = []
function loadPasswordsFromDisk() {
  // Appelé par loadProfileData(), toujours après app.whenReady() — safeStorage est disponible
  if (!fs.existsSync(passwordsFile())) { cachedPasswords = []; return }
  try {
    const raw = JSON.parse(fs.readFileSync(passwordsFile(), 'utf-8'))
    cachedPasswords = raw.map(e => ({ ...e, password: decryptPwd(e.password) }))
    // Entrées chiffrées devenues illisibles → garder une copie avant que la prochaine écriture
    // ne les remplace par des mots de passe vides
    if (raw.some((e, i) => e.password && !cachedPasswords[i].password)) backupFile(passwordsFile(), 'déchiffrement partiel')
  } catch {
    backupFile(passwordsFile(), 'fichier illisible')
    cachedPasswords = []
  }
}
function writePasswords(entries) {
  try { writeFileAtomic(passwordsFile(), JSON.stringify(entries.map(e => ({ ...e, password: encryptPwd(e.password) })))) } catch {}
}
function pwMeta(e) {
  return { id: e.id, domain: e.domain, username: e.username, url: e.url, createdAt: e.createdAt, lastUsed: e.lastUsed, updatedAt: e.updatedAt }
}

// ── IPC passwords — les mots de passe déchiffrés ne quittent jamais le main process
ipcMain.handle('passwords-get', () => cachedPasswords.map(pwMeta))

ipcMain.handle('password-autofill', async (_, id, wcId) => {
  const entry = cachedPasswords.find(p => p.id === id)
  if (!entry) return false
  try {
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return false
    // Ne jamais remplir un identifiant sur un autre site que le sien (anti-phishing) —
    // même règle de correspondance que getPasswordsForUrl() côté renderer.
    let host = ''
    try { host = new URL(wc.getURL()).hostname.replace(/^www\./, '').toLowerCase() } catch {}
    const d = String(entry.domain || '').toLowerCase()
    if (!host || !d || !(host === d || host.endsWith('.' + d) || d.endsWith('.' + host))) {
      writeLog(`password-autofill refusé : ${d} ≠ ${host}`)
      return false
    }
    const u = JSON.stringify(entry.username), p = JSON.stringify(entry.password)
    await wc.executeJavaScript(`(function(){
      const u=${u},p=${p}
      function fill(el,v){if(!el)return;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
      const uField=document.querySelector('input[type="email"],input[autocomplete*="username"],input[autocomplete*="email"],input[name*="user"],input[name*="email"],input[name*="login"]')||[...document.querySelectorAll('input[type="text"]')].find(i=>i.offsetParent)
      const pField=document.querySelector('input[type="password"]')
      fill(uField,u);fill(pField,p)
    })()`)
    entry.lastUsed = Date.now()
    writePasswords(cachedPasswords)
    return true
  } catch { return false }
})

ipcMain.handle('password-copy', (_, id) => {
  const entry = cachedPasswords.find(p => p.id === id)
  if (!entry) return false
  clipboard.writeText(entry.password)
  entry.lastUsed = Date.now()
  writePasswords(cachedPasswords)
  return true
})

ipcMain.handle('password-save', (_, domain, url, username, password) => {
  if (typeof domain !== 'string' || !domain || domain.length > 255) return { ok: false }
  if (typeof username !== 'string' || !username || username.length > 500) return { ok: false }
  if (typeof password !== 'string' || !password || password.length > 1000) return { ok: false }
  if (typeof url !== 'string' || url.length > 2048) return { ok: false }
  const idx = cachedPasswords.findIndex(p => p.domain === domain && p.username === username)
  let entry
  if (idx >= 0) {
    cachedPasswords[idx].password  = password
    cachedPasswords[idx].updatedAt = Date.now()
    entry = cachedPasswords[idx]
  } else {
    entry = { id: 'pw' + Date.now(), domain, url, username, password, createdAt: Date.now(), lastUsed: 0 }
    cachedPasswords.unshift(entry)
  }
  writePasswords(cachedPasswords)
  return { ok: true, entry: pwMeta(entry) }
})

ipcMain.handle('password-delete', (_, id) => {
  if (typeof id !== 'string' || id.length > 50) return false
  cachedPasswords = cachedPasswords.filter(p => p.id !== id)
  writePasswords(cachedPasswords)
  return true
})

// ── Aperçu des onglets
ipcMain.handle('capture-tab', async (_, wcId) => {
  try {
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) return null
    const img = await wc.capturePage()
    return img.resize({ width: 280, quality: 'good' }).toDataURL()
  } catch { return null }
})

// ── Sessions nommées (par profil)
let cachedSessions = []
function writeSessions(s) { try { writeFileAtomic(path.join(profileDir(), 'sessions.json'), JSON.stringify(s)) } catch {} }

ipcMain.handle('sessions-save', (_, s) => { cachedSessions = s; writeSessions(s) })
ipcMain.on('sessions-load-sync', e => { e.returnValue = cachedSessions })

// ── Historique (par profil — profiles/<id>/history.json)
// L'ancien fichier global n'est plus lu qu'une fois, par migrateProfileIsolation()
const LEGACY_HISTORY_PATH = path.join(app.getPath('userData'), 'history.json')
let cachedHistory = []
function writeHistory(h) { try { writeFileAtomic(historyFile(), JSON.stringify(h)) } catch {} }

// ── Chargement d'un profil
function loadProfileData(id) {
  activeProfileId = id
  try { fs.mkdirSync(profileDir(id), { recursive: true }) } catch {}
  config = { adblock: true, webDarkMode: false, httpsUpgrade: true }
  try { Object.assign(config, JSON.parse(fs.readFileSync(path.join(profileDir(id), 'config.json'), 'utf-8'))) } catch {}
  // {} (et non null) — pour qu'un profil neuf utilise ses propres défauts
  // au lieu de retomber sur le localStorage partagé (qui contient le profil précédent)
  cachedAppState = {}
  try { cachedAppState = JSON.parse(fs.readFileSync(path.join(profileDir(id), 'state.json'), 'utf-8')) } catch {}
  cachedSessions = []
  try { cachedSessions = JSON.parse(fs.readFileSync(path.join(profileDir(id), 'sessions.json'), 'utf-8')) } catch {}
  cachedHistory = []
  try { cachedHistory = JSON.parse(fs.readFileSync(historyFile(), 'utf-8')) } catch {}
  loadPasswordsFromDisk()
  userAllowedProtos.clear()
  try { for (const p of JSON.parse(config.allowedExternalProtos || '[]')) if (typeof p === 'string') userAllowedProtos.add(p) } catch {}
  profilesIndex.lastUsedId = id
  saveProfilesIndex()
}

const PROFILE_PRESETS = {
  video: { essentials: [
    { id:'e1', title:'YouTube',     url:'https://www.youtube.com',      favicon:'https://www.youtube.com/favicon.ico' },
    { id:'e2', title:'Netflix',     url:'https://www.netflix.com',      favicon:'https://www.netflix.com/favicon.ico' },
    { id:'e3', title:'Prime Video', url:'https://www.primevideo.com',   favicon:'https://www.primevideo.com/favicon.ico' },
    { id:'e4', title:'Anime-Sama',  url:'https://anime-sama.fr',        favicon:'https://anime-sama.fr/favicon.ico' },
  ]},
  work: { essentials: [
    { id:'e1', title:'GitHub',  url:'https://github.com',       favicon:'https://github.com/favicon.ico' },
    { id:'e2', title:'Claude',  url:'https://claude.ai',        favicon:'https://claude.ai/favicon.ico' },
    { id:'e3', title:'ChatGPT', url:'https://chatgpt.com',      favicon:'https://chatgpt.com/favicon.ico' },
    { id:'e4', title:'Google',  url:'https://www.google.com',   favicon:'https://www.google.com/favicon.ico' },
  ]},
  lecture: { essentials: [
    { id:'e1', title:'ScanManga', url:'https://www.scan-manga.com', favicon:'https://www.scan-manga.com/favicon.ico' },
    { id:'e2', title:'Mangadex',  url:'https://mangadex.org',       favicon:'https://mangadex.org/favicon.ico' },
  ]},
  gaming: { essentials: [
    { id:'e1', title:'Steam',   url:'https://store.steampowered.com', favicon:'https://store.steampowered.com/favicon.ico' },
    { id:'e2', title:'Discord', url:'https://discord.com/app',        favicon:'https://discord.com/favicon.ico' },
    { id:'e3', title:'Twitch',  url:'https://www.twitch.tv',          favicon:'https://www.twitch.tv/favicon.ico' },
  ]},
}

function makePresetState(key) {
  const p = PROFILE_PRESETS[key]; if (!p) return null
  return { tabs:[], essentials:p.essentials, favorites:[], spaces:[], activeTabId:null, activeEssentialId:'e1', activeSpaceId:null }
}

function initProfiles() {
  try { fs.mkdirSync(PROFILES_DIR, { recursive: true }) } catch {}
  try { profilesIndex = JSON.parse(fs.readFileSync(PROFILES_INDEX, 'utf-8')) } catch {}
  if (profilesIndex.profiles.length > 0) { migrateProfileIsolation(); return false }
  const legacyState    = path.join(app.getPath('userData'), 'state.json')
  const legacyConfig   = path.join(app.getPath('userData'), 'config.json')
  const legacySessions = path.join(app.getPath('userData'), 'sessions.json')
  if (fs.existsSync(legacyState) || fs.existsSync(legacyConfig)) {
    const id = 'default'
    try {
      fs.mkdirSync(profileDir(id), { recursive: true })
      if (fs.existsSync(legacyState))    fs.copyFileSync(legacyState,    path.join(profileDir(id), 'state.json'))
      if (fs.existsSync(legacyConfig))   fs.copyFileSync(legacyConfig,   path.join(profileDir(id), 'config.json'))
      if (fs.existsSync(legacySessions)) fs.copyFileSync(legacySessions, path.join(profileDir(id), 'sessions.json'))
    } catch {}
    profilesIndex.profiles.push({ id, name:'Mon profil', emoji:'\u{1F3E0}', image:null, color:'#0a84ff' })
    profilesIndex.lastUsedId = id
    migrateProfileIsolation()   // → persist:divo + reprise de l'historique / mots de passe globaux
    return false
  }
  return true
}

async function showProfileSelectorWindow() {
  return new Promise(resolve => {
    pendingProfileSelectResolve = resolve
    profileSelectorWin = new BrowserWindow({
      width: 380, height: 540,
      frame: false, resizable: false, center: true, thickFrame: false,
      title: 'Divo — Profil',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload-profile.js'),
        contextIsolation: true,
        sandbox: true,
      }
    })
    profileSelectorWin.loadFile(path.join(__dirname, 'renderer', 'profile-selector.html'))
    profileSelectorWin.on('closed', () => {
      profileSelectorWin = null
      if (pendingProfileSelectResolve) {
        const r = pendingProfileSelectResolve; pendingProfileSelectResolve = null
        if (profilesIndex.profiles.length > 0) {
          const id = profilesIndex.lastUsedId || profilesIndex.profiles[0].id
          const p  = profilesIndex.profiles.find(x => x.id === id)
          if (p) { loadProfileData(p.id); r(); return }
        }
        app.quit()
      }
    })
  })
}

// IPC — sélecteur de profils
ipcMain.handle('ps-get-data', () => ({ profiles: profilesIndex.profiles, isFirstRun: profilesIndex.profiles.length === 0 }))

ipcMain.handle('ps-select', (_, id) => {
  if (!profilesIndex.profiles.some(p => p.id === id)) return { ok: false }
  if (mainWindow) {
    try { fs.writeFileSync(LAUNCH_PROFILE_FILE, id) } catch {}
    relaunchApp(); app.exit(0)
    return { ok: true }
  }
  loadProfileData(id)
  const r = pendingProfileSelectResolve; pendingProfileSelectResolve = null
  setImmediate(() => { if (profileSelectorWin && !profileSelectorWin.isDestroyed()) profileSelectorWin.close() })
  if (r) r()
  return { ok: true }
})

ipcMain.handle('ps-create', (_, data) => {
  const id = 'p' + Date.now()
  try { fs.mkdirSync(profileDir(id), { recursive: true }) } catch {}
  // Nouveau profil = nouvelle partition vierge (aucun compte connecté, aucun cookie)
  profilesIndex.profiles.push({ id, name: data.name||'Profil', emoji: data.emoji||'\u{1F3E0}', image: data.image||null, color: data.color||'#0a84ff', partition: partitionForNewProfile(id) })
  if (data.presetKey) { const st = makePresetState(data.presetKey); if (st) try { writeFileAtomic(path.join(profileDir(id),'state.json'), JSON.stringify(st)) } catch {} }
  if (mainWindow) {
    saveProfilesIndex()
    try { fs.writeFileSync(LAUNCH_PROFILE_FILE, id) } catch {}
    relaunchApp(); app.exit(0)
    return { ok: true }
  }
  loadProfileData(id)
  const r = pendingProfileSelectResolve; pendingProfileSelectResolve = null
  setImmediate(() => { if (profileSelectorWin && !profileSelectorWin.isDestroyed()) profileSelectorWin.close() })
  if (r) r()
  return { ok: true }
})

ipcMain.handle('ps-edit', (_, id, data) => {
  const p = profilesIndex.profiles.find(x => x.id === id); if (!p) return { ok: false }
  if (data.name  !== undefined) p.name  = data.name
  if (data.emoji !== undefined) p.emoji = data.emoji
  if (data.color !== undefined) p.color = data.color
  if (data.image !== undefined) p.image = data.image
  saveProfilesIndex(); return { ok: true }
})

ipcMain.handle('ps-delete', (_, id) => {
  if (profilesIndex.profiles.length <= 1) return { ok: false, reason: 'last' }
  const idx = profilesIndex.profiles.findIndex(p => p.id === id); if (idx === -1) return { ok: false }
  // Le profil en cours d'utilisation a sa session ouverte : on ne supprime pas ses fichiers sous lui
  if (mainWindow && id === activeProfileId) return { ok: false, reason: 'active' }
  const [removed] = profilesIndex.profiles.splice(idx, 1)
  if (profilesIndex.lastUsedId === id) profilesIndex.lastUsedId = profilesIndex.profiles[0].id
  saveProfilesIndex()
  try { fs.rmSync(profileDir(id), { recursive: true, force: true }) } catch {}
  // Cookies / données des sites du profil supprimé (jamais la partition historique persist:divo,
  // ni une partition encore utilisée par un autre profil)
  const part = removed.partition
  if (part && part !== LEGACY_PARTITION && !profilesIndex.profiles.some(p => p.partition === part)) {
    try { fs.rmSync(partitionDir(part), { recursive: true, force: true }) } catch {}
  }
  return { ok: true }
})

ipcMain.handle('ps-close',            () => {
  if (mainWindow) { if (profileSelectorWin && !profileSelectorWin.isDestroyed()) profileSelectorWin.close() }
  else app.quit()
})
ipcMain.handle('get-active-profile',  () => profilesIndex.profiles.find(p => p.id === activeProfileId) || null)
ipcMain.handle('get-all-profiles',    () => profilesIndex.profiles)
ipcMain.handle('switch-profile',      () => {
  profileSelectorWin = new BrowserWindow({
    width: 380, height: 540,
    frame: false, resizable: false, center: true, thickFrame: false,
    title: 'Divo — Profil',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-profile.js'),
      contextIsolation: true,
      sandbox: true,
    }
  })
  profileSelectorWin.loadFile(path.join(__dirname, 'renderer', 'profile-selector.html'))
  profileSelectorWin.on('closed', () => { profileSelectorWin = null })
})
ipcMain.handle('edit-active-profile', (_, data) => {
  const p = profilesIndex.profiles.find(x => x.id === activeProfileId); if (!p) return { ok: false }
  if (data.name  !== undefined) p.name  = data.name
  if (data.emoji !== undefined) p.emoji = data.emoji
  if (data.color !== undefined) p.color = data.color
  saveProfilesIndex(); return { ok: true }
})

ipcMain.handle('history-save', (_, h) => { cachedHistory = h; writeHistory(h) })
ipcMain.on('history-load-sync', e => { e.returnValue = cachedHistory })

// Sessions qui hébergent des webviews — les handlers de sécurité doivent couvrir toutes.
// Uniquement la partition du profil actif (+ privée) : à n'appeler qu'une fois le profil chargé.
function getProtectedSessions() {
  if (!activeProfileId) throw new Error('getProtectedSessions() appelé avant le choix du profil')
  return [session.defaultSession, session.fromPartition(activePartition()), session.fromPartition('private:incognito')]
}

// ── Adblocker (CSS/JS + blocklist réseau)
const BL_DIR = app.getPath('userData')
const BL_VER = 'v6'
const BL_DOMAINS_FILE  = path.join(BL_DIR, `bl_${BL_VER}_domains.txt`)
const BL_COSMETIC_FILE = path.join(BL_DIR, `bl_${BL_VER}_cosmetic.json`)
const BL_TTL = 7 * 24 * 60 * 60 * 1000

let blockedDomains     = new Set()
let cosmeticGenericCSS = ''           // CSS générique prêt à injecter (une règle par sélecteur)
const cosmeticByDomain = new Map()    // "example.com" → ["#ad", ".banner", …]
const adblockStats = { blocked: 0 }

// Helpers d'injection — tests sur le hostname (un includes() sur l'URL matchait aussi
// "evil.com/?q=youtube.com")
function isInjectableUrl(url) {
  return !!url && url !== 'about:blank' && !url.startsWith('chrome') && !url.startsWith('arc') && !url.startsWith('file')
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase() } catch { return '' } }
function onHost(host, d) { return host === d || host.endsWith('.' + d) }
function isYouTubeHost(host) { return onHost(host, 'youtube.com') || onHost(host, 'youtu.be') }

// Renvoie true si hostname (ou un domaine parent) est dans la blocklist, sauf whitelist
function isBlockedHostname(hostname) {
  const parts = hostname.toLowerCase().split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    if (ADBLOCK_NEVER_BLOCK.has(parts.slice(i).join('.'))) return false
  }
  for (let i = 0; i < parts.length - 1; i++) {
    if (blockedDomains.has(parts.slice(i).join('.'))) return true
  }
  return false
}

// Filtre les pseudo-classes uBlock/ABP non natives (navigateur ne les comprend pas)
function isNativeSelector(sel) {
  // Rejette toute tentative d'injection CSS via accolades ou commentaires
  if (/[{}]|\/\*|\*\//.test(sel)) return false
  const ext = [':has-text(', ':upward(', ':xpath(', ':matches-css(', ':-abp-',
               ':if(', ':if-not(', '+js(', ':watch-attr(', ':min-text-length(',
               ':matches-path(', ':others(']
  return !ext.some(s => sel.includes(s))
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
        const inner = rule.slice(2).split(/[\^/?]/)[0].toLowerCase()
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
  return hideCSS(sels)
}

// Une règle par sélecteur : avec "a, b, c { … }", Chromium ignore la règle ENTIÈRE dès qu'un
// seul sélecteur lui est inconnu — un sélecteur exotique d'EasyList désactivait tout le cosmétique.
function hideCSS(sels) {
  return sels.map(s => s + '{display:none!important}').join('\n')
}
const COSMETIC_GENERIC_MAX = 6000

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

    const domOk = domRes.status === 'fulfilled' && domRes.value.ok
    const elOk  = elRes.status  === 'fulfilled' && elRes.value.ok
    // Hors ligne / serveur indisponible : garder le cache plutôt qu'écrire une liste vide
    // (qui aurait désactivé l'adblock jusqu'au prochain refresh, 7 jours plus tard)
    if (!domOk && !elOk) { writeLog('[adblock] listes indisponibles, cache conservé'); return }

    if (domOk) {
      const text = await domRes.value.text()
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t || t[0] === '#' || t[0] === '!') continue
        const d = t.split(/\s+/).pop().toLowerCase().replace(/^\*\./, '')
        if (d.includes('.') && d !== 'localhost' && !/^\d+\.\d+\.\d+/.test(d)) newDomains.add(d)
      }
    }

    if (elOk) {
      // parseNetRules=false : on utilise EasyList pour les cosmétiques uniquement,
      // OISD couvre déjà le blocage réseau sans risquer des faux-positifs Google/CDN
      parseAbpList(await elRes.value.text(), newDomains, newGeneric, newByDomain, false)
    }

    // Sauvegarde + application — uniquement les listes effectivement téléchargées
    if (domOk) {
      writeFileAtomic(BL_DOMAINS_FILE, [...newDomains].join('\n'), 'utf-8')
      blockedDomains = newDomains
    }
    if (elOk) {
      const generic = newGeneric.slice(0, COSMETIC_GENERIC_MAX)
      writeFileAtomic(BL_COSMETIC_FILE, JSON.stringify({ generic, byDomain: Object.fromEntries(newByDomain) }), 'utf-8')
      cosmeticGenericCSS = hideCSS(generic)
      cosmeticByDomain.clear()
      for (const [k, v] of newByDomain) cosmeticByDomain.set(k, v)
    }

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
      cosmeticGenericCSS = hideCSS((data.generic || []).slice(0, COSMETIC_GENERIC_MAX))
      for (const [k, v] of Object.entries(data.byDomain || {})) cosmeticByDomain.set(k, v)
    } catch {}
  }

  const needsRefresh = !fs.existsSync(BL_DOMAINS_FILE) || !fs.existsSync(BL_COSMETIC_FILE) ||
    Date.now() - fs.statSync(BL_DOMAINS_FILE).mtimeMs > BL_TTL
  if (needsRefresh) refreshFilterLists()
}

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

function onBeforeRequestHandler(details, callback) {
  // Adblocker réseau : bloque les sous-requêtes (pubs, trackers) vers domaines connus
  if (config.adblock && blockedDomains.size && details.resourceType !== 'mainFrame') {
    const scheme = details.url.split(':')[0]
    if (scheme !== 'divo' && scheme !== 'file') {
      try {
        if (isBlockedHostname(new URL(details.url).hostname)) {
          adblockStats.blocked++
          callback({ cancel: true }); return
        }
      } catch {}
    }
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
  callback({})
}

function setupCsp() {
  for (const s of getProtectedSessions()) {
    s.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const url = details.url || ''
      if (url.startsWith('divo://')) {
        // Nos pages internes : CSP stricte
        return cspHandler(details, callback)
      }
      // YouTube uniquement : retirer require-trusted-types-for pour que page-preload.js puisse
      // injecter son patch anti-pub (<script>.textContent). Partout ailleurs on garde cette
      // protection anti-XSS des sites intacte.
      if (!isYouTubeHost(hostOf(url))) { callback({}); return }
      const headers = { ...details.responseHeaders }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-security-policy') {
          headers[key] = headers[key].map(v =>
            v.replace(/require-trusted-types-for\s+'script'\s*;?\s*/gi, '')
          )
        }
      }
      callback({ responseHeaders: headers })
    })
  }
}

function setupWebRequestFilters() {
  for (const s of getProtectedSessions()) {
    s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, onBeforeRequestHandler)
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
  .ytp-ad-player-overlay-skip-or-preview, .ytp-ad-button-icon,
  .ytp-ad-action-interstitial, .ytp-ad-action-interstitial-slot,
  .ytp-suggested-action-badge, .ytp-suggested-action-badge-expanded,
  ytd-action-companion-ad-renderer, ytd-ad-slot-renderer,
  ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
  ytd-search-pyv-renderer, ytd-display-ad-renderer,
  ytd-promoted-sparkles-text-search-renderer, ytd-statement-banner-renderer,
  ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
  ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer,
  ytd-video-masthead-ad-v3-renderer, ytd-primetime-promo-renderer,
  ytd-compact-promoted-video-renderer, ytd-mealbar-promo-renderer,
  ytd-enforcement-message-view-model,
  tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
  #player-ads, #masthead-ad, .ytd-banner-promo-renderer { display: none !important; }
`
const YT_AD_JS = `(function(){
  if (window.__dv) return; window.__dv = 1;

  function dismissEnforcement() {
    var btns = document.querySelectorAll(
      'ytd-enforcement-message-view-model button, ' +
      'tp-yt-paper-dialog ytd-button-renderer button, ' +
      'ytd-mealbar-promo-renderer #dismiss-button button, ' +
      'ytd-mealbar-promo-renderer button[aria-label]'
    );
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].offsetParent !== null) { btns[i].click(); return true; }
    }
    return false;
  }

  function skip() {
    if (dismissEnforcement()) return;

    // Bouton "Passer l'annonce" — sélecteurs 2024/2025
    var btn = document.querySelector(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, ' +
      '.ytp-ad-skip-button-slot button, button[class*="skip"]'
    );
    if (btn) { btn.click(); return; }

    var vid = document.querySelector('video');
    if (!vid) return;

    // Détection via .ad-showing sur <html> (la plus fiable, stable depuis 2020)
    var isAd =
      document.documentElement.classList.contains('ad-showing') ||
      document.documentElement.classList.contains('ad-interrupting') ||
      !!document.querySelector(
        '.ytp-ad-player-overlay-instream-info, .ytp-ad-simple-ad-badge, ' +
        '.ytp-ad-preview-container, .ytp-ad-player-overlay-layout'
      );

    if (isAd) {
      if (vid.playbackRate !== 16) {
        if (window.__dvRate === undefined) window.__dvRate = vid.playbackRate;
        vid.playbackRate = 16;
      }
      if (!vid.muted) { window.__dvWasMuted = false; vid.muted = true; }
      if (isFinite(vid.duration) && vid.duration > 0)
        vid.currentTime = vid.duration - 0.01;
    } else if (window.__dvRate !== undefined) {
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

  // Polling de sécurité : MutationObserver peut manquer certains états transitoires
  setInterval(skip, 100);

  // YouTube SPA : chaque navigation vidéo déclenche cet événement
  window.__dvSkip = skip;
  document.addEventListener('yt-navigate-finish', skip);
  skip();
})()`

// ── YouTube : injection précoce (dom-ready) — intercepte l'API player avant YouTube
const YT_EARLY_JS = `(function(){
  if (window.__dvE) return; window.__dvE = 1;

  var AD_KEYS = ['adPlacements','playerAds','adSlots','adBreakHeartbeatParams',
                 'externalAdsConfig','auxiliaryUi','paidContentOverlay',
                 'adCpns','adMetadata'];

  function cleanYT(obj, d) {
    if (!obj || typeof obj !== 'object' || d > 8) return;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) cleanYT(obj[i], d + 1);
      return;
    }
    for (var i = 0; i < AD_KEYS.length; i++) delete obj[AD_KEYS[i]];
    if (obj.playabilityStatus && obj.playabilityStatus.status &&
        obj.playabilityStatus.status !== 'OK' &&
        obj.playabilityStatus.status !== 'LIVE_STREAM_OFFLINE' &&
        obj.playabilityStatus.status !== 'LOGIN_REQUIRED') {
      if (!obj.playabilityStatus.reason) obj.playabilityStatus.status = 'OK';
    }
    for (var k in obj) {
      if (obj.hasOwnProperty(k) && obj[k] && typeof obj[k] === 'object') {
        cleanYT(obj[k], d + 1);
      }
    }
  }

  // Nettoyer ytInitialPlayerResponse déjà posé par les scripts inline du HTML
  try {
    var cur = window.ytInitialPlayerResponse;
    if (cur) cleanYT(cur, 0);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get: function() { return cur; },
      set: function(v) { cleanYT(v, 0); cur = v; },
      configurable: true
    });
  } catch {}

  // Intercepter fetch pour /youtubei/v1/player et /youtubei/v1/next
  var _f = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = _f.apply(this, arguments);
    if (!url.includes('/youtubei/v1/player') && !url.includes('/youtubei/v1/next')) return p;
    return p.then(function(resp) {
      var fallback = resp.clone();
      return resp.text().then(function(text) {
        try {
          var json = JSON.parse(text);
          cleanYT(json, 0);
          var h = {};
          resp.headers.forEach(function(v, k) {
            if (k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding') h[k] = v;
          });
          return new Response(JSON.stringify(json), { status: resp.status, statusText: resp.statusText, headers: h });
        } catch { return fallback; }
      }).catch(function() { return fallback; });
    });
  };
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
  /* global document, window, MutationObserver */ // exécutée dans la page (via toString), pas dans le main
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
  try {
    autoUpdater.logger = null
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('update-available', info => {
      try {
        pendingUpdateVersion = info.version
        mainWindow?.webContents.send('update-available', { version: info.version })
      } catch {}
    })
    autoUpdater.on('download-progress', p => {
      try { mainWindow?.webContents.send('update-progress', Math.round(p.percent)) } catch {}
    })
    autoUpdater.on('update-downloaded', () => {
      try { mainWindow?.webContents.send('update-progress', 100) } catch {}
    })
    autoUpdater.on('error', (e) => writeLog('autoUpdater error: ' + (e?.message || e)))
    setTimeout(() => {
      try {
        writeLog('autoUpdater: checking for updates...')
        autoUpdater.checkForUpdates().catch(e => writeLog('checkForUpdates error: ' + e?.message))
      } catch (e) { writeLog('checkForUpdates threw: ' + e.message) }
    }, 15000)
    setInterval(() => {
      try { autoUpdater.checkForUpdates().catch(() => {}) } catch {}
    }, 4 * 60 * 60 * 1000)
  } catch (e) {
    writeLog('setupAutoUpdater failed: ' + e.message)
  }
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
  const DIVO_PAGES = { newtab: 'newtab.html', settings: 'settings.html', dino: 'dino.html', secret: 'secret.html' }
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
  for (const partition of [activePartition(), 'private:incognito']) {
    try { session.fromPartition(partition).protocol.handle('divo', makeDivoHandler()) } catch {}
  }

  rendererReady = false
  mainWindow.loadFile('renderer/index.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true
    for (const u of pendingOpenUrls.splice(0)) mainWindow.webContents.send('open-new-tab', u)
  })

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
  attachWebviewSecurity(mainWindow.webContents)
}

// ── Ouverture de liens externes avec confirmation pour les protocoles inconnus
// Protocoles inoffensifs : pas d'args sensibles, dialog inutile
const ALWAYS_OPEN_PROTOS = new Set(['mailto:', 'tel:', 'sms:', 'callto:'])
// Rempli par loadProfileData() (la config du profil n'est pas encore chargée à ce stade)
const userAllowedProtos  = new Set()
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

// ── Popups JS (window.open avec dimensions, ex : pubs) → mini-fenêtre "Peek" dismissable
// au lieu d'un nouvel onglet. L'utilisateur choisit de la promouvoir en onglet classique
// ou de la fermer.
const PEEK_WIDTH  = 420
const PEEK_HEIGHT = 640
function createPeekWindow(url) {
  const offset = peekWindows.size * 28
  const win = new BrowserWindow({
    width: PEEK_WIDTH, height: PEEK_HEIGHT,
    minWidth: 280, minHeight: 220,
    frame: false,
    backgroundColor: '#111113',
    title: 'Divo — Aperçu',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload-peek.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    }
  })
  if (mainWindow) {
    const b = mainWindow.getBounds()
    win.setPosition(
      Math.round(b.x + (b.width - PEEK_WIDTH) / 2) + offset,
      Math.round(b.y + (b.height - PEEK_HEIGHT) / 2) + offset
    )
  }
  attachWebviewSecurity(win.webContents)
  win.loadFile(path.join(__dirname, 'renderer', 'peek.html'), { query: { url } })
  peekWindows.add(win)
  win.on('closed', () => peekWindows.delete(win))
  return win
}

ipcMain.on('peek-close', e => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win && !win.isDestroyed()) win.close()
})

ipcMain.on('peek-promote', (e, url) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (mainWindow && url) {
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
    mainWindow.webContents.send('open-new-tab', url)
    mainWindow.focus()
  }
  if (win && !win.isDestroyed()) win.close()
})

app.whenReady().then(async () => {
  initBlocklist()

  // ── Choix du profil EN PREMIER : la partition (session) à protéger en dépend.
  // Le sélecteur n'utilise que la session par défaut (aucune webview).
  initProfiles()
  let launchProfileId = null
  try { launchProfileId = fs.readFileSync(LAUNCH_PROFILE_FILE, 'utf-8').trim(); fs.unlinkSync(LAUNCH_PROFILE_FILE) } catch {}
  if (launchProfileId) {
    const lp = profilesIndex.profiles.find(x => x.id === launchProfileId)
    if (lp) { loadProfileData(lp.id) } else { await showProfileSelectorWindow() }
  } else if (profilesIndex.profiles.length === 0) {
    await showProfileSelectorWindow()
  } else if (profilesIndex.profiles.length === 1) {
    loadProfileData(profilesIndex.profiles[0].id)
  } else {
    await showProfileSelectorWindow()
  }

  // ── Sessions du profil actif (+ navigation privée) : adblock, CSP, téléchargements, permissions
  setupWebRequestFilters()
  setupCsp()

  // ── Téléchargements — appliqués sur toutes les sessions (profil actif + private:incognito)
  const safeFilename = raw =>
    path.basename(String(raw || 'download'))
      // eslint-disable-next-line no-control-regex -- caractères de contrôle volontairement filtrés
      .replace(/[\x00-\x1f<>"'/\\|?*]/g, '_')
      .slice(0, 200) || 'download'

  let dlSeq = 0
  const willDownloadHandler = (_, item) => {
    const id = Date.now() * 1000 + (dlSeq++ % 1000)   // unique même pour 2 téléchargements dans la même ms
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
      // settle() ne répond qu'une fois ; refus automatique si l'onglet est fermé avant la réponse
      const settle = granted => { if (pendingPerms.delete(key)) callback(!!granted) }
      pendingPerms.set(key, settle)
      wc.once('destroyed', () => settle(false))
      mainWindow.webContents.send('permission-request', {
        key,
        permission,
        label: PERM_LABELS[permission] || permission,
        origin: (() => { try { return new URL(details?.requestingUrl || wc.getURL()).hostname } catch { return 'ce site' } })()
      })
    })
  }

  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'webview') {
      // Liens custom protocol (steam://, discord://, epic://, etc.) → ouvrir dans l'OS
      contents.on('will-navigate', (event, url) => {
        try {
          const proto = new URL(url).protocol
          if (!SAFE_PROTOS.has(proto)) {
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

      // dom-ready (avant le rendu complet) : le CSS cosmétique est posé avant que les pubs
      // ne s'affichent — avec did-finish-load elles apparaissaient une fraction de seconde.
      contents.on('dom-ready', () => {
        if (!config.adblock) return
        const url = contents.getURL()
        if (!isInjectableUrl(url) || url.startsWith('divo:')) return
        const host = hostOf(url)
        // CSS génériques (curatés + EasyList)
        contents.insertCSS(GENERIC_AD_CSS).catch(() => {})
        if (cosmeticGenericCSS) contents.insertCSS(cosmeticGenericCSS).catch(() => {})
        // CSS cosmétiques spécifiques au domaine
        const domCSS = host && getPageCosmeticCSS(host)
        if (domCSS) contents.insertCSS(domCSS).catch(() => {})
        if (isYouTubeHost(host)) {
          contents.executeJavaScript(YT_EARLY_JS).catch(() => {})
          contents.insertCSS(YT_AD_CSS).catch(() => {})
        }
        if (onHost(host, 'twitch.tv')) contents.insertCSS(TWITCH_AD_CSS).catch(() => {})
      })

      contents.on('did-finish-load', () => {
        const url = contents.getURL()
        if (!isInjectableUrl(url)) return
        const host = hostOf(url)

        if (config.adblock && !url.startsWith('divo:')) {
          // Scripts anti-pub : besoin du DOM complet (lecteur vidéo)
          if (isYouTubeHost(host))      contents.executeJavaScript(YT_AD_JS).catch(() => {})
          if (onHost(host, 'twitch.tv')) contents.executeJavaScript(TWITCH_AD_JS).catch(() => {})
        }

        // Boutons souris 4 (retour) et 5 (avant) — injectés dans chaque page
        contents.executeJavaScript(`(function(){
          if (window.__dvMouseNav) return; window.__dvMouseNav = 1;
          document.addEventListener('mouseup', function(e) {
            if (e.button === 3) { e.preventDefault(); history.back(); }
            if (e.button === 4) { e.preventDefault(); history.forward(); }
          }, true);
        })()`).catch(() => {})

        if (config.webDarkMode && !url.startsWith('divo:')) {
          try {
            const hostname = new URL(url).hostname.replace(/^www\./, '')
            const skip = WEB_DARK_SKIP.some(h => hostname === h || hostname.endsWith('.' + h))
            if (!skip) contents.executeJavaScript(WEB_DARK_JS).catch(() => {})
          } catch {}
        }
      })

      // Navigation SPA : re-injecter YouTube + dark mode
      contents.on('did-navigate-in-page', (_, url, isMainFrame) => {
        if (!isMainFrame || !url || url.startsWith('divo:')) return
        if (config.adblock && isYouTubeHost(hostOf(url))) {
          // Pas de ré-insertion de YT_AD_CSS ici : le CSS posé au did-finish-load
          // persiste à travers les navigations SPA (même document) — le réinjecter
          // à chaque vidéo empilait une feuille de style supplémentaire à chaque
          // fois (fuite mémoire qui grossissait au fil du visionnage).
          contents.executeJavaScript(
            'clearTimeout(window.__dvSkipT);window.__dvSkipT=setTimeout(function(){if(window.__dvSkip)window.__dvSkip();},200)'
          ).catch(() => {})
        }
        if (!config.webDarkMode) return
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
      contents.setWindowOpenHandler(({ url, disposition }) => {
        try {
          const proto = new URL(url).protocol
          if (!SAFE_PROTOS.has(proto)) {
            const origin = (() => { try { return new URL(contents.getURL()).hostname } catch { return '' } })()
            maybeOpenExternal(url, origin)
            return { action: 'deny' }
          }
        } catch {}
        if (config.adblock && url) {
          try {
            if (isBlockedHostname(new URL(url).hostname)) return { action: 'deny' }
          } catch {}
        }
        // Toute demande d'ouverture d'un nouvel onglet/fenêtre (lien target=_blank,
        // window.open avec ou sans dimensions, pub qui s'ouvre "dans un autre onglet"...)
        // passe d'abord par une mini-fenêtre "Peek" façon Arc : l'utilisateur choisit
        // de la promouvoir en onglet classique ou de la fermer.
        if (disposition === 'new-window' || disposition === 'foreground-tab' || disposition === 'background-tab') {
          createPeekWindow(url)
          return { action: 'deny' }
        }
        if (mainWindow && url) {
          if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
          mainWindow.webContents.send('open-new-tab', url)
        }
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
  pendingPerms.get(key)?.(granted)
})

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
ipcMain.handle('set-theme', (_, theme) => {
  // Valeur réinjectée dans un attribut HTML des pages divo:// — liste fermée
  if (theme !== 'dark' && theme !== 'light') return
  config.theme = theme; saveConfig()
})

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

// ── Adblock IPC
ipcMain.handle('adblock-status', () => config.adblock !== false)
ipcMain.handle('adblock-toggle', (_, enabled) => { config.adblock = !!enabled; saveConfig(); return config.adblock })
ipcMain.handle('adblock-stats', () => adblockStats)

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

// ── Export / Import profil
ipcMain.handle('profile-export', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le profil Divo',
    defaultPath: `divo-profile-${new Date().toISOString().slice(0,10)}.divo-profile`,
    filters: [{ name: 'Profil Divo', extensions: ['divo-profile'] }],
  })
  if (canceled || !filePath) return { ok: false }
  try {
    const profile = {
      app: 'Divo',
      version: '3.0.0',
      exportedAt: new Date().toISOString(),
      state:    cachedAppState || null,
      history:  cachedHistory  || [],
      config:   { ...config },
      sessions: cachedSessions || [],
    }
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('profile-import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer un profil Divo',
    filters: [{ name: 'Profil Divo', extensions: ['divo-profile'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) return { ok: false }
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8')
    const profile = JSON.parse(raw)
    if (profile.app !== 'Divo') return { ok: false, error: 'Fichier invalide' }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Importer le profil',
      message: 'Cette action remplacera vos données actuelles.',
      detail: `Profil exporté le ${new Date(profile.exportedAt).toLocaleString('fr-FR')}.\nVos onglets, favoris, espaces, historique et sessions actuels seront remplacés.`,
      buttons: ['Annuler', 'Importer et redémarrer'],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1) return { ok: false }
    if (profile.state)    { cachedAppState = profile.state;    writeAppState(profile.state) }
    if (profile.history)  { cachedHistory  = profile.history;  writeHistory(profile.history) }
    if (profile.sessions) { cachedSessions = profile.sessions; writeSessions(profile.sessions) }
    // Seuls les réglages d'apparence/confort sont importés. Jamais allowedExternalProtos
    // (un fichier piégé pourrait autoriser l'ouverture silencieuse de protocoles dangereux)
    // ni downloadPath (chemin d'une autre machine / dossier arbitraire).
    if (profile.config && typeof profile.config === 'object') {
      const c = profile.config
      if (typeof c.adblock      === 'boolean') config.adblock      = c.adblock
      if (typeof c.webDarkMode  === 'boolean') config.webDarkMode  = c.webDarkMode
      if (typeof c.httpsUpgrade === 'boolean') config.httpsUpgrade = c.httpsUpgrade
      if (c.theme === 'dark' || c.theme === 'light') config.theme = c.theme
      saveConfig()
    }
    relaunchApp()
    app.exit(0)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})