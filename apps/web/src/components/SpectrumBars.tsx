import { useEffect, useRef, useCallback } from "react";
import { audioPlayer } from "../audio/AudioPlayer";

const BAR_COUNT = 64;

interface Props {
  active: boolean;
}

function toRgba(color: string, alpha: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const r = parseInt(m[1], 16) >> 16;
    const g = (parseInt(m[1], 16) >> 8) & 0xff;
    const b = parseInt(m[1], 16) & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }
  return `rgba(94,232,197,${alpha})`;
}

export default function SpectrumBars({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const barsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const peaksRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const peakHoldRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));

  const setupAudio = useCallback(() => {
    if (analyserRef.current) return;
    try {
      const audioCtx = audioPlayer.getAudioContext();
      const sourceNode = audioPlayer.getSourceNode();
      if (!audioCtx || !sourceNode) return;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
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

    // Pre-compute log mapping table
    const logMap: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const minLog = Math.log10(1);
      const maxLog = Math.log10(512); // 1024 fftSize → 512 bins
      logMap.push(Math.pow(10, minLog + (maxLog - minLog) * (i / BAR_COUNT)));
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

      const style = getComputedStyle(document.documentElement);
      const primaryColor = style.getPropertyValue("--color-primary").trim() || "#5ee8c5";

      const barWidth = w / BAR_COUNT;
      const gap = 1;

      // Get frequency data once per frame
      if (active && analyser && freqData) {
        analyser.getByteFrequencyData(freqData);
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        let target: number;
        if (active && freqData) {
          // Logarithmic frequency mapping
          const idx = Math.min(Math.floor(logMap[i]), freqData.length - 1);
          // Perceptual bass boost
          const ratio = i / BAR_COUNT;
          const boost = 1.0 + Math.pow(1.0 - ratio, 2.0) * 1.5;
          target = Math.min(1, (freqData[idx] || 0) / 255 * boost);
        } else {
          // Idle animation — multi-layered sine for organic feel
          target = 0.12 + 0.08 * Math.sin(t * 0.002 + i * 0.3) * (0.5 + 0.5 * Math.sin(t * 0.001));
        }

        // Fast attack (0.65), medium release (0.25) — pop up, float down
        bars[i] += (target - bars[i]) * (target > bars[i] ? 0.65 : 0.25);

        // Sqrt compression for better dynamic range
        const barHeight = Math.pow(bars[i], 0.65) * h * 0.88;
        const x = i * barWidth + gap / 2;
        const y = h - barHeight;

        // Glow effect
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 4 + bars[i] * 10;

        // Color gradient — primary color fading to transparent at bottom
        const grad = ctx.createLinearGradient(x, h, x, y);
        grad.addColorStop(0, toRgba(primaryColor, 0.08));
        grad.addColorStop(0.3, toRgba(primaryColor, 0.25));
        grad.addColorStop(0.6, toRgba(primaryColor, 0.55));
        grad.addColorStop(1, toRgba(primaryColor, 0.95));
        ctx.fillStyle = grad;

        // Rounded top caps
        const radius = Math.min(3, (barWidth - gap) / 2);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - gap, barHeight, [radius, radius, 0, 0]);
        ctx.fill();

        // Reset shadow
        ctx.shadowBlur = 0;

        // Peak indicator
        if (bars[i] > peaks[i]) {
          peaks[i] = bars[i];
          peakHold[i] = 30;
        } else if (peakHold[i] > 0) {
          peakHold[i]--;
        } else {
          peaks[i] *= 0.97;
        }
        const peakY = h - Math.pow(peaks[i], 0.7) * h * 0.85;
        ctx.fillStyle = toRgba(primaryColor, 0.6);
        ctx.fillRect(x, Math.max(0, peakY - 2), barWidth - gap, 2);
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
