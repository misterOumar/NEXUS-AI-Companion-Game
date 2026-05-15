import { Vector3 } from '@babylonjs/core';
import { RecordedFrame, RecordingStats } from './InputRecorder';
import { PlayerProfileData } from './PlayerProfile';

/**
 * Décision prise par le CloneBrain à chaque frame
 */
export interface CloneDecision {
  targetPosition: Vector3;  // où le clone doit se diriger
  speed: number;            // vitesse de déplacement
  mode: CloneMode;          // mode de décision actif (pour debug/affichage)
}

/**
 * Mode de prise de décision du clone
 */
export enum CloneMode {
  DIRECT = 'direct',         // fonce vers le joueur
  PREDICT = 'predict',       // prédit où le joueur va
  INTERCEPT = 'intercept',   // coupe la route du joueur
  PATTERN = 'pattern',       // rejoue un pattern observé
}

/**
 * CloneBrain — cerveau de l'IA qui imite le joueur
 *
 * Fonctionne en deux temps :
 * 1. Apprentissage : on lui donne les RecordedFrames de la phase d'observation
 * 2. Décision : chaque frame, on lui donne la situation et il retourne où aller
 *
 * La précision s'améliore au fil des sessions (clone évolutif)
 */
export class CloneBrain {
  // Historique cross-sessions
  private allFrames: RecordedFrame[] = [];
  private sessionCount: number = 0;

  // Précision de prédiction (croît avec le nombre de sessions)
  private predictionAccuracy: number = 0.0;

  // Profil comportemental déduit du joueur
  private playerMoveRatio: number = 0.7;
  private playerPreferredSide: 'left' | 'right' | 'neutral' = 'neutral';
  private playerAggressionScore: number = 0.5;

  // État interne pour le mode "pattern"
  private patternCooldown: number = 0;
  private lastMode: CloneMode = CloneMode.DIRECT;

  /**
   * Charge les données d'observation et améliore le modèle
   * Appelé à la fin de chaque phase d'observation
   */
  public learn(frames: RecordedFrame[], stats: RecordingStats, _profile: PlayerProfileData): void {
    if (frames.length === 0) return;

    // Fusion avec l'historique existant (30% ancien, 70% nouveau)
    if (this.allFrames.length > 0 && this.sessionCount > 0) {
      const keepCount = Math.floor(this.allFrames.length * 0.3);
      const kept = this.allFrames.slice(-keepCount);
      this.allFrames = [...kept, ...frames];
    } else {
      this.allFrames = [...frames];
    }

    // Mise à jour du profil comportemental
    this.playerMoveRatio = stats.moveRatio;
    this.playerPreferredSide = stats.preferredSide;
    this.playerAggressionScore = stats.aggressionScore;

    // Précision augmente avec l'expérience
    this.sessionCount++;
    this.predictionAccuracy = Math.min(0.85, this.sessionCount * 0.20 + 0.10);
  }

