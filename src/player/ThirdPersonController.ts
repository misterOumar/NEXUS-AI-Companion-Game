import {
  Scene,
  Vector3,
  ArcRotateCamera,
  Mesh,
  MeshBuilder,
  TransformNode,
} from '@babylonjs/core';
import { InputManager } from '@/core/InputManager';
import { PlayerCharacter } from './PlayerCharacter';

/**
 * Configuration du contrôleur 3ème personne
 */
export interface ThirdPersonConfig {
  moveSpeed: number;
  runSpeed: number;
  rotationSpeed: number;
  cameraDistance: number;
  cameraHeight: number;
  cameraMinDistance: number;
  cameraMaxDistance: number;
  enableCollisions: boolean;
  collisionRadius: number;
  collisionHeight: number;
}

/**
 * Contrôleur de personnage en 3ème personne
 * Gère le personnage visible, la caméra orbitale, les mouvements et les collisions
 */
export class ThirdPersonController {
  private scene: Scene;
  private inputManager: InputManager;
  private config: ThirdPersonConfig;

  // Composants
  private character: PlayerCharacter;
  private camera: ArcRotateCamera;
  private cameraTarget: TransformNode;

  // Collision
  private collisionMesh: Mesh;

  // État
  private velocity: Vector3 = Vector3.Zero();
  private isGrounded: boolean = true;
  private isMoving: boolean = false;
  private isRunning: boolean = false;
  private targetRotation: number = 0;

  // Physique
  private readonly gravity: number = -20;
  private readonly jumpForce: number = 8;

  constructor(scene: Scene, config?: Partial<ThirdPersonConfig>) {
    this.scene = scene;
    this.inputManager = InputManager.getInstance();

    this.config = {
      moveSpeed: 4,
      runSpeed: 8,
      rotationSpeed: 10,
      cameraDistance: 5,
      cameraHeight: 2,
      cameraMinDistance: 2,
      cameraMaxDistance: 15,
      enableCollisions: true,
      collisionRadius: 0.35,
      collisionHeight: 1.8,
      ...config,
    };

    // Active les collisions sur la scène
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -9.81, 0);

    // Crée le personnage
    this.character = new PlayerCharacter(scene);

    // Crée le mesh de collision invisible (ellipsoïde)
    this.collisionMesh = this.createCollisionMesh();

    // Crée la cible de la caméra
    this.cameraTarget = new TransformNode('cameraTarget', scene);
    this.cameraTarget.position.y = 1.2;

