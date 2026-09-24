/* 3.1 — teacher's lesson logbook: pick a lesson of the day, attendance (including combined lessons),
   topic linked to the curriculum, homework and an announced test with the school limit.
   Grades live on a separate screen (#/oceny). */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'tl.title': 'Dziennik lekcyjny',
      'tl.day': 'Dzień',
      'tl.dayLessons': 'Lekcje dnia',
      'tl.loadingPlan': 'Wczytywanie planu…',
      'tl.loadingLesson': 'Wczytywanie lekcji…',
      'tl.noLessons': 'Brak lekcji w tym dniu.',
      'tl.pickLesson': 'Wybierz lekcję z planu dnia, aby zapisać frekwencję i temat.',
      'tl.open': 'Otwórz',
      'tl.syncOffline': 'Frekwencja i tematy zapisują się lokalnie i pójdą na serwer po odzyskaniu sieci',
      'tl.lastSync': 'ostatnia synchronizacja {at}',
      'tl.card.combined': 'lekcja łączona',
      'tl.card.topicSaved': 'temat zapisany',
      'tl.card.noTopic': 'brak tematu',
      'tl.card.att': 'frekwencja {a}/{b}',
      'tl.card.draft': '(wersja robocza)',
      'tl.hours': '{n} godz.',
      'tl.students.one': '{n} uczeń', 'tl.students.few': '{n} uczniowie', 'tl.students.many': '{n} uczniów',
      'tl.w.ob': 'obecnych', 'tl.w.nb': 'nieobecnych', 'tl.w.sp': 'spóźnionych', 'tl.w.zw': 'zwolnionych', 'tl.w.u': 'usprawiedliwionych', 'tl.w.rs': 'reprezentuje szkołę', 'tl.w.w': 'na wycieczce',
      'tl.st.ob': 'obecny (ob)', 'tl.st.nb': 'nieobecny (nb)', 'tl.st.sp': 'spóźniony (sp)', 'tl.st.zw': 'zwolniony (zw)', 'tl.st.u': 'usprawiedliwiony (u)', 'tl.st.rs': 'reprezentuje szkołę (rs)', 'tl.st.w': 'wycieczka (w)',
      'tl.att.noEntry': 'bez wpisu {n}',
      'tl.att.noEntries': 'brak wpisów',
      'tl.att.notSaved': 'Frekwencja nie została jeszcze zapisana.',
      'tl.att.savedIs': 'Zapisana frekwencja: {s}.',
      'tl.att.draftPending': 'Wersja robocza czeka na dokończenie.',
      'tl.att.queuedMsg': 'Zapis czeka w kolejce offline i zostanie wysłany po odzyskaniu sieci.',
      'tl.att.queuedToast': 'Frekwencja zapisana lokalnie — wyślemy ją po powrocie sieci.',
      'tl.att.saveFail': 'Nie udało się zapisać frekwencji.',
      'tl.att.pickStatuses': 'Zaznacz statusy albo użyj przycisku „Zaznacz wszystkich obecnych”.',
      'tl.att.qlabel': 'Frekwencja · {lesson}',
      'tl.att.qlabelDraft': 'Wersja robocza frekwencji · {lesson}',
      'tl.att.qlabelAll': 'Frekwencja (wszyscy obecni) · {lesson}',
      'tl.att.savedMsg': 'Zapisano frekwencję: {s}.',
      'tl.att.savedDraftMsg': 'Zapisano wersję roboczą frekwencji: {s}.',
      'tl.att.savedToast': 'Zapisano frekwencję · {s}.',
      'tl.att.draftSavedToast': 'Wersja robocza frekwencji zapisana.',
      'tl.att.allPresentMsg': 'Zapisano frekwencję: wszyscy obecni ({s}).',
      'tl.att.allPresentToast': 'Zapisano frekwencję — wszyscy obecni.',
      'tl.att.combinedTitle': 'Lekcja łączona',
      'tl.att.combinedText': 'Wspólna lista obecności: {a} oraz {b}. Wpisy frekwencji i oceny trafiają do dziennika klasy macierzystej każdego ucznia.',
      'tl.att.rosterTitle': 'Lista obecności · {c}',
      'tl.att.save': 'Zapisz frekwencję',
      'tl.att.allPresent': 'Wszyscy obecni i zapisz',
      'tl.att.saveDraft': 'Zapisz wersję roboczą',
      'tl.att.legend': 'Statusy: {list}. „rs” i „w” liczą się jak obecność.',
      'tl.att.unsaved': 'Niezapisane zmiany na liście — kliknij „Zapisz frekwencję”.',
      'tl.att.minutesClamped': 'Spóźnienie liczymy w zakresie 1–44 minut; poprawiono wpisy poza zakresem.',
      'tl.card.open': 'otwarta',
      'tl.kbd.all': 'wszyscy obecni',
      'tl.kbd.status': 'status ucznia',
      'tl.kbd.save': 'zapisz',
      'tl.topic.h': 'Temat lekcji i podstawa programowa',
      'tl.topic.label': 'Temat lekcji',
      'tl.topic.hint': 'Temat trafia do dziennika lekcyjnego klasy {c}',
      'tl.topic.empty': 'Wpisz temat lekcji.',
      'tl.topic.qlabel': 'Temat lekcji · {lesson}',
      'tl.topic.queued': 'Temat czeka w kolejce offline.',
      'tl.topic.queuedToast': 'Temat zapisany lokalnie.',
      'tl.topic.savedMsg': 'Zapisano temat lekcji.',
      'tl.topic.savedMsgLinked': 'Zapisano temat lekcji i powiązanie z podstawą programową ({codes}).',
      'tl.topic.savedToast': 'Zapisano temat lekcji.',
      'tl.topic.saveFail': 'Nie udało się zapisać tematu.',
      'tl.topic.item': 'Punkt podstawy programowej',
      'tl.topic.itemPh': 'wybierz punkt do powiązania',
      'tl.topic.itemHint': 'Baza planów wynikowych MEN · {s}',
      'tl.topic.link': 'Powiąż punkt',
      'tl.topic.unlink': 'Usuń powiązanie {code}',
      'tl.topic.noCurriculum': 'Dla przedmiotu {s} w klasie {c} nie wprowadzono jeszcze podstawy programowej — temat zapisze się bez powiązania.',
      'tl.topic.editCurriculum': 'Podstawa programowa',
      'tl.topic.editCurriculumHint': 'Punkty podstawy wpisuje się raz (można wkleić arkusz wydawnictwa) — potem wybiera się je przy temacie lekcji.',
      'tl.topic.progress': 'Realizacja podstawy programowej · {s} {c}',
      'tl.topic.progressHint': '{covered} z {hours} godzin · tematy powiązane z podstawą: {linked} z {held} odbytych lekcji (stan na {date})',
      'tl.topic.tableCap': 'Realizacja punktów podstawy programowej',
      'tl.topic.col.code': 'Punkt',
      'tl.topic.col.title': 'Zagadnienie',
      'tl.topic.col.covered': 'Zrealizowano',
      'tl.topic.save': 'Zapisz temat',
      'tl.topic.grades': 'Oceny z tej lekcji',
      'tl.file.alt': 'Podgląd pracy: {name}',
      'tl.file.unreadable': '(nie udało się odczytać treści pliku)',
      'tl.file.title': 'Plik {name}',
      'tl.file.openInfo': 'Format {type} otwiera się w osobnej karcie przeglądarki; nic nie zapisuje się na dysku.',
      'tl.file.openTab': 'Otwórz {name} w nowej karcie',
      'tl.hw.h': 'Zadanie domowe',
      'tl.hw.text': 'Treść',
      'tl.hw.textPh': 'np. zadania 4–7 ze strony 61',
      'tl.hw.due': 'Termin oddania',
      'tl.hw.time': 'Godzina',
      'tl.hw.limit': 'Limit załącznika',
      'tl.hw.limitHint': 'Maksimum szkolne: {n} MB',
      'tl.hw.block': 'Blokuj oddanie po terminie',
      'tl.hw.blockHint': 'Po terminie uczeń nie prześle pliku ani treści',
      'tl.hw.publish': 'Opublikuj zadanie',
      'tl.hw.publishedMsg': 'Opublikowano zadanie domowe dla {c} · termin {date} {time} · limit załącznika {mb} MB · {lock}.',
      'tl.hw.lockOn': 'oddanie po terminie zablokowane',
      'tl.hw.lockOff': 'oddanie po terminie dozwolone',
      'tl.hw.publishedToast': 'Opublikowano zadanie domowe.',
      'tl.hw.publishFail': 'Nie udało się opublikować zadania.',
      'tl.hw.noneYet': 'Zadanie nie zostało jeszcze opublikowane z tej lekcji.',
      'tl.hw.dueBadge': 'termin {date} {time}',
      'tl.hw.counts': '{text} · oddane {a}/{b} · przejrzane {c}',
      'tl.hw.works': 'Prace',
      'tl.hw.submissionsTitle': 'Oddane prace · {s}',
      'tl.hw.filesInline': 'Pliki otwierają się w tym oknie — nie trzeba ich pobierać na dysk komputera.',
      'tl.hw.reviewed': 'przejrzana',
      'tl.hw.toReview': 'do przejrzenia',
      'tl.hw.submittedAt': 'oddano {at}',
      'tl.hw.noAttachment': 'bez załącznika',
      'tl.hw.openWork': 'Otwórz pracę',
      'tl.hw.nobody': 'Nikt jeszcze nie oddał pracy.',
      'tl.hw.missing': 'Bez pracy: {list}.',
      'tl.hw.workOf': 'Praca · {name}',
      'tl.hw.markReviewed': 'Oznacz jako przejrzaną',
      'tl.hw.reviewedToast': 'Praca oznaczona jako przejrzana.',
      'tl.hw.grade': 'Wystaw ocenę',
      'tl.hw.reviewedAt': 'Przejrzano {at}.',
      'tl.hw.notReviewed': 'Praca nie została jeszcze oznaczona jako przejrzana.',
      'tl.test.h': 'Zapowiedziany sprawdzian',
      'tl.test.rejected': 'Termin odrzucony przez limit szkolny',
      'tl.test.limitReached': 'Limit sprawdzianów osiągnięty',
      'tl.test.limitCount': 'Limit sprawdzianów: {a}/{b} w tygodniu',
      'tl.test.kind': 'Rodzaj',
      'tl.test.opt.test': 'sprawdzian (objęty limitem)',
      'tl.test.opt.quiz': 'kartkówka (bez limitu)',
      'tl.test.kn.test': 'sprawdzian',
      'tl.test.kn.quiz': 'kartkówka',
      'tl.test.limitHint': 'Statut szkoły: {d} dziennie, {w} w tygodniu dla oddziału',
      'tl.test.scope': 'Zakres',
      'tl.test.scopePh': 'np. twierdzenie Pitagorasa — zadania',
      'tl.test.announce': 'Zapowiedz termin',
      'tl.test.savedMsg': 'Zapisano termin: {kind} {date} · {c} · {s}. ',
      'tl.test.announcedToast': 'Zapowiedziano {kind} na {date}.',
      'tl.test.saveFail': 'Nie udało się zapisać terminu.'
    },
    en: {
      'tl.title': 'Lesson logbook',
      'tl.day': 'Day',
      'tl.dayLessons': 'Lessons of the day',
      'tl.loadingPlan': 'Loading the timetable…',
      'tl.loadingLesson': 'Loading the lesson…',
      'tl.noLessons': 'No lessons on this day.',
      'tl.pickLesson': 'Pick a lesson from the day to record attendance and the topic.',
      'tl.open': 'Open',
      'tl.syncOffline': 'Attendance and topics are saved on this device and sent to the server once the network is back',
      'tl.lastSync': 'last sync {at}',
      'tl.card.combined': 'combined lesson',
      'tl.card.topicSaved': 'topic saved',
      'tl.card.noTopic': 'no topic',
      'tl.card.att': 'attendance {a}/{b}',
      'tl.card.draft': '(draft)',
      'tl.hours': '{n} hrs',
      'tl.students.one': '{n} student', 'tl.students.other': '{n} students',
      'tl.w.ob': 'present', 'tl.w.nb': 'absent', 'tl.w.sp': 'late', 'tl.w.zw': 'excused from class', 'tl.w.u': 'absence excused', 'tl.w.rs': 'representing the school', 'tl.w.w': 'on a school trip',
      'tl.st.ob': 'present (ob)', 'tl.st.nb': 'absent (nb)', 'tl.st.sp': 'late (sp)', 'tl.st.zw': 'excused from class (zw)', 'tl.st.u': 'absence excused (u)', 'tl.st.rs': 'representing the school (rs)', 'tl.st.w': 'school trip (w)',
      'tl.att.noEntry': 'not marked {n}',
      'tl.att.noEntries': 'nothing recorded',
      'tl.att.notSaved': 'Attendance has not been saved yet.',
      'tl.att.savedIs': 'Attendance on record: {s}.',
      'tl.att.draftPending': 'A draft is waiting to be finished.',
      'tl.att.queuedMsg': 'The entry is queued offline and will be sent once the network is back.',
      'tl.att.queuedToast': 'Attendance saved on this device — we will send it when the network returns.',
      'tl.att.saveFail': 'Attendance could not be saved.',
      'tl.att.pickStatuses': 'Mark the statuses or use the "Mark all present" button.',
      'tl.att.qlabel': 'Attendance · {lesson}',
      'tl.att.qlabelDraft': 'Attendance draft · {lesson}',
      'tl.att.qlabelAll': 'Attendance (all present) · {lesson}',
      'tl.att.savedMsg': 'Attendance saved: {s}.',
      'tl.att.savedDraftMsg': 'Attendance draft saved: {s}.',
      'tl.att.savedToast': 'Attendance saved · {s}.',
      'tl.att.draftSavedToast': 'Attendance draft saved.',
      'tl.att.allPresentMsg': 'Attendance saved: all present ({s}).',
      'tl.att.allPresentToast': 'Attendance saved — everyone present.',
      'tl.att.combinedTitle': 'Combined lesson',
      'tl.att.combinedText': 'Shared attendance list: {a} together with {b}. Attendance entries and grades go to each student\'s own class logbook.',
      'tl.att.rosterTitle': 'Attendance list · {c}',
      'tl.att.save': 'Save attendance',
      'tl.att.allPresent': 'All present and save',
      'tl.att.saveDraft': 'Save draft',
      'tl.att.legend': 'Statuses: {list}. "rs" and "w" count as attendance.',
      'tl.att.unsaved': 'Unsaved changes in the list — press "Save attendance".',
      'tl.att.minutesClamped': 'Lateness is recorded as 1–44 minutes; entries outside that range were corrected.',
      'tl.card.open': 'open',
      'tl.kbd.all': 'all present',
      'tl.kbd.status': 'status of a student',
      'tl.kbd.save': 'save',
      'tl.topic.h': 'Lesson topic and curriculum',
      'tl.topic.label': 'Lesson topic',
      'tl.topic.hint': 'The topic goes into the logbook of class {c}',
      'tl.topic.empty': 'Enter the lesson topic.',
      'tl.topic.qlabel': 'Lesson topic · {lesson}',
      'tl.topic.queued': 'The topic is queued offline.',
      'tl.topic.queuedToast': 'Topic saved on this device.',
      'tl.topic.savedMsg': 'Lesson topic saved.',
      'tl.topic.savedMsgLinked': 'Lesson topic saved and linked to the curriculum ({codes}).',
      'tl.topic.savedToast': 'Lesson topic saved.',
      'tl.topic.saveFail': 'The topic could not be saved.',
      'tl.topic.item': 'Curriculum point',
      'tl.topic.itemPh': 'choose a point to link',
      'tl.topic.itemHint': 'Ministry curriculum plans · {s}',
      'tl.topic.link': 'Link the point',
      'tl.topic.unlink': 'Remove the link to {code}',
      'tl.topic.noCurriculum': 'There is no curriculum for {s} in class {c} yet — the topic will be saved without a link.',
      'tl.topic.editCurriculum': 'National curriculum',
      'tl.topic.editCurriculumHint': 'The curriculum points are entered once (the publisher’s sheet can be pasted in) — after that they are simply picked next to the lesson topic.',
      'tl.topic.progress': 'Curriculum coverage · {s} {c}',
      'tl.topic.progressHint': '{covered} of {hours} hours · topics linked to the curriculum: {linked} of {held} lessons held (as at {date})',
      'tl.topic.tableCap': 'Coverage of the curriculum points',
      'tl.topic.col.code': 'Point',
      'tl.topic.col.title': 'Subject matter',
      'tl.topic.col.covered': 'Covered',
      'tl.topic.save': 'Save the topic',
      'tl.topic.grades': 'Grades from this lesson',
      'tl.file.alt': 'Preview of the work: {name}',
      'tl.file.unreadable': '(the file contents could not be read)',
      'tl.file.title': 'File {name}',
      'tl.file.openInfo': 'The {type} format opens in a separate browser tab; nothing is written to disk.',
      'tl.file.openTab': 'Open {name} in a new tab',
      'tl.hw.h': 'Homework',
      'tl.hw.text': 'Task',
      'tl.hw.textPh': 'e.g. exercises 4–7 on page 61',
      'tl.hw.due': 'Due date',
      'tl.hw.time': 'Time',
      'tl.hw.limit': 'Attachment limit',
      'tl.hw.limitHint': 'School maximum: {n} MB',
      'tl.hw.block': 'Block submissions after the deadline',
      'tl.hw.blockHint': 'After the deadline a student cannot send a file or any text',
      'tl.hw.publish': 'Publish the homework',
      'tl.hw.publishedMsg': 'Homework published for {c} · due {date} {time} · attachment limit {mb} MB · {lock}.',
      'tl.hw.lockOn': 'late submissions blocked',
      'tl.hw.lockOff': 'late submissions allowed',
      'tl.hw.publishedToast': 'Homework published.',
      'tl.hw.publishFail': 'The homework could not be published.',
      'tl.hw.noneYet': 'No homework has been published from this lesson yet.',
      'tl.hw.dueBadge': 'due {date} {time}',
      'tl.hw.counts': '{text} · submitted {a}/{b} · reviewed {c}',
      'tl.hw.works': 'Submissions',
      'tl.hw.submissionsTitle': 'Submitted work · {s}',
      'tl.hw.filesInline': 'Files open in this window — there is no need to download them to your computer.',
      'tl.hw.reviewed': 'reviewed',
      'tl.hw.toReview': 'to review',
      'tl.hw.submittedAt': 'submitted {at}',
      'tl.hw.noAttachment': 'no attachment',
      'tl.hw.openWork': 'Open the work',
      'tl.hw.nobody': 'Nobody has submitted any work yet.',
      'tl.hw.missing': 'Nothing submitted: {list}.',
      'tl.hw.workOf': 'Work · {name}',
      'tl.hw.markReviewed': 'Mark as reviewed',
      'tl.hw.reviewedToast': 'The work has been marked as reviewed.',
      'tl.hw.grade': 'Enter a grade',
      'tl.hw.reviewedAt': 'Reviewed {at}.',
      'tl.hw.notReviewed': 'This work has not been marked as reviewed yet.',
      'tl.test.h': 'Announced test',
      'tl.test.rejected': 'Date rejected by the school limit',
      'tl.test.limitReached': 'Test limit reached',
      'tl.test.limitCount': 'Test limit: {a}/{b} this week',
      'tl.test.kind': 'Type',
      'tl.test.opt.test': 'test (counts towards the limit)',
      'tl.test.opt.quiz': 'quiz (not limited)',
      'tl.test.kn.test': 'test',
      'tl.test.kn.quiz': 'quiz',
      'tl.test.limitHint': 'School statute: {d} per day, {w} per week for a class',
      'tl.test.scope': 'Scope',
      'tl.test.scopePh': 'e.g. Pythagorean theorem — problems',
      'tl.test.announce': 'Announce the date',
      'tl.test.savedMsg': 'Date saved: {kind} {date} · {c} · {s}. ',
      'tl.test.announcedToast': '{kind} announced for {date}.',
      'tl.test.saveFail': 'The date could not be saved.'
    }
  });

  var ORDER = ['ob', 'nb', 'sp', 'zw', 'u', 'rs', 'w'];
  /* Server-side kind codes stay Polish ('sprawdzian' / 'kartkówka'); only the label shown to the user is translated. */
  var KIND_KEY = { sprawdzian: 'tl.test.kn.test', 'kartkówka': 'tl.test.kn.quiz' };
  function kindName(k) { return KIND_KEY[k] ? A.t(KIND_KEY[k]) : k; }
  function statusOpts() { return ORDER.map(function (k) { return { value: k, label: A.t('tl.st.' + k) }; }); }
  /** Lesson label built on the client so the subject name follows the interface language. */
  function lessonLabel(l) { return l.lessonNo + '. ' + A.subjectName(l.subjectId, l.subjectName) + ' · ' + l.classId + ' · ' + A.fmtDate(l.date) + ' ' + l.start + '–' + l.end; }

  /** The grade book keys on classId|subjectId — passing only the lesson id left the teacher on pairs[0]. */
  function gradesHref(lesson, studentId) {
    if (!lesson) return '#/oceny';
    return '#/oceny?klasa=' + encodeURIComponent(lesson.classId + '|' + lesson.subjectId)
      + '&lekcja=' + encodeURIComponent(lesson.id)
      + (studentId ? '&student=' + encodeURIComponent(studentId) : '');
  }

  function describe(rows) {
    var counts = {};
    rows.forEach(function (r) { if (r.status && r.status !== 'none') counts[r.status] = (counts[r.status] || 0) + 1; });
    var parts = ORDER.filter(function (k) { return counts[k]; }).map(function (k) { return A.t('tl.w.' + k) + ' ' + counts[k]; });
    var missing = rows.filter(function (r) { return !r.status || r.status === 'none'; }).length;
    if (missing) parts.push(A.t('tl.att.noEntry', { n: missing }));
    return parts.length ? parts.join(' · ') : A.t('tl.att.noEntries');
  }
  /** 'now' is the LessonCard's "in progress" state — it must follow the clock, not the selection. */
  function isNow(l) { var d = new Date(); var iso = A.isoToday(); var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return l.date === iso && l.start <= hm && hm < l.end; }
  function stamp() { return new Date().toISOString(); }
  /* Native date inputs follow the BROWSER locale (a Polish UI shows mm/dd/yyyy in an English Chrome),
     so every date field repeats the value in the interface locale. */

  /* ---------------- attendance ---------------- */
  function AttendanceCard(p) {
    var att = p.att, lesson = p.lesson, llabel = lessonLabel(lesson);
    var s1 = React.useState([]), rows = s1[0], setRows = s1[1];
    var s2 = React.useState(A.t('tl.att.notSaved')), msg = s2[0], setMsg = s2[1];
    var s3 = React.useState(false), busy = s3[0], setBusy = s3[1];
    var s4 = React.useState(false), dirty = s4[0], setDirty = s4[1];

    React.useEffect(function () {
      var d = att.data; if (!d) return;
      setRows(d.students.map(function (x, i) {
        return { no: x.no || i + 1, studentId: x.studentId, classId: x.classId,
          name: x.name + (x.classId !== d.lesson.classId ? ' · ' + x.classId : ''),
          status: x.status || 'none', minutes: x.minutes == null ? undefined : x.minutes };
      }));
      setDirty(false);
      setMsg(d.stats && d.stats.total
        ? A.t('tl.att.savedIs', { s: describe(d.students) })
        : (d.draft ? A.t('tl.att.draftPending') : A.t('tl.att.notSaved')));
    }, [att.data]);

    function send(body, label, done) {
      setBusy(true);
      A.api.post('/api/attendance/lesson/' + lesson.id, body, { queueable: true, label: label })
        .then(function (res) {
          setBusy(false);
          setDirty(false);
          if (res && res.queued) { setMsg(A.t('tl.att.queuedMsg')); A.toast(A.t('tl.att.queuedToast'), 'success'); return; }
          done(res); att.reload();
        })
        .catch(function (e) { setBusy(false); A.toast(e.message || A.t('tl.att.saveFail'), 'danger'); });
    }
    function save(draft) {
      var clamped = false;
      var entries = rows.filter(function (r) { return r.status && r.status !== 'none'; }).map(function (r) {
        var min = null;
        if (r.status === 'sp') { min = Math.round(+r.minutes || 5); var fixed = Math.max(1, Math.min(44, min)); if (fixed !== min) clamped = true; min = fixed; }
        return { studentId: r.studentId, status: r.status, minutes: min };
      });
      if (!entries.length) { A.toast(A.t('tl.att.pickStatuses'), 'danger'); return; }
      if (clamped) A.toast(A.t('tl.att.minutesClamped'), 'danger');
      send({ entries: entries, draft: draft, at: stamp() }, A.t(draft ? 'tl.att.qlabelDraft' : 'tl.att.qlabel', { lesson: llabel }), function () {
        setMsg(A.t(draft ? 'tl.att.savedDraftMsg' : 'tl.att.savedMsg', { s: describe(rows) }));
        A.toast(draft ? A.t('tl.att.draftSavedToast') : A.t('tl.att.savedToast', { s: describe(rows) }), 'success');
      });
    }
    function allPresent() {
      send({ allPresent: true, at: stamp() }, A.t('tl.att.qlabelAll', { lesson: llabel }), function () {
        setMsg(A.t('tl.att.allPresentMsg', { s: A.plural(rows.length, 'tl.students') }));
        A.toast(A.t('tl.att.allPresentToast'), 'success');
      });
    }
    A.onSave(function () { save(false); });

    return h('section', { className: 'card', 'aria-labelledby': 'h-frek' },
      h('h2', { id: 'h-frek' }, A.t('common.attendance')),
      lesson.combinedWith && h(E.Alert, { tone: 'info', title: A.t('tl.att.combinedTitle') },
        A.t('tl.att.combinedText', { a: lesson.classId + (lesson.groupName ? ' (' + lesson.groupName + ')' : ''), b: lesson.combinedLabel || '' })),
      att.error && h(E.Alert, { tone: 'danger' }, att.error.message),
      h(E.AttendanceRoster, {
        key: 'roster-' + lesson.id + '-' + rows.length,
        title: A.t('tl.att.rosterTitle', { c: lesson.classId + (lesson.combinedWith ? ' + ' + (lesson.combinedLabel || '') : '') }),
        lesson: llabel,
        students: rows,
        draft: !!(att.data && att.data.draft),
        onChange: function (next) { setDirty(true); setRows(next.map(function (n, i) { return Object.assign({}, rows[i], n); })); }
      }),
      h('div', { className: 'row mt-4' },
        h(E.Button, { variant: 'primary', icon: 'check', loading: busy, onClick: function () { save(false); } }, A.t('tl.att.save')),
        h(E.Button, { variant: 'secondary', icon: 'check-all', disabled: busy, onClick: allPresent }, A.t('tl.att.allPresent')),
        h(E.Button, { variant: 'quiet', icon: 'edit', disabled: busy, onClick: function () { save(true); } }, A.t('tl.att.saveDraft'))),
      dirty ? h(E.Alert, { tone: 'warning' }, A.t('tl.att.unsaved')) : null,
      h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, msg),
      h('ul', { className: 'row muted', style: { listStyle: 'none', padding: 0, margin: 0 } },
        h('li', { className: 'row' }, h(E.Kbd, { keys: ['A'] }), ' ' + A.t('tl.kbd.all')),
        h('li', { className: 'row' }, h(E.Kbd, { keys: ['N', 'S', 'Z', 'U'] }), ' ' + A.t('tl.kbd.status')),
        h('li', { className: 'row' }, h(E.Kbd, { keys: ['Ctrl', 'S'] }), ' ' + A.t('tl.kbd.save'))),
      h('p', { className: 'muted' }, A.t('tl.att.legend', { list: statusOpts().map(function (o) { return o.label; }).join(', ') })));
  }

  /* ---------------- lesson topic and curriculum ---------------- */
  function TopicCard(p) {
    var lesson = p.lesson, subject = A.subjectName(lesson.subjectId, lesson.subjectName);
    var cur = A.useApi('/api/curriculum?subjectId=' + lesson.subjectId + '&classId=' + lesson.classId, [lesson.id]);
    var comp = A.useApi('/api/curriculum/completion?subjectId=' + lesson.subjectId + '&classId=' + lesson.classId, [lesson.id]);
    var s1 = React.useState(lesson.topic || ''), topic = s1[0], setTopic = s1[1];
    var s2 = React.useState((lesson.curriculumItemIds || []).slice()), items = s2[0], setItems = s2[1];
    var s3 = React.useState(''), pickv = s3[0], setPick = s3[1];
    var s4 = React.useState(''), msg = s4[0], setMsg = s4[1];
    var cardRef = React.useRef(null);
    React.useEffect(function () { setTopic(lesson.topic || ''); setItems((lesson.curriculumItemIds || []).slice()); }, [lesson.id]);

    var all = (cur.data && cur.data.items) || [];
    var byId = {}; all.forEach(function (x) { byId[x.id] = x; });
    var free = all.filter(function (x) { return items.indexOf(x.id) < 0; });
    var c = comp.data;

    function save() {
      if (!topic.trim()) { A.toast(A.t('tl.topic.empty'), 'danger'); return; }
      A.api.patch('/api/lessons/' + lesson.id, { topic: topic, curriculumItemIds: items, at: stamp() }, { queueable: true, label: A.t('tl.topic.qlabel', { lesson: lessonLabel(lesson) }) })
        .then(function (res) {
          if (res && res.queued) { setMsg(A.t('tl.topic.queued')); A.toast(A.t('tl.topic.queuedToast'), 'success'); return; }
          setMsg(items.length
            ? A.t('tl.topic.savedMsgLinked', { codes: items.map(function (i) { return (byId[i] || {}).code || i; }).join(', ') })
            : A.t('tl.topic.savedMsg'));
          A.toast(A.t('tl.topic.savedToast'), 'success'); comp.reload(); p.onSaved && p.onSaved();
        })
        .catch(function (e) { A.toast(e.message || A.t('tl.topic.saveFail'), 'danger'); });
    }

    /* m13 — inside this card Ctrl+S saves the topic, not the attendance roster below it. */
    A.onSave(save, cardRef);

    return h('section', { ref: cardRef, className: 'card', 'aria-labelledby': 'h-temat' },
      h('h2', { id: 'h-temat' }, A.t('tl.topic.h')),
      h('div', { className: 'stack' },
        h(E.TextField, { label: A.t('tl.topic.label'), required: true, value: topic, hint: A.t('tl.topic.hint', { c: lesson.classId }), onChange: function (ev) { setTopic(ev.target.value); } }),
        h(E.Select, {
          label: A.t('tl.topic.item'), value: pickv, placeholder: A.t('tl.topic.itemPh'),
          hint: A.t('tl.topic.itemHint', { s: subject }),
          options: free.map(function (x) { return { value: x.id, label: x.code + ' ' + x.title + ' (' + A.t('tl.hours', { n: x.hours }) + ')' }; }),
          onChange: function (ev) { setPick(ev.target.value); }
        }),
        h('div', { className: 'row' },
          h(E.Button, { variant: 'secondary', icon: 'plus', disabled: !pickv, onClick: function () { setItems(items.concat([pickv])); setPick(''); } }, A.t('tl.topic.link')),
          items.map(function (id) {
            var it = byId[id] || { code: id, title: '' };
            return h('span', { key: id, className: 'row' },
              h(E.Badge, { tone: 'brand' }, it.code + ' ' + it.title),
              h(E.Button, { size: 'sm', variant: 'quiet', iconOnly: true, icon: 'x', label: A.t('tl.topic.unlink', { code: it.code }), onClick: function () { setItems(items.filter(function (x) { return x !== id; })); } }));
          })),
        c && !c.hasItems ? h(E.Alert, { tone: 'info', title: A.t('tl.topic.editCurriculum') },
          A.t('tl.topic.noCurriculum', { s: subject, c: lesson.classId }),
          h('p', null, A.t('tl.topic.editCurriculumHint')),
          h(E.Button, { variant: 'secondary', icon: 'plus', href: '#/podstawa?subjectId=' + encodeURIComponent(lesson.subjectId) }, A.t('tl.topic.editCurriculum'))) : null,
        c && c.hasItems && c.hours ? h(E.ProgressBar, {
          label: A.t('tl.topic.progress', { s: subject, c: lesson.classId }),
          value: c.percent || 0, max: 100, valueText: A.fmtPct(c.percent),
          hint: A.t('tl.topic.progressHint', { covered: c.covered, hours: c.hours, linked: c.lessonsLinked, held: c.lessonsHeld, date: A.fmtDate(c.asOf) })
        }) : null,
        c && c.hasItems ? h(E.Table, {
          caption: A.t('tl.topic.tableCap'), stack: true,
          columns: [
            { key: 'code', title: A.t('tl.topic.col.code') }, { key: 'title', title: A.t('tl.topic.col.title') },
            { key: 'covered', title: A.t('tl.topic.col.covered'), num: true, render: function (r) { return r.covered + ' / ' + A.t('tl.hours', { n: r.hours }); } },
            { key: 'percent', title: '%', num: true, render: function (r) { return A.fmtPct(r.percent); } }],
          rows: c.items.map(function (x) { return Object.assign({ id: x.id }, x); })
        }) : null,
        h('div', { className: 'row' },
          h(E.Button, { variant: 'primary', icon: 'check', onClick: save }, A.t('tl.topic.save')),
          h(E.Button, { variant: 'quiet', href: gradesHref(lesson) }, A.t('tl.topic.grades')),
          h(E.Button, { variant: 'quiet', href: '#/podstawa?subjectId=' + encodeURIComponent(lesson.subjectId) }, A.t('tl.topic.editCurriculum'))),
        /* Komentarz do wpisu dziennika lekcyjnego — widzi go każdy, kto widzi lekcję. */
        h(window.EdLogComments.Toggle, { kind: 'lesson-log', entryId: lesson.id, counts: p.counts, onChange: p.onSaved }),
        h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, msg)));
  }

  /* File preview without downloading: images as <img>, text decoded from the dataUrl, anything else with a note. */
  function renderFile(f) {
    var frame = { maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' };
    if (/^image\//.test(f.type)) return h('img', { src: f.dataUrl, alt: A.t('tl.file.alt', { name: f.name }), style: frame });
    if (/^text\//.test(f.type) || /^application\/json/.test(f.type)) {
      var text = '';
      try { text = decodeURIComponent(escape(atob(String(f.dataUrl).split(',')[1] || ''))); } catch (e) { text = A.t('tl.file.unreadable'); }
      return h('pre', { style: Object.assign({ padding: 'var(--space-3)', whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto' }, frame) }, text);
    }
    return h(E.Alert, { tone: 'info', title: A.t('tl.file.title', { name: f.name }) },
      A.t('tl.file.openInfo', { type: f.type }),
      h('p', null, h('a', { href: f.dataUrl, target: '_blank', rel: 'noopener' }, A.t('tl.file.openTab', { name: f.name }))));
  }

  /* ---------------- reviewing submitted work in the browser (3.1.18) ---------------- */
  function ReviewDialog(p) {
    var list = A.useApi('/api/homework/' + p.homeworkId + '/submissions', [p.homeworkId]);
    var s1 = React.useState(null), open = s1[0], setOpen = s1[1];
    var s2 = React.useState(null), file = s2[0], setFile = s2[1];
    function view(sub) {
      A.api.get('/api/homework/' + p.homeworkId + '/submissions/' + sub.id)
        .then(function (r) { setOpen(r.submission); setFile((r.submission.files || [])[0] || null); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function markReviewed() {
      A.api.post('/api/homework/' + p.homeworkId + '/submissions/' + open.id + '/review', {})
        .then(function (r) { setOpen(r.submission); A.toast(A.t('tl.hw.reviewedToast'), 'success'); list.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var hw = (list.data && list.data.homework) || {};
    var subs = (list.data && list.data.submissions) || [];
    var missing = (list.data && list.data.missing) || [];
    return h(E.Dialog, { title: A.t('tl.hw.submissionsTitle', { s: hw.subjectId ? A.subjectName(hw.subjectId, hw.subjectName) : (hw.subjectName || '') }), onClose: p.onClose, actions: h(E.Button, { onClick: p.onClose }, A.t('common.close')) },
      h('div', { className: 'stack' },
        h('p', { className: 'muted' }, A.t('tl.hw.filesInline')),
        h('ul', { className: 'stack', style: { listStyle: 'none', padding: 0 } }, subs.map(function (sub) {
          return h('li', { key: sub.id, className: 'row' },
            h(E.Badge, { tone: sub.reviewedAt ? 'success' : 'outline', icon: sub.reviewedAt ? 'check' : 'clock' }, A.t(sub.reviewedAt ? 'tl.hw.reviewed' : 'tl.hw.toReview')),
            h('span', null, sub.studentName),
            h('span', { className: 'muted' }, A.t('tl.hw.submittedAt', { at: A.fmtDateTime(sub.receivedAt) }) + ' · ' + (sub.files.length ? sub.files.map(function (f) { return f.name; }).join(', ') : A.t('tl.hw.noAttachment'))),
            h(E.Button, { size: 'sm', variant: 'secondary', icon: 'file', onClick: function () { view(sub); } }, A.t('tl.hw.openWork')));
        })),
        subs.length ? null : h('p', { className: 'muted' }, A.t('tl.hw.nobody')),
        missing.length ? h('p', { className: 'muted' }, A.t('tl.hw.missing', { list: missing.map(function (m) { return m.name; }).join(', ') })) : null,
        open && h('div', { className: 'card' },
          h('h3', null, A.t('tl.hw.workOf', { name: open.studentName })),
          open.text ? h('p', null, open.text) : null,
          h('div', { className: 'row' }, (open.files || []).map(function (f) {
            return h(E.Button, { key: f.name, size: 'sm', variant: file && file.name === f.name ? 'secondary' : 'quiet', onClick: function () { setFile(f); } }, f.name);
          })),
          file ? renderFile(file) : null,
          h('div', { className: 'row' },
            h(E.Button, { variant: 'primary', icon: 'check', onClick: markReviewed }, A.t('tl.hw.markReviewed')),
            h(E.Button, { variant: 'quiet', href: gradesHref(p.lesson, open.studentId) }, A.t('tl.hw.grade'))),
          h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' },
            open.reviewedAt ? A.t('tl.hw.reviewedAt', { at: A.fmtDateTime(open.reviewedAt) }) : A.t('tl.hw.notReviewed')))));
  }

  /* ---------------- homework ---------------- */
  function HomeworkCard(p) {
    var lesson = p.lesson, cfg = p.config;
    var maxMB = (cfg && cfg.homeworkMaxAttachmentMB) || 10;
    var s1 = React.useState({ text: '', due: lesson.date, time: '23:59', limit: String(maxMB), block: true }), f = s1[0], setF = s1[1];
    var s2 = React.useState(''), msg = s2[0], setMsg = s2[1];
    var s3 = React.useState(null), review = s3[0], setReview = s3[1];
    var list = A.useApi('/api/homework?classId=' + lesson.classId + '&subjectId=' + lesson.subjectId, [lesson.id]);
    function upd(patch) { setF(Object.assign({}, f, patch)); }
    function publish() {
      A.api.post('/api/homework', {
        classId: lesson.classId, groupId: lesson.groupId || null, subjectId: lesson.subjectId, lessonId: lesson.id,
        text: f.text, dueAt: f.due + 'T' + f.time, maxAttachmentMB: +f.limit, lockAfterDue: f.block
      }).then(function (res) {
        setMsg(A.t('tl.hw.publishedMsg', {
          c: lesson.classId, date: A.fmtDate(res.homework.dueDate || res.homework.dueAt), time: res.homework.dueTime || String(res.homework.dueLocal || '').slice(11, 16),
          mb: res.homework.maxAttachmentMB, lock: A.t(res.homework.lockAfterDue ? 'tl.hw.lockOn' : 'tl.hw.lockOff')
        }));
        A.toast(A.t('tl.hw.publishedToast'), 'success'); upd({ text: '' }); list.reload();
      }).catch(function (e) { A.toast(e.message || A.t('tl.hw.publishFail'), 'danger'); });
    }
    var rows = (list.data && list.data.homework) || [];
    return h('section', { className: 'card', 'aria-labelledby': 'h-zd' },
      h('h2', { id: 'h-zd' }, A.t('tl.hw.h')),
      h('div', { className: 'stack' },
        h(E.TextField, { label: A.t('tl.hw.text'), multiline: 3, required: true, value: f.text, placeholder: A.t('tl.hw.textPh'), onChange: function (ev) { upd({ text: ev.target.value }); } }),
        h('div', { className: 'grid-3' },
          h(E.TextField, Object.assign({ label: A.t('tl.hw.due'), type: 'date', value: f.due, hint: A.dateHint(f.due), onChange: function (ev) { upd({ due: ev.target.value }); } }, A.dateInputProps())),
          h(E.TextField, Object.assign({ label: A.t('tl.hw.time'), type: 'time', value: f.time, onChange: function (ev) { upd({ time: ev.target.value }); }, hint: A.dateHint(f.time, 'time') }, A.dateInputProps('time'))),
          h(E.TextField, { label: A.t('tl.hw.limit'), type: 'number', min: 1, max: maxMB, affix: 'MB', value: f.limit, hint: A.t('tl.hw.limitHint', { n: maxMB }), onChange: function (ev) { upd({ limit: ev.target.value }); } })),
        h(E.Checkbox, { label: A.t('tl.hw.block'), hint: A.t('tl.hw.blockHint'), checked: f.block, onChange: function (ev) { upd({ block: ev.target.checked }); } }),
        h('div', { className: 'row' }, h(E.Button, { variant: 'secondary', icon: 'check', disabled: !f.text.trim() || !f.due, onClick: publish }, A.t('tl.hw.publish'))),
        h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, msg || A.t('tl.hw.noneYet')),
        rows.length ? h('ul', { className: 'stack', style: { listStyle: 'none', padding: 0 } }, rows.slice(0, 4).map(function (hw) {
          return h('li', { key: hw.id, className: 'row' },
            h(E.Badge, { tone: hw.locked ? 'danger' : 'outline', icon: hw.locked ? 'lock' : 'clock' }, A.t('tl.hw.dueBadge', { date: A.fmtDate(hw.dueDate || hw.dueAt), time: hw.dueTime || String(hw.dueLocal || '').slice(11, 16) })),
            h('span', { className: 'muted' }, A.t('tl.hw.counts', { text: hw.text.slice(0, 70) + (hw.text.length > 70 ? '…' : ''), a: hw.submittedCount, b: hw.expectedCount, c: hw.reviewedCount })),
            h(E.Button, { size: 'sm', variant: 'quiet', icon: 'file', onClick: function () { setReview(hw.id); } }, A.t('tl.hw.works')));
        })) : null,
        review && h(ReviewDialog, { homeworkId: review, lesson: lesson, onClose: function () { setReview(null); list.reload(); } })));
  }

  /* ---------------- announced test ---------------- */
  function TestCard(p) {
    var lesson = p.lesson, cfg = p.config, subject = A.subjectName(lesson.subjectId, lesson.subjectName);
    var s1 = React.useState({ date: lesson.date, kind: 'sprawdzian', scope: '' }), f = s1[0], setF = s1[1];
    var s2 = React.useState(null), err = s2[0], setErr = s2[1];
    var s3 = React.useState(''), msg = s3[0], setMsg = s3[1];
    var check = A.useApi('/api/tests/check?classId=' + lesson.classId + '&date=' + f.date + '&kind=' + encodeURIComponent(f.kind), [lesson.id]);
    var list = A.useApi('/api/tests?classId=' + lesson.classId, [lesson.id]);
    function upd(patch) { setF(Object.assign({}, f, patch)); setErr(null); }
    var ch = check.data;
    function announce() {
      A.api.post('/api/tests', { classId: lesson.classId, subjectId: lesson.subjectId, date: f.date, kind: f.kind, scope: f.scope })
        .then(function (res) {
          setErr(null);
          setMsg(A.t('tl.test.savedMsg', { kind: kindName(res.test.kind), date: A.fmtDate(res.test.date), c: lesson.classId, s: subject }) + (res.warning || ''));
          A.toast(A.t('tl.test.announcedToast', { kind: kindName(res.test.kind), date: A.fmtDate(res.test.date) }), 'success'); check.reload(); list.reload();
        })
        .catch(function (e) { setErr(e.message || A.t('tl.test.saveFail')); A.toast(e.message || A.t('tl.test.saveFail'), 'danger'); });
    }
    var limits = (cfg && cfg.testLimits) || {};
    var rows = (list.data && list.data.tests) || [];
    return h('section', { className: 'card', 'aria-labelledby': 'h-spr' },
      h('h2', { id: 'h-spr' }, A.t('tl.test.h')),
      h('div', { className: 'stack' },
        err && h(E.Alert, { tone: 'danger', title: A.t('tl.test.rejected') }, err),
        ch && h(E.Alert, { tone: ch.limitReached ? 'warning' : 'info', title: ch.limitReached ? A.t('tl.test.limitReached') : A.t('tl.test.limitCount', { a: ch.weekCount, b: ch.perWeek }) }, ch.warning),
        h(E.TextField, Object.assign({ label: A.t('common.date'), type: 'date', value: f.date, hint: A.dateHint(f.date), onChange: function (ev) { upd({ date: ev.target.value }); } }, A.dateInputProps())),
        h(E.Select, {
          label: A.t('tl.test.kind'), value: f.kind,
          options: [{ value: 'sprawdzian', label: A.t('tl.test.opt.test') }, { value: 'kartkówka', label: A.t('tl.test.opt.quiz') }],
          hint: A.t('tl.test.limitHint', { d: limits.perDay || 1, w: limits.perWeek || 3 }),
          onChange: function (ev) { upd({ kind: ev.target.value }); }
        }),
        h(E.TextField, { label: A.t('tl.test.scope'), value: f.scope, placeholder: A.t('tl.test.scopePh'), onChange: function (ev) { upd({ scope: ev.target.value }); } }),
        h('div', { className: 'row' }, h(E.Button, { variant: 'secondary', icon: 'calendar', onClick: announce }, A.t('tl.test.announce'))),
        h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, msg),
        rows.length ? h('ul', { className: 'stack muted', style: { listStyle: 'none', padding: 0 } }, rows.slice(0, 6).map(function (t) {
          return h('li', { key: t.id }, A.fmtDate(t.date) + ' · ' + A.subjectName(t.subjectId, t.subjectName) + ' · ' + kindName(t.kind) + (t.scope ? ' · ' + t.scope : ''));
        })) : null));
  }

  /* ---------------- one lesson ---------------- */
  function LessonPanel(p) {
    var att = A.useApi('/api/attendance/lesson/' + p.lessonId, [p.lessonId]);
    if (att.error) return h(E.Alert, { tone: 'danger' }, att.error.message);
    if (!att.data) return h('p', { className: 'muted' }, A.t('tl.loadingLesson'));
    var lesson = att.data.lesson;
    return h('div', { className: 'grid-2' },
      h('div', null,
        h(AttendanceCard, { lesson: lesson, att: att }),
        h(TestCard, { lesson: lesson, config: p.config })),
      h('div', null,
        h(TopicCard, { lesson: lesson, counts: p.counts, onSaved: p.onSaved }),
        h(HomeworkCard, { lesson: lesson, config: p.config }),
        /* materiały z lekcji z przełącznikiem „otwarty na współpracę” — screens/materials.js */
        window.EdMaterials ? h(window.EdMaterials.LessonCard, { lesson: lesson }) : null));
  }

  /* ---------------- screen ---------------- */
  function Screen(props) {
    var app = A.useAppState();
    var today = (props.config && props.config.today) || A.isoToday();
    var s1 = React.useState(today), date = s1[0], setDate = s1[1];
    var day = A.useApi('/api/lessons?date=' + date, [date]);
    var lessons = (day.data && day.data.lessons) || [];
    var wanted = props.route.query.lesson;
    var current = null;
    lessons.forEach(function (l) { if (l.id === wanted) current = l; });
    if (!current && lessons.length) current = lessons[0];

    var sync = app.syncError ? 'error' : app.syncing ? 'pending' : !app.online ? 'offline' : app.queue.length ? 'pending' : 'synced';
    return h('div', null,
      h('h1', { className: 'display app-title' }, A.t('tl.title')),
      h('p', { className: 'app-sub' },
        ((props.config && props.config.school && props.config.school.short) || '') + ' · ' + A.userName(props.user) + ' · ' + A.fmtDate(date) +
        (current ? ' · ' + lessonLabel(current) : '')),
      h('div', { className: 'row mb-4' },
        h(E.SyncStatus, {
          state: sync, pending: app.queue.length || undefined,
          detail: !app.online ? A.t('tl.syncOffline') : app.syncError || (app.lastSync ? A.t('tl.lastSync', { at: A.fmtDateTime(app.lastSync.toISOString()) }) : undefined),
          action: (app.online && app.queue.length) ? A.t('shell.sendNow') : undefined, onAction: A.flushQueue
        }),
        h(E.TextField, Object.assign({ label: A.t('tl.day'), type: 'date', value: date, width: '12rem', hint: A.dateHint(date), onChange: function (ev) { setDate(ev.target.value); } }, A.dateInputProps()))),

      h('section', { className: 'card mb-4', 'aria-labelledby': 'h-plan' },
        h('h2', { id: 'h-plan' }, A.t('tl.dayLessons')),
        day.loading && !lessons.length ? h('p', { className: 'muted' }, A.t('tl.loadingPlan')) : null,
        !day.loading && !lessons.length ? h('p', { className: 'muted' }, A.t('tl.noLessons')) : null,
        h('div', { className: 'grid-3' }, lessons.map(function (l) {
          return h(E.LessonCard, {
            key: l.id, no: l.lessonNo, start: l.start, end: l.end,
            className: current && l.id === current.id ? 'app-lesson-open' : undefined,
            subject: A.subjectName(l.subjectId, l.subjectName), group: l.groupName || undefined, room: l.room,
            teacher: l.substituteTeacherId ? l.teacherName : undefined,
            state: isNow(l) ? 'now' : l.substituteTeacherId ? 'sub' : 'normal',
            note: (current && l.id === current.id ? A.t('tl.card.open') + ' · ' : '') + (l.combinedWith ? A.t('tl.card.combined') + ' · ' : '') + A.t(l.hasTopic ? 'tl.card.topicSaved' : 'tl.card.noTopic') +
              ' · ' + A.t('tl.card.att', { a: l.attendance.saved, b: l.attendance.total }) + (l.attendance.drafts ? ' ' + A.t('tl.card.draft') : ''),
            action: current && l.id === current.id ? undefined : A.t('tl.open'),
            onAction: function () { A.navigate('/lekcja', { lesson: l.id }); }
          });
        }))),

      current ? h(LessonPanel, { key: current.id, lessonId: current.id, counts: current.comments, config: props.config, onSaved: day.reload })
        : h('p', { className: 'muted' }, A.t('tl.pickLesson')));
  }

  A.screen({ id: 'teacher-lesson', path: '/lekcja', title: 'Dziennik lekcyjny', roles: ['teacher', 'principal'], module: 'logbook', nav: { key: 'nav.logbook', label: 'Dziennik', order: 10 }, component: Screen });
})();
