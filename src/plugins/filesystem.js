'use strict';

const fs   = require('fs').promises;
const path = require('path');
const os   = require('os');

const MAX_READ_BYTES = 100 * 1024;

module.exports = {
  name:        'filesystem',
  description: 'Basic file system operations',

  async execute(input, context) {
    const action = input && input.action;
    const rawPath = input && input.path;

    if (action !== 'list' && action !== 'read') {
      return { error: 'Unknown or missing action. Use "list" or "read".' };
    }
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      return { error: 'path is required (non-empty string).' };
    }

    let resolved;
    try {
      resolved = path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.resolve(process.cwd(), rawPath);
    } catch {
      return { error: 'Invalid path.' };
    }

    const allowed = await assertAllowedPath(resolved);
    if (allowed.error) return allowed;

    const safePath = allowed.path;

    if (action === 'list') {
      return await doList(safePath);
    }
    return await doRead(safePath);
  },
};

/**
 * Ensure the path stays under the user home directory or current working directory,
 * and block a few sensitive absolute locations.
 */
async function assertAllowedPath(resolved) {
  if (isBlockedSystemPath(resolved)) {
    return { error: 'Access to this system path is not allowed.' };
  }

  let realTarget = resolved;
  try {
    realTarget = await fs.realpath(resolved);
  } catch {
    // Missing path: still validate the intended resolved path string
  }

  if (isBlockedSystemPath(realTarget)) {
    return { error: 'Access to this system path is not allowed.' };
  }

  const roots = [path.resolve(os.homedir()), path.resolve(process.cwd())];
  const ok = roots.some((root) => isInsideRoot(realTarget, root));
  if (!ok) {
    return { error: 'Path must resolve inside the project directory or your home directory.' };
  }

  return { path: realTarget };
}

function isInsideRoot(target, root) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isBlockedSystemPath(p) {
  const n = path.normalize(p);
  if (process.platform === 'win32') {
    const lower = n.toLowerCase();
    const blocks = [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'config').toLowerCase(),
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'lsass.exe').toLowerCase(),
    ];
    return blocks.some((b) => b && lower.startsWith(b));
  }
  const blocks = ['/etc/shadow', '/etc/sudoers', '/root/.ssh'];
  return blocks.some((b) => n === b || n.startsWith(b + path.sep));
}

async function doList(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return { error: err.message || String(err) };
  }

  const files = entries.map((e) => ({
    name: e.name,
    type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
  }));

  files.sort((a, b) => a.name.localeCompare(b.name));
  return { files };
}

async function doRead(filePath) {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch (err) {
    return { error: err.message || String(err) };
  }

  if (st.isDirectory()) {
    return { error: 'Path is a directory; use action "list".' };
  }
  if (!st.isFile()) {
    return { error: 'Path is not a regular file.' };
  }
  if (st.size > MAX_READ_BYTES) {
    return { error: `File too large to read (${st.size} bytes; max ${MAX_READ_BYTES}).` };
  }

  try {
    const content = await fs.readFile(filePath, { encoding: 'utf8' });
    return { content };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}
