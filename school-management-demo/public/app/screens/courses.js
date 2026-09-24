/* Ekran modułu „Kursy” (LMS w dzienniku): nauczyciel buduje kurs (jednostki, elementy, quiz), publikuje go
   i śledzi postępy; uczeń przechodzi kurs, rozwiązuje quiz i pobiera zaświadczenie; rodzic widzi postęp dziecka.
   Treści tekstowe są w „lekkim markdownie” (akapity, **pogrubienie**, listy) renderowanym przez Reacta —
   tekst nigdy nie trafia do innerHTML, więc HTML z treści jest automatycznie ekranowany. */
window.EdI18n.add({
  pl: {
    'co.title': 'Kursy', 'co.subTeacher': 'Kursy, które prowadzisz — treści, quizy i postępy uczniów.',
    'co.subStudent': 'Twoje kursy: materiały, quizy i zadania krok po kroku.', 'co.subParent': 'Postępy dziecka w kursach szkolnych — widok tylko do odczytu.',
    'co.tabs.courses': 'Kursy', 'co.tabs.editor': 'Edytor kursu', 'co.tabs.gradebook': 'Postępy uczniów',
    'co.new': 'Nowy kurs', 'co.newTitle': 'Nowy kurs', 'co.create': 'Utwórz kurs',
    'co.field.title': 'Tytuł kursu', 'co.field.description': 'Opis', 'co.field.subject': 'Przedmiot', 'co.field.class': 'Oddział',
    'co.field.visibility': 'Dostępność', 'co.field.cover': 'Kolor okładki', 'co.field.language': 'Język kursu',
    'co.vis.class': 'Dla wskazanego oddziału', 'co.vis.open': 'Otwarty — zapisy własne',
    'co.status.draft': 'Wersja robocza', 'co.status.published': 'Opublikowany', 'co.status.archived': 'Zarchiwizowany',
    'co.open': 'Otwórz', 'co.edit': 'Edytuj kurs', 'co.publish': 'Opublikuj', 'co.archive': 'Archiwizuj', 'co.enrolClass': 'Zapisz oddział',
    'co.published': 'Kurs opublikowany.', 'co.archived': 'Kurs zarchiwizowany.', 'co.enrolled': 'Zapisano uczniów: {n}.',
    'co.units': 'Jednostki', 'co.unit': 'Jednostka', 'co.addUnit': 'Dodaj jednostkę', 'co.unitTitle': 'Tytuł jednostki',
    'co.unitSummary': 'Krótki opis', 'co.availableFrom': 'Otwarta od', 'co.unitAdded': 'Jednostka dodana.',
    'co.lockedUntil': 'Otworzy się {date}', 'co.lockedInfo': 'Ta jednostka otworzy się {date}. Wcześniej jej elementy są niedostępne.',
    'co.items': 'Elementy', 'co.addItem': 'Dodaj element', 'co.itemTitle': 'Tytuł elementu', 'co.itemKind': 'Rodzaj elementu',
    'co.itemBody': 'Treść (akapity, **pogrubienie**, listy z myślnikiem)', 'co.itemRequired': 'Wymagany do ukończenia kursu',
    'co.itemAdded': 'Element dodany.', 'co.itemDeleted': 'Element usunięty.', 'co.noItems': 'Ta jednostka nie ma jeszcze elementów.',
    'co.kind.text': 'Tekst', 'co.kind.material': 'Materiał', 'co.kind.link': 'Odnośnik', 'co.kind.assignment': 'Zadanie domowe', 'co.kind.quiz': 'Quiz', 'co.kind.meeting': 'Spotkanie',
    'co.field.material': 'Materiał z dziennika (identyfikator)', 'co.field.url': 'Adres odnośnika', 'co.field.meeting': 'Identyfikator istniejącego spotkania (opcjonalnie)',
    'co.field.meetingDate': 'Data zajęć', 'co.field.meetingStart': 'Początek (GG:MM)', 'co.field.meetingEnd': 'Koniec (GG:MM)',
    'co.meetingHint': 'Podaj termin, a dziennik założy spotkanie wideo na serwerze szkoły dla uczniów zapisanych na kurs. Możesz też wpisać identyfikator istniejącego spotkania.',
    'co.meetingWhen': 'Termin spotkania', 'co.meetingCancelled': 'Spotkanie odwołane.',
    'co.hw.text': 'Treść zadania domowego', 'co.hw.due': 'Termin oddania (RRRR-MM-DD)', 'co.hw.link': 'Oddaj pracę w dzienniku',
    'co.quiz.builder': 'Pytania quizu', 'co.quiz.addQuestion': 'Dodaj pytanie', 'co.quiz.question': 'Treść pytania {n}',
    'co.quiz.option': 'Odpowiedź {n}', 'co.quiz.correct': 'Poprawna odpowiedź', 'co.quiz.points': 'Punkty', 'co.quiz.attempts': 'Liczba podejść',
    'co.quiz.timeLimit': 'Limit czasu (min)', 'co.quiz.removeQuestion': 'Usuń pytanie',
    'co.quiz.start': 'Rozwiąż quiz', 'co.quiz.submit': 'Oddaj quiz', 'co.quiz.result': 'Wynik: {score} z {max} pkt ({percent})',
    'co.quiz.correctAnswer': 'Poprawna odpowiedź: {text}', 'co.quiz.ok': 'Dobrze', 'co.quiz.bad': 'Źle',
    'co.quiz.attemptsLeft': 'Pozostałe podejścia: {n}', 'co.quiz.noAttempts': 'Wykorzystano wszystkie podejścia.',
    'co.quiz.best': 'Najlepszy wynik: {score} z {max} pkt', 'co.quiz.toGrade': 'Wpisz ocenę z quizu', 'co.quiz.graded': 'Ocena {value} wpisana do dziennika.',
    'co.progress': 'Postęp kursu', 'co.progressOf': '{done} z {total} elementów obowiązkowych',
    'co.markDone': 'Oznacz jako zrobione', 'co.done': 'Zrobione', 'co.new2': 'Do zrobienia', 'co.doneToast': 'Zapisano postęp.',
    'co.certificate': 'Zaświadczenie o ukończeniu', 'co.certificateHint': 'Wszystkie elementy obowiązkowe zaliczone — możesz pobrać zaświadczenie do wydruku.',
    'co.myCourses': 'Moje kursy', 'co.available': 'Kursy otwarte', 'co.selfEnrol': 'Zapisz się', 'co.selfEnrolled': 'Zapisano na kurs.',
    'co.noCourses': 'Nie masz jeszcze żadnych kursów.', 'co.noCoursesTeacher': 'Nie prowadzisz jeszcze żadnego kursu. Zacznij od przycisku „Nowy kurs”.',
    'co.discussion': 'Dyskusja', 'co.newThread': 'Nowy wątek', 'co.threadTitle': 'Temat wątku', 'co.post': 'Napisz', 'co.reply': 'Odpowiedz',
    'co.locked': 'Zamknięty', 'co.pinned': 'Przypięty', 'co.lock': 'Zamknij wątek', 'co.unlock': 'Otwórz wątek', 'co.pin': 'Przypnij', 'co.unpin': 'Odepnij',
    'co.lockedThread': 'Wątek zamknięty przez nauczyciela — nie można dopisywać odpowiedzi.', 'co.posted': 'Wpis dodany.',
    'co.gb.student': 'Uczeń', 'co.gb.progress': 'Postęp', 'co.gb.quizzes': 'Quizy', 'co.gb.assignments': 'Zadania',
    'co.gb.submitted': 'Oddane', 'co.gb.missing': 'Brak', 'co.gb.reviewed': 'Sprawdzone', 'co.gb.noAttempt': 'brak podejścia',
    'co.gb.enrolled': 'Zapisani', 'co.gb.avg': 'Średni postęp', 'co.gb.completed': 'Ukończyli kurs',
    'co.stat.units': 'Jednostki', 'co.stat.items': 'Elementy', 'co.stat.enrolled': 'Zapisani uczniowie',
    'co.download': 'Pobierz materiał', 'co.openLink': 'Otwórz odnośnik', 'co.meetingJoin': 'Dołącz do spotkania',
    'co.backToList': 'Wróć do listy kursów', 'co.childProgress': 'Postępy w kursach', 'co.readOnly': 'Widok tylko do odczytu.',
    'co.confirmDelete': 'Usunąć ten element kursu?', 'co.teacher': 'Prowadzący', 'co.langLabel': 'Język',
    'co.quizMeta': '{n} pytań · {max} pkt', 'co.optional': 'nieobowiązkowy', 'co.quiz.pts': '{n} pkt'
  },
  en: {
    'co.title': 'Courses', 'co.subTeacher': 'Courses you teach — content, quizzes and student progress.',
    'co.subStudent': 'Your courses: materials, quizzes and assignments, step by step.', 'co.subParent': "Your child's progress in school courses — read-only view.",
    'co.tabs.courses': 'Courses', 'co.tabs.editor': 'Course editor', 'co.tabs.gradebook': 'Student progress',
    'co.new': 'New course', 'co.newTitle': 'New course', 'co.create': 'Create course',
    'co.field.title': 'Course title', 'co.field.description': 'Description', 'co.field.subject': 'Subject', 'co.field.class': 'Class',
    'co.field.visibility': 'Availability', 'co.field.cover': 'Cover colour', 'co.field.language': 'Course language',
    'co.vis.class': 'For a specific class', 'co.vis.open': 'Open — self-enrolment',
    'co.status.draft': 'Draft', 'co.status.published': 'Published', 'co.status.archived': 'Archived',
    'co.open': 'Open', 'co.edit': 'Edit course', 'co.publish': 'Publish', 'co.archive': 'Archive', 'co.enrolClass': 'Enrol class',
    'co.published': 'Course published.', 'co.archived': 'Course archived.', 'co.enrolled': 'Students enrolled: {n}.',
    'co.units': 'Units', 'co.unit': 'Unit', 'co.addUnit': 'Add unit', 'co.unitTitle': 'Unit title',
    'co.unitSummary': 'Short summary', 'co.availableFrom': 'Available from', 'co.unitAdded': 'Unit added.',
    'co.lockedUntil': 'Opens on {date}', 'co.lockedInfo': 'This unit opens on {date}. Its items are unavailable until then.',
    'co.items': 'Items', 'co.addItem': 'Add item', 'co.itemTitle': 'Item title', 'co.itemKind': 'Item type',
    'co.itemBody': 'Body (paragraphs, **bold**, dashed lists)', 'co.itemRequired': 'Required to complete the course',
    'co.itemAdded': 'Item added.', 'co.itemDeleted': 'Item deleted.', 'co.noItems': 'This unit has no items yet.',
    'co.kind.text': 'Text', 'co.kind.material': 'Material', 'co.kind.link': 'Link', 'co.kind.assignment': 'Homework', 'co.kind.quiz': 'Quiz', 'co.kind.meeting': 'Meeting',
    'co.field.material': 'Material from the logbook (id)', 'co.field.url': 'Link address', 'co.field.meeting': 'Id of an existing meeting (optional)',
    'co.field.meetingDate': 'Session date', 'co.field.meetingStart': 'Start (HH:MM)', 'co.field.meetingEnd': 'End (HH:MM)',
    'co.meetingHint': 'Give a time and the logbook creates a video meeting on the school server for the students enrolled on this course. You can also paste the id of an existing meeting.',
    'co.meetingWhen': 'Meeting time', 'co.meetingCancelled': 'Meeting cancelled.',
    'co.hw.text': 'Homework text', 'co.hw.due': 'Due date (YYYY-MM-DD)', 'co.hw.link': 'Hand in your work in the logbook',
    'co.quiz.builder': 'Quiz questions', 'co.quiz.addQuestion': 'Add question', 'co.quiz.question': 'Question {n}',
    'co.quiz.option': 'Answer {n}', 'co.quiz.correct': 'Correct answer', 'co.quiz.points': 'Points', 'co.quiz.attempts': 'Attempts',
    'co.quiz.timeLimit': 'Time limit (min)', 'co.quiz.removeQuestion': 'Remove question',
    'co.quiz.start': 'Take the quiz', 'co.quiz.submit': 'Submit quiz', 'co.quiz.result': 'Score: {score} of {max} pts ({percent})',
    'co.quiz.correctAnswer': 'Correct answer: {text}', 'co.quiz.ok': 'Correct', 'co.quiz.bad': 'Wrong',
    'co.quiz.attemptsLeft': 'Attempts left: {n}', 'co.quiz.noAttempts': 'All attempts used.',
    'co.quiz.best': 'Best score: {score} of {max} pts', 'co.quiz.toGrade': 'Record quiz grade', 'co.quiz.graded': 'Grade {value} saved to the logbook.',
    'co.progress': 'Course progress', 'co.progressOf': '{done} of {total} required items',
    'co.markDone': 'Mark as done', 'co.done': 'Done', 'co.new2': 'To do', 'co.doneToast': 'Progress saved.',
    'co.certificate': 'Completion certificate', 'co.certificateHint': 'All required items are complete — you can download a printable certificate.',
    'co.myCourses': 'My courses', 'co.available': 'Open courses', 'co.selfEnrol': 'Enrol', 'co.selfEnrolled': 'Enrolled in the course.',
    'co.noCourses': 'You have no courses yet.', 'co.noCoursesTeacher': 'You do not teach any course yet. Start with “New course”.',
    'co.discussion': 'Discussion', 'co.newThread': 'New thread', 'co.threadTitle': 'Thread subject', 'co.post': 'Post', 'co.reply': 'Reply',
    'co.locked': 'Locked', 'co.pinned': 'Pinned', 'co.lock': 'Lock thread', 'co.unlock': 'Unlock thread', 'co.pin': 'Pin', 'co.unpin': 'Unpin',
    'co.lockedThread': 'The teacher locked this thread — no new replies can be added.', 'co.posted': 'Post added.',
    'co.gb.student': 'Student', 'co.gb.progress': 'Progress', 'co.gb.quizzes': 'Quizzes', 'co.gb.assignments': 'Assignments',
    'co.gb.submitted': 'Handed in', 'co.gb.missing': 'Missing', 'co.gb.reviewed': 'Reviewed', 'co.gb.noAttempt': 'no attempt',
    'co.gb.enrolled': 'Enrolled', 'co.gb.avg': 'Average progress', 'co.gb.completed': 'Completed the course',
    'co.stat.units': 'Units', 'co.stat.items': 'Items', 'co.stat.enrolled': 'Enrolled students',
    'co.download': 'Download material', 'co.openLink': 'Open link', 'co.meetingJoin': 'Join the meeting',
    'co.backToList': 'Back to the course list', 'co.childProgress': 'Course progress', 'co.readOnly': 'Read-only view.',
    'co.confirmDelete': 'Delete this course item?', 'co.teacher': 'Teacher', 'co.langLabel': 'Language',
    'co.quizMeta': '{n} questions · {max} pts', 'co.optional': 'optional', 'co.quiz.pts': '{n} pts'
  }
});

