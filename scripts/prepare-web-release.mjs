import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dist = resolve('dist');
const downloads = join(dist, 'd');
const github = 'https://raw.githubusercontent.com/jdmiami/Void-studio';
const android = 'de96a74223fcbd817265b109b1215d611a151c27/v1.1.0';
const apple = 'ea5c098ef247821a8083ff2df94810e8a4797d89/v1.2.0';
const releases = [
  ['void-studio.apk', android, '7a67b864a8b41c52a42ea1b9952020441866d00417cec1adfe646b66b12093ae'],
  ['VoidStudio-iphoneos-unsigned.zip', apple, '9ce29effc88492f805edb25aaddffdbccc0db26a6f5be5fdabb7c273b029a45f'],
  ['VoidStudio-iphonesimulator.zip', apple, '609b178e5372520736557f584dc82e82b0be1a784104ba78b48fcd75ecc39ca8'],
];

async function getRelease([name, revision, expectedHash]) {
  const path = join(downloads, name);
  await run('curl', ['-fsSL', '--retry', '2', '--max-time', '90', `${github}/${revision}/${name}`, '-o', path]);
  const hash = createHash('sha256').update(await readFile(path)).digest('hex');
  if (hash !== expectedHash) throw new Error(`Checksum mismatch for ${name}`);
  console.log(`Verified ${name}`);
}

await mkdir(downloads, { recursive: true });
await mkdir(join(dist, 'cam'), { recursive: true });
await copyFile(join(dist, 'index.html'), join(dist, 'cam', 'index.html'));

const webFiles = (await readdir(dist)).filter(name => name !== 'd' && name !== 'launch.html');
const sourceFiles = [
  'README.md', '.gitignore', '.github/workflows', 'package.json', 'package-lock.json',
  'index.html', 'vite.config.js', 'vercel.json', 'src', 'public', 'scripts', 'android/app', 'ios',
];
await Promise.all([
  ...releases.map(getRelease),
  run('zip', ['-qr', join(downloads, 'void-studio-pwa.zip'), ...webFiles], { cwd: dist }),
  run('zip', ['-qr', join(downloads, 'void-studio-source.zip'), ...sourceFiles,
    '-x', 'public/models/*', 'public/vision/*', '*/xcuserdata/*', '*.xcuserstate']),
]);

await copyFile(join(dist, 'launch.html'), join(dist, 'index.html'));
