/**
 * Deterministic Browser DOM, Canvas 2D, MediaPipe HandLandmarker & Web Audio API Test Harness
 * Executes the demo scripts inside a shared browser-like VM context
 * loaded directly from demo/index.html <script> tags.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.defaultValue = defaultValue;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'setValueAtTime', value, time });
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'linearRampToValueAtTime', value, time });
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'exponentialRampToValueAtTime', value, time });
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value;
    this.events.push({ type: 'setTargetAtTime', value, time, timeConstant });
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancelScheduledValues', time });
  }
}

class MockAudioNode {
  constructor(name, ctx) {
    this.nodeType = name;
    this.context = ctx;
    this.connections = [];
    this.disconnected = false;
  }

  connect(dest, output = 0, input = 0) {
    this.connections.push({ dest, output, input });
    return dest;
  }

  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}

class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = [];
    for (let c = 0; c < numberOfChannels; c++) {
      this.channels.push(new Float32Array(length));
    }
  }

  getChannelData(channel) {
    return this.channels[channel];
  }
}

class MockPeriodicWave {
  constructor(real, imag) {
    this.real = new Float32Array(real);
    this.imag = new Float32Array(imag);
  }
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0.0;
    this.state = 'running';
    this.destination = new MockAudioNode('AudioDestinationNode', this);
    this.createdNodes = [];
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }

  createPeriodicWave(real, imag) {
    return new MockPeriodicWave(real, imag);
  }

  createBuffer(numberOfChannels, length, sampleRate) {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource() {
    const node = new MockAudioNode('AudioBufferSourceNode', this);
    node.buffer = null;
    node.loop = false;
    node.playbackRate = new MockAudioParam(1.0);
    node.started = false;
    node.stopped = false;
    node.start = (when = 0) => { node.started = true; node.startTime = when; };
    node.stop = (when = 0) => { node.stopped = true; node.stopTime = when; };
    this.createdNodes.push(node);
    return node;
  }

  createOscillator() {
    const node = new MockAudioNode('OscillatorNode', this);
    node.type = 'sine';
    node.frequency = new MockAudioParam(440);
    node.detune = new MockAudioParam(0);
    node.periodicWave = null;
    node.started = false;
    node.stopped = false;
    node.setPeriodicWave = (wave) => {
      node.periodicWave = wave;
      node.type = 'custom';
    };
    node.start = (when = 0) => { node.started = true; node.startTime = when; };
    node.stop = (when = 0) => { node.stopped = true; node.stopTime = when; };
    this.createdNodes.push(node);
    return node;
  }

  createGain() {
    const node = new MockAudioNode('GainNode', this);
    node.gain = new MockAudioParam(1.0);
    this.createdNodes.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = new MockAudioNode('BiquadFilterNode', this);
    node.type = 'lowpass';
    node.frequency = new MockAudioParam(350);
    node.Q = new MockAudioParam(1.0);
    node.gain = new MockAudioParam(0.0);
    this.createdNodes.push(node);
    return node;
  }

  createWaveShaper() {
    const node = new MockAudioNode('WaveShaperNode', this);
    node.curve = null;
    node.oversample = 'none';
    this.createdNodes.push(node);
    return node;
  }

  createDelay(maxDelayTime = 1.0) {
    const node = new MockAudioNode('DelayNode', this);
    node.maxDelayTime = maxDelayTime;
    node.delayTime = new MockAudioParam(0.0);
    this.createdNodes.push(node);
    return node;
  }

  createConvolver() {
    const node = new MockAudioNode('ConvolverNode', this);
    node.buffer = null;
    node.normalize = true;
    this.createdNodes.push(node);
    return node;
  }

  createDynamicsCompressor() {
    const node = new MockAudioNode('DynamicsCompressorNode', this);
    node.threshold = new MockAudioParam(-24);
    node.knee = new MockAudioParam(30);
    node.ratio = new MockAudioParam(12);
    node.attack = new MockAudioParam(0.003);
    node.release = new MockAudioParam(0.25);
    this.createdNodes.push(node);
    return node;
  }

  createChannelMerger(numberOfInputs = 2) {
    const node = new MockAudioNode('ChannelMergerNode', this);
    node.numberOfInputs = numberOfInputs;
    this.createdNodes.push(node);
    return node;
  }

  createStereoPanner() {
    const node = new MockAudioNode('StereoPannerNode', this);
    node.pan = new MockAudioParam(0.0);
    this.createdNodes.push(node);
    return node;
  }

  createAnalyser() {
    const node = new MockAudioNode('AnalyserNode', this);
    node.fftSize = 2048;
    Object.defineProperty(node, 'frequencyBinCount', {
      get() { return Math.floor(node.fftSize / 2); }
    });
    node.smoothingTimeConstant = 0.8;
    node.getByteFrequencyData = (array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(128 * Math.exp(-i / 64));
      }
    };
    node.getByteTimeDomainData = (array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(128 + 60 * Math.sin((2 * Math.PI * i) / 64));
      }
    };
    this.createdNodes.push(node);
    return node;
  }
}

class MockCanvas2DContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.drawCalls = [];
  }

  fillRect(x, y, w, h) {
    this.drawCalls.push({ op: 'fillRect', x, y, w, h, fillStyle: this.fillStyle });
  }

  strokeRect(x, y, w, h) {
    this.drawCalls.push({ op: 'strokeRect', x, y, w, h, strokeStyle: this.strokeStyle });
  }

  clearRect(x, y, w, h) {
    this.drawCalls.push({ op: 'clearRect', x, y, w, h });
  }

  beginPath() { this.drawCalls.push({ op: 'beginPath' }); }
  moveTo(x, y) { this.drawCalls.push({ op: 'moveTo', x, y }); }
  lineTo(x, y) { this.drawCalls.push({ op: 'lineTo', x, y }); }
  arc(x, y, r, s, e) { this.drawCalls.push({ op: 'arc', x, y, r, s, e }); }
  stroke() { this.drawCalls.push({ op: 'stroke' }); }
  fill() { this.drawCalls.push({ op: 'fill' }); }
  fillText(text, x, y) { this.drawCalls.push({ op: 'fillText', text, x, y }); }
  save() { this.drawCalls.push({ op: 'save' }); }
  restore() { this.drawCalls.push({ op: 'restore' }); }
}

class MockElement {
  constructor(tagName = 'DIV', doc = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.id = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this._className = '';
    this._classSet = new Set();
    this._innerText = '';
    this._innerHTML = '';
    this.width = (this.tagName === 'CANVAS' || this.tagName === 'VIDEO') ? 480 : 100;
    this.height = (this.tagName === 'CANVAS' || this.tagName === 'VIDEO') ? 360 : 40;
    this.videoWidth = this.tagName === 'VIDEO' ? 480 : 0;
    this.videoHeight = this.tagName === 'VIDEO' ? 360 : 0;
    this.currentTime = 0;
    this._ctx2d = null;

    this.classList = {
      add: (...cls) => cls.forEach(c => { if (c) this._classSet.add(c); }),
      remove: (...cls) => cls.forEach(c => this._classSet.delete(c)),
      contains: (c) => this._classSet.has(c),
      toggle: (c) => {
        if (this._classSet.has(c)) { this._classSet.delete(c); return false; }
        this._classSet.add(c); return true;
      }
    };
  }

  get options() {
    return this.children.filter(c => c.tagName === 'OPTION');
  }

  get className() {
    return Array.from(this._classSet).join(' ');
  }

  set className(val) {
    this._className = val || '';
    this._classSet = new Set((val || '').split(/\s+/).filter(Boolean));
  }

  get innerText() {
    return this._innerText;
  }

  set innerText(val) {
    this._innerText = String(val ?? '');
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = String(val ?? '');
    if (val === '') {
      this.children = [];
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    if (this.ownerDocument && child.id) {
      this.ownerDocument._registerElement(child);
    }
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      if (child.selected || this.value === '') {
        this.value = child.value;
      }
    }
    return child;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    const evt = {
      target: this,
      currentTarget: this,
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: 50,
      clientY: 25,
      deltaY: -10,
      ...event
    };
    const handlers = this.listeners[evt.type] || [];
    handlers.forEach(fn => fn(evt));
  }

  click(extra = {}) {
    this.dispatchEvent({ type: 'click', ...extra });
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.width || 200,
      height: this.height || 100
    };
  }

  getContext(type) {
    if (type === '2d') {
      if (!this._ctx2d) {
        this._ctx2d = new MockCanvas2DContext(this);
      }
      return this._ctx2d;
    }
    return null;
  }

  _matches(selector) {
    const parts = selector.split(',').map(s => s.trim());
    for (const part of parts) {
      if (part.startsWith('#')) {
        if (this.id === part.slice(1)) return true;
      } else if (part.startsWith('.')) {
        const clsName = part.slice(1);
        if (this.classList.contains(clsName)) return true;
      } else if (this.tagName === part.toUpperCase()) {
        return true;
      }
    }
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child._matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

class MockDocument {
  constructor() {
    this.readyState = 'complete';
    this.elementsById = new Map();
    this.allElements = [];
    this.head = new MockElement('HEAD', this);
    this.body = new MockElement('BODY', this);
    this.activeElement = this.body;
    this.listeners = {};
  }

  createElement(tag) {
    const el = new MockElement(tag, this);
    this.allElements.push(el);
    return el;
  }

  _registerElement(el) {
    if (el.id) this.elementsById.set(el.id, el);
    if (!this.allElements.includes(el)) this.allElements.push(el);
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this.allElements.filter(el => el._matches(selector));
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
}

function populateDOMFromHTML(doc, htmlContent) {
  const tagRegex = /<\/([a-zA-Z0-9]+)>|<([a-zA-Z0-9]+)\s+([^>]+)>/g;
  let match;
  let currentSelect = null;
  while ((match = tagRegex.exec(htmlContent)) !== null) {
    if (match[1]) {
      if (match[1].toUpperCase() === 'SELECT') {
        currentSelect = null;
      }
      continue;
    }

    const tag = match[2].toUpperCase();
    const attrs = match[3];

    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const classMatch = attrs.match(/\bclass="([^"]+)"/);
    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const valueMatch = attrs.match(/\bvalue="([^"]+)"/);
    const typeMatch = attrs.match(/\btype="([^"]+)"/);
    const styleMatch = attrs.match(/\bstyle="([^"]+)"/);
    const widthMatch = attrs.match(/\bwidth="(\d+)"/);
    const heightMatch = attrs.match(/\bheight="(\d+)"/);
    const checked = /\bchecked\b/.test(attrs);
    const selected = /\bselected\b/.test(attrs);

    if (idMatch || classMatch || nameMatch || tag === 'OPTION' || tag === 'SELECT') {
      const el = doc.createElement(tag);
      if (idMatch) el.id = idMatch[1];
      if (classMatch) el.className = classMatch[1];
      if (nameMatch) el.name = nameMatch[1];
      if (valueMatch) el.value = valueMatch[1];
      if (typeMatch) el.type = typeMatch[1];
      if (widthMatch) el.width = parseInt(widthMatch[1], 10);
      if (heightMatch) el.height = parseInt(heightMatch[1], 10);
      el.checked = checked;
      el.selected = selected;

      if (styleMatch) {
        styleMatch[1].split(';').forEach(decl => {
          const [rawKey, rawVal] = decl.split(':');
          if (rawKey && rawVal) {
            const key = rawKey.trim().replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
            el.style[key] = rawVal.trim();
          }
        });
      }

      if (tag === 'OPTION') {
        const rest = htmlContent.slice(tagRegex.lastIndex);
        const closeIdx = rest.search(/<\/option>/i);
        if (closeIdx !== -1) {
          el.innerText = rest.slice(0, closeIdx).trim();
        }
      }

      if (el.classList.contains('knob-control')) {
        const progress = doc.createElement('CIRCLE');
        progress.className = 'knob-progress';
        const valSpan = doc.createElement('SPAN');
        valSpan.className = 'knob-val';
        el.appendChild(progress);
        el.appendChild(valSpan);
      }

      doc._registerElement(el);
      if (tag === 'OPTION' && currentSelect) {
        currentSelect.appendChild(el);
      } else {
        doc.body.appendChild(el);
      }

      if (tag === 'SELECT') {
        currentSelect = el;
      }
    }
  }

  // Ensure select#filter-type-select-v2 defaults to lowpass as in HTML
  const filterSelect = doc.getElementById('filter-type-select-v2');
  if (filterSelect && !filterSelect.value) {
    filterSelect.value = 'lowpass';
  }
}

/**
 * Helper to construct a 21-landmark hand array.
 * - `palmX`, `palmY`: coordinates of `landmarks[0]` (palm center / wrist)
 * - `activeFingers`: array of 5 booleans [thumb, index, middle, ring, pinky].
 * - `scale`: multiplier for fingertip-to-palm distances to simulate moving closer/further from the camera.
 */
