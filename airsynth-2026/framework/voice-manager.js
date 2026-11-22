/**
 * Dual-Hand Air Synth Demo — Voice Manager
 *
 * Coordinates voice allocation (supporting both monophonic mode for the Left-Hand
 * Fractal Synth and polyphonic mode with palm-center horizontal pitch bend for the
 * Right-Hand Bowed Violin String Synth), DetuneModule unison/sub-bass stacks,
 * EnvelopeModule ADSR scheduling, and AudioBus signal propagation into the shared FX pipeline.
 */
(function (root) {
  'use strict';

  class PolyphonicVoiceManager {
    /**
     * @param {AudioContext} audioCtx
     * @param {AudioFXEngine} fxEngine
     * @param {AudioBus} [audioBus]
     * @param {number} [maxPolyphony=32]
     * @param {AudioNode} [outputTargetNode=null] - Optional pre-FX stage input node (e.g. Left-Hand dedicated Wavefolder)
     */
    constructor(audioCtx, fxEngine, audioBus, maxPolyphony = 32, outputTargetNode = null) {
      this.ctx = audioCtx;
      this.fx = fxEngine;
      this.fxEngine = fxEngine;
      this.audioBus = audioBus || (fxEngine && fxEngine.audioBus) || null;
      this.maxPolyphony = maxPolyphony;
      this.outputTargetNode = outputTargetNode;
      this.activeVoices = new Map(); // note -> voiceObject
      this.lastPlayedNote = null;

      this.engines = new Map();
      this.registerDefaultEngines();
    }

    registerDefaultEngines() {
      const engineClasses = [
        root.HyperDroneEngine,
        root.BowedViolinEngine,
        ...(Array.isArray(root.REGISTERED_SYNTH_ENGINES) ? root.REGISTERED_SYNTH_ENGINES : [])
      ];

      for (const EngineCls of engineClasses) {
        if (!EngineCls) continue;
        if (typeof EngineCls.getEngineDescriptor === 'function') {
          this.registerEngine(EngineCls.getEngineDescriptor());
        } else if (EngineCls.id) {
          this.registerEngine(EngineCls);
        }
      }
    }

    registerEngine(descriptor) {
      if (!descriptor || !descriptor.id) return;
      this.engines.set(descriptor.id, descriptor);
    }

    createPeriodicWaveForMode(synthParams, timestamp = (typeof performance !== 'undefined' ? performance.now() : 0)) {
      const mode = synthParams.mode || 'drone';
      const engine = this.engines.get(mode);
      if (engine && engine.type === 'wavetable' && typeof engine.createPeriodicWave === 'function') {
        return engine.createPeriodicWave(this.ctx, synthParams, timestamp);
      }
      if (mode === 'drone' && root.HyperDroneEngine) {
        return root.HyperDroneEngine.createDroneWave(this.ctx, synthParams, timestamp);
      }
      return null;
    }

    playNote(note, velocity = 0.8, synthParams = {}) {
      if (!this.ctx) return null;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      // Enforce maxPolyphony (e.g. maxPolyphony = 1 for monophonic Left-Hand Fractal Synth)
      while (this.activeVoices.size >= this.maxPolyphony && !this.activeVoices.has(note)) {
        const noteToSteal = this.activeVoices.keys().next().value;
        if (noteToSteal !== null && noteToSteal !== undefined) {
          this.stopNote(noteToSteal, true, synthParams);
        } else {
          break;
        }
      }

      if (this.activeVoices.has(note)) {
        this.stopNote(note, true, synthParams);
      }

      const targetFreq = root.midiToFreq(note, synthParams.microtuningOffset || 0);
      const now = this.ctx.currentTime;

      const { startFreq } = root.DetuneModule.computeGlide(targetFreq, this.lastPlayedNote, synthParams);
      const voiceGain = root.EnvelopeModule.createVoiceEnvelope(this.ctx, velocity, synthParams);

      const masterMerger = this.ctx.createGain();
      const clampedVel = Math.max(0.10, Math.min(1.0, velocity));
      const velDynamicScale = (0.25 + 0.75 * Math.pow(clampedVel, 1.15)) * 0.85;
      masterMerger.gain.setValueAtTime(velDynamicScale, now);

      const voiceObj = {
        note,
        targetFreq,
        startFreq,
        velocity,
        voiceGain,
        masterMerger,
        oscillators: [],
        subOscillators: [],
        bufferNodes: [],
        unisonNodes: [],
        subNode: null,
        currentMode: synthParams.mode || 'drone',
        currentUnisonCount: synthParams.unisonEnabled !== false ? (parseInt(synthParams.unisonCount) || 1) : 1,
        pitchBendCents: synthParams.pitchBendCents || 0,
        noteOnPalmX: synthParams.noteOnPalmX !== undefined ? synthParams.noteOnPalmX : null,
        createdAt: now
      };

      this.instantiateVoiceOscillators(voiceObj, synthParams);

      // Route voice through optional pre-FX stage (e.g. Left-Hand dedicated Wavefolder) or directly into shared Studio FX Pipeline
      const targetNode = this.outputTargetNode || (this.fx ? this.fx.filterNode : undefined);
      if (this.audioBus) {
        this.audioBus.routeVoice(voiceObj.masterMerger, voiceGain, targetNode);
      } else {
        voiceObj.masterMerger.connect(voiceGain);
        if (targetNode) {
          voiceGain.connect(targetNode);
        }
      }

      this.activeVoices.set(note, voiceObj);
      this.lastPlayedNote = note;
      return voiceObj;
    }

    instantiateVoiceOscillators(voiceObj, synthParams = {}) {
      const now = this.ctx.currentTime;
      const freq = voiceObj.targetFreq;
      const glideTime = (synthParams.glideTime || 0) / 1000.0;
      const mode = synthParams.mode || 'drone';
      const unisonCount = synthParams.unisonEnabled !== false ? (parseInt(synthParams.unisonCount) || 1) : 1;
      const detuneSpread = synthParams.unisonEnabled !== false ? (synthParams.unisonDetune !== undefined ? synthParams.unisonDetune : 15) : 0;
      const stereoWidth = synthParams.unisonEnabled !== false ? ((synthParams.unisonStereo !== undefined ? synthParams.unisonStereo : 80) / 100.0) : 0;
      const pitchBendCents = voiceObj.pitchBendCents !== undefined
        ? voiceObj.pitchBendCents
        : (synthParams.pitchBendCents || 0);

      voiceObj.currentMode = mode;
      voiceObj.currentUnisonCount = unisonCount;
      voiceObj.unisonNodes = [];
      voiceObj.bufferNodes = [];
      voiceObj.oscillators = [];
      voiceObj.subOscillators = [];

      // 1. Sub-Bass Core via DetuneModule
      root.DetuneModule.attachSubBass(this.ctx, voiceObj, synthParams);

      // 2. Super-Unison Detune Stack Layout via DetuneModule
      const { detuneRatios, panOffsets, voiceAmp } = root.DetuneModule.getUnisonLayout(unisonCount, stereoWidth);

      const engineDesc = this.engines.get(mode);
      const isBufferMode = Boolean(engineDesc && engineDesc.type === 'buffer');
      const sharedPeriodicWave = !isBufferMode ? this.createPeriodicWaveForMode(synthParams) : null;
      const sharedVoiceBuffer = (isBufferMode && engineDesc && typeof engineDesc.createVoiceBuffer === 'function')
        ? engineDesc.createVoiceBuffer(this.ctx, freq, synthParams, voiceObj.velocity)
        : null;

      const centerIdx = Math.floor(detuneRatios.length / 2);

      for (let m = 0; m < detuneRatios.length; m++) {
        const isPrimaryVoice = (m === centerIdx) || detuneRatios.length === 1;
        const rawRatio = detuneRatios[m];
        const effectiveRatio = (isBufferMode && !isPrimaryVoice)
          ? (rawRatio < 0 ? rawRatio * 0.73 : rawRatio * 1.11)
          : rawRatio;
        const cents = (synthParams.unisonEnabled !== false ? effectiveRatio * detuneSpread : 0) + pitchBendCents;
        const panVal = synthParams.unisonEnabled !== false ? panOffsets[m] : 0;

        const effectiveVoiceAmp = (isBufferMode && detuneRatios.length > 1)
          ? (isPrimaryVoice ? 0.90 : 0.12 / Math.sqrt(detuneRatios.length - 1))
          : voiceAmp;

        const uGain = this.ctx.createGain();
        uGain.gain.setValueAtTime(effectiveVoiceAmp, now);

        let uPanner = null;
        if (this.ctx.createStereoPanner) {
          uPanner = this.ctx.createStereoPanner();
          uPanner.pan.setValueAtTime(panVal, now);
        }

        if (!isBufferMode) {
          const osc = this.ctx.createOscillator();
          if (sharedPeriodicWave) osc.setPeriodicWave(sharedPeriodicWave);
          osc.frequency.setValueAtTime(voiceObj.startFreq, now);
          if (glideTime > 0) osc.frequency.exponentialRampToValueAtTime(freq, now + glideTime);
          osc.detune.setValueAtTime(cents, now);
          osc.start(now);
          voiceObj.oscillators.push(osc);

          if (uPanner) { osc.connect(uPanner); uPanner.connect(uGain); }
          else { osc.connect(uGain); }

          voiceObj.unisonNodes.push({ osc, uGain, uPanner, detuneRatio: effectiveRatio, panOffset: panOffsets[m] });
        } else {
          const bufNode = this.ctx.createBufferSource();
          bufNode.buffer = sharedVoiceBuffer;
          bufNode.loop = engineDesc && engineDesc.loop !== undefined ? engineDesc.loop : true;

          const bendRate = Math.pow(2, cents / 1200.0);
          bufNode.playbackRate.setValueAtTime(bendRate, now);
          bufNode.start(now);
          voiceObj.bufferNodes.push({ bufNode, uGain, uPanner, detuneRatio: effectiveRatio, panOffset: panOffsets[m] });

          if (uPanner) { bufNode.connect(uPanner); uPanner.connect(uGain); }
          else { bufNode.connect(uGain); }
        }

        uGain.connect(voiceObj.masterMerger);
      }
    }

    /**
     * Updates the pitch bend in cents for a specific active note (used by Right-Hand palm movement).
     * @param {number} note
     * @param {number} pitchBendCents
     * @param {Object} synthParams
     */
    setNotePitchBend(note, pitchBendCents, synthParams = {}) {
      if (!this.ctx || !this.activeVoices.has(note)) return;
      const voiceObj = this.activeVoices.get(note);
      voiceObj.pitchBendCents = pitchBendCents;
      root.DetuneModule.updateVoiceDetuneAndSub(this.ctx, voiceObj, {
        ...synthParams,
        pitchBendCents
      });
    }

    updateActiveVoices(synthParams = {}, forceRebuild = false) {
      if (!this.ctx || this.activeVoices.size === 0) return;
      const mode = synthParams.mode || 'drone';
      const unisonCount = synthParams.unisonEnabled !== false ? (parseInt(synthParams.unisonCount) || 1) : 1;

      const engineDesc = this.engines.get(mode);
      const isBufferMode = Boolean(engineDesc && engineDesc.type === 'buffer');
      let sharedWave = null;
      if (!isBufferMode) {
        sharedWave = this.createPeriodicWaveForMode(synthParams);
      }

      for (const [, voiceObj] of this.activeVoices.entries()) {
        if (forceRebuild || voiceObj.currentMode !== mode || voiceObj.currentUnisonCount !== unisonCount) {
          this.rebuildVoiceSoundGenerators(voiceObj, synthParams);
          continue;
        }

        if (sharedWave) {
          for (const uNode of voiceObj.unisonNodes) {
            if (uNode.osc) {
              try { uNode.osc.setPeriodicWave(sharedWave); } catch (e) {}
            }
          }
        }

        root.DetuneModule.updateVoiceDetuneAndSub(this.ctx, voiceObj, synthParams);
      }
    }

    rebuildVoiceSoundGenerators(voiceObj, synthParams) {
      if (voiceObj.oscillators) {
        voiceObj.oscillators.forEach(osc => { try { osc.stop(); osc.disconnect(); } catch (e) {} });
      }
      if (voiceObj.subOscillators) {
        voiceObj.subOscillators.forEach(sub => { try { sub.osc.stop(); sub.osc.disconnect(); sub.gain.disconnect(); } catch (e) {} });
      }
      if (voiceObj.bufferNodes) {
        voiceObj.bufferNodes.forEach(b => {
          const node = b.bufNode || b;
          try { node.stop(); node.disconnect(); } catch (e) {}
        });
      }

      voiceObj.oscillators = [];
      voiceObj.subOscillators = [];
      voiceObj.bufferNodes = [];
      voiceObj.unisonNodes = [];
      voiceObj.subNode = null;

      this.instantiateVoiceOscillators(voiceObj, synthParams);
    }

    updateDroneWaves(synthParams, timestamp) {
      if (!this.ctx || this.activeVoices.size === 0) return;
      const droneWave = root.HyperDroneEngine.createDroneWave(this.ctx, synthParams, timestamp);
      if (!droneWave) return;
      for (const voiceObj of this.activeVoices.values()) {
        if (voiceObj.currentMode === 'drone') {
          for (const uNode of voiceObj.unisonNodes) {
            if (uNode.osc) {
              try { uNode.osc.setPeriodicWave(droneWave); } catch (e) {}
            }
          }
        }
      }
    }

    stopNote(note, forceStop = false, synthParams = {}) {
      if (!this.activeVoices.has(note)) return;
      const voiceObj = this.activeVoices.get(note);

      const release = root.EnvelopeModule.triggerRelease(voiceObj.voiceGain, this.ctx, synthParams);

      setTimeout(() => {
        try {
          if (voiceObj.oscillators) voiceObj.oscillators.forEach(osc => { try { osc.stop(); osc.disconnect(); } catch (e) {} });
          if (voiceObj.subOscillators) voiceObj.subOscillators.forEach(sub => { try { sub.osc.stop(); sub.osc.disconnect(); sub.gain.disconnect(); } catch (e) {} });
          if (voiceObj.bufferNodes) voiceObj.bufferNodes.forEach(b => { const node = b.bufNode || b; try { node.stop(); node.disconnect(); } catch (e) {} });
          voiceObj.masterMerger.disconnect();
          voiceObj.voiceGain.disconnect();
        } catch (e) {}
      }, release * 1000 + 60);

      this.activeVoices.delete(note);
    }

    allNotesOff(synthParams = {}) {
      for (const note of Array.from(this.activeVoices.keys())) {
        this.stopNote(note, true, synthParams);
      }
      this.activeVoices.clear();
    }
  }

  root.PolyphonicVoiceManager = PolyphonicVoiceManager;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PolyphonicVoiceManager };
  }
})(typeof window !== 'undefined' ? window : globalThis);
