'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { DEFAULT_SERVICE_URL } = require('./gladbeck');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_FILE = path.join(ROOT, 'config.json');

const DEFAULTS = {
  person: {
    anrede: 'Herr',
    name: '',
    vorname: '',
    strasse: '',
    hausnummer: '',
    plz: '',
    ort: '',
    geburtsdatum: '',
    telefon: '',
    email: '',
  },
  gladbeck: {
    serviceUrl: DEFAULT_SERVICE_URL,
    fahrzeugart: 'PKW (Auto)',
    headless: true,
    chromePath: null,
    delaySeconds: 30,
    maxAgeDays: 5,
    allowedZips: ['45964', '45966', '45968'],
  },
  import: {
    photoMode: 'auto',
    includeTokenInDescription: false,
    tbnrMap: {},
    // Anzeigen mit diesem Marker in der weg.li-Notiz werden übersprungen.
    skipNoteMarker: '\\[GLA-Fremdanzeige[^\\]]*\\]',
  },
  outputDir: path.join(ROOT, 'output'),
  cacheDir: path.join(ROOT, 'cache'),
};

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (over && typeof over === 'object') {
      for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
    }
    return out;
  }
  return over === undefined ? base : over;
}

function loadEnv(envFile = path.join(ROOT, '.env')) {
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });
}

function loadConfig(configFile = DEFAULT_CONFIG_FILE) {
  loadEnv();
  let user = {};
  if (fs.existsSync(configFile)) {
    try {
      user = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (e) {
      throw new Error(`config.json ist kein gültiges JSON: ${e.message}`);
    }
  }
  const config = deepMerge(DEFAULTS, user);
  config.configFile = configFile;
  config.apiKey = process.env.WEGLI_API_KEY || config.apiKey || '';
  config.outputDir = path.resolve(ROOT, process.env.PARKEN_OUTPUT_DIR || config.outputDir);
  config.cacheDir = path.resolve(ROOT, process.env.PARKEN_CACHE_DIR || config.cacheDir);
  return config;
}

function missingPersonFields(person) {
  const required = ['anrede', 'name', 'vorname', 'strasse', 'hausnummer', 'plz', 'ort', 'geburtsdatum', 'email'];
  return required.filter((k) => !String(person?.[k] ?? '').trim());
}

module.exports = { loadConfig, loadEnv, missingPersonFields, DEFAULTS, ROOT, DEFAULT_CONFIG_FILE };
