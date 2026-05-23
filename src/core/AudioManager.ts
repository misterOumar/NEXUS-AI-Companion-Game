/**
 * AudioManager — Moteur audio 100% procédural (Web Audio API)
 *
 * Aucun fichier audio externe nécessaire.
 * Tous les sons sont générés en temps réel : oscillateurs, bruit blanc, reverb.
 *
 * Pattern Singleton — initialiser au premier geste utilisateur pour
 * respecter l'autoplay policy des navigateurs.
 */
export class AudioManager {
  private static instance: AudioManager | null = null;

  private ctx:        AudioContext | null = null;
  private master:     GainNode    | null = null;
  private droneOsc:   OscillatorNode  | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain:  GainNode    | null = null;
  private ambienceRunning = false;

  // Maze-specific
  private mazeAmbiOsc:   OscillatorNode | null = null;
  private mazeAmbiGain:  GainNode       | null = null;
  private mazeAmbiRunning = false;
  private alertOsc:   OscillatorNode | null = null;
  private alertGain:  GainNode       | null = null;

  private constructor() {}

  static getInstance(): AudioManager {
    if (!AudioManager.instance) AudioManager.instance = new AudioManager();
    return AudioManager.instance;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  dispose(): void {
    this.stopAmbience();
    this.stopMazeAmbience();
    this.setDroneAlertLevel(0);
    if (this.alertOsc) { try { this.alertOsc.stop(); } catch { /* already stopped */ } this.alertOsc = null; this.alertGain = null; }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    AudioManager.instance = null;
  }

  // ─── Sounds événementiels ────────────────────────────────────────────────

  /** Impact au hit : bruit blanc bref + envelope */
  playHit(): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;

    const len    = Math.floor(ctx.sampleRate * 0.09);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    }

    const src    = ctx.createBufferSource();
    src.buffer   = buffer;

    const filt   = ctx.createBiquadFilter();
    filt.type    = 'bandpass';
    filt.frequency.value = 350;
    filt.Q.value = 0.7;

