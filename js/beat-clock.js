// BeatClock turns a time in seconds into a beat number.
//
// At 124 BPM one beat lasts 60 / 124 ≈ 0.484 s. Beat n starts at
// offset + n * period. `offset` is the phase: it slides the beat grid so
// beat 0 lines up with the song's actual first kick drum. Tap tempo
// sets both the period (from the gap between taps) and the offset
// (from where the last tap landed).

export class BeatClock {
  constructor(bpm = 124) {
    this.bpm = bpm;
    this.offset = 0;      // seconds
    this.lastBeat = -1;   // last beat index we reported
    this.taps = [];       // wall-clock times of recent taps, in seconds
  }

  get period() {
    return 60 / this.bpm;
  }

  setBpm(bpm) {
    this.bpm = Math.min(200, Math.max(60, bpm));
  }

  beatAt(t) {
    return Math.floor((t - this.offset) / this.period);
  }

  // Call once per animation frame with the song time.
  // Returns the beat index when a new beat has just started, otherwise null.
  tick(t) {
    const beat = this.beatAt(t);
    if (beat < this.lastBeat) {
      // The song was rewound or restarted: resync quietly.
      this.lastBeat = beat;
      return null;
    }
    if (beat > this.lastBeat) {
      this.lastBeat = beat;
      return beat;
    }
    return null;
  }

  reset() {
    this.lastBeat = -1;
  }

  // wallTime: performance.now() in seconds, used to measure tempo.
  // songTime: the song's current time, used to set the phase (null if stopped).
  tap(wallTime, songTime = null) {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && wallTime - last > 2) this.taps = []; // a long pause starts a new tap run
    this.taps.push(wallTime);
    if (this.taps.length > 8) this.taps.shift();

    if (this.taps.length >= 2) {
      const span = this.taps[this.taps.length - 1] - this.taps[0];
      const avgInterval = span / (this.taps.length - 1);
      this.setBpm(Math.round(60 / avgInterval));
    }

    if (songTime !== null) {
      // Make this tap land exactly on a beat.
      this.offset = songTime % this.period;
      this.lastBeat = this.beatAt(songTime);
    }
    return this.bpm;
  }
}
