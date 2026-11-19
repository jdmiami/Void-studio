import '@fontsource-variable/space-grotesk';
import '@phosphor-icons/web/regular';
import './styles.css';
import { Compositor, clamp, families, palettes, project } from './effects.js';
import { VisionTracker } from './tracking.js';
import { canvasStream, downloadBlob, frameAt, getTakes, makeRecorder, removeTake, saveTake } from './capture.js';

const studio = document.querySelector('#studio');
const icon = name => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const tabOrder = Object.keys(families);
const defaults = {
  family: 'portal', intensity: 72, element: 'fire', look: 'clear', zoom: 1, exposure: 0,
  density: 115, tracking: 18, resolution: 720, fps: 30, depth: true, gestures: true,
  skeleton: false, grid: false, timer: 0, mode: 'editable', duration: 15, mic: false,
};
let stored;
try { stored = JSON.parse(localStorage.getItem('void-settings')); } catch { stored = null; }
const settings = { ...defaults, ...stored };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const labelFor = key => key.charAt(0).toUpperCase() + key.slice(1);

studio.innerHTML = `
  <header class="topbar">
    <div class="brand"><img src="/art/wordmark.webp" alt="VOID Studio"></div>
    <button id="status" class="status" data-panel="camera" aria-label="Camera status and settings">
      <span class="status-dot" aria-hidden="true"></span><span id="status-label">Demo</span>
    </button>
  </header>
  <div class="stage" id="stage">
    <canvas id="preview" aria-label="Elemental camera preview"></canvas>
    <div class="grid-guide" id="grid" hidden></div>
    <div class="stage-shade"></div>
  </div>
  <video class="source-video" id="camera-source" muted playsinline disablepictureinpicture aria-hidden="true" tabindex="-1"></video>
  <img class="aperture" src="/art/aperture.webp" alt="" draggable="false">
  <div class="intensity-rail">
    <button class="rail-end" data-step="8" aria-label="Increase effect strength">${icon('arrows-out-simple')}</button>
    <input type="range" min="0" max="100" id="intensity" aria-label="Effect strength">
    <button class="rail-end" data-step="-8" aria-label="Decrease effect strength">${icon('arrows-in-simple')}</button>
  </div>
  <div id="aim" class="aim" aria-hidden="true" hidden></div>
  <div id="aim-label" class="aim-label" aria-hidden="true" hidden></div>
  <div id="countdown-view" class="countdown-view" aria-hidden="true" hidden></div>
  <div class="control-stack">
    <div class="families" id="families" role="group" aria-label="Effect family">
      ${tabOrder.map(key => `<button data-family="${key}" aria-pressed="false">${families[key].label}</button>`).join('')}
    </div>
    <button class="capture-mode" data-panel="capture" id="mode-button"></button>
  </div>
  <div class="dock" role="group" aria-label="Camera dock">
    <button class="camera-button" id="camera-button" aria-label="Enable camera" data-hold="true"></button>
    <button class="record-button" id="record-button" aria-label="Start recording" data-hold="true"><span class="record-glyph" aria-hidden="true"></span></button>
    <button class="settings-button" data-panel="effects" aria-label="Studio controls"></button>
  </div>
  <button class="scrim" id="scrim" aria-label="Close controls" tabindex="-1" hidden></button>
  <section class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden></section>
  <div class="notice" id="notice" role="status" hidden></div>
`;

const $ = selector => studio.querySelector(selector);
const stage = $('#stage');
const video = $('#camera-source');
const preview = $('#preview');
const sheet = $('#sheet');
const recordButton = $('#record-button');
const compositor = new Compositor(preview);
const tracker = new VisionTracker(compositor);

let stream;
let microphone;
let devices = [];
let facing = 'user';
let cameraState = 'demo';
let modelState = 'off';
let panel = '';
let focusedBeforePanel;
let takes = [];
let currentTake;
let editor;
let rememberedCamera;
let takeSession;
let countdownUntil = 0;
let preparing = false;
let noticeTimeout;
let lastFrame = 0;
let previousTarget;
let pointerPoint;
let aimOverrideUntil = 0;
let installPrompt;
let measuredFps = 0;
let framesWindow = 0;
let fpsStart = performance.now();
let uiStatus;

function notify(message) {
  const notice = $('#notice');
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimeout = setTimeout(() => { notice.hidden = true; }, 3600);
}

function updateStatus(now = performance.now()) {
  const label = takeSession ? `REC ${formatTime((now - takeSession.started) / 1000)}`
    : countdownUntil ? 'Countdown'
    : preparing ? 'Preparing'
    : cameraState === 'opening' ? 'Opening'
    : cameraState !== 'live' ? 'Demo'
    : modelState === 'loading' ? 'Loading AI'
    : modelState === 'error' ? 'Camera live'
    : !settings.gestures ? 'Camera live'
    : tracker.hands.length ? 'Tracking' : 'Ready';
  const state = takeSession ? 'recording'
    : (cameraState === 'opening' || modelState === 'loading' || countdownUntil || preparing) ? 'pending' : 'ready';
  if (uiStatus !== label) {
    $('#status-label').textContent = label;
    uiStatus = label;
  }
  studio.dataset.state = state;
}

