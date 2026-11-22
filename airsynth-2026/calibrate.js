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
const FINGER_LABELS = ['1: Thumb (C)', '2: Index (D)', '3: Middle (E)', '4: Ring (F)', '5: Pinky (G)'];
const SHORT_NOTE_LABELS = ['1:C', '2:D', '3:E', '4:F', '5:G'];

const GUIDED_STEPS = [
  {
    title: '1. Open Hand — No Notes (Normal Distance)',
    desc: 'Hold your hand open at a normal distance from the camera with NO fingers bent, then press Spacebar or Capture.',
    fingers: [false, false, false, false, false]
  },
  {
    title: '2. Open Hand — No Notes (Further from Camera)',
    desc: 'Move your open hand further back from the camera (all 5 fingers extended, NO notes playing) and capture.',
    fingers: [false, false, false, false, false]
  },
  {
    title: '3. Play Finger 1 Only — Thumb (Note C)',
    desc: 'Bend ONLY your Thumb (Finger 1) inward to play Note C while keeping fingers 2–5 extended, then capture.',
    fingers: [true, false, false, false, false]
  },
  {
    title: '4. Play Finger 2 Only — Index (Note D)',
    desc: 'Bend ONLY your Index finger (Finger 2) to play Note D while keeping the other fingers extended, then capture.',
    fingers: [false, true, false, false, false]
  },
  {
    title: '5. Play Finger 3 Only — Middle (Note E)',
    desc: 'Bend ONLY your Middle finger (Finger 3) to play Note E while keeping the other fingers extended, then capture.',
    fingers: [false, false, true, false, false]
  },
  {
    title: '6. Play Finger 4 Only — Ring (Note F)',
    desc: 'Bend ONLY your Ring finger (Finger 4) to play Note F while keeping the other fingers extended, then capture.',
    fingers: [false, false, false, true, false]
  },
  {
    title: '7. Play Finger 5 Only — Pinky (Note G)',
    desc: 'Bend ONLY your Pinky finger (Finger 5) to play Note G while keeping the other fingers extended, then capture.',
    fingers: [false, false, false, false, true]
  },
  {
    title: '8. Play Chord: Fingers 1 + 3 (Notes C + E)',
    desc: 'Bend both Thumb (1:C) and Middle (3:E) simultaneously while keeping Index, Ring, and Pinky extended, then capture.',
    fingers: [true, false, true, false, false]
  },
  {
    title: '9. Play Chord: Fingers 2 + 4 (Notes D + F)',
    desc: 'Bend both Index (2:D) and Ring (4:F) simultaneously while keeping Thumb, Middle, and Pinky extended, then capture.',
    fingers: [false, true, false, true, false]
  }
];

let handLandmarker = null;
let lastVideoTime = -1;
let latestResults = null;
let swapHands = false;

let currentStepIndex = 0;
let activeLabelFingers = [false, false, false, false, false];
let capturedSamples = [];
let currentCalibration = {
  metricMode: 'ratioToMaxTip',
  thresholds: [0.60, 0.75, 0.75, 0.75, 0.75],
  accuracy: null,
  sampleCount: 0,
  updatedAt: null
};

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

function evaluateFingersWithCalibration(metrics, calib = currentCalibration) {
  const mode = (calib && calib.metricMode) || 'ratioToMaxTip';
  const thresholds = (calib && calib.thresholds) || [0.60, 0.75, 0.75, 0.75, 0.75];
  const values = metrics[mode] || metrics.ratioToMaxTip;
  return values.map((v, i) => v < thresholds[i]);
}

function getHandCategory(detectionResults, index) {
  const list = (detectionResults && (detectionResults.handednesses || detectionResults.handedness)) || [];
  const entry = list[index];
  let raw = '';
  if (Array.isArray(entry) && entry[0]) {
    raw = entry[0].categoryName || entry[0].displayName || entry[0].label || '';
  } else if (entry && typeof entry === 'object') {
    raw = entry.categoryName || entry.displayName || entry.label || '';
  } else if (typeof entry === 'string') {
    raw = entry;
  }
  const lower = String(raw).trim().toLowerCase();
  let rawHand = lower.startsWith('l') ? 'Left' : (lower.startsWith('r') ? 'Right' : (index === 0 ? 'Right' : 'Left'));
  if (!swapHands) {
    return rawHand === 'Left' ? 'Right' : 'Left';
  }
  return rawHand;
}

