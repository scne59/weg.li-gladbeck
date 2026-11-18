'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { sleep, log, berlinParts, splitStreet, norm } = require('./util');
const { mapOffenses, buildDescription, vehicleType, brand, registration } = require('./mapping');

const DEFAULT_SERVICE_URL =
  'https://serviceportal.gladbeck.de/extension/service/call/c685c3f7-200e-4fb8-86be-88c6b85b5dab';

function selId(id) {
  return '#' + String(id).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  throw new Error(
    'Google Chrome/Chromium wurde nicht gefunden. Bitte in config.json unter gladbeck.chromePath eintragen oder CHROME_PATH setzen.'
  );
}

class GladbeckImporter {
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
    this.browser = null;
    this.serviceUrl = config?.gladbeck?.serviceUrl || DEFAULT_SERVICE_URL;
  }

  async start() {
    if (this.browser) return;
    const executablePath = this.config?.gladbeck?.chromePath || findChrome();
    const headless = this.options.headful ? false : this.config?.gladbeck?.headless !== false;
    log('info', `Starte Browser (${headless ? 'headless' : 'sichtbar'}): ${executablePath}`);
    this.browser = await puppeteer.launch({
      executablePath,
      headless,
      defaultViewport: { width: 1280, height: 1100 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=de-DE', '--window-size=1280,1100'],
    });
  }

  async stop() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Kleine Helfer
  // ---------------------------------------------------------------------------

  async panelId(page) {
    return page
      .evaluate(() => {
        const el = document.querySelector('[data-panel-identifier]');
        return el ? el.getAttribute('data-panel-identifier') : '';
      })
      .catch(() => '');
  }

  async waitPanel(page, name, timeout = 60000) {
    await page.waitForFunction(
      (n) => {
        const el = document.querySelector('[data-panel-identifier]');
        return el && el.getAttribute('data-panel-identifier') === n;
      },
      { timeout },
      name
    );
  }

  async clickButton(page, text, { optional = false, timeout = 15000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const ok = await page
        .evaluate((t) => {
          const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
          const exact = buttons.find((b) => (b.innerText || '').replace(/\s+/g, ' ').trim() === t);
          const partial = buttons.find((b) => (b.innerText || '').replace(/\s+/g, ' ').trim().includes(t));
          const btn = exact || partial;
          if (!btn) return false;
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return true;
        }, text)
        .catch(() => false);
      if (ok) return true;
      await sleep(500);
    }
    if (optional) return false;
    throw new Error(`Button "${text}" nicht gefunden.`);
  }

  async hasText(page, regex) {
    return page.evaluate((src) => new RegExp(src, 'i').test(document.body.innerText), regex.source).catch(() => false);
  }

  /** Liefert die ID des Eingabefeldes, dessen Label zum regulären Ausdruck passt. */
  async fieldId(page, regex) {
    return page.evaluate((src) => {
      const rx = new RegExp(src, 'i');
      const root = document.querySelector('[data-panel-identifier]');
      const scope = root ? (root.tagName === 'FORM' ? root : root.closest('form') || root) : document;
      const labels = [...scope.querySelectorAll('label')];
      for (const label of labels) {
        const text = (label.innerText || label.textContent || '').replace(/\s+/g, ' ').trim();
        if (rx.test(text)) {
          const id = label.getAttribute('for');
          if (id && document.getElementById(id)) return id;
        }
        // Fallback: Input innerhalb des Labels
        const inner = label.querySelector('input,select,textarea');
        if (rx.test(text) && inner && inner.id) return inner.id;
      }
      return null;
    }, regex.source);
  }

  async setText(page, regex, value) {
    const id = await this.fieldId(page, regex);
    if (!id) throw new Error(`Feld nicht gefunden: ${regex}`);
    const sel = selId(id);
    await page.click(sel, { clickCount: 3 }).catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.type(sel, String(value), { delay: 8 });
    await page.evaluate((fieldId) => document.getElementById(fieldId)?.blur(), id).catch(() => {});
    await sleep(350);
  }

  async selectByLabel(page, regex, optionText) {
    const id = await this.fieldId(page, regex);
    if (!id) throw new Error(`Auswahlfeld nicht gefunden: ${regex}`);
    const value = await page.evaluate(
      ({ fieldId, wanted }) => {
        const select = document.getElementById(fieldId);
        if (!select) return null;
        const wantedNorm = String(wanted).replace(/\s+/g, ' ').trim().toLowerCase();
        const opt =
          [...select.options].find((o) => (o.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === wantedNorm) ||
          [...select.options].find((o) => (o.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes(wantedNorm));
        return opt ? opt.value : null;
      },
      { fieldId: id, wanted: optionText }
    );
    if (value === null) {
      const available = await page.evaluate(
        (fieldId) => [...document.getElementById(fieldId).options].map((o) => (o.textContent || '').trim()),
        id
      );
      throw new Error(`Option "${optionText}" nicht gefunden. Verfügbar: ${available.join(', ')}`);
    }
    await page.select(selId(id), value);
    await sleep(700);
  }

  async checkByLabel(page, text) {
    const ok = await page.evaluate((wanted) => {
      const wantedNorm = wanted.replace(/\s+/g, ' ').trim();
      const root = document.querySelector('[data-panel-identifier]');
      const scope = root ? (root.tagName === 'FORM' ? root : root.closest('form') || root) : document;
      const labels = [...scope.querySelectorAll('label')];
      const label = labels.find((l) => (l.innerText || l.textContent || '').replace(/\s+/g, ' ').trim() === wantedNorm);
      if (!label) return false;
      let input = null;
      const id = label.getAttribute('for');
      if (id) input = document.getElementById(id);
      if (!input) input = label.querySelector('input');
      if (!input) input = label.parentElement?.querySelector('input');
      if (!input) return false;
      if (!input.checked) input.click();
      return true;
    }, text);
    if (!ok) throw new Error(`Checkbox/Radio "${text}" nicht gefunden.`);
    await sleep(500);
  }

  async uploadByLabel(page, regex, filePath) {
    const id = await this.fieldId(page, regex);
    if (!id) throw new Error(`Upload-Feld nicht gefunden: ${regex}`);
    const input = await page.$(selId(id));
    if (!input) throw new Error(`Upload-Feld #${id} nicht gefunden.`);
    await input.uploadFile(filePath);
    await sleep(1800);
  }

  async readErrors(page) {
    return page
      .evaluate(() => {
        const root = document.querySelector('[data-panel-identifier]');
        const scope = root ? (root.tagName === 'FORM' ? root : root.closest('form') || document) : document;
        const nodes = [...scope.querySelectorAll('.ym-error, .feedbackPanelERROR, .wk-feedback, [role="alert"]')];
        return [...new Set(nodes.map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()))].filter(
          (t) => t && !/^\*?\s*Es handelt sich um eine Pflichtangabe/.test(t)
        );
      })
      .catch(() => []);
  }

  async advance(page, expected, timeout = 60000) {
    const before = await this.panelId(page);
    await this.clickButton(page, 'Weiter');
    const deadline = Date.now() + timeout;
    let after = before;
    while (Date.now() < deadline) {
      await sleep(700);
      after = await this.panelId(page);
      const errors = await this.readErrors(page);
      if (errors.length) throw new Error(`Formularfehler: ${errors.join(' | ')}`);
      if (!after) {
        const final = await page
          .evaluate(() => {
            const t = document.body ? document.body.innerText : '';
            return (
              /Ausfüllvorgang abschließen/i.test(t) ||
              [...document.querySelectorAll('button')].some((b) => /Verbindlich einreichen/i.test(b.innerText || ''))
            );
          })
          .catch(() => false);
        if (final) {
          after = expected || 'Fremdanzeigen';
          break;
        }
      }
      if (after && after !== before) break;
    }
    if (!after || after === before) {
      const errors = await this.readErrors(page);
      throw new Error(
        errors.length
          ? `Formularfehler: ${errors.join(' | ')}`
          : `Formular ist nicht weitergesprungen (weiterhin "${before}").`
      );
    }
    if (expected && after !== expected) {
      log('warn', `Erwarteter Schritt "${expected}", tatsächlich "${after}" – fahre fort.`);
    }
    return after;
  }

  // ---------------------------------------------------------------------------
  // Formular-Schritte
  // ---------------------------------------------------------------------------

  async open(page) {
    await page.goto(this.serviceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Cookie-Dialog (falls vorhanden)
    await this.clickButton(page, 'Nur Notwendige speichern', { optional: true, timeout: 6000 });
    await sleep(1200);

    await this.clickButton(page, 'Dienst starten', { timeout: 30000 });

    await page
      .waitForFunction(
        () => {
          const p = document.querySelector('[data-panel-identifier]');
          const t = document.body ? document.body.innerText : '';
          return (p && p.getAttribute('data-panel-identifier') === 'Einleitung') || /Einwilligungserklärung|Einverständniserklärung/.test(t);
        },
        { timeout: 60000 }
      )
      .catch(() => {});

    if (await this.hasText(page, /Einwilligungserklärung|Einverständniserklärung/)) {
      await this.clickButton(page, 'Weiter', { timeout: 15000 });
      await sleep(2000);
    }

    await this.waitPanel(page, 'Einleitung', 60000);
  }

  async stepZeugendaten(page, person) {
    await this.selectByLabel(page, /Anrede\s*\*/, person.anrede || 'Herr');
    await this.setText(page, /^Name\s*\*$/, person.name);
    await this.setText(page, /^Vorname\s*\*$/, person.vorname);
    await this.setText(page, /^Straße\s*\*$/, person.strasse);
    await this.setText(page, /^Hausnummer\s*\*$/, person.hausnummer);
    await this.setText(page, /^Postleitzahl\s*\*$/, person.plz);
    await this.setText(page, /^Wohnort\s*\*$/, person.ort);

    const birth = String(person.geburtsdatum || '').trim();
    let day, month, year;
    let m = birth.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) [, day, month, year] = m;
    m = birth.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) [, year, month, day] = m;
    if (!day || !month || !year) {
      throw new Error('config.person.geburtsdatum muss im Format TT.MM.JJJJ oder JJJJ-MM-TT angegeben werden.');
    }
    await this.setText(page, /^Geburtsdatum\s*\*$/, String(day).padStart(2, '0'));
    await this.setText(page, /Geburtsdatum\s*-\s*Monat/i, String(month).padStart(2, '0'));
    await this.setText(page, /Geburtsdatum\s*-\s*Jahr/i, String(year));

    if (person.telefon) await this.setText(page, /^Telefonnummer$/, person.telefon);
    await this.setText(page, /^E-Mail\s*\*$/, person.email);

    return this.advance(page, 'Zeitpunkt_Ort');
  }

  async stepZeitpunktOrt(page, notice) {
    const start = berlinParts(notice.start_date);
    const end = notice.end_date ? berlinParts(notice.end_date) : start;
    if (end.date !== start.date) {
      throw new Error(
        `Beginn (${start.date} ${start.time}) und Ende (${end.date} ${end.time}) liegen an unterschiedlichen Tagen. ` +
          'Das Gladbecker Formular unterstützt nur eine Uhrzeit am selben Tag.'
      );
    }

    await this.setText(page, /Beginn der Beobachtung\s*-\s*Datum/i, start.date);
    await this.setText(page, /Beginn der Beobachtung\s*-\s*Stunde/i, start.hour);
    await this.setText(page, /Beginn der Beobachtung\s*-\s*Minute/i, start.minute);
    await this.setText(page, /Ende der Beobachtung\s*-\s*Stunde/i, end.hour);
    await this.setText(page, /Ende der Beobachtung\s*-\s*Minute/i, end.minute);

    const { street, houseNumber } = splitStreet(notice.street);
    await this.setText(page, /^Straße\s*\*$/, street);
    if (houseNumber) await this.setText(page, /^Hausnummer$/, houseNumber);
    if (notice.zip) await this.setText(page, /^Postleitzahl$/, notice.zip);
    if (notice.city) await this.setText(page, /^Ort$/, notice.city);

    return this.advance(page, 'Art_Verstoss');
  }

  async stepArtVerstoss(page, labels) {
    for (const label of labels) {
      await this.checkByLabel(page, label);
    }
    return this.advance(page, 'Hinweis');
  }

  async stepHinweis(page) {
    return this.advance(page, 'Angaben_Fahrzeug');
  }

  async stepFahrzeug(page, notice) {
    await this.selectByLabel(page, /^Fahrzeugart\s*\*$/, vehicleType(notice, this.config));
    await this.setText(page, /^Hersteller\s*\*$/, brand(notice));
    await this.setText(page, /^Amtliches Kennzeichen\s*\*$/, registration(notice));
    return this.advance(page, 'Beschreibung');
  }

  async stepBeschreibung(page, notice, photoPlan) {
    const text = buildDescription(notice, {
      includeToken: !!this.config?.import?.includeTokenInDescription,
    });
    if (text) await this.setText(page, /Hier können Sie den Verstoß näher erläutern/i, text);

    for (let i = 0; i < photoPlan.vehicle.length; i++) {
      await this.uploadByLabel(page, new RegExp(`Foto des Fahrzeugs ${i + 1}`), photoPlan.vehicle[i]);
    }
    for (let i = 0; i < photoPlan.situation.length; i++) {
      await this.uploadByLabel(page, new RegExp(`Foto der Verkehrssituation ${i + 1}`), photoPlan.situation[i]);
    }

    await this.checkByLabel(page, 'nein');
    return this.advance(page, 'Richtigkeit');
  }

  async stepRichtigkeit(page) {
    await this.checkByLabel(page, 'Ich bestätige die Richtigkeit meiner Angaben und nehme die o.g. Hinweise zur Kenntnis.');
    return this.advance(page, 'Fremdanzeigen');
  }

  async saveEvidence(page, dir, prefix) {
    fs.mkdirSync(dir, { recursive: true });
    const png = path.join(dir, `${prefix}.png`);
    const html = path.join(dir, `${prefix}.html`);
    await page.screenshot({ path: png, fullPage: true }).catch(() => {});
    const content = await page.content().catch(() => '');
    if (content) fs.writeFileSync(html, content);
    return { png, html };
  }

  async openPreview(page, dir) {
    const before = new Set(await this.browser.pages());
    await this.clickButton(page, 'Vorschau', { timeout: 20000 });
    await sleep(4000);
    const pages = await this.browser.pages();
    const fresh = pages.find((p) => !before.has(p));
    if (!fresh) return null;
    await fresh.waitForNetworkIdle({ idleTime: 1000, timeout: 20000 }).catch(() => {});
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, 'vorschau.png');
    await fresh.screenshot({ path: dest, fullPage: false }).catch(() => {});
    const url = fresh.url();
    await fresh.close().catch(() => {});
    return { screenshot: dest, url };
  }

  async submit(page, dir) {
    await this.clickButton(page, 'Verbindlich einreichen', { timeout: 20000 });
    await sleep(6000);
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
    await sleep(2000);
    const text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const stillFinal = await page
      .evaluate(() => [...document.querySelectorAll('button')].some((b) => /Verbindlich einreichen/i.test(b.innerText || '')))
      .catch(() => true);
    const errors = await this.readErrors(page);
    const evidence = await this.saveEvidence(page, dir, 'eingereicht');
    const failureText = /(fehler|nicht möglich|ungültig|abgelehnt)/i.test(text);
    const ok = !stillFinal && errors.length === 0 && !failureText;
    return {
      ok,
      stillFinal,
      errors,
      text: text.replace(/\s+/g, ' ').slice(0, 1200),
      evidence,
    };
  }

  // ---------------------------------------------------------------------------
  // Kompletter Durchlauf für eine Anzeige
  // ---------------------------------------------------------------------------

  async importNotice(notice, preparedPhotos, opts = {}) {
    const token = notice.token;
    const outDir = path.join(this.options.outputDir, token);
    const submit = !!opts.submit;

    await this.start();
    const context = await this.browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(45000);

    const result = { token, ok: false, status: 'failed', warnings: [], steps: [] };
    try {
      await this.open(page);
      result.steps.push('Einleitung');

      await this.advance(page, 'Zeugendaten');
      await this.stepZeugendaten(page, this.config.person);
      result.steps.push('Zeugendaten');

      await this.stepZeitpunktOrt(page, notice);
      result.steps.push('Zeitpunkt_Ort');

      const offenses = mapOffenses(notice, this.config?.import?.tbnrMap || {});
      await this.stepArtVerstoss(page, offenses);
      result.offenses = offenses;
      result.steps.push('Art_Verstoss');

      await this.stepHinweis(page);
      result.steps.push('Hinweis');

      await this.stepFahrzeug(page, notice);
      result.steps.push('Angaben_Fahrzeug');

      result.warnings.push(...(preparedPhotos.warnings || []));
      await this.stepBeschreibung(page, notice, preparedPhotos);
      result.steps.push('Beschreibung');

      await this.stepRichtigkeit(page);
      result.steps.push('Richtigkeit');

      const beforeSubmit = await this.saveEvidence(page, outDir, 'vor-einreichung');
      result.evidence = beforeSubmit;

      if (this.options.preview && !submit) {
        result.preview = await this.openPreview(page, outDir).catch((e) => ({ error: e.message }));
      }

      if (submit) {
        result.status = 'submitting';
        const sub = await this.submit(page, outDir);
        result.submitText = sub.text;
        if (!sub.ok) {
          const reason = sub.errors?.length ? sub.errors.join(' | ') : sub.text.slice(0, 300);
          throw new Error(`Einreichung nicht bestätigt: ${reason}`);
        }
        result.status = 'submitted';
        result.ok = true;
      } else {
        result.status = 'prepared';
        result.ok = true;
      }
      return result;
    } catch (error) {
      result.error = error.message;
      await this.saveEvidence(page, outDir, 'fehler').catch(() => {});
      throw Object.assign(error, { result });
    } finally {
      if (this.options.pauseSeconds > 0) {
        log('info', `Browser bleibt ${this.options.pauseSeconds}s offen (Prüfung/--pause).`);
        await sleep(this.options.pauseSeconds * 1000);
      }
      await context.close().catch(() => {});
    }
  }
}

module.exports = { GladbeckImporter, DEFAULT_SERVICE_URL, findChrome };