(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;
  var t = A.t;
  var KINDS = ['text', 'material', 'link', 'assignment', 'quiz', 'meeting'];
  var KIND_ICON = { text: 'file', material: 'download', link: 'chevron-right', assignment: 'edit', quiz: 'check-all', meeting: 'users' };
  var COVERS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'];

  /* ---------- lekki markdown: akapity, **pogrubienie**, listy ---------- */
  function inline(text, key) {
    return String(text == null ? '' : text).split('**').map(function (part, i) { return i % 2 ? h('strong', { key: key + 'b' + i }, part) : part; });
  }
  function Markdown(p) {
    var blocks = String(p.text == null ? '' : p.text).split(/\n{2,}/).filter(function (b) { return b.trim(); });
    if (!blocks.length) return null;
    var bullet = /^\s*[-*]\s+/;
    var out = [];
    blocks.forEach(function (b, bi) {
      var run = null;                                    // bieżąca lista punktowana wewnątrz akapitu
      var para = [];                                     // bieżące wiersze zwykłego tekstu
      var flushPara = function () { if (para.length) { out.push(h('p', { key: 'p' + bi + '-' + out.length, style: { margin: 0 } }, inline(para.join(' '), bi + '-' + out.length + '-'))); para = []; } };
      var flushRun = function () { if (run && run.length) { out.push(h('ul', { key: 'u' + bi + '-' + out.length, style: { margin: 0, paddingLeft: 'var(--space-5)' } }, run.map(function (l, i) { return h('li', { key: i }, inline(l, bi + '-' + i + '-')); }))); } run = null; };
      b.split('\n').forEach(function (line) {
        if (!line.trim()) return;
        if (bullet.test(line)) { flushPara(); (run = run || []).push(line.replace(bullet, '')); }
        else { flushRun(); para.push(line.trim()); }
      });
      flushPara(); flushRun();
    });
    return h('div', { className: 'stack', style: { gap: 'var(--space-2)' } }, out);
  }

  function Section(p) {
    return h('section', { className: 'card', 'aria-labelledby': p.hid },
      h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
        h('h2', { className: 'heading', id: p.hid, style: { margin: 0 } }, p.title), p.actions || null),
      p.children);
  }
  function statusTone(s) { return s === 'published' ? 'success' : s === 'archived' ? 'outline' : 'info'; }
  function kindLabel(k) { return t('co.kind.' + k); }
  function cover(c) { return { borderLeft: '4px solid var(--' + (c.coverColor || 'cat-1') + ')' }; }
  function fileSize(n) { return n > 1048576 ? A.fmtNum(n / 1048576, 1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' kB'; }

  /* ======================= NAUCZYCIEL: lista kursów ======================= */
  function NewCourseDialog(p) {
    var st = React.useState({ title: '', description: '', subjectId: (p.subjects[0] || {}).id || 'mat', classId: (p.classes[0] || {}).id || '', visibility: 'class', coverColor: 'cat-1', language: 'pl', busy: false });
    var f = st[0], set = st[1];
    var save = function () {
      set(Object.assign({}, f, { busy: true }));
      A.api.post('/api/courses', { title: f.title, description: f.description, subjectId: f.subjectId, classIds: f.visibility === 'class' && f.classId ? [f.classId] : [], visibility: f.visibility, coverColor: f.coverColor, language: f.language })
        .then(function (r) { p.onDone(r.course.id); })
        .catch(function (e) { set(Object.assign({}, f, { busy: false })); A.toast(e.message, 'danger'); });
    };
    return h(E.Dialog, { title: t('co.newTitle'), onClose: p.onClose, initialFocus: '[data-autofocus]', actions: [
      h(E.Button, { key: 'c', onClick: p.onClose }, t('common.cancel')),
      h(E.Button, { key: 's', variant: 'primary', loading: f.busy, disabled: !f.title.trim(), onClick: save }, t('co.create'))] },
      h('div', { className: 'stack' },
        h(E.TextField, { label: t('co.field.title'), 'data-autofocus': true, value: f.title, required: true, onChange: function (e) { set(Object.assign({}, f, { title: e.target.value })); } }),
        h(E.TextField, { label: t('co.field.description'), multiline: 3, value: f.description, onChange: function (e) { set(Object.assign({}, f, { description: e.target.value })); } }),
        h(E.Select, { label: t('co.field.subject'), value: f.subjectId, options: p.subjects.map(function (s) { return { value: s.id, label: A.subjectName(s.id, s.name) }; }), onChange: function (e) { set(Object.assign({}, f, { subjectId: e.target.value })); } }),
        h(E.Select, { label: t('co.field.visibility'), value: f.visibility, options: [{ value: 'class', label: t('co.vis.class') }, { value: 'open', label: t('co.vis.open') }], onChange: function (e) { set(Object.assign({}, f, { visibility: e.target.value })); } }),
        f.visibility === 'class' ? h(E.Select, { label: t('co.field.class'), value: f.classId, options: p.classes.map(function (c) { return { value: c.id, label: c.name }; }), onChange: function (e) { set(Object.assign({}, f, { classId: e.target.value })); } }) : null,
        h(E.Select, { label: t('co.field.cover'), value: f.coverColor, options: COVERS.map(function (c, i) { return { value: c, label: String(i + 1) }; }), onChange: function (e) { set(Object.assign({}, f, { coverColor: e.target.value })); } }),
        h(E.Select, { label: t('co.field.language'), value: f.language, options: [{ value: 'pl', label: t('common.pl') }, { value: 'en', label: t('common.en') }], onChange: function (e) { set(Object.assign({}, f, { language: e.target.value })); } })));
  }

  function CourseList(p) {
    var st = React.useState(false), dlg = st[0], setDlg = st[1];
    var ctx = (p.data && p.data.context) || { subjects: [], classes: [] };
    var rows = (p.data && p.data.courses) || [];
    return h(F, null,
      h(Section, { hid: 'h-co-list', title: t('co.tabs.courses'), actions: h(E.Button, { variant: 'primary', icon: 'plus', onClick: function () { setDlg(true); } }, t('co.new')) },
        rows.length ? h('div', { className: 'grid-2', style: { marginTop: 'var(--space-3)' } }, rows.map(function (c) {
          return h('div', { key: c.id, className: 'card', style: cover(c) },
            h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
              h('h3', { className: 'subheading', style: { margin: 0 } }, c.title),
              h(E.Badge, { tone: statusTone(c.status), icon: c.status === 'published' ? 'check' : c.status === 'archived' ? 'lock' : 'edit' }, t('co.status.' + c.status))),
            h('p', { className: 'caption muted' }, A.subjectName(c.subjectId, c.subjectName) + ' · ' + (c.classIds.length ? c.classIds.join(', ') : t('co.vis.open')) + ' · ' + t('co.langLabel') + ': ' + c.language.toUpperCase()),
            h('p', { style: { marginTop: 0 } }, c.description),
            h('div', { className: 'row', style: { gap: 'var(--space-3)' } },
              h('span', { className: 'caption muted' }, t('co.stat.units') + ': ' + c.unitCount),
              h('span', { className: 'caption muted' }, t('co.stat.items') + ': ' + c.itemCount),
              h('span', { className: 'caption muted' }, t('co.stat.enrolled') + ': ' + c.enrolledCount)),
            h('div', { className: 'row' }, h(E.Button, { size: 'sm', onClick: function () { p.onOpen(c.id); } }, t('co.open'))));
        })) : h('p', { className: 'muted' }, t('co.noCoursesTeacher'))),
      dlg ? h(NewCourseDialog, { subjects: ctx.subjects, classes: ctx.classes, onClose: function () { setDlg(false); }, onDone: function (id) { setDlg(false); p.reload(); p.onOpen(id); } }) : null);
  }

  /* ======================= NAUCZYCIEL: edytor kursu ======================= */
  function QuizBuilder(p) {
    var qs = p.questions;
    var setQ = function (i, patch) { p.onChange(qs.map(function (q, k) { return k === i ? Object.assign({}, q, patch) : q; })); };
    return h('div', { className: 'stack' },
      h('h4', { className: 'subheading', style: { margin: 0 } }, t('co.quiz.builder')),
      qs.map(function (q, i) {
        return h('div', { key: i, className: 'card', style: { padding: 'var(--space-3)' } },
          h(E.TextField, { label: t('co.quiz.question', { n: i + 1 }), value: q.text, onChange: function (e) { setQ(i, { text: e.target.value }); } }),
          q.options.map(function (op, k) {
            return h(E.TextField, { key: k, label: t('co.quiz.option', { n: k + 1 }), value: op.text, onChange: function (e) { setQ(i, { options: q.options.map(function (o, j) { return j === k ? { id: o.id, text: e.target.value } : o; }) }); } });
          }),
          h('div', { className: 'row' },
            h(E.Select, { label: t('co.quiz.correct'), width: 200, value: q.correctId, options: q.options.map(function (o, k) { return { value: o.id, label: t('co.quiz.option', { n: k + 1 }) }; }), onChange: function (e) { setQ(i, { correctId: e.target.value }); } }),
            h(E.TextField, { label: t('co.quiz.points'), width: 110, inputMode: 'numeric', value: String(q.points), onChange: function (e) { setQ(i, { points: e.target.value }); } }),
            h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', onClick: function () { p.onChange(qs.filter(function (_, k) { return k !== i; })); } }, t('co.quiz.removeQuestion'))));
      }),
      h(E.Button, { size: 'sm', icon: 'plus', onClick: function () { p.onChange(qs.concat([{ id: 'q' + (qs.length + 1), text: '', points: 1, correctId: 'o1', options: [{ id: 'o1', text: '' }, { id: 'o2', text: '' }, { id: 'o3', text: '' }] }])); } }, t('co.quiz.addQuestion')));
  }

  function ItemDialog(p) {
    var st = React.useState({ kind: 'text', title: '', body: '', url: '', materialId: '', meetingId: '', meetDate: '', meetStart: '', meetEnd: '', required: true, hwText: '', hwDue: '', attempts: '1', timeLimitMin: '', questions: [{ id: 'q1', text: '', points: 1, correctId: 'o1', options: [{ id: 'o1', text: '' }, { id: 'o2', text: '' }, { id: 'o3', text: '' }] }], busy: false });
    var f = st[0], set = st[1];
    var save = function () {
      var body = { unitId: p.unitId, kind: f.kind, title: f.title, body: f.body, required: f.required };
      if (f.kind === 'material') body.materialId = f.materialId.trim();
      if (f.kind === 'link') body.url = f.url.trim();
      if (f.kind === 'meeting') {
        if (f.meetingId.trim()) body.meetingId = f.meetingId.trim();
        else if (f.meetDate && f.meetStart) { body.start = f.meetDate + 'T' + f.meetStart; if (f.meetEnd) body.end = f.meetDate + 'T' + f.meetEnd; }
      }
      if (f.kind === 'assignment') body.homework = { text: f.hwText, dueAt: f.hwDue };
      if (f.kind === 'quiz') body.quiz = { attempts: +f.attempts || 1, timeLimitMin: f.timeLimitMin ? +f.timeLimitMin : null, questions: f.questions.map(function (q) { return { id: q.id, text: q.text, points: +q.points || 1, correctId: q.correctId, options: q.options.filter(function (o) { return o.text.trim(); }) }; }) };
      set(Object.assign({}, f, { busy: true }));
      A.api.post('/api/courses/' + p.courseId + '/items', body)
        .then(function () { A.toast(t('co.itemAdded'), 'success'); p.onDone(); })
        .catch(function (e) { set(Object.assign({}, f, { busy: false })); A.toast(e.message, 'danger'); });
    };
    return h(E.Dialog, { title: t('co.addItem'), onClose: p.onClose, actions: [
      h(E.Button, { key: 'c', onClick: p.onClose }, t('common.cancel')),
      h(E.Button, { key: 's', variant: 'primary', loading: f.busy, disabled: !f.title.trim(), onClick: save }, t('common.save'))] },
      h('div', { className: 'stack' },
        h(E.Select, { label: t('co.itemKind'), value: f.kind, options: KINDS.map(function (k) { return { value: k, label: kindLabel(k) }; }), onChange: function (e) { set(Object.assign({}, f, { kind: e.target.value })); } }),
        h(E.TextField, { label: t('co.itemTitle'), value: f.title, required: true, onChange: function (e) { set(Object.assign({}, f, { title: e.target.value })); } }),
        h(E.TextField, { label: t('co.itemBody'), multiline: 4, value: f.body, onChange: function (e) { set(Object.assign({}, f, { body: e.target.value })); } }),
        f.kind === 'material' ? h(E.TextField, { label: t('co.field.material'), mono: true, value: f.materialId, onChange: function (e) { set(Object.assign({}, f, { materialId: e.target.value })); } }) : null,
        f.kind === 'link' ? h(E.TextField, { label: t('co.field.url'), value: f.url, placeholder: 'https://', onChange: function (e) { set(Object.assign({}, f, { url: e.target.value })); } }) : null,
        f.kind === 'meeting' ? h(F, null,
          h('p', { className: 'caption muted', style: { margin: 0 } }, t('co.meetingHint')),
          h('div', { className: 'row' },
            h(E.TextField, Object.assign({ label: t('co.field.meetingDate'), type: 'date', value: f.meetDate, onChange: function (e) { set(Object.assign({}, f, { meetDate: e.target.value })); }, hint: A.dateHint(f.meetDate) }, A.dateInputProps())),
            h(E.TextField, { label: t('co.field.meetingStart'), width: 140, value: f.meetStart, placeholder: '16:00', onChange: function (e) { set(Object.assign({}, f, { meetStart: e.target.value })); } }),
            h(E.TextField, { label: t('co.field.meetingEnd'), width: 140, value: f.meetEnd, placeholder: '16:45', onChange: function (e) { set(Object.assign({}, f, { meetEnd: e.target.value })); } })),
          h(E.TextField, { label: t('co.field.meeting'), mono: true, value: f.meetingId, onChange: function (e) { set(Object.assign({}, f, { meetingId: e.target.value })); } })) : null,
        f.kind === 'assignment' ? h(F, null,
          h(E.TextField, { label: t('co.hw.text'), multiline: 2, value: f.hwText, onChange: function (e) { set(Object.assign({}, f, { hwText: e.target.value })); } }),
          h(E.TextField, Object.assign({ label: t('co.hw.due'), type: 'date', value: f.hwDue, onChange: function (e) { set(Object.assign({}, f, { hwDue: e.target.value })); }, hint: A.dateHint(f.hwDue) }, A.dateInputProps()))) : null,
        f.kind === 'quiz' ? h(F, null,
          h('div', { className: 'row' },
            h(E.TextField, { label: t('co.quiz.attempts'), width: 140, inputMode: 'numeric', value: f.attempts, onChange: function (e) { set(Object.assign({}, f, { attempts: e.target.value })); } }),
            h(E.TextField, { label: t('co.quiz.timeLimit'), width: 160, inputMode: 'numeric', value: f.timeLimitMin, onChange: function (e) { set(Object.assign({}, f, { timeLimitMin: e.target.value })); } })),
          h(QuizBuilder, { questions: f.questions, onChange: function (qs) { set(Object.assign({}, f, { questions: qs })); } })) : null,
        h(E.Checkbox, { label: t('co.itemRequired'), checked: f.required, onChange: function (e) { set(Object.assign({}, f, { required: e.target.checked })); } })));
  }

  function UnitForm(p) {
    var st = React.useState({ title: '', summary: '', availableFrom: '' }), f = st[0], set = st[1];
    var add = function () {
      A.api.post('/api/courses/' + p.courseId + '/units', f)
        .then(function () { set({ title: '', summary: '', availableFrom: '' }); A.toast(t('co.unitAdded'), 'success'); p.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    };
    return h('div', { className: 'row', style: { alignItems: 'flex-end' } },
      h(E.TextField, { label: t('co.unitTitle'), width: 260, value: f.title, onChange: function (e) { set(Object.assign({}, f, { title: e.target.value })); } }),
      h(E.TextField, { label: t('co.unitSummary'), width: 280, value: f.summary, onChange: function (e) { set(Object.assign({}, f, { summary: e.target.value })); } }),
      h(E.TextField, Object.assign({ label: t('co.availableFrom'), type: 'date', width: 180, value: f.availableFrom, onChange: function (e) { set(Object.assign({}, f, { availableFrom: e.target.value })); }, hint: A.dateHint(f.availableFrom) }, A.dateInputProps())),
      h(E.Button, { icon: 'plus', disabled: !f.title.trim(), onClick: add }, t('co.addUnit')));
  }

  function CourseEditor(p) {
    var d = p.data;
    var st = React.useState(null), dlgUnit = st[0], setDlgUnit = st[1];
    if (!d) return h('p', { className: 'muted' }, t('common.loading'));
    var c = d.course;
    var act = function (path, msg) { A.api.post('/api/courses/' + c.id + path, {}).then(function (r) { A.toast(msg + (r.added != null ? ' ' + t('co.enrolled', { n: r.added }) : ''), 'success'); p.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); };
    return h(F, null,
      h(Section, { hid: 'h-co-edit', title: c.title, actions: h('div', { className: 'row' },
        h(E.Button, { size: 'sm', variant: 'quiet', icon: 'chevron-left', onClick: p.onBack }, t('co.backToList')),
        c.status !== 'published' ? h(E.Button, { size: 'sm', variant: 'primary', icon: 'check', onClick: function () { act('/publish', t('co.published')); } }, t('co.publish')) : null,
        c.classIds.length ? h(E.Button, { size: 'sm', icon: 'users', onClick: function () { act('/enrol', t('co.enrolled', { n: 0 })); } }, t('co.enrolClass')) : null,
        c.status !== 'archived' ? h(E.Button, { size: 'sm', icon: 'lock', onClick: function () { act('/archive', t('co.archived')); } }, t('co.archive')) : null) },
        h('div', { className: 'row', style: { gap: 'var(--space-3)', marginTop: 'var(--space-2)' } },
          h(E.Badge, { tone: statusTone(c.status) }, t('co.status.' + c.status)),
          h(E.StatTile, { label: t('co.stat.units'), value: String(c.unitCount) }),
          h(E.StatTile, { label: t('co.stat.items'), value: String(c.itemCount) }),
          h(E.StatTile, { label: t('co.stat.enrolled'), value: String(c.enrolledCount), hint: A.subjectName(c.subjectId, c.subjectName) })),
        h('p', null, c.description)),
      h(Section, { hid: 'h-co-units', title: t('co.units') },
        p.canEdit ? h(UnitForm, { courseId: c.id, reload: p.reload }) : null,
        h('div', { className: 'stack', style: { marginTop: 'var(--space-3)' } }, d.units.map(function (u) {
          return h('div', { key: u.id, className: 'card' },
            h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
              h('h3', { className: 'subheading', style: { margin: 0 } }, u.order + '. ' + u.title),
              h('div', { className: 'row' },
                u.availableFrom ? h(E.Badge, { tone: u.locked ? 'info' : 'outline', icon: u.locked ? 'lock' : 'calendar' }, u.locked ? t('co.lockedUntil', { date: A.fmtDate(u.availableFrom) }) : A.fmtDate(u.availableFrom)) : null,
                p.canEdit ? h(E.Button, { size: 'sm', icon: 'plus', onClick: function () { setDlgUnit(u.id); } }, t('co.addItem')) : null)),
            u.summary ? h('p', { className: 'caption muted', style: { marginTop: 0 } }, u.summary) : null,
            u.items.length ? h('ul', { className: 'stack', style: { listStyle: 'none', padding: 0, margin: 0, gap: 'var(--space-2)' } }, u.items.map(function (it) {
              return h('li', { key: it.id, className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
                h('span', { className: 'row', style: { gap: 'var(--space-2)' } },
                  h(E.Icon, { name: KIND_ICON[it.kind] || 'file', label: kindLabel(it.kind) }),
                  h('span', null, it.title),
                  h(E.Badge, { tone: 'outline' }, kindLabel(it.kind)),
                  it.kind === 'quiz' ? h('span', { className: 'caption muted' }, t('co.quizMeta', { n: it.quiz.questions.length, max: it.maxScore })) : null,
                  it.kind === 'meeting' && it.meeting ? h('span', { className: 'caption muted' }, A.fmtDate(it.meeting.date) + ', ' + it.meeting.startTime + '–' + it.meeting.endTime) : null,
                  it.kind === 'meeting' && it.meeting ? h(E.Button, { size: 'sm', icon: 'users', href: it.meeting.joinPath }, t('co.meetingJoin')) : null,
                  it.required ? null : h('span', { className: 'caption muted' }, t('co.optional'))),
                p.canEdit ? h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', iconOnly: true, label: t('common.delete') + ': ' + it.title, onClick: function () { A.api.delete('/api/courses/' + c.id + '/items/' + it.id).then(function () { A.toast(t('co.itemDeleted'), 'success'); p.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); } }) : null);
            })) : h('p', { className: 'muted' }, t('co.noItems')));
        }))),
      h(Discussion, { courseId: c.id, threads: d.discussion, canModerate: p.canEdit, reload: p.reload }),
      dlgUnit ? h(ItemDialog, { courseId: c.id, unitId: dlgUnit, onClose: function () { setDlgUnit(null); }, onDone: function () { setDlgUnit(null); p.reload(); } }) : null);
  }

  /* ======================= NAUCZYCIEL: dziennik postępów ======================= */
  function Gradebook(p) {
    var gb = A.useApi('/api/courses/' + p.courseId + '/gradebook', [p.courseId]);
    if (gb.loading) return h('p', { className: 'muted' }, t('common.loading'));
    if (gb.error) return h(E.Alert, { tone: 'danger' }, gb.error.message);
    var d = gb.data;
    var grade = function (itemId, studentId) {
      A.api.post('/api/courses/' + p.courseId + '/items/' + itemId + '/grade', { studentId: studentId })
        .then(function (r) { A.toast(t('co.quiz.graded', { value: r.grade.value }), 'success'); gb.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    };
    var columns = [
      { key: 'name', title: t('co.gb.student') },
      { key: 'progress', title: t('co.gb.progress'), render: function (r) { return h(E.ProgressBar, { label: r.name + ' — ' + t('co.progress'), value: r.progress.percent, max: 100, valueText: A.fmtPct(r.progress.percent) }); } }
    ].concat(d.quizzes.map(function (q) {
      return { key: 'q_' + q.id, title: q.title, render: function (r) {
        var cell = r.quiz[q.id] || {};
        if (!cell.attempts) return h('span', { className: 'muted' }, t('co.gb.noAttempt'));
        return h('div', { className: 'row', style: { gap: 'var(--space-2)' } },
          h('span', null, A.fmtNum(cell.score, 0) + '/' + cell.maxScore),
          cell.gradeValue ? h(E.Badge, { tone: 'success', icon: 'check' }, cell.gradeValue)
            : h(E.Button, { size: 'sm', onClick: function () { grade(q.id, r.studentId); } }, t('co.quiz.toGrade')));
      } };
    })).concat(d.assignments.map(function (a) {
      return { key: 'a_' + a.id, title: a.title, render: function (r) {
        var cell = r.assignment[a.id] || {};
        return cell.submitted
          ? h(E.Badge, { tone: cell.reviewedAt ? 'success' : 'info', icon: cell.reviewedAt ? 'check-all' : 'check' }, cell.reviewedAt ? t('co.gb.reviewed') : t('co.gb.submitted'))
          : h(E.Badge, { tone: 'danger', icon: 'x' }, t('co.gb.missing'));
      } };
    }));
    return h(Section, { hid: 'h-co-gb', title: t('co.tabs.gradebook') },
      h('div', { className: 'row', style: { gap: 'var(--space-3)' } },
        h(E.StatTile, { label: t('co.gb.enrolled'), value: String(d.students.length) }),
        h(E.StatTile, { label: t('co.gb.avg'), value: A.fmtPct(d.averagePercent) }),
        h(E.StatTile, { label: t('co.gb.completed'), value: String(d.completedCount) })),
      h(E.Table, { caption: t('co.tabs.gradebook') + ' — ' + d.course.title, columns: columns, rows: d.students.map(function (s) { return Object.assign({ id: s.studentId }, s); }) }));
  }

  /* ======================= Dyskusja ======================= */
  function Discussion(p) {
    var st = React.useState({ title: '', body: '', reply: {} }), f = st[0], set = st[1];
    var post = function (threadId, body, cb) {
      if (!body.trim()) return;
      A.api.post('/api/courses/' + p.courseId + '/threads/' + threadId + '/posts', { body: body })
        .then(function () { A.toast(t('co.posted'), 'success'); if (cb) cb(); p.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    };
    var newThread = function () {
      A.api.post('/api/courses/' + p.courseId + '/threads', { title: f.title, body: f.body })
        .then(function () { set({ title: '', body: '', reply: {} }); A.toast(t('co.posted'), 'success'); p.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    };
    var moderate = function (th, patch) { A.api.patch('/api/courses/' + p.courseId + '/threads/' + th.id, patch).then(p.reload).catch(function (e) { A.toast(e.message, 'danger'); }); };
    return h(Section, { hid: 'h-co-disc', title: t('co.discussion') },
      h('div', { className: 'stack', style: { marginTop: 'var(--space-3)' } }, (p.threads || []).map(function (th) {
        return h('div', { key: th.id, className: 'card' },
          h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
            h('h3', { className: 'subheading', style: { margin: 0 } }, th.title),
            h('div', { className: 'row' },
              th.pinned ? h(E.Badge, { tone: 'info', icon: 'bell' }, t('co.pinned')) : null,
              th.locked ? h(E.Badge, { tone: 'outline', icon: 'lock' }, t('co.locked')) : null,
              p.canModerate ? h(E.Button, { size: 'sm', variant: 'quiet', onClick: function () { moderate(th, { pinned: !th.pinned }); } }, th.pinned ? t('co.unpin') : t('co.pin')) : null,
              p.canModerate ? h(E.Button, { size: 'sm', variant: 'quiet', icon: th.locked ? 'lock-open' : 'lock', onClick: function () { moderate(th, { locked: !th.locked }); } }, th.locked ? t('co.unlock') : t('co.lock')) : null)),
          h('div', { className: 'stack', style: { gap: 'var(--space-2)' } }, th.posts.map(function (ps) {
            return h('div', { key: ps.id, style: ps.parentId ? { paddingLeft: 'var(--space-5)' } : null },
              h('p', { className: 'caption muted', style: { margin: 0 } }, ps.author + ' · ' + A.fmtDateTime(ps.at)),
              h('p', { style: { margin: 0 } }, ps.body));
          })),
          th.locked && !p.canModerate ? h('p', { className: 'caption muted' }, t('co.lockedThread'))
            : h('div', { className: 'row', style: { alignItems: 'flex-end' } },
              h(E.TextField, { label: t('co.reply'), width: 360, value: f.reply[th.id] || '', onChange: function (e) { var r = Object.assign({}, f.reply); r[th.id] = e.target.value; set(Object.assign({}, f, { reply: r })); } }),
              h(E.Button, { size: 'sm', onClick: function () { post(th.id, f.reply[th.id] || '', function () { var r = Object.assign({}, f.reply); r[th.id] = ''; set(Object.assign({}, f, { reply: r })); }); } }, t('co.post'))));
      })),
      h('div', { className: 'row', style: { alignItems: 'flex-end', marginTop: 'var(--space-3)' } },
        h(E.TextField, { label: t('co.threadTitle'), width: 280, value: f.title, onChange: function (e) { set(Object.assign({}, f, { title: e.target.value })); } }),
        h(E.TextField, { label: t('co.post'), width: 320, value: f.body, onChange: function (e) { set(Object.assign({}, f, { body: e.target.value })); } }),
        h(E.Button, { icon: 'plus', disabled: !f.title.trim(), onClick: newThread }, t('co.newThread'))));
  }

  /* ======================= UCZEŃ ======================= */
  function QuizRunner(p) {
    var it = p.item;
    var st = React.useState({ answers: {}, result: null, busy: false }), f = st[0], set = st[1];
    var submit = function () {
      set(Object.assign({}, f, { busy: true }));
      A.api.post('/api/courses/' + p.courseId + '/items/' + it.id + '/quiz', { answers: f.answers })
        .then(function (r) { set(Object.assign({}, f, { busy: false, result: r })); p.reload(); })
        .catch(function (e) { set(Object.assign({}, f, { busy: false })); A.toast(e.message, 'danger'); });
    };
    var res = f.result;
    var byQ = {}; if (res) res.results.forEach(function (x) { byQ[x.questionId] = x; });
    return h('div', { className: 'stack' },
      h('p', { className: 'caption muted' }, t('co.quiz.attemptsLeft', { n: res ? res.attemptsLeft : it.attemptsLeft })
        + (it.quiz.timeLimitMin ? ' · ' + t('co.quiz.timeLimit') + ': ' + it.quiz.timeLimitMin : '')),
      it.bestScore != null && !res ? h('p', { className: 'caption muted' }, t('co.quiz.best', { score: A.fmtNum(it.bestScore, 0), max: it.maxScore })) : null,
      it.quiz.questions.map(function (q, i) {
        var r = byQ[q.id];
        return h('div', { key: q.id, className: 'card', style: { padding: 'var(--space-3)' } },
          h(E.RadioGroup, {
            legend: (i + 1) + '. ' + q.text + ' · ' + t('co.quiz.pts', { n: q.points }),
            name: 'q-' + it.id + '-' + q.id, value: f.answers[q.id] || '',
            options: q.options.map(function (o) { return { value: o.id, label: o.text }; }),
            onChange: res ? function () {} : function (v) { var a = Object.assign({}, f.answers); a[q.id] = v; set(Object.assign({}, f, { answers: a })); }
          }),
          r ? h('p', { className: 'caption', 'aria-live': 'polite', style: { margin: 0 } },
            h(E.Badge, { tone: r.correct ? 'success' : 'danger', icon: r.correct ? 'check' : 'x' }, r.correct ? t('co.quiz.ok') : t('co.quiz.bad')),
            ' ', t('co.quiz.correctAnswer', { text: (q.options.filter(function (o) { return o.id === r.correctId; })[0] || {}).text || r.correctId })) : null);
      }),
      res ? h(E.Alert, { tone: 'success', title: t('co.quiz.result', { score: A.fmtNum(res.score, 0), max: res.maxScore, percent: A.fmtPct(res.percent) }) },
        h('p', { style: { margin: 0 } }, res.attemptsLeft ? t('co.quiz.attemptsLeft', { n: res.attemptsLeft }) : t('co.quiz.noAttempts')))
        : h(E.Button, { variant: 'primary', loading: f.busy, disabled: it.attemptsLeft <= 0, onClick: submit }, it.attemptsLeft > 0 ? t('co.quiz.submit') : t('co.quiz.noAttempts')));
  }

  function StudentItem(p) {
    var it = p.item;
    var done = it.status === 'done';
    var markDone = function () {
      A.api.post('/api/courses/' + p.courseId + '/items/' + it.id + '/done', {})
        .then(function () { A.toast(t('co.doneToast'), 'success'); p.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    };
    return h('div', { className: 'card' },
      h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
        h('h4', { className: 'subheading', style: { margin: 0 } },
          h(E.Icon, { name: KIND_ICON[it.kind] || 'file', label: kindLabel(it.kind) }), ' ', it.title),
        h(E.Badge, { tone: done ? 'success' : 'outline', icon: done ? 'check' : 'clock' }, done ? t('co.done') : t('co.new2'))),
      h(Markdown, { text: it.body }),
      it.kind === 'material' && it.material ? h('div', { className: 'row' },
        h(E.Button, { size: 'sm', icon: 'download', href: A.base + it.material.downloadPath, target: '_blank' }, t('co.download')),
        h('span', { className: 'caption muted' }, it.material.name + ' · ' + fileSize(it.material.size))) : null,
      it.kind === 'link' && it.url ? h('div', { className: 'row' }, h(E.Button, { size: 'sm', icon: 'chevron-right', href: it.url, target: '_blank' }, t('co.openLink'))) : null,
      it.kind === 'meeting' && it.meetingId ? h('div', { className: 'row' },
        h(E.Button, { size: 'sm', icon: 'users', href: '#/spotkania?meeting=' + it.meetingId }, t('co.meetingJoin')),
        it.meeting ? h('span', { className: 'caption muted' }, t('co.meetingWhen') + ': ' + A.fmtDate(it.meeting.date) + ', ' + it.meeting.startTime + '–' + it.meeting.endTime) : null) : null,
      it.kind === 'assignment' && it.homework ? h('div', { className: 'stack', style: { gap: 'var(--space-2)' } },
        h('p', { style: { margin: 0 } }, it.homework.text),
        h('p', { className: 'caption muted', style: { margin: 0 } }, t('co.hw.due') + ': ' + A.fmtDate(it.homework.dueAt)),
        h('div', { className: 'row' },
          h(E.Button, { size: 'sm', icon: 'edit', href: '#/uczen' }, t('co.hw.link')),
          it.submission ? h(E.Badge, { tone: 'success', icon: 'check' }, t('co.gb.submitted') + ' · ' + A.fmtDateTime(it.submission.receivedAt)) : h(E.Badge, { tone: 'danger', icon: 'x' }, t('co.gb.missing')))) : null,
      it.kind === 'quiz' ? h(QuizRunner, { courseId: p.courseId, item: it, reload: p.reload }) : null,
      it.kind !== 'quiz' ? h('div', { className: 'row' }, h(E.Button, { size: 'sm', icon: 'check', variant: done ? 'quiet' : 'secondary', disabled: done, onClick: markDone }, done ? t('co.done') : t('co.markDone'))) : null);
  }

  function StudentCourse(p) {
    var d = p.data;
    var st = React.useState(p.initialUnit || null), openUnit = st[0], setOpenUnit = st[1];
    if (!d) return h('p', { className: 'muted' }, t('common.loading'));
    var c = d.course, pr = d.progress;
    var active = openUnit || (d.units.filter(function (u) { return !u.locked; })[0] || {}).id || null;
    return h(F, null,
      h(Section, { hid: 'h-co-course', title: c.title, actions: h(E.Button, { size: 'sm', variant: 'quiet', icon: 'chevron-left', onClick: p.onBack }, t('co.backToList')) },
        h('p', { className: 'caption muted' }, A.subjectName(c.subjectId, c.subjectName) + ' · ' + t('co.teacher') + ': ' + c.teachers.map(function (x) { return x.name; }).join(', ')),
        h('p', null, c.description),
        h(E.ProgressBar, { label: t('co.progress'), value: pr.percent, max: 100, valueText: A.fmtPct(pr.percent), hint: t('co.progressOf', { done: pr.done, total: pr.total }) }),
        pr.complete ? h(E.Alert, { tone: 'success', title: t('co.certificate'), actions: h(E.Button, { size: 'sm', icon: 'print', onClick: function () { A.openPrint(d.certificatePath); } }, t('co.certificate')) }, t('co.certificateHint')) : null),
      h(Section, { hid: 'h-co-units-s', title: t('co.units') },
        h(E.Tabs, {
          label: t('co.units'),
          tabs: d.units.map(function (u) { return { id: u.id, label: u.order + '. ' + u.title, count: u.items.length || undefined }; }),
          value: active, onChange: setOpenUnit
        }, function (id) {
          var u = d.units.filter(function (x) { return x.id === id; })[0] || d.units[0];
          if (!u) return null;
          if (u.locked) return h(E.Alert, { tone: 'info', title: t('co.lockedUntil', { date: A.fmtDate(u.availableFrom) }) }, t('co.lockedInfo', { date: A.fmtDate(u.availableFrom) }));
          return h('div', { className: 'stack', style: { gap: 'var(--space-3)' } },
            u.summary ? h('p', { className: 'muted', style: { margin: 0 } }, u.summary) : null,
            u.items.length ? u.items.map(function (it) { return h(StudentItem, { key: it.id, courseId: c.id, item: it, reload: p.reload }); }) : h('p', { className: 'muted' }, t('co.noItems')));
        })),
      h(Discussion, { courseId: c.id, threads: d.discussion, canModerate: false, reload: p.reload }));
  }

  function StudentList(p) {
    var d = p.data;
    var enrol = function (id) { A.api.post('/api/courses/' + id + '/enrol/self', {}).then(function () { A.toast(t('co.selfEnrolled'), 'success'); p.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); };
    var card = function (c, action) {
      return h('div', { key: c.id, className: 'card', style: cover(c) },
        h('h3', { className: 'subheading', style: { margin: 0 } }, c.title),
        h('p', { className: 'caption muted' }, A.subjectName(c.subjectId, c.subjectName) + ' · ' + c.teachers.map(function (x) { return x.name; }).join(', ')),
        h('p', { style: { marginTop: 0 } }, c.description),
        c.progress ? h(E.ProgressBar, { label: t('co.progress') + ' — ' + c.title, value: c.progress.percent, max: 100, valueText: A.fmtPct(c.progress.percent), hint: t('co.progressOf', { done: c.progress.done, total: c.progress.total }) }) : null,
        h('div', { className: 'row' }, action));
    };
    return h(F, null,
      h(Section, { hid: 'h-co-mine', title: t('co.myCourses') },
        d.courses.length ? h('div', { className: 'grid-2', style: { marginTop: 'var(--space-3)' } }, d.courses.map(function (c) {
          return card(c, h(E.Button, { size: 'sm', onClick: function () { p.onOpen(c.id); } }, t('co.open')));
        })) : h('p', { className: 'muted' }, t('co.noCourses'))),
      d.available && d.available.length ? h(Section, { hid: 'h-co-open', title: t('co.available') },
        h('div', { className: 'grid-2', style: { marginTop: 'var(--space-3)' } }, d.available.map(function (c) {
          return card(c, h(E.Button, { size: 'sm', variant: 'primary', icon: 'plus', onClick: function () { enrol(c.id); } }, t('co.selfEnrol')));
        }))) : null);
  }

  /* ======================= RODZIC ======================= */
  function ParentView() {
    var d = A.useApi('/api/courses/child/progress', []);
    if (d.loading) return h('p', { className: 'muted' }, t('common.loading'));
    if (d.error) return h(E.Alert, { tone: 'danger' }, d.error.message);
    var data = d.data;
    return h(F, null,
      h('h1', { className: 'display app-title' }, t('co.title')),
      h('p', { className: 'app-sub' }, t('co.subParent')),
      h(Section, { hid: 'h-co-child', title: t('co.childProgress') + ' · ' + data.student },
        h('p', { className: 'caption muted' }, t('co.readOnly')),
        data.courses.length ? h('div', { className: 'stack', style: { marginTop: 'var(--space-3)' } }, data.courses.map(function (c) {
          return h('div', { key: c.id, className: 'card', style: cover(c) },
            h('h3', { className: 'subheading', style: { margin: 0 } }, c.title),
            h('p', { className: 'caption muted' }, A.subjectName(c.subjectId, c.subjectName) + ' · ' + c.teachers.map(function (x) { return x.name; }).join(', ')),
            h(E.ProgressBar, { label: t('co.progress') + ' — ' + c.title, value: c.progress.percent, max: 100, valueText: A.fmtPct(c.progress.percent), hint: t('co.progressOf', { done: c.progress.done, total: c.progress.total }) }),
            c.quiz.length ? h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, c.quiz.map(function (q) {
              return h('li', { key: q.itemId }, q.title + ': ' + (q.score == null ? t('co.gb.noAttempt') : A.fmtNum(q.score, 0) + '/' + q.maxScore));
            })) : null);
        })) : h('p', { className: 'muted' }, t('co.noCourses'))));
  }

  /* ======================= EKRAN ======================= */
  function Screen(props) {
    var role = props.user.role;
    var q = props.route.query || {};
    var st = React.useState(q.course || null), courseId = st[0], setCourseId = st[1];
    var st2 = React.useState('editor'), tab = st2[0], setTab = st2[1];
    var list = A.useApi(role === 'parent' ? null : '/api/courses', [role]);
    var one = A.useApi(courseId && role !== 'parent' ? '/api/courses/' + courseId : null, [courseId]);

    if (role === 'parent') return h(ParentView, null);

    var head = h(F, null,
      h('h1', { className: 'display app-title' }, t('co.title')),
      h('p', { className: 'app-sub' }, role === 'student' ? t('co.subStudent') : t('co.subTeacher')));

    if (list.loading) return h(F, null, head, h('p', { className: 'muted' }, t('common.loading')));
    if (list.error) return h(F, null, head, h(E.Alert, { tone: 'danger' }, list.error.message));

    if (role === 'student') {
      if (!courseId) return h(F, null, head, h(StudentList, { data: list.data, reload: list.reload, onOpen: setCourseId }));
      if (one.error) return h(F, null, head, h(E.Alert, { tone: 'danger' }, one.error.message), h(E.Button, { onClick: function () { setCourseId(null); } }, t('co.backToList')));
      return h(F, null, head, h(StudentCourse, { data: one.data, initialUnit: q.unit || null, reload: function () { one.reload(); list.reload(); }, onBack: function () { setCourseId(null); } }));
    }

    if (!courseId) return h(F, null, head, h(CourseList, { data: list.data, reload: list.reload, onOpen: setCourseId }));
    if (one.error) return h(F, null, head, h(E.Alert, { tone: 'danger' }, one.error.message), h(E.Button, { onClick: function () { setCourseId(null); } }, t('co.backToList')));
    return h(F, null, head,
      h(E.Tabs, { label: t('co.title'), tabs: [{ id: 'editor', label: t('co.tabs.editor') }, { id: 'gradebook', label: t('co.tabs.gradebook') }], value: tab, onChange: setTab },
        function (id) {
          return id === 'gradebook'
            ? h(Gradebook, { courseId: courseId })
            : h(CourseEditor, { data: one.data, canEdit: !!(one.data && one.data.canEdit), reload: function () { one.reload(); list.reload(); }, onBack: function () { setCourseId(null); } });
        }));
  }

  A.screen({
    id: 'courses', path: '/kursy', title: 'Kursy', roles: ['staff', 'student', 'parent'], module: 'courses',
    nav: { key: 'nav.courses', label: 'Kursy', order: 70 }, component: Screen
  });
})();
