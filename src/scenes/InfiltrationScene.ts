import {
  Vector3,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  GlowLayer,
  PointLight,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  DefaultRenderingPipeline,
  ParticleSystem,
  DynamicTexture,
  Texture,
} from '@babylonjs/core';
import { AbstractScene }           from './AbstractScene';
import { ThirdPersonController }   from '@/player/ThirdPersonController';
import { EchoAI, AdviceType }      from '@/ai/EchoAI';
import { AudioManager }            from '@/core/AudioManager';
import { SceneManager }            from '@/core/SceneManager';
import {
  GuardAI,
  GUARD_ALARM_THRESHOLD,
  GUARD_SPEED,
} from '@/ai/GuardAI';

// ─── Config ───────────────────────────────────────────────────────────────────
const WALL_H         = 4.2;
const WALL_THICK     = 0.35;
const TERMINAL_COUNT = 4;
const EMP_CHARGES    = 3;
const EMP_RADIUS     = 7;
const EMP_STUN_DUR   = 6;
const HACK_DURATION  = 2.0;
const NODE_PICK_DIST = 1.8;
const EXIT_DIST      = 2.5;

const TW = '/textures/walls/MetalPlates017B_1K-PNG_';
const TF = '/textures/floor/tiles/Tiles076_1K-PNG_';

