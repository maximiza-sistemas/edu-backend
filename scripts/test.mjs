// Runs every src/**/*.test.ts file with the Node test runner and tsx (works on Node 20+, any OS).
// Node 20 cannot expand glob patterns given to --test, so the files are listed here.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(path.join(root, 'src'), { recursive: true })
    .map(String)
    .filter(file => file.endsWith('.test.ts'))
    .map(file => path.join('src', file))
    .sort();

if (files.length === 0) {
    console.error('No src/**/*.test.ts files found');
    process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
