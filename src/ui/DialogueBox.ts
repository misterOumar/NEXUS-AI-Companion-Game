import { AdvancedDynamicTexture, TextBlock, Rectangle, Control } from '@babylonjs/gui';
import { Advice, AdviceType } from '@/ai/EchoAI';

/**
 * Boîte de dialogue pour afficher les messages d'ECHO
 */
export class DialogueBox {
  private ui: AdvancedDynamicTexture;
  private container: Rectangle;
  private nameLabel: TextBlock;
  private messageText: TextBlock;

  private isVisible: boolean = false;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly displayDuration: number = 4000;

  constructor() {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI('dialogueUI');

    // Container principal
    this.container = new Rectangle('dialogueContainer');
    this.container.width = '500px';
    this.container.height = '120px';
    this.container.cornerRadius = 10;
    this.container.color = 'rgba(100, 150, 255, 0.8)';
    this.container.thickness = 2;
    this.container.background = 'rgba(10, 15, 30, 0.9)';
    this.container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.container.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.container.top = '-50px';
    this.container.isVisible = false;
    this.ui.addControl(this.container);

    // Nom "ECHO"
    this.nameLabel = new TextBlock('echoName', 'ECHO');
    this.nameLabel.color = '#6496ff';
    this.nameLabel.fontSize = 18;
    this.nameLabel.fontWeight = 'bold';
    this.nameLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.nameLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.nameLabel.paddingLeft = '20px';
    this.nameLabel.paddingTop = '15px';
    this.container.addControl(this.nameLabel);

    // Texte du message
    this.messageText = new TextBlock('messageText', '');
    this.messageText.color = 'white';
    this.messageText.fontSize = 16;
    this.messageText.textWrapping = true;
    this.messageText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.messageText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.messageText.paddingLeft = '20px';
    this.messageText.paddingRight = '20px';
    this.messageText.paddingTop = '45px';
    this.container.addControl(this.messageText);
  }

  /**
   * Affiche un message d'ECHO
   */
  public showAdvice(advice: Advice): void {
    // Annule le timeout précédent
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }

    // Change la couleur selon le type
    const color = this.getColorForType(advice.type);
    this.container.color = color;
    this.nameLabel.color = color;

    // Met à jour le texte
    this.messageText.text = advice.message;

    // Affiche
    this.container.isVisible = true;
    this.isVisible = true;

    // Programme le masquage
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, this.displayDuration);
  }

  /**
   * Affiche un message simple
   */
  public showMessage(message: string, type: AdviceType = AdviceType.OBSERVATION): void {
    this.showAdvice({ type, message, priority: 1 });
  }

  /**
   * Masque la boîte de dialogue
   */
  public hide(): void {
    this.container.isVisible = false;
    this.isVisible = false;
  }

  /**
   * Retourne la couleur associée à un type de conseil
   */
  private getColorForType(type: AdviceType): string {
    switch (type) {
      case AdviceType.ENCOURAGEMENT:
        return 'rgba(50, 200, 100, 0.9)';
      case AdviceType.WARNING:
        return 'rgba(255, 150, 50, 0.9)';
      case AdviceType.TIP:
        return 'rgba(100, 200, 255, 0.9)';
      case AdviceType.CHALLENGE:
        return 'rgba(180, 100, 255, 0.9)';
      default:
        return 'rgba(100, 150, 255, 0.8)';
    }
  }

  /**
   * Vérifie si la boîte est visible
   */
  public getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    this.ui.dispose();
  }
}
