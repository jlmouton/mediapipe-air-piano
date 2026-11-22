# MediaPipe Demos: Air Synth & Air Piano

This repository contains browser-based musical demos built with the [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker) task to play music in real time using hand and finger movements in front of a computer or phone camera.

[MediaPipe](https://developers.google.com/edge/mediapipe/) is an open-source framework for running machine learning models on-device.

## Demos Overview

| Demo | Folder | Hands | Audio Engine | Live Demo |
| --- | --- | --- | --- | --- |
| **Air Synthesizer (2026)** | [`airsynth-2026/`](airsynth-2026/) | 2 hands | Dual Web Audio synths (Fractal Pad + Bowed Violin) & Studio FX rack | [Try it live](https://www.atuetete.com/web-synthesizers/airsynth/) |
| **Air Piano (2023)** | [`airpiano-2023/`](airpiano-2023/) | 1 hand | Raw square-wave oscillators (5-note polyphony) | [Try it live](https://www.atuetete.com/web-synthesizers/airpiano/) |
| **Air Piano Offline** | [`airpiano-2023-offline/`](airpiano-2023-offline/) | 1 hand | Same as Air Piano (2023), fully self-hosted for offline use | Local only |

---

## Air Synthesizer (2026)

Folder: [`airsynth-2026/`](airsynth-2026/) — **[Try the live demo](https://www.atuetete.com/web-synthesizers/airsynth/)**

This project was developed for the GDG DevFest 2026 season. I used the Google Antigravity coding agent to assist in building it and bringing together components from my [Web Audio synthesizer projects](https://github.com/jlmouton/websynths) with hand landmark note triggering from my legacy Air Piano demo below.

### How It Works

Click **Start Audio Engine** in the top bar (required by browser autoplay policies), grant webcam access, and bend individual fingers toward your palm to trigger notes. If your camera feed is already mirrored, use the **Switch Left / Right Hands (Mirror Mode)** toggle in the side panel.

- **Left Hand — Monophonic Fractal Synthesizer (*Seahorse Valley Pad*):**
  - Plays a monophonic evolving drone pad powered by the Hyper-Drone engine (`Dual Morph`, `Swirl LFO`, and dedicated `Wavefolder` controls).
  - Moving your palm **up and down** in the camera viewport while holding a note modulates the synth's dedicated **Wavefolder** distortion (0% to 40% across 25% of the viewport height, without resetting between notes).
  - **YouTube Drum Track Gesture:** Transitioning from an **open hand** to bringing **all 5 fingertips together** toggles Play/Pause on an embedded YouTube drum loop. You can choose among four backing drum tracks (60–100 BPM) from the right-hand side dropdown or reset playback with the **Reload** button.

- **Right Hand — Polyphonic Bowed Violin String Synth:**
  - Plays a physical-modeling bowed string preset with up to 5-note polyphony (`Bow Force`, `Bow Speed`, `Bow Pos (β)`, and `Rosin Grit` controls).
  - Moving your palm **left and right** while holding a note applies per-note **pitch bend** (half the camera viewport equals 1 whole tone / ±200 cents).

### Finger-to-Note Mapping

| Finger | Left Hand (Fractal Pad — Mono) | Right Hand (Bowed Violin — Poly) |
| --- | --- | --- |
| 1 — Thumb | `C3` | `C4` |
| 2 — Index | `B2` | `D4` |
| 3 — Middle | `A2` | `E4` |
| 4 — Ring | `G2` | `F4` |
| 5 — Pinky | `F2` | `G4` |

### Shared Studio Audio Effects Pipeline

Both synthesizers feed into a shared, toggleable Web Audio effects chain:

`Multi-Mode Filter` → `Wavefolder` → `Vector Chorus` → `Ping-Pong Echo` → `FDN Diffusion Reverb` → `Limiter`

### Hand Calibration Tool

The web UI includes a link to the **Hand Calibration & Labeled Capture Studio** ([`airsynth-2026/calibrate.html`](airsynth-2026/calibrate.html)). Use this guided 9-step tool to capture webcam snapshots of your own hand poses, automatically compute optimal scale-invariant thresholds tailored to your finger length and dexterity, save them directly to your browser (`localStorage`), or export the labeled dataset as JSON.

---

## Air Piano (2023)

Folder: [`airpiano-2023/`](airpiano-2023/) — **[Try the live demo](https://www.atuetete.com/web-synthesizers/airpiano/)**

This project was developed from scratch for the GDG DevFest 2023 season and demoed at several developer events to present on-device machine learning with MediaPipe.

- Tracks **1 hand** using MediaPipe Hand Landmarker via CDN.
- Generates sound with a raw Web Audio **square-wave oscillator** (no effects).
- Supports **5-note full polyphony** (`C`, `D`, `E`, `F`, `G`) triggered by bringing each fingertip close to the wrist.

---

## Air Piano Offline

Folder: [`airpiano-2023-offline/`](airpiano-2023-offline/)

A self-contained version of the 2023 Air Piano created to demonstrate that MediaPipe supports true **offline execution** in the browser with no external network requests.

All runtime dependencies—the MediaPipe Tasks Vision bundle (`tasks-vision@0.10.0.js`, `hands.js`), the WebAssembly inference runtime (`vision_wasm_internal.js`, `vision_wasm_internal.wasm`), and the Hand Landmarker model (`hand_landmarker.task`)—are stored directly inside the folder, and the loader code points to these local files instead of a CDN.
