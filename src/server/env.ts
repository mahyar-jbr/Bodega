// Loads .env from the repo root when the file exists (local development). Render has no
// .env: its settings are already in the environment. A variable that is already set,
// even to an empty value, wins over the file.
// src/server/index.ts imports this first, so every module after it sees the settings.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
