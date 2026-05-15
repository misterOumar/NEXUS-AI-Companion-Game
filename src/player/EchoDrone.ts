import {
  Scene,
  Vector3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  Color3,
  GlowLayer,
  PointLight,
  TransformNode,
  ParticleSystem,
  Texture,
  Color4,
  AbstractMesh,
  AnimationGroup,
} from '@babylonjs/core';
import { EchoAI, Advice, AdviceType } from '@/ai/EchoAI';
import { ModelLoader, type LoadedModel } from '@/core/ModelLoader';

/**
 * Représentation visuelle du drone ECHO
 * Charge un modèle GLB ou utilise un fallback de primitives
 */
export class EchoDrone {
  private scene: Scene;
  private echoAI: EchoAI;

  // Structure
  private rootNode: TransformNode;
  private bodyGroup: TransformNode;

  // Fallback meshes
  private innerCore!: Mesh;
  private mainRing!: Mesh;
  private secondaryRing!: Mesh;
  private tertiaryRing!: Mesh;
  private antenna!: Mesh;
  private eyeLens!: Mesh;
  private emitterMesh!: Mesh;
  private isFallbackActive: boolean = true;

  // GLB model
  private modelMeshes: AbstractMesh[] = [];
  private modelAnimations: AnimationGroup[] = [];

  // Effets
  private light: PointLight;
  private glowLayer: GlowLayer;
  private particleSystem: ParticleSystem | null = null;

  // Animation
  private targetPosition: Vector3 = Vector3.Zero();
  private currentVelocity: Vector3 = Vector3.Zero();
  private bobOffset: number = 0;
  private tiltAngle: number = 0;

  // Configuration
  private readonly followDistance: number = 1.8;
  private readonly followHeight: number = 1.3;
  private readonly followSpeed: number = 4;
  private readonly bobSpeed: number = 2;
  private readonly bobAmplitude: number = 0.08;

  // Couleurs
  private baseColor: Color3 = new Color3(0.3, 0.6, 1);
  private accentColor: Color3 = new Color3(0.5, 0.8, 1);
  private coreColor: Color3 = new Color3(0.8, 0.9, 1);

  constructor(scene: Scene, existingGlowLayer?: GlowLayer) {
    this.scene = scene;
    this.echoAI = EchoAI.getInstance();

    this.glowLayer = existingGlowLayer || new GlowLayer('echoGlow', scene);
    this.glowLayer.intensity = 0.8;

    this.rootNode = new TransformNode('echoDrone', scene);
    this.bodyGroup = new TransformNode('echoBody', scene);
    this.bodyGroup.parent = this.rootNode;

    // Crée le fallback immédiatement
    this.createFallbackModel();

    // Effets communs
    this.light = this.createLight();
    this.createParticles();

    // Tente de charger le modèle GLB
    this.loadGLBModel();

    // Écoute les messages d'ECHO
    this.echoAI.onMessage(this.onEchoMessage.bind(this));
  }

