const list       = document.getElementById('ext-list')
const installing = document.getElementById('installing')
const toast      = document.getElementById('toast')

// Actions → document.title (intercepté par page-title-updated dans app.js)
document.getElementById('btn-cws').addEventListener('click', () => {
  document.title = 'divo-ext-action:open-cws'
})

function showToast(msg, type = 'ok') {
  toast.textContent = msg
  toast.className = 'toast ' + type
  toast.style.display = 'block'
  setTimeout(() => { toast.style.display = 'none' }, 3000)
}

function renderExt(ext) {
  const card = document.createElement('div')
  card.className = 'ext-card'
  card.dataset.id = ext.id

  const iconHtml = ext.iconPath
    ? `<img class="ext-icon" src="divo://ext-icon/${ext.id}/${ext.iconPath.replace(/\\/g, '/')}" alt="">`
    : `<div class="ext-icon-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/></svg></div>`

  card.innerHTML = `
    ${iconHtml}
    <div class="ext-info">
      <div class="ext-name">${ext.name}</div>
      <div class="ext-version">v${ext.version}</div>
      ${ext.description ? `<div class="ext-desc">${ext.description}</div>` : ''}
    </div>
    <div class="ext-actions">
      <label class="toggle" title="${ext.enabled ? 'Désactiver' : 'Activer'}">
        <input type="checkbox" ${ext.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <button class="remove-btn">Supprimer</button>
    </div>
  `

  card.querySelector('input[type=checkbox]').addEventListener('change', function() {
    document.title = 'divo-ext-action:toggle:' + ext.id + ':' + this.checked
  })

  card.querySelector('.remove-btn').addEventListener('click', () => {
    if (!confirm(`Supprimer "${ext.name}" ?`)) return
    document.title = 'divo-ext-action:remove:' + ext.id
    card.remove()
    if (!list.querySelector('.ext-card')) list.innerHTML = '<div class="empty">Aucune extension installée</div>'
  })

  return card
}

function loadExtensions(exts) {
  list.innerHTML = ''
  if (!exts || !exts.length) {
    list.innerHTML = '<div class="empty">Aucune extension installée</div>'
    return
  }
  exts.forEach(e => list.appendChild(renderExt(e)))
}

// Exposé globalement — appelé via executeJavaScript depuis app.js
window.__divoRefresh = function(exts) {
  installing.classList.remove('active')
  loadExtensions(exts)
}

window.__divoToast = function(msg, type) {
  showToast(msg, type)
}

// Chargement initial depuis les données injectées
loadExtensions(window.__divoExts || [])
