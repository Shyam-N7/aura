// Process-level safety net, registered once at the entry point (serverless +
// local dev). Express 4 does not forward async-handler rejections to error
// middleware, and background emitters can surface errors out-of-band; without a
// guard an unhandled rejection or uncaught exception terminates the process
// (Node 20 defaults to --unhandled-rejections=throw), failing the in-flight
// request AND any others sharing the warm instance. We log and survive instead —
// the route-level error middleware handles per-request failures cleanly; this is
// the last-resort backstop so a stray rejection can't take the instance down.
// (security: #25 / #26)

let installed = false;

export function installProcessGuards() {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    console.error(
      '[process] unhandledRejection (non-fatal):',
      reason instanceof Error ? (reason.stack ?? reason.message) : reason,
    );
  });
  process.on('uncaughtException', (err) => {
    console.error('[process] uncaughtException (non-fatal):', err?.stack ?? err?.message ?? err);
  });
}
