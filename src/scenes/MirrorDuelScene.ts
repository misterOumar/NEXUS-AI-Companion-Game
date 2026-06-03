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
  DirectionalLight,
  ShadowGenerator,
  DefaultRenderingPipeline,
  ParticleSystem,
  DynamicTexture,
  SceneLoader,
  AbstractMesh,
  Observer,
  Scene,
  Texture,
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

  // ── Environnement arène
  private arenaDome:        Mesh | null = null;
  private pillarMeshes:     Mesh[] = [];
  private pillarLights:     PointLight[] = [];
  private decalMeshes:      Mesh[] = [];
  private wallMeshes:       Mesh[] = [];
  private arenaAnimObs:     Observer<Scene> | null = null;
  private shadowGen:        ShadowGenerator | null = null;

  // ── Lumières suivant les personnages
  private playerFollowLight: PointLight | null = null;
  private cloneFollowLight:  PointLight | null = null;

  // ── Scan observation (O4)
  private scanBeam:          Mesh | null = null;
  private scanRoot:          Mesh | null = null;
  private scanObs:           Observer<Scene> | null = null;

  // ── Aura clone par round (O1)
  private cloneAuraRing2:    Mesh | null = null;
  private cloneAuraRing3:    Mesh | null = null;
  private cloneAuraPs:       ParticleSystem | null = null;
  private cloneAuraPsTex:    DynamicTexture | null = null;

  // ── Particules ambiantes + trail (R5)
  private ambientPs:     ParticleSystem | null = null;
  private ambientPsTex:  DynamicTexture | null = null;
  private cloneTrailPs:  ParticleSystem | null = null;
  private cloneTrailTex: DynamicTexture | null = null;

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
  private hudOverlay!:    HTMLElement;
  private introOverlay:   HTMLDivElement | null = null;
  private pauseOverlay:   HTMLDivElement | null = null;
  private introTimers:    ReturnType<typeof setTimeout>[] = [];
  private isPaused:       boolean = false;
  private escListener!:   (e: KeyboardEvent) => void;

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

  /** Charge character.glb — matériaux GLB originaux conservés, couleur via lumières */
  private async loadCharacterModels(): Promise<void> {
    try {
      // Joueur
      const r1 = await SceneLoader.ImportMeshAsync('', '/models/', 'character.glb', this.scene);
      if (r1.meshes.length > 0) {
        const root = r1.meshes[0];
        root.name     = 'playerGLB';
        root.position = this.playerPos.clone();
        root.scaling  = new Vector3(0.9, 0.9, 0.9);
        r1.meshes.forEach(m => {
          if (m instanceof Mesh) this.shadowGen?.addShadowCaster(m);
        });
        this.playerRoot = root;
        this.playerMesh.setEnabled(false);
      }

      // Clone — second import du même fichier
      const r2 = await SceneLoader.ImportMeshAsync('', '/models/', 'character.glb', this.scene);
      if (r2.meshes.length > 0) {
        const root = r2.meshes[0];
        root.name     = 'cloneGLB';
        root.position = this.clonePos.clone();
        root.scaling  = new Vector3(0.9, 0.9, 0.9);
        // Légère teinte violette sur les matériaux existants du clone
        r2.meshes.forEach(m => {
          if (m instanceof Mesh && m.material instanceof StandardMaterial) {
            m.material.emissiveColor = new Color3(0.25, 0.0, 0.35);
          }
          if (m instanceof Mesh) this.shadowGen?.addShadowCaster(m);
        });
        this.cloneRoot = root;
        this.cloneMesh.setEnabled(false);
      }

    } catch (e) {
      console.warn('[MirrorDuel] character.glb non chargé, fallback capsule actif.', e);
    }
  }


  public async createScene(): Promise<void> {
    this.setupCamera();
    this.setupLighting();
    this.buildArena();
    this.buildArenaDecor();      // R1 + R3 : dôme + piliers
    this.buildPlayerMesh();
    this.buildCloneMesh();
    this.buildHPOrbs();
    this.buildScanEffect();       // O4
    this.buildAmbientParticles(); // R5
    this.buildCloneTrail();       // R5
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

    this.escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.phase === DuelPhase.DUEL) this.togglePause();
      else if (e.key === 'Escape' && this.isPaused)            this.togglePause();
    };
    document.addEventListener('keydown', this.escListener);

    this.startPhase(DuelPhase.INTRO);
    this.showIntroOverlay(); // R2
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BOUCLE PRINCIPALE
  // ═══════════════════════════════════════════════════════════════════════════

  public update(deltaTime: number): void {
    if (this.isPaused) return;

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
        // L'overlay d'intro gère le démarrage — pas de setTimeout automatique
        break;

      case DuelPhase.OBSERVATION:
        this.showScanEffect(); // O4
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
        this.hideScanEffect(); // O4
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
        this.introTimers.push(setTimeout(() => this.startPhase(DuelPhase.DUEL), 4000));
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
        // J1 : countdown 3-2-1 avant de débloquer le gameplay
        this.showDuelCountdown(() => {
          this.echoAI.say(
            this.currentRound === 1
              ? "Duel ! Esquive ton clone aussi longtemps que possible !"
              : this.currentRound === 2
                ? "Round 2 — le clone se souvient de toi. Change de stratégie !"
                : "Round 3 — MIROIR PARFAIT. Il te connaît mieux que toi-même.",
            AdviceType.CHALLENGE,
          );
        });
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
    if (this.duelFrozen) return; // J1 : bloqué pendant le countdown

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
      this.inputRecorder.startRecording();
      // O2 : flash du label du nouveau round
      const cfg = ROUND_CONFIGS[this.currentRound - 1];
      this.showPhaseFlash(`ROUND ${this.currentRound} — ${cfg.label}`, '#cc66ff', 1400, () => {
        this.startPhase(DuelPhase.OBSERVATION);
      });
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
    this.showScorePopup('-5', '#ff4444'); // J3

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
    this.showScorePopup('+3', '#00ff7f'); // J3
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

    // Changer la couleur de la lumière clone selon le round
    if (this.cloneFollowLight) {
      this.cloneFollowLight.diffuse    = e;
      this.cloneFollowLight.intensity  = 1.2 + (this.currentRound - 1) * 0.4;
    }
    this.updateCloneAura(e); // O1
  }

  private updateCloneAura(color: Color3): void {
    // Round 2+ : anneau orbitant supplémentaire
    if (this.currentRound >= 2 && !this.cloneAuraRing2) {
      this.cloneAuraRing2 = MeshBuilder.CreateTorus('cloneAura2', {
        diameter: 2.2, thickness: 0.07, tessellation: 48,
      }, this.scene);
      const m2 = new StandardMaterial('cloneAura2Mat', this.scene);
      m2.emissiveColor = color;
      this.cloneAuraRing2.material = m2;
      this.glowLayer.addIncludedOnlyMesh(this.cloneAuraRing2);
    } else if (this.cloneAuraRing2) {
      (this.cloneAuraRing2.material as StandardMaterial).emissiveColor = color;
    }

    // Round 3 : second anneau + particules de feu
    if (this.currentRound === 3) {
      if (!this.cloneAuraRing3) {
        this.cloneAuraRing3 = MeshBuilder.CreateTorus('cloneAura3', {
          diameter: 2.8, thickness: 0.05, tessellation: 64,
        }, this.scene);
        const m3 = new StandardMaterial('cloneAura3Mat', this.scene);
        m3.emissiveColor = new Color3(1.0, 0.55, 0.0);
        this.cloneAuraRing3.material = m3;
        this.glowLayer.addIncludedOnlyMesh(this.cloneAuraRing3);
      }
      if (!this.cloneAuraPs) {
        this.cloneAuraPsTex = new DynamicTexture('cloneAuraTex', { width: 16, height: 16 }, this.scene, false);
        const ctx = this.cloneAuraPsTex.getContext();
        const g   = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        g.addColorStop(0, 'rgba(255,150,0,1)'); g.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
        this.cloneAuraPsTex.update();

        this.cloneAuraPs = new ParticleSystem('cloneAura', 35, this.scene);
        this.cloneAuraPs.emitter         = this.clonePos.clone();
        this.cloneAuraPs.particleTexture = this.cloneAuraPsTex;
        this.cloneAuraPs.minEmitBox      = new Vector3(-0.3, 0, -0.3);
        this.cloneAuraPs.maxEmitBox      = new Vector3( 0.3, 0.8, 0.3);
        this.cloneAuraPs.color1          = new Color4(1.0, 0.5, 0.0, 0.7);
        this.cloneAuraPs.color2          = new Color4(1.0, 0.2, 0.0, 0.4);
        this.cloneAuraPs.colorDead       = new Color4(0.5, 0.0, 0.0, 0.0);
        this.cloneAuraPs.minSize         = 0.06; this.cloneAuraPs.maxSize      = 0.2;
        this.cloneAuraPs.minLifeTime     = 0.2;  this.cloneAuraPs.maxLifeTime  = 0.6;
        this.cloneAuraPs.emitRate        = 30;
        this.cloneAuraPs.direction1      = new Vector3(-0.5, 2, -0.5);
        this.cloneAuraPs.direction2      = new Vector3( 0.5, 4,  0.5);
        this.cloneAuraPs.minEmitPower    = 0.5; this.cloneAuraPs.maxEmitPower = 1.5;
        this.cloneAuraPs.gravity         = new Vector3(0, -1, 0);
        this.cloneAuraPs.start();
      }
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

    // Sync lumières personnages
    if (this.playerFollowLight) this.playerFollowLight.position.set(this.playerPos.x, this.playerPos.y + 1.5, this.playerPos.z);
    if (this.cloneFollowLight)  this.cloneFollowLight.position.set(this.clonePos.x,   this.clonePos.y + 1.5,  this.clonePos.z);

    // Sync trail clone (R5)
    if (this.cloneTrailPs) {
      (this.cloneTrailPs.emitter as Vector3).copyFrom(this.clonePos);
    }

    // Sync aura rings (O1)
    const t = performance.now() / 1000;
    if (this.cloneAuraRing2) {
      this.cloneAuraRing2.position.copyFrom(this.clonePos);
      this.cloneAuraRing2.rotation.x += 0.025;
      this.cloneAuraRing2.rotation.z += 0.018;
    }
    if (this.cloneAuraRing3) {
      this.cloneAuraRing3.position.copyFrom(this.clonePos);
      this.cloneAuraRing3.rotation.z = t * 0.8;
    }
    if (this.cloneAuraPs) {
      (this.cloneAuraPs.emitter as Vector3).copyFrom(this.clonePos);
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
    // Beta PI/3.8 ≈ 47° depuis le haut — on voit les murs et les personnages
    this.camera = new ArcRotateCamera('duelCamera', -Math.PI / 2, Math.PI / 3.8, 34, new Vector3(0, 1, 0), this.scene);
    this.camera.minZ = 0.1; this.camera.maxZ = 500;
    this.camera.lowerRadiusLimit = 34; this.camera.upperRadiusLimit = 34;
    this.camera.lowerBetaLimit   = Math.PI / 3.8;
    this.camera.upperBetaLimit   = Math.PI / 3.8;
  }

  private setupLighting(): void {
    // Lumière ambiante douce
    const ambient       = new HemisphericLight('duelAmbient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity   = 0.55;
    ambient.diffuse     = new Color3(0.7, 0.65, 0.9);
    ambient.groundColor = new Color3(0.1, 0.08, 0.18);

    // Lumière directionnelle principale + ombres
    const sun       = new DirectionalLight('duelSun', new Vector3(-0.4, -1, 0.3), this.scene);
    sun.position    = new Vector3(0, 20, 0);
    sun.diffuse     = new Color3(0.9, 0.85, 1.0);
    sun.intensity   = 0.9;

    this.shadowGen = new ShadowGenerator(1024, sun);
    this.shadowGen.useBlurExponentialShadowMap = true;
    this.shadowGen.blurScale   = 2;
    this.shadowGen.setDarkness(0.4);

    // Lumière centrale au plafond
    const center      = new PointLight('duelCenter', new Vector3(0, 7, 0), this.scene);
    center.diffuse    = new Color3(0.7, 0.5, 1.0);
    center.intensity  = 0.8; center.range = 32;

    // Lumière suivant le joueur (bleue)
    this.playerFollowLight = new PointLight('playerFL', this.playerPos.clone(), this.scene);
    this.playerFollowLight.diffuse    = new Color3(0.2, 0.7, 1.0);
    this.playerFollowLight.intensity  = 1.4;
    this.playerFollowLight.range      = 8;

    // Lumière suivant le clone (violette)
    this.cloneFollowLight = new PointLight('cloneFL', this.clonePos.clone(), this.scene);
    this.cloneFollowLight.diffuse    = new Color3(0.9, 0.2, 1.0);
    this.cloneFollowLight.intensity  = 1.2;
    this.cloneFollowLight.range      = 8;
  }

  private buildArena(): void {
    const WALL_H = 8;
    const T = '/textures/walls/MetalPlates017B_1K-PNG_';
    const TF = '/textures/floor/tiles/Tiles076_1K-PNG_';

    // ── Sol PBR texturé ───────────────────────────────────────────────────
    this.arenaFloor = MeshBuilder.CreateDisc('arenaFloor', { radius: ARENA_RADIUS, tessellation: 80 }, this.scene);
    this.arenaFloor.rotation.x = Math.PI / 2;
    this.arenaFloor.position.y = 0;
    this.arenaFloor.receiveShadows = true;

    const floorMat = new PBRMaterial('arenaFloorMat', this.scene);
    floorMat.metallic  = 0.15;
    floorMat.roughness = 0.8;
    floorMat.albedoColor = new Color3(0.18, 0.14, 0.22);
    try {
      const fc = new Texture(`${TF}Color.png`, this.scene); fc.uScale = 6; fc.vScale = 6;
      const fn = new Texture(`${TF}NormalGL.png`, this.scene); fn.uScale = 6; fn.vScale = 6;
      floorMat.albedoTexture = fc;
      floorMat.bumpTexture   = fn;
    } catch { /* textures optionnelles */ }
    this.arenaFloor.material = floorMat;

    // ── Mur circulaire (face intérieure) — texture MetalPlates ────────────
    const wall = MeshBuilder.CreateCylinder('arenaWall', {
      height:      WALL_H,
      diameter:    ARENA_RADIUS * 2,
      tessellation: 64,
      sideOrientation: Mesh.BACKSIDE,
    }, this.scene);
    wall.position.y = WALL_H / 2;
    wall.receiveShadows = true;

    const wallMat = new PBRMaterial('arenaWallMat', this.scene);
    wallMat.metallic  = 0.85;
    wallMat.roughness = 0.3;
    wallMat.albedoColor = new Color3(0.12, 0.10, 0.16);
    try {
      const wc = new Texture(`${T}Color.png`, this.scene); wc.uScale = 8; wc.vScale = 2;
      const wn = new Texture(`${T}NormalGL.png`, this.scene); wn.uScale = 8; wn.vScale = 2;
      const wa = new Texture(`${T}AmbientOcclusion.png`, this.scene); wa.uScale = 8; wa.vScale = 2;
      wallMat.albedoTexture          = wc;
      wallMat.bumpTexture            = wn;
      wallMat.ambientTexture         = wa;
    } catch { /* textures optionnelles */ }
    wall.material = wallMat;
    this.wallMeshes.push(wall);
    this.shadowGen?.addShadowCaster(wall);

    // ── Plafond PBR sombre ─────────────────────────────────────────────────
    const ceiling = MeshBuilder.CreateDisc('arenaCeiling', { radius: ARENA_RADIUS, tessellation: 64 }, this.scene);
    ceiling.rotation.x  = -Math.PI / 2;
    ceiling.position.y  = WALL_H;
    const ceilMat = new PBRMaterial('arenaCeilMat', this.scene);
    ceilMat.albedoColor = new Color3(0.06, 0.04, 0.10);
    ceilMat.metallic    = 0.6; ceilMat.roughness = 0.5;
    ceiling.material = ceilMat;
    this.wallMeshes.push(ceiling);

    // Panneaux lumineux au plafond
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const px = Math.cos(angle) * 5;
      const pz = Math.sin(angle) * 5;
      const panel = MeshBuilder.CreateBox(`ceilPanel_${i}`, { width: 3, height: 0.06, depth: 1 }, this.scene);
      panel.position.set(px, WALL_H - 0.05, pz);
      panel.rotation.y = angle;
      const pm = new StandardMaterial(`ceilPanelMat_${i}`, this.scene);
      pm.emissiveColor = new Color3(0.5, 0.4, 0.7);
      panel.material = pm;
      this.glowLayer.addIncludedOnlyMesh(panel);
      this.wallMeshes.push(panel);
    }

    // ── Anneau de base lumineux (indicateur de zone) ───────────────────────
    this.boundaryRing = MeshBuilder.CreateTorus('arenaRing', {
      diameter: ARENA_RADIUS * 2, thickness: 0.28, tessellation: 96,
    }, this.scene);
    this.boundaryRing.position.y = 0.14;
    const ringMat = new StandardMaterial('arenaRingMat', this.scene);
    ringMat.emissiveColor = new Color3(0.7, 0.2, 1.0);
    this.boundaryRing.material = ringMat;
    this.glowLayer.addIncludedOnlyMesh(this.boundaryRing);

    // Ligne de séparation centrale (joueur vs clone)
    const divider = MeshBuilder.CreateBox('divider', { width: 0.06, height: 0.05, depth: ARENA_RADIUS * 2 }, this.scene);
    divider.position.y = 0.025;
    const divMat = new StandardMaterial('dividerMat', this.scene);
    divMat.emissiveColor = new Color3(0.5, 0.15, 0.85); divMat.alpha = 0.55;
    divider.material = divMat;
    this.glowLayer.addIncludedOnlyMesh(divider);

    // Marqueurs de spawn
    this.buildSpawnMarker(new Vector3(0, 0.02, 10),  new Color3(0.2, 0.8, 1.0));
    this.buildSpawnMarker(new Vector3(0, 0.02, -10), new Color3(1.0, 0.2, 0.8));

    // Animation ring couleur
    this.arenaAnimObs = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      ringMat.emissiveColor = new Color3(
        0.5 + 0.2 * Math.sin(t * 0.5), 0.1,
        0.8 + 0.2 * Math.cos(t * 0.5),
      );
    });
  }

  // ─── Scan visuel observation (O4) ─────────────────────────────────────────

  private buildScanEffect(): void {
    // Bande scan longue et fine qui tourne autour de l'axe Y
    this.scanBeam = MeshBuilder.CreateBox('scanBeam', {
      width: ARENA_RADIUS - 0.5, height: 0.025, depth: 0.18,
    }, this.scene);
    this.scanBeam.position.x = (ARENA_RADIUS - 0.5) / 2;
    this.scanBeam.position.y = 0.04;
    const bm = new StandardMaterial('scanBeamMat', this.scene);
    bm.emissiveColor = new Color3(0.3, 0.9, 1.0);
    bm.alpha = 0.75;
    this.scanBeam.material = bm;
    this.glowLayer.addIncludedOnlyMesh(this.scanBeam);

    // Disque semi-transparent
    this.scanRoot = MeshBuilder.CreateDisc('scanDisc', {
      radius: ARENA_RADIUS - 0.5, tessellation: 64,
    }, this.scene);
    this.scanRoot.rotation.x = -Math.PI / 2;
    this.scanRoot.position.y = 0.02;
    const dm = new StandardMaterial('scanDiscMat', this.scene);
    dm.emissiveColor = new Color3(0.12, 0.5, 0.6);
    dm.alpha = 0.06;
    dm.backFaceCulling = false;
    this.scanRoot.material = dm;

    this.scanBeam.setEnabled(false);
    this.scanRoot.setEnabled(false);
  }

  private showScanEffect(): void {
    if (!this.scanBeam || !this.scanRoot) return;
    this.scanBeam.setEnabled(true);
    this.scanRoot.setEnabled(true);
    this.scanObs = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.scanBeam) return;
      const cfg      = ROUND_CONFIGS[this.currentRound - 1];
      const progress = Math.min(1, this.phaseTimer / cfg.observeTime);
      const angle    = progress * Math.PI * 2 * 1.5;
      this.scanBeam.rotation.y = angle;
      this.scanRoot!.rotation.y = angle;
    });
  }

  private hideScanEffect(): void {
    this.scanBeam?.setEnabled(false);
    this.scanRoot?.setEnabled(false);
    if (this.scanObs) {
      this.scene.onBeforeRenderObservable.remove(this.scanObs);
      this.scanObs = null;
    }
  }

  // ─── Particules ambiantes (R5) ────────────────────────────────────────────

  private buildAmbientParticles(): void {
    this.ambientPsTex = new DynamicTexture('ambientTex', { width: 16, height: 16 }, this.scene, false);
    const ctx = this.ambientPsTex.getContext();
    const g   = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(180,80,255,1)'); g.addColorStop(1, 'rgba(100,0,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
    this.ambientPsTex.update();

    this.ambientPs = new ParticleSystem('arenaAmbient', 120, this.scene);
    this.ambientPs.emitter      = new Vector3(0, 1, 0);
    this.ambientPs.minEmitBox   = new Vector3(-ARENA_RADIUS, 0, -ARENA_RADIUS);
    this.ambientPs.maxEmitBox   = new Vector3( ARENA_RADIUS, 0,  ARENA_RADIUS);
    this.ambientPs.particleTexture = this.ambientPsTex;
    this.ambientPs.color1       = new Color4(0.6, 0.2, 1.0, 0.20);
    this.ambientPs.color2       = new Color4(0.8, 0.4, 1.0, 0.12);
    this.ambientPs.colorDead    = new Color4(0.3, 0.0, 0.5, 0.0);
    this.ambientPs.minSize      = 0.04; this.ambientPs.maxSize      = 0.14;
    this.ambientPs.minLifeTime  = 3.5;  this.ambientPs.maxLifeTime  = 6.5;
    this.ambientPs.emitRate     = 18;
    this.ambientPs.direction1   = new Vector3(-0.1, 0.6, -0.1);
    this.ambientPs.direction2   = new Vector3( 0.1, 1.5,  0.1);
    this.ambientPs.minEmitPower = 0.05; this.ambientPs.maxEmitPower = 0.18;
    this.ambientPs.gravity      = new Vector3(0, 0, 0);
    this.ambientPs.start();
  }

  private buildCloneTrail(): void {
    this.cloneTrailTex = new DynamicTexture('cloneTrailTex', { width: 16, height: 16 }, this.scene, false);
    const ctx = this.cloneTrailTex.getContext();
    const g   = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(200,50,255,1)'); g.addColorStop(1, 'rgba(150,0,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
    this.cloneTrailTex.update();

    this.cloneTrailPs = new ParticleSystem('cloneTrail', 30, this.scene);
    this.cloneTrailPs.emitter         = this.clonePos.clone();
    this.cloneTrailPs.particleTexture = this.cloneTrailTex;
    this.cloneTrailPs.minEmitBox      = new Vector3(-0.1, 0, -0.1);
    this.cloneTrailPs.maxEmitBox      = new Vector3( 0.1, 0.5, 0.1);
    this.cloneTrailPs.color1          = new Color4(0.9, 0.2, 1.0, 0.65);
    this.cloneTrailPs.color2          = new Color4(0.6, 0.0, 0.8, 0.35);
    this.cloneTrailPs.colorDead       = new Color4(0.3, 0.0, 0.4, 0.0);
    this.cloneTrailPs.minSize         = 0.05; this.cloneTrailPs.maxSize      = 0.18;
    this.cloneTrailPs.minLifeTime     = 0.2;  this.cloneTrailPs.maxLifeTime  = 0.5;
    this.cloneTrailPs.emitRate        = 22;
    this.cloneTrailPs.direction1      = new Vector3(-0.2, 0.5, -0.2);
    this.cloneTrailPs.direction2      = new Vector3( 0.2, 1.0,  0.2);
    this.cloneTrailPs.minEmitPower    = 0.1; this.cloneTrailPs.maxEmitPower = 0.35;
    this.cloneTrailPs.gravity         = new Vector3(0, -0.5, 0);
    this.cloneTrailPs.start();
  }

  // ─── Décor 3D — dôme + piliers (R1 + R3) ─────────────────────────────────

  private buildArenaDecor(): void {
    this.buildArenaDome();
    this.buildArenaPillars();
  }

  private buildArenaDome(): void {
    this.arenaDome = MeshBuilder.CreateSphere('arenaDome', {
      diameter: 72,
      segments: 14,
      sideOrientation: Mesh.BACKSIDE,
    }, this.scene);
    this.arenaDome.position.y = 8;

    const mat = new StandardMaterial('arenaDomeMat', this.scene);
    mat.emissiveColor   = new Color3(0.04, 0.01, 0.10);
    mat.diffuseColor    = new Color3(0.02, 0.01, 0.05);
    mat.backFaceCulling = false;
    this.arenaDome.material = mat;

    // Anneaux horizontaux sur le dôme — effet grille néon
    const levels = [4, 12, 20, 28];
    for (const yOff of levels) {
      const y      = yOff;
      const halfH  = 36;  // rayon de la sphère
      const rSq    = halfH * halfH - (y - 8) * (y - 8);
      if (rSq <= 0) continue;
      const r = Math.sqrt(rSq);
      const ring = MeshBuilder.CreateTorus(`domeRing_${y}`, {
        diameter: r * 2, thickness: 0.12, tessellation: 80,
      }, this.scene);
      ring.position.y = y;
      const rm = new StandardMaterial(`domeRingMat_${y}`, this.scene);
      rm.emissiveColor = new Color3(0.10, 0.03, 0.25);
      rm.alpha = 0.40;
      ring.material = rm;
      this.decalMeshes.push(ring);
    }
  }

  private buildArenaPillars(): void {
    const count  = 8;
    const radius = ARENA_RADIUS + 2.5;
    const colors = [
      new Color3(0.2, 0.8, 1.0),
      new Color3(1.0, 0.2, 0.8),
      new Color3(0.5, 0.1, 1.0),
      new Color3(0.2, 1.0, 0.7),
    ];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x     = Math.cos(angle) * radius;
      const z     = Math.sin(angle) * radius;
      const color = colors[i % colors.length];

      // Corps pilier
      const pillar = MeshBuilder.CreateCylinder(`pillar_${i}`, {
        height: 9, diameterTop: 0.28, diameterBottom: 0.46, tessellation: 12,
      }, this.scene);
      pillar.position.set(x, 4.5, z);
      const pm = new PBRMaterial(`pillarMat_${i}`, this.scene);
      pm.albedoColor = new Color3(0.06, 0.04, 0.10);
      pm.metallic    = 0.85;
      pm.roughness   = 0.2;
      pillar.material = pm;
      this.pillarMeshes.push(pillar);

      // Bande lumineuse centrale
      const band = MeshBuilder.CreateCylinder(`pillarBand_${i}`, {
        height: 0.15, diameter: 0.50, tessellation: 12,
      }, this.scene);
      band.position.set(x, 4.5, z);
      const bm = new StandardMaterial(`bandMat_${i}`, this.scene);
      bm.emissiveColor = color;
      band.material = bm;
      this.glowLayer.addIncludedOnlyMesh(band);
      this.pillarMeshes.push(band);

      // Orbe au sommet
      const orb = MeshBuilder.CreateSphere(`pillarOrb_${i}`, { diameter: 0.5, segments: 8 }, this.scene);
      orb.position.set(x, 9.3, z);
      const om = new StandardMaterial(`orbMat_${i}`, this.scene);
      om.emissiveColor = color;
      orb.material = om;
      this.glowLayer.addIncludedOnlyMesh(orb);
      this.pillarMeshes.push(orb);

      // Lumière de l'orbe
      const light = new PointLight(`pillarLight_${i}`, new Vector3(x, 9.3, z), this.scene);
      light.diffuse   = color;
      light.intensity = 0.55;
      light.range     = 10;
      this.pillarLights.push(light);
    }
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
    // Boutons cliquables (O3)
    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'flex', gap: '16px', justifyContent: 'center',
      marginTop: '24px', pointerEvents: 'all',
    });
    const replayBtn = this.makePauseBtn('REJOUER',        '#cc66ff', () => this.restartGame());
    const hubBtn    = this.makePauseBtn('RETOUR AU HUB',  '#ff6666', () => this.returnToHub());
    btnRow.appendChild(replayBtn); btnRow.appendChild(hubBtn);
    body.appendChild(btnRow);

    const hint = document.createElement('div');
    Object.assign(hint.style, { marginTop: '10px', fontSize: '10px',
      color: 'rgba(255,255,255,0.22)', letterSpacing: '2px' });
    hint.textContent = '[R] REJOUER  |  [ÉCHAP] RETOUR HUB';
    body.appendChild(hint);

    overlay.style.display = 'block';

    if (survived) {
      this.audioManager.playVictory();
      this.introTimers.push(setTimeout(() => this.echoAI.say(`Impressionnant. Tu as survécu les 3 rounds. Score : ${totalScore}. Mon clone passe au niveau ${this.gameState.cloneLevel}.`, AdviceType.ENCOURAGEMENT), 500));
    } else {
      this.audioManager.playDefeat();
      this.introTimers.push(setTimeout(() => this.echoAI.say(`Duel terminé. Score : ${totalScore}. Mon clone atteint ${accuracy}% de précision. Je me souviens de toi.`, AdviceType.OBSERVATION), 500));
    }
  }

  private hideResultScreen(): void {
    const overlay = document.getElementById('md-result-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COUNTDOWN 3-2-1 (J1)
  // ═══════════════════════════════════════════════════════════════════════════

  private duelFrozen: boolean = false;

  private showDuelCountdown(callback: () => void): void {
    this.duelFrozen = true;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%,-50%)',
      fontSize: '8rem', fontWeight: 'bold',
      fontFamily: '"Courier New", monospace',
      color: '#fff', textShadow: '0 0 40px #cc66ff',
      pointerEvents: 'none', zIndex: '40',
      opacity: '0', transition: 'opacity 0.15s, transform 0.15s',
    });
    document.body.appendChild(el);

    const counts  = ['3', '2', '1', 'DUEL !'];
    const colors  = ['#cc66ff', '#cc66ff', '#cc66ff', '#00ff7f'];
    let i = 0;
    const next = () => {
      el.textContent = counts[i];
      el.style.color      = colors[i];
      el.style.textShadow = `0 0 40px ${colors[i]}`;
      el.style.opacity    = '1';
      el.style.transform  = 'translate(-50%,-50%) scale(1)';
      this.introTimers.push(setTimeout(() => {
        el.style.opacity   = '0';
        el.style.transform = 'translate(-50%,-50%) scale(1.35)';
        i++;
        if (i < counts.length) {
          this.introTimers.push(setTimeout(next, 180));
        } else {
          this.introTimers.push(setTimeout(() => {
            el.remove();
            this.duelFrozen = false;
            callback();
          }, 180));
        }
      }, 700));
    };
    this.introTimers.push(setTimeout(next, 80));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SCORE POPUP (J3)
  // ═══════════════════════════════════════════════════════════════════════════

  private showScorePopup(text: string, color: string): void {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed', top: '38%', left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '2rem', fontWeight: 'bold',
      fontFamily: '"Courier New", monospace',
      color, textShadow: `0 0 16px ${color}`,
      pointerEvents: 'none', zIndex: '35',
      opacity: '1', transition: 'opacity 0.5s, top 0.5s',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.top     = '32%';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 520);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FLASH DE PHASE (O2)
  // ═══════════════════════════════════════════════════════════════════════════

  private showPhaseFlash(label: string, color: string, duration = 1400, callback?: () => void): void {
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed', inset: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(5,0,18,0.88)',
      zIndex: '40', opacity: '0', transition: 'opacity 0.28s',
      fontFamily: '"Courier New", monospace', pointerEvents: 'none',
    });
    const text = document.createElement('div');
    text.textContent = label;
    Object.assign(text.style, {
      color, fontSize: '2.6rem', letterSpacing: '0.22em',
      textShadow: `0 0 40px ${color}`, fontWeight: 'bold',
    });
    flash.appendChild(text);
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '1';
      this.introTimers.push(setTimeout(() => {
        flash.style.opacity = '0';
        this.introTimers.push(setTimeout(() => { flash.remove(); callback?.(); }, 300));
      }, duration));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAUSE (O3)
  // ═══════════════════════════════════════════════════════════════════════════

  private togglePause(): void {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.audioManager.stopAmbience();
      this.showPauseOverlay();
    } else {
      if (this.phase === DuelPhase.DUEL) this.audioManager.startAmbience();
      this.pauseOverlay?.remove();
      this.pauseOverlay = null;
    }
  }

  private showPauseOverlay(): void {
    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(4,2,12,0.88)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: '45', fontFamily: '"Courier New", monospace',
      gap: '14px', pointerEvents: 'all',
    });
    const title = document.createElement('h2');
    title.textContent = '— PAUSE —';
    Object.assign(title.style, { color: '#cc66ff', fontSize: '1.6rem', letterSpacing: '0.3em', margin: '0 0 20px' });
    const resume = this.makePauseBtn('REPRENDRE', '#cc66ff', () => this.togglePause());
    const hub    = this.makePauseBtn('RETOUR AU HUB', '#ff6666', async () => {
      ov.remove();
      await SceneManager.getInstance().loadScene('HubScene');
    });
    const hint = document.createElement('p');
    hint.textContent = 'ESC pour reprendre';
    Object.assign(hint.style, { color: '#442255', fontSize: '0.8rem', margin: '8px 0 0' });
    ov.appendChild(title); ov.appendChild(resume); ov.appendChild(hub); ov.appendChild(hint);
    document.body.appendChild(ov);
    this.pauseOverlay = ov;
  }

  private makePauseBtn(label: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background: 'transparent', border: `2px solid ${color}`,
      color, fontSize: '0.95rem', letterSpacing: '0.15em',
      padding: '10px 36px', cursor: 'pointer',
      pointerEvents: 'all', minWidth: '220px', transition: 'background 0.2s, color 0.2s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = color; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = color; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INTRO OVERLAY (R2)
  // ═══════════════════════════════════════════════════════════════════════════

  private showIntroOverlay(): void {
    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(4,2,12,0.96)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: '50', fontFamily: '"Courier New", monospace', color: '#cc66ff',
    });

    const title = document.createElement('h1');
    title.textContent = 'MIRROR DUEL';
    Object.assign(title.style, {
      fontSize: '3.2rem', letterSpacing: '0.3em',
      color: '#cc66ff', textShadow: '0 0 35px #9900ff, 0 0 70px #6600cc55',
      margin: '0 0 8px',
    });

    const sub = document.createElement('p');
    sub.textContent = "Combat contre ton Clone IA — il apprend, il s'adapte, il te connaît";
    Object.assign(sub.style, { fontSize: '0.85rem', color: '#7744aa', margin: '0 0 32px', letterSpacing: '0.06em' });

    // Règles du jeu
    const rules = document.createElement('div');
    Object.assign(rules.style, { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '38px', fontSize: '0.84rem' });

    const items: [string, string, string, string][] = [
      ['●', '#00ccff',  `SCAN — ${ROUND_CONFIGS[0].observeTime}s obs + ${ROUND_CONFIGS[0].duelTime}s duel`,  "L'IA mémorise tes déplacements"],
      ['●', '#cc66ff',  `APPRENTISSAGE — ${ROUND_CONFIGS[1].observeTime}s + ${ROUND_CONFIGS[1].duelTime}s`, 'Le clone rejoue tes patterns'],
      ['●', '#ff6600',  `MIROIR PARFAIT — ${ROUND_CONFIGS[2].observeTime}s + ${ROUND_CONFIGS[2].duelTime}s`, 'Il te connaît mieux que toi-même'],
      ['◆', '#ffffff',  'WASD pour te déplacer', 'Esquive ton clone aussi longtemps que possible'],
    ];
    for (const [icon, color, label, desc] of items) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'flex-start', gap: '12px' });
      const ic = document.createElement('span');
      ic.textContent = icon; ic.style.color = color; ic.style.flexShrink = '0';
      const col = document.createElement('div');
      const lbl = document.createElement('div');
      lbl.textContent = label; lbl.style.color = color;
      const dsc = document.createElement('div');
      dsc.textContent = desc;
      Object.assign(dsc.style, { fontSize: '0.77rem', color: '#554477', marginTop: '2px' });
      col.appendChild(lbl); col.appendChild(dsc);
      row.appendChild(ic); row.appendChild(col);
      rules.appendChild(row);
    }

    const btn = document.createElement('button');
    btn.textContent = 'COMMENCER';
    Object.assign(btn.style, {
      background: 'transparent', border: '2px solid #cc66ff',
      color: '#cc66ff', fontSize: '1rem', letterSpacing: '0.2em',
      padding: '12px 48px', cursor: 'pointer',
      pointerEvents: 'all', transition: 'background 0.2s, color 0.2s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#cc66ff'; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#cc66ff'; });
    btn.addEventListener('click', () => {
      ov.style.opacity    = '0';
      ov.style.transition = 'opacity 0.45s';
      this.introTimers.push(setTimeout(() => {
        ov.remove();
        this.introOverlay = null;
        this.startPhase(DuelPhase.OBSERVATION);
      }, 460));
    });

    ov.appendChild(title);
    ov.appendChild(sub);
    ov.appendChild(rules);
    ov.appendChild(btn);
    document.body.appendChild(ov);
    this.introOverlay = ov;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DISPOSE
  // ═══════════════════════════════════════════════════════════════════════════

  public async dispose(): Promise<void> {
    // Timers + listeners
    this.introTimers.forEach(t => clearTimeout(t));
    this.introTimers = [];
    document.removeEventListener('keydown', this.escListener);
    this.introOverlay?.remove();
    this.pauseOverlay?.remove();

    // Observer animation anneau
    if (this.arenaAnimObs) this.scene.onBeforeRenderObservable.remove(this.arenaAnimObs);

    // Scan (O4)
    if (this.scanObs) this.scene.onBeforeRenderObservable.remove(this.scanObs);
    this.scanBeam?.dispose();
    this.scanRoot?.dispose();

    // Aura clone (O1)
    this.cloneAuraRing2?.dispose();
    this.cloneAuraRing3?.dispose();
    this.cloneAuraPs?.stop();
    this.cloneAuraPs?.dispose();
    this.cloneAuraPsTex?.dispose();

    // Particules (R5)
    this.ambientPs?.stop();
    this.ambientPs?.dispose();
    this.ambientPsTex?.dispose();
    this.cloneTrailPs?.stop();
    this.cloneTrailPs?.dispose();
    this.cloneTrailTex?.dispose();

    // Environnement arène
    this.arenaDome?.dispose();
    this.wallMeshes.forEach(m => m.dispose());
    this.pillarMeshes.forEach(m => m.dispose());
    this.pillarLights.forEach(l => l.dispose());
    this.decalMeshes.forEach(m => m.dispose());
    this.shadowGen?.dispose();
    this.playerFollowLight?.dispose();
    this.cloneFollowLight?.dispose();

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
