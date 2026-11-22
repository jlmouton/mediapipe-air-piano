/**
 * Dual-Hand Air Synth Demo — Fractal Sound Engine: Hyper-Drone (Seahorse Valley Pad)
 *
 * Generates evolving dual-Julia morph wavetables with continuous 60 FPS phase swirl
 * and smooth escape-velocity harmonic profiling for the Left-Hand Monophonic Synth.
 */
(function (root) {
  'use strict';

  const TWO_PI = root.TWO_PI || Math.PI * 2;

  /**
   * "Seahorse Valley Pad" preset configuration from Fractal Sound Engine v2.0,
   * with Swirl LFO set to 0.05 Hz as the default.
   */
  const SEAHORSE_VALLEY_PAD_PRESET = {
    id: 'pad_seahorse_nebula',
    name: '🌌 Seahorse Valley Pad',
    category: 'Pads & Textures',
    description: 'Deep, lush Julia morph pad with continuous 60fps harmonic swirl and stereo diffusion reverb.',
    params: {
      mode: 'drone',
      droneMorph: 0.45,
      droneSwirlRate: 0.05,
      droneSub: 0.70,
      droneSpectral: 12,
      attack: 0.8,
      decay: 1.2,
      sustain: 0.85,
      release: 1.8,
      unisonEnabled: true,
      unisonCount: 5,
      unisonDetune: 20,
      unisonStereo: 90,
      subLevel: 0.5,
      subOctave: 12,
      subWave: 'sine',
      glideTime: 120,
      pitchBendCents: 0
    }
  };

  class HyperDroneEngine {
    /**
     * Computes a morphing dual-Julia PeriodicWave with time-varying phase swirl.
     * @param {AudioContext} audioCtx
     * @param {Object} params
     * @param {number} [timestamp=performance.now()]
     * @returns {PeriodicWave|null}
     */
    static createDroneWave(audioCtx, params = {}, timestamp = (typeof performance !== 'undefined' ? performance.now() : 0)) {
      if (!audioCtx) return null;
      const tableSize = 256;
      const real = new Float32Array(tableSize);
      const imag = new Float32Array(tableSize);

      const morph = params.droneMorph !== undefined ? params.droneMorph : 0.45;
      const swirlRate = params.droneSwirlRate !== undefined
        ? params.droneSwirlRate
        : (params.droneSwirl !== undefined ? params.droneSwirl : 0.05);
      const spectralLayers = Math.max(1, params.droneSpectral || 12);
      const subStrength = params.droneSub !== undefined ? params.droneSub : 0.70;

      // Dual Julia Orbit Anchor Points
      const c1r = -0.75, c1i = 0.1;
      const c2r = -0.4,  c2i = 0.6;
      const cr = c1r + morph * (c2r - c1r);
      const ci = c1i + morph * (c2i - c1i);

      const swirlTime = timestamp / 1000.0;
      const swirlPhase = TWO_PI * swirlRate * swirlTime;

      for (let k = 1; k < tableSize / 2; k++) {
        const basePhase = (TWO_PI * k) / tableSize;
        const angle = basePhase + swirlPhase * (k % 3 === 0 ? -1 : 1);

        let zx = Math.cos(angle);
        let zy = Math.sin(angle);
        let iter = 0;
        const maxIter = 16;

        for (let i = 0; i < maxIter; i++) {
          const x2 = zx * zx - zy * zy + cr;
          const y2 = 2 * zx * zy + ci;
          zx = x2; zy = y2;
          if (zx * zx + zy * zy > 4.0) break;
          iter++;
        }

        const r2 = zx * zx + zy * zy;
        const smoothIter = (iter < maxIter && r2 > 1.0)
          ? iter + 1 - Math.log(Math.log(r2) / 2) / Math.LN2
          : iter;

        let layerAmp = (smoothIter / maxIter) / Math.pow(k, 0.85);

        if (k > spectralLayers * 2) {
          layerAmp *= Math.exp(-0.2 * (k - spectralLayers * 2));
        }
        if (k === 1) {
          layerAmp += subStrength * 0.8;
        } else if (k === 2) {
          layerAmp += subStrength * 0.4;
        }

        real[k] = layerAmp * Math.cos(basePhase);
        imag[k] = layerAmp * Math.sin(basePhase);
      }

      return audioCtx.createPeriodicWave(real, imag);
    }

    static getEngineDescriptor() {
      return {
        id: 'drone',
        name: 'Hyper-Drone (Seahorse Valley Pad)',
        type: 'wavetable',
        createPeriodicWave: (audioCtx, params, timestamp) => HyperDroneEngine.createDroneWave(audioCtx, params, timestamp)
      };
    }
  }

  root.HyperDroneEngine = HyperDroneEngine;
  root.SEAHORSE_VALLEY_PAD_PRESET = SEAHORSE_VALLEY_PAD_PRESET;
  root.FractalWavetableDSP = root.FractalWavetableDSP || {};
  root.FractalWavetableDSP.createDroneWave = HyperDroneEngine.createDroneWave.bind(HyperDroneEngine);

  root.REGISTERED_SYNTH_ENGINES = root.REGISTERED_SYNTH_ENGINES || [];
  if (!root.REGISTERED_SYNTH_ENGINES.includes(HyperDroneEngine)) {
    root.REGISTERED_SYNTH_ENGINES.push(HyperDroneEngine);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HyperDroneEngine, SEAHORSE_VALLEY_PAD_PRESET };
  }
})(typeof window !== 'undefined' ? window : globalThis);
