import { Vector3 } from '@babylonjs/core';
import { PlayerProfile } from './PlayerProfile';

/**
 * Types d'événements comportementaux détectés
 */
export enum BehaviorEvent {
  PLAYER_HESITATION = 'PLAYER_HESITATION',
  RISK_TAKEN = 'RISK_TAKEN',
  REPEATED_ERROR = 'REPEATED_ERROR',
  PATTERN_DETECTED = 'PATTERN_DETECTED',
  STYLE_SHIFT = 'STYLE_SHIFT',
  FAST_REACTION = 'FAST_REACTION',
  SLOW_REACTION = 'SLOW_REACTION',
}

/**
 * Données d'un événement comportemental
 */
export interface BehaviorEventData {
  type: BehaviorEvent;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * Callback pour les événements
 */
export type BehaviorEventCallback = (event: BehaviorEventData) => void;

/**
 * Enregistrement d'une action du joueur
 */
export interface PlayerAction {
  timestamp: number;
  type: string;
  position: Vector3;
  data?: Record<string, unknown>;
}

/**
 * Analyseur du comportement du joueur
 * Détecte les patterns, hésitations, et événements significatifs
 */
export class BehaviorAnalyzer {
  private profile: PlayerProfile;
  private actions: PlayerAction[] = [];
  private eventCallbacks: BehaviorEventCallback[] = [];
  public lastPosition: Vector3 = Vector3.Zero();
  private lastMoveTime: number = 0;
  private errorCount: Map<string, number> = new Map();
  private hesitationThreshold: number = 1500; // ms
  private maxActionsHistory: number = 100;

  constructor(profile: PlayerProfile) {
    this.profile = profile;
  }

  /**
   * Enregistre une action du joueur
   */
  public recordAction(type: string, position: Vector3, data?: Record<string, unknown>): void {
    const now = Date.now();
    const action: PlayerAction = {
      timestamp: now,
      type,
      position: position.clone(),
      data,
    };

    this.actions.push(action);

    // Limite la taille de l'historique
    if (this.actions.length > this.maxActionsHistory) {
      this.actions.shift();
    }

    // Analyse l'action
    this.analyzeAction(action);
  }

  /**
   * Analyse une action et met à jour le profil
   */
  private analyzeAction(action: PlayerAction): void {
    const now = action.timestamp;

    // Détection d'hésitation
    if (this.lastMoveTime > 0) {
      const timeSinceLastMove = now - this.lastMoveTime;
      if (timeSinceLastMove > this.hesitationThreshold) {
        this.emitEvent({
          type: BehaviorEvent.PLAYER_HESITATION,
          timestamp: now,
          data: { duration: timeSinceLastMove },
        });
      }
    }

    // Mise à jour du temps de réaction
    if (action.type === 'reaction') {
      const reactionTime = action.data?.reactionTime as number || 500;
      this.profile.recordReactionTime(reactionTime);

      if (reactionTime < 300) {
        this.emitEvent({
          type: BehaviorEvent.FAST_REACTION,
          timestamp: now,
          data: { reactionTime },
        });
      } else if (reactionTime > 1000) {
        this.emitEvent({
          type: BehaviorEvent.SLOW_REACTION,
          timestamp: now,
          data: { reactionTime },
        });
      }
    }

    // Détection de prise de risque
    if (action.type === 'risk') {
      const riskLevel = action.data?.riskLevel as number || 0.5;
      if (riskLevel > 0.7) {
        this.emitEvent({
          type: BehaviorEvent.RISK_TAKEN,
          timestamp: now,
          data: { riskLevel },
        });
        this.profile.recordCautiousDecision(false);
      } else {
        this.profile.recordCautiousDecision(true);
      }
    }

    // Détection d'action agressive
    if (action.type === 'attack' || action.type === 'aggressive') {
      this.profile.recordAggressiveAction(action.data?.intensity as number || 0.7);
    }

    // Mise à jour position et temps
    if (action.type === 'move') {
      this.lastPosition = action.position.clone();
      this.lastMoveTime = now;
    }
  }

  /**
   * Enregistre une erreur du joueur
   */
  public recordError(errorType: string): void {
    const count = (this.errorCount.get(errorType) || 0) + 1;
    this.errorCount.set(errorType, count);

    // Détection d'erreurs répétées
    if (count >= 3) {
      this.emitEvent({
        type: BehaviorEvent.REPEATED_ERROR,
        timestamp: Date.now(),
        data: { errorType, count },
      });
    }
  }

  /**
   * Réinitialise le compteur d'erreurs
   */
  public resetErrors(): void {
    this.errorCount.clear();
  }

  /**
   * Détecte un changement de style de jeu
   */
  public detectStyleShift(): void {
    if (this.actions.length < 20) return;

    const recentActions = this.actions.slice(-10);
    const olderActions = this.actions.slice(-20, -10);

    // Compare l'agressivité moyenne
    const recentAggression = this.calculateAverageAggression(recentActions);
    const olderAggression = this.calculateAverageAggression(olderActions);

    if (Math.abs(recentAggression - olderAggression) > 0.3) {
      this.emitEvent({
        type: BehaviorEvent.STYLE_SHIFT,
        timestamp: Date.now(),
        data: {
          from: olderAggression > 0.5 ? 'agressif' : 'défensif',
          to: recentAggression > 0.5 ? 'agressif' : 'défensif',
        },
      });
      this.profile.recordStrategyChange(true);
    }
  }

  /**
   * Calcule l'agressivité moyenne d'un ensemble d'actions
   */
  private calculateAverageAggression(actions: PlayerAction[]): number {
    const aggressiveActions = actions.filter(
      a => a.type === 'attack' || a.type === 'aggressive'
    );
    return aggressiveActions.length / actions.length;
  }

  /**
   * Ajoute un callback pour les événements
   */
  public onEvent(callback: BehaviorEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Émet un événement à tous les callbacks
   */
  private emitEvent(event: BehaviorEventData): void {
    this.eventCallbacks.forEach(callback => callback(event));
  }

  /**
   * Retourne l'historique des actions
   */
  public getActions(): readonly PlayerAction[] {
    return this.actions;
  }

  /**
   * Réinitialise l'analyseur
   */
  public reset(): void {
    this.actions = [];
    this.errorCount.clear();
    this.lastPosition = Vector3.Zero();
    this.lastMoveTime = 0;
  }
}
