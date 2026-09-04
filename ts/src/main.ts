import { fdOutput, run } from './cli/main.ts';

process.exitCode = run(process.argv.slice(2), fdOutput());
