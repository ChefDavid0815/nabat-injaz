declare global {
  var nabatLocalWorker: NodeJS.Timeout | undefined;
}
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    !process.env.DATABASE_URL &&
    process.env.NODE_ENV === 'development' &&
    !globalThis.nabatLocalWorker
  ) {
    const { runAnalysisBatch, overdueSweep } = await import('./server/analysis');
    const { ready } = await import('./server/db');
    let running = false,
      tick = 0;
    globalThis.nabatLocalWorker = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await ready();
        await runAnalysisBatch(3);
        if (tick++ % 30 === 0) await overdueSweep();
      } catch (e) {
        console.error(
          JSON.stringify({
            event: 'local-worker.error',
            error: e instanceof Error ? e.message : 'Unknown',
          }),
        );
      } finally {
        running = false;
      }
    }, 2000);
    globalThis.nabatLocalWorker.unref();
  }
}
