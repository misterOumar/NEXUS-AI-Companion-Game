import {
  Vector3,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  GlowLayer,
  TransformNode,
  PointLight,
} from '@babylonjs/core';
import { AbstractScene } from './AbstractScene';
import { HubEnvironment } from './HubEnvironment';
import { ThirdPersonController } from '@/player/ThirdPersonController';
import { EchoDrone } from '@/player/EchoDrone';
import { EchoAI, AdviceType } from '@/ai/EchoAI';
import { SceneManager } from '@/core/SceneManager';

interface PortalConfig {
  name:        string;
  displayName: string;
  number:      string;
  position:    Vector3;
  color:       Color3;
  sceneName:   string;
  subtitle:    string;
  description: string;
  tags:        string[];
  icon:        string;
}

export class HubScene extends AbstractScene {
  private playerController!: ThirdPersonController;
  private echoDrone!:        EchoDrone;
  private echoAI!:           EchoAI;
  private environment!:      HubEnvironment;
  private glowLayer!:        GlowLayer;

  // Portails — uniquement les 2 jeux existants
  private portals: Map<string, TransformNode> = new Map();
  private portalConfigs: PortalConfig[] = [
    {
      name:        'neuroMaze',
      displayName: 'NEURO MAZE',
      number:      '01',
      position:    new Vector3(-16, 0, -8),
      color:       new Color3(0.15, 0.95, 0.45),
      sceneName:   'NeuroMazeScene',
      subtitle:    'Labyrinthe Adaptatif',
      description: "L'IA analyse ta progression en temps réel et adapte le labyrinthe. Échappe au drone de traque et collecte les nœuds de données.",
      tags:        ['IA ADAPTATIVE', 'EXPLORATION', 'DRONE'],
      icon:        'maze',
    },
    {
      name:        'mirrorDuel',
      displayName: 'MIRROR DUEL',
      number:      '02',
      position:    new Vector3(16, 0, -8),
      color:       new Color3(0.75, 0.25, 1.0),
      sceneName:   'MirrorDuelScene',
      subtitle:    'Combat contre ton Clone IA',
      description: "L'IA copie et apprend ton style de combat pour te défier. Bats ton propre reflet avant qu'il ne te surpasse.",
      tags:        ['IA CLONE', 'COMBAT', 'DUEL'],
      icon:        'mirror',
    },
  ];

  // État
  private nearestPortal:  PortalConfig | null = null;
  private portalCooldown: number = 0;
  private hasGreeted:     boolean = false;

  // DOM
  private hudRoot!:        HTMLDivElement;
  private portalCards:     Map<string, HTMLDivElement> = new Map();
  private activeCard:      HTMLDivElement | null = null;
  private greetTimers:     ReturnType<typeof setTimeout>[] = [];
  private pointerHintEl:   HTMLDivElement | null = null;
  private echoUnsub!:      () => void;
  private echoMsgEl!:      HTMLDivElement;
  private echoMsgTimer:    ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  public async init(): Promise<void> {
    await super.init();
    this.scene.clearColor  = new Color4(0.01, 0.01, 0.03, 1);
    this.scene.ambientColor = new Color3(0.1, 0.1, 0.15);
    this.glowLayer = new GlowLayer('hubGlow', this.scene, { blurKernelSize: 32 });
    this.glowLayer.intensity = 0.75;
    this.echoAI = EchoAI.getInstance();
  }

  public async loadAssets(): Promise<void> {
    await super.loadAssets();
    this.updateLoadingProgress(30, "Chargement de l'environnement...");
  }

