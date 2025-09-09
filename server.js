require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_API_KEY = process.env.SITE_API_KEY || 'MinhaChaveUltraSecreta123!';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

function checkKey(req, res, next) {
  // Autenticação desativada temporariamente
  return next();
}

app.use(helmet());
app.use(morgan('tiny'));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(cors({ origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS }));
const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

// DB
const dataDir = path.join(__dirname, 'data');
const exportDir = path.join(__dirname, 'exports');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });
const db = new Database(path.join(dataDir, 'mod.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    guildId TEXT,
    name TEXT,
    joinedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT,
    memberName TEXT,
    guildId TEXT,
    channelId TEXT,
    channelName TEXT,
    message TEXT,
    timestamp TEXT
  );
  CREATE TABLE IF NOT EXISTS punishments (
    -- policy: warn -> mute 2h -> mute 4h -> mute 6h -> reset

    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT,
    memberName TEXT,
    type TEXT, -- warn|mute|ban
    reason TEXT,
    channelId TEXT,
    channelName TEXT,
    timestamp TEXT,
    durationHours INTEGER,
    endAt TEXT
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agentId TEXT,
    agentName TEXT,
    count INTEGER,
    timestamp TEXT
  );
`);

// Static
const staticPath = path.join(__dirname, 'frontend_build');
if (fs.existsSync(staticPath)) app.use('/', express.static(staticPath, { extensions: ['html'] }));

// API
// --- Policy helpers ---
function getLastCompletedAction(db, memberId){
  // last punishment ordered by id desc where either warn OR (mute with endAt <= now)
  const nowIso = new Date().toISOString();
  const row = db.prepare(`
    SELECT * FROM punishments
    WHERE memberId=? AND (
      type='warn' OR (type='mute' AND (endAt IS NULL OR endAt <= ?))
    )
    ORDER BY id DESC LIMIT 1
  `).get(memberId, nowIso);
  return row || null;
}

function hasActiveMute(db, memberId){
  const nowIso = new Date().toISOString();
  const row = db.prepare(`SELECT * FROM punishments WHERE memberId=? AND type='mute' AND endAt IS NOT NULL AND endAt > ? ORDER BY id DESC LIMIT 1`).get(memberId, nowIso);
  return row || null;
}

function computeNextAction(db, memberId){
  const active = hasActiveMute(db, memberId);
  if (active) return { action: 'activeMute', until: active.endAt };

  const last = getLastCompletedAction(db, memberId);
  if (!last) return { action: 'warn' };
  if (last.type === 'warn') return { action: 'mute', hours: 2 };

  if (last.type === 'mute'){
    const h = Number(last.durationHours || 0);
    if (h <= 2) return { action: 'mute', hours: 4 };
    if (h <= 4) return { action: 'mute', hours: 6 };
    // last completed was 6h -> reset
    return { action: 'warn' };
  }
  return { action: 'warn' };
}

app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Batch member sync
app.post('/api/memberSyncBatch', checkKey, (req, res) => {
  const { members, guildId } = req.body || {};
  if (!Array.isArray(members)) return res.status(400).json({ error: 'members array required' });
  const stmt = db.prepare(`INSERT INTO members (id,guildId,name,joinedAt) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, guildId=excluded.guildId, joinedAt=excluded.joinedAt`);
  const tx = db.transaction((rows)=>{ rows.forEach(r => stmt.run(r.memberId, guildId || null, r.memberName || '', r.joinedAt || new Date().toISOString())); });
  tx(members);
  res.json({ ok: true, upserted: members.length });
});

app.post('/api/memberSync', checkKey, (req, res) => {
  const { memberId, memberName, joinedAt, guildId } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId required' });
  db.prepare(`INSERT INTO members (id,guildId,name,joinedAt) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, guildId=excluded.guildId, joinedAt=excluded.joinedAt`)
    .run(memberId, guildId || null, memberName || '', joinedAt || new Date().toISOString());
  res.json({ ok: true });
});

app.post('/api/memberRemove', checkKey, (req, res) => {
  const { memberId } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId required' });
  db.prepare(`DELETE FROM members WHERE id = ?`).run(memberId);
  res.json({ ok: true });
});

app.post('/api/logs', checkKey, (req, res) => {
  const { memberId, memberName, channelId, channelName, message, timestamp, guildId } = req.body || {};
  if (!memberId || !message) return res.status(400).json({ error: 'missing fields' });
  db.prepare(`INSERT INTO logs (memberId, memberName, guildId, channelId, channelName, message, timestamp) VALUES (?,?,?,?,?,?,?)`)
    .run(memberId, memberName||'', guildId||null, channelId||'', channelName||'', message, timestamp || new Date().toISOString());
  res.json({ ok: true });
});

// Punishments
app.post('/api/punish/:type(warn|mute|ban)', checkKey, (req, res) => {
  const type = req.params.type;
  const { memberId, memberName, reason, channelId, channelName, timestamp } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId required' });
  db.prepare(`INSERT INTO punishments (memberId, memberName, type, reason, channelId, channelName, timestamp, durationHours, endAt) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(memberId, memberName||'', type, reason||'', channelId||'', channelName||'', timestamp || new Date().toISOString(), req.body?.durationHours || null, req.body?.endAt || null);
  res.json({ ok: true });
});