function resizePreview() {
  if (!takeSession) compositor.resize(stage, settings.resolution);
}
new ResizeObserver(resizePreview).observe(stage);

function syncSettings() {
  const effect = families[settings.family];
  studio.style.setProperty('--accent', effect.accent);
  $('#families').style.setProperty('--index', tabOrder.indexOf(settings.family));
  studio.querySelectorAll('[data-family]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.family === settings.family)));
  $('#intensity').value = settings.intensity;
  $('#intensity').setAttribute('aria-label', effect.size);
  $('#intensity').style.setProperty('--percent', `${settings.intensity}%`);
  $('#mode-button').innerHTML = settings.mode === 'editable'
    ? `Editable take · ${settings.duration}s ${icon('pencil-simple')}`
    : `Finished video ${icon('caret-down')}`;
  $('#grid').hidden = !settings.grid;
  resizePreview();
}

function updateSetting(key, value) {
  settings[key] = value;
  const { demoPortal, ...saved } = settings;
  try { localStorage.setItem('void-settings', JSON.stringify(saved)); } catch { /* Session settings remain usable. */ }
  if (key === 'family') {
    settings.demoPortal = null;
    aimOverrideUntil = performance.now() + 3000;
  }
  syncSettings();
  if (key === 'resolution') resizePreview();
  if (key === 'gestures' && !value) {
    previousTarget?.classList.remove('gesture-target');
    previousTarget = null;
    tracker.pinch = null;
    tracker.hoverTarget = null;
  }
}

function showAim(position, label, progress = 0) {
  const aim = $('#aim');
  const caption = $('#aim-label');
  aim.hidden = caption.hidden = !position;
  if (!position) return;
  const x = clamp(position.x, 17, studio.clientWidth - 17);
  const y = clamp(position.y, 18, studio.clientHeight - 46);
  aim.style.left = `${x}px`;
  aim.style.top = `${y}px`;
  aim.style.setProperty('--progress', `${progress}turn`);
  caption.textContent = label;
  const labelX = clamp(x, caption.offsetWidth / 2 + 5, studio.clientWidth - caption.offsetWidth / 2 - 5);
  caption.style.left = `${labelX}px`;
  caption.style.top = `${y + 28}px`;
}

const stagePoint = point => point && ({ x: stage.offsetLeft + stage.clientWidth * point.x, y: stage.offsetTop + stage.clientHeight * point.y });

function updateFeedback(now, demo) {
  const effect = families[settings.family];
  let command;
  if (!demo && settings.gestures && modelState === 'ready' && panel !== 'editor') command = tracker.command(studio, now);
  if (command?.active !== previousTarget) {
    previousTarget?.classList.remove('gesture-target');
    previousTarget = command?.active;
    previousTarget?.classList.add('gesture-target');
  }
  if (command) {
    const description = command.active && (command.active.getAttribute('aria-label') || command.active.textContent.trim());
    const action = command.active?.dataset.hold === 'true' && command.progress > 0 && command.progress < 1 ? 'Hold to confirm' : description || 'Point to a control';
    const hand = stagePoint(command.hand);
    if (hand) showAim(hand, action, command.progress);
    return;
  }
  if (panel) { showAim(null); return; }
  if (demo) {
    const hand = settings.demoPortal && pointerPoint ? pointerPoint : project({ x: .79, y: .235 }, compositor.fit, preview.width, preview.height);
    showAim(stagePoint(hand), `${effect.label} · ${settings.intensity}%`);
    return;
  }
  const hand = tracker.hands[0]?.palm;
  const cast = tracker.portal && now - tracker.portal.born < 1350;
  const label = (cast && settings.family === 'portal') ? 'Portal opened'
    : now < aimOverrideUntil ? `${effect.label} · ${settings.intensity}%` : effect.label;
  showAim(stagePoint(hand), label, cast && settings.family === 'portal' ? 1 : 0);
}

async function loadVision() {
  if (modelState === 'ready' || modelState === 'loading') return;
  modelState = 'loading';
  try {
    await tracker.load();
    modelState = 'ready';
    if (tracker.poseError) notify('Hand tracking is ready. Body tracking is unavailable.');
  } catch (error) {
    modelState = 'error';
    console.warn('Vision models could not start', error);
    notify('Tracking could not start. Try again in Gestures.');
  }
}

async function startCamera(nextFacing = facing, deviceId) {
  if (takeSession || countdownUntil || preparing || cameraState === 'opening') return;
  if (!navigator.mediaDevices?.getUserMedia) {
    notify('Camera access requires HTTPS or localhost.');
    return;
  }
  const oldFacing = facing;
  const oldDevice = stream?.getVideoTracks()[0]?.getSettings().deviceId;
  cameraState = 'opening';
  stopMedia(stream);
  stream = null;
  video.srcObject = null;
  tracker.reset();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: nextFacing } }),
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
      },
      audio: false,
    });
    await attachCamera(stream, nextFacing);
    rememberedCamera = stream.getVideoTracks()[0].getSettings().deviceId;
    devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(device => device.kind === 'videoinput');
    if (oldDevice && oldDevice === rememberedCamera && oldFacing !== nextFacing && devices.length < 2) notify('Only one camera is available.');
    if (panel === 'camera') renderPanel(false);
    loadVision();
  } catch (error) {
    if (!stream && oldDevice) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: oldDevice } } });
        await attachCamera(stream, oldFacing);
      } catch {
        stopCamera();
      }
    } else stopCamera();
    const message = error.name === 'NotAllowedError' ? 'Camera permission was denied. Enable it in your browser settings.'
      : error.name === 'NotFoundError' ? 'No camera was found on this device.'
      : 'The camera could not open. Try again or use Demo.';
    notify(message);
  }
}