function buildHandLandmarks({ palmX = 0.5, palmY = 0.7, activeFingers = [false, false, false, false, false], scale = 1.0 } = {}) {
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: palmX, y: Math.max(0.05, palmY - 0.15 * scale), z: 0 });
  }
  landmarks[0] = { x: palmX, y: palmY, z: 0 };

  const tipIndices = [4, 8, 12, 16, 20];
  for (let f = 0; f < 5; f++) {
    const tipIdx = tipIndices[f];
    const isPlaying = Boolean(activeFingers[f]);
    const dist = (isPlaying ? 0.15 : 0.45) * scale;
    landmarks[tipIdx] = {
      x: Math.min(0.98, Math.max(0.02, palmX)),
      y: Math.min(0.98, Math.max(0.02, palmY - dist)),
      z: 0
    };
  }
  return landmarks;
}

/**
 * Helper to construct a realistic 21-landmark hand for testing the Left Hand YouTube gesture:
 * - `pose: 'open'`     -> All 5 fingers spread open, none curled in play position
 * - `pose: 'together'` -> All 5 fingertips pinched/clustered tightly together
 * - `pose: 'fist'`     -> All 5 fingers curled closely together into the palm
 */
function buildLeftGestureHand({ palmX = 0.35, palmY = 0.72, pose = 'open', scale = 1.0 } = {}) {
  const clamp = (v) => Math.min(0.98, Math.max(0.02, v));
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: clamp(palmX), y: clamp(palmY - 0.14 * scale), z: 0 });
  }
  landmarks[0] = { x: clamp(palmX), y: clamp(palmY), z: 0 };
  landmarks[5] = { x: clamp(palmX - 0.06 * scale), y: clamp(palmY - 0.19 * scale), z: 0 };
  landmarks[9] = { x: clamp(palmX), y: clamp(palmY - 0.20 * scale), z: 0 };
  landmarks[13] = { x: clamp(palmX + 0.03 * scale), y: clamp(palmY - 0.19 * scale), z: 0 };
  landmarks[17] = { x: clamp(palmX + 0.06 * scale), y: clamp(palmY - 0.17 * scale), z: 0 };

  if (pose === 'together') {
    const cx = palmX;
    const cy = palmY - 0.28 * scale;
    const offsets = [
      [-0.018, 0.012],
      [-0.010, -0.010],
      [0.000, -0.014],
      [0.010, -0.008],
      [0.018, 0.006]
    ];
    const tipIndices = [4, 8, 12, 16, 20];
    for (let f = 0; f < 5; f++) {
      landmarks[tipIndices[f]] = {
        x: clamp(cx + offsets[f][0] * scale),
        y: clamp(cy + offsets[f][1] * scale),
        z: 0
      };
    }
  } else if (pose === 'fist') {
    const cx = palmX;
    const cy = palmY - 0.14 * scale;
    const offsets = [
      [-0.035, 0.010],
      [-0.030, -0.012],
      [0.000, -0.015],
      [0.028, -0.010],
      [0.050, 0.005]
    ];
    const tipIndices = [4, 8, 12, 16, 20];
    for (let f = 0; f < 5; f++) {
      landmarks[tipIndices[f]] = {
        x: clamp(cx + offsets[f][0] * scale),
        y: clamp(cy + offsets[f][1] * scale),
        z: 0
      };
    }
  } else {
    // Open hand with realistic splayed fingertips
    const tipCoords = [
      [palmX - 0.17 * scale, palmY - 0.21 * scale], // Thumb (4)
      [palmX - 0.10 * scale, palmY - 0.36 * scale], // Index (8)
      [palmX - 0.01 * scale, palmY - 0.39 * scale], // Middle (12)
      [palmX + 0.08 * scale, palmY - 0.36 * scale], // Ring (16)
      [palmX + 0.16 * scale, palmY - 0.30 * scale]  // Pinky (20)
    ];
    const tipIndices = [4, 8, 12, 16, 20];
    for (let f = 0; f < 5; f++) {
      landmarks[tipIndices[f]] = {
        x: clamp(tipCoords[f][0]),
        y: clamp(tipCoords[f][1]),
        z: 0
      };
    }
  }

  return landmarks;
}

