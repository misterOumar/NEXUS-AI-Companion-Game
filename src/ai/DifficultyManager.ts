import { PlayerProfile } from './PlayerProfile';

/**
 * Niveaux de difficulté
 */
export enum DifficultyLevel {
  EASY = 'easy',
  NORMAL = 'normal',
  HARD = 'hard',
  EXPERT = 'expert',
}

/**
 * Paramètres de difficulté
 */
export interface DifficultyParams {
  level: DifficultyLevel;
  speedMultiplier: number;      // Multiplicateur de vitesse des ennemis/obstacles
  complexityMultiplier: number; // Multiplicateur de complexité
  toleranceMultiplier: number;  // Multiplicateur de tolérance aux erreurs
  eventFrequency: number;       // Fréquence des événements (0-1)
}

/**
 * Gestionnaire de difficulté adaptative
 * Ajuste les paramètres de jeu en fonction du profil joueur
 */
export class DifficultyManager {
  private profile: PlayerProfile;
  private currentParams: DifficultyParams;
  private targetParams: DifficultyParams;

  // Hystérésis pour éviter les oscillations
  private readonly smoothingFactor: number = 0.05;
  public readonly changeThreshold: number = 0.15;

  // Compteurs pour l'adaptation
  private successCount: number = 0;
  private failureCount: number = 0;
  private readonly adaptationWindow: number = 5;

  constructor(profile: PlayerProfile) {
    this.profile = profile;
    this.currentParams = this.getDefaultParams();
    this.targetParams = { ...this.currentParams };
  }

  /**
   * Retourne les paramètres par défaut (difficulté normale)
   */
  private getDefaultParams(): DifficultyParams {
    return {
      level: DifficultyLevel.NORMAL,
      speedMultiplier: 1.0,
      complexityMultiplier: 1.0,
      toleranceMultiplier: 1.0,
      eventFrequency: 0.5,
    };
  }

  /**
   * Retourne les paramètres actuels
   */
  public getParams(): Readonly<DifficultyParams> {
    return { ...this.currentParams };
  }

  /**
   * Retourne le niveau de difficulté actuel
   */
  public getLevel(): DifficultyLevel {
    return this.currentParams.level;
  }

  /**
   * Enregistre un succès du joueur
   */
  public recordSuccess(): void {
    this.successCount++;
    this.checkAdaptation();
  }

  /**
   * Enregistre un échec du joueur
   */
  public recordFailure(): void {
    this.failureCount++;
    this.checkAdaptation();
  }

  /**
   * Vérifie si une adaptation est nécessaire
   */
  private checkAdaptation(): void {
    const total = this.successCount + this.failureCount;
    if (total < this.adaptationWindow) return;

    const successRate = this.successCount / total;

    // Augmente la difficulté si trop facile
    if (successRate > 0.8) {
      this.adjustDifficulty(0.1);
    }
    // Diminue la difficulté si trop difficile
    else if (successRate < 0.3) {
      this.adjustDifficulty(-0.15);
    }

    // Reset des compteurs
    this.successCount = 0;
    this.failureCount = 0;
  }

  /**
   * Ajuste la difficulté d'un certain delta
   */
  private adjustDifficulty(delta: number): void {
    // Calcule les nouveaux paramètres cibles
    this.targetParams.speedMultiplier = Math.max(0.5, Math.min(2.0,
      this.targetParams.speedMultiplier + delta
    ));

    this.targetParams.complexityMultiplier = Math.max(0.5, Math.min(2.0,
      this.targetParams.complexityMultiplier + delta
    ));

    this.targetParams.toleranceMultiplier = Math.max(0.5, Math.min(2.0,
      this.targetParams.toleranceMultiplier - delta // Inverse pour la tolérance
    ));

    this.targetParams.eventFrequency = Math.max(0.2, Math.min(0.9,
      this.targetParams.eventFrequency + delta * 0.5
    ));

    // Met à jour le niveau
    this.updateLevel();
  }

  /**
   * Met à jour le niveau de difficulté basé sur les paramètres
   */
  private updateLevel(): void {
    const avgMultiplier = (
      this.targetParams.speedMultiplier +
      this.targetParams.complexityMultiplier
    ) / 2;

    if (avgMultiplier < 0.75) {
      this.targetParams.level = DifficultyLevel.EASY;
    } else if (avgMultiplier < 1.1) {
      this.targetParams.level = DifficultyLevel.NORMAL;
    } else if (avgMultiplier < 1.5) {
      this.targetParams.level = DifficultyLevel.HARD;
    } else {
      this.targetParams.level = DifficultyLevel.EXPERT;
    }
  }

  /**
   * Met à jour progressivement les paramètres (appelé chaque frame)
   */
  public update(): void {
    // Lissage exponentiel vers les valeurs cibles
    this.currentParams.speedMultiplier += this.smoothingFactor * (
      this.targetParams.speedMultiplier - this.currentParams.speedMultiplier
    );

    this.currentParams.complexityMultiplier += this.smoothingFactor * (
      this.targetParams.complexityMultiplier - this.currentParams.complexityMultiplier
    );

    this.currentParams.toleranceMultiplier += this.smoothingFactor * (
      this.targetParams.toleranceMultiplier - this.currentParams.toleranceMultiplier
    );

    this.currentParams.eventFrequency += this.smoothingFactor * (
      this.targetParams.eventFrequency - this.currentParams.eventFrequency
    );

    this.currentParams.level = this.targetParams.level;
  }

  /**
   * Adapte la difficulté basée sur le profil joueur
   */
  public adaptToProfile(): void {
    const profileData = this.profile.getData();

    // Joueur rapide et agressif = augmente la difficulté
    if (profileData.reactionSpeed > 0.7 && profileData.aggressiveness > 0.6) {
      this.adjustDifficulty(0.05);
    }

    // Joueur lent et prudent = diminue légèrement
    if (profileData.reactionSpeed < 0.3 && profileData.caution > 0.7) {
      this.adjustDifficulty(-0.03);
    }

    // Joueur adaptable = peut gérer plus de variation
    if (profileData.adaptability > 0.7) {
      this.targetParams.eventFrequency = Math.min(0.8,
        this.targetParams.eventFrequency + 0.05
      );
    }
  }

  /**
   * Réinitialise à la difficulté normale
   */
  public reset(): void {
    this.currentParams = this.getDefaultParams();
    this.targetParams = { ...this.currentParams };
    this.successCount = 0;
    this.failureCount = 0;
  }

  /**
   * Force un niveau de difficulté spécifique
   */
  public setLevel(level: DifficultyLevel): void {
    switch (level) {
      case DifficultyLevel.EASY:
        this.targetParams = {
          level,
          speedMultiplier: 0.7,
          complexityMultiplier: 0.7,
          toleranceMultiplier: 1.3,
          eventFrequency: 0.3,
        };
        break;
      case DifficultyLevel.NORMAL:
        this.targetParams = this.getDefaultParams();
        break;
      case DifficultyLevel.HARD:
        this.targetParams = {
          level,
          speedMultiplier: 1.3,
          complexityMultiplier: 1.3,
          toleranceMultiplier: 0.8,
          eventFrequency: 0.6,
        };
        break;
      case DifficultyLevel.EXPERT:
        this.targetParams = {
          level,
          speedMultiplier: 1.7,
          complexityMultiplier: 1.7,
          toleranceMultiplier: 0.5,
          eventFrequency: 0.8,
        };
        break;
    }
  }
}