// ─── ECHO messages ────────────────────────────────────────────────────────────
const MSGS_DETECT = [
  'Garde en alerte. Recule ou utilise un EMP.',
  'Détection en cours. Trouve un angle mort.',
  'Le garde te voit. Bouge maintenant.',
];
const MSGS_ALARM = [
  'ALARME. Cache-toi immédiatement.',
  'Tous les gardes convergent. Écarte-toi des couloirs.',
  'Protocole d\'urgence déclenché. Reste dans les ombres.',
];
const MSGS_HACK = [
  'Terminal extrait. Continue l\'infiltration.',
  'Données récupérées. Reste discret.',
  'Nœud sécurisé. Encore un peu.',
];
const MSGS_EMP  = [
  'EMP activé. Tu as quelques secondes.',
  'Gardes neutralisés temporairement. Avance vite.',
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Carte : segments de murs ─────────────────────────────────────────────────
// Chaque entrée = [x1, z1, x2, z2] (coordonnées des extrémités d'un mur)
// Carte en croix : Hub central (16×16), 4 salles reliées par des couloirs de 4u
const WALL_SEGS: [number, number, number, number][] = [
  // ── Salle OUEST = ENTRY (-28..-14, -8..8) ─────────────────────────────
  [-28, -8, -28,  8],  // W
  [-28,  8, -14,  8],  // N
  [-28, -8, -14, -8],  // S
  [-14,  8, -14,  4],  // E-N (gap [-4,4] = corridor)
  [-14, -4, -14, -8],  // E-S

  // ── Couloir W→Hub (-14..-8, -4..4) ────────────────────────────────────
  [-14,  4,  -8,  4],  // N
  [-14, -4,  -8, -4],  // S

  // ── Hub (-8..8, -8..8) avec 4 ouvertures ─────────────────────────────
  [ -8,  8,  -4,  8],  // N-W (gap [-4,4] = N corridor)
  [  4,  8,   8,  8],  // N-E
  [ -8, -8,  -4, -8],  // S-W (gap [-4,4] = S corridor)
  [  4, -8,   8, -8],  // S-E
  [  8,  8,   8,  4],  // E-N (gap [-4,4] = E corridor)
  [  8, -4,   8, -8],  // E-S
  // W side already covered by corridor walls above

  // ── Couloir Hub→N (-4..4, 8..14) ──────────────────────────────────────
  [ -4,  8,  -4, 14],  // W
  [  4,  8,   4, 14],  // E

  // ── Salle NORD = EXIT (-8..8, 14..28) ─────────────────────────────────
  [ -8, 14,  -8, 28],  // W
  [  8, 14,   8, 28],  // E
  [ -8, 28,   8, 28],  // N
  [ -8, 14,  -4, 14],  // S-W
  [  4, 14,   8, 14],  // S-E

  // ── Couloir Hub→E (8..14, -4..4) ──────────────────────────────────────
  [  8,  4,  14,  4],  // N
  [  8, -4,  14, -4],  // S

  // ── Salle EST (14..28, -8..8) ─────────────────────────────────────────
  [ 14,  8,  28,  8],  // N
  [ 14, -8,  28, -8],  // S
  [ 28,  8,  28, -8],  // E
  [ 14,  8,  14,  4],  // W-N
  [ 14, -4,  14, -8],  // W-S

  // ── Couloir Hub→S (-4..4, -14..-8) ───────────────────────────────────
  [ -4, -8,  -4, -14], // W
  [  4, -8,   4, -14], // E

  // ── Salle SUD (SERVER ROOM, -8..8, -28..-14) ─────────────────────────
  [ -8,-14,  -8, -28], // W
  [  8,-14,   8, -28], // E
  [ -8,-28,   8, -28], // S (mur du fond)
  [ -8,-14,  -4, -14], // N-W
  [  4,-14,   8, -14], // N-E
];

// ─── Terminaux (positions X, Z) ───────────────────────────────────────────────
const TERMINAL_POS: [number, number][] = [
  [-21,  0],   // Salle entry
  [  0,  0],   // Hub
  [ 21,  0],   // Salle est
  [  0, 21],   // Salle nord (près exit)
];

// ─── Positions des gardes + waypoints ─────────────────────────────────────────
interface GuardDef {
  waypoints: [number, number][];  // [x, z] pairs
  rot: number;                    // rotation initiale
}
const GUARD_DEFS: GuardDef[] = [
  { // Hub — tourne autour du centre
    waypoints: [[5,5], [-5,5], [-5,-5], [5,-5]],
    rot: 0,
  },
  { // Salle est — patrouille E-W
    waypoints: [[18, 4], [26, 4], [26, -4], [18, -4]],
    rot: Math.PI / 2,
  },
  { // Salle nord — patrouille autour du terminal
    waypoints: [[4, 20], [-4, 20], [-4, 26], [4, 26]],
    rot: Math.PI,
  },
  { // Salle sud — garde l'exit
    waypoints: [[-3, -20], [3, -20], [3, -26], [-3, -26]],
    rot: 0,
  },
];

// ─── Position de sortie ───────────────────────────────────────────────────────
const EXIT_POS = new Vector3(0, 0, 22);

// ─── Scène ────────────────────────────────────────────────────────────────────

export class InfiltrationScene extends AbstractScene {

  private controller!:   ThirdPersonController;
  private echoAI:        EchoAI = EchoAI.getInstance();
  private echoUnsub!:    () => void;
  private audio:         AudioManager = AudioManager.getInstance();

  // Rendu
  private glowLayer!:    GlowLayer;
  private shadowGen!:    ShadowGenerator;

  // Environnement
  private wallMat!:      PBRMaterial;
  private floorMat!:     PBRMaterial;
  private ceilMat!:      PBRMaterial;
  private wallMeshes:    Mesh[] = [];
  private envMeshes:     Mesh[] = [];

  // Terminaux
  private terminals:     Mesh[] = [];
  private termLights:    PointLight[] = [];
  private termCollected: boolean[] = [];

  // Particule burst terminaux
  private burstTex!:     DynamicTexture;

  // Exit portal
  private exitMesh!:     Mesh;
  private exitDisc!:     Mesh;
  private exitLight!:    PointLight;

  // Gardes
  private guards:        GuardAI[] = [];

  // État
  private phase: 'intro' | 'playing' | 'alarm' | 'gameover' | 'complete' = 'intro';
  private globalAlert    = 0;
  private alarmTimer     = 0;
  private termHacked     = 0;
  private elapsed        = 0;
  private empCharges     = EMP_CHARGES;
  private hackTarget:    number | null = null;
  private hackProgress   = 0;
  // Score (O1)
  private alarmCount     = 0;
  // ECHO contextuel (O5)
  private echoContextCd  = 0;
  private stuckTimer     = 0;
  private lastPlayerPos: Vector3 | null = null;
  private echoTermSent   = [false, false, false];
  // Tension audio (O3)
  private guardTensionTimer = 0;
  // Particules hack (J1)
  private hackPs:        ParticleSystem | null = null;
  private hackPsTex:     DynamicTexture | null = null;
  // Prédiction patrouille ECHO (J4)
  private patrolWarnCd   = 0;

  // DOM
  private hudRoot!:      HTMLDivElement;
  private elTimer!:      HTMLSpanElement;
  private elTerms!:      HTMLSpanElement;
  private elEMP!:        HTMLSpanElement;
  private elAlert!:      HTMLDivElement;
  private elAlertBar!:   HTMLDivElement;
  private hackBarEl:     HTMLDivElement | null = null;
  private hackFillEl:    HTMLDivElement | null = null;
  private echoMsgEl!:    HTMLDivElement;
  private echoMsgTimer:  ReturnType<typeof setTimeout> | null = null;
  private introOverlay:  HTMLDivElement | null = null;
  private overlayTimers: ReturnType<typeof setTimeout>[] = [];
  private escListener!:  (e: KeyboardEvent) => void;
  private pauseOverlay:  HTMLDivElement | null = null;
  private isPaused       = false;
  private alarmFlashEl:     HTMLDivElement | null = null;
  // Minimap (R2)
  private minimapCanvas!:   HTMLCanvasElement;
  private minimapCtx!:      CanvasRenderingContext2D;
  private minimapTimer      = 0;
  // Indicateur terminal (R3)
  private proxIndicatorEl:  HTMLDivElement | null = null;
  // Countdown alarme (R4)
  private alarmCountdownEl: HTMLDivElement | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  public async init(): Promise<void> {
    await super.init();
    const ff = /Firefox/i.test(navigator.userAgent);
    this.scene.clearColor  = new Color4(0.01, 0.01, 0.02, 1);
    this.scene.ambientColor = new Color3(0.08, 0.06, 0.12);
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -20, 0);

    this.glowLayer = new GlowLayer('infGlow', this.scene, {
      blurKernelSize: ff ? 16 : 32, ldrMerge: true,
    });
    this.glowLayer.intensity = ff ? 0.65 : 0.9;
  }

  public async loadAssets(): Promise<void> {
    await super.loadAssets();
  }

  public async createScene(): Promise<void> {
    this.createMaterials();
    this.setupLighting();

    // Le controller doit être créé AVANT le post-processing pour que la caméra existe
    this.controller = new ThirdPersonController(this.scene, {
      moveSpeed:         4.5,
      runSpeed:          9,
      cameraDistance:    4.5,
      cameraMinDistance: 1.2,
      cameraHeight:      2,
      mouseSensitivity:  0.0022,
      collisionRadius:   0.3,
    });
    this.controller.setPosition(new Vector3(-21, 0, 0));

    const canvas = this.scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;
    this.controller.enablePointerLock(canvas);

    const cam = this.controller.getCamera();
    cam.beta = Math.PI / 2.6;

    // Limites de déplacement
    this.controller.setMovementBounds(
      new Vector3(-28.5, 0, -28.5),
      new Vector3(28.5, 8, 28.5),
    );

    this.buildEnvironment();
    this.buildTerminals();
    this.buildHackParticles(); // J1
    this.buildExitPortal();
    this.buildGuards();
    this.buildAmbientParticles();
    this.setupPostProcessing(); // caméra existe maintenant

    this.buildHUD();

    this.echoUnsub = this.echoAI.onMessage(a => this.showEchoMessage(a.message));

    this.escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.phase === 'playing') this.togglePause();
      else if (e.key === 'Escape' && this.isPaused)       this.togglePause();
    };
    document.addEventListener('keydown', this.escListener);

    this.showIntroOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  public update(deltaTime: number): void {
    if (this.isPaused || this.phase === 'gameover' || this.phase === 'complete') return;

    const frozen = this.phase === 'intro';
    if (!frozen) this.controller.update(deltaTime);

    const pos = this.controller.getPosition();

    if (this.phase === 'intro') return;

    this.elapsed += deltaTime;
    this.updateHUDTimer();

    // ── Gardes ────────────────────────────────────────────────────────────
    let alertSum = 0;
    for (const g of this.guards) {
      const { alertDelta, isInCone } = g.update(deltaTime, pos);
      g.alertLevel = Math.max(0, Math.min(1, g.alertLevel + alertDelta));
      alertSum    += g.alertLevel;

      if (isInCone && this.phase === 'playing' && g.alertLevel > 0.5) {
        this.echoAI.say(pick(MSGS_DETECT), AdviceType.WARNING);
      }
    }
    this.globalAlert = Math.min(1, alertSum / this.guards.length);

    // O3 — tension audio : niveau = max(alerte globale, proximité garde le plus proche)
    this.guardTensionTimer += deltaTime;
    if (this.guardTensionTimer >= 0.25) {
      this.guardTensionTimer = 0;
      let nearestDist = Infinity;
      for (const g of this.guards) {
        if (!g.isStunned()) {
          const d = Vector3.Distance(g.getPosition(), pos);
          if (d < nearestDist) nearestDist = d;
        }
      }
      const GUARD_VISION_D = 9;
      const proximityLevel = nearestDist < GUARD_VISION_D
        ? Math.max(0, 1 - (nearestDist - 1.5) / (GUARD_VISION_D - 1.5))
        : 0;
      this.audio.setDroneAlertLevel(Math.max(this.globalAlert, proximityLevel * 0.6));
    }
    this.elAlertBar.style.width = `${(this.globalAlert * 100).toFixed(1)}%`;
    this.elAlertBar.style.background = this.globalAlert > 0.7
      ? '#ff2200'
      : this.globalAlert > 0.3 ? '#ff8800' : '#00ccff';

    // Déclenchement alarme
    if (this.phase === 'playing' && this.globalAlert >= GUARD_ALARM_THRESHOLD) {
      this.triggerAlarm(pos);
    }

    // Mode alarme : timer de capture
    if (this.phase === 'alarm') {
      this.alarmTimer += deltaTime;
      this.updateAlarmFlash(this.alarmTimer);

      // Gardes convergent vers le joueur
      for (const g of this.guards) g.setChaseTarget(pos);

      for (const g of this.guards) {
        if (Vector3.Distance(g.getPosition(), pos) < 1.6) {
          this.triggerGameOver();
          return;
        }
      }

      // Si l'alerte globale redescend (joueur caché)
      if (this.globalAlert < 0.15 && this.alarmTimer > 3) {
        this.phase = 'playing';
        this.hideAlarmUI();
        this.alarmTimer = 0;
        this.echoAI.say('Danger écarté. Reprends l\'infiltration.', AdviceType.OBSERVATION);
      }
    }

    // ── Hack terminal ──────────────────────────────────────────────────────
    this.updateHackProgress(deltaTime, pos);
    this.updateProxIndicator(pos);     // R3

    // ── EMP (touche E) ─────────────────────────────────────────────────────
    if (this.inputManager.isKeyJustPressed('e') && this.empCharges > 0) {
      this.activateEMP(pos);
    }

    // ── Exit ───────────────────────────────────────────────────────────────
    if (this.termHacked >= TERMINAL_COUNT) {
      const dExit = Vector3.Distance(pos, EXIT_POS);
      if (dExit < EXIT_DIST) this.triggerComplete();
    }

    // ── ECHO contextuel (O5) + prédiction patrouille (J4) ───────────────────
    this.updateEchoContext(deltaTime, pos);
    this.updatePatrolWarning(deltaTime, pos);

    // ── Minimap refresh (R2) à 10fps ────────────────────────────────────────
    this.minimapTimer += deltaTime;
    if (this.minimapTimer >= 0.1) {
      this.minimapTimer = 0;
      this.drawMinimap();
    }

    this.inputManager.update();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HACKING
  // ═══════════════════════════════════════════════════════════════════════════

  private updateHackProgress(dt: number, pos: Vector3): void {
    let inRange = -1;
    for (let i = 0; i < TERMINAL_COUNT; i++) {
      if (this.termCollected[i]) continue;
      const tp = this.terminals[i].position;
      if (Math.sqrt((pos.x - tp.x) ** 2 + (pos.z - tp.z) ** 2) < NODE_PICK_DIST) {
        inRange = i;
        break;
      }
    }

    if (inRange < 0) {
      this.cancelHack();
      return;
    }

    if (this.hackTarget !== inRange) {
      this.hackTarget   = inRange;
      this.hackProgress = 0;
      if (!this.hackBarEl) this.createHackBar();
      this.hackBarEl!.style.display = 'block';
      // J1 — démarrer les particules sur le terminal
      if (this.hackPs) {
        (this.hackPs.emitter as Vector3).copyFrom(this.terminals[inRange].position);
        this.hackPs.start();
      }
    }

    this.hackProgress += dt;
    const pct = Math.min(1, this.hackProgress / HACK_DURATION) * 100;
    if (this.hackFillEl) this.hackFillEl.style.width = `${pct.toFixed(1)}%`;

    if (this.hackProgress >= HACK_DURATION) {
      this.collectTerminal(inRange);
      this.cancelHack();
    }
  }

  private cancelHack(): void {
    if (this.hackTarget === null) return;
    this.hackTarget   = null;
    this.hackProgress = 0;
    if (this.hackBarEl) this.hackBarEl.style.display = 'none';
    if (this.hackFillEl) this.hackFillEl.style.width = '0%';
    this.hackPs?.stop(); // J1
  }

  private collectTerminal(idx: number): void {
    this.termCollected[idx] = true;
    this.termHacked++;
    this.elTerms.textContent = `${this.termHacked}/${TERMINAL_COUNT}`;

    this.terminals[idx].setEnabled(false);
    this.termLights[idx].dispose();
    this.spawnCollectBurst(this.terminals[idx].position.clone());
    this.audio.playNodeCollect();

    const rem = TERMINAL_COUNT - this.termHacked;
    this.echoAI.say(
      pick(MSGS_HACK) + (rem > 0 ? ` ${rem} restant${rem > 1 ? 's' : ''}.` : ' Rejoins la sortie !'),
      AdviceType.ENCOURAGEMENT,
    );

    if (this.termHacked >= TERMINAL_COUNT) {
      this.exitMesh.setEnabled(true);
      this.exitDisc.setEnabled(true);
      this.exitLight.setEnabled(true);
      this.echoAI.say('Tous les terminaux hackés. Atteins la sortie au nord.', AdviceType.ENCOURAGEMENT);
      // Pulsation de la sortie
      this.scene.onBeforeRenderObservable.add(() => {
        const t = performance.now() / 1000;
        const mat = this.exitMesh.material as StandardMaterial;
        mat.emissiveColor = new Color3(0, 0.6 + Math.sin(t * 3) * 0.4, 0.3);
        this.exitLight.intensity = 1.0 + Math.sin(t * 3) * 0.6;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EMP
  // ═══════════════════════════════════════════════════════════════════════════

  private activateEMP(pos: Vector3): void {
    this.empCharges--;
    this.elEMP.textContent = '⚡'.repeat(this.empCharges) + '○'.repeat(EMP_CHARGES - this.empCharges);
    this.echoAI.say(pick(MSGS_EMP), AdviceType.TIP);

    for (const g of this.guards) {
      if (Vector3.Distance(g.getPosition(), pos) < EMP_RADIUS) {
        g.stun(EMP_STUN_DUR);
      }
    }

    // Visuel EMP : anneau cyan expansif
    const ring = MeshBuilder.CreateTorus('emp', { diameter: 0.2, thickness: 0.1, tessellation: 32 }, this.scene);
    ring.position.copyFrom(pos);
    ring.position.y = 0.1;
    const rm = new StandardMaterial('empMat', this.scene);
    rm.emissiveColor = new Color3(0.0, 0.9, 1.0);
    rm.alpha = 0.7;
    ring.material = rm;
    this.glowLayer.addIncludedOnlyMesh(ring);

    let t = 0;
    const obs = this.scene.onBeforeRenderObservable.add((s) => {
      t += s.deltaTime / 1000;
      const scale = 1 + t * EMP_RADIUS * 0.9;
      ring.scaling.setAll(scale);
      rm.alpha = Math.max(0, 0.7 - t * 0.9);
      if (t > 0.8) {
        this.scene.onBeforeRenderObservable.remove(obs);
        ring.dispose();
      }
    });
    this.audio.playWallOpen();

    // Si alarme active, la réinitialiser
    if (this.phase === 'alarm') {
      this.phase = 'playing';
      this.alarmTimer  = 0;
      this.globalAlert = 0;
      this.guards.forEach(g => { g.alertLevel = 0; });
      this.hideAlarmUI();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ALARME / FIN DE PARTIE
  // ═══════════════════════════════════════════════════════════════════════════

  private readonly ALARM_HIDE_TIME = 12; // secondes pour se cacher

  private triggerAlarm(pos: Vector3): void {
    if (this.phase === 'alarm') return;
    this.phase = 'alarm';
    this.alarmTimer = 0;
    this.alarmCount++;
    this.echoAI.say(pick(MSGS_ALARM), AdviceType.WARNING);
    this.audio.playCapture();

    // Vignette rouge (R4)
    this.alarmFlashEl = document.createElement('div');
    Object.assign(this.alarmFlashEl.style, {
      position: 'fixed', inset: '0',
      boxShadow: 'inset 0 0 80px 30px rgba(255,0,0,0.35)',
      pointerEvents: 'none', zIndex: '18',
      transition: 'box-shadow 0.3s',
    });
    document.body.appendChild(this.alarmFlashEl);

    // Countdown alarme visible (R4)
    if (this.alarmCountdownEl) this.alarmCountdownEl.style.display = 'flex';

    for (const g of this.guards) g.setChaseTarget(pos);
  }

  private updateAlarmFlash(t: number): void {
    if (!this.alarmFlashEl) return;
    const pulse = 0.3 + Math.abs(Math.sin(t * 4)) * 0.25;
    this.alarmFlashEl.style.boxShadow = `inset 0 0 90px 35px rgba(255,0,0,${pulse.toFixed(2)})`;

    // Mise à jour countdown (R4)
    const remaining = Math.max(0, this.ALARM_HIDE_TIME - t);
    const fill = document.getElementById('inf-alarm-fill');
    const sub  = document.getElementById('inf-alarm-sub');
    if (fill) fill.style.width = `${(remaining / this.ALARM_HIDE_TIME * 100).toFixed(0)}%`;
    if (sub)  sub.textContent  = `Cache-toi — ${Math.ceil(remaining)}s`;

    // Timeout alarme : si pas caché en ALARM_HIDE_TIME secondes → game over
    if (t >= this.ALARM_HIDE_TIME) {
      this.triggerGameOver();
    }
  }

  private hideAlarmUI(): void {
    if (this.alarmCountdownEl) this.alarmCountdownEl.style.display = 'none';
    this.alarmFlashEl?.remove();
    this.alarmFlashEl = null;
  }

  private triggerGameOver(): void {
    if (this.phase === 'gameover') return;
    this.phase = 'gameover';
    this.hideAlarmUI();
    this.audio.playDefeat();
    this.audio.setDroneAlertLevel(0);

    // J2 — shake caméra
    this.shakeCamera(0.08, 0.5);

    // O2 — flash rouge + texte CAPTURÉ animé avant l'overlay
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(200,0,0,0.55)',
      pointerEvents: 'none', zIndex: '60',
      transition: 'opacity 0.6s',
    });
    document.body.appendChild(flash);

    const captureLabel = document.createElement('div');
    captureLabel.textContent = 'CAPTURÉ';
    Object.assign(captureLabel.style, {
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%,-50%) scale(0.5)',
      fontSize: '5rem', fontWeight: 'bold', letterSpacing: '0.2em',
      fontFamily: '"Courier New", monospace',
      color: '#ff0000', textShadow: '0 0 40px #ff0000',
      pointerEvents: 'none', zIndex: '61',
      opacity: '0', transition: 'all 0.35s ease-out',
    });
    document.body.appendChild(captureLabel);

    requestAnimationFrame(() => {
      captureLabel.style.opacity   = '1';
      captureLabel.style.transform = 'translate(-50%,-50%) scale(1)';
    });

    this.overlayTimers.push(setTimeout(() => {
      flash.style.opacity = '0';
      captureLabel.style.opacity = '0';
      this.overlayTimers.push(setTimeout(() => {
        flash.remove();
        captureLabel.remove();
        this.showEndOverlay(false);
      }, 600));
    }, 700));
  }

  private triggerComplete(): void {
    if (this.phase === 'complete') return;
    this.phase = 'complete';
    this.audio.setDroneAlertLevel(0);
    this.alarmFlashEl?.remove();
    this.audio.playVictory();

    const m = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const s = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    this.echoAI.say(`Extraction réussie ! Temps : ${m}:${s}.`, AdviceType.ENCOURAGEMENT);
    this.showEndOverlay(true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTRUCTION ENVIRONNEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  private createMaterials(): void {
    this.wallMat = new PBRMaterial('infWallMat', this.scene);
    this.wallMat.albedoColor = new Color3(0.12, 0.10, 0.16);
    this.wallMat.metallic    = 0.85;
    this.wallMat.roughness   = 0.28;
    try {
      const wc = new Texture(`${TW}Color.png`, this.scene); wc.uScale = 2; wc.vScale = 1;
      const wn = new Texture(`${TW}NormalGL.png`, this.scene); wn.uScale = 2; wn.vScale = 1;
      this.wallMat.albedoTexture = wc;
      this.wallMat.bumpTexture   = wn;
    } catch { /* textures optionnelles */ }

    this.floorMat = new PBRMaterial('infFloorMat', this.scene);
    this.floorMat.albedoColor = new Color3(0.14, 0.12, 0.18);
    this.floorMat.metallic    = 0.20;
    this.floorMat.roughness   = 0.80;
    try {
      const fc = new Texture(`${TF}Color.png`, this.scene); fc.uScale = 4; fc.vScale = 4;
      const fn = new Texture(`${TF}NormalGL.png`, this.scene); fn.uScale = 4; fn.vScale = 4;
      this.floorMat.albedoTexture = fc;
      this.floorMat.bumpTexture   = fn;
    } catch { /* textures optionnelles */ }

    this.ceilMat = new PBRMaterial('infCeilMat', this.scene);
    this.ceilMat.albedoColor = new Color3(0.06, 0.04, 0.10);
    this.ceilMat.metallic    = 0.6;
    this.ceilMat.roughness   = 0.5;
  }

  private setupLighting(): void {
    const amb = new HemisphericLight('infAmb', new Vector3(0, 1, 0), this.scene);
    amb.intensity   = 0.45;
    amb.diffuse     = new Color3(0.55, 0.5, 0.75);
    amb.groundColor = new Color3(0.05, 0.04, 0.08);

    const sun = new DirectionalLight('infSun', new Vector3(-0.4, -1, 0.3), this.scene);
    sun.position  = new Vector3(0, 20, 0);
    sun.diffuse   = new Color3(0.85, 0.82, 1.0);
    sun.intensity = 0.7;

    this.shadowGen = new ShadowGenerator(1024, sun);
    this.shadowGen.useBlurExponentialShadowMap = true;
    this.shadowGen.blurScale   = 2;
    this.shadowGen.setDarkness(0.45);
  }

  private buildEnvironment(): void {
    // Sol global couvrant toutes les salles
    const groundSize = 62;
    const ground = MeshBuilder.CreateGround('infGround', { width: groundSize, height: groundSize }, this.scene);
    ground.position.y   = 0;
    ground.material     = this.floorMat;
    ground.receiveShadows = true;
    ground.checkCollisions = true;
    this.envMeshes.push(ground);

    // Plafond
    const ceil = MeshBuilder.CreateGround('infCeil', { width: groundSize, height: groundSize }, this.scene);
    ceil.position.y  = WALL_H;
    ceil.rotation.x  = Math.PI;
    ceil.material    = this.ceilMat;
    this.envMeshes.push(ceil);

    // Panneaux lumineux au plafond (dans chaque salle)
    const ceilLightPositions: [number, number][] = [
      [-21, 0], [0, 0], [21, 0], [0, 21], [0, -21],
    ];
    for (const [x, z] of ceilLightPositions) {
      const panel = MeshBuilder.CreateBox(`ceilPanel_${x}_${z}`, {
        width: 3.5, height: 0.06, depth: 1.2,
      }, this.scene);
      panel.position.set(x, WALL_H - 0.04, z);
      const pm = new StandardMaterial(`ceilPanelMat_${x}_${z}`, this.scene);
      pm.emissiveColor = new Color3(0.55, 0.45, 0.75);
      panel.material   = pm;
      this.glowLayer.addIncludedOnlyMesh(panel);
      this.envMeshes.push(panel);

      const pl = new PointLight(`roomLight_${x}_${z}`, new Vector3(x, WALL_H - 0.5, z), this.scene);
      pl.diffuse    = new Color3(0.7, 0.65, 0.9);
      pl.intensity  = 0.65;
      pl.range      = 14;
    }

    // R5 — lumière locale zone de spawn (entry)
    const spawnLight = new PointLight('spawnLight', new Vector3(-21, 3, 0), this.scene);
    spawnLight.diffuse    = new Color3(0.7, 0.6, 0.9);
    spawnLight.intensity  = 0.75;
    spawnLight.range      = 12;

    // Murs
    for (const [x1, z1, x2, z2] of WALL_SEGS) {
      this.buildWallSeg(x1, z1, x2, z2);
    }

    // Serveurs décoratifs dans les salles
    this.buildServerRacks();
  }

  private buildWallSeg(x1: number, z1: number, x2: number, z2: number): void {
    const cx  = (x1 + x2) / 2;
    const cz  = (z1 + z2) / 2;
    const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    if (len < 0.1) return;

    const angle = Math.atan2(x2 - x1, z2 - z1);
    const wall  = MeshBuilder.CreateBox(`wall_${x1}_${z1}`, {
      width: len, height: WALL_H, depth: WALL_THICK,
    }, this.scene);
    wall.position.set(cx, WALL_H / 2, cz);
    wall.rotation.y      = angle;
    wall.material        = this.wallMat;
    wall.checkCollisions = true;
    wall.receiveShadows  = true;
    this.shadowGen.addShadowCaster(wall);
    this.wallMeshes.push(wall);

    // Bande émissive au bas du mur
    const stripe = MeshBuilder.CreateBox(`stripe_${x1}_${z1}`, {
      width: len - 0.05, height: 0.06, depth: 0.04,
    }, this.scene);
    stripe.position.set(cx, 0.08, cz);
    stripe.rotation.y = angle;
    const sm = new StandardMaterial(`stripeMat_${x1}_${z1}`, this.scene);
    sm.emissiveColor = new Color3(0.15, 0.06, 0.35);
    sm.alpha = 0.7;
    stripe.material = sm;
    this.glowLayer.addIncludedOnlyMesh(stripe);
    this.envMeshes.push(stripe);
  }

  private buildServerRacks(): void {
    // Racks décoratifs dans les 4 grandes salles
    const rackPositions: [number, number, number][] = [
      [-25, 0,  5], [-25, 0, -5],   // entry W
      [ 23, 0,  6], [ 23, 0, -6],   // east E
      [ -5, 0, 25], [  5, 0, 25],   // north
      [ -5, 0,-25], [  5, 0,-25],   // south
    ];
    for (const [rx, _ry, rz] of rackPositions) {
      // Rack corps
      const rack = MeshBuilder.CreateBox(`rack_${rx}_${rz}`, {
        width: 0.55, height: 2.0, depth: 0.9,
      }, this.scene);
      rack.position.set(rx, 1.0, rz);
      const rm = new PBRMaterial(`rackMat_${rx}_${rz}`, this.scene);
      rm.albedoColor = new Color3(0.06, 0.05, 0.08);
      rm.metallic    = 0.8;
      rm.roughness   = 0.3;
      rack.material  = rm;
      this.shadowGen.addShadowCaster(rack);
      this.envMeshes.push(rack);

      // Lumières LED sur le rack
      for (let row = 0; row < 3; row++) {
        const led = MeshBuilder.CreateBox(`led_${rx}_${rz}_${row}`, {
          width: 0.45, height: 0.04, depth: 0.04,
        }, this.scene);
        led.position.set(rx, 0.5 + row * 0.55, rz + 0.46);
        const lm = new StandardMaterial(`ledMat_${rx}_${rz}_${row}`, this.scene);
        lm.emissiveColor = row % 2 === 0 ? new Color3(0.0, 0.8, 0.3) : new Color3(0.0, 0.4, 0.9);
        led.material     = lm;
        this.glowLayer.addIncludedOnlyMesh(led);
        this.envMeshes.push(led);
      }
    }
  }

  private buildTerminals(): void {
    this.burstTex = new DynamicTexture('burstTex', { width: 32, height: 32 }, this.scene, false);
    const ctx = this.burstTex.getContext();
    const g   = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,200,1)');
    g.addColorStop(1, 'rgba(200,180,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    this.burstTex.update();

    for (let i = 0; i < TERMINAL_COUNT; i++) {
      const [tx, tz] = TERMINAL_POS[i];

      // Piédestal
      const base = MeshBuilder.CreateCylinder(`termBase_${i}`, {
        height: 0.8, diameter: 0.6, tessellation: 12,
      }, this.scene);
      base.position.set(tx, 0.4, tz);
      const bm = new PBRMaterial(`termBaseMat_${i}`, this.scene);
      bm.albedoColor = new Color3(0.08, 0.07, 0.12);
      bm.metallic    = 0.85;
      bm.roughness   = 0.2;
      base.material  = bm;
      this.shadowGen.addShadowCaster(base);
      this.envMeshes.push(base);

      // Cristal de données (sphère émissive)
      const orb = MeshBuilder.CreateSphere(`term_${i}`, { diameter: 0.55, segments: 12 }, this.scene);
      orb.position.set(tx, 1.05, tz);
      const om = new StandardMaterial(`termMat_${i}`, this.scene);
      om.emissiveColor = new Color3(0.9, 0.75, 0.0);
      orb.material     = om;
      this.glowLayer.addIncludedOnlyMesh(orb);
      this.terminals.push(orb);
      this.termCollected.push(false);
      this.shadowGen.addShadowCaster(orb);

      // Lumière du terminal
      const light = new PointLight(`termLight_${i}`, new Vector3(tx, 1.8, tz), this.scene);
      light.diffuse    = new Color3(1.0, 0.85, 0.0);
      light.intensity  = 0.6;
      light.range      = 5;
      this.termLights.push(light);
    }

    // Animation de flottement
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (let i = 0; i < this.terminals.length; i++) {
        if (this.termCollected[i]) continue;
        this.terminals[i].position.y = 1.05 + Math.sin(t * 2 + i * 1.2) * 0.1;
        this.terminals[i].rotation.y = t * 0.8;
      }
    });
  }

  private buildExitPortal(): void {
    // Portail de sortie (salle nord)
    this.exitMesh = MeshBuilder.CreateTorus('exitPortal', {
      diameter: 3.2, thickness: 0.25, tessellation: 64,
    }, this.scene);
    this.exitMesh.position.set(EXIT_POS.x, 2.0, EXIT_POS.z);
    this.exitMesh.rotation.x = Math.PI / 2;
    const em = new StandardMaterial('exitPortalMat', this.scene);
    em.emissiveColor = new Color3(0.0, 0.7, 0.35);
    this.exitMesh.material = em;
    this.glowLayer.addIncludedOnlyMesh(this.exitMesh);
    this.exitMesh.setEnabled(false);

    // Disc central
    this.exitDisc = MeshBuilder.CreateDisc('exitDiscMesh', { radius: 1.3, tessellation: 48 }, this.scene);
    this.exitDisc.position.set(EXIT_POS.x, 2.0, EXIT_POS.z);
    this.exitDisc.rotation.x = Math.PI / 2;
    const dm = new StandardMaterial('exitDiscMat', this.scene);
    dm.emissiveColor   = new Color3(0.0, 0.5, 0.25);
    dm.alpha           = 0.5;
    dm.backFaceCulling = false;
    this.exitDisc.material = dm;
    this.exitDisc.setEnabled(false);

    this.exitLight = new PointLight('exitLight', EXIT_POS.add(new Vector3(0, 2, 0)), this.scene);
    this.exitLight.diffuse    = new Color3(0.0, 1.0, 0.5);
    this.exitLight.intensity  = 0;
    this.exitLight.range      = 10;
    this.exitLight.setEnabled(false);
  }

  private buildGuards(): void {
    for (const def of GUARD_DEFS) {
      const wp = def.waypoints.map(([x, z]) => new Vector3(x, 0.9, z));
      const g  = new GuardAI(this.scene, this.glowLayer, wp, def.rot);
      this.shadowGen.addShadowCaster(g['bodyMesh'] as Mesh);
      this.guards.push(g);
    }
  }

  private buildAmbientParticles(): void {
    const tex = new DynamicTexture('ambTex', { width: 16, height: 16 }, this.scene, false);
    const ctx = tex.getContext();
    const g   = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(140,60,200,1)'); g.addColorStop(1, 'rgba(80,20,150,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
    tex.update();

    const ps = new ParticleSystem('infAmbient', 100, this.scene);
    ps.emitter    = new Vector3(0, 0.5, 0);
    ps.minEmitBox = new Vector3(-30, 0, -30);
    ps.maxEmitBox = new Vector3( 30, 0,  30);
    ps.particleTexture = tex;
    ps.color1          = new Color4(0.5, 0.2, 0.9, 0.18);
    ps.color2          = new Color4(0.7, 0.3, 1.0, 0.10);
    ps.colorDead       = new Color4(0.2, 0.0, 0.4, 0.0);
    ps.minSize         = 0.04; ps.maxSize     = 0.12;
    ps.minLifeTime     = 4;    ps.maxLifeTime = 8;
    ps.emitRate        = 14;
    ps.direction1      = new Vector3(-0.05, 0.4, -0.05);
    ps.direction2      = new Vector3( 0.05, 1.2,  0.05);
    ps.minEmitPower    = 0.04; ps.maxEmitPower = 0.14;
    ps.gravity         = new Vector3(0, 0, 0);
    ps.start();
  }

  // ─── Particules hack en cours (J1) ────────────────────────────────────────

  private buildHackParticles(): void {
    this.hackPsTex = new DynamicTexture('hackPsTex', { width: 16, height: 16 }, this.scene, false);
    const ctx = this.hackPsTex.getContext();
    const g   = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,220,50,1)'); g.addColorStop(1, 'rgba(200,140,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
    this.hackPsTex.update();

    this.hackPs = new ParticleSystem('hackPs', 30, this.scene);
    this.hackPs.emitter         = new Vector3(0, 0, 0);
    this.hackPs.particleTexture = this.hackPsTex;
    this.hackPs.minEmitBox      = new Vector3(-0.12, 0, -0.12);
    this.hackPs.maxEmitBox      = new Vector3( 0.12, 0,  0.12);
    this.hackPs.color1          = new Color4(1.0, 0.9, 0.1, 0.9);
    this.hackPs.color2          = new Color4(1.0, 0.6, 0.0, 0.6);
    this.hackPs.colorDead       = new Color4(0.6, 0.3, 0.0, 0.0);
    this.hackPs.minSize         = 0.04; this.hackPs.maxSize      = 0.15;
    this.hackPs.minLifeTime     = 0.4;  this.hackPs.maxLifeTime  = 0.9;
    this.hackPs.emitRate        = 20;
    this.hackPs.direction1      = new Vector3(-0.3, 1.5, -0.3);
    this.hackPs.direction2      = new Vector3( 0.3, 3.0,  0.3);
    this.hackPs.minEmitPower    = 0.2; this.hackPs.maxEmitPower = 0.6;
    this.hackPs.gravity         = new Vector3(0, -0.5, 0);
    // Ne démarre pas encore — piloté par updateHackProgress
  }

  private spawnCollectBurst(pos: Vector3): void {
    const ps = new ParticleSystem('burst', 40, this.scene);
    ps.emitter         = pos;
    ps.particleTexture = this.burstTex;
    ps.minEmitBox      = new Vector3(-0.1, 0, -0.1);
    ps.maxEmitBox      = new Vector3( 0.1, 0.1, 0.1);
    ps.color1          = new Color4(1.0, 0.9, 0.1, 1.0);
    ps.color2          = new Color4(1.0, 0.6, 0.0, 0.8);
    ps.colorDead       = new Color4(0.6, 0.3, 0.0, 0.0);
    ps.minSize         = 0.07; ps.maxSize     = 0.22;
    ps.minLifeTime     = 0.2;  ps.maxLifeTime = 0.6;
    ps.emitRate        = 300;
    ps.direction1      = new Vector3(-2, 3, -2);
    ps.direction2      = new Vector3( 2, 6,  2);
    ps.minEmitPower    = 2; ps.maxEmitPower = 6;
    ps.gravity         = new Vector3(0, -8, 0);
    ps.start();
    setTimeout(() => { ps.stop(); }, 100);
    setTimeout(() => { ps.dispose(); }, 800);
  }

  private setupPostProcessing(): void {
    const ff = /Firefox/i.test(navigator.userAgent);
    const pipeline = new DefaultRenderingPipeline('infPipeline', true, this.scene, [this.controller.getCamera()]);
    pipeline.bloomEnabled    = true;
    pipeline.bloomThreshold  = ff ? 0.28 : 0.12;
    pipeline.bloomWeight     = ff ? 0.3  : 0.5;
    pipeline.bloomKernel     = 64;
    pipeline.bloomScale      = 0.5;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight  = 4.5;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HUD
  // ═══════════════════════════════════════════════════════════════════════════

  private buildHUD(): void {
    this.hudRoot = document.createElement('div');
    Object.assign(this.hudRoot.style, {
      position: 'fixed', inset: '0',
      pointerEvents: 'none', zIndex: '20',
      fontFamily: '"Courier New", monospace',
    });
    document.body.appendChild(this.hudRoot);

    // Barre du haut
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 22px',
      background: 'rgba(0,0,0,0.6)',
      borderBottom: '1px solid rgba(80,40,130,0.5)',
    });
    this.hudRoot.appendChild(bar);

    const makeBlock = (label: string, value: string, color = '#7ec8e3'): [HTMLDivElement, HTMLSpanElement] => {
      const b = document.createElement('div');
      Object.assign(b.style, { textAlign: 'center', minWidth: '90px' });
      const lbl = document.createElement('div');
      lbl.textContent = label;
      Object.assign(lbl.style, { fontSize: '10px', color: '#4a5580', marginBottom: '2px', letterSpacing: '0.1em' });
      const val = document.createElement('span');
      val.textContent = value;
      Object.assign(val.style, { fontSize: '15px', fontWeight: 'bold', color, letterSpacing: '0.05em' });
      b.appendChild(lbl); b.appendChild(val);
      return [b, val];
    };

    const [timerB, timerV] = makeBlock('TEMPS', '00:00');
    const [termB, termV]   = makeBlock('TERMINAUX', `0/${TERMINAL_COUNT}`, '#ccbb00');
    const [empB, empV]     = makeBlock('EMP  [E]', '⚡⚡⚡', '#00ccff');

    this.elTimer = timerV;
    this.elTerms = termV;
    this.elEMP   = empV;

    bar.appendChild(timerB);
    bar.appendChild(termB);
    bar.appendChild(empB);

    // Barre de détection (bas centre)
    this.elAlert = document.createElement('div');
    Object.assign(this.elAlert.style, {
      position: 'fixed', bottom: '60px', left: '50%',
      transform: 'translateX(-50%)',
      width: '220px', fontFamily: '"Courier New", monospace',
      textAlign: 'center', pointerEvents: 'none', zIndex: '22',
    });
    const alertLabel = document.createElement('div');
    alertLabel.textContent = 'DÉTECTION';
    Object.assign(alertLabel.style, { fontSize: '10px', color: '#884444', letterSpacing: '0.15em', marginBottom: '4px' });
    const alertTrack = document.createElement('div');
    Object.assign(alertTrack.style, {
      height: '6px', background: 'rgba(255,255,255,0.12)',
      borderRadius: '3px', overflow: 'hidden',
    });
    this.elAlertBar = document.createElement('div');
    Object.assign(this.elAlertBar.style, {
      height: '100%', width: '0%', borderRadius: '3px',
      background: '#00ccff', transition: 'width 0.15s, background 0.3s',
    });
    alertTrack.appendChild(this.elAlertBar);
    this.elAlert.appendChild(alertLabel);
    this.elAlert.appendChild(alertTrack);
    document.body.appendChild(this.elAlert);

    // R3 — indicateur terminal à portée (affiché entre 2.5u et 1.8u)
    this.proxIndicatorEl = document.createElement('div');
    Object.assign(this.proxIndicatorEl.style, {
      position: 'fixed', bottom: '110px', left: '50%',
      transform: 'translateX(-50%)',
      color: '#ffdd44', fontSize: '11px', letterSpacing: '0.18em',
      fontFamily: '"Courier New", monospace',
      pointerEvents: 'none', zIndex: '24',
      opacity: '0', transition: 'opacity 0.2s',
      textAlign: 'center',
    });
    this.proxIndicatorEl.textContent = '◆ TERMINAL À PORTÉE — RESTER IMMOBILE';
    document.body.appendChild(this.proxIndicatorEl);

    // R4 — countdown alarme (caché par défaut)
    this.alarmCountdownEl = document.createElement('div');
    Object.assign(this.alarmCountdownEl.style, {
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%,-50%)',
      display: 'none', flexDirection: 'column', alignItems: 'center', gap: '8px',
      fontFamily: '"Courier New", monospace', pointerEvents: 'none', zIndex: '30',
    });
    const alarmTitle = document.createElement('div');
    alarmTitle.textContent = '⚠ ALARME ACTIVE';
    Object.assign(alarmTitle.style, {
      fontSize: '1.4rem', letterSpacing: '0.2em', color: '#ff2200',
      textShadow: '0 0 20px #ff0000', fontWeight: 'bold',
    });
    const alarmSub = document.createElement('div');
    alarmSub.id = 'inf-alarm-sub';
    alarmSub.textContent = 'Cache-toi pour annuler';
    Object.assign(alarmSub.style, { fontSize: '0.85rem', color: '#ff8888', letterSpacing: '0.1em' });
    const alarmTrack = document.createElement('div');
    Object.assign(alarmTrack.style, {
      width: '200px', height: '5px', background: 'rgba(255,50,50,0.2)',
      borderRadius: '3px', overflow: 'hidden',
    });
    const alarmFill = document.createElement('div');
    alarmFill.id = 'inf-alarm-fill';
    Object.assign(alarmFill.style, {
      height: '100%', width: '100%', borderRadius: '3px',
      background: 'linear-gradient(90deg,#ff0000,#ff6600)',
      transition: 'width 0.2s',
    });
    alarmTrack.appendChild(alarmFill);
    this.alarmCountdownEl.appendChild(alarmTitle);
    this.alarmCountdownEl.appendChild(alarmSub);
    this.alarmCountdownEl.appendChild(alarmTrack);
    document.body.appendChild(this.alarmCountdownEl);

    // ECHO toast
    this.echoMsgEl = document.createElement('div');
    Object.assign(this.echoMsgEl.style, {
      position: 'fixed', bottom: '90px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,5,20,0.9)', border: '1px solid #33007755',
      borderRadius: '6px', color: '#aa88ff', padding: '9px 22px',
      fontSize: '13px', letterSpacing: '0.05em',
      opacity: '0', transition: 'opacity 0.3s',
      pointerEvents: 'none', zIndex: '25',
      maxWidth: '520px', textAlign: 'center', whiteSpace: 'nowrap',
    });
    document.body.appendChild(this.echoMsgEl);

    // R2 — minimap
    this.buildMinimap();
  }

  // ─── ECHO contextuel (O5) ─────────────────────────────────────────────────

  private updateEchoContext(dt: number, pos: Vector3): void {
    this.echoContextCd = Math.max(0, this.echoContextCd - dt);
    if (this.echoContextCd > 0) return;

    // Joueur bloqué (ne bouge presque plus depuis 10s)
    if (this.lastPlayerPos) {
      const moved = Vector3.Distance(pos, this.lastPlayerPos);
      if (moved < 0.4) {
        this.stuckTimer += dt;
        if (this.stuckTimer >= 10) {
          this.echoAI.say(
            this.empCharges > 0
              ? 'Tu sembles bloqué. Un EMP peut créer une fenêtre de passage.'
              : 'Bloqué. Attends que le garde tourne le dos, puis traverse rapidement.',
            AdviceType.TIP,
          );
          this.stuckTimer    = 0;
          this.echoContextCd = 22;
          return;
        }
      } else {
        this.stuckTimer = 0;
      }
    }
    this.lastPlayerPos = pos.clone();

    // Progression par palier de terminaux (une seule fois chacun)
    const hints: [number, string][] = [
      [1, `1 terminal extrait. Reste discret — les gardes surveillent plus attentivement.`],
      [2, `${TERMINAL_COUNT - 2} terminaux restants. Utilise les racks comme couverture.`],
      [3, `Dernier terminal. La sortie apparaîtra au nord dès qu'il est hacké.`],
    ];
    for (let i = 0; i < hints.length; i++) {
      const [threshold, msg] = hints[i];
      if (this.termHacked >= threshold && !this.echoTermSent[i]) {
        this.echoTermSent[i] = true;
        this.echoAI.say(msg, AdviceType.OBSERVATION);
        this.echoContextCd = 8;
        return;
      }
    }

    // Alerte modérée mais pas alarme
    if (this.globalAlert > 0.35 && this.globalAlert < GUARD_ALARM_THRESHOLD && this.phase === 'playing') {
      this.echoAI.say('Alerte modérée. Recule ou cache-toi derrière un serveur.', AdviceType.WARNING);
      this.echoContextCd = 18;
      return;
    }

    // EMP faible
    if (this.empCharges === 1 && this.termHacked < TERMINAL_COUNT && !this.echoTermSent[0]) {
      this.echoAI.say('Dernière charge EMP. Utilise-la uniquement si indispensable.', AdviceType.TIP);
      this.echoContextCd = 30;
    }
  }

  // ─── Prédiction patrouille ECHO (J4) ──────────────────────────────────────

  private updatePatrolWarning(dt: number, pos: Vector3): void {
    this.patrolWarnCd = Math.max(0, this.patrolWarnCd - dt);
    // Ne déclenche pas si un autre hint ECHO vient d'être envoyé
    if (this.patrolWarnCd > 0 || this.echoContextCd > 5) return;

    let bestTimeToPlayer = Infinity;
    for (const g of this.guards) {
      if (g.isStunned()) continue;

      const gPos    = g.getPosition();
      const nextWp  = g.getNextWaypoint();
      const distNow = Vector3.Distance(gPos, pos);

      // Le prochain waypoint est-il significativement plus proche du joueur ?
      const distWpToPlayer = Vector3.Distance(nextWp, pos);
      if (distWpToPlayer >= 8 || distWpToPlayer >= distNow) continue;

      // Estimation : temps pour le garde d'atteindre son prochain waypoint
      const timeToWp = g.getDistToNextWaypoint() / GUARD_SPEED;
      if (timeToWp < bestTimeToPlayer) bestTimeToPlayer = timeToWp;
    }

    // Avertir uniquement si le garde arrive dans 3-7 secondes
    if (bestTimeToPlayer >= 3 && bestTimeToPlayer <= 7) {
      const sec = Math.ceil(bestTimeToPlayer);
      this.echoAI.say(
        `Un garde approche de ta position dans environ ${sec}s. Trouve une couverture.`,
        AdviceType.WARNING,
      );
      this.patrolWarnCd = 14;
    }
  }

  // ─── Indicateur terminal à portée (R3) ────────────────────────────────────

  private updateProxIndicator(pos: Vector3): void {
    const PROX = NODE_PICK_DIST + 1.2; // zone d'approche légèrement plus large que le hack
    let anyNear = false;
    for (let i = 0; i < TERMINAL_COUNT; i++) {
      if (this.termCollected[i]) continue;
      const tp = this.terminals[i].position;
      const d  = Math.sqrt((pos.x - tp.x) ** 2 + (pos.z - tp.z) ** 2);
      if (d < PROX) { anyNear = true; break; }
    }
    if (this.proxIndicatorEl) {
      // Caché si le hack bar est déjà affiché (on est encore plus proche)
      const hackVisible = this.hackBarEl?.style.display === 'block';
      this.proxIndicatorEl.style.opacity = (anyNear && !hackVisible) ? '1' : '0';
    }
  }

  // ─── Minimap (R2) ──────────────────────────────────────────────────────────
  // Carte en croix : bounds ±28 world units → 168 px (3px/unit)
  private readonly MM_SCALE = 3;
  private readonly MM_SIZE  = 168; // = 56 * 3

  private worldToMM(wx: number, wz: number): [number, number] {
    return [(wx + 28) * this.MM_SCALE, (wz + 28) * this.MM_SCALE];
  }

  private buildMinimap(): void {
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width  = this.MM_SIZE;
    this.minimapCanvas.height = this.MM_SIZE;
    Object.assign(this.minimapCanvas.style, {
      position:       'fixed',
      bottom:         '16px',
      right:          '16px',
      width:          `${this.MM_SIZE}px`,
      height:         `${this.MM_SIZE}px`,
      border:         '1px solid rgba(100,60,180,0.5)',
      borderRadius:   '4px',
      background:     '#06030f',
      pointerEvents:  'none',
      zIndex:         '22',
      imageRendering: 'pixelated',
      opacity:        '0.90',
    });
    document.body.appendChild(this.minimapCanvas);
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.drawMinimap();
  }

  private drawMinimap(): void {
    const ctx = this.minimapCtx;
    const S   = this.MM_SCALE;
    ctx.clearRect(0, 0, this.MM_SIZE, this.MM_SIZE);

    // Fond
    ctx.fillStyle = '#06030f';
    ctx.fillRect(0, 0, this.MM_SIZE, this.MM_SIZE);

    // Salles (rectangles clairs)
    ctx.fillStyle = '#110820';
    const rooms: [number, number, number, number][] = [
      [-28, -8, 14, 16],  // entry
      [ -8, -8, 16, 16],  // hub
      [ 14, -8, 14, 16],  // east
      [ -8, 14, 16, 14],  // north
      [ -8,-28, 16, 14],  // south
    ];
    const corridors: [number, number, number, number][] = [
      [-14, -4,  6,  8],  // W-Hub
      [  8, -4,  6,  8],  // Hub-E
      [ -4,  8,  8,  6],  // Hub-N
      [ -4,-14,  8,  6],  // Hub-S
    ];
    for (const [x, z, w, d] of [...rooms, ...corridors]) {
      const [px, pz] = this.worldToMM(x, z);
      ctx.fillRect(px, pz, w * S, d * S);
    }

    // Murs (petites lignes)
    ctx.strokeStyle = '#2a1560';
    ctx.lineWidth   = 1;
    for (const [x1, z1, x2, z2] of WALL_SEGS) {
      const [px1, pz1] = this.worldToMM(x1, z1);
      const [px2, pz2] = this.worldToMM(x2, z2);
      ctx.beginPath();
      ctx.moveTo(px1, pz1);
      ctx.lineTo(px2, pz2);
      ctx.stroke();
    }

    // Terminaux
    for (let i = 0; i < TERMINAL_COUNT; i++) {
      const [tx, tz] = TERMINAL_POS[i];
      const [px, pz] = this.worldToMM(tx, tz);
      if (this.termCollected[i]) {
        ctx.fillStyle   = '#554400';
        ctx.strokeStyle = '#887700';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.arc(px, pz, 4, 0, Math.PI * 2);
        ctx.fill();
        // Croix
        ctx.strokeStyle = '#887700';
        ctx.beginPath();
        ctx.moveTo(px - 3, pz - 3); ctx.lineTo(px + 3, pz + 3);
        ctx.moveTo(px + 3, pz - 3); ctx.lineTo(px - 3, pz + 3);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(px, pz, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Sortie (triangle vert, visible seulement si tous terminaux hackés)
    const [ex, ez] = this.worldToMM(EXIT_POS.x, EXIT_POS.z);
    if (this.termHacked >= TERMINAL_COUNT) {
      ctx.fillStyle = '#00ff7f';
    } else {
      ctx.fillStyle = '#114422';
    }
    ctx.beginPath();
    ctx.moveTo(ex,     ez - 6);
    ctx.lineTo(ex + 5, ez + 4);
    ctx.lineTo(ex - 5, ez + 4);
    ctx.closePath();
    ctx.fill();

    // Gardes (triangles rouges orientés)
    for (const g of this.guards) {
      const gp = g.getPosition();
      const [gx, gz] = this.worldToMM(gp.x, gp.z);
      const rot = g['rotation'] as number ?? 0;
      ctx.save();
      ctx.translate(gx, gz);
      ctx.rotate(rot);
      ctx.fillStyle = g.isStunned() ? '#00aaff' : (g.alertLevel > 0.5 ? '#ff0000' : '#cc2200');
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(3.5, 4);
      ctx.lineTo(-3.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Joueur (point cyan)
    if (this.controller) {
      const p = this.controller.getPosition();
      const [px, pz] = this.worldToMM(p.x, p.z);
      ctx.fillStyle = '#00eeff';
      ctx.beginPath();
      ctx.arc(px, pz, 4, 0, Math.PI * 2);
      ctx.fill();
      // Direction de regard
      ctx.strokeStyle = '#00eeff';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(px, pz - 7);
      ctx.stroke();
    }

    // Bordure
    ctx.strokeStyle = 'rgba(100,60,200,0.4)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, this.MM_SIZE - 1, this.MM_SIZE - 1);
  }

  private updateHUDTimer(): void {
    const m = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const s = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    this.elTimer.textContent = `${m}:${s}`;
  }

  private showEchoMessage(msg: string): void {
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);
    this.echoMsgEl.textContent = `ECHO  ▸  ${msg}`;
    this.echoMsgEl.style.opacity = '1';
    this.echoMsgTimer = setTimeout(() => { this.echoMsgEl.style.opacity = '0'; }, 4500);
  }

  private createHackBar(): void {
    this.hackBarEl = document.createElement('div');
    Object.assign(this.hackBarEl.style, {
      position: 'fixed', bottom: '80px', left: '50%',
      transform: 'translateX(-50%)',
      width: '200px', background: 'rgba(0,5,20,0.9)',
      border: '1px solid #ccbb0055', borderRadius: '5px',
      padding: '7px 12px 8px', pointerEvents: 'none',
      zIndex: '25', fontFamily: '"Courier New", monospace', display: 'none',
    });
    const label = document.createElement('div');
    label.textContent = 'EXTRACTION...';
    Object.assign(label.style, { color: '#ccbb00', fontSize: '10px', letterSpacing: '0.1em', marginBottom: '5px' });
    const track = document.createElement('div');
    Object.assign(track.style, { background: '#1a1500', height: '6px', borderRadius: '3px', overflow: 'hidden' });
    this.hackFillEl = document.createElement('div');
    Object.assign(this.hackFillEl.style, {
      background: 'linear-gradient(90deg,#aa8800,#ffcc00)',
      height: '100%', width: '0%', borderRadius: '3px',
    });
    track.appendChild(this.hackFillEl);
    this.hackBarEl.appendChild(label);
    this.hackBarEl.appendChild(track);
    document.body.appendChild(this.hackBarEl);
  }

  // ─── Intro ─────────────────────────────────────────────────────────────────

  private showIntroOverlay(): void {
    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(2,1,8,0.97)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: '50', fontFamily: '"Courier New", monospace',
    });

    const title = document.createElement('h1');
    title.textContent = 'NEXUS : INFILTRATION';
    Object.assign(title.style, {
      fontSize: '2.6rem', letterSpacing: '0.2em',
      color: '#aa88ff', textShadow: '0 0 30px #6600cc, 0 0 60px #33004455',
      margin: '0 0 8px',
    });

    const sub = document.createElement('p');
    sub.textContent = 'Hacke les terminaux, évite les gardes, atteins la sortie';
    Object.assign(sub.style, { color: '#443355', fontSize: '0.85rem', margin: '0 0 32px', letterSpacing: '0.06em' });

    const rules = document.createElement('div');
    Object.assign(rules.style, { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '36px', fontSize: '0.84rem' });

    const items: [string, string, string][] = [
      ['◆', '#ccbb00', `Hacke ${TERMINAL_COUNT} terminaux dorés (rester 2s à portée)`],
      ['◆', '#00ccff', `EMP [E] — ${EMP_CHARGES} charges — neutralise les gardes proches ${EMP_STUN_DUR}s`],
      ['◆', '#ff4444', 'Évite les cônes rouges des gardes — alarme = les gardes convergent'],
      ['◆', '#00ff7f', 'Atteins le portail vert après avoir tout hacké'],
      ['◆', '#ffffff', 'WASD + Souris · Shift = courir · ESC = pause'],
    ];
    for (const [icon, color, text] of items) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '12px' });
      const ic = document.createElement('span');
      ic.textContent = icon; ic.style.color = color; ic.style.flexShrink = '0';
      const tx = document.createElement('span');
      tx.textContent = text; tx.style.color = '#776688';
      row.appendChild(ic); row.appendChild(tx);
      rules.appendChild(row);
    }

    const btn = document.createElement('button');
    btn.textContent = 'COMMENCER L\'INFILTRATION';
    Object.assign(btn.style, {
      background: 'transparent', border: '2px solid #aa88ff',
      color: '#aa88ff', fontSize: '0.95rem', letterSpacing: '0.18em',
      padding: '12px 40px', cursor: 'pointer',
      pointerEvents: 'all', transition: 'background 0.2s, color 0.2s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#aa88ff'; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#aa88ff'; });
    btn.addEventListener('click', () => {
      ov.style.opacity    = '0';
      ov.style.transition = 'opacity 0.45s';
      this.overlayTimers.push(setTimeout(() => {
        ov.remove();
        this.introOverlay = null;
        this.phase = 'playing';
        this.audio.startMazeAmbience();
        this.echoAI.say('Infiltration démarrée. 4 terminaux à extraire. Les gardes patrouillent.', AdviceType.OBSERVATION);
      }, 460));
    });

    ov.appendChild(title); ov.appendChild(sub); ov.appendChild(rules); ov.appendChild(btn);
    document.body.appendChild(ov);
    this.introOverlay = ov;
  }

  // ─── Pause ─────────────────────────────────────────────────────────────────

  private togglePause(): void {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.audio.stopMazeAmbience();
      const ov = document.createElement('div');
      Object.assign(ov.style, {
        position: 'fixed', inset: '0', background: 'rgba(2,1,8,0.88)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', zIndex: '45',
        fontFamily: '"Courier New", monospace', gap: '14px', pointerEvents: 'all',
      });
      const t2 = document.createElement('h2');
      t2.textContent = '— PAUSE —';
      Object.assign(t2.style, { color: '#aa88ff', fontSize: '1.6rem', letterSpacing: '0.3em', margin: '0 0 20px' });
      const resumeBtn = this.mkBtn('REPRENDRE', '#aa88ff', () => this.togglePause());
      const hubBtn    = this.mkBtn('RETOUR AU HUB', '#ff6666', async () => {
        ov.remove();
        await SceneManager.getInstance().loadScene('HubScene');
      });
      ov.appendChild(t2); ov.appendChild(resumeBtn); ov.appendChild(hubBtn);
      document.body.appendChild(ov);
      this.pauseOverlay = ov;
    } else {
      this.audio.startMazeAmbience();
      this.pauseOverlay?.remove();
      this.pauseOverlay = null;
    }
  }

  private mkBtn(label: string, color: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      background: 'transparent', border: `2px solid ${color}`,
      color, fontSize: '0.95rem', letterSpacing: '0.15em',
      padding: '10px 36px', cursor: 'pointer',
      pointerEvents: 'all', minWidth: '220px', transition: 'background 0.2s, color 0.2s',
    });
    b.addEventListener('mouseenter', () => { b.style.background = color; b.style.color = '#000'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = color; });
    b.addEventListener('click', fn);
    return b;
  }

  // ─── Écran de fin ──────────────────────────────────────────────────────────

  // ─── Shake caméra (J2) ────────────────────────────────────────────────────

  private shakeCamera(intensity: number, duration: number): void {
    const cam      = this.controller.getCamera();
    const origAlpha = cam.alpha;
    const origBeta  = cam.beta;
    const endTime   = performance.now() + duration * 1000;
    const tick = () => {
      const now  = performance.now();
      if (now >= endTime) { cam.alpha = origAlpha; cam.beta = origBeta; return; }
      const decay = (endTime - now) / (duration * 1000);
      cam.alpha = origAlpha + (Math.random() - 0.5) * intensity * decay * 2;
      cam.beta  = origBeta  + (Math.random() - 0.5) * intensity * decay;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ─── Score (O1) ────────────────────────────────────────────────────────────

  private computeScore(): { score: number; rank: string } {
    const timePenalty  = Math.floor(this.elapsed) * 10;
    const termBonus    = this.termHacked * 500;
    const empBonus     = this.empCharges * 300;
    const alarmPenalty = this.alarmCount * 800;
    const perfect      = this.alarmCount === 0 && this.termHacked === TERMINAL_COUNT ? 2000 : 0;
    const score = Math.max(0, 10000 + termBonus + empBonus + perfect - timePenalty - alarmPenalty);
    let rank = 'C';
    if (score >= 13000) rank = 'S';
    else if (score >= 9000) rank = 'A';
    else if (score >= 6000) rank = 'B';
    return { score, rank };
  }

  private showEndOverlay(success: boolean): void {
    const { score, rank } = this.computeScore();
    const rankColors: Record<string, string> = { S: '#ffd700', A: '#00ccff', B: '#00ff7f', C: '#aaaaaa' };

    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'fixed', inset: '0',
      background: success ? 'rgba(0,10,5,0.95)' : 'rgba(15,0,0,0.95)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', zIndex: '50',
      fontFamily: '"Courier New", monospace', pointerEvents: 'all', gap: '6px',
    });

    const title = document.createElement('h1');
    title.textContent = success ? 'EXTRACTION RÉUSSIE' : 'CAPTURÉ';
    Object.assign(title.style, {
      fontSize: '2.8rem', letterSpacing: '0.22em',
      color:     success ? '#00ff7f' : '#ff2200',
      textShadow: success ? '0 0 30px #00ff7f' : '0 0 30px #ff0000',
      margin: '0 0 4px',
    });

    // Rang (O1)
    if (success) {
      const rankEl = document.createElement('div');
      rankEl.textContent = `RANG  ${rank}`;
      Object.assign(rankEl.style, {
        fontSize: '1.8rem', letterSpacing: '0.3em',
        color: rankColors[rank] ?? '#aaa',
        textShadow: `0 0 18px ${rankColors[rank] ?? '#aaa'}`,
        marginBottom: '8px',
      });
      ov.appendChild(title); ov.appendChild(rankEl);
    } else {
      ov.appendChild(title);
    }

    const m = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const s = Math.floor(this.elapsed % 60).toString().padStart(2, '0');

    const stats = document.createElement('div');
    Object.assign(stats.style, { textAlign: 'center', color: '#776688', fontSize: '0.9rem', lineHeight: '2.1', marginBottom: '16px' });
    const addLine = (text: string, color = '#776688') => {
      const d = document.createElement('div');
      d.textContent = text; d.style.color = color;
      stats.appendChild(d);
    };
    addLine(`Temps : ${m}:${s}`);
    addLine(`Terminaux : ${this.termHacked} / ${TERMINAL_COUNT}`);
    addLine(`Alarmes déclenchées : ${this.alarmCount}`, this.alarmCount === 0 ? '#00ff7f' : '#ff8888');
    addLine(`EMP économisés : ${this.empCharges}`, '#00ccff');
    if (success) {
      addLine(`Score : ${score.toLocaleString('fr-FR')}`, '#ffffff');
      if (this.alarmCount === 0) addLine('★ INFILTRATION PARFAITE ★', '#ffd700');
    }

    const hubBtn   = this.mkBtn('RETOUR AU HUB', success ? '#00ff7f' : '#ff4444', async () => {
      ov.remove();
      await SceneManager.getInstance().loadScene('HubScene');
    });
    const retryBtn = this.mkBtn('REJOUER', '#aa88ff', async () => {
      ov.remove();
      await SceneManager.getInstance().loadScene('InfiltrationScene');
    });

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '14px', marginTop: '8px' });
    btnRow.appendChild(hubBtn); btnRow.appendChild(retryBtn);

    ov.appendChild(stats); ov.appendChild(btnRow);
    document.body.appendChild(ov);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DISPOSE
  // ═══════════════════════════════════════════════════════════════════════════

  public async dispose(): Promise<void> {
    this.overlayTimers.forEach(t => clearTimeout(t));
    this.overlayTimers = [];
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);
    document.removeEventListener('keydown', this.escListener);
    this.echoUnsub?.();

    this.audio.stopMazeAmbience();

    this.hudRoot?.remove();
    this.echoMsgEl?.remove();
    this.elAlert?.remove();
    this.hackBarEl?.remove();
    this.introOverlay?.remove();
    this.pauseOverlay?.remove();
    this.alarmFlashEl?.remove();
    this.proxIndicatorEl?.remove();
    this.alarmCountdownEl?.remove();
    this.minimapCanvas?.remove();

    this.audio.setDroneAlertLevel(0);
    this.guards.forEach(g => g.dispose());
    this.wallMeshes.forEach(m => m.dispose());
    this.envMeshes.forEach(m => m.dispose());
    this.terminals.forEach(m => m.dispose());
    this.termLights.forEach(l => l.dispose());
    this.hackPs?.stop();
    this.hackPs?.dispose();
    this.hackPsTex?.dispose();
    this.burstTex?.dispose();
    this.exitMesh?.dispose();
    this.exitDisc?.dispose();
    this.exitLight?.dispose();
    this.shadowGen?.dispose();
    this.glowLayer?.dispose();
    this.controller?.dispose();

    await super.dispose();
  }
}
