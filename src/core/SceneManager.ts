import { Engine } from './Engine';
import { AbstractScene } from '@/scenes/AbstractScene';

export type SceneConstructor = new () => AbstractScene;

export interface SceneTransitionOptions {
  fadeOut?: boolean;
  fadeIn?: boolean;
  fadeDuration?: number;
}

/**
 * Gestionnaire du cycle de vie des scènes
 * Gère les transitions et le chargement/déchargement des scènes
 */
export class SceneManager {
  private static instance: SceneManager | null = null;

  private scenes: Map<string, SceneConstructor> = new Map();
  private currentScene: AbstractScene | null = null;
  private currentSceneName: string = '';
  private isTransitioning: boolean = false;

  private constructor() {}

  /**
   * Récupère l'instance singleton
   */
  public static getInstance(): SceneManager {
    if (!SceneManager.instance) {
      SceneManager.instance = new SceneManager();
    }
    return SceneManager.instance;
  }

  /**
   * Enregistre une scène avec un nom
   */
  public registerScene(name: string, sceneClass: SceneConstructor): void {
    this.scenes.set(name, sceneClass);
  }

  /**
   * Charge et affiche une scène
   */
  public async loadScene(
    name: string,
    options: SceneTransitionOptions = {}
  ): Promise<void> {
    if (this.isTransitioning) {
      console.warn('Scene transition already in progress');
      return;
    }

    const SceneClass = this.scenes.get(name);
    if (!SceneClass) {
      throw new Error(`Scene "${name}" not registered`);
    }

    this.isTransitioning = true;

    try {
      // Décharge la scène actuelle
      if (this.currentScene) {
        await this.currentScene.dispose();
        this.currentScene = null;
      }

      // Crée la nouvelle scène
      const newScene = new SceneClass();

      // Initialise la scène
      await newScene.init();

      // Charge les assets
      await newScene.loadAssets();

      // Crée la scène Babylon
      await newScene.createScene();

      // Définit la scène active dans le moteur
      const engine = Engine.getInstance();
      engine.setActiveScene(newScene.getScene());

      this.currentScene = newScene;
      this.currentSceneName = name;

    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Retourne la scène actuelle
   */
  public getCurrentScene(): AbstractScene | null {
    return this.currentScene;
  }

  /**
   * Retourne le nom de la scène actuelle
   */
  public getCurrentSceneName(): string {
    return this.currentSceneName;
  }

  /**
   * Met à jour la scène actuelle (appelé chaque frame)
   */
  public update(deltaTime: number): void {
    if (this.currentScene && !this.isTransitioning) {
      this.currentScene.update(deltaTime);
    }
  }

  /**
   * Vérifie si une transition est en cours
   */
  public isInTransition(): boolean {
    return this.isTransitioning;
  }

  /**
   * Libère les ressources
   */
  public async dispose(): Promise<void> {
    if (this.currentScene) {
      await this.currentScene.dispose();
      this.currentScene = null;
    }
    this.scenes.clear();
    SceneManager.instance = null;
  }
}
