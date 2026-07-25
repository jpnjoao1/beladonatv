// "Banco de dados" em arquivo JSON — simples e robusto na escala de poucas telas.
// Guardado no volume persistente (DATA_DIR). Escrita atomica (tmp + rename).

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureDirs() {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

function defaultDb() {
  return { videos: [], screens: [] };
}

function load() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    if (!Array.isArray(db.videos)) db.videos = [];
    if (!Array.isArray(db.screens)) db.screens = [];
    return db;
  } catch (e) {
    return defaultDb();
  }
}

let _db = load();

function save() {
  ensureDirs();
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(_db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function db() {
  return _db;
}

// ---- IDs ----
let _counter = 0;
function makeId(prefix) {
  _counter += 1;
  const t = Date.now().toString(36);
  const c = _counter.toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}_${t}${c}${r}`;
}

module.exports = {
  DATA_DIR,
  VIDEOS_DIR,
  DB_FILE,
  db,
  save,
  load,
  makeId,
  ensureDirs,
};
