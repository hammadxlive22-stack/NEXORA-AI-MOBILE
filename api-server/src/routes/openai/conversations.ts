import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateOpenaiConversationBody,
  SendOpenaiMessageBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

// GET /openai/conversations — list all conversations
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(conversations)
      .orderBy(conversations.createdAt);
    res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list conversations");
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

// POST /openai/conversations — create new conversation
router.post("/", async (req, res) => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [row] = await db
      .insert(conversations)
      .values({ title: parsed.data.title })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err, "Failed to create conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// GET /openai/conversations/:id — get conversation with messages
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json({ ...conv, messages: msgs });
  } catch (err) {
    req.log.error(err, "Failed to get conversation");
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

// DELETE /openai/conversations/:id — delete conversation
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete conversation");
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// GET /openai/conversations/:id/messages — list messages
router.get("/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json(msgs);
  } catch (err) {
    req.log.error(err, "Failed to list messages");
    res.status(500).json({ error: "Failed to list messages" });
  }
});

// POST /openai/conversations/:id/messages — send message, stream response
router.post("/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = SendOpenaiMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Save user message
    await db.insert(messages).values({
      conversationId: id,
      role: "user",
      content: parsed.data.content,
    });

    // Fetch history for context
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Prepend Nexora system prompt
    chatMessages.unshift({
      role: "system",
      content:
        "You are Nexora AI — the world's most powerful and knowledgeable AI assistant. " +
        "You know everything about science, technology, history, culture, mathematics, medicine, law, philosophy, art, sports, current events, coding, and every other domain of human knowledge. " +
        "You answer every question with depth, accuracy, and clarity. You are fast, helpful, honest, and brilliant. " +
        "When you don't know something, say so honestly. Always respond in the same language the user writes in. " +
        "Your name is Nexora AI. Never claim to be ChatGPT, GPT, or any other AI.",
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // Save assistant response
    await db.insert(messages).values({
      conversationId: id,
      role: "assistant",
      content: fullResponse,
    });

    // Auto-update conversation title if it's still default
    if (conv.title === "New Conversation" && parsed.data.content.length > 0) {
      const titleStream = await openai.chat.completions.create({
        model: "gpt-5-nano",
        max_completion_tokens: 20,
        messages: [
          {
            role: "user",
            content: `Generate a short 3-5 word title for this conversation. Message: "${parsed.data.content.slice(0, 100)}". Reply with ONLY the title, nothing else.`,
          },
        ],
        stream: false,
      });
      const newTitle =
        titleStream.choices[0]?.message?.content?.trim() ?? conv.title;
      if (newTitle && newTitle !== conv.title) {
        await db
          .update(conversations)
          .set({ title: newTitle })
          .where(eq(conversations.id, id));
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error(err, "Failed to send message");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to send message" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
});

export default router;
