import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// --ignore-scripts skips cpu-features' configuration generator. Electron's
// node-gyp rebuild does not run it, but binding.gyp requires its output.
const fromSsh = createRequire(import.meta.resolve('ssh2/package.json'));
let cpuFeatures;
try {
  cpuFeatures = dirname(fromSsh.resolve('cpu-features/package.json'));
} catch (error) {
  // ssh2 supports installations without this optional dependency.
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

if (cpuFeatures) {
  const configuration = execFileSync(process.execPath, ['buildcheck.js'], {
    cwd: cpuFeatures,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // Validate before writing so a failed probe cannot leave an empty config.
  JSON.parse(configuration);
  writeFileSync(join(cpuFeatures, 'buildcheck.gypi'), configuration);
}
