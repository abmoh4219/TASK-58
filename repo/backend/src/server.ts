import dotenv from 'dotenv';

import { buildApp } from './app';

dotenv.config();

const app = buildApp();
const port = Number(process.env.BACKEND_PORT || 4000);
const host = process.env.BACKEND_HOST || '0.0.0.0';

async function start() {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
