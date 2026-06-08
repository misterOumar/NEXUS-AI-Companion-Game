# NEXUS — AI Companion Game

**Games On Web 2026 — IA Edition**
Université de Rennes 1 · MIAGE

> Deux jeux immersifs où l'IA observe, apprend et s'adapte à ton comportement en temps réel.

**Jouer en ligne :** [https://nexus-ai-companion-game.vercel.app/](https://nexus-ai-companion-game.vercel.app/)

**Vidéo de démo :** [https://youtu.be/XanRjzyY9QE](https://youtu.be/XanRjzyY9QE)

---

## Les jeux

### NEURO MAZE — Labyrinthe Adaptatif

Navigue dans un labyrinthe procédural pendant que l'IA analyse ta progression.

- **IA adaptative** : si tu restes bloqué trop longtemps, ECHO ouvre un nouveau passage en cassant un mur
- **Drone de traque** : activé 30 secondes après le début, il te pourchasse via BFS. 3 captures = game over
- **Nœuds à hacker** : maintiens-toi 2s sur chaque nœud doré pour l'extraire
- **Détection de boucles** : ECHO détecte si tu tournes en rond (fenêtre glissante de 25 cellules) et te conseille
- **Minimap** : carte en bas à droite mise à jour en temps réel
- **ECHO** : compagnon IA qui commente ta progression et t'aide

**Contrôles :** WASD + souris | Shift = courir | ESC = pause | Tirer sur l'écran = verrouiller la souris

---

### NEXUS : INFILTRATION — Stealth & Gardes IA

Infiltre un datacenter, hacke 4 terminaux et atteins la sortie sans te faire capturer.

- **Gardes IA** : 4 robots de sécurité avec cônes de vision 3D, patrouille par waypoints, vitesse adaptative
- **Occlusion** : les murs bloquent réellement la détection (raycast LOS)
- **Système de détection** : barre de détection globale, alarme avec countdown de 12s pour se cacher
- **EMP** : 3 charges (touche E) — neutralise tous les gardes dans un rayon de 7u pendant 6s
- **ECHO prédictif** : annonce quand un garde approche de ta zone ("dans environ 4s"), détecte si tu es bloqué
- **Minimap** : carte complète avec position des gardes, terminaux et sortie
- **Score** : calculé selon le temps, les terminaux, les EMP économisés et le nombre d'alarmes

**Contrôles :** WASD + souris | Shift = courir | E = EMP | ESC = pause

---

## Architecture technique

| Technologie | Usage |
|---|---|
| **Babylon.js v7** | Moteur 3D unique (contrainte de la compétition) |
| **TypeScript strict** | Typage complet, `noUnusedLocals` actif |
| **Vite** | Build et dev server |
| **Web Audio API** | Tous les sons sont synthétisés procéduralement (0 fichier audio) |
| **DOM pur** | Toute l'UI in-game (pas de framework UI) |

### IA implémentée

- **BFS pathfinding** (drone NeuroMaze) — navigation dans les passages ouverts du labyrinthe
- **Adaptive wall opening** — l'IA casse le mur le plus utile selon la progression Manhattan
- **Circular path detection** — fenêtre glissante de 25 cellules, détecte les boucles (≥4 visites)
- **Guard patrol AI** — waypoints, interpolation de rotation, détection angulaire + raycast LOS
- **Raycast Line-of-Sight** — les murs bloquent physiquement la détection des gardes
- **Patrol prediction** — ECHO estime l'heure d'arrivée du garde le plus proche dans la zone joueur
- **ECHO** — compagnon IA contextuellement réactif : progression, blocage, alerte, patterns

---

## Lancer en local

```bash
npm install
npm run dev       # dev server → http://localhost:3000
npm run build     # build production → dist/
npx tsc --noEmit  # vérification TypeScript
```

---

*Games On Web 2026 — IA Edition · Université de Rennes 1 MIAGE*
