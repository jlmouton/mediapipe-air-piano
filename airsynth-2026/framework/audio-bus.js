/**
 * Dual-Hand Air Synth Demo — Framework Audio Bus
 *
 * Manages high-efficiency, zero-copy Web Audio API signal propagation across:
 * 1. Per-Voice Signal Chain (from both Left-Hand Fractal Synth & Right-Hand Bowed Violin Synth):
 *    Sound Engine -> Detune/Unison & Sub-Bass -> ADSR Envelope -> Master Bus Entry
 * 2. Master Effects Pipeline:
 *    Filter -> Wavefolder -> Chorus -> Ping-Pong Delay -> FDN Reverb -> Limiter -> Master Gain -> Analyser -> Destination
 */
(function (root) {
  'use strict';

  class AudioBus {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.ctx = audioCtx;
      this.stages = [];
      this.taps = new Set();

      if (this.ctx) {
        this.masterGain = this.ctx.createGain();
        this.analyserNode = this.ctx.createAnalyser();
        this.analyserNode.fftSize = 2048;
        this.analyserNode.smoothingTimeConstant = 0.85;

        this.masterGain.connect(this.analyserNode);
        this.analyserNode.connect(this.ctx.destination);
      } else {
        this.masterGain = null;
        this.analyserNode = null;
      }
    }

    /**
     * Returns the entry AudioNode where voices from both synthesizers connect into the bus.
     * @returns {AudioNode|null}
     */
    getVoiceEntryNode() {
      if (this.stages.length > 0 && this.stages[0].inputNode) {
        return this.stages[0].inputNode;
      }
      return this.masterGain;
    }

    /**
     * Registers an ordered list of processing stages on the bus and wires their native Web Audio nodes.
     * @param {Array<{id: string, inputNode: AudioNode, outputNode: AudioNode}>} stageList
     */
    setStages(stageList) {
      this.stages = Array.isArray(stageList) ? stageList.filter(s => s && s.inputNode && s.outputNode) : [];
      this.rebuildChain();
    }

    /**
     * Appends a single stage to the master bus pipeline.
     * @param {{id: string, inputNode: AudioNode, outputNode: AudioNode}} stage
     */
    addStage(stage) {
      if (!stage || !stage.inputNode || !stage.outputNode) return;
      this.stages.push(stage);
      this.rebuildChain();
    }

    /**
     * Wires all registered stages in series into masterGain -> analyserNode -> destination.
     */
    rebuildChain() {
      if (!this.ctx || !this.masterGain) return;

      for (let i = 0; i < this.stages.length; i++) {
        const current = this.stages[i];
        try {
          current.outputNode.disconnect();
        } catch (e) {}

        if (i + 1 < this.stages.length) {
          current.outputNode.connect(this.stages[i + 1].inputNode);
        } else {
          current.outputNode.connect(this.masterGain);
        }
      }
    }

    /**
     * Routes a voice through the per-voice modules into the shared Master Audio Bus / FX Pipeline:
     *   [Voice Unison/Sub Merger] -> [Voice ADSR Envelope Gain] -> [Master Bus Entry Node]
     * @param {AudioNode} voiceSourceMerger
     * @param {GainNode} voiceEnvelopeGain
     * @param {AudioNode} [overrideTargetNode]
     */
    routeVoice(voiceSourceMerger, voiceEnvelopeGain, overrideTargetNode) {
      if (!voiceSourceMerger || !voiceEnvelopeGain) return;
      voiceSourceMerger.connect(voiceEnvelopeGain);
      const target = overrideTargetNode || this.getVoiceEntryNode();
      if (target) {
        voiceEnvelopeGain.connect(target);
      }
    }

    /**
     * Sets the master output volume smoothly.
     * @param {number} volume - Normalized gain [0.0, 1.0]
     */
    setMasterVolume(volume) {
      if (!this.masterGain || !this.ctx) return;
      const clamped = Math.max(0.0, Math.min(1.5, volume));
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  root.AudioBus = AudioBus;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioBus };
  }
})(typeof window !== 'undefined' ? window : globalThis);