async function attachCamera(nextStream, nextFacing) {
  video.srcObject = nextStream;
  await video.play();
  const track = nextStream.getVideoTracks()[0];
  facing = track.getSettings().facingMode || nextFacing;
  track.addEventListener('ended', () => {
    if (stream !== nextStream) return;
    if (takeSession) finishRecording();
    stopCamera();
    notify('Camera disconnected.');
  });
  cameraState = 'live';
  $('#camera-button').setAttribute('aria-label', 'Switch camera');
  updateStatus();
}

function stopMedia(media) { media?.getTracks().forEach(track => track.stop()); }

function stopCamera() {
  stopMedia(stream);
  stream = null;
  video.srcObject = null;
  cameraState = 'demo';
  tracker.reset();
  $('#camera-button').setAttribute('aria-label', 'Enable camera');
  updateStatus();
}

function flipCamera() {
  if (cameraState !== 'live') { startCamera(); return; }
  const nextFacing = facing === 'user' ? 'environment' : 'user';
  const other = devices.length === 2 && devices.find(device => device.deviceId !== rememberedCamera);
  startCamera(nextFacing, other ? other.deviceId : undefined);
}

function setRecordUi(state, number = '') {
  recordButton.className = `record-button ${state}`.trim();
  recordButton.setAttribute('aria-label', state === 'recording' ? 'Stop recording' : state === 'counting' ? 'Cancel countdown' : 'Start recording');
  recordButton.firstElementChild.textContent = state === 'counting' || state === 'busy' ? number : '';
  const countdown = $('#countdown-view');
  countdown.hidden = state !== 'counting';
  if (state === 'counting') countdown.textContent = number;
  $('#camera-button').disabled = Boolean(state);
  $('#camera-button').setAttribute('aria-label', cameraState === 'live' ? 'Switch camera' : 'Enable camera');
  $('#mode-button').disabled = Boolean(state);
}

function handleRecord() {
  if (preparing || cameraState === 'opening') return;
  if (takeSession) { finishRecording(); return; }
  if (countdownUntil) {
    countdownUntil = 0;
    setRecordUi('');
    return;
  }
  if (settings.timer > 0) {
    countdownUntil = performance.now() + settings.timer * 1000;
    setRecordUi('counting', settings.timer);
  } else beginRecording();
}

function getDemoSnapshot() {
  if (!compositor.fit) return { hands: [], trails: [] };
  const point = coords => project(coords, compositor.fit, preview.width, preview.height);
  return {
    hands: [point({ x: .79, y: .235 }), point({ x: .35, y: .62 })],
    body: { ...point({ x: .48, y: .54 }), scale: .48 },
    portal: settings.demoPortal || { x: .51, y: .31, radius: .38 },
    trails: [],
  };
}

function timelineFrame(session, now) {
  const snapshot = session.demo ? getDemoSnapshot() : tracker.snapshot();
  const { family, intensity, element, zoom, exposure, look, density, skeleton } = settings;
  session.events.push({
    at: Math.max(0, Math.round(now - session.started)),
    settings: { family, intensity, element, zoom, exposure, look, density, skeleton },
    tracking: snapshot,
  });
}

