type Listener = () => void;
type TimeListener = (current: number, duration: number) => void;

interface MediaCallbacks {
  onNext: () => void;
  onPrevious: () => void;
}

class AudioPlayerManager {
  private audio: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private onPlayListeners: Listener[] = [];
  private onPauseListeners: Listener[] = [];
  private onEndedListeners: Listener[] = [];
  private onErrorListeners: Listener[] = [];
  private onTimeListeners: TimeListener[] = [];
  private pendingPlay = false;
  private mediaCallbacks: MediaCallbacks = { onNext: () => {}, onPrevious: () => {} };

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.addEventListener("play", () => {
      this.pendingPlay = false;
      this.onPlayListeners.forEach((fn) => fn());
    });
    this.audio.addEventListener("pause", () => this.onPauseListeners.forEach((fn) => fn()));
    this.audio.addEventListener("ended", () => this.onEndedListeners.forEach((fn) => fn()));
    this.audio.addEventListener("error", () => {
      const err = this.audio.error;
      console.warn("[audio] Error event:", err ? `${err.code} - ${err.message}` : "unknown");
      this.onErrorListeners.forEach((fn) => fn());
    });
    this.audio.addEventListener("canplay", () => {
      if (this.pendingPlay) {
        this.audio.play().catch((err) => {
          console.warn("[audio] canplay auto-play failed:", err);
          this.pendingPlay = false;
        });
      }
    });
    this.audio.addEventListener("stalled", () => {
      console.warn("[audio] Playback stalled");
    });
    this.audio.addEventListener("waiting", () => {
      console.warn("[audio] Waiting for data...");
    });
    this.audio.addEventListener("timeupdate", () => {
      this.onTimeListeners.forEach((fn) => fn(this.audio.currentTime * 1000, this.audio.duration * 1000 || 0));
    });

    this.registerMediaSessionHandlers();
  }

  private registerMediaSessionHandlers() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession!;
    ms.setActionHandler("play", () => this.play());
    ms.setActionHandler("pause", () => this.pause());
    ms.setActionHandler("previoustrack", () => this.mediaCallbacks.onPrevious());
    ms.setActionHandler("nexttrack", () => this.mediaCallbacks.onNext());
    ms.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        const el = this.audio as HTMLMediaElement & { fastSeek?: (time: number) => void };
        if (typeof el.fastSeek === "function") {
          el.fastSeek(details.seekTime);
        } else {
          this.audio.currentTime = details.seekTime;
        }
      }
    });
  }

  setMediaCallbacks(cb: MediaCallbacks) {
    this.mediaCallbacks = cb;
  }

  updateMetadata(title: string, artist: string, coverUrl: string) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: "Claudio",
      artwork: coverUrl ? [{ src: coverUrl }] : [],
    });
  }

  load(url: string) {
    this.audio.src = url;
    this.audio.load();
  }

  async play() {
    try {
      this.pendingPlay = true;
      // Only attempt immediate play if audio is already buffered;
      // otherwise let the canplay event handler trigger playback
      if (this.audio.readyState >= 3) {
        await this.audio.play();
      }
    } catch (err) {
      console.warn("[audio] Play failed (autoplay blocked?):", err);
      this.pendingPlay = false;
    }
  }

  /** Retry play - called from user gesture context */
  retryPlay() {
    if (this.pendingPlay || this.audio.paused) {
      this.audio.play().catch((err) => {
        console.error("[audio] Retry play failed:", err);
      });
    }
  }

  pause() {
    this.audio.pause();
  }

  seek(ms: number) {
    this.audio.currentTime = ms / 1000;
  }

  setVolume(v: number) {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  /** Initialize Web Audio API gain node for ducking */
  private ensureGainNode() {
    if (this.gainNode) return;
    try {
      this.audioCtx = new AudioContext();
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.gainNode = this.audioCtx.createGain();
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    } catch {
      this.audioCtx = null;
      this.sourceNode = null;
      this.gainNode = null;
    }

  }

  /** Duck music volume (for DJ voice) */
  duck(targetVolume = 0.2, durationMs = 300) {
    this.ensureGainNode();
    if (!this.gainNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(targetVolume, now + durationMs / 1000);
  }

  /** Restore music volume after ducking */
  unduck(durationMs = 600) {
    if (!this.gainNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(1.0, now + durationMs / 1000);
  }

  get isPlaying() {
    return !this.audio.paused;
  }

  get isPending() {
    return this.pendingPlay;
  }

  get audioElement() {
    return this.audio;
  }

  /** Expose the shared AudioContext for SpectrumBars etc. */
  getAudioContext(): AudioContext | null {
    this.ensureGainNode();
    return this.audioCtx;
  }

  /** Expose the shared source node so other components can create analysers from it */
  getSourceNode(): MediaElementAudioSourceNode | null {
    this.ensureGainNode();
    return this.sourceNode;
  }

  get currentTimeMs() {
    return this.audio.currentTime * 1000;
  }

  get durationMs() {
    return (this.audio.duration || 0) * 1000;
  }

  onPlay(fn: Listener) { this.onPlayListeners.push(fn); }
  onPause(fn: Listener) { this.onPauseListeners.push(fn); }
  onEnded(fn: Listener) { this.onEndedListeners.push(fn); }
  onError(fn: Listener) { this.onErrorListeners.push(fn); }
  onTimeUpdate(fn: TimeListener) { this.onTimeListeners.push(fn); }
}

export const audioPlayer = new AudioPlayerManager();
