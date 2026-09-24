'use strict';
/* R7 — tożsamość ucznia w księdze uczniów (wiersz 2 triage'u z 23.09.2026).
   § 4 rozporządzenia MEN z 25.08.2017 o dokumentacji: księga uczniów prowadzi numer PESEL, a gdy
   uczeń go nie ma — **rodzaj i numer dokumentu potwierdzającego tożsamość**. Nasza księga miała do
   tej pory tylko `passport` + `passportCountry`, więc uczeń z **kartą pobytu** (a takich jest
   w fixture'ach naboru tyle samo, co z paszportem) musiał być wpisany jako paszport albo wcale.

   Jeden kształt dla całego dziennika:
       students[].identityDocument = { type: 'passport' | 'residence-card' | 'other', number, country }
   `passport` / `passportCountry` zostają jako pola zgodności (czyta je pakiet SIO i starsze testy)
   i są zapisywane razem z `identityDocument`, gdy typem jest paszport.

   Zero zależności; dekodowanie bajtów robi `textdecode.js`, rozbiór CSV — `csv.js`. */

const CSV = require('./csv');

/** Rodzaje dokumentu tożsamości, jakie księga przyjmuje zamiast numeru PESEL. */
const DOCUMENT_TYPES = ['passport', 'residence-card', 'other'];
/** Nazwa rodzaju po polsku — ta sama w wydrukach, w pakiecie SIO i w komunikatach błędów. */
const TYPE_PL = { passport: 'paszport', 'residence-card': 'karta pobytu', other: 'inny dokument tożsamości' };
const TYPE_EN = { passport: 'passport', 'residence-card': 'residence card', other: 'other identity document' };
/** Najkrótszy sensowny numer dokumentu; krótszy to prawie zawsze urwane pole w imporcie. */
const MIN_NUMBER = 6;

const txt = (v) => String(v == null ? '' : v).trim();
const normType = (t) => (DOCUMENT_TYPES.includes(String(t)) ? String(t) : null);

/**
 * Dokument tożsamości ucznia w jednym kształcie, niezależnie od tego, jak stary jest wpis.
 * Zwraca `{ type, number, country }` albo `null`, gdy uczeń dokumentu nie ma.
 */
function documentOf(s) {
  if (!s) return null;
  const d = s.identityDocument;
  if (d && txt(d.number)) return { type: normType(d.type) || 'other', number: txt(d.number), country: txt(d.country) || null };
  if (txt(s.passport)) return { type: 'passport', number: txt(s.passport), country: txt(s.passportCountry) || null };
  return null;
}
/** Czy uczeń ma czym się wylegitymować: PESEL albo dokument. `kind` = 'pesel' | 'document' | 'none'. */
function identityOf(s) {
  const pesel = txt(s && s.pesel);
  const doc = documentOf(s);
  return { kind: pesel ? 'pesel' : doc ? 'document' : 'none', pesel: pesel || null, document: doc };
}
/**
 * Podpis tożsamości do wydruku i do XML — **nigdy `undefined`**. To jest ta jedna funkcja, której
 * używają odpis arkusza ocen, pakiet SIO i księga uczniów, żeby uczeń bez numeru PESEL nie zostawił
 * na świadectwie dziury po `s.pesel`.
 */
function identityLabel(s, locale) {
  const en = locale === 'en';
  const id = identityOf(s);
  if (id.kind === 'pesel') return 'PESEL ' + id.pesel;
  if (id.kind === 'document') {
    const t = (en ? TYPE_EN : TYPE_PL)[id.document.type] || (en ? TYPE_EN.other : TYPE_PL.other);
    return t + ' ' + id.document.number + (id.document.country ? ' (' + id.document.country + ')' : '');
  }
  return en ? 'no identity document' : 'brak numeru PESEL i dokumentu tożsamości';
}

/**
 * Odczyt dokumentu z treści żądania albo z wiersza importu. Przyjmuje zarówno nowy kształt
 * (`identityDocument: {type, number, country}`), jak i dotychczasowe `passport` / `passportCountry`.
 * Zwraca `{ ok, doc }` albo `{ ok:false, error, field, code }` — rzucanie zostawia warstwie tras,
 * żeby import mógł zebrać błędy wszystkich wierszy naraz zamiast przerwać się na pierwszym.
 */
