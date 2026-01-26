import { Vector3, Color3 } from '@babylonjs/core';

/**
 * Utilitaires mathématiques
 */
export const MathUtils = {
  /**
   * Clamp une valeur entre min et max
   */
  clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  },

  /**
   * Interpolation linéaire
   */
  lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  },

  /**
   * Interpolation linéaire pour Vector3
   */
  lerpVector3(start: Vector3, end: Vector3, t: number): Vector3 {
    return new Vector3(
      MathUtils.lerp(start.x, end.x, t),
      MathUtils.lerp(start.y, end.y, t),
      MathUtils.lerp(start.z, end.z, t)
    );
  },

  /**
   * Interpolation linéaire pour Color3
   */
  lerpColor3(start: Color3, end: Color3, t: number): Color3 {
    return new Color3(
      MathUtils.lerp(start.r, end.r, t),
      MathUtils.lerp(start.g, end.g, t),
      MathUtils.lerp(start.b, end.b, t)
    );
  },

  /**
   * Convertit des degrés en radians
   */
  degToRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  },

  /**
   * Convertit des radians en degrés
   */
  radToDeg(radians: number): number {
    return radians * (180 / Math.PI);
  },

  /**
   * Retourne un nombre aléatoire entre min et max
   */
  random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  },

  /**
   * Retourne un entier aléatoire entre min et max (inclus)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Smooth step (interpolation douce)
   */
  smoothStep(edge0: number, edge1: number, x: number): number {
    const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  },

  /**
   * Easing in quad
   */
  easeInQuad(t: number): number {
    return t * t;
  },

  /**
   * Easing out quad
   */
  easeOutQuad(t: number): number {
    return t * (2 - t);
  },

  /**
   * Easing in-out quad
   */
  easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  },
};

/**
 * Utilitaires pour les tableaux
 */
export const ArrayUtils = {
  /**
   * Mélange un tableau (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },

  /**
   * Retourne un élément aléatoire
   */
  randomElement<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[Math.floor(Math.random() * array.length)];
  },

  /**
   * Supprime un élément du tableau
   */
  remove<T>(array: T[], element: T): boolean {
    const index = array.indexOf(element);
    if (index > -1) {
      array.splice(index, 1);
      return true;
    }
    return false;
  },
};

/**
 * Utilitaires pour le timing
 */
export const TimeUtils = {
  /**
   * Attends un certain nombre de millisecondes
   */
  wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Formate le temps en MM:SS
   */
  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  },
};

/**
 * Utilitaires pour le stockage local
 */
export const StorageUtils = {
  /**
   * Sauvegarde des données dans le localStorage
   */
  save(key: string, data: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }
  },

  /**
   * Charge des données depuis le localStorage
   */
  load<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.warn('Failed to load from localStorage:', e);
      return defaultValue;
    }
  },

  /**
   * Supprime des données du localStorage
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('Failed to remove from localStorage:', e);
    }
  },
};
