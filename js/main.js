// main.js connects the parts:
//
//   webcam -> PoseTracker -> ankle positions -> (smoothed) stance
//   MP3    -> BeatClock   -> "a beat just happened"
//   on each beat: FloorPlan.addStep(stance)     -> walls and rooms
//   on Space:     FloorPlan.markDrop(stance)    -> double-height room
//
// Everything runs in one requestAnimationFrame loop (about 60 times a second).

import { BeatClock } from "./beat-clock.js";
import { PoseTracker } from "./pose-tracker.js";
import { FloorPlan } from "./floor-plan.js";

// Tune these if the plan feels cramped or your feet don't reach the edges.
const CONFIG = {
  // Which part of the camera frame maps onto the floor plan, as 0..1 fractions.
  // Width: left/right in the frame. Depth: ankle height in the frame. Your
  // ankles sit lower in the picture when you step toward the camera.
  widthRange: [0.15, 0.85],
  depthRange: [0.72, 0.98],
  minVisibility: 0.5, // ignore ankles the model isn't confident about
  smoothing: 0.35,    // 0..1 per frame; lower = steadier, higher = snappier
};

const $ = (id) => document.getElementById(id);
const els = {
  video: $("video"),
  poseOverlay: $("pose-overlay"),
  cameraPlaceholder: $("camera-placeholder"),
  status: $("status"),
  plan: $("plan"),
  cursor: $("plan-cursor"),
  stats: $("plan-stats"),
  cameraBtn: $("camera-btn"),
  mp3Input: $("mp3-input"),
  mp3Label: $("mp3-label"),
  playBtn: $("play-btn"),
  bpmInput: $("bpm-input"),
  tapBtn: $("tap-btn"),
  beatDots: [...$("beat-dots").children],
  clearBtn: $("clear-btn"),
  exportBtn: $("export-btn"),
};

const clock = new BeatClock(Number(els.bpmInput.value));
const tracker = new PoseTracker(els.video, els.poseOverlay);
const plan = new FloorPlan(els.plan);
els.cursor.width = els.plan.width;
els.cursor.height = els.plan.height;
const cursorCtx = els.cursor.getContext("2d");

let stance = null;      // smoothed {u, v} position on the floor, or null
let lastBeatAt = 0;     // performance.now() of the last beat, for the pulse
let flashText = null;   // {text, until} big message on the plan ("DROP!")

function setStatus(text) {
  els.status.textContent = text;
}

// ---------- Transport: what time is it in the song? ----------
// With an MP3 loaded, time comes from the audio element. Without one,
// a silent clock runs so you can test at the BPM in the box.

const audio = new Audio();
let hasTrack = false;
let silentStartedAt = null; // performance.now() when the silent clock started
let silentElapsed = 0;      // seconds accumulated before the last pause

function songTime() {
  if (hasTrack) return audio.currentTime;
  if (silentStartedAt !== null) return silentElapsed + (performance.now() - silentStartedAt) / 1000;
  return silentElapsed;
}

function isPlaying() {
  return hasTrack ? !audio.paused : silentStartedAt !== null;
}

function togglePlay() {
  if (hasTrack) {
    audio.paused ? audio.play() : audio.pause();
  } else if (silentStartedAt === null) {
    silentStartedAt = performance.now();
  } else {
    silentElapsed = songTime();
    silentStartedAt = null;
  }
  updatePlayButton();
}

function updatePlayButton() {
  const playing = isPlaying();
  els.playBtn.textContent = playing ? "Pause" : hasTrack ? "Play" : "Play (no music)";
  els.playBtn.classList.toggle("active", playing);
}

els.mp3Input.addEventListener("change", () => {
  const file = els.mp3Input.files[0];
  if (!file) return;
  audio.pause();
  if (audio.src) URL.revokeObjectURL(audio.src);
  audio.src = URL.createObjectURL(file); // plays the local file; nothing is uploaded
  hasTrack = true;
  silentStartedAt = null;
  silentElapsed = 0;
  clock.reset();
  els.mp3Label.textContent = file.name;
  updatePlayButton();
});
audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);
audio.addEventListener("ended", updatePlayButton);

// ---------- Tempo ----------

function setBpm(bpm) {
  clock.setBpm(bpm);
  plan.meta.bpm = clock.bpm;
  els.bpmInput.value = clock.bpm;
  plan.render();
}

els.bpmInput.addEventListener("change", () => setBpm(Number(els.bpmInput.value) || 124));

function tapTempo() {
  const bpm = clock.tap(performance.now() / 1000, isPlaying() ? songTime() : null);
  setBpm(bpm);
  els.tapBtn.classList.add("active");
  setTimeout(() => els.tapBtn.classList.remove("active"), 100);
}

// ---------- Pose -> floor position ----------

const mapRange = (x, lo, hi) => (x - lo) / (hi - lo);

