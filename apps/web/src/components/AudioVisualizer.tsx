import { useEffect, useRef, useCallback } from "react";
import { audioPlayer } from "../audio/AudioPlayer";
import { usePlayerStore } from "../stores/playerStore";

interface Props {
  mode: string;
  onFrequencyData?: (bass: number, mid: number) => void;
}

const ATTACK = 0.6;
const RELEASE = 0.3;

function toRgba(color: string, alpha: number): string {
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const r = parseInt(m[1], 16) >> 16;
    const g = (parseInt(m[1], 16) >> 8) & 0xff;
    const b = parseInt(m[1], 16) & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(94,232,197,${alpha})`;
}

export default function AudioVisualizer({ mode, onFrequencyData }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const bassRef = useRef(0);
  const midRef = useRef(0);
  const onFreqRef = useRef(onFrequencyData);
  onFreqRef.current = onFrequencyData;

  const setupAudio = useCallback(() => {
    if (analyserRef.current) return;
    try {
      const audioCtx = audioPlayer.getAudioContext();
      const sourceNode = audioPlayer.getSourceNode();
      if (!audioCtx || !sourceNode) return;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      sourceNode.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn("[AudioVisualizer] Could not set up audio analysis:", err);
    }
  }, []);

  useEffect(() => {
    const isPlaying = usePlayerStore.getState().isPlaying;
    if (isPlaying) setupAudio();

    const unsubPlay = usePlayerStore.subscribe((state) => {
      if (state.isPlaying) setupAudio();
    });
    return () => unsubPlay();
  }, [setupAudio]);

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

    const w = () => canvas.offsetWidth;
    const h = () => canvas.offsetHeight;

    const getBandAvg = (start: number, end: number) => {
      const freqData = freqDataRef.current;
      if (!freqData) return 0;
      let sum = 0;
      for (let i = start; i < end; i++) sum += freqData[i];
      return sum / (end - start) / 255;
    };

    let time = 0;

    const draw = () => {
      const isPlaying = usePlayerStore.getState().isPlaying;
      const analyser = analyserRef.current;
      const freqData = freqDataRef.current;

      if (isPlaying && analyser && freqData) {
        analyser.getByteFrequencyData(freqData);
        const rawBass = getBandAvg(1, 8);
        const rawMid = getBandAvg(8, 50);
        bassRef.current += (rawBass - bassRef.current) * (rawBass > bassRef.current ? ATTACK : RELEASE);
        midRef.current += (rawMid - midRef.current) * (rawMid > midRef.current ? ATTACK : RELEASE);
      } else {
        bassRef.current *= 0.96;
        midRef.current *= 0.96;
      }

      const bass = bassRef.current;
      const mid = midRef.current;

      if (onFreqRef.current) {
        onFreqRef.current(bass, mid);
      }

      time += 0.015;
      ctx.clearRect(0, 0, w(), h());

      const cx = w() / 2;
      const cy = h() / 2;

      const style = getComputedStyle(document.documentElement);
      const primaryColor = style.getPropertyValue("--color-primary").trim() || "#5ee8c5";

      const speedMul = 1 + bass * 2.5;
      const scaleMul = 1 + bass * 1.8;
      const opBase = isPlaying ? 0.45 : 0.15;

      switch (mode) {
        case "Glob": {
          ctx.beginPath();
          for (let i = 0; i < 100; i++) {
            const angle = (i / 100) * Math.PI * 2;
            const r = (100 + Math.sin(time * 2.5 * speedMul + i * 0.3) * 50 + Math.cos(time * 1.8 * speedMul + i * 0.5) * 35) * scaleMul;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = toRgba(primaryColor, opBase);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = toRgba(primaryColor, opBase * 0.15);
          ctx.fill();
          break;
        }
        case "Flower": {
          const petals = 8;
          for (let p = 0; p < petals; p++) {
            const angle = (p / petals) * Math.PI * 2 + time * 0.5 * speedMul;
            const r = (80 + Math.sin(time * 2.5 * speedMul + p) * 35) * scaleMul;
            ctx.beginPath();
            ctx.ellipse(
              cx + Math.cos(angle) * 45 * scaleMul,
              cy + Math.sin(angle) * 45 * scaleMul,
              r, r * 0.4, angle, 0, Math.PI * 2
            );
            ctx.strokeStyle = toRgba(primaryColor, opBase + Math.sin(time + p) * 0.1 + mid * 0.15);
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          break;
        }
        case "Arcs": {
          for (let i = 0; i < 20; i++) {
            const startAngle = time * speedMul + (i / 20) * Math.PI * 2;
            const r = (50 + i * (8 + bass * 6)) * scaleMul;
            ctx.beginPath();
            ctx.arc(cx, cy, r, startAngle, startAngle + Math.PI * 0.3);
            ctx.strokeStyle = toRgba(primaryColor, Math.max(0, opBase - i * 0.008 + bass * 0.1));
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          break;
        }
        case "Circles": {
          for (let i = 0; i < 5; i++) {
            const r = (40 + i * 30 + Math.sin(time * 3 * speedMul + i) * 20) * scaleMul;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = toRgba(primaryColor, Math.max(0, opBase - i * 0.02 + mid * 0.1));
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          break;
        }
        case "Wave": {
          ctx.beginPath();
          for (let x = 0; x < w(); x += 2) {
            const y = cy + Math.sin(x * 0.02 + time * 4 * speedMul) * (50 + bass * 40) + Math.sin(x * 0.01 + time * 2.5 * speedMul) * (35 + mid * 25);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = toRgba(primaryColor, opBase);
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
        case "Shine": {
          const rays = 30;
          for (let i = 0; i < rays; i++) {
            const angle = (i / rays) * Math.PI * 2 + time * 0.3 * speedMul;
            const len = (50 + Math.sin(time * 4 * speedMul + i * 0.5) * 45) * scaleMul;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
            ctx.strokeStyle = toRgba(primaryColor, opBase + Math.sin(time + i) * 0.1 + bass * 0.1);
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          break;
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [mode]);

  return (
    <div className="audio-visualizer">
      <canvas ref={canvasRef} className="viz-canvas" />
    </div>
  );
}
