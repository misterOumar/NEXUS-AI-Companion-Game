
# NEXUS – Documentation Technique

Ce document décrit en détail l'architecture technique, les choix d'implémentation et les systèmes internes du jeu **NEXUS – AI Companion Game**.

**Destiné aux :**
- Développeurs
- Membres du jury technique
- Enseignants
- Contributeurs potentiels

---

## Stack technique

### Frontend / Game Engine
- **Babylon.js** (WebGL)
- **TypeScript**
- **HTML5 / CSS3**
- **Vite** pour le bundling

### Architecture logicielle
- Programmation orientée composants
- Séparation claire : moteur / scènes / logique IA / UI / multijoueur
- Pattern événementiel pour le découplage

---

## Structure détaillée du projet

```
src/
├── core/
│   ├── Engine.ts              // Initialisation Babylon, canvas, loop
│   ├── SceneManager.ts        // Gestion du cycle de vie des scènes
│   └── InputManager.ts        // Centralisation des inputs clavier/souris
│
├── scenes/
│   ├── AbstractScene.ts       // Classe mère des scènes
│   ├── HubScene.ts            // Hub central
│   ├── NeuroMazeScene.ts      // Labyrinthe adaptatif
│   ├── MirrorDuelScene.ts     // Combat contre clone IA
│   ├── MindRushScene.ts       // Arène de décisions
│   └── MultiplayerScene.ts    // Mode multijoueur
│
├── ai/
│   ├── EchoAI.ts              // IA compagnon (orchestrateur)
│   ├── PlayerProfile.ts       // Modèle comportemental du joueur
│   ├── BehaviorAnalyzer.ts    // Analyse des actions du joueur
│   ├── DifficultyManager.ts   // Adaptation dynamique
│   └── CloneAI.ts             // IA du clone (MirrorDuel)
│
├── player/
│   ├── PlayerController.ts    // Déplacement, collisions
│   └── PlayerStats.ts         // Données runtime
│
├── ui/
│   ├── HUD.ts                 // Interface en jeu
│   ├── DialogueBox.ts         // Dialogues IA
│   └── Menu.ts                // Menus
│
├── multiplayer/
│   ├── RoomManager.ts         // Gestion des salles
│   └── NetworkAdapter.ts      // Abstraction réseau
│
└── utils/
    └── helpers.ts             // Utilitaires
```

---

## Gestion des scènes

Toutes les scènes héritent de `AbstractScene`.

### Responsabilités d'une scène
- Création des meshes
- Chargement des assets
- Gestion des collisions
- Envoi des événements à l'IA

### Cycle de vie
```
init() → loadAssets() → createScene() → update(deltaTime) → dispose()
```

Le `SceneManager` assure la transition propre entre les scènes.

---

## Architecture de l'IA compagnon

### Principe général
L'IA repose sur :
- des **scores comportementaux** normalisés
- des **règles décisionnelles** explicites
- des **profils dynamiques** évolutifs

Aucun Machine Learning lourd n'est utilisé afin de :
- garantir la lisibilité du code
- garder le contrôle sur les décisions
- faciliter l'évaluation par le jury

---

### PlayerProfile

Stocke des métriques normalisées (0 → 1) :

| Métrique | Description |
|----------|-------------|
| `aggressiveness` | Tendance offensive vs défensive |
| `caution` | Niveau de prudence dans les choix |
| `reactionSpeed` | Rapidité de réponse aux stimuli |
| `adaptability` | Capacité à changer de stratégie |
| `consistency` | Cohérence stratégique sur la durée |

Ces valeurs évoluent en temps réel pendant la partie.

```typescript
interface PlayerProfile {
  aggressiveness: number;    // 0 = défensif, 1 = offensif
  caution: number;           // 0 = imprudent, 1 = très prudent
  reactionSpeed: number;     // 0 = lent, 1 = très rapide
  adaptability: number;      // 0 = rigide, 1 = très adaptable
  consistency: number;       // 0 = erratique, 1 = très cohérent
}
```

---

### BehaviorAnalyzer

Analyse en continu les actions du joueur.

**Inputs analysés :**
- Positions et trajectoires
- Timing des actions
- Séquences de décisions
- Patterns d'erreurs

**Événements produits :**
```typescript
enum BehaviorEvent {
  PLAYER_HESITATION,     // Pause prolongée avant action
  RISK_TAKEN,            // Action à haut risque
  REPEATED_ERROR,        // Même erreur plusieurs fois
  PATTERN_DETECTED,      // Comportement récurrent identifié
  STYLE_SHIFT            // Changement de style de jeu
}
```

---

### DifficultyManager

Ajuste dynamiquement les paramètres de jeu :
- Vitesse des éléments
- Complexité des puzzles
- Fréquence des événements
- Tolérance aux erreurs

