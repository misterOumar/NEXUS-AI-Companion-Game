import {
  Scene, Mesh, MeshBuilder, PBRMaterial, StandardMaterial,
  Color3, Color4, Vector3, GlowLayer, Animation, CubicEase,
  EasingFunction, HemisphericLight, DirectionalLight, PointLight,
  ParticleSystem, DynamicTexture, TransformNode, DefaultRenderingPipeline,
  Observer, Texture, ShadowGenerator,
} from '@babylonjs/core';
import type { MazeCell } from './MazeGenerator';

// ─── Palette néon ──────────────────────────────────────────────────────────────
const C_WALL_EMI   = new Color3(0.01, 0.06, 0.18);
const C_GRID_EMI   = new Color3(0.08, 0.18, 0.55);
const C_EXIT_EMI   = new Color3(0.0,  0.9,  0.4);
const C_START_EMI  = new Color3(0.9,  0.5,  0.05);
const C_NODE_EMI   = new Color3(0.9,  0.85, 0.0);
const C_ADAPT_EMI  = new Color3(0.3,  1.0,  0.55);

export class MazeRenderer {
  private scene:      Scene;
  private glowLayer:  GlowLayer;
  private pipeline!:  DefaultRenderingPipeline;

  private wallMeshes:    Map<string, Mesh>                    = new Map();
  private nodeMeshes:    Map<string, Mesh>                    = new Map();
  private nodeLights:    Map<string, PointLight>              = new Map();
  private nodeObservers: Map<string, Observer<Scene> | null>  = new Map();
  private portalObserver: Observer<Scene> | null = null;
  private exitPortal!:   TransformNode;

  private sharedWallMat!:  PBRMaterial;
  private adaptedWallMat!: StandardMaterial;
  private wallStripMat!:   StandardMaterial;
  private burstTex!:       DynamicTexture;
  private exitPs:          ParticleSystem | null = null;
  private exitPsTex:       DynamicTexture | null = null;
  private stripMeshes:     Mesh[] = [];
  private ceilingMeshes:   Mesh[] = [];
  private shadowGen:       ShadowGenerator | null = null;

  readonly CELL_SIZE:       number;
  readonly WALL_HEIGHT:     number;
  readonly WALL_THICKNESS:  number = 0.35;
  private readonly offsetX: number;
  private readonly offsetZ: number;

  constructor(
    scene: Scene,
    glowLayer: GlowLayer,
    private readonly cols: number,
    private readonly rows: number,
    cellSize   = 6,
    wallHeight = 4,
  ) {
    this.scene      = scene;
    this.glowLayer  = glowLayer;
    this.CELL_SIZE  = cellSize;
    this.WALL_HEIGHT = wallHeight;
    this.offsetX    = -(cols * cellSize) / 2;
    this.offsetZ    = -(rows * cellSize) / 2;
    this.createMaterials();
  }

  // ─── Materials ───────────────────────────────────────────────────────────────

