import {
  Scene,
  Vector3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  StandardMaterial,
  Color3,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
} from '@babylonjs/core';
import { ModelLoader, LoadedModel } from '@/core/ModelLoader';

/**
 * État d'animation du personnage
 */
export enum CharacterState {
  IDLE = 'idle',
  WALKING = 'walking',
  RUNNING = 'running',
  JUMPING = 'jumping',
}

/**
 * Personnage 3D du joueur
 * Charge un modèle GLB depuis /models/ ou crée un fallback avec des primitives
 */
export class PlayerCharacter {
  private scene: Scene;
  private rootNode: TransformNode;
  private isModelLoaded: boolean = false;

  // Fallback primitives
  private body!: Mesh;
  private leftArm!: Mesh;
  private rightArm!: Mesh;
  private leftLeg!: Mesh;
  private rightLeg!: Mesh;

  // GLB model
  private modelMeshes: AbstractMesh[] = [];
  private animationGroups: AnimationGroup[] = [];
  private idleAnim: AnimationGroup | null = null;
  private walkAnim: AnimationGroup | null = null;
  private runAnim: AnimationGroup | null = null;
  private currentAnim: AnimationGroup | null = null;

  // Animations fallback
  private walkCycle: number = 0;
  private idleBob: number = 0;

  // Couleurs du personnage (fallback)
  private readonly skinColor = new Color3(0.9, 0.75, 0.65);
  private readonly clothColor = new Color3(0.2, 0.3, 0.5);
  private readonly pantsColor = new Color3(0.15, 0.15, 0.2);
  private readonly shoeColor = new Color3(0.1, 0.1, 0.12);
  private readonly hairColor = new Color3(0.15, 0.1, 0.08);

  constructor(scene: Scene) {
    this.scene = scene;
    this.rootNode = new TransformNode('playerCharacter', scene);

    // Crée le fallback immédiatement (visible pendant le chargement)
    this.createFallbackModel();

    // Tente de charger le modèle GLB en arrière-plan
    this.loadGLBModel();
  }

  /**
   * Charge le modèle GLB du personnage
   */
  private async loadGLBModel(): Promise<void> {
    try {
      console.log('[PlayerCharacter] Début chargement GLB...');
      const loader = ModelLoader.getInstance();
      const model = await loader.loadModelSafe(
        this.scene,
        '/models/',
        'character.glb',
        'characterModel'
      );

      if (model) {
        this.applyGLBModel(model);
      } else {
        console.log('[PlayerCharacter] Modèle non trouvé, fallback conservé');
      }
    } catch (error) {
      console.error('[PlayerCharacter] Erreur chargement GLB:', error);
    }
  }

