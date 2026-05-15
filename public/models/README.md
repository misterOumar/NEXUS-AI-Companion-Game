# Modeles 3D pour NEXUS

Placez vos modeles GLB dans ce dossier.

## Modeles requis

### Personnage : `character.glb`
Modele anime d'un personnage humanoide avec les animations suivantes :
- **idle** : Animation d'attente
- **walk** : Animation de marche
- **run** : Animation de course
- **jump** : Animation de saut

**Modeles recommandes sur Sketchfab (gratuits, CC license) :**
- Recherchez "animated character low poly" sur https://sketchfab.com
- Filtrez par : Downloadable, Free, Animated
- Format : Telecharger en **glTF / GLB**
- Renommez le fichier en `character.glb`

### Drone : `drone.glb`
Modele d'un petit drone ou robot volant.

**Modeles recommandes sur Sketchfab :**
- Recherchez "sci-fi drone" ou "flying robot" sur https://sketchfab.com
- Filtrez par : Downloadable, Free
- Format : Telecharger en **glTF / GLB**
- Renommez le fichier en `drone.glb`

## Notes
- Si les fichiers GLB ne sont pas presents, le jeu utilise automatiquement des modeles de fallback (primitives 3D).
- Les modeles sont charges de maniere asynchrone. Le fallback est visible pendant le chargement.
- Ajustez l'echelle dans `PlayerCharacter.ts` et `EchoDrone.ts` si necessaire (`model.rootNode.scaling.setAll(X)`).