Fonctionne par **paliers progressifs** avec hystérésis pour éviter les oscillations.

---

### EchoAI

Point d'entrée unique de l'IA compagnon :
- Agrège les données de tous les analyseurs
- Décide quand et comment intervenir
- Génère les conseils contextuels
- Déclenche les adaptations de difficulté

Architecture événementielle pour limiter le couplage.

```typescript
class EchoAI {
  onBehaviorEvent(event: BehaviorEvent): void;
  generateAdvice(context: GameContext): Advice;
  shouldIntervene(): boolean;
}
```

---

## NeuroMaze – Génération procédurale

### Algorithme de génération

1. **Génération de grille** : Matrice NxM de cellules
2. **DFS / Recursive Backtracking** : Création des chemins
3. **Post-traitement adaptatif** : Ajustements selon le profil joueur

```typescript
class MazeGenerator {
  generate(width: number, height: number): MazeGrid;
  adaptToPlayer(maze: MazeGrid, profile: PlayerProfile): MazeGrid;
}
```

### Adaptations IA en temps réel
- Suppression/ajout de murs dynamique
- Modification de la visibilité (brouillard)
- Agrandissement/réduction de zones
- Ajout de raccourcis si frustration détectée

---

## MirrorDuel – Clone IA Comportemental

**Le mini-jeu signature de NEXUS** - Démonstration principale de l'IA.

### Concept
Le joueur affronte un clone IA qui **reproduit son propre style de jeu**. Plus il joue, plus le clone devient précis.

### Architecture technique

```
┌─────────────────────────────────────────────────────────────────┐
│                     MirrorDuelScene                             │
├─────────────────────────────────────────────────────────────────┤
│                              │                                  │
│    ┌─────────────────────────┼─────────────────────────┐        │
│    ▼                         ▼                         ▼        │
│ InputRecorder          CloneBrain              CloneController  │
│ (Capture actions)      (Modèle IA)             (Exécution)      │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1 : Apprentissage (30-60 secondes)

**InputRecorder** capture toutes les actions du joueur :

```typescript
interface RecordedAction {
  timestamp: number;
  type: ActionType;           // MOVE, ATTACK, DODGE, SPECIAL
  direction: Vector3;
  duration: number;
  context: GameContext;       // État du jeu au moment de l'action
}

interface GameContext {
  playerPosition: Vector3;
  enemyPositions: Vector3[];
  playerHealth: number;
  nearestThreat: ThreatInfo;
}
```

**Données collectées :**

| Donnée | Utilité |
|--------|---------|
| Patterns de mouvement | Reproduction des trajectoires |
| Timing des attaques | Rythme offensif |
| Réactions aux menaces | Comportement défensif |
| Utilisation de l'espace | Positionnement tactique |
| Séquences d'actions | Combos et habitudes |

### Phase 2 : Analyse et modélisation

**CloneBrain** transforme les données brutes en modèle comportemental :

```typescript
class CloneBrain {
  // Modèle de mouvement
  private movementPatterns: MovementPattern[];

  // Modèle de combat
  private attackPatterns: AttackPattern[];
  private defensePatterns: DefensePattern[];

  // Modèle décisionnel
  private decisionTree: BehaviorTree;

  // Analyse des données
  analyze(recordings: RecordedAction[]): void {
    this.extractMovementPatterns(recordings);
    this.extractCombatPatterns(recordings);
    this.buildDecisionTree(recordings);
  }

  // Décision en temps réel
  decide(context: GameContext): CloneAction {
    return this.decisionTree.evaluate(context);
  }
}
```

**Algorithmes utilisés :**

1. **Clustering des trajectoires** : K-means sur les séquences de positions
2. **Analyse de fréquence** : Identification des actions préférées
3. **Détection de patterns** : Séquences récurrentes d'actions
4. **Arbre de décision** : Mapping contexte → action

### Phase 3 : Duel

**CloneController** exécute les décisions du CloneBrain :

```typescript
class CloneController {
  private brain: CloneBrain;
  private mesh: Mesh;

  update(deltaTime: number, context: GameContext): void {
    const action = this.brain.decide(context);
    this.executeAction(action, deltaTime);
  }

