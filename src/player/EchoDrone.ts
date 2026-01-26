import {
  Scene,
  Vector3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  GlowLayer,
  Animation,
  PointLight,
} from '@babylonjs/core';
import { EchoAI, Advice, AdviceType } from '@/ai/EchoAI';

/**
 * Représentation visuelle du drone ECHO
 * Suit le joueur et affiche des réactions visuelles aux conseils
 */
export class EchoDrone {
  private scene: Scene;
  private echoAI: EchoAI;

  // Meshes
  private droneGroup: Mesh;
  private coreBody: Mesh;
  private ring: Mesh;
  private light: PointLight;

  // Animation
  private targetPosition: Vector3 = Vector3.Zero();
  private readonly followDistance: number = 2;
  private readonly followHeight: number = 1.5;
  private readonly followSpeed: number = 3;

  // État
  private baseColor: Color3 = new Color3(0.3, 0.5, 1); // Bleu
  private glowLayer: GlowLayer;

  constructor(scene: Scene) {
    this.scene = scene;
    this.echoAI = EchoAI.getInstance();

    // Crée le glow layer
    this.glowLayer = new GlowLayer('echoGlow', scene);
    this.glowLayer.intensity = 0.8;

    // Crée le drone
    this.droneGroup = new Mesh('echoDrone', scene);
    this.coreBody = this.createCoreBody();
    this.ring = this.createRing();
    this.light = this.createLight();

    // Configure les animations
    this.setupAnimations();

    // Écoute les messages d'ECHO
    this.echoAI.onMessage(this.onEchoMessage.bind(this));
  }

  /**
   * Crée le corps principal du drone
   */
  private createCoreBody(): Mesh {
    const body = MeshBuilder.CreateSphere('echoBody', {
      diameter: 0.3,
      segments: 16,
    }, this.scene);

    const material = new StandardMaterial('echoBodyMat', this.scene);
    material.emissiveColor = this.baseColor;
    material.diffuseColor = this.baseColor;
    material.specularColor = new Color3(1, 1, 1);
    material.specularPower = 32;

    body.material = material;
    body.parent = this.droneGroup;

    // Ajoute au glow
    this.glowLayer.addIncludedOnlyMesh(body);

    return body;
  }

  /**
   * Crée l'anneau autour du drone
   */
  private createRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('echoRing', {
      diameter: 0.5,
      thickness: 0.03,
      tessellation: 32,
    }, this.scene);

    const material = new StandardMaterial('echoRingMat', this.scene);
    material.emissiveColor = this.baseColor.scale(0.7);
    material.diffuseColor = this.baseColor.scale(0.5);
    material.alpha = 0.8;

    ring.material = material;
    ring.parent = this.droneGroup;
    ring.rotation.x = Math.PI / 2;

    this.glowLayer.addIncludedOnlyMesh(ring);

    return ring;
  }

  /**
   * Crée la lumière du drone
   */
  private createLight(): PointLight {
    const light = new PointLight('echoLight', Vector3.Zero(), this.scene);
    light.intensity = 0.5;
    light.diffuse = this.baseColor;
    light.specular = this.baseColor;
    light.range = 5;
    light.parent = this.droneGroup;

    return light;
  }

  /**
   * Configure les animations d'idle
   */
  private setupAnimations(): void {
    // Animation de flottement
    const floatAnim = new Animation(
      'echoFloat',
      'position.y',
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const keys = [
      { frame: 0, value: 0 },
      { frame: 30, value: 0.1 },
      { frame: 60, value: 0 },
    ];
    floatAnim.setKeys(keys);

    this.coreBody.animations.push(floatAnim);
    this.scene.beginAnimation(this.coreBody, 0, 60, true);

    // Animation de rotation de l'anneau
    const ringRotateAnim = new Animation(
      'echoRingRotate',
      'rotation.z',
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const ringKeys = [
      { frame: 0, value: 0 },
      { frame: 120, value: Math.PI * 2 },
    ];
    ringRotateAnim.setKeys(ringKeys);

    this.ring.animations.push(ringRotateAnim);
    this.scene.beginAnimation(this.ring, 0, 120, true);
  }

  /**
   * Réagit aux messages d'ECHO
   */
  private onEchoMessage(advice: Advice): void {
    // Change la couleur selon le type de conseil
    let color: Color3;
    let intensity: number;

    switch (advice.type) {
      case AdviceType.ENCOURAGEMENT:
        color = new Color3(0.2, 1, 0.3); // Vert
        intensity = 1.5;
        break;
      case AdviceType.WARNING:
        color = new Color3(1, 0.5, 0.1); // Orange
        intensity = 2;
        break;
      case AdviceType.TIP:
        color = new Color3(0.3, 0.8, 1); // Cyan
        intensity = 1.2;
        break;
      case AdviceType.CHALLENGE:
        color = new Color3(0.8, 0.3, 1); // Violet
        intensity = 1.5;
        break;
      default:
        color = this.baseColor;
        intensity = 1;
    }

    this.pulse(color, intensity);
  }

  /**
   * Effet de pulse avec une couleur
   */
  private pulse(color: Color3, intensity: number): void {
    // Change temporairement la couleur
    const bodyMat = this.coreBody.material as StandardMaterial;
    const ringMat = this.ring.material as StandardMaterial;

    bodyMat.emissiveColor = color;
    ringMat.emissiveColor = color.scale(0.7);
    this.light.diffuse = color;
    this.light.intensity = intensity;
    this.glowLayer.intensity = intensity;

    // Revient à la couleur normale après 1 seconde
    setTimeout(() => {
      bodyMat.emissiveColor = this.baseColor;
      ringMat.emissiveColor = this.baseColor.scale(0.7);
      this.light.diffuse = this.baseColor;
      this.light.intensity = 0.5;
      this.glowLayer.intensity = 0.8;
    }, 1000);
  }

  /**
   * Met à jour la position du drone pour suivre le joueur
   */
  public update(deltaTime: number, playerPosition: Vector3, playerRotation: number): void {
    // Calcule la position cible (derrière et à droite du joueur)
    const offset = new Vector3(
      Math.sin(playerRotation + 0.5) * this.followDistance,
      this.followHeight,
      Math.cos(playerRotation + 0.5) * this.followDistance
    );

    this.targetPosition = playerPosition.add(offset);

    // Lissage du mouvement
    const currentPos = this.droneGroup.position;
    const direction = this.targetPosition.subtract(currentPos);
    const distance = direction.length();

    if (distance > 0.01) {
      const moveAmount = Math.min(distance, this.followSpeed * deltaTime);
      const normalizedDir = direction.normalize();
      this.droneGroup.position.addInPlace(normalizedDir.scale(moveAmount));
    }

    // Regarde vers le joueur
    const lookDir = playerPosition.subtract(this.droneGroup.position);
    lookDir.y = 0;
    if (lookDir.length() > 0.01) {
      const angle = Math.atan2(lookDir.x, lookDir.z);
      this.droneGroup.rotation.y = angle;
    }
  }

  /**
   * Place le drone à une position initiale
   */
  public setPosition(position: Vector3): void {
    this.droneGroup.position = position.clone();
    this.targetPosition = position.clone();
  }

  /**
   * Retourne la position du drone
   */
  public getPosition(): Vector3 {
    return this.droneGroup.position.clone();
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.glowLayer.dispose();
    this.light.dispose();
    this.ring.dispose();
    this.coreBody.dispose();
    this.droneGroup.dispose();
  }
}
