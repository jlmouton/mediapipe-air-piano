/**
 * Hand Calibration & Labeled Capture Studio (`demo/calibrate.js`)
 *
 * Allows capturing webcam snapshots + 21 MediaPipe hand landmarks, labeling each image
 * with which finger(s)/note(s) (1:C, 2:D, 3:E, 4:F, 5:G, or No Notes) should be played,
 * auto-computing optimal scale-invariant thresholds, saving directly to the Demo (`localStorage`),
 * and exporting a downloadable JSON dataset (`hand-calibration-data.json`).
 */

const CALIB_STORAGE_KEY = 'airsynth_hand_calibration';
const SAMPLES_STORAGE_KEY = 'airsynth_calibration_samples';

const PALM_CENTER_INDEX = 0;
const FINGER_TIP_INDICES = [4, 8, 12, 16, 20];
const FINGER_MCP_INDICES = [2, 5, 9, 13, 17];

const FINGER_LABELS_BY_HAND = {
  Left: ['1: Thumb (C3)', '2: Index (B2)', '3: Middle (A2)', '4: Ring (G2)', '5: Pinky (F2)'],
  Right: ['1: Thumb (C4)', '2: Index (D4)', '3: Middle (E4)', '4: Ring (F4)', '5: Pinky (G4)']
};
const SHORT_NOTE_LABELS_BY_HAND = {
  Left: ['1:C3', '2:B2', '3:A2', '4:G2', '5:F2'],
  Right: ['1:C4', '2:D4', '3:E4', '4:F4', '5:G4']
};
const FINGER_LABELS = FINGER_LABELS_BY_HAND.Right;
const SHORT_NOTE_LABELS = SHORT_NOTE_LABELS_BY_HAND.Right;

const GUIDED_STEPS_BY_HAND = {
  Left: [
    {
      title: 'Left 1. Open Hand — No Notes (Normal Distance)',
      desc: 'Hold your LEFT hand open at a normal playing distance with NO fingers bent, then press Spacebar or Capture.',
      fingers: [false, false, false, false, false]
    },
    {
      title: 'Left 2. Open Hand — No Notes (Further from Camera)',
      desc: 'Move your open LEFT hand slightly further from the camera (all 5 fingers extended, NO notes playing) and capture.',
      fingers: [false, false, false, false, false]
    },
    {
      title: 'Left 3. Play Finger 1 Only — Thumb (C3)',
      desc: 'On your LEFT hand, bend ONLY your Thumb (C3) while keeping fingers 2–5 extended, then capture.',
      fingers: [true, false, false, false, false]
    },
    {
      title: 'Left 4. Play Finger 2 Only — Index (B2)',
      desc: 'On your LEFT hand, bend ONLY your Index finger (B2) while keeping the other fingers extended, then capture.',
      fingers: [false, true, false, false, false]
    },
    {
      title: 'Left 5. Play Finger 3 Only — Middle (A2)',
      desc: 'On your LEFT hand, bend ONLY your Middle finger (A2) while keeping the other fingers extended, then capture.',
      fingers: [false, false, true, false, false]
    },
    {
      title: 'Left 6. Play Finger 4 Only — Ring (G2)',
      desc: 'On your LEFT hand, bend ONLY your Ring finger (G2) while keeping the other fingers extended, then capture.',
      fingers: [false, false, false, true, false]
    },
    {
      title: 'Left 7. Play Finger 5 Only — Pinky (F2)',
      desc: 'On your LEFT hand, bend ONLY your Pinky finger (F2) naturally (even if Ring droops slightly — leave Ring unchecked!) so the optimizer separates F2 from G2 cleanly.',
      fingers: [false, false, false, false, true]
    }
  ],
  Right: [
    {
      title: 'Right 1. Open Hand — No Notes (Normal Distance)',
      desc: 'Hold your RIGHT hand open at a normal distance from the camera with NO fingers bent, then press Spacebar or Capture.',
      fingers: [false, false, false, false, false]
    },
    {
      title: 'Right 2. Open Hand — No Notes (Further from Camera)',
      desc: 'Move your open RIGHT hand further back from the camera (all 5 fingers extended, NO notes playing) and capture.',
      fingers: [false, false, false, false, false]
    },
    {
      title: 'Right 3. Play Finger 1 Only — Thumb (C4)',
      desc: 'On your RIGHT hand, bend ONLY your Thumb (C4) inward while keeping fingers 2–5 extended, then capture.',
      fingers: [true, false, false, false, false]
    },
    {
      title: 'Right 4. Play Finger 2 Only — Index (D4)',
      desc: 'On your RIGHT hand, bend ONLY your Index finger (D4) while keeping the other fingers extended, then capture.',
      fingers: [false, true, false, false, false]
    },
    {
      title: 'Right 5. Play Finger 3 Only — Middle (E4)',
      desc: 'On your RIGHT hand, bend ONLY your Middle finger (E4) while keeping the other fingers extended, then capture.',
      fingers: [false, false, true, false, false]
    },
    {
      title: 'Right 6. Play Finger 4 Only — Ring (F4)',
      desc: 'On your RIGHT hand, bend ONLY your Ring finger (F4) while keeping the other fingers extended, then capture.',
      fingers: [false, false, false, true, false]
    },
    {
      title: 'Right 7. Play Finger 5 Only — Pinky (G4)',
      desc: 'On your RIGHT hand, bend ONLY your Pinky finger (G4) while keeping the other fingers extended, then capture.',
      fingers: [false, false, false, false, true]
    },
    {
      title: 'Right 8. Play Chord: Fingers 1 + 3 (C4 + E4)',
      desc: 'On your RIGHT hand, bend both Thumb (C4) and Middle (E4) simultaneously while keeping Index, Ring, and Pinky extended, then capture.',
      fingers: [true, false, true, false, false]
    },
    {
      title: 'Right 9. Play Chord: Fingers 2 + 4 (D4 + F4)',
      desc: 'On your RIGHT hand, bend both Index (D4) and Ring (F4) simultaneously while keeping Thumb, Middle, and Pinky extended, then capture.',
      fingers: [false, true, false, true, false]
    }
  ]
};
const GUIDED_STEPS = GUIDED_STEPS_BY_HAND.Right;

