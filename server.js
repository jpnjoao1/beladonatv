// Servidor unico: painel (para voce, do PC) + API + streaming de video + playlist/heartbeat das TVs.
// Escala pequena (ate ~5 telas). Sem framework pesado: Express + arquivo JSON.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { db, save, VIDEOS_DIR, makeId, ensureDirs } = require("./lib/db");

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PANEL_PASSWORD || "beladona"; // troque em producao (env no Fly)

ensureDirs();
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------- cookies
function cookieParser() {
  return (req, _res, next) => {
    req.cookies = {};
    const h = req.headers.cookie;
    if (h) {
      h.split(";").forEach((c) => {
        const i = c.indexOf("=");
        if (i > -1) req.cookies[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
      });
    }
    next();
  };
}

// Token de sessao derivado da senha — simples, suficiente para 1 usuario.
function sessionToken() {
  return crypto.createHash("sha256").update("sess:" + PASSWORD).digest("hex").slice(0, 32);
}

function requireAuth(req, res, next) {
  if (req.cookies.tvsess === sessionToken()) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "nao autenticado" });
  return res.redirect("/login.html");
}

// ---------------------------------------------------------------- login
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password === PASSWORD) {
    res.setHeader(
      "Set-Cookie",
      `tvsess=${sessionToken()}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`
    );
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "senha incorreta" });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "tvsess=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// ================================================================ ROTAS PUBLICAS (TVs)
// Ficam ANTES do requireAuth porque as TVs nao fazem login.

// CORS para as TVs: no APK a pagina roda em file:// e busca a API neste servidor.
app.use(["/api/playlist", "/api/heartbeat", "/media"], (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Playlist de uma tela — a TV consulta periodicamente.
app.get("/api/playlist", (req, res) => {
  const code = String(req.query.device || "").trim().toUpperCase();
  const screen = db().screens.find((s) => s.code === code);
  if (!screen) return res.status(404).json({ error: "tela nao cadastrada", code });

  const items = (screen.playlist || [])
    .map((id) => db().videos.find((v) => v.id === id))
    .filter(Boolean)
    .map((v) => ({
      id: v.id,
      title: v.title,
      file: v.file,
      size: v.size,
      duration: v.duration || 0,
      url: `/media/${v.file}`,
    }));

  res.json({
    device: code,
    name: screen.name,
    updatedAt: screen.updatedAt || null,
    minAppVersion: 1,
    items,
  });
});

// Heartbeat — a TV avisa que esta viva e o que esta tocando.
app.post("/api/heartbeat", (req, res) => {
  const { device, nowPlaying, appVersion, storageFreeMb, itemsCached } = req.body || {};
  const code = String(device || "").trim().toUpperCase();
  const screen = db().screens.find((s) => s.code === code);
  if (!screen) return res.status(404).json({ error: "tela nao cadastrada" });
  screen.lastSeen = new Date().toISOString();
  screen.nowPlaying = nowPlaying || null;
  screen.appVersion = appVersion || null;
  screen.storageFreeMb = typeof storageFreeMb === "number" ? storageFreeMb : null;
  screen.itemsCached = typeof itemsCached === "number" ? itemsCached : null;
  save();
  res.json({ ok: true });
});

// Streaming de video com suporte a Range (necessario para <video> na TV/navegador).
app.get("/media/:file", (req, res) => {
  const file = path.basename(req.params.file); // evita path traversal
  const full = path.join(VIDEOS_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();

  const stat = fs.statSync(full);
  const total = stat.size;
  const type = file.endsWith(".webm") ? "video/webm" : "video/mp4";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (start >= total) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", end - start + 1);
    res.setHeader("Content-Type", type);
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", total);
    res.setHeader("Content-Type", type);
    res.setHeader("Accept-Ranges", "bytes");
    fs.createReadStream(full).pipe(res);
  }
});

// Player publico (a TV carrega isto; tambem da para testar no navegador do PC).
app.get(["/player", "/player.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

// Pagina de login (publica).
app.get("/login.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// APK do Fire TV (publico) — no Fire Stick, abra o app "Downloader" e digite:
//   SEU-APP.fly.dev/tv.apk
app.get(["/tv.apk", "/apk", "/install"], (_req, res) => {
  const apk = path.join(__dirname, "public", "downloads", "beladonatv.apk");
  if (!fs.existsSync(apk)) return res.status(404).send("APK ainda nao publicado.");
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", 'attachment; filename="beladonatv.apk"');
  res.sendFile(apk);
});

// ================================================================ ROTAS PROTEGIDAS (painel)
app.use(requireAuth);

// ---- Videos ----
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || ".mp4").toLowerCase();
      const safeExt = ext === ".webm" ? ".webm" : ".mp4";
      cb(null, makeId("v") + safeExt);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB por arquivo
});

app.get("/api/videos", (_req, res) => {
  res.json({ videos: db().videos });
});

app.post("/api/videos", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "arquivo ausente" });
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  const video = {
    id,
    file: req.file.filename,
    title: (req.body.title || req.file.originalname || "Sem titulo").slice(0, 120),
    original: req.file.originalname,
    size: req.file.size,
    duration: Number(req.body.duration) || 0,
    uploadedAt: new Date().toISOString(),
  };
  db().videos.unshift(video);
  save();
  res.json({ ok: true, video });
});

