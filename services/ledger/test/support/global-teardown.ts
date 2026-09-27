export default async function globalTeardown(): Promise<void> {
  if (globalThis.__AMBAR_PG__) {
    await globalThis.__AMBAR_PG__.stop();
    globalThis.__AMBAR_PG__ = undefined;
  }
}
