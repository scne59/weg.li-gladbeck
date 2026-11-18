'use strict';

const { asArray, truncate } = require('./util');

/**
 * Zuordnung weg.li-Tatbestand (TBNR) -> Checkboxen im Gladbecker Formular.
 * Die Checkbox-Texte müssen exakt den Labels im Formular entsprechen.
 */
const OFFENSE_LABELS = [
  'Anlieger Frei',
  'Gehweg',
  'absolutes Haltverbot',
  'eingeschränktes Haltverbot',
  'eingeschränktes Haltverbot mit Ladezone',
  'Schwerbehindertenparkplatz',
  'Parkfläche für E-Fahrzeuge',
  'Grundstückszufahrt',
  'Radweg',
  'Haltestellenbereich',
  'Verkehrsberuhigter Bereich',
  'Feuerwehrzufahrt',
  'Fußgängerzone',
  '5-Meter-Bereich Kreuzung/Einmündung',
  'Zweite Reihe',
  'Sperrfläche',
  'sonstiger Halt- oder Parkverstoß',
];

const TBNR_MAP = {
  // Gehweg
  '112454': ['Gehweg'],
  '112655': ['Gehweg'],
  '112656': ['Gehweg'],
  // Radweg / Radfahrstreifen
  '112474': ['Radweg'],
  '141174': ['Radweg'],
  // Geh- und Radweg (Zeichen 240/241)
  '141194': ['Gehweg', 'Radweg'],
  '141775': ['Radweg'],
};

const RULES = [
  [/geh-?\s*und\s*radweg|gemeinsamer\s+geh-\s*und\s*radweg/i, ['Gehweg', 'Radweg']],
  [/gehweg/i, ['Gehweg']],
  [/radweg|radfahrstreifen/i, ['Radweg']],
  [/eingeschränkte[snmr]?\s+haltverbot.{0,20}ladezone/i, ['eingeschränktes Haltverbot mit Ladezone']],
  [/eingeschränkte[snmr]?\s+haltverbot/i, ['eingeschränktes Haltverbot']],
  [/absolute[nrs]?\s+haltverbot/i, ['absolutes Haltverbot']],
  [/feuerwehr/i, ['Feuerwehrzufahrt']],
  [/fußgängerzone|fussgängerzone/i, ['Fußgängerzone']],
  [/schwerbehindert/i, ['Schwerbehindertenparkplatz']],
  [/e-?fahrzeug|elektro|ladesäule/i, ['Parkfläche für E-Fahrzeuge']],
  [/grundstückszufahrt|einfahrt/i, ['Grundstückszufahrt']],
  [/haltestelle/i, ['Haltestellenbereich']],
  [/verkehrsberuhigt/i, ['Verkehrsberuhigter Bereich']],
  [/zweite\s+reihe/i, ['Zweite Reihe']],
  [/sperrfläche/i, ['Sperrfläche']],
  [/5-?\s*meter|kreuzung|einmündung/i, ['5-Meter-Bereich Kreuzung/Einmündung']],
  [/anlieger/i, ['Anlieger Frei']],
];

function mapOffenses(notice, overrideTbnrMap = {}) {
  const tbnr = String(notice?.tbnr ?? '');
  const overrides = { ...TBNR_MAP, ...overrideTbnrMap };

  if (Array.isArray(overrides[tbnr]) && overrides[tbnr].length) {
    return overrides[tbnr].filter((l) => OFFENSE_LABELS.includes(l));
  }
  if (typeof overrides[tbnr] === 'string' && OFFENSE_LABELS.includes(overrides[tbnr])) {
    return [overrides[tbnr]];
  }

  const description = notice?.charge?.description || '';
  for (const [re, labels] of RULES) {
    if (re.test(description)) return labels;
  }
  return ['sonstiger Halt- oder Parkverstoß'];
}

function buildDescription(notice, options = {}) {
  const parts = [];
  const charge = notice?.charge?.description;
  if (charge) parts.push(charge.trim());

  if (notice?.note && notice.note.trim()) {
    parts.push(`Anmerkung: ${notice.note.trim()}`);
  }

  const flags = [];
  if (notice?.vehicle_empty) flags.push('Fahrzeug war unbesetzt');
  if (notice?.hazard_lights) flags.push('Warnblinker war eingeschaltet');
  if (notice?.expired_tuv) flags.push('HU/TÜV abgelaufen');
  if (notice?.expired_eco) flags.push('Umweltplakette abgelaufen');
  if (notice?.over_2_8_tons) flags.push('Fahrzeug über 2,8 t');
  if (notice?.color) flags.push(`Farbe: ${notice.color}`);
  if (flags.length) parts.push(flags.join('; '));
  if (options.includeToken && notice?.token) parts.push(`weg.li-Referenz: ${notice.token}`);

  return truncate(parts.join('\n\n'), 1800);
}

function vehicleType(notice, config) {
  return config?.gladbeck?.fahrzeugart || 'PKW (Auto)';
}

function brand(notice) {
  const b = (notice?.brand || '').trim();
  return b || 'Unbekannt';
}

function registration(notice) {
  return (notice?.registration || '').trim();
}

function isImportableStatus(notice) {
  const s = String(notice?.status || '').toLowerCase();
  return !['draft', 'incomplete', 'entwurf', 'unvollständig'].includes(s);
}

module.exports = {
  OFFENSE_LABELS,
  TBNR_MAP,
  mapOffenses,
  buildDescription,
  vehicleType,
  brand,
  registration,
  isImportableStatus,
};