/**
 * Finds the optimal per-finger thresholds and best normalization metric across all captured samples.
 */
function computeOptimalCalibration(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return currentCalibration;
  }

  const candidateModes = ['ratioToMaxTip', 'ratioToPalm', 'tipToMcpOverPalm'];
  const defaultThresholdsByMode = {
    ratioToMaxTip: [0.60, 0.75, 0.75, 0.75, 0.75],
    ratioToPalm: [1.15, 1.50, 1.55, 1.50, 1.35],
    tipToMcpOverPalm: [1.10, 0.75, 0.80, 0.75, 0.68]
  };

  let bestResult = null;

  for (const mode of candidateModes) {
    const thresholds = [...defaultThresholdsByMode[mode]];
    const fingerStats = [];
    let totalChecks = 0;
    let totalCorrect = 0;

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

      if (playingVals.length > 0 && openVals.length > 0) {
        // Search candidate split points between min(playing) and max(open)
        const allSorted = [...new Set([...playingVals, ...openVals])].sort((a, b) => a - b);
        const candidates = [];
        for (let i = 0; i < allSorted.length - 1; i++) {
          candidates.push((allSorted[i] + allSorted[i + 1]) / 2);
        }
        // Also include midpoint between max(playing) and min(open)
        const maxPlay = Math.max(...playingVals);
        const minOpen = Math.min(...openVals);
        const meanPlay = playingVals.reduce((a, b) => a + b, 0) / playingVals.length;
        const meanOpen = openVals.reduce((a, b) => a + b, 0) / openVals.length;
        candidates.push((maxPlay + minOpen) / 2);
        candidates.push((meanPlay + meanOpen) / 2);

        let bestT = thresholds[f];
        let bestHits = -1;
        let bestMargin = -Infinity;

        for (const t of candidates) {
          let hits = 0;
          for (const v of playingVals) if (v < t) hits++;
          for (const v of openVals) if (v >= t) hits++;
          const margin = -Math.abs(t - (meanPlay + meanOpen) / 2);
          if (hits > bestHits || (hits === bestHits && margin > bestMargin)) {
            bestHits = hits;
            bestMargin = margin;
            bestT = t;
          }
        }
        thresholds[f] = Number(bestT.toFixed(4));
      } else if (openVals.length > 0) {
        // Only open samples so far: set threshold 18% below the minimum open value
        const minOpen = Math.min(...openVals);
        thresholds[f] = Number((minOpen * 0.82).toFixed(4));
      } else if (playingVals.length > 0) {
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
        accuracy: fTotal > 0 ? Number(((fCorrect / fTotal) * 100).toFixed(1)) : 100
      });
    }

    const overallAccuracy = totalChecks > 0 ? Number(((totalCorrect / totalChecks) * 100).toFixed(1)) : 0;
    const candidateResult = {
      metricMode: mode,
      thresholds,
      fingerStats,
      accuracy: overallAccuracy,
      sampleCount: samples.length,
      updatedAt: new Date().toISOString()
    };

    if (!bestResult || candidateResult.accuracy > bestResult.accuracy) {
      bestResult = candidateResult;
    }
  }

  return bestResult || currentCalibration;
}

function updateCalibrationDisplay() {
  currentCalibration = computeOptimalCalibration(capturedSamples);

  const badge = document.getElementById('accuracy-badge');
  const box = document.getElementById('calibration-results-box');
  if (badge) {
    badge.innerText = capturedSamples.length > 0
      ? `${capturedSamples.length} samples • ${currentCalibration.accuracy}% accuracy (${currentCalibration.metricMode})`
      : '0 samples captured';
  }

  if (!box) return;
  if (capturedSamples.length === 0) {
    box.innerHTML = 'Capture at least 1 "Open Hand (No Notes)" frame and 1+ bent-finger frames to auto-compute optimal per-finger thresholds for your hands.';
    return;
  }

  const lines = (currentCalibration.fingerStats || []).map(st => {
    const playStr = st.playingMean !== null ? st.playingMean : '—';
    const openStr = st.openMean !== null ? st.openMean : '—';
    return `<div><strong>${st.label}</strong>: threshold = <span style="color:var(--accent-cyan)">${st.threshold}</span> (bent avg: ${playStr}, open avg: ${openStr}, acc: ${st.accuracy}%)</div>`;
  });

  box.innerHTML = `
    <div style="margin-bottom:6px; color:var(--accent-gold);">
      <strong>Best Metric Mode:</strong> <code>${currentCalibration.metricMode}</code> &nbsp;|&nbsp;
      <strong>Thresholds:</strong> <code>[${currentCalibration.thresholds.join(', ')}]</code>
    </div>
    ${lines.join('')}
  `;
}