  /**
   * Charge le modèle GLB du drone
   */
  private async loadGLBModel(): Promise<void> {
    try {
      console.log('[EchoDrone] Début chargement GLB...');
      const loader = ModelLoader.getInstance();
      const model = await loader.loadModelSafe(
        this.scene,
        '/models/',
        'drone.glb',
        'droneModel'
      );

      if (model) {
        this.applyGLBModel(model);
      } else {
        console.log('[EchoDrone] Modèle non trouvé, fallback conservé');
        this.setupFallbackAnimations();
      }
    } catch (error) {
      console.error('[EchoDrone] Erreur chargement GLB:', error);
      this.setupFallbackAnimations();
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
    console.log(`[EchoDrone] Application du modèle: ${model.meshes.length} meshes`);
    console.log(`[EchoDrone] Meshes: ${model.meshes.map((m) => `${m.name}(vertices:${m.getTotalVertices ? m.getTotalVertices() : '?'})`).join(', ')}`);

    // Calcule la taille AVANT de supprimer le fallback
    const bounds = this.computeMeshBounds(model.meshes);

    if (!bounds) {
      console.warn('[EchoDrone] Aucun mesh avec géométrie trouvé, fallback conservé');
      this.setupFallbackAnimations();
      return;
    }

    const modelHeight = bounds.max.y - bounds.min.y;
    const modelWidth = bounds.max.x - bounds.min.x;
    const modelDepth = bounds.max.z - bounds.min.z;
    const maxDimension = Math.max(modelWidth, modelHeight, modelDepth);

    console.log(`[EchoDrone] Dimensions: ${modelWidth.toFixed(2)} x ${modelHeight.toFixed(2)} x ${modelDepth.toFixed(2)}`);

    // Maintenant qu'on sait que le modèle est valide, on supprime le fallback
    this.disposeFallbackMeshes();

    this.modelMeshes = model.meshes;
    this.modelAnimations = model.animationGroups;

    // Parente le modèle au bodyGroup
    model.rootNode.parent = this.bodyGroup;

    // Auto-scale pour que le drone fasse ~0.4m dans sa plus grande dimension
    const targetSize = 0.4;
    if (maxDimension > 0.001) {
      const scale = targetSize / maxDimension;
      model.rootNode.scaling.setAll(scale);
      const centerY = (bounds.min.y + bounds.max.y) / 2;
      model.rootNode.position.y = -centerY * scale;
      console.log(`[EchoDrone] Auto-scale: ${scale.toFixed(4)} (dim max: ${maxDimension.toFixed(2)})`);
    } else {
      model.rootNode.scaling.setAll(0.3);
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

    // Démarre les animations du modèle
    model.animationGroups.forEach((ag) => ag.start(true));

    this.isFallbackActive = false;
    console.log(`[EchoDrone] Modèle appliqué ! Animations: ${model.animationGroups.map((a) => a.name).join(', ') || 'aucune'}`);
  }

  // ===== FALLBACK PRIMITIVES =====

  private createFallbackModel(): void {
    this.createCoreBody();
    this.innerCore = this.createInnerCore();
    this.createOuterShell();
    this.mainRing = this.createMainRing();
    this.secondaryRing = this.createSecondaryRing();
    this.tertiaryRing = this.createTertiaryRing();
    this.antenna = this.createAntenna();
    this.eyeLens = this.createEyeLens();

    // Mesh invisible pour le particle emitter
    this.emitterMesh = MeshBuilder.CreateBox('echoEmitter', { size: 0.01 }, this.scene);
    this.emitterMesh.parent = this.bodyGroup;
    this.emitterMesh.isVisible = false;
    this.emitterMesh.isPickable = false;
  }

  private disposeFallbackMeshes(): void {
    const meshes = this.bodyGroup.getChildMeshes(false);
    meshes.forEach((mesh) => {
      // Garde le emitterMesh (utilisé par le particle system) et les meshes du modèle GLB
      if (!mesh.name.includes('droneModel') && mesh.name !== 'echoEmitter') {
        mesh.dispose();
      }
    });
  }

  private createCoreBody(): Mesh {
    const body = MeshBuilder.CreateSphere('echoCoreBody', {
      diameter: 0.35,
      segments: 24,
    }, this.scene);
    body.parent = this.bodyGroup;
    body.isPickable = false;

    const material = new PBRMaterial('echoCoreBodyMat', this.scene);
    material.albedoColor = new Color3(0.15, 0.15, 0.2);
    material.metallic = 0.8;
    material.roughness = 0.2;
    material.emissiveColor = this.baseColor.scale(0.1);
    body.material = material;

    return body;
  }

  private createInnerCore(): Mesh {
    const core = MeshBuilder.CreateSphere('echoInnerCore', {
      diameter: 0.18,
      segments: 16,
    }, this.scene);
    core.parent = this.bodyGroup;
    core.isPickable = false;

    const material = new StandardMaterial('echoInnerCoreMat', this.scene);
    material.emissiveColor = this.coreColor;
    material.diffuseColor = this.coreColor;
    material.alpha = 0.9;
    core.material = material;

    this.glowLayer.addIncludedOnlyMesh(core);

    return core;
  }

  private createOuterShell(): Mesh {
    const shell = MeshBuilder.CreateSphere('echoOuterShell', {
      diameter: 0.42,
      segments: 24,
    }, this.scene);
    shell.parent = this.bodyGroup;
    shell.isPickable = false;

    const material = new PBRMaterial('echoOuterShellMat', this.scene);
    material.albedoColor = new Color3(0.6, 0.8, 1);
    material.metallic = 0.1;
    material.roughness = 0.1;
    material.alpha = 0.15;
    material.transparencyMode = 2;
    shell.material = material;

    return shell;
  }

  private createMainRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('echoMainRing', {
      diameter: 0.55,
      thickness: 0.04,
      tessellation: 48,
    }, this.scene);
    ring.parent = this.bodyGroup;
    ring.rotation.x = Math.PI / 2;
    ring.isPickable = false;

    const material = new StandardMaterial('echoMainRingMat', this.scene);
    material.emissiveColor = this.baseColor;
    material.diffuseColor = this.baseColor.scale(0.5);
    ring.material = material;

    this.glowLayer.addIncludedOnlyMesh(ring);

    return ring;
  }

  private createSecondaryRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('echoSecondaryRing', {
      diameter: 0.48,
      thickness: 0.025,
      tessellation: 40,
    }, this.scene);
    ring.parent = this.bodyGroup;
    ring.rotation.x = Math.PI / 2 + 0.4;
    ring.rotation.y = 0.3;
    ring.isPickable = false;

    const material = new StandardMaterial('echoSecondaryRingMat', this.scene);
    material.emissiveColor = this.accentColor.scale(0.7);
    material.diffuseColor = this.accentColor.scale(0.3);
    material.alpha = 0.8;
    ring.material = material;

    this.glowLayer.addIncludedOnlyMesh(ring);

    return ring;
  }