async function beginRecording() {
  countdownUntil = 0;
  if (takeSession || preparing) return;
  preparing = true;
  setRecordUi('busy', '…');
  const demo = cameraState !== 'live';
  const mode = settings.mode;
  let sourceStream;
  try {
    if (settings.mic && !demo) {
      try { microphone = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { notify('Microphone unavailable. Recording without sound.'); }
    }
    const audio = microphone?.getAudioTracks() || [];
    const width = preview.width;
    const height = preview.height;
    const mirror = !demo && facing === 'user';
    let cleanDemo;
    if (mode === 'editable' && !demo) sourceStream = new MediaStream([...stream.getVideoTracks(), ...audio]);
    else if (mode === 'editable') {
      const cleanCanvas = document.createElement('canvas');
      cleanCanvas.width = width;
      cleanCanvas.height = height;
      const cleanContext = cleanCanvas.getContext('2d');
      const picture = compositor.demo;
      if (!picture.complete) await picture.decode();
      const scale = Math.max(width / picture.naturalWidth, height / picture.naturalHeight);
      const sourceWidth = picture.naturalWidth * scale;
      const sourceHeight = picture.naturalHeight * scale;
      const drawDemo = () => cleanContext.drawImage(picture, (width - sourceWidth) / 2, (height - sourceHeight) / 2, sourceWidth, sourceHeight);
      drawDemo();
      sourceStream = canvasStream(cleanCanvas, settings.fps);
      cleanDemo = drawDemo;
    } else sourceStream = canvasStream(preview, settings.fps, audio);
    const { recorder, result } = makeRecorder(sourceStream, settings.resolution > 720 ? 8_000_000 : 4_000_000);
    const session = { recorder, result, sourceStream, cleanDemo, mode, demo, mirror, width, height, events: [],
      started: performance.now(), lastEvent: -Infinity, duration: settings.duration,
    };
    recorder.start();
    takeSession = session;
    if (mode === 'editable') timelineFrame(session, session.started);
    recorder.addEventListener('error', () => { if (takeSession === session) finishRecording(); });
    setRecordUi('recording');
    if (panel) closePanel();
  } catch (error) {
    sourceStream?.getVideoTracks().forEach(track => {
      if (!stream?.getVideoTracks().includes(track)) track.stop();
    });
    stopMedia(microphone);
    microphone = null;
    notify(error.message || 'Recording could not start.');
    setRecordUi('');
  } finally {
    preparing = false;
  }
}

async function finishRecording() {
  const session = takeSession;
  if (!session) return;
  takeSession = null;
  preparing = true;
  setRecordUi('busy', '…');
  const duration = (performance.now() - session.started) / 1000;
  try {
    if (session.recorder.state !== 'inactive') session.recorder.stop();
    const blob = await session.result;
    const id = globalThis.crypto.randomUUID?.() || String(Date.now());
    const take = {
      id, created: Date.now(), duration, mode: session.mode, demo: session.demo,
      mirror: session.mirror, width: session.width, height: session.height,
      events: session.events, blob,
    };
    try { await saveTake(take); } catch { notify('Storage is unavailable. Download this take to keep it.'); }
    takes.unshift(take);
    openTake(take);
  } catch (error) {
    notify(error.message || 'The take could not be saved.');
  } finally {
    session.sourceStream.getVideoTracks().forEach(track => {
      if (!stream?.getVideoTracks().includes(track)) track.stop();
    });
    stopMedia(microphone);
    microphone = null;
    preparing = false;
    setRecordUi('');
    resizePreview();
  }
}

const range = (key, title, min, max, value, unit = '', step = 1) => `<label class="setting">
  <span>${title}<output data-output="${key}">${value}${unit}</output></span>
  <input type="range" data-setting="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${value}">
</label>`;
const toggle = (key, title) => `<button class="pill toggle" data-toggle="${key}" aria-pressed="${settings[key]}">
  <span>${title}</span><span aria-hidden="true">${settings[key] ? 'On' : 'Off'}</span>
</button>`;
const options = (key, values, selection, title) => `<div class="options" role="group" aria-label="${title}">
  ${values.map(([value, text]) => `<button class="pill" data-option="${key}" data-value="${value}" aria-pressed="${String(value === selection)}">${text}</button>`).join('')}
</div>`;
const action = (name, label, glyph, extra = '') => `<button class="action ${extra}" data-action="${name}">
  ${glyph ? icon(glyph) : ''}${label}
</button>`;

const panelTitles = { effects: 'Effects', camera: 'Camera', gestures: 'Gestures', quality: 'Performance', capture: 'Capture', takes: 'Takes', editor: 'Take' };
const panelLinks = ['effects', 'camera', 'gestures', 'quality', 'takes'];
const panelTabLabels = { ...panelTitles, quality: 'Quality' };

function escapeText(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function panelContent() {
  const videoTrack = stream?.getVideoTracks()[0];
  const capabilities = videoTrack?.getCapabilities?.() || {};
  const cameraSettings = videoTrack?.getSettings?.() || {};
  switch (panel) {
    case 'effects':
      return `<p>${families[settings.family].instruction}</p>
        ${options('family', tabOrder.map(key => [key, families[key].label]), settings.family, 'Effect family')}
        ${range('intensity', families[settings.family].size, 0, 100, settings.intensity, '%')}
        ${['elements', 'energy'].includes(settings.family) ? options('element', Object.keys(palettes).map(key => [key, labelFor(key)]), settings.element, 'Element') : ''}
        ${settings.family === 'aura' ? toggle('skeleton', 'Pose overlay') : ''}
        ${settings.family === 'portal' && cameraState !== 'live' ? '<p>Tap or drag across the demo to move the portal.</p>' : ''}`;
    case 'camera': {
      const deviceOptions = devices.map((device, i) => `<option value="${escapeText(device.deviceId)}" ${device.deviceId === cameraSettings.deviceId ? 'selected' : ''}>${escapeText(device.label || `Camera ${i + 1}`)}</option>`).join('');
      return `<div class="action-row">
        ${cameraState === 'live' ? action('flip', 'Switch camera', 'camera-rotate', 'primary') + action('demo', 'Return to demo', 'image')
          : action('enable', 'Enable camera', 'video-camera', 'primary')}
        </div>
        ${devices.length > 1 && cameraState === 'live' ? `<label class="setting"><span>Camera source</span><select data-device>${deviceOptions}</select></label>` : ''}
        ${cameraState !== 'live' ? '<p>Try the effects in Demo or enable your camera for live tracking.</p>' : ''}
        ${range('zoom', 'Digital zoom', 1, 3, settings.zoom, '×', .1)}
        ${range('exposure', 'Image brightness', -1, 1, settings.exposure, '', .1)}
        ${['zoom', 'exposureCompensation', 'focusDistance'].map(key => {
          const cap = capabilities[key];
          if (takeSession || !cap || !Number.isFinite(cap.min) || cap.max <= cap.min) return '';
          const label = { zoom: 'Camera zoom', exposureCompensation: 'Exposure compensation', focusDistance: 'Focus distance' }[key];
          return range(`hardware-${key}`, label, cap.min, cap.max, cameraSettings[key] ?? cap.min, '', cap.step || .01);
        }).join('')}
        ${options('look', [['clear', 'Natural'], ['arctic', 'Arctic'], ['ember', 'Ember'], ['mono', 'Mono']], settings.look, 'Camera look')}
        ${toggle('grid', 'Framing grid')}`;
    }
    case 'gestures':
      return `${toggle('gestures', 'Point-and-pinch controls')}
        <p>Point with one finger to highlight a control. Pinch your thumb and index finger to select. Keep the pinch held for recording and camera switching. Pinch and move to adjust sliders.</p>
        <p>${families[settings.family].instruction} Keep your hands visible and well lit for tracking.</p>
        ${modelState === 'error' ? action('retry-models', 'Retry tracking', 'arrow-clockwise') : ''}`;
    case 'quality':
      return `<p id="fps-label">${measuredFps ? `Preview · ${measuredFps} fps` : 'Measuring preview frame rate…'}</p>
        <div class="setting"><span>Render height</span></div>
        ${options('resolution', [[480, '480p'], [720, '720p'], [1080, '1080p']], settings.resolution, 'Render height')}
        <div class="setting"><span>Target frame rate</span></div>
        ${options('fps', [[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], settings.fps, 'Target frame rate')}
        ${range('density', 'Particles', 20, 190, settings.density)}
        ${range('tracking', 'Hand tracking rate', 8, 28, settings.tracking, ' Hz')}
        ${toggle('depth', 'Estimated depth layering')}
        <p>Uses a camera-based subject mask for live portal and aura layering. Lower particle density or render height if the preview stutters.</p>`;
    case 'capture':
      return `<p>Choose what the record button saves.</p>
        ${options('mode', [['finished', 'Finished video'], ['editable', 'Editable take']], settings.mode, 'Capture format')}
        <p>${settings.mode === 'editable' ? 'Save clean video with hand, body and effect timing for adjustments in Takes.' : 'Save a ready-to-share clip with the effects in the video.'}</p>
        ${settings.mode === 'editable' ? options('duration', [[10, '10s'], [15, '15s'], [30, '30s']], settings.duration, 'Maximum take duration') : ''}
        <div class="setting"><span>Countdown timer</span></div>
        ${options('timer', [[0, 'Off'], [3, '3s'], [5, '5s'], [10, '10s']], settings.timer, 'Countdown timer')}
        ${toggle('mic', 'Record microphone audio')}`;
    case 'takes':
      return `${takes.length ? takes.map(take => `<div class="take-row">
        <div><strong>${take.mode === 'editable' ? 'Editable take' : 'Finished video'}</strong>
          <small>${formatTime(take.duration)} · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(take.created)}</small>
        </div>
        <button class="action" data-open="${take.id}" aria-label="Open take">${icon('play')} Open</button>
      </div>`).join('') : '<p>Your recorded takes appear here.</p>'}
      <div class="action-row">${action('install', 'Install VOID Studio', 'download-simple')}</div>`;
    default:
      return '';
  }
}

function setStudioInert(inert) {
  studio.querySelectorAll('.topbar, .intensity-rail, .control-stack, .dock').forEach(region => { region.inert = inert; });
}

function renderPanel(focus = true) {
  sheet.classList.toggle('editor-sheet', panel === 'editor');
  if (panel === 'editor') return;
  sheet.innerHTML = `<div class="sheet-header">
    <h1 id="sheet-title">${panelTitles[panel]}</h1>
    <button class="icon-button" data-action="close" aria-label="Close controls">${icon('x')}</button>
  </div>
  ${panel !== 'capture' ? `<nav class="panel-tabs" aria-label="Studio settings">${panelLinks.map(name =>
    `<button class="pill" data-panel="${name}" aria-pressed="${String(panel === name)}">${panelTabLabels[name]}</button>`).join('')}</nav>` : ''}
  ${panelContent()}`;
  if (takeSession || preparing || countdownUntil) {
    sheet.querySelectorAll('[data-action="enable"], [data-action="flip"], [data-action="demo"], [data-device], [data-option="resolution"], [data-option="fps"], [data-option="mode"]').forEach(button => { button.disabled = true; });
  }
  if (focus) sheet.querySelector('[data-action="close"]')?.focus({ preventScroll: true });
}

function openPanel(next) {
  if (!panel) focusedBeforePanel = document.activeElement;
  if (panel === 'editor') disposeEditor();
  panel = next;
  sheet.hidden = false;
  $('#scrim').hidden = false;
  setStudioInert(true);
  renderPanel();
}

function closePanel() {
  if (panel === 'editor') disposeEditor();
  panel = '';
  sheet.hidden = true;
  $('#scrim').hidden = true;
  setStudioInert(false);
  focusedBeforePanel?.focus({ preventScroll: true });
  focusedBeforePanel = null;
}

function openTake(take) {
  if (!panel) focusedBeforePanel = recordButton;
  disposeEditor();
  panel = 'editor';
  currentTake = take;
  setStudioInert(true);
  sheet.hidden = false;
  $('#scrim').hidden = false;
  sheet.classList.add('editor-sheet');
  const editable = take.mode === 'editable';
  sheet.innerHTML = `<div class="sheet-header">
    <h1 id="sheet-title">${editable ? 'Editable take' : 'Finished video'}</h1>
    <button class="icon-button" data-panel="takes" aria-label="Back to takes">${icon('x')}</button>
  </div>
  <div class="editor-visual">
    <video id="take-video" playsinline preload="auto" ${editable ? 'class="editable-source" aria-hidden="true"' : 'controls aria-label="Recorded video"'}></video>
    ${editable ? '<canvas id="take-preview" aria-label="Editable video preview"></canvas>' : ''}
  </div>
  ${editable ? `<div class="action-row"><button class="action" id="play-take" data-action="play-take">${icon('play')} Play</button></div>
    ${range('playhead', 'Timeline', 0, Math.max(.1, take.duration), 0, 's', .01)}
    <label class="setting"><span>Effect</span><select id="edit-effect" aria-label="Effect" data-editor="family">
      <option value="">As recorded</option>${tabOrder.map(key => `<option value="${key}">${families[key].label}</option>`).join('')}
    </select></label>
    <label class="setting"><span>Element</span><select aria-label="Element" data-editor="element">
      <option value="">As recorded</option>${Object.keys(palettes).map(key => `<option value="${key}">${labelFor(key)}</option>`).join('')}
    </select></label>
    ${range('edit-strength', 'Effect strength multiplier', 0, 150, 100, '%')}` : ''}
  <div class="action-row">
    ${editable ? action('export', 'Export video', 'film-strip', 'primary') + action('download-clean', 'Download original', 'download-simple')
      : action('download', 'Download video', 'download-simple', 'primary')}
    ${action('delete', 'Delete', 'trash', 'danger')}
  </div>`;
  const source = $('#take-video');
  const url = URL.createObjectURL(take.blob);
  source.src = url;
  editor = { source, url, edit: {}, strength: 1 };
  if (editable) {
    const canvas = $('#take-preview');
    canvas.width = take.width;
    canvas.height = take.height;
    editor.compositor = new Compositor(canvas);
    source.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(source.duration)) {
        const slider = sheet.querySelector('[data-setting="playhead"]');
        if (slider) slider.max = source.duration;
      }
    });
    source.addEventListener('ended', () => {
      if (editor?.source !== source) return;
      if (editor.exportRecorder?.state === 'recording') editor.exportRecorder.stop();
      syncPlayButton();
    });
  }
  sheet.querySelector('[data-panel="takes"]').focus({ preventScroll: true });
}

