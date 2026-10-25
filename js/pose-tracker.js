// PoseTracker wraps MediaPipe's Pose Landmarker.
//
// The model finds 33 body "landmarks" in each video frame. Each landmark
// has x and y from 0 to 1 (a fraction of the frame width and height), a
// depth estimate z, and a `visibility` score for how sure the model is
// that the point is actually in view. We only need 27 (left ankle) and
// 28 (right ankle), but we draw the whole skeleton so you can see the
// tracking working.

import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
// "lite" is the smallest and fastest model, which is plenty for ankles.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export const LEFT_ANKLE = 27;
export const RIGHT_ANKLE = 28;

export class PoseTracker {
  constructor(video, overlay) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext("2d");
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.ankles = null; // { left, right } from the latest frame, or null
  }

  // Downloads the WebAssembly runtime and the model. Tries the GPU first
  // and falls back to the CPU on machines where WebGL isn't available.
  async loadModel() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch (err) {
      console.warn("GPU delegate failed, using CPU", err);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
    this.drawing = new DrawingUtils(this.ctx);
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.overlay.width = this.video.videoWidth;
    this.overlay.height = this.video.videoHeight;
  }

  get running() {
    return this.landmarker !== null && this.video.readyState >= 2;
  }

  // Call once per animation frame. Runs the model only when the camera
  // has produced a new frame, draws the skeleton, and returns the ankles.
  update(nowMs) {
    if (!this.running) return null;
    if (this.video.currentTime === this.lastVideoTime) return this.ankles;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

    const landmarks = result.landmarks[0];
    if (!landmarks) {
      this.ankles = null;
      return null;
    }

    this.drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: "rgba(244, 241, 234, 0.85)",
      lineWidth: 2,
    });
    this.drawing.drawLandmarks(landmarks, { color: "#f4f1ea", radius: 2, lineWidth: 1 });

    // Ankles get big red markers: these are the points that draw the plan.
    const ankles = [landmarks[LEFT_ANKLE], landmarks[RIGHT_ANKLE]];
    this.drawing.drawLandmarks(ankles, { color: "#c8462f", fillColor: "#c8462f", radius: 7 });

    this.ankles = { left: ankles[0], right: ankles[1] };
    return this.ankles;
  }
}