let handLandmarker = null;
let lastVideoTime = -1;
let latestResults = null;
let swapHands = false;

let activeTargetHand = 'Left';
const stepIndexByHand = { Left: 0, Right: 0 };
let galleryFilterHand = 'All';
let activeLabelFingers = [false, false, false, false, false];
let capturedSamples = [];
let currentCalibration = {
  metricMode: 'ratioToMaxTip',
  thresholds: [0.60, 0.75, 0.75, 0.75, 0.75],
  perHand: { Left: null, Right: null },
  accuracy: null,
  sampleCount: 0,
  updatedAt: null
};

function getFingerLabelsForHand(hand) {
  return FINGER_LABELS_BY_HAND[hand] || FINGER_LABELS;
}

function getShortNoteLabelsForHand(hand) {
  return SHORT_NOTE_LABELS_BY_HAND[hand] || SHORT_NOTE_LABELS;
}

function getGuidedStepsForHand(hand) {
  return GUIDED_STEPS_BY_HAND[hand] || GUIDED_STEPS_BY_HAND.Right;
}

function distance2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Computes all 3 candidate scale-invariant finger distance metrics for a 21-landmark hand:
 * 1. `ratioToMaxTip`: distance(tip, wrist[0]) / max(distance(tip_0..4, wrist[0]))
 * 2. `ratioToPalm`: distance(tip, wrist[0]) / distance(wrist[0], middleMcp[9])
 * 3. `tipToMcpOverPalm`:
 *    - Thumb (0): distance(thumbTip[4], pinkyMcp[17]) / distance(indexMcp[5], pinkyMcp[17])
 *    - Fingers 2..5 (1..4): distance(tip[i], mcp[i]) / distance(wrist[0], middleMcp[9])
 */
function computeHandMetrics(landmarks) {
  const wrist = landmarks[PALM_CENTER_INDEX];
  const rawDistToWrist = FINGER_TIP_INDICES.map(idx => distance2D(landmarks[idx], wrist));
  const maxTipDist = Math.max(...rawDistToWrist, 1e-6);

  // Rigid palm length: wrist (0) to middle finger knuckle/MCP (9)
  const palmLength = Math.max(distance2D(wrist, landmarks[9]), 1e-6);
  // Rigid palm width: index MCP (5) to pinky MCP (17)
  const palmWidth = Math.max(distance2D(landmarks[5], landmarks[17]), 1e-6);

  const ratioToMaxTip = rawDistToWrist.map(d => Number((d / maxTipDist).toFixed(4)));
  const ratioToPalm = rawDistToWrist.map(d => Number((d / palmLength).toFixed(4)));

  const tipToMcpOverPalm = FINGER_TIP_INDICES.map((tipIdx, i) => {
    if (i === 0) {
      // Thumb bends across palm toward pinky base (17)
      return Number((distance2D(landmarks[4], landmarks[17]) / palmWidth).toFixed(4));
    }
    const mcpIdx = FINGER_MCP_INDICES[i];
    return Number((distance2D(landmarks[tipIdx], landmarks[mcpIdx]) / palmLength).toFixed(4));
  });

  return {
    rawDistToWrist: rawDistToWrist.map(d => Number(d.toFixed(4))),
    maxTipDist: Number(maxTipDist.toFixed(4)),
    palmLength: Number(palmLength.toFixed(4)),
    palmWidth: Number(palmWidth.toFixed(4)),
    ratioToMaxTip,
    ratioToPalm,
    tipToMcpOverPalm
  };
}

function getCalibrationProfileForHand(calib = currentCalibration, hand = null) {
  if (hand && calib && calib.perHand && calib.perHand[hand] && Array.isArray(calib.perHand[hand].thresholds)) {
    return calib.perHand[hand];
  }
  return {
    metricMode: (calib && calib.metricMode) || 'ratioToMaxTip',
    thresholds: (calib && calib.thresholds) || [0.60, 0.75, 0.75, 0.75, 0.75]
  };
}

function evaluateFingersWithCalibration(metrics, calib = currentCalibration, hand = null) {
  const profile = getCalibrationProfileForHand(calib, hand);
  const mode = profile.metricMode || 'ratioToMaxTip';
  const thresholds = profile.thresholds || [0.60, 0.75, 0.75, 0.75, 0.75];
  const values = metrics[mode] || metrics.ratioToMaxTip;
  return values.map((v, i) => v < thresholds[i]);
}

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
  const rawHand = lower.startsWith('l') ? 'Left' : (lower.startsWith('r') ? 'Right' : (index === 0 ? 'Right' : 'Left'));
  const category = !swapHands ? (rawHand === 'Left' ? 'Right' : 'Left') : rawHand;
  return { category, score };
}

function getHandCategory(detectionResults, index) {
  return getHandDetectionInfo(detectionResults, index).category;
}

/**
 * Resolves up to 2 detected hands cleanly into Left/Right entries, disambiguating
 * duplicate MediaPipe handedness labels using confidence score and camera x-order.
 */