function readDocument(b) {
  const raw = b && typeof b.identityDocument === 'object' && b.identityDocument ? b.identityDocument : {};
  const wanted = txt(raw.type) || txt(b && b.documentType) || (txt(b && b.passport) ? 'passport' : '');
  const type = normType(wanted);
  const number = txt(raw.number) || txt(b && b.documentNumber) || txt(b && b.passport);
  const country = (txt(raw.country) || txt(b && b.documentCountry) || txt(b && b.passportCountry)).toUpperCase();
  /* Nazwy pól w błędzie zależą od rodzaju: formularz paszportowy ma pola `passport` i
     `passportCountry`, a nowy formularz dokumentu — `identityDocument.*`. */
  const numberField = type === 'passport' || !type ? 'passport' : 'identityDocument.number';
  const countryField = type === 'passport' || !type ? 'passportCountry' : 'identityDocument.country';
  if (wanted && !type) return { ok: false, code: 'document_type_unknown', field: 'identityDocument.type', allowed: DOCUMENT_TYPES, error: `Rodzaj dokumentu tożsamości może być: ${DOCUMENT_TYPES.join(', ')} (${DOCUMENT_TYPES.map((t) => TYPE_PL[t]).join(', ')}).` };
  if (!number) return { ok: false, code: 'document_number_required', field: numberField, error: 'Uczeń bez numeru PESEL musi mieć w księdze rodzaj i numer dokumentu tożsamości (§ 4 rozporządzenia o dokumentacji).' };
  if (number.length < MIN_NUMBER) return { ok: false, code: 'document_number_short', field: numberField, error: `Numer dokumentu (${TYPE_PL[type || 'passport']}) musi mieć co najmniej ${MIN_NUMBER} znaków.` };
  if (!country) return { ok: false, code: 'document_country_required', field: countryField, error: 'Podaj kod kraju wydania dokumentu (pakiet SIO wymaga tego pola).' };
  return { ok: true, doc: { type: type || 'passport', number, country } };
}
/** Pola, które zapisuje się przy uczniu razem z dokumentem (z polami zgodności dla pakietu SIO). */
function documentFields(doc) {
  if (!doc) return { identityDocument: null, passport: null, passportCountry: null };
  return {
    identityDocument: { type: doc.type, number: doc.number, country: doc.country || null },
    /* `passport` czyta pakiet SIO i eksport archiwum; karta pobytu jedzie tym samym polem, bo SIO
       nie ma osobnego — rodzaj niesie `rodzajDokumentu`. */
    passport: doc.number, passportCountry: doc.country || null
  };
}

/* ------------------------------------------------- rozbiór jednego wolnego pola „Dokument tożsamości”
   Nabór gminny (`tests/fixtures/real-formats/register/nabor-vulcan.csv`) trzyma dokument jako JEDEN
   string: „paszport UA FL123456”, „karta pobytu BY 0012345”. Rozbicie go jest heurystyką, więc
   wynik niesie `confident` — sekretariat musi go przejrzeć, zanim uczeń trafi do księgi. */
const TYPE_WORDS = [
  [/^(karta\s*pobytu|karta\s*czasowego\s*pobytu|residence\s*card|zezwolenie\s*na\s*pobyt)/i, 'residence-card'],
  [/^(paszport|passport|dokument\s*podr[oó][zż]y|travel\s*document)/i, 'passport']
];
function parseDocumentString(raw) {
  const s = txt(raw).replace(/\s+/g, ' ');
  if (!s) return null;
  let type = null, rest = s;
  for (const [re, t] of TYPE_WORDS) { const m = re.exec(s); if (m) { type = t; rest = s.slice(m[0].length).trim(); break; } }
  const parts = rest.split(/[\s,;/]+/).filter(Boolean);
  /* Kod kraju: samodzielne 2–3 litery bez cyfry (UA, BY, VN). Numer: najdłuższy pozostały człon. */
  let country = null; const left = [];
  for (const p of parts) { if (!country && /^[A-Za-z]{2,3}$/.test(p) && p === p.toUpperCase()) country = p.toUpperCase(); else left.push(p); }
  const number = left.sort((a, b) => b.length - a.length)[0] || '';
  return { type: type || 'other', number, country, source: s, confident: !!type && !!number && number.length >= MIN_NUMBER };
}