  /**
   * Calcule le bounding box manuellement à partir des meshes avec des vertices
   */
  private computeMeshBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3 } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let found = false;

    for (const mesh of meshes) {
      // Ignore les meshes sans géométrie (ex: __root__)
      if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;

      mesh.computeWorldMatrix(true);
      const bi = mesh.getBoundingInfo();
      const bbMin = bi.boundingBox.minimumWorld;
      const bbMax = bi.boundingBox.maximumWorld;

      minX = Math.min(minX, bbMin.x);
      minY = Math.min(minY, bbMin.y);
      minZ = Math.min(minZ, bbMin.z);
      maxX = Math.max(maxX, bbMax.x);
      maxY = Math.max(maxY, bbMax.y);
      maxZ = Math.max(maxZ, bbMax.z);
      found = true;
    }

    if (!found) return null;
    return { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) };
  }

  /**
   * Applique le modèle GLB chargé
   */
  private applyGLBModel(model: LoadedModel): void {
    console.log(`[PlayerCharacter] Application du modèle: ${model.meshes.length} meshes`);
    console.log(`[PlayerCharacter] Meshes: ${model.meshes.map((m) => `${m.name}(vertices:${m.getTotalVertices ? m.getTotalVertices() : '?'})`).join(', ')}`);

    // Calcule la taille du modèle AVANT de supprimer le fallback
    const bounds = this.computeMeshBounds(model.meshes);

    if (!bounds) {
      console.warn('[PlayerCharacter] Aucun mesh avec géométrie trouvé, fallback conservé');
      return;
    }

    const modelHeight = bounds.max.y - bounds.min.y;
    const modelWidth = bounds.max.x - bounds.min.x;
    const modelDepth = bounds.max.z - bounds.min.z;

    console.log(`[PlayerCharacter] Bounds: min=(${bounds.min.x.toFixed(2)}, ${bounds.min.y.toFixed(2)}, ${bounds.min.z.toFixed(2)}) max=(${bounds.max.x.toFixed(2)}, ${bounds.max.y.toFixed(2)}, ${bounds.max.z.toFixed(2)})`);
    console.log(`[PlayerCharacter] Dimensions: ${modelWidth.toFixed(2)} x ${modelHeight.toFixed(2)} x ${modelDepth.toFixed(2)}`);

    // Maintenant qu'on sait que le modèle est valide, on supprime le fallback
    this.disposeFallback();

    // Configure le modèle
    this.modelMeshes = model.meshes;
    this.animationGroups = model.animationGroups;

    // Parente le modèle au personnage
    model.rootNode.parent = this.rootNode;

    // Auto-scale pour que le personnage fasse ~1.7m de haut
    const targetHeight = 1.7;
    if (modelHeight > 0.001) {
      const scale = targetHeight / modelHeight;
      model.rootNode.scaling.setAll(scale);
      // Repositionne pour que les pieds soient à Y=0
      model.rootNode.position.y = -bounds.min.y * scale;
      console.log(`[PlayerCharacter] Auto-scale: ${scale.toFixed(4)} (hauteur originale: ${modelHeight.toFixed(2)})`);
    } else {
      model.rootNode.scaling.setAll(1);
      model.rootNode.position.y = 0;
    }

    // S'assure que tous les meshes sont visibles
    model.meshes.forEach((mesh) => {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      if (mesh.getTotalVertices && mesh.getTotalVertices() > 0) {
        mesh.isVisible = true;
      }
    });

    // Cherche les animations
    const loader = ModelLoader.getInstance();
    this.idleAnim = loader.findAnimation(model.animationGroups, 'idle') || null;
    this.walkAnim = loader.findAnimation(model.animationGroups, 'walk') || null;
    this.runAnim = loader.findAnimation(model.animationGroups, 'run') || null;

    // Stoppe toutes les animations puis démarre l'idle
    model.animationGroups.forEach((ag) => ag.stop());
    if (this.idleAnim) {
      this.idleAnim.start(true);
      this.currentAnim = this.idleAnim;
    }

    this.isModelLoaded = true;
    console.log(`[PlayerCharacter] Modèle appliqué ! Animations: ${model.animationGroups.map((a) => a.name).join(', ') || 'aucune'}`);
  }

  /**
   * Crée le modèle fallback avec des primitives
   */
  private createFallbackModel(): void {
    this.body = this.createBody();
    this.createHead();
    this.leftArm = this.createArm('left');
    this.rightArm = this.createArm('right');
    this.leftLeg = this.createLeg('left');
    this.rightLeg = this.createLeg('right');
    this.createAccessories();
  }

  private createBody(): Mesh {
    const torso = MeshBuilder.CreateCapsule('torso', {
      height: 0.6,
      radius: 0.22,
    }, this.scene);
    torso.position.y = 1.1;
    torso.parent = this.rootNode;
    torso.isPickable = false;

    const torsoMat = new PBRMaterial('torsoMat', this.scene);
    torsoMat.albedoColor = this.clothColor;
    torsoMat.metallic = 0.1;
    torsoMat.roughness = 0.8;
    torso.material = torsoMat;

    const neck = MeshBuilder.CreateCylinder('neck', {
      height: 0.1,
      diameter: 0.12,
    }, this.scene);
    neck.position.y = 0.35;
    neck.parent = torso;
    neck.isPickable = false;

    const neckMat = new PBRMaterial('neckMat', this.scene);
    neckMat.albedoColor = this.skinColor;
    neckMat.metallic = 0;
    neckMat.roughness = 0.6;
    neck.material = neckMat;

    const belt = MeshBuilder.CreateCylinder('belt', {
      height: 0.08,
      diameter: 0.45,
    }, this.scene);
    belt.position.y = -0.28;
    belt.parent = torso;
    belt.isPickable = false;

    const beltMat = new PBRMaterial('beltMat', this.scene);
    beltMat.albedoColor = new Color3(0.3, 0.25, 0.2);
    beltMat.metallic = 0.3;
    beltMat.roughness = 0.5;
    belt.material = beltMat;

    return torso;
  }

  private createHead(): Mesh {
    const head = MeshBuilder.CreateSphere('head', {
      diameter: 0.28,
      segments: 16,
    }, this.scene);
    head.position.y = 1.55;
    head.parent = this.rootNode;
    head.isPickable = false;

    const headMat = new PBRMaterial('headMat', this.scene);
    headMat.albedoColor = this.skinColor;
    headMat.metallic = 0;
    headMat.roughness = 0.6;
    head.material = headMat;

    const hair = MeshBuilder.CreateSphere('hair', {
      diameter: 0.3,
      segments: 16,
    }, this.scene);
    hair.position.y = 0.03;
    hair.position.z = -0.02;
    hair.scaling = new Vector3(1, 0.8, 1);
    hair.parent = head;
    hair.isPickable = false;

    const hairMat = new PBRMaterial('hairMat', this.scene);
    hairMat.albedoColor = this.hairColor;
    hairMat.metallic = 0.2;
    hairMat.roughness = 0.7;
    hair.material = hairMat;

    this.createEye(head, 'left', -0.06);
    this.createEye(head, 'right', 0.06);

    return head;
  }

  private createEye(parent: Mesh, side: string, offsetX: number): void {
    const eyeWhite = MeshBuilder.CreateSphere(`eye${side}White`, {
      diameter: 0.05,
    }, this.scene);
    eyeWhite.position = new Vector3(offsetX, 0.02, 0.12);
    eyeWhite.parent = parent;
    eyeWhite.isPickable = false;

    const whiteMat = new StandardMaterial(`eyeWhiteMat${side}`, this.scene);
    whiteMat.diffuseColor = new Color3(1, 1, 1);
    whiteMat.emissiveColor = new Color3(0.2, 0.2, 0.2);
    eyeWhite.material = whiteMat;

    const pupil = MeshBuilder.CreateSphere(`eye${side}Pupil`, {
      diameter: 0.025,
    }, this.scene);
    pupil.position = new Vector3(0, 0, 0.015);
    pupil.parent = eyeWhite;
    pupil.isPickable = false;

    const pupilMat = new StandardMaterial(`pupilMat${side}`, this.scene);
    pupilMat.diffuseColor = new Color3(0.2, 0.4, 0.6);
    pupil.material = pupilMat;

    const iris = MeshBuilder.CreateSphere(`eye${side}Iris`, {
      diameter: 0.012,
    }, this.scene);
    iris.position.z = 0.008;
    iris.parent = pupil;
    iris.isPickable = false;

    const irisMat = new StandardMaterial(`irisMat${side}`, this.scene);
    irisMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
    iris.material = irisMat;
  }

  private createArm(side: 'left' | 'right'): Mesh {
    const xOffset = side === 'left' ? -0.32 : 0.32;

    const upperArm = MeshBuilder.CreateCapsule(`${side}UpperArm`, {
      height: 0.35,
      radius: 0.06,
    }, this.scene);
    upperArm.position = new Vector3(xOffset, 1.2, 0);
    upperArm.parent = this.rootNode;
    upperArm.isPickable = false;

    const armMat = new PBRMaterial(`${side}ArmMat`, this.scene);
    armMat.albedoColor = this.clothColor;
    armMat.metallic = 0.1;
    armMat.roughness = 0.8;
    upperArm.material = armMat;

    const forearm = MeshBuilder.CreateCapsule(`${side}Forearm`, {
      height: 0.3,
      radius: 0.05,
    }, this.scene);
    forearm.position.y = -0.28;
    forearm.parent = upperArm;
    forearm.isPickable = false;

    const forearmMat = new PBRMaterial(`${side}ForearmMat`, this.scene);
    forearmMat.albedoColor = this.skinColor;
    forearmMat.metallic = 0;
    forearmMat.roughness = 0.6;
    forearm.material = forearmMat;

    const hand = MeshBuilder.CreateSphere(`${side}Hand`, {
      diameter: 0.1,
    }, this.scene);
    hand.position.y = -0.18;
    hand.scaling = new Vector3(0.8, 1, 0.6);
    hand.parent = forearm;
    hand.material = forearmMat;
    hand.isPickable = false;

    return upperArm;
  }

  private createLeg(side: 'left' | 'right'): Mesh {
    const xOffset = side === 'left' ? -0.12 : 0.12;

    const upperLeg = MeshBuilder.CreateCapsule(`${side}UpperLeg`, {
      height: 0.45,
      radius: 0.09,
    }, this.scene);
    upperLeg.position = new Vector3(xOffset, 0.6, 0);
    upperLeg.parent = this.rootNode;
    upperLeg.isPickable = false;

    const legMat = new PBRMaterial(`${side}LegMat`, this.scene);
    legMat.albedoColor = this.pantsColor;
    legMat.metallic = 0.1;
    legMat.roughness = 0.8;
    upperLeg.material = legMat;

    const lowerLeg = MeshBuilder.CreateCapsule(`${side}LowerLeg`, {
      height: 0.4,
      radius: 0.07,
    }, this.scene);
    lowerLeg.position.y = -0.38;
    lowerLeg.parent = upperLeg;
    lowerLeg.material = legMat;
    lowerLeg.isPickable = false;

    const foot = MeshBuilder.CreateBox(`${side}Foot`, {
      width: 0.12,
      height: 0.08,
      depth: 0.22,
    }, this.scene);
    foot.position = new Vector3(0, -0.24, 0.04);
    foot.parent = lowerLeg;
    foot.isPickable = false;

    const footMat = new PBRMaterial(`${side}FootMat`, this.scene);
    footMat.albedoColor = this.shoeColor;
    footMat.metallic = 0.2;
    footMat.roughness = 0.6;
    foot.material = footMat;

    return upperLeg;
  }

  private createAccessories(): void {
    const backpack = MeshBuilder.CreateBox('backpack', {
      width: 0.3,
      height: 0.35,
      depth: 0.12,
    }, this.scene);
    backpack.position = new Vector3(0, 1.05, -0.22);
    backpack.parent = this.rootNode;
    backpack.isPickable = false;

    const backpackMat = new PBRMaterial('backpackMat', this.scene);
    backpackMat.albedoColor = new Color3(0.15, 0.15, 0.2);
    backpackMat.metallic = 0.4;
    backpackMat.roughness = 0.5;
    backpack.material = backpackMat;

    const backpackLight = MeshBuilder.CreateBox('backpackLight', {
      width: 0.15,
      height: 0.04,
      depth: 0.01,
    }, this.scene);
    backpackLight.position = new Vector3(0, 0.1, -0.07);
    backpackLight.parent = backpack;
    backpackLight.isPickable = false;

    const lightMat = new StandardMaterial('backpackLightMat', this.scene);
    lightMat.emissiveColor = new Color3(0.3, 0.6, 1);
    backpackLight.material = lightMat;

    const bracelet = MeshBuilder.CreateTorus('bracelet', {
      diameter: 0.1,
      thickness: 0.015,
      tessellation: 16,
    }, this.scene);
    bracelet.position = new Vector3(-0.32, 0.85, 0);
    bracelet.rotation.z = Math.PI / 2;
    bracelet.parent = this.rootNode;
    bracelet.isPickable = false;

    const braceletMat = new StandardMaterial('braceletMat', this.scene);
    braceletMat.emissiveColor = new Color3(0.2, 0.8, 0.5);
    braceletMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
    bracelet.material = braceletMat;
  }

  /**
   * Supprime le modèle fallback
   */
  private disposeFallback(): void {
    // Dispose all children except the model nodes
    const children = this.rootNode.getChildMeshes(false);
    children.forEach((child) => child.dispose());

    const childNodes = this.rootNode.getChildTransformNodes(false);
    childNodes.forEach((child) => {
      if (child.name !== 'characterModel') {
        child.dispose();
      }
    });
  }

  /**
   * Met à jour les animations du personnage
   */
  public update(deltaTime: number, isMoving: boolean, isRunning: boolean = false): void {
    if (this.isModelLoaded) {
      this.updateGLBAnimations(isMoving, isRunning);
    } else {
      this.updateFallbackAnimations(deltaTime, isMoving, isRunning);
    }
  }

  /**
   * Met à jour les animations GLB
   */
  private updateGLBAnimations(isMoving: boolean, isRunning: boolean): void {
    let targetAnim: AnimationGroup | null = null;

    if (isMoving) {
      targetAnim = isRunning
        ? (this.runAnim || this.walkAnim)
        : this.walkAnim;
    } else {
      targetAnim = this.idleAnim;
    }

    if (targetAnim && targetAnim !== this.currentAnim) {
      if (this.currentAnim) {
        this.currentAnim.stop();
      }
      targetAnim.start(true);
      this.currentAnim = targetAnim;
    }
  }

  /**
   * Met à jour les animations fallback (primitives)
   */
  private updateFallbackAnimations(deltaTime: number, isMoving: boolean, isRunning: boolean): void {
    if (isMoving) {
      this.animateWalk(deltaTime, isRunning);
    } else {
      this.animateIdle(deltaTime);
    }
  }

  private animateWalk(deltaTime: number, isRunning: boolean): void {
    const speed = isRunning ? 12 : 8;
    const amplitude = isRunning ? 0.4 : 0.25;

    this.walkCycle += deltaTime * speed;

    const legAngle = Math.sin(this.walkCycle) * amplitude;
    this.leftLeg.rotation.x = legAngle;
    this.rightLeg.rotation.x = -legAngle;

    const armAngle = Math.sin(this.walkCycle) * (amplitude * 0.7);
    this.leftArm.rotation.x = -armAngle;
    this.rightArm.rotation.x = armAngle;

    this.body.position.y = 1.1 + Math.abs(Math.sin(this.walkCycle * 2)) * 0.03;
    this.body.rotation.z = Math.sin(this.walkCycle) * 0.02;
  }

  private animateIdle(deltaTime: number): void {
    this.idleBob += deltaTime * 2;

    const breathe = Math.sin(this.idleBob) * 0.01;
    this.body.scaling.y = 1 + breathe;
    this.body.position.y = 1.1 + breathe * 2;

    this.leftLeg.rotation.x *= 0.9;
    this.rightLeg.rotation.x *= 0.9;
    this.leftArm.rotation.x *= 0.9;
    this.rightArm.rotation.x *= 0.9;

    this.body.rotation.z = Math.sin(this.idleBob * 0.5) * 0.01;
  }

  public setPosition(position: Vector3): void {
    this.rootNode.position = position.clone();
  }

  public getPosition(): Vector3 {
    return this.rootNode.position.clone();
  }

  public setRotation(rotation: number): void {
    this.rootNode.rotation.y = rotation;
  }

  public getRotation(): number {
    return this.rootNode.rotation.y;
  }

  public getRootNode(): TransformNode {
    return this.rootNode;
  }

  public getIsModelLoaded(): boolean {
    return this.isModelLoaded;
  }

  public dispose(): void {
    this.animationGroups.forEach((ag) => ag.dispose());
    this.modelMeshes.forEach((m) => m.dispose());
    this.rootNode.dispose();
  }
}
