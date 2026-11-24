/**
 * Unit & Integration Tests for the Dual-Hand Air Synth Demo (`demo/`)
 * Run with: node --test demo/tests/demo.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDemoTestEnv, buildHandLandmarks, buildLeftGestureHand } = require('./test-harness.js');

describe('1. Self-Contained Demo Structure & No Web MIDI', () => {
  it('loads all scripts from within the demo/ folder', () => {
    const env = createDemoTestEnv();
    assert.ok(env.loadedScripts.length >= 16);
    for (const relPath of env.loadedScripts) {
      assert.ok(!relPath.startsWith('..'), `Script ${relPath} must live inside demo/`);
      const fullPath = path.join(__dirname, '..', relPath);
      assert.ok(fs.existsSync(fullPath), `Missing file in demo/: ${relPath}`);
    }
  });

  it('contains no Web MIDI code or MIDI DOM elements in demo/', () => {
    const env = createDemoTestEnv();
    assert.equal(env.doc.getElementById('midi-led'), null);
    assert.equal(env.doc.getElementById('midi-status-text'), null);
    assert.ok(!/requestMIDIAccess/i.test(env.htmlContent));

    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(!/requestMIDIAccess/i.test(appJs));
    assert.ok(!/onMIDIMessage/i.test(appJs));
  });
});

describe('2. MediaPipe 2-Hand Recognition & Video Overlay Dots', () => {
  it('initializes MediaPipe HandLandmarker with numHands: 2 in VIDEO mode', async () => {
    const env = createDemoTestEnv();
    await new Promise(resolve => setTimeout(resolve, 10));

    const created = env.getCreatedLandmarkerOptions();
    assert.ok(created, 'HandLandmarker.createFromOptions should be called');
    assert.equal(created.options.runningMode, 'VIDEO');
    assert.equal(created.options.numHands, 2);
    assert.equal(created.options.minHandDetectionConfidence, 0.85);
    assert.equal(created.options.minHandPresenceConfidence, 0.80);
    assert.equal(created.options.minTrackingConfidence, 0.75);

    const setOpts = env.getSetOptionsCalls();
    assert.ok(setOpts.length >= 1);
    assert.equal(setOpts[0].numHands, 2);
    assert.equal(setOpts[0].minHandDetectionConfidence, 0.85);
    assert.equal(setOpts[0].minHandPresenceConfidence, 0.80);
    assert.equal(setOpts[0].minTrackingConfidence, 0.75);
  });

  it('calculates scale-invariant fingertip-to-palm distance ratios (< 0.60 for thumb, < 0.75 for fingers 2-5) consistent at any camera distance', () => {
    const env = createDemoTestEnv();
    const d = env.evaluate('distance({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 })');
    assert.ok(Math.abs(d - 0.5) < 1e-9);

    // 1. Open hand moved far away from the camera (scale = 0.25 -> all fingertip distances = 0.1125):
    //    Because all 5 fingers are never assumed playing at once, all ratios are 1.0 -> NO fingers falsely play!
    const openHandFar = buildHandLandmarks({
      palmX: 0.5,
      palmY: 0.7,
      activeFingers: [false, false, false, false, false],
      scale: 0.25
    });
    const farOpenStates = env.evaluate(`getFingerPlayStates(${JSON.stringify(openHandFar)})`);
    assert.deepEqual(Array.from(farOpenStates), [false, false, false, false, false]);

    // 2. Playing fingers at close camera distance (scale = 1.2) vs far camera distance (scale = 0.25)
    //    yields the exact same play states for both 1-hand and 2-hand configurations
    const closePlay = buildHandLandmarks({
      palmX: 0.5,
      palmY: 0.7,
      activeFingers: [true, false, true, false, false],
      scale: 1.2
    });
    const farPlay = buildHandLandmarks({
      palmX: 0.5,
      palmY: 0.7,
      activeFingers: [true, false, true, false, false],
      scale: 0.25
    });
    assert.deepEqual(
      Array.from(env.evaluate(`getFingerPlayStates(${JSON.stringify(closePlay)})`)),
      [true, false, true, false, false]
    );
    assert.deepEqual(
      Array.from(env.evaluate(`getFingerPlayStates(${JSON.stringify(farPlay)})`)),
      [true, false, true, false, false]
    );

    // 3. Ratio threshold distinction between Thumb (< 0.60 of maxDistance) and Index (< 0.75 of maxDistance):
    //    With maxDistance = 0.50 (from extended fingers 3..5), a distance of 0.33 has ratio 0.33 / 0.50 = 0.66:
    //    -> Thumb (0.66 >= 0.60) is inactive, while Index (0.66 < 0.75) is active!
    const handCustom = buildHandLandmarks({ palmX: 0.5, palmY: 0.7, activeFingers: [false, false, false, false, false] });
    handCustom[12] = { x: 0.5, y: 0.20, z: 0 }; // distance = 0.50 (maxDistance)
    handCustom[16] = { x: 0.5, y: 0.20, z: 0 }; // distance = 0.50
    handCustom[20] = { x: 0.5, y: 0.20, z: 0 }; // distance = 0.50
    handCustom[4] = { x: 0.5, y: 0.37, z: 0 };  // distance = 0.33 -> ratio 0.66 >= 0.60 -> thumb false
    handCustom[8] = { x: 0.5, y: 0.37, z: 0 };  // distance = 0.33 -> ratio 0.66 < 0.75  -> index true
    const statesCustom = env.evaluate(`getFingerPlayStates(${JSON.stringify(handCustom)})`);
    assert.deepEqual(Array.from(statesCustom), [false, true, false, false, false]);
  });

  it('draws 10x10 fingertip and palm center dots on #output_canvas (#FF0000 active, #00FF00 inactive)', async () => {
    const env = createDemoTestEnv();
    await new Promise(resolve => setTimeout(resolve, 10));

    const canvas = env.doc.getElementById('output_canvas');
    assert.ok(canvas, '#output_canvas must exist');
    const ctx = canvas.getContext('2d');
    ctx.drawCalls.length = 0;

    const leftHand = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    const rightHand = buildHandLandmarks({ palmX: 0.7, palmY: 0.7, activeFingers: [false, true, false, true, false] });

    env.setDetectionResult({
      landmarks: [leftHand, rightHand],
      handednesses: [
        [{ categoryName: 'Right' }],
        [{ categoryName: 'Left' }]
      ]
    });

    const video = env.doc.getElementById('webcam');
    video.currentTime = 1.0;
    await env.evaluate('predictWebcam()');

    const fillRects = ctx.drawCalls.filter(c => c.op === 'fillRect');
    // 2 hands * (5 fingertips + 1 palm center) = 12 dots
    assert.equal(fillRects.length, 12);

    const redDots = fillRects.filter(c => c.fillStyle === '#FF0000');
    const greenDots = fillRects.filter(c => c.fillStyle === '#00FF00');
    // Left hand: 1 active finger + 1 palm center = 2 red, 4 green
    // Right hand: 2 active fingers + 1 palm center = 3 red, 3 green
    assert.equal(redDots.length, 5);
    assert.equal(greenDots.length, 7);
  });
});

describe('3. Left Hand — Fractal Synth (Seahorse Valley Pad, Monophonic, C3–F2, No Pitch Bend)', () => {
  let env;

  beforeEach(() => {
    env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
  });

  it('uses only the Seahorse Valley Pad preset (Hyper-Drone mode) with Swirl LFO default = 0.05 Hz, Dual Morph = 45%, and Wavefolder = 0%', () => {
    const mode = env.evaluate('leftSynthParams.mode');
    const morph = env.evaluate('leftSynthParams.droneMorph');
    const swirl = env.evaluate('leftSynthParams.droneSwirlRate');
    const wavefolder = env.evaluate('leftSynthParams.wavefolder');
    const maxPoly = env.evaluate('leftVoiceManager.maxPolyphony');

    assert.equal(mode, 'drone');
    assert.equal(morph, 0.45);
    assert.equal(swirl, 0.05);
    assert.equal(wavefolder, 0.0);
    assert.equal(maxPoly, 1);

    // Verify UI knob labels match defaults
    const morphKnob = env.doc.getElementById('knob-drone-morph');
    const swirlKnob = env.doc.getElementById('knob-drone-swirl');
    const wavefolderKnob = env.doc.getElementById('knob-drone-wavefolder');
    assert.ok(morphKnob);
    assert.ok(swirlKnob);
    assert.ok(wavefolderKnob);
    assert.equal(morphKnob.querySelector('.knob-val').innerText, '45%');
    assert.equal(swirlKnob.querySelector('.knob-val').innerText, '0.05 Hz');
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '0%');
  });

  it('maps Left Hand fingers 1..5 to C3 (48), B2 (47), A2 (45), G2 (43), F2 (41)', () => {
    const expectedNotes = [48, 47, 45, 43, 41];
    const expectedNames = ['C3', 'B2', 'A2', 'G2', 'F2'];

    for (let f = 0; f < 5; f++) {
      const activeFingers = [false, false, false, false, false];
      activeFingers[f] = true;
      const lm = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers });

      env.evaluate(`processLeftHand(${JSON.stringify(lm)}, null)`);

      const activeKeys = env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())');
      assert.deepEqual(activeKeys, [expectedNotes[f]]);
      assert.equal(env.doc.getElementById('lbl-left-status').innerText, expectedNames[f]);

      // Release before testing next finger
      const releasedLm = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [false, false, false, false, false] });
      env.evaluate(`processLeftHand(${JSON.stringify(releasedLm)}, null)`);
      env.flushTimeouts();
      assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 0);
    }
  });

  it('enforces monophony on the Left Hand so only one finger plays at a time', () => {
    // Finger 1 (C3 = 48) plays first
    const lm1 = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(lm1)}, null)`);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [48]);

    // While Finger 1 is still held, Finger 3 (A2 = 45) also closes -> switches monophonically to A2 (45)
    const lm2 = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, false, true, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(lm2)}, null)`);
    env.flushTimeouts();
    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 1);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [45]);

    // Even if 4 fingers on the left hand close simultaneously, only 1 voice is active
    const lmFour = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, true, true, true, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(lmFour)}, null)`);
    env.flushTimeouts();
    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 1);
  });

  it('applies no pitch bend on the Left Hand and does not impact Right Hand pitch bend when Left palm moves', () => {
    // Start Left Hand Finger 1 (C3 = 48) at palmX = 0.2 and Right Hand Finger 1 (C4 = 60) at palmX = 0.5
    // Note: By default, MediaPipe raw handedness is switched (raw 'Right' -> Left Hand, raw 'Left' -> Right Hand)
    const leftLm1 = buildHandLandmarks({ palmX: 0.2, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    const rightLm1 = buildHandLandmarks({ palmX: 0.5, palmY: 0.7, activeFingers: [true, false, false, false, false] });

    env.evaluate('processHandDetectionResults( { landmarks: ' + JSON.stringify([leftLm1, rightLm1]) + ', handednesses: [[{categoryName:"Right"}],[{categoryName:"Left"}]] }, null)');

    const c3BaseFreq = env.evaluate('leftVoiceManager.activeVoices.get(48).unisonNodes[2].osc.frequency.value');
    const c3BaseDetune = env.evaluate('leftVoiceManager.activeVoices.get(48).unisonNodes[2].osc.detune.value');

    // Move Left Hand palm horizontally by +0.5 (from 0.2 to 0.7), keeping Right Hand palm fixed at 0.5
    const leftLmMoved = buildHandLandmarks({ palmX: 0.7, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    env.evaluate('processHandDetectionResults( { landmarks: ' + JSON.stringify([leftLmMoved, rightLm1]) + ', handednesses: [[{categoryName:"Right"}],[{categoryName:"Left"}]] }, null)');

    const c3AfterFreq = env.evaluate('leftVoiceManager.activeVoices.get(48).unisonNodes[2].osc.frequency.value');
    const c3AfterDetune = env.evaluate('leftVoiceManager.activeVoices.get(48).unisonNodes[2].osc.detune.value');
    const leftBend = env.evaluate('leftSynthParams.pitchBendCents');
    const rightBend = env.evaluate('rightSynthParams.pitchBendCents');
    const rightVoiceBend = env.evaluate('rightVoiceManager.activeVoices.get(60).pitchBendCents');

    assert.equal(leftBend, 0);
    assert.equal(c3AfterFreq, c3BaseFreq);
    assert.equal(c3AfterDetune, c3BaseDetune);
    assert.equal(rightBend, 0);
    assert.equal(rightVoiceBend, 0);
  });

  it('modulates the Left Hand dedicated Wavefolder knob with vertical palm movement (25% upward = 0%->40%, max 40%, only while playing, without resetting between notes)', () => {
    const wavefolderKnob = env.doc.getElementById('knob-drone-wavefolder');
    const fxDriveKnob = env.doc.getElementById('knob-fx-drive');

    // 1. Moving left palm vertically when NO note is playing does not change the knob
    const idleBottom = buildHandLandmarks({ palmX: 0.3, palmY: 0.85, activeFingers: [false, false, false, false, false] });
    const idleTop = buildHandLandmarks({ palmX: 0.3, palmY: 0.50, activeFingers: [false, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(idleBottom)}, null)`);
    env.evaluate(`processLeftHand(${JSON.stringify(idleTop)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.0);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '0%');

    // 2. Start playing Finger 1 (C3 = 48) with palm at y = 0.80
    const note1Start = buildHandLandmarks({ palmX: 0.3, palmY: 0.80, activeFingers: [true, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(note1Start)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.0);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '0%');

    // 3. Move upward by 12.5% of viewport height (from y = 0.80 to y = 0.675) -> knob reaches 20%
    const note1HalfUp = buildHandLandmarks({ palmX: 0.3, palmY: 0.675, activeFingers: [true, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(note1HalfUp)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.20);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '20%');
    assert.ok(Math.abs(env.evaluate('leftWavefolder.driveWetGain.gain.value') - 0.80) < 1e-6);
    assert.ok(Math.abs(env.evaluate('leftWavefolder.preDriveGain.gain.value') - 2.8) < 1e-6);

    // 4. Move upward by 25% of viewport height from Note-On (from y = 0.80 to y = 0.55) -> knob reaches 40%
    const note1FullUp = buildHandLandmarks({ palmX: 0.3, palmY: 0.55, activeFingers: [true, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(note1FullUp)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.40);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '40%');
    assert.ok(Math.abs(env.evaluate('leftWavefolder.preDriveGain.gain.value') - 4.6) < 1e-6);
    assert.equal(env.evaluate('leftWavefolder.driveWetGain.gain.value'), 1.0);
    assert.ok(Math.abs(env.evaluate('leftWavefolder.driveDryGain.gain.value') - 0.50) < 1e-6);

    // Shared FX pipeline Wavefolder knob (#knob-fx-drive) must remain untouched at 0%
    assert.equal(env.evaluate('fxParams.driveAmount'), 0.0);
    assert.equal(fxDriveKnob.querySelector('.knob-val').innerText, '0%');

    // 5. Move upward even higher (from y = 0.80 to y = 0.48, i.e., 32% upward) -> clamped at 40% (never goes over 40%)
    const note1OverUp = buildHandLandmarks({ palmX: 0.3, palmY: 0.48, activeFingers: [true, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(note1OverUp)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.40);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '40%');

    // 6. Release Note 1 and move hand while no note is playing -> knob does NOT reset to 0% and does NOT change while silent
    const released = buildHandLandmarks({ palmX: 0.3, palmY: 0.85, activeFingers: [false, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(released)}, null)`);
    env.flushTimeouts();
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.40);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '40%');

    // 7. Play a second note (Finger 2 = B2 = 47) starting at y = 0.55 -> starts at 40% (not reset to 0%),
    //    and moving downward by 12.5% (to y = 0.675) brings the knob from 40% down to 20%
    const note2Start = buildHandLandmarks({ palmX: 0.3, palmY: 0.55, activeFingers: [false, true, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(note2Start)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.40);

    const note2Down = buildHandLandmarks({ palmX: 0.3, palmY: 0.675, activeFingers: [false, true, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(note2Down)}, null)`);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.20);
    assert.equal(wavefolderKnob.querySelector('.knob-val').innerText, '20%');
  });
});

describe('4. Right Hand — Bowed Violin Synth (Polyphonic C4–G4 + Palm Horizontal Pitch Bend)', () => {
  let env;

  beforeEach(() => {
    env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
  });

  it('maps Right Hand fingers 1..5 to C4 (60), D4 (62), E4 (64), F4 (65), G4 (67) and supports polyphonic chords across camera distances', () => {
    // Activate fingers 1..4 (C4, D4, E4, F4) while finger 5 remains extended as the scale reference
    const rightFirstFour = buildHandLandmarks({
      palmX: 0.5,
      palmY: 0.7,
      activeFingers: [true, true, true, true, false],
      scale: 0.30
    });

    env.evaluate(`processRightHand(${JSON.stringify(rightFirstFour)}, null)`);

    const activeNotes = env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())');
    assert.deepEqual(activeNotes, [60, 62, 64, 65]);
    assert.equal(env.doc.getElementById('lbl-right-status').innerText, 'C4, D4, E4, F4');

    // Switch to fingers 1 (C4=60), 3 (E4=64), 5 (G4=67) while fingers 2 and 4 are extended
    const rightSubset = buildHandLandmarks({
      palmX: 0.5,
      palmY: 0.7,
      activeFingers: [true, false, true, false, true],
      scale: 1.15
    });
    env.evaluate(`processRightHand(${JSON.stringify(rightSubset)}, null)`);
    env.flushTimeouts();

    const remainingNotes = env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())');
    assert.deepEqual(remainingNotes, [60, 64, 67]);
    assert.equal(env.doc.getElementById('lbl-right-status').innerText, 'C4, E4, G4');
  });

  it('bends pitch by +1 tone (+200 cents, C4 toward D4) when palm center moves right by half the viewport (+0.5)', () => {
    // 1. Trigger Finger 1 (Thumb = C4, MIDI 60) with palm center at x = 0.25
    const noteOnHand = buildHandLandmarks({
      palmX: 0.25,
      palmY: 0.7,
      activeFingers: [true, false, false, false, false]
    });
    env.evaluate(`processRightHand(${JSON.stringify(noteOnHand)}, null)`);

    // Center unison buffer node (index 1 for unisonCount = 3) has detuneRatio = 0
    const initialRate = env.evaluate('rightVoiceManager.activeVoices.get(60).bufferNodes[1].bufNode.playbackRate.value');
    assert.ok(Math.abs(initialRate - 1.0) < 1e-6);

    // 2. Move palm center horizontally to the right by +0.5 (from 0.25 to 0.75 = half of camera viewport)
    const bentRightHand = buildHandLandmarks({
      palmX: 0.75,
      palmY: 0.7,
      activeFingers: [true, false, false, false, false]
    });
    env.evaluate(`processRightHand(${JSON.stringify(bentRightHand)}, null)`);

    const bendCents = env.evaluate('rightVoiceManager.activeVoices.get(60).pitchBendCents');
    assert.ok(Math.abs(bendCents - 200) < 1e-6, `Expected +200 cents (1 tone), got ${bendCents}`);

    // Verify playbackRate scales C4 frequency toward D4 (2^(200/1200) = 2^(1/6) ≈ 1.122462)
    const expectedRatio = Math.pow(2, 200 / 1200);
    const bentRate = env.evaluate('rightVoiceManager.activeVoices.get(60).bufferNodes[1].bufNode.playbackRate.value');
    assert.ok(Math.abs(bentRate - expectedRatio) < 1e-4, `Expected playbackRate ${expectedRatio}, got ${bentRate}`);
    assert.equal(env.doc.getElementById('lbl-pitch-bend').innerText, '+200 ct');

    // 3. Move palm center to the left by -0.25 from Note-On (0.25 -> 0.0) => -100 cents (-1 semitone)
    const bentLeftHand = buildHandLandmarks({
      palmX: 0.0,
      palmY: 0.7,
      activeFingers: [true, false, false, false, false]
    });
    env.evaluate(`processRightHand(${JSON.stringify(bentLeftHand)}, null)`);
    const negBendCents = env.evaluate('rightVoiceManager.activeVoices.get(60).pitchBendCents');
    assert.ok(Math.abs(negBendCents - (-100)) < 1e-6);
  });

  it('tracks Note-On palm center position independently for each finger on the Right Hand', () => {
    // Finger 1 (C4 = 60) turns on when palmX = 0.20
    const step1 = buildHandLandmarks({
      palmX: 0.20,
      palmY: 0.7,
      activeFingers: [true, false, false, false, false]
    });
    env.evaluate(`processRightHand(${JSON.stringify(step1)}, null)`);

    // Hand moves to palmX = 0.45 (+0.25 = +100 cents for Finger 1) and Finger 2 (D4 = 62) turns on at 0.45
    const step2 = buildHandLandmarks({
      palmX: 0.45,
      palmY: 0.7,
      activeFingers: [true, true, false, false, false]
    });
    env.evaluate(`processRightHand(${JSON.stringify(step2)}, null)`);

    // Hand moves to palmX = 0.70 (+0.50 = +200 cents for Finger 1; +0.25 = +100 cents for Finger 2)
    const step3 = buildHandLandmarks({
      palmX: 0.70,
      palmY: 0.7,
      activeFingers: [true, true, false, false, false]
    });
    env.evaluate(`processRightHand(${JSON.stringify(step3)}, null)`);

    const bendC4 = env.evaluate('rightVoiceManager.activeVoices.get(60).pitchBendCents');
    const bendD4 = env.evaluate('rightVoiceManager.activeVoices.get(62).pitchBendCents');
    assert.ok(Math.abs(bendC4 - 200) < 1e-6);
    assert.ok(Math.abs(bendD4 - 100) < 1e-6);
  });
});

describe('5. Disappearing Hand / Fingertips & Hand Mirror Switch', () => {
  let env;

  beforeEach(() => {
    env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
  });

  it('switches MediaPipe raw Left/Right hands by default and allows toggling #toggle-swap-hands for mirrored cameras', () => {
    const handA = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    const handB = buildHandLandmarks({ palmX: 0.7, palmY: 0.7, activeFingers: [false, true, true, false, false] });

    // 1. By default (swapHands === false), MediaPipe raw 'Right' -> Left Hand (Mono C3=48)
    //    and MediaPipe raw 'Left' -> Right Hand (Poly D4=62, E4=64)
    assert.equal(env.evaluate('swapHands'), false);
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([handA, handB])},
      handednesses: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]]
    }, null)`);

    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [48]);
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [62, 64]);

    // 2. Toggle #toggle-swap-hands (Mirror Mode) ON -> immediately turns off active notes and switches mapping
    const toggleSwap = env.doc.getElementById('toggle-swap-hands');
    assert.ok(toggleSwap, '#toggle-swap-hands must exist');
    toggleSwap.checked = true;
    toggleSwap.dispatchEvent({ type: 'change' });
    env.flushTimeouts();

    assert.equal(env.evaluate('swapHands'), true);
    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 0);
    assert.equal(env.evaluate('rightVoiceManager.activeVoices.size'), 0);

    // 3. With Mirror Mode ON (swapHands === true), MediaPipe raw 'Left' -> Left Hand and raw 'Right' -> Right Hand
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([handA, handB])},
      handednesses: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]]
    }, null)`);

    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [48]);
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [62, 64]);
  });

  it('turns off all notes for a hand when that hand disappears from the camera feed', () => {
    const leftHand = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    const rightHand = buildHandLandmarks({ palmX: 0.7, palmY: 0.7, activeFingers: [true, true, false, false, false] });

    // Both hands visible and playing (by default raw 'Right' -> Left Hand, raw 'Left' -> Right Hand)
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([leftHand, rightHand])},
      handednesses: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]]
    }, null)`);

    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 1);
    assert.equal(env.evaluate('rightVoiceManager.activeVoices.size'), 2);

    // Right hand disappears from frame, Left hand remains visible
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([leftHand])},
      handednesses: [[{ categoryName: 'Right' }]]
    }, null)`);
    env.flushTimeouts();

    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 1);
    assert.equal(env.evaluate('rightVoiceManager.activeVoices.size'), 0);

    // Left hand also disappears (empty detection result)
    env.evaluate(`processHandDetectionResults({ landmarks: [], handednesses: [] }, null)`);
    env.flushTimeouts();

    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 0);
    assert.equal(env.evaluate('rightVoiceManager.activeVoices.size'), 0);
  });

  it('turns off all notes for a hand when any of its fingertips go outside the camera viewport', () => {
    const rightHand = buildHandLandmarks({ palmX: 0.5, palmY: 0.7, activeFingers: [true, true, true, false, false] });
    env.evaluate(`processRightHand(${JSON.stringify(rightHand)}, null)`);
    assert.equal(env.evaluate('rightVoiceManager.activeVoices.size'), 3);

    // Pinky fingertip (landmark 20) moves outside the camera viewport (x > 1.0)
    const clippedRightHand = buildHandLandmarks({ palmX: 0.5, palmY: 0.7, activeFingers: [true, true, true, false, false] });
    clippedRightHand[20] = { x: 1.25, y: 0.5, z: 0 };
    env.evaluate(`processRightHand(${JSON.stringify(clippedRightHand)}, null)`);
    env.flushTimeouts();

    assert.equal(env.evaluate('rightVoiceManager.activeVoices.size'), 0);
    assert.equal(env.doc.getElementById('lbl-right-status').innerText, 'No notes');
  });

  it('removes the old big red PANIC button (#btn-panic) from the UI', () => {
    assert.equal(env.doc.getElementById('btn-panic'), null);
  });
});

describe('6. UI Controls & Shared Studio Audio Effects Pipeline', () => {
  let env;

  beforeEach(() => {
    env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
  });

  it('exposes the requested Left Hand, Right Hand, and Studio FX controls with Fractal Synth defaults', () => {
    // Left Hand controls: Dual Morph (45%), Swirl LFO (0.05 Hz), dedicated Wavefolder (0%)
    assert.equal(env.evaluate('leftSynthParams.droneMorph'), 0.45);
    assert.equal(env.evaluate('leftSynthParams.droneSwirlRate'), 0.05);
    assert.equal(env.evaluate('leftSynthParams.wavefolder'), 0.0);

    // Right Hand controls: Bow Force (55%), Bow Speed (65%), Bow Pos (11%), Rosin Grit (20%)
    assert.equal(env.evaluate('rightSynthParams.bowPressure'), 0.55);
    assert.equal(env.evaluate('rightSynthParams.bowVelocity'), 0.65);
    assert.equal(env.evaluate('rightSynthParams.bowPosition'), 0.11);
    assert.equal(env.evaluate('rightSynthParams.rosinGrit'), 0.20);

    // Studio Audio Effects Pipeline defaults (matching Fractal Synth, with general Wavefolder = 0%)
    assert.equal(env.evaluate('fxFilterParams.filterType'), 'lowpass');
    assert.equal(env.evaluate('fxFilterParams.cutoff'), 4500);
    assert.equal(env.evaluate('fxFilterParams.resonance'), 1.2);
    assert.equal(env.evaluate('fxParams.driveAmount'), 0.0);
    assert.equal(env.evaluate('fxParams.chorusMix'), 0.25);
    assert.equal(env.evaluate('fxParams.delayMix'), 0.20);
    assert.equal(env.evaluate('fxParams.delayTime'), 350);
    assert.equal(env.evaluate('fxParams.delayFeedback'), 0.40);
    assert.equal(env.evaluate('fxParams.reverbMix'), 0.30);
    assert.equal(env.evaluate('fxParams.reverbSize'), 2.5);
  });

  it('routes Left Hand through its dedicated Wavefolder and both synthesizers into the shared Studio Audio Effect Pipeline', () => {
    const sameFxNode = env.evaluate(
      'leftVoiceManager.fxEngine === rightVoiceManager.fxEngine && leftVoiceManager.audioBus === rightVoiceManager.audioBus'
    );
    assert.equal(sameFxNode, true);

    const entryIsFilter = env.evaluate('audioBus.getVoiceEntryNode() === fxEngine.filterNode');
    assert.equal(entryIsFilter, true);

    // Play a note on each hand:
    // Left Hand -> leftWavefolder.inputNode -> leftWavefolder.outputNode -> fxEngine.filterNode
    // Right Hand -> fxEngine.filterNode directly
    const leftHand = buildHandLandmarks({ palmX: 0.3, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    const rightHand = buildHandLandmarks({ palmX: 0.7, palmY: 0.7, activeFingers: [true, false, false, false, false] });
    env.evaluate(`processLeftHand(${JSON.stringify(leftHand)}, null)`);
    env.evaluate(`processRightHand(${JSON.stringify(rightHand)}, null)`);

    const leftConnectedToDedicatedWavefolder = env.evaluate(
      'leftVoiceManager.activeVoices.get(48).voiceGain.connections[0].dest === leftWavefolder.inputNode'
    );
    const dedicatedWavefolderFeedsFxPipeline = env.evaluate(
      'leftWavefolder.outputNode.connections[0].dest === fxEngine.filterNode'
    );
    const rightConnectedDirectlyToFx = env.evaluate(
      'rightVoiceManager.activeVoices.get(60).voiceGain.connections[0].dest === fxEngine.filterNode'
    );
    assert.equal(leftConnectedToDedicatedWavefolder, true);
    assert.equal(dedicatedWavefolderFeedsFxPipeline, true);
    assert.equal(rightConnectedDirectlyToFx, true);
  });

  it('updates synth and FX parameters when rotary knobs and FX controls are adjusted', () => {
    // Adjust Left Hand Swirl LFO knob via mousewheel
    const swirlKnob = env.doc.getElementById('knob-drone-swirl');
    swirlKnob.dispatchEvent({ type: 'wheel', deltaY: -10 });
    assert.equal(env.evaluate('leftSynthParams.droneSwirlRate'), 0.06);

    // Adjust Right Hand Bow Force knob via mousewheel
    const bowForceKnob = env.doc.getElementById('knob-bow-pressure');
    bowForceKnob.dispatchEvent({ type: 'wheel', deltaY: -10 });
    assert.equal(env.evaluate('rightSynthParams.bowPressure'), 0.56);

    // Adjust Filter Cutoff knob via mousewheel
    const cutoffKnob = env.doc.getElementById('knob-filter-cutoff');
    cutoffKnob.dispatchEvent({ type: 'wheel', deltaY: -10 });
    assert.equal(env.evaluate('fxFilterParams.cutoff'), 4510);
    assert.equal(env.evaluate('fxEngine.filterNode.frequency.value'), 4510);

    // Toggle Master FX bypass
    const toggleFx = env.doc.getElementById('toggle-fx-master-v2');
    toggleFx.checked = false;
    toggleFx.dispatchEvent({ type: 'change' });
    assert.equal(env.evaluate('fxParams.fxEnabled'), false);
    assert.equal(env.evaluate('fxEngine.chorusWetGain.gain.value'), 0);
  });

  it('scales Wavefolder curve & wet/dry progressively from 0% -> 1% (subtle) -> 20% (moderate) -> 40%+', () => {
    const measureCurveDeviation = (amt) => env.evaluate(`(() => {
      leftWavefolder.updateCurve(${amt});
      leftWavefolder.setMix(${amt}, false);
      const curve = leftWavefolder.wavefolderNode.curve;
      let maxDiff = 0;
      for (let i = 0; i < curve.length; i++) {
        const x = (i * 2) / curve.length - 1;
        maxDiff = Math.max(maxDiff, Math.abs(curve[i] - x));
      }
      return {
        maxDiff,
        wet: leftWavefolder.driveWetGain.gain.value,
        dry: leftWavefolder.driveDryGain.gain.value,
        preDrive: leftWavefolder.preDriveGain.gain.value
      };
    })()`);

    const at0 = measureCurveDeviation(0.0);
    const at1 = measureCurveDeviation(0.01);
    const at20 = measureCurveDeviation(0.20);
    const at40 = measureCurveDeviation(0.40);

    // 0% is clean linear bypass
    assert.ok(at0.maxDiff < 1e-6);
    assert.equal(at0.wet, 0.0);
    assert.equal(at0.dry, 1.0);
    assert.equal(at0.preDrive, 1.0);

    // 1% is genuinely subtle (tiny curve deviation and low wet mix, no harsh jump)
    assert.ok(at1.maxDiff > 0 && at1.maxDiff < 0.05);
    assert.ok(at1.wet > 0 && at1.wet <= 0.05);
    assert.ok(at1.preDrive < 1.15);

    // 20% reaches substantial folding & 80% wet mix, and 40% deepens further
    assert.ok(at20.maxDiff > 0.5 && at20.maxDiff > at1.maxDiff * 10);
    assert.ok(Math.abs(at20.wet - 0.80) < 1e-6);
    assert.ok(at40.maxDiff >= at20.maxDiff);
    assert.equal(at40.wet, 1.0);
  });
});

describe('7. DSP Synthesis Engines (HyperDroneEngine & BowedViolinEngine)', () => {
  it('generates normalized PeriodicWave harmonic spectra for the Seahorse Valley Pad (HyperDroneEngine)', () => {
    const env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
    const waveInfo = env.evaluate(`(() => {
      const wave = HyperDroneEngine.createDroneWave(audioCtx, leftSynthParams, 1000);
      let maxMag = 0;
      for (let k = 1; k < wave.real.length; k++) {
        const mag = Math.hypot(wave.real[k], wave.imag[k]);
        if (mag > maxMag) maxMag = mag;
      }
      return { length: wave.real.length, dcReal: wave.real[0], dcImag: wave.imag[0], maxMag };
    })()`);

    assert.equal(waveInfo.length, 256);
    assert.equal(waveInfo.dcReal, 0);
    assert.equal(waveInfo.dcImag, 0);
    assert.ok(waveInfo.maxMag > 0.5 && waveInfo.maxMag < 2.5);
  });

  it('synthesizes a stereo looped physical-modeling AudioBuffer for BowedViolinEngine', () => {
    const env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
    const bufInfo = env.evaluate(`(() => {
      const buf = BowedViolinEngine.generateBowedStringBuffer(audioCtx, 261.63, rightSynthParams);
      const chL = buf.getChannelData(0);
      const chR = buf.getChannelData(1);
      let peakL = 0;
      let peakR = 0;
      for (let i = 0; i < chL.length; i++) {
        if (Math.abs(chL[i]) > peakL) peakL = Math.abs(chL[i]);
        if (Math.abs(chR[i]) > peakR) peakR = Math.abs(chR[i]);
      }
      return { channels: buf.numberOfChannels, length: buf.length, peakL, peakR };
    })()`);

    assert.equal(bufInfo.channels, 2);
    assert.ok(bufInfo.length > 20000);
    assert.ok(bufInfo.peakL > 0.1 && bufInfo.peakL <= 1.0);
    assert.ok(bufInfo.peakR > 0.1 && bufInfo.peakR <= 1.0);
  });

  it('supports custom hand calibration profiles (ratioToMaxTip, ratioToPalm, tipToMcpOverPalm)', () => {
    const env = createDemoTestEnv();
    const hand = buildHandLandmarks({
      palmX: 0.5,
      palmY: 0.7,
      activeFingers: [true, false, true, false, false]
    });

    // Apply custom ratioToMaxTip calibration
    const calib1 = env.evaluate(`applyHandCalibration({
      metricMode: 'ratioToMaxTip',
      thresholds: [0.65, 0.78, 0.78, 0.78, 0.78]
    })`);
    assert.equal(calib1.metricMode, 'ratioToMaxTip');
    assert.deepEqual(Array.from(env.evaluate(`getFingerPlayStates(${JSON.stringify(hand)})`)), [true, false, true, false, false]);
    assert.ok(env.doc.getElementById('lbl-calib-status').innerText.includes('Custom'));
  });
});

describe('8. YouTube Video Dropdown, Reload Button, Thumbnail View & Left-Hand 5-Fingers-Together Gesture', () => {
  const EXPECTED_URLS = [
    'https://www.youtube.com/watch?v=xeqUit1EHIw',
    'https://www.youtube.com/watch?v=trzD7Eqq2xA',
    'https://www.youtube.com/watch?v=KatkfHwpawg',
    'https://www.youtube.com/watch?v=hEVxMDI5c94'
  ];

  it('replaces the PANIC button with the YouTube URL dropdown (first selected by default), small reload button, and hidden thumbnail view', () => {
    const env = createDemoTestEnv();
    assert.equal(env.doc.getElementById('btn-panic'), null);

    const select = env.doc.getElementById('youtube-video-select');
    const btnReload = env.doc.getElementById('btn-youtube-reload');
    const thumb = env.doc.getElementById('youtube-thumbnail-container');

    assert.ok(select, '#youtube-video-select must exist');
    assert.ok(btnReload, '#btn-youtube-reload must exist');
    assert.ok(thumb, '#youtube-thumbnail-container must exist');

    const optionValues = select.options.map(o => o.value);
    assert.deepEqual(optionValues, EXPECTED_URLS);
    assert.equal(select.value, EXPECTED_URLS[0]);
    assert.equal(select.options[0].selected, true);

    // Initially paused and thumbnail hidden
    assert.equal(env.evaluate('youtubeIsPlaying'), false);
    assert.equal(thumb.style.display, 'none');
    assert.equal(thumb.classList.contains('is-hidden'), true);

    // Mock YT player initialized with the first video ID
    const players = env.getYouTubePlayers();
    assert.equal(players.length, 1);
    assert.equal(players[0].videoId, 'xeqUit1EHIw');
  });

  it('triggers play on Left Hand Open -> All 5 Fingers Together, displays thumbnail at half camera view on both axes, and pauses & hides thumbnail when shown again', () => {
    const env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');

    // Set explicit camera dimensions (640x480) to verify half-size on both axes (320x240)
    const webcam = env.doc.getElementById('webcam');
    webcam.width = 640;
    webcam.height = 480;

    const thumb = env.doc.getElementById('youtube-thumbnail-container');
    const player = env.getYouTubePlayers()[0];
    const openHand = buildLeftGestureHand({ pose: 'open' });
    const togetherHand = buildLeftGestureHand({ pose: 'together' });

    // 1. Entering the frame already with all 5 fingers together (without open hand first) must NOT trigger playback
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), false);
    assert.equal(thumb.style.display, 'none');

    // 2. Open left hand -> arms the gesture
    env.evaluate(`processLeftHand(${JSON.stringify(openHand)}, null)`);
    assert.equal(env.evaluate('leftGestureState'), 'armed_open');
    assert.equal(env.evaluate('youtubeIsPlaying'), false);

    // 3. Move all 5 fingers together -> starts playing YouTube video & displays half-size thumbnail (320x240)
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), true);
    assert.equal(env.evaluate('leftGestureState'), 'triggered_together');
    assert.equal(player.calls.filter(c => c.method === 'playVideo').length, 1);
    assert.equal(thumb.style.display, 'block');
    assert.equal(thumb.classList.contains('is-hidden'), false);
    assert.equal(thumb.style.width, '320px');
    assert.equal(thumb.style.height, '240px');
    assert.equal(player.width, 320);
    assert.equal(player.height, 240);

    // Ensure the 5-fingers-together gesture did not leave any Left Hand synth notes playing
    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 0);

    // 4. Holding all 5 fingers together across subsequent frames must NOT toggle/pause
    env.advanceTime(500);
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), true);
    assert.equal(player.calls.filter(c => c.method === 'pauseVideo').length, 0);

    // 5. Open hand again -> re-arms, video continues playing
    env.evaluate(`processLeftHand(${JSON.stringify(openHand)}, null)`);
    assert.equal(env.evaluate('leftGestureState'), 'armed_open');
    assert.equal(env.evaluate('youtubeIsPlaying'), true);

    // 6. All 5 fingers together again -> pauses video & hides thumbnail view
    env.advanceTime(500);
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), false);
    assert.equal(player.calls.filter(c => c.method === 'pauseVideo').length, 1);
    assert.equal(thumb.style.display, 'none');
    assert.equal(thumb.classList.contains('is-hidden'), true);
  });

  it('reload button puts the video back to the beginning (0:00) in pause mode, hides thumbnail, and waits for left hand gesture to start again', () => {
    const env = createDemoTestEnv();
    const thumb = env.doc.getElementById('youtube-thumbnail-container');
    const btnReload = env.doc.getElementById('btn-youtube-reload');
    const player = env.getYouTubePlayers()[0];
    const openHand = buildLeftGestureHand({ pose: 'open' });
    const togetherHand = buildLeftGestureHand({ pose: 'together' });

    // Start playing via left hand gesture
    env.evaluate(`processLeftHand(${JSON.stringify(openHand)}, null)`);
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), true);
    assert.equal(thumb.style.display, 'block');
    player.currentTime = 42;

    // Click Reload button -> paused at 0:00, thumbnail hidden
    btnReload.click();
    assert.equal(env.evaluate('youtubeIsPlaying'), false);
    assert.equal(thumb.style.display, 'none');
    assert.equal(thumb.classList.contains('is-hidden'), true);
    assert.equal(player.currentTime, 0);
    assert.equal(player.playerState, 5); // CUED (paused at beginning)
    const cueCalls = player.calls.filter(c => c.method === 'cueVideoById');
    assert.ok(cueCalls.length >= 1);
    assert.equal(cueCalls[cueCalls.length - 1].videoId, 'xeqUit1EHIw');
    assert.equal(cueCalls[cueCalls.length - 1].startSeconds, 0);

    // Left hand gesture (open -> all 5 fingers together) starts playing again
    env.advanceTime(500);
    env.evaluate(`processLeftHand(${JSON.stringify(openHand)}, null)`);
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), true);
    assert.equal(thumb.style.display, 'block');
    assert.equal(player.calls.filter(c => c.method === 'playVideo').length, 2);
  });

  it('changing the dropdown selection cues the newly selected video at 0:00 in pause mode and plays it on next gesture', () => {
    const env = createDemoTestEnv();
    const select = env.doc.getElementById('youtube-video-select');
    const thumb = env.doc.getElementById('youtube-thumbnail-container');
    const player = env.getYouTubePlayers()[0];
    const openHand = buildLeftGestureHand({ pose: 'open' });
    const togetherHand = buildLeftGestureHand({ pose: 'together' });

    // Start first video
    env.evaluate(`processLeftHand(${JSON.stringify(openHand)}, null)`);
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), true);

    // Switch dropdown to the 3rd video (KatkfHwpawg)
    select.value = EXPECTED_URLS[2];
    select.dispatchEvent({ type: 'change' });

    assert.equal(env.evaluate('youtubeIsPlaying'), false);
    assert.equal(thumb.style.display, 'none');
    assert.equal(player.videoId, 'KatkfHwpawg');
    assert.equal(player.currentTime, 0);

    // Trigger left hand gesture to play the newly selected video
    env.advanceTime(500);
    env.evaluate(`processLeftHand(${JSON.stringify(openHand)}, null)`);
    env.evaluate(`processLeftHand(${JSON.stringify(togetherHand)}, null)`);
    assert.equal(env.evaluate('youtubeIsPlaying'), true);
    assert.equal(thumb.style.display, 'block');
    assert.equal(player.videoId, 'KatkfHwpawg');
  });

  it('never falsely triggers the 5-fingers-together gesture on real open-hand or note-playing calibration samples', () => {
    const env = createDemoTestEnv();
    const calibPath = path.join(__dirname, '..', 'hand-calibration-data.json');
    const calibData = JSON.parse(fs.readFileSync(calibPath, 'utf8'));

    for (const sample of calibData.samples) {
      const together = env.evaluate(`areAllFiveFingersTogether(${JSON.stringify(sample.landmarks)})`);
      assert.equal(together, false, `Sample ${sample.id} (${sample.stepTitle}) must NOT trigger all-5-fingers-together`);
    }
  });
});

describe('9. Cross-Hand Stability, Handedness Glitch Protection, Debounce/Hysteresis & Per-Hand Calibration', () => {
  let env;

  beforeEach(() => {
    env = createDemoTestEnv();
    env.evaluate('initAudioEngine()');
  });

  it('prevents Right Hand melody (e.g., F4 on Ring finger) from hijacking Left Hand F2 when MediaPipe emits duplicate or swapped handedness labels', () => {
    // Frame 1: Clean baseline — Left Hand at x=0.75 holding Pinky (F2=41), Right Hand at x=0.25 playing C4 (Thumb)
    const leftF2 = buildHandLandmarks({ palmX: 0.75, palmY: 0.7, activeFingers: [false, false, false, false, true] });
    const rightC4 = buildHandLandmarks({ palmX: 0.25, palmY: 0.7, activeFingers: [true, false, false, false, false] });

    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([leftF2, rightC4])},
      handednesses: [[{ categoryName: 'Right', score: 0.96 }], [{ categoryName: 'Left', score: 0.95 }]]
    }, null)`);

    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // F2
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [60]); // C4

    // Frame 2: Right Hand plays F4 (Ring finger, index 3) while MediaPipe glitches and labels BOTH hands raw 'Left'
    // (which both invert to 'Right' under default swapHands === false). Previously this swapped Left and Right,
    // causing Left Hand to jump from F2 (41) to G2 (43)!
    env.advanceTime(33);
    const rightF4 = buildHandLandmarks({ palmX: 0.26, palmY: 0.7, activeFingers: [false, false, false, true, false] });
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([leftF2, rightF4])},
      handednesses: [[{ categoryName: 'Left', score: 0.62 }], [{ categoryName: 'Left', score: 0.91 }]]
    }, null)`);
    env.flushTimeouts();

    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // Still F2!
    assert.equal(env.doc.getElementById('lbl-left-status').innerText, 'F2');
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [65]); // Right plays F4

    // Frame 3: MediaPipe reorders array to [rightF4, leftF2] AND labels BOTH hands raw 'Right' (both invert to 'Left')
    env.advanceTime(33);
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([rightF4, leftF2])},
      handednesses: [[{ categoryName: 'Right', score: 0.60 }], [{ categoryName: 'Right', score: 0.94 }]]
    }, null)`);
    env.flushTimeouts();

    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // Still F2!
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [65]); // Still F4!

    // Frame 4: MediaPipe simultaneously flips BOTH handedness labels while both wrists stayed put
    env.advanceTime(33);
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([leftF2, rightF4])},
      handednesses: [[{ categoryName: 'Left', score: 0.70 }], [{ categoryName: 'Right', score: 0.70 }]]
    }, null)`);
    env.flushTimeouts();

    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // Still F2!
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [65]); // Still F4!

    // Frame 5: Left Hand momentarily disappears, and MediaPipe misclassifies the stationary Right Hand (at x=0.26) as Left
    env.advanceTime(33);
    env.evaluate(`processHandDetectionResults({
      landmarks: ${JSON.stringify([rightF4])},
      handednesses: [[{ categoryName: 'Right', score: 0.65 }]]
    }, null)`);
    env.flushTimeouts();

    // Left Hand cleanly releases instead of playing G2 from Right Hand's F4, while Right Hand stays on F4
    assert.equal(env.evaluate('leftVoiceManager.activeVoices.size'), 0);
    assert.deepEqual(env.evaluate('Array.from(rightVoiceManager.activeVoices.keys())'), [65]);
  });

  it('rejects 1-2 frame borderline Ring (G2) droop while holding Pinky (F2), still allows deliberate G2, and picks the deepest curled finger on ties', () => {
    // Apply exact calibrated thresholds from hand-calibration-data.json
    env.evaluate(`applyHandCalibration({
      metricMode: 'ratioToMaxTip',
      thresholds: [0.511, 0.6973, 0.743, 0.5039, 0.5434]
    })`);

    // Helper to build a hand with explicit fingertip ratios relative to maxTipDist = 0.50
    const buildRatiosHand = (ratios) => {
      const lm = buildHandLandmarks({ palmX: 0.7, palmY: 0.8, activeFingers: [false, false, false, false, false] });
      const tips = [4, 8, 12, 16, 20];
      for (let i = 0; i < 5; i++) {
        lm[tips[i]] = { x: 0.7, y: 0.8 - 0.50 * ratios[i], z: 0 };
      }
      return lm;
    };

    // 1. Hold Pinky (F2, ratio 0.27 << 0.5434) with Ring open (ratio 0.53 > 0.5039)
    const holdF2Clean = buildRatiosHand([0.65, 0.95, 1.0, 0.53, 0.27]);
    env.evaluate(`processLeftHand(${JSON.stringify(holdF2Clean)}, null, true)`);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // F2

    // 2. Ring finger sympathetically droops slightly below 0.5039 (ratio 0.495, margin 0.0089 < 0.04) for 2 video frames
    //    plus duplicate RAF ticks (isNewVideoFrame = false) -> MUST NOT jump to G2!
    const ringBorderlineDroop = buildRatiosHand([0.65, 0.95, 1.0, 0.495, 0.27]);
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, true)`);
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, false)`);
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, true)`);
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, false)`);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // Still F2!

    // Ring recovers on frame 3 -> debounce counter resets cleanly
    env.evaluate(`processLeftHand(${JSON.stringify(holdF2Clean)}, null, true)`);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]);

    // 3. Even if Pinky recovers from a dropout with both Ring barely below (0.495) and Pinky deeply bent (0.27),
    //    deepest-curl tie-breaking picks Pinky (F2=41) instead of Ring (G2=43)!
    env.evaluate('releaseLeftHandNotes()');
    env.flushTimeouts();
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, true)`);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // F2 wins over G2!

    // 4. If Ring finger deliberately stays bent at 0.495 for 3 consecutive new video frames while Pinky is held,
    //    it switches cleanly to G2 (43)
    env.evaluate(`processLeftHand(${JSON.stringify(holdF2Clean)}, null, true)`);
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, true)`);
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, true)`);
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // Not yet on frame 2
    env.evaluate(`processLeftHand(${JSON.stringify(ringBorderlineDroop)}, null, true)`);
    env.flushTimeouts();
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [43]); // Switched to G2 on frame 3

    // 5. Decisive curl on Pinky while holding G2 switches immediately on frame 1
    env.evaluate(`processLeftHand(${JSON.stringify(buildRatiosHand([0.65, 0.95, 1.0, 0.45, 0.85]))}, null, true)`);
    env.evaluate(`processLeftHand(${JSON.stringify(buildRatiosHand([0.65, 0.95, 1.0, 0.45, 0.27]))}, null, true)`);
    env.flushTimeouts();
    assert.deepEqual(env.evaluate('Array.from(leftVoiceManager.activeVoices.keys())'), [41]); // Immediate F2!
  });

  it('supports independent Left and Right per-hand calibration profiles and max-margin optimization in calibrate.js', () => {
    // 1. Verify app.js applies independent perHand thresholds for Left vs Right
    env.evaluate(`applyHandCalibration({
      metricMode: 'ratioToMaxTip',
      thresholds: [0.60, 0.75, 0.75, 0.75, 0.75],
      perHand: {
        Left: { metricMode: 'ratioToMaxTip', thresholds: [0.50, 0.65, 0.70, 0.45, 0.55] },
        Right: { metricMode: 'ratioToMaxTip', thresholds: [0.55, 0.70, 0.75, 0.60, 0.55] }
      }
    })`);

    assert.ok(env.doc.getElementById('lbl-calib-status').innerText.includes('L+R'));

    // Build identical hand landmarks where Ring (index 3) ratio is 0.52:
    // - On Left Hand (Ring thresh 0.45): 0.52 >= 0.45 -> NOT playing
    // - On Right Hand (Ring thresh 0.60): 0.52 < 0.60 -> PLAYING
    const lmRing052 = buildHandLandmarks({ palmX: 0.5, palmY: 0.8, activeFingers: [false, false, false, false, false] });
    const tips = [4, 8, 12, 16, 20];
    const ratios = [0.65, 0.95, 1.0, 0.52, 0.85];
    for (let i = 0; i < 5; i++) {
      lmRing052[tips[i]] = { x: 0.5, y: 0.8 - 0.50 * ratios[i], z: 0 };
    }

    const leftStates = Array.from(env.evaluate(`getFingerPlayStates(${JSON.stringify(lmRing052)}, 'Left')`));
    const rightStates = Array.from(env.evaluate(`getFingerPlayStates(${JSON.stringify(lmRing052)}, 'Right')`));
    assert.equal(leftStates[3], false);
    assert.equal(rightStates[3], true);

    // 2. Verify calibrate.js computeOptimalCalibration produces max-margin thresholds and perHand profiles
    const vm = require('vm');
    const calibCode = fs.readFileSync(path.join(__dirname, '..', 'calibrate.js'), 'utf8');
    const calibCtx = vm.createContext({ console, Math, Date, JSON, Array, Object, Set, Number, String, Boolean });
    vm.runInContext(calibCode, calibCtx);

    const makeSample = (hand, expectedFingers, ratioToMaxTip) => ({
      hand,
      expectedFingers,
      metrics: {
        ratioToMaxTip,
        ratioToPalm: ratioToMaxTip.map(v => v * 1.9),
        tipToMcpOverPalm: ratioToMaxTip.map(v => v * 0.9)
      }
    });

    const samples = [
      // Left hand: Ring open=0.52, bent=0.40 -> max-margin midpoint = 0.46
      makeSample('Left', [false, false, false, false, false], [0.65, 0.95, 1.0, 0.52, 0.85]),
      makeSample('Left', [false, false, false, true, false], [0.65, 0.95, 1.0, 0.40, 0.85]),
      // Right hand: Ring open=0.88, bent=0.48 -> max-margin midpoint = 0.68
      makeSample('Right', [false, false, false, false, false], [0.65, 0.95, 1.0, 0.88, 0.85]),
      makeSample('Right', [false, false, false, true, false], [0.65, 0.95, 1.0, 0.48, 0.85])
    ];

    const opt = vm.runInContext(`computeOptimalCalibration(${JSON.stringify(samples)})`, calibCtx);
    assert.ok(opt.perHand.Left, 'Left per-hand calibration profile should be computed');
    assert.ok(opt.perHand.Right, 'Right per-hand calibration profile should be computed');
    // For ratioToMaxTip, Left Ring threshold is 0.46 while Right Ring threshold is 0.68 (or scaled if ratioToPalm wins with larger margin)
    assert.ok(opt.perHand.Left.thresholds[3] < opt.perHand.Right.thresholds[3]);
    assert.deepEqual(Array.from(opt.perHand.Left.fingerStats.map(s => s.label)), ['1:C3', '2:B2', '3:A2', '4:G2', '5:F2']);
    assert.deepEqual(Array.from(opt.perHand.Right.fingerStats.map(s => s.label)), ['1:C4', '2:D4', '3:E4', '4:F4', '5:G4']);
  });

  it('captures ONLY the selected target hand (Left C3-F2 or Right C4-G4) in calibrate.js even when both hands are visible', () => {
    const vm = require('vm');
    const calibCode = fs.readFileSync(path.join(__dirname, '..', 'calibrate.js'), 'utf8');
    const stubDoc = {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => []
    };
    const calibCtx = vm.createContext({
      console, Math, Date, JSON, Array, Object, Set, Number, String, Boolean,
      document: stubDoc,
      window: { addEventListener: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} },
      navigator: {}
    });
    vm.runInContext(calibCode, calibCtx);

    const leftF2 = buildHandLandmarks({ palmX: 0.75, palmY: 0.7, activeFingers: [false, false, false, false, true] });
    const rightOpen = buildHandLandmarks({ palmX: 0.25, palmY: 0.7, activeFingers: [false, false, false, false, false] });

    // Both hands visible in frame; Left Hand is selected target with Pinky (F2) label
    vm.runInContext(`
      setTargetHand('Left');
      activeLabelFingers = [false, false, false, false, true];
      latestResults = {
        landmarks: ${JSON.stringify([leftF2, rightOpen])},
        handednesses: [[{ categoryName: 'Right', score: 0.95 }], [{ categoryName: 'Left', score: 0.95 }]]
      };
      captureCurrentSample();
    `, calibCtx);

    const afterLeftCapture = vm.runInContext('capturedSamples', calibCtx);
    assert.equal(afterLeftCapture.length, 1, 'Must capture ONLY the targeted Left Hand, not both hands');
    assert.equal(afterLeftCapture[0].hand, 'Left');
    assert.deepEqual(Array.from(afterLeftCapture[0].expectedNotes), ['5:F2']);

    // Switch target to Right Hand while only Left Hand is visible -> must NOT capture Left Hand as Right
    const rightCaptureOk = vm.runInContext(`
      setTargetHand('Right');
      activeLabelFingers = [false, false, false, false, false];
      latestResults = {
        landmarks: ${JSON.stringify([leftF2])},
        handednesses: [[{ categoryName: 'Right', score: 0.95 }]]
      };
      captureCurrentSample();
    `, calibCtx);
    assert.equal(rightCaptureOk, false);
    assert.equal(vm.runInContext('capturedSamples.length', calibCtx), 1);

    // Now show both hands -> captures ONLY the Right Hand with Right-Hand labels
    const rightCaptureBoth = vm.runInContext(`
      activeLabelFingers = [false, false, false, true, false];
      latestResults = {
        landmarks: ${JSON.stringify([leftF2, rightOpen])},
        handednesses: [[{ categoryName: 'Right', score: 0.95 }], [{ categoryName: 'Left', score: 0.95 }]]
      };
      captureCurrentSample();
    `, calibCtx);
    assert.equal(rightCaptureBoth, true);
    const samples = vm.runInContext('capturedSamples', calibCtx);
    assert.equal(samples.length, 2);
    assert.equal(samples[1].hand, 'Right');
    assert.deepEqual(Array.from(samples[1].expectedNotes), ['4:F4']);
  });
});
