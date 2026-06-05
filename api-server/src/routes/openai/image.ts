import { Router } from "express";
import { GenerateOpenaiImageBody } from "@workspace/api-zod";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";

const router = Router();

// POST /openai/generate-image
router.post("/generate-image", async (req, res) => {
  const parsed = GenerateOpenaiImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const size = (parsed.data.size ?? "1024x1024") as
      | "1024x1024"
      | "1536x1024"
      | "1024x1536";
    const buffer = await generateImageBuffer(parsed.data.prompt, size as "1024x1024" | "512x512" | "256x256");
    res.json({ b64_json: buffer.toString("base64") });
  } catch (err) {
    req.log.error(err, "Failed to generate image");
    res.status(500).json({ error: "Failed to generate image" });
  }
});

export default router;
