/**
 * Dual-Hand Air Synth Demo — Application & MediaPipe 2-Hand Controller
 *
 * Combines:
 * 1. MediaPipe HandLandmarker (expanded to 2 hands: Left Hand & Right Hand)
 * 2. Left Hand (Monophonic, C3–F2, No Pitch Bend):
 *    Fractal Synth running only the "Seahorse Valley Pad" preset (Hyper-Drone engine)
 *    with Dual Morph and Swirl LFO (0.05 Hz default) controls.
 * 3. Right Hand (Polyphonic, C4–G4, Palm Horizontal Pitch Bend: 1/2 viewport = 1 tone):
 *    Physical Modeling String Synth running the Bowed Violin engine
 *    with Bow Force, Bow Speed, Bow Pos (β), and Rosin Grit controls.
 * 4. Shared Studio Audio Effects Pipeline (with Fractal Synth defaults) receiving audio from both synths.
 * 5. YouTube Backing Video Player controlled by Left Hand gesture (Open Hand -> All 5 Fingers Together
 *    to toggle Play/Pause, with a dropdown of preset URLs, a small Reload button, and a thumbnail view
 *    sized to half the camera view on both axes while playing).
 */

// ============================================================================
// 1. NOTE MAPPINGS & CONSTANTS
// ============================================================================
// Left Hand (Fractal Synth — Monophonic): Thumb=C3(48), Index=B2(47), Middle=A2(45), Ring=G2(43), Pinky=F2(41)
const LEFT_HAND_NOTES = [48, 47, 45, 43, 41];
const LEFT_HAND_NOTE_NAMES = ['C3', 'B2', 'A2', 'G2', 'F2'];

// Right Hand (Bowed Violin Synth — Polyphonic): Thumb=C4(60), Index=D4(62), Middle=E4(64), Ring=F4(65), Pinky=G4(67)
const RIGHT_HAND_NOTES = [60, 62, 64, 65, 67];
const RIGHT_HAND_NOTE_NAMES = ['C4', 'D4', 'E4', 'F4', 'G4'];

// MediaPipe Hand Landmark Indices: Wrist/Palm Center = 0, Thumb..Pinky Tips = [4, 8, 12, 16, 20]
const PALM_CENTER_INDEX = 0;
const MIDDLE_MCP_INDEX = 9;
const FINGER_TIP_INDICES = [4, 8, 12, 16, 20];
const FINGER_MCP_INDICES = [2, 5, 9, 13, 17];
const HAND_CALIBRATION_STORAGE_KEY = 'airsynth_hand_calibration';

// Scale-invariant fingertip-to-palm ratio thresholds (relative to the most extended finger on the hand):
// Assumes all 5 fingers are never played simultaneously, so max(distance) represents the extended hand scale
// regardless of how close or far the hand is from the camera.
const FINGER_PLAY_RATIO_THRESHOLDS = [0.60, 0.75, 0.75, 0.75, 0.75];
const FINGER_PLAY_THRESHOLDS = FINGER_PLAY_RATIO_THRESHOLDS;

// Active hand calibration profile (can be customized via calibrate.html or applyHandCalibration)
// Supports both shared fallback thresholds and optional independent Left/Right per-hand profiles.
let handCalibration = {
  metricMode: 'ratioToMaxTip',
  thresholds: [...FINGER_PLAY_RATIO_THRESHOLDS],
  perHand: {
    Left: null,
    Right: null
  }
};

// Hysteresis & borderline debounce settings:
// - Release hysteresis prevents 1-frame upward landmark jitter from dropping a held note.
// - Left-hand borderline steal debounce prevents slight sympathetic droop on an adjacent finger
//   (e.g. Ring/G2 while holding Pinky/F2) from immediately stealing the monophonic voice on 1-2 noisy frames.
const FINGER_RELEASE_HYSTERESIS_BY_MODE = {
  ratioToMaxTip: 0.04,
  ratioToPalm: 0.08,
  tipToMcpOverPalm: 0.05
};
const LEFT_STEAL_DECISIVE_MARGIN_BY_MODE = {
  ratioToMaxTip: 0.04,
  ratioToPalm: 0.08,
  tipToMcpOverPalm: 0.05
};
const LEFT_BORDERLINE_DEBOUNCE_FRAMES = 3;
const HAND_TRACKING_MEMORY_MS = 500;

// Pitch bend scaling: horizontal movement of 0.5 (half of the camera viewport) = 1 tone (2 semitones = 200 cents)
const VIEWPORT_HALF_WIDTH = 0.5;
const CENTS_PER_TONE = 200;

// Left Hand Wavefolder vertical palm scaling:
// Upward movement of 25% (0.25) of camera viewport height maps the Left Hand Wavefolder knob from 0% to 40% (clamped at 40%).
const LEFT_WAVEFOLDER_VIEWPORT_HEIGHT = 0.25;
const LEFT_WAVEFOLDER_MAX_PERCENT = 40;

// YouTube Backing Video URLs (first URL is selected by default)
const YOUTUBE_VIDEO_URLS = [
  'https://www.youtube.com/watch?v=xeqUit1EHIw',
  'https://www.youtube.com/watch?v=trzD7Eqq2xA',
  'https://www.youtube.com/watch?v=M8sLeAe1EnI',
  'https://www.youtube.com/watch?v=hEVxMDI5c94'
];

// Scale-invariant Left Hand gesture thresholds (relative to handScale = max(palmLength, palmWidth)):
// - Open Hand: fingertips spread apart and none curled in play position
// - All 5 Fingers Together: all 5 fingertips brought close to each other
const LEFT_GESTURE_OPEN_MAX_PAIR_RATIO = 1.05;
const LEFT_GESTURE_OPEN_AVG_PAIR_RATIO = 0.55;
const LEFT_GESTURE_TOGETHER_MAX_PAIR_RATIO = 0.70;
const LEFT_GESTURE_TOGETHER_AVG_PAIR_RATIO = 0.45;
const YOUTUBE_GESTURE_COOLDOWN_MS = 300;

// ============================================================================
// 2. SYNTHESIZER & FX DEFAULT PARAMETERS
// ============================================================================
let audioCtx = null;
let audioBus = null;
let fxEngine = null;
let leftWavefolder = null;    // Dedicated Wavefolder effect for Left-Hand Fractal Synth before Studio FX Pipeline
let leftVoiceManager = null;  // Monophonic Fractal Synth (Seahorse Valley Pad)
let rightVoiceManager = null; // Polyphonic Bowed Violin String Synth
let isAudioStarted = false;

// Left Hand: Fractal Synth — Seahorse Valley Pad preset (Swirl LFO default = 0.05 Hz, dedicated Wavefolder default = 0%)
const leftSynthParams = {
  ...(typeof SEAHORSE_VALLEY_PAD_PRESET !== 'undefined' ? SEAHORSE_VALLEY_PAD_PRESET.params : {}),
  mode: 'drone',
  droneMorph: 0.45,
  droneSwirlRate: 0.05,
  wavefolder: 0.0,
  droneSub: 0.70,
  droneSpectral: 12,
  attack: 0.8,
  decay: 1.2,
  sustain: 0.85,
  release: 1.8,
  unisonEnabled: true,
  unisonCount: 5,
  unisonDetune: 20,
  unisonStereo: 90,
  subLevel: 0.5,
  subOctave: 12,
  subWave: 'sine',
  glideTime: 120,
  microtuningOffset: 0,
  pitchBendCents: 0
};

// Right Hand: Bowed Violin String Physical Modeling Engine
const rightSynthParams = {
  mode: 'bowed_violin',
  bowPressure: 0.55,
  bowVelocity: 0.65,
  bowPosition: 0.11,
  rosinGrit: 0.20,
  attack: 0.18,
  decay: 0.45,
  sustain: 0.85,
  release: 0.55,
  unisonEnabled: true,
  unisonCount: 3,
  unisonDetune: 10,
  unisonStereo: 65,
  subLevel: 0.20,
  subOctave: 12,
  subWave: 'sine',
  glideTime: 0,
  microtuningOffset: 0,
  pitchBendCents: 0
};

// Studio Audio Effect Pipeline defaults (same defaults as the Fractal Synth)
const fxFilterParams = {
  masterVolume: 0.75,
  cutoff: 4500,
  resonance: 1.2,
  filterType: 'lowpass'
};

const fxParams = {
  fxEnabled: true,
  driveAmount: 0.0,
  chorusMix: 0.25,
  chorusRate: 1.5,
  delayMix: 0.20,
  delayTime: 350,
  delayFeedback: 0.40,
  reverbMix: 0.30,
  reverbSize: 2.5
};

const knobs = {};

// Hand tracking state
let handLandmarker = undefined;
let lastVideoTime = -1;
let results = undefined;

