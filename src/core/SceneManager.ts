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
 * Gère les transitions (fade noir) et le chargement/déchargement des scènes
 */
export class SceneManager {
  private static instance: SceneManager | null = null;

  private scenes: Map<string, SceneConstructor> = new Map();
  private currentScene: AbstractScene | null = null;
  private currentSceneName: string = '';
  private isTransitioning: boolean = false;
  private fadeOverlay: HTMLDivElement | null = null;

  private constructor() {}

  public static getInstance(): SceneManager {
    if (!SceneManager.instance) {
      SceneManager.instance = new SceneManager();
    }
    return SceneManager.instance;
  }

  public registerScene(name: string, sceneClass: SceneConstructor): void {
    this.scenes.set(name, sceneClass);
  }

  // ─── Overlay de transition ───────────────────────────────────────────────

  private getOverlay(): HTMLDivElement {
    if (!this.fadeOverlay) {
      this.fadeOverlay = document.createElement('div');
      this.fadeOverlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:#000', 'opacity:0', 'pointer-events:none',
        'z-index:9999', 'transition:opacity 0.45s ease',
      ].join(';');
      document.body.appendChild(this.fadeOverlay);
    }
    return this.fadeOverlay;
  }

  private fadeToBlack(duration = 450): Promise<void> {
    return new Promise(resolve => {
      const el = this.getOverlay();
      el.style.transition = `opacity ${duration}ms ease`;
      el.style.pointerEvents = 'all';
      // Force reflow pour que la transition CSS démarre bien
      void el.offsetHeight;
      el.style.opacity = '1';
      setTimeout(resolve, duration + 30);
    });
  }

  private fadeFromBlack(duration = 450): Promise<void> {
    return new Promise(resolve => {
      const el = this.getOverlay();
      el.style.transition = `opacity ${duration}ms ease`;
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.pointerEvents = 'none';
        resolve();
      }, duration + 30);
    });
  }

  // ─── Chargement de scène ─────────────────────────────────────────────────

  public async loadScene(
    name: string,
    _options: SceneTransitionOptions = {}
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
      // Fondu au noir
      await this.fadeToBlack();

      // Décharge la scène actuelle
      if (this.currentScene) {
        await this.currentScene.dispose();
        this.currentScene = null;
      }

      // Crée, initialise et construit la nouvelle scène
      const newScene = new SceneClass();
      await newScene.init();
      await newScene.loadAssets();
      await newScene.createScene();

      // Définit la scène active dans le moteur
      const engine = Engine.getInstance();
      engine.setActiveScene(newScene.getScene());

      this.currentScene = newScene;
      this.currentSceneName = name;

      // Fondu depuis le noir
      await this.fadeFromBlack();

    } finally {
      this.isTransitioning = false;
    }
  }

  public getCurrentScene(): AbstractScene | null {
    return this.currentScene;
  }

  public getCurrentSceneName(): string {
    return this.currentSceneName;
  }

  public update(deltaTime: number): void {
    if (this.currentScene && !this.isTransitioning) {
      this.currentScene.update(deltaTime);
    }
  }

  public isInTransition(): boolean {
    return this.isTransitioning;
  }

  public async dispose(): Promise<void> {
    if (this.currentScene) {
      await this.currentScene.dispose();
      this.currentScene = null;
    }
    if (this.fadeOverlay?.parentNode) {
      this.fadeOverlay.parentNode.removeChild(this.fadeOverlay);
    }
    this.scenes.clear();
    SceneManager.instance = null;
  }
}
