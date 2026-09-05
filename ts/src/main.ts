import { fdOutput, run } from './cli/main.ts';

// serve keeps the process alive until a signal ends it, so run resolves late for it; every
// other command resolves immediately. Top-level await keeps the exit code the last word.
process.exitCode = await run(process.argv.slice(2), {
  out: fdOutput(),
  env: process.env,
  cwd: process.cwd(),
  // The streams' own TTY status is what §7.11's auto mode follows (false when piped).
  isStdoutTty: process.stdout.isTTY,
  isStderrTty: process.stderr.isTTY,
});
