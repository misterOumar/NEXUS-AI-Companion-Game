import {
  Scene,
  Vector3,
  Mesh,
  MeshBuilder,
  UniversalCamera,
  Ray,
} from '@babylonjs/core';
import { InputManager } from '@/core/InputManager';

/**
 * Configuration du contrôleur joueur
 */
export interface PlayerControllerConfig {
  moveSpeed: number;
  lookSensitivity: number;
  height: number;
  radius: number;
}

/**
 * Contrôleur du personnage joueur
 * Gère les déplacements, la caméra FPS et les collisions
 */
export class PlayerController {
  private scene: Scene;
  private inputManager: InputManager;
  private config: PlayerControllerConfig;

  private camera: UniversalCamera;
  private playerMesh: Mesh;
  private isPointerLocked: boolean = false;

  // Mouvement
  private velocity: Vector3 = Vector3.Zero();
  private readonly gravity: number = -9.81;
  private readonly jumpForce: number = 5;
  private isGrounded: boolean = true;

  constructor(scene: Scene, config?: Partial<PlayerControllerConfig>) {
    this.scene = scene;
    this.inputManager = InputManager.getInstance();

    this.config = {
      moveSpeed: 5,
      lookSensitivity: 0.002,
      height: 1.8,
      radius: 0.5,
      ...config,
    };

    this.camera = this.createCamera();
    this.playerMesh = this.createPlayerMesh();

    this.setupPointerLock();
  }

  /**
   * Crée la caméra FPS
   */
  private createCamera(): UniversalCamera {
    const camera = new UniversalCamera(
      'playerCamera',
      new Vector3(0, this.config.height, 0),
      this.scene
    );

    camera.minZ = 0.1;
    camera.maxZ = 1000;
    camera.fov = 1.2; // ~70 degrés

    // Désactive les contrôles par défaut (on gère manuellement)
    camera.inputs.clear();

    return camera;
  }

  /**
   * Crée le mesh du joueur (invisible, juste pour les collisions)
   */
  private createPlayerMesh(): Mesh {
    const mesh = MeshBuilder.CreateCapsule('player', {
      height: this.config.height,
      radius: this.config.radius,
    }, this.scene);

    mesh.position = new Vector3(0, this.config.height / 2, 0);
    mesh.isVisible = false; // Invisible car on est en FPS
    mesh.checkCollisions = true;

    // Attache la caméra au mesh
    this.camera.parent = mesh;
    this.camera.position = new Vector3(0, this.config.height / 2 - 0.1, 0);

    return mesh;
  }

  /**
   * Configure le pointer lock pour la souris
   */
  private setupPointerLock(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;

    // Demande le pointer lock au clic
    canvas.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        canvas.requestPointerLock();
      }
    });

    // Écoute les changements de pointer lock
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === canvas;
    });

    // Gère le mouvement de la souris pour la rotation
    canvas.addEventListener('mousemove', (event) => {
      if (this.isPointerLocked) {
        this.handleMouseMove(event.movementX, event.movementY);
      }
    });
  }

  /**
   * Gère le mouvement de la souris
   */
  private handleMouseMove(deltaX: number, deltaY: number): void {
    // Rotation horizontale (yaw) - sur le mesh
    this.playerMesh.rotation.y += deltaX * this.config.lookSensitivity;

    // Rotation verticale (pitch) - sur la caméra uniquement
    this.camera.rotation.x += deltaY * this.config.lookSensitivity;

    // Limite le pitch
    const maxPitch = Math.PI / 2 - 0.1;
    this.camera.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.camera.rotation.x));
  }

  /**
   * Met à jour le joueur (appelé chaque frame)
   */
  public update(deltaTime: number): void {
    this.handleMovement(deltaTime);
    this.handleJump();
    this.applyGravity(deltaTime);
    this.checkGrounded();
  }

  /**
   * Gère le mouvement WASD
   */
  private handleMovement(deltaTime: number): void {
    const input = InputManager.getInstance();

    // Direction de déplacement
    const forward = input.getVerticalAxis();
    const right = input.getHorizontalAxis();

    if (forward === 0 && right === 0) return;

    // Calcule la direction relative à la rotation du joueur
    const rotation = this.playerMesh.rotation.y;
    const moveX = Math.sin(rotation) * forward + Math.cos(rotation) * right;
    const moveZ = Math.cos(rotation) * forward - Math.sin(rotation) * right;

    // Normalise si mouvement diagonal
    const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
    const normalizedX = moveX / length;
    const normalizedZ = moveZ / length;

    // Applique le mouvement
    const speed = this.config.moveSpeed * deltaTime;
    this.playerMesh.position.x += normalizedX * speed;
    this.playerMesh.position.z += normalizedZ * speed;
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
      this.playerMesh.position.y += this.velocity.y * deltaTime;
    }
  }

  /**
   * Vérifie si le joueur est au sol
   */
  private checkGrounded(): void {
    // Raycast vers le bas
    const ray = new Ray(
      this.playerMesh.position,
      Vector3.Down(),
      this.config.height / 2 + 0.1
    );

    const hit = this.scene.pickWithRay(ray, (mesh) => {
      return mesh !== this.playerMesh && mesh.isPickable;
    });

    if (hit?.hit) {
      this.isGrounded = true;
      this.velocity.y = 0;

      // Corrige la position si enfoncé dans le sol
      const groundY = hit.pickedPoint!.y + this.config.height / 2;
      if (this.playerMesh.position.y < groundY) {
        this.playerMesh.position.y = groundY;
      }
    } else {
      this.isGrounded = false;
    }
  }

  /**
   * Téléporte le joueur à une position
   */
  public setPosition(position: Vector3): void {
    this.playerMesh.position = position.clone();
    this.playerMesh.position.y += this.config.height / 2;
  }

  /**
   * Retourne la position du joueur
   */
  public getPosition(): Vector3 {
    return this.playerMesh.position.clone();
  }

  /**
   * Retourne la direction vers laquelle le joueur regarde
   */
  public getLookDirection(): Vector3 {
    return this.camera.getForwardRay().direction;
  }

  /**
   * Retourne la caméra
   */
  public getCamera(): UniversalCamera {
    return this.camera;
  }

  /**
   * Retourne le mesh du joueur
   */
  public getMesh(): Mesh {
    return this.playerMesh;
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.playerMesh.dispose();
    this.camera.dispose();
  }
}