  public async createScene(): Promise<void> {
    this.updateLoadingProgress(40, "Création de l'environnement...");
    this.environment = new HubEnvironment(this.scene, this.glowLayer);
    this.environment.create();

    this.updateLoadingProgress(60, 'Création des portails...');
    this.createPortals();

    this.updateLoadingProgress(70, 'Initialisation du joueur...');
    this.playerController = new ThirdPersonController(this.scene, {
      moveSpeed:        5,
      runSpeed:         10,
      cameraDistance:   6,
      cameraHeight:     2.5,
      mouseSensitivity: 0.0022,
    });
    this.playerController.setPosition(new Vector3(0, 0, 10));

    const canvas = this.scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;
    this.playerController.enablePointerLock(canvas);

    this.updateLoadingProgress(80, "Initialisation d'ECHO...");
    this.echoDrone = new EchoDrone(this.scene, this.glowLayer);
    this.echoDrone.setPosition(new Vector3(2, 1.5, 10));

    this.updateLoadingProgress(90, "Construction de l'interface...");
    this.buildHUD();

    this.echoUnsub = this.echoAI.onMessage((advice) => {
      this.showEchoMessage(advice.message);
    });

    this.updateLoadingProgress(100, 'Bienvenue dans NEXUS !');
    setTimeout(() => this.hideLoadingScreen(), 500);
  }

  public update(deltaTime: number): void {
    this.playerController.update(deltaTime);

    const playerPos = this.playerController.getPosition();
    const playerRot = this.playerController.getRotation();
    this.echoDrone.update(deltaTime, playerPos, playerRot);
    this.echoAI.update(deltaTime);

    if (this.portalCooldown > 0) this.portalCooldown -= deltaTime;

    this.checkPortalProximity(playerPos);
    this.animatePortals(playerPos);

    if (!this.hasGreeted) this.greetPlayer();

    this.inputManager.update();
  }

