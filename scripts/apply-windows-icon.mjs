import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findRcedit() {
  const candidates = [
    path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
    process.env.ELECTRON_BUILDER_RCEDIT_PATH
      ? path.join(process.env.ELECTRON_BUILDER_RCEDIT_PATH, 'rcedit-x64.exe')
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error('rcedit.exe not found. Install dependencies before packaging.');
}

export default async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const exePath = path.join(context.appOutDir, 'Miaw.exe');
  const iconPath = path.join(projectRoot, 'icons', 'miaw.ico');
  const rceditPath = await findRcedit();

  await execFileAsync(rceditPath, [
    exePath,
    '--set-icon',
    iconPath,
    '--set-version-string',
    'FileDescription',
    'Miaw',
    '--set-version-string',
    'ProductName',
    'Miaw',
    '--set-version-string',
    'LegalCopyright',
    'Copyright (c) 2026 Cloudfren',
  ]);

  console.log(`Applied Windows icon to ${exePath}`);
}
