import { Engine as BabylonEngine, Scene } from '@babylonjs/core';

export interface EngineConfig {
  canvasId: string;
  antialias?: boolean;
  adaptToDeviceRatio?: boolean;
}

/**
 * Wrapper autour du moteur Babylon.js
 * Gère l'initialisation, la boucle de rendu et le redimensionnement
 */
export class Engine {
  private static instance: Engine | null = null;

  private babylonEngine: BabylonEngine;
  private canvas: HTMLCanvasElement;
  private currentScene: Scene | null = null;
  private isRunning: boolean = false;
  private updateCallback: ((deltaTime: number) => void) | null = null;

  private constructor(config: EngineConfig) {
    const canvas = document.getElementById(config.canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas with id "${config.canvasId}" not found`);
    }

    this.canvas = canvas;
    this.babylonEngine = new BabylonEngine(
      canvas,
      config.antialias ?? true,
      { stencil: true, preserveDrawingBuffer: false },
      config.adaptToDeviceRatio ?? true
    );

    // Gestion du redimensionnement
    window.addEventListener('resize', () => {
      this.babylonEngine.resize();
    });
  }

  /**
   * Initialise le singleton Engine
   */
  public static initialize(config: EngineConfig): Engine {
    if (!Engine.instance) {
      Engine.instance = new Engine(config);
    }
    return Engine.instance;
  }

  /**
   * Récupère l'instance du moteur
   */
  public static getInstance(): Engine {
    if (!Engine.instance) {
      throw new Error('Engine not initialized. Call Engine.initialize() first.');
    }
    return Engine.instance;
  }

  /**
   * Récupère le moteur Babylon.js
   */
  public getBabylonEngine(): BabylonEngine {
    return this.babylonEngine;
  }

  /**
   * Récupère le canvas
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Définit la scène active
   */
  public setActiveScene(scene: Scene): void {
    this.currentScene = scene;
  }

  /**
   * Enregistre un callback appelé à chaque frame avant le rendu
   */
  public onUpdate(callback: (deltaTime: number) => void): void {
    this.updateCallback = callback;
  }

  /**
   * Démarre la boucle de rendu
   */
  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.babylonEngine.runRenderLoop(() => {
      if (this.currentScene) {
        const deltaTime = this.getDeltaTime();

        // Met à jour la logique du jeu
        if (this.updateCallback) {
          this.updateCallback(deltaTime);
        }

        // Rendu de la scène
        this.currentScene.render();
      }
    });
  }

  /**
   * Arrête la boucle de rendu
   */
  public stop(): void {
    this.isRunning = false;
    this.babylonEngine.stopRenderLoop();
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.stop();
    this.babylonEngine.dispose();
    Engine.instance = null;
  }

  /**
   * Retourne les FPS actuels
   */
  public getFPS(): number {
    return this.babylonEngine.getFps();
  }

  /**
   * Retourne le delta time en secondes
   */
  public getDeltaTime(): number {
    return this.babylonEngine.getDeltaTime() / 1000;
  }
}
