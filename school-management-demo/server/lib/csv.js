'use strict';
/* R1 — parser CSV z cudzysłowami (RFC 4180), bo `line.split(';')` psuje prawdziwe pliki:
   adnotacja sądowa w `register/nabor-vulcan.csv` ma średnik w środku pola, a eksport
   `register/uonet-uczniowie.csv` trzyma w cudzysłowach **każde** pole, także puste i liczby.
   Separator (`;` albo `,`) wykrywamy z pierwszego wiersza logicznego, poza cudzysłowami.
   BOM, CRLF i przełamania wiersza wewnątrz pola są obsłużone. Zero zależności.
   Dekodowanie bajtów robi `server/lib/textdecode.js` — tu wchodzi już string. */

const SEPARATORS = [';', ',', '\t', '|'];

/** Ile razy każdy kandydat na separator pada poza cudzysłowami w pierwszym wierszu logicznym. */
function sniffSeparator(text, allowed) {
  const cands = allowed && allowed.length ? allowed : SEPARATORS;
  const counts = Object.fromEntries(cands.map((s) => [s, 0]));
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (inQ && text[i + 1] === '"') { i++; continue; } inQ = !inQ; continue; }
    if (inQ) continue;
    if (ch === '\n') break;
    if (counts[ch] !== undefined) counts[ch]++;
  }
  let best = cands[0], bestN = -1;
  for (const s of cands) if (counts[s] > bestN) { best = s; bestN = counts[s]; }
  return bestN > 0 ? best : ';';
}

/**
 * parse(text, { separator, trim }) → { rows: string[][], separator }
 * `trim` (domyślnie true) obcina białe znaki pól **niecytowanych** — pole w cudzysłowach
 * zostaje dokładnie takie, jakie było (spacje w adresie są częścią danych).
 */
function parse(text, opts) {
  const o = opts || {};
  const src = String(text == null ? '' : text).replace(/^﻿/, '');
  const sep = o.separator || sniffSeparator(src, o.allowed);
  const trim = o.trim !== false;
  const rows = [];
  let row = [], field = '', quoted = false, inQ = false, any = false;
  const pushField = () => { row.push(quoted ? field : (trim ? field.trim() : field)); field = ''; quoted = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; any = false; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; continue; }
      field += ch; continue;
    }
    if (ch === '"' && (field === '' || /^\s*$/.test(field))) { inQ = true; quoted = true; field = ''; any = true; continue; }
    if (ch === sep) { pushField(); any = true; continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; pushRow(); continue; }
    if (ch === '\n') { pushRow(); continue; }
    field += ch; if (!/\s/.test(ch)) any = true;
  }
  if (field !== '' || quoted || row.length || any) pushRow();
  /* Ostatni pusty wiersz („plik kończy się znakiem nowej linii”) nie jest danymi. */
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return { rows, separator: sep };
}

/**
 * parseObjects(text, opts) → { header, rows: [{kolumna: wartość, _line}], separator, errors }
 * Nagłówki normalizujemy tylko przez obcięcie spacji — półpauza w `Opiekun 1 – nazwisko`
 * zostaje, bo to jest prawdziwa nazwa kolumny (patrz README fixture'ów, pkt 5).
 */
function parseObjects(text, opts) {
  const o = opts || {};
  const { rows, separator } = parse(text, o);
  if (!rows.length) return { header: [], rows: [], separator, errors: [] };
  const header = rows[0].map((h) => String(h).trim());
  const out = [], errors = [];
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.length === 1 && cells[0] === '') return;
    if (cells.length !== header.length && o.strict) { errors.push({ line, error: `Oczekiwano ${header.length} kolumn, znaleziono ${cells.length}.`, code: 'column_count', expected: header.length, actual: cells.length }); return; }
    const r = { _line: line };
    header.forEach((h, k) => { r[h] = cells[k] == null ? '' : cells[k]; });
    out.push(r);
  });
  return { header, rows: out, separator, errors };
}

/** Nagłówek szukany „po ludzku”: bez wielkości liter, bez diakrytyków i z myślnikiem dowolnego kroju. */
const headerKey = (h) => String(h || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

/** Wyszukanie kolumny po nazwie znormalizowanej (`column(row, 'opiekun 1 - nazwisko')`). */
function column(row, wanted) {
  const want = headerKey(wanted);
  for (const k of Object.keys(row)) if (headerKey(k) === want) return row[k];
  return undefined;
}

module.exports = { parse, parseObjects, sniffSeparator, headerKey, column, SEPARATORS };
