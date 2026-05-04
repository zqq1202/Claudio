import type { FastifyInstance } from "fastify";
import { z } from "zod";

const DispatchSchema = z.object({
  message: z.string().min(1).max(500),
});

interface DispatchCommand {
  type: "command";
  action: string;
  message?: string;
}

const COMMAND_PATTERNS: Array<{ pattern: RegExp; action: string; reply: string }> = [
  { pattern: /下一首|切歌|next/i, action: "next", reply: "好的，切下一首~" },
  { pattern: /上一首|previous/i, action: "prev", reply: "回到上一首~" },
  { pattern: /暂停|pause/i, action: "pause", reply: "已暂停" },
  { pattern: /^播放$|^play$/i, action: "play", reply: "继续播放~" },
  { pattern: /随机(播放)?|shuffle/i, action: "shuffle", reply: "随机播放模式已开启" },
  { pattern: /循环|单曲循环|repeat/i, action: "repeat", reply: "循环播放模式已开启" },
];

function detectCommand(text: string): DispatchCommand | null {
  const trimmed = text.trim();
  for (const { pattern, action, reply } of COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "command", action, message: reply };
    }
  }
  return null;
}

function detectSearch(text: string): string | null {
  const match = text.match(/^(?:搜索|播放|找|来一首?|听)\s*(.+)/);
  if (match?.[1]) {
    return match[1].trim();
  }
  const match2 = text.match(/^(.+?)(?:的歌|的音乐)$/);
  if (match2?.[1]) {
    return match2[1].trim();
  }
  return null;
}

export async function dispatchRoutes(app: FastifyInstance) {
  // GET /api/song/cover?id=xxx — fetch cover URL by NCM song ID
  app.get<{ Querystring: { id: string } }>("/api/song/cover", async (request, reply) => {
    const { id } = request.query;
    if (!id) return reply.code(400).send({ error: "missing id" });
    try {
      const { ncm } = app.services;
      const detail = await ncm.getSongDetail(id);
      if (detail?.coverUrl) {
        return { coverUrl: detail.coverUrl };
      }
      return reply.code(404).send({ error: "not found" });
    } catch {
      return reply.code(500).send({ error: "search failed" });
    }
  });

  app.post<{ Body: { message: string } }>("/api/dispatch", async (request, reply) => {
    const { message } = DispatchSchema.parse(request.body);
    const trimmed = message.trim();

    // 1. Command fast-path
    const cmd = detectCommand(trimmed);
    if (cmd) {
      const { action } = cmd;
      try {
        if (action === "next") {
          await fetch(`http://localhost:${process.env.PORT ?? 8080}/api/player/next`, { method: "POST" });
        } else if (action === "prev") {
          await fetch(`http://localhost:${process.env.PORT ?? 8080}/api/player/previous`, { method: "POST" });
        } else if (action === "pause") {
          await fetch(`http://localhost:${process.env.PORT ?? 8080}/api/player/pause`, { method: "POST" });
        } else if (action === "play") {
          await fetch(`http://localhost:${process.env.PORT ?? 8080}/api/player/play`, { method: "POST" });
        }
      } catch (err) {
        console.error("[dispatch] player command failed:", err);
      }
      return reply.send({ type: "command", action: cmd.action, message: cmd.message });
    }

    // 2. Search fast-path
    const searchQuery = detectSearch(trimmed);
    if (searchQuery) {
      const { ncm } = app.services;
      const results = await ncm.search(searchQuery, 5);
      return reply.send({ type: "search", query: searchQuery, results });
    }

    // 3. Natural language -> Claude structured reply (SSE stream)
    const { claude, context, ncm } = app.services;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const contextStr = await context.buildContext(trimmed);
      sendEvent("status", { phase: "thinking" });

      const chatReply = await claude.generateChatReplyStream(
        trimmed,
        contextStr,
        (chunk: string) => {
          sendEvent("chunk", { text: chunk });
        }
      );

      // Enrich play songs with NCM search results (get audio URLs)
      if (chatReply.play && chatReply.play.length > 0) {
        for (const song of chatReply.play) {
          try {
            // Try artist + name first
            let results = await ncm.search(`${song.artist} ${song.name}`, 1);
            // Fallback: name only
            if (results.length === 0) {
              results = await ncm.search(song.name, 1);
            }
            if (results.length > 0) {
              song.id = results[0].id;
              song.cover = results[0].coverUrl;
            }
          } catch {
            // Keep original id if search fails
          }
        }
      }

      // Send structured reply as final event
      sendEvent("reply", chatReply);
      sendEvent("done", { totalItems: chatReply.play?.length ?? 0 });
    } catch (err) {
      console.error("[dispatch] Error:", err);
      sendEvent("error", { message: "抱歉，出了点问题，请再试一次" });
    } finally {
      reply.raw.end();
    }
  });
}
