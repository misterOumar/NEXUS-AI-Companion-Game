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
} from '@babylonjs/core';
import { AbstractScene } from './AbstractScene';
import { HubEnvironment } from './HubEnvironment';
import { ThirdPersonController } from '@/player/ThirdPersonController';
import { EchoDrone } from '@/player/EchoDrone';
import { EchoAI, AdviceType } from '@/ai/EchoAI';
import { HUD } from '@/ui/HUD';
import { DialogueBox } from '@/ui/DialogueBox';
import { Engine } from '@/core/Engine';
import { SceneManager } from '@/core/SceneManager';

/**
 * Configuration d'un portail de mini-jeu
 */
interface PortalConfig {
  name: string;
  displayName: string;
  position: Vector3;
  color: Color3;
  sceneName: string;
  description: string;
  icon: string;
}

/**
 * HubScene - Le monde central de NEXUS
 * Environnement immersif avec personnage 3ème personne et drone ECHO
 */
export class HubScene extends AbstractScene {
  // Composants principaux
  private playerController!: ThirdPersonController;
  private echoDrone!: EchoDrone;
  private echoAI!: EchoAI;
  private environment!: HubEnvironment;
  private hud!: HUD;
  private dialogueBox!: DialogueBox;
  private glowLayer!: GlowLayer;

  // Portails
  private portals: Map<string, TransformNode> = new Map();
  private portalConfigs: PortalConfig[] = [
    {
      name: 'neuroMaze',
      displayName: 'NeuroMaze',
      position: new Vector3(-18, 0, 0),
      color: new Color3(0.2, 0.9, 0.4),
      sceneName: 'NeuroMazeScene',
      description: 'Labyrinthe adaptatif',
      icon: 'maze',
    },
    {
      name: 'mirrorDuel',
      displayName: 'MirrorDuel',
      position: new Vector3(0, 0, -18),
      color: new Color3(0.8, 0.3, 0.95),
      sceneName: 'MirrorDuelScene',
      description: 'Affronte ton clone IA',
      icon: 'mirror',
    },
    {
      name: 'mindRush',
      displayName: 'MindRush',
      position: new Vector3(18, 0, 0),
      color: new Color3(1, 0.6, 0.2),
      sceneName: 'MindRushScene',
      description: 'Arène de décisions',
      icon: 'brain',
    },
  ];

  // État
  private hasGreeted: boolean = false;
  private nearestPortal: PortalConfig | null = null;
  private portalCooldown: number = 0;

  public async init(): Promise<void> {
    await super.init();

    // Couleur de fond (ciel nocturne)
    this.scene.clearColor = new Color4(0.01, 0.01, 0.03, 1);
    this.scene.ambientColor = new Color3(0.1, 0.1, 0.15);

    // Glow layer global
    this.glowLayer = new GlowLayer('hubGlow', this.scene);
    this.glowLayer.intensity = 0.7;

    // Initialise l'IA
    this.echoAI = EchoAI.getInstance();
  }

  public async loadAssets(): Promise<void> {
    await super.loadAssets();
    this.updateLoadingProgress(30, 'Chargement de l\'environnement...');
  }

  public async createScene(): Promise<void> {
    this.updateLoadingProgress(40, 'Création de l\'environnement...');

    // Crée l'environnement
    this.environment = new HubEnvironment(this.scene, this.glowLayer);
    this.environment.create();

    this.updateLoadingProgress(60, 'Création des portails...');

    // Crée les portails
    this.createPortals();

    this.updateLoadingProgress(70, 'Initialisation du joueur...');

    // Crée le joueur avec contrôleur 3ème personne
    this.playerController = new ThirdPersonController(this.scene, {
      moveSpeed: 5,
      runSpeed: 10,
      cameraDistance: 6,
      cameraHeight: 2.5,
    });
    this.playerController.setPosition(new Vector3(0, 0, 8));

    this.updateLoadingProgress(80, 'Initialisation d\'ECHO...');

    // Crée le drone ECHO (utilise le glow layer existant)
    this.echoDrone = new EchoDrone(this.scene, this.glowLayer);
    this.echoDrone.setPosition(new Vector3(2, 1.5, 8));

    this.updateLoadingProgress(90, 'Initialisation de l\'interface...');

    // UI
    this.hud = new HUD();
    this.dialogueBox = new DialogueBox();

    // Configure les callbacks d'ECHO
    this.echoAI.onMessage((advice) => {
      this.dialogueBox.showAdvice(advice);
    });

    this.updateLoadingProgress(100, 'Bienvenue dans NEXUS !');

    // Masque l'écran de chargement après un court délai
    setTimeout(() => {
      this.hideLoadingScreen();
    }, 500);
  }

