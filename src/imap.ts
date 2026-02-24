import { ImapFlow } from 'imapflow';
import { config } from './config';

export async function createImapClient(): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: true,
    auth: {
      user: config.imap.user,
      pass: config.imap.pass,
    },
    logger: false,
  });

  await client.connect();
  return client;
}
