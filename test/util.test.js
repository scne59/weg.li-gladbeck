'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitStreet, noticeFingerprint, berlinParts, truncate } = require('../src/util');

test('splitStreet trennt Straße und Hausnummer', () => {
  assert.deepEqual(splitStreet('Musterstraße 12a'), { street: 'Musterstraße', houseNumber: '12a' });
  assert.deepEqual(splitStreet('Willy-Brandt-Platz 2'), { street: 'Willy-Brandt-Platz', houseNumber: '2' });
  assert.deepEqual(splitStreet('Hauptstr. 12 - 14'), { street: 'Hauptstr.', houseNumber: '12 - 14' });
});

test('splitStreet lässt Adressen ohne Hausnummer unverändert', () => {
  assert.deepEqual(splitStreet('Ohne Hausnummer'), { street: 'Ohne Hausnummer', houseNumber: '' });
  assert.deepEqual(splitStreet(''), { street: '', houseNumber: '' });
});

test('noticeFingerprint ist unabhängig von Schreibweise und Zeitzone', () => {
  const a = noticeFingerprint({
    zip: '45966',
    registration: 'GLA AB 123',
    start_date: '2026-11-15T17:07:00.000+01:00',
    tbnr: '112656',
  });
  const b = noticeFingerprint({
    zip: '45966',
    registration: 'gla-ab-123',
    start_date: '2026-11-15T16:07:00.000Z',
    tbnr: '112656',
  });
  assert.equal(a, b);
  assert.equal(a, '45966|GLAAB123|2026-11-15T16:07|112656');
});

test('berlinParts rechnet UTC nach Europe/Berlin', () => {
  const p = berlinParts('2026-11-15T16:07:00.000Z');
  assert.equal(p.date, '15.11.2026');
  assert.equal(p.time, '17:07');
  assert.equal(p.hour, '17');
  assert.equal(p.minute, '07');
});

test('truncate kürzt und setzt ein Auslassungszeichen', () => {
  assert.equal(truncate('abcdef', 10), 'abcdef');
  assert.equal(truncate('abcdef', 5), 'abcd…');
});
