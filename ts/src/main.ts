import { fdOutput, run } from './cli/main.ts';

process.exitCode = run(process.argv.slice(2), {
  out: fdOutput(),
  env: process.env,
  cwd: process.cwd(),
  // The streams' own TTY status is what §7.11's auto mode follows (false when piped).
  isStdoutTty: process.stdout.isTTY,
  isStderrTty: process.stderr.isTTY,
});
