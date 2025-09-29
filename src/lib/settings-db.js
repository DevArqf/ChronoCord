const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'settings.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guildId TEXT PRIMARY KEY,
    eventRoleIds TEXT,      -- JSON array of role IDs allowed to use event commands
    requireManage INTEGER,  -- 0/1: require ManageGuild to run event commands when set
    defaultMaxVotes INTEGER -- optional default max votes for new polls
  )`);
});

const upsertSettings = (guildId, partial) =>
  new Promise((resolve, reject) => {
    // fetch existing
    db.get(`SELECT * FROM guild_settings WHERE guildId = ?`, [guildId], (err, row) => {
      if (err) return reject(err);
      const existing = row || { eventRoleIds: '[]', requireManage: 0, defaultMaxVotes: null };
      const merged = {
        guildId,
        eventRoleIds: partial.eventRoleIds !== undefined ? JSON.stringify(partial.eventRoleIds) : existing.eventRoleIds,
        requireManage: partial.requireManage !== undefined ? (partial.requireManage ? 1 : 0) : existing.requireManage,
        defaultMaxVotes: partial.defaultMaxVotes !== undefined ? partial.defaultMaxVotes : existing.defaultMaxVotes,
      };
      const stmt = db.prepare(
        `INSERT INTO guild_settings(guildId,eventRoleIds,requireManage,defaultMaxVotes)
         VALUES(?,?,?,?)
         ON CONFLICT(guildId) DO UPDATE SET
           eventRoleIds=excluded.eventRoleIds,
           requireManage=excluded.requireManage,
           defaultMaxVotes=excluded.defaultMaxVotes`
      );
      stmt.run(merged.guildId, merged.eventRoleIds, merged.requireManage, merged.defaultMaxVotes, function (err2) {
        stmt.finalize();
        if (err2) return reject(err2);
        resolve();
      });
    });
  });

const fetchSettings = (guildId) =>
  new Promise((resolve, reject) => {
    db.get(`SELECT * FROM guild_settings WHERE guildId = ?`, [guildId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      try {
        const parsed = {
          guildId: row.guildId,
          eventRoleIds: JSON.parse(row.eventRoleIds || '[]'),
          requireManage: Boolean(row.requireManage),
          defaultMaxVotes: row.defaultMaxVotes === null ? null : Number(row.defaultMaxVotes),
        };
        resolve(parsed);
      } catch (e) {
        resolve({
          guildId: row.guildId,
          eventRoleIds: [],
          requireManage: Boolean(row.requireManage),
          defaultMaxVotes: row.defaultMaxVotes === null ? null : Number(row.defaultMaxVotes),
        });
      }
    });
  });

module.exports = { upsertSettings, fetchSettings };