  /**
   * Crée les portails vers les mini-jeux
   */
  private createPortals(): void {
    this.portalConfigs.forEach((config) => {
      const portal = this.createPortal(config);
      this.portals.set(config.name, portal);
    });
  }

  /**
   * Crée un portail individuel amélioré
   */
  private createPortal(config: PortalConfig): TransformNode {
    const portalGroup = new TransformNode(`portal_${config.name}`, this.scene);
    portalGroup.position = config.position;

    // Base du portail
    const base = MeshBuilder.CreateCylinder(`portalBase_${config.name}`, {
      diameter: 6,
      height: 0.4,
      tessellation: 48,
    }, this.scene);
    base.position.y = 0.2;
    base.parent = portalGroup;
    base.checkCollisions = true;

    const baseMat = new PBRMaterial(`portalBaseMat_${config.name}`, this.scene);
    baseMat.albedoColor = new Color3(0.08, 0.08, 0.12);
    baseMat.metallic = 0.7;
    baseMat.roughness = 0.3;
    base.material = baseMat;

    // Anneau principal
    const mainRing = MeshBuilder.CreateTorus(`portalMainRing_${config.name}`, {
      diameter: 5,
      thickness: 0.25,
      tessellation: 64,
    }, this.scene);
    mainRing.position.y = 2.5;
    mainRing.rotation.x = Math.PI / 2;
    mainRing.parent = portalGroup;

    const ringMat = new StandardMaterial(`portalRingMat_${config.name}`, this.scene);
    ringMat.emissiveColor = config.color;
    ringMat.diffuseColor = config.color.scale(0.5);
    mainRing.material = ringMat;
    this.glowLayer.addIncludedOnlyMesh(mainRing);

    // Anneau secondaire
    const secondRing = MeshBuilder.CreateTorus(`portalSecondRing_${config.name}`, {
      diameter: 4.5,
      thickness: 0.12,
      tessellation: 48,
    }, this.scene);
    secondRing.position.y = 2.5;
    secondRing.rotation.x = Math.PI / 2;
    secondRing.parent = portalGroup;

    const secondRingMat = new StandardMaterial(`portalSecondRingMat_${config.name}`, this.scene);
    secondRingMat.emissiveColor = config.color.scale(0.6);
    secondRingMat.alpha = 0.7;
    secondRing.material = secondRingMat;
    this.glowLayer.addIncludedOnlyMesh(secondRing);

    // Surface du portail (vortex)
    const surface = MeshBuilder.CreateDisc(`portalSurface_${config.name}`, {
      radius: 2.2,
      tessellation: 48,
    }, this.scene);
    surface.position.y = 2.5;
    surface.rotation.x = Math.PI / 2;
    surface.parent = portalGroup;

    const surfaceMat = new StandardMaterial(`portalSurfaceMat_${config.name}`, this.scene);
    surfaceMat.emissiveColor = config.color.scale(0.4);
    surfaceMat.alpha = 0.5;
    surfaceMat.backFaceCulling = false;
    surface.material = surfaceMat;

    // Piliers
    this.createPortalPillars(portalGroup, config);

    // Animations
    this.scene.registerBeforeRender(() => {
      const time = performance.now() / 1000;
      mainRing.rotation.z = time * 0.3;
      secondRing.rotation.z = -time * 0.5;
      surface.rotation.z = time * 0.2;

      // Pulsation
      const pulse = 1 + Math.sin(time * 2) * 0.05;
      mainRing.scaling.setAll(pulse);
    });

    // Icône centrale
    this.createPortalIcon(portalGroup, config);

    return portalGroup;
  }

