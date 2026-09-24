'use strict';
/* R1 — dekodowanie bajtów z plików, które szkoła naprawdę ma.
   Node 18 bez pełnego ICU **nie ma** dekodera windows-1250, a zasada zerowych zależności nie pozwala
   dołożyć npm-a. Publikacja „Plan lekcji Optivum” i eksporty z Librusa/UONET+/naboru są w cp1250,
   aSc bywa w UTF-8 z BOM-em. Stąd własna, 128-elementowa tablica bajtów 0x80–0xFF → UTF-16
   (docs/IMPORT.md, tests/fixtures/real-formats/README.md pkt 4.1).

   Kolejność wykrywania kodowania: BOM → deklaracja w treści (`<meta charset>` / `<?xml encoding?>`)
   → wartość domyślna podana przez wywołującego (cp1250 dla Optivum, utf-8 dla XML). */

/** windows-1250, bajty 0x80–0xFF. `null` = pozycja nieprzypisana w tej stronie kodowej. */
const CP1250 = [
  '€', null, '‚', null, '„', '…', '†', '‡',        // 80–87
  null, '‰', 'Š', '‹', 'Ś', 'Ť', 'Ž', 'Ź',    // 88–8F
  null, '‘', '’', '“', '”', '•', '–', '—',    // 90–97
  null, '™', 'š', '›', 'ś', 'ť', 'ž', 'ź',    // 98–9F
  ' ', 'ˇ', '˘', 'Ł', '¤', 'Ą', '¦', '§', // A0–A7
  '¨', '©', 'Ş', '«', '¬', '­', '®', 'Ż', // A8–AF
  '°', '±', '˛', 'ł', '´', 'µ', '¶', '·', // B0–B7
  '¸', 'ą', 'ş', '»', 'Ľ', '˝', 'ľ', 'ż', // B8–BF
  'Ŕ', 'Á', 'Â', 'Ă', 'Ä', 'Ĺ', 'Ć', 'Ç', // C0–C7
  'Č', 'É', 'Ę', 'Ë', 'Ě', 'Í', 'Î', 'Ď', // C8–CF
  'Đ', 'Ń', 'Ň', 'Ó', 'Ô', 'Ő', 'Ö', '×', // D0–D7
  'Ř', 'Ů', 'Ú', 'Ű', 'Ü', 'Ý', 'Ţ', 'ß', // D8–DF
  'ŕ', 'á', 'â', 'ă', 'ä', 'ĺ', 'ć', 'ç', // E0–E7
  'č', 'é', 'ę', 'ë', 'ě', 'í', 'î', 'ď', // E8–EF
  'đ', 'ń', 'ň', 'ó', 'ô', 'ő', 'ö', '÷', // F0–F7
  'ř', 'ů', 'ú', 'ű', 'ü', 'ý', 'ţ', '˙'  // F8–FF
];

/** Bajty → string wg windows-1250. Bajt bez przypisania staje się U+FFFD, nie znika po cichu. */
function decodeCp1250(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) out += String.fromCharCode(c);
    else { const ch = CP1250[c - 0x80]; out += ch == null ? '�' : ch; }
  }
  return out;
}

const LABELS = {
  'utf-8': 'utf-8', utf8: 'utf-8', 'utf8': 'utf-8',
  'windows-1250': 'windows-1250', cp1250: 'windows-1250', 'x-cp1250': 'windows-1250', 'win-1250': 'windows-1250',
  'iso-8859-2': 'iso-8859-2', 'latin2': 'iso-8859-2',
  'iso-8859-1': 'windows-1252', 'windows-1252': 'windows-1252', 'cp1252': 'windows-1252'
};
const normLabel = (x) => LABELS[String(x || '').trim().toLowerCase()] || null;

/** ISO 8859-2 i windows-1252 pojawiają się w starszych publikacjach — obie mają 0x00–0x7F jak ASCII,
    więc deklarację czytamy, ale dekodujemy tablicą cp1250 (różnice dotyczą znaków, których w planie
    lekcji nie ma) i mówimy o tym w `note`. Nic nie zgadujemy po cichu. */
