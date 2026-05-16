const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const ENGINES = {
  google:     'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing:       'https://www.bing.com/search?q=',
  qwant:      'https://www.qwant.com/?q=',
  brave:      'https://search.brave.com/search?q=',
}

function update() {
  const now = new Date(), h = now.getHours()
  document.getElementById('time').textContent = String(h).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  document.getElementById('date').textContent = DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()]
  document.getElementById('greeting').textContent = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'
}
update()
const s = new Date().getSeconds()
setTimeout(() => { update(); setInterval(update, 60000) }, (60 - s) * 1000)

document.getElementById('search').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const val = e.target.value.trim()
  if (!val) return
  if (val.startsWith('http://') || val.startsWith('https://')) { window.location.href = val; return }
  if (/^[\w-]+\.[\w.-]+/.test(val) && !val.includes(' ')) { window.location.href = 'https://' + val; return }
  const base = ENGINES[window.__divoEngine] || ENGINES.google
  window.location.href = base + encodeURIComponent(val)
})

document.getElementById('btn-bitwarden').addEventListener('click', () => {
  window.location.href = 'https://vault.bitwarden.com/#/login'
})

document.getElementById('btn-settings').addEventListener('click', () => {
  window.location.href = 'divo://settings'
})

document.getElementById('btn-dark').addEventListener('click', () => {
  window.location.href = 'divo://settings'
})