// Left hand monophonic tracking state + vertical palm wavefolder modulation state
let leftActiveFinger = null; // 0..4 or null
let leftPrevPlays = [false, false, false, false, false];
let leftPendingStealCounts = [0, 0, 0, 0, 0];
let leftNoteOnPalmY = null;
let leftNoteOnWavefolderPct = 0;

// Spatial hand-tracking memory used to keep Left/Right identity stable across MediaPipe handedness glitches
let lastHandTracking = {
  Left: null,
  Right: null
};

// Left hand YouTube play/pause gesture state ('idle' | 'armed_open' | 'triggered_together')
let leftGestureState = 'idle';
let lastYouTubeGestureToggleMs = -Infinity;

// YouTube player state
let selectedYouTubeUrl = YOUTUBE_VIDEO_URLS[0];
let currentLoadedVideoId = '';
let youtubePlayer = null;
let youtubePlayerReady = false;
let youtubeIsPlaying = false;
let pendingYouTubePlay = false;
let youtubeApiRequested = false;

// Right hand polyphonic + per-note palm pitch-bend tracking state
let rightActiveFingers = [false, false, false, false, false];
let rightNoteOnPalmX = [null, null, null, null, null];

// Handedness mirror switch (false = default switched mapping where MediaPipe's raw Left/Right are inverted;
// true = switched for cameras with hardware/driver mirror enabled)
let swapHands = false;

let lastBufferRebuildMs = 0;

if (typeof window !== 'undefined') {
  window.leftSynthParams = leftSynthParams;
  window.rightSynthParams = rightSynthParams;
  window.fxFilterParams = fxFilterParams;
  window.fxParams = fxParams;
  window.LEFT_HAND_NOTES = LEFT_HAND_NOTES;
  window.RIGHT_HAND_NOTES = RIGHT_HAND_NOTES;
  window.YOUTUBE_VIDEO_URLS = YOUTUBE_VIDEO_URLS;
  window.swapHands = swapHands;
  window.youtubeIsPlaying = youtubeIsPlaying;
  window.leftGestureState = leftGestureState;
}

// ============================================================================
// 3. SHARED AUDIO ENGINE & EFFECT PIPELINE INITIALIZATION
// ============================================================================
function initAudioEngine() {
  if (isAudioStarted && audioCtx) return;

  const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || AudioContext;
  audioCtx = new AudioContextClass();

  // 1. Shared AudioBus
  audioBus = new AudioBus(audioCtx);
  audioBus.setMasterVolume(fxFilterParams.masterVolume);

  // 2. Shared Studio Audio FX Pipeline (Filter -> Wavefolder -> Chorus -> Delay -> FDN Reverb -> Limiter)
  fxEngine = new AudioFXEngine(audioCtx, audioBus);
  fxEngine.updateParams(fxParams, fxFilterParams);

  // 3. Dedicated Wavefolder Effect for Left-Hand Fractal Synth (before Studio Audio Effects Pipeline)
  leftWavefolder = new WavefolderEffect(audioCtx);
  updateLeftWavefolderDSP(leftSynthParams.wavefolder || 0.0);
  leftWavefolder.outputNode.connect(fxEngine.filterNode);

  // 4. Left Hand Voice Manager (Monophonic Fractal Synth -> Dedicated Wavefolder -> Shared Studio FX Pipeline)
  const leftPreFxTarget = Object.assign(Object.create(Object.getPrototypeOf(fxEngine)), fxEngine, {
    filterNode: leftWavefolder.inputNode,
    audioBus
  });
  leftVoiceManager = new PolyphonicVoiceManager(audioCtx, leftPreFxTarget, audioBus, 1, leftWavefolder.inputNode);
  leftVoiceManager.fxEngine = fxEngine;
  leftVoiceManager.outputTargetNode = leftWavefolder.inputNode;

  // 5. Right Hand Voice Manager (Polyphonic Bowed Violin String Synth -> Shared Studio FX Pipeline)
  rightVoiceManager = new PolyphonicVoiceManager(audioCtx, fxEngine, audioBus, 5);

  isAudioStarted = true;

  if (typeof window !== 'undefined') {
    window.audioCtx = audioCtx;
    window.audioBus = audioBus;
    window.fxEngine = fxEngine;
    window.leftWavefolder = leftWavefolder;
    window.leftVoiceManager = leftVoiceManager;
    window.rightVoiceManager = rightVoiceManager;
  }

  if (typeof document !== 'undefined') {
    const btnStart = document.getElementById('btn-audio-start-v2');
    if (btnStart) {
      btnStart.innerText = '✓ Audio Engine Running';
      btnStart.classList.add('active');
    }
  }
}

/**
 * Updates the Left Hand Fractal Synth's dedicated Wavefolder DSP curve and dry/wet mix.
 * @param {number} amount - Normalized wavefolder drive amount [0.0, 1.0]
 */
function updateLeftWavefolderDSP(amount) {
  const clamped = Math.max(0.0, Math.min(1.0, Number(amount) || 0.0));
  leftSynthParams.wavefolder = clamped;
  if (leftWavefolder) {
    leftWavefolder.updateCurve(clamped);
    leftWavefolder.setMix(clamped, false);
  }
}

function ensureAudioEngine() {
  if (!isAudioStarted || !audioCtx) {
    initAudioEngine();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function throttledRightVoiceBufferUpdate() {
  if (!rightVoiceManager || rightVoiceManager.activeVoices.size === 0) return;
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - lastBufferRebuildMs >= 100) {
    lastBufferRebuildMs = nowMs;
    rightVoiceManager.updateActiveVoices(rightSynthParams, true);
  }
}

// ============================================================================
// 4. GEOMETRY, LANDMARK VISIBILITY, DRAWING & PITCH BEND HELPERS
// ============================================================================

/**
 * Euclidean distance in the 2D camera plane between two MediaPipe landmarks
 * (same formula as airpiano.js).
 */
function distance(landmark1, landmark2) {
  return Math.sqrt((landmark1.y - landmark2.y) ** 2 + (landmark1.x - landmark2.x) ** 2);
}

/**
 * Draws a 10x10 square marker for a fingertip or palm center onto the overlay canvas
 * (same as airpiano.js: red #FF0000 when active, green #00FF00 when inactive).
 */
function drawFinger(ctx, fingerTip, active) {
  if (!ctx || !fingerTip) return;
  if (active) {
    ctx.fillStyle = '#FF0000';
  } else {
    ctx.fillStyle = '#00FF00';
  }
  const x = Math.abs(fingerTip.x * ctx.canvas.width);
  const y = Math.abs(fingerTip.y * ctx.canvas.height);
  ctx.fillRect(x - 5, y - 5, 10, 10);
}

/**
 * Checks whether a single landmark is valid and visible within the camera viewport [0, 1].
 */
function isLandmarkVisible(lm) {
  return Boolean(
    lm &&
    Number.isFinite(lm.x) &&
    Number.isFinite(lm.y) &&
    lm.x >= 0 && lm.x <= 1 &&
    lm.y >= 0 && lm.y <= 1
  );
}

/**
 * Checks whether the palm center (0) and all 5 fingertips (4, 8, 12, 16, 20)
 * of a hand are detected and visible in the camera feed.
 */
function areFingertipsVisible(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return false;
  if (!isLandmarkVisible(landmarks[PALM_CENTER_INDEX])) return false;
  for (let i = 0; i < FINGER_TIP_INDICES.length; i++) {
    if (!isLandmarkVisible(landmarks[FINGER_TIP_INDICES[i]])) {
      return false;
    }
  }
  return true;
}

function normalizeHandCalibrationProfile(profile, fallbackMode = 'ratioToMaxTip', fallbackThresholds = FINGER_PLAY_RATIO_THRESHOLDS) {
  if (!profile || typeof profile !== 'object') return null;
  const validModes = ['ratioToMaxTip', 'ratioToPalm', 'tipToMcpOverPalm'];
  const mode = validModes.includes(profile.metricMode) ? profile.metricMode : fallbackMode;
  const thresholds = (Array.isArray(profile.thresholds) && profile.thresholds.length === 5)
    ? profile.thresholds.map((t, i) => Number.isFinite(Number(t)) ? Number(t) : fallbackThresholds[i])
    : [...fallbackThresholds];
  return { metricMode: mode, thresholds };
}

/**
 * Returns the active calibration profile (`{ metricMode, thresholds }`) for a given hand ('Left' | 'Right'),
 * preferring a hand-specific calibration profile when available and falling back to the shared profile.
 */
function getActiveCalibrationForHand(hand = null) {
  if (hand && handCalibration && handCalibration.perHand && handCalibration.perHand[hand]) {
    const specific = handCalibration.perHand[hand];
    if (Array.isArray(specific.thresholds) && specific.thresholds.length === 5) {
      return specific;
    }
  }
  const thresholds = (handCalibration && Array.isArray(handCalibration.thresholds) && handCalibration.thresholds.length === 5)
    ? handCalibration.thresholds
    : FINGER_PLAY_RATIO_THRESHOLDS;
  const metricMode = (handCalibration && handCalibration.metricMode) || 'ratioToMaxTip';
  return { metricMode, thresholds };
}

/**
 * Applies a custom hand calibration profile (`metricMode` + 5 per-finger `thresholds`,
 * plus optional independent `perHand: { Left, Right }` profiles).
 * Supported `metricMode` values:
 * - `'ratioToMaxTip'`: `dist(tip, wrist[0]) / max(dist(tip_0..4, wrist[0]))`
 * - `'ratioToPalm'`: `dist(tip, wrist[0]) / dist(wrist[0], middleMcp[9])`
 * - `'tipToMcpOverPalm'`: thumb across palm `dist(tip[4], pinkyMcp[17]) / dist(indexMcp[5], pinkyMcp[17])`,
 *    fingers 2–5 curl `dist(tip[i], mcp[i]) / dist(wrist[0], middleMcp[9])`
 */
function applyHandCalibration(calib) {
  if (!calib || typeof calib !== 'object') return handCalibration;
  const base = normalizeHandCalibrationProfile(calib, 'ratioToMaxTip', FINGER_PLAY_RATIO_THRESHOLDS);
  const perHand = { Left: null, Right: null };

  if (calib.perHand && typeof calib.perHand === 'object') {
    if (calib.perHand.Left) {
      perHand.Left = normalizeHandCalibrationProfile(calib.perHand.Left, base.metricMode, base.thresholds);
    }
    if (calib.perHand.Right) {
      perHand.Right = normalizeHandCalibrationProfile(calib.perHand.Right, base.metricMode, base.thresholds);
    }
  }

  handCalibration = { metricMode: base.metricMode, thresholds: base.thresholds, perHand };
  for (let i = 0; i < 5; i++) {
    FINGER_PLAY_RATIO_THRESHOLDS[i] = base.thresholds[i];
  }
  if (typeof window !== 'undefined') {
    window.handCalibration = handCalibration;
  }
  if (typeof document !== 'undefined') {
    const lblCalib = document.getElementById('lbl-calib-status');
    if (lblCalib) {
      if (perHand.Left && perHand.Right) {
        lblCalib.innerText = `Custom (L+R | L:${perHand.Left.metricMode}, R:${perHand.Right.metricMode})`;
      } else if (perHand.Left) {
        lblCalib.innerText = `Custom (L:${perHand.Left.metricMode}: ${perHand.Left.thresholds.map(t => Number(t).toFixed(2)).join('/')})`;
      } else if (perHand.Right) {
        lblCalib.innerText = `Custom (R:${perHand.Right.metricMode}: ${perHand.Right.thresholds.map(t => Number(t).toFixed(2)).join('/')})`;
      } else {
        lblCalib.innerText = `Custom (${base.metricMode}: ${base.thresholds.map(t => Number(t).toFixed(2)).join('/')})`;
      }
    }
  }
  return handCalibration;
}

/**
 * Loads saved hand calibration from localStorage (saved by demo/calibrate.html) if present.
 */
function loadSavedHandCalibration() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(HAND_CALIBRATION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return applyHandCalibration(parsed);
      }
    }
  } catch (e) {
    // Ignore storage read errors in restricted environments
  }
  return handCalibration;
}