/* ------------------------------------------------------------------ mapowanie kolumn rejestrów
   Nagłówki z prawdziwych eksportów (nabór VULCAN, Librus, UONET+) i z naszego własnego formatu
   importu. Dopasowanie idzie przez `CSV.headerKey`, więc półpauza w „Opiekun 1 – nazwisko”
   i wielkość liter nie mają znaczenia (README fixture'ów, §5). */
const COLUMNS = {
  lastName: ['nazwisko', 'lastname', 'nazwisko ucznia'],
  firstName: ['imie', 'imię', 'firstname', 'pierwsze imie', 'imie ucznia'],
  secondName: ['drugie imie', 'secondname'],
  pesel: ['pesel', 'nr pesel', 'numer pesel'],
  /* jedno wolne pole z rodzajem i numerem razem */
  documentText: ['dokument tożsamości', 'dokument tozsamosci', 'dokument', 'identity document'],
  /* albo rozbite na trzy kolumny */
  documentType: ['rodzaj dokumentu', 'typ dokumentu', 'document type', 'documenttype'],
  documentNumber: ['nr dokumentu', 'numer dokumentu', 'nr dokumentu tożsamości', 'paszport', 'nr paszportu', 'numer paszportu', 'passport', 'document number', 'documentnumber'],
  documentCountry: ['kraj wydania', 'kraj wydania dokumentu', 'państwo wydania', 'kod kraju', 'country', 'documentcountry'],
  birthDate: ['data urodzenia', 'birthdate', 'data ur.'],
  birthPlace: ['miejsce urodzenia', 'birthplace'],
  classId: ['oddział', 'oddzial', 'klasa', 'class', 'oddział docelowy'],
  rollNo: ['nr w dzienniku', 'rollno', 'numer w dzienniku'],
  registerNo: ['nr w księdze', 'nr w ksiedze', 'registerno', 'numer księgi'],
  address: ['adres zamieszkania', 'adres', 'address'],
  /* OPS3-06/20 — jedna tablica aliasów dla obu dróg wejścia: kreatora (`server/routes/setup.js`,
     `STUDENT_COLUMNS`) i próbnego dopasowania w sekretariacie. Dopóki żyły osobno, ten sam plik
     z naboru miał w jednym miejscu „nieznane kolumny”, a w drugim komplet danych opiekunów. */
  sex: ['sex', 'plec', 'plec ucznia', 'k/m'],
  enrolledAt: ['enrolledat', 'data przyjecia', 'data przyjecia do szkoly', 'przyjety od', 'data zapisu'],
  note: ['uwagi', 'note', 'notes', 'adnotacje', 'uwagi o uczniu'],
  parentLastName: ['parentlastname', 'opiekun 1 - nazwisko', 'opiekun - nazwisko', 'nazwisko opiekuna', 'nazwisko rodzica', 'matka - nazwisko'],
  parentFirstName: ['parentfirstname', 'opiekun 1 - imie', 'opiekun - imie', 'imie opiekuna', 'imie rodzica', 'matka - imie'],
  parentEmail: ['parentemail', 'opiekun 1 - e-mail', 'opiekun - e-mail', 'e-mail opiekuna', 'e-mail rodzica', 'matka - e-mail'],
  parentPhone: ['parentphone', 'opiekun 1 - telefon', 'opiekun - telefon', 'telefon opiekuna', 'telefon rodzica', 'matka - telefon'],
  parent2LastName: ['parent2lastname', 'opiekun 2 - nazwisko', 'drugi opiekun - nazwisko', 'ojciec - nazwisko'],
  parent2FirstName: ['parent2firstname', 'opiekun 2 - imie', 'drugi opiekun - imie', 'ojciec - imie'],
  parent2Email: ['parent2email', 'opiekun 2 - e-mail', 'drugi opiekun - e-mail', 'ojciec - e-mail'],
  parent2Phone: ['parent2phone', 'opiekun 2 - telefon', 'drugi opiekun - telefon', 'ojciec - telefon']
};
/** Wartość kolumny po dowolnym z jej aliasów (pierwszy niepusty wygrywa). */
function cell(row, field) {
  for (const alias of COLUMNS[field] || []) { const v = CSV.column(row, alias); if (v !== undefined && txt(v)) return txt(v); }
  return '';
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** `DD.MM.RRRR`, `DD-MM-RRRR` i `RRRR-MM-DD` — trzy formaty, które naprawdę są w eksportach. */
function isoDate(raw) {
  const s = txt(raw);
  if (!s) return null;
  if (ISO.test(s)) return s;
  const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s);
  if (!m) return null;
  return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/**
 * Jeden wiersz rejestru → kandydat do księgi uczniów. Nic nie zapisuje i nic nie odrzuca: zwraca
 * to, co zrozumiał, plus `issues[]` z kodami. Decyzję („wpisz”, „popraw”, „pomiń”) podejmuje
 * sekretariat na ekranie, bo rozbicie pola „Dokument tożsamości” jest heurystyką.
 */
function mapRegisterRow(row) {
  const out = {
    line: row._line || null,
    lastName: cell(row, 'lastName'), firstName: cell(row, 'firstName'),
    birthDate: null, birthPlace: cell(row, 'birthPlace'), classId: cell(row, 'classId'),
    pesel: txt(cell(row, 'pesel')).replace(/\s/g, ''), identityDocument: null,
    rollNo: cell(row, 'rollNo') ? +cell(row, 'rollNo') : null,
    registerNo: cell(row, 'registerNo') ? +cell(row, 'registerNo') : null,
    address: cell(row, 'address'),
    /* OPS3-20 — „Uwagi” z naboru to zdanie, które ktoś w gminie napisał o dziecku. Gubienie go po
       cichu jest gorsze niż przeniesienie: sekretariat widzi je w próbnym dopasowaniu i decyduje. */
    sex: (cell(row, 'sex') || '').toUpperCase().startsWith('M') ? 'M' : ((cell(row, 'sex') || '').toUpperCase().startsWith('K') || (cell(row, 'sex') || '').toUpperCase().startsWith('F') ? 'K' : null),
    enrolledAt: isoDate(cell(row, 'enrolledAt')),
    note: cell(row, 'note') || null,
    issues: []
  };
  const rawBirth = cell(row, 'birthDate');
  out.birthDate = isoDate(rawBirth);
  if (rawBirth && !out.birthDate) out.issues.push({ code: 'bad_date', level: 'error', field: 'birthDate', message: `„${rawBirth}” nie wygląda jak data urodzenia — dopuszczalne są formaty DD.MM.RRRR i RRRR-MM-DD.` });
  if (!out.lastName || !out.firstName) out.issues.push({ code: 'no_name', level: 'error', field: 'lastName', message: 'Wiersz bez imienia albo nazwiska ucznia.' });

  const combined = cell(row, 'documentText');
  const type = cell(row, 'documentType'), number = cell(row, 'documentNumber'), country = cell(row, 'documentCountry');
  if (number || type || country) {
    const r = readDocument({ identityDocument: { type: type || 'passport', number, country } });
    if (r.ok) out.identityDocument = r.doc;
    else out.issues.push({ code: r.code, level: 'error', field: r.field, message: r.error });
  } else if (combined) {
    const parsed = parseDocumentString(combined);
    out.identityDocument = parsed && parsed.number ? { type: parsed.type, number: parsed.number, country: parsed.country } : null;
    out.documentSource = combined;
    out.review = true;
    /* Rozbicie jednego wolnego pola na rodzaj / kraj / numer jest zawsze heurystyką, więc wraca do
       przejrzenia; gdy heurystyka nie rozpoznała rodzaju albo numeru, wiersz jest wprost błędny. */
    out.issues.push({ code: 'document_needs_review', level: parsed && parsed.confident ? 'warning' : 'error', field: 'identityDocument',
      message: `Pole „Dokument tożsamości” („${combined}”) rozbito automatycznie na rodzaj, kraj i numer — sprawdź wynik przed wpisem do księgi.` });
  }
  if (!out.pesel && !out.identityDocument) {
    out.issues.push({ code: 'no_identity', level: 'error', field: 'pesel', message: 'Uczeń nie ma numeru PESEL ani dokumentu tożsamości — księga uczniów nie przyjmie takiego wpisu.' });
  }
  return out;
}

module.exports = {
  DOCUMENT_TYPES, TYPE_PL, TYPE_EN, MIN_NUMBER, COLUMNS,
  documentOf, identityOf, identityLabel, readDocument, documentFields, parseDocumentString,
  mapRegisterRow, isoDate, cell
};
