import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../../cache/tts");

export interface TtsService {
  synthesize(text: string): Promise<string>;
}

export class MockTtsService implements TtsService {
  constructor() {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  async synthesize(text: string): Promise<string> {
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const filename = `${hash}.mp3`;
    const filepath = join(CACHE_DIR, filename);

    if (existsSync(filepath)) {
      return `/api/media/tts/${hash}`;
    }

    writeFileSync(filepath, Buffer.alloc(0));
    return `/api/media/tts/${hash}`;
  }
}

export class FishTtsService implements TtsService {
  private apiKey: string;
  private voiceId: string;
  private cacheDir: string;

  constructor(config: { apiKey: string; voiceId: string }) {
    this.apiKey = config.apiKey;
    this.voiceId = config.voiceId;
    this.cacheDir = CACHE_DIR;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  async synthesize(text: string): Promise<string> {
    if (text.length > 200) {
      text = text.slice(0, 200);
    }

    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const filename = `${hash}.mp3`;
    const filepath = join(this.cacheDir, filename);

    if (existsSync(filepath) && readFileSync(filepath).length > 0) {
      return `/api/media/tts/${hash}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const body: Record<string, unknown> = {
        text,
        reference_id: this.voiceId,
        format: "mp3",
        mp3_bitrate: 128,
        normalize: true,
        latency: "normal",
      };

      const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
      const url = "https://api.fish.audio/v1/tts";
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      };
      const bodyStr = JSON.stringify(body);

      let res: Response;
      if (proxyUrl) {
        const { ProxyAgent, fetch: undiciFetch } = await import("undici");
        res = await undiciFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: controller.signal,
          dispatcher: new ProxyAgent(proxyUrl),
        }) as unknown as Response;
      } else {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: controller.signal,
        });
      }

      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Fish Audio API ${res.status}: ${res.statusText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      writeFileSync(filepath, buffer);
      return `/api/media/tts/${hash}`;
    } catch (err) {
      console.error("[tts] Fish Audio failed:", err);
      return "";
    }
  }
}

export class EdgeTtsService implements TtsService {
  private voice: string;
  private cacheDir: string;
  private wsUrl = "wss://speech.platform.bing.com/td/s3/upsell";

  constructor(config: { voice?: string }) {
    this.voice = config.voice || "zh-CN-XiaoxiaoNeural";
    this.cacheDir = CACHE_DIR;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  async synthesize(text: string): Promise<string> {
    const hash = createHash("sha256").update(text + this.voice).digest("hex").slice(0, 16);
    const filename = `${hash}.mp3`;
    const filepath = join(this.cacheDir, filename);

    if (existsSync(filepath) && readFileSync(filepath).length > 0) {
      return `/api/media/tts/${hash}`;
    }

    return new Promise((resolve) => {
      const audioChunks: Buffer[] = [];

      const ssml = this.buildSsml(text);

      const reqId = this.generateUUID();
      const timestamp = Date.now();

      try {
        const websocket = new WebSocket(this.wsUrl, {
          headers: {
            "Pragma": "no-cache",
            "Cache-Control": "no-cache",
            "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        let sentConfig = false;
        let finished = false;

        const sendText = () => {
          if (finished) return;

          const configMsg = `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:session.config\r\n\r\n{"context":{"synthesis":{"audioConfig":{"sampleRate":"24000","outputFormat":"audio-24khz-48kbitrate-mono-mp3"},"language":{"autoDetection":"${this.getLang(text)}"}}}}\r\n`;
          websocket.send(`Path: speech\r\nX-RequestId:${reqId}\r\nContent-Type:application/x-ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n${ssml}`);

          const dataMsg = `Path: speech\r\nX-RequestId:${reqId}\r\nContent-Type:application/json\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:turn.end\r\n\r\n{"context":{"synthesis":{"audioConfig":{"sampleRate":"24000","outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
          websocket.send(dataMsg);
        };

        websocket.on("open", () => {
          const synPkg = `Path: speech.config\r\nX-RequestId:${reqId}\r\nContent-Type:application/json; charset=utf-8\r\n\r\n{"context":{"synthesis":{"audioConfig":{"sampleRate":"24000","outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
          websocket.send(synPkg);
          setTimeout(() => {
            sentConfig = true;
            sendText();
          }, 100);
        });

        websocket.on("message", (data: Buffer) => {
          const str = data.toString();

          if (str.includes("Path:turn.end")) {
            finished = true;
            websocket.close();

            if (audioChunks.length > 0) {
              const audioBuffer = Buffer.concat(audioChunks);
              writeFileSync(filepath, audioBuffer);
              resolve(`/api/media/tts/${hash}`);
            } else {
              resolve("");
            }
          } else if (str.includes("Path:audio")) {
            const headerEnd = str.indexOf("\r\n\r\n");
            if (headerEnd !== -1 && headerEnd + 4 < str.length) {
              const audioBase64 = str.slice(headerEnd + 4);
              const audioBuffer = Buffer.from(audioBase64, "base64");
              audioChunks.push(audioBuffer);
            }
          }
        });

        websocket.on("error", (err: Error) => {
          console.error("[tts] Edge TTS WebSocket error:", err);
          finished = true;
          resolve("");
        });

        websocket.on("close", () => {
          if (!finished) {
            finished = true;
            if (audioChunks.length > 0) {
              const audioBuffer = Buffer.concat(audioChunks);
              writeFileSync(filepath, audioBuffer);
              resolve(`/api/media/tts/${hash}`);
            } else {
              resolve("");
            }
          }
        });

        setTimeout(() => {
          if (!finished) {
            finished = true;
            websocket.close();
            resolve("");
          }
        }, 15000);
      } catch (err) {
        console.error("[tts] Edge TTS failed:", err);
        resolve("");
      }
    });
  }

  private buildSsml(text: string): string {
    const cleanText = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${this.voice}'>${cleanText}</voice></speak>`;
  }

  private getLang(text: string): string {
    const zhRegex = /[\u4e00-\u9fff]/;
    return zhRegex.test(text) ? "zh-CN" : "en-US";
  }

  private generateUUID(): string {
    return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }
}
