#!/usr/bin/env node
// Starts the dev server with fixture mode on.
//
// A wrapper rather than `EXPO_PUBLIC_MOCK=1 expo start` in the npm script,
// because npm runs scripts through cmd.exe on Windows, where the inline
// VAR=value prefix is a syntax error rather than an assignment. Setting it here
// works the same on every platform and adds no dependency.
//
// Pass through any extra args: `npm run start:mock -- --web`.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (!args.length) args.push('--web');

const child = spawn('npx', ['expo', 'start', ...args], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EXPO_PUBLIC_MOCK: '1' },
});

child.on('exit', (code) => process.exit(code ?? 0));
