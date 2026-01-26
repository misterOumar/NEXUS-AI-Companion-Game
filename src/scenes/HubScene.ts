import {
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  Texture,
  GlowLayer,
  Mesh,
  Animation,
  CubeTexture,
  ShadowGenerator,
} from '@babylonjs/core';
import { AbstractScene } from './AbstractScene';
import { PlayerController } from '@/player/PlayerController';
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
}

/**
 * HubScene - Le monde central de NEXUS
 * Point de départ du joueur avec accès aux différents mini-jeux
 */
export class HubScene extends AbstractScene {
  // Composants
  private playerController!: PlayerController;
  private echoDrone!: EchoDrone;
  private echoAI!: EchoAI;
  private hud!: HUD;
  private dialogueBox!: DialogueBox;
  private glowLayer!: GlowLayer;

  // Portails
  private portals: Map<string, Mesh> = new Map();
  private portalConfigs: PortalConfig[] = [
    {
      name: 'neuroMaze',
      displayName: 'NeuroMaze',
      position: new Vector3(-15, 0, 0),
      color: new Color3(0.2, 0.8, 0.4),
      sceneName: 'NeuroMazeScene',
      description: 'Labyrinthe adaptatif',
    },
    {
      name: 'mirrorDuel',
      displayName: 'MirrorDuel',
      position: new Vector3(0, 0, -15),
      color: new Color3(0.8, 0.3, 0.9),
      sceneName: 'MirrorDuelScene',
      description: 'Affronte ton clone IA',
    },
    {
      name: 'mindRush',
      displayName: 'MindRush',
      position: new Vector3(15, 0, 0),
      color: new Color3(0.9, 0.6, 0.2),
      sceneName: 'MindRushScene',
      description: 'Arène de décisions',
    },
  ];

  // État
  private hasGreeted: boolean = false;
  private nearestPortal: PortalConfig | null = null;

  public async init(): Promise<void> {
    await super.init();

    // Couleur de fond
    this.scene.clearColor = new Color4(0.02, 0.02, 0.05, 1);

    // Glow layer pour les effets lumineux
    this.glowLayer = new GlowLayer('hubGlow', this.scene);
    this.glowLayer.intensity = 0.6;

    // Initialise l'IA
    this.echoAI = EchoAI.getInstance();
  }

  public async loadAssets(): Promise<void> {
    await super.loadAssets();
    this.updateLoadingProgress(50, 'Chargement des assets...');
  }

  public async createScene(): Promise<void> {
    // Lumières
    this.createLights();

    // Environnement
    this.createEnvironment();

    // Portails vers les mini-jeux
    this.createPortals();

    // Joueur
    this.playerController = new PlayerController(this.scene);
    this.playerController.setPosition(new Vector3(0, 0, 5));

    // Drone ECHO
    this.echoDrone = new EchoDrone(this.scene);
    this.echoDrone.setPosition(new Vector3(2, 1.5, 5));

    // UI
    this.hud = new HUD();
    this.dialogueBox = new DialogueBox();

    // Configure les callbacks d'ECHO
    this.echoAI.onMessage((advice) => {
      this.dialogueBox.showAdvice(advice);
    });

    this.updateLoadingProgress(100, 'Prêt !');
    this.hideLoadingScreen();
  }

  /**
   * Crée les lumières de la scène
   */
  private createLights(): void {
    // Lumière ambiante
    const ambient = new HemisphericLight(
      'ambientLight',
      new Vector3(0, 1, 0),
      this.scene
    );
    ambient.intensity = 0.3;
    ambient.diffuse = new Color3(0.6, 0.7, 1);
    ambient.groundColor = new Color3(0.1, 0.1, 0.2);

    // Lumière directionnelle principale
    const sun = new DirectionalLight(
      'sunLight',
      new Vector3(-0.5, -1, -0.5),
      this.scene
    );
    sun.intensity = 0.8;
    sun.diffuse = new Color3(1, 0.95, 0.9);
  }

  /**
   * Crée l'environnement du hub
   */
  private createEnvironment(): void {
    // Sol principal
    const ground = MeshBuilder.CreateGround('ground', {
      width: 60,
      height: 60,
      subdivisions: 20,
    }, this.scene);

    const groundMat = new PBRMaterial('groundMat', this.scene);
    groundMat.albedoColor = new Color3(0.08, 0.08, 0.12);
    groundMat.metallic = 0.3;
    groundMat.roughness = 0.8;
    ground.material = groundMat;
    ground.receiveShadows = true;

    // Grille au sol pour effet futuriste
    this.createGridLines();

    // Plateforme centrale
    const platform = MeshBuilder.CreateCylinder('platform', {
      diameter: 8,
      height: 0.3,
      tessellation: 32,
    }, this.scene);
    platform.position.y = 0.15;

    const platformMat = new PBRMaterial('platformMat', this.scene);
    platformMat.albedoColor = new Color3(0.15, 0.15, 0.25);
    platformMat.metallic = 0.5;
    platformMat.roughness = 0.4;
    platformMat.emissiveColor = new Color3(0.1, 0.15, 0.3);
    platform.material = platformMat;

    // Piliers décoratifs
    this.createPillars();

    // Skybox simple (gradient)
    this.createSkybox();
  }

