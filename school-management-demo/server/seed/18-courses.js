'use strict';
/* Zasiew modułu „Kursy” (LMS): kurs powtórkowy z matematyki dla 7b (3 jednostki, teksty, materiał,
   quiz na 5 pytań, zadanie domowe i wątek dyskusji) oraz otwarty kurs „Bezpieczeństwo w sieci”
   z informatyki z zapisami własnymi. Postęp uzupełniony dla Anny Kowalczyk (7b).
   Wszystkie identyfikatory mają przedrostek `co_`, żeby nie kolidowały z innymi sekcjami. */
const { addDays } = require('../lib/util');

const ANNA = 'st_kowalczyk_anna';
const PDF_URL = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+';

function seed(db) {
  const cfg = db.data.config;
  const TODAY = cfg.today;
  const push = (col, row) => { if (!db.col(col).some((x) => x.id === row.id)) db.col(col).push(row); return db.get(col, row.id); };

  /* --- materiał do pobrania wewnątrz kursu (kolekcja `materials` należy do 3.6) --- */
  push('materials', {
    id: 'co_mt_ulamki', lessonId: null, classId: '7b', subjectId: 'mat', name: 'Ułamki zwykłe – karta powtórkowa.pdf',
    type: 'application/pdf', dataUrl: PDF_URL, size: PDF_URL.length, byUserId: 'u_nowak',
    at: '2026-10-05T09:00:00.000Z', createdAt: '2026-10-05T09:00:00.000Z'
  });

  /* --- zadanie domowe pod element typu „assignment” (kolekcja `homework` należy do 3.1) --- */
  let hwId = db.get('homework', 'st_hw_mat') ? 'st_hw_mat' : 'co_hw_ulamki';
  if (hwId === 'co_hw_ulamki') {
    push('homework', {
      id: 'co_hw_ulamki', classId: '7b', groupId: null, subjectId: 'mat', teacherId: 'u_nowak',
      text: 'Kurs „Ułamki zwykłe”: zadania 1–6 z karty powtórkowej — prześlij zdjęcie rozwiązań.',
      dueAt: addDays(TODAY, 7) + 'T23:59:00.000Z', maxAttachmentMB: cfg.homeworkMaxAttachmentMB || 10,
      lockAfterDue: false, attachments: [], lessonId: null, createdAt: '2026-10-05T09:05:00.000Z'
    });
  }

  /* ===================== Kurs 1: Ułamki zwykłe – kurs powtórkowy ===================== */
  push('courses', {
    id: 'co_ulamki', title: 'Ułamki zwykłe – kurs powtórkowy',
    description: 'Powtórka przed sprawdzianem z działu III.2: pojęcie ułamka, skracanie i rozszerzanie, cztery działania i zadania tekstowe. Kurs prowadzi do zadania sprawdzającego i quizu punktowanego.',
    subjectId: 'mat', classIds: ['7b'], groupIds: [], teacherIds: ['u_nowak'],
    visibility: 'class', enrollmentOpen: false, status: 'published',
    createdAt: '2026-10-05T08:30:00.000Z', publishedAt: '2026-10-05T08:45:00.000Z',
    coverColor: 'cat-1', language: 'pl'
  });

  push('courseUnits', { id: 'co_ulamki_u1', courseId: 'co_ulamki', order: 1, title: 'Czym jest ułamek zwykły', summary: 'Licznik, mianownik, ułamki właściwe i niewłaściwe, liczby mieszane.', availableFrom: '2026-10-05', lessonId: null });
  push('courseUnits', { id: 'co_ulamki_u2', courseId: 'co_ulamki', order: 2, title: 'Cztery działania na ułamkach', summary: 'Dodawanie i odejmowanie ułamków o różnych mianownikach, mnożenie i dzielenie.', availableFrom: '2026-10-19', lessonId: null });
  push('courseUnits', { id: 'co_ulamki_u3', courseId: 'co_ulamki', order: 3, title: 'Sprawdź się przed sprawdzianem', summary: 'Zadanie do oddania w dzienniku. Jednostka otwiera się po omówieniu działu na lekcji.', availableFrom: '2026-11-02', lessonId: null });

  push('courseItems', {
    id: 'co_ulamki_i1', courseId: 'co_ulamki', unitId: 'co_ulamki_u1', order: 1, kind: 'text', required: true,
    title: 'Licznik, mianownik, liczba mieszana',
    body: 'Ułamek zwykły zapisujemy jako **a/b**, gdzie **a** to licznik, a **b** to mianownik różny od zera.\n\nZapamiętaj trzy nazwy:\n- ułamek **właściwy** — licznik jest mniejszy od mianownika, np. 3/4;\n- ułamek **niewłaściwy** — licznik jest większy lub równy mianownikowi, np. 7/4;\n- **liczba mieszana** — część całkowita i ułamek właściwy, np. 1 3/4.\n\nKażdy ułamek niewłaściwy można zamienić na liczbę mieszaną i odwrotnie. To pierwsza rzecz, którą sprawdzam na sprawdzianie.',
    materialId: null, url: null, homeworkId: null, quiz: null, meetingId: null
  });
  push('courseItems', {
    id: 'co_ulamki_i2', courseId: 'co_ulamki', unitId: 'co_ulamki_u1', order: 2, kind: 'material', required: true,
    title: 'Karta powtórkowa do wydruku', body: 'Wydrukuj kartę i rozwiąż zadania 1–4 ołówkiem. Odpowiedzi omówimy na lekcji.',
    materialId: 'co_mt_ulamki', url: null, homeworkId: null, quiz: null, meetingId: null
  });
  push('courseItems', {
    id: 'co_ulamki_i3', courseId: 'co_ulamki', unitId: 'co_ulamki_u2', order: 1, kind: 'text', required: true,
    title: 'Wspólny mianownik krok po kroku',
    body: 'Aby dodać ułamki o różnych mianownikach, sprowadzamy je do wspólnego mianownika.\n\n- znajdź najmniejszą wspólną wielokrotność mianowników;\n- rozszerz każdy ułamek;\n- dodaj liczniki, mianownik przepisz;\n- skróć wynik, jeśli się da.\n\nPrzy mnożeniu **nie szukamy** wspólnego mianownika — mnożymy licznik przez licznik i mianownik przez mianownik. Dzielenie to mnożenie przez odwrotność.',
    materialId: null, url: null, homeworkId: null, quiz: null, meetingId: null
  });
  push('courseItems', {
    id: 'co_ulamki_i4', courseId: 'co_ulamki', unitId: 'co_ulamki_u2', order: 2, kind: 'quiz', required: true,
    title: 'Quiz: działania na ułamkach', body: 'Pięć pytań jednokrotnego wyboru. Masz dwa podejścia, liczy się lepszy wynik.',
    materialId: null, url: null, homeworkId: null, meetingId: null,
    quiz: {
      attempts: 2, timeLimitMin: 15,
      questions: [
        { id: 'q1', text: 'Ile wynosi 1/2 + 1/3?', points: 2, correctId: 'b', options: [{ id: 'a', text: '2/5' }, { id: 'b', text: '5/6' }, { id: 'c', text: '1/6' }, { id: 'd', text: '2/6' }] },
        { id: 'q2', text: 'Który ułamek jest niewłaściwy?', points: 1, correctId: 'c', options: [{ id: 'a', text: '3/4' }, { id: 'b', text: '5/9' }, { id: 'c', text: '9/5' }, { id: 'd', text: '1/2' }] },
        { id: 'q3', text: 'Ile wynosi 2/3 · 3/4?', points: 2, correctId: 'a', options: [{ id: 'a', text: '1/2' }, { id: 'b', text: '6/7' }, { id: 'c', text: '5/12' }, { id: 'd', text: '2/4' }] },
        { id: 'q4', text: 'Jak zapisać 7/4 jako liczbę mieszaną?', points: 2, correctId: 'd', options: [{ id: 'a', text: '4 3/7' }, { id: 'b', text: '1 1/4' }, { id: 'c', text: '2 1/4' }, { id: 'd', text: '1 3/4' }] },
        { id: 'q5', text: 'Ile wynosi 3/5 : 3/10?', points: 3, correctId: 'b', options: [{ id: 'a', text: '9/50' }, { id: 'b', text: '2' }, { id: 'c', text: '1/2' }, { id: 'd', text: '6/15' }] }
      ]
    }
  });
  push('courseItems', {
    id: 'co_ulamki_i5', courseId: 'co_ulamki', unitId: 'co_ulamki_u3', order: 1, kind: 'assignment', required: true,
    title: 'Zadanie do oddania: karta powtórkowa', body: 'Rozwiązania oddajesz w dzienniku, w sekcji zadań domowych.',
    materialId: null, url: null, homeworkId: hwId, quiz: null, meetingId: null
  });

  /* --- element „spotkanie”: zajęcia online kursu (wiersz `co_` w kolekcji videoMeetings sekcji „meetings”) --- */
  const meetStudents = (db.get('classes', '7b').studentIds || []);
  push('videoMeetings', {
    id: 'co_me_ulamki', kind: 'course', provider: 'jitsi',
    title: 'Ułamki zwykłe — konsultacje online przed sprawdzianem',
    room: 'edmat-course-ulamki-1029', start: '2026-10-29T16:30:00.000Z', end: '2026-10-29T17:15:00.000Z',
    hostId: 'u_nowak', classIds: [], groupIds: [], moderatorIds: [],
    participantIds: db.col('users').filter((u) => u.role === 'student' && meetStudents.includes(u.studentId)).map((u) => u.id),
    courseId: 'co_ulamki', courseItemId: 'co_ulamki_i6', lessonId: null, studentId: null,
    status: 'scheduled', joinPolicy: 'invited',
    recording: { enabled: false, consentRequired: true, storedAt: 'school-server', fileId: null, consents: {} },
    waitingRoom: true, lobbyPasscode: '5064', externalUrl: null,
    note: 'Spotkanie kursu — wchodzą wyłącznie uczniowie zapisani na kurs, ze swoich kont w dzienniku.',
    createdAt: '2026-10-21T09:00:00.000Z'
  });
  push('courseItems', {
    id: 'co_ulamki_i6', courseId: 'co_ulamki', unitId: 'co_ulamki_u2', order: 3, kind: 'meeting', required: false,
    title: 'Konsultacje online przed sprawdzianem', body: 'Wejście z tej strony — pokój otwiera się 5 minut przed czasem.',
    materialId: null, url: null, homeworkId: null, quiz: null, meetingId: 'co_me_ulamki'
  });

  /* zapisy: cała klasa 7b */
  (db.get('classes', '7b').studentIds || []).forEach((sid, i) => push('courseEnrollments', {
    id: 'co_en_ulamki_' + sid, courseId: 'co_ulamki', studentId: sid, at: '2026-10-05T08:46:0' + (i % 10) + '.000Z', source: 'class'
  }));

  /* dyskusja kursu */
  push('courseThreads', { id: 'co_th_ulamki', courseId: 'co_ulamki', title: 'Pytania do działu „Ułamki zwykłe”', byUserId: 'u_nowak', at: '2026-10-06T07:30:00.000Z', pinned: true, locked: false });
  push('coursePosts', { id: 'co_ps_ulamki_1', threadId: 'co_th_ulamki', courseId: 'co_ulamki', parentId: null, byUserId: 'u_nowak', at: '2026-10-06T07:30:00.000Z', body: 'Tu zadajcie pytania do materiału. Odpowiadam codziennie po lekcjach, najpóźniej do 16:00.' });
  push('coursePosts', { id: 'co_ps_ulamki_2', threadId: 'co_th_ulamki', courseId: 'co_ulamki', parentId: 'co_ps_ulamki_1', byUserId: 'u_' + ANNA, at: '2026-10-19T17:12:00.000Z', body: 'Czy przy dzieleniu ułamków też trzeba szukać wspólnego mianownika?' });
  push('coursePosts', { id: 'co_ps_ulamki_3', threadId: 'co_th_ulamki', courseId: 'co_ulamki', parentId: 'co_ps_ulamki_1', byUserId: 'u_nowak', at: '2026-10-19T18:40:00.000Z', body: 'Nie. Dzielenie zamieniamy na mnożenie przez odwrotność drugiego ułamka — wspólny mianownik potrzebny jest tylko przy dodawaniu i odejmowaniu.' });

  /* ===================== Kurs 2: Bezpieczeństwo w sieci (otwarty) ==================== */
  push('courses', {
    id: 'co_siec', title: 'Bezpieczeństwo w sieci',
    description: 'Kurs otwarty dla wszystkich uczniów: silne hasła, phishing, ślad cyfrowy i reagowanie na cyberprzemoc. Zapisujesz się sam, w dowolnym momencie.',
    subjectId: 'inf', classIds: [], groupIds: [], teacherIds: ['u_wojcik'],
    visibility: 'open', enrollmentOpen: true, status: 'published',
    createdAt: '2026-09-28T10:00:00.000Z', publishedAt: '2026-09-28T10:20:00.000Z',
    coverColor: 'cat-4', language: 'pl'
  });
  push('courseUnits', { id: 'co_siec_u1', courseId: 'co_siec', order: 1, title: 'Hasła i logowanie', summary: 'Jak zbudować hasło, którego nikt nie zgadnie, i po co dwa składniki logowania.', availableFrom: '2026-09-28', lessonId: null });
  push('courseUnits', { id: 'co_siec_u2', courseId: 'co_siec', order: 2, title: 'Phishing i ślad cyfrowy', summary: 'Rozpoznawanie fałszywych wiadomości i świadome zostawianie śladów w sieci.', availableFrom: '2026-10-12', lessonId: null });

  push('courseItems', {
    id: 'co_siec_i1', courseId: 'co_siec', unitId: 'co_siec_u1', order: 1, kind: 'text', required: true,
    title: 'Dobre hasło w trzech krokach',
    body: 'Dobre hasło jest **długie**, **niepowtarzalne** i **zapamiętywalne**.\n\n- co najmniej 12 znaków — długość jest ważniejsza od dziwnych znaków;\n- inne hasło do każdej usługi;\n- nigdy imienia psa, daty urodzenia ani „qwerty123”.\n\nNajprościej zbudować hasło z trzech niepowiązanych słów i liczby, np. „rower-lampa-tygrys-41”.',
    materialId: null, url: null, homeworkId: null, quiz: null, meetingId: null
  });
  push('courseItems', {
    id: 'co_siec_i2', courseId: 'co_siec', unitId: 'co_siec_u1', order: 2, kind: 'link', required: false,
    title: 'Poradnik CERT Polska dla uczniów', body: 'Materiał dodatkowy — nie jest wymagany do ukończenia kursu.',
    materialId: null, url: 'https://cert.pl/', homeworkId: null, quiz: null, meetingId: null
  });
  push('courseItems', {
    id: 'co_siec_i3', courseId: 'co_siec', unitId: 'co_siec_u2', order: 1, kind: 'text', required: true,
    title: 'Jak rozpoznać phishing',
    body: 'Fałszywa wiadomość prawie zawsze **spieszy** i **straszy**.\n\n- nadawca podszywa się pod znaną instytucję, ale adres jest dziwny;\n- w treści jest link „potwierdź dane w 24 godziny”;\n- prosi o hasło albo kod z SMS-a.\n\nSzkoła ani bank nigdy nie proszą o hasło. W razie wątpliwości pokaż wiadomość dorosłemu.',
    materialId: null, url: null, homeworkId: null, quiz: null, meetingId: null
  });
  push('courseItems', {
    id: 'co_siec_i4', courseId: 'co_siec', unitId: 'co_siec_u2', order: 2, kind: 'quiz', required: true,
    title: 'Quiz: czy to phishing?', body: 'Trzy krótkie pytania. Jedno podejście.',
    materialId: null, url: null, homeworkId: null, meetingId: null,
    quiz: {
      attempts: 1, timeLimitMin: null,
      questions: [
        { id: 'q1', text: 'Dostajesz SMS: „Twoja paczka czeka, dopłać 1 zł: link”. Co robisz?', points: 2, correctId: 'c', options: [{ id: 'a', text: 'Klikam i płacę' }, { id: 'b', text: 'Podaję dane karty' }, { id: 'c', text: 'Nie klikam i pokazuję wiadomość rodzicowi' }] },
        { id: 'q2', text: 'Które hasło jest najlepsze?', points: 2, correctId: 'b', options: [{ id: 'a', text: 'Ania2013' }, { id: 'b', text: 'rower-lampa-tygrys-41' }, { id: 'c', text: 'qwerty123' }] },
        { id: 'q3', text: 'Kolega prosi o Twoje hasło do dziennika. Co robisz?', points: 1, correctId: 'a', options: [{ id: 'a', text: 'Nie podaję — hasło jest tylko moje' }, { id: 'b', text: 'Podaję, to przecież kolega' }] }
      ]
    }
  });

  /* --- postęp Anny Kowalczyk (7b) --- */
  push('courseEnrollments', { id: 'co_en_siec_anna', courseId: 'co_siec', studentId: ANNA, at: '2026-10-14T16:20:00.000Z', source: 'self' });
  push('courseProgress', { id: 'co_pr_anna_1', courseId: 'co_ulamki', studentId: ANNA, itemId: 'co_ulamki_i1', status: 'done', score: null, at: '2026-10-06T16:05:00.000Z' });
  push('courseProgress', { id: 'co_pr_anna_2', courseId: 'co_ulamki', studentId: ANNA, itemId: 'co_ulamki_i2', status: 'done', score: null, at: '2026-10-06T16:22:00.000Z' });
  push('courseProgress', { id: 'co_pr_anna_3', courseId: 'co_ulamki', studentId: ANNA, itemId: 'co_ulamki_i3', status: 'done', score: null, at: '2026-10-20T17:40:00.000Z' });
  push('courseProgress', { id: 'co_pr_anna_4', courseId: 'co_ulamki', studentId: ANNA, itemId: 'co_ulamki_i4', status: 'done', score: 7, at: '2026-10-20T18:05:00.000Z' });
  push('quizAttempts', { id: 'co_qa_anna_1', itemId: 'co_ulamki_i4', courseId: 'co_ulamki', studentId: ANNA, answers: { q1: 'b', q2: 'c', q3: 'a', q4: 'b', q5: 'a' }, score: 5, maxScore: 10, at: '2026-10-20T17:55:00.000Z', autoGraded: true });
  push('quizAttempts', { id: 'co_qa_anna_2', itemId: 'co_ulamki_i4', courseId: 'co_ulamki', studentId: ANNA, answers: { q1: 'b', q2: 'c', q3: 'a', q4: 'd', q5: 'a' }, score: 7, maxScore: 10, at: '2026-10-20T18:05:00.000Z', autoGraded: true });
  push('courseProgress', { id: 'co_pr_anna_5', courseId: 'co_siec', studentId: ANNA, itemId: 'co_siec_i1', status: 'done', score: null, at: '2026-10-14T16:31:00.000Z' });

  /* kilkoro innych uczniów 7b, żeby dziennik postępów nie był pusty */
  push('courseProgress', { id: 'co_pr_jan_1', courseId: 'co_ulamki', studentId: 'st_nowak_jan', itemId: 'co_ulamki_i1', status: 'done', score: null, at: '2026-10-07T18:10:00.000Z' });
  push('courseProgress', { id: 'co_pr_maja_1', courseId: 'co_ulamki', studentId: 'st_adamczyk_maja', itemId: 'co_ulamki_i1', status: 'done', score: null, at: '2026-10-06T19:02:00.000Z' });
  push('courseProgress', { id: 'co_pr_maja_2', courseId: 'co_ulamki', studentId: 'st_adamczyk_maja', itemId: 'co_ulamki_i3', status: 'done', score: null, at: '2026-10-20T19:30:00.000Z' });

  ['courses', 'courseUnits', 'courseItems', 'courseEnrollments', 'courseProgress', 'quizAttempts', 'courseThreads', 'coursePosts'].forEach((c) => db.col(c));
}
module.exports = { seed };
