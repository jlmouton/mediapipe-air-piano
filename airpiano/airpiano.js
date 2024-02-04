import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

let handLandmarker = undefined;
// Before we can use HandLandmarker class we must wait for it to finish loading.
async function createHandLandmarker() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
    });
}
createHandLandmarker();

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
// Check if webcam access is supported.
const hasGetUserMedia = () => { var _a; return !!((_a = navigator.mediaDevices) === null || _a === void 0 ? void 0 : _a.getUserMedia); };
if (!hasGetUserMedia()) {
    console.warn("getUserMedia() is not supported by your browser");
}

// Enable the live webcam view and start detection.
async function enableCam() {
    if (!handLandmarker) {
        console.log("objectDetector not loaded yet, retrying in 100ms");
        setTimeout(enableCam, 100);
        return;
    }

    // Activate the webcam stream.
    const constraints = {
        video: true
    };
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });

    // Now let's start detecting the stream.
    await handLandmarker.setOptions({ runningMode: "VIDEO" });
}
enableCam();


let lastVideoTime = -1;
let results = undefined;

async function predictWebcam() {
    canvasElement.style.width = video.videoWidth;
    canvasElement.style.height = video.videoHeight;
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = handLandmarker.detectForVideo(video, startTimeMs);
    }
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (results.landmarks && results.landmarks.length) {
        const landmarks = results.landmarks[0];
        // calculate the distance between each fingertip and the wrist
        // to decide if the finger is in "play" position or not
        let play1 = distance(landmarks[4], landmarks[0]) < 0.3;
        let play2 = distance(landmarks[8], landmarks[0]) < 0.4;
        let play3 = distance(landmarks[12], landmarks[0]) < 0.4;
        let play4 = distance(landmarks[16], landmarks[0]) < 0.4;
        let play5 = distance(landmarks[20], landmarks[0]) < 0.4;

        // draw the 5 finger tip locations
        drawFinger(canvasCtx, landmarks[4], play1);
        drawFinger(canvasCtx, landmarks[8], play2);
        drawFinger(canvasCtx, landmarks[12], play3);
        drawFinger(canvasCtx, landmarks[16], play4);
        drawFinger(canvasCtx, landmarks[20], play5);
        // draw the wrist location
        drawFinger(canvasCtx, landmarks[0], true);

        // play (or stop playing) the note associated to each finger
        playFingerIfCloseToWrist(514, 0, play1);
        playFingerIfCloseToWrist(577, 1, play2);
        playFingerIfCloseToWrist(647, 2, play3);
        playFingerIfCloseToWrist(686, 3, play4);
        playFingerIfCloseToWrist(770, 4, play5);
    }
    canvasCtx.restore();

    // Call this function again to keep predicting when the browser is ready.
    window.requestAnimationFrame(predictWebcam);
}

// distance between 2 landmarks
function distance(landmark1, landmark2) {
  return Math.sqrt((landmark1.y - landmark2.y)**2 + (landmark1.x - landmark2.x)**2);
}

// very basic point drawing function
function drawFinger(ctx, fingerTip, active) {
  if (active) {
    ctx.fillStyle = "#FF0000";
  } else {
    ctx.fillStyle = "#00FF00";
  }
  let x = Math.abs(fingerTip.x * ctx.canvas.width);
  let y = Math.abs(fingerTip.y * ctx.canvas.height);
  ctx.fillRect(x-5, y-5, 10, 10);
}

function playFingerIfCloseToWrist(frequency, fingerNb, active) {
  if (active) {
    if(!oscillators[fingerNb]) {
      oscillators[fingerNb] = playNote(frequency, 1.0);
    }
  } else {
    if (oscillators[fingerNb]) {
      stopNote(oscillators[fingerNb]);
      oscillators[fingerNb] = 0;
    }
  }
}

// my even more basic note playing synthetizer
var oscillators = new Array(5);
function playNote(frequency, volume) {
  var ctx = new AudioContext();
  var gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);
    
  // create a new oscillator for each note
  var osc = ctx.createOscillator();
  osc.type = 'square'; // 'sine', 'triangle', 'sawtooth';
  osc.connect(gainNode);

  // set frequency and volume 
  osc.frequency.setTargetAtTime(frequency, ctx.currentTime, 0);
  osc.gain = 1.0;
  gainNode.gain.setTargetAtTime(parseFloat(volume), 0.002, 0.002);
          
  osc.start(0);
  return osc;
}

function stopNote(osc) {
  osc.stop();
}
