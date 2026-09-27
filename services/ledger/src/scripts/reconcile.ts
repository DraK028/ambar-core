import { ReconciliationService } from '../application/reconciliation.service';
import { loadDbConfig } from '../config';
import { createPoolFromConfig } from '../infrastructure/db';

/** Conciliación nocturna: sale con código 1 si hay descuadres (para alarmas en CloudWatch). */
async function main(): Promise<void> {
  const pool = createPoolFromConfig(loadDbConfig(), 2);
  try {
    const report = await new ReconciliationService(pool).run();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
