(function () {
  const url = new URLSearchParams(location.search).get('url') || ''

  const webview   = document.getElementById('peek-webview')
  const titleEl   = document.getElementById('tb-title')
  const faviconEl = document.getElementById('tb-favicon')

  titleEl.textContent = (() => { try { return new URL(url).hostname } catch { return url } })()
  webview.src = url

  webview.addEventListener('page-title-updated', e => {
    if (e.title) titleEl.textContent = e.title
  })
  webview.addEventListener('page-favicon-updated', e => {
    if (e.favicons && e.favicons[0]) {
      faviconEl.src = e.favicons[0]
      faviconEl.style.display = ''
    }
  })
  // La page popup s'est fermée elle-même (window.close(), ex: fin de pub ou flux OAuth)
  webview.addEventListener('close', () => window.peekBridge.close())

  document.getElementById('btn-promote').addEventListener('click', () => {
    let current = url
    try { current = webview.getURL() || url } catch {}
    window.peekBridge.promote(current)
  })
  document.getElementById('btn-close').addEventListener('click', () => window.peekBridge.close())
})()
