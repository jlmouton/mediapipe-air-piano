/**
 * Dual-Hand Air Synth Demo — Effect Stage 3: Stereo Vector Chorus
 */
(function (root) {
  'use strict';

  class ChorusEffect {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.id = 'chorus';
      this.ctx = audioCtx;

      this.inputNode = this.ctx.createGain();
      this.outputNode = this.ctx.createGain();
      this.chorusDelayL = this.ctx.createDelay();
      this.chorusDelayR = this.ctx.createDelay();
      this.chorusLfoL = this.ctx.createOscillator();
      this.chorusLfoR = this.ctx.createOscillator();
      this.chorusDepthL = this.ctx.createGain();
      this.chorusDepthR = this.ctx.createGain();
      this.chorusDryGain = this.ctx.createGain();
      this.chorusWetGain = this.ctx.createGain();

      this.chorusDelayL.delayTime.value = 0.025;
      this.chorusDelayR.delayTime.value = 0.030;
      this.chorusLfoL.frequency.value = 1.5;
      this.chorusLfoR.frequency.value = 1.65;
      this.chorusDepthL.gain.value = 0.002;
      this.chorusDepthR.gain.value = 0.002;

      this.chorusLfoL.connect(this.chorusDepthL);
      this.chorusLfoR.connect(this.chorusDepthR);
      this.chorusDepthL.connect(this.chorusDelayL.delayTime);
      this.chorusDepthR.connect(this.chorusDelayR.delayTime);

      this.chorusLfoL.start();
      this.chorusLfoR.start();

      this.inputNode.connect(this.chorusDryGain);
      this.inputNode.connect(this.chorusDelayL);
      this.inputNode.connect(this.chorusDelayR);
      this.chorusDelayL.connect(this.chorusWetGain);
      this.chorusDelayR.connect(this.chorusWetGain);
      this.chorusDryGain.connect(this.outputNode);
      this.chorusWetGain.connect(this.outputNode);
    }

    setMix(chorusMix = 0.25, bypassed = false) {
      const now = this.ctx.currentTime;
      const cMix = !bypassed ? (chorusMix !== undefined ? chorusMix : 0.25) : 0.0;
      this.chorusWetGain.gain.setTargetAtTime(cMix, now, 0.01);
      this.chorusDryGain.gain.setTargetAtTime(1.0 - cMix * 0.5, now, 0.01);
    }
  }

  root.ChorusEffect = ChorusEffect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ChorusEffect };
  }
})(typeof window !== 'undefined' ? window : globalThis);