function resolveDetectedHands(detectionResults) {
  if (!detectionResults || !Array.isArray(detectionResults.landmarks) || detectionResults.landmarks.length === 0) {
    return [];
  }
  const count = Math.min(2, detectionResults.landmarks.length);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const landmarks = detectionResults.landmarks[i];
    if (!Array.isArray(landmarks) || landmarks.length < 21) continue;
    const info = getHandDetectionInfo(detectionResults, i);
    entries.push({
      index: i,
      landmarks,
      hand: info.category,
      score: info.score,
      wristX: landmarks[PALM_CENTER_INDEX].x
    });
  }

  if (entries.length === 2 && entries[0].hand === entries[1].hand) {
    const [h0, h1] = entries;
    let h0IsLeft;
    if (Math.abs(h0.score - h1.score) > 0.05) {
      h0IsLeft = h0.hand === 'Left' ? (h0.score >= h1.score) : (h0.score < h1.score);
    } else {
      h0IsLeft = swapHands ? (h0.wristX <= h1.wristX) : (h0.wristX >= h1.wristX);
    }
    h0.hand = h0IsLeft ? 'Left' : 'Right';
    h1.hand = h0IsLeft ? 'Right' : 'Left';
  }

  return entries;
}

function computeCalibrationForSubset(samples, fallbackThresholdsByMode = null) {
  const candidateModes = ['ratioToMaxTip', 'ratioToPalm', 'tipToMcpOverPalm'];
  const defaultThresholdsByMode = {
    ratioToMaxTip: [0.60, 0.75, 0.75, 0.75, 0.75],
    ratioToPalm: [1.15, 1.50, 1.55, 1.50, 1.35],
    tipToMcpOverPalm: [1.10, 0.75, 0.80, 0.75, 0.68]
  };

  let bestResult = null;

  for (const mode of candidateModes) {
    const baseFallback = (fallbackThresholdsByMode && fallbackThresholdsByMode[mode]) || defaultThresholdsByMode[mode];
    const thresholds = [...baseFallback];
    const fingerStats = [];
    let totalChecks = 0;
    let totalCorrect = 0;
    let minFingerMargin = Infinity;

    for (let f = 0; f < 5; f++) {
      const playingVals = [];
      const openVals = [];

      for (const s of samples) {
        if (!s.metrics || !Array.isArray(s.metrics[mode])) continue;
        const val = s.metrics[mode][f];
        if (s.expectedFingers && s.expectedFingers[f]) {
          playingVals.push(val);
        } else {
          openVals.push(val);
        }
      }

      let fingerMargin = null;
      if (playingVals.length > 0 && openVals.length > 0) {
        const allSorted = [...new Set([...playingVals, ...openVals])].sort((a, b) => a - b);
        const candidates = [];
        for (let i = 0; i < allSorted.length - 1; i++) {
          candidates.push((allSorted[i] + allSorted[i + 1]) / 2);
        }
        const maxPlay = Math.max(...playingVals);
        const minOpen = Math.min(...openVals);
        const meanPlay = playingVals.reduce((a, b) => a + b, 0) / playingVals.length;
        const meanOpen = openVals.reduce((a, b) => a + b, 0) / openVals.length;
        candidates.push((maxPlay + minOpen) / 2);
        candidates.push((meanPlay + meanOpen) / 2);

        let bestT = thresholds[f];
        let bestHits = -1;
        let bestSafetyMargin = -Infinity;
        let bestCenterTie = -Infinity;

        for (const t of candidates) {
          let hits = 0;
          let nearestPlayGap = Infinity;
          let nearestOpenGap = Infinity;
          for (const v of playingVals) {
            if (v < t) {
              hits++;
              if (t - v < nearestPlayGap) nearestPlayGap = t - v;
            }
          }
          for (const v of openVals) {
            if (v >= t) {
              hits++;
              if (v - t < nearestOpenGap) nearestOpenGap = v - t;
            }
          }
          // Maximize worst-case distance to the closest correctly classified bent/open sample
          const safetyMargin = (Number.isFinite(nearestPlayGap) && Number.isFinite(nearestOpenGap))
            ? Math.min(nearestPlayGap, nearestOpenGap)
            : -Infinity;
          const centerTie = -Math.abs(t - (meanPlay + meanOpen) / 2);

          if (
            hits > bestHits ||
            (hits === bestHits && safetyMargin > bestSafetyMargin + 1e-9) ||
            (hits === bestHits && Math.abs(safetyMargin - bestSafetyMargin) <= 1e-9 && centerTie > bestCenterTie)
          ) {
            bestHits = hits;
            bestSafetyMargin = safetyMargin;
            bestCenterTie = centerTie;
            bestT = t;
          }
        }
        thresholds[f] = Number(bestT.toFixed(4));
        fingerMargin = Number((minOpen - maxPlay).toFixed(4));
        const normalizedMargin = fingerMargin / Math.max(thresholds[f], 1e-6);
        if (normalizedMargin < minFingerMargin) minFingerMargin = normalizedMargin;
      } else if (openVals.length > 0 && !fallbackThresholdsByMode) {
        // Only open samples so far: set threshold 18% below the minimum open value
        const minOpen = Math.min(...openVals);
        thresholds[f] = Number((minOpen * 0.82).toFixed(4));
      } else if (playingVals.length > 0 && !fallbackThresholdsByMode) {
        const maxPlay = Math.max(...playingVals);
        thresholds[f] = Number((maxPlay * 1.15).toFixed(4));
      }

      // Evaluate accuracy for finger f
      let fCorrect = 0;
      const fTotal = playingVals.length + openVals.length;
      for (const v of playingVals) if (v < thresholds[f]) fCorrect++;
      for (const v of openVals) if (v >= thresholds[f]) fCorrect++;

      totalChecks += fTotal;
      totalCorrect += fCorrect;

      fingerStats.push({
        finger: f,
        label: SHORT_NOTE_LABELS[f],
        threshold: thresholds[f],
        playingCount: playingVals.length,
        openCount: openVals.length,
        playingMean: playingVals.length ? Number((playingVals.reduce((a, b) => a + b, 0) / playingVals.length).toFixed(3)) : null,
        openMean: openVals.length ? Number((openVals.reduce((a, b) => a + b, 0) / openVals.length).toFixed(3)) : null,
        gap: fingerMargin,
        accuracy: fTotal > 0 ? Number(((fCorrect / fTotal) * 100).toFixed(1)) : 100
      });
    }

    const overallAccuracy = totalChecks > 0 ? Number(((totalCorrect / totalChecks) * 100).toFixed(1)) : 0;
    const candidateResult = {
      metricMode: mode,
      thresholds,
      fingerStats,
      accuracy: overallAccuracy,
      minFingerMargin: Number.isFinite(minFingerMargin) ? Number(minFingerMargin.toFixed(4)) : 0,
      sampleCount: samples.length,
      updatedAt: new Date().toISOString()
    };

    if (
      !bestResult ||
      candidateResult.accuracy > bestResult.accuracy ||
      (candidateResult.accuracy === bestResult.accuracy && candidateResult.minFingerMargin > bestResult.minFingerMargin)
    ) {
      bestResult = candidateResult;
    }
  }

  return bestResult;
}

