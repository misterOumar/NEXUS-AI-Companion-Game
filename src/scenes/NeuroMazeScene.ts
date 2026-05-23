import { Vector3, GlowLayer, PointLight, Color3 } from '@babylonjs/core';
import { AbstractScene } from './AbstractScene';
import { ThirdPersonController } from '@/player/ThirdPersonController';
import { MazeGenerator, type MazeCell } from '@/maze/MazeGenerator';
import type { Dir } from '@/maze/MazeGenerator';
import { MazeRenderer } from '@/maze/MazeRenderer';
import { EchoAI, AdviceType } from '@/ai/EchoAI';
import { SceneManager } from '@/core/SceneManager';

// ─── Phase ────────────────────────────────────────────────────────────────────
const enum Phase { INTRO, PLAYING, PAUSED, COMPLETE }

// ─── Config ───────────────────────────────────────────────────────────────────
const MAZE_COLS      = 11;
const MAZE_ROWS      = 11;
const CELL_SIZE      = 6;
const HESITATE_SEC   = 10;   // seconds without progress before AI opens a wall
const NODE_PICK_DIST = 1.5;
const EXIT_DIST      = 2.2;
const NEAR_EXIT_DIST = 18;
const FOG_BASE       = 0.012;
const FOG_MAX        = 0.05;
const MINIMAP_CS     = 13;   // minimap pixels per cell