function disposeEditor() {
  if (!editor) return;
  const { source, url, audioContext, exportRecorder } = editor;
  if (exportRecorder?.state === 'recording') exportRecorder.stop();
  source.pause();
  source.removeAttribute('src');
  source.load();
  URL.revokeObjectURL(url);
  audioContext?.close().catch(() => {});
  editor = null;
  currentTake = null;
}

function syncPlayButton() {
  const button = $('#play-take');
  if (!button || !editor) return;
  const paused = editor.source.paused;
  button.innerHTML = `${icon(paused ? 'play' : 'pause')} ${paused ? 'Play' : 'Pause'}`;
}

async function playEditor() {
  if (!editor || editor.exportRecorder) return;
  try {
    if (editor.source.paused) {
      await editor.audioContext?.resume();
      await editor.source.play();
    } else editor.source.pause();
    syncPlayButton();
  } catch { notify('This take could not be played.'); }
}

function renderEditor() {
  if (!editor?.compositor) return;
  const { source, compositor: renderer, edit, strength } = editor;
  const event = frameAt(currentTake.events, source.currentTime * 1000);
  if (!event) return;
  const snapshot = event.tracking;
  const shotSettings = { ...defaults, ...event.settings, ...edit, depth: false };
  shotSettings.intensity = clamp(event.settings.intensity * strength, 0, 100);
  const tracking = shotSettings.family === 'portal' && !snapshot.portal && snapshot.hands.length
    ? { ...snapshot, portal: { ...snapshot.hands[0], radius: .2 } } : snapshot;
  renderer.frame({ source, settings: shotSettings, tracking, time: source.currentTime, mirror: currentTake.mirror });
  const slider = sheet.querySelector('[data-setting="playhead"]');
  if (slider && document.activeElement !== slider) slider.value = source.currentTime;
  const output = sheet.querySelector('[data-output="playhead"]');
  if (output) output.value = `${source.currentTime.toFixed(1)}s`;
}