/**
 * Computes the 5 continuous scale-invariant finger metric values for `landmarks`
 * under the requested `mode` ('ratioToMaxTip' | 'ratioToPalm' | 'tipToMcpOverPalm').
 * Returns `null` if the hand landmarks collapse to zero size.
 */
function getFingerMetricValues(landmarks, mode = 'ratioToMaxTip') {
  const palm = landmarks[PALM_CENTER_INDEX];
  const tipToWrist = FINGER_TIP_INDICES.map(idx => distance(landmarks[idx], palm));
  const maxTipDist = Math.max(...tipToWrist);

  if (!Number.isFinite(maxTipDist) || maxTipDist <= 1e-6) {
    return null;
  }

  if (mode === 'ratioToPalm') {
    const middleMcp = landmarks[MIDDLE_MCP_INDEX] || palm;
    const palmScale = Math.max(distance(palm, middleMcp), 1e-6);
    return tipToWrist.map(dist => dist / palmScale);
  }

  if (mode === 'tipToMcpOverPalm') {
    const middleMcp = landmarks[MIDDLE_MCP_INDEX] || palm;
    const palmScale = Math.max(distance(palm, middleMcp), 1e-6);
    const indexMcp = landmarks[5] || palm;
    const pinkyMcp = landmarks[17] || palm;
    const palmWidth = Math.max(distance(indexMcp, pinkyMcp), 1e-6);
    return FINGER_TIP_INDICES.map((tipIdx, i) => {
      if (i === 0) {
        return distance(landmarks[tipIdx], pinkyMcp) / palmWidth;
      }
      const mcp = landmarks[FINGER_MCP_INDICES[i]] || palm;
      return distance(landmarks[tipIdx], mcp) / palmScale;
    });
  }

  return tipToWrist.map(dist => dist / maxTipDist);
}

/**
 * Evaluates which of the 5 fingers are in "play" position relative to the hand's scale
 * using the active scale-invariant metric (`ratioToMaxTip`, `ratioToPalm`, or `tipToMcpOverPalm`)
 * and per-finger thresholds (with optional per-hand profile and release hysteresis).
 *
 * Works identically whether 1 hand or 2 hands are detected and regardless of how close or far
 * the hand is from the camera.
 */
function getFingerPlayStates(landmarks, hand = null, prevStates = null) {
  const { metricMode: mode, thresholds } = getActiveCalibrationForHand(hand);
  const values = getFingerMetricValues(landmarks, mode);
  if (!values) {
    return [false, false, false, false, false];
  }

  const releaseHyst = (Array.isArray(prevStates) && prevStates.length === 5)
    ? (FINGER_RELEASE_HYSTERESIS_BY_MODE[mode] || 0.04)
    : 0;

  return values.map((val, i) => {
    const effectiveThreshold = (releaseHyst > 0 && prevStates[i])
      ? thresholds[i] + releaseHyst
      : thresholds[i];
    return val < effectiveThreshold;
  });
}

/**
 * Computes pitch bend in cents from horizontal movement of the right hand's palm center.
 * A horizontal movement of half the camera viewport (0.5) equals 1 tone (2 semitones = 200 cents).
 * Moving to the right (+0.5) bends C4 up by +200 cents to D4.
 * @param {number} currentPalmX - Current normalized horizontal coordinate of landmarks[0]
 * @param {number} noteOnPalmX - Normalized horizontal coordinate of landmarks[0] at Note-On
 * @returns {number} Pitch bend in cents
 */
function computePalmPitchBendCents(currentPalmX, noteOnPalmX) {
  if (!Number.isFinite(currentPalmX) || !Number.isFinite(noteOnPalmX)) return 0;
  const deltaX = currentPalmX - noteOnPalmX;
  return (deltaX / VIEWPORT_HALF_WIDTH) * CENTS_PER_TONE;
}

/**
 * Computes the Left Hand dedicated Wavefolder percentage from vertical movement of the left hand's palm center.
 * - Upward movement (`noteOnPalmY - currentPalmY > 0`) of 25% of the camera viewport (`0.25`)
 *   corresponds to a +40% increase (from 0% to 40%).
 * - Left hand vertical movements never exceed 40% (clamped to `[0, 40]`).
 * @param {number} currentPalmY - Current normalized vertical coordinate of landmarks[0]
 * @param {number} noteOnPalmY - Normalized vertical coordinate of landmarks[0] at Note-On
 * @param {number} [basePercent=0] - Knob percentage at Note-On
 * @returns {number} Wavefolder percentage clamped to [0, 40]
 */
function computeLeftWavefolderPercent(currentPalmY, noteOnPalmY, basePercent = 0) {
  if (!Number.isFinite(currentPalmY) || !Number.isFinite(noteOnPalmY)) {
    return Math.max(0, Math.min(LEFT_WAVEFOLDER_MAX_PERCENT, Math.round(basePercent || 0)));
  }
  const upwardDeltaY = noteOnPalmY - currentPalmY;
  const deltaPercent = (upwardDeltaY / LEFT_WAVEFOLDER_VIEWPORT_HEIGHT) * LEFT_WAVEFOLDER_MAX_PERCENT;
  const rawPercent = (Number(basePercent) || 0) + deltaPercent;
  return Math.max(0, Math.min(LEFT_WAVEFOLDER_MAX_PERCENT, Math.round(rawPercent)));
}

/**
 * Updates the Left Hand Wavefolder knob UI and dedicated Wavefolder DSP (without affecting the shared FX pipeline Wavefolder).
 * @param {number} percent - Percentage value [0..100]
 */
function setLeftWavefolderPercent(percent) {
  const clampedPct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (knobs.droneWavefolder) {
    knobs.droneWavefolder.setValue(clampedPct, true);
  } else {
    updateLeftWavefolderDSP(clampedPct / 100.0);
  }
}