/**
 * Finds the optimal per-finger thresholds and best normalization metric across all captured samples,
 * plus independent Left/Right per-hand profiles when samples exist for each hand.
 */
function computeOptimalCalibration(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return currentCalibration;
  }

  const globalResult = computeCalibrationForSubset(samples);
  if (!globalResult) return currentCalibration;

  const fallbackByMode = {
    [globalResult.metricMode]: globalResult.thresholds
  };

  const buildHandProfile = (handName) => {
    const handSamples = samples.filter(s => s.hand === handName);
    if (handSamples.length < 2) return null;
    const hasOpen = handSamples.some(s => Array.isArray(s.expectedFingers) && s.expectedFingers.some(v => !v));
    const hasPlay = handSamples.some(s => Array.isArray(s.expectedFingers) && s.expectedFingers.some(Boolean));
    if (!hasOpen || !hasPlay) return null;

    const sub = computeCalibrationForSubset(handSamples, fallbackByMode);
    if (!sub) return null;
    const handLabels = getShortNoteLabelsForHand(handName);
    return {
      metricMode: sub.metricMode,
      thresholds: sub.thresholds,
      fingerStats: (sub.fingerStats || []).map((st, idx) => ({ ...st, label: handLabels[idx] || st.label })),
      accuracy: sub.accuracy,
      minFingerMargin: sub.minFingerMargin,
      sampleCount: sub.sampleCount
    };
  };

  return {
    ...globalResult,
    perHand: {
      Left: buildHandProfile('Left'),
      Right: buildHandProfile('Right')
    }
  };
}

function updateHandTabCounts() {
  const leftCount = capturedSamples.filter(s => s.hand === 'Left').length;
  const rightCount = capturedSamples.filter(s => s.hand === 'Right').length;
  const leftBadge = document.getElementById('left-sample-count-badge');
  const rightBadge = document.getElementById('right-sample-count-badge');
  if (leftBadge) leftBadge.innerText = `${leftCount} sample${leftCount === 1 ? '' : 's'}`;
  if (rightBadge) rightBadge.innerText = `${rightCount} sample${rightCount === 1 ? '' : 's'}`;
}

function renderHandProfileCard(handName, profile, sampleCount) {
  const accent = handName === 'Left' ? 'var(--accent-cyan)' : 'var(--accent-magenta)';
  const rangeLabel = handName === 'Left' ? 'C3–F2 Mono' : 'C4–G4 Poly';
  if (!profile) {
    return `
      <div class="hand-result-card">
        <div style="color:${accent}; font-weight:700; margin-bottom:4px;">${handName} Hand (${rangeLabel})</div>
        <div style="color:var(--text-dim);">
          ${sampleCount} sample${sampleCount === 1 ? '' : 's'} — capture Open + bent-finger frames for ${handName} Hand to create an independent profile (currently uses shared fallback).
        </div>
      </div>
    `;
  }

  const lines = (profile.fingerStats || []).map(st => {
    const playStr = st.playingMean !== null ? st.playingMean : '—';
    const openStr = st.openMean !== null ? st.openMean : '—';
    const relGap = (st.gap !== null && st.threshold > 0) ? (st.gap / st.threshold) : null;
    const gapWarn = (relGap !== null && relGap < 0.12)
      ? ` <span style="color:var(--accent-gold);">⚠️ tight</span>`
      : '';
    return `<div><strong>${st.label}</strong>: <span style="color:${accent}">${st.threshold}</span> (bent ${playStr} / open ${openStr})${gapWarn}</div>`;
  });

  return `
    <div class="hand-result-card" style="border-color:${accent};">
      <div style="color:${accent}; font-weight:700; margin-bottom:4px;">
        ${handName} Hand (${rangeLabel}) • ${profile.accuracy}% (${profile.sampleCount} samples)
      </div>
      <div style="color:var(--accent-gold); margin-bottom:4px;">
        Mode: <code>${profile.metricMode}</code>
      </div>
      ${lines.join('')}
    </div>
  `;
}

