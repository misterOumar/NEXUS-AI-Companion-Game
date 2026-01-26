import { Scene } from '@babylonjs/core';
import { Engine } from '@/core/Engine';
import { InputManager } from '@/core/InputManager';

/**
 * Classe abstraite de base pour toutes les scènes du jeu
 * Définit le cycle de vie standard d'une scène
 */
export abstract class AbstractScene {
  protected scene: Scene;
  protected inputManager: InputManager;
  protected isInitialized: boolean = false;
  protected isLoaded: boolean = false;

  constructor() {
    const engine = Engine.getInstance();
    this.scene = new Scene(engine.getBabylonEngine());
    this.inputManager = InputManager.getInstance();
    this.inputManager.attachToScene(this.scene);
  }

  /**
   * Retourne la scène Babylon.js
   */
  public getScene(): Scene {
    return this.scene;
  }

  /**
   * Phase 1 : Initialisation
   * Configuration initiale de la scène (caméra, lumières de base)
   */
  public async init(): Promise<void> {
    this.isInitialized = true;
  }

  /**
   * Phase 2 : Chargement des assets
   * Chargement asynchrone des modèles, textures, sons
   */
  public async loadAssets(): Promise<void> {
    this.isLoaded = true;
  }

  /**
   * Phase 3 : Création de la scène
   * Instanciation des objets, configuration finale
   */
  public abstract createScene(): Promise<void>;

  /**
   * Phase 4 : Mise à jour
   * Appelé à chaque frame avec le delta time en secondes
   */
  public abstract update(deltaTime: number): void;

  /**
   * Phase 5 : Nettoyage
   * Libération des ressources
   */
  public async dispose(): Promise<void> {
    this.scene.dispose();
    this.isInitialized = false;
    this.isLoaded = false;
  }

  /**
   * Appelé quand la scène devient active
   */
  public onEnter(): void {}

  /**
   * Appelé quand la scène devient inactive
   */
  public onExit(): void {}
}