  public async dispose(): Promise<void> {
    this.echoUnsub?.();
    this.greetTimers.forEach(t => clearTimeout(t));
    this.greetTimers = [];
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);
    this.removeHUD();
    this.playerController.dispose();
    this.echoDrone.dispose();
    this.environment.dispose();
    this.glowLayer.dispose();
    await super.dispose();
  }

  // ─── Portails ────────────────────────────────────────────────────────────────

  private createPortals(): void {
    for (const config of this.portalConfigs) {
      this.portals.set(config.name, this.createPortal(config));
    }
  }

  private createPortal(config: PortalConfig): TransformNode {
    const root = new TransformNode(`portal_${config.name}`, this.scene);
    root.position = config.position;

    // Base plate
    const base = MeshBuilder.CreateCylinder(`pBase_${config.name}`, {
      diameter: 6.5, height: 0.3, tessellation: 64,
    }, this.scene);
    base.position.y = 0.15;
    base.parent = root;
    base.checkCollisions = true;
    const baseMat = new PBRMaterial(`pBaseMat_${config.name}`, this.scene);
    baseMat.albedoColor = new Color3(0.06, 0.06, 0.10);
    baseMat.metallic    = 0.8;
    baseMat.roughness   = 0.2;
    base.material = baseMat;

    // Anneau émissif au sol
    const groundRing = MeshBuilder.CreateTorus(`pGroundRing_${config.name}`, {
      diameter: 6.5, thickness: 0.1, tessellation: 64,
    }, this.scene);
    groundRing.position.y = 0.31;
    groundRing.parent = root;
    const grMat = new StandardMaterial(`pGroundRingMat_${config.name}`, this.scene);
    grMat.emissiveColor = config.color.scale(0.7);
    groundRing.material = grMat;
    this.glowLayer.addIncludedOnlyMesh(groundRing);

    // Piliers
    for (const xSign of [-1, 1]) {
      const pillar = MeshBuilder.CreateCylinder(`pPillar_${config.name}_${xSign}`, {
        height: 5.8, diameterTop: 0.28, diameterBottom: 0.44, tessellation: 12,
      }, this.scene);
      pillar.position.set(xSign * 2.9, 2.9, 0);
      pillar.parent = root;
      pillar.checkCollisions = true;
      const pm = new PBRMaterial(`pPillarMat_${config.name}_${xSign}`, this.scene);
      pm.albedoColor = new Color3(0.08, 0.08, 0.14);
      pm.metallic    = 0.85;
      pm.roughness   = 0.25;
      pillar.material = pm;

      // Orbe au sommet du pilier
      const orb = MeshBuilder.CreateSphere(`pOrb_${config.name}_${xSign}`, { diameter: 0.42 }, this.scene);
      orb.position.set(xSign * 2.9, 5.95, 0);
      orb.parent = root;
      const om = new StandardMaterial(`pOrbMat_${config.name}_${xSign}`, this.scene);
      om.emissiveColor = config.color;
      orb.material = om;
      this.glowLayer.addIncludedOnlyMesh(orb);

      const orbLight = new PointLight(`pOrbLight_${config.name}_${xSign}`,
        config.position.add(new Vector3(xSign * 2.9, 5.95, 0)), this.scene);
      orbLight.diffuse   = config.color;
      orbLight.intensity = 0.6;
      orbLight.range     = 8;
    }

    // Anneau principal
    const ring = MeshBuilder.CreateTorus(`pRing_${config.name}`, {
      diameter: 5.2, thickness: 0.22, tessellation: 80,
    }, this.scene);
    ring.position.y  = 3.0;
    ring.rotation.x  = Math.PI / 2;
    ring.parent = root;
    const ringMat = new StandardMaterial(`pRingMat_${config.name}`, this.scene);
    ringMat.emissiveColor = config.color;
    ring.material = ringMat;
    this.glowLayer.addIncludedOnlyMesh(ring);

    // Anneau secondaire contre-rotatif
    const ring2 = MeshBuilder.CreateTorus(`pRing2_${config.name}`, {
      diameter: 4.6, thickness: 0.1, tessellation: 64,
    }, this.scene);
    ring2.position.y = 3.0;
    ring2.rotation.x = Math.PI / 2;
    ring2.parent = root;
    const ring2Mat = new StandardMaterial(`pRing2Mat_${config.name}`, this.scene);
    ring2Mat.emissiveColor = config.color.scale(0.5);
    ring2Mat.alpha = 0.7;
    ring2.material = ring2Mat;
    this.glowLayer.addIncludedOnlyMesh(ring2);

    // Disque central (vortex)
    const disc = MeshBuilder.CreateDisc(`pDisc_${config.name}`, {
      radius: 2.1, tessellation: 64,
    }, this.scene);
    disc.position.y = 3.0;
    disc.rotation.x = Math.PI / 2;
    disc.parent = root;
    const discMat = new StandardMaterial(`pDiscMat_${config.name}`, this.scene);
    discMat.emissiveColor    = config.color.scale(0.35);
    discMat.alpha            = 0.55;
    discMat.backFaceCulling  = false;
    disc.material = discMat;

    // Icône wireframe
    const icon = this.buildPortalIcon(config);
    icon.position.y = 3.0;
    icon.parent = root;
    const iconMat = new StandardMaterial(`pIconMat_${config.name}`, this.scene);
    iconMat.emissiveColor = config.color;
    iconMat.wireframe     = true;
    icon.material = iconMat;
    this.glowLayer.addIncludedOnlyMesh(icon);

    // Animations (via registerBeforeRender — observer stocké dans root metadata pour cleanup)
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      ring.rotation.z  =  t * 0.28;
      ring2.rotation.z = -t * 0.46;
      disc.rotation.z  =  t * 0.18;
      icon.rotation.y  =  t * 0.7;
      const pulse = 1 + Math.sin(t * 2.2) * 0.04;
      ring.scaling.setAll(pulse);
    });
    root.metadata = { observer: obs };

    return root;
  }

  private buildPortalIcon(config: PortalConfig): Mesh {
    switch (config.icon) {
      case 'maze':
        return MeshBuilder.CreateBox(`icon_${config.name}`, { size: 0.9 }, this.scene);
      case 'mirror':
        return MeshBuilder.CreatePolyhedron(`icon_${config.name}`, { type: 1, size: 0.45 }, this.scene);
      default:
        return MeshBuilder.CreateSphere(`icon_${config.name}`, { diameter: 0.8, segments: 16 }, this.scene);
    }
  }

  // ─── Proximité & interaction ─────────────────────────────────────────────────

  private checkPortalProximity(playerPos: Vector3): void {
    const INTERACT_DIST = 7;
    let nearest: PortalConfig | null = null;
    let nearestDist = Infinity;

    for (const config of this.portalConfigs) {
      const dist = Vector3.Distance(playerPos, config.position);
      if (dist < INTERACT_DIST && dist < nearestDist) {
        nearest = config;
        nearestDist = dist;
      }
    }

    // Changement de portail le plus proche
    if (nearest !== this.nearestPortal) {
      // Cacher l'ancienne carte
      if (this.activeCard) {
        this.activeCard.style.opacity = '0';
        this.activeCard.style.transform = 'translateY(20px)';
        this.activeCard = null;
      }
      // Afficher la nouvelle carte
      if (nearest) {
        const card = this.portalCards.get(nearest.name);
        if (card) {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
          this.activeCard = card;
        }
        if (this.portalCooldown <= 0) {
          this.echoAI.say(
            `${nearest.displayName} — ${nearest.subtitle}. Appuie sur E pour entrer.`,
            AdviceType.TIP,
          );
          this.portalCooldown = 4;
        }
      }
    }

    this.nearestPortal = nearest;

    // Entrée via E
    if (nearest && this.inputManager.isKeyJustPressed('e')) {
      this.enterPortal(nearest);
    }
  }

  private animatePortals(playerPos: Vector3): void {
    for (const config of this.portalConfigs) {
      const root = this.portals.get(config.name);
      if (!root) continue;
      const dist = Vector3.Distance(playerPos, config.position);
      const near = dist < 10;
      const targetScale = near ? 1.06 : 1.0;
      root.scaling.x += (targetScale - root.scaling.x) * 0.07;
      root.scaling.y += (targetScale - root.scaling.y) * 0.07;
      root.scaling.z += (targetScale - root.scaling.z) * 0.07;
    }
  }

  private enterPortal(config: PortalConfig): void {
    this.echoAI.say(
      `Chargement de ${config.displayName}. Prépare-toi !`,
      AdviceType.ENCOURAGEMENT,
    );
    setTimeout(() => {
      SceneManager.getInstance().loadScene(config.sceneName).catch((err) => {
        console.error(`Impossible de charger ${config.sceneName}:`, err);
      });
    }, 400);
  }

  // ─── HUD DOM ────────────────────────────────────────────────────────────────

  private buildHUD(): void {
    this.hudRoot = document.createElement('div');
    Object.assign(this.hudRoot.style, {
      position:       'fixed',
      inset:          '0',
      pointerEvents:  'none',
      fontFamily:     '"Courier New", monospace',
      zIndex:         '20',
    });
    document.body.appendChild(this.hudRoot);

    // Bandeau titre haut
    const topBar = document.createElement('div');
    Object.assign(topBar.style, {
      position:       'fixed',
      top:            '0', left: '0', right: '0',
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'center',
      padding:        '12px 24px',
      background:     'rgba(0,0,0,0.55)',
      borderBottom:   '1px solid rgba(80,140,255,0.3)',
    });

    const logoEl = document.createElement('div');
    Object.assign(logoEl.style, {
      color: '#00ccff', fontSize: '18px', letterSpacing: '0.35em', fontWeight: 'bold',
      textShadow: '0 0 18px #00ccff',
    });
    logoEl.textContent = 'N E X U S';
    topBar.appendChild(logoEl);

    const infoEl = document.createElement('div');
    Object.assign(infoEl.style, {
      color: '#4a7fa5', fontSize: '11px', letterSpacing: '0.1em', textAlign: 'right',
    });
    const infoLine1 = document.createElement('div');
    infoLine1.style.color = '#7ec8e3';
    infoLine1.textContent = '2 JEUX DISPONIBLES';
    const infoLine2 = document.createElement('div');
    infoLine2.textContent = 'WASD · Souris · E = Entrer';
    infoEl.appendChild(infoLine1);
    infoEl.appendChild(infoLine2);
    topBar.appendChild(infoEl);

    this.hudRoot.appendChild(topBar);

    // Messages ECHO
    this.echoMsgEl = document.createElement('div');
    Object.assign(this.echoMsgEl.style, {
      position:       'fixed',
      bottom:         '40px',
      left:           '50%',
      transform:      'translateX(-50%)',
      background:     'rgba(0,5,20,0.88)',
      border:         '1px solid #00ccff44',
      borderRadius:   '6px',
      color:          '#00ccff',
      padding:        '10px 24px',
      fontSize:       '13px',
      letterSpacing:  '0.05em',
      opacity:        '0',
      transition:     'opacity 0.3s',
      pointerEvents:  'none',
      zIndex:         '25',
      maxWidth:       '560px',
      textAlign:      'center',
      whiteSpace:     'nowrap',
    });
    document.body.appendChild(this.echoMsgEl);

    // Cartes portail
    for (const config of this.portalConfigs) {
      const card = this.buildPortalCard(config);
      this.portalCards.set(config.name, card);
      document.body.appendChild(card);
    }

    // Hint pointer lock
    this.buildPointerLockHint();
  }

  private buildPortalCard(config: PortalConfig): HTMLDivElement {
    const card = document.createElement('div');
    Object.assign(card.style, {
      position:       'fixed',
      bottom:         '90px',
      left:           '50%',
      transform:      'translateX(-50%) translateY(20px)',
      width:          '340px',
      background:     'rgba(0,5,20,0.92)',
      border:         `1px solid ${this.colorToCss(config.color, 0.6)}`,
      borderRadius:   '8px',
      padding:        '20px 22px 18px',
      opacity:        '0',
      transition:     'opacity 0.25s ease, transform 0.25s ease',
      pointerEvents:  'none',
      zIndex:         '24',
      fontFamily:     '"Courier New", monospace',
    });

    const numberEl = document.createElement('div');
    Object.assign(numberEl.style, {
      color:          this.colorToCss(config.color, 0.5),
      fontSize:       '10px',
      letterSpacing:  '0.2em',
      marginBottom:   '4px',
    });
    numberEl.textContent = `MINI-JEU ${config.number} / 02`;

    const titleEl = document.createElement('div');
    Object.assign(titleEl.style, {
      color:          this.colorToCss(config.color, 1),
      fontSize:       '22px',
      fontWeight:     'bold',
      letterSpacing:  '0.15em',
      textShadow:     `0 0 14px ${this.colorToCss(config.color, 0.7)}`,
      marginBottom:   '2px',
    });
    titleEl.textContent = config.displayName;

    const subtitleEl = document.createElement('div');
    Object.assign(subtitleEl.style, {
      color:          '#7ec8e3',
      fontSize:       '12px',
      letterSpacing:  '0.08em',
      marginBottom:   '10px',
    });
    subtitleEl.textContent = config.subtitle;

    const tagsEl = document.createElement('div');
    Object.assign(tagsEl.style, {
      display:        'flex',
      gap:            '6px',
      flexWrap:       'wrap',
      marginBottom:   '12px',
    });
    for (const tag of config.tags) {
      const t = document.createElement('span');
      Object.assign(t.style, {
        background:     this.colorToCss(config.color, 0.12),
        border:         `1px solid ${this.colorToCss(config.color, 0.35)}`,
        borderRadius:   '3px',
        color:          this.colorToCss(config.color, 0.9),
        fontSize:       '9px',
        letterSpacing:  '0.12em',
        padding:        '2px 7px',
      });
      t.textContent = tag;
      tagsEl.appendChild(t);
    }

    const descEl = document.createElement('div');
    Object.assign(descEl.style, {
      color:          '#4a7fa5',
      fontSize:       '11px',
      lineHeight:     '1.55',
      marginBottom:   '14px',
    });
    descEl.textContent = config.description;

    const enterEl = document.createElement('div');
    Object.assign(enterEl.style, {
      display:        'flex',
      alignItems:     'center',
      gap:            '10px',
      color:          this.colorToCss(config.color, 1),
      fontSize:       '13px',
      letterSpacing:  '0.15em',
      fontWeight:     'bold',
    });
    const kbd = document.createElement('kbd');
    Object.assign(kbd.style, {
      background:     this.colorToCss(config.color, 0.15),
      border:         `1px solid ${this.colorToCss(config.color, 0.5)}`,
      borderRadius:   '4px',
      padding:        '3px 10px',
      fontSize:       '14px',
    });
    kbd.textContent = 'E';
    enterEl.appendChild(kbd);
    const enterText = document.createElement('span');
    enterText.textContent = 'ENTRER';
    enterEl.appendChild(enterText);

    card.appendChild(numberEl);
    card.appendChild(titleEl);
    card.appendChild(subtitleEl);
    card.appendChild(tagsEl);
    card.appendChild(descEl);
    card.appendChild(enterEl);

    return card;
  }

  private buildPointerLockHint(): void {
    this.pointerHintEl = document.createElement('div');
    Object.assign(this.pointerHintEl.style, {
      position:       'fixed',
      bottom:         '24px',
      left:           '50%',
      transform:      'translateX(-50%)',
      background:     'rgba(0,0,0,0.65)',
      color:          '#a0c8ff',
      padding:        '10px 22px',
      borderRadius:   '8px',
      fontFamily:     'monospace',
      fontSize:       '13px',
      pointerEvents:  'none',
      zIndex:         '9999',
      border:         '1px solid rgba(80,140,255,0.4)',
      transition:     'opacity 0.4s',
    });
    this.pointerHintEl.textContent = 'Clic pour jouer — Echap pour liberer la souris';
    document.body.appendChild(this.pointerHintEl);

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement && this.pointerHintEl) {
        this.pointerHintEl.style.opacity = '0';
        setTimeout(() => this.pointerHintEl?.remove(), 400);
        this.pointerHintEl = null;
      }
    }, { once: true });
  }

  private removeHUD(): void {
    this.hudRoot?.remove();
    this.echoMsgEl?.remove();
    this.pointerHintEl?.remove();
    this.portalCards.forEach(c => c.remove());
    this.portalCards.clear();
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);

    // Nettoyer les observers d'animation des portails
    for (const root of this.portals.values()) {
      const obs = root.metadata?.observer;
      if (obs) this.scene.onBeforeRenderObservable.remove(obs);
    }
  }

  private showEchoMessage(msg: string): void {
    if (this.echoMsgTimer) clearTimeout(this.echoMsgTimer);
    this.echoMsgEl.textContent = `ECHO  ▸  ${msg}`;
    this.echoMsgEl.style.opacity = '1';
    this.echoMsgTimer = setTimeout(() => {
      this.echoMsgEl.style.opacity = '0';
    }, 5000);
  }

  // ─── Bienvenue ───────────────────────────────────────────────────────────────

  private greetPlayer(): void {
    this.hasGreeted = true;
    this.greetTimers.push(setTimeout(() => {
      this.echoAI.say(
        "Bienvenue dans NEXUS. Je suis ECHO, ton compagnon IA. Deux jeux t'attendent — approche-toi d'un portail.",
        AdviceType.TIP,
      );
    }, 2000));
    this.greetTimers.push(setTimeout(() => {
      this.echoAI.say(
        "Chaque jeu utilise une IA différente qui s'adapte à toi. Tes performances sont analysées en temps réel.",
        AdviceType.OBSERVATION,
      );
    }, 10000));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private colorToCss(c: Color3, alpha: number): string {
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  private updateLoadingProgress(percent: number, status: string): void {
    const bar    = document.getElementById('loading-bar');
    const label  = document.getElementById('loading-status');
    if (bar)   bar.style.width = `${percent}%`;
    if (label) label.textContent = status;
  }

  private hideLoadingScreen(): void {
    const screen = document.getElementById('loading-screen');
    if (screen) screen.classList.add('hidden');
  }
}