function updateCalibrationDisplay() {
  currentCalibration = computeOptimalCalibration(capturedSamples);
  updateHandTabCounts();

  const badge = document.getElementById('accuracy-badge');
  const box = document.getElementById('calibration-results-box');
  const leftCount = capturedSamples.filter(s => s.hand === 'Left').length;
  const rightCount = capturedSamples.filter(s => s.hand === 'Right').length;
  const perHand = currentCalibration.perHand || {};

  if (badge) {
    if (capturedSamples.length === 0) {
      badge.innerText = '0 samples captured';
    } else if (perHand.Left && perHand.Right) {
      badge.innerText = `L+R Calibrated • L:${perHand.Left.accuracy}% / R:${perHand.Right.accuracy}%`;
    } else {
      badge.innerText = `${capturedSamples.length} samples • ${currentCalibration.accuracy}% accuracy (${currentCalibration.metricMode})`;
    }
  }

  if (!box) return;
  if (capturedSamples.length === 0) {
    box.innerHTML = 'Capture Open Hand and bent-finger frames for both Left Hand (C3–F2) and Right Hand (C4–G4) to auto-compute independent optimal thresholds.';
    return;
  }

  box.innerHTML = `
    <div style="margin-bottom:4px; color:var(--text-dim);">
      <strong>Shared Fallback:</strong> <code>${currentCalibration.metricMode}</code> <code>[${currentCalibration.thresholds.join(', ')}]</code>
      (${currentCalibration.accuracy}% across ${capturedSamples.length} total samples)
    </div>
    <div class="per-hand-results-grid">
      ${renderHandProfileCard('Left', perHand.Left, leftCount)}
      ${renderHandProfileCard('Right', perHand.Right, rightCount)}
    </div>
  `;
}

function setTargetHand(hand) {
  if (hand !== 'Left' && hand !== 'Right') return;
  activeTargetHand = hand;
  const btnLeft = document.getElementById('btn-select-left-hand');
  const btnRight = document.getElementById('btn-select-right-hand');
  if (btnLeft) btnLeft.classList.toggle('active-left', hand === 'Left');
  if (btnRight) btnRight.classList.toggle('active-right', hand === 'Right');
  renderStepUI();
}

function renderStepUI() {
  const steps = getGuidedStepsForHand(activeTargetHand);
  const idx = Math.max(0, Math.min(steps.length - 1, stepIndexByHand[activeTargetHand] || 0));
  stepIndexByHand[activeTargetHand] = idx;
  const step = steps[idx];

  const badge = document.getElementById('step-progress-badge');
  const title = document.getElementById('guided-prompt-title');
  const desc = document.getElementById('guided-prompt-desc');
  const btnCapture = document.getElementById('btn-capture-now');

  if (badge) badge.innerText = `${activeTargetHand} Hand • Step ${idx + 1} / ${steps.length}`;
  if (title) title.innerText = step.title;
  if (desc) desc.innerText = step.desc;
  if (btnCapture) btnCapture.innerText = `📸 Capture ${activeTargetHand} Hand Now (Spacebar)`;

  const fingerLabels = getFingerLabelsForHand(activeTargetHand);
  const pills = document.querySelectorAll('#label-pills-container .finger-pill');
  pills.forEach(pill => {
    const fIdx = parseInt(pill.dataset.finger, 10);
    if (fingerLabels[fIdx]) {
      pill.innerText = fingerLabels[fIdx];
    }
  });

  activeLabelFingers = [...step.fingers];
  renderLabelPills();
}

function renderLabelPills() {
  const pills = document.querySelectorAll('#label-pills-container .finger-pill');
  pills.forEach(pill => {
    const idx = parseInt(pill.dataset.finger, 10);
    pill.classList.toggle('active', Boolean(activeLabelFingers[idx]));
  });
}

