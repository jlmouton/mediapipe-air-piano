/**
 * Dual-Hand Air Synth Demo — Mathematical Constants & MIDI Pitch-to-Frequency Conversion
 * UMD / Global-Namespace Module (compatible with file://, HTTP, and Node.js)
 */
(function (root) {
  'use strict';

  const TWO_PI = Math.PI * 2;
  const PHI = 1.618033988749895; // Golden Ratio

  /**
   * MIDI Pitch to Frequency Conversion (A4 = 440Hz, equal temperament or microtonal)
   * @param {number} note - MIDI note number (0 - 127)
   * @param {number} [microtuningOffset=0] - Fractional semitone offset
   * @returns {number} Frequency in Hz
   */
  function midiToFreq(note, microtuningOffset = 0) {
    return 440 * Math.pow(2, (note + microtuningOffset - 69) / 12);
  }

  root.TWO_PI = TWO_PI;
  root.PHI = PHI;
  root.midiToFreq = midiToFreq;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TWO_PI, PHI, midiToFreq };
  }
})(typeof window !== 'undefined' ? window : globalThis);
