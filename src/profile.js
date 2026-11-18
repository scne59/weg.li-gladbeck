'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { sleep, log, splitStreet } = require('./util');
const { findChrome } = require('./gladbeck');

const PROFILE_URL = 'https://www.weg.li/user/edit';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/** Liest den value eines <input name="..."> aus gespeichertem HTML. */
function inputValue(html, name) {
  const tagRe = new RegExp(`<input\\b[^>]*\\bname\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*>`, 'i');
  const tag = String(html).match(tagRe)?.[0];
  if (!tag) return '';
  const valueRe = /(?:^|\s)value\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;
  const m = tag.match(valueRe);
  if (!m) return '';
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim();
}

function extractProfileFromHtml(html) {
  return {
    name: inputValue(html, 'user[name]'),
    street: inputValue(html, 'user[street]'),
    city: inputValue(html, 'user[city]'),
    zip: inputValue(html, 'user[zip]'),
    appendix: inputValue(html, 'user[appendix]'),
    date_of_birth: inputValue(html, 'user[date_of_birth]'),
    phone: inputValue(html, 'user[phone]'),
    email: inputValue(html, 'user[email]'),
  };
}

const NAME_PARTICLES = new Set(['von', 'van', 'de', 'der', 'den', 'zu', 'zur', 'du', 'la', 'le', 'di', 'da', 'dos', 'das']);

/** "Max von der Leyen" -> { vorname: "Max", name: "von der Leyen" } */
function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { vorname: '', name: '' };
  if (parts.length === 1) return { vorname: '', name: parts[0] };
  let i = parts.length - 1;
  while (i > 1 && NAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { vorname: parts.slice(0, i).join(' '), name: parts.slice(i).join(' ') };
}

function normalizeBirth(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
  return v;
}

function mapProfileToPerson(profile, currentPerson = {}, anredeOverride = '') {
  const warnings = [];
  const { vorname, name } = splitFullName(profile.name);
  const { street, houseNumber } = splitStreet(profile.street);
  const birth = normalizeBirth(profile.date_of_birth);
  const anrede = anredeOverride || currentPerson.anrede || '';

  if (!profile.name) warnings.push('Kein Name im Profil gefunden.');
  if (!vorname) warnings.push('Vorname konnte nicht aus dem weg.li-Namen abgeleitet werden.');
  if (!profile.street) warnings.push('Keine Straße im Profil gefunden.');
  if (!houseNumber) warnings.push('Keine Hausnummer in der weg.li-Adresse erkannt – bitte manuell prüfen.');
  if (!birth) warnings.push('Kein Geburtsdatum in weg.li hinterlegt – bestehenden Wert beibehalten.');
  if (profile.appendix) warnings.push(`weg.li-Zusatz "${profile.appendix}" (c/o) kann im Gladbecker Formular nicht abgebildet werden.`);
  if (!anrede) warnings.push('Anrede wird von weg.li nicht gespeichert – bitte mit --anrede setzen (Herr/Frau/Divers).');

  return {
    person: {
      ...currentPerson,
      anrede,
      name: name || currentPerson.name || '',
      vorname: vorname || currentPerson.vorname || '',
      strasse: street || currentPerson.strasse || '',
      hausnummer: houseNumber || currentPerson.hausnummer || '',
      plz: profile.zip || currentPerson.plz || '',
      ort: profile.city || currentPerson.ort || '',
      geburtsdatum: birth || currentPerson.geburtsdatum || '',
      telefon: profile.phone || currentPerson.telefon || '',
      email: profile.email || currentPerson.email || '',
    },
    warnings,
    profile,
  };
}

function browserExtractScript() {
  return () => {
    const val = (name) => document.querySelector(`[name="${name}"]`)?.value || '';
    return {
      name: val('user[name]'),
      street: val('user[street]'),
      city: val('user[city]'),
      zip: val('user[zip]'),
      appendix: val('user[appendix]'),
      date_of_birth: val('user[date_of_birth]'),
      phone: val('user[phone]'),
      email: val('user[email]'),
    };
  };
}

/**
 * Öffnet die weg.li-Profilseite in einem sichtbaren Browser. Der Nutzer meldet
 * sich manuell an; danach werden die Profilfelder ausgelesen.
 */
async function readProfileFromBrowser(options = {}) {
  const profileUrl = options.profileUrl || PROFILE_URL;
  const timeoutMs = options.timeoutMs || 600000;
  const userDataDir = options.userDataDir || path.join(process.cwd(), '.chrome-profile');
  const executablePath = options.chromePath || findChrome();

  log('info', `Öffne ${profileUrl} im Browser …`);
  log('info', 'Bitte bei weg.li einloggen. Das Tool wartet, bis das Profilformular sichtbar ist.');

  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=de-DE', '--start-maximized'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    let navigated = false;
    let lastHint = 0;
    while (Date.now() < deadline) {
      const pages = await browser.pages().catch(() => []);
      for (const p of pages) {
        try {
          const url = p.url();
          const data = await p.evaluate(browserExtractScript());
          if (data.name && data.name.trim()) {
            return data;
          }

          // Nach dem Login landet man oft auf /notices. Einmalig zum Profil navigieren.
          if (
            !navigated &&
            /^https:\/\/www\.weg\.li\//.test(url) &&
            !/\/auth\//.test(url) &&
            !/\/login/.test(url) &&
            !/\/user\/edit/.test(url)
          ) {
            navigated = true;
            p.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          }
        } catch {
          // Seite befindet sich ggf. gerade in Navigation
        }
      }

      if (Date.now() - lastHint > 30000) {
        lastHint = Date.now();
        log('info', 'Warte auf weg.li-Login/Profil … (Browser offen lassen)');
      }
      await sleep(1000);
    }
    throw new Error(
      'Zeitüberschreitung: Profilformular nicht gefunden. Bitte einloggen und https://www.weg.li/user/edit öffnen, oder --html mit einer gespeicherten Profilseite verwenden.'
    );
  } finally {
    if (!options.keepOpen) await browser.close().catch(() => {});
  }
}

module.exports = {
  PROFILE_URL,
  extractProfileFromHtml,
  mapProfileToPerson,
  readProfileFromBrowser,
  splitFullName,
  normalizeBirth,
  inputValue,
};
