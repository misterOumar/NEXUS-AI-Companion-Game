import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PointLight,
  GlowLayer,
} from '@babylonjs/core';
import type { MazeRenderer } from './MazeRenderer';
import type { MazeGenerator } from './MazeGenerator';

interface Cell { col: number; row: number; }

const MOVE_SPEED      = 3.2;   // u/s — sous la vitesse de marche joueur (4.5)
const REPATH_INTERVAL = 1.8;   // secondes entre chaque recalcul BFS
const CAPTURE_DIST    = 1.8;   // unités — distance de capture
const WARNING_DIST    = 11;    // unités — début de l'alerte sonore/visuelle
export const DRONE_ACTIVATION_DELAY = 30; // secondes après le début du jeu

export class MazeDrone {
  private mesh!: Mesh;
  private light!: PointLight;

  private currentCell: Cell;
  private worldPos:    Vector3;
  private path:        Cell[] = [];
  private pathTimer    = 0;
  private activationTimer = 0;
  private isActive     = false;

  constructor(
    private scene:     Scene,
    private glowLayer: GlowLayer,
    private renderer:  MazeRenderer,
    private generator: MazeGenerator,
    private cols:      number,
    private rows:      number,
  ) {
    // Spawn dans le coin opposé à la case de départ
    this.currentCell = { col: cols - 1, row: rows - 1 };
    const w = renderer.cellToWorld(this.currentCell.col, this.currentCell.row);
    this.worldPos = new Vector3(w.x, 1.8, w.z);
    this.buildMesh();
  }

  private buildMesh(): void {
    // Octaèdre rouge — silhouette reconnaissable
    this.mesh = MeshBuilder.CreatePolyhedron('drone', { type: 1, size: 0.32 }, this.scene);
    this.mesh.position.copyFrom(this.worldPos);
    this.mesh.isVisible  = false;
    this.mesh.isPickable = false;

    const mat = new StandardMaterial('droneMat', this.scene);
    mat.emissiveColor = new Color3(1.0, 0.08, 0.04);
    mat.diffuseColor  = new Color3(0.2, 0.02, 0.01);
    this.mesh.material = mat;
    this.glowLayer.addIncludedOnlyMesh(this.mesh);

    this.light = new PointLight('droneLight', this.worldPos.clone(), this.scene);
    this.light.diffuse   = new Color3(1.0, 0.12, 0.05);
    this.light.intensity = 0;
    this.light.range     = 7;
  }

  // BFS à travers les passages ouverts du labyrinthe
  private findPath(from: Cell, to: Cell): Cell[] {
    const queue: Array<{ cell: Cell; path: Cell[] }> = [{ cell: from, path: [from] }];
    const visited = new Set<string>([`${from.col},${from.row}`]);

    while (queue.length > 0) {
      const { cell, path } = queue.shift()!;
      if (cell.col === to.col && cell.row === to.row) return path;

      const data = this.generator.getCell(cell.col, cell.row);
      if (!data) continue;

      const moves: Array<[number, number, 'N' | 'E' | 'S' | 'W']> = [
        [0, -1, 'N'], [0, 1, 'S'], [1, 0, 'E'], [-1, 0, 'W'],
      ];
      for (const [dc, dr, dir] of moves) {
        if (data.walls[dir]) continue;
        const n = { col: cell.col + dc, row: cell.row + dr };
        if (n.col < 0 || n.col >= this.cols || n.row < 0 || n.row >= this.rows) continue;
        const key = `${n.col},${n.row}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ cell: n, path: [...path, n] });
        }
      }
    }
    return [from];
  }

  /** Téléporte le drone dans la cellule Manhattan-la-plus-éloignée du joueur */
  respawn(playerCol: number, playerRow: number): void {
    let best: Cell = { col: 0, row: 0 };
    let bestDist = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const d = Math.abs(c - playerCol) + Math.abs(r - playerRow);
        if (d > bestDist) { bestDist = d; best = { col: c, row: r }; }
      }
    }
    this.currentCell = best;
    const w = this.renderer.cellToWorld(best.col, best.row);
    this.worldPos.set(w.x, 1.8, w.z);
    this.mesh.position.copyFrom(this.worldPos);
    this.path = [];
    this.pathTimer = 0;
  }

  update(deltaTime: number, playerPos: Vector3): {
    isNear:     boolean;
    isCapture:  boolean;
    alertLevel: number;
  } {
    if (!this.isActive) {
      this.activationTimer += deltaTime;
      if (this.activationTimer >= DRONE_ACTIVATION_DELAY) this.activate();
      return { isNear: false, isCapture: false, alertLevel: 0 };
    }

    // Cellule courante du joueur (clampée aux bords)
    const { col: pc, row: pr } = this.renderer.worldToCell(playerPos.x, playerPos.z);
    const playerCell: Cell = {
      col: Math.max(0, Math.min(this.cols - 1, pc)),
      row: Math.max(0, Math.min(this.rows - 1, pr)),
    };

    // Recalcul BFS
    this.pathTimer += deltaTime;
    if (this.pathTimer >= REPATH_INTERVAL || this.path.length <= 1) {
      this.pathTimer = 0;
      this.path = this.findPath(this.currentCell, playerCell);
    }

    // Mouvement vers la prochaine cellule du chemin
    if (this.path.length > 1) {
      const next   = this.path[1];
      const nw     = this.renderer.cellToWorld(next.col, next.row);
      const target = new Vector3(nw.x, 1.8, nw.z);
      const dir    = target.subtract(this.worldPos);
      const dist   = dir.length();

      if (dist < 0.12) {
        this.currentCell = next;
        this.path.shift();
      } else {
        const step = Math.min(MOVE_SPEED * deltaTime, dist);
        this.worldPos.addInPlace(dir.normalize().scaleInPlace(step));
      }
    }

    // Animation (flottement + rotation)
    const t = performance.now() / 1000;
    this.mesh.position.x = this.worldPos.x;
    this.mesh.position.y = this.worldPos.y + Math.sin(t * 3.2) * 0.12;
    this.mesh.position.z = this.worldPos.z;
    this.mesh.rotation.y += deltaTime * 2.0;
    this.mesh.rotation.x += deltaTime * 0.8;
    this.light.position.copyFrom(this.mesh.position);

    // Distances
    const d2p        = Vector3.Distance(this.mesh.position, playerPos);
    const alertLevel = d2p < WARNING_DIST
      ? Math.max(0, 1 - (d2p - CAPTURE_DIST) / (WARNING_DIST - CAPTURE_DIST))
      : 0;

    this.light.intensity = 0.4 + alertLevel * 2.0;

    return {
      isNear:     d2p < WARNING_DIST,
      isCapture:  d2p < CAPTURE_DIST,
      alertLevel: Math.min(1, alertLevel),
    };
  }

  private activate(): void {
    this.isActive      = true;
    this.mesh.isVisible = true;
    this.light.intensity = 0.4;
  }

  get active(): boolean { return this.isActive; }

  getMesh(): Mesh { return this.mesh; }

  dispose(): void {
    this.mesh.dispose();
    this.light.dispose();
  }
}