async function exportEditedTake(button) {
  if (!editor || editor.exportRecorder) return;
  const activeEditor = editor;
  const { source, compositor: renderer } = activeEditor;
  let output;
  button.disabled = true;
  button.textContent = 'Exporting…';
  let onEnded;
  let timeout;
  try {
    source.pause();
    source.currentTime = 0;
    const audioTracks = [];
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (AudioEngine && !currentTake.demo) {
      try {
        if (!activeEditor.audioContext) {
          activeEditor.audioContext = new AudioEngine();
          activeEditor.audioSource = activeEditor.audioContext.createMediaElementSource(source);
          activeEditor.audioSource.connect(activeEditor.audioContext.destination);
        }
        await activeEditor.audioContext.resume();
        const destination = activeEditor.audioContext.createMediaStreamDestination();
        activeEditor.audioSource.connect(destination);
        activeEditor.audioDestination = destination;
        audioTracks.push(...destination.stream.getAudioTracks());
      } catch { notify('Audio could not be included in this export.'); }
    }
    output = canvasStream(renderer.canvas, 30, audioTracks);
    const { recorder, result } = makeRecorder(output, 5_000_000);
    activeEditor.exportRecorder = recorder;
    onEnded = () => { if (recorder.state === 'recording') recorder.stop(); };
    source.addEventListener('ended', onEnded, { once: true });
    timeout = setTimeout(onEnded, (currentTake.duration + 3) * 1000);
    renderEditor();
    recorder.start();
    await source.play();
    syncPlayButton();
    const blob = await result;
    if (editor === activeEditor) {
      downloadBlob(blob, 'VOID-export');
      notify('Export ready.');
    }
  } catch (error) { notify(error.message || 'Export failed.'); }
  finally {
    if (onEnded) source.removeEventListener('ended', onEnded);
    clearTimeout(timeout);
    if (activeEditor.exportRecorder?.state === 'recording') activeEditor.exportRecorder.stop();
    output?.getTracks().forEach(track => track.stop());
    if (activeEditor.audioDestination) activeEditor.audioSource.disconnect(activeEditor.audioDestination);
    activeEditor.exportRecorder = null;
    if (editor === activeEditor) {
      button.disabled = false;
      button.innerHTML = `${icon('film-strip')} Export video`;
      syncPlayButton();
    }
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

const actions = {
  close: closePanel,
  enable: () => startCamera(),
  flip: flipCamera,
  demo: () => { if (!takeSession && !preparing) { stopCamera(); renderPanel(false); } },
  'retry-models': () => { loadVision(); closePanel(); },
  'play-take': playEditor,
  'download-clean': () => downloadBlob(currentTake.blob, 'VOID-original'),
  download: () => downloadBlob(currentTake.blob, 'VOID-take'),
  export: exportEditedTake,
  delete: async button => {
    if (!button.dataset.confirm) {
      button.dataset.confirm = 'true';
      button.textContent = 'Confirm delete';
      return;
    }
    const { id } = currentTake;
    try {
      await removeTake(id);
      takes = takes.filter(take => take.id !== id);
      openPanel('takes');
      notify('Take deleted.');
    } catch { notify('The take could not be deleted.'); }
  },
  install: async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      installPrompt = null;
      return;
    }
    notify(/iPhone|iPad/.test(navigator.userAgent)
      ? 'In Safari, use Share → Add to Home Screen.'
      : 'Open your browser menu and choose Install app or Add to Home screen.');
  },
};

