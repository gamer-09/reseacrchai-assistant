const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const NOTES_PATH = path.join(DATA_DIR, 'notes.json');

async function ensureFile() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.access(NOTES_PATH, fs.constants.F_OK);
  } catch (_) {
    await fsp.writeFile(NOTES_PATH, JSON.stringify({ notes: [] }, null, 2), 'utf8');
  }
}

async function readAll() {
  await ensureFile();
  const raw = await fsp.readFile(NOTES_PATH, 'utf8');
  try {
    const obj = JSON.parse(raw || '{}');
    return Array.isArray(obj.notes) ? obj.notes : [];
  } catch {
    return [];
  }
}

async function writeAll(notes) {
  await ensureFile();
  await fsp.writeFile(NOTES_PATH, JSON.stringify({ notes }, null, 2), 'utf8');
}

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function list() {
  return await readAll();
}

async function add(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Note text required');
  }
  const notes = await readAll();
  const note = { id: makeId(), text: text.trim(), createdAt: new Date().toISOString() };
  notes.unshift(note);
  await writeAll(notes.slice(0, 500)); // cap to latest 500
  return note;
}

module.exports = { list, add };
