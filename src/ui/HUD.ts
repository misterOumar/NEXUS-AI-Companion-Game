import {
  AdvancedDynamicTexture,
  TextBlock,
  Rectangle,
  Control,
  StackPanel,
} from '@babylonjs/gui';

/**
 * Interface en jeu (HUD)
 * Affiche les informations importantes au joueur
 */
export class HUD {
  private ui: AdvancedDynamicTexture;

  // Éléments UI
  private fpsText: TextBlock;
  private instructionsPanel: Rectangle;
  private instructionsText: TextBlock;
  private crosshair: Rectangle;

  constructor() {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI('hudUI');

    this.fpsText = this.createFPSCounter();
    this.crosshair = this.createCrosshair();
    const instructions = this.createInstructions();
    this.instructionsPanel = instructions.panel;
    this.instructionsText = instructions.text;
  }

  /**
   * Crée le compteur FPS
   */
  private createFPSCounter(): TextBlock {
    const fpsText = new TextBlock('fps', 'FPS: 0');
    fpsText.color = 'rgba(255, 255, 255, 0.6)';
    fpsText.fontSize = 14;
    fpsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    fpsText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    fpsText.paddingRight = '10px';
    fpsText.paddingTop = '10px';
    this.ui.addControl(fpsText);

    return fpsText;
  }

  /**
   * Crée le crosshair central
   */
  private createCrosshair(): Rectangle {
    const crosshair = new Rectangle('crosshair');
    crosshair.width = '4px';
    crosshair.height = '4px';
    crosshair.cornerRadius = 2;
    crosshair.color = 'transparent';
    crosshair.background = 'rgba(255, 255, 255, 0.8)';
    crosshair.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    crosshair.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.ui.addControl(crosshair);

    return crosshair;
  }

  /**
   * Crée le panneau d'instructions
   */
  private createInstructions(): { panel: Rectangle; text: TextBlock } {
    const panel = new Rectangle('instructionsPanel');
    panel.width = '300px';
    panel.height = '120px';
    panel.cornerRadius = 8;
    panel.color = 'rgba(100, 150, 255, 0.5)';
    panel.thickness = 1;
    panel.background = 'rgba(10, 15, 30, 0.7)';
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.left = '20px';
    panel.top = '20px';
    this.ui.addControl(panel);

    const text = new TextBlock('instructions');
    text.text = 'WASD - Se déplacer\nSouris - Regarder\nEspace - Sauter\nClic - Verrouiller souris\n\nApprochez des portails pour jouer';
    text.color = 'white';
    text.fontSize = 14;
    text.textWrapping = true;
    text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    text.paddingLeft = '15px';
    text.paddingTop = '10px';
    panel.addControl(text);

    return { panel, text };
  }

  /**
   * Met à jour les FPS affichés
   */
  public updateFPS(fps: number): void {
    this.fpsText.text = `FPS: ${Math.round(fps)}`;
  }

  /**
   * Affiche/masque les instructions
   */
  public showInstructions(show: boolean): void {
    this.instructionsPanel.isVisible = show;
  }

  /**
   * Affiche un message temporaire en haut de l'écran
   */
  public showNotification(message: string, duration: number = 3000): void {
    const notification = new TextBlock('notification', message);
    notification.color = 'white';
    notification.fontSize = 20;
    notification.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    notification.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    notification.paddingTop = '150px';
    notification.outlineColor = 'black';
    notification.outlineWidth = 2;
    this.ui.addControl(notification);

    // Supprime après la durée
    setTimeout(() => {
      this.ui.removeControl(notification);
    }, duration);
  }

  /**
   * Affiche l'indicateur d'interaction
   */
  public showInteractionPrompt(text: string): void {
    // À implémenter : indicateur "Appuyez sur E pour interagir"
  }

  /**
   * Masque l'indicateur d'interaction
   */
  public hideInteractionPrompt(): void {
    // À implémenter
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.ui.dispose();
  }
}
