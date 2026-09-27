import { loadDbConfig } from '../config';
import { createPoolFromConfig } from './db';
import { runMigrations } from './migrate';

/** En ECS corre como tarea única (familia ledger-migrate) antes de cada despliegue. */
async function main(): Promise<void> {
  const pool = createPoolFromConfig(loadDbConfig(), 1);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'La base ya está al día.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