function renderStepUI() {
  const step = GUIDED_STEPS[currentStepIndex];
  const badge = document.getElementById('step-progress-badge');
  const title = document.getElementById('guided-prompt-title');
  const desc = document.getElementById('guided-prompt-desc');

  if (badge) badge.innerText = `Guided Step ${currentStepIndex + 1} / ${GUIDED_STEPS.length}`;
  if (title) title.innerText = step.title;
  if (desc) desc.innerText = step.desc;

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

  const gallery = document.getElementById('samples-gallery');
  if (!gallery) return;

  if (capturedSamples.length === 0) {
    gallery.innerHTML = '<div style="color: var(--text-dim); font-size: 12px;">No captured frames yet. Hold a hand pose in front of the webcam and press Spacebar or click "Capture Frame Now".</div>';
    return;
  }

  gallery.innerHTML = '';
  capturedSamples.slice().reverse().forEach((sample) => {
    const card = document.createElement('div');
    card.className = 'sample-card';

    const notesText = sample.expectedFingers
      .map((active, i) => (active ? SHORT_NOTE_LABELS[i] : null))
      .filter(Boolean)
      .join(', ') || 'No Notes (Open Hand)';

    card.innerHTML = `
      <div class="sample-card-header">
        <span>#${sample.id} • <strong style="color:var(--accent-cyan)">${sample.hand} Hand</strong></span>
        <button class="mini-pill" data-delete="${sample.id}" title="Delete this capture">✕</button>
      </div>
      ${sample.thumbnail ? `<img src="${sample.thumbnail}" alt="Capture #${sample.id}">` : ''}
      <div style="font-size:11px; color:var(--text-main);">
        <strong>Label:</strong> <span style="color:var(--accent-magenta)">${notesText}</span>
      </div>
      <div style="font-family:var(--font-mono); font-size:10px; color:var(--text-dim);">
        ratioToMax: [${sample.metrics.ratioToMaxTip.map(n => n.toFixed(2)).join(', ')}]<br>
        ratioToPalm: [${sample.metrics.ratioToPalm.map(n => n.toFixed(2)).join(', ')}]
      </div>
      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        ${SHORT_NOTE_LABELS.map((lbl, fIdx) => `
          <button class="mini-pill ${sample.expectedFingers[fIdx] ? 'active' : ''}" data-sample-id="${sample.id}" data-toggle-finger="${fIdx}">
            ${lbl}
          </button>
        `).join('')}
      </div>
    `;

    gallery.appendChild(card);
  });

  // Wire relabel and delete buttons
  gallery.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-delete'), 10);
      capturedSamples = capturedSamples.filter(s => s.id !== id);
      persistSamples();
      updateCalibrationDisplay();
      renderSamplesGallery();
    });
  });

  gallery.querySelectorAll('[data-toggle-finger]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-sample-id'), 10);
      const fIdx = parseInt(btn.getAttribute('data-toggle-finger'), 10);
      const sample = capturedSamples.find(s => s.id === id);
      if (sample) {
        sample.expectedFingers[fIdx] = !sample.expectedFingers[fIdx];
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
  if (!latestResults || !Array.isArray(latestResults.landmarks) || latestResults.landmarks.length === 0) {
    if (statusEl) {
      statusEl.style.color = 'var(--accent-red)';
      statusEl.innerText = '⚠️ No hand detected in camera feed! Hold your hand in view of the camera first.';
    }
    return;
  }

  const video = document.getElementById('webcam');
  const count = Math.min(2, latestResults.landmarks.length);

  for (let i = 0; i < count; i++) {
    const landmarks = latestResults.landmarks[i];
    const hand = getHandCategory(latestResults, i);
    const metrics = computeHandMetrics(landmarks);
    const thumbnail = video ? captureThumbnail(video, landmarks) : null;

    const sample = {
      id: capturedSamples.length + 1,
      timestamp: new Date().toISOString(),
      hand,
      stepTitle: GUIDED_STEPS[currentStepIndex] ? GUIDED_STEPS[currentStepIndex].title : 'Custom',
      expectedFingers: [...activeLabelFingers],
      expectedNotes: activeLabelFingers
        .map((active, fIdx) => (active ? SHORT_NOTE_LABELS[fIdx] : null))
        .filter(Boolean),
      metrics,
      landmarks: landmarks.map(lm => ({
        x: Number(lm.x.toFixed(5)),
        y: Number(lm.y.toFixed(5)),
        z: Number((lm.z || 0).toFixed(5))
      })),
      thumbnail
    };

    capturedSamples.push(sample);
  }

  persistSamples();
  updateCalibrationDisplay();
  renderSamplesGallery();

  if (statusEl) {
    statusEl.style.color = 'var(--accent-green)';
    statusEl.innerText = `✓ Captured sample #${capturedSamples.length}! Auto-updated optimal thresholds.`;
  }

  // Automatically advance guided step if not on last step
  if (currentStepIndex < GUIDED_STEPS.length - 1) {
    currentStepIndex++;
    renderStepUI();
  }
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
      statusEl.style.color = 'var(--accent-green)';
      statusEl.innerText = `✓ Saved calibration (${currentCalibration.metricMode}: [${currentCalibration.thresholds.join(', ')}]) to Demo! Click "Back to Air Synth Demo" to play.`;
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

  if (!detectionResults || !Array.isArray(detectionResults.landmarks) || detectionResults.landmarks.length === 0) {
    if (summaryEl) summaryEl.innerText = 'No hand currently in frame — hold your hand in front of the webcam.';
    return;
  }

  const landmarks = detectionResults.landmarks[0];
  const hand = getHandCategory(detectionResults, 0);
  const metrics = computeHandMetrics(landmarks);
  const states = evaluateFingersWithCalibration(metrics, currentCalibration);

  if (canvasCtx) {
    for (let i = 0; i < 5; i++) {
      const pt = landmarks[FINGER_TIP_INDICES[i]];
      canvasCtx.fillStyle = states[i] ? '#FF0000' : '#00FF00';
      canvasCtx.fillRect(pt.x * canvasCtx.canvas.width - 5, pt.y * canvasCtx.canvas.height - 5, 10, 10);
    }
    const wrist = landmarks[PALM_CENTER_INDEX];
    canvasCtx.fillStyle = '#00E6FF';
    canvasCtx.fillRect(wrist.x * canvasCtx.canvas.width - 5, wrist.y * canvasCtx.canvas.height - 5, 10, 10);
  }

  const activeNoteNames = states.map((on, i) => (on ? SHORT_NOTE_LABELS[i] : null)).filter(Boolean);
  if (summaryEl) {
    summaryEl.innerText = `Detected: ${hand} Hand | Palm Size: ${metrics.palmLength.toFixed(3)} | Live Triggered Notes: ${activeNoteNames.length ? activeNoteNames.join(', ') : 'None (Open Hand)'}`;
  }

  if (tbody) {
    const mode = currentCalibration.metricMode || 'ratioToMaxTip';
    tbody.innerHTML = FINGER_LABELS.map((name, i) => {
      const rMax = metrics.ratioToMaxTip[i];
      const rPalm = metrics.ratioToPalm[i];
      const rMcp = metrics.tipToMcpOverPalm[i];
      const thresh = currentCalibration.thresholds[i];
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
  renderStepUI();
  loadSavedSamples();

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
      currentStepIndex = (currentStepIndex - 1 + GUIDED_STEPS.length) % GUIDED_STEPS.length;
      renderStepUI();
    });
  }

  const btnNext = document.getElementById('btn-next-step');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      currentStepIndex = (currentStepIndex + 1) % GUIDED_STEPS.length;
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

  const btnClearAll = document.getElementById('btn-clear-all-samples');
  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      capturedSamples = [];
      persistSamples();
      updateCalibrationDisplay();
      renderSamplesGallery();
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
      numHands: 2
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
