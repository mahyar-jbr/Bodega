import '../src/server/env';
import { closeDb, getDb } from '../src/shared/db';
import { seedDatabase } from '../src/store/seed';

async function main(): Promise<void> {
  const summary = await seedDatabase(getDb());
  console.log(
    `Seed complete: ${summary.stores} stores, ${summary.products} products, ${summary.codes} codes, ${summary.members} members`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`Seed failed: ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const details = error as Error & { code?: unknown; codeName?: unknown };
  const code = typeof details.code === 'number' || typeof details.code === 'string' ? ` ${details.code}` : '';
  const codeName = typeof details.codeName === 'string' ? ` (${details.codeName})` : '';
  const message = details.message
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted MongoDB URI]')
    .replace(/\/\/[^/@\s]+@/g, '//[redacted]@');
  return `${details.name}${code}${codeName}: ${message}`;
}