app.post('/api/clear/member', checkKey, (req, res) => {
  const { memberId } = req.body || {};
  if (!memberId) return res.status(400).json({ error: 'memberId required' });
  const a = db.prepare(`DELETE FROM logs WHERE memberId=?`).run(memberId).changes;
  const b = db.prepare(`DELETE FROM punishments WHERE memberId=?`).run(memberId).changes;
  res.json({ ok: true, deleted: { logs: a, punishments: b } });
});

app.post('/api/clear/all', checkKey, (req, res) => {
  const a = db.prepare(`DELETE FROM logs`).run().changes;
  const b = db.prepare(`DELETE FROM punishments`).run().changes;
  const c = db.prepare(`DELETE FROM tickets`).run().changes;
  res.json({ ok: true, deleted: { logs: a, punishments: b, tickets: c } });
});

app.post('/api/ticket', checkKey, (req, res) => {
  const { agentId, agentName, count } = req.body || {};
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const c = Math.max(1, parseInt(count || 1, 10) || 1);
  db.prepare(`INSERT INTO tickets (agentId, agentName, count, timestamp) VALUES (?,?,?,?)`)
    .run(agentId, agentName||'', c, new Date().toISOString());
  res.json({ ok: true });
});

// Aggregated members with stats
app.get('/api/policy/next', (req, res) => {
  const memberId = req.query.memberId;
  if (!memberId) return res.status(400).json({ error: 'memberId required' });
  const next = computeNextAction(db, memberId);
  res.json({ ok: true, next });
});

// Member detail endpoints
app.get('/api/member/:id', (req, res) => {
  const id = req.params.id;
  const member = db.prepare(`SELECT * FROM members WHERE id=?`).get(id) || { id, name: '', joinedAt: null };
  const warns = db.prepare(`SELECT * FROM punishments WHERE memberId=? AND type='warn' ORDER BY id DESC`).all(id);
  const mutes = db.prepare(`SELECT * FROM punishments WHERE memberId=? AND type='mute' ORDER BY id DESC`).all(id);
  const bans  = db.prepare(`SELECT * FROM punishments WHERE memberId=? AND type='ban'  ORDER BY id DESC`).all(id);
  const logs  = db.prepare(`SELECT * FROM logs WHERE memberId=? ORDER BY id DESC`).all(id);
  const lastP = db.prepare(`SELECT * FROM punishments WHERE memberId=? ORDER BY id DESC LIMIT 1`).get(id) || null;
  const tickets = db.prepare(`SELECT SUM(count) as t FROM tickets WHERE agentId=?`).get(id)?.t || 0;
  const activeMute = db.prepare(`SELECT * FROM punishments WHERE memberId=? AND type='mute' AND endAt IS NOT NULL AND endAt > ? ORDER BY id DESC LIMIT 1`).get(id, new Date().toISOString()) || null;

  res.json({
    ok: true,
    member: { id: member.id, name: member.name, joinedAt: member.joinedAt },
    stats: {
      warns: warns.length, mutes: mutes.length, bans: bans.length, tickets, lastPunishment: lastP, activeMute
    },
    punishments: { warns, mutes, bans },
    logs
  });
});

app.get('/api/member/:id/logs', (req, res) => {
  const id = req.params.id;
  const logs  = db.prepare(`SELECT * FROM logs WHERE memberId=? ORDER BY id DESC`).all(id);
  res.json({ ok: true, logs });
});

app.get('/api/member/:id/punishments', (req, res) => {
  const id = req.params.id;
  const rows = db.prepare(`SELECT * FROM punishments WHERE memberId=? ORDER BY id DESC`).all(id);
  res.json({ ok: true, punishments: rows });
});

