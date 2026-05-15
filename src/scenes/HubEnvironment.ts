import {
  Scene,
  Vector3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Color4,
  GlowLayer,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  Texture,
  ParticleSystem,
  TransformNode,
} from '@babylonjs/core';

/**
 * Crée l'environnement complet du Hub
 * Inclut le sol, les bâtiments, les décorations et l'éclairage
 */
export class HubEnvironment {
  private scene: Scene;
  private glowLayer: GlowLayer;
  private shadowGenerator: ShadowGenerator | null = null;

  // Collections de meshes
  private groundMeshes: Mesh[] = [];
  private buildingMeshes: Mesh[] = [];
  private decorationMeshes: Mesh[] = [];
  private lightMeshes: Mesh[] = [];

  constructor(scene: Scene, glowLayer: GlowLayer) {
    this.scene = scene;
    this.glowLayer = glowLayer;
  }

  /**
   * Crée tout l'environnement
   */
  public create(): void {
    this.createLighting();
    this.createGround();
    this.createCentralPlatform();
    this.createBuildings();
    this.createTrees();
    this.createLampPosts();
    this.createFloatingPlatforms();
    this.createAmbientParticles();
    this.createBoundaryWalls();
  }

  /**
   * Configure l'éclairage de la scène
   */
  private createLighting(): void {
    // Lumière ambiante
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.4;
    ambient.diffuse = new Color3(0.6, 0.7, 0.9);
    ambient.groundColor = new Color3(0.1, 0.1, 0.2);

    // Soleil/lune
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), this.scene);
    sun.intensity = 0.6;
    sun.diffuse = new Color3(0.9, 0.85, 1);
    sun.position = new Vector3(30, 50, 30);

    // Générateur d'ombres
    this.shadowGenerator = new ShadowGenerator(1024, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurScale = 2;
    this.shadowGenerator.setDarkness(0.3);
  }

  /**
   * Crée le sol principal
   */
  private createGround(): void {
    // Sol principal
    const ground = MeshBuilder.CreateGround('mainGround', {
      width: 100,
      height: 100,
      subdivisions: 50,
    }, this.scene);
    ground.receiveShadows = true;
    ground.checkCollisions = true;

    const groundMat = new PBRMaterial('groundMat', this.scene);
    groundMat.albedoColor = new Color3(0.06, 0.06, 0.1);
    groundMat.metallic = 0.3;
    groundMat.roughness = 0.85;
    ground.material = groundMat;

    this.groundMeshes.push(ground);

    // Grille lumineuse au sol
    this.createGridLines(100, 4);
  }

  /**
   * Crée les lignes de grille au sol
   */
  private createGridLines(size: number, spacing: number): void {
    const gridMat = new StandardMaterial('gridMat', this.scene);
    gridMat.emissiveColor = new Color3(0.1, 0.15, 0.3);
    gridMat.alpha = 0.6;

    for (let i = -size / 2; i <= size / 2; i += spacing) {
      // Lignes X
      const lineX = MeshBuilder.CreateBox(`gridX${i}`, {
        width: size,
        height: 0.02,
        depth: 0.06,
      }, this.scene);
      lineX.position = new Vector3(0, 0.01, i);
      lineX.material = gridMat;
      this.decorationMeshes.push(lineX);

      // Lignes Z
      const lineZ = MeshBuilder.CreateBox(`gridZ${i}`, {
        width: 0.06,
        height: 0.02,
        depth: size,
      }, this.scene);
      lineZ.position = new Vector3(i, 0.01, 0);
      lineZ.material = gridMat;
      this.decorationMeshes.push(lineZ);
    }
  }

  /**
   * Crée la plateforme centrale
   */
  private createCentralPlatform(): void {
    // Plateforme principale
    const platform = MeshBuilder.CreateCylinder('centralPlatform', {
      diameter: 12,
      height: 0.5,
      tessellation: 48,
    }, this.scene);
    platform.position.y = 0.25;
    platform.receiveShadows = true;
    platform.checkCollisions = true;

    const platformMat = new PBRMaterial('platformMat', this.scene);
    platformMat.albedoColor = new Color3(0.12, 0.12, 0.18);
    platformMat.metallic = 0.6;
    platformMat.roughness = 0.3;
    platform.material = platformMat;

    this.groundMeshes.push(platform);

    // Anneau lumineux autour de la plateforme
    const ring = MeshBuilder.CreateTorus('platformRing', {
      diameter: 12.5,
      thickness: 0.15,
      tessellation: 64,
    }, this.scene);
    ring.position.y = 0.5;

    const ringMat = new StandardMaterial('platformRingMat', this.scene);
    ringMat.emissiveColor = new Color3(0.3, 0.5, 1);
    ring.material = ringMat;

    this.glowLayer.addIncludedOnlyMesh(ring);
    this.decorationMeshes.push(ring);

    // Cercles concentriques
    for (let i = 1; i <= 3; i++) {
      const innerRing = MeshBuilder.CreateTorus(`innerRing${i}`, {
        diameter: 3 * i,
        thickness: 0.08,
        tessellation: 32,
      }, this.scene);
      innerRing.position.y = 0.52;

      const innerMat = new StandardMaterial(`innerRingMat${i}`, this.scene);
      innerMat.emissiveColor = new Color3(0.2, 0.3, 0.6).scale(1 - i * 0.2);
      innerMat.alpha = 0.7;
      innerRing.material = innerMat;

      this.glowLayer.addIncludedOnlyMesh(innerRing);
      this.decorationMeshes.push(innerRing);
    }

    // Hologramme central (NEXUS logo simplifié)
    this.createCentralHologram();
  }

  /**
   * Crée l'hologramme central
   */
  private createCentralHologram(): void {
    const holoGroup = new TransformNode('hologram', this.scene);
    holoGroup.position.y = 2;

    // Cube rotatif
    const cube = MeshBuilder.CreateBox('holoCube', { size: 0.8 }, this.scene);
    cube.parent = holoGroup;
    cube.rotation.x = Math.PI / 4;
    cube.rotation.z = Math.PI / 4;

    const cubeMat = new StandardMaterial('holoCubeMat', this.scene);
    cubeMat.emissiveColor = new Color3(0.4, 0.6, 1);
    cubeMat.alpha = 0.6;
    cubeMat.wireframe = true;
    cube.material = cubeMat;

    this.glowLayer.addIncludedOnlyMesh(cube);

    // Animation de rotation
    this.scene.registerBeforeRender(() => {
      cube.rotation.y += 0.01;
    });

    // Sphère interne
    const sphere = MeshBuilder.CreateSphere('holoSphere', {
      diameter: 0.4,
      segments: 16,
    }, this.scene);
    sphere.parent = holoGroup;

    const sphereMat = new StandardMaterial('holoSphereMat', this.scene);
    sphereMat.emissiveColor = new Color3(0.6, 0.8, 1);
    sphere.material = sphereMat;

    this.glowLayer.addIncludedOnlyMesh(sphere);
  }

  /**
   * Crée les bâtiments futuristes
   */
  private createBuildings(): void {
    const buildingPositions = [
      { pos: new Vector3(-25, 0, -25), height: 15, width: 8 },
      { pos: new Vector3(25, 0, -25), height: 20, width: 6 },
      { pos: new Vector3(-25, 0, 25), height: 12, width: 7 },
      { pos: new Vector3(25, 0, 25), height: 18, width: 5 },
      { pos: new Vector3(-35, 0, 0), height: 25, width: 8 },
      { pos: new Vector3(35, 0, 0), height: 22, width: 7 },
      { pos: new Vector3(0, 0, -35), height: 16, width: 9 },
      { pos: new Vector3(0, 0, 35), height: 14, width: 6 },
    ];

    buildingPositions.forEach((config, index) => {
      this.createBuilding(config.pos, config.height, config.width, index);
    });
  }

  /**
   * Crée un bâtiment individuel
   */
  private createBuilding(position: Vector3, height: number, width: number, index: number): void {
    const group = new TransformNode(`building${index}`, this.scene);
    group.position = position;

    // Corps principal
    const body = MeshBuilder.CreateBox(`buildingBody${index}`, {
      width: width,
      height: height,
      depth: width,
    }, this.scene);
    body.position.y = height / 2;
    body.parent = group;
    body.receiveShadows = true;
    body.checkCollisions = true;

    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(body);
    }

    const bodyMat = new PBRMaterial(`buildingMat${index}`, this.scene);
    bodyMat.albedoColor = new Color3(0.08, 0.08, 0.12);
    bodyMat.metallic = 0.7;
    bodyMat.roughness = 0.4;
    body.material = bodyMat;

    this.buildingMeshes.push(body);

    // Fenêtres lumineuses
    const windowRows = Math.floor(height / 2);
    const windowCols = Math.floor(width / 1.5);

    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        if (Math.random() > 0.3) { // 70% de fenêtres allumées
          const window = MeshBuilder.CreateBox(`window${index}_${row}_${col}`, {
            width: 0.8,
            height: 1,
            depth: 0.1,
          }, this.scene);

          const offsetX = (col - windowCols / 2 + 0.5) * 1.5;
          const offsetY = row * 2 + 1.5;

          window.position = new Vector3(offsetX, offsetY, width / 2 + 0.05);
          window.parent = group;

          const windowMat = new StandardMaterial(`windowMat${index}_${row}_${col}`, this.scene);
          const brightness = 0.3 + Math.random() * 0.4;
          windowMat.emissiveColor = new Color3(
            brightness * 0.9,
            brightness * 0.8,
            brightness
          );
          window.material = windowMat;

          this.glowLayer.addIncludedOnlyMesh(window);
        }
      }
    }

    // Antenne sur le toit
    if (height > 15) {
      const antenna = MeshBuilder.CreateCylinder(`antenna${index}`, {
        height: 3,
        diameter: 0.2,
      }, this.scene);
      antenna.position.y = height + 1.5;
      antenna.parent = group;

      const antennaMat = new PBRMaterial(`antennaMat${index}`, this.scene);
      antennaMat.albedoColor = new Color3(0.2, 0.2, 0.25);
      antennaMat.metallic = 0.9;
      antenna.material = antennaMat;

      // Lumière clignotante
      const light = MeshBuilder.CreateSphere(`antennaLight${index}`, {
        diameter: 0.3,
      }, this.scene);
      light.position.y = height + 3.2;
      light.parent = group;

      const lightMat = new StandardMaterial(`antennaLightMat${index}`, this.scene);
      lightMat.emissiveColor = new Color3(1, 0.2, 0.2);
      light.material = lightMat;

      this.glowLayer.addIncludedOnlyMesh(light);
    }
  }

  /**
   * Crée des arbres stylisés (low-poly/futuristes)
   */
  private createTrees(): void {
    const treePositions = [
      new Vector3(-15, 0, -8),
      new Vector3(15, 0, -8),
      new Vector3(-15, 0, 8),
      new Vector3(15, 0, 8),
      new Vector3(-8, 0, -15),
      new Vector3(8, 0, -15),
      new Vector3(-8, 0, 15),
      new Vector3(8, 0, 15),
    ];

    treePositions.forEach((pos, index) => {
      this.createTree(pos, index);
    });
  }

  /**
   * Crée un arbre stylisé
   */
  private createTree(position: Vector3, index: number): void {
    const group = new TransformNode(`tree${index}`, this.scene);
    group.position = position;

    // Tronc
    const trunk = MeshBuilder.CreateCylinder(`trunk${index}`, {
      height: 1.5,
      diameterTop: 0.15,
      diameterBottom: 0.25,
      tessellation: 6,
    }, this.scene);
    trunk.position.y = 0.75;
    trunk.parent = group;
    trunk.checkCollisions = true;

    const trunkMat = new PBRMaterial(`trunkMat${index}`, this.scene);
    trunkMat.albedoColor = new Color3(0.15, 0.1, 0.08);
    trunkMat.metallic = 0.1;
    trunkMat.roughness = 0.9;
    trunk.material = trunkMat;

    // Feuillage (formes géométriques empilées)
    const colors = [
      new Color3(0.1, 0.4, 0.3),
      new Color3(0.15, 0.5, 0.35),
      new Color3(0.2, 0.6, 0.4),
    ];

    for (let i = 0; i < 3; i++) {
      const foliage = MeshBuilder.CreateCylinder(`foliage${index}_${i}`, {
        height: 0.8 - i * 0.15,
        diameterTop: 0.1,
        diameterBottom: 1.2 - i * 0.3,
        tessellation: 6,
      }, this.scene);
      foliage.position.y = 1.8 + i * 0.6;
      foliage.parent = group;

      const foliageMat = new PBRMaterial(`foliageMat${index}_${i}`, this.scene);
      foliageMat.albedoColor = colors[i];
      foliageMat.metallic = 0.1;
      foliageMat.roughness = 0.8;
      foliage.material = foliageMat;
    }

    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(trunk);
    }
  }

  /**
   * Crée les lampadaires
   */
  private createLampPosts(): void {
    const lampPositions = [
      new Vector3(-10, 0, 0),
      new Vector3(10, 0, 0),
      new Vector3(0, 0, -10),
      new Vector3(0, 0, 10),
      new Vector3(-7, 0, -7),
      new Vector3(7, 0, -7),
      new Vector3(-7, 0, 7),
      new Vector3(7, 0, 7),
    ];

    lampPositions.forEach((pos, index) => {
      this.createLampPost(pos, index);
    });
  }

  /**
   * Crée un lampadaire
   */
  private createLampPost(position: Vector3, index: number): void {
    const group = new TransformNode(`lamp${index}`, this.scene);
    group.position = position;

    // Poteau
    const pole = MeshBuilder.CreateCylinder(`pole${index}`, {
      height: 4,
      diameter: 0.12,
      tessellation: 8,
    }, this.scene);
    pole.position.y = 2;
    pole.parent = group;
    pole.checkCollisions = true;

    const poleMat = new PBRMaterial(`poleMat${index}`, this.scene);
    poleMat.albedoColor = new Color3(0.15, 0.15, 0.2);
    poleMat.metallic = 0.8;
    poleMat.roughness = 0.3;
    pole.material = poleMat;

    // Tête de lampe
    const head = MeshBuilder.CreateSphere(`lampHead${index}`, {
      diameter: 0.5,
      segments: 16,
    }, this.scene);
    head.position.y = 4.2;
    head.scaling = new Vector3(1, 0.6, 1);
    head.parent = group;

    const headMat = new StandardMaterial(`lampHeadMat${index}`, this.scene);
    headMat.emissiveColor = new Color3(0.9, 0.85, 0.7);
    headMat.diffuseColor = new Color3(1, 0.95, 0.9);
    head.material = headMat;

    this.glowLayer.addIncludedOnlyMesh(head);

    // Pas de PointLight individuelle (le GlowLayer suffit pour l'effet visuel)
    // Trop de lumières dynamiques causent des erreurs de compilation shader WebGL

    this.lightMeshes.push(head);
  }

  /**
   * Crée des plateformes flottantes
   */
  private createFloatingPlatforms(): void {
    const platformConfigs = [
      { pos: new Vector3(-20, 5, -20), size: 3 },
      { pos: new Vector3(20, 7, -18), size: 2.5 },
      { pos: new Vector3(-18, 4, 20), size: 2 },
      { pos: new Vector3(22, 6, 22), size: 3.5 },
    ];

    platformConfigs.forEach((config, index) => {
      this.createFloatingPlatform(config.pos, config.size, index);
    });
  }

  /**
   * Crée une plateforme flottante
   */
  private createFloatingPlatform(position: Vector3, size: number, index: number): void {
    const platform = MeshBuilder.CreateCylinder(`floatingPlatform${index}`, {
      diameter: size,
      height: 0.3,
      tessellation: 32,
    }, this.scene);
    platform.position = position;

    const mat = new PBRMaterial(`floatingPlatformMat${index}`, this.scene);
    mat.albedoColor = new Color3(0.1, 0.1, 0.15);
    mat.metallic = 0.5;
    mat.roughness = 0.4;
    platform.material = mat;

    // Anneau lumineux
    const ring = MeshBuilder.CreateTorus(`floatingRing${index}`, {
      diameter: size + 0.2,
      thickness: 0.08,
      tessellation: 32,
    }, this.scene);
    ring.position = position.clone();
    ring.position.y -= 0.1;

    const ringMat = new StandardMaterial(`floatingRingMat${index}`, this.scene);
    ringMat.emissiveColor = new Color3(0.3, 0.5, 0.8);
    ring.material = ringMat;

    this.glowLayer.addIncludedOnlyMesh(ring);

    // Animation de flottement
    const originalY = position.y;
    const offset = Math.random() * Math.PI * 2;
    this.scene.registerBeforeRender(() => {
      const time = performance.now() / 1000;
      platform.position.y = originalY + Math.sin(time + offset) * 0.2;
      ring.position.y = platform.position.y - 0.1;
    });

    this.decorationMeshes.push(platform);
  }

  /**
   * Crée des particules ambiantes
   */
  private createAmbientParticles(): void {
    const particleSystem = new ParticleSystem('ambientParticles', 200, this.scene);

    // Texture simple
    particleSystem.particleTexture = new Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGJSURBVFiF7ZY9SwNBEIafNYUggo2N2PgLbGzsLGwsLfwFgp2FjY2NhY2NjY2NjY2NjRZaWFiIiIiIH4iIqIiIH4iI53Cz7Obubm8vXggOLHu3Mzvv7OzM7kH+ywqQADYBB4EtwGZgE9gMnAYmgF/AHcS5YBeglwIXIQ0cA+ql8vwqA+8DuoFdwHbgGDAINANl4CKwQPQA6K/uAIOAI0Ct0wgMAM+BFZjzgGdAK3AUmAJ+AMViwHOiN0AD0Ai8A/aS+wA+4jxUJ88C54GlVGYWC6RKPwS4AFSLAQ8QvcEioB7IAw7hAmCgAl8FlgBFIoAPQFdVYDfQAjQBw6IAoEqcABJABdCXfQr9wJhcL1IFDlXhq4Dl2VbhvkAfUAfsADqBDqAOWOu4swjYTJwCDgDzpJ4Ky/NN4AbRE0wQLQLhvhJyG9GrbQY6gNXACqLNRDdVxB7gJLAL+Au8Al4Cy4B5ok/YgWg38AL4lu0b/qdUJA5RBJSAI0A58A3IA+aI3mY+4B6iBdADXM72pL8AhbGLCxYw6AQAAAAASUVORK5CYII=', this.scene);

    particleSystem.emitter = new Vector3(0, 10, 0);
    particleSystem.minEmitBox = new Vector3(-40, 0, -40);
    particleSystem.maxEmitBox = new Vector3(40, 0, 40);

    particleSystem.color1 = new Color4(0.4, 0.6, 1, 0.3);
    particleSystem.color2 = new Color4(0.6, 0.8, 1, 0.2);
    particleSystem.colorDead = new Color4(0.2, 0.4, 0.8, 0);

    particleSystem.minSize = 0.02;
    particleSystem.maxSize = 0.08;

    particleSystem.minLifeTime = 3;
    particleSystem.maxLifeTime = 6;

    particleSystem.emitRate = 30;

    particleSystem.gravity = new Vector3(0, -0.05, 0);

    particleSystem.direction1 = new Vector3(-0.2, -0.5, -0.2);
    particleSystem.direction2 = new Vector3(0.2, -0.5, 0.2);

    particleSystem.minEmitPower = 0.1;
    particleSystem.maxEmitPower = 0.3;

    particleSystem.start();
  }

  /**
   * Crée les murs de limite
   */
  private createBoundaryWalls(): void {
    const wallMat = new PBRMaterial('boundaryWallMat', this.scene);
    wallMat.albedoColor = new Color3(0.05, 0.05, 0.08);
    wallMat.metallic = 0.3;
    wallMat.roughness = 0.7;
    wallMat.alpha = 0.3;

    const size = 100;
    const height = 15;
    const positions = [
      { pos: new Vector3(0, height / 2, -size / 2), rot: 0 },
      { pos: new Vector3(0, height / 2, size / 2), rot: 0 },
      { pos: new Vector3(-size / 2, height / 2, 0), rot: Math.PI / 2 },
      { pos: new Vector3(size / 2, height / 2, 0), rot: Math.PI / 2 },
    ];

    positions.forEach((config, index) => {
      const wall = MeshBuilder.CreateBox(`boundaryWall${index}`, {
        width: size,
        height: height,
        depth: 0.5,
      }, this.scene);
      wall.position = config.pos;
      wall.rotation.y = config.rot;
      wall.material = wallMat;
      wall.isPickable = false;
      wall.checkCollisions = true;
    });
  }

  /**
   * Retourne le générateur d'ombres
   */
  public getShadowGenerator(): ShadowGenerator | null {
    return this.shadowGenerator;
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    [...this.groundMeshes, ...this.buildingMeshes, ...this.decorationMeshes, ...this.lightMeshes]
      .forEach(mesh => mesh.dispose());
  }
}
