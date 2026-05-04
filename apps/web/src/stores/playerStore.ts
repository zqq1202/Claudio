import { create } from "zustand";
import type { QueueItem } from "../api/client";
import { api } from "../api/client";
import { audioPlayer } from "../audio/AudioPlayer";
import { wsClient } from "../api/ws";
import { useToastStore } from "./toastStore";

export interface DjMessage {
  id: string;
  text: string;
  ts: number;
}

export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  djMessages: DjMessage[];
  isPlaying: boolean;
  needsUserAction: boolean;
  progressMs: number;
  durationMs: number;
  scene: string | null;
  djStatus: "idle" | "thinking" | "speaking" | "error";
  planLoading: boolean;

  // Volume
  volume: number;
  isMuted: boolean;
  setVolume: (v: number) => void;
  toggleMute: () => void;

  // Shuffle / Repeat
  repeatMode: RepeatMode;
  shuffle: boolean;
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  // Playback persistence
  playbackRestored: boolean;
  restorePlayback: () => Promise<void>;
  savePlaybackState: () => void;

  // Error
  lastError: string | null;
  clearError: () => void;

  // Favorites
  favoriteIds: string[];
  loadFavorites: () => Promise<void>;
  toggleFavorite: (songId: string, title?: string, artist?: string, coverUrl?: string) => Promise<void>;

  fetchNow: () => Promise<void>;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  setProgress: (ms: number) => void;
  playItem: (item: QueueItem) => void;
  setQueue: (items: QueueItem[]) => void;
  enqueueItems: (items: QueueItem[]) => void;
  updateItemAudioUrl: (itemId: string, audioUrl: string) => void;
  addDjMessage: (text: string) => void;
  clearDjMessages: () => void;
  userActionPlay: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  let consecutiveErrors = 0;

  audioPlayer.onPlay(() => {
    consecutiveErrors = 0;
    set({ isPlaying: true, needsUserAction: false });
  });
  audioPlayer.onPause(() => set({ isPlaying: false }));
  audioPlayer.onTimeUpdate((current, duration) => {
    set({ progressMs: current, durationMs: duration });
  });
  audioPlayer.onEnded(() => {
    get().next();
  });
  audioPlayer.onError(() => {
    consecutiveErrors++;
    const { nowPlaying } = get();
    const errMsg = `Playback failed: ${nowPlaying?.title ?? "Unknown"}`;
    console.warn(`[player] Audio error for: ${nowPlaying?.title} (consecutive: ${consecutiveErrors})`);
    set({ lastError: errMsg });
    useToastStore.getState().addToast("播放失败，已跳过", "error");
    const dur = audioPlayer.durationMs;
    if (!Number.isNaN(dur) && dur > 0) {
      set({ durationMs: dur });
    }
    if (consecutiveErrors > 3) {
      console.error("[player] Too many consecutive errors, stopping auto-skip.");
      consecutiveErrors = 0;
      return;
    }
    get().next();
  });

  audioPlayer.setMediaCallbacks({
    onNext: () => get().next(),
    onPrevious: () => get().previous(),
  });

  wsClient.on("now_changed", (payload) => {
    const data = payload as { nowPlaying: QueueItem | null; queue: QueueItem[]; scene: string; djStatus: string };
    // Only update scene/djStatus from server; don't overwrite client-managed queue
    // Server mock data has empty audioUrl which would break playback
    set({
      scene: data.scene,
      djStatus: data.djStatus as PlayerState["djStatus"],
    });
  });

  wsClient.on("queue_updated", (payload) => {
    set({ queue: payload as QueueItem[] });
  });

  wsClient.on("plan_started", () => {
    set({ planLoading: true });
  });

  wsClient.on("plan_finished", async () => {
    set({ planLoading: false });
    try {
      const data = await api.getNow();
      set({
        nowPlaying: data.nowPlaying,
        queue: data.queue,
        scene: data.scene,
        djStatus: data.djStatus,
      });
    } catch (err) {
      console.error("[ws] failed to refresh after plan_finished:", err);
    }
  });

  wsClient.on("tts_ready", (payload) => {
    const { itemId, audioUrl } = payload as { itemId: string; audioUrl: string };
    const { queue, nowPlaying } = get();
    const updatedQueue = queue.map((item) =>
      item.id === itemId ? { ...item, audioUrl } : item
    );
    const updatedNow = nowPlaying?.id === itemId ? { ...nowPlaying, audioUrl } : nowPlaying;
    set({ queue: updatedQueue, nowPlaying: updatedNow });
  });

  wsClient.on("error", (payload) => {
    const { message } = payload as { code: string; message: string };
    useToastStore.getState().addToast(message, "error");
  });

  return {
    nowPlaying: null,
    queue: [],
    djMessages: [],
    isPlaying: false,
    needsUserAction: false,
    progressMs: 0,
    durationMs: 0,
    scene: null,
    djStatus: "idle",
    planLoading: false,
    playbackRestored: false,

    // Volume
    volume: 1,
    isMuted: false,
    setVolume: (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      audioPlayer.setVolume(clamped);
      set({ volume: clamped, isMuted: clamped === 0 });
    },
    toggleMute: () => {
      const { isMuted, volume } = get();
      if (isMuted) {
        audioPlayer.setVolume(volume || 1);
        set({ isMuted: false });
      } else {
        audioPlayer.setVolume(0);
        set({ isMuted: true });
      }
    },

    // Shuffle / Repeat
    repeatMode: "off",
    shuffle: false,
    toggleShuffle: () => {
      set((s) => ({ shuffle: !s.shuffle }));
      get().savePlaybackState();
    },
    cycleRepeat: () => {
      set((s) => {
        const modes: RepeatMode[] = ["off", "all", "one"];
        const idx = modes.indexOf(s.repeatMode);
        return { repeatMode: modes[(idx + 1) % 3] };
      });
      get().savePlaybackState();
    },

    // Error
    lastError: null,
    clearError: () => set({ lastError: null }),

    // Favorites
    favoriteIds: [],
    loadFavorites: async () => {
      try {
        const { favorites } = await api.getFavorites();
        set({ favoriteIds: favorites.map((f) => f.songId) });
      } catch (err) {
        console.error("Failed to load favorites:", err);
      }
    },
    toggleFavorite: async (songId: string, title?: string, artist?: string, coverUrl?: string) => {
      const { favoriteIds } = get();
      const isFav = favoriteIds.includes(songId);
      if (isFav) {
        set({ favoriteIds: favoriteIds.filter((id) => id !== songId) });
        try { await api.removeFavorite(songId); } catch { set({ favoriteIds: get().favoriteIds.concat(songId) }); }
      } else {
        set({ favoriteIds: [...favoriteIds, songId] });
        try { await api.addFavorite({ songId, title, artist, coverUrl }); } catch { set({ favoriteIds: get().favoriteIds.filter((id) => id !== songId) }); }
      }
    },

    fetchNow: async () => {
      try {
        // Don't overwrite state if user is already playing
        const { nowPlaying } = get();
        if (nowPlaying) return;

        const data = await api.getNow();
        set({
          nowPlaying: data.nowPlaying,
          queue: data.queue,
          scene: data.scene,
          djStatus: data.djStatus,
        });
        if (data.nowPlaying?.audioUrl) {
          audioPlayer.load(data.nowPlaying.audioUrl);
        }

        // If queue is empty, auto-load from default NCM playlist
        if (!data.nowPlaying && data.queue.length === 0) {
          try {
            const defaultPlaylistId = "8624020658";
            const plData = await api.getNcmPlaylistDetail(defaultPlaylistId);
            if (plData.tracks.length > 0) {
              const items: QueueItem[] = plData.tracks.map((t, i) => ({
                id: `default_${t.id}_${i}`,
                type: "song" as const,
                songId: t.id,
                title: t.title,
                artist: t.artist,
                coverUrl: t.coverUrl,
                audioUrl: `/api/audio?id=${encodeURIComponent(t.id)}&title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist)}`,
                status: (i === 0 ? "playing" : "pending") as QueueItem["status"],
              }));
              set({ queue: items, nowPlaying: items[0] });
              if (items[0].audioUrl) {
                audioPlayer.load(items[0].audioUrl);
              }
            }
          } catch (err) {
            console.warn("[player] Failed to load default playlist:", err);
          }
        }
      } catch (err) {
        console.error("Failed to fetch /api/now:", err);
      }
    },

    playItem: (item: QueueItem) => {
      if (item.audioUrl) {
        audioPlayer.load(item.audioUrl);
        audioPlayer.setVolume(get().isMuted ? 0 : get().volume);
        audioPlayer.play();
        setTimeout(() => {
          if (audioPlayer.isPending && audioPlayer.audioElement.paused) {
            set({ needsUserAction: true });
          }
        }, 500);
      }
      audioPlayer.updateMetadata(item.title ?? "", item.artist ?? "", item.coverUrl ?? "");
      set({ nowPlaying: item, progressMs: 0, lastError: null });
      get().savePlaybackState();
      if (item.type === "song" && item.songId) {
        api.reportPlay({
          songId: item.songId,
          title: item.title,
          artist: item.artist,
          coverUrl: item.coverUrl,
        });
      }
    },

    togglePlay: () => {
      const { isPlaying, nowPlaying } = get();
      if (isPlaying) {
        audioPlayer.pause();
      } else {
        if (nowPlaying?.audioUrl) {
          audioPlayer.play();
        }
      }
    },

    next: () => {
      const { queue, nowPlaying, repeatMode, shuffle } = get();
      if (queue.length === 0) return;

      if (repeatMode === "one" && nowPlaying) {
        get().playItem(nowPlaying);
        return;
      }

      const idx = queue.findIndex((item) => item.id === nowPlaying?.id);

      if (shuffle) {
        if (queue.length === 1) {
          get().playItem(queue[0]);
          return;
        }
        let randIdx = Math.floor(Math.random() * queue.length);
        while (randIdx === idx && queue.length > 1) {
          randIdx = Math.floor(Math.random() * queue.length);
        }
        get().playItem(queue[randIdx]);
        return;
      }

      const nextIdx = idx + 1;
      if (nextIdx < queue.length) {
        get().playItem(queue[nextIdx]);
      } else if (repeatMode === "all") {
        get().playItem(queue[0]);
      }
    },

    previous: () => {
      const { queue, nowPlaying, shuffle } = get();
      if (queue.length === 0) return;

      const idx = queue.findIndex((item) => item.id === nowPlaying?.id);

      if (shuffle) {
        if (queue.length === 1) {
          get().playItem(queue[0]);
          return;
        }
        let randIdx = Math.floor(Math.random() * queue.length);
        while (randIdx === idx && queue.length > 1) {
          randIdx = Math.floor(Math.random() * queue.length);
        }
        get().playItem(queue[randIdx]);
        return;
      }

      const prevIdx = idx - 1;
      if (prevIdx >= 0) {
        get().playItem(queue[prevIdx]);
      } else {
        get().playItem(queue[queue.length - 1]);
      }
    },

    setProgress: (ms: number) => {
      audioPlayer.seek(ms);
      set({ progressMs: ms });
      get().savePlaybackState();
    },

    setQueue: (items: QueueItem[]) => {
      // Separate songs from TTS items
      const songs = items.filter((i) => i.type === "song");
      const ttsItems = items.filter((i) => i.type === "tts");
      const ttsTexts = ttsItems.filter((i) => i.text);

      // Add DJ messages for display
      if (ttsTexts.length > 0) {
        const msgs = ttsTexts.map((t) => ({
          id: t.id,
          text: t.text!,
          ts: Date.now(),
        }));
        set((s) => ({ djMessages: [...s.djMessages, ...msgs] }));
      }

      // Include TTS items with audioUrl in the queue (they play before songs)
      const playableTts = ttsItems.filter((i) => i.audioUrl);
      const queueItems = [...playableTts, ...songs];

      const first = queueItems[0] ?? null;
      set({ queue: queueItems, nowPlaying: first, progressMs: 0 });
      get().savePlaybackState();
      if (first?.audioUrl) {
        audioPlayer.load(first.audioUrl);
        audioPlayer.play();
        // If autoplay is blocked, show a prompt after a short delay
        setTimeout(() => {
          if (audioPlayer.isPending && audioPlayer.audioElement.paused) {
            set({ needsUserAction: true });
          }
        }, 500);
      }
    },

    enqueueItems: (items: QueueItem[]) => {
      const songs = items.filter((i) => i.type === "song");
      const ttsItems = items.filter((i) => i.type === "tts");
      const ttsTexts = ttsItems.filter((i) => i.text);

      if (ttsTexts.length > 0) {
        const msgs = ttsTexts.map((t) => ({
          id: t.id,
          text: t.text!,
          ts: Date.now(),
        }));
        set((s) => ({ djMessages: [...s.djMessages, ...msgs] }));
      }

      const playableTts = ttsItems.filter((i) => i.audioUrl);
      const newItems = [...playableTts, ...songs];

      const { queue, nowPlaying } = get();
      if (!nowPlaying && newItems.length > 0) {
        get().setQueue([...queue, ...newItems]);
      } else {
        set({ queue: [...queue, ...newItems] });
        get().savePlaybackState();
      }
    },

    updateItemAudioUrl: (itemId: string, audioUrl: string) => {
      const { queue, nowPlaying } = get();
      const updatedQueue = queue.map((item) =>
        item.id === itemId ? { ...item, audioUrl } : item
      );
      const updatedNow = nowPlaying?.id === itemId ? { ...nowPlaying, audioUrl } : nowPlaying;
      set({ queue: updatedQueue, nowPlaying: updatedNow });
    },

    addDjMessage: (text: string) => {
      set((s) => ({
        djMessages: [...s.djMessages, { id: `dj_${Date.now()}`, text, ts: Date.now() }],
      }));
    },

    clearDjMessages: () => set({ djMessages: [] }),

    userActionPlay: () => {
      audioPlayer.retryPlay();
      set({ needsUserAction: false });
    },

    restorePlayback: async () => {
      try {
        const state = await api.getPlaybackState();
        if (!state?.currentSongId) {
          set({ playbackRestored: true });
          return;
        }
        const restored: QueueItem = {
          id: `restored_${state.currentSongId}`,
          type: "song",
          songId: state.currentSongId,
          title: state.currentSongName,
          artist: state.currentSongArtist,
          coverUrl: state.currentSongCover,
          audioUrl: `/api/audio?id=${encodeURIComponent(state.currentSongId)}&title=${encodeURIComponent(state.currentSongName ?? "")}&artist=${encodeURIComponent(state.currentSongArtist ?? "")}`,
          status: "playing",
        };

        let restoredQueue: QueueItem[] = [];
        if (state.queueData) {
          try {
            const parsed = JSON.parse(state.queueData);
            if (Array.isArray(parsed)) {
              restoredQueue = parsed.map((item: string | { id?: string; songId?: string; title?: string; artist?: string; coverUrl?: string }, i: number) => {
                if (typeof item === "string") {
                  return {
                    id: `q_${item}_${i}`,
                    type: "song" as const,
                    songId: item,
                    title: undefined,
                    artist: undefined,
                    coverUrl: undefined,
                    audioUrl: `/api/audio?id=${encodeURIComponent(item)}`,
                    status: "pending" as const,
                  };
                }
                return {
                  id: item.id ?? `q_${item.songId ?? i}_${i}`,
                  type: "song" as const,
                  songId: item.songId,
                  title: item.title,
                  artist: item.artist,
                  coverUrl: item.coverUrl,
                  audioUrl: `/api/audio?id=${encodeURIComponent(item.songId ?? "")}`,
                  status: "pending" as const,
                };
              });
            }
          } catch { /* ignore parse errors */ }
        }

        // Map server repeat mode to client
        let repeatMode: RepeatMode = "off";
        if (state.play_mode === "one") repeatMode = "one";
        else if (state.play_mode === "all") repeatMode = "all";

        set({
          nowPlaying: restored,
          queue: restoredQueue.length > 0 ? restoredQueue : [restored],
          repeatMode,
          shuffle: state.shuffle ?? false,
          progressMs: (state.progressSeconds ?? 0) * 1000,
          playbackRestored: true,
        });

        if (restored.audioUrl) {
          audioPlayer.load(restored.audioUrl);
        }
      } catch {
        set({ playbackRestored: true });
      }
    },

    savePlaybackState: (() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const { nowPlaying, queue, repeatMode, shuffle, progressMs } = get();
          const play_mode = repeatMode === "one" ? "one" : repeatMode === "all" ? "all" : "off";
          const queueIndex = nowPlaying ? queue.findIndex(q => q.id === nowPlaying.id) : 0;
          api.savePlaybackState({
            currentSongId: nowPlaying?.songId,
            currentSongName: nowPlaying?.title,
            currentSongArtist: nowPlaying?.artist,
            currentSongAlbum: undefined,
            currentSongCover: nowPlaying?.coverUrl,
            queueData: JSON.stringify(queue.map(q => ({ id: q.id, songId: q.songId, title: q.title, artist: q.artist, coverUrl: q.coverUrl }))),
            queueIndex: queueIndex >= 0 ? queueIndex : 0,
            play_mode,
            shuffle,
            progressSeconds: Math.floor(progressMs / 1000),
          });
        }, 500);
      };
    })(),
  };
});

// Music ducking — lower volume during voice synthesis
if (typeof window !== "undefined") {
  let savedVolume = 0.8;

  window.addEventListener("voiceStart", () => {
    const store = usePlayerStore.getState();
    savedVolume = store.volume;
    usePlayerStore.setState({ volume: 0.2 });
    audioPlayer.setVolume(0.2);
  });

  window.addEventListener("voiceEnd", () => {
    let current = 0.2;
    const fade = setInterval(() => {
      current = Math.min(current + 0.05, savedVolume);
      usePlayerStore.setState({ volume: current });
      audioPlayer.setVolume(current);
      if (current >= savedVolume) clearInterval(fade);
    }, 50);
  });
}

// TODO: Import and call extractColors(nowPlaying.cover) when song changes