  private createTertiaryRing(): Mesh {
    const ring = MeshBuilder.CreateTorus('echoTertiaryRing', {
      diameter: 0.52,
      thickness: 0.02,
      tessellation: 36,
    }, this.scene);
    ring.parent = this.bodyGroup;
    ring.rotation.x = Math.PI / 2 - 0.5;
    ring.rotation.y = -0.4;
    ring.isPickable = false;

    const material = new StandardMaterial('echoTertiaryRingMat', this.scene);
    material.emissiveColor = this.accentColor.scale(0.5);
    material.diffuseColor = this.accentColor.scale(0.2);
    material.alpha = 0.6;
    ring.material = material;

    this.glowLayer.addIncludedOnlyMesh(ring);

    return ring;
  }

  private createAntenna(): Mesh {
    const antenna = MeshBuilder.CreateCylinder('echoAntenna', {
      height: 0.15,
      diameterTop: 0.01,
      diameterBottom: 0.03,
      tessellation: 8,
    }, this.scene);
    antenna.position.y = 0.22;
    antenna.parent = this.bodyGroup;
    antenna.isPickable = false;

    const material = new PBRMaterial('echoAntennaMat', this.scene);
    material.albedoColor = new Color3(0.2, 0.2, 0.25);
    material.metallic = 0.9;
    material.roughness = 0.3;
    antenna.material = material;

    const tip = MeshBuilder.CreateSphere('echoAntennaTip', {
      diameter: 0.04,
    }, this.scene);
    tip.position.y = 0.08;
    tip.parent = antenna;
    tip.isPickable = false;

    const tipMat = new StandardMaterial('echoAntennaTipMat', this.scene);
    tipMat.emissiveColor = new Color3(1, 0.3, 0.3);
    tip.material = tipMat;

    this.glowLayer.addIncludedOnlyMesh(tip);

    return antenna;
  }

  private createEyeLens(): Mesh {
    const lens = MeshBuilder.CreateSphere('echoEyeLens', {
      diameter: 0.12,
      segments: 16,
    }, this.scene);
    lens.position.z = 0.15;
    lens.scaling = new Vector3(1, 1, 0.5);
    lens.parent = this.bodyGroup;
    lens.isPickable = false;

    const material = new StandardMaterial('echoEyeLensMat', this.scene);
    material.emissiveColor = this.coreColor;
    material.diffuseColor = new Color3(0.9, 0.95, 1);
    material.specularColor = new Color3(1, 1, 1);
    material.specularPower = 64;
    lens.material = material;

    this.glowLayer.addIncludedOnlyMesh(lens);

    return lens;
  }

  // ===== EFFETS COMMUNS =====

  private createLight(): PointLight {
    const light = new PointLight('echoLight', Vector3.Zero(), this.scene);
    light.intensity = 0.8;
    light.diffuse = this.baseColor;
    light.specular = this.accentColor;
    light.range = 8;
    light.parent = this.rootNode;

    return light;
  }