  /**
   * Crée les piliers du portail
   */
  private createPortalPillars(parent: TransformNode, config: PortalConfig): void {
    const pillarPositions = [
      new Vector3(-2.8, 0, 0),
      new Vector3(2.8, 0, 0),
    ];

    pillarPositions.forEach((pos, index) => {
      // Pilier
      const pillar = MeshBuilder.CreateCylinder(`pillar_${config.name}_${index}`, {
        height: 5.5,
        diameterTop: 0.3,
        diameterBottom: 0.5,
        tessellation: 12,
      }, this.scene);
      pillar.position = pos.clone();
      pillar.position.y = 2.75;
      pillar.parent = parent;
      pillar.checkCollisions = true;

      const pillarMat = new PBRMaterial(`pillarMat_${config.name}_${index}`, this.scene);
      pillarMat.albedoColor = new Color3(0.1, 0.1, 0.15);
      pillarMat.metallic = 0.8;
      pillarMat.roughness = 0.3;
      pillar.material = pillarMat;

      // Ornement lumineux
      const ornament = MeshBuilder.CreateSphere(`ornament_${config.name}_${index}`, {
        diameter: 0.4,
      }, this.scene);
      ornament.position = pos.clone();
      ornament.position.y = 5.3;
      ornament.parent = parent;

      const ornamentMat = new StandardMaterial(`ornamentMat_${config.name}_${index}`, this.scene);
      ornamentMat.emissiveColor = config.color;
      ornament.material = ornamentMat;
      this.glowLayer.addIncludedOnlyMesh(ornament);
    });
  }

  /**
   * Crée l'icône centrale du portail
   */
  private createPortalIcon(parent: TransformNode, config: PortalConfig): void {
    let icon: Mesh;

    switch (config.icon) {
      case 'maze':
        // Icône labyrinthe : grille
        icon = MeshBuilder.CreateBox(`icon_${config.name}`, {
          size: 0.8,
        }, this.scene);
        icon.rotation.x = Math.PI / 4;
        icon.rotation.y = Math.PI / 4;
        break;

      case 'mirror':
        // Icône miroir : double octaèdre
        icon = MeshBuilder.CreatePolyhedron(`icon_${config.name}`, {
          type: 1, // Octahedron
          size: 0.4,
        }, this.scene);
        break;

      case 'brain':
        // Icône cerveau : sphère
        icon = MeshBuilder.CreateSphere(`icon_${config.name}`, {
          diameter: 0.8,
          segments: 16,
        }, this.scene);
        break;

      default:
        icon = MeshBuilder.CreateSphere(`icon_${config.name}`, {
          diameter: 0.6,
        }, this.scene);
    }

    icon.position.y = 2.5;
    icon.parent = parent;

    const iconMat = new StandardMaterial(`iconMat_${config.name}`, this.scene);
    iconMat.emissiveColor = config.color;
    iconMat.wireframe = true;
    icon.material = iconMat;

    this.glowLayer.addIncludedOnlyMesh(icon);

    // Animation de rotation
    this.scene.registerBeforeRender(() => {
      icon.rotation.y += 0.02;
    });
  }

