import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import authRouter from "./auth";
import teamRouter from "./team";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(authRouter);
router.use(teamRouter);

export default router;
