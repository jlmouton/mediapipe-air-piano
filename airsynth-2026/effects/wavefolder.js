/**
 * Dual-Hand Air Synth Demo — Effect Stage 2: West-Coast Non-Linear Wavefolder & Saturation
 *
 * Includes a dynamic pre-drive stage (`preDriveGain`) feeding a 4x-oversampled
 * West-Coast sine/harmonic wavefolder (`wavefolderNode`) so low-level polyphonic/unison
 * pad signals are driven across multiple wavefolds even at 5%–40% modulation depths.
 */
(function (root) {
  'use strict';

  class WavefolderEffect {
    /**
     * @param {AudioContext} audioCtx
     */
    constructor(audioCtx) {
      this.id = 'drive';
      this.ctx = audioCtx;

      this.inputNode = this.ctx.createGain();
      this.outputNode = this.ctx.createGain();
      this.preDriveGain = this.ctx.createGain();
      this.wavefolderNode = this.ctx.createWaveShaper();
      this.wavefolderNode.oversample = '4x';
      this.driveDryGain = this.ctx.createGain();
      this.driveWetGain = this.ctx.createGain();

      this.preDriveGain.gain.value = 1.0;
      this.driveDryGain.gain.value = 1.0;
      this.driveWetGain.gain.value = 0.0;

      this._lastAmount = null;
      this.updateCurve(0.0);

      // Dry path: inputNode -> driveDryGain -> outputNode
      this.inputNode.connect(this.driveDryGain);
      this.driveDryGain.connect(this.outputNode);

      // Wet folded path: inputNode -> preDriveGain -> wavefolderNode -> driveWetGain -> outputNode
      this.inputNode.connect(this.preDriveGain);
      this.preDriveGain.connect(this.wavefolderNode);
      this.wavefolderNode.connect(this.driveWetGain);
      this.driveWetGain.connect(this.outputNode);
    }

    updateCurve(amount = 0.0) {
      const roundedAmount = Math.max(0.0, Math.min(1.0, Math.round((Number(amount) || 0) * 1000) / 1000));
      if (this._lastAmount === roundedAmount && this.wavefolderNode.curve) return;
      this._lastAmount = roundedAmount;

      const nSamples = 2048;
      const curve = new Float32Array(nSamples);
      const deg = Math.PI / 180;

      // Progressive West-Coast scaling:
      // - At 0%: purely linear (y = x)
      // - At 1%: subtle warmth without sudden heavy distortion
      // - At ~20%: reaches mild-to-moderate folding (~old 1% character)
      // - At 25%–100%: progressively deepens multi-stage wavefolding
      const k = Math.pow(roundedAmount, 1.5) * 35;
      const foldBlend = Math.min(1.0, roundedAmount / 0.25);
      const overtoneAmt = Math.min(0.35, (roundedAmount / 0.40) * 0.35);

      for (let i = 0; i < nSamples; i++) {
        const x = (i * 2) / nSamples - 1;
        if (roundedAmount === 0) {
          curve[i] = x;
        } else {
          const folded = Math.sin((k + 1) * x * Math.PI * 0.5);
          const overtone = Math.sin((2 * k + 1) * x * Math.PI) * overtoneAmt;
          const sat = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
          const nonlinear = Math.max(-1.0, Math.min(1.0, 0.70 * folded + overtone + 0.25 * sat));
          curve[i] = Math.max(-1.0, Math.min(1.0, (1.0 - foldBlend) * x + foldBlend * nonlinear));
        }
      }
      this.wavefolderNode.curve = curve;
    }

    setMix(driveAmount = 0.0, bypassed = false) {
      const now = this.ctx.currentTime;
      const amt = Math.max(0.0, Math.min(1.0, Number(driveAmount) || 0.0));
      const driveOn = !bypassed && amt > 0;

      // Smooth crossfade & drive taper so 0% -> 1% is subtle and progressive (~20% = clear folding)
      const wetVal = driveOn ? Math.min(1.0, amt / 0.25) : 0.0;
      const dryVal = driveOn ? Math.max(0.0, 1.0 - amt * 1.25) : 1.0;
      const preDrive = driveOn ? (1.0 + amt * 9.0) : 1.0;

      if (this.preDriveGain && this.preDriveGain.gain) {
        this.preDriveGain.gain.cancelScheduledValues(now);
        this.preDriveGain.gain.setValueAtTime(preDrive, now);
      }

      this.driveWetGain.gain.cancelScheduledValues(now);
      this.driveWetGain.gain.setValueAtTime(wetVal, now);

      this.driveDryGain.gain.cancelScheduledValues(now);
      this.driveDryGain.gain.setValueAtTime(dryVal, now);
    }
  }

  root.WavefolderEffect = WavefolderEffect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WavefolderEffect };
  }
})(typeof window !== 'undefined' ? window : globalThis);