  private executeAction(action: CloneAction, dt: number): void {
    switch (action.type) {
      case ActionType.MOVE:
        this.move(action.direction, action.speed, dt);
        break;
      case ActionType.ATTACK:
        this.attack(action.target, action.attackType);
        break;
      case ActionType.DODGE:
        this.dodge(action.direction);
        break;
    }
  }
}
```

### Scoring et feedback

```typescript
interface DuelResult {
  winner: 'player' | 'clone' | 'draw';
  similarityScore: number;      // 0-100% : précision du clone
  playerScore: number;
  cloneScore: number;
  behaviorInsights: string[];   // Observations d'ECHO
}
```

**Score de similarité** : Mesure à quel point le clone reproduit fidèlement le joueur.

```typescript
function calculateSimilarity(
  playerActions: RecordedAction[],
  cloneActions: CloneAction[]
): number {
  // Comparaison des distributions d'actions
  const actionDistSimilarity = compareActionDistributions(playerActions, cloneActions);

  // Comparaison des patterns de mouvement
  const movementSimilarity = compareMovementPatterns(playerActions, cloneActions);

  // Comparaison des timings
  const timingSimilarity = compareTimings(playerActions, cloneActions);

  return (actionDistSimilarity + movementSimilarity + timingSimilarity) / 3;
}
```

### Évolution du clone

Le clone s'améliore à chaque partie :

```typescript
class CloneEvolution {
  // Historique des parties
  private history: DuelHistory[];

  // Amélioration progressive
  evolve(newData: RecordedAction[]): void {
    // Fusion des anciennes et nouvelles données
    this.brain.integrateNewData(newData, weight: 0.3);

    // Affinage des patterns
    this.brain.refinePatterns();

    // Augmentation de la précision
    this.brain.increasePrecision();
  }
}
```

### Intégration avec ECHO

```typescript
// ECHO commente le duel en temps réel
echoAI.onDuelEvent({
  type: 'CLONE_MIMICS_PLAYER',
  message: "Ton clone utilise ta technique de feinte à droite..."
});

echoAI.onDuelEvent({
  type: 'PLAYER_PREDICTABLE',
  message: "Tu répètes le même pattern. Ton clone l'a appris."
});

// Débriefing post-match
echoAI.generateDuelAnalysis(duelResult): DuelAnalysis {
  return {
    strengths: [...],
    weaknesses: [...],
    suggestions: [...],
    cloneAccuracy: duelResult.similarityScore
  };
}
```

---

## MindRush – Système de décisions

### Génération de scénarios
- Templates de situations avec variables
- Pondération risque/récompense dynamique
- Adaptation au profil du joueur

### Scoring
- Cohérence des choix sur la durée
- Détection des biais décisionnels
- L'IA force parfois des choix opposés au style dominant

```typescript
interface Scenario {
  id: string;
  description: string;
  options: DecisionOption[];
  timeLimit: number;
  riskLevel: number;
}

interface DecisionOption {
  id: string;
  text: string;
  risk: number;
  reward: number;
  alignsWithProfile: boolean;
}
```

---

## Multijoueur

### Communication
- **WebSockets** pour la communication temps réel
- Rooms isolées avec état partagé

### Synchronisation
- Envoi des états clés uniquement (positions, actions)
- Logique déterministe locale pour la fluidité
- Réconciliation périodique

### IA en multijoueur
- ECHO en mode coaching uniquement
- Pas d'avantage artificiel
- Analyse post-match comparative

```typescript
interface MultiplayerState {
  roomId: string;
  players: PlayerState[];
  gameState: GameState;
  timestamp: number;
}
```

---

## Performances

### Optimisations appliquées
- **Pooling des objets** : Réutilisation des meshes et particules
- **Frustum culling** : Désactivation des meshes hors champ
- **LOD** : Niveaux de détail selon la distance
- **Tick IA réduit** : Analyse toutes les 100-200ms, pas à chaque frame

### Métriques cibles
- 60 FPS stable sur hardware moyen
- Temps de chargement < 3s
- Latence IA < 50ms

---

## Tests & Debug

### Outils disponibles
- **Logs IA** : Activables via console/config
- **Mode debug visuel** : Affichage des zones, trajectoires IA
- **Overlays métriques** : PlayerProfile en temps réel
- **Replay système** : Enregistrement et relecture des parties

```typescript
// Activation du mode debug
DebugManager.enable({
  showAIDecisions: true,
  showPlayerProfile: true,
  logBehaviorEvents: true,
  showCloneThinking: true  // MirrorDuel
});
```

---

## Lancement

```bash
npm install
npm run dev
```

### Scripts disponibles
```bash
npm run dev      # Développement avec hot reload
npm run build    # Build production
npm run preview  # Preview du build
npm run test     # Tests unitaires
```

---

## Notes concours

| Critère | Implémentation |
|---------|----------------|
| Jouable navigateur | Babylon.js WebGL, pas de plugins |
| IA intégrée gameplay | ECHO + MirrorDuel + adaptation dynamique |
| Code lisible | TypeScript, architecture modulaire |
| Innovation | Clone IA comportemental unique |

---

**© NEXUS – Games On Web 2026 – Université de Rennes 1**
