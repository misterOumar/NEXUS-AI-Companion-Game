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
  mouseSensitivity: number;
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

  // Pointer lock
  private isPointerLocked: boolean = false;

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
      mouseSensitivity: 0.002,
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
   * Crée la caméra orbitale — sans attachControl, entièrement pilotée par la souris via pointer lock
   */
  private createCamera(): ArcRotateCamera {
    const camera = new ArcRotateCamera(
      'thirdPersonCamera',
      Math.PI,       // alpha : derrière le joueur (-Z)
      Math.PI / 3,   // beta  : légèrement au-dessus
      this.config.cameraDistance,
      this.cameraTarget.position,
      this.scene
    );

    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.fov = 1.0;

    // Limites
    camera.lowerRadiusLimit = this.config.cameraMinDistance;
    camera.upperRadiusLimit = this.config.cameraMaxDistance;
    camera.lowerBetaLimit = 0.3;
    camera.upperBetaLimit = Math.PI / 2 - 0.05;

    // Inertie à zéro — on gère le lissage nous-mêmes
    camera.inertia = 0;

    // Collision caméra (évite de passer dans les murs)
    camera.checkCollisions = this.config.enableCollisions;
    camera.collisionRadius = new Vector3(0.5, 0.5, 0.5);

    // PAS de attachControl — la rotation est gérée dans updateCameraRotation()

    return camera;
  }

  /**
   * Active le pointer lock sur le canvas pour une caméra FPS-style
   */
  public enablePointerLock(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('click', () => {
      if (!document.pointerLockElement) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === canvas;
      // Clear any accumulated delta so the camera doesn't jump on lock acquire
      if (this.isPointerLocked) this.inputManager.update();
    });
  }

  /**
   * Applique la rotation de la caméra depuis le delta souris (pointer lock ou clic droit)
   */
  private updateCameraRotation(): void {
    const delta = this.inputManager.getMouseDelta();
    const canRotate = this.isPointerLocked || this.inputManager.isMouseButtonDown(2);

    if (canRotate && (delta.x !== 0 || delta.y !== 0)) {
      this.camera.alpha -= delta.x * this.config.mouseSensitivity;
      this.camera.beta = Math.max(
        0.3,
        Math.min(Math.PI / 2 - 0.05, this.camera.beta - delta.y * this.config.mouseSensitivity)
      );
    }

    // Zoom molette
    const wheel = this.inputManager.getWheelDelta();
    if (wheel !== 0) {
      this.camera.radius = Math.max(
        this.config.cameraMinDistance,
        Math.min(this.config.cameraMaxDistance, this.camera.radius + wheel * 0.005)
      );
    }
  }

  /**
   * Met à jour le contrôleur
   */
  public update(deltaTime: number): void {
    this.isRunning = this.inputManager.isKeyDown('shift');

    this.handleMovement(deltaTime);
    this.handleJump();
    this.applyGravity(deltaTime);
    this.syncCharacterToCollider();
    this.updateCameraTarget();
    this.updateCameraRotation();
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

    // Direction basée sur l'orientation de la caméra.
    // Pour ArcRotateCamera Babylon.js : pos = target + r*(sin(beta)*sin(alpha), cos(beta), sin(beta)*cos(alpha))
    // Donc forward (camera→target, plan XZ) = (-sin(alpha), 0, -cos(alpha)).
    // Dans la convention (sin(θ), 0, cos(θ)) de moveVector, l'angle de cette direction = alpha + PI.
    const cameraDirection = this.camera.alpha + Math.PI;

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
   * Met à jour la position de la cible caméra — directement sur le collider sans inertie
   */
  private updateCameraTarget(): void {
    const p = this.collisionMesh.position;
    this.cameraTarget.position.x = p.x;
    this.cameraTarget.position.y = p.y + 1.2;
    this.cameraTarget.position.z = p.z;
    this.camera.target.copyFrom(this.cameraTarget.position);
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