    const gain   = ctx.createGain();
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    src.connect(filt); filt.connect(gain); gain.connect(this.getMaster());
    src.start(t); src.stop(t + 0.2);
  }

  /** Near-miss : sweep fréquentiel doppler */
  playNearMiss(): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;

    const osc  = ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.18);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain); gain.connect(this.getMaster());
    osc.start(t); osc.stop(t + 0.2);
  }

  /** Transition de phase : impact grave + longue réverb */
  playPhaseTransition(): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;

    const osc  = ctx.createOscillator();
    osc.type   = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.6);

    const reverb = this.buildReverb(2.0, 0.35);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);

    osc.connect(gain); gain.connect(reverb); reverb.connect(this.getMaster());
    osc.start(t); osc.stop(t + 0.9);
  }

  /** Début de round : accord dramatique selon le numéro de round */
  playRoundStart(round: number): void {
    const ctx  = this.getCtx();
    const t    = ctx.currentTime;
    // Round 1 = La mineur, Round 2 = Mi mineur, Round 3 = dissonant
    const roots = [220, 165, 185];
    const base  = roots[Math.min(round - 1, 2)];

    // Root + quinte + octave, entrées décalées
    [base, base * 1.498, base * 2].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'triangle';
      osc.frequency.value = freq;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.06 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 1.8);

      osc.connect(g); g.connect(this.getMaster());
      osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 1.8);
    });
  }

  /** Victoire : arpège ascendant C majeur */
  playVictory(): void {
    const ctx  = this.getCtx();
    const t    = ctx.currentTime;
    [261, 329, 392, 523, 659].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.13);
      g.gain.linearRampToValueAtTime(0.28, t + i * 0.13 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 1.2);
      osc.connect(g); g.connect(this.getMaster());
      osc.start(t + i * 0.13); osc.stop(t + i * 0.13 + 1.2);
    });
  }

  /** Défaite : arpège descendant avec distorsion douce */
  playDefeat(): void {
    const ctx  = this.getCtx();
    const t    = ctx.currentTime;
    [392, 311, 261, 196, 164].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.16);
      g.gain.linearRampToValueAtTime(0.2, t + i * 0.16 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.16 + 1.4);
      osc.connect(g); g.connect(this.getMaster());
      osc.start(t + i * 0.16); osc.stop(t + i * 0.16 + 1.4);
    });
  }

  // ─── Ambiance dynamique ──────────────────────────────────────────────────

  /** Lance le drone d'ambiance du duel (montée progressive 2s) */
  startAmbience(): void {
    if (this.ambienceRunning) return;

    const ctx = this.getCtx();
    const t   = ctx.currentTime;

    const osc    = ctx.createOscillator();
    osc.type     = 'sawtooth';
    osc.frequency.value = 55;

    const filter  = ctx.createBiquadFilter();
    filter.type   = 'lowpass';
    filter.frequency.value = 180;
    filter.Q.value = 1.2;

    const gain   = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 2.0);

    osc.connect(filter); filter.connect(gain); gain.connect(this.getMaster());
    osc.start();

    this.droneOsc    = osc;
    this.droneFilter = filter;
    this.droneGain   = gain;
    this.ambienceRunning = true;
  }

  /** Coupe l'ambiance (fondu 600ms) */
  stopAmbience(): void {
    if (!this.droneGain || !this.droneOsc) return;
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    this.droneGain.gain.linearRampToValueAtTime(0, t + 0.6);
    const osc = this.droneOsc;
    setTimeout(() => {
      try { osc.stop(); } catch { /* déjà arrêté */ }
    }, 700);
    this.droneOsc    = null;
    this.droneGain   = null;
    this.droneFilter = null;
    this.ambienceRunning = false;
  }

  /**
   * Modifie la tension (0 = calme, 1 = max).
   * Ouvre le filtre et monte le volume progressivement.
   * À appeler chaque seconde dans updateDuel().
   */
  setTension(level: number): void {
    if (!this.droneFilter || !this.droneGain) return;
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    this.droneFilter.frequency.linearRampToValueAtTime(180 + level * 700, t + 1.5);
    this.droneGain.gain.linearRampToValueAtTime(0.09 + level * 0.16, t + 1.5);
  }

  // ─── Maze audio ─────────────────────────────────────────────────────────

  /** Ambiance labyrinthe : bourdon électronique grave + modulation lente */
  startMazeAmbience(): void {
    if (this.mazeAmbiRunning) return;
    const ctx = this.getCtx();
    const t   = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type  = 'sawtooth';
    osc.frequency.value = 42;

    // LFO lent pour pulsation organique
    const lfo     = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value  = 4;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = 140;
    filter.Q.value = 2.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.055, t + 3.5);

    osc.connect(filter); filter.connect(gain); gain.connect(this.getMaster());
    osc.start(); lfo.start();

    this.mazeAmbiOsc  = osc;
    this.mazeAmbiGain = gain;
    this.mazeAmbiRunning = true;
  }

  stopMazeAmbience(): void {
    if (!this.mazeAmbiGain || !this.mazeAmbiOsc) return;
    const ctx = this.getCtx();
    this.mazeAmbiGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    const osc = this.mazeAmbiOsc;
    setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 900);
    this.mazeAmbiOsc = null; this.mazeAmbiGain = null;
    this.mazeAmbiRunning = false;
  }

  /** Pas sur sol métallique */
  playFootstep(isRunning: boolean): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.055);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5);

    const src  = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type  = 'bandpass';
    filt.frequency.value = isRunning ? 520 : 340;
    filt.Q.value = 1.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(isRunning ? 0.22 : 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(filt); filt.connect(g); g.connect(this.getMaster());
    src.start(t); src.stop(t + 0.1);
  }

  /** Collecte d'un nœud : arpège synth ascendant */
  playNodeCollect(): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.14, t + i * 0.07 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.38);
      osc.connect(g); g.connect(this.getMaster());
      osc.start(t + i * 0.07); osc.stop(t + i * 0.07 + 0.4);
    });
  }

  /** Ouverture de mur par l'IA : grondement grave + crissement */
  playWallOpen(): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.65);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    osc.connect(filt); filt.connect(g); g.connect(this.getMaster());
    osc.start(t); osc.stop(t + 0.75);
  }

  /** Alerte drone — level 0-1, 0 = silence, 1 = danger imminent */
  setDroneAlertLevel(level: number): void {
    if (level <= 0.01) {
      if (this.alertGain) {
        const ctx = this.getCtx();
        this.alertGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      }
      return;
    }
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    if (!this.alertOsc) {
      const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 80;
      const g   = ctx.createGain(); g.gain.value = 0;
      osc.connect(g); g.connect(this.getMaster()); osc.start();
      this.alertOsc = osc; this.alertGain = g;
    }
    this.alertOsc.frequency.linearRampToValueAtTime(60 + level * 90, t + 0.25);
    this.alertGain!.gain.linearRampToValueAtTime(level * 0.07, t + 0.25);
  }

  /** Capture par le drone : impact grave + stridence */
  playCapture(): void {
    const ctx = this.getCtx();
    const t   = ctx.currentTime;
    const low = ctx.createOscillator(); low.type = 'sine';
    low.frequency.setValueAtTime(55, t); low.frequency.exponentialRampToValueAtTime(18, t + 0.55);
    const g1 = ctx.createGain(); g1.gain.setValueAtTime(0.85, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    low.connect(g1); g1.connect(this.getMaster()); low.start(t); low.stop(t + 0.6);

    const hi = ctx.createOscillator(); hi.type = 'sawtooth';
    hi.frequency.setValueAtTime(1400, t); hi.frequency.exponentialRampToValueAtTime(220, t + 0.4);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.22, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    hi.connect(g2); g2.connect(this.getMaster()); hi.start(t); hi.stop(t + 0.45);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.75;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private getMaster(): GainNode {
    this.getCtx();
    return this.master!;
  }

  /** Crée un ConvolverNode de réverb simulée par bruit exponentiel */
  private buildReverb(duration = 1.5, decay = 0.4): ConvolverNode {
    const ctx        = this.getCtx();
    const sampleRate = ctx.sampleRate;
    const length     = Math.floor(sampleRate * duration);
    const buffer     = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    const conv  = ctx.createConvolver();
    conv.buffer = buffer;
    return conv;
  }
}
