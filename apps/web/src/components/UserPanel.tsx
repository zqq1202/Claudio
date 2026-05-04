import { useEffect, useState } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { api } from "../api/client";
import type { FavoriteItem, RecentPlay } from "../api/client";
import SlideUpPanel from "./SlideUpPanel";

interface UserPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function UserPanel({ visible, onClose }: UserPanelProps) {
  const favoriteIds = usePlayerStore((s) => s.favoriteIds);
  const playItem = usePlayerStore((s) => s.playItem);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<RecentPlay[]>([]);

  useEffect(() => {
    if (!visible) return;
    api
      .getFavorites()
      .then((res) => setFavorites(res.favorites ?? []))
      .catch(() => {});
    api
      .getRecentPlays(10)
      .then((res) => setHistory(res.plays ?? []))
      .catch(() => {});
  }, [visible, favoriteIds.length]);

  const handlePlayFavorite = (fav: FavoriteItem) => {
    if (!fav.songId) return;
    playItem({
      id: fav.songId,
      type: "song",
      songId: fav.songId,
      title: fav.title ?? "Unknown",
      artist: fav.artist ?? undefined,
      coverUrl: fav.coverUrl ?? undefined,
      status: "pending",
    });
    onClose();
  };

  const handlePlayHistory = (item: RecentPlay) => {
    if (!item.songId) return;
    playItem({
      id: item.songId,
      type: "song",
      songId: item.songId,
      title: item.title ?? "Unknown",
      artist: item.artist ?? undefined,
      coverUrl: item.coverUrl ?? undefined,
      status: "pending",
    });
    onClose();
  };

  return (
    <SlideUpPanel visible={visible} onClose={onClose} title="Your Library">
      <div className="user-panel-header">
        <div className="user-panel-avatar">U</div>
        <div>
          <div className="user-panel-name">Listener</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {favoriteIds.length} favorites
          </div>
        </div>
      </div>

      <div className="user-panel-section">
        <div className="user-panel-section-title">Favorites</div>
        {favorites.length === 0 ? (
          <div className="user-panel-empty">No favorites yet</div>
        ) : (
          favorites.slice(0, 10).map((fav) => (
            <div
              key={fav.songId}
              className="user-panel-item"
              onClick={() => handlePlayFavorite(fav)}
            >
              <div className="user-panel-item-cover">
                {fav.coverUrl ? (
                  <img src={fav.coverUrl} alt={fav.title ?? ""} loading="lazy" />
                ) : (
                  <div className="user-panel-item-cover-fallback">♫</div>
                )}
              </div>
              <div className="user-panel-item-info">
                <div className="user-panel-item-title">{fav.title ?? "Unknown"}</div>
                <div className="user-panel-item-artist">{fav.artist}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="user-panel-section">
        <div className="user-panel-section-title">Recently Played</div>
        {history.length === 0 ? (
          <div className="user-panel-empty">No play history yet</div>
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              className="user-panel-item"
              onClick={() => handlePlayHistory(item)}
            >
              <div className="user-panel-item-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt={item.title ?? ""} loading="lazy" />
                ) : (
                  <div className="user-panel-item-cover-fallback">♫</div>
                )}
              </div>
              <div className="user-panel-item-info">
                <div className="user-panel-item-title">{item.title ?? "Unknown"}</div>
                <div className="user-panel-item-artist">{item.artist}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </SlideUpPanel>
  );
}