function createDemoTestEnv(demoDir = path.resolve(__dirname, '..'), htmlFilename = 'index.html', options = {}) {
  const indexHtmlPath = path.join(demoDir, htmlFilename);
  const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

  const doc = new MockDocument();
  populateDOMFromHTML(doc, htmlContent);

  const windowListeners = {};
  const rafCallbacks = [];
  let nowTimeMs = 1000;

  let mockDetectionResult = {
    landmarks: [],
    handednesses: []
  };

  let createdLandmarkerOptions = null;
  let setOptionsCalls = [];
  const createdYouTubePlayers = [];

  const MockYT = {
    PlayerState: {
      UNSTARTED: -1,
      ENDED: 0,
      PLAYING: 1,
      PAUSED: 2,
      BUFFERING: 3,
      CUED: 5
    },
    Player: class MockYouTubePlayer {
      constructor(elementId, config) {
        this.elementId = elementId;
        this.config = config;
        this.videoId = config.videoId;
        this.width = config.width;
        this.height = config.height;
        this.currentTime = 0;
        this.playerState = MockYT.PlayerState.CUED;
        this.calls = [];
        createdYouTubePlayers.push(this);

        if (config.events && typeof config.events.onReady === 'function' && options.deferYouTubeReady !== true) {
          config.events.onReady({ target: this });
        }
      }

      playVideo() {
        this.calls.push({ method: 'playVideo' });
        this.playerState = MockYT.PlayerState.PLAYING;
        if (this.config.events && typeof this.config.events.onStateChange === 'function') {
          this.config.events.onStateChange({ data: MockYT.PlayerState.PLAYING, target: this });
        }
      }

      pauseVideo() {
        this.calls.push({ method: 'pauseVideo' });
        this.playerState = MockYT.PlayerState.PAUSED;
        if (this.config.events && typeof this.config.events.onStateChange === 'function') {
          this.config.events.onStateChange({ data: MockYT.PlayerState.PAUSED, target: this });
        }
      }

      cueVideoById(videoId, startSeconds = 0) {
        this.videoId = typeof videoId === 'object' ? videoId.videoId : videoId;
        this.currentTime = typeof videoId === 'object' ? (videoId.startSeconds || 0) : startSeconds;
        this.playerState = MockYT.PlayerState.CUED;
        this.calls.push({ method: 'cueVideoById', videoId: this.videoId, startSeconds: this.currentTime });
      }

      seekTo(seconds, allowSeekAhead) {
        this.currentTime = seconds;
        this.calls.push({ method: 'seekTo', seconds, allowSeekAhead });
      }

      setSize(width, height) {
        this.width = width;
        this.height = height;
        this.calls.push({ method: 'setSize', width, height });
      }

      triggerReady() {
        if (this.config.events && typeof this.config.events.onReady === 'function') {
          this.config.events.onReady({ target: this });
        }
      }
    }
  };

  const mockHandLandmarkerInstance = {
    detectForVideo: () => mockDetectionResult,
    setOptions: (opts) => {
      setOptionsCalls.push(opts);
      return Promise.resolve();
    }
  };

  const MockFilesetResolver = {
    forVisionTasks: (wasmUrl) => Promise.resolve({ wasmUrl })
  };

  const MockHandLandmarker = {
    createFromOptions: (vision, options) => {
      createdLandmarkerOptions = { vision, options };
      return Promise.resolve(mockHandLandmarkerInstance);
    }
  };

  const sandbox = {
    console,
    Math,
    Date: {
      now: () => nowTimeMs
    },
    JSON,
    Array,
    Object,
    Set,
    Map,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    Promise,
    Float32Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Int32Array,
    parseFloat,
    parseInt,
    isNaN,
    isFinite,
    setTimeout: (fn, delay) => {
      sandbox._scheduledTimeouts.push({ fn, delay });
      return sandbox._scheduledTimeouts.length;
    },
    clearTimeout: () => {},
    performance: {
      now: () => nowTimeMs
    },
    requestAnimationFrame: (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    },
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    FilesetResolver: MockFilesetResolver,
    HandLandmarker: MockHandLandmarker,
    YT: options.withMockYT === false ? undefined : MockYT,
    location: { origin: 'http://localhost:8080' },
    navigator: {
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ id: 'mock-webcam-stream' })
      }
    },
    document: doc,
    devicePixelRatio: 1,
    addEventListener: (type, fn) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    dispatchWindowEvent: (evt) => {
      const handlers = windowListeners[evt.type] || [];
      handlers.forEach(fn => fn({
        preventDefault: () => {},
        stopPropagation: () => {},
        target: doc.body,
        ...evt
      }));
    },
    _scheduledTimeouts: [],
    _rafCallbacks: rafCallbacks,
    _MockAudioContext: MockAudioContext,
    _getCreatedLandmarkerOptions: () => createdLandmarkerOptions,
    _getSetOptionsCalls: () => setOptionsCalls,
    _setMockDetectionResult: (res) => { mockDetectionResult = res; }
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  const scriptRegex = /<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
  const loadedScripts = [];
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(htmlContent)) !== null) {
    const relPath = scriptMatch[1].split('?')[0];
    const fullPath = path.join(demoDir, relPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: fullPath });
    loadedScripts.push(relPath);
  }

  const evaluate = (expr) => vm.runInContext(expr, context);

  return {
    sandbox,
    context,
    doc,
    htmlContent,
    loadedScripts,
    evaluate,
    advanceTime: (deltaMs) => {
      nowTimeMs += deltaMs;
    },
    setDetectionResult: (res) => {
      mockDetectionResult = res;
    },
    getCreatedLandmarkerOptions: () => createdLandmarkerOptions,
    getSetOptionsCalls: () => setOptionsCalls,
    getYouTubePlayers: () => createdYouTubePlayers,
    flushTimeouts: () => {
      const pending = [...sandbox._scheduledTimeouts];
      sandbox._scheduledTimeouts.length = 0;
      pending.forEach(t => t.fn());
    },
    stepAnimationFrame: (timestampMs) => {
      if (typeof timestampMs === 'number') {
        nowTimeMs = timestampMs;
      }
      const currentCbs = [...rafCallbacks];
      rafCallbacks.length = 0;
      currentCbs.forEach(cb => cb(nowTimeMs));
    }
  };
}

module.exports = {
  createDemoTestEnv,
  buildHandLandmarks,
  buildLeftGestureHand,
  MockAudioContext,
  MockAudioNode,
  MockAudioParam,
  MockPeriodicWave,
  MockAudioBuffer
};