  /**
   * Crée les lignes de grille au sol
   */
  private createGridLines(): void {
    const gridMat = new StandardMaterial('gridMat', this.scene);
    gridMat.emissiveColor = new Color3(0.1, 0.2, 0.4);
    gridMat.alpha = 0.5;

    const gridSize = 60;
    const spacing = 2;

    for (let i = -gridSize / 2; i <= gridSize / 2; i += spacing) {
      // Lignes X
      const lineX = MeshBuilder.CreateBox(`gridX${i}`, {
        width: gridSize,
        height: 0.02,
        depth: 0.05,
      }, this.scene);
      lineX.position = new Vector3(0, 0.01, i);
      lineX.material = gridMat;

      // Lignes Z
      const lineZ = MeshBuilder.CreateBox(`gridZ${i}`, {
        width: 0.05,
        height: 0.02,
        depth: gridSize,
      }, this.scene);
      lineZ.position = new Vector3(i, 0.01, 0);
      lineZ.material = gridMat;
    }
  }

  /**
   * Crée les piliers décoratifs
   */
  private createPillars(): void {
    const pillarPositions = [
      new Vector3(-20, 0, -20),
      new Vector3(20, 0, -20),
      new Vector3(-20, 0, 20),
      new Vector3(20, 0, 20),
    ];

    const pillarMat = new PBRMaterial('pillarMat', this.scene);
    pillarMat.albedoColor = new Color3(0.1, 0.1, 0.15);
    pillarMat.metallic = 0.7;
    pillarMat.roughness = 0.3;

    pillarPositions.forEach((pos, i) => {
      const pillar = MeshBuilder.CreateCylinder(`pillar${i}`, {
        diameter: 1,
        height: 8,
        tessellation: 8,
      }, this.scene);
      pillar.position = pos.add(new Vector3(0, 4, 0));
      pillar.material = pillarMat;

      // Lumière au sommet
      const light = MeshBuilder.CreateSphere(`pillarLight${i}`, {
        diameter: 0.5,
      }, this.scene);
      light.position = pos.add(new Vector3(0, 8.5, 0));

      const lightMat = new StandardMaterial(`pillarLightMat${i}`, this.scene);
      lightMat.emissiveColor = new Color3(0.3, 0.5, 1);
      light.material = lightMat;
      this.glowLayer.addIncludedOnlyMesh(light);
    });
  }

