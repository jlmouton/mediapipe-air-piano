/**
 * Dual-Hand Air Synth Demo — ADSR Amplitude Envelope Generator Module
 */
(function (root) {
  'use strict';

  class EnvelopeModule {
    /**
     * Creates and schedules a per-voice ADSR GainNode on Note-On.
     * @param {AudioContext} audioCtx
     * @param {number} velocity - Note velocity [0.0, 1.0]
     * @param {Object} synthParams - { attack, decay, sustain }
     * @returns {GainNode}
     */
    static createVoiceEnvelope(audioCtx, velocity = 0.8, synthParams = {}) {
      const now = audioCtx.currentTime;
      const voiceGain = audioCtx.createGain();

      const attack = Math.max(0.002, synthParams.attack || 0.03);
      const decay = Math.max(0.01, synthParams.decay || 0.15);
      const sustain = Math.max(0.0, Math.min(1.0, synthParams.sustain !== undefined ? synthParams.sustain : 0.7));

      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(velocity, now + attack);
      voiceGain.gain.linearRampToValueAtTime(velocity * sustain, now + attack + decay);

      return voiceGain;
    }

    /**
     * Schedules the exponential Release phase on Note-Off and returns the release duration in seconds.
     * @param {GainNode} voiceGain
     * @param {AudioContext} audioCtx
     * @param {Object} synthParams - { release }
     * @returns {number} releaseDurationSeconds
     */
    static triggerRelease(voiceGain, audioCtx, synthParams = {}) {
      const now = audioCtx.currentTime;
      const release = Math.max(0.005, synthParams.release !== undefined ? synthParams.release : 0.3);

      voiceGain.gain.cancelScheduledValues(now);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, now);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + release);

      return release;
    }
  }

  root.EnvelopeModule = EnvelopeModule;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnvelopeModule };
  }
})(typeof window !== 'undefined' ? window : globalThis);