/**
 * Extracts normalized handedness ('Left' or 'Right') and confidence score for hand `index`
 * from MediaPipe results.
 * Because MediaPipe's HandLandmarker assumes a mirrored selfie image by default,
 * its raw 'Left' and 'Right' labels are inverted relative to a standard webcam feed.
 * Therefore, by default (`swapHands === false`), raw 'Left' is mapped to 'Right'
 * and raw 'Right' is mapped to 'Left'. Toggling `#toggle-swap-hands` (`swapHands === true`)
 * switches them back for users whose video camera is already mirrored.
 */
function getHandDetectionInfo(detectionResults, index) {
  const list = (detectionResults && (detectionResults.handednesses || detectionResults.handedness)) || [];
  const entry = list[index];
  let raw = '';
  let score = 1.0;
  if (Array.isArray(entry) && entry[0]) {
    raw = entry[0].categoryName || entry[0].displayName || entry[0].label || '';
    if (Number.isFinite(entry[0].score)) score = entry[0].score;
  } else if (entry && typeof entry === 'object') {
    raw = entry.categoryName || entry.displayName || entry.label || '';
    if (Number.isFinite(entry.score)) score = entry.score;
  } else if (typeof entry === 'string') {
    raw = entry;
  }

  const lower = String(raw).trim().toLowerCase();
  let rawHand;
  let hasLabel = true;
  if (lower.startsWith('l')) {
    rawHand = 'Left';
  } else if (lower.startsWith('r')) {
    rawHand = 'Right';
  } else {
    hasLabel = false;
    score = 0.5;
    rawHand = index === 0 ? 'Right' : 'Left';
  }

  // Switched by default (`swapHands === false`): raw 'Left' -> 'Right', raw 'Right' -> 'Left'
  const category = !swapHands ? (rawHand === 'Left' ? 'Right' : 'Left') : rawHand;
  return { category, score, hasLabel };
}

function getHandCategory(detectionResults, index) {
  return getHandDetectionInfo(detectionResults, index).category;
}

/**
 * Switches Left and Right hand recognition (for mirrored video cameras)
 * and releases any active notes so no notes remain stuck.
 * @param {boolean} swapped
 */
function setHandSwap(swapped) {
  swapHands = Boolean(swapped);
  if (typeof window !== 'undefined') {
    window.swapHands = swapHands;
  }
  panicAllNotesOff();
}

// ============================================================================
// 5. YOUTUBE BACKING VIDEO PLAYER & LEFT-HAND 5-FINGERS-TOGETHER GESTURE
// ============================================================================

/**
 * Extracts the 11-character YouTube video ID from a standard watch, short, or embed URL.
 * @param {string} url
 * @returns {string}
 */
function extractYouTubeVideoId(url) {
  const str = String(url || '').trim();
  if (!str) return '';
  const watchMatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = str.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  return '';
}

function getSelectedYouTubeUrl() {
  if (typeof document !== 'undefined') {
    const select = document.getElementById('youtube-video-select');
    if (select && select.value) {
      selectedYouTubeUrl = select.value;
    }
  }
  return selectedYouTubeUrl || YOUTUBE_VIDEO_URLS[0];
}

function getSelectedYouTubeVideoId() {
  return extractYouTubeVideoId(getSelectedYouTubeUrl());
}

function updateYouTubeStatusLabel(text) {
  if (typeof document === 'undefined') return;
  const lbl = document.getElementById('lbl-youtube-status');
  if (lbl) {
    lbl.innerText = text;
  }
}

function setLeftGestureState(nextState) {
  leftGestureState = nextState;
  if (typeof window !== 'undefined') {
    window.leftGestureState = leftGestureState;
  }
}

/**
 * Computes the rendered dimensions of the camera view (#webcam / .video-viewport-wrapper).
 */
function getCameraViewDimensions() {
  if (typeof document !== 'undefined') {
    const webcam = document.getElementById('webcam');
    if (webcam && typeof webcam.getBoundingClientRect === 'function') {
      const rect = webcam.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    const wrapper = document.querySelector('.video-viewport-wrapper');
    if (wrapper && typeof wrapper.getBoundingClientRect === 'function') {
      const rect = wrapper.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    if (webcam && webcam.videoWidth > 0 && webcam.videoHeight > 0) {
      return { width: webcam.videoWidth, height: webcam.videoHeight };
    }
  }
  return { width: 640, height: 360 };
}

/**
 * Resizes the YouTube thumbnail view to exactly half the size of the camera view on both axes.
 */
function syncYouTubeThumbnailSize() {
  const cam = getCameraViewDimensions();
  const thumbWidth = Math.max(1, Math.round(cam.width / 2));
  const thumbHeight = Math.max(1, Math.round(cam.height / 2));

  if (typeof document !== 'undefined') {
    const container = document.getElementById('youtube-thumbnail-container');
    if (container) {
      container.style.width = `${thumbWidth}px`;
      container.style.height = `${thumbHeight}px`;
    }
  }

  if (youtubePlayer && typeof youtubePlayer.setSize === 'function') {
    try {
      youtubePlayer.setSize(thumbWidth, thumbHeight);
    } catch (err) {
      // Ignore sizing errors before iframe is attached
    }
  }

  return { width: thumbWidth, height: thumbHeight };
}

/**
 * Shows or hides the YouTube thumbnail view.
 * When shown, ensures its width and height are half of the camera view on both axes.
 */
function setYouTubeThumbnailVisible(visible) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('youtube-thumbnail-container');
  if (!container) return;

  if (visible) {
    syncYouTubeThumbnailSize();
    container.classList.remove('is-hidden');
    container.style.display = 'block';
  } else {
    container.classList.add('is-hidden');
    container.style.display = 'none';
  }
}

function createYouTubePlayer(videoId) {
  if (youtubePlayer) return youtubePlayer;
  if (typeof window === 'undefined' || !window.YT || typeof window.YT.Player !== 'function') {
    return null;
  }
  if (typeof document === 'undefined' || !document.getElementById('youtube-player')) {
    return null;
  }

  const size = syncYouTubeThumbnailSize();
  const playerVars = {
    autoplay: 0,
    controls: 1,
    enablejsapi: 1,
    playsinline: 1,
    rel: 0
  };
  if (window.location && window.location.origin && window.location.origin !== 'null') {
    playerVars.origin = window.location.origin;
  }

  const initialVideoId = videoId || getSelectedYouTubeVideoId();
  currentLoadedVideoId = initialVideoId;

  youtubePlayer = new window.YT.Player('youtube-player', {
    width: size.width,
    height: size.height,
    videoId: initialVideoId,
    playerVars,
    events: {
      onReady: () => {
        youtubePlayerReady = true;
        const desiredVideoId = getSelectedYouTubeVideoId();
        if (desiredVideoId && desiredVideoId !== currentLoadedVideoId && typeof youtubePlayer.cueVideoById === 'function') {
          currentLoadedVideoId = desiredVideoId;
          youtubePlayer.cueVideoById(desiredVideoId, 0);
        }
        if (pendingYouTubePlay && youtubeIsPlaying) {
          pendingYouTubePlay = false;
          if (youtubePlayer && typeof youtubePlayer.playVideo === 'function') {
            youtubePlayer.playVideo();
          }
        }
      },
      onStateChange: (event) => {
        const states = (window.YT && window.YT.PlayerState) || { ENDED: 0, PLAYING: 1, PAUSED: 2 };
        const state = event ? event.data : undefined;
        if (state === states.PLAYING) {
          youtubeIsPlaying = true;
          window.youtubeIsPlaying = true;
          setYouTubeThumbnailVisible(true);
          updateYouTubeStatusLabel('Playing');
        } else if (state === states.PAUSED || state === states.ENDED) {
          youtubeIsPlaying = false;
          pendingYouTubePlay = false;
          window.youtubeIsPlaying = false;
          setYouTubeThumbnailVisible(false);
          updateYouTubeStatusLabel(state === states.ENDED ? 'Ended (Paused)' : 'Paused');
        }
      }
    }
  });

  window.youtubePlayer = youtubePlayer;
  return youtubePlayer;
}

function loadYouTubeIframeAPI() {
  if (typeof window === 'undefined') return;
  if (window.YT && typeof window.YT.Player === 'function') {
    createYouTubePlayer(getSelectedYouTubeVideoId());
    return;
  }
  if (youtubeApiRequested) return;
  youtubeApiRequested = true;

  const prevReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (typeof prevReady === 'function') {
      try {
        prevReady();
      } catch (e) {
        // Ignore previous callback error
      }
    }
    createYouTubePlayer(getSelectedYouTubeVideoId());
  };

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    const parent = document.head || document.body;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(script);
    }
  }
}

