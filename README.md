# Divo

Navigateur minimaliste pour Windows et Linux, construit avec Electron.

## Téléchargement

→ [Dernière version](../../releases/latest)

### Windows

Télécharger `Divo Setup x.x.x.exe` (installeur) ou `Divo x.x.x.exe` (portable).

> **Note :** Divo n'est pas encore signé avec un certificat EV — Windows SmartScreen peut afficher un avertissement. Vérifiez l'intégrité du fichier avant de l'exécuter (voir [Vérifier l'intégrité](#vérifier-lintégrité)).

### Linux

Télécharger `Divo-x.x.x.AppImage`, rendre exécutable et lancer :

```bash
chmod +x Divo-*.AppImage && ./Divo-*.AppImage
```

<details>
<summary>Dépendances manquantes ?</summary>

```bash
# Debian / Ubuntu
sudo apt install libgtk-3-0 libnss3 libxss1 libxtst6 xdg-utils

# Fedora
sudo dnf install gtk3 nss libXScrnSaver libXtst xdg-utils

# Arch
sudo pacman -S gtk3 nss libxss libxtst xdg-utils
```
</details>

---

## Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| **Spaces** | Groupes d'onglets avec favoris et historique isolés |
| **Essentials** | Onglets épinglés accessibles depuis tous les spaces |
| **Favoris** | Bookmarks par space, import Chrome / Edge / Firefox |
| **Auto-archive** | Onglets inactifs archivés automatiquement |
| **Déchargement d'onglets** | Libère la RAM, position de scroll sauvegardée |
| **Bloqueur de pubs** | Moteur intégré : ~280 000 domaines + filtres cosmétiques EasyList |
| **Navigation privée** | Session isolée, aucun historique conservé |
| **Mode sombre web** | Thème sombre appliqué automatiquement sur tous les sites |
| **Boutons souris** | Boutons 4 / 5 pour reculer / avancer |
| **Navigateur par défaut** | S'enregistre pour HTTP, HTTPS et fichiers `.html` |

## Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl+T` | Nouvel onglet |
| `Ctrl+W` | Fermer l'onglet |
| `Ctrl+Shift+T` | Restaurer le dernier onglet fermé |
| `Ctrl+Shift+N` | Navigation privée |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl+L` | Focus barre URL |
| `Ctrl+F` | Recherche dans la page |
| `Ctrl+H` | Historique |
| `Ctrl+B` | Afficher / masquer la sidebar |
| `Ctrl+D` | Épingler en Essential |
| `Ctrl+R` | Recharger |
| `Alt+←` / `Alt+→` | Reculer / avancer |
| `F11` | Plein écran |

---

## Vérifier l'intégrité

Chaque release publie des checksums SHA256 et une attestation de provenance SLSA signée par GitHub.

**Windows**
```powershell
# Calculer le hash
Get-FileHash "Divo Setup x.x.x.exe" -Algorithm SHA256

# Comparer avec SHA256SUMS-windows.txt publié sur la Release
```

**Linux**
```bash
# Vérification automatique
sha256sum -c SHA256SUMS-linux.txt
```

**Attestation de provenance** (nécessite [gh CLI](https://cli.github.com))
```bash
gh attestation verify Divo-Setup-x.x.x.exe -R bleathingman/divo
gh attestation verify Divo-x.x.x.AppImage   -R bleathingman/divo
```

---

## Build

Prérequis : Node.js 20+

```bash
npm ci

# Windows
npm run build

# Linux
npm run build:linux
```

> Sous Windows, le Mode Développeur doit être activé pour les liens symboliques npm.