function renderSamplesGallery() {
  const countLbl = document.getElementById('sample-count-lbl');
  if (countLbl) countLbl.innerText = String(capturedSamples.length);
  updateHandTabCounts();

  const gallery = document.getElementById('samples-gallery');
  if (!gallery) return;

  const filtered = galleryFilterHand === 'All'
    ? capturedSamples
    : capturedSamples.filter(s => s.hand === galleryFilterHand);

  if (filtered.length === 0) {
    gallery.innerHTML = `<div style="color: var(--text-dim); font-size: 12px;">No captured frames${galleryFilterHand === 'All' ? '' : ` for ${galleryFilterHand} Hand`} yet. Hold your ${activeTargetHand} Hand in front of the webcam and press Spacebar or click "Capture ${activeTargetHand} Hand Now".</div>`;
    return;
  }

  gallery.innerHTML = '';
  filtered.slice().reverse().forEach((sample) => {
    const card = document.createElement('div');
    card.className = 'sample-card';
    const noteLabels = getShortNoteLabelsForHand(sample.hand);
    const handAccent = sample.hand === 'Left' ? 'var(--accent-cyan)' : 'var(--accent-magenta)';

    const notesText = sample.expectedFingers
      .map((active, i) => (active ? noteLabels[i] : null))
      .filter(Boolean)
      .join(', ') || 'No Notes (Open Hand)';

    card.innerHTML = `
      <div class="sample-card-header">
        <span>#${sample.id} • <strong style="color:${handAccent}">${sample.hand} Hand</strong></span>
        <div style="display:flex; gap:4px;">
          <button class="mini-pill" data-swap-sample-hand="${sample.id}" title="Switch sample between Left and Right Hand">⇄ ${sample.hand === 'Left' ? 'R' : 'L'}</button>
          <button class="mini-pill" data-delete="${sample.id}" title="Delete this capture">✕</button>
        </div>
      </div>
      ${sample.thumbnail ? `<img src="${sample.thumbnail}" alt="Capture #${sample.id}">` : ''}
      <div style="font-size:11px; color:var(--text-main);">
        <strong>Label:</strong> <span style="color:${handAccent}">${notesText}</span>
      </div>
      <div style="font-family:var(--font-mono); font-size:10px; color:var(--text-dim);">
        ratioToMax: [${sample.metrics.ratioToMaxTip.map(n => n.toFixed(2)).join(', ')}]<br>
        ratioToPalm: [${sample.metrics.ratioToPalm.map(n => n.toFixed(2)).join(', ')}]
      </div>
      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        ${noteLabels.map((lbl, fIdx) => `
          <button class="mini-pill ${sample.expectedFingers[fIdx] ? 'active' : ''}" data-sample-id="${sample.id}" data-toggle-finger="${fIdx}">
            ${lbl}
          </button>
        `).join('')}
      </div>
    `;

    gallery.appendChild(card);
  });

  // Wire relabel, hand-toggle, and delete buttons
  gallery.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-delete'), 10);
      capturedSamples = capturedSamples.filter(s => s.id !== id);
      persistSamples();
      updateCalibrationDisplay();
      renderSamplesGallery();
    });
  });

  gallery.querySelectorAll('[data-swap-sample-hand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-swap-sample-hand'), 10);
      const sample = capturedSamples.find(s => s.id === id);
      if (sample) {
        sample.hand = sample.hand === 'Left' ? 'Right' : 'Left';
        const noteLabels = getShortNoteLabelsForHand(sample.hand);
        sample.expectedNotes = sample.expectedFingers
          .map((active, idx) => (active ? noteLabels[idx] : null))
          .filter(Boolean);
        persistSamples();
        updateCalibrationDisplay();
        renderSamplesGallery();
      }
    });
  });

  gallery.querySelectorAll('[data-toggle-finger]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-sample-id'), 10);
      const fIdx = parseInt(btn.getAttribute('data-toggle-finger'), 10);
      const sample = capturedSamples.find(s => s.id === id);
      if (sample) {
        sample.expectedFingers[fIdx] = !sample.expectedFingers[fIdx];
        const noteLabels = getShortNoteLabelsForHand(sample.hand);
        sample.expectedNotes = sample.expectedFingers
          .map((active, idx) => (active ? noteLabels[idx] : null))
          .filter(Boolean);
        persistSamples();
        updateCalibrationDisplay();
        renderSamplesGallery();
      }
    });
  });
}

function captureThumbnail(video, landmarks) {
  try {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 240;
    thumbCanvas.height = 180;
    const ctx = thumbCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);

    // Draw fingertip & wrist dots on the thumbnail
    FINGER_TIP_INDICES.forEach((tipIdx, i) => {
      const pt = landmarks[tipIdx];
      ctx.fillStyle = activeLabelFingers[i] ? '#FF0000' : '#00FF00';
      ctx.fillRect(pt.x * thumbCanvas.width - 4, pt.y * thumbCanvas.height - 4, 8, 8);
    });
    const wrist = landmarks[PALM_CENTER_INDEX];
    ctx.fillStyle = '#00E6FF';
    ctx.fillRect(wrist.x * thumbCanvas.width - 4, wrist.y * thumbCanvas.height - 4, 8, 8);

    return thumbCanvas.toDataURL('image/jpeg', 0.72);
  } catch (e) {
    return null;
  }
}

function captureCurrentSample() {
  const statusEl = document.getElementById('save-status-msg');
  const detectedHands = resolveDetectedHands(latestResults);
  if (detectedHands.length === 0) {
    if (statusEl) {
      statusEl.style.color = 'var(--accent-red)';
      statusEl.innerText = `⚠️ No hand detected in camera feed! Hold your ${activeTargetHand} Hand in view of the camera first.`;
    }
    return false;
  }

  // Capture ONLY the currently selected target hand so the opposite hand can never contaminate its samples
  const targetEntry = detectedHands.find(h => h.hand === activeTargetHand);
  if (!targetEntry) {
    const seenList = detectedHands.map(h => `${h.hand} Hand`).join(', ');
    if (statusEl) {
      statusEl.style.color = 'var(--accent-gold)';
      statusEl.innerText = `⚠️ ${activeTargetHand} Hand not detected (currently seeing: ${seenList}). Show your ${activeTargetHand} Hand, switch the hand tab, or toggle Mirror Mode if Left/Right are reversed.`;
    }
    return false;
  }

  const video = document.getElementById('webcam');
  const steps = getGuidedStepsForHand(activeTargetHand);
  const stepIdx = stepIndexByHand[activeTargetHand] || 0;
  const noteLabels = getShortNoteLabelsForHand(activeTargetHand);
  const metrics = computeHandMetrics(targetEntry.landmarks);
  const thumbnail = video ? captureThumbnail(video, targetEntry.landmarks) : null;
  const nextId = capturedSamples.reduce((maxId, s) => Math.max(maxId, Number(s.id) || 0), 0) + 1;

  const sample = {
    id: nextId,
    timestamp: new Date().toISOString(),
    hand: activeTargetHand,
    stepTitle: steps[stepIdx] ? steps[stepIdx].title : `${activeTargetHand} Custom`,
    expectedFingers: [...activeLabelFingers],
    expectedNotes: activeLabelFingers
      .map((active, fIdx) => (active ? noteLabels[fIdx] : null))
      .filter(Boolean),
    metrics,
    landmarks: targetEntry.landmarks.map(lm => ({
      x: Number(lm.x.toFixed(5)),
      y: Number(lm.y.toFixed(5)),
      z: Number((lm.z || 0).toFixed(5))
    })),
    thumbnail
  };

  capturedSamples.push(sample);
  persistSamples();
  updateCalibrationDisplay();
  renderSamplesGallery();

  const otherHand = activeTargetHand === 'Left' ? 'Right' : 'Left';
  const finishedGuidedSet = stepIdx >= steps.length - 1;
  if (statusEl) {
    statusEl.style.color = 'var(--accent-green)';
    statusEl.innerText = finishedGuidedSet
      ? `✓ Captured ${activeTargetHand} Hand sample #${sample.id}! Finished all ${activeTargetHand} Hand steps — switch to ${otherHand} Hand or click "Apply & Save to Demo".`
      : `✓ Captured ${activeTargetHand} Hand sample #${sample.id}! Auto-updated optimal thresholds.`;
  }

  if (stepIdx < steps.length - 1) {
    stepIndexByHand[activeTargetHand] = stepIdx + 1;
    renderStepUI();
  }
  return true;
}

