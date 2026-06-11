const { contextBridge, ipcRenderer, webFrame } = require('electron')

// <browser-action-list> / <button is="browser-action"> — icône et popup des
// extensions (uBlock Origin) dans la barre d'outils.
// Code repris (et inliné) de electron-chrome-extensions/dist/cjs/browser-action.js :
// le require sandboxé d'Electron dans le preload ne sait charger que le module
// "electron" (et quelques modules natifs), pas les paquets npm — d'où l'inlining.
try {
  ;(function injectBrowserAction() {
    const actionMap = new Map()
    const observerCounts = new Map()
    const internalEmitter = process
    const invoke = (name, partition, ...args) => ipcRenderer.invoke('crx-msg-remote', partition, name, ...args)

    const __browserAction__ = {
      addEventListener(name, listener) {
        internalEmitter.addListener(`-actions-${name}`, listener)
      },
      removeEventListener(name, listener) {
        internalEmitter.removeListener(`-actions-${name}`, listener)
      },
      getAction(extensionId) {
        return actionMap.get(extensionId)
      },
      async getState(partition) {
        const state = await invoke('browserAction.getState', partition)
        for (const action of state.actions) actionMap.set(action.id, action)
        queueMicrotask(() => internalEmitter.emit('-actions-update', state))
        return state
      },
      activate: (partition, details) => invoke('browserAction.activate', partition, details),
      addObserver(partition) {
        let count = observerCounts.has(partition) ? observerCounts.get(partition) : 0
        count = count + 1
        observerCounts.set(partition, count)
        if (count === 1) invoke('browserAction.addObserver', partition)
      },
      removeObserver(partition) {
        let count = observerCounts.has(partition) ? observerCounts.get(partition) : 0
        count = Math.max(count - 1, 0)
        observerCounts.set(partition, count)
        if (count === 0) {
          invoke('browserAction.removeObserver', partition)
          observerCounts.delete(partition)
        }
      }
    }

    ipcRenderer.on('browserAction.update', () => {
      for (const partition of observerCounts.keys()) __browserAction__.getState(partition)
    })

    function mainWorldScript() {
      const DEFAULT_PARTITION = '_self'
      const browserAction = globalThis.browserAction || __browserAction__

      class BrowserActionElement extends HTMLButtonElement {
        get id() { return this.getAttribute('id') || '' }
        set id(id) { this.setAttribute('id', id) }
        get tab() {
          const tabId = parseInt(this.getAttribute('tab') || '', 10)
          return typeof tabId === 'number' && !isNaN(tabId) ? tabId : -1
        }
        set tab(tab) { this.setAttribute('tab', `${tab}`) }
        get partition() { return this.getAttribute('partition') }
        set partition(partition) {
          if (partition) this.setAttribute('partition', partition)
          else this.removeAttribute('partition')
        }
        get alignment() { return this.getAttribute('alignment') || '' }
        set alignment(alignment) { this.setAttribute('alignment', alignment) }
        static get observedAttributes() { return ['id', 'tab', 'partition', 'alignment'] }
        constructor() {
          super()
          this.addEventListener('click', this.onClick.bind(this))
          this.addEventListener('contextmenu', this.onContextMenu.bind(this))
        }
        connectedCallback() {
          if (this.isConnected) this.update()
        }
        disconnectedCallback() {
          if (this.updateId) {
            cancelAnimationFrame(this.updateId)
            this.updateId = void 0
          }
          if (this.pendingIcon) this.pendingIcon = void 0
        }
        attributeChangedCallback() {
          if (this.isConnected) this.update()
        }
        activate(event) {
          const rect = this.getBoundingClientRect()
          browserAction.activate(this.partition || DEFAULT_PARTITION, {
            eventType: event.type,
            extensionId: this.id,
            tabId: this.tab,
            alignment: this.alignment,
            anchorRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
          })
        }
        onClick(event) { this.activate(event) }
        onContextMenu(event) {
          event.stopImmediatePropagation()
          event.preventDefault()
          this.activate(event)
        }
        getBadge() {
          let badge = this.badge
          if (!badge) {
            this.badge = badge = document.createElement('div')
            badge.className = 'badge'
            badge.part = 'badge'
            this.appendChild(badge)
          }
          return badge
        }
        update() {
          if (this.updateId) return
          this.updateId = requestAnimationFrame(this.updateCallback.bind(this))
        }
        updateIcon(info) {
          const iconSize = 32
          const resizeType = 2
          const searchParams = new URLSearchParams({
            tabId: `${this.tab}`,
            partition: `${this.partition || DEFAULT_PARTITION}`
          })
          if (info.iconModified) searchParams.append('t', info.iconModified)
          const iconUrl = `crx://extension-icon/${this.id}/${iconSize}/${resizeType}?${searchParams.toString()}`
          const bgImage = `url(${iconUrl})`
          if (this.pendingIcon) {
            this.pendingIcon.onload = this.pendingIcon.onerror = () => {}
            this.pendingIcon = void 0
          }
          const img = this.pendingIcon = new Image()
          img.onerror = () => {
            if (this.isConnected) {
              this.classList.toggle('no-icon', true)
              if (this.title) this.dataset.letter = this.title.charAt(0)
              this.pendingIcon = void 0
            }
          }
          img.onload = () => {
            if (this.isConnected) {
              this.classList.toggle('no-icon', false)
              this.style.backgroundImage = bgImage
              this.pendingIcon = void 0
            }
          }
          img.src = iconUrl
        }
        updateCallback() {
          this.updateId = void 0
          const action = browserAction.getAction(this.id)
          const activeTabId = this.tab
          const tabInfo = activeTabId > -1 ? action.tabs[activeTabId] : {}
          const info = { ...tabInfo, ...action }
          this.title = typeof info.title === 'string' ? info.title : ''
          this.updateIcon(info)
          if (info.text) {
            const badge = this.getBadge()
            badge.textContent = info.text
            badge.style.color = '#fff'
            badge.style.backgroundColor = info.color
          } else if (this.badge) {
            this.badge.remove()
            this.badge = void 0
          }
        }
      }
      customElements.define('browser-action', BrowserActionElement, { extends: 'button' })

      class BrowserActionListElement extends HTMLElement {
        constructor() {
          super()
          this.observing = false
          this.fetchState = async () => {
            try {
              await browserAction.getState(this.partition || DEFAULT_PARTITION)
            } catch {
              console.error(`browser-action-list failed to update [tab: ${this.tab}, partition: '${this.partition}']`)
            }
          }
          this.update = (state) => {
            const tabId = typeof this.tab === 'number' && this.tab >= 0 ? this.tab : state.activeTabId || -1
            for (const action of state.actions) {
              let browserActionNode = this.shadowRoot?.querySelector(`[id=${action.id}]`)
              if (!browserActionNode) {
                const node = document.createElement('button', { is: 'browser-action' })
                node.id = action.id
                node.className = 'action'
                node.alignment = this.alignment
                node.part = 'action'
                browserActionNode = node
                this.shadowRoot?.appendChild(browserActionNode)
              }
              if (this.partition) browserActionNode.partition = this.partition
              if (this.alignment) browserActionNode.alignment = this.alignment
              browserActionNode.tab = tabId
            }
            const actionNodes = Array.from(this.shadowRoot?.querySelectorAll('.action'))
            for (const actionNode of actionNodes) {
              if (!state.actions.some((action) => action.id === actionNode.id)) actionNode.remove()
            }
          }
          const shadowRoot = this.attachShadow({ mode: 'open' })
          const style = document.createElement('style')
          style.textContent = `
:host {
  display: flex;
  flex-direction: row;
  gap: 5px;
}

.action {
  width: 28px;
  height: 28px;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 70%;
  border: none;
  border-radius: 4px;
  padding: 0;
  position: relative;
  outline: none;
}

.action:hover {
  background-color: var(--browser-action-hover-bg, rgba(255, 255, 255, 0.3));
}

.action.no-icon::after {
  content: attr(data-letter);
  text-transform: uppercase;
  font-size: .7rem;
  background-color: #757575;
  color: white;
  border-radius: 4px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80%;
  height: 80%;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.badge {
  box-shadow: 0px 0px 1px 1px var(--browser-action-badge-outline, #444);
  box-sizing: border-box;
  max-width: 100%;
  height: 12px;
  padding: 0 2px;
  border-radius: 2px;
  position: absolute;
  bottom: 1px;
  right: 0;
  pointer-events: none;
  line-height: 1.5;
  font-size: 9px;
  font-weight: 400;
  overflow: hidden;
  white-space: nowrap;
}`
          shadowRoot.appendChild(style)
        }
        get tab() {
          const tabId = parseInt(this.getAttribute('tab') || '', 10)
          return typeof tabId === 'number' && !isNaN(tabId) ? tabId : null
        }
        set tab(tab) {
          if (typeof tab === 'number') this.setAttribute('tab', `${tab}`)
          else this.removeAttribute('tab')
        }
        get partition() { return this.getAttribute('partition') }
        set partition(partition) {
          if (partition) this.setAttribute('partition', partition)
          else this.removeAttribute('partition')
        }
        get alignment() { return this.getAttribute('alignment') || '' }
        set alignment(alignment) { this.setAttribute('alignment', alignment) }
        static get observedAttributes() { return ['tab', 'partition', 'alignment'] }
        connectedCallback() {
          if (this.isConnected) {
            this.startObserving()
            this.fetchState()
          }
        }
        disconnectedCallback() { this.stopObserving() }
        attributeChangedCallback(name, oldValue, newValue) {
          if (oldValue === newValue) return
          if (this.isConnected) this.fetchState()
        }
        startObserving() {
          if (this.observing) return
          browserAction.addEventListener('update', this.update)
          browserAction.addObserver(this.partition || DEFAULT_PARTITION)
          this.observing = true
        }
        stopObserving() {
          if (!this.observing) return
          browserAction.removeEventListener('update', this.update)
          browserAction.removeObserver(this.partition || DEFAULT_PARTITION)
          this.observing = false
        }
      }
      customElements.define('browser-action-list', BrowserActionListElement)
    }

    if (process.contextIsolated) {
      contextBridge.exposeInMainWorld('browserAction', __browserAction__)
      if ('executeInMainWorld' in contextBridge) {
        contextBridge.executeInMainWorld({ func: mainWorldScript })
      } else {
        webFrame.executeJavaScript(`(${mainWorldScript}());`)
      }
    } else {
      mainWorldScript()
    }
  })()
} catch (e) { console.error('[ext] injectBrowserAction failed:', e) }