const BOMS = [
  { enc: 'utf-8', bytes: [0xEF, 0xBB, 0xBF] },
  { enc: 'utf-16le', bytes: [0xFF, 0xFE] },
  { enc: 'utf-16be', bytes: [0xFE, 0xFF] }
];

/** Deklaracja kodowania w pierwszych 2 kB treści czytanej jako ASCII (nagłówki HTML/XML są ASCII). */
function sniffDeclared(bytes) {
  const head = Buffer.isBuffer(bytes) ? bytes.slice(0, 2048).toString('latin1') : String(bytes).slice(0, 2048);
  let m = /<\?xml[^>]*?encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (m) return { label: m[1], from: 'xml' };
  m = /<meta[^>]*charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(head);
  if (m) return { label: m[1], from: 'meta' };
  return null;
}

/**
 * decode(buf, { default: 'windows-1250' | 'utf-8' }) → { text, encoding, source, note }
 * `source`: 'bom' | 'xml' | 'meta' | 'default'. BOM zawsze wygrywa z deklaracją w treści
 * (tak robią przeglądarki) i jest usuwany z wyniku.
 */
function decode(input, opts) {
  const o = opts || {};
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input == null ? '' : input), 'utf8');
  for (const b of BOMS) {
    if (buf.length >= b.bytes.length && b.bytes.every((x, i) => buf[i] === x)) {
      const body = buf.slice(b.bytes.length);
      if (b.enc === 'utf-16be') { const sw = Buffer.from(body); for (let i = 0; i + 1 < sw.length; i += 2) { const t = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = t; } return { text: sw.toString('utf16le'), encoding: 'utf-16be', source: 'bom', note: null }; }
      return { text: body.toString(b.enc === 'utf-8' ? 'utf8' : 'utf16le'), encoding: b.enc, source: 'bom', note: null };
    }
  }
  const declared = sniffDeclared(buf);
  const wanted = (declared && normLabel(declared.label)) || normLabel(o.default) || 'utf-8';
  const source = declared && normLabel(declared.label) ? declared.from : 'default';
  let note = null;
  if (declared && !normLabel(declared.label)) note = `Nieznana deklaracja kodowania „${declared.label}” — odczytano jako ${normLabel(o.default) || 'utf-8'}.`;
  if (wanted === 'iso-8859-2' || wanted === 'windows-1252') note = `Plik deklaruje ${wanted}; odczytano tablicą windows-1250 (różnice nie dotyczą polskich liter używanych w planie lekcji).`;
  if (wanted === 'utf-8') {
    const text = buf.toString('utf8');
    /* UTF-8 z bajtami cp1250 daje U+FFFD. Nie „naprawiamy” tego po cichu — zgłaszamy w `note`,
       bo to najczęstszy objaw źle zadeklarowanego eksportu. */
    if (text.includes('�') && !declared) return { text: decodeCp1250(buf), encoding: 'windows-1250', source: 'sniff', note: 'Bajty nie tworzą poprawnego UTF-8 — odczytano jako windows-1250.' };
    return { text, encoding: 'utf-8', source, note: text.includes('�') ? 'Plik deklaruje UTF-8, ale zawiera bajty spoza UTF-8 — w tekście są znaki zastępcze.' : note };
  }
  return { text: decodeCp1250(buf), encoding: 'windows-1250', source, note };
}

/** Wygodny skrót: sam tekst, bez raportu. */
const decodeText = (input, opts) => decode(input, opts).text;

/** Cokolwiek przyszło z klienta (string, base64, Buffer) → Buffer. `base64` gdy tekst wygląda na base64. */
function toBuffer(value, encodingHint) {
  if (Buffer.isBuffer(value)) return value;
  if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  const s = String(value == null ? '' : value);
  if (encodingHint === 'base64') return Buffer.from(s, 'base64');
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(s.trim());
  if (m) return Buffer.from(m[1], 'base64');
  return Buffer.from(s, 'utf8');
}

module.exports = { decode, decodeText, decodeCp1250, toBuffer, sniffDeclared, CP1250 };