studio.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  const data = target.dataset;
  if (target.id === 'record-button') return handleRecord();
  if (target.id === 'camera-button') return flipCamera();
  if (target.id === 'scrim') return closePanel();
  if (data.panel) return openPanel(data.panel);
  if (data.action) return actions[data.action]?.(target);
  if (data.open) {
    const take = takes.find(item => item.id === data.open);
    if (take) openTake(take);
  }
  if (data.family) updateSetting('family', data.family);
  if (data.step) updateSetting('intensity', clamp(settings.intensity + Number(data.step), 0, 100));
  if (data.toggle || data.option) {
    const key = data.toggle || data.option;
    const value = data.toggle ? !settings[key] : typeof settings[key] === 'number' ? Number(data.value) : data.value;
    updateSetting(key, value);
    renderPanel(false);
    const selector = data.toggle ? `[data-toggle="${key}"]` : `[data-option="${key}"][data-value="${data.value}"]`;
    sheet.querySelector(selector)?.focus({ preventScroll: true });
  }
});

studio.addEventListener('input', event => {
  const target = event.target;
  const key = target.dataset.setting;
  const value = Number(target.value);
  if (target.id === 'intensity') updateSetting('intensity', value);
  else if (key === 'playhead') {
    if (editor && !editor.exportRecorder) editor.source.currentTime = value;
  } else if (key === 'edit-strength') {
    if (editor) editor.strength = value / 100;
  } else if (key?.startsWith('hardware-')) {
    const name = key.slice(9);
    const track = stream?.getVideoTracks()[0];
    const capability = name === 'focusDistance' ? { focusMode: 'manual', [name]: value } : { [name]: value };
    track?.applyConstraints({ advanced: [capability] }).catch(() => notify('This camera did not accept the setting.'));
  } else if (key) updateSetting(key, value);
  const output = key && sheet.querySelector(`[data-output="${key}"]`);
  if (output) output.value = value + target.dataset.unit;
});

