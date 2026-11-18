'use strict';

const fs = require('fs');
const path = require('path');

/** Status, die eine erneute Einreichung verhindern. */
const BLOCKING_STATUSES = ['submitted', 'submitting', 'manual'];

class Store {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, notices: {} };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.notices) this.data = parsed;
    } catch (e) {
      throw new Error(`state.json konnte nicht gelesen werden: ${e.message}`);
    }
  }

  get(token) {
    return this.data.notices[token] || null;
  }

  set(token, entry) {
    this.data.notices[token] = { ...(this.data.notices[token] || {}), ...entry, updatedAt: new Date().toISOString() };
    this.save();
  }

  remove(token) {
    if (this.data.notices[token]) {
      delete this.data.notices[token];
      this.save();
      return true;
    }
    return false;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  isBlocked(token, force = false) {
    const entry = this.get(token);
    if (!entry) return null;
    // Manuelle Markierungen sind absichtlich "klebrig" und werden nur durch
    // "mark --unmark" entfernt, nicht durch --force.
    if (entry.status === 'manual') {
      return `Manuell als eingereicht markiert${entry.at ? ` am ${entry.at.slice(0, 10)}` : ''}${entry.note ? ` (${entry.note})` : ''}. Entfernen mit: node cli.js mark --token ${token} --unmark`;
    }
    if (force) return null;
    if (BLOCKING_STATUSES.includes(entry.status)) {
      if (entry.status === 'submitting') {
        return 'Einreichung wurde begonnen, aber nicht bestätigt. Bitte manuell prüfen (--force zum erneuten Versuch).';
      }
      return `Bereits eingereicht am ${entry.at || entry.updatedAt}.`;
    }
    return null;
  }

  /**
   * Sucht eine bereits eingereichte Anzeige mit demselben Fingerabdruck
   * (PLZ, Kennzeichen, Startzeit, TBNR) – unabhängig vom Token.
   */
  findByFingerprint(fingerprint, exceptToken) {
    if (!fingerprint) return null;
    for (const [token, entry] of Object.entries(this.data.notices)) {
      if (token === exceptToken) continue;
      if (entry.fingerprint === fingerprint && BLOCKING_STATUSES.includes(entry.status)) {
        return { token, ...entry };
      }
    }
    return null;
  }
}

module.exports = { Store, BLOCKING_STATUSES };
