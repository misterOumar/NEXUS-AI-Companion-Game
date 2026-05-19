import { Scene, KeyboardEventTypes, PointerEventTypes, Vector2 } from '@babylonjs/core';

export interface InputState {
  // Clavier
  keys: Set<string>;
  keysJustPressed: Set<string>;
  keysJustReleased: Set<string>;

  // Souris
  mousePosition: Vector2;
  mouseDelta: Vector2;
  mouseButtons: Set<number>;
  mouseButtonsJustPressed: Set<number>;
  mouseButtonsJustReleased: Set<number>;
  wheelDelta: number;
}

/**
 * Gestionnaire centralisé des inputs clavier et souris
 * Pattern Singleton pour accès global
 */
export class InputManager {
  private static instance: InputManager | null = null;

  private state: InputState;
  public previousMousePosition: Vector2;
  public currentScene: Scene | null = null;

  private constructor() {
    this.state = {
      keys: new Set(),
      keysJustPressed: new Set(),
      keysJustReleased: new Set(),
      mousePosition: new Vector2(0, 0),
      mouseDelta: new Vector2(0, 0),
      mouseButtons: new Set(),
      mouseButtonsJustPressed: new Set(),
      mouseButtonsJustReleased: new Set(),
      wheelDelta: 0,
    };
    this.previousMousePosition = new Vector2(0, 0);
  }

  /**
   * Récupère l'instance singleton
   */
  public static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  /**
   * Attache le gestionnaire à une scène Babylon
   */
  public attachToScene(scene: Scene): void {
    this.currentScene = scene;

    // Événements clavier
    scene.onKeyboardObservable.add((kbInfo) => {
      const key = kbInfo.event.key.toLowerCase();

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (!this.state.keys.has(key)) {
          this.state.keysJustPressed.add(key);
        }
        this.state.keys.add(key);
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        this.state.keys.delete(key);
        this.state.keysJustReleased.add(key);
      }
    });

    // Événements souris
    scene.onPointerObservable.add((pointerInfo) => {
      const event = pointerInfo.event as PointerEvent;

      // Position + delta souris (accumulé sur la frame, réinitialisé dans update())
      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        this.state.mousePosition.x = event.clientX;
        this.state.mousePosition.y = event.clientY;
        this.state.mouseDelta.x += event.movementX || 0;
        this.state.mouseDelta.y += event.movementY || 0;
      }

      // Boutons souris
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        if (!this.state.mouseButtons.has(event.button)) {
          this.state.mouseButtonsJustPressed.add(event.button);
        }
        this.state.mouseButtons.add(event.button);
      } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        this.state.mouseButtons.delete(event.button);
        this.state.mouseButtonsJustReleased.add(event.button);
      } else if (pointerInfo.type === PointerEventTypes.POINTERWHEEL) {
        const wheelEvent = event as unknown as WheelEvent;
        this.state.wheelDelta = wheelEvent.deltaY;
      }
    });
  }

  /**
   * À appeler à la fin de chaque frame pour réinitialiser les états "just"
   */
  public update(): void {
    this.state.keysJustPressed.clear();
    this.state.keysJustReleased.clear();
    this.state.mouseButtonsJustPressed.clear();
    this.state.mouseButtonsJustReleased.clear();
    this.state.wheelDelta = 0;
    this.state.mouseDelta.x = 0;
    this.state.mouseDelta.y = 0;
  }

  // ===== Méthodes de requête clavier =====

  /**
   * Vérifie si une touche est maintenue enfoncée
   */
  public isKeyDown(key: string): boolean {
    return this.state.keys.has(key.toLowerCase());
  }

  /**
   * Vérifie si une touche vient d'être pressée cette frame
   */
  public isKeyJustPressed(key: string): boolean {
    return this.state.keysJustPressed.has(key.toLowerCase());
  }

  /**
   * Vérifie si une touche vient d'être relâchée cette frame
   */
  public isKeyJustReleased(key: string): boolean {
    return this.state.keysJustReleased.has(key.toLowerCase());
  }

  /**
   * Retourne l'axe horizontal (-1, 0, 1) basé sur les touches A/D ou flèches
   */
  public getHorizontalAxis(): number {
    let axis = 0;
    if (this.isKeyDown('a') || this.isKeyDown('arrowleft')) axis -= 1;
    if (this.isKeyDown('d') || this.isKeyDown('arrowright')) axis += 1;
    return axis;
  }

  /**
   * Retourne l'axe vertical (-1, 0, 1) basé sur les touches W/S ou flèches
   */
  public getVerticalAxis(): number {
    let axis = 0;
    if (this.isKeyDown('s') || this.isKeyDown('arrowdown')) axis -= 1;
    if (this.isKeyDown('w') || this.isKeyDown('arrowup')) axis += 1;
    return axis;
  }

  // ===== Méthodes de requête souris =====

  /**
   * Vérifie si un bouton de souris est maintenu enfoncé
   * 0 = gauche, 1 = milieu, 2 = droit
   */
  public isMouseButtonDown(button: number): boolean {
    return this.state.mouseButtons.has(button);
  }

  /**
   * Vérifie si un bouton de souris vient d'être pressé
   */
  public isMouseButtonJustPressed(button: number): boolean {
    return this.state.mouseButtonsJustPressed.has(button);
  }

  /**
   * Vérifie si un bouton de souris vient d'être relâché
   */
  public isMouseButtonJustReleased(button: number): boolean {
    return this.state.mouseButtonsJustReleased.has(button);
  }

  /**
   * Retourne la position actuelle de la souris
   */
  public getMousePosition(): Vector2 {
    return this.state.mousePosition.clone();
  }

  /**
   * Retourne le mouvement de la souris depuis la dernière frame
   */
  public getMouseDelta(): Vector2 {
    return this.state.mouseDelta.clone();
  }

  /**
   * Retourne le delta de la molette
   */
  public getWheelDelta(): number {
    return this.state.wheelDelta;
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.state.keys.clear();
    this.state.keysJustPressed.clear();
    this.state.keysJustReleased.clear();
    this.state.mouseButtons.clear();
    this.state.mouseButtonsJustPressed.clear();
    this.state.mouseButtonsJustReleased.clear();
    InputManager.instance = null;
  }
}
