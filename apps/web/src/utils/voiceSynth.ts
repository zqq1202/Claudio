import { audioPlayer } from "../audio/AudioPlayer";

let speaking = false;
let currentAudio: HTMLAudioElement | null = null;

export async function speak(text: string): Promise<void> {
  if (speaking) return;
  speaking = true;

  // Duck music volume
  audioPlayer.duck(0.2, 300);
  window.dispatchEvent(new CustomEvent("voiceStart", { detail: { text } }));

  try {
    // Call server TTS endpoint (Fish Audio)
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      throw new Error(`TTS failed: ${res.status}`);
    }

    const { audioUrl } = await res.json();
    if (!audioUrl) throw new Error("No audio URL");

    await playAudio(audioUrl);
  } catch (err) {
    console.warn("[voiceSynth] Fish Audio TTS failed, falling back to browser TTS:", err);
    await browserSpeak(text);
  } finally {
    speaking = false;
    audioPlayer.unduck(600);
    window.dispatchEvent(new CustomEvent("voiceEnd"));
  }
}

function playAudio(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => { currentAudio = null; resolve(); };
    audio.onerror = () => { currentAudio = null; reject(new Error("Audio play failed")); };
    audio.play().catch(reject);
  });
}

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

export function stop(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();
  speaking = false;
  audioPlayer.unduck(600);
  window.dispatchEvent(new CustomEvent("voiceEnd"));
}

export function isSpeaking(): boolean {
  return speaking;
}
