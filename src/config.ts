import dotenv from 'dotenv';
dotenv.config();

interface Config {
  imap: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  port: number;
  apiToken: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: Config = {
  imap: {
    host: requireEnv('IMAP_HOST'),
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    user: requireEnv('IMAP_USER'),
    pass: requireEnv('IMAP_PASSWORD'),
  },
  port: parseInt(process.env.PORT || '3000', 10),
  apiToken: requireEnv('API_BEARER_TOKEN'),
};
