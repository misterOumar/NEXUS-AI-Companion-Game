/**
 * Profil comportemental du joueur
 * Toutes les métriques sont normalisées entre 0 et 1
 */
export interface PlayerProfileData {
  aggressiveness: number;   // 0 = défensif, 1 = offensif
  caution: number;          // 0 = imprudent, 1 = très prudent
  reactionSpeed: number;    // 0 = lent, 1 = très rapide
  adaptability: number;     // 0 = rigide, 1 = très adaptable
  consistency: number;      // 0 = erratique, 1 = très cohérent
}

/**
 * Historique d'une métrique pour calculer les tendances
 */
interface MetricHistory {
  values: number[];
  maxSize: number;
}

/**
 * Gestionnaire du profil comportemental du joueur
 * Met à jour les métriques en temps réel basé sur les actions
 */
export class PlayerProfile {
  private data: PlayerProfileData;
  private history: Map<keyof PlayerProfileData, MetricHistory>;

  // Facteur de lissage pour les mises à jour (0 = pas de changement, 1 = changement instantané)
  private readonly smoothingFactor: number = 0.1;

  constructor() {
    // Initialisation avec des valeurs neutres
    this.data = {
      aggressiveness: 0.5,
      caution: 0.5,
      reactionSpeed: 0.5,
      adaptability: 0.5,
      consistency: 0.5,
    };

    // Historique pour chaque métrique
    this.history = new Map();
    const metrics: (keyof PlayerProfileData)[] = [
      'aggressiveness', 'caution', 'reactionSpeed', 'adaptability', 'consistency'
    ];
    metrics.forEach(metric => {
      this.history.set(metric, { values: [], maxSize: 50 });
    });
  }

  /**
   * Retourne les données du profil
   */
  public getData(): Readonly<PlayerProfileData> {
    return { ...this.data };
  }

  /**
   * Retourne une métrique spécifique
   */
  public getMetric(metric: keyof PlayerProfileData): number {
    return this.data[metric];
  }

  /**
   * Met à jour une métrique avec lissage
   */
  public updateMetric(metric: keyof PlayerProfileData, targetValue: number): void {
    // Clamp entre 0 et 1
    targetValue = Math.max(0, Math.min(1, targetValue));

    // Lissage exponentiel
    this.data[metric] = this.data[metric] + this.smoothingFactor * (targetValue - this.data[metric]);

    // Ajoute à l'historique
    const hist = this.history.get(metric);
    if (hist) {
      hist.values.push(this.data[metric]);
      if (hist.values.length > hist.maxSize) {
        hist.values.shift();
      }
    }
  }

  /**
   * Met à jour l'agressivité basé sur une action
   */
  public recordAggressiveAction(intensity: number): void {
    // intensity: 0 = action défensive, 1 = action très agressive
    this.updateMetric('aggressiveness', intensity);
  }

  /**
   * Met à jour la prudence basé sur une décision
   */
  public recordCautiousDecision(wasCautious: boolean): void {
    this.updateMetric('caution', wasCautious ? 1 : 0);
  }

  /**
   * Enregistre un temps de réaction
   */
  public recordReactionTime(timeMs: number): void {
    // Normalise : <200ms = rapide (1), >2000ms = lent (0)
    const normalized = 1 - Math.min(1, Math.max(0, (timeMs - 200) / 1800));
    this.updateMetric('reactionSpeed', normalized);
  }

  /**
   * Enregistre un changement de stratégie
   */
  public recordStrategyChange(didChange: boolean): void {
    this.updateMetric('adaptability', didChange ? 1 : 0);
  }

  /**
   * Calcule la cohérence basée sur l'historique des actions
   */
  public updateConsistency(): void {
    const hist = this.history.get('aggressiveness');
    if (!hist || hist.values.length < 5) return;

    // Calcule la variance des dernières valeurs
    const recent = hist.values.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;

    // Faible variance = haute cohérence
    const consistency = 1 - Math.min(1, variance * 4);
    this.updateMetric('consistency', consistency);
  }

  /**
   * Retourne un résumé textuel du profil
   */
  public getSummary(): string {
    const styles: string[] = [];

    if (this.data.aggressiveness > 0.7) styles.push('agressif');
    else if (this.data.aggressiveness < 0.3) styles.push('défensif');

    if (this.data.caution > 0.7) styles.push('prudent');
    else if (this.data.caution < 0.3) styles.push('téméraire');

    if (this.data.reactionSpeed > 0.7) styles.push('réactif');
    else if (this.data.reactionSpeed < 0.3) styles.push('réfléchi');

    if (this.data.adaptability > 0.7) styles.push('adaptable');
    else if (this.data.adaptability < 0.3) styles.push('méthodique');

    return styles.length > 0 ? styles.join(', ') : 'équilibré';
  }

  /**
   * Réinitialise le profil
   */
  public reset(): void {
    this.data = {
      aggressiveness: 0.5,
      caution: 0.5,
      reactionSpeed: 0.5,
      adaptability: 0.5,
      consistency: 0.5,
    };
    this.history.forEach(hist => hist.values = []);
  }

  /**
   * Exporte le profil pour sauvegarde
   */
  public export(): PlayerProfileData {
    return { ...this.data };
  }

  /**
   * Importe un profil sauvegardé
   */
  public import(data: PlayerProfileData): void {
    this.data = { ...data };
  }
}
