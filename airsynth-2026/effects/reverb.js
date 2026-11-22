/**
 * Dual-Hand Air Synth Demo — Effect Stage 5: FDN Diffusion Reverb
 */
(function (root) {
  'use strict';

  const IMPULSE_CACHE = new Map();

  class ReverbEffect {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.id = 'reverb';
      this.ctx = audioCtx;

      this.inputNode = this.ctx.createGain();
      this.outputNode = this.ctx.createGain();
      this.convolverNode = this.ctx.createConvolver();
      this.convolverNode.normalize = false;
      this.reverbDryGain = this.ctx.createGain();
      this.reverbWetGain = this.ctx.createGain();

      this._lastDuration = null;
      this._lastDecay = null;

      this.updateImpulse(2.5, 2.0);

      this.inputNode.connect(this.reverbDryGain);
      this.inputNode.connect(this.convolverNode);
      this.convolverNode.connect(this.reverbWetGain);
      this.reverbDryGain.connect(this.outputNode);
      this.reverbWetGain.connect(this.outputNode);
    }

    updateImpulse(duration = 2.5, decay = 2.0, force = false) {
      if (!force && this._lastDuration === duration && this._lastDecay === decay && this.convolverNode.buffer) {
        return;
      }
      this._lastDuration = duration;
      this._lastDecay = decay;

      const sampleRate = this.ctx.sampleRate;
      const cacheKey = `${sampleRate}|${duration.toFixed(2)}|${decay.toFixed(2)}`;
      if (!force && IMPULSE_CACHE.has(cacheKey)) {
        this.convolverNode.buffer = IMPULSE_CACHE.get(cacheKey);
        return;
      }

      const length = Math.max(1, Math.floor(sampleRate * duration));
      const impulse = this.ctx.createBuffer(2, length, sampleRate);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);

      const invLen = 1.0 / length;
      const isQuad = Math.abs(decay - 2.0) < 1e-4;
      const expectedEnergy = length / (3.0 * (2.0 * decay + 1.0));
      const normScale = 0.55 / Math.sqrt(Math.max(1.0, expectedEnergy));
      let s1 = 13579, s2 = 24681;

      for (let i = 0; i < length; i++) {
        const rem = 1.0 - i * invLen;
        const factor = (isQuad ? rem * rem : Math.pow(rem, decay)) * normScale;
        s1 = (s1 * 16807) % 2147483647;
        s2 = (s2 * 48271) % 2147483647;
        left[i] = ((s1 / 1073741823.5) - 1.0) * factor;
        right[i] = ((s2 / 1073741823.5) - 1.0) * factor;
      }

      if (IMPULSE_CACHE.size >= 24) {
        IMPULSE_CACHE.delete(IMPULSE_CACHE.keys().next().value);
      }
      IMPULSE_CACHE.set(cacheKey, impulse);
      this.convolverNode.buffer = impulse;
    }

    setMix(reverbMix = 0.30, bypassed = false) {
      const now = this.ctx.currentTime;
      const rMix = !bypassed ? (reverbMix !== undefined ? reverbMix : 0.30) : 0.0;
      this.reverbWetGain.gain.setTargetAtTime(rMix, now, 0.01);
      this.reverbDryGain.gain.setTargetAtTime(1.0 - rMix * 0.4, now, 0.01);
    }
  }

  root.ReverbEffect = ReverbEffect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ReverbEffect };
  }
})(typeof window !== 'undefined' ? window : globalThis);