// Chargé synchronement avant que app.js tourne — élimine tout problème de timing
const __divoInitState     = ipcRenderer.sendSync('state-load-sync')
const __divoInitHistory   = ipcRenderer.sendSync('history-load-sync')
const __divoInitSessions  = ipcRenderer.sendSync('sessions-load-sync')
const __divoInitPasswords = ipcRenderer.sendSync('passwords-load-sync')

contextBridge.exposeInMainWorld('bridge', {
  minimize:             () => ipcRenderer.send('window-minimize'),
  maximize:             () => ipcRenderer.send('window-maximize'),
  close:                () => ipcRenderer.send('window-close'),
  newtabUrl:            'divo://newtab',
  settingsUrl:          'divo://settings',
  toggleFullscreen:     () => ipcRenderer.send('toggle-fullscreen'),
  focusWebview:         (id) => ipcRenderer.send('focus-webview', id),
  openFile:             (p)  => ipcRenderer.send('open-file', p),
  openDlFolder:         ()   => ipcRenderer.send('open-dl-folder'),
  answerPermission:     (key, granted) => ipcRenderer.send('answer-permission', key, granted),
  onDlStart:            (cb) => ipcRenderer.on('dl-start',          (_, d) => cb(d)),
  onDlUpdate:           (cb) => ipcRenderer.on('dl-update',         (_, d) => cb(d)),
  onDlDone:             (cb) => ipcRenderer.on('dl-done',           (_, d) => cb(d)),
  onOpenNewTab:         (cb) => ipcRenderer.on('open-new-tab',      (_, u) => cb(u)),
  onFullscreenChange:   (cb) => ipcRenderer.on('fullscreen-change', (_, v) => cb(v)),
  onPermissionRequest:  (cb) => ipcRenderer.on('permission-request',(_, d) => cb(d)),
  adblockStatus: ()        => ipcRenderer.invoke('adblock-status'),
  adblockToggle: (v)       => ipcRenderer.invoke('adblock-toggle', v),
  importChromeBookmarks: () => ipcRenderer.invoke('import-chrome-bookmarks'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  importBookmarksHtml:   () => ipcRenderer.invoke('import-bookmarks-html'),
  getDownloadPath:    () => ipcRenderer.invoke('get-download-path'),
  pickDownloadPath:   () => ipcRenderer.invoke('pick-download-path'),
  webDarkModeStatus: () => ipcRenderer.invoke('web-dark-mode-status'),
  webDarkModeToggle: (v) => ipcRenderer.invoke('web-dark-mode-toggle', v),
  httpsUpgradeStatus: () => ipcRenderer.invoke('https-upgrade-status'),
  httpsUpgradeToggle: (v) => ipcRenderer.invoke('https-upgrade-toggle', v),
  onWebviewShortcut:    (cb) => ipcRenderer.on('webview-shortcut',  (_, d) => cb(d)),
  onUpdateAvailable:    (cb) => ipcRenderer.on('update-available',    (_, d) => cb(d)),
  onUpdateProgress:     (cb) => ipcRenderer.on('update-progress',     (_, p) => cb(p)),
  installUpdate:        ()    => ipcRenderer.invoke('install-update'),
  getUpdateStatus:      ()    => ipcRenderer.invoke('get-update-status'),
  checkUpdateNow:       ()    => ipcRenderer.invoke('check-update-now'),
  isDefaultBrowser:     ()    => ipcRenderer.invoke('is-default-browser'),
  setDefaultBrowser:    ()    => ipcRenderer.invoke('set-default-browser'),
  onNotDefaultBrowser:  (cb)  => ipcRenderer.on('not-default-browser', () => cb()),
  getUserExtensions:    ()    => ipcRenderer.invoke('get-user-extensions'),
  installExtById:       (id)  => ipcRenderer.invoke('install-extension-by-id', id),
  removeUserExtension:  (id)  => ipcRenderer.invoke('remove-user-extension', id),
  toggleUserExtension:  (id, enabled) => ipcRenderer.invoke('toggle-user-extension', id, enabled),
  onExtensionInstalled: (cb)  => ipcRenderer.on('extension-installed', (_, d) => cb(d)),
  extTabActivated:      (id)  => ipcRenderer.send('ext-tab-activated', id),
  extCreateTabResult:   (requestId, webContentsId) => ipcRenderer.send('ext-create-tab-result', { requestId, webContentsId }),
  onExtCreateTab:       (cb)  => ipcRenderer.on('ext-create-tab', (_, d) => cb(d)),
  onExtRemoveTab:       (cb)  => ipcRenderer.on('ext-remove-tab', (_, id) => cb(id)),
  onExtSelectTab:       (cb)  => ipcRenderer.on('ext-select-tab', (_, id) => cb(id)),
  initState:    __divoInitState,
  initHistory:  __divoInitHistory,
  historySave:  (h) => ipcRenderer.invoke('history-save', h),
  initSessions:   __divoInitSessions,
  sessionsSave:   (s) => ipcRenderer.invoke('sessions-save', s),
  initPasswords:  __divoInitPasswords,
  passwordsSave:  (p) => ipcRenderer.invoke('passwords-save', p),
  captureTab:          (id) => ipcRenderer.invoke('capture-tab', id),
  stateSave: (s)   => ipcRenderer.invoke('state-save', s),
  rendererLog: (msg) => ipcRenderer.send('renderer-log', msg),
  exportProfile:      () => ipcRenderer.invoke('profile-export'),
  importProfile:      () => ipcRenderer.invoke('profile-import'),
  getActiveProfile:   () => ipcRenderer.invoke('get-active-profile'),
  getAllProfiles:      () => ipcRenderer.invoke('get-all-profiles'),
  switchProfile:      () => ipcRenderer.invoke('switch-profile'),
  editActiveProfile:  (d) => ipcRenderer.invoke('edit-active-profile', d),
})