'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/store');

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wegli-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  return { dir, file, store: new Store(file) };
}

test('submitted blockiert, --force hebt die Sperre auf', (t) => {
  const { store } = tempStore(t);
  store.set('abc', { status: 'submitted', at: '2026-01-01T00:00:00.000Z' });

  assert.match(store.isBlocked('abc'), /Bereits eingereicht/);
  assert.equal(store.isBlocked('abc', true), null);
});

test('manual blockiert auch mit --force', (t) => {
  const { store } = tempStore(t);
  store.set('abc', { status: 'manual', note: 'manuell eingereicht' });

  assert.match(store.isBlocked('abc', true), /Manuell/);
});

test('submitting blockiert und weist auf manuelle Prüfung hin', (t) => {
  const { store } = tempStore(t);
  store.set('abc', { status: 'submitting' });

  assert.match(store.isBlocked('abc'), /nicht bestätigt/);
  assert.equal(store.isBlocked('abc', true), null);
});

test('findByFingerprint findet manuelle Markierungen unabhängig vom Token', (t) => {
  const { store } = tempStore(t);
  store.set('abc', { status: 'manual', fingerprint: '45966|GLAAB123|2026-11-15T16:07|112656' });

  const match = store.findByFingerprint('45966|GLAAB123|2026-11-15T16:07|112656', 'other');
  assert.equal(match.token, 'abc');
  assert.equal(match.status, 'manual');
  assert.equal(store.findByFingerprint('45966|GLAAB123|2026-11-15T16:07|112656', 'abc'), null);
});

test('remove löscht eine Markierung', (t) => {
  const { store } = tempStore(t);
  store.set('abc', { status: 'manual' });
  assert.equal(store.remove('abc'), true);
  assert.equal(store.get('abc'), null);
  assert.equal(store.remove('abc'), false);
});

test('state.json wird mit Modus 600 geschrieben', (t) => {
  const { store, file } = tempStore(t);
  store.set('abc', { status: 'manual' });

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
});
