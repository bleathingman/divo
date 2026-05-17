// Polyfill injecté avant les scripts d'extension (service workers ET background pages)
// via session.registerPreloadScript — pas de 'window' pour compatibilité SW
;(function () {
  if (typeof chrome === 'undefined' || !chrome.storage) return

  const local = chrome.storage.local
  if (!local) return

  // Remplace chrome.storage.sync → chrome.storage.local (sync non supporté dans Electron)
  // Essaie plusieurs stratégies car la propriété peut être non-configurable
  const syncProxy = {
    QUOTA_BYTES: local.QUOTA_BYTES || 102400,
    get:            (k, cb) => local.get(k, cb),
    set:            (v, cb) => local.set(v, cb),
    remove:         (k, cb) => local.remove(k, cb),
    clear:          (cb)    => local.clear(cb),
    getBytesInUse:  (k, cb) => local.getBytesInUse ? local.getBytesInUse(k, cb) : (cb && cb(0), Promise.resolve(0)),
    onChanged: local.onChanged || { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
  }

  // Stratégie 1 : Object.defineProperty (fonctionne si configurable:true)
  try {
    Object.defineProperty(chrome.storage, 'sync', { get: () => syncProxy, configurable: true, enumerable: true })
  } catch {
    // Stratégie 2 : assignment direct
    try { chrome.storage.sync = syncProxy } catch {}
  }

  // chrome.storage.managed — stub no-op
  if (!chrome.storage.managed) {
    try {
      const noop = { get: (k,cb) => (cb && cb({}), Promise.resolve({})), set: (_,cb) => (cb && cb(), Promise.resolve()), remove: (_,cb) => (cb && cb(), Promise.resolve()), clear: (cb) => (cb && cb(), Promise.resolve()), onChanged: { addListener:()=>{}, removeListener:()=>{}, hasListener:()=>false } }
      Object.defineProperty(chrome.storage, 'managed', { get: () => noop, configurable: true, enumerable: true })
    } catch {}
  }

  // chrome.storage.session — volatile in-memory
  if (!chrome.storage.session) {
    const mem = Object.create(null), ls = []
    const sessionStore = {
      get: (k, cb) => { let r; if (!k) r = Object.assign({}, mem); else if (typeof k === 'string') r = { [k]: mem[k] }; else if (Array.isArray(k)) r = k.reduce((o,x)=>(o[x]=mem[x],o),{}); else r = Object.keys(k).reduce((o,x)=>(o[x]=mem[x]!==undefined?mem[x]:k[x],o),{}); if(cb) cb(r); return Promise.resolve(r) },
      set: (v, cb) => { const ch={}; Object.keys(v).forEach(x=>{ch[x]={oldValue:mem[x],newValue:v[x]};mem[x]=v[x]}); ls.forEach(f=>f(ch,'session')); if(cb) cb(); return Promise.resolve() },
      remove: (k,cb) => { (Array.isArray(k)?k:[k]).forEach(x=>delete mem[x]); if(cb) cb(); return Promise.resolve() },
      clear: (cb) => { Object.keys(mem).forEach(x=>delete mem[x]); if(cb) cb(); return Promise.resolve() },
      onChanged: { addListener: f=>ls.push(f), removeListener: f=>{const i=ls.indexOf(f);if(i>-1)ls.splice(i,1)}, hasListener: f=>ls.includes(f) }
    }
    try { Object.defineProperty(chrome.storage, 'session', { get: ()=>sessionStore, configurable:true, enumerable:true }) } catch {}
  }

  // chrome.scripting polyfill (MV3 → MV2)
  if (!chrome.scripting && chrome.tabs) {
    try {
      chrome.scripting = {
        executeScript: ({target, func, files, args}) => { const id=target&&target.tabId; if(func){const code='('+func.toString()+')('+(args||[]).map(JSON.stringify).join(',')+')'; return new Promise((rs,rj)=>chrome.tabs.executeScript(id,{code},r=>chrome.runtime.lastError?rj(chrome.runtime.lastError):rs([{result:r&&r[0]}])))} if(files) return Promise.all(files.map(f=>new Promise(rs=>chrome.tabs.executeScript(id,{file:f},()=>rs())))); return Promise.resolve([]) },
        insertCSS: ({target,css,files}) => { const id=target&&target.tabId; if(css) return new Promise(rs=>chrome.tabs.insertCSS(id,{code:css},()=>rs())); if(files) return Promise.all(files.map(f=>new Promise(rs=>chrome.tabs.insertCSS(id,{file:f},()=>rs())))); return Promise.resolve() },
        removeCSS: () => Promise.resolve()
      }
    } catch {}
  }

  // chrome.action ↔ chrome.browserAction
  if (chrome.action && !chrome.browserAction) { try { chrome.browserAction = chrome.action } catch {} }
  if (chrome.browserAction && !chrome.action) { try { chrome.action = chrome.browserAction } catch {} }
})()