  private createMaterials(): void {
    this.sharedWallMat = new PBRMaterial('mazeWall', this.scene);

    // PBR textures (MetalPlates017B 1K)
    const T = '/textures/walls/MetalPlates017B_1K-PNG_';
    const uS = 3, vS = 2; // 2 unités par plaque

    const colorTex = new Texture(`${T}Color.png`, this.scene);
    colorTex.uScale = uS; colorTex.vScale = vS;
    this.sharedWallMat.albedoTexture = colorTex;

    const normalTex = new Texture(`${T}NormalGL.png`, this.scene);
    normalTex.uScale = uS; normalTex.vScale = vS;
    this.sharedWallMat.bumpTexture = normalTex;

    const aoTex = new Texture(`${T}AmbientOcclusion.png`, this.scene);
    aoTex.uScale = uS; aoTex.vScale = vS;
    this.sharedWallMat.ambientTexture = aoTex;
    this.sharedWallMat.ambientColor   = new Color3(1, 1, 1);

    // Teinture bleu acier — l'emissive + GlowLayer ajoute le filet néon
    this.sharedWallMat.albedoColor   = new Color3(0.82, 0.88, 1.0);
    this.sharedWallMat.emissiveColor = C_WALL_EMI;
    this.sharedWallMat.metallic      = 0.55;
    this.sharedWallMat.roughness     = 0.45;

    this.adaptedWallMat = new StandardMaterial('mazeAdaptWall', this.scene);
    this.adaptedWallMat.emissiveColor = C_ADAPT_EMI;
    this.adaptedWallMat.diffuseColor  = C_ADAPT_EMI.scale(0.3);
    this.adaptedWallMat.alpha         = 0.5;

    // Arêtes néon en haut de chaque mur — pas dans le GlowLayer (surcharge la passe glow)
    this.wallStripMat = new StandardMaterial('wallStripMat', this.scene);
    this.wallStripMat.emissiveColor = new Color3(0.08, 0.45, 1.0);
    this.wallStripMat.diffuseColor  = new Color3(0, 0, 0);

    // Shared texture for node burst particles
    this.burstTex = new DynamicTexture('burstTex', { width: 16, height: 16 }, this.scene, false);
    const bctx = this.burstTex.getContext();
    const bg = bctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    bg.addColorStop(0,   'rgba(255,220,50,1)');
    bg.addColorStop(0.4, 'rgba(255,140,0,0.6)');
    bg.addColorStop(1,   'rgba(255,80,0,0)');
    bctx.fillStyle = bg;
    bctx.fillRect(0, 0, 16, 16);
    this.burstTex.update();
  }

  // ─── Build ───────────────────────────────────────────────────────────────────

  build(grid: MazeCell[][]): void {
    this.setupLighting();
    this.buildFloor();
    this.buildCeiling();
    this.buildBoundary();
    this.buildInteriorWalls(grid);
    this.buildExitPortal(grid);
    this.buildStartMarker();
    this.buildDataNodes(grid);
    this.setupPostProcessing();
  }