function persistSamples() {
  try {
    // Store without large base64 thumbnails if quota is tight, or with thumbnails
    const compact = capturedSamples.map(({ thumbnail, ...rest }) => rest);
    localStorage.setItem(SAMPLES_STORAGE_KEY, JSON.stringify(compact));
    localStorage.setItem(CALIB_STORAGE_KEY, JSON.stringify(currentCalibration));
  } catch (e) {}
}

function loadSavedSamples() {
  try {
    const rawSamples = localStorage.getItem(SAMPLES_STORAGE_KEY);
    if (rawSamples) {
      const parsed = JSON.parse(rawSamples);
      if (Array.isArray(parsed)) capturedSamples = parsed;
    }
  } catch (e) {}
  updateCalibrationDisplay();
  renderSamplesGallery();
}

function applyCalibrationToDemo() {
  currentCalibration = computeOptimalCalibration(capturedSamples);
  try {
    localStorage.setItem(CALIB_STORAGE_KEY, JSON.stringify(currentCalibration));
    const statusEl = document.getElementById('save-status-msg');
    if (statusEl) {
      const perHand = currentCalibration.perHand || {};
      const detail = (perHand.Left && perHand.Right)
        ? `Left (${perHand.Left.metricMode}: [${perHand.Left.thresholds.join(', ')}]) & Right (${perHand.Right.metricMode}: [${perHand.Right.thresholds.join(', ')}])`
        : `${currentCalibration.metricMode}: [${currentCalibration.thresholds.join(', ')}]`;
      statusEl.style.color = 'var(--accent-green)';
      statusEl.innerText = `✓ Saved calibration (${detail}) to Demo! Click "Back to Air Synth Demo" to play.`;
    }
  } catch (e) {}
}

