/* 3.1 — subject grade book: the grid, a grade entry (points mode, locks, comment),
   bulk entry, categories and weights, the retake rule, statistics, remarks, descriptive grades for years 1–3,
   spreadsheet export and a printout for parents. Port of ../design-system/components/TeacherGrades/preview.html. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement;
  var COLORS = [1, 2, 3, 4, 5, 6, 7, 8];

  /* m10 — the weight box patched on blur while being uncontrolled: a refused PATCH left the rejected
     number sitting on screen, and a weight change silently re-computes every average in the class.
     It is now controlled, it asks before it writes, and it falls back to the stored value on a No
     from either the teacher or the server. */
  function CatWeight(p) {
    var st = React.useState(String(p.row.weight)), v = st[0], setV = st[1];
    var a = React.useState(null), ask = a[0], setAsk = a[1];
    React.useEffect(function () { setV(String(p.row.weight)); }, [p.row.weight]);
    var revert = function () { setAsk(null); setV(String(p.row.weight)); };
    return h(React.Fragment, null,
      h(E.TextField, { label: '', 'aria-label': A.t('tg.cat.weightAria', { name: p.row.name }), type: 'number', min: 1, max: 10, width: '5rem', value: v,
        onChange: function (ev) { setV(ev.target.value); },
        onBlur: function () { var next = Math.round(Number(v)); if (!next || next < 1 || next > 10 || next === p.row.weight) { setV(String(p.row.weight)); return; } setAsk(next); } }),
      ask != null ? h(E.Dialog, { title: A.t('tg.cat.weightConfirmTitle'), onClose: revert, actions: [
        h(E.Button, { key: 'c', onClick: revert }, A.t('common.cancel')),
        h(E.Button, { key: 'o', variant: 'primary', 'data-autofocus': true, onClick: function () { var next = ask; setAsk(null); p.onPatch(p.row, { weight: next }, revert); } }, A.t('tg.cat.weightConfirmOk'))
      ] }, h('p', null, A.t('tg.cat.weightConfirmText', { name: p.row.name, from: p.row.weight, to: ask }))) : null);
  }

  window.EdI18n.add({
    pl: {
      'tg.title': 'Oceny · {s} · {c}',
      'tg.sub': '{who} · {school} · rok szkolny {year} · {students} · stan na {date}',
      'tg.students.one': '{n} uczeń', 'tg.students.few': '{n} uczniowie', 'tg.students.many': '{n} uczniów',
      'tg.accounts.one': '{n} konto', 'tg.accounts.few': '{n} konta', 'tg.accounts.many': '{n} kont',
      'tg.tabsLabel': 'Sekcje dziennika ocen',
      'tg.tab.grades': 'Oceny cząstkowe',
      'tg.tab.stats': 'Statystyki',
      'tg.tab.remarks': 'Uwagi',
      'tg.tab.desc': 'Ocena opisowa',
      'tg.noPairTitle': 'Brak przypisanych zajęć',
      'tg.noPairText': 'Nie prowadzisz zajęć z żadnym oddziałem, więc dziennik ocen jest pusty.',
      'tg.pair': 'Klasa i przedmiot',
      'tg.lockedBadge': 'Klasyfikacja zamknięta — tylko do odczytu',
      'tg.pickStudent': 'Wybierz ucznia',
      'tg.backToLesson': '← Wróć do lekcji',
      'tg.saveFail': 'Nie udało się zapisać wpisu.',
      'tg.saveError': 'błąd zapisu',
      'tg.notSaved': 'Nie zapisano: {msg}.',
      'tg.loadingGrid': 'Wczytywanie siatki ocen…',
      'tg.on': 'wł.', 'tg.off': 'wył.',
      'tg.tile.classAvg': 'Średnia klasy',
      'tg.tile.classAvgHint': 'Średnia ważona z kategorii wliczanych do średniej',
      'tg.tile.count': 'Liczba ocen',
      'tg.tile.countHint': 'W tym np {a} · bz {b} poza średnią',
      'tg.tile.noGrades': 'Bez ocen',
      'tg.tile.noGradesHint': 'Uczniowie bez żadnego wpisu w tym semestrze',
      'tg.tile.atRisk': 'Zagrożeni',
      'tg.tile.atRiskHint': 'Średnia poniżej 2,00',
      'tg.gridCaption': '{s} · {c} · {sem} roku szkolnego {year} · stan na {date}',
      'tg.legend.locked': 'Zablokowana',
      'tg.legend.lockedText': 'Wpisy zamknięte po klasyfikacji pozostają czytelne.',
      'tg.legend.proposed': 'Proponowana',
      'tg.legend.proposedText': 'Kolumna „Proponowana” i kategorie odznaczone w menedżerze są poza średnią ważoną.',
      'tg.legend.absentText': 'Nieobecność potwierdzona — wpis oceny wymaga zaznaczenia „do uzupełnienia”.',
      'tg.kbd.enter': 'Zatwierdź ocenę i przejdź do następnego ucznia',
      'tg.kbd.esc': 'Anuluj edycję komórki',
      'tg.kbd.plus': 'Modyfikator po cyfrze (także −)',
      'tg.kbd.save': 'Zapisz bieżący wpis',
      'tg.kbd.list': 'Lista skrótów',
      'tg.kbd.section': 'Sekcja Oceny',
      'tg.editor.h': 'Wpis oceny',
      'tg.editor.active': 'Aktywny uczeń: {s}{extra}',
      'tg.editor.colPart': ' · kolumna {c}',
      'tg.editor.weightPart': ' · waga {w}',
      'tg.editor.pick': 'Wybierz komórkę w siatce albo ucznia poniżej, aby wpisać ocenę.',
      'tg.editor.lockedTitle': 'Wpis zablokowany',
      'tg.editor.lockedText': 'Ocena pozostaje czytelna, ale edycja po zamknięciu klasyfikacji wymaga zgody dyrekcji.',
      'tg.editor.category': 'Kategoria (waga z kategorii)',
      'tg.editor.categoryPh': 'Wybierz kategorię',
      'tg.editor.catOption': '{name} · waga {w}{extra}',
      'tg.editor.outOfAvg': ' · poza średnią',
      'tg.editor.date': 'Data wpisu',
      'tg.editor.points': 'Tryb punktowy',
      'tg.editor.stateGrade': 'ocena',
      'tg.editor.statePoints': 'punkty',
      'tg.editor.maxPoints': 'Maksymalna liczba punktów',
      'tg.editor.gradeLabel': 'Ocena',
      'tg.editor.pointsLabel': 'Punkty',
      'tg.editor.blockedReason': 'Nie można wpisać oceny: uczeń ma potwierdzoną nieobecność (nb) na tej godzinie lekcyjnej. Zaznacz „do uzupełnienia”, aby wpisać ją mimo to.',
      'tg.editor.comment': 'Komentarz dla ucznia i rodzica',
      'tg.editor.commentHint': 'Widoczny na koncie ucznia i rodzica; wyjaśnia kryteria popełnionych błędów.',
      'tg.editor.commentPh': 'np. błąd w zadaniu 4 — zamiana jednostek',
      'tg.editor.save': 'Zapisz ocenę',
      'tg.editor.revert': 'Cofnij ocenę',
      'tg.editor.propose': 'Wystaw jako proponowaną',
      'tg.editor.bulk': 'Wpisywanie seryjne (Enter przechodzi do następnego ucznia)',
      'tg.proposedHint.none': 'Ocena proponowana trafia do kolumny „Proponowana”, poza średnią ważoną.',
      'tg.proposedHint.due': 'Termin wystawiania ocen proponowanych: {date}. Rodzic i uczeń otrzymają powiadomienie oraz wiadomość.',
      'tg.proposedHint.past': 'Termin wystawiania ocen proponowanych minął {date}. Rodzic i uczeń otrzymają powiadomienie oraz wiadomość.',
      'tg.retake.h': 'Zasada zaliczania poprawy',
      'tg.retake.text1': 'Obie oceny pozostają widoczne w siatce: komórka pierwotna pokazuje „ocena → poprawa”, a kolumna poprawy jest oznaczona jako poza średnią, gdy liczy się tylko jedna wartość. Zasadę ustala statut szkoły (konfiguracja ',
      'tg.retake.text1b': ').',
      'tg.retake.text2': 'Aby wpisać poprawę, wybierz komórkę oceny pierwotnej i zapisz nową ocenę z datą poprawy.',
      'tg.export.h': 'Eksport i wydruk',
      'tg.export.anon': 'Anonimizuj dane (analiza egzaminacyjna)',
      'tg.export.anonHint': 'Zamiast nazwisk trafiają numery w dzienniku, a nagłówek arkusza otrzymuje adnotację „Dane zanonimizowane”.',
      'tg.export.csv': 'Eksportuj do arkusza (CSV)',
      'tg.export.print': 'Wydruk dla rodzica',
      'tg.export.noteStudent': 'Wydruk dotyczy zaznaczonego ucznia i zawsze zawiera imię i nazwisko — anonimizacja dotyczy wyłącznie eksportu do analizy.',
      'tg.export.noteNone': 'Zaznacz ucznia w siatce, aby przygotować wydruk na spotkanie indywidualne.',
      'tg.cat.h': 'Kategorie ocen i wagi',
      'tg.cat.intro': 'Waga 1–10, kolor wypełnia komórkę w siatce, a nazwa kategorii trafia do etykiety czytnika ekranu.',
      'tg.cat.caption': 'Kategorie ocen przedmiotu',
      'tg.cat.col.name': 'Kategoria',
      'tg.cat.col.weight': 'Waga',
      'tg.cat.col.color': 'Kolor',
      'tg.cat.col.counts': 'Do średniej',
      'tg.cat.weightAria': 'Waga kategorii {name}',
      'tg.cat.weightConfirmTitle': 'Zmienić wagę kategorii?',
      'tg.cat.weightConfirmText': 'Waga kategorii „{name}” zmieni się z {from} na {to}. Przeliczymy od nowa średnie ważone wszystkich uczniów, którzy mają oceny w tej kategorii.',
      'tg.cat.weightConfirmOk': 'Zmień wagę i przelicz średnie',
      'tg.cat.colorAria': 'Kolor kategorii {name}',
      'tg.cat.include': 'Wliczaj',
      'tg.cat.newH': 'Nowa kategoria',
      'tg.cat.name': 'Nazwa kategorii',
      'tg.cat.namePh': 'np. Laboratorium',
      'tg.cat.includeAvg': 'Wliczaj do średniej ważonej',
      'tg.cat.add': 'Dodaj kategorię',
      'tg.cat.inAvg': 'wliczana do średniej ważonej.',
      'tg.cat.outAvg': 'poza średnią ważoną.',
      'tg.stats.dist': 'Rozkład ocen',
      'tg.stats.grade': 'Ocena {n}',
      'tg.stats.outside': 'Poza średnią: np {a} · bz {b}. Wpisy np i bz nie zmieniają średniej ważonej, ale liczą się w raportach statystycznych.',
      'tg.stats.avgH': 'Średnie uczniów',
      'tg.stats.avgCap': 'Średnia ważona i liczba ocen każdego ucznia',
      'tg.stats.col.count': 'Ocen',
      'tg.stats.atRisk': 'Zagrożony',
      'tg.stats.noGrades': 'Brak ocen',
      'tg.stats.ok': 'bez uwag',
      'tg.kind.positive': 'Pochwała',
      'tg.kind.negative': 'Uwaga',
      'tg.kind.neutral': 'Informacja',
      'tg.rem.newH': 'Nowa uwaga z dziennika lekcyjnego',
      'tg.rem.kind': 'Rodzaj wpisu',
      'tg.rem.neutralOpt': 'Informacja (bez punktów)',
      'tg.rem.text': 'Treść',
      'tg.rem.textPh': 'np. pomoc koleżeńska przy projekcie',
      'tg.rem.points': 'Punkty zachowania',
      'tg.rem.pointsHint': 'Znak wynika z rodzaju wpisu; informacja nie zmienia punktów.',
      'tg.rem.save': 'Zapisz uwagę',
      'tg.rem.classH': 'Uwagi i punkty zachowania klasy',
      'tg.rem.cap': 'Punkty zachowania uczniów',
      'tg.rem.col.points': 'Punkty',
      'tg.rem.col.grade': 'Ocena z zachowania',
      'tg.rem.col.entries': 'Wpisy',
      'tg.rem.entry': '{kind} ({p} pkt)',
      'tg.rem.entryDefault': 'Wpis',
      'tg.desc.h': 'Ocena opisowa (klasy 1–3)',
      'tg.desc.intro': 'Śródroczna ocena opisowa w podziale na obszary rozwoju, budowana z banku zwrotów pedagogicznych.',
      'tg.desc.area': 'Obszar rozwoju',
      'tg.desc.areaPh': 'Wybierz obszar',
      'tg.desc.bank': 'Bank zwrotów — {area}',
      'tg.desc.own': 'Uzupełnienie własne',
      'tg.desc.ownPh': 'np. chętnie liczy w pamięci i tłumaczy sposób obliczeń',
      'tg.desc.save': 'Zapisz ocenę opisową',
      'tg.revert.title': 'Cofnąć ocenę?',
      'tg.revert.text1': 'Wpis: {label}. Ocena zniknie ze średniej ucznia, ale pozostanie w bazie.',
      'tg.revert.text2': 'Wartość pierwotna, powód, autor, czas i adres IP zostaną zapisane w rejestrze zmian.',
      'tg.revert.reason': 'Powód cofnięcia',
      'tg.revert.reasonHint': 'Powód trafia do rejestru zmian i jest widoczny dla dyrekcji.',
      'tg.revert.reasonPh': 'np. wpis w wierszu innego ucznia',
      'tg.toast.saved': 'Zapisano ocenę {v}.',
      'tg.toast.reverted': 'Ocena cofnięta. Wpis zapisano w rejestrze zmian.',
      'tg.toast.proposed': 'Ocena proponowana zapisana; powiadomiono rodzica i ucznia.',
      'tg.toast.catAdded': 'Dodano kategorię „{n}”.',
      'tg.toast.remark': 'Zapisano wpis w dzienniku.',
      'tg.toast.desc': 'Zapisano ocenę opisową.',
      'tg.live.ready': 'Dziennik ocen gotowy. Wybierz komórkę w siatce, aby wpisać ocenę.',
      'tg.live.opened': 'Otwarto wpis: {s} · {col}{extra}.',
      'tg.live.weightPart': ', waga {w}',
      'tg.live.pickStudent': 'Najpierw wybierz ucznia w siatce ocen.',
      'tg.live.saved': 'Zapisano ocenę {v}{pts} · {student}{comment}{makeup} · średnia ucznia: {avg}.',
      'tg.live.ptsPart': ' ({p}/{mp} · {pct} % → {g})',
      'tg.live.commentPart': ' · komentarz dla ucznia i rodzica zapisany',
      'tg.live.makeupPart': ' · do uzupełnienia w późniejszym terminie',
      'tg.live.activeStudent': ' Aktywny uczeń: {s}.',
      'tg.live.reverted': 'Cofnięto ocenę {v} · {label}. Wartość pierwotna i powód trafiły do rejestru zmian.',
      'tg.live.revertCancelled': 'Cofanie oceny anulowane. Wpis pozostaje bez zmian.',
      'tg.live.proposed': 'Zapisano ocenę proponowaną {v} · termin wystawienia {date} · powiadomienia wysłano na {n} (uczeń i rodzice).',
      'tg.live.picked': 'Wybrano dziennik: {name}.',
      'tg.live.pointsOn': 'Tryb punktowy włączony: wpisz punkty, system przeliczy procent i zaproponuje ocenę wg skali szkolnej.',
      'tg.live.pointsOff': 'Tryb punktowy wyłączony: wpisz ocenę 1–6.',
      'tg.live.makeupOn': 'Zaznaczono „do uzupełnienia” — wpis oceny dla nieobecnego ucznia jest możliwy.',
      'tg.live.makeupOff': 'Odznaczono „do uzupełnienia” — wpis jest zablokowany.',
      'tg.live.cancelled': 'Anulowano edycję komórki.',
      'tg.live.bulkOn': 'Wpisywanie seryjne włączone: Enter zatwierdza ocenę i przechodzi do następnego ucznia w tej samej kolumnie.',
      'tg.live.bulkOff': 'Wpisywanie seryjne wyłączone.',
      'tg.live.anonOn': 'Eksport będzie zanonimizowany.',
      'tg.live.anonOff': 'Eksport będzie zawierał imiona i nazwiska uczniów.',
      'tg.live.printOpened': 'Otwarto wydruk wykazu ocen i frekwencji w nowej karcie.',
      'tg.live.catPatched': 'Kategoria „{n}”: waga {w}, kolor {c}, {tail}',
      'tg.live.catAdded': 'Dodano kategorię „{n}” (waga {w}, kolor {c}).',
      'tg.live.remark': 'Zapisano {kind} dla {student}: {applied} pkt, razem {total} pkt ({grade}).',
      'tg.live.desc': 'Zapisano ocenę opisową dla {student} · obszar {area} · wypełniono {f} z {t} obszarów.'
    },
    en: {
      'tg.title': 'Grades · {s} · {c}',
      'tg.sub': '{who} · {school} · school year {year} · {students} · as at {date}',
      'tg.students.one': '{n} student', 'tg.students.other': '{n} students',
      'tg.accounts.one': '{n} account', 'tg.accounts.other': '{n} accounts',
      'tg.tabsLabel': 'Grade book sections',
      'tg.tab.grades': 'Individual grades',
      'tg.tab.stats': 'Statistics',
      'tg.tab.remarks': 'Remarks',
      'tg.tab.desc': 'Descriptive grade',
      'tg.noPairTitle': 'No classes assigned',
      'tg.noPairText': 'You do not teach any class group, so the grade book is empty.',
      'tg.pair': 'Class and subject',
      'tg.lockedBadge': 'End-of-term classification closed — read only',
      'tg.pickStudent': 'Choose a student',
      'tg.backToLesson': '← Back to the lesson',
      'tg.saveFail': 'The entry could not be saved.',
      'tg.saveError': 'save error',
      'tg.notSaved': 'Not saved: {msg}.',
      'tg.loadingGrid': 'Loading the grade grid…',
      'tg.on': 'on', 'tg.off': 'off',
      'tg.tile.classAvg': 'Class average',
      'tg.tile.classAvgHint': 'Weighted average of the categories that count towards it',
      'tg.tile.count': 'Grades entered',
      'tg.tile.countHint': 'Including np {a} · bz {b} outside the average',
      'tg.tile.noGrades': 'Without grades',
      'tg.tile.noGradesHint': 'Students with no entry at all this semester',
      'tg.tile.atRisk': 'At risk',
      'tg.tile.atRiskHint': 'Average below 2.00',
      'tg.gridCaption': '{s} · {c} · {sem} of the {year} school year · as at {date}',
      'tg.legend.locked': 'Locked',
      'tg.legend.lockedText': 'Entries closed after classification stay readable.',
      'tg.legend.proposed': 'Proposed',
      'tg.legend.proposedText': 'The "Proposed" column and categories unticked in the manager stay outside the weighted average.',
      'tg.legend.absentText': 'Absence confirmed — entering a grade requires ticking "to be completed".',
      'tg.kbd.enter': 'Confirm the grade and move to the next student',
      'tg.kbd.esc': 'Cancel editing the cell',
      'tg.kbd.plus': 'Modifier after a digit (− as well)',
      'tg.kbd.save': 'Save the current entry',
      'tg.kbd.list': 'List of shortcuts',
      'tg.kbd.section': 'Grades section',
      'tg.editor.h': 'Grade entry',
      'tg.editor.active': 'Active student: {s}{extra}',
      'tg.editor.colPart': ' · column {c}',
      'tg.editor.weightPart': ' · weight {w}',
      'tg.editor.pick': 'Choose a cell in the grid or a student below to enter a grade.',
      'tg.editor.lockedTitle': 'Entry locked',
      'tg.editor.lockedText': 'The grade stays readable, but editing it after classification is closed needs the principal\'s approval.',
      'tg.editor.category': 'Category (weight comes from the category)',
      'tg.editor.categoryPh': 'Choose a category',
      'tg.editor.catOption': '{name} · weight {w}{extra}',
      'tg.editor.outOfAvg': ' · outside the average',
      'tg.editor.date': 'Entry date',
      'tg.editor.points': 'Points mode',
      'tg.editor.stateGrade': 'grade',
      'tg.editor.statePoints': 'points',
      'tg.editor.maxPoints': 'Maximum number of points',
      'tg.editor.gradeLabel': 'Grade',
      'tg.editor.pointsLabel': 'Points',
      'tg.editor.blockedReason': 'The grade cannot be entered: the student has a confirmed absence (nb) for this lesson. Tick "to be completed" to enter it anyway.',
      'tg.editor.comment': 'Comment for the student and parent',
      'tg.editor.commentHint': 'Visible on the student\'s and the parent\'s account; it explains what went wrong.',
      'tg.editor.commentPh': 'e.g. mistake in question 4 — unit conversion',
      'tg.editor.save': 'Save the grade',
      'tg.editor.revert': 'Revert the grade',
      'tg.editor.propose': 'Enter as a proposed grade',
      'tg.editor.bulk': 'Bulk entry (Enter moves to the next student)',
      'tg.proposedHint.none': 'A proposed grade goes into the "Proposed" column, outside the weighted average.',
      'tg.proposedHint.due': 'Proposed grades are due by {date}. The parent and the student receive a notification and a message.',
      'tg.proposedHint.past': 'The deadline for proposed grades passed on {date}. The parent and the student receive a notification and a message.',
      'tg.retake.h': 'Retake rule',
      'tg.retake.text1': 'Both grades stay visible in the grid: the original cell shows "grade → retake", and the retake column is marked as outside the average when only one value counts. The rule is set by the school statute (configuration ',
      'tg.retake.text1b': ').',
      'tg.retake.text2': 'To record a retake, choose the cell with the original grade and save a new grade dated on the retake day.',
      'tg.export.h': 'Export and printout',
      'tg.export.anon': 'Anonymise the data (exam analysis)',
      'tg.export.anonHint': 'Roll numbers replace surnames and the sheet header is annotated "Data anonymised".',
      'tg.export.csv': 'Export to a spreadsheet (CSV)',
      'tg.export.print': 'Printout for the parent',
      'tg.export.noteStudent': 'The printout covers the selected student and always carries their full name — anonymisation applies only to the analysis export.',
      'tg.export.noteNone': 'Select a student in the grid to prepare a printout for a one-to-one meeting.',
      'tg.cat.h': 'Grade categories and weights',
      'tg.cat.intro': 'Weight 1–10, the colour fills the cell in the grid, and the category name goes into the screen-reader label.',
      'tg.cat.caption': 'Grade categories of the subject',
      'tg.cat.col.name': 'Category',
      'tg.cat.col.weight': 'Weight',
      'tg.cat.col.color': 'Colour',
      'tg.cat.col.counts': 'In the average',
      'tg.cat.weightAria': 'Weight of category {name}',
      'tg.cat.weightConfirmTitle': 'Change the category weight?',
      'tg.cat.weightConfirmText': 'The weight of category "{name}" changes from {from} to {to}. Every weighted average of a pupil with a grade in this category is recomputed.',
      'tg.cat.weightConfirmOk': 'Change the weight and recompute',
      'tg.cat.colorAria': 'Colour of category {name}',
      'tg.cat.include': 'Count it',
      'tg.cat.newH': 'New category',
      'tg.cat.name': 'Category name',
      'tg.cat.namePh': 'e.g. Lab work',
      'tg.cat.includeAvg': 'Count towards the weighted average',
      'tg.cat.add': 'Add the category',
      'tg.cat.inAvg': 'counted towards the weighted average.',
      'tg.cat.outAvg': 'outside the weighted average.',
      'tg.stats.dist': 'Grade distribution',
      'tg.stats.grade': 'Grade {n}',
      'tg.stats.outside': 'Outside the average: np {a} · bz {b}. np and bz entries do not change the weighted average, but they do count in statistical reports.',
      'tg.stats.avgH': 'Student averages',
      'tg.stats.avgCap': 'Weighted average and number of grades for each student',
      'tg.stats.col.count': 'Grades',
      'tg.stats.atRisk': 'At risk',
      'tg.stats.noGrades': 'No grades',
      'tg.stats.ok': 'no concerns',
      'tg.kind.positive': 'Commendation',
      'tg.kind.negative': 'Remark',
      'tg.kind.neutral': 'Note',
      'tg.rem.newH': 'New remark from the lesson logbook',
      'tg.rem.kind': 'Type of entry',
      'tg.rem.neutralOpt': 'Note (no points)',
      'tg.rem.text': 'Text',
      'tg.rem.textPh': 'e.g. helped a classmate with the project',
      'tg.rem.points': 'Behaviour points',
      'tg.rem.pointsHint': 'The sign follows the type of entry; a note does not change the points.',
      'tg.rem.save': 'Save the remark',
      'tg.rem.classH': 'Remarks and behaviour points of the class',
      'tg.rem.cap': 'Behaviour points of the students',
      'tg.rem.col.points': 'Points',
      'tg.rem.col.grade': 'Behaviour grade',
      'tg.rem.col.entries': 'Entries',
      'tg.rem.entry': '{kind} ({p} pts)',
      'tg.rem.entryDefault': 'Entry',
      'tg.desc.h': 'Descriptive grade (years 1–3)',
      'tg.desc.intro': 'The mid-year descriptive grade, split by area of development and built from the bank of teaching phrases.',
      'tg.desc.area': 'Area of development',
      'tg.desc.areaPh': 'Choose an area',
      'tg.desc.bank': 'Phrase bank — {area}',
      'tg.desc.own': 'Your own wording',
      'tg.desc.ownPh': 'e.g. enjoys mental arithmetic and explains how they worked it out',
      'tg.desc.save': 'Save the descriptive grade',
      'tg.revert.title': 'Revert the grade?',
      'tg.revert.text1': 'Entry: {label}. The grade drops out of the student\'s average but stays in the database.',
      'tg.revert.text2': 'The original value, the reason, the author, the time and the IP address are written to the change log.',
      'tg.revert.reason': 'Reason for reverting',
      'tg.revert.reasonHint': 'The reason goes into the change log and is visible to the principal.',
      'tg.revert.reasonPh': 'e.g. entered in another student\'s row',
      'tg.toast.saved': 'Grade {v} saved.',
      'tg.toast.reverted': 'Grade reverted. The entry was written to the change log.',
      'tg.toast.proposed': 'Proposed grade saved; the parent and the student have been notified.',
      'tg.toast.catAdded': 'Category "{n}" added.',
      'tg.toast.remark': 'The entry was saved in the logbook.',
      'tg.toast.desc': 'Descriptive grade saved.',
      'tg.live.ready': 'The grade book is ready. Choose a cell in the grid to enter a grade.',
      'tg.live.opened': 'Entry open: {s} · {col}{extra}.',
      'tg.live.weightPart': ', weight {w}',
      'tg.live.pickStudent': 'Choose a student in the grade grid first.',
      'tg.live.saved': 'Grade {v}{pts} saved · {student}{comment}{makeup} · student average: {avg}.',
      'tg.live.ptsPart': ' ({p}/{mp} · {pct}% → {g})',
      'tg.live.commentPart': ' · comment for the student and parent saved',
      'tg.live.makeupPart': ' · to be completed at a later date',
      'tg.live.activeStudent': ' Active student: {s}.',
      'tg.live.reverted': 'Grade {v} reverted · {label}. The original value and the reason went to the change log.',
      'tg.live.revertCancelled': 'Reverting cancelled. The entry stays unchanged.',
      'tg.live.proposed': 'Proposed grade {v} saved · due by {date} · notifications sent to {n} (student and parents).',
      'tg.live.picked': 'Grade book selected: {name}.',
      'tg.live.pointsOn': 'Points mode on: enter the points, the system works out the percentage and suggests a grade on the school scale.',
      'tg.live.pointsOff': 'Points mode off: enter a grade from 1 to 6.',
      'tg.live.makeupOn': '"To be completed" ticked — a grade can be entered for an absent student.',
      'tg.live.makeupOff': '"To be completed" unticked — the entry is blocked.',
      'tg.live.cancelled': 'Cell editing cancelled.',
      'tg.live.bulkOn': 'Bulk entry on: Enter confirms the grade and moves to the next student in the same column.',
      'tg.live.bulkOff': 'Bulk entry off.',
      'tg.live.anonOn': 'The export will be anonymised.',
      'tg.live.anonOff': 'The export will contain the students\' names.',
      'tg.live.printOpened': 'The printout of grades and attendance opened in a new tab.',
      'tg.live.catPatched': 'Category "{n}": weight {w}, colour {c}, {tail}',
      'tg.live.catAdded': 'Category "{n}" added (weight {w}, colour {c}).',
      'tg.live.remark': 'Saved a {kind} for {student}: {applied} pts, {total} pts in total ({grade}).',
      'tg.live.desc': 'Descriptive grade saved for {student} · area {area} · {f} of {t} areas filled in.'
    }
  });

  function kindLabel(k) { return A.t('tg.kind.' + k); }
  function pairKey(p) { return p.classId + '|' + p.subjectId; }
  function isoToday(cfg) { return (cfg && cfg.today) || A.isoToday(); }
  /* Native date inputs render in the BROWSER locale, so the chosen day is repeated in the interface locale. */
  /* The editor's grade box is remounted on every pick and every bulk advance; without this the teacher has
     to click into it once per pupil. */
  function focusGradeInput() { setTimeout(function () { var el = document.querySelector('.ed-gradeinput input'); if (el) { el.focus(); el.select && el.select(); } }, 0); }

  function Screen(props) {
    var cfg = props.config || {};
    var ctx = A.useApi('/api/grades/context', []);
    var pairs = (ctx.data && ctx.data.pairs) || [];
    var st = React.useState({ pair: props.route.query.klasa || null, semester: props.route.query.semestr ? +props.route.query.semestr : null, tab: props.route.query.tab || 'oceny' });
    var fromLesson = props.route.query.lekcja || null;
    var s = st[0], set = function (patch) { st[1](Object.assign({}, s, patch)); };
    var pair = pairs.filter(function (p) { return pairKey(p) === s.pair; })[0] || pairs[0] || null;
    var semester = s.semester || (ctx.data && ctx.data.semester) || 1;
    var q = pair ? '?classId=' + pair.classId + '&subjectId=' + pair.subjectId + '&semester=' + semester : null;

    var grid = A.useApi(pair ? '/api/grades/grid' + q : null, [s.pair, semester]);
    var stats = A.useApi(pair ? '/api/grades/statistics' + q : null, [s.pair, semester]);
    var cats = A.useApi(pair ? '/api/grade-categories?subjectId=' + pair.subjectId : null, [s.pair]);
    var remarks = A.useApi(pair ? '/api/remarks?classId=' + pair.classId : null, [s.pair]);
    var bank = A.useApi('/api/phrase-bank', []);

    /* ——— editor state ——— */
    var ed0 = { studentId: props.route.query.student || null, colId: null, gradeId: null, categoryId: null, date: null, value: '', comment: '', makeup: false, points: false, maxPoints: '25' };
    var e1 = React.useState(ed0), ed = e1[0], setEd = function (patch) { e1[1](Object.assign({}, ed, patch)); };
    var b1 = React.useState(false), bulk = b1[0], setBulk = b1[1];
    var l1 = React.useState(A.t('tg.live.ready')), live = l1[0], setLive = l1[1];
    var r1 = React.useState(null), revert = r1[0], setRevert = r1[1];   // { gradeId, label, reason }
    var a1 = React.useState(true), anon = a1[0], setAnon = a1[1];
    var n1 = React.useState({ name: '', weight: '2', color: 'cat-8', countsInAverage: true }), newCat = n1[0];
    var m1 = React.useState({ studentId: '', kind: 'positive', text: '', points: '5' }), rem = m1[0];
    var d1 = React.useState({ studentId: '', area: '', phraseIds: [], text: '' }), desc = d1[0];
    var busy = React.useState(false), saving = busy[0], setSaving = busy[1];

    var students = (grid.data && grid.data.students) || [];
    var columns = (grid.data && grid.data.columns) || [];
    var categories = (cats.data && cats.data.categories) || [];
    var locked = !!(grid.data && grid.data.locked);
    var student = students.filter(function (x) { return x.studentId === ed.studentId; })[0] || null;
    var column = columns.filter(function (x) { return x.id === ed.colId; })[0] || null;
    var cell = student && column ? (student.grades || {})[column.id] : null;
    var category = categories.filter(function (x) { return x.id === ed.categoryId; })[0] || null;
    var blocked = !!(student && column && (student.absent || []).indexOf(column.id) >= 0 && !cell);

    function reloadAll() { grid.reload(); stats.reload(); }
    function fail(err) { setSaving(false); A.toast(err.message || A.t('tg.saveFail'), 'danger'); setLive(A.t('tg.notSaved', { msg: err.message || A.t('tg.saveError') })); }

    function pick(row, col) {
      var g = (row.grades || {})[col.id];
      setEd({
        studentId: row.studentId, colId: col.id, gradeId: g ? g.gradeId : null,
        categoryId: col.categoryId || ed.categoryId, date: col.iso || ed.date || isoToday(cfg),
        value: g ? (g.retake ? g.retake.to : g.value) : '', comment: (g && g.commentText) || '', makeup: !!(g && g.makeup), points: false, maxPoints: ed.maxPoints
      });
      focusGradeInput();
      setLive(A.t('tg.live.opened', {
        s: row.no + '. ' + row.name, col: col.title.toLowerCase(),
        extra: (col.weight ? A.t('tg.live.weightPart', { w: col.weight }) : '') + (col.date ? ' · ' + col.date : '')
      }));
    }

    function save(value, advance) {
      if (!pair || !ed.studentId) { setLive(A.t('tg.live.pickStudent')); return; }
      var body = {
        studentId: ed.studentId, subjectId: pair.subjectId, classId: pair.classId, semester: semester,
        categoryId: ed.categoryId, date: ed.date || isoToday(cfg), comment: ed.comment, makeup: ed.makeup
      };
      if (ed.points) { body.points = String(value == null ? ed.value : value).replace(',', '.'); body.maxPoints = ed.maxPoints; }
      else body.value = value == null ? ed.value : value;
      setSaving(true);
      A.api.post('/api/grades', body).then(function (r) {
        setSaving(false);
        var msg = A.t('tg.live.saved', {
          v: r.grade.value,
          pts: r.percent != null ? A.t('tg.live.ptsPart', { p: r.grade.points, mp: r.grade.maxPoints, pct: A.fmtNum(r.percent, 0), g: r.suggestedGrade }) : '',
          student: r.student,
          comment: r.grade.comment ? A.t('tg.live.commentPart') : '',
          makeup: r.grade.makeup ? A.t('tg.live.makeupPart') : '',
          avg: A.fmtNum(r.average)
        });
        if (advance && bulk) {
          var idx = students.map(function (x) { return x.studentId; }).indexOf(ed.studentId);
          var next = students[(idx + 1) % students.length];
          setEd({ studentId: next.studentId, gradeId: null, value: '', comment: '', makeup: false });
          focusGradeInput();
          msg += A.t('tg.live.activeStudent', { s: next.no + '. ' + next.name });
        } else setEd({ gradeId: r.grade.id, value: ed.points ? '' : r.grade.value });
        A.toast(A.t('tg.toast.saved', { v: r.grade.value }), 'success');
        setLive(msg);
        reloadAll();
      }).catch(fail);
    }

    function doRevert() {
      if (!revert || !revert.reason.trim()) return;
      A.api.delete('/api/grades/' + revert.gradeId, { reason: revert.reason.trim() }).then(function (r) {
        setRevert(null);
        setEd({ gradeId: null, value: '', comment: '' });
        setLive(A.t('tg.live.reverted', { v: r.reverted.value, label: revert.label }));
        A.toast(A.t('tg.toast.reverted'), 'success');
        reloadAll();
      }).catch(fail);
    }

    function propose() {
      A.api.post('/api/grades/proposed', { studentId: ed.studentId, subjectId: pair.subjectId, classId: pair.classId, semester: semester, value: ed.value })
        .then(function (r) {
          A.toast(A.t('tg.toast.proposed'), 'success');
          setLive(A.t('tg.live.proposed', { v: r.grade.value, date: A.fmtDate(r.deadline), n: A.plural(r.notified.length, 'tg.accounts') }));
          reloadAll();
        }).catch(fail);
    }

    A.onSave(function () { if (!locked && ed.studentId && ed.value) save(null, false); });

    /* ——— cards ——— */

    function pickerRow() {
      return h('div', { className: 'row', style: { alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' } },
        h(E.Select, {
          label: A.t('tg.pair'), width: '18rem', value: pair ? pairKey(pair) : '',
          options: pairs.map(function (p) { return { value: pairKey(p), label: p.className + ' · ' + A.subjectName(p.subjectId, p.subjectName) }; }),
          onChange: function (ev) { set({ pair: ev.target.value }); setEd(ed0); A.navigate('/oceny', Object.assign({ klasa: ev.target.value, semestr: String(semester), tab: s.tab }, fromLesson ? { lekcja: fromLesson } : {})); setLive(A.t('tg.live.picked', { name: ev.target.options[ev.target.selectedIndex].text })); }
        }),
        h(E.Select, {
          label: A.t('common.semester'), width: '10rem', value: String(semester),
          options: ((ctx.data && ctx.data.semesters) || []).map(function (x) { return { value: String(x.id), label: x.name }; }),
          onChange: function (ev) { set({ semester: +ev.target.value }); setEd(ed0); }
        }),
        locked ? h(E.Badge, { tone: 'outline', icon: 'lock' }, A.t('tg.lockedBadge')) : null);
    }

    function tiles() {
      var d = stats.data || {};
      return h('div', { className: 'grid-3' },
        h(E.StatTile, { label: A.t('tg.tile.classAvg'), value: A.fmtNum(d.classAverage), hint: A.t('tg.tile.classAvgHint') }),
        h(E.StatTile, { label: A.t('tg.tile.count'), value: String(d.total || 0), hint: A.t('tg.tile.countHint', { a: d.npCount || 0, b: d.bzCount || 0 }) }),
        h(E.StatTile, { label: A.t('tg.tile.noGrades'), value: String(d.withoutGrades || 0), hint: A.t('tg.tile.noGradesHint') }),
        h(E.StatTile, { label: A.t('tg.tile.atRisk'), value: String(d.atRisk || 0), alert: (d.atRisk || 0) > 0, hint: A.t('tg.tile.atRiskHint') }));
    }

    function gridCard() {
      if (grid.loading) return h('p', { className: 'muted' }, A.t('tg.loadingGrid'));
      if (grid.error) return h(E.Alert, { tone: 'danger' }, grid.error.message);
      if (!grid.data) return null;
      return h('div', { className: 'stack' },
        h(E.GradeGrid, {
          caption: A.t('tg.gridCaption', { s: A.subjectName(grid.data.subjectId, grid.data.subjectName), c: grid.data.className, sem: grid.data.semesterName, year: cfg.year, date: A.fmtDate(grid.data.today) }),
          columns: columns.map(function (c) { return { id: c.id, title: c.title, category: c.category, categoryName: c.categoryName, weight: c.weight, date: c.date, excluded: c.excluded }; }),
          students: students.map(function (x) { return { no: x.no, name: x.name, grades: x.grades, absent: x.absent, absentStatus: x.absentStatus }; }),
          onCell: function (row, col) {
            var full = students.filter(function (x) { return x.no === row.no; })[0];
            if (full) pick(full, columns.filter(function (c) { return c.id === col.id; })[0] || col);
          }
        }),
        h('div', { className: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-3)' } },
          h(E.Badge, { tone: 'outline', icon: 'lock' }, A.t('tg.legend.locked')),
          h('span', { className: 'muted' }, A.t('tg.legend.lockedText')),
          h(E.Badge, { tone: 'accent' }, A.t('tg.legend.proposed')),
          h('span', { className: 'muted' }, A.t('tg.legend.proposedText')),
          h(E.AttendanceChip, { status: 'nb' }),
          h('span', { className: 'muted' }, A.t('tg.legend.absentText'))),
        kbdHints());
    }

    function kbdHints() {
      var rows = [[['Enter'], A.t('tg.kbd.enter')], [['Esc'], A.t('tg.kbd.esc')], [['+'], A.t('tg.kbd.plus')], [['Ctrl', 'S'], A.t('tg.kbd.save')], [['?'], A.t('tg.kbd.list')], [['Alt', '2'], A.t('tg.kbd.section')]];
      return h('dl', { className: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-2) var(--space-5)', margin: 0 } },
        rows.map(function (r, i) { return h('div', { key: i, className: 'row', style: { gap: 'var(--space-2)' } }, h('dt', { style: { margin: 0 } }, h(E.Kbd, { keys: r[0] })), h('dd', { className: 'muted', style: { margin: 0 } }, r[1])); }));
    }

    function editorCard() {
      var weight = category ? category.weight : (column ? column.weight : null);
      var cellLocked = !!(cell && cell.locked) || locked;
      return h('div', { className: 'card' },
        h('h2', { className: 'title' }, A.t('tg.editor.h')),
        h('p', { className: 'muted', role: 'status', 'aria-live': 'polite', style: { marginTop: 0 } },
          student ? A.t('tg.editor.active', {
            s: student.no + '. ' + student.name,
            extra: (column ? A.t('tg.editor.colPart', { c: column.title }) : '') + (weight ? A.t('tg.editor.weightPart', { w: weight }) : '') + (ed.date ? ' · ' + A.fmtDate(ed.date) : '')
          }) : A.t('tg.editor.pick')),
        cellLocked ? h(E.Alert, { tone: 'info', title: A.t('tg.editor.lockedTitle') }, A.t('tg.editor.lockedText')) : null,
        h('div', { className: 'stack' },
          h(E.Select, {
            label: A.t('common.student'), value: ed.studentId || '', placeholder: A.t('tg.pickStudent'),
            options: students.map(function (x) { return { value: x.studentId, label: x.no + '. ' + x.name }; }),
            onChange: function (ev) { setEd({ studentId: ev.target.value, gradeId: null, value: '', comment: '' }); focusGradeInput(); }
          }),
          h(E.Select, {
            label: A.t('tg.editor.category'), value: ed.categoryId || '', placeholder: A.t('tg.editor.categoryPh'),
            options: categories.map(function (x) { return { value: x.id, label: A.t('tg.editor.catOption', { name: x.name, w: x.weight, extra: x.countsInAverage ? '' : A.t('tg.editor.outOfAvg') }) }; }),
            onChange: function (ev) { setEd({ categoryId: ev.target.value }); }
          }),
          h(E.TextField, Object.assign({ label: A.t('tg.editor.date'), type: 'date', value: ed.date || isoToday(cfg), hint: A.dateHint(ed.date || isoToday(cfg)), onChange: function (ev) { setEd({ date: ev.target.value }); } }, A.dateInputProps())),
          h(E.Switch, {
            label: A.t('tg.editor.points'), states: [A.t('tg.editor.stateGrade'), A.t('tg.editor.statePoints')], checked: ed.points,
            onChange: function (v) { setEd({ points: v, value: '' }); setLive(A.t(v ? 'tg.live.pointsOn' : 'tg.live.pointsOff')); }
          }),
          ed.points ? h(E.TextField, { label: A.t('tg.editor.maxPoints'), type: 'number', min: 1, width: '9rem', value: ed.maxPoints, onChange: function (ev) { setEd({ maxPoints: ev.target.value }); } }) : null,
          h(E.GradeInput, {
            key: (ed.studentId || '-') + '|' + (ed.colId || '-') + '|' + (ed.points ? 'p' : 'g'),
            label: A.t(ed.points ? 'tg.editor.pointsLabel' : 'tg.editor.gradeLabel') + (student ? ' · ' + student.no + '. ' + student.name : ''),
            value: ed.points ? '' : ed.value, weight: weight || undefined, pointsMax: ed.points ? +ed.maxPoints || 25 : undefined,
            blocked: blocked, makeup: ed.makeup,
            blockedReason: A.t('tg.editor.blockedReason'),
            onMakeup: function (v) { setEd({ makeup: v }); setLive(A.t(v ? 'tg.live.makeupOn' : 'tg.live.makeupOff')); },
            onChange: function (v) { setEd({ value: v }); },
            onCommit: function (g) { save(g && g.text ? g.text : String(g), true); },
            onCancel: function () { setEd({ value: cell ? cell.value : '' }); setLive(A.t('tg.live.cancelled')); }
          }),
          h(E.TextField, {
            label: A.t('tg.editor.comment'), multiline: 2, value: ed.comment,
            hint: A.t('tg.editor.commentHint'),
            placeholder: A.t('tg.editor.commentPh'),
            onChange: function (ev) { setEd({ comment: ev.target.value }); }
          }),
          h('div', { className: 'row', style: { flexWrap: 'wrap' } },
            h(E.Button, { variant: 'primary', icon: 'check', loading: saving, disabled: cellLocked, onClick: function () { save(null, false); } }, A.t('tg.editor.save')),
            h(E.Button, {
              variant: 'danger', icon: 'trash', disabled: cellLocked || !ed.gradeId,
              onClick: function () { setRevert({ gradeId: ed.gradeId, reason: '', label: (student ? student.no + '. ' + student.name : '') + ' · ' + (column ? column.title.toLowerCase() : '') }); }
            }, A.t('tg.editor.revert'))),
          h('div', { className: 'row', style: { flexWrap: 'wrap' } },
            h(E.Button, { variant: 'secondary', icon: 'check-all', disabled: locked || !ed.studentId || !ed.value, onClick: propose }, A.t('tg.editor.propose')),
            h('span', { className: 'muted' }, proposedHint())),
          h(E.Switch, {
            label: A.t('tg.editor.bulk'), states: [A.t('tg.off'), A.t('tg.on')], checked: bulk,
            onChange: function (v) { setBulk(v); setLive(A.t(v ? 'tg.live.bulkOn' : 'tg.live.bulkOff')); }
          })));
    }

    function proposedHint() {
      var sem = ((ctx.data && ctx.data.semesters) || []).filter(function (x) { return x.id === semester; })[0];
      if (!sem || !sem.proposedDeadline) return A.t('tg.proposedHint.none');
      var after = isoToday(cfg) > sem.proposedDeadline;
      return A.t(after ? 'tg.proposedHint.past' : 'tg.proposedHint.due', { date: A.fmtDate(sem.proposedDeadline) });
    }

    function retakeCard() {
      var d = grid.data || {};
      return h('div', { className: 'card' },
        h('h2', { className: 'title' }, A.t('tg.retake.h')),
        h('p', { style: { margin: 0 } }, h(E.Badge, { tone: 'info' }, d.retakeRuleLabel || '—')),
        h('p', { className: 'muted', style: { margin: 0 } }, A.t('tg.retake.text1'), h('span', { className: 'code' }, 'retakeRule'), A.t('tg.retake.text1b')),
        h('p', { className: 'muted', style: { margin: 0 } }, A.t('tg.retake.text2')));
    }

    function exportCard() {
      var url = '/api/grades/export.csv' + q + (anon ? '&anonymize=1' : '');
      return h('div', { className: 'card' },
        h('h2', { className: 'title' }, A.t('tg.export.h')),
        h(E.Checkbox, {
          label: A.t('tg.export.anon'), checked: anon,
          hint: A.t('tg.export.anonHint'),
          onChange: function (ev) { setAnon(ev.target.checked); setLive(A.t(ev.target.checked ? 'tg.live.anonOn' : 'tg.live.anonOff')); }
        }),
        h('div', { className: 'row', style: { flexWrap: 'wrap' } },
          h(E.Button, { variant: 'secondary', icon: 'download', href: url }, A.t('tg.export.csv')),
          h(E.Button, {
            variant: 'secondary', icon: 'print', disabled: !ed.studentId,
            onClick: function () { A.openPrint('/api/grades/record/' + ed.studentId + '?subjectId=' + pair.subjectId + '&semester=' + semester + '&print=1'); setLive(A.t('tg.live.printOpened')); }
          }, A.t('tg.export.print'))),
        h('p', { className: 'muted', style: { margin: 0 } }, A.t(ed.studentId ? 'tg.export.noteStudent' : 'tg.export.noteNone')));
    }

    function categoryCard() {
      return h('div', { className: 'card' },
        h('h2', { className: 'title' }, A.t('tg.cat.h')),
        h('p', { className: 'muted', style: { marginTop: 0 } }, A.t('tg.cat.intro')),
        h(E.Table, {
          caption: A.t('tg.cat.caption'), hideCaption: true,
          columns: [
            { key: 'name', title: A.t('tg.cat.col.name'), render: function (row) { return h('span', { className: 'row', style: { gap: 'var(--space-2)', alignItems: 'center' } }, h('span', { 'aria-hidden': 'true', style: { width: '16px', height: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line-strong)', background: 'var(--' + row.color + ')' } }), row.name); } },
            { key: 'weight', title: A.t('tg.cat.col.weight'), num: true, render: function (row) { return h(CatWeight, { row: row, onPatch: patchCat }); } },
            { key: 'color', title: A.t('tg.cat.col.color'), render: function (row) { return h(E.Select, { label: '', 'aria-label': A.t('tg.cat.colorAria', { name: row.name }), width: '7rem', value: row.color, options: COLORS.map(function (n) { return { value: 'cat-' + n, label: 'cat-' + n }; }), onChange: function (ev) { patchCat(row, { color: ev.target.value }); } }); } },
            { key: 'counts', title: A.t('tg.cat.col.counts'), render: function (row) { return h(E.Checkbox, { label: A.t('tg.cat.include'), checked: row.countsInAverage !== false, onChange: function (ev) { patchCat(row, { countsInAverage: ev.target.checked }); } }); } }
          ],
          rows: categories.map(function (x) { return Object.assign({ id: x.id }, x); })
        }),
        h('h3', { className: 'title' }, A.t('tg.cat.newH')),
        h('div', { className: 'row', style: { alignItems: 'flex-end', flexWrap: 'wrap' } },
          h(E.TextField, { label: A.t('tg.cat.name'), width: '12rem', value: newCat.name, placeholder: A.t('tg.cat.namePh'), onChange: function (ev) { n1[1](Object.assign({}, newCat, { name: ev.target.value })); } }),
          h(E.TextField, { label: A.t('tg.cat.col.weight'), type: 'number', min: 1, max: 10, width: '5.5rem', value: newCat.weight, onChange: function (ev) { n1[1](Object.assign({}, newCat, { weight: ev.target.value })); } }),
          h(E.Select, { label: A.t('tg.cat.col.color'), width: '7rem', value: newCat.color, options: COLORS.map(function (n) { return { value: 'cat-' + n, label: 'cat-' + n }; }), onChange: function (ev) { n1[1](Object.assign({}, newCat, { color: ev.target.value })); } }),
          h(E.Checkbox, { label: A.t('tg.cat.includeAvg'), checked: newCat.countsInAverage, onChange: function (ev) { n1[1](Object.assign({}, newCat, { countsInAverage: ev.target.checked })); } }),
          h(E.Button, { variant: 'secondary', icon: 'plus', onClick: addCat }, A.t('tg.cat.add'))));
    }

    function patchCat(row, patch, onFail) {
      A.api.patch('/api/grade-categories/' + row.id, patch).then(function (r) {
        cats.reload(); reloadAll();
        setLive(A.t('tg.live.catPatched', { n: r.category.name, w: r.category.weight, c: r.category.color, tail: A.t(r.category.countsInAverage ? 'tg.cat.inAvg' : 'tg.cat.outAvg') }));
      }).catch(function (err) { if (onFail) onFail(err); fail(err); });
    }
    function addCat() {
      A.api.post('/api/grade-categories', { name: newCat.name, weight: +newCat.weight, color: newCat.color, countsInAverage: newCat.countsInAverage, subjectId: pair ? pair.subjectId : null })
        .then(function (r) { n1[1]({ name: '', weight: '2', color: 'cat-8', countsInAverage: true }); cats.reload(); A.toast(A.t('tg.toast.catAdded', { n: r.category.name }), 'success'); setLive(A.t('tg.live.catAdded', { n: r.category.name, w: r.category.weight, c: r.category.color })); })
        .catch(fail);
    }

    function statsPanel() {
      var d = stats.data || {}; var dist = d.distribution || {};
      var max = Math.max.apply(null, [1].concat([1, 2, 3, 4, 5, 6].map(function (n) { return dist[n] || 0; })));
      return h('div', { className: 'grid-2' },
        h('div', { className: 'card' },
          h('h2', { className: 'title' }, A.t('tg.stats.dist')),
          [1, 2, 3, 4, 5, 6].map(function (n) { return h(E.ProgressBar, { key: n, label: A.t('tg.stats.grade', { n: n }), value: dist[n] || 0, max: max, valueText: String(dist[n] || 0), tone: n === 1 ? 'danger' : undefined }); }),
          h('p', { className: 'muted', style: { margin: 0 } }, A.t('tg.stats.outside', { a: d.npCount || 0, b: d.bzCount || 0 }))),
        h('div', { className: 'card' },
          h('h2', { className: 'title' }, A.t('tg.stats.avgH')),
          h(E.Table, {
            caption: A.t('tg.stats.avgCap'),
            columns: [
              { key: 'name', title: A.t('common.student') },
              { key: 'avg', title: A.t('common.average'), num: true },
              { key: 'count', title: A.t('tg.stats.col.count'), num: true },
              { key: 'status', title: A.t('common.status'), render: function (row) { return row.atRisk ? h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('tg.stats.atRisk')) : (row.entries === 0 ? h(E.Badge, { tone: 'outline' }, A.t('tg.stats.noGrades')) : h('span', { className: 'muted' }, A.t('tg.stats.ok'))); } }
            ],
            rows: (d.students || []).map(function (x) { return { id: x.studentId, name: x.no + '. ' + x.name, avg: A.fmtNum(x.average), count: x.count, entries: x.entries, atRisk: x.atRisk }; })
          })));
    }

    function remarksPanel() {
      var d = remarks.data || {};
      return h('div', { className: 'grid-2' },
        h('div', { className: 'card' },
          h('h2', { className: 'title' }, A.t('tg.rem.newH')),
          h(E.Select, { label: A.t('common.student'), value: rem.studentId, placeholder: A.t('tg.pickStudent'), options: students.map(function (x) { return { value: x.studentId, label: x.no + '. ' + x.name }; }), onChange: function (ev) { m1[1](Object.assign({}, rem, { studentId: ev.target.value })); } }),
          h(E.RadioGroup, { legend: A.t('tg.rem.kind'), row: true, value: rem.kind, options: [{ value: 'positive', label: kindLabel('positive') }, { value: 'negative', label: kindLabel('negative') }, { value: 'neutral', label: A.t('tg.rem.neutralOpt') }], onChange: function (v) { m1[1](Object.assign({}, rem, { kind: v })); } }),
          h(E.TextField, { label: A.t('tg.rem.text'), multiline: 2, value: rem.text, placeholder: A.t('tg.rem.textPh'), onChange: function (ev) { m1[1](Object.assign({}, rem, { text: ev.target.value })); } }),
          h(E.TextField, { label: A.t('tg.rem.points'), type: 'number', min: 0, max: 50, width: '8rem', value: rem.points, hint: A.t('tg.rem.pointsHint'), onChange: function (ev) { m1[1](Object.assign({}, rem, { points: ev.target.value })); } }),
          h(E.Button, {
            variant: 'secondary', icon: 'plus', onClick: function () {
              A.api.post('/api/remarks', { studentId: rem.studentId, kind: rem.kind, text: rem.text, points: rem.points === '' ? null : +rem.points })
                .then(function (r) { m1[1]({ studentId: '', kind: 'positive', text: '', points: '5' }); remarks.reload(); A.toast(A.t('tg.toast.remark'), 'success'); setLive(A.t('tg.live.remark', { kind: kindLabel(r.remark.kind).toLowerCase(), student: r.remark.student, applied: r.applied, total: r.points.total, grade: r.points.grade })); })
                .catch(fail);
            }
          }, A.t('tg.rem.save'))),
        h('div', { className: 'card' },
          h('h2', { className: 'title' }, A.t('tg.rem.classH')),
          h(E.Table, {
            caption: A.t('tg.rem.cap'),
            columns: [{ key: 'name', title: A.t('common.student') }, { key: 'total', title: A.t('tg.rem.col.points'), num: true }, { key: 'grade', title: A.t('tg.rem.col.grade') }, { key: 'counts', title: A.t('tg.rem.col.entries') }],
            rows: (d.students || []).map(function (x) { return { id: x.studentId, name: x.student, total: x.total, grade: x.grade, counts: '+' + x.positive + ' / −' + x.negative }; })
          }),
          h('div', { className: 'stack' }, (d.remarks || []).slice(0, 8).map(function (x) {
            /* Uwagę komentuje każdy, kto ją widzi — także rodzic i sam uczeń. */
            return h('div', { key: x.id, className: 'stack' },
              h(E.AuditEntry, {
                kind: x.kind === 'negative' ? 'edit' : 'create', actor: x.teacher,
                action: A.t('tg.rem.entry', { kind: (x.kind ? kindLabel(x.kind) : A.t('tg.rem.entryDefault')).toLowerCase(), p: (x.points > 0 ? '+' : '') + (x.points || 0) }),
                target: x.student, time: A.fmtDate(x.date), iso: x.date, reason: x.text
              }),
              h(window.EdLogComments.Toggle, { kind: 'remarks', entryId: x.id, counts: x.comments, onChange: remarks.reload }));
          }))));
    }

    function descriptivePanel() {
      var areas = (bank.data && bank.data.areas) || [];
      var area = areas.filter(function (a) { return a.area === desc.area; })[0];
      return h('div', { className: 'card' },
        h('h2', { className: 'title' }, A.t('tg.desc.h')),
        h('p', { className: 'muted', style: { marginTop: 0 } }, A.t('tg.desc.intro')),
        h(E.Select, { label: A.t('common.student'), value: desc.studentId, placeholder: A.t('tg.pickStudent'), options: students.map(function (x) { return { value: x.studentId, label: x.no + '. ' + x.name }; }), onChange: function (ev) { d1[1](Object.assign({}, desc, { studentId: ev.target.value })); } }),
        h(E.Select, { label: A.t('tg.desc.area'), value: desc.area, placeholder: A.t('tg.desc.areaPh'), options: areas.map(function (a) { return { value: a.area, label: a.area }; }), onChange: function (ev) { d1[1](Object.assign({}, desc, { area: ev.target.value, phraseIds: [] })); } }),
        area ? h('fieldset', { style: { border: 0, padding: 0, margin: 0 } },
          h('legend', { className: 'muted' }, A.t('tg.desc.bank', { area: area.area })),
          area.phrases.map(function (p) {
            return h(E.Checkbox, {
              key: p.id, label: p.text, checked: desc.phraseIds.indexOf(p.id) >= 0,
              onChange: function (ev) { var ids = desc.phraseIds.filter(function (x) { return x !== p.id; }); if (ev.target.checked) ids = ids.concat([p.id]); d1[1](Object.assign({}, desc, { phraseIds: ids })); }
            });
          })) : null,
        h(E.TextField, { label: A.t('tg.desc.own'), multiline: 2, value: desc.text, placeholder: A.t('tg.desc.ownPh'), onChange: function (ev) { d1[1](Object.assign({}, desc, { text: ev.target.value })); } }),
        h(E.Button, {
          variant: 'secondary', icon: 'check', onClick: function () {
            A.api.post('/api/descriptive-grades', { studentId: desc.studentId, semester: semester, area: desc.area, phraseIds: desc.phraseIds, text: desc.text })
              .then(function (r) { A.toast(A.t('tg.toast.desc'), 'success'); setLive(A.t('tg.live.desc', { student: r.student, area: r.descriptive.area, f: r.filled, t: r.total })); d1[1](Object.assign({}, desc, { phraseIds: [], text: '' })); })
              .catch(fail);
          }
        }, A.t('tg.desc.save')));
    }

    function revertDialog() {
      return h(E.Dialog, {
        title: A.t('tg.revert.title'), onClose: function () { setRevert(null); },
        actions: [
          h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setRevert(null); setLive(A.t('tg.live.revertCancelled')); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !revert.reason.trim(), onClick: doRevert }, A.t('tg.editor.revert'))
        ]
      },
        h('p', null, A.t('tg.revert.text1', { label: revert.label })),
        h('p', null, A.t('tg.revert.text2')),
        h(E.TextField, {
          label: A.t('tg.revert.reason'), required: true, 'data-autofocus': true, value: revert.reason,
          hint: A.t('tg.revert.reasonHint'), placeholder: A.t('tg.revert.reasonPh'),
          onChange: function (ev) { setRevert(Object.assign({}, revert, { reason: ev.target.value })); }
        }));
    }

    if (ctx.loading) return h('div', null, h('h1', { className: 'display app-title' }, A.t('common.grades')), h('p', { className: 'muted' }, A.t('common.loading')));
    if (!pair) return h('div', null, h('h1', { className: 'display app-title' }, A.t('common.grades')), h(E.Alert, { tone: 'info', title: A.t('tg.noPairTitle') }, A.t('tg.noPairText')));

    var teachesEdw = pairs.some(function (p) { return p.subjectId === 'edw'; });
    var tabs = [{ id: 'oceny', label: A.t('tg.tab.grades'), count: (stats.data && stats.data.total) || undefined }, { id: 'stat', label: A.t('tg.tab.stats') }, { id: 'uwagi', label: A.t('tg.tab.remarks') }];
    if (teachesEdw) tabs.push({ id: 'opis', label: A.t('tg.tab.desc') });

    return h('div', null,
      h('h1', { className: 'display app-title' }, A.t('tg.title', { s: A.subjectName(pair.subjectId, grid.data ? grid.data.subjectName : pair.subjectName), c: pair.className })),
      h('p', { className: 'app-sub' }, A.t('tg.sub', {
        who: A.userName(props.user), school: cfg.school ? cfg.school.short : '', year: cfg.year,
        students: A.plural(students.length, 'tg.students'), date: A.fmtDate(isoToday(cfg))
      })),
      fromLesson ? h('p', { style: { margin: '0 0 var(--space-3)' } }, h(E.Button, { size: 'sm', variant: 'quiet', href: '#/lekcja?lesson=' + encodeURIComponent(fromLesson) }, A.t('tg.backToLesson'))) : null,
      h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, live),
      pickerRow(),
      tiles(),
      h(E.Tabs, {
        label: A.t('tg.tabsLabel'), value: s.tab, tabs: tabs,
        onChange: function (v) { set({ tab: v }); A.navigate('/oceny', Object.assign({ klasa: pairKey(pair), semestr: String(semester), tab: v }, fromLesson ? { lekcja: fromLesson } : {})); }
      }, function (active) {
        if (active === 'stat') return statsPanel();
        if (active === 'uwagi') return remarksPanel();
        if (active === 'opis') return descriptivePanel();
        return h('div', { className: 'stack' },
          gridCard(),
          h('div', { className: 'grid-2' }, editorCard(), h('div', { className: 'stack' }, retakeCard(), exportCard())),
          categoryCard());
      }),
      revert ? revertDialog() : null);
  }

  A.screen({ id: 'teacher-grades', path: '/oceny', title: 'Oceny', roles: ['teacher', 'principal'], module: 'grades', nav: { key: 'nav.grades', label: 'Oceny', order: 20 }, component: Screen });
})();
