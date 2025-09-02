#!/usr/bin/env node

import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), status: r.status };
}

// Single arg test
let res = run('node', ['index.js', 'x=1', '--domain', 'clearspeak', '--locale', 'en']);
assert.equal(res.status, 0, res.stderr);
assert.ok(res.stdout.toLowerCase().includes('x equals 1'));

// Batch file test
const batch = 'x=1\na^2+b^2=c^2\n';
fs.writeFileSync('input.txt', batch, 'utf8');
res = run('node', ['index.js', '--input', 'input.txt']);
assert.equal(res.status, 0, res.stderr);
const lines = res.stdout.split('\n');
assert.equal(lines.length, 2);
assert.ok(lines[0].toLowerCase().includes('x equals 1'));
assert.ok(lines[1].toLowerCase().includes('a squared plus b squared equals c squared'));

console.log('All tests passed.');