function exportCalibrationJSON() {
  currentCalibration = computeOptimalCalibration(capturedSamples);
  const payload = {
    exportedAt: new Date().toISOString(),
    swapHands,
    recommendedCalibration: currentCalibration,
    samples: capturedSamples.map(({ thumbnail, ...rest }) => rest)
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hand-calibration-data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderLiveTelemetry(detectionResults, canvasCtx) {
  const summaryEl = document.getElementById('live-detection-summary');
  const tbody = document.getElementById('telemetry-tbody');

  const detectedHands = resolveDetectedHands(detectionResults);
  if (detectedHands.length === 0) {
    if (summaryEl) summaryEl.innerText = `No hand currently in frame — hold your ${activeTargetHand} Hand in front of the webcam.`;
    return;
  }

  const handSummaries = [];

  for (const entry of detectedHands) {
    const hMetrics = computeHandMetrics(entry.landmarks);
    const hStates = evaluateFingersWithCalibration(hMetrics, currentCalibration, entry.hand);
    const shortLabels = getShortNoteLabelsForHand(entry.hand);

    if (canvasCtx) {
      for (let i = 0; i < 5; i++) {
        const pt = entry.landmarks[FINGER_TIP_INDICES[i]];
        canvasCtx.fillStyle = hStates[i] ? '#FF0000' : '#00FF00';
        canvasCtx.fillRect(pt.x * canvasCtx.canvas.width - 5, pt.y * canvasCtx.canvas.height - 5, 10, 10);
      }
      const wrist = entry.landmarks[PALM_CENTER_INDEX];
      canvasCtx.fillStyle = entry.hand === 'Left' ? '#00E6FF' : '#FF0080';
      canvasCtx.fillRect(wrist.x * canvasCtx.canvas.width - 5, wrist.y * canvasCtx.canvas.height - 5, 10, 10);
    }

    const activeNames = hStates.map((on, i) => (on ? shortLabels[i] : null)).filter(Boolean);
    handSummaries.push(`${entry.hand} Hand (${activeNames.length ? activeNames.join(', ') : 'Open'})`);
  }

  // Prefer displaying live telemetry for the currently selected target hand
  const focused = detectedHands.find(h => h.hand === activeTargetHand) || detectedHands[0];
  const metrics = computeHandMetrics(focused.landmarks);
  const activeProfile = getCalibrationProfileForHand(currentCalibration, focused.hand);
  const states = evaluateFingersWithCalibration(metrics, currentCalibration, focused.hand);
  const tableLabels = getFingerLabelsForHand(focused.hand);

  if (summaryEl) {
    const focusNote = focused.hand !== activeTargetHand
      ? ` ⚠️ (Target: ${activeTargetHand} Hand not in view)`
      : '';
    summaryEl.innerText = `Detected: ${handSummaries.join('  |  ')} | Telemetry: ${focused.hand} Hand (Palm ${metrics.palmLength.toFixed(3)})${focusNote}`;
  }

  if (tbody) {
    const mode = activeProfile.metricMode || 'ratioToMaxTip';
    tbody.innerHTML = tableLabels.map((name, i) => {
      const rMax = metrics.ratioToMaxTip[i];
      const rPalm = metrics.ratioToPalm[i];
      const rMcp = metrics.tipToMcpOverPalm[i];
      const thresh = activeProfile.thresholds[i];
      const isPlaying = states[i];

      return `
        <tr>
          <td><strong>${name}</strong></td>
          <td style="${mode === 'ratioToMaxTip' ? 'color:var(--accent-cyan);font-weight:700;' : ''}">${rMax.toFixed(3)}</td>
          <td style="${mode === 'ratioToPalm' ? 'color:var(--accent-cyan);font-weight:700;' : ''}">${rPalm.toFixed(3)}</td>
          <td style="${mode === 'tipToMcpOverPalm' ? 'color:var(--accent-cyan);font-weight:700;' : ''}">${rMcp.toFixed(3)}</td>
          <td>&lt; ${thresh.toFixed(3)}</td>
          <td>
            <span style="color:${isPlaying ? 'var(--accent-red)' : 'var(--accent-green)'}; font-weight:700;">
              ${isPlaying ? '● PLAYING' : '○ OPEN'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }
}

async function initCalibrator() {
  setTargetHand(activeTargetHand);
  loadSavedSamples();

  // Wire Left/Right target hand tabs
  document.querySelectorAll('#hand-selector-tabs [data-hand]').forEach(btn => {
    btn.addEventListener('click', () => {
      setTargetHand(btn.getAttribute('data-hand'));
    });
  });

  // Wire gallery filter pills
  document.querySelectorAll('[data-gallery-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      galleryFilterHand = btn.getAttribute('data-gallery-filter') || 'All';
      document.querySelectorAll('[data-gallery-filter]').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      renderSamplesGallery();
    });
  });

  // Wire UI buttons
  document.querySelectorAll('#label-pills-container .finger-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const idx = parseInt(pill.dataset.finger, 10);
      activeLabelFingers[idx] = !activeLabelFingers[idx];
      renderLabelPills();
    });
  });

  const btnClearLabels = document.getElementById('btn-clear-labels');
  if (btnClearLabels) {
    btnClearLabels.addEventListener('click', () => {
      activeLabelFingers = [false, false, false, false, false];
      renderLabelPills();
    });
  }

  const btnPrev = document.getElementById('btn-prev-step');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      const steps = getGuidedStepsForHand(activeTargetHand);
      stepIndexByHand[activeTargetHand] = (stepIndexByHand[activeTargetHand] - 1 + steps.length) % steps.length;
      renderStepUI();
    });
  }

  const btnNext = document.getElementById('btn-next-step');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const steps = getGuidedStepsForHand(activeTargetHand);
      stepIndexByHand[activeTargetHand] = (stepIndexByHand[activeTargetHand] + 1) % steps.length;
      renderStepUI();
    });
  }

  const btnCaptureNow = document.getElementById('btn-capture-now');
  if (btnCaptureNow) {
    btnCaptureNow.addEventListener('click', captureCurrentSample);
  }

  const btnCountdown = document.getElementById('btn-capture-countdown');
  if (btnCountdown) {
    btnCountdown.addEventListener('click', () => {
      const overlay = document.getElementById('countdown-overlay');
      let remaining = 2;
      if (overlay) {
        overlay.style.display = 'flex';
        overlay.innerText = String(remaining);
      }
      const interval = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          if (overlay) overlay.innerText = String(remaining);
        } else {
          clearInterval(interval);
          if (overlay) overlay.style.display = 'none';
          captureCurrentSample();
        }
      }, 1000);
    });
  }

  const btnApply = document.getElementById('btn-apply-calibration');
  if (btnApply) {
    btnApply.addEventListener('click', applyCalibrationToDemo);
  }

  const btnExport = document.getElementById('btn-export-json');
  if (btnExport) {
    btnExport.addEventListener('click', exportCalibrationJSON);
  }

  const btnClearHand = document.getElementById('btn-clear-hand-samples');
  if (btnClearHand) {
    btnClearHand.addEventListener('click', () => {
      capturedSamples = capturedSamples.filter(s => s.hand !== activeTargetHand);
      stepIndexByHand[activeTargetHand] = 0;
      persistSamples();
      updateCalibrationDisplay();
      renderSamplesGallery();
      renderStepUI();
    });
  }

  const btnClearAll = document.getElementById('btn-clear-all-samples');
  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      capturedSamples = [];
      stepIndexByHand.Left = 0;
      stepIndexByHand.Right = 0;
      persistSamples();
      updateCalibrationDisplay();
      renderSamplesGallery();
      renderStepUI();
    });
  }

  const toggleSwap = document.getElementById('toggle-swap-hands');
  if (toggleSwap) {
    toggleSwap.addEventListener('change', (e) => {
      swapHands = Boolean(e.target.checked);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      captureCurrentSample();
    }
  });

  // Load MediaPipe HandLandmarker
  try {
    const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0');
    const vision = await visionModule.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
    );
    handLandmarker = await visionModule.HandLandmarker.createFromOptions(vision, {
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

    const video = document.getElementById('webcam');
    if (video && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      video.addEventListener('loadeddata', predictCalibrationLoop);
    }
  } catch (err) {
    console.warn('Could not initialize MediaPipe in calibration page:', err);
  }
}

function predictCalibrationLoop() {
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('output_canvas');
  if (!video || !canvas) return;
  const ctx = canvas.getContext('2d');

  if (video.videoWidth && video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  if (handLandmarker && lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    latestResults = handLandmarker.detectForVideo(video, performance.now());
  }

  if (ctx) {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderLiveTelemetry(latestResults, ctx);
    ctx.restore();
  }

  requestAnimationFrame(predictCalibrationLoop);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalibrator);
  } else {
    initCalibrator();
  }
}
