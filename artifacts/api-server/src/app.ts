import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    success: false,
    message: "Endpoint not found.",
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// Express 5 automatically forwards async route errors here.
// Never expose stack traces to clients.

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    req.log?.error({ err }, "Unhandled route error");
    if (!res.headersSent) {
      res.status(500).json({
        status: 500,
        success: false,
        message: "Internal server error.",
      });
    }
    logger.error({ message }, "Global error handler caught error");
  },
);

export default app;
