import { useEffect, useRef, useCallback } from "react";
import { audioPlayer } from "../audio/AudioPlayer";

const BAR_COUNT = 64;

interface Props {
  active: boolean;
}

export default function SpectrumBars({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const barsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));

  const setupAudio = useCallback(() => {
    if (analyserRef.current) return; // already set up
    try {
      // Reuse AudioPlayer's shared AudioContext and source node
      // instead of creating a second MediaElementAudioSourceNode (which throws)
      const audioCtx = audioPlayer.getAudioContext();
      const sourceNode = audioPlayer.getSourceNode();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      sourceNode.connect(analyser);
      // Don't connect analyser to destination — AudioPlayer's gainNode already does that
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

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const freqData = freqDataRef.current;
      const analyser = analyserRef.current;
      const bars = barsRef.current;
      const t = performance.now();

      const style = getComputedStyle(document.documentElement);
      const primaryColor = style.getPropertyValue("--color-primary").trim() || "#5ee8c5";

      const barWidth = w / BAR_COUNT;
      const gap = 1;

      for (let i = 0; i < BAR_COUNT; i++) {
        let target: number;
        if (active && analyser && freqData) {
          analyser.getByteFrequencyData(freqData);
          const idx = Math.floor(Math.pow(i / BAR_COUNT, 1.6) * freqData.length);
          target = (freqData[idx] || 0) / 255;
        } else {
          target = 0.06 + 0.04 * Math.sin(t * 0.002 + i * 0.3);
        }

        bars[i] += (target - bars[i]) * (target > bars[i] ? 0.35 : 0.12);

        const barHeight = bars[i] * h;
        const x = i * barWidth + gap / 2;
        const y = h - barHeight;

        const grad = ctx.createLinearGradient(x, h, x, y);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.08)");
        grad.addColorStop(1, "rgba(255,255,255,0.25)");

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth - gap, barHeight);
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