  private setupLighting(): void {
    const ambient = new HemisphericLight('mazeAmbient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity   = 0.55;
    ambient.diffuse     = new Color3(0.7, 0.75, 1.0);
    ambient.groundColor = new Color3(0.1,  0.1,  0.2);

    // Lumière directionelle légèrement inclinée pour des ombres visibles sur le sol
    const overhead = new DirectionalLight('mazeDir', new Vector3(-0.4, -1, 0.3), this.scene);
    overhead.position  = new Vector3(0, 20, 0);
    overhead.intensity = 0.6;
    overhead.diffuse   = new Color3(0.8, 0.85, 1.0);

    // Shadow map 1024 — qualité/perf raisonnable pour le labyrinthe
    this.shadowGen = new ShadowGenerator(1024, overhead);
    this.shadowGen.useExponentialShadowMap = true;
    this.shadowGen.darkness = 0.45; // 0 = ombre noire, 1 = pas d'ombre

    const center = new PointLight('mazeCenter', new Vector3(0, 8, 0), this.scene);
    center.intensity = 0.6;
    center.range     = Math.max(this.cols, this.rows) * this.CELL_SIZE * 1.5;
    center.diffuse   = new Color3(0.5, 0.65, 1.0);
  }

  private buildCeiling(): void {
    const w = this.cols * this.CELL_SIZE + 2;
    const h = this.rows * this.CELL_SIZE + 2;

    // Plafond métallique sombre, rendu vers le bas (rotation X = π)
    const ceiling = MeshBuilder.CreateGround('mazeCeiling', { width: w, height: h }, this.scene);
    ceiling.position.y  = this.WALL_HEIGHT;
    ceiling.rotation.x  = Math.PI;
    ceiling.isPickable  = false;
    // Pas de checkCollisions : le spring arm n'a pas besoin de le détecter
    // car camera.beta est limité à ~69° et la caméra reste sous le plafond

    const mat = new PBRMaterial('mazeCeilMat', this.scene);
    mat.albedoColor   = new Color3(0.10, 0.13, 0.20);
    mat.emissiveColor = new Color3(0.004, 0.006, 0.018);
    mat.metallic      = 0.90;
    mat.roughness     = 0.35;
    ceiling.material  = mat;
    this.ceilingMeshes.push(ceiling);

    // Grille émissive au plafond — même espacement que le sol, moins lumineuse
    const gridMat = new StandardMaterial('ceilGridMat', this.scene);
    gridMat.emissiveColor = new Color3(0.03, 0.07, 0.28);
    gridMat.alpha         = 0.45;

    const spacing = this.CELL_SIZE;
    for (let i = 0; i <= this.cols; i++) {
      const line = MeshBuilder.CreateBox(`cg_x${i}`, { width: 0.05, height: 0.01, depth: h }, this.scene);
      line.position.set(this.offsetX + i * spacing, this.WALL_HEIGHT - 0.01, 0);
      line.material  = gridMat;
      line.isPickable = false;
      this.ceilingMeshes.push(line);
    }
    for (let i = 0; i <= this.rows; i++) {
      const line = MeshBuilder.CreateBox(`cg_z${i}`, { width: w, height: 0.01, depth: 0.05 }, this.scene);
      line.position.set(0, this.WALL_HEIGHT - 0.01, this.offsetZ + i * spacing);
      line.material  = gridMat;
      line.isPickable = false;
      this.ceilingMeshes.push(line);
    }
  }

  private buildFloor(): void {
    const w = this.cols * this.CELL_SIZE + 2;
    const h = this.rows * this.CELL_SIZE + 2;

    const floor = MeshBuilder.CreateGround('mazeFloor', { width: w, height: h }, this.scene);
    floor.checkCollisions = true;
    floor.receiveShadows  = true;

    const mat = new PBRMaterial('mazeFloorMat', this.scene);

    // PBR textures sol (Tiles076 1K) — ~1.7 unités par carreau
    const fT = '/textures/floor/tiles/Tiles076_1K-PNG_';
    const fS = Math.round((this.cols * this.CELL_SIZE) / 1.7);

    const floorColor = new Texture(`${fT}Color.png`, this.scene);
    floorColor.uScale = fS; floorColor.vScale = fS;
    mat.albedoTexture = floorColor;

    const floorNormal = new Texture(`${fT}NormalGL.png`, this.scene);
    floorNormal.uScale = fS; floorNormal.vScale = fS;
    mat.bumpTexture = floorNormal;

    // Légère teinte bleu-nuit + emissive circuit pour l'esthétique numérique
    mat.albedoColor   = new Color3(0.70, 0.78, 1.0);
    mat.emissiveColor = new Color3(0.01, 0.04, 0.14);
    mat.ambientColor  = new Color3(1, 1, 1);
    mat.metallic      = 0.15;
    mat.roughness     = 0.75;
    floor.material    = mat;

    // Grid lines
    const spacing = this.CELL_SIZE;
    const gridMat  = new StandardMaterial('mazeGridMat', this.scene);
    gridMat.emissiveColor = C_GRID_EMI;
    gridMat.alpha         = 0.55;

    for (let i = 0; i <= this.cols; i++) {
      const line = MeshBuilder.CreateBox(`gl_x${i}`, { width: 0.06, height: 0.02, depth: h }, this.scene);
      line.position.set(this.offsetX + i * spacing, 0.01, 0);
      line.material = gridMat;
    }
    for (let i = 0; i <= this.rows; i++) {
      const line = MeshBuilder.CreateBox(`gl_z${i}`, { width: w, height: 0.02, depth: 0.06 }, this.scene);
      line.position.set(0, 0.01, this.offsetZ + i * spacing);
      line.material = gridMat;
    }
  }

  private buildBoundary(): void {
    const W = this.cols * this.CELL_SIZE;
    const H = this.rows * this.CELL_SIZE;
    const y = this.WALL_HEIGHT / 2;

    const sides: Array<[string, number, number, number, number, number]> = [
      ['bN', 0, y, this.offsetZ,   W + this.WALL_THICKNESS, this.WALL_THICKNESS],
      ['bS', 0, y, -this.offsetZ,  W + this.WALL_THICKNESS, this.WALL_THICKNESS],
      ['bW', this.offsetX,  y, 0,  this.WALL_THICKNESS, H + this.WALL_THICKNESS],
      ['bE', -this.offsetX, y, 0,  this.WALL_THICKNESS, H + this.WALL_THICKNESS],
    ];

    for (const [name, x, yPos, z, bw, bh] of sides) {
      const m = MeshBuilder.CreateBox(name, { width: bw, height: this.WALL_HEIGHT, depth: bh }, this.scene);
      m.position.set(x, yPos, z);
      m.material        = this.sharedWallMat;
      m.checkCollisions = true;
      this.glowLayer.addIncludedOnlyMesh(m);
      this.shadowGen?.addShadowCaster(m);
    }
  }

  private buildInteriorWalls(grid: MazeCell[][]): void {
    const t  = this.WALL_THICKNESS;
    const cs = this.CELL_SIZE;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = grid[r][c];

        if (cell.walls.S && r < this.rows - 1) {
          const id = `H_${c}_${r}`;
          const x  = this.offsetX + c * cs + cs / 2;
          const z  = this.offsetZ + (r + 1) * cs;
          this.wallMeshes.set(id, this.createWallBox(id, x, z, cs + t, t));
        }

        if (cell.walls.E && c < this.cols - 1) {
          const id = `V_${c}_${r}`;
          const x  = this.offsetX + (c + 1) * cs;
          const z  = this.offsetZ + r * cs + cs / 2;
          this.wallMeshes.set(id, this.createWallBox(id, x, z, t, cs + t));
        }
      }
    }
  }

  private createWallBox(id: string, x: number, z: number, bw: number, bd: number): Mesh {
    const m = MeshBuilder.CreateBox(id, { width: bw, height: this.WALL_HEIGHT, depth: bd }, this.scene);
    m.position.set(x, this.WALL_HEIGHT / 2, z);
    m.material        = this.sharedWallMat;
    m.checkCollisions = true;
    this.glowLayer.addIncludedOnlyMesh(m);
    this.shadowGen?.addShadowCaster(m);

    // Arête néon au sommet du mur
    const strip = MeshBuilder.CreateBox(`${id}_strip`, { width: bw, height: 0.05, depth: bd }, this.scene);
    strip.position.set(x, this.WALL_HEIGHT + 0.025, z);
    strip.material    = this.wallStripMat;
    strip.isPickable  = false;
    this.glowLayer.addIncludedOnlyMesh(strip);
    this.stripMeshes.push(strip);

    return m;
  }

  // ─── Exit portal ──────────────────────────────────────────────────────────────

  private buildExitPortal(grid: MazeCell[][]): void {
    const exitCell = grid[this.rows - 1][this.cols - 1];
    const { x, z }  = this.cellToWorld(exitCell.col, exitCell.row);

    this.exitPortal = new TransformNode('exitPortal', this.scene);
    this.exitPortal.position.set(x, 0, z);

    const base = MeshBuilder.CreateDisc('exitBase', { radius: 1.8, tessellation: 48 }, this.scene);
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.05;
    base.parent     = this.exitPortal;
    const baseMat   = new StandardMaterial('exitBaseMat', this.scene);
    baseMat.emissiveColor = C_EXIT_EMI;
    baseMat.alpha         = 0.7;
    base.material         = baseMat;
    this.glowLayer.addIncludedOnlyMesh(base);

    const ring = MeshBuilder.CreateTorus('exitRing', { diameter: 3.8, thickness: 0.18, tessellation: 64 }, this.scene);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.9;
    ring.parent     = this.exitPortal;
    const ringMat   = new StandardMaterial('exitRingMat', this.scene);
    ringMat.emissiveColor = C_EXIT_EMI;
    ring.material         = ringMat;
    this.glowLayer.addIncludedOnlyMesh(ring);

    const inner = MeshBuilder.CreateDisc('exitInner', { radius: 1.5, tessellation: 32 }, this.scene);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 1.9;
    inner.parent     = this.exitPortal;
    const innerMat   = new StandardMaterial('exitInnerMat', this.scene);
    innerMat.emissiveColor = C_EXIT_EMI.scale(0.6);
    innerMat.alpha         = 0.5;
    inner.material         = innerMat;
    this.glowLayer.addIncludedOnlyMesh(inner);

    this.buildExitParticles(new Vector3(x, 0, z));

    const pLight = new PointLight('exitLight', new Vector3(x, 2, z), this.scene);
    pLight.diffuse   = C_EXIT_EMI;
    pLight.intensity = 1.8;
    pLight.range     = 10;

    this.portalObserver = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      ring.rotation.y  = t * 0.6;
      inner.rotation.y = -t * 1.1;
      ring.scaling.setAll(1 + Math.sin(t * 2.5) * 0.06);
    });
  }

  private buildExitParticles(pos: Vector3): void {
    this.exitPs  = new ParticleSystem('exitPs', 120, this.scene);
    this.exitPsTex = new DynamicTexture('exitPsTex', { width: 32, height: 32 }, this.scene, false);
    const ps  = this.exitPs;
    const tex = this.exitPsTex;
    const ctx = tex.getContext();
    const g   = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    tex.update();
    ps.particleTexture = tex;

    ps.emitter      = pos.clone();
    ps.minEmitBox   = new Vector3(-1, 0, -1);
    ps.maxEmitBox   = new Vector3(1, 0, 1);
    ps.color1       = new Color4(0.0, 1.0, 0.5, 1.0);
    ps.color2       = new Color4(0.2, 0.8, 1.0, 0.8);
    ps.colorDead    = new Color4(0.0, 0.5, 0.3, 0.0);
    ps.minSize      = 0.06; ps.maxSize      = 0.18;
    ps.minLifeTime  = 1.2;  ps.maxLifeTime  = 2.5;
    ps.emitRate     = 50;
    ps.direction1   = new Vector3(-0.3, 2, -0.3);
    ps.direction2   = new Vector3(0.3,  4,  0.3);
    ps.minEmitPower = 0.5;  ps.maxEmitPower = 1.5;
    ps.gravity      = new Vector3(0, -1, 0);
    ps.start();
  }

  private buildStartMarker(): void {
    const x = this.offsetX + this.CELL_SIZE / 2;
    const z = this.offsetZ + this.CELL_SIZE / 2;

    const marker = MeshBuilder.CreateDisc('startMarker', { radius: 1.4, tessellation: 32 }, this.scene);
    marker.rotation.x = Math.PI / 2;
    marker.position.set(x, 0.06, z);
    const mat = new StandardMaterial('startMarkerMat', this.scene);
    mat.emissiveColor = C_START_EMI;
    mat.alpha         = 0.6;
    marker.material   = mat;
    this.glowLayer.addIncludedOnlyMesh(marker);

    const arrow = MeshBuilder.CreateCylinder('startArrow',
      { height: 0.4, diameterTop: 0, diameterBottom: 0.5, tessellation: 3 }, this.scene);
    arrow.position.set(x, 0.2, z);
    const aMat = new StandardMaterial('startArrowMat', this.scene);
    aMat.emissiveColor = C_START_EMI;
    arrow.material     = aMat;
    this.glowLayer.addIncludedOnlyMesh(arrow);
  }

  private buildDataNodes(grid: MazeCell[][]): void {
    let idx = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!grid[r][c].dataNode) continue;

        const { x, z } = this.cellToWorld(c, r);
        const id  = `node_${c}_${r}`;

        // Orb
        const orb = MeshBuilder.CreateSphere(id, { diameter: 0.7, segments: 12 }, this.scene);
        orb.position.set(x, 1.5, z);
        const mat = new StandardMaterial(`${id}Mat`, this.scene);
        mat.emissiveColor = C_NODE_EMI;
        mat.diffuseColor  = C_NODE_EMI.scale(0.3);
        orb.material      = mat;
        this.glowLayer.addIncludedOnlyMesh(orb);

        // Small point light that makes corridors glow yellow nearby
        const light = new PointLight(`${id}Light`, new Vector3(x, 1.5, z), this.scene);
        light.diffuse   = C_NODE_EMI;
        light.intensity = 0.7;
        light.range     = 4.5;
        this.nodeLights.set(id, light);

        // Hover animation — stored for cleanup
        const off = idx * 0.7;
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          orb.position.y  = 1.5 + Math.sin(performance.now() / 1000 * 1.8 + off) * 0.2;
          orb.rotation.y += 0.025;
        });
        this.nodeObservers.set(id, obs);
        this.nodeMeshes.set(id, orb);
        idx++;
      }
    }
  }

  private setupPostProcessing(): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;

    // Firefox gère la tonemapping HDR et le stencil différemment de Chrome/Safari.
    // On réduit l'exposition et le bloom pour éviter que les matériaux PBR disparaissent.
    const ff = /Firefox/i.test(navigator.userAgent);

    this.pipeline = new DefaultRenderingPipeline('mazePipe', true, this.scene, [cam]);
    this.pipeline.bloomEnabled    = true;
    this.pipeline.bloomThreshold  = ff ? 0.45 : 0.2;
    this.pipeline.bloomWeight     = ff ? 0.2  : 0.35;
    this.pipeline.bloomKernel     = 48;
    this.pipeline.bloomScale      = 0.5;
    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.vignetteEnabled = true;
    this.pipeline.imageProcessing.vignetteWeight  = ff ? 1.8 : 3.0;
    this.pipeline.imageProcessing.contrast        = ff ? 1.0 : 1.05;
    this.pipeline.imageProcessing.exposure        = ff ? 1.0 : 1.3;
    this.pipeline.chromaticAberrationEnabled      = !ff;
    if (!ff) {
      this.pipeline.chromaticAberration.aberrationAmount = 3;
    }
  }

  // ─── Adaptive wall opening ────────────────────────────────────────────────────

  animateWallOpen(wallId: string): Promise<void> {
    const mesh = this.wallMeshes.get(wallId);
    if (!mesh || !mesh.isEnabled()) return Promise.resolve();

    mesh.material = this.adaptedWallMat;

    return new Promise(resolve => {
      const anim = new Animation('wallSink', 'position.y', 60,
        Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const ease = new CubicEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEIN);
      anim.setEasingFunction(ease);
      anim.setKeys([
        { frame: 0,  value: this.WALL_HEIGHT / 2 },
        { frame: 50, value: -(this.WALL_HEIGHT + 0.5) },
      ]);
      mesh.animations = [anim];
      this.scene.beginAnimation(mesh, 0, 50, false, 1, () => {
        mesh.setEnabled(false);
        mesh.checkCollisions = false;
        resolve();
      });
    });
  }

  // ─── Node collection + burst ──────────────────────────────────────────────────

  collectNode(col: number, row: number): boolean {
    const id   = `node_${col}_${row}`;
    const mesh = this.nodeMeshes.get(id);
    if (!mesh || !mesh.isEnabled()) return false;

    // Stop animation observer
    const obs = this.nodeObservers.get(id);
    if (obs) {
      this.scene.onBeforeRenderObservable.remove(obs);
      this.nodeObservers.delete(id);
    }

    // Turn off point light
    const light = this.nodeLights.get(id);
    if (light) {
      light.setEnabled(false);
    }

    mesh.setEnabled(false);
    this.spawnNodeBurst(col, row);
    return true;
  }

  spawnNodeBurst(col: number, row: number): void {
    const { x, z } = this.cellToWorld(col, row);
    const ps = new ParticleSystem(`burst_${col}_${row}`, 80, this.scene);
    ps.particleTexture     = this.burstTex;
    ps.emitter             = new Vector3(x, 1.5, z);
    ps.minEmitBox          = new Vector3(-0.2, -0.2, -0.2);
    ps.maxEmitBox          = new Vector3(0.2,   0.2,  0.2);
    ps.color1              = new Color4(1.0, 0.9, 0.1, 1.0);
    ps.color2              = new Color4(1.0, 0.4, 0.0, 0.8);
    ps.colorDead           = new Color4(1.0, 0.2, 0.0, 0.0);
    ps.minSize             = 0.08; ps.maxSize      = 0.25;
    ps.minLifeTime         = 0.3;  ps.maxLifeTime  = 0.8;
    ps.emitRate            = 300;
    ps.direction1          = new Vector3(-2, 2, -2);
    ps.direction2          = new Vector3(2,  5,  2);
    ps.minEmitPower        = 1.0;  ps.maxEmitPower = 3.0;
    ps.gravity             = new Vector3(0, -4, 0);
    ps.targetStopDuration  = 0.15;
    ps.disposeOnStop       = true;
    ps.start();
  }

  // ─── Fog / atmosphere ─────────────────────────────────────────────────────────

  getShadowGenerator(): ShadowGenerator | null {
    return this.shadowGen;
  }

  setFogDensity(density: number): void {
    this.scene.fogMode    = 3; // FOGMODE_EXP2
    this.scene.fogDensity = density;
    this.scene.fogColor   = new Color3(0.01, 0.02, 0.06);
  }

  // ─── Coordinate helpers ───────────────────────────────────────────────────────

  cellToWorld(col: number, row: number): { x: number; z: number } {
    return {
      x: this.offsetX + col * this.CELL_SIZE + this.CELL_SIZE / 2,
      z: this.offsetZ + row * this.CELL_SIZE + this.CELL_SIZE / 2,
    };
  }

  worldToCell(wx: number, wz: number): { col: number; row: number } {
    return {
      col: Math.floor((wx - this.offsetX) / this.CELL_SIZE),
      row: Math.floor((wz - this.offsetZ) / this.CELL_SIZE),
    };
  }

  hasWallMesh(id: string): boolean {
    const m = this.wallMeshes.get(id);
    return !!m && m.isEnabled();
  }

  getExitWorldPos(): Vector3 {
    return this.exitPortal.position.clone();
  }

  dispose(): void {
    // Unregister all node observers
    this.nodeObservers.forEach(obs => {
      if (obs) this.scene.onBeforeRenderObservable.remove(obs);
    });
    this.nodeObservers.clear();

    // Unregister portal observer
    if (this.portalObserver) {
      this.scene.onBeforeRenderObservable.remove(this.portalObserver);
      this.portalObserver = null;
    }

    this.wallMeshes.forEach(m => m.dispose());
    this.nodeMeshes.forEach(m => m.dispose());
    this.nodeLights.forEach(l => l.dispose());
    this.wallMeshes.clear();
    this.nodeMeshes.clear();
    this.nodeLights.clear();
    this.burstTex?.dispose();
    this.exitPs?.dispose();
    this.exitPsTex?.dispose();
    this.stripMeshes.forEach(m => m.dispose());
    this.stripMeshes = [];
    this.ceilingMeshes.forEach(m => m.dispose());
    this.ceilingMeshes = [];
    this.shadowGen?.dispose();
    this.shadowGen = null;
    this.pipeline?.dispose();
  }
}
