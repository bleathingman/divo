const EMOJIS  = ['🏠','💼','🎬','📚','🎮','🎵','🌍','🚀','💡','🔥','⚡','🌟','❤️','🎯','🏆','💻','📱','✈️','🌊','🎧','🎨','🌈','🍕','☕','🌙','🦊','🐱','🌸']
const COLORS  = ['#0a84ff','#34c759','#ff453a','#ff9f0a','#bf5af2','#ff6b35','#64d2ff','#636366']
const PRESETS = [
  { key:'video',   emoji:'🎬', name:'Vidéo',       desc:'YouTube, Netflix, Prime Video, Anime-Sama', color:'#ff453a' },
  { key:'work',    emoji:'💼', name:'Travail',      desc:'GitHub, Claude, ChatGPT, Google',          color:'#0a84ff' },
  { key:'lecture', emoji:'📚', name:'Lecture',      desc:'ScanManga, Mangadex',                      color:'#34c759' },
  { key:'gaming',  emoji:'🎮', name:'Gaming',       desc:'Steam, Discord, Twitch',                   color:'#bf5af2' },
  { key:null,      emoji:'✏️', name:'Personnalisé', desc:'Commencer avec un profil vide',            color:'#636366' },
]

let profiles    = []
let isFirstRun  = false
let editingId   = null
let deleteTargetId = null
let selEmoji    = EMOJIS[0]
let selColor    = COLORS[0]

async function init() {
  const d = await window.profileBridge.getData()
  profiles   = d.profiles
  isFirstRun = d.isFirstRun

  document.getElementById('btn-close').addEventListener('click', () => window.profileBridge.close())
  document.getElementById('btn-new').addEventListener('click', () => openForm(null))
  document.getElementById('form-back').addEventListener('click', closeForm)
  document.getElementById('btn-cancel').addEventListener('click', closeForm)
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirm)
  document.getElementById('confirm-delete').addEventListener('click', confirmDelete)

  buildEmojiGrid()
  buildColorRow()

  const nameInput = document.getElementById('name-input')
  nameInput.addEventListener('input', () => {
    document.getElementById('btn-ok').disabled = !nameInput.value.trim()
  })
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-ok').click()
  })
  document.getElementById('btn-ok').addEventListener('click', submitForm)

  if (isFirstRun) {
    document.getElementById('main-title').textContent = 'Bienvenue sur Divo !'
    document.getElementById('main-sub').textContent   = 'Choisissez votre profil de départ'
    document.getElementById('footer').style.display   = 'none'
    renderPresets()
  } else {
    renderProfiles()
  }
}

