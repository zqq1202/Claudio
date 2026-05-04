interface ColorResult {
  primary: string;
  secondary: string;
  accent: string;
}

function simpleKMeans(pixels: number[][], k: number): number[][] {
  let centroids: number[][] = [];
  for (let i = 0; i < k; i++) {
    centroids.push([...pixels[Math.floor(Math.random() * pixels.length)]]);
  }

  for (let iter = 0; iter < 10; iter++) {
    const clusters: number[][][] = Array.from({ length: k }, () => []);
    for (const p of pixels) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let i = 0; i < k; i++) {
        const d =
          (p[0] - centroids[i][0]) ** 2 +
          (p[1] - centroids[i][1]) ** 2 +
          (p[2] - centroids[i][2]) ** 2;
        if (d < minDist) {
          minDist = d;
          minIdx = i;
        }
      }
      clusters[minIdx].push(p);
    }
    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      centroids[i] = [
        Math.round(clusters[i].reduce((s, p) => s + p[0], 0) / clusters[i].length),
        Math.round(clusters[i].reduce((s, p) => s + p[1], 0) / clusters[i].length),
        Math.round(clusters[i].reduce((s, p) => s + p[2], 0) / clusters[i].length),
      ];
    }
  }

  centroids.sort((a, b) => {
    const satA = Math.max(a[0], a[1], a[2]) - Math.min(a[0], a[1], a[2]);
    const satB = Math.max(b[0], b[1], b[2]) - Math.min(b[0], b[1], b[2]);
    return satB - satA;
  });

  return centroids;
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Boost saturation and lightness so extracted colors are vivid enough for UI */
function boostSaturation(r: number, g: number, b: number): number[] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [r, g, b].map(v => Math.round(v * 255));
  const d = max - min;
  let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  // Boost: min saturation 0.45, min lightness 0.35, max lightness 0.65
  s = Math.max(s, 0.45);
  const l2 = Math.min(Math.max(l, 0.35), 0.65);
  const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
  const p = 2 * l2 - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function complementaryColor(rgbStr: string): string {
  const m = rgbStr.match(/(\d+)/g);
  if (!m) return rgbStr;
  let [r, g, b] = m.map(Number);
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return rgbStr;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  h = (h + 0.5) % 1;
  const s2 = Math.min(s, 0.7);
  const l2 = Math.min(l + 0.08, 0.6);
  const q2 = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p2 = 2 * l2 - q2;
  const rr = Math.round(hue2rgb(p2, q2, h + 1 / 3) * 255);
  const gg = Math.round(hue2rgb(p2, q2, h) * 255);
  const bb = Math.round(hue2rgb(p2, q2, h - 1 / 3) * 255);
  return `rgb(${rr},${gg},${bb})`;
}

export function extractColors(imageUrl: string): Promise<ColorResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      const pixels: number[][] = [];
      for (let i = 0; i < data.length; i += 16) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }

      const colors = simpleKMeans(pixels, 3);
      const [primary, secondary, accent] = colors.map((c) => {
        const boosted = boostSaturation(c[0], c[1], c[2]);
        return `rgb(${boosted[0]},${boosted[1]},${boosted[2]})`;
      });

      const root = document.documentElement;
      root.style.setProperty("--color-primary", primary);
      root.style.setProperty("--color-secondary", secondary);
      root.style.setProperty("--color-accent", accent);
      root.style.setProperty(
        "--blob-secondary",
        complementaryColor(primary)
      );

      resolve({ primary, secondary, accent });
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/** Reset dynamic color overrides so theme CSS variables take effect */
export function resetColors(): void {
  const root = document.documentElement;
  root.style.removeProperty("--color-primary");
  root.style.removeProperty("--color-secondary");
  root.style.removeProperty("--color-accent");
  root.style.removeProperty("--blob-secondary");
}
