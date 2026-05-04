import { useEffect, useState, useRef, useCallback } from "react";
import { api, type FullProfileResponse, type ProfilePreferences } from "../api/client";
import { useI18n } from "../i18n/context";

/* ── helpers ── */
const toText = (arr: string[]) => arr.join(", ");
const fromText = (s: string) =>
  s.split(/[,，、;/\n]\s*/).map((v) => v.trim()).filter(Boolean);

export default function ProfilePage() {
  const [data, setData] = useState<FullProfileResponse | null>(null);
  const [prefs, setPrefs] = useState<ProfilePreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const { t } = useI18n();

  useEffect(() => {
    api.getFullProfile().then((d) => {
      setData(d);
      setPrefs(d.preferences);
    }).catch((err) => {
      console.error(err);
      setError(true);
    });
  }, []);

  // Auto-save with debounce
  const autoSave = useCallback(async (newPrefs: ProfilePreferences) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.updateProfilePreferences(newPrefs);
      } catch (err) {
        console.error("Auto-save failed:", err);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, []);

  const updatePrefs = (patch: Partial<ProfilePreferences>) => {
    if (!prefs) return;
    const newPrefs = { ...prefs, ...patch };
    setPrefs(newPrefs);
    autoSave(newPrefs);
  };

  if (!data || !prefs) {
    return (
      <div className="main-inner">
        <div className="profile-card">
          <div className="profile-header">
            <div className="profile-avatar"><span style={{ fontSize: 28 }}>🎵</span></div>
            <div className="profile-name-block">
              <div className="profile-name">Claudio</div>
            </div>
          </div>
          <div className="profile-desc">{t("profileSubtitle")}</div>
          <div className="profile-section">
            <div className="empty-state">{error ? t("emptyProfile") : t("loading")}</div>
          </div>
        </div>
      </div>
    );
  }

  const { stats, dailyRecommendations } = data;
  const hasData = stats.totalPlays > 0;
  const maxCount = Math.max(...stats.topArtists.map((a) => a.count), 1);

  return (
    <div className="main-inner">
      <div className="ambient-mesh">
        <div className="ambient-blob ambient-blob-1" />
        <div className="ambient-blob ambient-blob-2" />
        <div className="ambient-blob ambient-blob-3" />
      </div>
      <div className="profile-card">
        {/* Header */}
        <div className="profile-header">
          <div className="profile-avatar">
            <span style={{ fontSize: 28 }}>🎵</span>
          </div>
          <div className="profile-name-block">
            <div className="profile-name">Claudio</div>
            <div className="profile-status">
              <span className="dj-status-dot" />
              {t("iSpinOnBoot")}
              {saving && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.5 }}>· saving…</span>}
            </div>
          </div>
        </div>

        <div className="profile-desc">{t("profileSubtitle")}</div>

        {/* ===== Music Profile Stats ===== */}
        <div className="profile-section">
          <div className="profile-section-title">{t("musicProfile")}</div>

          <div className="profile-stats">
            <div className="stat-cell">
              <div className="stat-value">{stats.totalPlays}</div>
              <div className="stat-label">{t("totalPlays")}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-value">{stats.totalMinutes}</div>
              <div className="stat-label">{t("totalMinutes")}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-value">{stats.favoriteCount}</div>
              <div className="stat-label">{t("favoriteCount")}</div>
            </div>
          </div>

          {!hasData && <div className="empty-state">{t("emptyProfile")}</div>}

          {/* Top Artists */}
          {stats.topArtists.length > 0 && (
            <div className="profile-subsection">
              <div className="profile-subsection-title">{t("topArtists")}</div>
              {stats.topArtists.slice(0, 5).map((a, i) => (
                <div key={a.name} className="artist-row">
                  <span className="artist-rank">{i + 1}</span>
                  <span className="artist-name">{a.name}</span>
                  <div className="artist-bar">
                    <div className="artist-bar-fill" style={{ width: `${(a.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="artist-count">{a.count}x</span>
                </div>
              ))}
            </div>
          )}

          {/* Mood Distribution */}
          {Object.keys(stats.moodPreference).length > 0 && (
            <div className="profile-subsection">
              <div className="profile-subsection-title">{t("mood")}</div>
              {Object.entries(stats.moodPreference).map(([mood, pct]) => (
                <div key={mood} className="bar-row">
                  <span className="bar-label">{mood}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-value">{pct}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent Themes */}
          {stats.recentThemes.length > 0 && (
            <div className="profile-subsection">
              <div className="profile-subsection-title">{t("recentThemes")}</div>
              <div className="tag-pills">
                {stats.recentThemes.map((th) => (
                  <span key={th} className="tag-pill">{th}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== Editable Preferences (auto-save) ===== */}
        <div className="profile-section">
          <div className="profile-section-title">
            {t("myPreferences")}
            {saving && <span className="pref-saving-hint">saving…</span>}
          </div>

          <div className="pref-section">
            <div className="pref-section-label">🎵 {t("favoriteGenres")}</div>
            <textarea
              className="pref-textarea"
              value={toText(prefs.favoriteGenres)}
              onChange={(e) => updatePrefs({ favoriteGenres: fromText(e.target.value) })}
              placeholder="Pop, Jazz, R&B, Hip-Hop…"
              rows={1}
            />
          </div>

          <div className="pref-section">
            <div className="pref-section-label">🚫 {t("dislikedGenres")}</div>
            <textarea
              className="pref-textarea"
              value={toText(prefs.dislikedGenres)}
              onChange={(e) => updatePrefs({ dislikedGenres: fromText(e.target.value) })}
              placeholder="Heavy Metal, Hardstyle…"
              rows={1}
            />
          </div>

          <div className="pref-section">
            <div className="pref-section-label">🎧 {t("preferredScenes")}</div>
            <textarea
              className="pref-textarea"
              value={toText(prefs.preferredScenes)}
              onChange={(e) => updatePrefs({ preferredScenes: fromText(e.target.value) })}
              placeholder="学习, 睡前, 开车, 运动…"
              rows={1}
            />
          </div>

          <div className="pref-section">
            <div className="pref-section-label">💆 {t("preferredMoods")}</div>
            <textarea
              className="pref-textarea"
              value={toText(prefs.preferredMoods)}
              onChange={(e) => updatePrefs({ preferredMoods: fromText(e.target.value) })}
              placeholder="放松, 治愈, 活力, 忧郁…"
              rows={1}
            />
          </div>

          <div className="pref-section">
            <div className="pref-section-label">📝 {t("userNote")}</div>
            <textarea
              className="pref-textarea pref-textarea-note"
              value={prefs.userNote}
              onChange={(e) => updatePrefs({ userNote: e.target.value })}
              placeholder="其他想让小音知道的偏好…"
              rows={2}
            />
          </div>
        </div>

        {/* ===== Daily Recommendation History ===== */}
        <div className="profile-section">
          <div className="profile-section-title">{t("dailyHistory")}</div>
          {dailyRecommendations.length === 0 ? (
            <div className="empty-state">{t("noRecommendations")}</div>
          ) : (
            <div className="daily-rec-list">
              {dailyRecommendations.slice(-7).reverse().map((rec) => (
                <div key={rec.date} className="daily-rec-item">
                  <div className="daily-rec-date">{rec.date}</div>
                  <div className="daily-rec-count">{rec.songIds.length} songs</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