function playYouTubeVideo() {
  youtubeIsPlaying = true;
  if (typeof window !== 'undefined') {
    window.youtubeIsPlaying = true;
  }
  setYouTubeThumbnailVisible(true);
  updateYouTubeStatusLabel('Playing');

  if (!youtubePlayer) {
    pendingYouTubePlay = true;
    loadYouTubeIframeAPI();
    if (youtubePlayer && youtubePlayerReady && typeof youtubePlayer.playVideo === 'function') {
      pendingYouTubePlay = false;
      youtubePlayer.playVideo();
    }
    return;
  }

  if (youtubePlayerReady && typeof youtubePlayer.playVideo === 'function') {
    pendingYouTubePlay = false;
    youtubePlayer.playVideo();
  } else {
    pendingYouTubePlay = true;
  }
}

function pauseYouTubeVideo() {
  youtubeIsPlaying = false;
  pendingYouTubePlay = false;
  if (typeof window !== 'undefined') {
    window.youtubeIsPlaying = false;
  }
  setYouTubeThumbnailVisible(false);
  updateYouTubeStatusLabel('Paused');

  if (youtubePlayer && youtubePlayerReady && typeof youtubePlayer.pauseVideo === 'function') {
    youtubePlayer.pauseVideo();
  }
}

function toggleYouTubePlayback() {
  if (youtubeIsPlaying) {
    pauseYouTubeVideo();
  } else {
    playYouTubeVideo();
  }
  return youtubeIsPlaying;
}

/**
 * Reloads the currently selected YouTube video back to the beginning (0:00) in pause mode,
 * hides the thumbnail view, and waits for the left hand gesture to start again.
 */
function reloadYouTubeVideo() {
  const videoId = getSelectedYouTubeVideoId();
  youtubeIsPlaying = false;
  pendingYouTubePlay = false;
  if (typeof window !== 'undefined') {
    window.youtubeIsPlaying = false;
  }
  setYouTubeThumbnailVisible(false);
  updateYouTubeStatusLabel('Reloaded (Paused)');

  if (youtubePlayer && youtubePlayerReady) {
    if (typeof youtubePlayer.pauseVideo === 'function') {
      youtubePlayer.pauseVideo();
    }
    if (typeof youtubePlayer.cueVideoById === 'function') {
      currentLoadedVideoId = videoId;
      youtubePlayer.cueVideoById(videoId, 0);
    } else if (typeof youtubePlayer.seekTo === 'function') {
      youtubePlayer.seekTo(0, true);
      if (typeof youtubePlayer.pauseVideo === 'function') {
        youtubePlayer.pauseVideo();
      }
    }
  }
}

function selectYouTubeVideo(url) {
  selectedYouTubeUrl = url || YOUTUBE_VIDEO_URLS[0];
  reloadYouTubeVideo();
  updateYouTubeStatusLabel('Paused');
}

function initYouTubeController() {
  selectedYouTubeUrl = getSelectedYouTubeUrl();
  youtubeIsPlaying = false;
  pendingYouTubePlay = false;
  if (typeof window !== 'undefined') {
    window.youtubeIsPlaying = false;
  }
  setYouTubeThumbnailVisible(false);
  updateYouTubeStatusLabel('Paused');
  loadYouTubeIframeAPI();
}

/**
 * Computes scale-invariant fingertip spread metrics for a hand's 5 fingertips [4, 8, 12, 16, 20].
 * Normalized by handScale = max(distance(wrist[0], middleMcp[9]), distance(indexMcp[5], pinkyMcp[17])).
 */
function computeLeftHandFingertipSpread(landmarks) {
  const wrist = landmarks[PALM_CENTER_INDEX];
  const middleMcp = landmarks[MIDDLE_MCP_INDEX] || wrist;
  const indexMcp = landmarks[5] || wrist;
  const pinkyMcp = landmarks[17] || wrist;
  const palmLength = distance(wrist, middleMcp);
  const palmWidth = distance(indexMcp, pinkyMcp);
  const handScale = Math.max(palmLength, palmWidth, 1e-6);

  let maxPair = 0;
  let sumPair = 0;
  let pairCount = 0;
  for (let i = 0; i < FINGER_TIP_INDICES.length; i++) {
    for (let j = i + 1; j < FINGER_TIP_INDICES.length; j++) {
      const d = distance(landmarks[FINGER_TIP_INDICES[i]], landmarks[FINGER_TIP_INDICES[j]]);
      if (d > maxPair) maxPair = d;
      sumPair += d;
      pairCount++;
    }
  }

  return {
    handScale,
    maxPairRatio: maxPair / handScale,
    avgPairRatio: (sumPair / pairCount) / handScale
  };
}

/**
 * Returns true when the left hand is open (all 5 fingertips spread apart and none playing notes).
 */
function isLeftHandOpenForGesture(landmarks, plays) {
  if (!Array.isArray(plays) || plays.some(Boolean)) return false;
  const spread = computeLeftHandFingertipSpread(landmarks);
  return (
    spread.maxPairRatio >= LEFT_GESTURE_OPEN_MAX_PAIR_RATIO &&
    spread.avgPairRatio >= LEFT_GESTURE_OPEN_AVG_PAIR_RATIO
  );
}

/**
 * Returns true when all 5 fingertips of the left hand are brought close together.
 */
function areAllFiveFingersTogether(landmarks) {
  const spread = computeLeftHandFingertipSpread(landmarks);
  return (
    spread.maxPairRatio <= LEFT_GESTURE_TOGETHER_MAX_PAIR_RATIO &&
    spread.avgPairRatio <= LEFT_GESTURE_TOGETHER_AVG_PAIR_RATIO
  );
}

/**
 * Tracks the Left Hand transition from Open Hand -> All 5 Fingers Together
 * to toggle YouTube video Play / Pause.
 * @returns {boolean} True if playback was toggled on this frame
 */
