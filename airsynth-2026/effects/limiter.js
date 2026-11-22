/**
 * Dual-Hand Air Synth Demo — Effect Stage 6: Master Brickwall Limiter
 */
(function (root) {
  'use strict';

  class LimiterEffect {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.id = 'limiter';
      this.ctx = audioCtx;

      this.limiterNode = this.ctx.createDynamicsCompressor();
      this.limiterNode.threshold.value = -1.5;
      this.limiterNode.knee.value = 3.0;
      this.limiterNode.ratio.value = 12.0;
      this.limiterNode.attack.value = 0.003;
      this.limiterNode.release.value = 0.08;

      this.inputNode = this.limiterNode;
      this.outputNode = this.limiterNode;
    }
  }

  root.LimiterEffect = LimiterEffect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LimiterEffect };
  }
})(typeof window !== 'undefined' ? window : globalThis);
