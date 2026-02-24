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

app.get('/api/help', (_req, res) => {
  res.json({
    name: 'OpenClaw Email Ingestor API',
    description: 'Read-only API for browsing and searching Gmail via IMAP. All endpoints except /api/health and /api/help require a Bearer token in the Authorization header.',
    auth: {
      type: 'Bearer',
      header: 'Authorization: Bearer <API_BEARER_TOKEN>',
      note: 'Token is set via the API_BEARER_TOKEN environment variable.',
    },
    endpoints: [
      {
        method: 'GET',
        path: '/api/health',
        auth: false,
        description: 'Health check. Returns ok if the server is running. Does not test the IMAP connection.',
        params: {},
        returns: '{ status: "ok" }',
      },
      {
        method: 'GET',
        path: '/api/help',
        auth: false,
        description: 'This endpoint. Returns documentation for all available API endpoints.',
        params: {},
        returns: 'This object.',
      },
      {
        method: 'GET',
        path: '/api/mailboxes',
        auth: true,
        description: 'Lists all IMAP mailboxes (folders) on the connected Gmail account. Useful for discovering folder paths like "[Gmail]/All Mail" or "[Gmail]/Sent Mail".',
        params: {},
        returns: 'Array of mailbox objects, each with: path, name, delimiter, flags, listed, subscribed.',
      },
      {
        method: 'GET',
        path: '/api/emails',
        auth: true,
        description: 'Lists emails from a mailbox, paginated, newest first. Returns envelope data only (no body content) for fast responses.',
        params: {
          mailbox: { type: 'string', default: 'INBOX', description: 'IMAP mailbox path. Use "/api/mailboxes" to discover available paths.' },
          page: { type: 'number', default: 1, description: 'Page number (1-indexed).' },
          limit: { type: 'number', default: 20, min: 1, max: 50, description: 'Number of emails per page.' },
        },
        returns: '{ messages: [{ uid, flags, date, subject, from, to }], total, page, limit }',
      },
      {
        method: 'GET',
        path: '/api/emails/search',
        auth: true,
        description: 'Searches emails using Gmail\'s native search engine (X-GM-RAW). Supports the same query syntax as the Gmail web UI. Results are paginated, newest first. Defaults to searching All Mail.',
        params: {
          q: { type: 'string', required: true, description: 'Search query. Plain words search everything. Supports Gmail operators: from:, to:, subject:, has:attachment, before:, after:, label:, is:unread, etc.' },
          mailbox: { type: 'string', default: '[Gmail]/All Mail', description: 'Mailbox to search within. The mailbox constraint is added to the Gmail query automatically (e.g. INBOX becomes "in:inbox <query>").' },
          page: { type: 'number', default: 1, description: 'Page number (1-indexed).' },
          limit: { type: 'number', default: 20, min: 1, max: 50, description: 'Number of emails per page.' },
        },
        searchExamples: [
          { query: 'invoice', description: 'Find all emails containing "invoice" anywhere.' },
          { query: 'from:alice@example.com', description: 'Emails from a specific sender.' },
          { query: 'from:alice subject:meeting', description: 'From alice AND subject contains meeting.' },
          { query: 'has:attachment filename:pdf', description: 'Emails with PDF attachments.' },
          { query: 'after:2024/01/01 before:2024/06/01', description: 'Emails within a date range.' },
          { query: 'is:unread', description: 'All unread emails.' },
        ],
        returns: '{ messages: [{ uid, flags, date, subject, from, to }], total, page, limit, query }',
      },
      {
        method: 'GET',
        path: '/api/emails/:uid',
        auth: true,
        description: 'Fetches a single email by its UID, including the full parsed body (plain text and HTML), CC field, and attachment metadata. Use a UID from the list or search endpoints.',
        params: {
          uid: { type: 'number', required: true, in: 'path', description: 'The email UID (unique identifier within the mailbox).' },
          mailbox: { type: 'string', default: 'INBOX', description: 'Mailbox the email lives in. Must match where the UID came from.' },
        },
        returns: '{ uid, flags, date, subject, from, to, cc, textBody, htmlBody, attachments: [{ filename, size, contentType }] }',
      },
    ],
  });
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