function updateLeftHandYouTubeGesture(landmarks, plays) {
  if (isLeftHandOpenForGesture(landmarks, plays)) {
    setLeftGestureState('armed_open');
    return false;
  }

  if (areAllFiveFingersTogether(landmarks)) {
    if (leftGestureState === 'armed_open') {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      setLeftGestureState('triggered_together');
      if (nowMs - lastYouTubeGestureToggleMs >= YOUTUBE_GESTURE_COOLDOWN_MS) {
        lastYouTubeGestureToggleMs = nowMs;
        toggleYouTubePlayback();
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// 6. HAND NOTE-ON / NOTE-OFF MANAGEMENT
// ============================================================================

function updateStatusLabels() {
  if (typeof document === 'undefined') return;
  const lblLeft = document.getElementById('lbl-left-status');
  const lblRight = document.getElementById('lbl-right-status');
  const lblBend = document.getElementById('lbl-pitch-bend');

  if (lblLeft) {
    lblLeft.innerText = leftActiveFinger !== null ? LEFT_HAND_NOTE_NAMES[leftActiveFinger] : 'No notes';
  }
  if (lblRight) {
    const activeNames = [];
    for (let i = 0; i < 5; i++) {
      if (rightActiveFingers[i]) activeNames.push(RIGHT_HAND_NOTE_NAMES[i]);
    }
    lblRight.innerText = activeNames.length > 0 ? activeNames.join(', ') : 'No notes';
  }
  if (lblBend) {
    const cents = Math.round(rightSynthParams.pitchBendCents || 0);
    const sign = cents > 0 ? '+' : '';
    lblBend.innerText = `${sign}${cents} ct`;
  }
}

/**
 * Stops active notes for the Left Hand (Fractal Synth) without resetting the YouTube gesture state.
 * Note: Does NOT reset the Left Hand Wavefolder knob to 0% between notes.
 */
function stopLeftHandSynthNotes() {
  if (leftActiveFinger !== null && leftVoiceManager) {
    leftVoiceManager.stopNote(LEFT_HAND_NOTES[leftActiveFinger], false, leftSynthParams);
  }
  if (leftVoiceManager && leftVoiceManager.activeVoices.size > 0) {
    leftVoiceManager.allNotesOff(leftSynthParams);
  }
  leftActiveFinger = null;
  leftNoteOnPalmY = null;
  leftPrevPlays = [false, false, false, false, false];
  leftPendingStealCounts = [0, 0, 0, 0, 0];
  updateStatusLabels();
}

/**
 * Turns all notes off for the Left Hand (Fractal Synth) and resets the Left Hand gesture state.
 * Note: Does NOT reset the Left Hand Wavefolder knob to 0% between notes.
 */
function releaseLeftHandNotes() {
  stopLeftHandSynthNotes();
  setLeftGestureState('idle');
}

/**
 * Turns all notes off for the Right Hand (Bowed Violin String Synth).
 */
function releaseRightHandNotes() {
  if (rightVoiceManager) {
    for (let i = 0; i < 5; i++) {
      if (rightActiveFingers[i]) {
        rightVoiceManager.stopNote(RIGHT_HAND_NOTES[i], false, rightSynthParams);
      }
    }
    if (rightVoiceManager.activeVoices.size > 0) {
      rightVoiceManager.allNotesOff(rightSynthParams);
    }
  }
  rightActiveFingers = [false, false, false, false, false];
  rightNoteOnPalmX = [null, null, null, null, null];
  rightSynthParams.pitchBendCents = 0;
  updateStatusLabels();
}

/**
 * Immediately turns all notes off on both synthesizers.
 */
function panicAllNotesOff() {
  releaseLeftHandNotes();
  releaseRightHandNotes();
  lastHandTracking = { Left: null, Right: null };
}

/**
 * Processes the Left Hand landmarks:
 * - Monophonic Fractal Synth (Seahorse Valley Pad)
 * - Finger 1..5 -> C3, B2, A2, G2, F2
 * - No pitch bend on the left hand
 * - Vertical palm movement (`landmarks[0].y`) controls the Left Hand's dedicated Wavefolder knob
 *   only while a note is playing (25% upward viewport movement = 0% -> 40%, clamped at 40%,
 *   and does not reset to 0% between notes).
 * - Open Hand -> All 5 Fingers Together gesture toggles YouTube video Play / Pause.
 */
function processLeftHand(landmarks, canvasCtx, isNewVideoFrame = true) {
  if (!areFingertipsVisible(landmarks)) {
    releaseLeftHandNotes();
    return;
  }

  const activeCalib = getActiveCalibrationForHand('Left');
  const metricValues = getFingerMetricValues(landmarks, activeCalib.metricMode);
  // Apply release hysteresis only to the currently playing monophonic finger so held notes
  // resist upward jitter without making inactive fingers artificially sticky.
  const leftHystStates = [false, false, false, false, false];
  if (leftActiveFinger !== null) {
    leftHystStates[leftActiveFinger] = true;
  }
  const plays = getFingerPlayStates(landmarks, 'Left', leftHystStates);
  updateLeftHandYouTubeGesture(landmarks, plays);

  // When all 5 fingertips are brought close together, suppress synth notes so the gesture cleanly controls video
  if (areAllFiveFingersTogether(landmarks)) {
    stopLeftHandSynthNotes();
    if (canvasCtx) {
      for (let i = 0; i < 5; i++) {
        drawFinger(canvasCtx, landmarks[FINGER_TIP_INDICES[i]], true);
      }
      drawFinger(canvasCtx, landmarks[PALM_CENTER_INDEX], true);
    }
    updateStatusLabels();
    return;
  }

  const currentPalmY = landmarks[PALM_CENTER_INDEX].y;
  const decisiveMargin = LEFT_STEAL_DECISIVE_MARGIN_BY_MODE[activeCalib.metricMode] || 0.04;

  // Normalized curl depth below threshold so that when multiple fingers read active
  // (e.g., deeply curled Pinky F2 with sympathetically drooping Ring G2), the most deeply
  // curled finger wins instead of blindly favoring lower finger indices.
  const getCurlDepth = (idx) => {
    if (!metricValues) return 0;
    const thresh = activeCalib.thresholds[idx] || 1e-6;
    return (thresh - metricValues[idx]) / Math.max(thresh, 1e-6);
  };

  const pickDeepestFinger = (candidates) => {
    if (!candidates || candidates.length === 0) return null;
    let best = candidates[0];
    let bestDepth = getCurlDepth(best);
    for (let k = 1; k < candidates.length; k++) {
      const idx = candidates[k];
      const depth = getCurlDepth(idx);
      if (depth > bestDepth + 1e-9) {
        best = idx;
        bestDepth = depth;
      }
    }
    return best;
  };

  // Monophonic voice selection with borderline steal debounce:
  // - If a finger newly transitions from inactive -> active while another finger is held,
  //   a decisive curl triggers immediately, whereas a borderline dip right near the threshold
  //   (such as sympathetic Ring/G2 droop while holding Pinky/F2) must persist for
  //   LEFT_BORDERLINE_DEBOUNCE_FRAMES consecutive new video frames before stealing the voice.
  // - If no finger is currently held (or the active finger was released), select the most deeply
  //   curled active finger immediately.
  const isHoldingActiveFinger = leftActiveFinger !== null && plays[leftActiveFinger];
  let nextFinger = leftActiveFinger;
  const newlyPressedCandidates = [];
  const nextPrevPlays = [...plays];

  if (isHoldingActiveFinger) {
    leftPendingStealCounts[leftActiveFinger] = 0;
    for (let i = 0; i < 5; i++) {
      if (i === leftActiveFinger) continue;
      if (plays[i] && !leftPrevPlays[i]) {
        const marginBelow = metricValues ? (activeCalib.thresholds[i] - metricValues[i]) : decisiveMargin;
        if (marginBelow >= decisiveMargin) {
          leftPendingStealCounts[i] = 0;
          newlyPressedCandidates.push(i);
        } else {
          if (isNewVideoFrame) {
            leftPendingStealCounts[i] = Math.min(LEFT_BORDERLINE_DEBOUNCE_FRAMES, leftPendingStealCounts[i] + 1);
          }
          if (leftPendingStealCounts[i] >= LEFT_BORDERLINE_DEBOUNCE_FRAMES) {
            leftPendingStealCounts[i] = 0;
            newlyPressedCandidates.push(i);
          } else {
            // Keep prev state false while pending debounce so subsequent frames continue confirming
            nextPrevPlays[i] = false;
          }
        }
      } else {
        leftPendingStealCounts[i] = 0;
      }
    }

    if (newlyPressedCandidates.length > 0) {
      nextFinger = pickDeepestFinger(newlyPressedCandidates);
    }
  } else {
    leftPendingStealCounts = [0, 0, 0, 0, 0];
    const activeCandidates = [];
    for (let i = 0; i < 5; i++) {
      if (plays[i]) activeCandidates.push(i);
    }
    nextFinger = pickDeepestFinger(activeCandidates);
  }

  if (nextFinger !== leftActiveFinger) {
    leftPendingStealCounts = [0, 0, 0, 0, 0];
    if (nextFinger !== null) {
      nextPrevPlays[nextFinger] = true;
    }
  }
  leftPrevPlays = nextPrevPlays;

  if (nextFinger !== leftActiveFinger) {
    if (leftActiveFinger !== null && leftVoiceManager) {
      leftVoiceManager.stopNote(LEFT_HAND_NOTES[leftActiveFinger], false, leftSynthParams);
    }
    if (nextFinger !== null) {
      ensureAudioEngine();
      // Left hand never applies pitch bend
      leftSynthParams.pitchBendCents = 0;
      // Anchor vertical palm position & current wavefolder knob percentage at Note-On (do not reset to 0%)
      leftNoteOnPalmY = currentPalmY;
      leftNoteOnWavefolderPct = knobs.droneWavefolder
        ? knobs.droneWavefolder.val
        : Math.round((leftSynthParams.wavefolder || 0) * 100);
      updateLeftWavefolderDSP(leftNoteOnWavefolderPct / 100.0);
      leftVoiceManager.playNote(LEFT_HAND_NOTES[nextFinger], 0.85, leftSynthParams);
    } else {
      leftNoteOnPalmY = null;
    }
    leftActiveFinger = nextFinger;
  } else if (leftActiveFinger !== null && leftNoteOnPalmY !== null) {
    // Modulate Left Hand dedicated Wavefolder knob with vertical palm movement only while a note is playing
    const targetPct = computeLeftWavefolderPercent(currentPalmY, leftNoteOnPalmY, leftNoteOnWavefolderPct);
    setLeftWavefolderPercent(targetPct);
  }

  // Draw the 5 fingertip locations & palm center location on the overlay canvas
  if (canvasCtx) {
    for (let i = 0; i < 5; i++) {
      drawFinger(canvasCtx, landmarks[FINGER_TIP_INDICES[i]], i === leftActiveFinger);
    }
    drawFinger(canvasCtx, landmarks[PALM_CENTER_INDEX], true);
  }

  updateStatusLabels();
}

/**
 * Processes the Right Hand landmarks:
 * - Polyphonic Bowed Violin String Synth
 * - Finger 1..5 -> C4, D4, E4, F4, G4
 * - Horizontal movement of palm center (landmarks[0].x) from its Note-On position
 *   bends pitch by 1 tone (200 cents) per half camera viewport (0.5).
 */
function processRightHand(landmarks, canvasCtx) {
  if (!areFingertipsVisible(landmarks)) {
    releaseRightHandNotes();
    return;
  }

  const plays = getFingerPlayStates(landmarks, 'Right', rightActiveFingers);
  const currentPalmX = landmarks[PALM_CENTER_INDEX].x;

  // Draw the 5 fingertip locations & palm center location on the overlay canvas
  if (canvasCtx) {
    for (let i = 0; i < 5; i++) {
      drawFinger(canvasCtx, landmarks[FINGER_TIP_INDICES[i]], plays[i]);
    }
    drawFinger(canvasCtx, landmarks[PALM_CENTER_INDEX], true);
  }

  let latestBendCents = 0;
  let anyActive = false;

  for (let i = 0; i < 5; i++) {
    const note = RIGHT_HAND_NOTES[i];
    const isPlaying = plays[i];

    if (isPlaying) {
      anyActive = true;
      if (!rightActiveFingers[i]) {
        // Note On: store palm center horizontal position at the time of Note-On
        ensureAudioEngine();
        rightActiveFingers[i] = true;
        rightNoteOnPalmX[i] = currentPalmX;
        rightVoiceManager.playNote(note, 0.85, {
          ...rightSynthParams,
          pitchBendCents: 0,
          noteOnPalmX: currentPalmX
        });
      } else {
        // Sustain + Pitch Bend based on horizontal movement from Note-On palm position
        const bendCents = computePalmPitchBendCents(currentPalmX, rightNoteOnPalmX[i]);
        latestBendCents = bendCents;
        if (rightVoiceManager) {
          rightVoiceManager.setNotePitchBend(note, bendCents, rightSynthParams);
        }
      }
    } else {
      if (rightActiveFingers[i]) {
        // Note Off for this finger
        if (rightVoiceManager) {
          rightVoiceManager.stopNote(note, false, rightSynthParams);
        }
        rightActiveFingers[i] = false;
        rightNoteOnPalmX[i] = null;
      }
    }
  }

  rightSynthParams.pitchBendCents = anyActive ? latestBendCents : 0;
  updateStatusLabels();
}

/**
 * Assigns up to 2 detected hands to Left and Right slots safely without swapping them when
 * MediaPipe outputs duplicate or flipped handedness labels on noisy frames.
 * Resolution order:
 * 1. Clean distinct handedness labels (with simultaneous 1-frame flip guard via wrist continuity)
 * 2. On duplicate labels: nearest-neighbor spatial continuity to recent Left/Right wrist positions,
 *    then MediaPipe handedness confidence score, then camera-orientation horizontal (x) order.
 * 3. On a single visible hand: guard against 1-frame misclassification if the wrist sits directly
 *    on the recently tracked opposite hand's position.
 */
function assignDetectedHands(detectionResults, nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
  const visibleHands = [];
  if (detectionResults && Array.isArray(detectionResults.landmarks) && detectionResults.landmarks.length > 0) {
    const count = Math.min(2, detectionResults.landmarks.length);
    for (let i = 0; i < count; i++) {
      const landmarks = detectionResults.landmarks[i];
      if (!areFingertipsVisible(landmarks)) continue;
      const info = getHandDetectionInfo(detectionResults, i);
      visibleHands.push({
        index: i,
        landmarks,
        wrist: landmarks[PALM_CENTER_INDEX],
        category: info.category,
        score: info.score,
        hasLabel: info.hasLabel
      });
    }
  }

  const getRecentTrack = (side) => {
    const entry = lastHandTracking[side];
    if (!entry) return null;
    if (nowMs - entry.timeMs > HAND_TRACKING_MEMORY_MS) return null;
    return entry;
  };

  const prevLeft = getRecentTrack('Left');
  const prevRight = getRecentTrack('Right');

  let assignedLeft = null;
  let assignedRight = null;

  if (visibleHands.length === 2) {
    const [h0, h1] = visibleHands;
    if (h0.category !== h1.category) {
      assignedLeft = h0.category === 'Left' ? h0 : h1;
      assignedRight = h0.category === 'Right' ? h0 : h1;

      // Guard against an unmistakable simultaneous Left<->Right handedness flip while both wrists stayed put
      if (
        prevLeft && prevRight &&
        distance(prevLeft, prevRight) > 0.18 &&
        distance(assignedRight.wrist, prevLeft) < 0.12 &&
        distance(assignedLeft.wrist, prevRight) < 0.12
      ) {
        const tmp = assignedLeft;
        assignedLeft = assignedRight;
        assignedRight = tmp;
      }
    } else {
      // Duplicate handedness from MediaPipe (both 'Left' or both 'Right'):
      // Resolve via spatial continuity first, then confidence score, then viewport horizontal order.
      let h0IsLeft;
      if (prevLeft && prevRight) {
        const cost01 = distance(h0.wrist, prevLeft) + distance(h1.wrist, prevRight);
        const cost10 = distance(h1.wrist, prevLeft) + distance(h0.wrist, prevRight);
        h0IsLeft = cost01 <= cost10;
      } else if (prevLeft) {
        h0IsLeft = distance(h0.wrist, prevLeft) <= distance(h1.wrist, prevLeft);
      } else if (prevRight) {
        h0IsLeft = distance(h1.wrist, prevRight) < distance(h0.wrist, prevRight);
      } else if (Math.abs(h0.score - h1.score) > 0.05) {
        h0IsLeft = h0.category === 'Left' ? (h0.score >= h1.score) : (h0.score < h1.score);
      } else {
        // In standard unmirrored webcam coordinates (swapHands === false), user's Left hand has larger raw x;
        // in hardware-mirrored cameras (swapHands === true), user's Left hand has smaller raw x.
        h0IsLeft = swapHands ? (h0.wrist.x <= h1.wrist.x) : (h0.wrist.x >= h1.wrist.x);
      }

      if (h0IsLeft) {
        assignedLeft = h0;
        assignedRight = h1;
      } else {
        assignedLeft = h1;
        assignedRight = h0;
      }
    }
  } else if (visibleHands.length === 1) {
    const h0 = visibleHands[0];
    let resolvedCategory = h0.category;

    // Guard against a single visible hand getting misclassified when its wrist sits squarely
    // on the recently tracked opposite hand's position (and far from the claimed hand's position).
    if (
      resolvedCategory === 'Left' &&
      prevRight &&
      distance(h0.wrist, prevRight) < 0.12 &&
      (!prevLeft || distance(h0.wrist, prevLeft) > 0.20)
    ) {
      resolvedCategory = 'Right';
    } else if (
      resolvedCategory === 'Right' &&
      prevLeft &&
      distance(h0.wrist, prevLeft) < 0.12 &&
      (!prevRight || distance(h0.wrist, prevRight) > 0.20)
    ) {
      resolvedCategory = 'Left';
    }

    if (resolvedCategory === 'Left') {
      assignedLeft = h0;
    } else {
      assignedRight = h0;
    }
  }

  if (assignedLeft) {
    lastHandTracking.Left = { x: assignedLeft.wrist.x, y: assignedLeft.wrist.y, timeMs: nowMs };
  }
  if (assignedRight) {
    lastHandTracking.Right = { x: assignedRight.wrist.x, y: assignedRight.wrist.y, timeMs: nowMs };
  }

  return {
    leftLandmarks: assignedLeft ? assignedLeft.landmarks : null,
    rightLandmarks: assignedRight ? assignedRight.landmarks : null
  };
}

/**
 * Processes a full MediaPipe HandLandmarker detection result for up to 2 hands.
 * Any hand whose fingertips are no longer detected or visible has all its notes turned off.
 */
function processHandDetectionResults(detectionResults, canvasCtx, isNewVideoFrame = true) {
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { leftLandmarks, rightLandmarks } = assignDetectedHands(detectionResults, nowMs);

  if (leftLandmarks) {
    processLeftHand(leftLandmarks, canvasCtx, isNewVideoFrame);
  } else {
    releaseLeftHandNotes();
  }

  if (rightLandmarks) {
    processRightHand(rightLandmarks, canvasCtx);
  } else {
    releaseRightHandNotes();
  }
}

// ============================================================================
// 6. MEDIAPIPE WEBCAM SETUP & 60 FPS PREDICTION LOOP
// ============================================================================
async function createHandLandmarker() {
  let HandLandmarkerCls = typeof window !== 'undefined' ? window.HandLandmarker : undefined;
  let FilesetResolverCls = typeof window !== 'undefined' ? window.FilesetResolver : undefined;

  if (!HandLandmarkerCls || !FilesetResolverCls) {
    try {
      const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0');
      HandLandmarkerCls = visionModule.HandLandmarker;
      FilesetResolverCls = visionModule.FilesetResolver;
    } catch (err) {
      console.warn('MediaPipe Tasks Vision module could not be loaded:', err);
      return null;
    }
  }

  const vision = await FilesetResolverCls.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
  );
  handLandmarker = await HandLandmarkerCls.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.85,
    minHandPresenceConfidence: 0.80,
    minTrackingConfidence: 0.75
  });

  if (typeof window !== 'undefined') {
    window.handLandmarker = handLandmarker;
  }
  return handLandmarker;
}

const hasGetUserMedia = () => {
  return Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
};

async function enableCam() {
  if (!handLandmarker) {
    setTimeout(enableCam, 100);
    return;
  }

  if (!hasGetUserMedia()) {
    console.warn('getUserMedia() is not supported by your browser');
    return;
  }

  const video = document.getElementById('webcam');
  if (!video) return;

  const constraints = { video: true };
  navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    video.srcObject = stream;
    video.addEventListener('loadeddata', () => {
      syncYouTubeThumbnailSize();
      predictWebcam();
    });
  }).catch((err) => {
    console.warn('Webcam access declined or unavailable:', err);
  });

  if (typeof handLandmarker.setOptions === 'function') {
    await handLandmarker.setOptions({
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.85,
      minHandPresenceConfidence: 0.80,
      minTrackingConfidence: 0.75
    });
  }
}

