import { usePlayerStore } from "../stores/playerStore";
import { useToastStore } from "../stores/toastStore";
import type { QueueItem } from "../api/client";

export interface SongCardProps {
  songId: string;
  title: string;
  artist: string;
  coverUrl?: string;
  album?: string;
  onPlay?: () => void;
  onAdd?: () => void;
  disabled?: boolean;
}

export default function SongCard({
  songId,
  title,
  artist,
  coverUrl,
  album,
  onPlay,
  onAdd,
  disabled,
}: SongCardProps) {
  const playItem = usePlayerStore((s) => s.playItem);
  const enqueueItems = usePlayerStore((s) => s.enqueueItems);
  const addToast = useToastStore((s) => s.addToast);

  const handlePlay = () => {
    if (disabled) return;
    if (onPlay) {
      onPlay();
      return;
    }
    const item: QueueItem = {
      id: `song_${songId}`,
      type: "song",
      songId,
      title,
      artist,
      coverUrl,
      audioUrl: `/api/audio?id=${encodeURIComponent(songId)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
      status: "pending",
    };
    playItem(item);
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (onAdd) {
      onAdd();
      return;
    }
    const item: QueueItem = {
      id: `song_${songId}`,
      type: "song",
      songId,
      title,
      artist,
      coverUrl,
      audioUrl: `/api/audio?id=${encodeURIComponent(songId)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
      status: "pending",
    };
    enqueueItems([item]);
    addToast("已添加到队列", "success");
  };

  return (
    <div
      className={`song-card-item ${disabled ? "disabled" : ""}`}
      onClick={handlePlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handlePlay()}
    >
      <div className="song-card-cover">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.dataset.retried) {
                img.dataset.retried = "1";
                fetch(`/api/song/cover?id=${encodeURIComponent(songId)}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((data) => {
                    if (data?.coverUrl) img.src = data.coverUrl;
                  })
                  .catch(() => {});
              }
            }}
          />
        ) : (
          <div className="song-card-cover-placeholder">♫</div>
        )}
        {disabled && (
          <div className="song-card-disabled-overlay">暂无音源</div>
        )}
      </div>
      <div className="song-card-info">
        <div className="song-card-title">{title}</div>
        <div className="song-card-artist">
          {artist}
          {album ? ` · ${album}` : ""}
        </div>
      </div>
      <div className="song-card-actions">
        <button
          className="song-card-btn play"
          onClick={handlePlay}
          disabled={disabled}
          title="播放"
        >
          ▶
        </button>
        <button
          className="song-card-btn add"
          onClick={handleAdd}
          disabled={disabled}
          title="添加到队列"
        >
          +
        </button>
      </div>
    </div>
  );
}
