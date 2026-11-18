'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapOffenses,
  buildDescription,
  vehicleType,
  brand,
  registration,
  isImportableStatus,
} = require('../src/mapping');

test('bekannte TBNR werden auf die richtigen Checkboxen abgebildet', () => {
  assert.deepEqual(mapOffenses({ tbnr: '112656' }), ['Gehweg']);
  assert.deepEqual(mapOffenses({ tbnr: '112474' }), ['Radweg']);
  assert.deepEqual(mapOffenses({ tbnr: '141194' }), ['Gehweg', 'Radweg']);
});

test('unbekannte TBNR werden über die Beschreibung zugeordnet', () => {
  assert.deepEqual(
    mapOffenses({ tbnr: '999999', charge: { description: 'Sie parkten im absoluten Haltverbot.' } }),
    ['absolutes Haltverbot']
  );
  assert.deepEqual(
    mapOffenses({ tbnr: '999999', charge: { description: 'Sie parkten in einer Feuerwehrzufahrt.' } }),
    ['Feuerwehrzufahrt']
  );
});

test('ohne Treffer wird "sonstiger Halt- oder Parkverstoß" gewählt', () => {
  assert.deepEqual(mapOffenses({ tbnr: '999999', charge: { description: 'Unbekannter Sachverhalt' } }), [
    'sonstiger Halt- oder Parkverstoß',
  ]);
});

test('eigene TBNR-Zuordnung überschreibt die Standardzuordnung', () => {
  assert.deepEqual(mapOffenses({ tbnr: '112656' }, { 112656: ['Radweg'] }), ['Radweg']);
});

test('buildDescription enthält Tatbestand, Notiz und Flags', () => {
  const text = buildDescription({
    token: 'abc',
    tbnr: '112656',
    charge: { description: 'Sie parkten auf dem Gehweg.' },
    note: 'Fahrzeug blockiert den Durchgang.',
    color: 'rot',
    vehicle_empty: true,
    hazard_lights: true,
  });
  assert.match(text, /Sie parkten auf dem Gehweg/);
  assert.match(text, /Fahrzeug blockiert den Durchgang/);
  assert.match(text, /Farbe: rot/);
  assert.match(text, /unbesetzt/);
  assert.match(text, /Warnblinker/);
});

test('Fahrzeug-Standardwerte', () => {
  assert.equal(vehicleType({}, {}), 'PKW (Auto)');
  assert.equal(brand({ brand: 'Seat' }), 'Seat');
  assert.equal(brand({}), 'Unbekannt');
  assert.equal(registration({ registration: 'GLA AB 123' }), 'GLA AB 123');
});

test('Entwürfe/unvollständige Anzeigen gelten nicht als importierbar', () => {
  assert.equal(isImportableStatus({ status: 'shared' }), true);
  assert.equal(isImportableStatus({ status: 'open' }), true);
  assert.equal(isImportableStatus({ status: 'draft' }), false);
  assert.equal(isImportableStatus({ status: 'incomplete' }), false);
});
