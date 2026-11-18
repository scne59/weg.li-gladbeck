'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(level, msg, extra) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = { info: 'INFO', warn: 'WARN', error: 'FEHLER', ok: 'OK  ' }[level] || 'INFO';
  let line = `[${ts}] ${prefix} ${msg}`;
  if (extra !== undefined) line += ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  console.log(line);
}

const BERLIN = 'Europe/Berlin';

function berlinParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Ungültiges Datum: ${iso}`);
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour === '24' ? '00' : p.hour,
    minute: p.minute,
    date: `${p.day}.${p.month}.${p.year}`,
    time: `${p.hour}:${p.minute}`,
    sortKey: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,
  };
}

function berlinToday() {
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day };
}

function dayNumber(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function ageInDays(iso) {
  const p = berlinParts(iso);
  const t = berlinToday();
  return dayNumber(t.year, t.month, t.day) - dayNumber(+p.year, +p.month, +p.day);
}

// "Musterstraße 12" -> { street: "Musterstraße", houseNumber: "137" }
// "Willy-Brandt-Platz 2a" -> ...
// "Hauptstr. 12 - 14" -> houseNumber "12 - 14"
function splitStreet(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(.*?)\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/);
  if (m) return { street: m[1].trim(), houseNumber: m[2].replace(/\s+/g, ' ').trim() };
  return { street: raw, houseNumber: '' };
}

function norm(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function truncate(value, max) {
  const s = String(value || '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Eindeutiger Fingerabdruck einer Anzeige, unabhängig vom weg.li-Token.
 * Schützt vor Doppeleinreichungen, wenn sich der Token ändert oder der
 * lokale Status verloren geht.
 */
function noticeFingerprint(notice) {
  const d = new Date(notice?.start_date);
  const start = Number.isNaN(d.getTime()) ? String(notice?.start_date || '') : d.toISOString().slice(0, 16);
  const plate = String(notice?.registration || '').toUpperCase().replace(/[\s-]+/g, '');
  return [String(notice?.zip || '').trim(), plate, start, String(notice?.tbnr || '').trim()].join('|');
}

module.exports = {
  sleep,
  log,
  berlinParts,
  berlinToday,
  ageInDays,
  splitStreet,
  norm,
  asArray,
  truncate,
  noticeFingerprint,
};
