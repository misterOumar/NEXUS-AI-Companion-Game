import { PlayerProfile } from './PlayerProfile';
import { BehaviorAnalyzer, BehaviorEvent, BehaviorEventData } from './BehaviorAnalyzer';
import { DifficultyManager } from './DifficultyManager';

/**
 * Type de conseil donné par ECHO
 */
export enum AdviceType {
  ENCOURAGEMENT = 'encouragement',
  WARNING = 'warning',
  TIP = 'tip',
  OBSERVATION = 'observation',
  CHALLENGE = 'challenge',
}

/**
 * Structure d'un conseil
 */
export interface Advice {
  type: AdviceType;
  message: string;
  priority: number; // 0-1, plus élevé = plus important
}

/**
 * Configuration d'ECHO
 */
export interface EchoConfig {
  minIntervalMs: number;      // Intervalle minimum entre deux interventions
  verbosity: number;          // 0-1, niveau de bavardage
  personalityMode: 'friendly' | 'professional' | 'playful';
}

/**
 * Callback pour les messages d'ECHO
 */
export type EchoMessageCallback = (advice: Advice) => void;

/**
 * ECHO - IA compagnon du joueur
 * Point d'entrée principal du système IA
 * Coordonne les analyses et génère les conseils
 */
export class EchoAI {
  private static instance: EchoAI | null = null;

  private profile: PlayerProfile;
  private analyzer: BehaviorAnalyzer;
  private difficultyManager: DifficultyManager;
  private config: EchoConfig;

  private lastInterventionTime: number = 0;
  private messageQueue: Advice[] = [];
  private messageCallbacks: EchoMessageCallback[] = [];
  private isActive: boolean = true;

  private constructor() {
    this.profile = new PlayerProfile();
    this.analyzer = new BehaviorAnalyzer(this.profile);
    this.difficultyManager = new DifficultyManager(this.profile);

    this.config = {
      minIntervalMs: 5000,
      verbosity: 0.5,
      personalityMode: 'friendly',
    };

    // Écoute les événements comportementaux
    this.analyzer.onEvent(this.handleBehaviorEvent.bind(this));
  }

  /**
   * Récupère l'instance singleton
   */
  public static getInstance(): EchoAI {
    if (!EchoAI.instance) {
      EchoAI.instance = new EchoAI();
    }
    return EchoAI.instance;
  }

  /**
   * Retourne le profil joueur
   */
  public getProfile(): PlayerProfile {
    return this.profile;
  }

  /**
   * Retourne l'analyseur comportemental
   */
  public getAnalyzer(): BehaviorAnalyzer {
    return this.analyzer;
  }

  /**
   * Retourne le gestionnaire de difficulté
   */
  public getDifficultyManager(): DifficultyManager {
    return this.difficultyManager;
  }

