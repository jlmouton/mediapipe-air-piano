/**
 * Dual-Hand Air Synth Demo — Studio Audio FX Pipeline Coordinator
 *
 * Composes the 6 modular effect stages (Filter, Wavefolder, Chorus, Ping-Pong Delay,
 * FDN Reverb, Brickwall Limiter) onto the shared AudioBus. Both Left-Hand Fractal
 * Synth and Right-Hand Bowed Violin Synth push their audio into this pipeline.
 */
(function (root) {
  'use strict';

  class AudioFXEngine {
    /**
     * @param {AudioContext} audioCtx
     * @param {AudioBus} [audioBus]
     */
    constructor(audioCtx, audioBus) {
      this.ctx = audioCtx;
      this.audioBus = audioBus || (root.AudioBus ? new root.AudioBus(audioCtx) : null);

      this.filterStage = new root.FilterEffect(audioCtx);
      this.wavefolderStage = new root.WavefolderEffect(audioCtx);
      this.chorusStage = new root.ChorusEffect(audioCtx);
      this.delayStage = new root.PingPongDelayEffect(audioCtx);
      this.reverbStage = new root.ReverbEffect(audioCtx);
      this.limiterStage = new root.LimiterEffect(audioCtx);

      this.filterNode = this.filterStage.filterNode;
      this.wavefolderNode = this.wavefolderStage.wavefolderNode;
      this.driveDryGain = this.wavefolderStage.driveDryGain;
      this.driveWetGain = this.wavefolderStage.driveWetGain;
      this.driveInput = this.wavefolderStage.inputNode;
      this.driveOutput = this.wavefolderStage.outputNode;

      this.chorusInput = this.chorusStage.inputNode;
      this.chorusOutput = this.chorusStage.outputNode;
      this.chorusDelayL = this.chorusStage.chorusDelayL;
      this.chorusDelayR = this.chorusStage.chorusDelayR;
      this.chorusLfoL = this.chorusStage.chorusLfoL;
      this.chorusLfoR = this.chorusStage.chorusLfoR;
      this.chorusDepthL = this.chorusStage.chorusDepthL;
      this.chorusDepthR = this.chorusStage.chorusDepthR;
      this.chorusDryGain = this.chorusStage.chorusDryGain;
      this.chorusWetGain = this.chorusStage.chorusWetGain;

      this.delayInput = this.delayStage.inputNode;
      this.delayOutput = this.delayStage.outputNode;
      this.delayNodeL = this.delayStage.delayNodeL;
      this.delayNodeR = this.delayStage.delayNodeR;
      this.delayFeedbackL = this.delayStage.delayFeedbackL;
      this.delayFeedbackR = this.delayStage.delayFeedbackR;
      this.delayMerger = this.delayStage.delayMerger;
      this.delayDryGain = this.delayStage.delayDryGain;
      this.delayWetGain = this.delayStage.delayWetGain;

      this.reverbInput = this.reverbStage.inputNode;
      this.reverbOutput = this.reverbStage.outputNode;
      this.convolverNode = this.reverbStage.convolverNode;
      this.reverbDryGain = this.reverbStage.reverbDryGain;
      this.reverbWetGain = this.reverbStage.reverbWetGain;

      this.limiterNode = this.limiterStage.limiterNode;

      if (this.audioBus) {
        this.masterGain = this.audioBus.masterGain;
        this.analyserNode = this.audioBus.analyserNode;
      } else {
        this.masterGain = this.ctx.createGain();
        this.analyserNode = this.ctx.createAnalyser();
        this.analyserNode.fftSize = 2048;
        this.analyserNode.smoothingTimeConstant = 0.85;
        this.masterGain.connect(this.analyserNode);
        this.analyserNode.connect(this.ctx.destination);
      }

      this.fxBypass = {
        master: false,
        filter: false,
        drive: false,
        chorus: false,
        delay: false,
        reverb: false
      };

      this.initPipeline();
    }

    initPipeline() {
      const stages = [
        this.filterStage,
        this.wavefolderStage,
        this.chorusStage,
        this.delayStage,
        this.reverbStage,
        this.limiterStage
      ];

      if (this.audioBus) {
        this.audioBus.setStages(stages);
      } else {
        for (let i = 0; i < stages.length - 1; i++) {
          stages[i].outputNode.connect(stages[i + 1].inputNode);
        }
        stages[stages.length - 1].outputNode.connect(this.masterGain);
      }

      this.setFXGains({
        driveAmount: 0.0,
        chorusMix: 0.25,
        delayMix: 0.20,
        reverbMix: 0.30
      });
    }

    updateWavefolderCurve(amount) {
      this.wavefolderStage.updateCurve(amount);
    }

    updateReverbImpulse(duration = 2.5, decay = 2.0) {
      this.reverbStage.updateImpulse(duration, decay);
    }

    setFXGains(fxParams = {}) {
      const isMasterBypassed = this.fxBypass.master;
      this.wavefolderStage.setMix(fxParams.driveAmount, isMasterBypassed || this.fxBypass.drive);
      this.chorusStage.setMix(fxParams.chorusMix, isMasterBypassed || this.fxBypass.chorus);
      this.delayStage.setMix(fxParams.delayMix, isMasterBypassed || this.fxBypass.delay);
      this.reverbStage.setMix(fxParams.reverbMix, isMasterBypassed || this.fxBypass.reverb);
    }

    setMasterFXBypass(bypassed, fxParams, synthParams) {
      this.fxBypass.master = bypassed;
      this.setFXGains(fxParams || {});
      this.filterStage.updateParams(synthParams || {}, bypassed);
    }

    updateParams(fxParams, synthParams) {
      if (!this.ctx) return;
      if (synthParams && !this.fxBypass.master) {
        this.filterStage.updateParams(synthParams, false);
      }
      if (fxParams) {
        if (fxParams.driveAmount !== undefined) {
          this.updateWavefolderCurve(fxParams.driveAmount);
        }
        this.delayStage.updateParams(fxParams);
        if (fxParams.reverbSize !== undefined) {
          this.updateReverbImpulse(fxParams.reverbSize, 2.0);
        }
        this.setFXGains(fxParams);
      }
    }
  }

  root.AudioFXEngine = AudioFXEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioFXEngine };
  }
})(typeof window !== 'undefined' ? window : globalThis);
