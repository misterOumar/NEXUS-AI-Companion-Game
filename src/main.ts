/**
 * NEXUS - AI Companion Game
 * Point d'entrée principal de l'application
 *
 * Games On Web 2026 - IA Edition
 * Université de Rennes 1 - MIAGE
 */

import { Engine } from '@/core/Engine';
import { SceneManager } from '@/core/SceneManager';
import { HubScene } from '@/scenes/HubScene';
import { MirrorDuelScene } from '@/scenes/MirrorDuelScene';

// Import des loaders Babylon.js
import '@babylonjs/loaders/glTF';

/**
 * Initialise et lance le jeu
 */
async function initGame(): Promise<void> {
  console.log('🎮 NEXUS - AI Companion Game');
  console.log('🏆 Games On Web 2026 - IA Edition');
  console.log('🎓 Université de Rennes 1 - MIAGE');
  console.log('');

  try {
    // Initialise le moteur
    const engine = Engine.initialize({
      canvasId: 'renderCanvas',
      antialias: true,
      adaptToDeviceRatio: true,
    });

    console.log('✅ Moteur initialisé');

    // Initialise le gestionnaire de scènes
    const sceneManager = SceneManager.getInstance();

    // Enregistre les scènes
    sceneManager.registerScene('HubScene', HubScene);
    sceneManager.registerScene('MirrorDuelScene', MirrorDuelScene);
    // sceneManager.registerScene('NeuroMazeScene', NeuroMazeScene);
    // sceneManager.registerScene('MindRushScene', MindRushScene);

    console.log('✅ Scènes enregistrées');

    // Charge la scène du Hub
    await sceneManager.loadScene('HubScene');

    console.log('✅ HubScene chargée');

    // Connecte la boucle de mise à jour
    engine.onUpdate((deltaTime) => {
      sceneManager.update(deltaTime);
    });

    // Démarre la boucle de rendu
    engine.start();

    console.log('✅ Jeu lancé !');
    console.log('');
    console.log('🎮 Contrôles:');
    console.log('   WASD - Se déplacer');
    console.log('   Souris - Regarder');
    console.log('   Espace - Sauter');
    console.log('   E - Interagir');
    console.log('   Clic - Verrouiller la souris');

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    showErrorScreen(error as Error);
  }
}

/**
 * Affiche un écran d'erreur
 */
function showErrorScreen(error: Error): void {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    const status = document.getElementById('loading-status');
    if (status) {
      status.textContent = `Erreur: ${error.message}`;
      status.style.color = '#ff6b6b';
    }

    const bar = document.getElementById('loading-bar');
    if (bar) {
      bar.style.background = '#ff6b6b';
      bar.style.width = '100%';
    }
  }
}

// Lance le jeu au chargement de la page
window.addEventListener('DOMContentLoaded', () => {
  initGame();
});

// Gestion du redimensionnement
window.addEventListener('resize', () => {
  try {
    const engine = Engine.getInstance();
    engine.getBabylonEngine().resize();
  } catch {
    // Engine pas encore initialisé
  }
});

// Empêche le menu contextuel sur le canvas
document.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).id === 'renderCanvas') {
    e.preventDefault();
  }
});
