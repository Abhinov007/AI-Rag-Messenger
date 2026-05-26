import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

import aiRouter from './routes/ai.js';

dotenv.config();

const host = process.env.BACKEND_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.BACKEND_PORT?.trim() || '8000');

const app = express();

app.use(
  cors({
    origin: true,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.use(aiRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled backend error:', error);
  response.status(500).json({
    detail: 'Internal server error.',
  });
});

app.listen(port, host, () => {
  console.log(`AIRagMessenger backend listening on http://${host}:${port}`);
});
