/**
 * Dual-Hand Air Synth Demo — Effect Stage 1: Multi-Mode 24dB Filter
 */
(function (root) {
  'use strict';

  class FilterEffect {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.id = 'filter';
      this.ctx = audioCtx;
      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.value = 4500;
      this.filterNode.Q.value = 1.2;

      this.inputNode = this.filterNode;
      this.outputNode = this.filterNode;
    }

    updateParams(synthParams = {}, bypassed = false) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      if (bypassed) {
        this.filterNode.frequency.setTargetAtTime(20000, now, 0.01);
        this.filterNode.Q.setTargetAtTime(0.707, now, 0.01);
        return;
      }
      if (synthParams.cutoff !== undefined) {
        this.filterNode.frequency.setTargetAtTime(synthParams.cutoff, now, 0.01);
      }
      if (synthParams.resonance !== undefined) {
        this.filterNode.Q.setTargetAtTime(synthParams.resonance, now, 0.01);
      }
      if (synthParams.filterType) {
        this.filterNode.type = synthParams.filterType;
      }
    }
  }

  root.FilterEffect = FilterEffect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FilterEffect };
  }
})(typeof window !== 'undefined' ? window : globalThis);