app.delete("/api/videos/:id", (req, res) => {
  const id = req.params.id;
  const idx = db().videos.findIndex((v) => v.id === id);
  if (idx === -1) return res.status(404).json({ error: "nao encontrado" });
  const [v] = db().videos.splice(idx, 1);
  // remove das playlists de todas as telas
  db().screens.forEach((s) => {
    s.playlist = (s.playlist || []).filter((vid) => vid !== id);
  });
  try {
    fs.unlinkSync(path.join(VIDEOS_DIR, v.file));
  } catch (_) {}
  save();
  res.json({ ok: true });
});

// ---- Telas ----
app.get("/api/screens", (_req, res) => {
  res.json({ screens: db().screens });
});

app.post("/api/screens", (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase().replace(/\s+/g, "-");
  const name = String(req.body.name || "").trim();
  if (!code) return res.status(400).json({ error: "codigo obrigatorio" });
  if (db().screens.some((s) => s.code === code))
    return res.status(409).json({ error: "codigo ja existe" });
  const screen = {
    code,
    name: name || code,
    playlist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSeen: null,
    nowPlaying: null,
    appVersion: null,
    storageFreeMb: null,
    itemsCached: null,
  };
  db().screens.push(screen);
  save();
  res.json({ ok: true, screen });
});

app.put("/api/screens/:code", (req, res) => {
  const screen = db().screens.find((s) => s.code === req.params.code.toUpperCase());
  if (!screen) return res.status(404).json({ error: "nao encontrado" });
  if (typeof req.body.name === "string") screen.name = req.body.name.trim() || screen.code;
  if (Array.isArray(req.body.playlist)) {
    const validIds = new Set(db().videos.map((v) => v.id));
    screen.playlist = req.body.playlist.filter((id) => validIds.has(id));
  }
  screen.updatedAt = new Date().toISOString();
  save();
  res.json({ ok: true, screen });
});

app.delete("/api/screens/:code", (req, res) => {
  const idx = db().screens.findIndex((s) => s.code === req.params.code.toUpperCase());
  if (idx === -1) return res.status(404).json({ error: "nao encontrado" });
  db().screens.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// Painel — protegido. CSS/JS ficam embutidos no proprio panel.html (nao ha estaticos protegidos).
app.get(["/", "/panel.html"], (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "panel.html"))
);

app.listen(PORT, () => {
  console.log(`TV Beladona rodando em http://localhost:${PORT}`);
  console.log(`Senha do painel: "${PASSWORD}" (defina PANEL_PASSWORD em producao)`);
});
