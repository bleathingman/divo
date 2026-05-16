const list       = document.getElementById('ext-list')
const installing = document.getElementById('installing')
const toast      = document.getElementById('toast')

document.getElementById('btn-cws').addEventListener('click', e => {
  e.preventDefault()
  window.location.href = 'https://chromewebstore.google.com/'
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

  card.querySelector('input[type=checkbox]').addEventListener('change', async function() {
    const enabled = this.checked
    const res = await window.bridge.toggleUserExtension(ext.id, enabled)
    if (!res.ok) { this.checked = !enabled; showToast('Erreur lors du changement d\'état', 'err') }
  })

  card.querySelector('.remove-btn').addEventListener('click', async () => {
    if (!confirm(`Supprimer "${ext.name}" ?`)) return
    await window.bridge.removeUserExtension(ext.id)
    card.remove()
    if (!list.querySelector('.ext-card')) list.innerHTML = '<div class="empty">Aucune extension installée</div>'
  })

  return card
}

async function loadExtensions() {
  const exts = await window.bridge.getUserExtensions()
  list.innerHTML = ''
  if (!exts.length) {
    list.innerHTML = '<div class="empty">Aucune extension installée</div>'
    return
  }
  exts.forEach(e => list.appendChild(renderExt(e)))
}

// Notifié quand une extension vient d'être installée
window.bridge.onExtensionInstalled(({ name }) => {
  installing.classList.remove('active')
  showToast(`"${name}" installée avec succès`, 'ok')
  loadExtensions()
})

// Montrer le spinner si une installation est en cours (déclenché depuis la CWS)
window.addEventListener('message', e => {
  if (e.data === 'divo:installing') installing.classList.add('active')
})

loadExtensions()