// Average the visible ankles into one "where am I standing" point.
function readStance(ankles) {
  if (!ankles) return null;
  const feet = [ankles.left, ankles.right].filter(
    (p) => p && (p.visibility ?? 1) >= CONFIG.minVisibility
  );
  if (feet.length === 0) return null;
  const x = feet.reduce((s, p) => s + p.x, 0) / feet.length;
  const y = feet.reduce((s, p) => s + p.y, 0) / feet.length;
  return {
    u: mapRange(1 - x, ...CONFIG.widthRange), // 1 - x mirrors, like the video
    v: mapRange(y, ...CONFIG.depthRange),
  };
}

// Exponential smoothing: move part of the way toward the new reading each
// frame. This removes jitter so a still foot doesn't hop between grid nodes.
function smooth(prev, next) {
  if (!next) return null;
  if (!prev) return next;
  const k = CONFIG.smoothing;
  return { u: prev.u + (next.u - prev.u) * k, v: prev.v + (next.v - prev.v) * k };
}

// ---------- Beats and drops ----------

function onBeat(beat) {
  lastBeatAt = performance.now();
  els.beatDots.forEach((dot, i) => dot.classList.toggle("on", i === beat % 4));
  if (stance && plan.addStep(stance.u, stance.v)) redrawPlan();
}

function drop() {
  if (!stance) {
    setStatus("Can't see your feet, so there's no room to raise. Step into frame.");
    return;
  }
  const room = plan.markDrop(stance.u, stance.v);
  flashText = { text: room.double ? "DROP!" : "back to single height", until: performance.now() + 900 };
  redrawPlan();
}

function redrawPlan() {
  plan.render();
  const { walls, rooms, doubles } = plan.stats;
  els.stats.textContent = `${walls} walls · ${rooms} rooms · ${doubles} double-height`;
}

// ---------- Live cursor (separate canvas so it's not in the export) ----------

function drawCursor(now) {
  const ctx = cursorCtx;
  ctx.clearRect(0, 0, els.cursor.width, els.cursor.height);

  if (stance) {
    // Ring on the grid node a beat would record right now.
    const node = plan.snap(stance.u, stance.v);
    const n = plan.toPx(node.c, node.r);
    const pulse = Math.max(0, 1 - (now - lastBeatAt) / 300); // fades over 300 ms
    ctx.strokeStyle = "rgba(200, 70, 47, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 10 + pulse * 14, 0, Math.PI * 2);
    ctx.stroke();

    // Dot where your feet actually are.
    const p = plan.uvToPx(stance.u, stance.v);
    ctx.fillStyle = "#c8462f";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  if (flashText && now < flashText.until) {
    ctx.font = '72px "Architects Daughter", cursive';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(200, 70, 47, ${(flashText.until - now) / 900})`;
    ctx.fillText(flashText.text, els.cursor.width / 2, els.cursor.height / 2 - 60);
  }
}

// ---------- Main loop ----------

function frame(now) {
  const ankles = tracker.update(now);
  if (tracker.running) stance = smooth(stance, readStance(ankles));

  if (isPlaying()) {
    const beat = clock.tick(songTime());
    if (beat !== null) onBeat(beat);
  }

  drawCursor(now);
  requestAnimationFrame(frame);
}

// ---------- Buttons and keys ----------

const modelReady = tracker.loadModel()
  .then(() => setStatus("Pose model loaded. Press Start camera."))
  .catch((err) => {
    console.error(err);
    setStatus("Couldn't load the pose model. Check your connection and reload.");
    throw err;
  });

els.cameraBtn.addEventListener("click", async () => {
  try {
    setStatus("Asking for camera permission…");
    await tracker.startCamera();
    els.cameraPlaceholder.hidden = true;
    els.cameraBtn.disabled = true;
    els.cameraBtn.textContent = "Camera on";
    setStatus("Waiting for the pose model…");
    await modelReady;
    setStatus("Tracking. Make sure both ankles are in frame.");
  } catch (err) {
    console.error(err);
    setStatus(`Camera error: ${err.message}`);
  }
});

els.playBtn.addEventListener("click", togglePlay);
els.tapBtn.addEventListener("click", tapTempo);

els.clearBtn.addEventListener("click", () => {
  if (plan.path.length && !confirm("Erase the whole plan?")) return;
  plan.clear();
  redrawPlan();
});

els.exportBtn.addEventListener("click", () => {
  plan.render();
  els.plan.toBlob((blob) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `house-plan-${stamp}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
});

// Remove focus after clicking a button, so Space marks the drop instead of
// "clicking" the last button again.
document.addEventListener("click", (e) => {
  if (e.target.closest("button")) e.target.closest("button").blur();
});

window.addEventListener("keydown", (e) => {
  if (e.target === els.bpmInput) return; // let people type in the BPM box
  if (e.code === "Space") {
    e.preventDefault(); // stop the page from scrolling
    if (!e.repeat) drop();
  } else if (e.code === "KeyT" && !e.repeat) {
    tapTempo();
  } else if (e.code === "KeyP" && !e.repeat) {
    togglePlay();
  }
});

// Draw once now, then again when the handwriting font has arrived.
redrawPlan();
document.fonts.load('20px "Architects Daughter"').then(redrawPlan);
updatePlayButton();
setStatus("Loading pose model…");
requestAnimationFrame(frame);
