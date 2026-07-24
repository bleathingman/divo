# Proposition : support du Chrome Web Store dans Divo

> **Statut :** proposition / discussion — pas d'implémentation dans ce PR.
> **Auteur :** @turpez
> **Cible :** v1.1 / v2

## Contexte

Divo est un navigateur Electron. La fonctionnalité « extensions Chrome non signées » a existé jusqu'à `v1.0.10` puis a été retirée (commit `9417edc`).

Ce document évalue la faisabilité de **réintroduire un support extensions, cette fois avec accès au Chrome Web Store**, et liste les contraintes techniques et de sécurité.

## TL;DR

- ✅ **C'est faisable** — Electron embarque déjà un sous-système d'extensions Chromium.
- ⚠️ **Mais pas trivial** — Electron n'implémente qu'un sous-ensemble des APIs `chrome.*`, et Google bloque activement le bouton « Add to Chrome » pour tout client qui n'est pas Chrome.
- 🛠️ **La bibliothèque de référence** est [`electron-chrome-web-store`](https://github.com/samuelmaddock/electron-chrome-web-store) (maintenue par Samuel Maddock, ex-Brave). Elle gère l'install, la mise à jour automatique et l'intégration UI.
- 🔒 **Sécurité** — réintroduire les extensions ré-ouvre directement les surfaces couvertes par les issues fermées #4 (`contextIsolation: false` sur popup), #11 (`allowFileAccess: true`) et indirectement #1 (extensions actives en mode privé). À considérer **avant** d'écrire la moindre ligne d'implémentation.

---

## 1. Ce qu'Electron sait faire nativement

Electron supporte un sous-ensemble du runtime d'extensions Chromium via `session.loadExtension(path, options)` :

```js
const ext = await session.defaultSession.loadExtension('/path/to/unpacked', {
  allowFileAccess: false,
})
```

**Ce qui fonctionne raisonnablement** (`MV2` et `MV3` partiels) :

- `chrome.runtime`, `chrome.storage`, `chrome.tabs` (en partie), `chrome.webRequest`, `chrome.cookies`, `chrome.i18n`, `chrome.contextMenus`, `chrome.notifications`.
- Content scripts, background pages (MV2), service workers (MV3).
- Action API (`chrome.action`) / browser action.
- Options page, popup, devtools panels.

**Ce qui ne fonctionne pas ou seulement partiellement** :

- `chrome.identity` (OAuth Chrome) — pas implémenté → Bitwarden, Google Drive, GitHub login depuis l'extension cassent.
- `chrome.sync` — pas de synchronisation cloud.
- `chrome.gcm`, `chrome.fcm` — pas de push.
- `chrome.management`, `chrome.webstorePrivate` — APIs internes du Web Store, absentes.
- Plusieurs APIs Enterprise / Policy.
- DRM Widevine pour certaines extensions de streaming.
- `chrome.sidePanel` (Chrome 114+) — partiel.

→ **Une extension sur deux a 80–95 % de ses features ; certaines ne marcheront pas du tout.** Brave et Vivaldi vivent avec ces limitations depuis des années en patchant Chromium ; Electron, lui, suit le runtime upstream.

[Documentation officielle Electron extensions](https://www.electronjs.org/docs/latest/api/extensions)

## 2. Options d'implémentation

### Option A — `electron-chrome-web-store` (recommandée)

Bibliothèque qui :

- Intercepte les requêtes vers `chrome.google.com/webstore` et `chromewebstore.google.com`.
- Fournit l'implémentation de `chrome.webstorePrivate.beginInstallWithManifest3` côté main pour que le bouton « Add to Chrome » fonctionne **depuis l'intérieur du Web Store**.
- Télécharge la `.crx`, vérifie sa signature, l'unpack dans `userData/Extensions/<id>`.
- Gère les mises à jour automatiques via le manifeste d'update Chromium.
- Optionnel : combine avec [`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions) qui fournit la **barre d'extension** (popups, badges, click handlers) compatible avec l'API native de Chrome.

**Setup minimal :**

```js
const { installChromeWebStore } = require('electron-chrome-web-store')

app.whenReady().then(async () => {
  await installChromeWebStore({
    session: session.defaultSession,
    extensionsPath: path.join(app.getPath('userData'), 'extensions'),
    // sécurité : on garde la main sur ce qui passe
    beforeInstall: async (details) => {
      const ok = await confirmInstallDialog(details)
      return { action: ok ? 'allow' : 'deny' }
    },
  })
})
```

**Pros**
- Bouton « Add to Chrome » fonctionne directement, UX native.
- Auto-update.
- Maintenu par un ex-dev Brave.
- Compatible avec l'API extensions native d'Electron.

**Cons**
- ~3 dépendances supplémentaires, dont une qui touche `webRequest` côté session par défaut.
- Limité aux APIs supportées par Electron (cf. §1).
- License Apache-2.0 (compatible).

### Option B — installation par .crx téléchargé manuellement

L'utilisateur télécharge un `.crx` depuis le Web Store via un site tiers (`crxextractor.com`, `crxdl.com`, etc.), puis Divo l'installe via un dialog.

```js
ipcMain.handle('install-crx', async (_, crxPath) => {
  // 1. parse .crx → extrait pubkey + payload zip
  // 2. vérifie la signature (sinon refuse)
  // 3. unzip dans userData/extensions/<id>
  // 4. session.loadExtension(unpackedPath, { allowFileAccess: false })
})
```

**Pros**
- Pas de dépendance externe ni hook sur le Web Store.
- Pas de risque de casser quand Google change l'API du store.

**Cons**
- UX dégradée (l'utilisateur sort du navigateur pour trouver la `.crx`).
- Pas d'auto-update.
- Vecteur de phishing : sites tiers de `.crx` parfois douteux.

### Option C — extensions « unpacked » uniquement (ancien comportement)

Re-revenir à `v1.0.9`, sans Web Store. L'utilisateur clone un dépôt GitHub d'extension et la pointe via un dialog.

**Pros**
- Le plus simple, déjà testé dans le code retiré.
- Aucun risque supply-chain via store.

**Cons**
- UX réservée aux développeurs.

### Option D — fork de Brave / Yandex (hors périmètre)

Demanderait de switcher Electron → un runtime Chromium custom. Hors périmètre d'un projet Electron.

## 3. Recommandation

**Option A en mode opt-in, avec garde-fous stricts.**

Étapes :

1. Ajouter un toggle « Extensions Chrome (expérimental) » dans Paramètres, **désactivé par défaut**.
2. À l'activation, afficher un dialog d'avertissement clair :
   > « Les extensions Chrome non signées peuvent voir et modifier le contenu de toutes les pages que vous visitez, y compris vos mots de passe et messages privés. N'installez que des extensions que vous reconnaissez. »
3. Intégrer `electron-chrome-web-store` avec un `beforeInstall` qui ouvre un dialog listant les `permissions` du manifest.
4. Ajouter une page `divo://extensions` listant les extensions installées, leurs permissions, et un bouton « Retirer ».
5. Refuser le chargement d'extensions sur les pages `divo://*` (whitelist d'origines).
6. Désactiver les extensions en navigation privée par défaut (toggle par-extension dans les paramètres).

## 4. Contraintes de sécurité — issues à régler avant

Toute réintroduction des extensions doit traiter ces points (certains étaient déjà des findings de l'audit) :

| Findings antérieurs | Cible |
|---|---|
| Popup d'extension `contextIsolation: false` (anciennement #4) | Doit être `true` |
| Extensions chargées avec `allowFileAccess: true` (anciennement #11) | Doit être `false` par défaut, opt-in par-extension |
| Extensions actives en navigation privée | Désactivées par défaut, toggle explicite |
| Aucun affichage des permissions du manifest avant install | Dialog obligatoire avec liste lisible |
| Pas de désinstallation propre | Bouton « Retirer » + cleanup de `userData/extensions/<id>` |

À ajouter spécifiquement pour le Web Store :

- **Vérification de signature CRX3** : la lib le fait, mais à vérifier dans une revue.
- **Origine `chrome.google.com`** : ne *jamais* exposer `chrome.webstorePrivate` sur d'autres origines.
- **CSP** des pages internes (#23) : autoriser uniquement `chrome-extension:` dans `frame-src` si on intègre des popups.
- **Quota de stockage** par extension (sinon une extension cassée remplit le disque).

## 5. Effort estimé

| Tâche | Effort |
|---|---|
| Intégration `electron-chrome-web-store` + UI minimale | 2-3 jours |
| Dialog de permissions à l'install | 0,5 jour |
| Page `divo://extensions` (liste + retrait + toggle privé / file access) | 1 jour |
| Gestion des popups d'extension dans la sidebar | 1-2 jours |
| Tests sur un échantillon d'extensions (uBlock Origin, Bitwarden, Dark Reader, LanguageTool) | 1-2 jours |
| Documentation | 0,5 jour |
| **Total** | **~1 semaine de dev concentré** |

À tester en priorité :

- **uBlock Origin** — bonne référence, devrait fonctionner.
- **Bitwarden** — utilisera `chrome.identity` → cassera la connexion via Google/Apple, mais le login email/password doit marcher.
- **Dark Reader** — `chrome.action` + content scripts → devrait fonctionner.
- **LanguageTool** — `chrome.storage` + content scripts → devrait fonctionner.
- **Google Translate** — `chrome.identity` → cassera.

## 6. Décision à prendre

Trois questions à trancher avant l'implémentation :

1. **Veut-on ouvrir le Web Store complet** (Option A) ou se limiter à un magasin curé maison (subset d'extensions testées) ?
2. **Veut-on faire vivre cette feature dans le navigateur principal** ou dans une build « developer » séparée, vu les limitations API ?
3. **Combien de temps est-on prêt à investir** dans la maintenance quand Electron casse une API chrome.* ou que Google change le protocole du Web Store ?

Si la réponse aux trois est « oui, à fond, longtemps », l'Option A est claire. Sinon, l'Option C (unpacked seulement) reste un compromis honnête : on garde la feature « extensions » sans s'engager dans la course Chromium.

## 7. Liens

- [electron-chrome-web-store](https://github.com/samuelmaddock/electron-chrome-web-store)
- [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell)
- [Electron Extensions API](https://www.electronjs.org/docs/latest/api/extensions)
- [Chrome Extensions API reference](https://developer.chrome.com/docs/extensions/reference/api)
- Historique : commit `9417edc` (retrait des extensions dans Divo)
