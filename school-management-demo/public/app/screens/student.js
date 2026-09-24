/* Ekran ucznia (3.6): pulpit na dziś, oceny, cel, zadania domowe, materiały, wiadomości, biblioteka i moje prawa.
   Port ../design-system/components/StudentDashboard/preview.html podłączony do /api/student/*. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'st.title': 'Dziennik ucznia', 'st.loading': 'Wczytywanie danych…', 'st.hello': 'Dzień dobry, {name}',
      'st.sub': '{date} · {school} · klasa {class} · dostęp do planu i ocen jest bezpłatny',
      'st.tile.lessons': 'Lekcje dzisiaj', 'st.tile.noChanges': 'plan bez zmian',
      'st.tile.changes.one': '{n} zmiana w planie', 'st.tile.changes.few': '{n} zmiany w planie', 'st.tile.changes.many': '{n} zmian w planie',
      'st.tile.tomorrow': 'Na jutro', 'st.tile.tomorrowHint': 'zadania domowe',
      'st.tile.tests': 'Sprawdziany', 'st.tile.testsHint': 'zapowiedziane na 30 dni',
      'st.tile.unread': 'Nieprzeczytane', 'st.tile.unreadHint': 'wiadomości w dzienniku',
      'st.wd.1': 'poniedziałek', 'st.wd.2': 'wtorek', 'st.wd.3': 'środa', 'st.wd.4': 'czwartek', 'st.wd.5': 'piątek', 'st.wd.6': 'sobota', 'st.wd.7': 'niedziela',
      'st.today': 'Dzisiaj · {date}', 'st.planChanges': 'Zmiany w planie', 'st.myAttendance': 'Moja frekwencja',
      'st.attNote': 'Frekwencja pochodzi z wpisów nauczycieli. Jeśli wpis jest błędny, napisz do wychowawcy przez dziennik.',
      'st.state.cancel': 'Lekcja odwołana', 'st.state.room': 'Zmiana sali', 'st.state.sub': 'Zastępstwo', 'st.state.now': 'Trwa teraz',
      'st.tomorrow': 'Na jutro', 'st.tomorrowCaption': 'Zadania na {date}', 'st.task': 'Zadanie',
      'st.sent': 'Wysłane', 'st.dueTomorrow': 'Na jutro', 'st.noHomework': 'Na jutro nie ma zadań domowych.',
      'st.tests': 'Nadchodzące sprawdziany', 'st.loadingCal': 'Wczytywanie kalendarza…', 'st.noAnnounced': 'brak zapowiedzi',
      'st.ruleViolation': 'Zapowiedź niezgodna z zasadą {n} dni',
      'st.grades': 'Moje oceny', 'st.loadingGrades': 'Wczytywanie ocen…', 'st.noGrades': 'Brak ocen w tym semestrze.',
      'st.gradesBySubject': 'Oceny według przedmiotu', 'st.weightedAvg': 'Średnia ważona', 'st.weightLabel': 'waga {n}',
      'st.comments': 'Komentarze nauczyciela',
      'st.commentLine': '{date} · {v}: {text}',
      'st.noComments': 'Do żadnej z tych ocen nauczyciel nie dopisał komentarza.',
      'st.fileTooBig': 'Plik „{name}” ma {size} i przekracza limit {mb} MB ustawiony przez nauczyciela. Zrób mniejsze zdjęcie albo wyślij samą treść.',
      'st.fileRejected': 'Załącznik odrzucony',
      'st.accessFail': 'Nie udało się zapisać zmiany dostępu rodzica.',
      'st.npBz': 'np i bz są poza średnią', 'st.printGrades': 'Wykaz ocen do wydruku', 'st.overallAvg': 'Średnia ze wszystkich przedmiotów: {v}',
      'st.goal': 'Cel na koniec semestru', 'st.target.3': '3 – dostateczny', 'st.target.4': '4 – dobry', 'st.target.5': '5 – bardzo dobry', 'st.target.6': '6 – celujący',
      'st.avgNow': 'Średnia ważona teraz',
      'st.counted.one': '{n} ocena liczona do średniej', 'st.counted.few': '{n} oceny liczone do średniej', 'st.counted.many': '{n} ocen liczonych do średniej',
      'st.progressTo': 'Postęp do celu {target}', 'st.outOf': '{v} z 6', 'st.markHint': 'Znacznik na pasku pokazuje próg wybranego celu ({v}).',
      'st.nextTests': 'Najbliższe zapowiedzi: {list}.', 'st.noTestsSim': 'Brak zapowiedzianych sprawdzianów — symulacja zakłada jedną ocenę o wadze {w}.',
      'st.simulating': 'Liczę symulację…',
      'st.sendHw': 'Wyślij zadanie domowe', 'st.allSubmitted': 'Wszystkie zadania z najbliższych dni są już oddane.',
      'st.homework': 'Zadanie', 'st.hwOption': '{subject} · {text} (do {date})',
      'st.hwReceived': 'Praca przyjęta.', 'st.hwSent': 'Zadanie wysłane.',
      'st.hwMeta': '{subject} · termin {date}, godz. {time} · limit załącznika {mb} MB',
      'st.solution': 'Rozwiązanie (tekst)', 'st.solutionHint': 'Możesz wpisać rozwiązanie tutaj albo dołączyć zdjęcie zeszytu.',
      'st.solutionPh': 'np. zadanie 4: x = 3, zadanie 5: x = −2', 'st.fileLabel': 'Zdjęcie lub plik',
      'st.hwReceivedTitle': 'Zadanie odebrane', 'st.hwReceiptHint': 'Potwierdzenie odbioru pojawi się tutaj razem z czasem serwera.',
      'st.hwSubmittedLine': 'Oddane: {subject} — {at} (czas serwera).',
      'st.materials': 'Materiały z lekcji', 'st.matCaption': 'Materiały udostępnione przez nauczycieli · historia lekcji',
      'st.material': 'Materiał', 'st.lesson': 'Lekcja', 'st.downloadCol': 'Pobieranie', 'st.downloadAria': 'Pobierz: {name}',
      'st.downloaded': 'Pobrano: {name} ({size}) · {subject}', 'st.noMaterials': 'Nauczyciele nie dodali jeszcze materiałów.',
      'st.emptyInbox': 'Skrzynka jest pusta.', 'st.writeTeacher': 'Napisz do nauczyciela',
      'st.msgNote': 'Rozmowa zostaje w dzienniku — nie udostępniamy numerów telefonów ani adresów e-mail.',
      'st.library': 'Biblioteka', 'st.overdue': 'Termin zwrotu minął', 'st.dueSoon': 'Termin zwrotu przed końcem semestru',
      'st.appearance': 'Wygląd', 'st.darkMode': 'Tryb ciemny', 'st.off': 'wył.', 'st.on': 'wł.',
      'st.darkOn': 'Tryb ciemny włączony — wieczorne sprawdzanie zadań mniej męczy wzrok.',
      'st.lightOn': 'Tryb jasny. Wybór zapisujemy na tym urządzeniu i na koncie.',
      'st.shortcutsNote': 'Pełną listę otwiera klawisz „?”. Nawigacja działa bez myszy.',
      'st.rights': 'Moje prawa (uczeń pełnoletni)', 'st.adultBadge': 'Konto pełnoletniego ucznia',
      'st.adultNote': 'Możesz sam(a) składać usprawiedliwienia — formularz jest w sekcji „Usprawiedliwienia”.',
      'st.parentBlocked': 'Dostęp opiekunów wyłączony', 'st.parentRestored': 'Dostęp opiekunów przywrócony.',
      'st.restoreAccess': 'Przywróć dostęp', 'st.blockAccess': 'Wyłącz dostęp rodzica do moich danych',
      'st.blockTitle': 'Wyłączyć dostęp opiekunów do Twoich danych?', 'st.leaveUnchanged': 'Zostaw bez zmian', 'st.blockConfirm': 'Wyłącz dostęp',
      'st.blockP1': 'Konta opiekunów stracą wgląd w Twoje oceny, frekwencję i uwagi natychmiast po zatwierdzeniu. Sprzeciw zapisujemy w rejestrze z datą i godziną.',
      'st.blockP2': 'Decyzję możesz odwołać w każdej chwili w tym samym miejscu. Szkoła nadal kontaktuje się z opiekunami w sprawach bezpieczeństwa.',
      'st.excuses': 'Usprawiedliwienia', 'st.excNotAllowed': 'Statut szkoły nie przewiduje samodzielnego usprawiedliwiania nieobecności.',
      'st.from': 'Od', 'st.to': 'Do', 'st.reasonPh': 'np. wizyta u lekarza', 'st.submitExcuse': 'Złóż usprawiedliwienie',
      'st.myExcuses': 'Moje usprawiedliwienia', 'st.exc.approved': 'Przyjęte', 'st.exc.rejected': 'Odrzucone', 'st.exc.pending': 'Oczekuje'
    },
    en: {
      'st.title': 'Student logbook', 'st.loading': 'Loading data…', 'st.hello': 'Good morning, {name}',
      'st.sub': '{date} · {school} · class {class} · access to the timetable and grades is free',
      'st.tile.lessons': 'Lessons today', 'st.tile.noChanges': 'no changes to the plan',
      'st.tile.changes.one': '{n} change to the plan', 'st.tile.changes.other': '{n} changes to the plan',
      'st.tile.tomorrow': 'For tomorrow', 'st.tile.tomorrowHint': 'homework tasks',
      'st.tile.tests': 'Tests', 'st.tile.testsHint': 'announced for the next 30 days',
      'st.tile.unread': 'Unread', 'st.tile.unreadHint': 'messages in the logbook',
      'st.wd.1': 'Monday', 'st.wd.2': 'Tuesday', 'st.wd.3': 'Wednesday', 'st.wd.4': 'Thursday', 'st.wd.5': 'Friday', 'st.wd.6': 'Saturday', 'st.wd.7': 'Sunday',
      'st.today': 'Today · {date}', 'st.planChanges': 'Timetable changes', 'st.myAttendance': 'My attendance',
      'st.attNote': 'Attendance comes from teachers’ entries. If an entry is wrong, message your homeroom teacher through the logbook.',
      'st.state.cancel': 'Lesson cancelled', 'st.state.room': 'Room change', 'st.state.sub': 'Substitution', 'st.state.now': 'In progress',
      'st.tomorrow': 'For tomorrow', 'st.tomorrowCaption': 'Tasks due {date}', 'st.task': 'Task',
      'st.sent': 'Sent', 'st.dueTomorrow': 'Due tomorrow', 'st.noHomework': 'No homework is due tomorrow.',
      'st.tests': 'Upcoming tests', 'st.loadingCal': 'Loading the calendar…', 'st.noAnnounced': 'nothing announced',
      'st.ruleViolation': 'Announcement breaks the {n}-day rule',
      'st.grades': 'My grades', 'st.loadingGrades': 'Loading grades…', 'st.noGrades': 'No grades this semester.',
      'st.gradesBySubject': 'Grades by subject', 'st.weightedAvg': 'Weighted average', 'st.weightLabel': 'weight {n}',
      'st.comments': 'Teacher comments',
      'st.commentLine': '{date} · {v}: {text}',
      'st.noComments': 'The teacher did not add a comment to any of these grades.',
      'st.fileTooBig': 'The file "{name}" is {size} and exceeds the {mb} MB limit set by the teacher. Take a smaller photo, or send the text only.',
      'st.fileRejected': 'Attachment rejected',
      'st.accessFail': 'The change to the parent\u2019s access could not be saved.',
      'st.npBz': 'np and bz stay out of the average', 'st.printGrades': 'Grade list for printing', 'st.overallAvg': 'Average across all subjects: {v}',
      'st.goal': 'Goal for the end of the semester', 'st.target.3': '3 – satisfactory', 'st.target.4': '4 – good', 'st.target.5': '5 – very good', 'st.target.6': '6 – excellent',
      'st.avgNow': 'Weighted average now',
      'st.counted.one': '{n} grade counted in the average', 'st.counted.other': '{n} grades counted in the average',
      'st.progressTo': 'Progress towards goal {target}', 'st.outOf': '{v} of 6', 'st.markHint': 'The mark on the bar shows the threshold of the chosen goal ({v}).',
      'st.nextTests': 'Next announced tests: {list}.', 'st.noTestsSim': 'No tests announced — the simulation assumes one grade with weight {w}.',
      'st.simulating': 'Running the simulation…',
      'st.sendHw': 'Send homework', 'st.allSubmitted': 'Everything due in the coming days has been handed in.',
      'st.homework': 'Task', 'st.hwOption': '{subject} · {text} (due {date})',
      'st.hwReceived': 'Work received.', 'st.hwSent': 'Homework sent.',
      'st.hwMeta': '{subject} · due {date} at {time} · attachment limit {mb} MB',
      'st.solution': 'Answer (text)', 'st.solutionHint': 'You can type the answer here or attach a photo of your notebook.',
      'st.solutionPh': 'e.g. task 4: x = 3, task 5: x = −2', 'st.fileLabel': 'Photo or file',
      'st.hwReceivedTitle': 'Homework received', 'st.hwReceiptHint': 'The receipt will appear here together with the server time.',
      'st.hwSubmittedLine': 'Handed in: {subject} — {at} (server time).',
      'st.materials': 'Lesson materials', 'st.matCaption': 'Materials shared by teachers · lesson history',
      'st.material': 'Material', 'st.lesson': 'Lesson', 'st.downloadCol': 'Download', 'st.downloadAria': 'Download: {name}',
      'st.downloaded': 'Downloaded: {name} ({size}) · {subject}', 'st.noMaterials': 'Teachers have not added any materials yet.',
      'st.emptyInbox': 'The inbox is empty.', 'st.writeTeacher': 'Message a teacher',
      'st.msgNote': 'The conversation stays in the logbook — we never share phone numbers or e-mail addresses.',
      'st.library': 'Library', 'st.overdue': 'Return date has passed', 'st.dueSoon': 'Return date before the end of the semester',
      'st.appearance': 'Appearance', 'st.darkMode': 'Dark mode', 'st.off': 'off', 'st.on': 'on',
      'st.darkOn': 'Dark mode on — checking homework in the evening is easier on the eyes.',
      'st.lightOn': 'Light mode. We save the choice on this device and in your account.',
      'st.shortcutsNote': 'The “?” key opens the full list. Navigation works without a mouse.',
      'st.rights': 'My rights (adult student)', 'st.adultBadge': 'Adult student account',
      'st.adultNote': 'You can file your own excuses — the form is in the “Excuses” section.',
      'st.parentBlocked': 'Guardian access switched off', 'st.parentRestored': 'Guardian access restored.',
      'st.restoreAccess': 'Restore access', 'st.blockAccess': 'Switch off parent access to my data',
      'st.blockTitle': 'Switch off guardian access to your data?', 'st.leaveUnchanged': 'Leave unchanged', 'st.blockConfirm': 'Switch off access',
      'st.blockP1': 'Guardian accounts lose access to your grades, attendance and remarks immediately after you confirm. The objection is recorded with date and time.',
      'st.blockP2': 'You can reverse the decision at any time in the same place. The school still contacts guardians on safety matters.',
      'st.excuses': 'Excuses', 'st.excNotAllowed': 'The school statute does not allow students to excuse their own absences.',
      'st.from': 'From', 'st.to': 'To', 'st.reasonPh': 'e.g. doctor’s appointment', 'st.submitExcuse': 'File an excuse',
      'st.myExcuses': 'My excuses', 'st.exc.approved': 'Accepted', 'st.exc.rejected': 'Rejected', 'st.exc.pending': 'Pending'
    }
  });

  /* Zapisywane w rejestrze sprzeciwu — zostaje po polsku niezależnie od języka interfejsu. */
  var OBJECTION_REASON = 'Sprzeciw ucznia pełnoletniego';

  /* Serwer oddaje każdy skrót dwujęzycznie ({ keys, pl, en }) — bierzemy pole bieżącego języka. */
  function scWhat(r) { return (A.state.locale === 'en' ? r.en : r.pl) || r.text || r.what || ''; }

  function targets() { return ['3', '4', '5', '6'].map(function (v) { return { value: v, label: A.t('st.target.' + v) }; }); }
  function stateNote(state) { return ['cancel', 'room', 'sub', 'now'].indexOf(state) >= 0 ? A.t('st.state.' + state) : ''; }
  function dayLabel(iso) { if (!iso) return ''; var d = new Date(iso + 'T00:00:00Z'); var wd = d.getUTCDay() || 7; return A.t('st.wd.' + wd) + ', ' + A.fmtDate(iso); }

  function Section(p) {
    return h('section', { className: 'card', 'aria-labelledby': p.hid },
      h('h2', { className: 'heading', id: p.hid }, p.title),
      p.children);
  }
  function addDay(iso) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  /* Native date inputs follow the BROWSER locale, so repeat the chosen day in the interface locale. */
  function fileSize(n) { return n > 1048576 ? A.fmtNum(n / 1048576, 1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' kB'; }

  function Today(p) {
    var d = p.data;
    return h(Section, { hid: 'h-dzisiaj', title: A.t('st.today', { date: dayLabel(d.today) }) },
      d.changes.length ? h(E.Alert, { tone: 'info', title: A.t('st.planChanges') },
        h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, d.changes.map(function (c, i) { return h('li', { key: i }, c.text); }))) : null,
      h('div', { className: 'stack', style: { gap: 'var(--space-3)', marginTop: 'var(--space-3)' } }, d.lessons.map(function (l) {
        return h('div', { key: l.id, className: 'stack', style: { gap: 'var(--space-1)' } },
          h(E.LessonCard, {
            no: l.lessonNo, start: l.start, end: l.end, subject: A.subjectName(l.subjectId, l.subject), group: l.group || d.student.className,
            room: l.roomChangedFrom || l.room, newRoom: l.roomChangedFrom ? l.room : undefined,
            state: l.state === 'normal' ? 'normal' : l.state, teacher: l.teacher ? l.teacher.name : '', note: l.note || undefined
          }),
          h('div', { className: 'row', style: { gap: 'var(--space-2)' } },
            h('span', { className: 'label', style: { color: 'var(--ink-muted)' } }, A.t('st.myAttendance')),
            h(E.AttendanceChip, { status: l.attendance.status === 'none' ? 'none' : l.attendance.status, minutes: l.attendance.minutes || undefined, word: true }),
            stateNote(l.state) ? h('span', { className: 'caption muted' }, stateNote(l.state)) : null));
      })),
      h('p', { className: 'caption muted' }, A.t('st.attNote')));
  }

  function Tomorrow(p) {
    var rows = p.data.homeworkTomorrow.map(function (t) {
      return { id: t.id, subject: A.subjectName(t.subjectId, t.subject), task: t.text, state: t.submitted ? 'sent' : 'today', at: t.submission ? A.fmtDateTime(t.submission.receivedAt) : null };
    });
    return h(Section, { hid: 'h-jutro', title: A.t('st.tomorrow') },
      rows.length ? h(E.Table, {
        caption: A.t('st.tomorrowCaption', { date: A.fmtDate(addDay(p.data.today)) }),
        hideCaption: true,
        columns: [
          { key: 'subject', title: A.t('common.subject') },
          { key: 'task', title: A.t('st.task') },
          { key: 'state', title: A.t('common.status'), render: function (r) {
            return h(F, null, h(E.Badge, { tone: r.state === 'sent' ? 'success' : 'danger', icon: r.state === 'sent' ? 'check' : 'clock' }, r.state === 'sent' ? A.t('st.sent') : A.t('st.dueTomorrow')),
              r.at ? h('div', { className: 'caption muted' }, r.at) : null);
          } }],
        rows: rows
      }) : h('p', { className: 'muted' }, A.t('st.noHomework')));
  }

  function TestsCalendar(p) {
    var st = React.useState(''), line = st[0], setLine = st[1];
    var cal = p.cal;
    if (!cal) return h(Section, { hid: 'h-spr', title: A.t('st.tests') }, h('p', { className: 'muted' }, A.t('st.loadingCal')));
    return h(Section, { hid: 'h-spr', title: A.t('st.tests') },
      h(E.Calendar, {
        month: cal.monthLabel, monthName: cal.monthName, testLimit: cal.testLimit, days: cal.days,
        onDay: function (day) {
          /* Serwer podaje gotową siatkę (dni z sąsiednich miesięcy też) — bierzemy jego etykietę dnia. */
          setLine((day.label || (day.d + ' ' + cal.monthName)) + (day.events && day.events.length
            ? ': ' + day.events.map(function (e) { return e.text + (e.scope ? ' — ' + e.scope : ''); }).join('; ')
            : ': ' + A.t('st.noAnnounced')));
        }
      }),
      h('p', { className: 'caption muted', 'aria-live': 'polite' }, line || cal.note),
      cal.violations.length ? h(E.Alert, { tone: 'warning', title: A.t('st.ruleViolation', { n: cal.noticeRule }) },
        h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, cal.violations.map(function (t) {
          return h('li', { key: t.id }, A.subjectName(t.subjectId, t.subject) + ' · ' + A.fmtDate(t.date) + ' — ' + t.noticeNote);
        }))) : null);
  }

  function Grades(p) {
    var g = p.grades; var st = React.useState(null), tab = st[0], setTab = st[1];
    if (!g) return h(Section, { hid: 'h-oceny', title: A.t('st.grades') }, h('p', { className: 'muted' }, A.t('st.loadingGrades')));
    var subjects = g.subjects.filter(function (s) { return s.grades.length; });
    if (!subjects.length) return h(Section, { hid: 'h-oceny', title: A.t('st.grades') }, h('p', { className: 'muted' }, A.t('st.noGrades')));
    var active = tab || subjects[0].subjectId;
    return h(Section, { hid: 'h-oceny', title: A.t('st.grades') },
      h(E.Tabs, { tabs: subjects.map(function (s) { return { id: s.subjectId, label: A.subjectName(s.subjectId, s.subject), count: s.grades.length }; }), value: active, onChange: setTab, label: A.t('st.gradesBySubject') },
        function (id) {
          var s = subjects.filter(function (x) { return x.subjectId === id; })[0] || subjects[0];
          var cats = [];
          s.grades.forEach(function (x) { if (!cats.some(function (c) { return c.categoryName === x.categoryName && c.weight === x.weight; })) cats.push(x); });
          return h('div', { className: 'stack', style: { gap: 'var(--space-3)' } },
            h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
              h('div', { className: 'row', style: { gap: 'var(--space-3)', alignItems: 'flex-end' } }, s.grades.map(function (x) {
                var props = { key: x.id, category: x.category, categoryName: x.categoryName, weight: x.weight, showWeight: true, date: A.fmtDate(x.date), comment: !!x.comment, student: g.student.lastName + ' ' + g.student.firstName };
                if (x.value === 'np' || x.value === 'bz') props.special = x.value; else props.value = x.value;
                return h(E.GradeCell, props);
              })),
              h(E.StatTile, { label: A.t('st.weightedAvg'), value: A.fmtNum(s.average), hint: A.subjectName(s.subjectId, s.subject) + (s.teachers.length ? ' · ' + s.teachers[0].name : '') })),
            h('div', { className: 'ed-legend' }, cats.map(function (x, i) {
              return h('span', { key: i }, h('i', { style: { background: 'var(--cat-' + (x.category || 1) + ')' } }), x.categoryName + ' · ' + A.t('st.weightLabel', { n: x.weight }));
            }).concat([h('span', { key: 'np' }, A.t('st.npBz'))])),
            /* The cell only carries a "has a comment" dot; the text itself has to be readable somewhere. */
            (function () {
              var withComment = s.grades.filter(function (x) { return x.comment; });
              return h('div', { className: 'stack', style: { gap: 'var(--space-1)' } },
                h('h3', { className: 'subheading', style: { margin: 0 } }, A.t('st.comments')),
                withComment.length
                  ? withComment.map(function (x, i) { return h('p', { key: x.id || i, className: 'caption', style: { margin: 0 } }, A.t('st.commentLine', { date: A.fmtDate(x.date), v: x.value, text: x.comment })); })
                  : h('p', { className: 'caption muted', style: { margin: 0 } }, A.t('st.noComments')));
            })());
        }),
      h('p', { className: 'caption muted' }, g.note),
      h('div', { className: 'row' },
        h(E.Button, { size: 'sm', icon: 'print', onClick: function () { A.openPrint('/api/student/grades/print'); } }, A.t('st.printGrades')),
        h('span', { className: 'caption muted' }, A.t('st.overallAvg', { v: A.fmtNum(g.overallAverage) }))));
  }

  function Goal(p) {
    var st = React.useState('5'), target = st[0], setTarget = st[1];
    var s2 = React.useState(''), subject = s2[0], setSubject = s2[1];
    var s3 = React.useState(null), sim = s3[0], setSim = s3[1];
    var subjects = (p.grades && p.grades.subjects.filter(function (x) { return x.grades.length; })) || [];
    var subjectId = subject || (subjects[0] && subjects[0].subjectId) || 'mat';
    React.useEffect(function () {
      if (!subjects.length) return;
      A.api.post('/api/student/goal/simulate', { subjectId: subjectId, target: +target }).then(setSim).catch(function () { setSim(null); });
    }, [subjectId, target, subjects.length]);
    return h(Section, { hid: 'h-cel', title: A.t('st.goal') },
      h('div', { className: 'row' },
        h(E.Select, { label: A.t('common.subject'), value: subjectId, width: 220, options: subjects.map(function (x) { return { value: x.subjectId, label: A.subjectName(x.subjectId, x.subject) }; }), onChange: function (e) { setSubject(e.target.value); } }),
        h(E.Select, { label: A.t('st.goal'), value: target, width: 220, options: targets(), onChange: function (e) { setTarget(e.target.value); } }),
        sim ? h(E.StatTile, { label: A.t('st.avgNow'), value: A.fmtNum(sim.current.average), hint: A.plural(sim.current.count, 'st.counted') }) : null),
      sim ? h(F, null,
        h(E.ProgressBar, {
          label: A.t('st.progressTo', { target: sim.target }), value: sim.current.average || 0, max: 6, mark: sim.threshold,
          valueText: A.t('st.outOf', { v: A.fmtNum(sim.current.average) }), tone: sim.reachable ? undefined : 'warning',
          hint: A.t('st.markHint', { v: A.fmtNum(sim.threshold) })
        }),
        h('p', { 'aria-live': 'polite', style: { margin: 0 } }, sim.advice),
        sim.upcomingTests && sim.upcomingTests.length
          ? h('p', { className: 'caption muted' }, A.t('st.nextTests', { list: sim.upcomingTests.map(function (t) { return A.fmtDate(t.date); }).join(', ') }))
          : h('p', { className: 'caption muted' }, A.t('st.noTestsSim', { w: sim.planned.weight }))) : h('p', { className: 'muted' }, A.t('st.simulating')));
  }

  function Homework(p) {
    var list = p.data.homeworkUpcoming.filter(function (x) { return !x.submitted; });
    var st = React.useState(''), text = st[0], setText = st[1];
    var s2 = React.useState([]), files = s2[0], setFiles = s2[1];
    var s3 = React.useState(null), receipt = s3[0], setReceipt = s3[1];
    var s4 = React.useState(list.length ? list[0].id : ''), pick = s4[0], setPick = s4[1];
    var s5 = React.useState([]), rejected = s5[0], setRejected = s5[1];
    var hw = list.filter(function (x) { return x.id === pick; })[0] || list[0];
    function onFiles(e) {
      var chosen = Array.prototype.slice.call(e.target.files || []);
      var limit = (hw && hw.maxAttachmentMB) || 10;
      /* A phone photo is easily over the limit; rejecting it here beats a 413 in a toast that has gone by the
         time the pupil looks up, with the oversized file still sitting in the list. */
      var tooBig = chosen.filter(function (f) { return f.size > limit * 1048576; });
      var ok = chosen.filter(function (f) { return f.size <= limit * 1048576; });
      setRejected(tooBig.map(function (f) { return A.t('st.fileTooBig', { name: f.name, size: fileSize(f.size), mb: limit }); }));
      e.target.value = '';
      if (!ok.length) return;
      Promise.all(ok.map(function (f) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res({ name: f.name, size: f.size, type: f.type, dataUrl: fr.result }); }; fr.readAsDataURL(f); });
      })).then(function (out) { setFiles(files.concat(out)); });
    }
    function send() {
      if (!hw) return;
      A.api.post(hw.submitPath, { text: text, files: files }).then(function (r) {
        setReceipt(r.receipt || A.t('st.hwReceived')); setText(''); setFiles([]); setRejected([]); A.toast(A.t('st.hwSent'), 'success'); p.reload();
      }).catch(function (err) { setRejected([err.message]); A.toast(err.message, 'danger'); });
    }
    return h(Section, { hid: 'h-zad', title: A.t('st.sendHw') },
      !hw ? h('p', { className: 'muted' }, A.t('st.allSubmitted')) : h(F, null,
        h(E.Select, {
          label: A.t('st.homework'), value: hw.id, width: '100%', onChange: function (e) { setPick(e.target.value); },
          options: list.map(function (x) { return { value: x.id, label: A.t('st.hwOption', { subject: A.subjectName(x.subjectId, x.subject), text: x.text.slice(0, 60), date: A.fmtDate(x.dueDate) }) }; })
        }),
        h('p', { className: 'muted' }, A.t('st.hwMeta', { subject: A.subjectName(hw.subjectId, hw.subject), date: A.fmtDate(hw.dueDate), time: hw.dueTime, mb: hw.maxAttachmentMB })),
        h(E.TextField, { label: A.t('st.solution'), multiline: 3, value: text, width: '100%', hint: A.t('st.solutionHint'), placeholder: A.t('st.solutionPh'), onChange: function (e) { setText(e.target.value); } }),
        h('div', { className: 'row' },
          h('label', { className: 'label', htmlFor: 'hw-files' }, A.t('st.fileLabel')),
          h('input', { id: 'hw-files', type: 'file', multiple: true, accept: 'image/*,.pdf,.txt,.odt,.docx', onChange: onFiles }),
          h(E.Button, { variant: 'primary', icon: 'check', disabled: !text.trim() && !files.length, onClick: send }, A.t('common.send'))),
        rejected.length ? h(E.Alert, { tone: 'danger', title: A.t('st.fileRejected'), onClose: function () { setRejected([]); } },
          h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, rejected.map(function (x, i) { return h('li', { key: i }, x); }))) : null,
        files.length ? h('div', { className: 'row' }, files.map(function (f, i) {
          return h(E.Badge, { key: i, tone: 'outline', icon: 'file' }, f.name + ' · ' + fileSize(f.size));
        })) : null,
        h('div', { 'aria-live': 'polite' }, receipt
          ? h(E.Alert, { tone: 'success', title: A.t('st.hwReceivedTitle') }, receipt)
          : h('p', { className: 'caption muted' }, A.t('st.hwReceiptHint')))),
      p.data.homeworkUpcoming.filter(function (x) { return x.submitted; }).map(function (x) {
        return h('p', { key: x.id, className: 'caption muted' }, A.t('st.hwSubmittedLine', { subject: A.subjectName(x.subjectId, x.subject), at: A.fmtDateTime(x.submission.receivedAt) }));
      }));
  }

  function Materials(p) {
    var st = React.useState(''), line = st[0], setLine = st[1];
    var list = (p.materials && p.materials.materials) || [];
    function download(m) {
      A.api.get('/api/materials/' + m.id).then(function (f) {
        var a = document.createElement('a'); a.href = f.dataUrl; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
        setLine(A.t('st.downloaded', { name: f.name, size: fileSize(f.size), subject: A.subjectName(m.subjectId, m.subject) }));
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    return h(Section, { hid: 'h-mat', title: A.t('st.materials') },
      list.length ? h(E.Table, {
        caption: A.t('st.matCaption'), hideCaption: true,
        columns: [
          { key: 'name', title: A.t('st.material'), render: function (r) { return h(F, null, r.name, h('div', { className: 'caption muted' }, A.subjectName(r.subjectId, r.subject) + ' · ' + fileSize(r.size))); } },
          { key: 'lesson', title: A.t('st.lesson'), render: function (r) { return r.lesson ? r.lesson.label : '—'; } },
          { key: 'a', title: A.t('st.downloadCol'), render: function (r) { return h(E.Button, { size: 'sm', icon: 'download', 'aria-label': A.t('st.downloadAria', { name: r.name }), onClick: function () { download(r); } }, A.t('common.download')); } }],
        rows: list
      }) : h('p', { className: 'muted' }, A.t('st.noMaterials')),
      h('p', { className: 'caption muted', 'aria-live': 'polite' }, line || (p.materials ? p.materials.note : '')));
  }

  function Messages(p) {
    var list = (p.messages && p.messages.messages) || [];
    return h(Section, { hid: 'h-msg', title: A.t('common.messages') },
      list.length ? h('div', { style: { border: 'var(--border) solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' } }, list.slice(0, 4).map(function (m) {
        return h(E.MessageItem, {
          key: m.id, from: m.from.name, role: m.from.context || m.from.roleLabel, kind: 'staff', subject: m.subject,
          preview: m.preview, time: A.fmtDate(m.at), unread: m.unread, confidential: m.confidential, href: '#/wiadomosci?id=' + m.id
        });
      })) : h('p', { className: 'muted' }, A.t('st.emptyInbox')),
      h('div', { className: 'row' },
        h(E.Button, { icon: 'bell', onClick: function () { A.navigate('/wiadomosci'); } }, A.t('st.writeTeacher')),
        h('span', { className: 'caption muted' }, A.t('st.msgNote'))));
  }

  function Library(p) {
    var notices = p.data.library || [];
    if (!notices.length) return null;
    return h(Section, { hid: 'h-bib', title: A.t('st.library') }, notices.map(function (n, i) {
      return h(E.Alert, { key: i, tone: n.overdue ? 'danger' : 'warning', title: n.overdue ? A.t('st.overdue') : A.t('st.dueSoon') }, n.text);
    }));
  }

  function Rights(p) {
    var d = p.data; var st = React.useState(false), ask = st[0], setAsk = st[1];
    var theme = document.documentElement.dataset.theme;
    var s2 = React.useState(d.student.parentAccessBlocked), blocked = s2[0], setBlocked = s2[1];
    function setTheme(dark) {
      var next = dark ? 'dark' : 'light'; A.setTheme(next);
      A.api.patch('/api/me/preferences', { theme: next }).catch(function () {});
    }
    return h('div', { className: 'grid-2' },
      h(Section, { hid: 'c-wyglad', title: A.t('st.appearance') },
        h(E.Switch, { label: A.t('st.darkMode'), checked: theme === 'dark', states: [A.t('st.off'), A.t('st.on')], onChange: setTheme }),
        h('p', { className: 'caption muted', 'aria-live': 'polite' }, theme === 'dark' ? A.t('st.darkOn') : A.t('st.lightOn')),
        h(E.Button, { size: 'sm', icon: 'keyboard', onClick: function () { A.navigate('/ustawienia'); } }, A.t('shell.settings'))),
      h(Section, { hid: 'c-skroty', title: A.t('shell.shortcuts') },
        h('dl', { style: { display: 'grid', gap: 'var(--space-2)', margin: 0 } }, (p.shortcuts || []).slice(0, 5).map(function (s, i) {
          return h('div', { key: i, className: 'row', style: { gap: 'var(--space-3)' } }, h('dt', { style: { margin: 0 } }, h(E.Kbd, { keys: s.keys, label: s.label })), h('dd', { className: 'caption muted', style: { margin: 0 } }, scWhat(s)));
        })),
        h('p', { className: 'caption muted' }, A.t('st.shortcutsNote'))),
      d.student.adult ? h(Section, { hid: 'c-prawa', title: A.t('st.rights') },
        h('div', { className: 'row' }, h(E.Badge, { tone: 'outline', icon: 'user' }, A.t('st.adultBadge'))),
        h('p', { className: 'caption muted' }, A.t('st.adultNote')),
        blocked
          ? h('div', { className: 'row' }, h(E.Badge, { tone: 'danger', icon: 'lock' }, A.t('st.parentBlocked')),
            h(E.Button, { size: 'sm', onClick: function () { A.api.post('/api/student/parent-access', { blocked: false }).then(function () { setBlocked(false); A.toast(A.t('st.parentRestored'), 'success'); }).catch(function (e) { A.toast(e.message || A.t('st.accessFail'), 'danger'); }); } }, A.t('st.restoreAccess')))
          : h(E.Button, { variant: 'danger', icon: 'eye-off', onClick: function () { setAsk(true); } }, A.t('st.blockAccess')),
        ask ? h(E.Dialog, {
          title: A.t('st.blockTitle'), onClose: function () { setAsk(false); },
          actions: [
            h(E.Button, { key: 'n', variant: 'secondary', onClick: function () { setAsk(false); } }, A.t('st.leaveUnchanged')),
            h(E.Button, { key: 'y', variant: 'danger', 'data-autofocus': true, onClick: function () {
              A.api.post('/api/student/parent-access', { blocked: true, reason: OBJECTION_REASON }).then(function (r) { setAsk(false); setBlocked(true); A.toast(r.confirmation, 'success'); }).catch(function (e) { setAsk(false); A.toast(e.message || A.t('st.accessFail'), 'danger'); });
            } }, A.t('st.blockConfirm'))]
        },
          h('p', null, A.t('st.blockP1')),
          h('p', null, A.t('st.blockP2'))) : null) : null);
  }

  function Excuses(p) {
    var ex = p.excuses; var st = React.useState({ from: '', to: '', reason: '' }), f = st[0], set = st[1];
    if (!ex) return null;
    if (!ex.adult) return null;
    return h(Section, { hid: 'h-uspr', title: A.t('st.excuses') },
      !ex.schoolAllows ? h(E.Alert, { tone: 'info' }, A.t('st.excNotAllowed')) : h(F, null,
        h('p', { className: 'caption muted' }, ex.rule),
        h('div', { className: 'row' },
          h(E.TextField, Object.assign({ label: A.t('st.from'), type: 'date', value: f.from, width: 180, hint: A.dateHint(f.from), onChange: function (e) { set(Object.assign({}, f, { from: e.target.value })); } }, A.dateInputProps())),
          h(E.TextField, Object.assign({ label: A.t('st.to'), type: 'date', value: f.to, width: 180, hint: A.dateHint(f.to), onChange: function (e) { set(Object.assign({}, f, { to: e.target.value })); } }, A.dateInputProps()))),
        h(E.TextField, { label: A.t('common.reason'), value: f.reason, width: '100%', placeholder: A.t('st.reasonPh'), onChange: function (e) { set(Object.assign({}, f, { reason: e.target.value })); } }),
        h('div', { className: 'row' }, h(E.Button, { icon: 'check', disabled: !f.from || !f.reason, onClick: function () {
          A.api.post('/api/student/excuses', { from: f.from, to: f.to || f.from, reason: f.reason }).then(function (r) { A.toast(r.receipt, 'success'); set({ from: '', to: '', reason: '' }); p.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); });
        } }, A.t('st.submitExcuse')))),
      ex.excuses.length ? h(E.Table, {
        caption: A.t('st.myExcuses'), hideCaption: true,
        columns: [{ key: 'from', title: A.t('st.from'), render: function (r) { return A.fmtDate(r.from); } }, { key: 'to', title: A.t('st.to'), render: function (r) { return A.fmtDate(r.to); } }, { key: 'reason', title: A.t('common.reason') },
          { key: 'status', title: A.t('common.status'), render: function (r) { return h(E.Badge, { tone: r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'info' }, A.t('st.exc.' + (r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'))); } }],
        rows: ex.excuses
      }) : null);
  }

  A.screen({
    id: 'student', path: '/uczen', title: 'Dziennik ucznia', roles: ['student'], module: 'student',
    nav: { key: 'nav.logbook', label: 'Dziennik', order: 10 },
    component: function StudentScreen(props) {
      var dash = A.useApi('/api/student/dashboard', []);
      var grades = A.useApi('/api/student/grades', []);
      var mats = A.useApi('/api/student/materials', []);
      var msgs = A.useApi('/api/messages?box=inbox&limit=5', []);
      var excuses = A.useApi('/api/student/excuses', []);
      var shortcuts = A.useApi('/api/shortcuts', []);
      var month = (props.config && props.config.today ? props.config.today : '2026-10-01').slice(0, 7);
      var cal = A.useApi('/api/student/tests/calendar?month=' + month, []);
      var d = dash.data;
      if (dash.error) return h('div', null, h('h1', { className: 'display app-title' }, A.t('st.title')), h(E.Alert, { tone: 'danger' }, dash.error.message));
      if (!d) return h('div', null, h('h1', { className: 'display app-title' }, A.t('st.title')), h('p', { className: 'muted' }, A.t('st.loading')));
      return h('div', { className: 'stack' },
        h('div', null,
          h('h1', { className: 'display app-title' }, A.t('st.hello', { name: d.student.firstName })),
          h('p', { className: 'app-sub' }, A.t('st.sub', { date: dayLabel(d.today), school: d.school.short, 'class': d.student.className })),
          h('div', { className: 'row' },
            h(E.StatTile, { label: A.t('st.tile.lessons'), value: String(d.lessons.length), hint: d.changes.length ? A.plural(d.changes.length, 'st.tile.changes') : A.t('st.tile.noChanges') }),
            h(E.StatTile, { label: A.t('st.tile.tomorrow'), value: String(d.homeworkTomorrow.length), hint: A.t('st.tile.tomorrowHint') }),
            h(E.StatTile, { label: A.t('st.tile.tests'), value: String(d.upcomingTests.length), hint: A.t('st.tile.testsHint') }),
            h(E.StatTile, { label: A.t('st.tile.unread'), value: String(d.unreadMessages), hint: A.t('st.tile.unreadHint') }))),
        h('div', { className: 'grid-2' }, h(Today, { data: d }), h('div', { className: 'stack' }, h(Tomorrow, { data: d }), h(TestsCalendar, { cal: cal.data }))),
        h('div', { className: 'grid-2' }, h(Grades, { grades: grades.data }), h(Goal, { grades: grades.data })),
        h('div', { className: 'grid-2' }, h(Homework, { data: d, reload: dash.reload }), h(Materials, { materials: mats.data })),
        h('div', { className: 'grid-2' }, h(Messages, { messages: msgs.data }), h('div', { className: 'stack' }, h(Library, { data: d }), h(Excuses, { excuses: excuses.data, reload: excuses.reload }))),
        h(Rights, { data: d, shortcuts: shortcuts.data ? shortcuts.data.shortcuts : [] }));
    }
  });
})();
