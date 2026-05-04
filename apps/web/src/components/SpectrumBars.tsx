import { useEffect, useRef, useCallback } from "react";
import { audioPlayer } from "../audio/AudioPlayer";

const BAR_COUNT = 64;
const SOURCE_BARS = 32;

interface Props {
  active: boolean;
}

/** Parse "rgb(R,G,B)" or "R, G, B" → [r, g, b] */
function parseRgb(str: string): [number, number, number] | null {
  const m = str.match(/(\d+)/g);
  if (!m || m.length < 3) return null;
  return [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])];
}

/** Read cover-extracted colors from CSS variables, fallback to defaults */
function readCoverColors(): { primary: [number, number, number]; secondary: [number, number, number]; accent: [number, number, number] } {
  const style = getComputedStyle(document.documentElement);
  const p = parseRgb(style.getPropertyValue("--color-primary"));
  const s = parseRgb(style.getPropertyValue("--color-secondary"));
  const a = parseRgb(style.getPropertyValue("--color-accent"));
  return {
    primary: p || [94, 232, 197],
    secondary: s || [130, 100, 220],
    accent: a || [203, 119, 144],
  };
}

/** Lerp between two RGB colors */
function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Get color for a given bar position (0=outer, 1=center) from cover colors */
function barColor(ratio: number, colors: { primary: [number, number, number]; secondary: [number, number, number]; accent: [number, number, number] }, alpha: number): string {
  // 3-stop gradient: accent (outer) → secondary → primary (center)
  let c: [number, number, number];
  if (ratio < 0.5) {
    c = lerpColor(colors.accent, colors.secondary, ratio * 2);
  } else {
    c = lerpColor(colors.secondary, colors.primary, (ratio - 0.5) * 2);
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export default function SpectrumBars({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const barsRef = useRef<number[]>(new Array(SOURCE_BARS).fill(0));
  const peaksRef = useRef<number[]>(new Array(SOURCE_BARS).fill(0));
  const peakHoldRef = useRef<number[]>(new Array(SOURCE_BARS).fill(0));
  const colorsRef = useRef(readCoverColors());
  const colorTickRef = useRef(0);

  const setupAudio = useCallback(() => {
    if (analyserRef.current) return;
    try {
      const audioCtx = audioPlayer.getAudioContext();
      const sourceNode = audioPlayer.getSourceNode();
      if (!audioCtx || !sourceNode) return;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;  // Lower = more responsive, was 0.8
      sourceNode.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn("[SpectrumBars] Could not set up audio analysis:", err);
    }
  }, []);

  useEffect(() => {
    if (active) setupAudio();
  }, [active, setupAudio]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Reversed log frequency mapping: center bars = bass (low freq), outer = treble
    // i=0 → outer (high freq ~12kHz), i=SOURCE_BARS-1 → center (low freq ~60Hz)
    const logMap: number[] = [];
    const minFreq = 50;    // 50Hz bass
    const maxFreq = 14000; // 14kHz treble
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    for (let i = 0; i < SOURCE_BARS; i++) {
      // Reverse: i=0 → maxFreq (outer), i=31 → minFreq (center)
      const logVal = maxLog - (maxLog - minLog) * (i / (SOURCE_BARS - 1));
      const freq = Math.pow(10, logVal);
      // Convert frequency to FFT bin index: bin = freq * fftSize / sampleRate
      // fftSize=1024, sampleRate typically 48000 or 44100
      logMap.push(freq);
    }

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const freqData = freqDataRef.current;
      const analyser = analyserRef.current;
      const bars = barsRef.current;
      const peaks = peaksRef.current;
      const peakHold = peakHoldRef.current;
      const t = performance.now();

      // Refresh cover colors every 30 frames (~0.5s)
      if (++colorTickRef.current % 30 === 0) {
        colorsRef.current = readCoverColors();
      }
      const colors = colorsRef.current;

      const barWidth = w / BAR_COUNT;
      const gap = 1;
      const mainHeight = h * 0.7;

      // Get frequency data once per frame
      if (active && analyser && freqData) {
        analyser.getByteFrequencyData(freqData);
      }

      const sampleRate = analyser?.context.sampleRate || 48000;
      const binCount = analyser?.frequencyBinCount || 512;

      for (let i = 0; i < SOURCE_BARS; i++) {
        let target: number;
        if (active && freqData) {
          // Convert frequency to bin index
          const centerBin = Math.round(logMap[i] * (analyser?.fftSize || 1024) / sampleRate);
          // Wider bin averaging for smoother response
          const binSpan = Math.max(2, Math.floor(centerBin * 0.4));
          const lo = Math.max(1, centerBin - binSpan);
          const hi = Math.min(binCount - 1, centerBin + binSpan);
          let sum = 0;
          for (let b = lo; b <= hi; b++) sum += freqData[b];
          const avg = sum / (hi - lo + 1);

          const ratio = i / (SOURCE_BARS - 1);
          // Boost center (bass) slightly, outer (treble) slightly less
          const boost = 1.0 + Math.pow(ratio, 1.5) * 0.8;
          target = Math.min(1, (avg / 255) * boost);
        } else {
          // Idle: multi-layer sine breathing
          target =
            0.1 +
            0.06 * Math.sin(t * 0.0015 + i * 0.25) *
            (0.5 + 0.5 * Math.sin(t * 0.0008 + i * 0.15)) +
            0.04 * Math.sin(t * 0.003 + i * 0.4);
        }

        // Fast attack (0.9), faster release (0.15) — was 0.85/0.08
        bars[i] += (target - bars[i]) * (target > bars[i] ? 0.9 : 0.15);

        // Sqrt compression
        const barHeight = Math.pow(bars[i], 0.6) * mainHeight * 0.88;
        const colorRatio = i / (SOURCE_BARS - 1);

        // Mirror: left side = reversed, right side = normal
        const leftIdx = SOURCE_BARS - 1 - i;
        const rightIdx = SOURCE_BARS + i;

        for (const [barPos, srcIdx] of [[leftIdx, i], [rightIdx, i]] as const) {
          const x = barPos * barWidth + gap / 2;
          const y = mainHeight - barHeight;

          // Glow
          ctx.shadowColor = barColor(colorRatio, colors, 0.8);
          ctx.shadowBlur = 4 + bars[i] * 14;

          // Cover-color gradient
          const grad = ctx.createLinearGradient(x, mainHeight, x, y);
          grad.addColorStop(0, barColor(colorRatio, colors, 0.05));
          grad.addColorStop(0.3, barColor(colorRatio, colors, 0.25));
          grad.addColorStop(0.6, barColor(colorRatio, colors, 0.55));
          grad.addColorStop(1, barColor(colorRatio, colors, 0.95));
          ctx.fillStyle = grad;

          // Rounded top caps
          const radius = Math.min(3, (barWidth - gap) / 2);
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth - gap, barHeight, [radius, radius, 0, 0]);
          ctx.fill();

          // Reset shadow
          ctx.shadowBlur = 0;

          // Bottom mirror reflection (30% height, 30% opacity)
          if (barHeight > 2) {
            const reflHeight = barHeight * 0.3;
            const reflGrad = ctx.createLinearGradient(x, mainHeight, x, mainHeight + reflHeight);
            reflGrad.addColorStop(0, barColor(colorRatio, colors, 0.25));
            reflGrad.addColorStop(1, barColor(colorRatio, colors, 0));
            ctx.fillStyle = reflGrad;
            ctx.beginPath();
            ctx.roundRect(x, mainHeight, barWidth - gap, reflHeight, [0, 0, radius, radius]);
            ctx.fill();
          }

          // Peak hold
          if (bars[i] > peaks[srcIdx]) {
            peaks[srcIdx] = bars[i];
            peakHold[srcIdx] = 35;
          } else if (peakHold[srcIdx] > 0) {
            peakHold[srcIdx]--;
          } else {
            peaks[srcIdx] *= 0.97;
          }
          const peakY = mainHeight - Math.pow(peaks[srcIdx], 0.6) * mainHeight * 0.88;
          ctx.fillStyle = barColor(colorRatio, colors, 0.6);
          ctx.fillRect(x, Math.max(0, peakY - 2), barWidth - gap, 2);
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [active]);

  return (
    <div className="spectrum-bars-container">
      <canvas ref={canvasRef} className="spectrum-bars-canvas" />
    </div>
  );
}