// ─── ECHO message pools ───────────────────────────────────────────────────────
const MSGS_ADAPT = [
  'Hésitation prolongée. Reconfiguration du labyrinthe.',
  'Impasse comportementale. Nouveau passage activé.',
  'Mes algorithmes analysent ton parcours. Chemin alternatif créé.',
  'Tu étais bloqué. J\'ai ouvert une voie. Continue.',
  'Données de progression insuffisantes. Intervention IA déclenchée.',
];
const MSGS_NODE = [
  'Fragment de données intégré.',
  'Nœud sécurisé. Données extraites.',
  'Information absorbée. Poursuis l\'exploration.',
  'Donnée acquise. Tu te rapproches.',
];
const MSGS_NEAR_EXIT = [
  'Signal de sortie détecté. Converge vers lui.',
  'Tu y es presque. Ne t\'arrête pas maintenant.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Score ────────────────────────────────────────────────────────────────────
function computeScore(elapsed: number, nodesCollected: number, adaptCount: number, nodesTotal: number): { score: number; rank: string } {
  const timePenalty = Math.floor(elapsed) * 10;
  const nodeBon     = nodesCollected * 300;
  const perfectBon  = nodesCollected === nodesTotal ? 2000 : 0;
  const adaptPen    = adaptCount * 400;
  const score       = Math.max(100, 10000 + nodeBon + perfectBon - timePenalty - adaptPen);
  let rank = 'C';
  if (score >= 13000) rank = 'S';
  else if (score >= 10000) rank = 'A';
  else if (score >= 7000) rank = 'B';
  return { score, rank };
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class NeuroMazeScene extends AbstractScene {
  private controller!:   ThirdPersonController;
  private generator!:    MazeGenerator;
  private renderer!:     MazeRenderer;
  private echo:          EchoAI = EchoAI.getInstance();
  private echoUnsub!:    () => void;
  private grid:          MazeCell[][] = [];

  // Game state
  private phase:          Phase  = Phase.INTRO;
  private elapsed:        number = 0;
  private nodesTotal:     number = 0;
  private nodesCollected: number = 0;
  private adaptCount:     number = 0;
  private exitWorldPos!:  Vector3;
  private nearExitWarned: boolean = false;

  // Hesitation (progress-based)
  private lastProgressDist: number = Infinity;
  private noProgressTime:   number = 0;

  // Minimap
  private visitedCells:  Set<string>        = new Set();
  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!:    CanvasRenderingContext2D;
  private minimapTimer:   number = 0;

  // HUD
  private hudRoot!:       HTMLDivElement;
  private elTimer!:       HTMLSpanElement;
  private elNodes!:       HTMLSpanElement;
  private elAdapt!:       HTMLSpanElement;
  private elEchoMsg!:     HTMLDivElement;
  private echoMsgTimer:   ReturnType<typeof setTimeout> | null = null;
  private lastDisplayedSecs: number = -1;

  // Player light (ensures character stays visible in dark corridors)
  private playerLight!:   PointLight;

  // Overlays
  private introOverlay!:  HTMLDivElement;
  private pauseOverlay!:  HTMLDivElement;
  private escapeListener!: (e: KeyboardEvent) => void;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  public async init(): Promise<void> {
    await super.init();
  }

  public async loadAssets(): Promise<void> {
    await super.loadAssets();
  }

  public async createScene(): Promise<void> {
    // Firefox a des problèmes de compositing HDR avec GlowLayer.
    // ldrMerge force le blend en espace LDR, plus cohérent cross-browser.
    const ff = /Firefox/i.test(navigator.userAgent);
    const glow = new GlowLayer('mazeGlow', this.scene, {
      blurKernelSize: ff ? 16 : 32,
      ldrMerge: true,
    });
    glow.intensity = ff ? 0.6 : 0.8;

    // Generate maze data
    this.generator = new MazeGenerator(MAZE_COLS, MAZE_ROWS);
    this.grid      = this.generator.generate();

    for (let r = 0; r < MAZE_ROWS; r++)
      for (let c = 0; c < MAZE_COLS; c++)
        if (this.grid[r][c].dataNode) this.nodesTotal++;

    // Instantiate renderer (pure math init, no build yet)
    this.renderer = new MazeRenderer(this.scene, glow, MAZE_COLS, MAZE_ROWS, CELL_SIZE);

    // Get start position without building (just coordinate math)
    const startPos = this.renderer.cellToWorld(0, 0);

    // Create controller FIRST so scene.activeCamera exists for post-processing
    this.controller = new ThirdPersonController(this.scene, {
      moveSpeed:          4.5,
      runSpeed:           9,
      cameraDistance:     4.5,   // spring arm gère la distance réelle, pas besoin de régler après
      cameraMinDistance:  1.2,   // zoom-in minimal si caméra collée au mur
      cameraHeight:       2,
      mouseSensitivity:   0.0022,
      collisionRadius:    0.3,   // légèrement réduit pour éviter de se coincer aux angles
    });
    this.controller.setPosition(new Vector3(startPos.x, 0, startPos.z));

    const canvas = this.scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;
    this.controller.enablePointerLock(canvas);

    // Angle overhead plus prononcé → personnage visible en couloir étroit
    const cam = this.controller.getCamera();
    cam.beta = Math.PI / 2.6;  // ~69° depuis le sommet

    // Limites de déplacement calées sur les bords du labyrinthe (murs de bordure inclus)
    const halfW = (MAZE_COLS * CELL_SIZE) / 2 - 0.5;
    const halfH = (MAZE_ROWS * CELL_SIZE) / 2 - 0.5;
    this.controller.setMovementBounds(
      new Vector3(-halfW, 0, -halfH),
      new Vector3( halfW, 8,  halfH)
    );

    // Player light: illuminates the character from above so it's always visible
    // against the dark emissive maze walls even with post-processing active.
    this.playerLight = new PointLight('playerSpot', Vector3.Zero(), this.scene);
    this.playerLight.diffuse    = new Color3(0.65, 0.8, 1.0);
    this.playerLight.intensity  = 2.0;
    this.playerLight.range      = 8;

    // Build maze (setupPostProcessing inside has an active camera now)
    this.renderer.build(this.grid);
    this.renderer.setFogDensity(FOG_BASE);

    this.exitWorldPos      = this.renderer.getExitWorldPos();
    this.lastProgressDist  = MAZE_COLS + MAZE_ROWS; // max Manhattan distance

    // ECHO — store unsubscribe to clean up on dispose
    this.echoUnsub = this.echo.onMessage((advice) => this.showEchoMessage(advice.message));

    // Keyboard: Escape for pause
    this.escapeListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.phase === Phase.PLAYING) this.togglePause();
      else if (e.key === 'Escape' && this.phase === Phase.PAUSED) this.togglePause();
    };
    document.addEventListener('keydown', this.escapeListener);

    this.buildHUD();
    this.buildMinimap();
    this.buildIntroOverlay();
  }

  public update(deltaTime: number): void {
    if (this.phase === Phase.COMPLETE || this.phase === Phase.PAUSED) return;

    this.controller.update(deltaTime);

    // Player light always tracks the character, even during intro
    const lpos = this.controller.getPosition();
    this.playerLight.position.set(lpos.x, lpos.y + 2.2, lpos.z);

    if (this.phase === Phase.INTRO) return;

    // PLAYING
    this.elapsed += deltaTime;
    this.updateHUDTimer();
    this.checkNodePickup();
    this.checkHesitation(deltaTime);
    this.checkExit();

    // Minimap refresh at 10fps
    this.minimapTimer += deltaTime;
    if (this.minimapTimer >= 0.1) {
      this.minimapTimer = 0;
      this.drawMinimap();
    }
  }

  public async dispose(): Promise<void> {
    this.echoUnsub?.();
    document.removeEventListener('keydown', this.escapeListener);
    this.playerLight?.dispose();
    this.renderer?.dispose();
    this.controller?.dispose();
    this.removeHUD();
    this.removeIntroOverlay();
    this.pauseOverlay?.remove();
    await super.dispose();
  }

  // ─── Game logic ─────────────────────────────────────────────────────────────

  private checkNodePickup(): void {
    const pos = this.controller.getPosition();
    const { col, row } = this.renderer.worldToCell(pos.x, pos.z);
    if (col < 0 || col >= MAZE_COLS || row < 0 || row >= MAZE_ROWS) return;

    const cell = this.generator.getCell(col, row);
    if (!cell?.dataNode) return;

    const nodeWorld = this.renderer.cellToWorld(col, row);
    const dist = Math.sqrt((pos.x - nodeWorld.x) ** 2 + (pos.z - nodeWorld.z) ** 2);
    if (dist > NODE_PICK_DIST) return;

    const collected = this.renderer.collectNode(col, row);
    if (collected) {
      cell.dataNode = false;
      this.nodesCollected++;
      this.elNodes.textContent = `${this.nodesCollected}/${this.nodesTotal}`;

      const remaining = this.nodesTotal - this.nodesCollected;
      const nodeMsg = pick(MSGS_NODE);
      const suffixMsg = remaining === 0
        ? 'Tous les nœuds collectés.'
        : `${remaining} restant${remaining > 1 ? 's' : ''}.`;
      this.echo.say(`${nodeMsg} ${suffixMsg}`, AdviceType.ENCOURAGEMENT);
      this.flashScreen('rgba(220,180,0,0.12)');
    }
  }

  private checkHesitation(deltaTime: number): void {
    const pos = this.controller.getPosition();
    const { col, row } = this.renderer.worldToCell(pos.x, pos.z);

    // Track visited cells for minimap
    this.visitedCells.add(`${col},${row}`);

    // Progress = Manhattan distance to exit
    const dist = Math.abs(col - (MAZE_COLS - 1)) + Math.abs(row - (MAZE_ROWS - 1));

    if (dist < this.lastProgressDist - 1) {
      this.lastProgressDist = dist;
      this.noProgressTime   = 0;
    } else {
      this.noProgressTime += deltaTime;
      if (this.noProgressTime >= HESITATE_SEC) {
        this.noProgressTime   = 0;
        this.lastProgressDist = dist;
        this.openAdaptiveWall(col, row);
      }
    }
  }

  private openAdaptiveWall(col: number, row: number): void {
    const candidates = this.generator.getClosedWallsOf(col, row);
    if (candidates.length === 0) return;

    const exitC = MAZE_COLS - 1;
    const exitR = MAZE_ROWS - 1;
    candidates.sort((a, b) => {
      const [dc1, dr1] = dirDelta(a.dir);
      const [dc2, dr2] = dirDelta(b.dir);
      const dA = Math.abs(col + dc1 - exitC) + Math.abs(row + dr1 - exitR);
      const dB = Math.abs(col + dc2 - exitC) + Math.abs(row + dr2 - exitR);
      return dA - dB;
    });

    const chosen = candidates[0];
    const wallId = this.generator.removeWall(col, row, chosen.dir as Dir);
    if (!wallId) return;

    this.renderer.animateWallOpen(wallId);
    this.adaptCount++;
    this.elAdapt.textContent = `${this.adaptCount}`;
    this.echo.say(pick(MSGS_ADAPT), AdviceType.TIP);
    this.flashScreen('rgba(50,255,130,0.08)');
    this.updateFog();
  }

  private checkExit(): void {
    const pos  = this.controller.getPosition();
    const dist = Math.sqrt(
      (pos.x - this.exitWorldPos.x) ** 2 + (pos.z - this.exitWorldPos.z) ** 2,
    );

    if (!this.nearExitWarned && dist < NEAR_EXIT_DIST) {
      this.nearExitWarned = true;
      this.echo.say(pick(MSGS_NEAR_EXIT), AdviceType.OBSERVATION);
    }

    if (dist < EXIT_DIST) this.triggerComplete();
  }

  private updateFog(): void {
    // Fog increases as AI adapts (it's "taking over" the environment)
    const density = FOG_BASE + (FOG_MAX - FOG_BASE) * Math.min(1, this.adaptCount / 6);
    this.renderer.setFogDensity(density);
  }

  // ─── Completion ─────────────────────────────────────────────────────────────

  private triggerComplete(): void {
    if (this.phase === Phase.COMPLETE) return;
    this.phase = Phase.COMPLETE;

    const mins = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const secs = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    this.echo.say(`Sortie atteinte ! Temps : ${mins}:${secs}. ${this.nodesCollected} nœuds.`, AdviceType.ENCOURAGEMENT);

    const { score, rank } = computeScore(this.elapsed, this.nodesCollected, this.adaptCount, this.nodesTotal);
    this.showCompleteOverlay(mins, secs, score, rank);
  }

  // ─── Screen flash feedback ────────────────────────────────────────────────────

  private flashScreen(color: string): void {
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position:       'fixed',
      inset:          '0',
      background:     color,
      pointerEvents:  'none',
      zIndex:         '15',
      transition:     'opacity 0.35s',
    });
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 350);
    });
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────────

  private buildHUD(): void {
    this.hudRoot = document.createElement('div');
    Object.assign(this.hudRoot.style, {
      position:       'fixed',
      top:            '0',
      left:           '0',
      width:          '100%',
      pointerEvents:  'none',
      fontFamily:     '"Courier New", monospace',
      zIndex:         '20',
    });

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'center',
      padding:        '10px 20px',
      background:     'rgba(0,0,0,0.6)',
      borderBottom:   '1px solid #1a3a6a',
      color:          '#7ec8e3',
      fontSize:       '14px',
      letterSpacing:  '0.08em',
    });

    const timerBlock = this.makeHudBlock('TEMPS', '00:00');
    const nodesBlock = this.makeHudBlock('NŒUDS', `0/${this.nodesTotal}`);
    const adaptBlock = this.makeHudBlock('ADAPT IA', '0');
    const escBlock   = this.makeHudBlock('PAUSE', 'ESC');

    this.elTimer = timerBlock.querySelector('span')!;
    this.elNodes = nodesBlock.querySelector('span')!;
    this.elAdapt = adaptBlock.querySelector('span')!;

    bar.appendChild(timerBlock);
    bar.appendChild(nodesBlock);
    bar.appendChild(adaptBlock);
    bar.appendChild(escBlock);
    this.hudRoot.appendChild(bar);

    // ECHO message toast
    this.elEchoMsg = document.createElement('div');
    Object.assign(this.elEchoMsg.style, {
      position:       'fixed',
      bottom:         '200px',
      left:           '50%',
      transform:      'translateX(-50%)',
      background:     'rgba(0,10,30,0.85)',
      border:         '1px solid #00ff7f55',
      borderRadius:   '6px',
      color:          '#00ff7f',
      padding:        '8px 20px',
      fontSize:       '13px',
      letterSpacing:  '0.05em',
      opacity:        '0',
      transition:     'opacity 0.3s',
      pointerEvents:  'none',
      zIndex:         '25',
      maxWidth:       '520px',
      textAlign:      'center',
      whiteSpace:     'nowrap',
    });

    document.body.appendChild(this.hudRoot);
    document.body.appendChild(this.elEchoMsg);
  }

  private makeHudBlock(label: string, initial: string): HTMLDivElement {
    const block = document.createElement('div');
    Object.assign(block.style, { textAlign: 'center', minWidth: '90px' });

    const lbl = document.createElement('div');
    Object.assign(lbl.style, { fontSize: '10px', color: '#4a7fa5', marginBottom: '2px' });
    lbl.textContent = label;

    const val = document.createElement('span');
    Object.assign(val.style, { fontSize: '16px', color: '#7ec8e3', fontWeight: 'bold' });
    val.textContent = initial;

    block.appendChild(lbl);
    block.appendChild(val);
    return block;
  }

  private updateHUDTimer(): void {
    const secs = Math.floor(this.elapsed % 60);
    if (secs === this.lastDisplayedSecs) return;
    this.lastDisplayedSecs = secs;
    const mins = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    this.elTimer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private showEchoMessage(msg: string): void {
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);
    this.elEchoMsg.textContent = `ECHO  ▸  ${msg}`;
    this.elEchoMsg.style.opacity = '1';
    this.echoMsgTimer = setTimeout(() => {
      this.elEchoMsg.style.opacity = '0';
    }, 4500);
  }

  private removeHUD(): void {
    this.hudRoot?.remove();
    this.elEchoMsg?.remove();
    this.minimapCanvas?.remove();
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);
  }

  // ─── Minimap ──────────────────────────────────────────────────────────────────

  private buildMinimap(): void {
    const W = MAZE_COLS * MINIMAP_CS;
    const H = MAZE_ROWS * MINIMAP_CS;

    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width  = W;
    this.minimapCanvas.height = H;
    Object.assign(this.minimapCanvas.style, {
      position:        'fixed',
      bottom:          '16px',
      right:           '16px',
      width:           `${W}px`,
      height:          `${H}px`,
      border:          '1px solid #1a3a6a',
      borderRadius:    '4px',
      background:      '#030310',
      pointerEvents:   'none',
      zIndex:          '22',
      imageRendering:  'pixelated',
      opacity:         '0.88',
    });
    document.body.appendChild(this.minimapCanvas);
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.drawMinimap();
  }

  private drawMinimap(): void {
    const ctx = this.minimapCtx;
    const CS  = MINIMAP_CS;
    const W   = MAZE_COLS * CS;
    const H   = MAZE_ROWS * CS;

    ctx.fillStyle = '#030310';
    ctx.fillRect(0, 0, W, H);

    // Visited cells
    ctx.fillStyle = '#0b0b28';
    for (const key of this.visitedCells) {
      const [c, r] = key.split(',').map(Number);
      if (c >= 0 && c < MAZE_COLS && r >= 0 && r < MAZE_ROWS)
        ctx.fillRect(c * CS + 1, r * CS + 1, CS - 1, CS - 1);
    }

    // Interior walls
    ctx.strokeStyle = '#1a4a9a';
    ctx.lineWidth   = 1;
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const cell = this.grid[r][c];
        if (cell.walls.S && r < MAZE_ROWS - 1) {
          ctx.beginPath();
          ctx.moveTo(c * CS,        (r + 1) * CS);
          ctx.lineTo((c + 1) * CS,  (r + 1) * CS);
          ctx.stroke();
        }
        if (cell.walls.E && c < MAZE_COLS - 1) {
          ctx.beginPath();
          ctx.moveTo((c + 1) * CS, r * CS);
          ctx.lineTo((c + 1) * CS, (r + 1) * CS);
          ctx.stroke();
        }
      }
    }

    // Boundary
    ctx.strokeStyle = '#2a5abf';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Data nodes (yellow dots)
    ctx.fillStyle = '#ccbb00';
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (!this.grid[r][c].dataNode) continue;
        ctx.beginPath();
        ctx.arc(c * CS + CS / 2, r * CS + CS / 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Exit (green)
    ctx.fillStyle = '#00ff7f';
    ctx.beginPath();
    ctx.arc((MAZE_COLS - 1) * CS + CS / 2, (MAZE_ROWS - 1) * CS + CS / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Player (cyan)
    if (this.controller) {
      const pos = this.controller.getPosition();
      const { col, row } = this.renderer.worldToCell(pos.x, pos.z);
      const px = Math.max(0, Math.min(MAZE_COLS - 1, col));
      const pr = Math.max(0, Math.min(MAZE_ROWS - 1, row));
      ctx.fillStyle = '#00eeff';
      ctx.beginPath();
      ctx.arc(px * CS + CS / 2, pr * CS + CS / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Intro overlay ───────────────────────────────────────────────────────────

  private buildIntroOverlay(): void {
    this.introOverlay = document.createElement('div');
    Object.assign(this.introOverlay.style, {
      position:       'fixed',
      inset:          '0',
      background:     'rgba(0,2,15,0.93)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         '50',
      fontFamily:     '"Courier New", monospace',
      color:          '#7ec8e3',
    });

    const title = document.createElement('h1');
    title.textContent = 'NEURO MAZE';
    Object.assign(title.style, {
      fontSize:      '3rem',
      letterSpacing: '0.3em',
      color:         '#00ccff',
      textShadow:    '0 0 30px #00ccff',
      margin:        '0 0 10px',
    });

    const sub = document.createElement('p');
    sub.textContent = "L'IA analyse ton comportement et adapte le labyrinthe en temps réel";
    Object.assign(sub.style, { fontSize: '0.88rem', color: '#4a7fa5', margin: '0 0 36px', letterSpacing: '0.06em' });

    const rules = document.createElement('ul');
    Object.assign(rules.style, { listStyle: 'none', padding: '0', margin: '0 0 44px', textAlign: 'center', lineHeight: '2.2', fontSize: '0.86rem' });

    const items = [
      ['■', '#00ff7f', 'Atteins la sortie verte en bas à droite'],
      ['●', '#ccbb00', 'Collecte les nœuds dorés en chemin'],
      ['▲', '#00ccff', 'ECHO ouvre des murs si tu restes bloqué'],
      ['◆', '#7ec8e3', 'WASD + souris   ·   Espace = saut   ·   ESC = pause'],
    ];
    items.forEach(([icon, color, text]) => {
      const li = document.createElement('li');
      const ic = document.createElement('span');
      ic.textContent = `${icon}  `;
      ic.style.color = color;
      const tx = document.createElement('span');
      tx.textContent = text;
      li.appendChild(ic);
      li.appendChild(tx);
      rules.appendChild(li);
    });

    const btn = document.createElement('button');
    btn.textContent = 'COMMENCER';
    Object.assign(btn.style, {
      background:    'transparent',
      border:        '2px solid #00ccff',
      color:         '#00ccff',
      fontSize:      '1rem',
      letterSpacing: '0.2em',
      padding:       '12px 44px',
      cursor:        'pointer',
      pointerEvents: 'all',
      transition:    'background 0.2s, color 0.2s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#00ccff'; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#00ccff'; });
    btn.addEventListener('click', () => this.startPlaying());

    this.introOverlay.appendChild(title);
    this.introOverlay.appendChild(sub);
    this.introOverlay.appendChild(rules);
    this.introOverlay.appendChild(btn);
    document.body.appendChild(this.introOverlay);
  }

  private startPlaying(): void {
    this.phase = Phase.PLAYING;
    this.echo.say('Labyrinthe actif. Je surveille tes mouvements.', AdviceType.OBSERVATION);
    this.introOverlay.style.opacity    = '0';
    this.introOverlay.style.transition = 'opacity 0.5s';
    setTimeout(() => this.removeIntroOverlay(), 500);
  }

  private removeIntroOverlay(): void {
    this.introOverlay?.remove();
  }

  // ─── Pause ────────────────────────────────────────────────────────────────────

  private togglePause(): void {
    if (this.phase === Phase.PLAYING) {
      this.phase = Phase.PAUSED;
      this.showPauseOverlay();
    } else if (this.phase === Phase.PAUSED) {
      this.phase = Phase.PLAYING;
      this.pauseOverlay?.remove();
    }
  }

  private showPauseOverlay(): void {
    this.pauseOverlay = document.createElement('div');
    Object.assign(this.pauseOverlay.style, {
      position:       'fixed',
      inset:          '0',
      background:     'rgba(0,2,15,0.82)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         '45',
      fontFamily:     '"Courier New", monospace',
      gap:            '16px',
    });

    const title = document.createElement('h2');
    title.textContent = '— PAUSE —';
    Object.assign(title.style, { color: '#00ccff', fontSize: '1.6rem', letterSpacing: '0.3em', margin: '0 0 24px' });

    const resumeBtn = this.makePauseBtn('REPRENDRE', '#00ccff', () => this.togglePause());
    const hubBtn    = this.makePauseBtn('RETOUR AU HUB', '#ff6666', async () => {
      this.pauseOverlay?.remove();
      await SceneManager.getInstance().loadScene('HubScene');
    });

    const hint = document.createElement('p');
    hint.textContent = 'ESC pour reprendre';
    Object.assign(hint.style, { color: '#2a4a6a', fontSize: '0.8rem', margin: '8px 0 0' });

    this.pauseOverlay.appendChild(title);
    this.pauseOverlay.appendChild(resumeBtn);
    this.pauseOverlay.appendChild(hubBtn);
    this.pauseOverlay.appendChild(hint);
    document.body.appendChild(this.pauseOverlay);
  }

  private makePauseBtn(label: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background:    'transparent',
      border:        `2px solid ${color}`,
      color:         color,
      fontSize:      '0.95rem',
      letterSpacing: '0.15em',
      padding:       '10px 36px',
      cursor:        'pointer',
      pointerEvents: 'all',
      minWidth:      '220px',
      transition:    'background 0.2s, color 0.2s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = color; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = color; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ─── Completion overlay ──────────────────────────────────────────────────────

  private showCompleteOverlay(mins: string, secs: string, score: number, rank: string): void {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:       'fixed',
      inset:          '0',
      background:     'rgba(0,2,15,0.92)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         '50',
      fontFamily:     '"Courier New", monospace',
      color:          '#7ec8e3',
    });

    const title = document.createElement('h1');
    title.textContent = 'LABYRINTHE COMPLÉTÉ';
    Object.assign(title.style, {
      fontSize:      '2.4rem',
      color:         '#00ff7f',
      textShadow:    '0 0 30px #00ff7f',
      margin:        '0 0 8px',
      letterSpacing: '0.1em',
    });

    const rankEl = document.createElement('div');
    const rankColors: Record<string, string> = { S: '#ffd700', A: '#00ccff', B: '#00ff7f', C: '#aaaaaa' };
    rankEl.textContent = `RANG  ${rank}`;
    Object.assign(rankEl.style, {
      fontSize:      '2rem',
      color:         rankColors[rank] ?? '#aaa',
      textShadow:    `0 0 20px ${rankColors[rank] ?? '#aaa'}`,
      letterSpacing: '0.3em',
      margin:        '0 0 32px',
    });

    const stats = document.createElement('div');
    Object.assign(stats.style, { textAlign: 'center', lineHeight: '2', marginBottom: '32px', fontSize: '0.95rem' });

    const makeStatLine = (text: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.textContent = text;
      return d;
    };
    stats.appendChild(makeStatLine(`Temps      :  ${mins}:${secs}`));
    stats.appendChild(makeStatLine(`Nœuds      :  ${this.nodesCollected} / ${this.nodesTotal}`));
    stats.appendChild(makeStatLine(`Adaptations IA :  ${this.adaptCount}`));

    const scoreEl = document.createElement('div');
    scoreEl.textContent = `Score  ${score.toLocaleString('fr-FR')}`;
    Object.assign(scoreEl.style, {
      fontSize:      '1.4rem',
      color:         '#00ccff',
      margin:        '0 0 36px',
      letterSpacing: '0.1em',
    });

    const btn = document.createElement('button');
    btn.textContent = 'RETOUR AU HUB';
    Object.assign(btn.style, {
      background:    'transparent',
      border:        '2px solid #00ff7f',
      color:         '#00ff7f',
      fontSize:      '1rem',
      letterSpacing: '0.15em',
      padding:       '12px 40px',
      cursor:        'pointer',
      pointerEvents: 'all',
      transition:    'background 0.2s, color 0.2s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#00ff7f'; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#00ff7f'; });
    btn.addEventListener('click', async () => {
      overlay.remove();
      await SceneManager.getInstance().loadScene('HubScene');
    });

    overlay.appendChild(title);
    overlay.appendChild(rankEl);
    overlay.appendChild(stats);
    overlay.appendChild(scoreEl);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dirDelta(dir: string): [number, number] {
  if (dir === 'N') return [0, -1];
  if (dir === 'S') return [0,  1];
  if (dir === 'E') return [1,  0];
  if (dir === 'W') return [-1, 0];
  return [0, 0];
}
