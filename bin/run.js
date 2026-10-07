#!/usr/bin/env node
// Standalone entry point (e.g. `SHOWTIME_AGENTIA_BIN=… bin/run.js showtime doctor`).
// Inside Agentia, the same commands run as `agentia showtime …` after `agentia plugins link .`.
import {execute} from '@oclif/core'

await execute({dir: import.meta.url})
