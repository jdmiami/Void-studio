import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const publicDirectory = new URL('../public/', import.meta.url);
const modelDirectory = new URL('models/', publicDirectory);
const runtimeDirectory = new URL('vision/', publicDirectory);
const packageDirectory = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const modelOrigin = 'https://storage.googleapis.com/mediapipe-models/';
const models = [
  ['hand.task', 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'],
  ['pose.task', 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'],
];
const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    // curl also handles environments that require their configured HTTPS proxy.
    const { stdout } = await run('curl', ['-fsSL', '--retry', '2', '--max-time', '45', url.href], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }
  if (!response.ok) throw new Error(`Model download returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareModel([name, path, expectedHash]) {
  const output = new URL(name, modelDirectory);
  const existing = await readFile(output).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && hash(existing) === expectedHash) return;

  const bytes = await download(new URL(path, modelOrigin));
  if (hash(bytes) !== expectedHash) throw new Error(`Integrity check failed for ${name}`);
  await writeFile(output, bytes);
}

await mkdir(modelDirectory, { recursive: true });
await Promise.all([
  cp(fileURLToPath(packageDirectory), fileURLToPath(runtimeDirectory), { recursive: true }),
  ...models.map(prepareModel),
]);
