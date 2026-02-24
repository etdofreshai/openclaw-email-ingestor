import path from 'path';
import express from 'express';
import { config } from './config';
import mailboxesRouter from './routes/mailboxes';
import emailsRouter from './routes/emails';

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Bearer token auth for all /api routes (except health)
app.use('/api', (req, res, next) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${config.apiToken}`) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized — provide a valid Bearer token' });
});

app.use('/api/mailboxes', mailboxesRouter);
app.use('/api/emails', emailsRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});
