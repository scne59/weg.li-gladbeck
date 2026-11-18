#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { loadConfig, missingPersonFields, ROOT } = require('./src/config');
const { WegliApi } = require('./src/wegli');
const { Store } = require('./src/store');
const { GladbeckImporter, findChrome } = require('./src/gladbeck');
const { preparePhoto, assignPhotos } = require('./src/photos');
const { mapOffenses, isImportableStatus } = require('./src/mapping');
const { extractProfileFromHtml, mapProfileToPerson, readProfileFromBrowser } = require('./src/profile');
const { log, sleep, berlinParts, ageInDays, truncate, noticeFingerprint } = require('./src/util');

const STATE_FILE = path.join(ROOT, 'state.json');

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.shift() || 'help';
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      opts._ = opts._ || [];
      opts._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  return { command, opts };
}

function maskKey(key) {
  if (!key) return '(nicht gesetzt)';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function pad(value, width) {
  return String(value ?? '').padEnd(width).slice(0, width);
}

function printNotices(notices, store) {
  const header = [
    pad('Datum', 12),
    pad('Zeit', 6),
    pad('PLZ', 6),
    pad('Kennzeichen', 14),
    pad('TBNR', 8),
    pad('Fotos', 5),
    pad('Alter', 6),
    pad('Status', 10),
    'Import',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const n of notices) {
    const p = berlinParts(n.start_date);
    const entry = store.get(n.token);
    const imported = entry ? entry.status : '-';
    console.log(
      [
        pad(p.date, 12),
        pad(p.time, 6),
        pad(n.zip, 6),
        pad(n.registration, 14),
        pad(n.tbnr, 8),
        pad((n.photos || []).length, 5),
        pad(`${ageInDays(n.start_date)} T.`, 6),
        pad(n.status, 10),
        imported,
      ].join(' ')
    );
  }
}

function filterNotices(notices, config, opts) {
  const zips = (config.gladbeck.allowedZips || []).map(String);
  const maxAge = opts.days !== undefined ? Number(opts.days) : Number(config.gladbeck.maxAgeDays);

  return notices.filter((n) => {
    if (opts.token) return n.token === opts.token;
    if (!opts['all-zips'] && !zips.includes(String(n.zip))) return false;
    if (!opts['all-days']) {
      const age = ageInDays(n.start_date);
      if (Number.isFinite(maxAge) && age > maxAge) return false;
    }
    if (!opts['all-status'] && !isImportableStatus(n)) return false;
    return true;
  });
}

function sortNewestFirst(notices) {
  return [...notices].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
}

async function loadNotices(api) {
  log('info', 'Lade Anzeigen von weg.li …');
  const notices = await api.listNotices((page, batch, total) => {
    if (batch > 0) log('info', `  Seite ${page}: ${batch} Einträge (gesamt ${total})`);
  });
  log('ok', `${notices.length} Anzeigen geladen.`);
  return notices;
}

async function loadSourceNotices(api, opts) {
  if (opts.input) {
    const inputFile = path.resolve(ROOT, opts.input);
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const notices = sortNewestFirst(Array.isArray(data) ? data : data.notices || []);
    log('info', `${notices.length} Anzeigen aus ${inputFile} geladen (offline).`);
    return notices;
  }
  return sortNewestFirst(await loadNotices(api));
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function cmdList(config, opts) {
  const api = new WegliApi(config.apiKey);
  const store = new Store(STATE_FILE);
  const notices = sortNewestFirst(await loadNotices(api));
  const filtered = filterNotices(notices, config, opts);
  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }
  console.log('');
  printNotices(filtered, store);
  console.log('');
  console.log(
    `${filtered.length} von ${notices.length} Anzeigen (Filter: ${opts['all-days'] ? 'alle Tage' : `max. ${opts.days ?? config.gladbeck.maxAgeDays} Tage`}, ` +
      `${opts['all-zips'] ? 'alle PLZ' : `PLZ ${config.gladbeck.allowedZips.join('/')}`}).`
  );
}

async function cmdExport(config, opts) {
  const api = new WegliApi(config.apiKey);
  const notices = sortNewestFirst(await loadNotices(api));
  const filtered = filterNotices(notices, config, opts);
  const format = String(opts.format || 'json').toLowerCase();
  const out = path.resolve(ROOT, opts.out || `export/anzeigen.${format === 'csv' ? 'csv' : 'json'}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (format === 'csv') {
    const columns = [
      'token', 'status', 'start_date', 'end_date', 'street', 'zip', 'city', 'registration',
      'brand', 'color', 'tbnr', 'charge_description', 'fine', 'photos', 'note',
      'vehicle_empty', 'hazard_lights', 'expired_tuv', 'expired_eco', 'over_2_8_tons', 'sent_at',
    ];
    const rows = filtered.map((n) => [
      n.token, n.status, n.start_date, n.end_date, n.street, n.zip, n.city, n.registration,
      n.brand, n.color, n.tbnr, n.charge?.description, n.charge?.fine,
      (n.photos || []).map((p) => p.url).join(' | '), n.note,
      n.vehicle_empty, n.hazard_lights, n.expired_tuv, n.expired_eco, n.over_2_8_tons, n.sent_at,
    ]);
    const csv = '\uFEFF' + [columns, ...rows].map((r) => r.map(csvEscape).join(';')).join('\r\n');
    fs.writeFileSync(out, csv);
  } else if (format === 'json') {
    fs.writeFileSync(out, JSON.stringify(filtered, null, 2));
  } else {
    throw new Error(`Unbekanntes Format: ${format} (json oder csv)`);
  }
  log('ok', `${filtered.length} Anzeigen exportiert: ${out}`);

  if (opts.photos) {
    const dir = path.join(path.dirname(out), 'fotos');
    log('info', `Lade Fotos nach ${dir} …`);
    for (const n of filtered) {
      for (let i = 0; i < (n.photos || []).length; i++) {
        const ph = n.photos[i];
        const safe = `${i + 1}-${(ph.filename || 'foto.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const dest = path.join(dir, n.token, safe);
        try {
          const r = await api.downloadPhoto(ph.url, dest);
          log('info', `  ${n.token}: Foto ${i + 1} (${(r.bytes / 1024).toFixed(0)} KB)`);
        } catch (e) {
          log('warn', `  ${n.token}: Foto ${i + 1} fehlgeschlagen: ${e.message}`);
        }
      }
    }
  }
}

async function prepareNoticePhotos(notice, config, api) {
  const photoDir = path.join(config.cacheDir, 'photos', notice.token);
  const prepDir = path.join(config.cacheDir, 'prepared', notice.token);
  const paths = [];

  for (let i = 0; i < (notice.photos || []).length; i++) {
    const ph = notice.photos[i];
    if (!ph?.url) continue;
    const safe = `${i + 1}-${(ph.filename || 'foto.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const src = path.join(photoDir, safe);
    try {
      await api.downloadPhoto(ph.url, src);
      const out = path.join(prepDir, `${i + 1}.jpg`);
      const meta = await preparePhoto(src, out);
      paths.push(out);
      log('info', `  Foto ${i + 1}: ${(meta.bytes / 1024).toFixed(0)} KB (${meta.width}px, q${meta.quality})`);
    } catch (e) {
      log('warn', `  Foto ${i + 1} konnte nicht vorbereitet werden: ${e.message}`);
    }
  }
  return paths;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function cmdImport(config, opts) {
  const api = new WegliApi(config.apiKey);
  const store = new Store(STATE_FILE);
  const submit = !!opts.submit && !opts['dry-run'];

  const missing = missingPersonFields(config.person);
  if (missing.length) {
    throw new Error(
      `In config.json fehlen Pflichtangaben in "person": ${missing.join(', ')}. ` +
        'Diese Angaben werden im Gladbecker Formular als Anzeigeerstatter benötigt.'
    );
  }

  const notices = await loadSourceNotices(api, opts);
  let selected = filterNotices(notices, config, opts);

  if (opts.token) {
    if (selected.length === 0) throw new Error(`Anzeige ${opts.token} nicht gefunden.`);
    const n = selected[0];
    const age = ageInDays(n.start_date);
    if (age > config.gladbeck.maxAgeDays) {
      log('warn', `Diese Anzeige ist ${age} Tage alt. Das Gladbecker Formular akzeptiert laut Hinweis nur max. ${config.gladbeck.maxAgeDays} Tage.`);
    }
    if (!config.gladbeck.allowedZips.map(String).includes(String(n.zip))) {
      log('warn', `Diese Anzeige liegt in PLZ ${n.zip}, nicht in Gladbeck (${config.gladbeck.allowedZips.join('/')}).`);
    }
  }

  if (opts.limit) selected = selected.slice(0, Number(opts.limit));

  if (selected.length === 0) {
    log('warn', 'Keine passenden Anzeigen gefunden (Filter: Tage/PLZ/Status prüfen).');
    return;
  }

  console.log('');
  printNotices(selected, store);
  console.log('');
  console.log(`Modus: ${submit ? 'VERBINDLICH EINREICHEN' : 'nur vorbereiten (Trockenlauf)'} – ${selected.length} Anzeige(n).`);
  if (selected.some((n) => ageInDays(n.start_date) > config.gladbeck.maxAgeDays)) {
    log('warn', `Mindestens eine Anzeige ist älter als ${config.gladbeck.maxAgeDays} Tage.`);
  }

  if (submit && !opts.yes) {
    if (!process.stdin.isTTY) {
      throw new Error('Zum verbindlichen Einreichen bitte --yes angeben (nicht-interaktives Terminal).');
    }
    const answer = await ask('Wirklich verbindlich einreichen? [ja/NEIN] ');
    if (!/^(ja|j|yes|y)$/i.test(answer.trim())) {
      log('info', 'Abgebrochen.');
      return;
    }
  }

  const importer = new GladbeckImporter(config, {
    outputDir: config.outputDir,
    preview: !!opts.preview,
    headful: !!opts.headful || !!opts['keep-open'],
    pauseSeconds: Number(opts.pause || 0),
  });

  const summary = { submitted: 0, prepared: 0, failed: 0, skipped: 0 };
  let started = false;
  try {
    for (let i = 0; i < selected.length; i++) {
      const notice = selected[i];
      const label = `${berlinParts(notice.start_date).date} ${notice.zip} ${notice.registration || ''}`.trim();
      log('info', `\n[${i + 1}/${selected.length}] ${label} (${notice.token})`);

      const fingerprint = noticeFingerprint(notice);

      const blocked = store.isBlocked(notice.token, !!opts.force);
      if (blocked) {
        log('warn', `  Übersprungen: ${blocked}`);
        summary.skipped++;
        continue;
      }

      const marker = config.import.skipNoteMarker;
      if (marker && new RegExp(marker, 'i').test(notice.note || '')) {
        log('warn', `  Übersprungen: weg.li-Notiz enthält den Marker "${marker}".`);
        summary.skipped++;
        continue;
      }

      const dupe = store.findByFingerprint(fingerprint, notice.token);
      if (dupe && (!opts.force || dupe.status === 'manual')) {
        log(
          'warn',
          `  Übersprungen: gleiche Anzeige wurde bereits als "${dupe.status}" erfasst (Token ${dupe.token}).` +
            (dupe.status === 'manual' ? ' Manuelle Markierung entfernen mit "mark --unmark".' : ' Mit --force trotzdem versuchen.')
        );
        summary.skipped++;
        continue;
      }

      if (!started) {
        await importer.start();
        started = true;
      }

      try {
        const photoPaths = await prepareNoticePhotos(notice, config, api);
        if (photoPaths.length === 0) throw new Error('Keine Fotos vorhanden/abrufbar – das Formular verlangt mindestens ein Foto.');
        const plan = assignPhotos(photoPaths, config.import.photoMode);
        for (const w of plan.warnings) log('warn', `  ${w}`);

        const offenses = mapOffenses(notice, config.import.tbnrMap);
        log('info', `  Tatbestand: ${notice.tbnr} -> ${offenses.join(', ')}`);

        if (submit) store.set(notice.token, { status: 'submitting', at: new Date().toISOString(), fingerprint, start_date: notice.start_date, zip: notice.zip, registration: notice.registration });

        const result = await importer.importNotice(notice, plan, { submit });

        store.set(notice.token, {
          status: result.status,
          at: new Date().toISOString(),
          fingerprint,
          start_date: notice.start_date,
          zip: notice.zip,
          registration: notice.registration,
          offenses: result.offenses,
          warnings: result.warnings,
          evidence: result.evidence,
          error: null,
        });

        if (result.status === 'submitted') {
          summary.submitted++;
          log('ok', `  Verbindlich eingereicht. Beleg: ${result.evidence?.png || ''}`);
        } else {
          summary.prepared++;
          log('ok', `  Vorbereitet (nicht eingereicht). Beleg: ${result.evidence?.png || ''}`);
        }
      } catch (error) {
        const status = error.result?.status === 'submitting' ? 'submitting' : 'failed';
        store.set(notice.token, {
          status,
          at: new Date().toISOString(),
          fingerprint,
          start_date: notice.start_date,
          zip: notice.zip,
          registration: notice.registration,
          error: error.message,
        });
        summary.failed++;
        log('error', `  Fehlgeschlagen: ${error.message}`);
        if (status === 'submitting') {
          log('warn', '  ACHTUNG: Die Einreichung wurde angeklickt, aber nicht bestätigt. Bitte im Portal/Postfach prüfen, bevor erneut versucht wird.');
        }
      }

      if (i < selected.length - 1 && config.gladbeck.delaySeconds > 0) {
        log('info', `  Warte ${config.gladbeck.delaySeconds}s bis zur nächsten Anzeige …`);
        await sleep(config.gladbeck.delaySeconds * 1000);
      }
    }
  } finally {
    if (started) await importer.stop();
  }

  console.log('');
  log('info', `Fertig: ${summary.submitted} eingereicht, ${summary.prepared} vorbereitet, ${summary.failed} fehlgeschlagen, ${summary.skipped} übersprungen.`);
  if (summary.prepared > 0) log('info', 'Vorbereitete Anzeigen sind NICHT bei der Stadt eingegangen. Zum Einreichen erneut mit --submit --yes starten.');
}


function normalizePlate(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

async function cmdMark(config, opts) {
  const api = new WegliApi(config.apiKey);
  const store = new Store(STATE_FILE);
  const notices = await loadSourceNotices(api, opts);

  if (!opts.token && !opts.plate) {
    throw new Error('Bitte --token <token> oder --plate "GLA AB 123" angeben.');
  }

  let matches = notices;
  if (opts.token) {
    matches = matches.filter((n) => n.token === opts.token);
  }
  if (opts.plate) {
    const wanted = normalizePlate(opts.plate);
    matches = matches.filter((n) => normalizePlate(n.registration) === wanted);
  }
  if (opts.date) {
    matches = matches.filter((n) => berlinParts(n.start_date).date === String(opts.date));
  }

  if (matches.length === 0) {
    throw new Error('Keine passende Anzeige gefunden. Bitte Token, Kennzeichen und ggf. Datum prüfen.');
  }
  if (matches.length > 1) {
    console.log('');
    printNotices(matches, store);
    console.log('');
    throw new Error(
      `Mehrere Anzeigen gefunden (${matches.length}). Bitte mit --date TT.MM.JJJJ oder --token eindeutig auswählen.`
    );
  }

  const notice = matches[0];
  const when = `${berlinParts(notice.start_date).date} ${berlinParts(notice.start_date).time}`;

  if (opts.unmark) {
    const removed = store.remove(notice.token);
    log(removed ? 'ok' : 'warn', removed
      ? `Markierung für ${notice.registration} (${when}, ${notice.token}) entfernt.`
      : `Für ${notice.registration} (${when}, ${notice.token}) war keine Markierung gesetzt.`);
    return;
  }

  const existing = store.get(notice.token);
  const note = String(opts.note || existing?.note || 'Manuell in Gladbeck eingereicht');
  store.set(notice.token, {
    status: 'manual',
    at: new Date().toISOString(),
    fingerprint: noticeFingerprint(notice),
    start_date: notice.start_date,
    zip: notice.zip,
    registration: notice.registration,
    note,
  });
  log('ok', `${notice.registration} (${when}, ${notice.token}) als manuell eingereicht markiert.`);
  log('info', 'Diese Anzeige wird beim Import übersprungen (auch über den Fingerabdruck PLZ+Kennzeichen+Zeit+TBNR).');

  if (opts.wegli) {
    const marker = `[GLA-Fremdanzeige eingereicht am ${berlinParts(notice.start_date).date}]`;
    if (String(notice.note || '').includes(marker)) {
      log('info', 'weg.li-Notiz enthält den Marker bereits.');
      return;
    }
    if (notice.status !== 'open') {
      log('warn', `weg.li-Marker nicht möglich: Die Anzeige hat den Status "${notice.status}".`);
      log('info', 'Die weg.li-API erlaubt das Ändern der Notiz nur bei offenen Meldungen (Status "open"). Bereits geteilte Anzeigen ("shared") lassen sich per API nicht mehr bearbeiten.');
      return;
    }
    try {
      const fullNote = [String(notice.note || '').trim(), marker].filter(Boolean).join('\n');
      await api.updateNotice(notice.token, { note: fullNote });
      store.set(notice.token, { wegliMarker: marker });
      log('ok', `weg.li-Notiz aktualisiert: ${marker}`);
    } catch (e) {
      log('warn', `weg.li-Marker konnte nicht gesetzt werden: ${e.message}`);
    }
  }
}


async function cmdProfile(config, opts) {
  if (opts.anrede && !['Herr', 'Frau', 'Divers'].includes(opts.anrede)) {
    throw new Error('--anrede muss "Herr", "Frau" oder "Divers" sein.');
  }

  let profile;
  if (opts.html) {
    const rawPath = String(opts.html).replace(/^~(?=$|[\\/])/, process.env.HOME || '');
    const file = path.resolve(ROOT, rawPath);
    if (!fs.existsSync(file)) throw new Error(`HTML-Datei nicht gefunden: ${file}`);
    profile = extractProfileFromHtml(fs.readFileSync(file, 'utf8'));
    log('info', `Profil aus ${file} gelesen.`);
  } else {
    profile = await readProfileFromBrowser({
      chromePath: config.gladbeck.chromePath || undefined,
      userDataDir: path.join(ROOT, '.chrome-profile'),
      timeoutMs: Number(opts.timeout || 600) * 1000,
      keepOpen: !!opts['keep-open'],
      log,
    });
  }

  const { person, warnings } = mapProfileToPerson(profile, config.person, opts.anrede || '');

  console.log('');
  console.log('Aus weg.li übernommen:');
  console.log(JSON.stringify(person, null, 2));
  console.log('');
  if (warnings.length) {
    for (const warning of warnings) log('warn', warning);
  } else {
    log('ok', 'Alle Felder konnten zugeordnet werden.');
  }

  if (!opts.write) {
    log('info', 'Trockenlauf: config.json wurde nicht geändert. Mit --write übernehmen.');
    return;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) throw new Error('Zum Schreiben bitte --yes angeben.');
    const answer = await ask('Diese Daten in config.json übernehmen? [ja/NEIN] ');
    if (!/^(ja|j|yes|y)$/i.test(answer.trim())) {
      log('info', 'Abgebrochen.');
      return;
    }
  }

  const raw = fs.existsSync(config.configFile)
    ? JSON.parse(fs.readFileSync(config.configFile, 'utf8'))
    : {};
  raw.person = person;
  fs.writeFileSync(config.configFile, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(config.configFile, 0o600);
  log('ok', `config.json aktualisiert: ${config.configFile}`);
}

async function cmdDoctor(config) {
  let ok = true;
  const check = (name, fn) => {
    try {
      const msg = fn();
      log('ok', `${name}: ${msg}`);
    } catch (e) {
      ok = false;
      log('error', `${name}: ${e.message}`);
    }
  };

  check('Node.js', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error(`Version ${process.versions.node} ist zu alt (mind. 18).`);
    return process.versions.node;
  });

  check('weg.li API-Key', () => (config.apiKey ? `vorhanden (${maskKey(config.apiKey)})` : (() => { throw new Error('WEGLI_API_KEY fehlt in .env'); })()));

  if (config.apiKey) {
    try {
      const api = new WegliApi(config.apiKey);
      const notices = await api.request('/notices', { page: 1 });
      log('ok', `weg.li API: erreichbar, ${Array.isArray(notices) ? notices.length : 0} Anzeigen auf Seite 1.`);
    } catch (e) {
      ok = false;
      log('error', `weg.li API: ${e.message}`);
    }
  }

  check('Chrome', () => {
    const p = config.gladbeck.chromePath || findChrome();
    if (!fs.existsSync(p)) throw new Error(`nicht gefunden: ${p}`);
    return p;
  });

  check('Konfiguration (Anzeigeerstatter)', () => {
    const missing = missingPersonFields(config.person);
    if (missing.length) throw new Error(`fehlende Felder: ${missing.join(', ')}`);
    return 'vollständig';
  });

  check('Ausgabeordner', () => {
    fs.mkdirSync(config.outputDir, { recursive: true });
    const test = path.join(config.outputDir, '.write-test');
    fs.writeFileSync(test, 'ok');
    fs.unlinkSync(test);
    return config.outputDir;
  });

  check('Cache-Ordner', () => {
    fs.mkdirSync(config.cacheDir, { recursive: true });
    return config.cacheDir;
  });

  check('sharp (Bildverarbeitung)', () => {
    const sharp = require('sharp');
    return `Version ${sharp.versions?.sharp || require('sharp/package.json').version}`;
  });

  console.log('');
  log(ok ? 'ok' : 'error', ok ? 'Alle Prüfungen bestanden.' : 'Bitte die markierten Punkte beheben.');
  process.exitCode = ok ? 0 : 1;
}

function printHelp() {
  console.log(`
weg.li -> Gladbeck Fremdanzeigen

Verwendung:
  node cli.js doctor
  node cli.js list [--days 5] [--all-days] [--all-zips] [--json]
  node cli.js export [--format json|csv] [--out datei] [--photos] [--all-days] [--all-zips]
  node cli.js import [--token TOKEN] [--input export.json] [--days 5] [--all-days]
                     [--all-zips] [--limit N] [--submit --yes] [--preview] [--headful]
                     [--keep-open] [--pause SEK] [--force]
  node cli.js mark --token TOKEN [--note TEXT] [--wegli] [--unmark]
  node cli.js mark --plate "GLA AB 123" [--date TT.MM.JJJJ] [--note TEXT] [--wegli] [--unmark]
  node cli.js profile [--browser] [--html DATEI] [--anrede Herr|Frau|Divers]
                      [--write --yes] [--timeout SEK] [--keep-open]

Die weg.li-API liefert keine Profildaten. "profile" liest sie aus der
eingeloggten weg.li-Profilseite (Browser) oder aus einer gespeicherten HTML-Datei.

Bereits eingereichte Anzeigen werden über state.json (Token und Fingerabdruck)
erkannt und übersprungen. Manuell eingereichte Anzeigen mit "mark" markieren.

Standardmäßig werden Anzeigen nur vorbereitet (Trockenlauf) und NICHT eingereicht.
Erst mit "--submit --yes" wird "Verbindlich einreichen" geklickt.

Beispiele:
  node cli.js list --all-days
  node cli.js import --days 5 --limit 3 --preview
  node cli.js import --token 0123456789abcdef0123456789abcdef --headful --keep-open --pause 120
  node cli.js import --all-days --submit --yes
  node cli.js import --input export/anzeigen.json --days 5 --limit 1
  node cli.js mark --plate "GLA AB 123" --date 15.11.2026 --note "manuell eingereicht"
  node cli.js mark --plate "GLA AB 123" --date 15.11.2026 --unmark
  node cli.js profile --browser --anrede Herr --write
  node cli.js profile --html ~/wegli-profil.html --write
`);
}

(async () => {
  const { command, opts } = parseArgs(process.argv);
  try {
    if (command === 'help' || command === '--help' || command === '-h') return printHelp();
    const config = loadConfig(opts.config ? path.resolve(ROOT, opts.config) : undefined);

    if (command === 'doctor') return await cmdDoctor(config);
    if (command === 'list') return await cmdList(config, opts);
    if (command === 'export') return await cmdExport(config, opts);
    if (command === 'import') return await cmdImport(config, opts);
    if (command === 'mark') return await cmdMark(config, opts);
    if (command === 'profile') return await cmdProfile(config, opts);
    printHelp();
    process.exitCode = 1;
  } catch (error) {
    log('error', error.message);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  }
})();