  private createParticles(): void {
    const particleSystem = new ParticleSystem('echoParticles', 50, this.scene);

    particleSystem.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGJSURBVFiF7ZY9SwNBEIafNYUggo2N2PgLbGzsLGwsLfwFgp2FjY2NhY2NjY2NjY2NjRZaWFiIiIiIH4iIqIiIH4iI53Cz7Obubm8vXggOLHu3Mzvv7OzM7kH+ywqQADYBB4EtwGZgE9gMnAYmgF/AHcS5YBeglwIXIQ0cA+ql8vwqA+8DuoFdwHbgGDAINANl4CKwQPQA6K/uAIOAI0Ct0wgMAM+BFZjzgGdAK3AUmAJ+AMViwHOiN0AD0Ai8A/aS+wA+4jxUJ88C54GlVGYWC6RKPwS4AFSLAQ8QvcEioB7IAw7hAmCgAl8FlgBFIoAPQFdVYDfQAjQBw6IAoEqcABJABdCXfQr9wJhcL1IFDlXhq4Dl2VbhvkAfUAfsADqBDqAOWOu4swjYTJwCDgDzpJ4Ky/NN4AbRE0wQLQLhvhJyG9GrbQY6gNXACqLNRDdVxB7gJLAL+Au8Al4Cy4B5ok/YgWg38AL4lu0b/qdUJA5RBJSAI0A58A3IA+aI3mY+4B6iBdADXM72pL8AhbGLCxYw6AQAAAAASUVORK5CYII=', this.scene);

    particleSystem.emitter = this.emitterMesh;
    particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
    particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);

    particleSystem.color1 = new Color4(0.3, 0.6, 1, 0.8);
    particleSystem.color2 = new Color4(0.5, 0.8, 1, 0.6);
    particleSystem.colorDead = new Color4(0.2, 0.4, 0.8, 0);

    particleSystem.minSize = 0.02;
    particleSystem.maxSize = 0.05;

    particleSystem.minLifeTime = 0.5;
    particleSystem.maxLifeTime = 1.5;

    particleSystem.emitRate = 15;

    particleSystem.gravity = new Vector3(0, 0.5, 0);

    particleSystem.direction1 = new Vector3(-0.5, 1, -0.5);
    particleSystem.direction2 = new Vector3(0.5, 1, 0.5);

    particleSystem.minAngularSpeed = 0;
    particleSystem.maxAngularSpeed = Math.PI;

    particleSystem.minEmitPower = 0.1;
    particleSystem.maxEmitPower = 0.3;

    particleSystem.updateSpeed = 0.01;

    particleSystem.start();