  /**
   * Configure ECHO
   */
  public configure(config: Partial<EchoConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Gère un événement comportemental
   */
  private handleBehaviorEvent(event: BehaviorEventData): void {
    if (!this.isActive) return;

    let advice: Advice | null = null;

    switch (event.type) {
      case BehaviorEvent.PLAYER_HESITATION:
        advice = this.generateHesitationAdvice(event);
        break;

      case BehaviorEvent.RISK_TAKEN:
        advice = this.generateRiskAdvice(event);
        break;

      case BehaviorEvent.REPEATED_ERROR:
        advice = this.generateErrorAdvice(event);
        break;

      case BehaviorEvent.STYLE_SHIFT:
        advice = this.generateStyleShiftAdvice(event);
        break;

      case BehaviorEvent.FAST_REACTION:
        advice = this.generateFastReactionAdvice();
        break;
    }

    if (advice) {
      this.queueAdvice(advice);
    }
  }

  /**
   * Génère un conseil pour une hésitation
   */
  private generateHesitationAdvice(_event: BehaviorEventData): Advice {
    const messages = {
      friendly: "Prends ton temps, mais n'hésite pas trop !",
      professional: "Pause détectée. Analyse la situation et agis.",
      playful: "Hé, tu rêves ? Le jeu t'attend !",
    };

    return {
      type: AdviceType.TIP,
      message: messages[this.config.personalityMode],
      priority: 0.3,
    };
  }

  /**
   * Génère un conseil pour une prise de risque
   */
  private generateRiskAdvice(event: BehaviorEventData): Advice {
    const riskLevel = event.data?.riskLevel as number || 0.5;

    if (riskLevel > 0.8) {
      return {
        type: AdviceType.WARNING,
        message: "Attention, c'est risqué ! Assure-toi d'avoir un plan B.",
        priority: 0.7,
      };
    }

    return {
      type: AdviceType.OBSERVATION,
      message: "Belle prise de risque calculée.",
      priority: 0.4,
    };
  }

  /**
   * Génère un conseil pour des erreurs répétées
   */
  private generateErrorAdvice(event: BehaviorEventData): Advice {
    const count = event.data?.count as number || 3;

    return {
      type: AdviceType.TIP,
      message: `Tu as fait la même erreur ${count} fois. Essaie une approche différente.`,
      priority: 0.8,
    };
  }

  /**
   * Génère un conseil pour un changement de style
   */
  private generateStyleShiftAdvice(event: BehaviorEventData): Advice {
    const from = event.data?.from as string;
    const to = event.data?.to as string;

    return {
      type: AdviceType.OBSERVATION,
      message: `Intéressant ! Tu passes d'un style ${from} à ${to}. Voyons ce que ça donne.`,
      priority: 0.5,
    };
  }

  /**
   * Génère un conseil pour une réaction rapide
   */
  private generateFastReactionAdvice(): Advice {
    const messages = [
      "Réflexes impressionnants !",
      "Quelle rapidité !",
      "Tu es en forme aujourd'hui !",
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];

    return {
      type: AdviceType.ENCOURAGEMENT,
      message,
      priority: 0.2,
    };
  }

  /**
   * Ajoute un conseil à la file d'attente
   */
  private queueAdvice(advice: Advice): void {
    // Vérifie le seuil de verbosité
    if (advice.priority < (1 - this.config.verbosity)) {
      return;
    }

    this.messageQueue.push(advice);
    this.messageQueue.sort((a, b) => b.priority - a.priority);

    // Limite la taille de la queue
    if (this.messageQueue.length > 5) {
      this.messageQueue.pop();
    }
  }

  /**
   * Vérifie si ECHO doit intervenir
   */
  public shouldIntervene(): boolean {
    if (!this.isActive || this.messageQueue.length === 0) {
      return false;
    }

    const now = Date.now();
    return (now - this.lastInterventionTime) >= this.config.minIntervalMs;
  }

  /**
   * Récupère et envoie le prochain conseil
   */
  public processNextAdvice(): Advice | null {
    if (!this.shouldIntervene()) {
      return null;
    }

    const advice = this.messageQueue.shift();
    if (!advice) return null;

    this.lastInterventionTime = Date.now();

    // Notifie tous les callbacks
    this.messageCallbacks.forEach(callback => callback(advice));

    return advice;
  }

  /**
   * Ajoute un callback pour les messages
   */
  public onMessage(callback: EchoMessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Envoie un message direct (bypass la queue)
   */
  public say(message: string, type: AdviceType = AdviceType.OBSERVATION): void {
    const advice: Advice = {
      type,
      message,
      priority: 1,
    };
    this.messageCallbacks.forEach(callback => callback(advice));
  }

  /**
   * Met à jour ECHO (appelé chaque frame)
   */
  public update(_deltaTime: number): void {
    if (!this.isActive) return;

    this.difficultyManager.update();
    this.profile.updateConsistency();

    // Traite les conseils en attente
    this.processNextAdvice();
  }

  /**
   * Active ECHO
   */
  public activate(): void {
    this.isActive = true;
  }

  /**
   * Désactive ECHO
   */
  public deactivate(): void {
    this.isActive = false;
  }

  /**
   * Vérifie si ECHO est actif
   */
  public isEnabled(): boolean {
    return this.isActive;
  }

  /**
   * Réinitialise ECHO
   */
  public reset(): void {
    this.profile.reset();
    this.analyzer.reset();
    this.difficultyManager.reset();
    this.messageQueue = [];
    this.lastInterventionTime = 0;
  }

  /**
   * Génère une analyse post-partie
   */
  public generateSessionSummary(): string {
    const profileData = this.profile.getData();
    const summary = this.profile.getSummary();
    const difficulty = this.difficultyManager.getLevel();

    return `Session terminée !
Style de jeu : ${summary}
Difficulté atteinte : ${difficulty}
Agressivité : ${Math.round(profileData.aggressiveness * 100)}%
Prudence : ${Math.round(profileData.caution * 100)}%
Réactivité : ${Math.round(profileData.reactionSpeed * 100)}%`;
  }
}
