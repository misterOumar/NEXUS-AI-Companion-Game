import {
  Vector3,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  GlowLayer,
  ArcRotateCamera,
  HemisphericLight,
  PointLight,
  DefaultRenderingPipeline,
  ParticleSystem,
  DynamicTexture,
  SceneLoader,
  AbstractMesh,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { AbstractScene }             from './AbstractScene';
import { EchoAI, AdviceType }        from '@/ai/EchoAI';
import { DialogueBox }               from '@/ui/DialogueBox';
import { InputRecorder }             from '@/ai/InputRecorder';
import { CloneBrain, CloneMode }     from '@/ai/CloneBrain';
import { SceneManager }              from '@/core/SceneManager';
import { AudioManager }              from '@/core/AudioManager';
import { HeatmapRenderer }           from '@/rendering/HeatmapRenderer';
import { GameState, BehavioralProfile } from '@/core/GameState';

// ─── Constantes de gameplay ───────────────────────────────────────────────────
const ARENA_RADIUS    = 14;
const PLAYER_SPEED    = 5.5;
const CLONE_BASE_SPEED = 5.0;
const HIT_DISTANCE    = 1.4;
const PLAYER_MAX_HP   = 5;
const NEAR_MISS_DIST  = 2.5;

const ROUND_CONFIGS = [
  { round: 1, observeTime: 45, duelTime: 60,  speedMult: 1.00, label: 'SCAN'            },
  { round: 2, observeTime: 30, duelTime: 75,  speedMult: 1.15, label: 'APPRENTISSAGE'   },
  { round: 3, observeTime: 20, duelTime: 90,  speedMult: 1.25, label: 'MIROIR PARFAIT'  },
] as const;

// ─── Phases ───────────────────────────────────────────────────────────────────
export enum DuelPhase {
  INTRO       = 'intro',
  OBSERVATION = 'observation',
  TRANSITION  = 'transition',
  DUEL        = 'duel',
  ANALYSIS    = 'analysis',   // écran inter-round
  RESULT      = 'result',
}

/**
 * MirrorDuelScene — Jeu complet Mirror Duel
 *
 * 3 rounds progressifs :
 *   Round 1 SCAN          : 45s obs + 60s duel  — clone niveau 1
 *   Round 2 APPRENTISSAGE : 30s obs + 75s duel  — clone connaît tes patterns
 *   Round 3 MIROIR PARFAIT: 20s obs + 90s duel  — clone cible tes zones chaudes
 */
export class MirrorDuelScene extends AbstractScene {

  // ── Caméra & rendu
  private camera!:         ArcRotateCamera;
  private glowLayer!:      GlowLayer;
  private pipeline!:       DefaultRenderingPipeline;
  private hitParticleTex!: DynamicTexture;

  // ── Entités 3D
  private playerMesh!: Mesh;
  private cloneMesh!:  Mesh;
  private arenaFloor!: Mesh;
  private boundaryRing!: Mesh;
  private hpOrbs: Mesh[] = [];

  // ── Systèmes
  private echoAI!:       EchoAI;
  private inputRecorder!: InputRecorder;
  private cloneBrain!:   CloneBrain;
  private dialogueBox!:  DialogueBox;
  private audioManager!: AudioManager;
  private heatmap!:      HeatmapRenderer;
  private gameState!:    GameState;

  // ── Assets GLB
  private playerRoot:    AbstractMesh | null = null;
  private cloneRoot:     AbstractMesh | null = null;

  // ── État joueur
  private playerPos:      Vector3 = new Vector3(0, 0.5, 10);
  private playerVelocity: Vector3 = Vector3.Zero();
  private playerHP:       number  = PLAYER_MAX_HP;

  // ── État clone
  private clonePos:             Vector3  = new Vector3(0, 0.5, -10);
  private cloneVelocity:        Vector3  = Vector3.Zero();
  private cloneSimilarityScore: number   = 0;
  private cloneCurrentMode:     CloneMode = CloneMode.DIRECT;
  private cloneTargetOverride:  Vector3 | null = null;
  private cloneOverrideTimer:   number = 0;

  // ── État de jeu global
  private phase:               DuelPhase = DuelPhase.INTRO;
  private phaseTimer:          number = 0;
  private currentRound:        number = 1;
  private score:               number = 0;    // score du round en cours
  private roundScores:         number[] = []; // scores des rounds terminés
  private hitCooldown:         number = 0;
  private nearMissCooldown:    number = 0;
  private echoCommentCooldown: number = 0;
  private hasNearMissed:       boolean = false;
  private tensionUpdateTimer:  number = 0;
  private analysisTimer:       number = 0;

  // ── UI DOM
  private hudOverlay!: HTMLElement;

  // ═══════════════════════════════════════════════════════════════════════════
  //  CYCLE DE VIE
  // ═══════════════════════════════════════════════════════════════════════════

  public async init(): Promise<void> {
    await super.init();
    this.scene.clearColor  = new Color4(0.01, 0.005, 0.02, 1);
    this.scene.ambientColor = new Color3(0.05, 0.03, 0.08);
    this.scene.collisionsEnabled = false;

    this.glowLayer = new GlowLayer('duelGlow', this.scene);
    this.glowLayer.intensity = 1.2;

    this.echoAI       = EchoAI.getInstance();
    this.audioManager = AudioManager.getInstance();
    this.gameState    = GameState.getInstance();
    this.gameState.startSession();
  }

  public async loadAssets(): Promise<void> {
    await super.loadAssets();
    await this.loadCharacterModels();
  }

  /** Charge character.glb pour joueur et clone (fallback silencieux si absent) */
  private async loadCharacterModels(): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '/models/', 'character.glb', this.scene);
      if (result.meshes.length === 0) return;

      // Joueur — racine
      const playerRoot = result.meshes[0];
      playerRoot.name     = 'playerGLB';
      playerRoot.position = this.playerPos.clone();
      playerRoot.scaling  = new Vector3(0.9, 0.9, 0.9);
      this.applyEmissiveMaterial(result.meshes, new Color3(0.0, 0.5, 1.0), new Color3(0.1, 0.6, 0.9));
      this.playerRoot = playerRoot;

      // Clone — second import
      const result2 = await SceneLoader.ImportMeshAsync('', '/models/', 'character.glb', this.scene);
      const cloneRoot = result2.meshes[0];
      cloneRoot.name     = 'cloneGLB';
      cloneRoot.position = this.clonePos.clone();
      cloneRoot.scaling  = new Vector3(0.9, 0.9, 0.9);
      this.applyEmissiveMaterial(result2.meshes, new Color3(0.8, 0.1, 1.0), new Color3(0.6, 0.0, 0.8), 0.45);
      this.cloneRoot = cloneRoot;

      // Masquer les capsules de fallback dès que les GLB sont chargés
      this.playerMesh.setEnabled(false);
      this.cloneMesh.setEnabled(false);

    } catch (e) {
      // GLB indisponible — les capsules de fallback restent actives
      console.warn('[MirrorDuel] character.glb non chargé, fallback capsule actif.', e);
    }
  }

  private applyEmissiveMaterial(meshes: AbstractMesh[], emissive: Color3, diffuse: Color3, alpha = 1.0): void {
    meshes.forEach(m => {
      if (!m.material) return;
      const mat = new StandardMaterial(m.name + '_mat', this.scene);
      mat.diffuseColor  = diffuse;
      mat.emissiveColor = emissive;
      mat.alpha = alpha;
      m.material = mat;
      if (m instanceof Mesh) this.glowLayer.addIncludedOnlyMesh(m);
    });
  }

  public async createScene(): Promise<void> {
    this.setupCamera();
    this.setupLighting();
    this.buildArena();
    this.buildPlayerMesh();
    this.buildCloneMesh();
    this.buildHPOrbs();
    this.setupPostProcessing();

    this.heatmap      = new HeatmapRenderer(this.scene, ARENA_RADIUS);
    this.inputRecorder = new InputRecorder();
    this.cloneBrain   = new CloneBrain();

    // Injecter la mémoire historique si ce n'est pas la première session
    if (!this.gameState.isFirstSession()) {
      this.cloneBrain.injectHistory(
        this.gameState.getInitialPredictionAccuracy(),
        this.gameState.behavioralProfile,
      );
    }
    this.dialogueBox  = new DialogueBox();

    this.echoAI.onMessage(advice => this.dialogueBox.showAdvice(advice));

    this.buildHUDOverlay();
    this.startPhase(DuelPhase.INTRO);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BOUCLE PRINCIPALE
  // ═══════════════════════════════════════════════════════════════════════════

  public update(deltaTime: number): void {
    this.phaseTimer          += deltaTime;
    this.hitCooldown          = Math.max(0, this.hitCooldown - deltaTime);
    this.nearMissCooldown     = Math.max(0, this.nearMissCooldown - deltaTime);
    this.echoCommentCooldown  = Math.max(0, this.echoCommentCooldown - deltaTime);
    this.cloneOverrideTimer   = Math.max(0, this.cloneOverrideTimer - deltaTime);

    this.echoAI.update(deltaTime);

    switch (this.phase) {
      case DuelPhase.INTRO:       this.updateIntro();                break;
      case DuelPhase.OBSERVATION: this.updateObservation(deltaTime); break;
      case DuelPhase.TRANSITION:  /* géré par setTimeout */          break;
      case DuelPhase.DUEL:        this.updateDuel(deltaTime);        break;
      case DuelPhase.ANALYSIS:    this.updateAnalysis(deltaTime);    break;
      case DuelPhase.RESULT:      this.updateResult();               break;
    }

    this.updateHUD();
    this.syncMeshes();
    this.inputManager.update(); // EN DERNIER
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  GESTION DES PHASES
  // ═══════════════════════════════════════════════════════════════════════════

  private startPhase(phase: DuelPhase): void {
    this.phase      = phase;
    this.phaseTimer = 0;

    const cfg = ROUND_CONFIGS[this.currentRound - 1];

    switch (phase) {

      case DuelPhase.INTRO:
        setTimeout(() => this.echoAI.say(
          "Bienvenue dans Mirror Duel. Je vais observer tes mouvements puis forger un clone numérique qui te traque. Trois rounds. Prépare-toi.",
          AdviceType.TIP
        ), 600);
        setTimeout(() => this.startPhase(DuelPhase.OBSERVATION), 4500);
        break;

      case DuelPhase.OBSERVATION:
        this.heatmap.reset();
        this.inputRecorder.startRecording();
        this.clonePos.set(0, 0.5, -10);
        this.cloneVelocity = Vector3.Zero();
        this.animateCloneIdling();
        this.echoAI.say(
          `Round ${this.currentRound}/3 — ${cfg.label}. Observation démarrée (${cfg.observeTime}s). Déplace-toi librement.`,
          AdviceType.OBSERVATION
        );
        break;

      case DuelPhase.TRANSITION: {
        this.inputRecorder.stopRecording();
        const frames  = this.inputRecorder.getFrames();
        const stats   = this.inputRecorder.getStats(this.clonePos);
        const profile = this.echoAI.getProfile().getData();
        this.cloneBrain.learn(frames, stats, profile);
        this.cloneSimilarityScore = 0;

        const style = this.cloneBrain.getPlayerStyle();
        this.audioManager.playPhaseTransition();
        this.echoAI.say(
          `${frames.length} mouvements analysés. Style : ${style}. Le clone est prêt — round ${this.currentRound}.`,
          AdviceType.OBSERVATION
        );
        setTimeout(() => this.startPhase(DuelPhase.DUEL), 4000);
        break;
      }

      case DuelPhase.DUEL:
        this.playerHP       = PLAYER_MAX_HP;
        this.score          = 0;
        this.hasNearMissed  = false;
        this.playerPos.set(0, 0.5, 10);
        this.clonePos.set(0, 0.5, -10);
        this.playerVelocity = Vector3.Zero();
        this.cloneVelocity  = Vector3.Zero();
        this.cloneTargetOverride = null;
        this.cloneOverrideTimer  = 0;
        this.updateCloneVisualForRound();
        this.audioManager.playRoundStart(this.currentRound);
        this.audioManager.startAmbience();
        this.echoAI.say(
          this.currentRound === 1
            ? "Duel ! Esquive ton clone aussi longtemps que possible !"
            : this.currentRound === 2
              ? "Round 2 — le clone se souvient de toi. Change de stratégie !"
              : "Round 3 — MIROIR PARFAIT. Il te connaît mieux que toi-même.",
          AdviceType.CHALLENGE
        );
        break;

      case DuelPhase.ANALYSIS:
        this.audioManager.stopAmbience();
        this.roundScores.push(Math.floor(this.score));
        this.analysisTimer = 0;
        this.showRoundAnalysisScreen();
        break;

      case DuelPhase.RESULT:
        this.audioManager.stopAmbience();
        // Pousse le score du round final s'il n'a pas encore été poussé
        if (this.roundScores.length < this.currentRound) {
          this.roundScores.push(Math.floor(this.score));
        }
        this.showResultScreen();
        break;
    }
  }

  // ─── Intro ────────────────────────────────────────────────────────────────
  private updateIntro(): void { /* géré par setTimeout */ }

  // ─── Observation ──────────────────────────────────────────────────────────
  private updateObservation(deltaTime: number): void {
    this.movePlayer(deltaTime);
    this.inputRecorder.update(this.playerPos);
    this.heatmap.update(this.playerPos, deltaTime);
    this.idleCloneMovement(deltaTime);

    const cfg     = ROUND_CONFIGS[this.currentRound - 1];
    const elapsed = this.phaseTimer;

    if (elapsed > 10 && elapsed < 11 && this.echoCommentCooldown <= 0) {
      this.echoAI.say("Je cartographie tes zones de déplacement...", AdviceType.OBSERVATION);
      this.echoCommentCooldown = 20;
    }
    if (elapsed > cfg.observeTime * 0.55 && elapsed < cfg.observeTime * 0.55 + 1 && this.echoCommentCooldown <= 0) {
      this.echoAI.say(this.buildObservationComment(), AdviceType.OBSERVATION);
      this.echoCommentCooldown = 20;
    }

    if (this.phaseTimer >= cfg.observeTime) {
      this.startPhase(DuelPhase.TRANSITION);
    }
  }

  // ─── Duel ─────────────────────────────────────────────────────────────────
  private updateDuel(deltaTime: number): void {
    const cfg = ROUND_CONFIGS[this.currentRound - 1];

    this.movePlayer(deltaTime);
    this.moveClone(deltaTime);
    this.heatmap.update(this.playerPos, deltaTime);

    // Score passif
    this.score += deltaTime;

    // Similarité du clone (toutes les 2s)
    if (Math.floor(this.phaseTimer * 0.5) !== Math.floor((this.phaseTimer - deltaTime) * 0.5)) {
      const frames = this.inputRecorder.getFrames().slice(-20);
      this.cloneSimilarityScore = this.cloneBrain.computeSimilarityScore(frames);
      this.inputRecorder.update(this.playerPos);
    }

    // Tension audio (toutes les secondes)
    this.tensionUpdateTimer += deltaTime;
    if (this.tensionUpdateTimer >= 1.0) {
      this.tensionUpdateTimer = 0;
      const timeLeft    = cfg.duelTime - this.phaseTimer;
      const hpTension   = (PLAYER_MAX_HP - this.playerHP) / PLAYER_MAX_HP;
      const timeTension = 1 - Math.min(1, timeLeft / 20);
      this.audioManager.setTension(Math.max(hpTension, timeTension));
    }

    // Détection collision
    const dist = Vector3.Distance(this.playerPos, this.clonePos);
    if (dist < HIT_DISTANCE && this.hitCooldown <= 0) {
      this.onPlayerHit();
    } else if (dist < NEAR_MISS_DIST && dist >= HIT_DISTANCE && this.nearMissCooldown <= 0) {
      this.onNearMiss();
    }

    this.updateDuelComments();

    // Fin de round
    const roundOver = this.phaseTimer >= cfg.duelTime || this.playerHP <= 0;
    if (roundOver) {
      if (this.currentRound < 3 && this.playerHP > 0) {
        // Survécu → analyse inter-round
        this.startPhase(DuelPhase.ANALYSIS);
      } else {
        // Mort ou dernier round → résultat final
        this.startPhase(DuelPhase.RESULT);
      }
    }
  }

  // ─── Analyse inter-round ──────────────────────────────────────────────────
  private updateAnalysis(deltaTime: number): void {
    this.analysisTimer += deltaTime;
    const countdown = Math.ceil(8 - this.analysisTimer);

    const el = document.getElementById('md-analysis-countdown');
    if (el) el.textContent = `Prochain round dans ${Math.max(0, countdown)}s...`;

    if (this.inputManager.isKeyJustPressed(' ') || this.analysisTimer >= 8) {
      this.hideRoundAnalysisScreen();
      this.currentRound++;
      this.heatmap.fadeRound();
      this.inputRecorder.startRecording(); // repart pour le round suivant
      this.startPhase(DuelPhase.OBSERVATION);
    }
  }

  // ─── Résultat ─────────────────────────────────────────────────────────────
  private updateResult(): void {
    if (this.inputManager.isKeyJustPressed('r'))      this.restartGame();
    if (this.inputManager.isKeyJustPressed('escape')) this.returnToHub();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MOUVEMENT JOUEUR
  // ═══════════════════════════════════════════════════════════════════════════

  private movePlayer(deltaTime: number): void {
    let dx = 0, dz = 0;
    if (this.inputManager.isKeyDown('w') || this.inputManager.isKeyDown('arrowup'))    dz -= 1;
    if (this.inputManager.isKeyDown('s') || this.inputManager.isKeyDown('arrowdown'))  dz += 1;
    if (this.inputManager.isKeyDown('a') || this.inputManager.isKeyDown('arrowleft'))  dx -= 1;
    if (this.inputManager.isKeyDown('d') || this.inputManager.isKeyDown('arrowright')) dx += 1;

    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) { dx /= len; dz /= len; }

    const target = new Vector3(dx * PLAYER_SPEED, 0, dz * PLAYER_SPEED);
    this.playerVelocity = Vector3.Lerp(this.playerVelocity, target, 0.25);
    this.playerPos = this.clampToArena(this.playerPos.add(this.playerVelocity.scale(deltaTime)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MOUVEMENT CLONE
  // ═══════════════════════════════════════════════════════════════════════════

  private moveClone(deltaTime: number): void {
    const cfg = ROUND_CONFIGS[this.currentRound - 1];

    // Rounds 2+ : cible parfois une zone chaude de la heatmap
    if (this.currentRound >= 2 && this.cloneOverrideTimer <= 0) {
      const hotChance = (0.15 + (this.currentRound - 1) * 0.12) * deltaTime;
      if (Math.random() < hotChance) {
        const zones = this.heatmap.getHotZones();
        if (zones.length > 0) {
          this.cloneTargetOverride = zones[0];
          this.cloneOverrideTimer  = 2.5 + Math.random() * 1.5;
        }
      }
    }

    const effectiveTarget = (this.cloneOverrideTimer > 0 && this.cloneTargetOverride)
      ? this.cloneTargetOverride
      : this.playerPos;

    const decision = this.cloneBrain.decide(
      this.clonePos,
      effectiveTarget,
      this.playerVelocity,
      CLONE_BASE_SPEED * cfg.speedMult,
      deltaTime,
    );
    this.cloneCurrentMode = decision.mode;

    const dir  = decision.targetPosition.subtract(this.clonePos);
    if (dir.length() < 0.1) return;
    dir.normalize();

    const targetVel    = dir.scale(decision.speed);
    this.cloneVelocity = Vector3.Lerp(this.cloneVelocity, targetVel, 0.18);
    this.clonePos      = this.clampToArena(this.clonePos.add(this.cloneVelocity.scale(deltaTime)));
  }

  private idleCloneMovement(deltaTime: number): void {
    const t = this.phaseTimer;
    this.clonePos.x = Math.sin(t * 0.4) * 2;
    this.clonePos.z = -10 + Math.cos(t * 0.3) * 1.5;
    this.clonePos.y = 0.5 + Math.sin(t * 1.2) * 0.2;
    void deltaTime;
  }

  private animateCloneIdling(): void {
    const mat = this.cloneMesh.material as StandardMaterial;
    if (!mat) return;
    let t = 0;
    const tick = this.scene.onBeforeRenderObservable.add(() => {
      if (this.phase !== DuelPhase.OBSERVATION && this.phase !== DuelPhase.TRANSITION) {
        this.scene.onBeforeRenderObservable.remove(tick);
        return;
      }
      t += 0.03;
      mat.alpha = 0.35 + Math.sin(t) * 0.2;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ÉVÉNEMENTS DE JEU
  // ═══════════════════════════════════════════════════════════════════════════

  private onPlayerHit(): void {
    this.playerHP--;
    this.hitCooldown = 1.5;
    this.score = Math.max(0, this.score - 5);

    this.flashMesh(this.playerMesh, new Color3(1, 0.2, 0.2));
    this.screenShake(0.9, 0.45);
    this.spawnHitParticles(this.playerPos.clone());
    this.triggerHitPostProcess();
    this.audioManager.playHit();

    const mode = this.cloneCurrentMode;
    if (mode === CloneMode.PREDICT || mode === CloneMode.INTERCEPT) {
      this.echoAI.say("Ton clone a prédit ton mouvement. Change de stratégie !", AdviceType.WARNING);
    } else if (mode === CloneMode.PATTERN) {
      this.echoAI.say("Il rejoue un de tes patterns ! Tu es trop prévisible.", AdviceType.WARNING);
    } else {
      this.echoAI.say(`Touché ! ${this.playerHP} vie${this.playerHP > 1 ? 's' : ''} restante${this.playerHP > 1 ? 's' : ''}.`, AdviceType.WARNING);
    }

    const dir = this.clonePos.subtract(this.playerPos).normalize();
    this.clonePos = this.clampToArena(this.clonePos.add(dir.scale(3)));
    this.cloneVelocity = Vector3.Zero();
  }

  private onNearMiss(): void {
    this.nearMissCooldown = 3.0;
    this.score += 3;
    this.audioManager.playNearMiss();
    if (!this.hasNearMissed) {
      this.hasNearMissed = true;
      this.echoAI.say("Belle esquive ! Mon clone retient ce mouvement...", AdviceType.OBSERVATION);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMMENTAIRES ECHO
  // ═══════════════════════════════════════════════════════════════════════════

  private updateDuelComments(): void {
    if (this.echoCommentCooldown > 0) return;
    const elapsed = this.phaseTimer;
    if (elapsed > 18 && Math.floor(elapsed / 18) !== Math.floor((elapsed - 0.016) / 18)) {
      const comment = this.pickDuelComment();
      if (comment) {
        this.echoAI.say(comment, AdviceType.OBSERVATION);
        this.echoCommentCooldown = 15;
      }
    }
  }

  private pickDuelComment(): string | null {
    const sim  = this.cloneSimilarityScore;
    const mode = this.cloneCurrentMode;
    const hp   = this.playerHP;
    const cfg  = ROUND_CONFIGS[this.currentRound - 1];

    if (sim > 70) return `Ressemblance à ${sim}% — il te connaît presque mieux que toi-même.`;
    if (sim > 40) return `Ton clone te ressemble à ${sim}%. Il anticipe tes esquives.`;
    if (mode === CloneMode.INTERCEPT) return "Le clone coupe ta route — il ne te chasse plus, il te piège.";
    if (mode === CloneMode.PATTERN)   return "Il rejoue un pattern favori. Surprise-le !";
    if (hp <= 2) return "Attention — plus que quelques erreurs.";
    if (this.phaseTimer > cfg.duelTime - 20) return `${Math.round(cfg.duelTime - this.phaseTimer)}s restantes. Tiens bon !`;
    return null;
  }

  private buildObservationComment(): string {
    const frames       = this.inputRecorder.getFrames();
    const moving       = frames.filter(f => f.speed > 0.3);
    const moveRatio    = moving.length / Math.max(frames.length, 1);
    if (moveRatio > 0.8) return "Profil très mobile détecté. Mon clone sera rapide.";
    if (moveRatio < 0.3) return "Tu restes souvent immobile. Mon clone saura où te trouver.";
    const avgSpeed     = moving.reduce((s, f) => s + f.speed, 0) / Math.max(moving.length, 1);
    if (avgSpeed > 4)   return "Vitesse élevée détectée. Mon clone va apprendre à te devancer.";
    return "Style équilibré — intéressant. Mon clone va s'adapter.";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EFFETS DE HIT
  // ═══════════════════════════════════════════════════════════════════════════

  private screenShake(intensity = 0.9, duration = 0.45): void {
    const base    = this.camera.target.clone();
    const endTime = performance.now() + duration * 1000;
    const tick = () => {
      const now = performance.now();
      if (now >= endTime) { this.camera.target.copyFrom(base); return; }
      const decay = (endTime - now) / (duration * 1000);
      const s = intensity * decay;
      this.camera.target.x = base.x + (Math.random() - 0.5) * s;
      this.camera.target.z = base.z + (Math.random() - 0.5) * s;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private spawnHitParticles(position: Vector3): void {
    const ps = new ParticleSystem('hitBurst', 60, this.scene);
    ps.emitter         = position;
    ps.particleTexture = this.hitParticleTex;
    ps.minEmitBox      = new Vector3(-0.15, 0, -0.15);
    ps.maxEmitBox      = new Vector3(0.15, 0.1, 0.15);
    ps.color1          = new Color4(1.0, 0.35, 0.1, 1.0);
    ps.color2          = new Color4(1.0, 0.0,  0.5, 1.0);
    ps.colorDead       = new Color4(0.4, 0.0,  0.2, 0.0);
    ps.minSize         = 0.08;  ps.maxSize      = 0.26;
    ps.minLifeTime     = 0.15;  ps.maxLifeTime  = 0.55;
    ps.emitRate        = 400;
    ps.direction1      = new Vector3(-3, 4, -3);
    ps.direction2      = new Vector3(3,  8,  3);
    ps.minEmitPower    = 3;     ps.maxEmitPower = 9;
    ps.updateSpeed     = 0.02;
    ps.gravity         = new Vector3(0, -12, 0);
    ps.start();
    setTimeout(() => ps.stop(), 120);
    setTimeout(() => ps.dispose(), 800);
  }

  private triggerHitPostProcess(): void {
    const ca = this.pipeline?.chromaticAberration;
    if (!ca) return;
    const start = performance.now();
    ca.aberrationAmount = 55;
    const tick = () => {
      const e = performance.now() - start;
      if (e >= 500) { ca.aberrationAmount = 0; return; }
      ca.aberrationAmount = 55 * (1 - e / 500);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UTILITAIRES
  // ═══════════════════════════════════════════════════════════════════════════

  private clampToArena(pos: Vector3): Vector3 {
    const r   = pos.clone();
    const d2  = r.x * r.x + r.z * r.z;
    const lim = ARENA_RADIUS - 1.0;
    if (d2 > lim * lim) {
      const f = lim / Math.sqrt(d2);
      r.x *= f; r.z *= f;
    }
    r.y = 0.5;
    return r;
  }

  private flashMesh(mesh: Mesh, color: Color3): void {
    const mat = mesh.material as StandardMaterial;
    if (!mat) return;
    const orig = mat.emissiveColor.clone();
    mat.emissiveColor = color;
    setTimeout(() => { mat.emissiveColor = orig; }, 300);
  }

  private restartGame(): void {
    this.hideResultScreen();
    this.hideRoundAnalysisScreen();
    this.currentRound  = 1;
    this.roundScores   = [];
    this.score         = 0;
    this.heatmap.reset();
    this.startPhase(DuelPhase.OBSERVATION);
  }

  private returnToHub(): void {
    this.hideResultScreen();
    SceneManager.getInstance().loadScene('HubScene').catch(console.error);
  }

  private updateCloneVisualForRound(): void {
    const alphas   = [0.45, 0.72, 1.0];
    const emissives = [
      new Color3(0.8, 0.1, 1.0),  // R1 : fantôme magenta
      new Color3(1.0, 0.2, 0.9),  // R2 : semi-solide rose
      new Color3(1.0, 0.4, 0.0),  // R3 : miroir chaud orange
    ];
    const a = alphas[this.currentRound - 1];
    const e = emissives[this.currentRound - 1];

    // Capsule fallback
    const mat = this.cloneMesh.material as StandardMaterial;
    if (mat) { mat.alpha = a; mat.emissiveColor = e; }

    // GLB
    if (this.cloneRoot) {
      this.cloneRoot.getChildMeshes().forEach(m => {
        if (m.material instanceof StandardMaterial) {
          m.material.alpha = a;
          m.material.emissiveColor = e;
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SYNC MESHES
  // ═══════════════════════════════════════════════════════════════════════════

  private syncMeshes(): void {
    // Capsules de fallback
    this.playerMesh.position.copyFrom(this.playerPos);
    this.cloneMesh.position.copyFrom(this.clonePos);

    if (this.playerVelocity.length() > 0.1)
      this.playerMesh.rotation.y = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
    if (this.cloneVelocity.length() > 0.1)
      this.cloneMesh.rotation.y = Math.atan2(this.cloneVelocity.x, this.cloneVelocity.z);

    // Modèles GLB (si chargés)
    if (this.playerRoot) {
      this.playerRoot.position.copyFrom(this.playerPos);
      if (this.playerVelocity.length() > 0.1)
        this.playerRoot.rotation.y = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
    }
    if (this.cloneRoot) {
      this.cloneRoot.position.copyFrom(this.clonePos);
      if (this.cloneVelocity.length() > 0.1)
        this.cloneRoot.rotation.y = Math.atan2(this.cloneVelocity.x, this.cloneVelocity.z);
    }

    this.syncHPOrbs();

    if (this.phase === DuelPhase.DUEL) {
      const t = performance.now() / 1000;
      const cmat = this.cloneMesh.material as StandardMaterial;
      if (cmat) {
        const pulse = 0.6 + Math.sin(t * 3) * 0.4;
        cmat.emissiveColor = cmat.emissiveColor.scale(pulse).add(cmat.emissiveColor.scale(1 - pulse * 0.4));
        // Pulsation simple
        const base = this.currentRound === 3
          ? new Color3(1.0, 0.4, 0.0)
          : this.currentRound === 2
            ? new Color3(1.0, 0.2, 0.9)
            : new Color3(0.8, 0.1, 1.0);
        cmat.emissiveColor = base.scale(0.55 + Math.sin(t * 3) * 0.45);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTRUCTION DE LA SCÈNE
  // ═══════════════════════════════════════════════════════════════════════════

  private setupCamera(): void {
    this.camera = new ArcRotateCamera('duelCamera', -Math.PI / 2, Math.PI / 3.2, 36, Vector3.Zero(), this.scene);
    this.camera.minZ = 0.1; this.camera.maxZ = 500;
    this.camera.lowerRadiusLimit = 36; this.camera.upperRadiusLimit = 36;
    this.camera.lowerBetaLimit   = Math.PI / 3.2;
    this.camera.upperBetaLimit   = Math.PI / 3.2;
  }

  private setupLighting(): void {
    const ambient     = new HemisphericLight('duelAmbient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.3;
    ambient.diffuse   = new Color3(0.4, 0.2, 0.6);
    ambient.groundColor = new Color3(0.1, 0.05, 0.15);

    const center      = new PointLight('duelCenter', new Vector3(0, 8, 0), this.scene);
    center.diffuse    = new Color3(0.6, 0.2, 1.0);
    center.intensity  = 1.2; center.range = 40;

    const playerL     = new PointLight('duelPlayer', new Vector3(0, 3, 12), this.scene);
    playerL.diffuse   = new Color3(0.2, 0.8, 1.0);
    playerL.intensity = 0.6; playerL.range = 20;

    const cloneL      = new PointLight('duelClone', new Vector3(0, 3, -12), this.scene);
    cloneL.diffuse    = new Color3(1.0, 0.2, 0.8);
    cloneL.intensity  = 0.6; cloneL.range = 20;
  }

  private buildArena(): void {
    this.arenaFloor = MeshBuilder.CreateDisc('arenaFloor', { radius: ARENA_RADIUS, tessellation: 64 }, this.scene);
    this.arenaFloor.rotation.x = Math.PI / 2;
    this.arenaFloor.position.y = 0;
    const floorMat = new PBRMaterial('arenaFloorMat', this.scene);
    floorMat.albedoColor = new Color3(0.03, 0.02, 0.06);
    floorMat.metallic = 0.1; floorMat.roughness = 0.9;
    this.arenaFloor.material = floorMat;

    this.boundaryRing = MeshBuilder.CreateTorus('arenaRing', { diameter: ARENA_RADIUS * 2, thickness: 0.3, tessellation: 96 }, this.scene);
    this.boundaryRing.position.y = 0.15;
    const ringMat = new StandardMaterial('arenaRingMat', this.scene);
    ringMat.emissiveColor = new Color3(0.7, 0.2, 1.0);
    this.boundaryRing.material = ringMat;
    this.glowLayer.addIncludedOnlyMesh(this.boundaryRing);

    for (let r = 4; r < ARENA_RADIUS; r += 4) {
      const circle = MeshBuilder.CreateTorus(`grid_${r}`, { diameter: r * 2, thickness: 0.05, tessellation: 64 }, this.scene);
      circle.position.y = 0.01;
      const cm = new StandardMaterial(`gridMat_${r}`, this.scene);
      cm.emissiveColor = new Color3(0.15, 0.05, 0.3); cm.alpha = 0.6;
      circle.material = cm;
    }

    const divider = MeshBuilder.CreateBox('divider', { width: 0.08, height: 0.05, depth: ARENA_RADIUS * 2 }, this.scene);
    divider.position.y = 0.02;
    const divMat = new StandardMaterial('dividerMat', this.scene);
    divMat.emissiveColor = new Color3(0.4, 0.1, 0.7); divMat.alpha = 0.5;
    divider.material = divMat;
    this.glowLayer.addIncludedOnlyMesh(divider);

    this.buildSpawnMarker(new Vector3(0, 0.02, 10),  new Color3(0.2, 0.8, 1.0));
    this.buildSpawnMarker(new Vector3(0, 0.02, -10), new Color3(1.0, 0.2, 0.8));

    this.scene.registerBeforeRender(() => {
      const t = performance.now() / 1000;
      ringMat.emissiveColor = new Color3(0.5 + 0.2 * Math.sin(t * 0.5), 0.1, 0.8 + 0.2 * Math.cos(t * 0.5));
    });
  }

  private buildSpawnMarker(pos: Vector3, color: Color3): void {
    const m = MeshBuilder.CreateDisc('spawn', { radius: 1.2, tessellation: 32 }, this.scene);
    m.position = pos; m.rotation.x = Math.PI / 2;
    const mat = new StandardMaterial('spawnMat', this.scene);
    mat.emissiveColor = color; mat.alpha = 0.3;
    m.material = mat;
    this.glowLayer.addIncludedOnlyMesh(m);
  }

  private buildPlayerMesh(): void {
    this.playerMesh = MeshBuilder.CreateCapsule('player', { height: 1.6, radius: 0.4 }, this.scene);
    this.playerMesh.position.copyFrom(this.playerPos);
    const mat = new StandardMaterial('playerMat', this.scene);
    mat.diffuseColor  = new Color3(0.1, 0.6, 0.9);
    mat.emissiveColor = new Color3(0.0, 0.5, 1.0);
    mat.specularColor = Color3.White();
    this.playerMesh.material = mat;
    this.glowLayer.addIncludedOnlyMesh(this.playerMesh);

    const arrow = MeshBuilder.CreateCylinder('playerArrow', { diameterTop: 0, diameterBottom: 0.3, height: 0.5, tessellation: 3 }, this.scene);
    arrow.parent = this.playerMesh; arrow.position.set(0, 0, 0.6); arrow.rotation.x = Math.PI / 2;
    const am = new StandardMaterial('arrowMat', this.scene);
    am.emissiveColor = new Color3(0.2, 0.9, 1.0);
    arrow.material = am;
    this.glowLayer.addIncludedOnlyMesh(arrow);
  }

  private buildCloneMesh(): void {
    this.cloneMesh = MeshBuilder.CreateCapsule('clone', { height: 1.6, radius: 0.42 }, this.scene);
    this.cloneMesh.position.copyFrom(this.clonePos);
    const mat = new StandardMaterial('cloneMat', this.scene);
    mat.diffuseColor  = new Color3(0.6, 0.0, 0.8);
    mat.emissiveColor = new Color3(0.8, 0.1, 1.0);
    mat.alpha = 0.45; mat.backFaceCulling = false;
    this.cloneMesh.material = mat;
    this.glowLayer.addIncludedOnlyMesh(this.cloneMesh);

    const ring = MeshBuilder.CreateTorus('cloneRing', { diameter: 1.4, thickness: 0.06, tessellation: 32 }, this.scene);
    ring.parent = this.cloneMesh;
    const rm = new StandardMaterial('cloneRingMat', this.scene);
    rm.emissiveColor = new Color3(1.0, 0.3, 1.0);
    ring.material = rm;
    this.glowLayer.addIncludedOnlyMesh(ring);
    this.scene.registerBeforeRender(() => { ring.rotation.x += 0.03; ring.rotation.y += 0.02; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HP ORBES 3D
  // ═══════════════════════════════════════════════════════════════════════════

  private buildHPOrbs(): void {
    for (let i = 0; i < PLAYER_MAX_HP; i++) {
      const angle    = (i / (PLAYER_MAX_HP - 1) - 0.5) * Math.PI * 0.55;
      const x        = Math.sin(angle) * 4.5;
      const z        = 10.5 + Math.cos(angle) * 0.8;
      const baseY    = 3.5 - Math.abs(angle) * 0.35;
      const orb      = MeshBuilder.CreateSphere(`hpOrb_${i}`, { diameter: 0.42, segments: 8 }, this.scene);
      orb.position.set(x, baseY, z);
      const mat      = new StandardMaterial(`hpOrbMat_${i}`, this.scene);
      mat.diffuseColor  = new Color3(0.05, 0.4, 0.9);
      mat.emissiveColor = new Color3(0.1,  0.7, 1.0);
      orb.material = mat;
      this.glowLayer.addIncludedOnlyMesh(orb);
      const off = i * 0.8;
      this.scene.registerBeforeRender(() => {
        orb.position.y = baseY + Math.sin(performance.now() / 1000 * 1.5 + off) * 0.12;
      });
      this.hpOrbs.push(orb);
    }
  }

  private syncHPOrbs(): void {
    if (this.phase !== DuelPhase.DUEL) { this.hpOrbs.forEach(o => o.setEnabled(false)); return; }
    const t = performance.now() / 1000;
    for (let i = 0; i < this.hpOrbs.length; i++) {
      const alive = i < this.playerHP;
      this.hpOrbs[i].setEnabled(alive);
      if (alive) {
        const mat = this.hpOrbs[i].material as StandardMaterial;
        if (this.playerHP <= 2) {
          const p = 0.55 + 0.45 * Math.sin(t * 7);
          mat.emissiveColor = new Color3(p, 0.08, 0.08);
        } else {
          mat.emissiveColor = new Color3(0.1, 0.7, 1.0);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  POST-PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  private setupPostProcessing(): void {
    this.pipeline = new DefaultRenderingPipeline('duelPipeline', true, this.scene, [this.camera]);
    this.pipeline.bloomEnabled   = true;
    this.pipeline.bloomThreshold = 0.1;
    this.pipeline.bloomWeight    = 0.55;
    this.pipeline.bloomKernel    = 64;
    this.pipeline.bloomScale     = 0.5;
    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.vignetteEnabled = true;
    this.pipeline.imageProcessing.vignetteWeight  = 4.5;
    this.pipeline.chromaticAberrationEnabled = true;
    this.pipeline.chromaticAberration.aberrationAmount = 0;

    this.hitParticleTex = new DynamicTexture('hitParticleTex', { width: 32, height: 32 }, this.scene, false);
    const ctx  = this.hitParticleTex.getContext();
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    this.hitParticleTex.update();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HUD DOM
  // ═══════════════════════════════════════════════════════════════════════════

  private buildHUDOverlay(): void {
    this.hudOverlay = document.createElement('div');
    this.hudOverlay.id = 'mirror-duel-hud';
    this.hudOverlay.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      pointer-events:none; z-index:10;
      font-family:'Segoe UI',monospace; color:#fff;
    `;
    this.hudOverlay.innerHTML = `
      <div id="md-round" style="
        position:absolute; top:12px; left:50%; transform:translateX(-50%);
        font-size:11px; letter-spacing:5px; color:#9966ff;
        text-shadow:0 0 8px #6600cc;
      "></div>

      <div id="md-phase" style="
        position:absolute; top:28px; left:50%; transform:translateX(-50%);
        font-size:12px; letter-spacing:4px; text-transform:uppercase;
        color:#cc66ff; text-shadow:0 0 10px #9900ff;
      "></div>

      <div id="md-timer" style="
        position:absolute; top:44px; left:50%; transform:translateX(-50%);
        font-size:36px; font-weight:bold; letter-spacing:2px;
        color:#fff; text-shadow:0 0 15px #cc66ff;
      "></div>

      <div id="md-score" style="
        position:absolute; top:20px; right:30px;
        font-size:13px; color:#aaddff; text-shadow:0 0 8px #0088ff;
      ">SCORE <span id="md-score-val" style="font-size:22px;color:#fff">0</span></div>

      <div id="md-hp" style="
        position:absolute; top:20px; left:30px;
        font-size:22px; letter-spacing:4px;
      "></div>

      <div id="md-similarity" style="
        position:absolute; bottom:80px; left:50%; transform:translateX(-50%);
        font-size:11px; letter-spacing:3px; color:#cc66ff; text-align:center; display:none;
      ">
        RESSEMBLANCE CLONE
        <div style="width:200px;height:6px;background:rgba(255,255,255,0.15);border-radius:3px;margin:6px auto 0;">
          <div id="md-sim-bar" style="height:100%;width:0%;border-radius:3px;
            background:linear-gradient(90deg,#6600cc,#ff00ff);
            box-shadow:0 0 8px #ff00ff;transition:width 0.5s;"></div>
        </div>
        <div id="md-sim-pct" style="margin-top:4px;font-size:18px;color:#fff">0%</div>
      </div>

      <div id="md-clone-level" style="
        position:absolute; top:20px; left:50%; transform:translateX(-50%);
        font-size:10px; letter-spacing:3px; color:rgba(204,102,255,0.6);
        text-shadow:0 0 6px #6600cc; margin-top:70px;
      "></div>

      <div id="md-controls" style="
        position:absolute; bottom:20px; left:50%; transform:translateX(-50%);
        font-size:11px; color:rgba(255,255,255,0.4); letter-spacing:2px; text-align:center;
      ">WASD / FLÈCHES — DÉPLACER</div>

      <div id="md-analysis-overlay" style="
        display:none; position:absolute; top:50%; left:50%;
        transform:translate(-50%,-50%); text-align:center;
        background:rgba(8,4,18,0.94); border:1px solid #6600cc;
        border-radius:12px; padding:36px 56px;
        box-shadow:0 0 40px rgba(153,0,255,0.4);
      ">
        <div id="md-analysis-title" style="font-size:22px;letter-spacing:4px;color:#cc66ff;margin-bottom:16px"></div>
        <div id="md-analysis-body"  style="font-size:13px;line-height:2;color:#ddd"></div>
        <div id="md-analysis-countdown" style="margin-top:20px;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:2px">
          Prochain round dans 8s...
        </div>
        <div style="margin-top:8px;font-size:10px;color:rgba(255,255,255,0.25);letter-spacing:2px">[ESPACE] CONTINUER</div>
      </div>

      <div id="md-result-overlay" style="
        display:none; position:absolute; top:50%; left:50%;
        transform:translate(-50%,-50%); text-align:center;
        background:rgba(8,4,18,0.94); border:1px solid #6600cc;
        border-radius:12px; padding:40px 60px;
        box-shadow:0 0 40px rgba(153,0,255,0.4);
        pointer-events:all;
      ">
        <div id="md-result-title" style="font-size:28px;letter-spacing:4px;color:#cc66ff;margin-bottom:20px">RÉSULTAT FINAL</div>
        <div id="md-result-body"  style="font-size:14px;line-height:2;color:#ddd"></div>
        <div style="margin-top:28px;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:2px">
          [R] REJOUER &nbsp;|&nbsp; [ÉCHAP] RETOUR HUB
        </div>
      </div>
    `;
    document.body.appendChild(this.hudOverlay);
  }

  private updateHUD(): void {
    if (!this.hudOverlay) return;
    const cfg = ROUND_CONFIGS[this.currentRound - 1];

    const roundEl   = document.getElementById('md-round');
    const phaseEl   = document.getElementById('md-phase');
    const timerEl   = document.getElementById('md-timer');
    const hpEl      = document.getElementById('md-hp');
    const scoreVal  = document.getElementById('md-score-val');
    const simDiv    = document.getElementById('md-similarity');
    const simBar    = document.getElementById('md-sim-bar');
    const simPct    = document.getElementById('md-sim-pct');

    if (roundEl) roundEl.textContent = `ROUND ${this.currentRound} / 3  —  ${cfg.label}`;

    const cloneLevelEl = document.getElementById('md-clone-level');
    if (cloneLevelEl) {
      const lvl = this.gameState.cloneLevel;
      const mem = !this.gameState.isFirstSession();
      cloneLevelEl.textContent = mem
        ? `CLONE NIVEAU ${lvl} — MÉMOIRE CHARGÉE`
        : `CLONE NIVEAU ${lvl}`;
    }

    if (phaseEl) {
      const labels: Record<DuelPhase, string> = {
        [DuelPhase.INTRO]:       'NEXUS — MIRROR DUEL',
        [DuelPhase.OBSERVATION]: '● ECHO OBSERVE',
        [DuelPhase.TRANSITION]:  'ANALYSE EN COURS...',
        [DuelPhase.DUEL]:        'DUEL',
        [DuelPhase.ANALYSIS]:    'ANALYSE INTER-ROUND',
        [DuelPhase.RESULT]:      'FIN DE PARTIE',
      };
      phaseEl.textContent = labels[this.phase] ?? '';
    }

    if (timerEl) {
      if (this.phase === DuelPhase.OBSERVATION) {
        timerEl.textContent = Math.ceil(Math.max(0, cfg.observeTime - this.phaseTimer)).toString();
      } else if (this.phase === DuelPhase.DUEL) {
        timerEl.textContent = Math.ceil(Math.max(0, cfg.duelTime - this.phaseTimer)).toString();
      } else {
        timerEl.textContent = '';
      }
    }

    if (hpEl) {
      hpEl.textContent = '♥'.repeat(this.playerHP) + '♡'.repeat(Math.max(0, PLAYER_MAX_HP - this.playerHP));
      hpEl.style.color = this.playerHP <= 2 ? '#ff4444' : '#44aaff';
    }

    const totalSoFar = this.roundScores.reduce((s, v) => s + v, 0) + Math.floor(this.score);
    if (scoreVal) scoreVal.textContent = totalSoFar.toString();

    if (simDiv) {
      simDiv.style.display = this.phase === DuelPhase.DUEL ? 'block' : 'none';
      if (simBar) simBar.style.width = `${this.cloneSimilarityScore}%`;
      if (simPct) simPct.textContent  = `${this.cloneSimilarityScore}%`;
    }
  }

  private showRoundAnalysisScreen(): void {
    const overlay = document.getElementById('md-analysis-overlay');
    const title   = document.getElementById('md-analysis-title');
    const body    = document.getElementById('md-analysis-body');
    if (!overlay || !title || !body) return;

    const roundScore = this.roundScores[this.roundScores.length - 1] ?? 0;
    const style      = this.cloneBrain.getPlayerStyle();
    const accuracy   = Math.round(this.cloneBrain.getPredictionAccuracy() * 100);

    title.textContent = `ROUND ${this.currentRound} TERMINÉ`;
    body.innerHTML = `
      <div style="color:#aaffcc">Score du round : <strong style="color:#fff;font-size:18px">${roundScore}</strong></div>
      <div>Ressemblance clone : <strong style="color:#cc66ff">${this.cloneSimilarityScore}%</strong></div>
      <div>Précision IA : <strong style="color:#ff88cc">${accuracy}%</strong></div>
      <div style="color:#aaa;margin-top:8px">Style détecté : <em style="color:#ffcc66">${style}</em></div>
      <div style="color:#888;margin-top:8px;font-size:11px">
        Le clone retient tes patterns pour le round ${this.currentRound + 1}.
      </div>
    `;
    overlay.style.display = 'block';
    overlay.style.pointerEvents = 'all';

    this.echoAI.say(
      `Round ${this.currentRound} terminé. Score : ${roundScore}. Mon clone se souvient de tout. Prépare-toi au round ${this.currentRound + 1}.`,
      AdviceType.OBSERVATION
    );
  }

  private hideRoundAnalysisScreen(): void {
    const overlay = document.getElementById('md-analysis-overlay');
    if (overlay) { overlay.style.display = 'none'; overlay.style.pointerEvents = 'none'; }
  }

  private showResultScreen(): void {
    const overlay = document.getElementById('md-result-overlay');
    const body    = document.getElementById('md-result-body');
    if (!overlay || !body) return;

    const totalScore = this.roundScores.reduce((s, v) => s + v, 0);
    const survived   = this.playerHP > 0 && this.roundScores.length >= 3;
    const survivedMsg = survived
      ? `Tu as survécu les 3 rounds !`
      : `Rattrapé au round ${this.currentRound}.`;
    const style      = this.cloneBrain.getPlayerStyle();
    const accuracy   = Math.round(this.cloneBrain.getPredictionAccuracy() * 100);
    const sessions   = this.cloneBrain.getSessionCount();

    // Persistance
    const profile: BehavioralProfile = {
      moveRatio:       this.cloneBrain.getMoveRatio(),
      preferredSide:   this.cloneBrain.getPreferredSide(),
      aggressionScore: this.cloneBrain.getAggressionScore(),
      avgSpeed:        this.cloneBrain.getAvgSpeed(),
      playerStyle:     style,
    };
    this.gameState.endSession(totalScore, survived, profile);

    const roundBreakdown = this.roundScores.map((s, i) =>
      `<span style="color:#888;font-size:12px">Round ${i + 1} : ${s} pts</span>`
    ).join(' &nbsp;|&nbsp; ');

    const cloneLevel = this.gameState.cloneLevel;
    body.innerHTML = `
      <div style="color:#aaffcc;margin-bottom:8px">${survivedMsg}</div>
      <div>Score total : <strong style="color:#fff;font-size:22px">${totalScore}</strong></div>
      ${totalScore >= this.gameState.bestScore ? '<div style="color:#ffcc44;font-size:12px">★ NOUVEAU RECORD ★</div>' : ''}
      <div style="margin-top:6px;font-size:12px">${roundBreakdown}</div>
      <div style="margin-top:12px">Ressemblance clone : <strong style="color:#cc66ff">${this.cloneSimilarityScore}%</strong></div>
      <div>Précision de prédiction : <strong style="color:#ff88cc">${accuracy}%</strong></div>
      <div style="margin-top:12px;color:#aaa">Profil ECHO : <em style="color:#ffcc66">${style}</em></div>
      ${sessions > 1 ? `<div style="color:#888;font-size:12px;margin-top:4px">Session n°${this.gameState.totalSessions} — Clone niveau ${cloneLevel}.</div>` : ''}
    `;
    overlay.style.display = 'block';

    if (survived) {
      this.audioManager.playVictory();
      setTimeout(() => this.echoAI.say(`Impressionnant. Tu as survécu les 3 rounds. Score : ${totalScore}. Mon clone passe au niveau ${this.gameState.cloneLevel}.`, AdviceType.ENCOURAGEMENT), 500);
    } else {
      this.audioManager.playDefeat();
      setTimeout(() => this.echoAI.say(`Duel terminé. Score : ${totalScore}. Mon clone atteint ${accuracy}% de précision. Je me souviens de toi.`, AdviceType.OBSERVATION), 500);
    }
  }

  private hideResultScreen(): void {
    const overlay = document.getElementById('md-result-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DISPOSE
  // ═══════════════════════════════════════════════════════════════════════════

  public async dispose(): Promise<void> {
    if (this.hudOverlay?.parentNode) this.hudOverlay.parentNode.removeChild(this.hudOverlay);
    this.inputRecorder.stopRecording();
    this.dialogueBox.dispose();
    this.heatmap?.dispose();
    this.audioManager?.stopAmbience();
    this.pipeline?.dispose();
    this.hitParticleTex?.dispose();
    this.glowLayer.dispose();
    this.playerRoot?.dispose();
    this.cloneRoot?.dispose();
    await super.dispose();
  }
}
