// Validates every workflow file parses as clean YAML before push/CI.
// Usage: npm run verify:workflows
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const dir = '.github/workflows';
let failed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
  try {
    yaml.load(readFileSync(join(dir, file), 'utf8'));
    console.log(`ok   — ${file}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL — ${file}: ${error.message}`);
  }
}
if (failed) {
  console.error(`workflow validation failed: ${failed} file(s)`);
  process.exit(1);
}
console.log('all workflows valid');
