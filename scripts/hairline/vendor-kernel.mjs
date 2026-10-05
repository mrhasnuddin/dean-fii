#!/usr/bin/env node
/**
 * Copies the hairline kernel (the engine every Hairline figure draws with) from the hairline-create
 * skill into the site as an ES module: the file unchanged, plus one line, `export default HL;`.
 * Run again after updating the skill: node scripts/hairline/vendor-kernel.mjs [path/to/kernel.js]
 * The kernel is MIT, © Lucas Marques (src/vendor/hairline/LICENSE).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const src = process.argv[2] ?? join(homedir(), '.claude', 'skills', 'hairline-create', 'kernel.js');
const kernel = readFileSync(src, 'utf8').replace(/\r\n/g, '\n').trimEnd();
if (!/^\/\* hairline kernel sha256:[0-9a-f]{64} \*\//.test(kernel)) throw new Error(`not a hairline kernel: ${src}`);
writeFileSync(new URL('../../src/vendor/hairline/kernel.js', import.meta.url), `${kernel}\n\nexport default HL;\n`);
console.log('src/vendor/hairline/kernel.js written from', src);
