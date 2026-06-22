import { Router, type IRouter, type Request, type Response } from "express";
import { getStats } from "../lib/stats";

const router: IRouter = Router();

router.get("/stats", (_req: Request, res: Response) => {
  res.json(getStats());
});

export default router;
