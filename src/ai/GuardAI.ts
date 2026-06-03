import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Vector3,
  PointLight,
  TransformNode,
  GlowLayer,
  VertexData,
  SceneLoader,
  AbstractMesh,
  AnimationGroup,
  Ray,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export const GUARD_VISION_DIST      = 9;
export const GUARD_VISION_ANGLE     = Math.PI / 2.2; // ~82° total (±41°)
export const GUARD_SPEED            = 2.4;
export const GUARD_DETECT_SPEED     = 0.38;
export const GUARD_RECOVER_SPEED    = 0.28;
export const GUARD_ALARM_THRESHOLD  = 1.0;
export const GUARD_CAPTURE_DIST     = 1.4;

// Couleurs état normal / stun
const COLOR_EYE_NORMAL  = new Color3(1.0, 0.12, 0.0);
const COLOR_EYE_STUN    = new Color3(0.0, 0.8,  1.0);
const COLOR_CONE_NORMAL = new Color3(1.0, 0.18, 0.0);
const COLOR_CONE_STUN   = new Color3(0.1, 0.8,  1.0);
const COLOR_LIGHT_NORMAL = new Color3(1.0, 0.25, 0.05);
const COLOR_LIGHT_STUN   = new Color3(0.1, 0.7,  1.0);
const EMISSIVE_NORMAL   = new Color3(0.65, 0.06, 0.01);
const EMISSIVE_STUN     = new Color3(0.0,  0.45, 0.85);

export class GuardAI {
  private root!:       TransformNode;
  private bodyMesh!:   Mesh;           // fallback capsule (caché si GLB chargé)
  private eyeMesh!:    Mesh;           // bande oculaire (toujours visible)
  private coneMesh!:   Mesh;           // cône de vision
  private light!:      PointLight;

  // GLB
  private modelRoot:   AbstractMesh | null = null;
  private modelMeshes: AbstractMesh[]      = [];
  private idleAnim:    AnimationGroup | null = null;
  private walkAnim:    AnimationGroup | null = null;
  private isMoving     = false;

  private waypoints:   Vector3[];
  private wpIdx        = 0;
  private position:    Vector3;
  private rotation     = 0;

  public  alertLevel   = 0;
  private stunTimer    = 0;
  private chaseTarget: Vector3 | null = null;

  constructor(
    private scene:     Scene,
    private glow:      GlowLayer,
    waypoints:         Vector3[],
    startRotation      = 0,
  ) {
    this.waypoints = waypoints.map(w => w.clone());
    this.position  = waypoints[0].clone();
    this.rotation  = startRotation;
    this.build();
    this.loadModel(); // async — le fallback reste visible pendant le chargement
  }

  // ─── Construction des primitives (fallback immédiat) ───────────────────────

  private build(): void {
    this.root = new TransformNode('guardRoot', this.scene);
    this.root.position.copyFrom(this.position);

    // Capsule fallback
    this.bodyMesh = MeshBuilder.CreateCapsule('guardBody', { height: 1.8, radius: 0.38 }, this.scene);
    this.bodyMesh.parent     = this.root;
    this.bodyMesh.position.y = 0.9;
    const bm = new PBRMaterial('guardBodyMat', this.scene);
    bm.albedoColor   = new Color3(0.06, 0.04, 0.08);
    bm.metallic      = 0.9;
    bm.roughness     = 0.2;
    bm.emissiveColor = EMISSIVE_NORMAL.clone();
    this.bodyMesh.material = bm;

    // Bande oculaire émissive (reste visible même avec le GLB)
    this.eyeMesh = MeshBuilder.CreateBox('guardEye', { width: 0.52, height: 0.09, depth: 0.40 }, this.scene);
    this.eyeMesh.parent   = this.root;
    this.eyeMesh.position.set(0, 1.52, 0);
    const em = new StandardMaterial('guardEyeMat', this.scene);
    em.emissiveColor = COLOR_EYE_NORMAL.clone();
    this.eyeMesh.material = em;
    this.glow.addIncludedOnlyMesh(this.eyeMesh);

    // Cône de vision
    this.coneMesh = this.buildConeSectorMesh();
    this.coneMesh.parent     = this.root;
    this.coneMesh.position.y = 0.07;
    const cm = new StandardMaterial('guardConeMat', this.scene);
    cm.emissiveColor   = COLOR_CONE_NORMAL.clone();
    cm.alpha           = 0.20;
    cm.backFaceCulling = false;
    this.coneMesh.material = cm;

    // Lumière
    this.light = new PointLight('guardLight', this.position.add(new Vector3(0, 1.5, 0)), this.scene);
    this.light.diffuse   = COLOR_LIGHT_NORMAL.clone();
    this.light.intensity = 0.45;
    this.light.range     = 7;
  }

