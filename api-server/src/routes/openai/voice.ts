import { Router } from "express";
import multer from "multer";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  try {
    const arrayBuffer = file.buffer.buffer.slice(
      file.buffer.byteOffset,
      file.buffer.byteOffset + file.buffer.byteLength
    ) as ArrayBuffer;
    const audioFile = new File([arrayBuffer], "recording.m4a", { type: file.mimetype || "audio/m4a" });

    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "json",
    });

    res.json({ transcript: response.text });
  } catch (err) {
    req.log.error(err, "Audio transcription failed");
    res.status(500).json({ error: "Transcription failed" });
  }
});

export default router;
