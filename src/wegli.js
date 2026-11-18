'use strict';

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://www.weg.li/api';
const PAGE_LIMIT = 100;

class WegliApi {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Kein weg.li API-Key gesetzt (WEGLI_API_KEY).');
    this.apiKey = apiKey;
  }

  async request(endpoint, params = {}, { method = 'GET', body } = {}) {
    const url = new URL(API_BASE + endpoint);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers = {
      'X-API-KEY': this.apiKey,
      Accept: 'application/json',
      'User-Agent': 'parken-wegli-gladbeck/1.0',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!res.ok) {
      const msg = payload && payload.message ? payload.message : String(payload).slice(0, 300);
      throw new Error(`weg.li API ${res.status} bei ${endpoint}: ${msg}`);
    }
    return payload;
  }

  /** Alle Anzeigen des Nutzers, seitenweise, dedupliziert nach token. */
  async listNotices(onPage) {
    const all = [];
    const seen = new Set();
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      const batch = await this.request('/notices', { page });
      if (!Array.isArray(batch)) {
        throw new Error(`Unerwartete Antwort für /notices?page=${page}: ${JSON.stringify(batch).slice(0, 200)}`);
      }
      let added = 0;
      for (const notice of batch) {
        if (!notice || !notice.token || seen.has(notice.token)) continue;
        seen.add(notice.token);
        all.push(notice);
        added++;
      }
      if (onPage) onPage(page, batch.length, all.length);
      if (batch.length === 0 || added === 0) break;
    }
    return all;
  }

  async getNotice(token) {
    return this.request(`/notices/${encodeURIComponent(token)}`);
  }

  /**
   * Aktualisiert eine Anzeige. weg.li erlaubt das nur für Anzeigen im
   * Status "open" (Entwurf), nicht für bereits geteilte ("shared") Anzeigen.
   */
  async updateNotice(token, notice) {
    return this.request(`/notices/${encodeURIComponent(token)}`, {}, { method: 'PATCH', body: { notice } });
  }

  async listExports() {
    return this.request('/exports');
  }

  async listPublicExports() {
    return this.request('/exports/public');
  }

  async listCharges() {
    return this.request('/charges');
  }

  /** Lädt ein Foto (active-storage-URL) herunter. */
  async downloadPhoto(url, dest) {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'parken-wegli-gladbeck/1.0' },
    });
    if (!res.ok) throw new Error(`Foto-Download fehlgeschlagen (${res.status}): ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return { path: dest, bytes: buf.length, contentType: res.headers.get('content-type') || '' };
  }
}

module.exports = { WegliApi, API_BASE };
