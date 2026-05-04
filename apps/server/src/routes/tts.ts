import type { FastifyInstance } from "fastify";

export async function ttsRoutes(app: FastifyInstance) {
  app.post<{ Body: { text: string } }>("/api/tts", async (request, reply) => {
    const { text } = request.body as { text: string };
    if (!text || text.trim().length === 0) {
      return reply.code(400).send({ error: "missing text" });
    }
    if (text.length > 500) {
      return reply.code(400).send({ error: "text too long (max 500)" });
    }

    try {
      const { tts } = app.services;
      const audioUrl = await tts.synthesize(text.trim());
      if (!audioUrl) {
        return reply.code(503).send({ error: "TTS service unavailable" });
      }
      return { audioUrl };
    } catch (err) {
      app.log.error(err, "[tts] synthesis failed");
      return reply.code(500).send({ error: "TTS synthesis failed" });
    }
  });
}
