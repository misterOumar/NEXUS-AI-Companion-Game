import {
  Scene,
  SceneLoader,
  AbstractMesh,
  AnimationGroup,
  TransformNode,
  Skeleton,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * Résultat du chargement d'un modèle
 */
export interface LoadedModel {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  skeletons: Skeleton[];
  rootNode: TransformNode;
}

/**
 * Cache de modèles déjà chargés
 */
interface ModelCacheEntry {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  skeletons: Skeleton[];
}

/**
 * Chargeur de modèles 3D (GLB/GLTF)
 * Gère le chargement, le cache et les fallbacks
 */
export class ModelLoader {
  private static instance: ModelLoader | null = null;
  private cache: Map<string, ModelCacheEntry> = new Map();
  private loadingPromises: Map<string, Promise<LoadedModel>> = new Map();

  private constructor() {}

  public static getInstance(): ModelLoader {
    if (!ModelLoader.instance) {
      ModelLoader.instance = new ModelLoader();
    }
    return ModelLoader.instance;
  }

  /**
   * Charge un modèle GLB/GLTF
   * @param scene Scène Babylon.js
   * @param rootUrl Dossier contenant le fichier (ex: "/models/")
   * @param fileName Nom du fichier (ex: "character.glb")
   * @param nodeName Nom du noeud racine créé
   */
  public async loadModel(
    scene: Scene,
    rootUrl: string,
    fileName: string,
    nodeName: string
  ): Promise<LoadedModel> {
    const key = `${rootUrl}${fileName}`;

    // Vérifie si un chargement est déjà en cours
    const existing = this.loadingPromises.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.doLoadModel(scene, rootUrl, fileName, nodeName);
    this.loadingPromises.set(key, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  private async doLoadModel(
    scene: Scene,
    rootUrl: string,
    fileName: string,
    nodeName: string
  ): Promise<LoadedModel> {
    const result = await SceneLoader.ImportMeshAsync(
      '',
      rootUrl,
      fileName,
      scene
    );

    // Crée un noeud racine pour regrouper tous les meshes
    const rootNode = new TransformNode(nodeName, scene);

    result.meshes.forEach((mesh) => {
      if (!mesh.parent) {
        mesh.parent = rootNode;
      }
    });

    return {
      meshes: result.meshes,
      animationGroups: result.animationGroups,
      skeletons: result.skeletons,
      rootNode,
    };
  }

  /**
   * Vérifie si un fichier modèle existe (tentative de fetch HEAD)
   */
  public async modelExists(rootUrl: string, fileName: string): Promise<boolean> {
    try {
      const response = await fetch(`${rootUrl}${fileName}`, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Charge un modèle avec fallback si le fichier n'existe pas
   * @returns Le modèle chargé ou null si indisponible
   */
  public async loadModelSafe(
    scene: Scene,
    rootUrl: string,
    fileName: string,
    nodeName: string
  ): Promise<LoadedModel | null> {
    try {
      const exists = await this.modelExists(rootUrl, fileName);
      if (!exists) {
        console.warn(`Modèle introuvable: ${rootUrl}${fileName}, utilisation du fallback`);
        return null;
      }
      return await this.loadModel(scene, rootUrl, fileName, nodeName);
    } catch (error) {
      console.warn(`Erreur chargement modèle ${fileName}:`, error);
      return null;
    }
  }

  /**
   * Trouve un animation group par nom (recherche partielle)
   */
  public findAnimation(
    animationGroups: AnimationGroup[],
    name: string
  ): AnimationGroup | undefined {
    const lower = name.toLowerCase();
    return animationGroups.find(
      (ag) => ag.name.toLowerCase().includes(lower)
    );
  }

  /**
   * Libère les ressources
   */
  public dispose(): void {
    this.cache.clear();
    this.loadingPromises.clear();
    ModelLoader.instance = null;
  }
}
