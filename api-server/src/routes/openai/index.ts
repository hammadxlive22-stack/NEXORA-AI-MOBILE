import { Router } from "express";
import conversationsRouter from "./conversations";
import imageRouter from "./image";
import voiceRouter from "./voice";

const router = Router();

router.use("/conversations", conversationsRouter);
router.use("/", imageRouter);
router.use("/", voiceRouter);

export default router;
