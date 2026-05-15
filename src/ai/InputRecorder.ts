import { Vector3 } from '@babylonjs/core';

/**
 * Frame enregistrée du joueur pendant la phase d'observation
 */
export interface RecordedFrame {
  timestamp: number;     // ms depuis début de l'enregistrement
  position: Vector3;     // position dans l'arène
  velocity: Vector3;     // vélocité dérivée
  direction: number;     // angle en radians (atan2 x/z)
  speed: number;         // magnitude de la vélocité
}

/**
 * Statistiques dérivées de l'enregistrement
 */
export interface RecordingStats {
  duration: number;        // durée totale (ms)
  frameCount: number;
  averageSpeed: number;
  maxSpeed: number;
  moveRatio: number;       // proportion du temps en mouvement
  dominantDirection: number; // direction moyenne pondérée
  preferredSide: 'left' | 'right' | 'neutral'; // tendance gauche/droite
  aggressionScore: number; // 0-1 : à quel point le joueur fonce vers le clone
}

/**
 * InputRecorder — capture les mouvements du joueur à 10fps pendant l'observation
 * Produit les données nécessaires au CloneBrain pour imiter le joueur
 */
export class InputRecorder {
  private frames: RecordedFrame[] = [];
  private isRecording: boolean = false;
  private startTime: number = 0;
  private lastPosition: Vector3 = Vector3.Zero();
  private lastTime: number = 0;
  private lastRecordTime: number = 0;

  private readonly RECORD_INTERVAL_MS = 100; // 10 fps
  private readonly MOVE_THRESHOLD = 0.3;     // vitesse min pour "être en mouvement"

  /**
   * Démarre un nouvel enregistrement (efface l'historique)
   */
  public startRecording(): void {
    this.frames = [];
    this.isRecording = true;
    this.startTime = Date.now();
    this.lastTime = this.startTime;
    this.lastRecordTime = 0;
    this.lastPosition = Vector3.Zero();
  }

  /**
   * Arrête l'enregistrement
   */
  public stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Met à jour avec la position actuelle du joueur — appeler chaque frame
   */
  public update(position: Vector3): void {
    if (!this.isRecording) return;

    const now = Date.now();
    if (now - this.lastRecordTime < this.RECORD_INTERVAL_MS) return;

    const dtSec = Math.max(0.001, (now - this.lastTime) / 1000);
    const displacement = position.subtract(this.lastPosition);
    const velocity = displacement.scale(1 / dtSec);
    const speed = velocity.length();
    const direction = Math.atan2(velocity.x, velocity.z);

    this.frames.push({
      timestamp: now - this.startTime,
      position: position.clone(),
      velocity: velocity.clone(),
      direction,
      speed,
    });

    this.lastPosition = position.clone();
    this.lastTime = now;
    this.lastRecordTime = now;
  }

  /**
   * Retourne les frames enregistrées
   */
  public getFrames(): RecordedFrame[] {
    return this.frames;
  }

  /**
   * Calcule les statistiques comportementales de la session
   */
  public getStats(cloneStartPosition?: Vector3): RecordingStats {
    if (this.frames.length === 0) {
      return {
        duration: 0, frameCount: 0, averageSpeed: 0, maxSpeed: 0,
        moveRatio: 0, dominantDirection: 0, preferredSide: 'neutral', aggressionScore: 0,
      };
    }

    const movingFrames = this.frames.filter(f => f.speed > this.MOVE_THRESHOLD);
    const averageSpeed = movingFrames.length > 0
      ? movingFrames.reduce((s, f) => s + f.speed, 0) / movingFrames.length
      : 0;
    const maxSpeed = this.frames.reduce((m, f) => Math.max(m, f.speed), 0);
    const moveRatio = movingFrames.length / this.frames.length;

    // Direction dominante : moyenne angulaire pondérée par la vitesse
    let sumSin = 0, sumCos = 0;
    movingFrames.forEach(f => {
      sumSin += Math.sin(f.direction) * f.speed;
      sumCos += Math.cos(f.direction) * f.speed;
    });
    const totalWeight = movingFrames.reduce((s, f) => s + f.speed, 0) + 0.001;
    const dominantDirection = Math.atan2(sumSin / totalWeight, sumCos / totalWeight);

    // Tendance gauche/droite : proportion des frames avec x positif vs négatif
    const rightFrames = movingFrames.filter(f => f.velocity.x > 0).length;
    const leftFrames = movingFrames.filter(f => f.velocity.x < 0).length;
    const sideDiff = (rightFrames - leftFrames) / (movingFrames.length + 1);
    const preferredSide: 'left' | 'right' | 'neutral' =
      Math.abs(sideDiff) < 0.15 ? 'neutral' : sideDiff > 0 ? 'right' : 'left';

    // Score d'agression : proportion du temps où le joueur se rapprochait du clone
    let aggressionScore = 0;
    if (cloneStartPosition && this.frames.length > 1) {
      let approachCount = 0;
      for (let i = 1; i < this.frames.length; i++) {
        const prevDist = Vector3.Distance(this.frames[i - 1].position, cloneStartPosition);
        const currDist = Vector3.Distance(this.frames[i].position, cloneStartPosition);
        if (currDist < prevDist) approachCount++;
      }
      aggressionScore = approachCount / (this.frames.length - 1);
    }

    return {
      duration: this.frames[this.frames.length - 1].timestamp,
      frameCount: this.frames.length,
      averageSpeed,
      maxSpeed,
      moveRatio,
      dominantDirection,
      preferredSide,
      aggressionScore,
    };
  }

  public isActive(): boolean {
    return this.isRecording;
  }

  public getFrameCount(): number {
    return this.frames.length;
  }
}
