'use strict';
/* 3.4 — dokumentacja pomocy psychologiczno-pedagogicznej dla Jana Nowaka (7b, objęty pomocą społeczną).
   Wszystkie identyfikatory z prefiksem s_ (seed 3.4). */
const C = require('../lib/crypto');
const U = require('../lib/util');

const YEAR = '2026/2027';
const ST = 'st_nowak_jan';
const NB_DAYS = ['2026-10-19', '2026-10-20', '2026-10-21'];

function seed(db, ctx) {
  const now = U.now();
  const student = db.get('students', ST);
  if (!student) return;
  const classId = student.classId;

  /* ---- 3.4.2 WOPFU ---- */
  db.col('wopfu').push({
    id: 's_wopfu_nowak_2026', studentId: ST, classId, year: YEAR,
    basis: 'Orzeczenie o potrzebie kształcenia specjalnego nr 12/2026 z 02.09.2026 (Poradnia Psychologiczno-Pedagogiczna nr 4 w Krakowie)',
    sections: {
      mocne: 'Bardzo dobra pamięć wzrokowa, chętnie pracuje na materiale konkretnym i schematach. Wysoka motywacja na zajęciach w małej grupie. Poprawne relacje z dwoma kolegami z klasy.',
      bariery: 'Trudność w utrzymaniu uwagi powyżej 15 minut, męczliwość po 5. lekcji. Tempo pisania znacząco poniżej klasy, przy dyktandach opuszcza końcówki wyrazów.',
      zalecenia: 'Wydłużony czas pracy na sprawdzianach, polecenia dzielone na etapy, miejsce w pierwszej ławce blisko tablicy. Sprawdzanie zrozumienia polecenia przed rozpoczęciem pracy.'
    },
    editors: [
      { userId: 'u_specjalny', scope: 'all', invitedBy: 'u_specjalny', invitedAt: '2026-09-03T09:00:00Z', accepted: true },
      { userId: 'u_zielinska', scope: 'all', invitedBy: 'u_specjalny', invitedAt: '2026-09-03T09:05:00Z', accepted: true }
    ],
    versions: [
      { no: 1, at: '2026-09-03T09:00:00Z', byUserId: 'u_specjalny', kind: 'create', section: null, before: null, after: null, reason: 'Utworzenie dokumentu przez zespół' },
      { no: 2, at: '2026-10-14T13:22:00Z', byUserId: 'u_specjalny', kind: 'edit', section: 'bariery', before: 'Trudność w utrzymaniu uwagi powyżej 10 minut', after: 'Trudność w utrzymaniu uwagi powyżej 15 minut, męczliwość po 5. lekcji.', reason: 'Obserwacja na lekcjach matematyki i biologii, wrzesień–październik 2026' }
    ],
    createdBy: 'u_specjalny', rolledFrom: null, createdAt: '2026-09-03T09:00:00Z'
  });

  /* ---- 3.4.3 IPET ---- */
  db.col('ipet').push({
    id: 's_ipet_nowak_2026', studentId: ST, classId, year: YEAR,
    basis: 'Orzeczenie o potrzebie kształcenia specjalnego nr 12/2026',
    integratedActions: [
      'Wspólne planowanie lekcji przez nauczyciela przedmiotu i nauczyciela wspomagającego (matematyka, język polski).',
      'Praca na materiale konkretnym i schematach graficznych na wszystkich przedmiotach.',
      'Karta kontrolna zadań domowych uzupełniana wspólnie z wychowawcą.'
    ],
    supportForms: [
      { form: 'kk', name: 'Zajęcia korekcyjno-kompensacyjne', hoursPerWeek: 2 },
      { form: 'logopedia', name: 'Terapia logopedyczna', hoursPerWeek: 1 },
      { form: 'emo', name: 'Zajęcia rozwijające kompetencje emocjonalno-społeczne', hoursPerWeek: 1 }
    ],
    rehabHoursPerWeek: 2,
    examAccommodations: ['wydłużony czas pracy', 'osobna sala'],
    recommendations: [
      { id: 'rec_czas', text: 'Wydłużony czas na zadania' },
      { id: 'rec_miejsce', text: 'Miejsce w pierwszej ławce blisko tablicy' },
      { id: 'rec_etapy', text: 'Polecenia dzielone na etapy' }
    ],
    goals: [
      { id: 'goal1', title: 'Czytanie ze zrozumieniem tekstu użytkowego', target: 80, level: 68 },
      { id: 'goal2', title: 'Samodzielne rozpoczęcie pracy po poleceniu', target: 80, level: 84 },
      { id: 'goal3', title: 'Utrzymanie uwagi przez 20 minut', target: 70, level: 41 }
    ],
    versions: [{ no: 1, at: '2026-09-03T10:00:00Z', byUserId: 'u_specjalny', kind: 'create', before: null, after: null, reason: 'Utworzenie IPET na rok 2026/2027' }],
    createdBy: 'u_specjalny', rolledFrom: null, createdAt: '2026-09-03T10:00:00Z'
  });

  /* ---- 3.4.1 dziennik zajęć innych: grupa + 4 spotkania ---- */
  const group = {
    id: 's_oa_emo_7b', name: 'Zajęcia rozwijające kompetencje emocjonalno-społeczne · 7b', form: 'emo',
    specialistId: 'u_zielinska', year: YEAR, classIds: [classId],
    goals: ['Rozpoznawanie i nazywanie emocji', 'Strategie radzenia sobie z napięciem', 'Współpraca w małej grupie'],
    studentIds: [ST, 'st_kowalczyk_anna', 'st_zielinski_kacper'], sessions: [], createdAt: '2026-09-20T08:00:00Z'
  };
  const SES = [
    ['2026-09-29', 'Rozpoznawanie emocji na podstawie sytuacji z życia klasy', 'Rozwijanie kompetencji emocjonalno-społecznych', 'ob'],
    ['2026-10-06', 'Ćwiczenia analizy i syntezy wzrokowej na materiale literowym', 'Wyrównywanie deficytów percepcji wzrokowej', 'ob'],
    ['2026-10-13', 'Strategie radzenia sobie z napięciem przed sprawdzianem', 'Redukcja lęku szkolnego', 'u'],
    ['2026-10-20', 'Planowanie pracy domowej w etapach, praca z listą kontrolną', 'Rozwijanie samodzielności w organizacji pracy', 'ob']
  ];
  SES.forEach((s, i) => group.sessions.push({
    id: 's_oas_' + (i + 1), date: s[0], topic: s[1], goal: s[2], note: '', byUserId: 'u_zielinska', at: s[0] + 'T12:00:00Z',
    attendance: group.studentIds.map((sid) => ({ studentId: sid, status: sid === ST ? s[3] : 'ob' }))
  }));
  db.col('otherActivities').push(group);

  /* ---- 3.4.4 notatka poufna czytelna dla psychologa i pedagoga ---- */
  const readers = ['u_zielinska', 'u_pedagog'].map((uid) => { const u = db.get('users', uid); return { userId: uid, publicKey: u.publicKey }; });
  db.col('confidentialNotes').push({
    id: 's_note_nowak_1', studentId: ST, title: 'Notatka z interwencji · 12.10.2026', kind: 'intervention',
    authorId: 'u_zielinska', readerIds: ['u_zielinska', 'u_pedagog'],
    envelope: C.encryptForReaders('Rozmowa wspierająca po zgłoszeniu wychowawcy dotyczącym wycofania z kontaktów w grupie klasowej. Uczeń opisał sytuację spokojnie, przyjął propozycję kolejnego spotkania. Ustalono spotkania co dwa tygodnie oraz udział w zajęciach rozwijających kompetencje emocjonalno-społeczne.', readers),
    at: '2026-10-12T14:20:00Z', exportable: false, createdAt: '2026-10-12T14:20:00Z'
  });

  /* ---- 3.4.9 dokumenty: publiczna opinia + chroniona diagnoza ---- */
  db.col('supportDocuments').push({
    id: 's_doc_opinia', studentId: ST, name: 'Opinia o funkcjonowaniu ucznia w szkole', kind: 'opinion', protected: false, shared: true,
    body: 'Uczeń pracuje chętnie na materiale konkretnym, wymaga wydłużonego czasu pracy i podziału poleceń na etapy. Zalecana kontynuacja zajęć korekcyjno-kompensacyjnych.',
    date: '2026-09-18', byUserId: 'u_zielinska', createdAt: '2026-09-18T10:00:00Z'
  });
  db.col('supportDocuments').push({
    id: 's_doc_diagnoza', studentId: ST, name: 'Wyniki badań diagnostycznych poradni psychologiczno-pedagogicznej', kind: 'diagnosis', protected: true, shared: false,
    body: 'Protokół badania psychologicznego (skala WISC-V) — dokumentacja diagnostyczna poradni, nieudostępniana przez dziennik.',
    date: '2026-09-12', byUserId: 'u_zielinska', createdAt: '2026-09-12T10:00:00Z'
  });

  /* ---- 3.4.10 rejestr zdarzeń: dostęp tylko dla pedagoga prowadzącego i dyrektora ---- */
  db.col('incidents').push({
    id: 's_inc_nk_1', studentId: ST, classId, kind: 'blueCard', title: 'Procedura „Niebieska Karta”',
    text: 'Wszczęcie procedury „Niebieska Karta — A” po zgłoszeniu wychowawcy. Notatka zespołu interwencyjnego z 19.10.2026, ustalono kontakt z dzielnicowym i MOPS.',
    caseNo: 'NK-11/2026', openedAt: '2026-10-19', institution: 'KMP Kraków / MOPS Kraków',
    readerIds: ['u_pedagog', 'u_dyrektor'], ownerId: 'u_pedagog', restricted: true, accessLog: [], createdAt: '2026-10-19T11:05:00Z'
  });

  /* ---- 3.4.11 zaplanowane zajęcia wyrównawcze (bez kolizji: wtorek, 6. lekcja) ---- */
  db.col('supportSessions').push({
    id: 's_ssn_kk_1', studentId: ST, classId, date: '2026-10-27', lessonNo: 6, form: 'kk',
    name: 'Zajęcia korekcyjno-kompensacyjne', room: '18', specialistId: 'u_specjalny', at: '2026-10-20T09:00:00Z', createdAt: '2026-10-20T09:00:00Z'
  });

  /* ---- 3.4.15 trzy kolejne dni nieobecności bez informacji od rodzica ---- */
  const existing = new Set(db.col('attendance').filter((a) => a.studentId === ST && NB_DAYS.includes(a.date)).map((a) => a.date));
  for (const date of NB_DAYS) {
    if (existing.has(date)) continue;
    const lessons = db.col('lessons').filter((l) => l.date === date && l.classId === classId);
    for (const l of lessons) {
      if (l.groupId) { const g = db.get('groups', l.groupId); if (!g || !(g.studentIds || []).includes(ST)) continue; }
      db.col('attendance').push({
        id: 's_att_' + ST + '_' + date + '_' + l.lessonNo, lessonId: l.id, studentId: ST, date, lessonNo: l.lessonNo,
        classId, subjectId: l.subjectId, status: 'nb', minutes: 0, draft: false, byUserId: l.teacherId, at: date + 'T08:05:00Z', excuseId: null
      });
    }
  }

  ['wopfu', 'ipet', 'otherActivities', 'confidentialNotes', 'supportDocuments', 'supportSessions', 'speechSessions',
    'ipetImplementations', 'supportEvaluations', 'incidents', 'communityInterviews', 'reportRequests', 'attendanceAlerts', 'excuses'].forEach((c) => db.col(c));
}
module.exports = { seed, YEAR, ST, NB_DAYS };
