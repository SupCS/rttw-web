import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['node_modules', '.git', 'dist', 'coverage']);
const instructionNames = new Set(['agents.md', 'agents.override.md', 'claude.md', 'gemini.md']);
const found = [];
const documents = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) await scan(path);
    else if (entry.isFile()) {
      if (instructionNames.has(entry.name.toLowerCase())) found.push(path);
      if (entry.name.toLowerCase().endsWith('.md')) documents.push(relative(root, path));
    }
  }
}

try {
  await scan(root);
  if (found.length !== 1 || relative(root, found[0]) !== 'AGENTS.md') {
    throw new Error('Keep one root AGENTS.md; remove duplicate AI instruction files.');
  }
  if (documents.length !== 2 || !documents.includes('AGENTS.md') || !documents.includes('TODO.md')) {
    throw new Error('Keep only AGENTS.md and TODO.md as project documentation.');
  }
  const words = (await readFile(found[0], 'utf8')).match(/\S+/g)?.length ?? 0;
  if (words > 250) throw new Error(`AGENTS.md has ${words} words; maximum is 250. Replace or shorten rules.`);
  const todoWords = (await readFile(join(root, 'TODO.md'), 'utf8')).match(/\S+/g)?.length ?? 0;
  if (todoWords > 400) throw new Error(`TODO.md has ${todoWords} words; maximum is 400. Update progress instead of appending history.`);
  console.log(`Documentation: AGENTS ${words}/250 words; TODO ${todoWords}/400 words; two files.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Agent guidance check failed.');
  process.exitCode = 1;
}