  /**
   * Calcule la décision du clone pour cette frame
   *
   * @param clonePos   position actuelle du clone
   * @param playerPos  position actuelle du joueur
   * @param playerVel  vélocité estimée du joueur cette frame
   * @param baseSpeed  vitesse de base configurée pour le clone
   * @param deltaTime  temps depuis la dernière frame (s)
   */
  public decide(
    clonePos: Vector3,
    playerPos: Vector3,
    playerVel: Vector3,
    baseSpeed: number,
    deltaTime: number,
  ): CloneDecision {

    this.patternCooldown = Math.max(0, this.patternCooldown - deltaTime);

    const distToPlayer = Vector3.Distance(clonePos, playerPos);

    // === Choix du mode selon la précision et la situation ===

    // Mode PATTERN : rejoue occasionnellement un intercept basé sur l'historique
    if (
      this.allFrames.length >= 20 &&
      this.patternCooldown <= 0 &&
      Math.random() < this.predictionAccuracy * 0.15
    ) {
      const interceptTarget = this.computePatternIntercept(clonePos, playerPos);
      if (interceptTarget) {
        this.patternCooldown = 3.0 + Math.random() * 2;
        this.lastMode = CloneMode.PATTERN;
        return {
          targetPosition: interceptTarget,
          speed: baseSpeed * 1.05,
          mode: CloneMode.PATTERN,
        };
      }
    }

    // Mode INTERCEPT : si le joueur se déplace vite, couper sa route
    const playerSpeed = playerVel.length();
    if (playerSpeed > 2 && this.predictionAccuracy > 0.3 && distToPlayer > 4) {
      const interceptTarget = this.computeVelocityIntercept(clonePos, playerPos, playerVel, baseSpeed);
      if (interceptTarget) {
        this.lastMode = CloneMode.INTERCEPT;
        return {
          targetPosition: interceptTarget,
          speed: baseSpeed,
          mode: CloneMode.INTERCEPT,
        };
      }
    }

    // Mode PREDICT : prédit la position future du joueur
    if (this.predictionAccuracy > 0.15 && playerSpeed > 0.5) {
      const predictionHorizon = 0.6 + this.predictionAccuracy * 0.8; // 0.6s → 1.38s
      const predicted = playerPos.add(playerVel.scale(predictionHorizon));

      // Blend entre "direct" et "prédit" selon le niveau de précision
      const blended = Vector3.Lerp(playerPos, predicted, this.predictionAccuracy);

      this.lastMode = CloneMode.PREDICT;
      return {
        targetPosition: blended,
        speed: baseSpeed * this.computeSpeedMultiplier(),
        mode: CloneMode.PREDICT,
      };
    }

    // Mode DIRECT : fonce sur le joueur (clone débutant / joueur immobile)
    this.lastMode = CloneMode.DIRECT;
    return {
      targetPosition: playerPos.clone(),
      speed: baseSpeed * this.computeSpeedMultiplier(),
      mode: CloneMode.DIRECT,
    };
  }

  /**
   * Intercept basé sur la cinématique : calcule le point d'interception optimale
   * (où lancer le clone pour arriver en même temps que le joueur)
   */
  private computeVelocityIntercept(
    clonePos: Vector3,
    playerPos: Vector3,
    playerVel: Vector3,
    cloneSpeed: number,
  ): Vector3 | null {
    // Résolution du triangle d'interception : cherche t tel que
    // |clonePos - (playerPos + playerVel * t)| = cloneSpeed * t
    const relPos = playerPos.subtract(clonePos);
    const pv = playerVel;
    const cs = cloneSpeed;

    // Coefficients de l'équation quadratique
    const a = pv.dot(pv) - cs * cs;
    const b = 2 * relPos.dot(pv);
    const c = relPos.dot(relPos);

    let t: number;
    if (Math.abs(a) < 0.001) {
      // Vitesses similaires : interception linéaire
      if (Math.abs(b) < 0.001) return null;
      t = -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);
      // On prend la plus petite valeur positive (interception la plus proche)
      t = (t1 > 0 && (t2 <= 0 || t1 < t2)) ? t1 : t2;
    }

    if (t <= 0 || t > 3.0) return null;  // interception trop loin dans le futur