async function predictWebcam() {
  const video = document.getElementById('webcam');
  const canvasElement = document.getElementById('output_canvas');
  if (!video || !canvasElement) return;
  const canvasCtx = canvasElement.getContext('2d');

  if (video.videoWidth && video.videoHeight) {
    canvasElement.style.width = video.videoWidth;
    canvasElement.style.height = video.videoHeight;
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
  }

  const startTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let isNewVideoFrame = false;
  if (handLandmarker && lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    results = handLandmarker.detectForVideo(video, startTimeMs);
    isNewVideoFrame = true;
  }

  if (canvasCtx) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    processHandDetectionResults(results, canvasCtx, isNewVideoFrame);
    canvasCtx.restore();
  } else {
    processHandDetectionResults(results, null, isNewVideoFrame);
  }

  // Advance Hyper-Drone 60 FPS swirl wavetable when Left Hand is playing a note
  if (isAudioStarted && leftVoiceManager && leftVoiceManager.activeVoices.size > 0) {
    leftVoiceManager.updateDroneWaves(leftSynthParams, startTimeMs);
  }

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(predictWebcam);
  }
}

// ============================================================================
// 7. ROTARY KNOBS & UI EVENT WIRING
// ============================================================================
function initAllKnobs() {
  const bindKnob = RotaryKnob.bind;

  // Left Hand: Fractal Synth (Seahorse Valley Pad) Controls
  knobs.droneMorph = bindKnob('knob-drone-morph', 0, 100, Math.round(leftSynthParams.droneMorph * 100), 1, '%', (v) => {
    leftSynthParams.droneMorph = v / 100.0;
    if (leftVoiceManager) leftVoiceManager.updateActiveVoices(leftSynthParams);
  });

  knobs.droneSwirl = bindKnob('knob-drone-swirl', 0.01, 2.0, leftSynthParams.droneSwirlRate, 0.01, ' Hz', (v) => {
    leftSynthParams.droneSwirlRate = v;
    if (leftVoiceManager) leftVoiceManager.updateActiveVoices(leftSynthParams);
  });

  knobs.droneWavefolder = bindKnob('knob-drone-wavefolder', 0, 100, Math.round((leftSynthParams.wavefolder || 0) * 100), 1, '%', (v) => {
    updateLeftWavefolderDSP(v / 100.0);
  });

  // Right Hand: Bowed Violin String Physical Synthesis Engine Controls
  knobs.bowPressure = bindKnob('knob-bow-pressure', 5, 100, Math.round(rightSynthParams.bowPressure * 100), 1, '%', (v) => {
    rightSynthParams.bowPressure = v / 100.0;
    throttledRightVoiceBufferUpdate();
  });

  knobs.bowVelocity = bindKnob('knob-bow-velocity', 5, 100, Math.round(rightSynthParams.bowVelocity * 100), 1, '%', (v) => {
    rightSynthParams.bowVelocity = v / 100.0;
    throttledRightVoiceBufferUpdate();
  });

  knobs.bowPosition = bindKnob('knob-bow-position', 3, 45, Math.round(rightSynthParams.bowPosition * 100), 1, '%', (v) => {
    rightSynthParams.bowPosition = v / 100.0;
    throttledRightVoiceBufferUpdate();
  });

  knobs.rosinGrit = bindKnob('knob-rosin-grit', 0, 100, Math.round(rightSynthParams.rosinGrit * 100), 1, '%', (v) => {
    rightSynthParams.rosinGrit = v / 100.0;
    throttledRightVoiceBufferUpdate();
  });

  // Shared Studio Audio Effects Pipeline Controls (Fractal Synth defaults)
  knobs.filterCutoff = bindKnob('knob-filter-cutoff', 50, 16000, fxFilterParams.cutoff, 10, ' Hz', (v) => {
    fxFilterParams.cutoff = v;
    if (fxEngine) fxEngine.updateParams(null, fxFilterParams);
  });

  knobs.filterRes = bindKnob('knob-filter-res', 0.1, 15.0, fxFilterParams.resonance, 0.1, '', (v) => {
    fxFilterParams.resonance = v;
    if (fxEngine) fxEngine.updateParams(null, fxFilterParams);
  });

  knobs.fxDrive = bindKnob('knob-fx-drive', 0, 100, Math.round(fxParams.driveAmount * 100), 1, '%', (v) => {
    fxParams.driveAmount = v / 100.0;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });

  knobs.fxChorusMix = bindKnob('knob-fx-chorus-mix', 0, 100, Math.round(fxParams.chorusMix * 100), 1, '%', (v) => {
    fxParams.chorusMix = v / 100.0;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });

  knobs.fxDelayMix = bindKnob('knob-fx-delay-mix', 0, 100, Math.round(fxParams.delayMix * 100), 1, '%', (v) => {
    fxParams.delayMix = v / 100.0;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });

  knobs.fxDelayTime = bindKnob('knob-fx-delay-time', 50, 1000, fxParams.delayTime, 10, ' ms', (v) => {
    fxParams.delayTime = v;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });

  knobs.fxDelayFeedback = bindKnob('knob-fx-delay-feedback', 0, 90, Math.round(fxParams.delayFeedback * 100), 1, '%', (v) => {
    fxParams.delayFeedback = v / 100.0;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });

  knobs.fxReverbMix = bindKnob('knob-fx-reverb-mix', 0, 100, Math.round(fxParams.reverbMix * 100), 1, '%', (v) => {
    fxParams.reverbMix = v / 100.0;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });

  knobs.fxReverbSize = bindKnob('knob-fx-reverb-size', 0.5, 5.0, fxParams.reverbSize, 0.1, 's', (v) => {
    fxParams.reverbSize = v;
    if (fxEngine) fxEngine.updateParams(fxParams, null);
  });
}

