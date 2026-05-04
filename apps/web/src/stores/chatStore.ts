import { create } from "zustand";
import type { QueueItem, StructuredReply } from "../api/client";
import { api } from "../api/client";
import { useToastStore } from "./toastStore";
import { speak } from "../utils/voiceSynth";

export interface ChatMessage {
    id: string;
    role: "user" | "ai" | "dj";
    text: string;
    ts: number;
    /** Recommended songs shown inline with AI message */
    songs?: RecommendedSong[];
    /** Structured reply from Claude */
    structured?: StructuredReply;
}

export interface RecommendedSong {
    id: string;
    songId?: string;
    title: string;
    artist: string;
    coverUrl?: string;
    reason?: string;
    audioUrl?: string;
}

interface ChatState {
    messages: ChatMessage[];
    streamingText: string;
    streamingSongs: RecommendedSong[];
    streamingReply: StructuredReply | null;
    isStreaming: boolean;
    error: string | null;

    loadHistory: () => Promise<void>;
    send: (text: string) => void;
    abort: () => void;
    clear: () => void;
}

let currentAbort: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
    messages: [],
    streamingText: "",
    streamingSongs: [],
    streamingReply: null,
    isStreaming: false,
    error: null,

    loadHistory: async () => {
        try {
            const { messages } = await api.getChatMessages(50);
            if (messages.length > 0) {
                set({
                    messages: messages.map((m) => ({
                        id: m.id,
                        role: m.role as ChatMessage["role"],
                        text: m.text,
                        ts: m.ts,
                        songs: m.songs as RecommendedSong[] | undefined,
                        structured: m.structured as StructuredReply | undefined,
                    })),
                });
            }
        } catch (err) {
            console.warn("[chat] Failed to load history:", err);
        }
    },

    send: (text: string) => {
        const { isStreaming } = get();
        if (isStreaming) return;

        // Add user message
        const userMsg: ChatMessage = {
            id: `user_${Date.now()}`,
            role: "user",
            text,
            ts: Date.now(),
        };

        set((s) => ({
            messages: [...s.messages, userMsg],
            streamingText: "",
            streamingSongs: [],
            streamingReply: null,
            isStreaming: true,
            error: null,
        }));

        // Persist user message
        api.saveChatMessage({ id: userMsg.id, role: "user", text }).catch(() => {});

        // Try dispatch: first attempt non-streaming (command/search)
        (async () => {
            try {
                const res = await fetch("/api/dispatch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: text }),
                });

                if (!res.ok) {
                    set({ isStreaming: false, error: `Server error: ${res.status}` });
                    return;
                }

                const contentType = res.headers.get("content-type") ?? "";

                // JSON response = command or search
                if (contentType.includes("application/json")) {
                    const data = await res.json();
                    set({ isStreaming: false });

                    if (data.type === "command") {
                        useToastStore.getState().addToast(data.message || "已执行", "success");
                    } else if (data.type === "search" && data.results) {
                        // Show search results as AI message with songs
                        const songs: RecommendedSong[] = data.results.map((r: { id: string; title: string; artist: string; coverUrl?: string }) => ({
                            id: r.id,
                            songId: r.id,
                            title: r.title,
                            artist: r.artist,
                            coverUrl: r.coverUrl || `/api/song/cover?id=${encodeURIComponent(r.id)}`,
                            audioUrl: `/api/audio?id=${encodeURIComponent(r.id)}&title=${encodeURIComponent(r.title)}&artist=${encodeURIComponent(r.artist)}`,
                        }));
                        const aiMsg: ChatMessage = {
                            id: `ai_${Date.now()}`,
                            role: "ai",
                            text: `为你找到 ${songs.length} 首「${data.query}」相关的歌曲：`,
                            ts: Date.now(),
                            songs,
                        };
                        set((s) => ({
                            messages: [...s.messages, aiMsg],
                        }));
                        api.saveChatMessage({
                            id: aiMsg.id,
                            role: "ai",
                            text: aiMsg.text,
                            meta: aiMsg.songs,
                        }).catch(() => {});
                    }
                    return;
                }

                // SSE stream = chat response
                const reader = res.body?.getReader();
                if (!reader) {
                    set({ isStreaming: false });
                    return;
                }

                const decoder = new TextDecoder();
                let buffer = "";
                let collectedText = "";
                const collectedSongs: RecommendedSong[] = [];
                let structuredReply: StructuredReply | null = null;

                // Create abort controller for this stream
                const controller = new AbortController();
                currentAbort = controller;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    let currentEvent = "";

                    for (const line of lines) {
                        const trimmed = line.trim();

                        if (trimmed.startsWith("event:")) {
                            currentEvent = trimmed.slice(6).trim();
                            continue;
                        }

                        if (trimmed.startsWith("data:")) {
                            const jsonStr = trimmed.slice(5).trim();
                            try {
                                const data = JSON.parse(jsonStr);

                                switch (currentEvent) {
                                    case "status":
                                        if (data.phase === "thinking") {
                                            set({ streamingText: "🎵 正在为你挑选音乐..." });
                                        }
                                        break;

                                    case "chunk":
                                        collectedText += data.text;
                                        // Strip raw JSON code blocks AND bare JSON objects from display
                                        let displayText = collectedText
                                            .replace(/```json\s*[\s\S]*?```/g, "")
                                            .trim();
                                        // If text starts with { and likely contains JSON, hide it
                                        if (displayText.startsWith("{") && (displayText.includes('"say"') || displayText.includes('"play"'))) {
                                            displayText = "";
                                        }
                                        set({ streamingText: displayText || "🎵 正在为你挑选音乐..." });
                                        break;

                                    case "reply":
                                        structuredReply = data as StructuredReply;
                                        set({ streamingReply: structuredReply });
                                        // Speak segue if present
                                        if (structuredReply.segue) {
                                            speak(structuredReply.segue).catch(() => {});
                                        }
                                        break;

                                    case "item": {
                                        const item = data as QueueItem;
                                        if (item.type === "song") {
                                            const song: RecommendedSong = {
                                                id: item.id,
                                                songId: item.songId,
                                                title: item.title ?? "Unknown",
                                                artist: item.artist ?? "",
                                                coverUrl: item.coverUrl || `/api/song/cover?id=${encodeURIComponent(item.id)}`,
                                                reason: item.reason,
                                                audioUrl: item.audioUrl,
                                            };
                                            collectedSongs.push(song);
                                            set({ streamingSongs: [...collectedSongs] });
                                        }
                                        break;
                                    }

                                    case "done":
                                        // Finalize message
                                        break;

                                    case "error":
                                        set({ error: data.message });
                                        useToastStore.getState().addToast("AI 对话出错", "error");
                                        break;
                                }
                            } catch {
                                // Skip unparseable
                            }
                        }
                    }
                }

                // If no structured reply was received, try to parse collectedText as JSON
                if (!structuredReply) {
                    try {
                        const obj = JSON.parse(collectedText);
                        if (obj.say) structuredReply = obj;
                    } catch {
                        const jsonMatch = collectedText.match(/\{[\s\S]*"say"[\s\S]*\}/);
                        if (jsonMatch) {
                            try {
                                const obj = JSON.parse(jsonMatch[0]);
                                if (obj.say) structuredReply = obj;
                            } catch {}
                        }
                    }
                }

                // Build the final AI message
                const cleanedText = collectedText.replace(/```json\s*[\s\S]*?```/g, "").trim();
                const displayText = structuredReply?.say || cleanedText || "已为你生成播放列表";

                // Convert structured play to RecommendedSong if we have them
                const finalSongs = structuredReply?.play
                    ? structuredReply.play.map((s) => ({
                        id: s.id,
                        songId: s.id,
                        title: s.name,
                        artist: s.artist,
                        coverUrl: s.cover || `/api/song/cover?id=${encodeURIComponent(s.id)}`,
                        audioUrl: `/api/audio?id=${encodeURIComponent(s.id)}&title=${encodeURIComponent(s.name ?? "")}&artist=${encodeURIComponent(s.artist ?? "")}`,
                    }))
                    : collectedSongs;

                const aiMsg: ChatMessage = {
                    id: `ai_${Date.now()}`,
                    role: "ai",
                    text: displayText,
                    ts: Date.now(),
                    songs: finalSongs.length > 0 ? finalSongs : undefined,
                    structured: structuredReply ?? undefined,
                };

                set((s) => ({
                    messages: [...s.messages, aiMsg],
                    streamingText: "",
                    streamingSongs: [],
                    streamingReply: null,
                    isStreaming: false,
                }));

                // Persist AI message
                api.saveChatMessage({
                    id: aiMsg.id,
                    role: "ai",
                    text: aiMsg.text,
                    meta: { songs: aiMsg.songs, structured: aiMsg.structured },
                }).catch(() => {});
            } catch (err) {
                if ((err as Error).name !== "AbortError") {
                    set({
                        streamingText: "",
                        streamingSongs: [],
                        streamingReply: null,
                        isStreaming: false,
                        error: (err as Error).message,
                    });
                    useToastStore.getState().addToast("发送失败", "error");
                }
            }
        })();
    },

    abort: () => {
        currentAbort?.abort();
        currentAbort = null;

        const { streamingText, streamingSongs, streamingReply } = get();
        if (streamingText || streamingSongs.length > 0 || streamingReply) {
            const aiMsg: ChatMessage = {
                id: `ai_${Date.now()}`,
                role: "ai",
                text: streamingReply?.say || streamingText || "已中断",
                ts: Date.now(),
                songs: streamingSongs.length > 0 ? streamingSongs : undefined,
                structured: streamingReply ?? undefined,
            };
            set((s) => ({
                messages: [...s.messages, aiMsg],
                streamingText: "",
                streamingSongs: [],
                streamingReply: null,
                isStreaming: false,
            }));
        }
    },

    clear: () => {
        currentAbort?.abort();
        currentAbort = null;
        set({
            messages: [],
            streamingText: "",
            streamingSongs: [],
            streamingReply: null,
            isStreaming: false,
            error: null,
        });
    },
}));