  /**
   * Met à jour la scène (appelé chaque frame)
   */
  public update(deltaTime: number): void {
    // Met à jour le joueur
    this.playerController.update(deltaTime);

    // Met à jour le drone ECHO
    const playerPos = this.playerController.getPosition();
    const playerRot = this.playerController.getRotation();
    this.echoDrone.update(deltaTime, playerPos, playerRot);

    // Met à jour l'IA
    this.echoAI.update(deltaTime);

    // Met à jour le HUD
    const engine = Engine.getInstance();
    this.hud.updateFPS(engine.getFPS());

    // Cooldown des portails
    if (this.portalCooldown > 0) {
      this.portalCooldown -= deltaTime;
    }

    // Vérifie la proximité des portails
    this.checkPortalProximity(playerPos);

    // Message de bienvenue
    if (!this.hasGreeted) {
      this.greetPlayer();
    }

    // Efface les états "just pressed" EN DERNIER — après toutes les vérifications
    this.inputManager.update();
  }

  /**
   * Vérifie si le joueur est proche d'un portail
   */
  private checkPortalProximity(playerPos: Vector3): void {
    const interactionDistance = 6;
    let nearest: PortalConfig | null = null;
    let nearestDist = Infinity;

    for (const config of this.portalConfigs) {
      const dist = Vector3.Distance(playerPos, config.position);
      if (dist < interactionDistance && dist < nearestDist) {
        nearest = config;
        nearestDist = dist;
      }
    }

    // Si on vient d'entrer dans la zone d'un portail
    if (nearest && nearest !== this.nearestPortal && this.portalCooldown <= 0) {
      this.echoAI.say(
        `${nearest.displayName} - ${nearest.description}. Appuie sur E pour entrer.`,
        AdviceType.TIP
      );
      this.portalCooldown = 3; // Cooldown de 3 secondes
    }

    this.nearestPortal = nearest;

    // Affiche l'indicateur d'interaction
    if (nearest) {
      this.hud.showNotification(`[E] ${nearest.displayName}`, 100);
    }

    // Interaction avec E
    if (nearest && this.inputManager.isKeyJustPressed('e')) {
      this.enterPortal(nearest);
    }
  }

  /**
   * Entre dans un portail
   */
  private enterPortal(config: PortalConfig): void {
    this.echoAI.say(
      `Excellent choix ! ${config.displayName} va tester tes capacités. Prépare-toi !`,
      AdviceType.ENCOURAGEMENT
    );

    // Petit délai (400ms) pour laisser ECHO parler — le SceneManager gère ensuite le fade noir
    setTimeout(() => {
      SceneManager.getInstance().loadScene(config.sceneName).catch((err) => {
        console.error(`Impossible de charger ${config.sceneName}:`, err);
      });
    }, 400);
  }

  /**
   * Message de bienvenue
   */
  private greetPlayer(): void {
    setTimeout(() => {
      this.echoAI.say(
        "Bienvenue dans NEXUS ! Je suis ECHO, ton compagnon IA. Utilise WASD pour te déplacer et la souris pour regarder autour de toi. Les portails mènent aux différents mini-jeux.",
        AdviceType.TIP
      );
      this.hasGreeted = true;

      // Second message après quelques secondes
      setTimeout(() => {
        this.echoAI.say(
          "Je vais analyser ton style de jeu pour t'aider à t'améliorer. Approche-toi d'un portail pour commencer !",
          AdviceType.OBSERVATION
        );
      }, 8000);
    }, 2000);
  }

  /**
   * Met à jour la barre de progression du chargement
   */
  private updateLoadingProgress(percent: number, status: string): void {
    const loadingBar = document.getElementById('loading-bar');
    const loadingStatus = document.getElementById('loading-status');

    if (loadingBar) loadingBar.style.width = `${percent}%`;
    if (loadingStatus) loadingStatus.textContent = status;
  }

  /**
   * Masque l'écran de chargement
   */
  private hideLoadingScreen(): void {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('hidden');
    }
  }

  /**
   * Libère les ressources
   */
  public async dispose(): Promise<void> {
    this.playerController.dispose();
    this.echoDrone.dispose();
    this.environment.dispose();
    this.hud.dispose();
    this.dialogueBox.dispose();
    this.glowLayer.dispose();

    await super.dispose();
  }
}