function setupUIEventListeners() {
  const btnStart = document.getElementById('btn-audio-start-v2');
  if (btnStart) {
    btnStart.addEventListener('click', (e) => {
      initAudioEngine();
      if (e.target && e.target.blur) e.target.blur();
    });
  }

  const youtubeSelect = document.getElementById('youtube-video-select');
  if (youtubeSelect) {
    youtubeSelect.addEventListener('change', (e) => {
      selectYouTubeVideo(e.target.value);
      if (e.target && e.target.blur) e.target.blur();
    });
  }

  const btnYouTubeReload = document.getElementById('btn-youtube-reload');
  if (btnYouTubeReload) {
    btnYouTubeReload.addEventListener('click', (e) => {
      reloadYouTubeVideo();
      if (e.target && e.target.blur) e.target.blur();
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', syncYouTubeThumbnailSize);
  }

  const toggleSwapHands = document.getElementById('toggle-swap-hands');
  if (toggleSwapHands) {
    toggleSwapHands.addEventListener('change', (e) => {
      setHandSwap(Boolean(e.target.checked));
      if (e.target && e.target.blur) e.target.blur();
    });
  }

  const filterTypeSelect = document.getElementById('filter-type-select-v2');
  if (filterTypeSelect) {
    filterTypeSelect.addEventListener('change', (e) => {
      fxFilterParams.filterType = e.target.value;
      if (fxEngine) fxEngine.updateParams(null, fxFilterParams);
      if (e.target && e.target.blur) e.target.blur();
    });
  }

  const toggleMasterFX = document.getElementById('toggle-fx-master-v2');
  if (toggleMasterFX) {
    toggleMasterFX.addEventListener('change', (e) => {
      fxParams.fxEnabled = e.target.checked;
      if (fxEngine) {
        fxEngine.setMasterFXBypass(!e.target.checked, fxParams, fxFilterParams);
      }
      if (e.target && e.target.blur) e.target.blur();
    });
  }

  const volSlider = document.getElementById('master-volume-v2');
  const volLabel = document.getElementById('volume-val-v2');
  if (volSlider) {
    volSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      fxFilterParams.masterVolume = val / 100.0;
      if (volLabel) volLabel.innerText = `${val}%`;
      if (audioBus) {
        audioBus.setMasterVolume(fxFilterParams.masterVolume);
      }
    });
  }
}

function bootstrapDemoApp() {
  loadSavedHandCalibration();
  initAllKnobs();
  setupUIEventListeners();
  initYouTubeController();
  createHandLandmarker().then(() => {
    enableCam();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapDemoApp);
  } else {
    bootstrapDemoApp();
  }
}
