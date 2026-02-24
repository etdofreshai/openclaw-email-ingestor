import { Router, Request, Response } from 'express';
import { simpleParser } from 'mailparser';
import { SearchObject } from 'imapflow';
import { createImapClient } from '../imap';

const router = Router();

function formatMessage(msg: any) {
  return {
    uid: msg.uid,
    flags: Array.from(msg.flags || []),
    date: msg.envelope?.date,
    subject: msg.envelope?.subject,
    from: msg.envelope?.from,
    to: msg.envelope?.to,
  };
}

// Converts our search query into a Gmail raw search string (X-GM-RAW).
// Gmail's native search is far more reliable than standard IMAP SEARCH.
// Uses the same syntax as the Gmail web UI search bar.
//
// Syntax:
//   plain words        → searches everything (Gmail default)
//   from:word          → matches sender
//   from:"multi word"  → matches sender (quoted)
//   to:word            → matches recipient
//   subject:word       → matches subject line
//   body:word          → matches message body
//   cc:word            → matches CC field
//
// Multiple terms are ANDed together.
// Example: "from:alice subject:invoice hello"
//   → Gmail search: "from:alice subject:invoice hello"
// Maps IMAP mailbox paths to Gmail search operators
const MAILBOX_TO_GMAIL: Record<string, string> = {
  'INBOX': 'in:inbox',
  '[Gmail]/Sent Mail': 'in:sent',
  '[Gmail]/Drafts': 'in:drafts',
  '[Gmail]/Spam': 'in:spam',
  '[Gmail]/Trash': 'in:trash',
  '[Gmail]/Starred': 'is:starred',
  '[Gmail]/Important': 'is:important',
  // [Gmail]/All Mail → no filter (search everything)
};

function buildGmailSearch(raw: string, mailbox: string): SearchObject {
  const gmailQuery = raw.replace(/\bbody:/gi, '');
  const mailboxFilter = MAILBOX_TO_GMAIL[mailbox];
  const fullQuery = mailboxFilter ? `${mailboxFilter} ${gmailQuery}` : gmailQuery;
  return { gmraw: fullQuery };
}

// GET /api/emails/search — must be registered before :uid
router.get('/search', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const mailbox = (req.query.mailbox as string) || '[Gmail]/All Mail';
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

  if (!query) {
    res.status(400).json({ error: 'Missing required query parameter: q' });
    return;
  }

  const searchCriteria = buildGmailSearch(query, mailbox);

  const client = await createImapClient();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      // Try Gmail native search first, fall back to standard IMAP TEXT
      let result = await client.search(searchCriteria, { uid: true });
      let usedQuery: any = searchCriteria;

      if (!result || (Array.isArray(result) && result.length === 0)) {
        const fallback: SearchObject = { text: query };
        result = await client.search(fallback, { uid: true });
        usedQuery = fallback;
      }

      const allUids = Array.isArray(result) ? result : [];
      const total = allUids.length;

      if (!total) {
        res.json({ messages: [], total: 0, page, limit, query: usedQuery });
        return;
      }

      // UIDs come back oldest-first; reverse so newest matches are first
      allUids.reverse();

      // Slice to the requested page
      const start = (page - 1) * limit;
      const pageUids = allUids.slice(start, start + limit);

      if (!pageUids.length) {
        res.json({ messages: [], total, page, limit, query: usedQuery });
        return;
      }

      const messages = [];
      for await (const msg of client.fetch(pageUids, {
        envelope: true,
        flags: true,
        uid: true,
      }, { uid: true })) {
        messages.push(formatMessage(msg));
      }

      // Sort newest first (fetch may not preserve order)
      messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({ messages, total, page, limit, query: usedQuery });
    } finally {
      lock.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.logout();
  }
});

// GET /api/emails/:uid — single email with full body
router.get('/:uid', async (req: Request<{ uid: string }>, res: Response) => {
  const uid = parseInt(req.params.uid, 10);
  const mailbox = (req.query.mailbox as string) || 'INBOX';

  if (isNaN(uid)) {
    res.status(400).json({ error: 'Invalid UID' });
    return;
  }

  const client = await createImapClient();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const message = await client.fetchOne(
        String(uid),
        { envelope: true, flags: true, source: true, uid: true },
        { uid: true }
      );

      if (!message || !message.source) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      const parsed = await simpleParser(message.source, {});

      res.json({
        uid: message.uid,
        flags: Array.from(message.flags || []),
        date: message.envelope?.date,
        subject: message.envelope?.subject,
        from: message.envelope?.from,
        to: message.envelope?.to,
        cc: message.envelope?.cc,
        textBody: parsed.text || null,
        htmlBody: parsed.html || null,
        attachments: (parsed.attachments || []).map((att: { filename?: string; size: number; contentType: string }) => ({
          filename: att.filename,
          size: att.size,
          contentType: att.contentType,
        })),
      });
    } finally {
      lock.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.logout();
  }
});

// GET /api/emails — list emails, paginated, newest first
router.get('/', async (req: Request, res: Response) => {
  const mailbox = (req.query.mailbox as string) || 'INBOX';
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

  const client = await createImapClient();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const mailboxInfo = client.mailbox;
      const total = mailboxInfo && typeof mailboxInfo === 'object' ? (mailboxInfo.exists ?? 0) : 0;

      if (total === 0) {
        res.json({ messages: [], total: 0, page, limit });
        return;
      }

      // Calculate sequence range (newest first)
      const end = total - (page - 1) * limit;
      const start = Math.max(1, end - limit + 1);

      if (end < 1) {
        res.json({ messages: [], total, page, limit });
        return;
      }

      const range = `${start}:${end}`;
      const messages = [];

      for await (const msg of client.fetch(range, {
        envelope: true,
        flags: true,
        uid: true,
      })) {
        messages.push(formatMessage(msg));
      }

      // Reverse so newest is first
      messages.reverse();

      res.json({ messages, total, page, limit });
    } finally {
      lock.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.logout();
  }
});

export default router;
