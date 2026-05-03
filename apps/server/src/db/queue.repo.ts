import { getDb } from "./db.js";

export interface QueueItemRow {
  id: string;
  type: string;
  song_id: string | null;
  tts_text: string | null;
  audio_url: string | null;
  reason: string | null;
  sort_order: number;
  status: string;
}

export function getQueueItems(): QueueItemRow[] {
  return getDb()
    .prepare("SELECT * FROM queue_items ORDER BY sort_order ASC")
    .all() as QueueItemRow[];
}

export function replaceQueue(items: Array<{
  id: string;
  type: string;
  songId?: string;
  text?: string;
  audioUrl?: string;
  reason?: string;
  status?: string;
}>): void {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM queue_items");
  const insertStmt = db.prepare(
    "INSERT INTO queue_items (id, type, song_id, tts_text, audio_url, reason, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const txn = db.transaction(() => {
    deleteStmt.run();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      insertStmt.run(
        item.id,
        item.type,
        item.songId ?? null,
        item.text ?? null,
        item.audioUrl ?? null,
        item.reason ?? null,
        i,
        item.status ?? "pending"
      );
    }
  });
  txn();
}