app.get('/api/members', (req, res) => {
  const guildId = req.query.guild || null;
  const members = guildId
    ? db.prepare(`SELECT * FROM members WHERE guildId IS NULL OR guildId=?`).all(guildId)
    : db.prepare(`SELECT * FROM members`).all();
  const warns = db.prepare(`SELECT memberId, COUNT(*) as c FROM punishments WHERE type='warn' GROUP BY memberId`).all();
  const mutes = db.prepare(`SELECT memberId, COUNT(*) as c FROM punishments WHERE type='mute' GROUP BY memberId`).all();
  const bans  = db.prepare(`SELECT memberId, COUNT(*) as c FROM punishments WHERE type='ban'  GROUP BY memberId`).all();
  const lastP = db.prepare(`
    SELECT memberId, type, timestamp FROM punishments
    WHERE id IN (SELECT MAX(id) FROM punishments GROUP BY memberId)`
  ).all();
  const ticketsAgg = db.prepare(`SELECT agentId as memberId, SUM(count) as tickets FROM tickets GROUP BY agentId`).all();

  const mapWarn = Object.fromEntries(warns.map(r=>[r.memberId, r.c]));
  const mapMute = Object.fromEntries(mutes.map(r=>[r.memberId, r.c]));
  const mapBan  = Object.fromEntries(bans.map(r=>[r.memberId, r.c]));
  const mapLast = Object.fromEntries(lastP.map(r=>[r.memberId, r]));
  const mapTic  = Object.fromEntries(ticketsAgg.map(r=>[r.memberId, r.tickets]));

  const data = members.map(m => ({
    user_id: m.id,
    user_tag: m.name || m.id,
    total_warns: mapWarn[m.id] || 0,
    total_mutes: mapMute[m.id] || 0,
    total_bans: mapBan[m.id] || 0,
    last_punishment: mapLast[m.id] || null,
    tickets: mapTic[m.id] || 0,
  }));

  res.json(data);
});

app.get('/api/history/:month', (req, res) => {
  const month = req.params.month; // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month format YYYY-MM' });
  const start = dayjs(`${month}-01T00:00:00Z`);
  const end = start.add(1, 'month');
  const logs = db.prepare(`SELECT * FROM logs WHERE timestamp >= ? AND timestamp < ?`).all(start.toISOString(), end.toISOString());
  const punish = db.prepare(`SELECT * FROM punishments WHERE timestamp >= ? AND timestamp < ?`).all(start.toISOString(), end.toISOString());
  const tickets = db.prepare(`SELECT * FROM tickets WHERE timestamp >= ? AND timestamp < ?`).all(start.toISOString(), end.toISOString());
  res.json({ ok: true, month, logs, punishments: punish, tickets });
});

app.post('/api/export/monthly', checkKey, async (req, res) => {
  const month = (req.body?.month) || dayjs().format('YYYY-MM');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month format YYYY-MM' });
  const start = dayjs(`${month}-01T00:00:00Z`);
  const end = start.add(1, 'month');
  const logs = db.prepare(`SELECT * FROM logs WHERE timestamp >= ? AND timestamp < ?`).all(start.toISOString(), end.toISOString());
  const punish = db.prepare(`SELECT * FROM punishments WHERE timestamp >= ? AND timestamp < ?`).all(start.toISOString(), end.toISOString());
  const tickets = db.prepare(`SELECT * FROM tickets WHERE timestamp >= ? AND timestamp < ?`).all(start.toISOString(), end.toISOString());

  const Excel = new ExcelJS.Workbook();
  const s1 = Excel.addWorksheet('Logs'); s1.addRow(['ID','MemberID','MemberName','GuildID','Channel','Message','Timestamp']);
  logs.forEach(r => s1.addRow([r.id, r.memberId, r.memberName, r.guildId, `#${r.channelName||r.channelId}`, r.message, r.timestamp]));
  const s2 = Excel.addWorksheet('Punishments'); s2.addRow(['ID','MemberID','MemberName','Type','Reason','Channel','Timestamp']);
  punish.forEach(r => s2.addRow([r.id, r.memberId, r.memberName, r.type, r.reason, `#${r.channelName||r.channelId}`, r.timestamp]));
  const s3 = Excel.addWorksheet('Tickets'); s3.addRow(['ID','AgentID','AgentName','Count','Timestamp']);
  tickets.forEach(r => s3.addRow([r.id, r.agentId, r.agentName, r.count, r.timestamp]));
  const xlsxPath = path.join(exportDir, `${month}.xlsx`);
  await Excel.xlsx.writeFile(xlsxPath);

  const pdfPath = path.join(exportDir, `${month}.pdf`);
  const doc = new PDFDocument({ margin: 36 });
  doc.pipe(fs.createWriteStream(pdfPath));
  doc.fontSize(18).text(`Relatório Mensal - ${month}`, { underline: true });
  doc.moveDown();
  doc.fontSize(12).text(`Logs: ${logs.length}  |  Punições: ${punish.length}  |  Tickets records: ${tickets.length}`);
  doc.moveDown().fontSize(14).text('Top 10 Punições:');
  punish.slice(0,10).forEach((p,i)=> doc.fontSize(10).text(`${i+1}. ${p.timestamp} - ${p.memberName||p.memberId}: ${p.type} (${p.reason||'-'})`));
  doc.end();

  res.json({ ok: true, month, files: { xlsx: `/exports/${month}.xlsx`, pdf: `/exports/${month}.pdf` } });
});

app.use('/exports', express.static(exportDir, { fallthrough: false }));

app.listen(PORT, '0.0.0.0', () => console.log(`[SITE] http://0.0.0.0:${PORT}`));
