import { Router, type IRouter } from "express";
import {
  TranscribeAudioBody,
  GenerateReplyBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { speechToText } from "@workspace/integrations-openai-ai-server/audio";

const router: IRouter = Router();

router.post("/voicereply/transcribe", async (req, res) => {
  try {
    const body = TranscribeAudioBody.parse(req.body);
    const audioBuffer = Buffer.from(body.audio, "base64");

    const transcript = await speechToText(audioBuffer, (body.format as "wav" | "m4a" | "webm" | "mp4" | "mp3" | "ogg") ?? "wav");

    res.json({ transcript });
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: "Failed to transcribe audio" });
  }
});

router.post("/voicereply/generate-reply", async (req, res) => {
  try {
    const body = GenerateReplyBody.parse(req.body);

    const toneInstruction = body.tone === "formal"
      ? "Write in a formal, professional tone."
      : body.tone === "casual"
      ? "Write in a casual, relaxed tone."
      : "Write in a friendly, natural conversational tone.";

    const systemPrompt = `You are a smart reply assistant built into a messaging app. The user speaks their reply intent out loud, and you generate a clean, polished text message to send.

${toneInstruction}

Rules:
- Write as if the user is sending this message themselves — first-person, natural voice
- Keep it concise and human-sounding, not robotic or over-formal
- Do NOT add "Hi," greetings or sign-offs unless the user explicitly said them
- Fix grammar, punctuation and spelling
- Use the conversation history (if provided) to make the reply contextually relevant and specific
- Return ONLY the reply text itself — no explanation, no quotes, nothing else`;

    const contextPart = body.context
      ? `\n\nRecent conversation:\n${body.context}\n\nWhat the user said out loud (their reply intent):`
      : "\n\nWhat the user said out loud (their reply intent):";

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${contextPart}\n"${body.transcript}"` },
      ],
    });

    const reply = response.choices[0]?.message?.content?.trim() ?? "";
    res.json({ reply });
  } catch (err) {
    console.error("Generate reply error:", err);
    res.status(500).json({ error: "Failed to generate reply" });
  }
});

export default router;
