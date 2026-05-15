/**
 * GameState — Persistance inter-sessions (localStorage)
 *
 * Stocke le profil comportemental du joueur, le niveau du clone et les meilleurs scores.
 * Plus le joueur joue, plus son clone se souvient de lui dès le round 1.
 *
 * Pattern Singleton.
 */

const STORAGE_KEY = 'nexus_mirror_duel_state';

export interface BehavioralProfile {
  moveRatio:      number;        // % de frames en mouvement (0-1)
  preferredSide:  'left' | 'right' | 'neutral';
  aggressionScore: number;       // 0 = passif, 1 = agressif
  avgSpeed:       number;        // vitesse moyenne observée
  playerStyle:    string;        // label texte (ex: "Chasseur agressif")
}

export interface SavedState {
  totalSessions:    number;
  bestScore:        number;
  cloneLevel:       number;      // 1-5, monte à chaque victoire (survive 3 rounds)
  behavioralProfile: BehavioralProfile | null;
  lastPlayed:       number;      // timestamp Unix
}

const DEFAULT_STATE: SavedState = {
  totalSessions:     0,
  bestScore:         0,
  cloneLevel:        1,
  behavioralProfile: null,
  lastPlayed:        0,
};

export class GameState {
  private static instance: GameState | null = null;
  private state: SavedState;

  private constructor() {
    this.state = this.load();
  }

  static getInstance(): GameState {
    if (!GameState.instance) GameState.instance = new GameState();
    return GameState.instance;
  }

  // ─── Lecture ─────────────────────────────────────────────────────────────

  get totalSessions():    number             { return this.state.totalSessions; }
  get bestScore():        number             { return this.state.bestScore; }
  get cloneLevel():       number             { return this.state.cloneLevel; }
  get behavioralProfile(): BehavioralProfile | null { return this.state.behavioralProfile; }

  /**
   * Retourne le boost de vitesse du clone basé sur le cloneLevel (1.0 → 1.20).
   * Utilisé par MirrorDuelScene pour ajuster CLONE_BASE_SPEED dès le round 1.
   */
  getCloneSpeedBoost(): number {
    return 1.0 + (this.state.cloneLevel - 1) * 0.05;
  }

  /**
   * Retourne la précision de départ du CloneBrain (0 → 0.20).
   * Le clone commence avec une mémoire non-nulle après la première session.
   */
  getInitialPredictionAccuracy(): number {
    return Math.min(0.20, (this.state.cloneLevel - 1) * 0.05);
  }

  isFirstSession(): boolean {
    return this.state.totalSessions === 0;
  }

  // ─── Écriture ─────────────────────────────────────────────────────────────

  /** Appelé au démarrage de MirrorDuelScene */
  startSession(): void {
    this.state.totalSessions++;
    this.state.lastPlayed = Date.now();
    this.save();
  }

  /**
   * Appelé à la fin d'une partie.
   * @param score         score total des 3 rounds
   * @param survived      true si le joueur a survécu les 3 rounds
   * @param profile       profil comportemental calculé par CloneBrain
   */
  endSession(score: number, survived: boolean, profile: BehavioralProfile): void {
    if (score > this.state.bestScore) {
      this.state.bestScore = score;
    }
    if (survived) {
      this.state.cloneLevel = Math.min(5, this.state.cloneLevel + 1);
    }
    this.state.behavioralProfile = profile;
    this.save();
  }

  /** Réinitialise toutes les données (bouton reset dans un menu optionnel) */
  reset(): void {
    this.state = { ...DEFAULT_STATE };
    localStorage.removeItem(STORAGE_KEY);
  }

  // ─── Persistance ─────────────────────────────────────────────────────────

  private load(): SavedState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      const parsed = JSON.parse(raw) as Partial<SavedState>;
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // localStorage indisponible (navigation privée, quota dépassé) → on ignore
    }
  }
}
