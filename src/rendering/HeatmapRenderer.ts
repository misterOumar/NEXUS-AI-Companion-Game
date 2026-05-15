import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  Vector3,
} from '@babylonjs/core';

// ─── Résolution interne ───────────────────────────────────────────────────────
const GRID = 64;   // grille de chaleur 64×64
const TEX  = 256;  // texture finale 256×256

/**
 * HeatmapRenderer
 *
 * Affiche en temps réel les zones fréquentées par le joueur sur le sol de l'arène.
 * Chaque frame d'observation ajoute un blob gaussien à la position du joueur.
 * La texture est mise à jour à ~10 fps (toutes les 100ms) pour les perfs.
 *
 * Le jury voit immédiatement « l'IA qui cartographie le comportement » sans
 * avoir besoin d'explications.
 */
export class HeatmapRenderer {
  private readonly arenaRadius: number;

  private mesh:        Mesh;
  private texture:     DynamicTexture;
  private heatBuffer:  Float32Array;          // valeurs cumulées [0..∞)
  private updateTimer: number = 0;
  private readonly UPDATE_INTERVAL = 0.1;     // 10 fps texture

  constructor(scene: Scene, arenaRadius: number) {
    this.arenaRadius = arenaRadius;
    this.heatBuffer  = new Float32Array(GRID * GRID);

    // ── Mesh — disque plat légèrement au-dessus du sol ────────────────────
    this.mesh = MeshBuilder.CreateDisc('heatmapDisc', {
      radius: arenaRadius,
      tessellation: 64,
    }, scene);
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.position.y = 0.018;    // au-dessus du arenaFloor (y=0)

    // ── DynamicTexture avec support alpha ─────────────────────────────────
    this.texture = new DynamicTexture('heatmapTex', { width: TEX, height: TEX }, scene, false);
    this.texture.hasAlpha = true;

    const mat = new StandardMaterial('heatmapMat', scene);
    mat.diffuseTexture            = this.texture;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor             = new Color3(0.45, 0.45, 0.45); // lueur subtile
    mat.diffuseColor              = Color3.White();
    mat.backFaceCulling           = false;
    this.mesh.material = mat;
  }

  // ─── API publique ────────────────────────────────────────────────────────

  /** Appelé chaque frame pendant OBSERVATION et DUEL */
  update(playerPos: Vector3, deltaTime: number): void {
    this.addHeat(playerPos);

    this.updateTimer += deltaTime;
    if (this.updateTimer >= this.UPDATE_INTERVAL) {
      this.updateTimer = 0;
      this.renderToTexture();
    }
  }

  /**
   * Retourne les 3 positions monde les plus visitées (zones « chaudes »).
   * Utilisé par MirrorDuelScene pour orienter le clone en round 2+.
   */
  getHotZones(): Vector3[] {
    const diam = this.arenaRadius * 2;
    const candidates: Array<{ u: number; v: number; heat: number }> = [];

    for (let v = 0; v < GRID; v++) {
      for (let u = 0; u < GRID; u++) {
        const heat = this.heatBuffer[v * GRID + u];
        if (heat > 0.15) candidates.push({ u, v, heat });
      }
    }
    candidates.sort((a, b) => b.heat - a.heat);

    return candidates.slice(0, 3).map(c => new Vector3(
      (c.u / GRID) * diam - this.arenaRadius,
      0.5,
      (c.v / GRID) * diam - this.arenaRadius,
    ));
  }

  /** Entre deux rounds : garde 40 % de l'historique (fantôme du round précédent) */
  fadeRound(): void {
    for (let i = 0; i < this.heatBuffer.length; i++) {
      this.heatBuffer[i] *= 0.4;
    }
    this.renderToTexture();
  }

  /** Efface complètement */
  reset(): void {
    this.heatBuffer.fill(0);
    const ctx = this.texture.getContext();
    ctx.clearRect(0, 0, TEX, TEX);
    this.texture.update(false);
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.dispose();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /** Ajoute un blob gaussien centré sur la position monde du joueur */
  private addHeat(worldPos: Vector3): void {
    const diam = this.arenaRadius * 2;
    const cu = Math.round(((worldPos.x + this.arenaRadius) / diam) * GRID);
    const cv = Math.round(((worldPos.z + this.arenaRadius) / diam) * GRID);

    const BLOB_RADIUS = 4;
    for (let dy = -BLOB_RADIUS; dy <= BLOB_RADIUS; dy++) {
      for (let dx = -BLOB_RADIUS; dx <= BLOB_RADIUS; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > BLOB_RADIUS) continue;
        const u = cu + dx;
        const v = cv + dy;
        if (u < 0 || u >= GRID || v < 0 || v >= GRID) continue;
        const falloff = 1 - dist / BLOB_RADIUS;
        this.heatBuffer[v * GRID + u] += 0.06 * falloff * falloff;
      }
    }
  }

  /** Re-dessine le buffer de chaleur sur la DynamicTexture */
  private renderToTexture(): void {
    // Calcule le max pour normalisation
    let maxVal = 0;
    for (let i = 0; i < this.heatBuffer.length; i++) {
      if (this.heatBuffer[i] > maxVal) maxVal = this.heatBuffer[i];
    }
    if (maxVal < 0.01) return;

    const ctx  = this.texture.getContext();
    const cell = TEX / GRID;

    ctx.clearRect(0, 0, TEX, TEX);

    for (let v = 0; v < GRID; v++) {
      for (let u = 0; u < GRID; u++) {
        const t = Math.min(1, this.heatBuffer[v * GRID + u] / maxVal);
        if (t < 0.02) continue;

        const { r, g, b } = this.heatToColor(t);
        const alpha = Math.min(0.82, t * 0.95);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(u * cell, v * cell, Math.ceil(cell) + 1, Math.ceil(cell) + 1);
      }
    }

    this.texture.update(false);
  }

  /**
   * Colormap : bleu froid → cyan → jaune → rouge brûlant
   *  t = 0   → transparent (géré avant appel)
   *  t = 0.3 → bleu-cyan
   *  t = 0.6 → jaune-vert
   *  t = 1.0 → rouge vif
   */
  private heatToColor(t: number): { r: number; g: number; b: number } {
    if (t < 0.25) {
      const f = t / 0.25;
      return { r: 0, g: Math.round(f * 80), b: Math.round(160 + f * 95) };
    }
    if (t < 0.5) {
      const f = (t - 0.25) / 0.25;
      return { r: 0, g: Math.round(80 + f * 175), b: Math.round(255 * (1 - f)) };
    }
    if (t < 0.75) {
      const f = (t - 0.5) / 0.25;
      return { r: Math.round(f * 255), g: 255, b: 0 };
    }
    const f = (t - 0.75) / 0.25;
    return { r: 255, g: Math.round(255 * (1 - f * 0.9)), b: 0 };
  }
}
