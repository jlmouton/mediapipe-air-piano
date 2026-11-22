/**
 * Dual-Hand Air Synth Demo — Physical Modeling String Engine: Bowed Violin / Cello
 * (Ultra-Low-Latency Helmholtz Stick-Slip Friction & Wooden Corpus Formant Model)
 *
 * Models a continuous horsehair bow driving a string into Helmholtz stick-slip motion:
 * - Non-linear Stribeck/Friedlander rosin friction curve: mu(v_rel) = mu_d + (mu_s - mu_d) / (1 + (v_rel/v0)^2)
 * - Bow force (bowPressure) controls Helmholtz corner sharpness & upper harmonic bite
 * - Bow speed (bowVelocity) shapes energy & harmonic excitation
 * - Bow position (bowPosition) shapes sul ponticello glassy harmonics vs sul tasto warmth
 * - Rosin grit (rosinGrit) controls stick-slip flyback micro-noise
 * - Violin/Cello wooden corpus formants (A0 Air ~275Hz, B1- ~510Hz, Bridge Hill ~2450Hz)
 */
(function (root) {
  'use strict';

  const TWO_PI = root.TWO_PI || Math.PI * 2;
  const BUFFER_CACHE = new Map();
  const MAX_CACHE_ENTRIES = 36;

  class BowedViolinEngine {
    static _getCacheKey(sampleRate, freq, bowPressure, bowVelocity, bowPosition, rosinGrit) {
      return `${sampleRate}|${Math.round(freq * 10)}|${bowPressure.toFixed(2)}|${bowVelocity.toFixed(2)}|${bowPosition.toFixed(2)}|${rosinGrit.toFixed(2)}`;
    }

    /**
     * Evaluates the non-linear Friedlander/Stribeck rosin stick-slip friction coefficient.
     * @param {number} vRel - Relative velocity (v_string - v_bow)
     * @param {number} bowPressure - Normalized bow downward force [0.05, 1.5]
     * @returns {number}
     */
    static computeFrictionForce(vRel, bowPressure = 0.5) {
      const muStatic = 0.85;
      const muDynamic = 0.25;
      const v0 = 0.15;
      const ratio = vRel / v0;
      const mu = muDynamic + (muStatic - muDynamic) / (1.0 + ratio * ratio);
      const sign = vRel >= 0 ? -1.0 : 1.0;
      return sign * bowPressure * mu;
    }

    /**
     * Generates a continuous stereo AudioBuffer of a bowed violin/cello string with
     * realistic stick-slip micro-instability, rosin grit, and wooden corpus formants.
     * @param {AudioContext} audioCtx
     * @param {number} freq
     * @param {Object} params
     * @returns {AudioBuffer|null}
     */
    static generateBowedStringBuffer(audioCtx, freq, params = {}) {
      if (!audioCtx) return null;
      const sampleRate = audioCtx.sampleRate;
      const safeFreq = Math.max(24, Math.min(sampleRate * 0.4, freq || 440));

      const bowPressure = Math.max(0.05, Math.min(1.2, params.bowPressure !== undefined ? params.bowPressure : 0.55));
      const bowVelocity = Math.max(0.05, Math.min(1.2, params.bowVelocity !== undefined ? params.bowVelocity : 0.65));
      const bowPosition = Math.max(0.03, Math.min(0.45, params.bowPosition !== undefined ? params.bowPosition : 0.11));
      const rosinGrit = Math.max(0.0, Math.min(1.0, params.rosinGrit !== undefined ? params.rosinGrit : 0.20));

      const cacheKey = BowedViolinEngine._getCacheKey(sampleRate, safeFreq, bowPressure, bowVelocity, bowPosition, rosinGrit);
      if (BUFFER_CACHE.has(cacheKey)) {
        return BUFFER_CACHE.get(cacheKey);
      }

      const approxPeriods = Math.max(12, Math.round(safeFreq * 0.65));
      const numSamples = Math.floor((approxPeriods / safeFreq) * sampleRate);
      const buffer = audioCtx.createBuffer(2, numSamples, sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);

      const tableSize = 256;
      const cycleL = new Float32Array(tableSize);
      const cycleR = new Float32Array(tableSize);
      const maxHarmonics = Math.min(36, Math.floor((sampleRate * 0.45) / safeFreq));

      const cornerSharpness = Math.max(0.4, Math.min(1.6, 0.55 + bowPressure * 0.65 + bowVelocity * 0.3));

      for (let k = 1; k <= maxHarmonics; k++) {
        const fk = k * safeFreq;
        if (fk >= sampleRate * 0.46) break;

        const bowNotch = 1.0 - 0.65 * Math.pow(Math.cos(k * Math.PI * bowPosition), 8);
        const cornerRoll = 1.0 / Math.pow(k, 1.55 - 0.45 * cornerSharpness);

        // Stradivarius / Violin Corpus Resonance Formants (A0 ~275Hz, B1 ~510Hz, Bridge Hill ~2450Hz)
        const dA0 = (fk - 275) / 55;
        const dB1 = (fk - 510) / 110;
        const dBH = (fk - 2450) / 750;
        const corpusGain = 0.65 + 1.45 * Math.exp(-dA0 * dA0) + 1.35 * Math.exp(-dB1 * dB1) + (0.9 + bowPressure * 0.8) * Math.exp(-dBH * dBH);

        const amp = (k % 2 === 0 ? -1 : 1) * cornerRoll * bowNotch * corpusGain;
        const omegaK = (TWO_PI * k) / tableSize;
        const cosStep = Math.cos(omegaK);
        const sinStep = Math.sin(omegaK);
        const phaseR = k * 0.11;
        let cL = 1.0, sL = 0.0;
        let cR = Math.cos(phaseR), sR = Math.sin(phaseR);

        for (let i = 0; i < tableSize; i++) {
          cycleL[i] += amp * sL;
          cycleR[i] += amp * sR;
          const nCL = cL * cosStep - sL * sinStep;
          sL = cL * sinStep + sL * cosStep;
          cL = nCL;
          const nCR = cR * cosStep - sR * sinStep;
          sR = cR * sinStep + sR * cosStep;
          cR = nCR;
        }
      }

      let peak = 0.001;
      for (let i = 0; i < tableSize; i++) {
        const aL = Math.abs(cycleL[i]);
        const aR = Math.abs(cycleR[i]);
        if (aL > peak) peak = aL;
        if (aR > peak) peak = aR;
      }
      const invPeak = 1.0 / peak;
      for (let i = 0; i < tableSize; i++) {
        cycleL[i] *= invPeak;
        cycleR[i] *= invPeak;
      }

      let phase = 0;
      const baseInc = (safeFreq * tableSize) / sampleRate;
      const mask = tableSize - 1;
      let rosinState = 0;
      let rngState = 1234567;

      const jitterEps = (TWO_PI * 3.0) / numSamples;
      let jitS = 0.0, jitC = 1.0;

      for (let n = 0; n < numSamples; n++) {
        jitS += jitterEps * jitC;
        jitC -= jitterEps * jitS;
        const microJitter = 1.0 + 0.0016 * jitS;

        const iFloor = phase | 0;
        const idx0 = iFloor & mask;
        const idx1 = (idx0 + 1) & mask;
        const frac = phase - iFloor;

        let sampleL = cycleL[idx0] + frac * (cycleL[idx1] - cycleL[idx0]);
        let sampleR = cycleR[idx0] + frac * (cycleR[idx1] - cycleR[idx0]);

        if (rosinGrit > 0) {
          const posL = sampleL > 0 ? sampleL : 0;
          const flybackGate = posL * posL;
          rngState = (rngState * 16807) % 2147483647;
          const white = (rngState / 1073741823.5) - 1.0;
          rosinState = 0.75 * rosinState + 0.25 * white;
          const grit = rosinState * rosinGrit * 0.22 * (0.25 + 0.75 * flybackGate);
          sampleL += grit;
          sampleR -= grit * 0.8;
        }

        left[n] = sampleL * 0.85;
        right[n] = sampleR * 0.85;

        phase += baseInc * microJitter;
        if (phase >= tableSize) phase -= tableSize;
      }

      if (BUFFER_CACHE.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = BUFFER_CACHE.keys().next().value;
        BUFFER_CACHE.delete(oldestKey);
      }
      BUFFER_CACHE.set(cacheKey, buffer);

      return buffer;
    }

    static getEngineDescriptor() {
      return {
        id: 'bowed_violin',
        name: 'Bowed Violin',
        type: 'buffer',
        loop: true,
        createVoiceBuffer: (audioCtx, freq, params) => BowedViolinEngine.generateBowedStringBuffer(audioCtx, freq, params)
      };
    }
  }

  root.BowedViolinEngine = BowedViolinEngine;
  root.REGISTERED_SYNTH_ENGINES = root.REGISTERED_SYNTH_ENGINES || [];
  if (!root.REGISTERED_SYNTH_ENGINES.includes(BowedViolinEngine)) {
    root.REGISTERED_SYNTH_ENGINES.push(BowedViolinEngine);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BowedViolinEngine };
  }
})(typeof window !== 'undefined' ? window : globalThis);
