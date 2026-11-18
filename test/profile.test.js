'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitFullName,
  normalizeBirth,
  extractProfileFromHtml,
  mapProfileToPerson,
} = require('../src/profile');

test('splitFullName trennt Vor- und Nachname', () => {
  assert.deepEqual(splitFullName('Max Mustermann'), { vorname: 'Max', name: 'Mustermann' });
  assert.deepEqual(splitFullName('Max Peter Mustermann'), { vorname: 'Max Peter', name: 'Mustermann' });
  assert.deepEqual(splitFullName('Max von der Leyen'), { vorname: 'Max', name: 'von der Leyen' });
  assert.deepEqual(splitFullName('Mustermann'), { vorname: '', name: 'Mustermann' });
  assert.deepEqual(splitFullName(''), { vorname: '', name: '' });
});

test('normalizeBirth liefert TT.MM.JJJJ', () => {
  assert.equal(normalizeBirth('1985-01-01'), '01.01.1985');
  assert.equal(normalizeBirth('1.1.1985'), '01.01.1985');
  assert.equal(normalizeBirth('01.01.1985'), '01.01.1985');
  assert.equal(normalizeBirth(''), '');
});

test('extractProfileFromHtml liest die weg.li-Profilfelder', () => {
  const html = `
    <form>
      <input class="form-control" type="text" value="Max Mustermann" name="user[name]" id="user_name">
      <input type="text" value="Musterstraße 12a" name="user[street]" id="user_street">
      <input type="text" value="Gladbeck" name="user[city]" id="user_city">
      <input type="text" value="45964" name="user[zip]" id="user_zip">
      <input type="text" value="" name="user[appendix]" id="user_appendix">
      <input type="date" value="1985-01-01" name="user[date_of_birth]" id="user_date_of_birth">
      <input type="text" value="02043 123456" name="user[phone]" id="user_phone">
      <input type="email" value="max@example.de" name="user[email]" id="user_email">
    </form>
  `;
  assert.deepEqual(extractProfileFromHtml(html), {
    name: 'Max Mustermann',
    street: 'Musterstraße 12a',
    city: 'Gladbeck',
    zip: '45964',
    appendix: '',
    date_of_birth: '1985-01-01',
    phone: '02043 123456',
    email: 'max@example.de',
  });
});

test('extractProfileFromHtml dekodiert HTML-Entities', () => {
  const html = '<input name="user[name]" value="Max &quot;Maxi&quot; M&amp;M">';
  assert.equal(extractProfileFromHtml(html).name, 'Max "Maxi" M&M');
});

test('mapProfileToPerson übernimmt die Profildaten und behält die Anrede', () => {
  const { person, warnings } = mapProfileToPerson(
    {
      name: 'Max Mustermann',
      street: 'Musterstraße 12a',
      city: 'Gladbeck',
      zip: '45964',
      appendix: '',
      date_of_birth: '1985-01-01',
      phone: '02043 123456',
      email: 'max@example.de',
    },
    { anrede: 'Herr', telefon: 'alt' }
  );

  assert.deepEqual(person, {
    anrede: 'Herr',
    name: 'Mustermann',
    vorname: 'Max',
    strasse: 'Musterstraße',
    hausnummer: '12a',
    plz: '45964',
    ort: 'Gladbeck',
    geburtsdatum: '01.01.1985',
    telefon: '02043 123456',
    email: 'max@example.de',
  });
  assert.equal(warnings.length, 0);
});

test('mapProfileToPerson warnt bei fehlender Hausnummer und Anrede', () => {
  const { warnings } = mapProfileToPerson(
    { name: 'Max Mustermann', street: 'Musterstraße', city: 'Gladbeck', zip: '45964' },
    {}
  );
  assert.ok(warnings.some((w) => /Hausnummer/.test(w)));
  assert.ok(warnings.some((w) => /Anrede/.test(w)));
});