  private buildConeSectorMesh(): Mesh {
    const STEPS = 20;
    const halfA = GUARD_VISION_ANGLE / 2;
    const positions: number[] = [0, 0, 0];
    const indices:   number[] = [];
    const normals:   number[] = [0, 1, 0];

    for (let i = 0; i <= STEPS; i++) {
      const a = -halfA + (i / STEPS) * GUARD_VISION_ANGLE;
      positions.push(Math.sin(a) * GUARD_VISION_DIST, 0, Math.cos(a) * GUARD_VISION_DIST);
      normals.push(0, 1, 0);
      if (i < STEPS) indices.push(0, i + 1, i + 2);
    }

    const cone = new Mesh('visionCone', this.scene);
    const vd   = new VertexData();
    vd.positions = positions;
    vd.indices   = indices;
    vd.normals   = normals;
    vd.applyToMesh(cone, true);
    return cone;
  }

  // ─── Chargement GLB asynchrone ─────────────────────────────────────────────

  private async loadModel(): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '/models/', 'character-robot.glb', this.scene);
      if (!result.meshes.length) return;

      const root = result.meshes[0];
      root.parent   = this.root;
      root.position = Vector3.Zero();
      root.scaling  = new Vector3(0.9, 0.9, 0.9);

      // Teinte rouge-orange + légère emissive pour look « robot de sécurité »
      result.meshes.forEach(m => {
        if (!m.material) return;
        if (m.material instanceof StandardMaterial) {
          m.material.emissiveColor = EMISSIVE_NORMAL.clone();
          m.material.diffuseColor  = new Color3(0.1, 0.07, 0.05);
        } else if (m.material instanceof PBRMaterial) {
          m.material.emissiveColor = EMISSIVE_NORMAL.clone();
          m.material.albedoColor   = new Color3(0.08, 0.05, 0.04);
        }
        if (m instanceof Mesh) this.glow.addIncludedOnlyMesh(m);
      });

      // Cacher le fallback capsule
      this.bodyMesh.setEnabled(false);

      this.modelRoot   = root;
      this.modelMeshes = result.meshes;

      // Animations
      const anims = result.animationGroups;
      this.idleAnim = anims.find(a => /idle/i.test(a.name)) ?? anims[0] ?? null;
      this.walkAnim = anims.find(a => /walk|run/i.test(a.name)) ?? null;
      if (this.idleAnim) this.idleAnim.start(true);

    } catch {
      // Capsule fallback reste active
    }
  }

  // ─── Couleur du modèle GLB ─────────────────────────────────────────────────

  private setModelEmissive(color: Color3): void {
    this.modelMeshes.forEach(m => {
      if (m.material instanceof StandardMaterial) m.material.emissiveColor = color.clone();
      else if (m.material instanceof PBRMaterial)  m.material.emissiveColor = color.clone();
    });
    // Capsule fallback
    (this.bodyMesh.material as PBRMaterial).emissiveColor = color.clone();
  }

  // ─── Stun (EMP) ────────────────────────────────────────────────────────────

  public stun(duration: number): void {
    this.stunTimer   = duration;
    this.alertLevel  = 0;
    this.chaseTarget = null;

    this.setModelEmissive(EMISSIVE_STUN);
    (this.eyeMesh.material  as StandardMaterial).emissiveColor = COLOR_EYE_STUN.clone();
    const cm = this.coneMesh.material as StandardMaterial;
    cm.emissiveColor = COLOR_CONE_STUN.clone();
    cm.alpha         = 0.35;
    this.light.diffuse = COLOR_LIGHT_STUN.clone();
    this.coneMesh.setEnabled(false);

    // Stopper les animations
    this.idleAnim?.stop();
    this.walkAnim?.stop();
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  public update(dt: number, playerPos: Vector3): {
    alertDelta: number;
    isInCone:   boolean;
    isCapture:  boolean;
  } {
    // Stunned
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) this.recover();
      this.root.position.copyFrom(this.position);
      this.light.position.set(this.position.x, this.position.y + 1.5, this.position.z);
      return { alertDelta: -dt * GUARD_RECOVER_SPEED, isInCone: false, isCapture: false };
    }
    this.coneMesh.setEnabled(true);

    // Mouvement vers waypoint
    const target = this.chaseTarget ?? this.waypoints[this.wpIdx];
    const diff   = target.subtract(this.position);
    diff.y       = 0;
    const dist   = diff.length();

    if (dist < 0.18) {
      if (this.chaseTarget) {
        this.chaseTarget = null;
      } else {
        this.wpIdx = (this.wpIdx + 1) % this.waypoints.length;
      }
      this.isMoving = false;
    } else {
      const step = Math.min(GUARD_SPEED * dt, dist);
      this.position.addInPlace(diff.normalize().scaleInPlace(step));

      const targetRot = Math.atan2(diff.x, diff.z);
      let rotDiff     = targetRot - this.rotation;
      while (rotDiff >  Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      this.rotation += rotDiff * Math.min(1, dt * 5.5);
      this.isMoving = true;
    }

    // Sync scène
    this.root.position.copyFrom(this.position);
    this.root.rotation.y = this.rotation;
    this.light.position.set(this.position.x, this.position.y + 1.5, this.position.z);

    // Animation walk / idle
    if (this.idleAnim && this.walkAnim) {
      if (this.isMoving && !this.walkAnim.isPlaying) {
        this.idleAnim.stop();
        this.walkAnim.start(true);
      } else if (!this.isMoving && !this.idleAnim.isPlaying) {
        this.walkAnim.stop();
        this.idleAnim.start(true);
      }
    }

    // Détection joueur
    const toPlayer   = playerPos.subtract(this.position);
    toPlayer.y       = 0;
    const playerDist = toPlayer.length();

    let isInCone = false;
    if (playerDist < GUARD_VISION_DIST && playerDist > 0.05) {
      const forward = new Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation));
      const toPN    = toPlayer.normalize();
      const dot     = Math.max(-1, Math.min(1, Vector3.Dot(forward, toPN)));
      if (Math.acos(dot) < GUARD_VISION_ANGLE / 2) {
        // Vérification d'occlusion : raycast de l'œil du garde vers le joueur
        const eyePos = this.position.add(new Vector3(0, 1.4, 0));
        const rayDir = playerPos.subtract(eyePos).normalize();
        const ray    = new Ray(eyePos, rayDir, playerDist);
        const hit    = this.scene.pickWithRay(ray, m => m.checkCollisions);
        // Si le raycast touche quelque chose avant le joueur → mur entre les deux
        const wallInBetween = hit?.hit && hit.distance !== undefined && hit.distance < playerDist - 0.4;
        isInCone = !wallInBetween;
      }
    }

    if (isInCone) this.chaseTarget = playerPos.clone();

    const alertDelta = isInCone
      ?  dt * GUARD_DETECT_SPEED
      : -dt * GUARD_RECOVER_SPEED;

    // Apparence selon niveau d'alerte
    const t  = this.alertLevel;
    const cm = this.coneMesh.material as StandardMaterial;
    cm.emissiveColor = new Color3(1.0, 0.18 * (1 - t), 0.0);
    cm.alpha         = 0.18 + t * 0.30;
    this.light.diffuse   = new Color3(1.0, 0.25 * (1 - t), 0.0);
    this.light.intensity = 0.45 + t * 1.2;

    // Emissive du robot vire à l'orange-rouge en alerte haute
    if (t > 0.3) {
      const alertEmissive = new Color3(0.65 + t * 0.35, 0.06 * (1 - t), 0.01);
      this.setModelEmissive(alertEmissive);
    }

    return { alertDelta, isInCone, isCapture: playerDist < GUARD_CAPTURE_DIST };
  }

  // ─── Alarme ────────────────────────────────────────────────────────────────

  public setChaseTarget(pos: Vector3): void {
    this.chaseTarget = pos.clone();
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  public getPosition(): Vector3  { return this.position.clone(); }
  public getAlertLevel(): number { return this.alertLevel; }
  public isStunned(): boolean    { return this.stunTimer > 0; }

  /** Distance restante jusqu'au prochain waypoint (J4) */
  public getDistToNextWaypoint(): number {
    const next = this.waypoints[(this.wpIdx + 1) % this.waypoints.length];
    return Vector3.Distance(this.position, next);
  }

  /** Position du prochain waypoint (J4) */
  public getNextWaypoint(): Vector3 {
    return this.waypoints[(this.wpIdx + 1) % this.waypoints.length].clone();
  }

  // ─── Recover ───────────────────────────────────────────────────────────────

  private recover(): void {
    this.setModelEmissive(EMISSIVE_NORMAL);
    (this.eyeMesh.material  as StandardMaterial).emissiveColor = COLOR_EYE_NORMAL.clone();
    const cm = this.coneMesh.material as StandardMaterial;
    cm.emissiveColor = COLOR_CONE_NORMAL.clone();
    cm.alpha         = 0.20;
    this.light.diffuse = COLOR_LIGHT_NORMAL.clone();
    this.coneMesh.setEnabled(true);

    if (this.idleAnim) this.idleAnim.start(true);
  }

  // ─── Dispose ───────────────────────────────────────────────────────────────

  public dispose(): void {
    this.idleAnim?.stop();
    this.walkAnim?.stop();
    this.modelRoot?.dispose();
    this.root.getChildMeshes().forEach(m => m.dispose());
    this.root.dispose();
    this.light.dispose();
  }
}