  /**
   * Crée le skybox
   */
  private createSkybox(): void {
    const skybox = MeshBuilder.CreateBox('skyBox', { size: 500 }, this.scene);
    const skyboxMaterial = new StandardMaterial('skyBoxMat', this.scene);
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.disableLighting = true;
    skyboxMaterial.emissiveColor = new Color3(0.02, 0.02, 0.08);
    skybox.material = skyboxMaterial;
    skybox.infiniteDistance = true;
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
   * Crée un portail individuel
   */
  private createPortal(config: PortalConfig): Mesh {
    // Groupe parent
    const portalGroup = new Mesh(`portal_${config.name}`, this.scene);
    portalGroup.position = config.position;

    // Anneau du portail
    const ring = MeshBuilder.CreateTorus(`portalRing_${config.name}`, {
      diameter: 4,
      thickness: 0.3,
      tessellation: 32,
    }, this.scene);
    ring.rotation.x = Math.PI / 2;
    ring.parent = portalGroup;

    const ringMat = new StandardMaterial(`portalRingMat_${config.name}`, this.scene);
    ringMat.emissiveColor = config.color;
    ring.material = ringMat;
    this.glowLayer.addIncludedOnlyMesh(ring);

    // Surface du portail (effet de vortex simplifié)
    const surface = MeshBuilder.CreateDisc(`portalSurface_${config.name}`, {
      radius: 1.8,
      tessellation: 32,
    }, this.scene);
    surface.rotation.x = Math.PI / 2;
    surface.position.y = 0.1;
    surface.parent = portalGroup;

    const surfaceMat = new StandardMaterial(`portalSurfaceMat_${config.name}`, this.scene);
    surfaceMat.emissiveColor = config.color.scale(0.5);
    surfaceMat.alpha = 0.6;
    surfaceMat.backFaceCulling = false;
    surface.material = surfaceMat;

    // Animation de rotation
    const rotateAnim = new Animation(
      'portalRotate',
      'rotation.y',
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    rotateAnim.setKeys([
      { frame: 0, value: 0 },
      { frame: 120, value: Math.PI * 2 },
    ]);
    surface.animations.push(rotateAnim);
    this.scene.beginAnimation(surface, 0, 120, true);

    // Socle
    const base = MeshBuilder.CreateCylinder(`portalBase_${config.name}`, {
      diameter: 5,
      height: 0.2,
      tessellation: 32,
    }, this.scene);
    base.position.y = -0.1;
    base.parent = portalGroup;

    const baseMat = new PBRMaterial(`portalBaseMat_${config.name}`, this.scene);
    baseMat.albedoColor = new Color3(0.1, 0.1, 0.15);
    baseMat.metallic = 0.6;
    baseMat.roughness = 0.3;
    base.material = baseMat;

    // Label du portail (texte 3D simplifié avec un plane)
    this.createPortalLabel(config, portalGroup);

    return portalGroup;
  }

  /**
   * Crée le label d'un portail
   */
  private createPortalLabel(config: PortalConfig, parent: Mesh): void {
    // Pour l'instant, on utilise juste un mesh texte basique
    // Dans une version complète, on utiliserait DynamicTexture ou TextMesh
    const labelPlane = MeshBuilder.CreatePlane(`portalLabel_${config.name}`, {
      width: 3,
      height: 0.5,
    }, this.scene);
    labelPlane.position = new Vector3(0, 3, 0);
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    labelPlane.parent = parent;

    const labelMat = new StandardMaterial(`portalLabelMat_${config.name}`, this.scene);
    labelMat.emissiveColor = config.color;
    labelMat.alpha = 0.9;
    labelMat.backFaceCulling = false;
    labelPlane.material = labelMat;
  }

  /**
   * Met à jour la scène (appelé chaque frame)
   */
  public update(deltaTime: number): void {
    // Met à jour le joueur
    this.playerController.update(deltaTime);

    // Met à jour le drone ECHO
    const playerPos = this.playerController.getPosition();
    const playerRot = this.playerController.getMesh().rotation.y;
    this.echoDrone.update(deltaTime, playerPos, playerRot);

    // Met à jour l'IA
    this.echoAI.update(deltaTime);

    // Met à jour les inputs
    this.inputManager.update();

    // Met à jour le HUD
    const engine = Engine.getInstance();
    this.hud.updateFPS(engine.getFPS());

    // Vérifie la proximité des portails
    this.checkPortalProximity(playerPos);

    // Message de bienvenue
    if (!this.hasGreeted) {
      this.greetPlayer();
    }
  }

  /**
   * Vérifie si le joueur est proche d'un portail
   */
  private checkPortalProximity(playerPos: Vector3): void {
    const interactionDistance = 5;
    let nearest: PortalConfig | null = null;
    let nearestDist = Infinity;

    this.portalConfigs.forEach((config) => {
      const dist = Vector3.Distance(playerPos, config.position);
      if (dist < interactionDistance && dist < nearestDist) {
        nearest = config;
        nearestDist = dist;
      }
    });

    // Si on vient d'entrer dans la zone d'un portail
    if (nearest && nearest !== this.nearestPortal) {
      this.echoAI.say(
        `${nearest.displayName} - ${nearest.description}. Approche-toi pour entrer.`,
        AdviceType.TIP
      );
    }

    this.nearestPortal = nearest;

    // Interaction avec E
    if (nearest && this.inputManager.isKeyJustPressed('e')) {
      this.enterPortal(nearest);
    }
  }

  /**
   * Entre dans un portail
   */
  private async enterPortal(config: PortalConfig): Promise<void> {
    this.echoAI.say(`Allons-y ! Direction ${config.displayName}.`, AdviceType.ENCOURAGEMENT);

    // Ici on chargerait la scène correspondante
    // const sceneManager = SceneManager.getInstance();
    // await sceneManager.loadScene(config.sceneName);

    // Pour l'instant, juste un message
    this.hud.showNotification(`${config.displayName} - Bientôt disponible !`, 3000);
  }

  /**
   * Message de bienvenue
   */
  private greetPlayer(): void {
    setTimeout(() => {
      this.echoAI.say(
        "Bienvenue dans NEXUS ! Je suis ECHO, ton compagnon IA. Explore le hub et choisis un mini-jeu.",
        AdviceType.ENCOURAGEMENT
      );
      this.hasGreeted = true;
    }, 1500);
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
    this.hud.dispose();
    this.dialogueBox.dispose();
    this.glowLayer.dispose();

    await super.dispose();
  }
}
