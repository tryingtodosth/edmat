/* 3.4 — Zespół pomocy psychologiczno-pedagogicznej: WOPFU, IPET, dziennik zajęć innych, notatki poufne, ewaluacja. */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'su.title': 'Pomoc psychologiczno-pedagogiczna',
      'su.sub': 'WOPFU, IPET, dziennik zajęć innych, notatki poufne i ewaluacja skuteczności pomocy.',
      'su.loadingDocs': 'Ładowanie dokumentacji…',
      'su.socialWelfareOpt': 'pomoc społeczna',
      'su.studentLine': '{no}. {name} · {cls}',
      'su.homeroomLine': 'Wychowawca: {homeroom} · rodzic: {parents}',
      'su.badge.ipet': 'IPET aktywny',
      'su.badge.wopfu': 'WOPFU wersja {n}',
      'su.badge.welfare': 'Pomoc społeczna',
      'su.badge.incidents': 'Rejestr zdarzeń',
      'su.alerts.title': 'Monitoring frekwencji uczniów objętych pomocą społeczną',
      'su.alerts.call': 'Zadzwoń do opiekuna',
      'su.alerts.contactNote': 'Kontakt telefoniczny z opiekunem',
      'su.alerts.contactDone': 'Kontakt z opiekunem odnotowano w dzienniku pedagoga.',
      'su.alerts.line': '{name}: {days} bez informacji od rodzica ({dates}).',
      'su.alerts.days.one': '{n} dzień nieobecności',
      'su.alerts.days.few': '{n} dni nieobecności',
      'su.alerts.days.many': '{n} dni nieobecności',
      'su.docs.heading': 'Dokumentacja ucznia',
      'su.tabs.label': 'Dokumentacja pomocy psychologiczno-pedagogicznej',
      'su.tab.wopfu': 'WOPFU',
      'su.tab.ipet': 'IPET',
      'su.tab.journal': 'Dziennik zajęć innych',
      'su.tab.notes': 'Notatki poufne',
      'su.tab.evaluation': 'Ewaluacja',

      'su.wopfu.noneTitle': 'Brak dokumentu WOPFU',
      'su.wopfu.noneText': 'Dla tego ucznia nie utworzono jeszcze wielospecjalistycznej oceny poziomu funkcjonowania.',
      'su.wopfu.editTitle': 'Wspólna redakcja dokumentu',
      'su.wopfu.editText': 'Dokument otwarty do wspólnej edycji. Każda zmiana trafia do historii wersji z nazwiskiem autora.',
      'su.wopfu.invite': 'Zaproś nauczyciela do edycji',
      'su.wopfu.strengths': 'Mocne strony',
      'su.wopfu.strengthsHint': 'Sekcja widoczna dla rodzica w wyciągu z WOPFU.',
      'su.wopfu.barriers': 'Bariery i ograniczenia utrudniające funkcjonowanie',
      'su.wopfu.recommendations': 'Zalecenia do pracy z uczniem',
      'su.wopfu.save': 'Zapisz WOPFU',
      'su.wopfu.saved': 'Zapisano WOPFU. Zmiany trafiły do historii wersji.',
      'su.wopfu.rollover': 'Przenieś na rok {year}',
      'su.wopfu.rolledOver': 'Przeniesiono IPET i WOPFU na rok {year}. Poprzednia wersja pozostaje w historii.',
      'su.wopfu.history': 'Historia wersji',
      'su.wopfu.rolledFrom': 'Przeniesiono z poprzedniego roku',
      'su.wopfu.version': 'Wersja {n}',
      'su.wopfu.versionTarget': 'WOPFU · wersja {n}',
      'su.wopfu.act.edit': 'zmieniła sekcję „{section}”',
      'su.wopfu.act.invite': 'zaprosiła do edycji',
      'su.wopfu.act.rollover': 'przeniosła dokument na nowy rok',
      'su.wopfu.act.create': 'utworzyła dokument',
      'su.sec.mocne': 'mocne strony',
      'su.sec.bariery': 'bariery',
      'su.sec.zalecenia': 'zalecenia',

      'su.invite.title': 'Zaproś nauczyciela do edycji WOPFU',
      'su.invite.text': 'Zaproszony nauczyciel otrzyma powiadomienie i dostęp do wspólnej redakcji. Każda zmiana zostanie podpisana jego nazwiskiem w historii wersji.',
      'su.invite.pick': 'Wybierz nauczyciela uczącego w klasie {cls}',
      'su.invite.limited': 'Dostęp tylko do sekcji „Mocne strony” i „Bariery”',
      'su.invite.limitedHint': 'Zalecenia i dokumentacja diagnostyczna pozostają widoczne wyłącznie dla zespołu.',
      'su.invite.send': 'Wyślij zaproszenie',
      'su.invite.sent': 'Wysłano zaproszenie do wspólnej edycji WOPFU. Nauczyciel otrzymał powiadomienie.',

      'su.ipet.noneTitle': 'Brak IPET',
      'su.ipet.noneText': 'Uczeń nie ma indywidualnego programu edukacyjno-terapeutycznego w tym roku szkolnym.',
      'su.ipet.formsTitle': 'Formy pomocy i dostosowania',
      'su.ipet.basis': 'Podstawa: {basis}',
      'su.ipet.formsCaption': 'Formy pomocy psychologiczno-pedagogicznej',
      'su.ipet.colForm': 'Forma',
      'su.ipet.colHours': 'Godz. tyg.',
      'su.ipet.rehab': 'Zajęcia rewalidacyjne',
      'su.ipet.rehabValue': '{n} godz./tydz.',
      'su.ipet.rehabHint': 'Wymiar ustalony w arkuszu organizacyjnym.',
      'su.ipet.exam': 'Dostosowania egzaminu zewnętrznego',
      'su.ipet.examNone': 'brak dostosowań',
      'su.ipet.integrated': 'Zintegrowane działania nauczycieli i specjalistów',

      'su.sched.title': 'Harmonogram zajęć · {month} {year}',
      'su.sched.conflictTitle': 'Konflikt w planie',
      'su.sched.conflictText': 'Kolizja {date}: {subject} ({lessonNo}. lekcja, {start}–{end}) to zajęcia obowiązkowe ucznia. Wybierz inną godzinę.',
      'su.sched.date': 'Data zajęć',
      'su.sched.lessonNo': 'Nr lekcji',
      'su.sched.form': 'Forma',
      'su.sched.plan': 'Zaplanuj zajęcia',
      'su.sched.planned': 'Zaplanowano zajęcia {date}, {lessonNo}. lekcja.',
      'su.sched.plannedToast': 'Zaplanowano zajęcia.',
      'su.sched.count': 'Zaplanowane zajęcia: {n}.',
      'su.sched.event': '{name}, {lessonNo}. lekcja',
      'su.form.rewalidacja': 'Zajęcia rewalidacyjne',
      'su.form.kk': 'Zajęcia korekcyjno-kompensacyjne',
      'su.form.logopedia': 'Terapia logopedyczna',
      'su.form.emo': 'Zajęcia rozwijające kompetencje emocjonalno-społeczne',
      'su.form.dydaktyczno': 'Zajęcia dydaktyczno-wyrównawcze',

      'su.impl.title': 'Dzienna realizacja zaleceń',
      'su.impl.text': 'Wpisy nauczyciela wspomagającego z widoku dziennika lekcyjnego.',
      'su.impl.caption': 'Realizacja zaleceń IPET na lekcjach',
      'su.impl.colLesson': 'Lekcja',
      'su.impl.colRecs': 'Zrealizowane zalecenia',
      'su.impl.none': 'Nie odnotowano jeszcze realizacji zaleceń.',

      'su.journal.title': 'Dziennik zajęć innych',
      'su.journal.inXml': 'Ujęte w eksporcie XML',
      'su.journal.notesOut': 'Notatki terapeutyczne poza eksportem',
      'su.journal.text': 'Eksport klasy do XML obejmuje wyłącznie formalne wpisy frekwencji i tematy z tego dziennika. Treść notatek z interwencji oraz diagnozy nie są przekazywane.',
      'su.journal.export': 'Eksportuj XML klasy {cls}',
      'su.journal.caption': 'Zajęcia inne · {name}, {cls}',
      'su.journal.colTopic': 'Temat zajęć',
      'su.journal.colGoal': 'Cel terapeutyczny',
      'su.journal.colPresence': 'Obecność',
      'su.journal.none': 'Uczeń nie jest zapisany na zajęcia inne.',
      'su.speech.title': 'Terapia logopedyczna',
      'su.speech.parentOnly': 'Widoczne wyłącznie na koncie rodzica',
      'su.speech.text': 'Wpisy z zajęć logopedycznych (ćwiczenia artykulacyjne i zalecenia do domu) pojawiają się wyłącznie na koncie rodzica. Nauczyciele przedmiotów nie mają do nich dostępu.',
      'su.speech.count': 'Zapisanych wpisów: {n}.',

      'su.notes.title': 'Nowa notatka z interwencji',
      'su.notes.text': 'Treść notatki',
      'su.notes.placeholder': 'Przebieg rozmowy, ustalenia, termin kolejnego spotkania',
      'su.notes.hint': 'Notatka zostanie zaszyfrowana kluczem publicznym wskazanych odbiorców. Treść nie trafia do eksportów XML ani PDF.',
      'su.notes.readers': 'Kto może czytać',
      'su.notes.onlyMe': 'Tylko ja',
      'su.notes.deputy': 'Ja i zastępca: {name}',
      'su.notes.save': 'Zapisz zaszyfrowaną',
      'su.notes.saved': 'Notatkę zaszyfrowano kluczem publicznym wskazanych czytelników. Treść nie trafia do eksportów XML ani PDF.',
      'su.notes.meta': 'Szyfrowanie asymetryczne · {alg}',
      'su.incidents.title': 'Rejestr zdarzeń · Niebieska Karta i nadzór kuratora',
      'su.incidents.text': 'Dostęp ograniczony na poziomie bazy danych: rejestr widzą wyłącznie pedagog prowadzący sprawę i czytelnicy wskazani przez dyrektora. Każda próba dostępu jest rejestrowana.',
      'su.incidents.probation': 'Nadzór kuratora',
      'su.incidents.blueCard': 'Niebieska Karta',
      'su.incidents.none': 'Brak wpisów w rejestrze zdarzeń dla tego ucznia.',
      'su.incidents.locked': 'Wpis zamknięty — komentarze widzą wyłącznie czytelnicy tego wpisu.',

      'su.eval.title': 'Skuteczność pomocy · semestr 1, {year}',
      'su.eval.goalValue': '{value} % (cel {target} %)',
      'su.eval.noGoals': 'Brak celów IPET do oceny.',
      'su.eval.attendance': 'Frekwencja na zajęciach',
      'su.eval.attendanceHint': '{present} z {planned} spotkań',
      'su.eval.entries': 'Wpisy realizacji zaleceń',
      'su.eval.goalsMet': 'Cele osiągnięte',
      'su.eval.goalsMetValue': '{met} z {total}',
      'su.eval.generate': 'Generuj ewaluację i otwórz do druku (PDF)',
      'su.eval.saved': 'Ewaluacja zapisana.',
      'su.eval.note': 'Dokument do druku nie zawiera treści notatek poufnych ani dokumentacji diagnostycznej.',
      'su.share.title': 'Udostępnianie rodzicowi',
      'su.share.text': 'Rodzic widzi wyłącznie dokumenty oznaczone jako publiczna opinia lub wyciąg. Dokumentacja diagnostyczna pozostaje w poradni.',
      'su.share.caption': 'Dokumenty ucznia i zakres udostępnienia rodzicowi',
      'su.share.colDoc': 'Dokument',
      'su.share.colKind': 'Rodzaj',
      'su.share.colShare': 'Udostępnij rodzicowi',
      'su.share.protected': 'Chroniona (diagnoza)',
      'su.share.public': 'Publiczna opinia',
      'su.share.switch': 'Udostępnij',
      'su.share.off': 'nie',
      'su.share.on': 'tak',
      'su.share.protectedHint': 'Dokumentacja badań diagnostycznych nie jest udostępniana przez dziennik. Rodzic odbiera ją w poradni.',
      'su.share.done': 'Udostępniono rodzicowi: {name}',
      'su.share.undone': 'Cofnięto udostępnienie: {name}',

      'su.month.1': 'Styczeń', 'su.month.2': 'Luty', 'su.month.3': 'Marzec', 'su.month.4': 'Kwiecień', 'su.month.5': 'Maj', 'su.month.6': 'Czerwiec',
      'su.month.7': 'Lipiec', 'su.month.8': 'Sierpień', 'su.month.9': 'Wrzesień', 'su.month.10': 'Październik', 'su.month.11': 'Listopad', 'su.month.12': 'Grudzień',
      'su.monthOf.1': 'stycznia', 'su.monthOf.2': 'lutego', 'su.monthOf.3': 'marca', 'su.monthOf.4': 'kwietnia', 'su.monthOf.5': 'maja', 'su.monthOf.6': 'czerwca',
      'su.monthOf.7': 'lipca', 'su.monthOf.8': 'sierpnia', 'su.monthOf.9': 'września', 'su.monthOf.10': 'października', 'su.monthOf.11': 'listopada', 'su.monthOf.12': 'grudnia'
    },
    en: {
      'su.title': 'Psychological and pedagogical support',
      'su.sub': 'WOPFU, IPET, the journal of other activities, confidential notes and an evaluation of how well the support works.',
      'su.loadingDocs': 'Loading documentation…',
      'su.socialWelfareOpt': 'social welfare',
      'su.studentLine': '{no}. {name} · {cls}',
      'su.homeroomLine': 'Homeroom teacher: {homeroom} · parent: {parents}',
      'su.badge.ipet': 'IPET active',
      'su.badge.wopfu': 'WOPFU version {n}',
      'su.badge.welfare': 'Social welfare',
      'su.badge.incidents': 'Incident register',
      'su.alerts.title': 'Attendance monitoring for students covered by social welfare',
      'su.alerts.call': 'Call the guardian',
      'su.alerts.contactNote': 'Phone call with the guardian',
      'su.alerts.contactDone': 'The contact with the guardian was recorded in the counsellor’s journal.',
      'su.alerts.line': '{name}: {days} with no word from a parent ({dates}).',
      'su.alerts.days.one': '{n} day of absence',
      'su.alerts.days.other': '{n} days of absence',
      'su.docs.heading': 'Student documentation',
      'su.tabs.label': 'Psychological and pedagogical support documentation',
      'su.tab.wopfu': 'WOPFU (multi-specialist assessment)',
      'su.tab.ipet': 'IPET (individual programme)',
      'su.tab.journal': 'Journal of other activities',
      'su.tab.notes': 'Confidential notes',
      'su.tab.evaluation': 'Evaluation',

      'su.wopfu.noneTitle': 'No WOPFU document',
      'su.wopfu.noneText': 'No multi-specialist assessment of the level of functioning (WOPFU) has been created for this student yet.',
      'su.wopfu.editTitle': 'Joint editing of the document',
      'su.wopfu.editText': 'The document is open for joint editing. Every change goes into the version history with the author’s name.',
      'su.wopfu.invite': 'Invite a teacher to edit',
      'su.wopfu.strengths': 'Strengths',
      'su.wopfu.strengthsHint': 'This section is visible to the parent in the WOPFU extract.',
      'su.wopfu.barriers': 'Barriers and limitations that hinder functioning',
      'su.wopfu.recommendations': 'Recommendations for working with the student',
      'su.wopfu.save': 'Save WOPFU',
      'su.wopfu.saved': 'WOPFU saved. The changes went into the version history.',
      'su.wopfu.rollover': 'Carry over to {year}',
      'su.wopfu.rolledOver': 'IPET and WOPFU were carried over to {year}. The previous version stays in the history.',
      'su.wopfu.history': 'Version history',
      'su.wopfu.rolledFrom': 'Carried over from the previous year',
      'su.wopfu.version': 'Version {n}',
      'su.wopfu.versionTarget': 'WOPFU · version {n}',
      'su.wopfu.act.edit': 'changed the “{section}” section',
      'su.wopfu.act.invite': 'invited a co-editor',
      'su.wopfu.act.rollover': 'carried the document over to a new year',
      'su.wopfu.act.create': 'created the document',
      'su.sec.mocne': 'strengths',
      'su.sec.bariery': 'barriers',
      'su.sec.zalecenia': 'recommendations',

      'su.invite.title': 'Invite a teacher to edit the WOPFU',
      'su.invite.text': 'The invited teacher receives a notification and access to joint editing. Every change is signed with their name in the version history.',
      'su.invite.pick': 'Choose a teacher who teaches class {cls}',
      'su.invite.limited': 'Access only to the “Strengths” and “Barriers” sections',
      'su.invite.limitedHint': 'Recommendations and diagnostic documentation stay visible to the team only.',
      'su.invite.send': 'Send the invitation',
      'su.invite.sent': 'The invitation to co-edit the WOPFU was sent. The teacher received a notification.',

      'su.ipet.noneTitle': 'No IPET',
      'su.ipet.noneText': 'The student has no IPET (individual educational-therapeutic programme) this school year.',
      'su.ipet.formsTitle': 'Forms of support and accommodations',
      'su.ipet.basis': 'Basis: {basis}',
      'su.ipet.formsCaption': 'Forms of psychological and pedagogical support',
      'su.ipet.colForm': 'Form',
      'su.ipet.colHours': 'Hrs/week',
      'su.ipet.rehab': 'Rehabilitation classes',
      'su.ipet.rehabValue': '{n} hrs/week',
      'su.ipet.rehabHint': 'The allocation set in the school organisation sheet.',
      'su.ipet.exam': 'External exam accommodations',
      'su.ipet.examNone': 'no accommodations',
      'su.ipet.integrated': 'Integrated actions of teachers and specialists',

      'su.sched.title': 'Timetable of classes · {month} {year}',
      'su.sched.conflictTitle': 'Clash in the timetable',
      'su.sched.conflictText': 'Clash on {date}: {subject} (lesson {lessonNo}, {start}–{end}) is a compulsory class for this student. Pick another time.',
      'su.sched.date': 'Date of the class',
      'su.sched.lessonNo': 'Lesson no.',
      'su.sched.form': 'Form',
      'su.sched.plan': 'Schedule the class',
      'su.sched.planned': 'Class scheduled for {date}, lesson {lessonNo}.',
      'su.sched.plannedToast': 'Class scheduled.',
      'su.sched.count': 'Scheduled classes: {n}.',
      'su.sched.event': '{name}, lesson {lessonNo}',
      'su.form.rewalidacja': 'Rehabilitation classes',
      'su.form.kk': 'Corrective and compensatory classes',
      'su.form.logopedia': 'Speech therapy',
      'su.form.emo': 'Classes developing emotional and social skills',
      'su.form.dydaktyczno': 'Remedial teaching classes',

      'su.impl.title': 'Day-to-day delivery of the recommendations',
      'su.impl.text': 'Entries made by the support teacher from the lesson logbook view.',
      'su.impl.caption': 'Delivery of the IPET recommendations during lessons',
      'su.impl.colLesson': 'Lesson',
      'su.impl.colRecs': 'Recommendations delivered',
      'su.impl.none': 'No delivery of the recommendations has been recorded yet.',

      'su.journal.title': 'Journal of other activities',
      'su.journal.inXml': 'Included in the XML export',
      'su.journal.notesOut': 'Therapy notes stay out of the export',
      'su.journal.text': 'The class XML export covers only the formal attendance entries and the topics from this journal. The content of intervention notes and diagnoses is not handed over.',
      'su.journal.export': 'Export XML for class {cls}',
      'su.journal.caption': 'Other activities · {name}, {cls}',
      'su.journal.colTopic': 'Topic of the class',
      'su.journal.colGoal': 'Therapeutic goal',
      'su.journal.colPresence': 'Presence',
      'su.journal.none': 'The student is not enrolled in any other activities.',
      'su.speech.title': 'Speech therapy',
      'su.speech.parentOnly': 'Visible on the parent account only',
      'su.speech.text': 'Entries from speech therapy sessions (articulation exercises and homework recommendations) appear on the parent account only. Subject teachers have no access to them.',
      'su.speech.count': 'Entries recorded: {n}.',

      'su.notes.title': 'New intervention note',
      'su.notes.text': 'Note content',
      'su.notes.placeholder': 'Course of the conversation, arrangements, date of the next meeting',
      'su.notes.hint': 'The note will be encrypted with the public key of the chosen readers. The content does not go into XML or PDF exports.',
      'su.notes.readers': 'Who may read it',
      'su.notes.onlyMe': 'Only me',
      'su.notes.deputy': 'Me and a deputy: {name}',
      'su.notes.save': 'Save encrypted',
      'su.notes.saved': 'The note was encrypted with the public key of the chosen readers. The content does not go into XML or PDF exports.',
      'su.notes.meta': 'Asymmetric encryption · {alg}',
      'su.incidents.title': 'Incident register · Niebieska Karta (the “Blue Card” domestic-violence procedure) and court-guardian supervision',
      'su.incidents.text': 'Access is restricted at the database level: only the counsellor handling the case and the readers named by the principal can see the register. Every attempt to access it is logged.',
      'su.incidents.probation': 'Court-guardian supervision',
      'su.incidents.blueCard': 'Niebieska Karta',
      'su.incidents.none': 'No entries in the incident register for this student.',
      'su.incidents.locked': 'Entry sealed — only the readers of this entry can see its comments.',

      'su.eval.title': 'Effectiveness of the support · semester 1, {year}',
      'su.eval.goalValue': '{value}% (target {target}%)',
      'su.eval.noGoals': 'No IPET goals to assess.',
      'su.eval.attendance': 'Attendance at the classes',
      'su.eval.attendanceHint': '{present} of {planned} meetings',
      'su.eval.entries': 'Delivery entries',
      'su.eval.goalsMet': 'Goals met',
      'su.eval.goalsMetValue': '{met} of {total}',
      'su.eval.generate': 'Generate the evaluation and open it for print (PDF)',
      'su.eval.saved': 'Evaluation saved.',
      'su.eval.note': 'The printable document contains neither the confidential notes nor the diagnostic documentation.',
      'su.share.title': 'Sharing with the parent',
      'su.share.text': 'The parent sees only documents marked as a public opinion or an extract. Diagnostic documentation stays at the counselling centre.',
      'su.share.caption': 'The student’s documents and what is shared with the parent',
      'su.share.colDoc': 'Document',
      'su.share.colKind': 'Type',
      'su.share.colShare': 'Share with the parent',
      'su.share.protected': 'Protected (diagnosis)',
      'su.share.public': 'Public opinion',
      'su.share.switch': 'Share',
      'su.share.off': 'no',
      'su.share.on': 'yes',
      'su.share.protectedHint': 'Diagnostic test documentation is not shared through the logbook. The parent collects it at the counselling centre.',
      'su.share.done': 'Shared with the parent: {name}',
      'su.share.undone': 'Sharing withdrawn: {name}',

      'su.month.1': 'January', 'su.month.2': 'February', 'su.month.3': 'March', 'su.month.4': 'April', 'su.month.5': 'May', 'su.month.6': 'June',
      'su.month.7': 'July', 'su.month.8': 'August', 'su.month.9': 'September', 'su.month.10': 'October', 'su.month.11': 'November', 'su.month.12': 'December',
      'su.monthOf.1': 'January', 'su.monthOf.2': 'February', 'su.monthOf.3': 'March', 'su.monthOf.4': 'April', 'su.monthOf.5': 'May', 'su.monthOf.6': 'June',
      'su.monthOf.7': 'July', 'su.monthOf.8': 'August', 'su.monthOf.9': 'September', 'su.monthOf.10': 'October', 'su.monthOf.11': 'November', 'su.monthOf.12': 'December'
    }
  });

  /* `name` stays Polish: it is stored on the server row and printed in official documentation. */
  var FORMY = [
    { value: 'rewalidacja', name: 'Zajęcia rewalidacyjne' },
    { value: 'kk', name: 'Zajęcia korekcyjno-kompensacyjne' },
    { value: 'logopedia', name: 'Terapia logopedyczna' },
    { value: 'emo', name: 'Zajęcia rozwijające kompetencje emocjonalno-społeczne' },
    { value: 'dydaktyczno', name: 'Zajęcia dydaktyczno-wyrównawcze' }
  ];
  /* Reason lines recorded in the document's audit trail stay Polish — they are part of the official record. */
  var REASON_TEAM_EDIT = 'Edycja zespołowa z widoku pomocy p-p';

  function monthOf(m) { return A.t('su.monthOf.' + (m + 1)); }
  function monthName(m) { return A.t('su.month.' + (m + 1)); }

  function iso(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function wd(dateIso) { var x = new Date(dateIso + 'T00:00:00Z').getUTCDay(); return x === 0 ? 7 : x; }
  /** Month grid for E.Calendar: leading/trailing days from the neighbouring months are marked off. */
  function buildMonth(y, m, eventsByDate, today) {
    var days = [], i;
    var first = iso(y, m, 1), lead = wd(first) - 1;
    var prevLen = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (i = lead; i > 0; i--) days.push({ d: prevLen - i + 1, label: (prevLen - i + 1) + ' ' + monthOf((m + 11) % 12), off: true });
    var len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (i = 1; i <= len; i++) {
      var key = iso(y, m, i);
      days.push({ d: i, off: wd(key) > 5, today: key === today, events: eventsByDate[key] || undefined });
    }
    var tail = (7 - (days.length % 7)) % 7;
    for (i = 1; i <= tail; i++) days.push({ d: i, label: i + ' ' + monthOf((m + 1) % 12), off: true });
    return days;
  }
  function Card(p) {
    return h('section', { className: 'card' + (p.className ? ' ' + p.className : '') },
      p.title && h(p.level || 'h3', null, p.title),
      h('div', { className: 'stack' }, p.children));
  }

  function Screen(props) {
    var user = props.user, q = props.route.query;
    var students = A.useApi('/api/support/students', []);
    var st = React.useState(q.studentId || ''), sid = st[0], setSid = st[1];
    React.useEffect(function () {
      if (!sid && students.data && students.data.length) {
        var pick = students.data.filter(function (s) { return s.hasIpet; })[0] || students.data[0];
        setSid(pick.id);
      }
    }, [students.data]);
    var ov = A.useApi(sid ? '/api/support/overview?studentId=' + encodeURIComponent(sid) : null, [sid]);
    var tabSt = React.useState(q.tab || 'wopfu'), tab = tabSt[0], setTab = tabSt[1];
    var msgSt = React.useState(''), msg = msgSt[0], setMsg = msgSt[1];
    var busySt = React.useState(false), busy = busySt[0], setBusy = busySt[1];
    var d = ov.data;

    /* liczniki komentarzy z przeglądu: { incidents: {...}, wopfuVersions: {...} } */
    function cmt(group) { return (d && d.comments && d.comments[group]) || {}; }
    function reloadCounts() { ov.reload(); }

    /* WOPFU */
    var secSt = React.useState(null), secs = secSt[0], setSecs = secSt[1];
    React.useEffect(function () { setSecs(d && d.wopfu ? Object.assign({}, d.wopfu.sections) : null); }, [d && d.wopfu && d.wopfu.id, d && d.wopfu && d.wopfu.versions.length]);
    var invSt = React.useState({ open: false, userId: '', limited: true }), inv = invSt[0], setInv = invSt[1];

    /* zajęcia / kalendarz */
    var sesSt = React.useState({ date: '', lessonNo: '3', form: 'kk' }), ses = sesSt[0], setSes = sesSt[1];
    var confSt = React.useState(null), conflict = confSt[0], setConflict = confSt[1];

    /* notatka */
    var noteSt = React.useState({ text: '', reader: '' }), note = noteSt[0], setNote = noteSt[1];

    function run(p, okText) {
      setBusy(true);
      return p.then(function (r) { setBusy(false); if (okText) { setMsg(okText); A.toast(okText, 'success'); } ov.reload(); return r; })
        .catch(function (e) { setBusy(false); setMsg(e.message); A.toast(e.message, 'danger'); throw e; });
    }
    A.onSave(React.useCallback(function () { if (d && d.wopfu && secs) saveWopfu(); }, [d, secs]));

    function saveWopfu() {
      if (!d || !d.wopfu) return;
      run(A.api.patch('/api/support/wopfu/' + d.wopfu.id, { sections: secs, reason: REASON_TEAM_EDIT }), A.t('su.wopfu.saved'));
    }
    function sendInvite() {
      run(A.api.post('/api/support/wopfu/' + d.wopfu.id + '/invite', { userId: inv.userId, scope: inv.limited ? 'sections' : 'all', sections: ['mocne', 'bariery'] }),
        A.t('su.invite.sent'));
      setInv({ open: false, userId: '', limited: true });
    }
    function addSession() {
      setConflict(null);
      A.api.post('/api/support/sessions', { studentId: sid, date: ses.date, lessonNo: +ses.lessonNo, form: ses.form, name: (FORMY.filter(function (f) { return f.value === ses.form; })[0] || {}).name })
        .then(function () { setMsg(A.t('su.sched.planned', { date: A.fmtDate(ses.date), lessonNo: ses.lessonNo })); A.toast(A.t('su.sched.plannedToast'), 'success'); ov.reload(); })
        .catch(function (e) { if (e.data && e.data.conflict) { setConflict(e.data.conflict); setMsg(e.message); } else A.toast(e.message, 'danger'); });
    }
    function saveNote() {
      run(A.api.post('/api/support/notes', { studentId: sid, text: note.text, readerIds: note.reader ? [note.reader] : [] }), A.t('su.notes.saved'));
      setNote({ text: '', reader: note.reader });
    }
    function makeEvaluation() {
      run(A.api.post('/api/support/evaluations', { studentId: sid, semester: 1 }), A.t('su.eval.saved'))
        .then(function (row) { A.openPrint('/api/support/evaluations/' + row.id + '/print?print=1'); });
    }

    if (students.error) return h('div', null, h('h1', { className: 'display app-title' }, A.t('su.title')), h(E.Alert, { tone: 'danger' }, students.error.message));

    var studentOptions = (students.data || []).map(function (s) { return { value: s.id, label: s.classId + ' · ' + s.name + (s.socialWelfare ? ' · ' + A.t('su.socialWelfareOpt') : '') }; });
    var s = d && d.student;
    var eventsByDate = {};
    if (d) (d.sessions || []).forEach(function (x) { (eventsByDate[x.date] = eventsByDate[x.date] || []).push({ kind: 'meet', text: A.t('su.sched.event', { name: x.name, lessonNo: x.lessonNo }) }); });
    var today = (props.config && props.config.today) || '2026-10-23';
    var tY = +today.slice(0, 4), tM = +today.slice(5, 7) - 1;

    /* ---------- panels ---------- */
    function panelWopfu() {
      if (!d.wopfu) return h(E.Alert, { tone: 'info', title: A.t('su.wopfu.noneTitle') }, A.t('su.wopfu.noneText'));
      var w = d.wopfu;
      return h('div', { className: 'stack' },
        h(Card, { title: A.t('su.wopfu.editTitle') },
          h('p', { className: 'muted' }, A.t('su.wopfu.editText')),
          h('div', { className: 'row' }, (w.editors || []).map(function (e, i) {
            var u = (d.teachers.concat(d.specialists)).filter(function (x) { return x.id === e.userId; })[0];
            return h(E.Badge, { key: i, tone: e.scope === 'all' ? 'accent' : 'outline', icon: 'user' }, (u ? u.name : e.userId) + (e.scope === 'all' ? '' : ' · ' + (e.sections || []).map(function (sc) { return A.t('su.sec.' + sc); }).join(', ')));
          })),
          h('div', { className: 'row' }, h(E.Button, { icon: 'users', onClick: function () { setInv({ open: true, userId: '', limited: true }); } }, A.t('su.wopfu.invite'))),
          secs && h(E.TextField, { label: A.t('su.wopfu.strengths'), multiline: 3, value: secs.mocne, hint: A.t('su.wopfu.strengthsHint'), onChange: function (e) { setSecs(Object.assign({}, secs, { mocne: e.target.value })); } }),
          secs && h(E.TextField, { label: A.t('su.wopfu.barriers'), multiline: 3, value: secs.bariery, onChange: function (e) { setSecs(Object.assign({}, secs, { bariery: e.target.value })); } }),
          secs && h(E.TextField, { label: A.t('su.wopfu.recommendations'), multiline: 3, value: secs.zalecenia, onChange: function (e) { setSecs(Object.assign({}, secs, { zalecenia: e.target.value })); } }),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'primary', icon: 'check', loading: busy, onClick: saveWopfu }, A.t('su.wopfu.save')),
            h(E.Button, { icon: 'refresh', onClick: function () { run(A.api.post('/api/support/rollover', { studentId: sid }), A.t('su.wopfu.rolledOver', { year: d.nextYear })); } }, A.t('su.wopfu.rollover', { year: d.nextYear })))),
        h(Card, { title: A.t('su.wopfu.history') },
          h('div', { className: 'row' },
            w.rolledFrom && h(E.Badge, { tone: 'info', icon: 'refresh' }, A.t('su.wopfu.rolledFrom')),
            h(E.Badge, { tone: 'outline' }, A.t('su.wopfu.version', { n: w.versions.length }))),
          h('div', null, w.versions.slice().reverse().map(function (v, i) {
            /* identyfikator wpisu dla komentarzy — jak na serwerze: <id dokumentu>:<nr wersji> */
            var eid = w.id + ':' + v.no;
            return h('div', { key: i }, h(E.AuditEntry, {
              kind: v.kind === 'create' ? 'create' : v.kind === 'rollover' ? 'edit' : v.kind === 'invite' ? 'create' : 'edit',
              actor: (d.specialists.concat(d.teachers).filter(function (x) { return x.id === v.byUserId; })[0] || { name: v.byUserId }).name,
              action: v.kind === 'edit' ? A.t('su.wopfu.act.edit', { section: A.t('su.sec.' + v.section) }) : v.kind === 'invite' ? A.t('su.wopfu.act.invite') : v.kind === 'rollover' ? A.t('su.wopfu.act.rollover') : A.t('su.wopfu.act.create'),
              target: A.t('su.wopfu.versionTarget', { n: v.no }), from: v.before || undefined, to: v.after || undefined, reason: v.reason,
              time: A.fmtDateTime(v.at), iso: v.at, meta: { id: v.no }
            }), h(window.EdLogComments.Toggle, { kind: 'wopfu-versions', entryId: eid, counts: cmt('wopfuVersions')[eid], onChange: reloadCounts }));
          }))));
    }

    function panelIpet() {
      if (!d.ipet) return h(E.Alert, { tone: 'info', title: A.t('su.ipet.noneTitle') }, A.t('su.ipet.noneText'));
      var ip = d.ipet;
      return h('div', { className: 'stack' },
        h(Card, { title: A.t('su.ipet.formsTitle') },
          h('div', { className: 'grid-2' },
            h('div', { className: 'stack' },
              h('p', { className: 'muted' }, A.t('su.ipet.basis', { basis: ip.basis || '—' })),
              h(E.Table, {
                caption: A.t('su.ipet.formsCaption'), columns: [{ key: 'name', title: A.t('su.ipet.colForm') }, { key: 'hoursPerWeek', title: A.t('su.ipet.colHours'), num: true }],
                rows: ip.supportForms.map(function (f, i) { return { id: 'f' + i, name: f.name || f.form, hoursPerWeek: f.hoursPerWeek }; })
              })),
            h('div', { className: 'stack' },
              h(E.StatTile, { label: A.t('su.ipet.rehab'), value: A.t('su.ipet.rehabValue', { n: ip.rehabHoursPerWeek }), hint: A.t('su.ipet.rehabHint') }),
              h(E.StatTile, { label: A.t('su.ipet.exam'), value: String(ip.examAccommodations.length), hint: ip.examAccommodations.join(', ') || A.t('su.ipet.examNone') }))),
          h('h4', null, A.t('su.ipet.integrated')),
          h('ul', null, ip.integratedActions.map(function (x, i) { return h('li', { key: i }, x); }))),
        h(Card, { title: A.t('su.sched.title', { month: monthName(tM), year: tY }) },
          conflict && h(E.Alert, { tone: 'warning', title: A.t('su.sched.conflictTitle') },
            A.t('su.sched.conflictText', { date: A.fmtDate(conflict.date), subject: A.subjectName(conflict.subjectId, conflict.subject), lessonNo: conflict.lessonNo, start: conflict.start, end: conflict.end })),
          h('div', { className: 'row' },
            h(E.TextField, Object.assign({ label: A.t('su.sched.date'), type: 'date', value: ses.date, width: '12rem', onChange: function (e) { setSes(Object.assign({}, ses, { date: e.target.value })); }, hint: A.dateHint(ses.date) }, A.dateInputProps())),
            h(E.TextField, { label: A.t('su.sched.lessonNo'), type: 'number', min: '1', max: '8', width: '7rem', value: ses.lessonNo, onChange: function (e) { setSes(Object.assign({}, ses, { lessonNo: e.target.value })); } }),
            h(E.Select, { label: A.t('su.sched.form'), options: FORMY.map(function (f) { return { value: f.value, label: A.t('su.form.' + f.value) }; }), value: ses.form, width: '22rem', onChange: function (e) { setSes(Object.assign({}, ses, { form: e.target.value })); } }),
            h(E.Button, { icon: 'plus', disabled: !ses.date, onClick: addSession }, A.t('su.sched.plan'))),
          h(E.Calendar, { month: monthName(tM) + ' ' + tY, monthName: monthOf(tM), days: buildMonth(tY, tM, eventsByDate, today) }),
          h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, A.t('su.sched.count', { n: (d.sessions || []).length }))),
        h(Card, { title: A.t('su.impl.title') },
          h('p', { className: 'muted' }, A.t('su.impl.text')),
          h('div', { className: 'row' }, (ip.recommendations || []).map(function (rc, i) { return h(E.Badge, { key: i, tone: 'outline' }, rc.text || rc); })),
          (d.implementations || []).length
            ? h(E.Table, {
                caption: A.t('su.impl.caption'),
                columns: [{ key: 'date', title: A.t('common.date'), render: function (r) { return A.fmtDate(r.date); } }, { key: 'lessonNo', title: A.t('su.impl.colLesson'), num: true }, { key: 'recs', title: A.t('su.impl.colRecs') }],
                rows: d.implementations.map(function (x) {
                  return { id: x.id, date: x.date, lessonNo: x.lessonNo, recs: (x.recommendations || []).map(function (rid) { var f = (ip.recommendations || []).filter(function (rc) { return (rc.id || rc) === rid; })[0]; return f ? (f.text || f) : rid; }).join(', ') };
                })
              })
            : h('p', { className: 'muted' }, A.t('su.impl.none'))));
    }

    function panelDziennik() {
      var rows = [];
      (d.otherActivities || []).forEach(function (g) {
        (g.sessions || []).forEach(function (x) {
          var a = (x.attendance || []).filter(function (y) { return y.studentId === sid; })[0];
          rows.push({ id: x.id, data: x.date, temat: x.topic, cel: x.goal, ob: a ? a.status : 'none', grupa: g.name });
        });
      });
      return h('div', { className: 'stack' },
        h(Card, { title: A.t('su.journal.title') },
          h('div', { className: 'row' },
            h(E.Badge, { tone: 'info', icon: 'download' }, A.t('su.journal.inXml')),
            h(E.Badge, { tone: 'outline', icon: 'eye-off' }, A.t('su.journal.notesOut'))),
          h('p', { className: 'muted' }, A.t('su.journal.text')),
          (user.role === 'principal') && h('div', { className: 'row' },
            h(E.Button, { icon: 'download', href: '/api/support/export/xml?classId=' + encodeURIComponent(s.classId) }, A.t('su.journal.export', { cls: s.classId }))),
          rows.length
            ? h(E.Table, {
                caption: A.t('su.journal.caption', { name: s.name, cls: s.classId }),
                columns: [
                  { key: 'data', title: A.t('common.date'), render: function (r) { return A.fmtDate(r.data); } },
                  { key: 'temat', title: A.t('su.journal.colTopic') },
                  { key: 'cel', title: A.t('su.journal.colGoal') },
                  { key: 'ob', title: A.t('su.journal.colPresence'), render: function (r) { return h(E.AttendanceChip, { status: r.ob, word: true }); } }
                ], rows: rows
              })
            : h('p', { className: 'muted' }, A.t('su.journal.none'))),
        h(Card, { title: A.t('su.speech.title') },
          h(E.Badge, { tone: 'info', icon: 'eye-off' }, A.t('su.speech.parentOnly')),
          h('p', { className: 'muted' }, A.t('su.speech.text')),
          h('p', { className: 'muted' }, A.t('su.speech.count', { n: (d.speechSessions || []).length }))));
    }

    function panelNotatki() {
      return h('div', { className: 'stack' },
        h(Card, { title: A.t('su.notes.title') },
          h(E.TextField, {
            label: A.t('su.notes.text'), multiline: 4, value: note.text, placeholder: A.t('su.notes.placeholder'),
            hint: A.t('su.notes.hint'),
            onChange: function (e) { setNote(Object.assign({}, note, { text: e.target.value })); }
          }),
          h(E.Select, {
            label: A.t('su.notes.readers'), value: note.reader, width: '26rem', placeholder: A.t('su.notes.onlyMe'),
            options: (d.specialists || []).filter(function (x) { return x.id !== user.id; }).map(function (x) { return { value: x.id, label: A.t('su.notes.deputy', { name: x.name }) }; }),
            onChange: function (e) { setNote(Object.assign({}, note, { reader: e.target.value })); }
          }),
          h('div', { className: 'row' }, h(E.Button, { variant: 'primary', icon: 'lock', disabled: !note.text.trim() || busy, onClick: saveNote }, A.t('su.notes.save')))),
        h('div', { className: 'stack' }, (d.notes || []).map(function (n) {
          return h(E.ConfidentialNote, {
            key: n.id, title: n.title, readers: n.readers, author: n.authorName, date: A.fmtDateTime(n.at),
            meta: A.t('su.notes.meta', { alg: n.alg }), sealed: n.sealed, sealedText: n.sealedText
          }, n.sealed ? null : h('p', null, n.text));
        })),
        h(Card, { title: A.t('su.incidents.title') },
          h('p', { className: 'muted' }, A.t('su.incidents.text')),
          (d.incidents || []).length
            ? h('div', { className: 'stack' }, d.incidents.map(function (i) {
                return h('div', { key: i.id },
                  h('div', { className: 'row' },
                    h(E.Badge, { tone: 'danger', icon: 'lock' }, i.kind === 'probation' ? A.t('su.incidents.probation') : A.t('su.incidents.blueCard')),
                    h('span', null, A.fmtDate(i.openedAt)),
                    i.locked ? h('span', { className: 'muted' }, i.sealedText) : h('span', null, i.text)),
                  /* komentarze tylko przy wpisach otwartych dla czytającego — zamknięty wpis ich nie ujawnia */
                  i.locked
                    ? h('p', { className: 'muted', style: { margin: '2px 0 0', fontSize: 12 } }, A.t('su.incidents.locked'))
                    : h(window.EdLogComments.Toggle, { kind: 'support-incidents', entryId: i.id, counts: cmt('incidents')[i.id], onChange: reloadCounts }));
              }))
            : h('p', { className: 'muted' }, A.t('su.incidents.none'))));
    }

    function panelEwaluacja() {
      var ip = d.ipet;
      var last = (d.evaluations || [])[d.evaluations.length - 1];
      return h('div', { className: 'stack' },
        h(Card, { title: A.t('su.eval.title', { year: d.year }) },
          ip ? h('div', { className: 'stack' }, (ip.goals || []).map(function (g, i) {
            return h(E.ProgressBar, { key: i, label: g.title, value: g.level || 0, mark: g.target, valueText: A.t('su.eval.goalValue', { value: g.level || 0, target: g.target }), tone: (g.level || 0) >= g.target ? undefined : (g.level || 0) >= g.target * 0.7 ? 'warning' : 'danger' });
          })) : h('p', { className: 'muted' }, A.t('su.eval.noGoals')),
          last && h('div', { className: 'grid-3' },
            h(E.StatTile, { label: A.t('su.eval.attendance'), value: A.fmtPct(last.attendance.percent), hint: A.t('su.eval.attendanceHint', { present: last.attendance.present, planned: last.attendance.planned }), alert: last.attendance.percent != null && last.attendance.percent < 85 }),
            h(E.StatTile, { label: A.t('su.eval.entries'), value: String(last.implementationEntries) }),
            h(E.StatTile, { label: A.t('su.eval.goalsMet'), value: A.t('su.eval.goalsMetValue', { met: last.goals.filter(function (g) { return g.met; }).length, total: last.goals.length }) })),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'primary', icon: 'print', loading: busy, onClick: makeEvaluation }, A.t('su.eval.generate'))),
          h('p', { className: 'muted' }, A.t('su.eval.note'))),
        h(Card, { title: A.t('su.share.title') },
          h('p', { className: 'muted' }, A.t('su.share.text')),
          h(E.Table, {
            caption: A.t('su.share.caption'),
            columns: [
              { key: 'name', title: A.t('su.share.colDoc') },
              { key: 'kind', title: A.t('su.share.colKind'), render: function (r) { return r.protected ? h(E.Badge, { tone: 'danger', icon: 'lock' }, A.t('su.share.protected')) : h(E.Badge, { tone: 'success' }, A.t('su.share.public')); } },
              { key: 'date', title: A.t('common.date'), render: function (r) { return A.fmtDate(r.date); } },
              { key: 'share', title: A.t('su.share.colShare'), render: function (r) {
                  return h(E.Switch, {
                    label: h('span', null, A.t('su.share.switch'), h('span', { className: 'ed-sr' }, ': ' + r.name)), states: [A.t('su.share.off'), A.t('su.share.on')],
                    checked: !r.protected && r.shared, disabled: !!r.protected,
                    hint: r.protected ? A.t('su.share.protectedHint') : undefined,
                    onChange: r.protected ? function () {} : function (c) { run(A.api.post('/api/support/documents/' + r.id + '/share', { shared: c }), A.t(c ? 'su.share.done' : 'su.share.undone', { name: r.name })); }
                  });
                } }
            ],
            rows: (d.documents || []).map(function (x) { return Object.assign({ id: x.id }, x); })
          })));
    }

    var panels = { wopfu: panelWopfu, ipet: panelIpet, dziennik: panelDziennik, notatki: panelNotatki, ewaluacja: panelEwaluacja };

    return h('div', null,
      h('h1', { className: 'display app-title' }, A.t('su.title')),
      h('p', { className: 'app-sub' }, A.t('su.sub')),
      h('div', { className: 'card' },
        h('div', { className: 'row' },
          h(E.Select, { label: A.t('common.student'), options: studentOptions, value: sid, width: '28rem', onChange: function (e) { setSid(e.target.value); A.navigate('/pomoc', { studentId: e.target.value }); } }),
          s && h(E.Avatar, { name: s.name, kind: 'child', size: 'lg' }),
          s && h('div', null,
            h('p', { className: 'heading', style: { margin: 0 } }, A.t('su.studentLine', { no: s.rollNo, name: s.name, cls: s.classId })),
            h('p', { className: 'muted', style: { margin: 0 } }, A.t('su.homeroomLine', { homeroom: s.homeroom, parents: s.parents || '—' }))),
          s && h('div', { className: 'row' },
            d.ipet && h(E.Badge, { tone: 'success', icon: 'check' }, A.t('su.badge.ipet')),
            d.wopfu && h(E.Badge, { tone: 'outline' }, A.t('su.badge.wopfu', { n: d.wopfu.versions.length })),
            s.socialWelfare && h(E.Badge, { tone: 'info', icon: 'shield' }, A.t('su.badge.welfare')),
            (d.incidents || []).length ? h(E.Badge, { tone: 'danger', icon: 'lock' }, A.t('su.badge.incidents')) : null))),
      ov.loading && !d && h('p', { className: 'muted' }, A.t('su.loadingDocs')),
      ov.error && h(E.Alert, { tone: 'danger' }, ov.error.message),
      d && (d.alerts || []).length ? h('div', { className: 'card' }, h(E.Alert, {
        tone: 'danger', title: A.t('su.alerts.title'),
        actions: h(E.Button, { size: 'sm', icon: 'user', onClick: function () { run(A.api.post('/api/support/attendance-alerts/' + d.alerts[0].id + '/contact', { channel: 'phone', note: A.t('su.alerts.contactNote') }), A.t('su.alerts.contactDone')); } }, A.t('su.alerts.call'))
      }, d.alerts.map(function (a) { return A.t('su.alerts.line', { name: a.studentName, days: A.plural(a.days.length, 'su.alerts.days'), dates: a.daysText }); }).join(' '))) : null,
      d && h('section', { 'aria-labelledby': 'dok-h2' },
        h('h2', { id: 'dok-h2' }, A.t('su.docs.heading')),
        h(E.Tabs, {
          label: A.t('su.tabs.label'), value: tab, onChange: setTab,
          tabs: [
            { id: 'wopfu', label: A.t('su.tab.wopfu') },
            { id: 'ipet', label: A.t('su.tab.ipet') },
            { id: 'dziennik', label: A.t('su.tab.journal'), count: (d.otherActivities || []).length },
            { id: 'notatki', label: A.t('su.tab.notes'), count: (d.notes || []).length },
            { id: 'ewaluacja', label: A.t('su.tab.evaluation') }
          ]
        }, function (active) { return panels[active](); })),
      h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, msg || ''),
      inv.open && d && d.wopfu && h(E.Dialog, {
        title: A.t('su.invite.title'), onClose: function () { setInv(Object.assign({}, inv, { open: false })); },
        actions: [
          h(E.Button, { key: 'c', onClick: function () { setInv(Object.assign({}, inv, { open: false })); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'primary', disabled: !inv.userId, onClick: sendInvite }, A.t('su.invite.send'))
        ]
      },
        h('p', null, A.t('su.invite.text')),
        h(E.Select, {
          label: A.t('common.teacher'), required: true, placeholder: A.t('su.invite.pick', { cls: s ? s.classId : '' }),
          options: (d.teachers || []).map(function (x) { return { value: x.id, label: x.name }; }),
          value: inv.userId, 'data-autofocus': true, onChange: function (e) { setInv(Object.assign({}, inv, { userId: e.target.value })); }
        }),
        h(E.Checkbox, {
          label: A.t('su.invite.limited'),
          hint: A.t('su.invite.limitedHint'),
          checked: inv.limited, onChange: function (e) { setInv(Object.assign({}, inv, { limited: e.target.checked })); }
        })));
  }

  A.screen({
    id: 'support', path: '/pomoc', title: 'Pomoc psychologiczno-pedagogiczna', module: 'support',
    roles: ['counselor', 'psychologist', 'specialEducator', 'speechTherapist', 'supportTeacher', 'principal'],
    nav: { key: 'nav.support', label: 'Pomoc p-p', order: 40 }, component: Screen
  });
})();
