/**
 * Dual-Hand Air Synth Demo — Effect Stage 4: Ping-Pong Stereo Delay
 */
(function (root) {
  'use strict';

  class PingPongDelayEffect {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.id = 'delay';
      this.ctx = audioCtx;

      this.inputNode = this.ctx.createGain();
      this.outputNode = this.ctx.createGain();
      this.delayNodeL = this.ctx.createDelay(2.0);
      this.delayNodeR = this.ctx.createDelay(2.0);
      this.delayFeedbackL = this.ctx.createGain();
      this.delayFeedbackR = this.ctx.createGain();
      this.delayMerger = this.ctx.createChannelMerger(2);
      this.delayDryGain = this.ctx.createGain();
      this.delayWetGain = this.ctx.createGain();

      this.delayNodeL.delayTime.value = 0.35;
      this.delayNodeR.delayTime.value = 0.525;
      this.delayFeedbackL.gain.value = 0.4;
      this.delayFeedbackR.gain.value = 0.4;

      this.inputNode.connect(this.delayDryGain);
      this.inputNode.connect(this.delayNodeL);
      this.delayNodeL.connect(this.delayFeedbackL);
      this.delayFeedbackL.connect(this.delayNodeR);
      this.delayNodeR.connect(this.delayFeedbackR);
      this.delayFeedbackR.connect(this.delayNodeL);

      this.delayNodeL.connect(this.delayMerger, 0, 0);
      this.delayNodeR.connect(this.delayMerger, 0, 1);
      this.delayMerger.connect(this.delayWetGain);
      this.delayDryGain.connect(this.outputNode);
      this.delayWetGain.connect(this.outputNode);
    }

    updateParams(fxParams = {}) {
      const now = this.ctx.currentTime;
      if (fxParams.delayTime !== undefined) {
        this.delayNodeL.delayTime.setTargetAtTime(fxParams.delayTime / 1000.0, now, 0.01);
        this.delayNodeR.delayTime.setTargetAtTime((fxParams.delayTime * 1.5) / 1000.0, now, 0.01);
      }
      if (fxParams.delayFeedback !== undefined) {
        this.delayFeedbackL.gain.setTargetAtTime(fxParams.delayFeedback, now, 0.01);
        this.delayFeedbackR.gain.setTargetAtTime(fxParams.delayFeedback, now, 0.01);
      }
    }

    setMix(delayMix = 0.20, bypassed = false) {
      const now = this.ctx.currentTime;
      const dMix = !bypassed ? (delayMix !== undefined ? delayMix : 0.20) : 0.0;
      this.delayWetGain.gain.setTargetAtTime(dMix, now, 0.01);
      this.delayDryGain.gain.setTargetAtTime(1.0, now, 0.01);
    }
  }

  root.PingPongDelayEffect = PingPongDelayEffect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PingPongDelayEffect };
  }
})(typeof window !== 'undefined' ? window : globalThis);
