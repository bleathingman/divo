// Communique les changements au renderer principal via document.title
function syncSettings() {
  const s = {
    searchEngine: document.getElementById('search-engine').value,
    homepage:     document.getElementById('homepage').value,
    saveSession:  document.getElementById('save-session').value,
    autoArchive:  document.getElementById('auto-archive').value,
  }
  document.title = 'divo-settings:' + JSON.stringify(s)
}

document.getElementById('search-engine').addEventListener('change', syncSettings)
document.getElementById('homepage').addEventListener('change', syncSettings)
document.getElementById('save-session').addEventListener('change', syncSettings)
document.getElementById('auto-archive').addEventListener('change', syncSettings)
document.getElementById('adblock-toggle').addEventListener('change', function() {
  document.title = 'divo-action:adblock:' + this.checked
})
const themeSelect = document.getElementById('theme-select')
themeSelect.value = document.documentElement.getAttribute('data-theme') || 'dark'
themeSelect.addEventListener('change', function() {
  document.title = 'divo-action:theme:' + this.value
  document.documentElement.setAttribute('data-theme', this.value)
})
const layoutSelect = document.getElementById('layout-select')
layoutSelect.addEventListener('change', function() {
  document.title = 'divo-action:layout:' + this.value
})
const dlDisplay = document.getElementById('download-path-display')
const dlPath = document.querySelector('meta[name="divo-dl-path"]')?.content
if (dlDisplay && dlPath) dlDisplay.textContent = dlPath
document.getElementById('btn-pick-download').addEventListener('click', function() {
  document.title = 'divo-action:pick-download-path:' + Date.now()
})
document.getElementById('web-dark-toggle').addEventListener('change', function() {
  document.title = 'divo-action:web-dark:' + this.checked
})
document.getElementById('https-upgrade-toggle').addEventListener('change', function() {
  document.title = 'divo-action:https-upgrade:' + this.checked
})
document.getElementById('default-browser-btn').addEventListener('click', function() {
  document.title = 'divo-settings-action:set-default-browser'
})
document.getElementById('btn-open-extensions').addEventListener('click', function() {
  document.title = 'divo-settings-action:open-extensions'
})
document.getElementById('update-action-btn').addEventListener('click', function() {
  if (this.dataset.state === 'available') {
    document.title = 'divo-settings-action:install-update'
  } else {
    document.title = 'divo-settings-action:check-update:' + Date.now()
  }
})

;(function() {
  document.getElementById('btn-switch-profile').addEventListener('click', function() {
    document.title = 'divo-settings-action:switch-profile'
  })
  document.getElementById('btn-export-profile').addEventListener('click', function() {
    document.title = 'divo-settings-action:export-profile'
  })
  document.getElementById('btn-import-profile').addEventListener('click', function() {
    document.title = 'divo-settings-action:import-profile'
  })

  let clicks = 0, timer = null
  document.getElementById('secret-trigger').addEventListener('click', () => {
    clicks++
    clearTimeout(timer)
    timer = setTimeout(() => { clicks = 0 }, 800)
    if (clicks >= 5) { clicks = 0; document.title = 'divo-settings-action:open-secret' }
  })
})()
