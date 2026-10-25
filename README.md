# House Music Builds a House

Dance to a house track in front of your webcam and your footsteps draw a floor plan in pencil.

Each beat records where you're standing, snaps it to a grid and connects it to the previous step with a wall. When your path returns to a spot you've already stood on, the loop becomes a room. Press **Space** on the drop and the room you're in becomes **double height**, drawn with diagonal hatching the way a plan marks a space that is open to the floor above.

![Demo](assets/demo.gif)

<!-- To add the demo: record the screen while you dance (ScreenToGif works well on Windows),
     save it as assets/demo.gif, then commit and push. -->

## How to use it

1. Open the page and click **Start camera**. Stand back until both ankles are in frame (the red dots).
2. Click **Load MP3…** and pick a track. Nothing is uploaded; the file plays locally in your browser.
3. Set the BPM (default 124), or press **Tap tempo** / **T** along with the kick drum. Your last tap also sets the beat phase, so taps keep the grid in time with the track.
4. Press **Play** and dance. One grid node is recorded per beat.
5. Press **Space** on the drop. Press it again in the same room to undo.
6. Click **Export PNG** to save the drawing.

| Key | Action |
| --- | --- |
| Space | Mark the drop (toggle double height) |
| T | Tap tempo |
| P | Play / pause |

With no MP3 loaded, **Play (no music)** runs a silent clock at the BPM shown, which is handy for testing.

## How it works

```
webcam ──► MediaPipe Pose Landmarker ──► ankles (landmarks 27, 28)
                                              │  average + smooth
                                              ▼
MP3 ──► audio.currentTime ──► BeatClock ──► on each beat: snap stance to grid ──► wall
                                                                     │
                                                    path loops back? ─┴─► room
Space ──► room under your feet ──► double height (hatched)
                                              │
                                              ▼
                                  rough.js draws everything on <canvas>
```

| File | What it does |
| --- | --- |
| `index.html` | Page layout: controls, webcam panel, plan panel. Loads rough.js and the Google Font. |
| `style.css` | Two-panel layout, trace-paper colors, mirrored video. |
| `js/main.js` | Connects everything: the animation loop, the audio clock, buttons and keys, and the conversion from ankles to a floor position. Tuning values are in `CONFIG` at the top. |
| `js/pose-tracker.js` | Loads the MediaPipe model, runs it on each camera frame, draws the skeleton, returns the ankles. |
| `js/beat-clock.js` | Converts song time into beat numbers. Handles tap tempo. |
| `js/floor-plan.js` | The plan itself: grid snapping, walls, room detection, the drop, and the rough.js drawing including the title block. |

### Mapping a webcam to a floor plan

The camera looks at you from the front, but a plan is a view from above. The mapping:

- **Left/right** in the (mirrored) camera image becomes **left/right** on the plan.
- **Height of your ankles in the image** becomes **depth** on the plan. Step toward the camera and your feet move down the frame, so you move down the sheet. The camera sits at the bottom edge of the plan.

If your moves only cover a small part of the plan, adjust `CONFIG.widthRange` and `CONFIG.depthRange` in `js/main.js`. Those are the parts of the camera frame that stretch to fill the grid.

### Design decisions

- **Orthogonal walls.** A diagonal step turns into an L-shaped pair of walls, as in most real plans. Set `this.orthogonal = false` in `floor-plan.js` to allow walls at any angle.
- **Rooms come from closed loops.** When a new step lands on a node you already visited, the steps in between form a polygon. Loops smaller than one grid square are ignored.
- **The drop needs a room.** If you hit Space while you're not inside a closed room, the bounding box of your last 16 steps (4 bars) gets walled in and becomes the double-height room.
- **Stable pencil lines.** rough.js draws randomly by default. Each wall gets a fixed `seed`, so the sketch doesn't wobble every time the plan redraws.
- **Grid units, not pixels.** The plan data is stored in grid coordinates, and pixels are only used when drawing, so other export formats (SVG, JSON) would be easy to add.

## Run it locally

Browsers block the camera and JavaScript modules on `file://` pages, so serve the folder from a local web server. `localhost` counts as secure, so the camera is allowed there.

```bash
cd house-music-builds-a-house
python -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge. Other options: `npx serve`, or the **Live Server** extension in VS Code.

## Publish on GitHub Pages

1. Create an empty repository on GitHub, e.g. `house-music-builds-a-house`. Don't add a README; this project already has one.
2. Push this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/house-music-builds-a-house.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose **main** and **/ (root)**, then click **Save**.
4. After a minute or so the site is at `https://<your-username>.github.io/house-music-builds-a-house/`.

GitHub Pages serves over HTTPS, so the camera works there too. There's no build step, so every push to `main` updates the live site.

## Built with

- [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) for body tracking
- [rough.js](https://roughjs.com/) for the hand-drawn lines
- [Architects Daughter](https://fonts.google.com/specimen/Architects+Daughter) for the lettering

## Ideas for v2

- Beat detection from the audio itself, instead of a fixed BPM
- SVG export for Illustrator or Rhino
- Doors when you pause on a wall, windows on the off-beats
- A second floor: the drop in one track becomes the stair to the next
