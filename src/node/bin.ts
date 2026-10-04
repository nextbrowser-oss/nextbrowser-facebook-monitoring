#!/usr/bin/env node
// The facebook-monitor executable; everything it does is in cli.ts.

import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`facebook-monitor: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
