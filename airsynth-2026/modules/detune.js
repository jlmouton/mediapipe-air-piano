/**
 * Dual-Hand Air Synth Demo — Super-Unison Detune Stack, Sub-Bass & Pitch-Bend Module
 */
(function (root) {
  'use strict';

  class DetuneModule {
    /**
     * Computes symmetric detune ratios, stereo panner offsets, and per-voice gain normalization
     * for a given unison voice count (1 - 7) and stereo width [0.0, 1.0].
     * @param {number} unisonCount
     * @param {number} stereoWidth
     * @returns {{detuneRatios: number[], panOffsets: number[], voiceAmp: number}}
     */
    static getUnisonLayout(unisonCount = 1, stereoWidth = 0.8) {
      let detuneRatios = [0];
      let panOffsets = [0];

      if (unisonCount === 2) {
        detuneRatios = [-1.0, 1.0];
        panOffsets = [-0.7 * stereoWidth, 0.7 * stereoWidth];
      } else if (unisonCount === 3) {
        detuneRatios = [-1.0, 0.0, 1.0];
        panOffsets = [-0.8 * stereoWidth, 0.0, 0.8 * stereoWidth];
      } else if (unisonCount === 4) {
        detuneRatios = [-1.0, -0.33, 0.33, 1.0];
        panOffsets = [-0.9 * stereoWidth, -0.3 * stereoWidth, 0.3 * stereoWidth, 0.9 * stereoWidth];
      } else if (unisonCount === 5) {
        detuneRatios = [-1.0, -0.5, 0.0, 0.5, 1.0];
        panOffsets = [-1.0 * stereoWidth, -0.5 * stereoWidth, 0.0, 0.5 * stereoWidth, 1.0 * stereoWidth];
      } else if (unisonCount === 6) {
        detuneRatios = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
        panOffsets = [-1.0 * stereoWidth, -0.6 * stereoWidth, -0.2 * stereoWidth, 0.2 * stereoWidth, 0.6 * stereoWidth, 1.0 * stereoWidth];
      } else if (unisonCount >= 7) {
        detuneRatios = [-1.0, -0.66, -0.33, 0.0, 0.33, 0.66, 1.0];
        panOffsets = [-1.0 * stereoWidth, -0.7 * stereoWidth, -0.35 * stereoWidth, 0.0, 0.35 * stereoWidth, 0.7 * stereoWidth, 1.0 * stereoWidth];
      }

      const voiceAmp = 1.0 / Math.sqrt(Math.max(1, unisonCount));
      return { detuneRatios, panOffsets, voiceAmp };
    }

    /**
     * Calculates the starting frequency for portamento/glide.
     * @param {number} targetFreq
     * @param {number|null} lastPlayedNote
     * @param {Object} synthParams
     * @returns {{startFreq: number, glideTimeSec: number}}
     */
    static computeGlide(targetFreq, lastPlayedNote, synthParams = {}) {
      const glideTimeSec = (synthParams.glideTime || 0) / 1000.0;
      const midiToFreqFn = root.midiToFreq || ((n, off = 0) => 440 * Math.pow(2, (n + off - 69) / 12));
      const startFreq = (glideTimeSec > 0 && lastPlayedNote !== null && lastPlayedNote !== undefined)
        ? midiToFreqFn(lastPlayedNote, synthParams.microtuningOffset || 0)
        : targetFreq;
      return { startFreq, glideTimeSec };
    }

    /**
     * Instantiates the Sub-Bass Oscillator & GainNode for a voice and connects to voiceObj.masterMerger.
     * @param {AudioContext} audioCtx
     * @param {Object} voiceObj
     * @param {Object} synthParams
     */
    static attachSubBass(audioCtx, voiceObj, synthParams = {}) {
      const now = audioCtx.currentTime;
      const freq = voiceObj.targetFreq;
      const glideTime = (synthParams.glideTime || 0) / 1000.0;
      const pitchBendCents = voiceObj.pitchBendCents !== undefined
        ? voiceObj.pitchBendCents
        : (synthParams.pitchBendCents || 0);

      const subOsc = audioCtx.createOscillator();
      const subGain = audioCtx.createGain();
      subOsc.type = synthParams.subWave || 'sine';

      const octDiv = Math.pow(2, (synthParams.subOctave || 12) / 12.0);
      const subFreq = freq / octDiv;
      subOsc.frequency.setValueAtTime(voiceObj.startFreq / octDiv, now);
      if (glideTime > 0) {
        subOsc.frequency.exponentialRampToValueAtTime(subFreq, now + glideTime);
      }
      subOsc.detune.setValueAtTime(pitchBendCents, now);

      const initialSubGain = (synthParams.unisonEnabled !== false
        ? (synthParams.subLevel !== undefined ? synthParams.subLevel : 0.35)
        : 0) * 0.6;
      subGain.gain.setValueAtTime(initialSubGain, now);

      subOsc.connect(subGain);
      subGain.connect(voiceObj.masterMerger);
      subOsc.start(now);

      const subEntry = { osc: subOsc, gain: subGain };
      voiceObj.subOscillators.push(subEntry);
      voiceObj.subNode = subEntry;
    }

    /**
     * Updates active unison detune cents, stereo panner width, pitch bend, and sub-bass level in real time.
     * @param {AudioContext} audioCtx
     * @param {Object} voiceObj
     * @param {Object} synthParams
     */
    static updateVoiceDetuneAndSub(audioCtx, voiceObj, synthParams = {}) {
      const now = audioCtx.currentTime;
      const detuneSpread = synthParams.unisonEnabled !== false ? (synthParams.unisonDetune !== undefined ? synthParams.unisonDetune : 15) : 0;
      const stereoWidth = synthParams.unisonEnabled !== false ? ((synthParams.unisonStereo !== undefined ? synthParams.unisonStereo : 80) / 100.0) : 0;
      const pitchBendCents = voiceObj.pitchBendCents !== undefined
        ? voiceObj.pitchBendCents
        : (synthParams.pitchBendCents || 0);
      const subLevel = synthParams.unisonEnabled !== false ? (synthParams.subLevel !== undefined ? synthParams.subLevel : 0.35) : 0;

      for (const uNode of voiceObj.unisonNodes) {
        if (uNode.osc) {
          const cents = (synthParams.unisonEnabled !== false ? uNode.detuneRatio * detuneSpread : 0) + pitchBendCents;
          uNode.osc.detune.setTargetAtTime(cents, now, 0.005);
        }
        if (uNode.uPanner) {
          const pan = synthParams.unisonEnabled !== false ? uNode.panOffset * stereoWidth : 0;
          uNode.uPanner.pan.setTargetAtTime(pan, now, 0.005);
        }
      }

      for (const bNode of voiceObj.bufferNodes) {
        if (bNode.bufNode) {
          const cents = (synthParams.unisonEnabled !== false ? bNode.detuneRatio * detuneSpread : 0) + pitchBendCents;
          const bendRate = Math.pow(2, cents / 1200.0);
          bNode.bufNode.playbackRate.setTargetAtTime(bendRate, now, 0.01);
        }
      }

      if (voiceObj.subNode) {
        if (voiceObj.subNode.osc && voiceObj.subNode.osc.detune) {
          voiceObj.subNode.osc.detune.setTargetAtTime(pitchBendCents, now, 0.005);
        }
        if (voiceObj.subNode.gain) {
          voiceObj.subNode.gain.gain.setTargetAtTime(subLevel * 0.6, now, 0.005);
        }
      }
    }
  }

  root.DetuneModule = DetuneModule;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DetuneModule };
  }
})(typeof window !== 'undefined' ? window : globalThis);
