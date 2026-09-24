'use strict';
/* R7 — sprawdzenie poprawności składniowej XML (well-formedness), bez schematu.
   `server/lib/import-asc.js` ma własny tokenizer, ale jest **świadomie pobłażliwy**: nieznane
   elementy, śmieci w tagu i niedomknięte znaczniki pomija po cichu, bo eksport aSc bywa taki
   z natury. Do sprawdzenia własnego pakietu SIO potrzeba czegoś odwrotnego: czegoś, co o każdym
   takim miejscu powie, w której linii i kolumnie jest. Stąd osobny, surowy skaner.

   To NIE jest walidacja wobec schematu XSD — patrz docs/SIO.md. Sprawdzamy tylko, że plik jest
   poprawnie zbudowanym dokumentem XML: jeden element główny, domknięte i prawidłowo zagnieżdżone
   znaczniki, atrybuty w cudzysłowach i bez powtórzeń, brak nagiego `&` i `]]>` w treści. */

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-]/;
const ENTITY = /^&(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
/** Ile błędów notujemy, zanim uznamy, że plik jest po prostu zepsuty i dalsze szukanie nic nie wnosi. */
const MAX_ERRORS = 50;
/** S3-19 — próg zagnieżdżenia. Prawdziwe sprawozdanie SIO ma cztery poziomy; 500 to margines
    z zapasem, a zarazem granica, przy której rekurencyjne parsery (import-optivum) wywracają stos. */
const MAX_DEPTH = 500;

/**
 * wellFormed(xml) → { ok, root, elements, errors: [{ code, message, line, column }] }
 * Kody: `no_root`, `multiple_roots`, `tag_mismatch`, `unclosed_tag`, `unexpected_close`,
 * `unquoted_attribute`, `duplicate_attribute`, `bad_name`, `raw_ampersand`, `text_outside_root`,
 * `unterminated`.
 */
function wellFormed(xml) {
  const s = String(xml == null ? '' : xml);
  const errors = []; const stack = [];
  let i = 0, roots = 0, root = null, elements = 0, stopped = null, maxDepth = 0;
  /* R3-06 — pozycja błędu liczona liniowo, nie przez `s.slice(0, pos).split('\n')`.
     Ta jedna linijka była kwadratowa: `tag_mismatch` wstawiał numer linii do komunikatu **z góry, dla
     każdego niedopasowania**, a każde takie wyliczenie kopiowało cały dotychczasowy tekst. Pół
     megabajta zepsutego eksportu wklejone do walidatora (a to jest dokładnie to, co ktoś wkleja do
     walidatora) zajmowało jednoprocesowy serwer szkoły na siedem sekund. Teraz początki linii są
     policzone raz, a odwzorowanie pozycji na linię i kolumnę to wyszukiwanie binarne. */
  const lineStarts = [0];
  for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const at = (pos) => {
    const p = pos < 0 ? 0 : pos > s.length ? s.length : pos;
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= p) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: p - lineStarts[lo] + 1 };
  };
  const fail = (code, message, pos) => { if (errors.length < MAX_ERRORS) errors.push(Object.assign({ code, message }, at(pos))); };
  /* Po MAX_ERRORS przerywamy skan: lista i tak jest zamknięta, a dalsze przemiatanie kosztuje. */
  const flooded = () => errors.length >= MAX_ERRORS;

  while (i < s.length) {
    if (flooded()) { stopped = 'too_many_errors'; break; }
    const lt = s.indexOf('<', i);
    if (lt < 0) { checkText(s.slice(i), i); break; }
    if (lt > i) checkText(s.slice(i, lt), i);
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); if (e < 0) { fail('unterminated', 'Komentarz nie ma zamknięcia „-->”.', lt); break; } i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); if (e < 0) { fail('unterminated', 'Sekcja CDATA nie ma zamknięcia „]]>”.', lt); break; } i = e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); if (e < 0) { fail('unterminated', 'Instrukcja przetwarzania nie ma zamknięcia „?>”.', lt); break; } i = e + 2; continue; }
    if (s.startsWith('<!', lt)) { const e = s.indexOf('>', lt + 2); if (e < 0) { fail('unterminated', 'Deklaracja „<!…” nie ma zamknięcia.', lt); break; } i = e + 1; continue; }

    let j = lt + 1;
    const closing = s[j] === '/';
    if (closing) j++;
    if (!NAME_START.test(s[j] || '')) { fail('bad_name', 'Znak „<” nie zaczyna poprawnej nazwy elementu (w treści musi być zapisany jako „&lt;”).', lt); i = lt + 1; continue; }
    let name = '';
    while (j < s.length && NAME_CHAR.test(s[j])) name += s[j++];

    if (closing) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== '>') fail('bad_name', `Znacznik zamykający „</${name}” ma śmieci przed „>”.`, j);
      const e = s.indexOf('>', j); i = e < 0 ? s.length : e + 1;
      const open = stack.pop();
      if (!open) fail('unexpected_close', `Znacznik zamykający „</${name}>” nie ma otwarcia.`, lt);
      else if (open.name !== name) fail('tag_mismatch', `Otwarto „<${open.name}>” (linia ${at(open.pos).line}), a zamknięto „</${name}>”.`, lt);   // at() jest teraz O(log n)
      if (!stack.length) root = root || (open && open.name) || name;
      continue;
    }

    const seen = new Set(); let selfClosing = false;
    for (;;) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length) { fail('unterminated', `Znacznik „<${name}” nie ma zamknięcia „>”.`, lt); i = s.length; break; }
      if (s[j] === '/' && s[j + 1] === '>') { selfClosing = true; i = j + 2; break; }
      if (s[j] === '>') { i = j + 1; break; }
      let an = '';
      while (j < s.length && NAME_CHAR.test(s[j])) an += s[j++];
      if (!an) { fail('bad_name', `Nieoczekiwany znak „${s[j]}” w znaczniku „<${name}>”.`, j); j++; continue; }
      if (seen.has(an)) fail('duplicate_attribute', `Atrybut „${an}” powtarza się w elemencie „<${name}>”.`, j);
      seen.add(an);
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== '=') { fail('unquoted_attribute', `Atrybut „${an}” elementu „<${name}>” nie ma wartości.`, j); continue; }
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      const q = s[j];
      if (q !== '"' && q !== "'") { fail('unquoted_attribute', `Wartość atrybutu „${an}” nie jest w cudzysłowach.`, j); while (j < s.length && !/[\s>]/.test(s[j])) j++; continue; }
      const e = s.indexOf(q, j + 1);
      if (e < 0) { fail('unterminated', `Wartość atrybutu „${an}” nie ma zamykającego cudzysłowu.`, j); i = s.length; break; }
      checkText(s.slice(j + 1, e), j + 1, true);
      j = e + 1;
    }
    if (i <= lt) break;                                             // bezpiecznik: zawsze idziemy do przodu
    elements++;
    if (!stack.length) { roots++; if (roots === 1) root = name; else fail('multiple_roots', `Dokument ma więcej niż jeden element główny (drugi to „<${name}>”).`, lt); }
    if (!selfClosing) {
      stack.push({ name, pos: lt });
      if (stack.length > maxDepth) maxDepth = stack.length;
      /* S3-19 — głębokość jest twardą granicą, nie kolejnym błędem na liście: dalej i tak nie ma
         czego sprawdzać, a rekurencyjne parsery tego samego pliku przewracają się na stosie. */
      if (stack.length > MAX_DEPTH) {
        fail('nesting_too_deep', `Dokument jest zagnieżdżony głębiej niż ${MAX_DEPTH} poziomów — to nie wygląda na sprawozdanie, tylko na plik uszkodzony albo celowo spreparowany. Sprawdzanie przerwano.`, lt);
        stopped = 'nesting_too_deep'; break;
      }
    }
  }
  for (const open of stack) fail('unclosed_tag', `Element „<${open.name}>” nie został zamknięty.`, open.pos);
  if (!roots) fail('no_root', 'Dokument nie ma żadnego elementu głównego.', 0);

  function checkText(t, pos, inAttr) {
    let k = 0;
    for (;;) {
      const amp = t.indexOf('&', k);
      if (amp < 0) break;
      const m = ENTITY.exec(t.slice(amp, amp + 64));
      if (!m) { fail('raw_ampersand', 'Znak „&” w treści musi być zapisany jako „&amp;”.', pos + amp); break; }
      /* S3-19 — odwołanie liczbowe spoza zakresu Unicode (np. `&#xFFFFFFFF;`) wywraca każdy parser,
         który je rozwija: `String.fromCodePoint` rzuca „Invalid code point 4294967295”, a ten komunikat
         szedł potem prosto do rozmówcy. Łapiemy je tutaj, po polsku i z własnym kodem. */
      if (m[1][0] === '#') {
        const n = m[1][1] === 'x' || m[1][1] === 'X' ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10);
        if (!Number.isFinite(n) || n < 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) {
          fail('bad_entity', `Odwołanie znakowe „&${m[1]};” wskazuje na znak spoza zakresu Unicode — popraw je albo zapisz znak wprost.`, pos + amp);
        }
      }
      k = amp + 1;
    }
    if (!inAttr && !stack.length && t.trim()) fail('text_outside_root', 'Tekst poza elementem głównym.', pos);
    if (!inAttr && t.includes(']]>')) fail('raw_ampersand', 'Ciąg „]]>” w treści musi być zapisany jako „]]&gt;”.', pos + t.indexOf(']]>'));
  }

  return { ok: errors.length === 0, root, elements, errors, depth: maxDepth, stopped, truncated: !!stopped };
}

module.exports = { wellFormed, MAX_DEPTH, MAX_ERRORS };
