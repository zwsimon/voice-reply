import { Router, type IRouter } from "express";
import healthRouter from "./health";
import voiceReplyRouter from "./voicereply";

const router: IRouter = Router();

router.use(healthRouter);
router.use(voiceReplyRouter);

export default router;
