import fs from 'fs';
import { validateConfig } from '../packages/ui-shared/src/index.ts' assert { type: 'json' };
// simple JS fallback
try {
  const raw = JSON.parse(fs.readFileSync('packages/ui-shared/src/config.example.json','utf8'));
  if (raw.version !== 1 || !Array.isArray(raw.channels)) throw new Error('schema mismatch');
  console.log('Config valid');
} catch (e) {
  console.error('⚠ CRITICAL FAILURE: Layout Config Collision Detected. Inspection Required.');
  console.error(e.message); process.exit(1);
}
