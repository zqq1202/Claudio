import { useEffect, useRef } from "react";
import { useChatStore, type ChatMessage, type RecommendedSong } from "../stores/chatStore";
import { usePlayerStore } from "../stores/playerStore";
import type { QueueItem, StructuredReply } from "../api/client";
import SongCard from "./SongCard";
import { speak } from "../utils/voiceSynth";

export default function ChatArea() {
    const { messages, streamingText, streamingSongs, streamingReply, isStreaming, error } = useChatStore();
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, streamingText, streamingSongs, streamingReply]);

    return (
        <div className="chat-area">
            <div className="chat-messages" ref={containerRef}>
                {messages.length === 0 && !streamingText && (
                    <div className="chat-welcome">
                        <div className="chat-welcome-avatar">🎵</div>
                        <div className="chat-welcome-title">Hey, 我是 Claudio</div>
                        <div className="chat-welcome-desc">
                            你的私人 AI 音乐助手，告诉我你现在想听什么～
                        </div>
                        <div className="chat-welcome-hints">
                            <ChatHint text="来点轻松的音乐" />
                            <ChatHint text="推荐几首适合写代码的歌" />
                            <ChatHint text="今天心情不太好，想听点治愈的" />
                            <ChatHint text="来点周杰伦的歌" />
                        </div>
                    </div>
                )}

                {messages.map((msg) => (
                    <ChatBubble key={msg.id} message={msg} />
                ))}

                {/* Streaming AI response */}
                {isStreaming && (streamingText || streamingSongs.length > 0 || streamingReply) && (
                    <div className="chat-bubble ai">
                        <div className="chat-avatar ai">🎵</div>
                        <div className="chat-content">
                            {streamingReply ? (
                                <StructuredContent reply={streamingReply} songs={streamingSongs} isStreaming />
                            ) : (
                                <>
                                    {streamingText && (
                                        <div className="chat-text streaming">
                                            {streamingText}
                                            <span className="stream-cursor">▊</span>
                                        </div>
                                    )}
                                    {streamingSongs.length > 0 && (
                                        <div className="song-cards">
                                            {streamingSongs.map((song, i) => (
                                                <LegacySongCard key={song.id} song={song} index={i} isStreaming />
                                            ))}
                                            <div className="song-cards-loading">正在搜索更多歌曲...</div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Error message */}
                {error && (
                    <div className="chat-bubble system-error">
                        <div className="chat-text">⚠️ {error}</div>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>
        </div>
    );
}

function ChatBubble({ message }: { message: ChatMessage }) {
    const isUser = message.role === "user";
    const isDj = message.role === "dj";

    return (
        <div className={`chat-bubble ${message.role}`}>
            {isUser ? (
                <>
                    <div className="chat-content">
                        <div className="chat-text">{message.text}</div>
                    </div>
                    <div className="chat-avatar user">U</div>
                </>
            ) : isDj ? (
                <>
                    <div className="chat-avatar dj">🎧</div>
                    <div className="chat-content">
                        <div className="chat-text">{message.text}</div>
                    </div>
                </>
            ) : (
                <>
                    <div className="chat-avatar ai">🎵</div>
                    <div className="chat-content">
                        {message.structured ? (
                            <StructuredContent
                                reply={message.structured}
                                songs={message.songs}
                            />
                        ) : (
                            <>
                                <div className="chat-text">{message.text}</div>
                                {message.songs && message.songs.length > 0 && (
                                    <div className="song-cards">
                                        {message.songs.map((song, i) => (
                                            <LegacySongCard key={song.id} song={song} index={i} />
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

/** Renders structured reply: say text, reason, segue, and SongCard list */
function StructuredContent({
    reply,
    songs,
    isStreaming,
}: {
    reply: StructuredReply;
    songs?: RecommendedSong[];
    isStreaming?: boolean;
}) {
    const playItem = usePlayerStore((s) => s.playItem);

    // Convert structured play to RecommendedSong for SongCard
    const playSongs: RecommendedSong[] = reply.play
        ? reply.play.map((s) => ({
            id: s.id,
            songId: s.id,
            title: s.name,
            artist: s.artist,
            coverUrl: s.cover,
            audioUrl: `/api/audio?id=${encodeURIComponent(s.id)}&title=${encodeURIComponent(s.name ?? "")}&artist=${encodeURIComponent(s.artist ?? "")}`,
        }))
        : [];

    // Use provided songs (from enrichment) if available, otherwise use structured play
    const displaySongs = songs && songs.length > 0 ? songs : playSongs;

    return (
        <>
            {/* Text: say + reason */}
            {reply.say && (
                <div className="chat-text">
                    {reply.say}
                    {isStreaming && <span className="stream-cursor">▊</span>}
                </div>
            )}
            {reply.reason && (
                <div className="chat-reason">{reply.reason}</div>
            )}

            {/* Voice: segue waveform bar */}
            {reply.segue && (
                <div
                    className="chat-segue"
                    onClick={() => speak(reply.segue!)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).click()}
                >
                    <span className="segue-icon">🎙️</span>
                    <div className="segue-waveform">
                        <span /><span /><span /><span /><span />
                        <span /><span /><span /><span /><span />
                    </div>
                    <span className="segue-label">DJ 语音</span>
                </div>
            )}

            {/* Songs: SongCard list */}
            {displaySongs.length > 0 && (
                <div className="song-cards">
                    {displaySongs.map((song) => (
                        <SongCard
                            key={song.id}
                            songId={song.songId ?? song.id}
                            title={song.title}
                            artist={song.artist}
                            coverUrl={song.coverUrl}
                        />
                    ))}
                    {isStreaming && (
                        <div className="song-cards-loading">正在搜索更多歌曲...</div>
                    )}
                </div>
            )}
        </>
    );
}

function ChatHint({ text }: { text: string }) {
    const send = useChatStore((s) => s.send);
    const isStreaming = useChatStore((s) => s.isStreaming);

    return (
        <button
            className="chat-hint"
            onClick={() => send(text)}
            disabled={isStreaming}
        >
            {text}
        </button>
    );
}

/** Legacy song card for backward compatibility with old messages */
function LegacySongCard({ song, index, isStreaming }: { song: RecommendedSong; index: number; isStreaming?: boolean }) {
    const playItem = usePlayerStore((s) => s.playItem);

    const handleClick = () => {
        const sid = song.songId ?? song.id;
        if (!sid) return;
        const item: QueueItem = {
            id: song.id,
            type: "song",
            songId: sid,
            title: song.title,
            artist: song.artist,
            coverUrl: song.coverUrl,
            audioUrl: song.audioUrl || `/api/audio?id=${encodeURIComponent(sid)}&title=${encodeURIComponent(song.title ?? "")}&artist=${encodeURIComponent(song.artist ?? "")}`,
            status: "pending",
        };
        playItem(item);
    };

    return (
        <div
            className={`song-card ${isStreaming ? "streaming" : ""}`}
            style={{ animationDelay: `${index * 80}ms` }}
            onClick={handleClick}
        >
            <div className="song-card-cover">
                {song.coverUrl ? (
                    <img src={song.coverUrl} alt={song.title} loading="lazy" />
                ) : (
                    <div className="song-card-cover-placeholder">♫</div>
                )}
                <div className="song-card-play-overlay">▶</div>
            </div>
            <div className="song-card-info">
                <div className="song-card-title">{song.title}</div>
                <div className="song-card-artist">{song.artist}</div>
                {song.reason && (
                    <div className="song-card-reason">💡 {song.reason}</div>
                )}
            </div>
        </div>
    );
}