studio.addEventListener('change', event => {
  const target = event.target;
  if (target.matches('[data-device]')) startCamera(facing, target.value);
  if (target.dataset.editor && editor) {
    if (target.value) editor.edit[target.dataset.editor] = target.value;
    else delete editor.edit[target.dataset.editor];
  }
});

studio.addEventListener('keydown', event => {
  if (event.key === 'Escape' && panel) closePanel();
  if (event.key !== 'Tab' || !panel) return;
  const focusable = [...sheet.querySelectorAll('button:not(:disabled), input, select')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});

function moveDemoPortal(event) {
  if (cameraState === 'live' || panel || settings.family !== 'portal') return;
  const bounds = stage.getBoundingClientRect();
  pointerPoint = { x: clamp((event.clientX - bounds.x) / bounds.width), y: clamp((event.clientY - bounds.y) / bounds.height) };
  settings.demoPortal = { ...pointerPoint, radius: .38 };
}
stage.addEventListener('pointerdown', event => {
  if (cameraState === 'live' || panel || settings.family !== 'portal') return;
  stage.setPointerCapture(event.pointerId);
  moveDemoPortal(event);
});
stage.addEventListener('pointermove', event => {
  if (stage.hasPointerCapture(event.pointerId)) moveDemoPortal(event);
});

function tick(now) {
  requestAnimationFrame(tick);
  const targetFrameMs = 1000 / settings.fps;
  if (now - lastFrame < targetFrameMs - 1.2) return;
  lastFrame = now;
  framesWindow++;
  if (now - fpsStart >= 1200) {
    measuredFps = Math.round(framesWindow * 1000 / (now - fpsStart));
    const label = $('#fps-label');
    if (label) label.textContent = `Preview · ${measuredFps} fps`;
    fpsStart = now;
    framesWindow = 0;
  }

  if (panel === 'editor') renderEditor();
  const demo = cameraState !== 'live';
  const mirror = !demo && facing === 'user';
  if (!demo && modelState === 'ready') {
    try { tracker.update(video, now, settings, takeSession?.mode === 'editable'); }
    catch (error) {
      console.warn('Tracking was interrupted', error);
      modelState = 'error';
      tracker.reset();
      notify('Tracking stopped. You can retry in Gestures.');
    }
  }
  if (panel !== 'editor' || takeSession) {
    compositor.frame({
      source: video, settings, tracking: demo ? undefined : tracker.snapshot(), demo, mirror,
      time: reducedMotion.matches && demo && !takeSession ? 0 : (takeSession ? now - takeSession.started : now) / 1000,
      mask: !demo && tracker.maskAvailable,
    });
  }
  updateFeedback(now, demo);
  updateStatus(now);
  if (countdownUntil) {
    const remaining = Math.ceil((countdownUntil - now) / 1000);
    if (remaining <= 0) beginRecording();
    else if (recordButton.firstElementChild.textContent !== String(remaining)) setRecordUi('counting', remaining);
  }
  const session = takeSession;
  if (session?.mode === 'editable') {
    session.cleanDemo?.();
    if (now - session.lastEvent > 1000 / 20) {
      session.lastEvent = now;
      timelineFrame(session, now);
    }
    if (now - session.started >= session.duration * 1000) finishRecording();
  }
}

syncSettings();
setRecordUi('');
getTakes().then(saved => {
  const existing = new Set(takes.map(take => take.id));
  takes = [...takes, ...saved.filter(take => !existing.has(take.id))].sort((a, b) => b.created - a.created);
  if (panel === 'takes') renderPanel(false);
}).catch(() => {});
requestAnimationFrame(tick);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Offline installation is unavailable', error));
}
