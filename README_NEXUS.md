
# NEXUS – AI Companion Game

> **NEXUS** est un jeu web 3D développé avec **Babylon.js**, dans lequel un **compagnon IA nommé ECHO** analyse le comportement du joueur à travers plusieurs mini-jeux cognitifs et stratégiques. ECHO apprend, s'adapte et fournit des conseils personnalisés pour aider le joueur à s'améliorer, seul ou face à d'autres joueurs.

**Projet réalisé dans le cadre du concours [Games On Web 2026 – IA Edition](https://www.cgi.com/france/fr-fr/event/games-on-web-2026)**

**Équipe : Université de Rennes 1 - MIAGE**

---

## Concept général

Le joueur incarne un personnage évoluant dans un **hub 3D central**.
À ses côtés flotte **ECHO**, un drone IA compagnon qui l'accompagne tout au long de l'aventure.

Le joueur se déplace librement dans le monde pour accéder à différents mini-jeux.
Pendant les parties, ECHO :
- observe les mouvements et décisions en temps réel
- analyse le style de jeu et construit un profil comportemental
- adapte dynamiquement la difficulté
- fournit des conseils contextuels personnalisés
- prépare le joueur pour les affrontements multijoueur

---

## Le compagnon IA – ECHO

### Rôle
ECHO est une IA compagnon **active**, intégrée au gameplay. Contrairement aux IA passives, ECHO interagit, apprend et influence directement l'expérience de jeu.

### Analyses réalisées

| Métrique | Description |
|----------|-------------|
| Temps de réaction | Mesure la rapidité des réponses aux stimuli |
| Fréquence des erreurs | Détecte les patterns d'échec récurrents |
| Prise de risque | Évalue le ratio risque/prudence |
| Hésitations | Analyse les pauses avant les décisions |
| Style de jeu | Classifie : agressif, défensif, explorateur, stratège |

### Actions concrètes
- **Conseils temps réel** : suggestions contextuelles pendant le jeu
- **Difficulté adaptative** : ajustement dynamique des challenges
- **Recommandations** : suggestion de mini-jeux selon le profil
- **Analyse post-partie** : débriefing détaillé des performances
- **Coaching multijoueur** : préparation aux matchs compétitifs

---

## Les Mini-Jeux

### HubScene – Le Monde Central
Espace 3D immersif servant de point d'accès aux mini-jeux. Le joueur explore librement, interagit avec ECHO et choisit ses activités.

---

### NeuroMaze – Labyrinthe Adaptatif
> *"Le labyrinthe qui apprend de toi"*

Un labyrinthe généré procéduralement qui **évolue en fonction du comportement du joueur**.

**Gameplay :**
- Génération procédurale unique à chaque partie
- L'IA analyse : vitesse, hésitations, choix de chemins
- Le labyrinthe s'adapte : plus facile si frustration détectée, plus complexe si maîtrise
- Objectifs dynamiques et collectibles

**Intégration IA :**
- Modification en temps réel de la structure
- Ajout/suppression de murs selon la performance
- Gestion de la visibilité et du brouillard
- Conseils de navigation par ECHO

---

### MirrorDuel – Affronte ton Clone IA
> *"Ton pire ennemi, c'est toi-même"*

**Le mini-jeu signature de NEXUS.** L'IA apprend le style de jeu du joueur et génère un **clone qui reproduit ses stratégies**.

**Gameplay :**
- Arène de combat/esquive en 3D
- **Phase d'apprentissage** (30-60s) : ECHO observe silencieusement
- **Phase de duel** : Le clone IA affronte le joueur
- Plus le joueur joue, plus le clone devient précis et redoutable

**Ce qui rend MirrorDuel unique :**
- Le joueur **voit concrètement** ce que l'IA a appris de lui
- Chaque clone est unique car basé sur le joueur réel
- Force l'introspection : "Comment je joue vraiment ?"
- Rejouabilité infinie : le clone évolue avec le joueur

**Intégration IA :**
- Capture des patterns de mouvement et de timing
- Reproduction des stratégies offensives/défensives
- Score de similarité affiché en temps réel
- Débriefing post-match par ECHO

---

### MindRush – Arène de Décisions
> *"Chaque choix révèle qui tu es"*

Une arène de décisions rapides où l'IA analyse la prise de risque et la cohérence stratégique.

**Gameplay :**
- Scénarios générés dynamiquement
- Choix à faire sous pression temporelle
- Pondération risque/récompense
- L'IA force parfois des choix opposés au style dominant

**Intégration IA :**
- Analyse de la cohérence décisionnelle
- Détection des biais comportementaux
- Adaptation des scénarios au profil
- Scoring basé sur la stratégie globale

---

### Mode Multijoueur
> *"Mets ton entraînement à l'épreuve"*

Affrontez d'autres joueurs dans des duels compétitifs.

**Fonctionnalités :**
- Création de salles privées/publiques
- Matchmaking basé sur le profil IA
- ECHO en mode coaching (sans avantage artificiel)
- Analyse post-match comparative

---

## Architecture IA

```
┌─────────────────────────────────────────────────────────┐
│                      EchoAI                             │
│            (Orchestrateur principal)                    │
├─────────────────────────────────────────────────────────┤
│                         │                               │
│    ┌────────────────────┼────────────────────┐          │
│    ▼                    ▼                    ▼          │
│ PlayerProfile    BehaviorAnalyzer    DifficultyManager  │
│ (Profil joueur)  (Analyse actions)   (Adaptation)       │
└─────────────────────────────────────────────────────────┘
```

- **PlayerProfile** : profil comportemental évolutif du joueur
- **BehaviorAnalyzer** : analyse continue des actions et décisions
- **DifficultyManager** : adaptation dynamique en temps réel
- **EchoAI** : coordination globale et génération de conseils

---

## Architecture du projet

```
NEXUS
├── public/
│   └── index.html
├── src/
│   ├── core/           # Moteur et gestion globale
│   ├── scenes/         # Scènes de jeu
│   ├── ai/             # Système IA complet
│   ├── player/         # Contrôleur joueur
│   ├── ui/             # Interface utilisateur
│   ├── multiplayer/    # Réseau et salles
│   └── utils/          # Utilitaires
├── assets/
│   ├── models/         # Modèles 3D
│   ├── textures/       # Textures
│   ├── sounds/         # Audio
│   └── shaders/        # Shaders personnalisés
└── README.md
```

---

## Direction artistique

- **Univers** : Futuriste épuré, atmosphère cyberpunk légère
- **Palette** : Bleu électrique / Violet néon / Blanc pur
- **UI** : Minimaliste, holographique
- **Animations** : Fluides et lisibles
- **ECHO** : Drone lumineux avec expressions visuelles

---

## Technologies

| Composant | Technologie |
|-----------|-------------|
| Moteur 3D | Babylon.js |
| Langage | TypeScript |
| Frontend | HTML5 / CSS3 |
| Bundler | Vite |
| Multijoueur | WebSockets |
| IA | Règles comportementales + profils dynamiques |

---

## Lancer le projet

```bash
npm install
npm run dev
```

---

## Objectifs du projet

- IA **véritablement intégrée** au gameplay (pas juste cosmétique)
- Expérience accessible et intuitive
- Analyse comportementale transparente pour le joueur
- Démonstration technique complète et innovante
- **Originalité** : MirrorDuel comme élément différenciant

---

## Games On Web 2026

| Critère | Notre réponse |
|---------|---------------|
| Thème IA Edition | ECHO + MirrorDuel = IA centrale |
| Jeu navigateur | Babylon.js WebGL |
| Innovation | Clone IA comportemental unique |
| Technique | Architecture modulaire propre |

---

**© NEXUS – Games On Web 2026 – Université de Rennes 1**
