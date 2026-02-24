import { Router, Request, Response } from 'express';
import { createImapClient } from '../imap';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const client = await createImapClient();
  try {
    const mailboxes = await client.list();
    const result = mailboxes.map((mb) => ({
      path: mb.path,
      name: mb.name,
      delimiter: mb.delimiter,
      flags: Array.from(mb.flags || []),
      listed: mb.listed,
      subscribed: mb.subscribed,
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.logout();
  }
});

export default router;