    return playerPos.add(playerVel.scale(t));
  }

  /**
   * Intercept basé sur les patterns observés :
   * cherche dans l'historique un séquence similaire à la situation actuelle
   * et utilise la direction suivante comme prédiction
   */
  private computePatternIntercept(clonePos: Vector3, playerPos: Vector3): Vector3 | null {
    if (this.allFrames.length < 10) return null;

    // Cherche un frame dans l'historique dont la position est proche de la position actuelle du joueur
    let bestIdx = -1;
    let bestDist = 5.0; // seuil de similarité (en unités d'arène)

    for (let i = 0; i < this.allFrames.length - 5; i++) {
      const d = Vector3.Distance(this.allFrames[i].position, playerPos);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;

    // Regarde la direction que le joueur a prise ensuite
    const futureFrame = this.allFrames[Math.min(bestIdx + 5, this.allFrames.length - 1)];
    const futureDir = futureFrame.position.subtract(this.allFrames[bestIdx].position);

    if (futureDir.length() < 0.5) return null;

    // Intercept : se placer 3 unités en avance sur cette direction
    futureDir.normalize();
    const interceptPoint = playerPos.add(futureDir.scale(3));

    // Ne retourner que si l'intercept rapproche le clone plus que foncer droit
    const distToIntercept = Vector3.Distance(clonePos, interceptPoint);
    const distToPlayer = Vector3.Distance(clonePos, playerPos);
    if (distToIntercept > distToPlayer * 1.4) return null;

    return interceptPoint;
  }

  /**
   * Calcule un multiplicateur de vitesse basé sur le profil du joueur
   * — si le joueur bouge beaucoup et vite, le clone compense
   */
  private computeSpeedMultiplier(): number {
    // Base : 0.85 (légèrement plus lent que la config par défaut)
    // Bonus si le joueur est mobile
    const mobilityBonus = this.playerMoveRatio * 0.2;
    // Bonus si le joueur a tendance à foncer (agression élevée)
    const aggressionBonus = this.playerAggressionScore * 0.1;
    return 0.85 + mobilityBonus + aggressionBonus;
  }

  /**
   * Calcule un score de similarité entre l'observation actuelle et l'historique
   * Retourne 0-100 (affiché en temps réel dans l'UI)
   */
  public computeSimilarityScore(recentFrames: RecordedFrame[]): number {
    if (recentFrames.length === 0 || this.allFrames.length === 0) {
      return Math.round(this.predictionAccuracy * 30);
    }

    const recentAvgSpeed = recentFrames.reduce((s, f) => s + f.speed, 0) / recentFrames.length;
    const histAvgSpeed = this.allFrames.reduce((s, f) => s + f.speed, 0) / this.allFrames.length;

    const speedSim = 1 - Math.min(1, Math.abs(recentAvgSpeed - histAvgSpeed) / (histAvgSpeed + 0.1));

    // Direction dominante récente vs historique
    const recentDir = recentFrames.reduce((s, f) => s + Math.sin(f.direction), 0) / recentFrames.length;
    const histDir = this.allFrames.reduce((s, f) => s + Math.sin(f.direction), 0) / this.allFrames.length;
    const dirSim = 1 - Math.min(1, Math.abs(recentDir - histDir));

    const rawSimilarity = (speedSim * 0.6 + dirSim * 0.4) * this.predictionAccuracy;
    return Math.round(Math.min(99, rawSimilarity * 100 + this.sessionCount * 5));
  }

  /**
   * Injecte un historique comportemental depuis une session précédente (GameState).
   * Appelé avant le round 1 si ce n'est pas la première partie.
   */
  public injectHistory(initialAccuracy: number, profile: import('@/core/GameState').BehavioralProfile | null): void {
    if (initialAccuracy > 0) {
      this.predictionAccuracy = initialAccuracy;
      this.sessionCount = 1; // compte comme une session déjà vécue
    }
    if (profile) {
      this.playerMoveRatio      = profile.moveRatio;
      this.playerPreferredSide  = profile.preferredSide;
      this.playerAggressionScore = profile.aggressionScore;
    }
  }

  // Getters pour l'affichage et GameState
  public getMoveRatio(): number      { return this.playerMoveRatio; }
  public getPreferredSide(): 'left' | 'right' | 'neutral' { return this.playerPreferredSide; }
  public getAggressionScore(): number { return this.playerAggressionScore; }
  public getAvgSpeed(): number {
    if (this.allFrames.length === 0) return 0;
    return this.allFrames.reduce((s, f) => s + f.speed, 0) / this.allFrames.length;
  }

  public getPredictionAccuracy(): number { return this.predictionAccuracy; }
  public getSessionCount(): number { return this.sessionCount; }
  public getLastMode(): CloneMode { return this.lastMode; }
  public getPlayerStyle(): string {
    const parts: string[] = [];
    if (this.playerAggressionScore > 0.6) parts.push('agressif');
    else if (this.playerAggressionScore < 0.35) parts.push('prudent');
    if (this.playerPreferredSide !== 'neutral') parts.push(`penche à ${this.playerPreferredSide === 'right' ? 'droite' : 'gauche'}`);
    if (this.playerMoveRatio > 0.75) parts.push('très mobile');
    else if (this.playerMoveRatio < 0.4) parts.push('statique');
    return parts.length > 0 ? parts.join(', ') : 'équilibré';
  }

  public reset(): void {
    this.allFrames = [];
    this.sessionCount = 0;
    this.predictionAccuracy = 0;
    this.patternCooldown = 0;
  }
}