    // Crée la caméra
    this.camera = this.createCamera();
  }

  /**
   * Crée un mesh invisible pour la détection de collisions
   */
  private createCollisionMesh(): Mesh {
    const mesh = MeshBuilder.CreateCapsule('playerCollider', {
      height: this.config.collisionHeight,
      radius: this.config.collisionRadius,
    }, this.scene);

    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.checkCollisions = this.config.enableCollisions;

    // Ellipsoïde de collision
    mesh.ellipsoid = new Vector3(
      this.config.collisionRadius,
      this.config.collisionHeight / 2,
      this.config.collisionRadius
    );
    mesh.ellipsoidOffset = new Vector3(0, this.config.collisionHeight / 2, 0);

    return mesh;
  }

  /**
   * Crée la caméra orbitale
   */
  private createCamera(): ArcRotateCamera {
    const camera = new ArcRotateCamera(
      'thirdPersonCamera',
      Math.PI,
      Math.PI / 3,
      this.config.cameraDistance,
      this.cameraTarget.position,
      this.scene
    );

    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.fov = 1.0;

    // Limites de la caméra
    camera.lowerRadiusLimit = this.config.cameraMinDistance;
    camera.upperRadiusLimit = this.config.cameraMaxDistance;
    camera.lowerBetaLimit = 0.3;
    camera.upperBetaLimit = Math.PI / 2 - 0.1;

    // Sensibilité
    camera.angularSensibilityX = 500;
    camera.angularSensibilityY = 500;
    camera.wheelPrecision = 20;

    // Lissage
    camera.inertia = 0.7;

    // Collision de la caméra (évite de passer à travers les murs)
    camera.checkCollisions = this.config.enableCollisions;
    camera.collisionRadius = new Vector3(0.5, 0.5, 0.5);

    // Attache les contrôles au canvas
    camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);

    return camera;
  }

  /**
   * Met à jour le contrôleur
   */
  public update(deltaTime: number): void {
    // Vérifie si on court
    this.isRunning = this.inputManager.isKeyDown('shift');

    // Mouvement avec collisions
    this.handleMovement(deltaTime);

    // Saut
    this.handleJump();

    // Gravité
    this.applyGravity(deltaTime);

    // Synchronise le personnage visuel avec le collider
    this.syncCharacterToCollider();

    // Met à jour la position de la cible caméra
    this.updateCameraTarget();

    // Met à jour les animations du personnage
    this.character.update(deltaTime, this.isMoving, this.isRunning);
  }

  /**
   * Gère le mouvement du personnage avec collisions
   */
  private handleMovement(deltaTime: number): void {
    const forward = this.inputManager.getVerticalAxis();
    const right = this.inputManager.getHorizontalAxis();

    this.isMoving = forward !== 0 || right !== 0;

    if (!this.isMoving) return;

    // Direction basée sur l'orientation de la caméra
    const cameraDirection = this.camera.alpha + Math.PI / 2;

    // Calcule la direction de mouvement
    const moveAngle = Math.atan2(right, forward);
    const targetAngle = cameraDirection + moveAngle;

    // Rotation fluide du personnage vers la direction de mouvement
    this.targetRotation = targetAngle;
    const currentRotation = this.character.getRotation();
    let rotationDiff = this.targetRotation - currentRotation;

    // Normalise la différence d'angle
    while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
    while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

    const newRotation = currentRotation + rotationDiff * this.config.rotationSpeed * deltaTime;
    this.character.setRotation(newRotation);

    // Applique le mouvement via moveWithCollisions
    const speed = (this.isRunning ? this.config.runSpeed : this.config.moveSpeed) * deltaTime;

    const moveVector = new Vector3(
      Math.sin(targetAngle) * speed,
      0,
      Math.cos(targetAngle) * speed
    );

    if (this.config.enableCollisions) {
      this.collisionMesh.moveWithCollisions(moveVector);
    } else {
      this.collisionMesh.position.addInPlace(moveVector);
    }
  }

  /**
   * Gère le saut
   */
  private handleJump(): void {
    if (this.inputManager.isKeyJustPressed(' ') && this.isGrounded) {
      this.velocity.y = this.jumpForce;
      this.isGrounded = false;
    }
  }

  /**
   * Applique la gravité
   */
  private applyGravity(deltaTime: number): void {
    if (!this.isGrounded) {
      this.velocity.y += this.gravity * deltaTime;
    }

    const gravityVector = new Vector3(0, this.velocity.y * deltaTime, 0);

    if (this.config.enableCollisions) {
      const prevY = this.collisionMesh.position.y;
      this.collisionMesh.moveWithCollisions(gravityVector);
      const newY = this.collisionMesh.position.y;

      // Détection du sol : si le mouvement vers le bas a été bloqué
      if (this.velocity.y < 0 && Math.abs(newY - (prevY + gravityVector.y)) > 0.01) {
        this.isGrounded = true;
        this.velocity.y = 0;
      }
    } else {
      this.collisionMesh.position.y += this.velocity.y * deltaTime;
    }

    // Limite plancher (fallback de sécurité)
    if (this.collisionMesh.position.y < 0) {
      this.collisionMesh.position.y = 0;
      this.velocity.y = 0;
      this.isGrounded = true;
    }
  }

  /**
   * Synchronise la position visuelle du personnage avec le collider
   */
  private syncCharacterToCollider(): void {
    this.character.setPosition(this.collisionMesh.position.clone());
  }

  /**
   * Met à jour la position de la cible caméra
   */
  private updateCameraTarget(): void {
    const characterPos = this.collisionMesh.position;
    this.cameraTarget.position.x = characterPos.x;
    this.cameraTarget.position.y = characterPos.y + 1.2;
    this.cameraTarget.position.z = characterPos.z;

    this.camera.target = this.cameraTarget.position;
  }

  /**
   * Téléporte le personnage
   */
  public setPosition(position: Vector3): void {
    this.collisionMesh.position = position.clone();
    this.syncCharacterToCollider();
    this.updateCameraTarget();
  }

  /**
   * Retourne la position du personnage
   */
  public getPosition(): Vector3 {
    return this.collisionMesh.position.clone();
  }

  /**
   * Retourne la rotation du personnage
   */
  public getRotation(): number {
    return this.character.getRotation();
  }

  /**
   * Retourne le personnage
   */
  public getCharacter(): PlayerCharacter {
    return this.character;
  }

  /**
   * Retourne la caméra
   */
  public getCamera(): ArcRotateCamera {
    return this.camera;
  }

  /**
   * Retourne le mesh de collision
   */
  public getCollisionMesh(): Mesh {
    return this.collisionMesh;
  }

  /**
   * Vérifie si le personnage est en mouvement
   */
  public getIsMoving(): boolean {
    return this.isMoving;
  }

  /**
   * Vérifie si le personnage court
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.character.dispose();
    this.collisionMesh.dispose();
    this.camera.dispose();
    this.cameraTarget.dispose();
  }
}