    this.particleSystem = particleSystem;
  }

  private setupFallbackAnimations(): void {
    this.scene.registerBeforeRender(() => {
      if (!this.isFallbackActive) return;
      const time = performance.now() / 1000;

      this.mainRing.rotation.z = time * 0.5;
      this.secondaryRing.rotation.z = -time * 0.8;
      this.tertiaryRing.rotation.z = time * 0.3;

      const pulse = 1 + Math.sin(time * 3) * 0.1;
      this.innerCore.scaling.setAll(pulse);

      this.antenna.rotation.z = Math.sin(time * 2) * 0.1;
    });
  }

  // ===== MESSAGES =====

  private onEchoMessage(advice: Advice): void {
    let color: Color3;
    let intensity: number;

    switch (advice.type) {
      case AdviceType.ENCOURAGEMENT:
        color = new Color3(0.2, 1, 0.4);
        intensity = 2;
        break;
      case AdviceType.WARNING:
        color = new Color3(1, 0.5, 0.1);
        intensity = 2.5;
        break;
      case AdviceType.TIP:
        color = new Color3(0.3, 0.8, 1);
        intensity = 1.5;
        break;
      case AdviceType.CHALLENGE:
        color = new Color3(0.8, 0.3, 1);
        intensity = 2;
        break;
      default:
        color = this.baseColor;
        intensity = 1;
    }

    this.pulse(color, intensity);
  }

  private pulse(color: Color3, intensity: number): void {
    if (this.isFallbackActive) {
      const innerMat = this.innerCore.material as StandardMaterial;
      const mainRingMat = this.mainRing.material as StandardMaterial;
      const eyeMat = this.eyeLens.material as StandardMaterial;

      innerMat.emissiveColor = color;
      mainRingMat.emissiveColor = color;
      eyeMat.emissiveColor = color;
    }

    this.light.diffuse = color;
    this.light.intensity = intensity;
    this.glowLayer.intensity = intensity;

    if (this.particleSystem) {
      this.particleSystem.color1 = new Color4(color.r, color.g, color.b, 0.8);
      this.particleSystem.color2 = new Color4(color.r * 0.7, color.g * 0.7, color.b * 0.7, 0.6);
    }

    setTimeout(() => {
      if (this.isFallbackActive) {
        const innerMat = this.innerCore.material as StandardMaterial;
        const mainRingMat = this.mainRing.material as StandardMaterial;
        const eyeMat = this.eyeLens.material as StandardMaterial;

        innerMat.emissiveColor = this.coreColor;
        mainRingMat.emissiveColor = this.baseColor;
        eyeMat.emissiveColor = this.coreColor;
      }

      this.light.diffuse = this.baseColor;
      this.light.intensity = 0.8;
      this.glowLayer.intensity = 0.8;

      if (this.particleSystem) {
        this.particleSystem.color1 = new Color4(0.3, 0.6, 1, 0.8);
        this.particleSystem.color2 = new Color4(0.5, 0.8, 1, 0.6);
      }
    }, 1500);
  }

  // ===== UPDATE =====

  public update(deltaTime: number, playerPosition: Vector3, playerRotation: number): void {
    // Position cible (à côté et légèrement devant le joueur)
    const offsetAngle = playerRotation - Math.PI / 3;
    const offset = new Vector3(
      Math.sin(offsetAngle) * this.followDistance,
      this.followHeight,
      Math.cos(offsetAngle) * this.followDistance
    );

    this.targetPosition = playerPosition.add(offset);

    // Mouvement fluide avec inertie
    const direction = this.targetPosition.subtract(this.rootNode.position);
    const distance = direction.length();

    if (distance > 0.01) {
      const acceleration = direction.normalize().scale(this.followSpeed * deltaTime);
      this.currentVelocity.addInPlace(acceleration);

      this.currentVelocity.scaleInPlace(0.92);

      const maxSpeed = this.followSpeed * 0.5;
      if (this.currentVelocity.length() > maxSpeed) {
        this.currentVelocity.normalize().scaleInPlace(maxSpeed);
      }

      this.rootNode.position.addInPlace(this.currentVelocity);
    }

    // Animation de flottement
    this.bobOffset += deltaTime * this.bobSpeed;
    const bobY = Math.sin(this.bobOffset) * this.bobAmplitude;
    const bobX = Math.cos(this.bobOffset * 0.7) * this.bobAmplitude * 0.5;
    this.bodyGroup.position.y = bobY;
    this.bodyGroup.position.x = bobX;

    // Inclinaison basée sur la vitesse
    const targetTilt = -this.currentVelocity.z * 0.3;
    this.tiltAngle += (targetTilt - this.tiltAngle) * 0.1;
    this.bodyGroup.rotation.x = this.tiltAngle;

    // Rotation pour regarder vers le joueur
    const lookDir = playerPosition.subtract(this.rootNode.position);
    lookDir.y = 0;
    if (lookDir.length() > 0.01) {
      const targetAngle = Math.atan2(lookDir.x, lookDir.z);
      let currentAngle = this.rootNode.rotation.y;

      let diff = targetAngle - currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      this.rootNode.rotation.y += diff * 0.1;
    }
  }

  public setPosition(position: Vector3): void {
    this.rootNode.position = position.clone();
    this.targetPosition = position.clone();
    this.currentVelocity = Vector3.Zero();
  }

  public getPosition(): Vector3 {
    return this.rootNode.position.clone();
  }

  public getGlowLayer(): GlowLayer {
    return this.glowLayer;
  }

  public dispose(): void {
    if (this.particleSystem) {
      this.particleSystem.dispose();
    }
    this.modelAnimations.forEach((ag) => ag.dispose());
    this.modelMeshes.forEach((m) => m.dispose());
    this.light.dispose();
    this.rootNode.dispose();
  }
}
