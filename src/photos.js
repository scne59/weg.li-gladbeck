'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_BYTES = 2 * 1024 * 1024; // Vorgabe des Gladbecker Formulars: max. 2 MB

/**
 * Bereitet ein Foto für den Upload vor: EXIF-Orientierung korrigieren,
 * auf eine sinnvolle Größe skalieren und als JPEG unter 2 MB speichern.
 */
async function preparePhoto(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const meta = await sharp(srcPath).metadata();
  const attempts = [
    { width: 1600, quality: 82 },
    { width: 1600, quality: 75 },
    { width: 1400, quality: 70 },
    { width: 1280, quality: 65 },
    { width: 1100, quality: 60 },
    { width: 900, quality: 55 },
  ];

  let lastSize = 0;
  let lastWidth = 0;
  for (const attempt of attempts) {
    const buf = await sharp(srcPath)
      .rotate()
      .resize({ width: attempt.width, height: attempt.width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: attempt.quality, mozjpeg: true })
      .toBuffer();
    lastSize = buf.length;
    lastWidth = Math.min(attempt.width, meta.width || attempt.width);
    if (buf.length <= MAX_BYTES) {
      fs.writeFileSync(destPath, buf);
      return { path: destPath, bytes: buf.length, width: lastWidth, quality: attempt.quality };
    }
  }

  // Notfall: weiter verkleinern
  const buf = await sharp(srcPath)
    .rotate()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 45, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(destPath, buf);
  return { path: destPath, bytes: buf.length, width: 800, quality: 45 };
}

/**
 * Verteilt die weg.li-Fotos auf die sechs Upload-Felder des Formulars.
 *
 * Standard ("auto"):
 *   - 1 Foto  -> Foto des Fahrzeugs 1 + Foto der Verkehrssituation 1 (dasselbe Bild, mit Warnung)
 *   - 2 Fotos -> Fahrzeug 1 = Foto 0, Verkehrssituation 1 = Foto 1
 *   - 3+      -> Fahrzeug 1 = Foto 0, Verkehrssituation 1..n = Foto 1..n
 */
function assignPhotos(photos, mode = 'auto') {
  const list = photos.slice(0, 6);
  const result = { vehicle: [], situation: [], reused: false, warnings: [] };

  if (list.length === 0) return result;

  if (mode === 'reuse') {
    result.vehicle.push(list[0]);
    result.situation.push(list[0]);
    result.reused = true;
    result.warnings.push('Nur ein Foto vorhanden: dasselbe Bild wird für Fahrzeug und Verkehrssituation verwendet.');
    return result;
  }

  if (mode === 'all-vehicle') {
    result.vehicle = list.slice(0, 3);
    result.situation = [list[0]];
    result.reused = true;
    result.warnings.push('Fotos wurden überwiegend dem Fahrzeug zugeordnet; Foto 1 zusätzlich als Verkehrssituation.');
    return result;
  }

  // auto
  result.vehicle = [list[0]];
  if (list.length >= 2) {
    result.situation = list.slice(1, 4);
  } else {
    result.situation = [list[0]];
    result.reused = true;
    result.warnings.push('Nur ein Foto vorhanden: dasselbe Bild wird für Fahrzeug und Verkehrssituation verwendet. Bitte prüfen.');
  }
  return result;
}

module.exports = { preparePhoto, assignPhotos, MAX_BYTES };