function hexRgba(hex, a) {
  try {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
    return `rgba(${r},${g},${b},${a})`
  } catch { return hex }
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderProfiles() {
  const wrap = document.getElementById('list-wrap')
  wrap.innerHTML = ''
  for (const p of profiles) wrap.appendChild(makeCard(p))
}

function makeCard(p) {
  const card = document.createElement('div')
  card.className = 'profile-card'

  const bg = hexRgba(p.color || '#0a84ff', .18)
  let avatarInner
  if (p.image) {
    avatarInner = `<img src="${esc(p.image)}" alt="">`
  } else {
    avatarInner = esc(p.emoji || '🏠')
  }

  card.innerHTML = `
    <div class="avatar" style="background:${bg}">${avatarInner}</div>
    <div class="card-info">
      <div class="card-name">${esc(p.name)}</div>
    </div>
    <div class="card-actions">
      <button class="card-action-btn edit" title="Modifier" data-id="${esc(p.id)}">✎</button>
      ${profiles.length > 1 ? `<button class="card-action-btn del" title="Supprimer" data-id="${esc(p.id)}">✕</button>` : ''}
    </div>
    <div class="card-arrow">›</div>
  `

  // Click on card → select profile
  card.addEventListener('click', async e => {
    if (e.target.closest('.card-action-btn')) return
    card.style.opacity = '.4'
    card.style.pointerEvents = 'none'
    await window.profileBridge.select(p.id)
  })

  // Edit button
  const editBtn = card.querySelector('.edit')
  if (editBtn) {
    editBtn.addEventListener('click', e => { e.stopPropagation(); openForm(p) })
  }

  // Delete button
  const delBtn = card.querySelector('.del')
  if (delBtn) {
    delBtn.addEventListener('click', e => {
      e.stopPropagation()
      deleteTargetId = p.id
      document.getElementById('confirm-sub').textContent = `Le profil « ${p.name} » sera définitivement supprimé.`
      document.getElementById('confirm-overlay').classList.add('open')
    })
  }

  return card
}

function renderPresets() {
  const wrap = document.getElementById('list-wrap')
  wrap.innerHTML = ''
  for (const preset of PRESETS) {
    const card = document.createElement('div')
    card.className = 'profile-card'
    const bg = hexRgba(preset.color, .18)
    card.innerHTML = `
      <div class="avatar" style="background:${bg}">${preset.emoji}</div>
      <div class="card-info">
        <div class="card-name">${esc(preset.name)}</div>
        <div class="card-desc">${esc(preset.desc)}</div>
      </div>
      <div class="card-arrow">›</div>
    `
    card.addEventListener('click', async () => {
      if (preset.key === null) { openForm(null); return }
      card.style.opacity = '.4'; card.style.pointerEvents = 'none'
      await window.profileBridge.create({ name: preset.name, emoji: preset.emoji, color: preset.color, presetKey: preset.key })
    })
    wrap.appendChild(card)
  }
}

// ── Form ─────────────────────────────────────────────────────────────────────

function buildEmojiGrid() {
  const grid = document.getElementById('emoji-grid')
  for (const em of EMOJIS) {
    const btn = document.createElement('button')
    btn.className = 'emoji-btn' + (em === selEmoji ? ' on' : '')
    btn.textContent = em
    btn.addEventListener('click', () => {
      selEmoji = em
      document.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('on', b.textContent === em))
    })
    grid.appendChild(btn)
  }
}

function buildColorRow() {
  const row = document.getElementById('color-row')
  for (const c of COLORS) {
    const dot = document.createElement('div')
    dot.className = 'color-dot' + (c === selColor ? ' on' : '')
    dot.style.background = c
    dot.addEventListener('click', () => {
      selColor = c
      document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('on', d.style.background === c || d.style.backgroundColor === c))
    })
    row.appendChild(dot)
  }
}

function openForm(profile) {
  editingId = profile ? profile.id : null

  selEmoji = profile ? (profile.emoji || EMOJIS[0]) : EMOJIS[0]
  selColor = profile ? (profile.color || COLORS[0]) : COLORS[0]

  const nameInput = document.getElementById('name-input')
  nameInput.value = profile ? profile.name : ''

  document.getElementById('form-title').textContent = profile ? 'Modifier le profil' : 'Nouveau profil'
  document.getElementById('btn-ok').textContent = profile ? 'Enregistrer' : 'Créer'
  document.getElementById('btn-ok').disabled = profile ? false : true

  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('on', b.textContent === selEmoji))
  document.querySelectorAll('.color-dot').forEach(d => {
    const match = d.style.background === selColor || d.style.backgroundColor === selColor
    d.classList.toggle('on', match)
  })

  document.getElementById('form-panel').classList.add('open')
  setTimeout(() => nameInput.focus(), 240)
}

function closeForm() {
  document.getElementById('form-panel').classList.remove('open')
  editingId = null
}

async function submitForm() {
  const name = document.getElementById('name-input').value.trim()
  if (!name) return
  document.getElementById('btn-ok').disabled = true

  if (editingId) {
    await window.profileBridge.edit(editingId, { name, emoji: selEmoji, color: selColor })
    closeForm()
    const d = await window.profileBridge.getData()
    profiles = d.profiles
    renderProfiles()
  } else {
    await window.profileBridge.create({ name, emoji: selEmoji, color: selColor, presetKey: null })
  }
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function closeConfirm() {
  document.getElementById('confirm-overlay').classList.remove('open')
  deleteTargetId = null
}

async function confirmDelete() {
  if (!deleteTargetId) return
  const id = deleteTargetId
  closeConfirm()
  await window.profileBridge.del(id)
  const d = await window.profileBridge.getData()
  profiles = d.profiles
  renderProfiles()
}

init()
