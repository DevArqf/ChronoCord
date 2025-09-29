const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'events.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS events (
    uid TEXT PRIMARY KEY,
    title TEXT,
    times TEXT,
    guildId TEXT,
    channelId TEXT,
    messageId TEXT,
    createdAt INTEGER,
    maxVotes INTEGER
  )`);
});

const insertEvent = (record) =>
  new Promise((resolve, reject) => {
    const stmt = db.prepare(
      `INSERT INTO events(uid,title,times,guildId,channelId,messageId,createdAt,maxVotes)
       VALUES(?,?,?,?,?,?,?,?)`
    );
    stmt.run(
      record.uid,
      record.title,
      JSON.stringify(record.times),
      record.guildId,
      record.channelId,
      record.messageId,
      record.createdAt,
      record.maxVotes,
      function (err) {
        stmt.finalize();
        if (err) return reject(err);
        resolve();
      }
    );
  });

const fetchEventsForGuild = (guildId) =>
  new Promise((resolve, reject) => {
    db.all(`SELECT * FROM events WHERE guildId = ? ORDER BY createdAt DESC`, [guildId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

// new helper: delete event by uid
const deleteEvent = (uid) =>
  new Promise((resolve, reject) => {
    db.run(`DELETE FROM events WHERE uid = ?`, [uid], function (err) {
      if (err) return reject(err);
      resolve(this.changes); // number of rows deleted (0/1)
    });
  });

// export helpers
module.exports = { insertEvent, fetchEventsForGuild, deleteEvent };