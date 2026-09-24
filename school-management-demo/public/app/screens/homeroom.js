/* 3.2 — Wychowawca klasy: klasyfikacja, usprawiedliwienia, dokumenty i sprawy klasy.
   Port ekranu HomeroomClassification z systemu projektowego, podpięty pod /api/homeroom/*. */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'hr.title': 'Klasa {c} · klasyfikacja i sprawy wychowawcze',
      'hr.sub.term': 'Semestr {n}',
      'hr.sub.meeting': 'posiedzenie klasyfikacyjne {d}',
      'hr.sub.tutor': 'wychowawca {t}',
      'hr.loadError': 'Nie udało się wczytać danych klasy',
      'hr.opFailed': 'Nie udało się wykonać operacji.',
      'hr.pick': '— wybierz —',
      'hr.tabs': 'Sekcje dziennika wychowawcy',
      'hr.tab.classification': 'Klasyfikacja',
      'hr.tab.excuses': 'Usprawiedliwienia',
      'hr.tab.documents': 'Dokumenty',
      'hr.tab.class': 'Klasa',
      'hr.stat.attendance': 'Frekwencja klasy',
      'hr.stat.attendanceHint': 'Od początku semestru do {d}',
      'hr.stat.average': 'Średnia klasy',
      'hr.stat.averageHint': 'Z ocen klasyfikacyjnych, proponowanych i bieżących',
      'hr.stat.atRisk': 'Zagrożeni',
      'hr.stat.atRiskHint': 'Ocena niedostateczna w klasyfikacji',
      'hr.stat.pending': 'Wnioski oczekujące',
      'hr.stat.pendingHint': 'Usprawiedliwienia od rodziców',
      'hr.stat.unread': 'Nieprzeczytane ostrzeżenia',
      'hr.stat.unreadHint': 'Pisma o zagrożeniu bez potwierdzenia odczytu',
      'hr.stat.logbook': 'Dziennik',
      'hr.stat.logbookHint': 'Status dziennika klasy',
      'hr.logbook.open': 'otwarty',
      'hr.logbook.submitted': 'przekazany',
      'hr.logbook.approved': 'zatwierdzony',
      'hr.locked.title': 'Semestr {n} zamknięty',
      'hr.locked.body': 'Oceny klasyfikacyjne są zablokowane. Zmiana wpisu wymaga formalnej zgody dyrekcji.',
      'hr.cl.heading': 'Oceny proponowane i klasyfikacyjne',
      'hr.cl.note': 'Zestawienie wszystkich przedmiotów klasy. Ocenę zachowania wychowawca ustala na podstawie punktów z uwag, frekwencji i opinii nauczycieli uczących.',
      'hr.cl.caption': 'Oceny proponowane i klasyfikacyjne · wszystkie przedmioty',
      'hr.cl.proposedOf': '{s}, ocena proponowana',
      'hr.cl.finalOf': '{s}, ocena klasyfikacyjna',
      'hr.cl.behavior': 'Zachowanie',
      'hr.cl.gradeLocked': 'ocena zablokowana',
      'hr.cl.behaviorFor': 'Ocena zachowania · {n}',
      'hr.badge.risk': 'Zagrożenie',
      'hr.badge.complete': 'Komplet',
      'hr.badge.inProgress': 'W toku',
      'hr.beh.heading': 'Propozycje ocen zachowania',
      'hr.beh.caption': 'Wyliczone propozycje ocen zachowania',
      'hr.beh.points': 'Punkty',
      'hr.beh.remarks': 'Uwagi +/−',
      'hr.beh.suggested': 'Propozycja systemu',
      'hr.beh.entered': 'Wpisana',
      'hr.beh.reason': 'Ustalona przez wychowawcę na podstawie punktów, frekwencji i uwag.',
      'hr.beh.saved': 'Zapisano ocenę zachowania: {v}.',
      'hr.risk.heading': 'Zagrożeni nieklasyfikowaniem',
      'hr.risk.alert': 'Ponad {p} % nieusprawiedliwionych nieobecności: {n}',
      'hr.risk.ok': 'Brak uczniów powyżej progu nieusprawiedliwionych nieobecności',
      'hr.risk.bar': 'Nieobecności nieusprawiedliwione · {s}',
      'hr.risk.barHint': '{h}; próg {p} % zaznaczony na skali.',
      'hr.risk.send': 'Wyślij ostrzeżenia do rodziców',
      'hr.risk.sent': 'Wysłano ostrzeżenia o zagrożeniu: {n} (termin: {d}).',
      'hr.close.heading': 'Zamknięcie semestru i przekazanie dziennika',
      'hr.close.lockedBadge': 'Semestr {n} zamknięty',
      'hr.close.logbookBadge': 'Dziennik: {s}',
      'hr.close.note': 'Po zamknięciu semestru nauczyciele przedmiotów nie wpiszą ani nie zmienią oceny z datą wstecz bez formalnej zgody dyrekcji. Odblokowanie należy wyłącznie do dyrektora.',
      'hr.close.btn': 'Zamknij semestr {n}',
      'hr.close.submit': 'Przekaż dziennik dyrektorowi',
      'hr.close.submitted': 'Dziennik klasy przekazany dyrektorowi do zatwierdzenia.',
      'hr.dlg.close.title': 'Zamknąć semestr {n} w klasie {c}?',
      'hr.dlg.close.p1': 'Zamknięcie blokuje nauczycielom przedmiotów zmiany ocen z datą wstecz. Odblokowanie wymaga decyzji dyrektora i zostanie zapisane w rejestrze.',
      'hr.dlg.close.p2': 'Ocen klasyfikacyjnych brakuje: {n}. Podstawa: uchwała Rady Pedagogicznej nr {res}.',
      'hr.dlg.close.early': 'Klasyfikacja jest zaplanowana na {d}. Wcześniejsze zamknięcie semestru wymaga podania podstawy — trafi ona do rejestru zmian.',
      'hr.dlg.close.reason': 'Podstawa wcześniejszego zamknięcia',
      'hr.dlg.close.reasonPh': 'np. uchwała Rady Pedagogicznej nr 3/2026/2027 z 26.01.2027',
      'hr.dlg.close.ok': 'Zamknij semestr',
      'hr.dlg.close.done': 'Semestr zamknięty. Nauczyciele przedmiotów nie zmienią ocen z datą wstecz bez zgody dyrekcji.',
      'hr.ex.heading': 'Wnioski o usprawiedliwienie',
      'hr.ex.note': 'Wnioski wpływają z kont rodziców. Zatwierdzenie zmienia nieobecności nb na u; odrzucenie wymaga podania powodu, który rodzic zobaczy w wiadomości.',
      'hr.ex.caption': 'Wnioski o usprawiedliwienie nieobecności',
      'hr.ex.selectAria': 'Zaznacz wniosek · {n}',
      'hr.ex.period': 'Okres',
      'hr.ex.attachment': 'Załącznik',
      'hr.ex.rejectReason': 'Powód odrzucenia: {r}',
      'hr.ex.hours': 'Do usprawiedliwienia godzin: {n}',
      'hr.ex.decision': 'Decyzja',
      'hr.ex.approve': 'Zatwierdź',
      'hr.ex.reject': 'Odrzuć',
      'hr.ex.approveAria': 'Zatwierdź wniosek · {n}',
      'hr.ex.rejectAria': 'Odrzuć wniosek · {n}',
      'hr.ex.approveSel': 'Zatwierdź zaznaczone',
      'hr.ex.rejectSel': 'Odrzuć zaznaczone',
      'hr.ex.counts': 'Oczekujących: {p} · zaznaczonych: {s}',
      'hr.ex.selectAll': 'Zaznacz wszystkie oczekujące',
      'hr.ex.clearSel': 'Odznacz wszystkie',
      'hr.ex.status.pending': 'Oczekuje',
      'hr.ex.status.approved': 'Zatwierdzone',
      'hr.ex.status.rejected': 'Odrzucone',
      'hr.ex.approved': 'Zatwierdzono wnioski: {n}. Nieobecności zapisano jako u (usprawiedliwione): {m}.',
      'hr.ex.rejected': 'Odrzucono wnioski: {n}. Powód wysłano rodzicom i zapisano w rejestrze.',
      'hr.dlg.reject.one': 'Odrzucić wniosek?',
      'hr.dlg.reject.many': 'Odrzucić zaznaczone wnioski?',
      'hr.dlg.reject.body': 'Wnioski: {names}. Nieobecności pozostaną oznaczone jako nb (nieusprawiedliwione).',
      'hr.dlg.reject.label': 'Powód odrzucenia',
      'hr.dlg.reject.ph': 'np. brak podanej przyczyny nieobecności',
      'hr.dlg.reject.hint': 'Powód zobaczy rodzic w wiadomości; trafia też do rejestru.',
      'hr.warn.heading': 'Ostrzeżenia o zagrożeniu · potwierdzenia odczytu',
      'hr.warn.note': 'Pisma wysyła się najpóźniej {d}, czyli {days} przed posiedzeniem klasyfikacyjnym {m}. Bez potwierdzenia odczytu: {u}.',
      'hr.warn.days.one': '{n} dzień',
      'hr.warn.days.few': '{n} dni',
      'hr.warn.days.many': '{n} dni',
      'hr.warn.noReceipt': 'bez potwierdzenia',
      'hr.warn.none': 'Nie wysłano jeszcze żadnego pisma o zagrożeniu.',
      'hr.doc.heading': 'Świadectwa',
      'hr.doc.note': 'Świadectwo z wyróżnieniem: średnia co najmniej {a} i zachowanie {b}. Na świadectwach drukowana jest adnotacja o uchwale Rady Pedagogicznej.',
      'hr.doc.caption': 'Świadectwa · średnia i zachowanie',
      'hr.doc.col': 'Świadectwo',
      'hr.doc.honours': 'Z wyróżnieniem',
      'hr.doc.or': ' lub ',
      'hr.doc.plain': 'zwykłe',
      'hr.doc.generate': 'Generuj świadectwa dla klasy',
      'hr.doc.print': 'Drukuj świadectwa (HTML → PDF)',
      'hr.doc.printHonours': 'Świadectwa z wyróżnieniem (seria)',
      'hr.doc.printTest': 'Wydruk próbny na blankiet MEN (18 mm)',
      'hr.doc.generated': 'Wygenerowano świadectwa: {n}, z wyróżnieniem: {hn}. {res}.',
      'hr.decl.heading': 'Sprawdź odmianę imion, nazwisk i miejsc urodzenia',
      'hr.decl.note': 'Blankiet MEN nie pozwala na korektę po wydruku, dlatego formy miejscownika sprawdza się przed generowaniem świadectw. Do sprawdzenia: {n}.',
      'hr.decl.first': 'Imię (miejscownik)',
      'hr.decl.last': 'Nazwisko (miejscownik)',
      'hr.decl.place': 'Miejsce urodzenia (miejscownik)',
      'hr.decl.rule': 'Reguła: {v}',
      'hr.decl.confirm': 'Potwierdź odmianę',
      'hr.decl.saved': 'Zapisano odmianę: {n}.',
      'hr.att.heading': 'Miesięczny raport frekwencji',
      'hr.att.month': 'Miesiąc',
      'hr.att.print': 'Drukuj raport',
      'hr.att.csv': 'Pobierz (CSV)',
      'hr.att.caption': 'Frekwencja klasy · {m}',
      'hr.att.excused': 'Usprawiedliwione',
      'hr.att.unexcused': 'Nieusprawiedliwione',
      'hr.att.late': 'Spóźnienia',
      'hr.att.early': 'Zwolnienia (zw)',
      'hr.ach.heading': 'Osiągnięcia szczególne',
      'hr.ach.note': 'Na świadectwie wolno umieścić wyłącznie osiągnięcia z listy dopuszczonej przepisami. Wpisów na świadectwie: {n}.',
      'hr.ach.kind': 'Rodzaj osiągnięcia',
      'hr.ach.text': 'Treść wpisu',
      'hr.ach.onCert': 'Wpisać na świadectwie',
      'hr.ach.save': 'Zapisz osiągnięcie',
      'hr.ach.saved': 'Zapisano osiągnięcie.',
      'hr.ach.caption': 'Zapisane osiągnięcia',
      'hr.ach.col': 'Osiągnięcie',
      'hr.ach.colCert': 'Na świadectwie',
      'hr.ach.archived': 'Zarchiwizowane',
      'hr.ach.no': 'nie',
      'hr.hist.heading': 'Oceny z poprzedniej szkoły',
      'hr.hist.note': 'Dla ucznia przeniesionego w trakcie cyklu kształcenia oceny z lat poprzednich wpisuje się do historii świadectw.',
      'hr.hist.year': 'Rok szkolny',
      'hr.hist.school': 'Szkoła',
      'hr.hist.schoolPh': 'Szkoła Podstawowa nr 3 w Zakopanem',
      'hr.hist.annual': 'Ocena roczna',
      'hr.hist.add': 'Dopisz do historii świadectw',
      'hr.hist.saved': 'Dopisano oceny do historii świadectw.',
      'hr.hist.rowsH': 'Wpisy w historii ucznia',
      'hr.hist.rowsNone': 'Ten uczeń nie ma jeszcze wpisów w historii świadectw.',
      'hr.roll.heading': 'Numery w dzienniku',
      'hr.roll.assign': 'Nadaj numery nowym uczniom',
      'hr.roll.renumber': 'Przenumeruj alfabetycznie',
      'hr.roll.renumberReason': 'Przenumerowanie alfabetyczne na polecenie wychowawcy.',
      'hr.roll.assigned': 'Nadano numery nowym uczniom: {n}. Pozostali zachowali swoje numery.',
      'hr.roll.renumbered': 'Przenumerowano alfabetycznie. Zmienionych numerów: {n}.',
      'hr.roll.caption': 'Numery w dzienniku',
      'hr.roll.no': 'Nr',
      'hr.roll.alpha': 'Alfabetycznie',
      'hr.roll.since': 'W klasie od',
      'hr.roll.sinceStart': 'od początku roku',
      'hr.flags.heading': 'Flagi ucznia',
      'hr.flags.note': 'Wychowawca poprawia flagi w swoim oddziale; sekretariat — w całej szkole. Każda zmiana zostawia wpis w rejestrze audytowym.',
      'hr.flags.welfare': 'Uczeń objęty pomocą społeczną',
      'hr.flags.welfareHint': 'Włącza 3-dniowy alert frekwencyjny dla pedagoga.',
      'hr.flags.adult': 'Uczeń pełnoletni',
      'hr.flags.selfExcuse': 'Usprawiedliwia się sam',
      'hr.flags.selfExcuseHint': 'Dostępne dopiero po zaznaczeniu pełnoletności.',
      'hr.flags.parentBlocked': 'Sprzeciw pełnoletniego wobec wglądu opiekunów',
      'hr.flags.saved': 'Zapisano flagi ucznia.',
      'hr.flags.loading': 'Wczytywanie flag…',
      'hr.rem.heading': 'Wypisanie ucznia',
      'hr.rem.note': 'Wypisanie na podstawie decyzji administracyjnej archiwizuje osiągnięcia ucznia. Dane nie są usuwane z bazy.',
      'hr.rem.btn': 'Wypisz ucznia z klasy',
      'hr.dlg.rem.title': 'Wypisać ucznia z klasy?',
      'hr.dlg.rem.body': 'Oceny, frekwencja i osiągnięcia zostaną zarchiwizowane i pozostaną dostępne w kartotece ucznia.',
      'hr.dlg.rem.decisionNo': 'Numer decyzji',
      'hr.dlg.rem.date': 'Data decyzji',
      'hr.dlg.rem.reason': 'Uzasadnienie',
      'hr.dlg.rem.ok': 'Wypisz i zarchiwizuj',
      'hr.dlg.rem.done': 'Uczeń wypisany. Zarchiwizowano osiągnięcia: {n}. Dane pozostają w bazie.',
      'hr.cast.heading': 'Wiadomość do Rady Rodziców',
      'hr.cast.members': 'Członkowie Rady Rodziców klasy: {n}',
      'hr.cast.audience': 'Odbiorcy',
      'hr.cast.council': 'Rada Rodziców klasy',
      'hr.cast.allParents': 'Wszyscy rodzice klasy',
      'hr.cast.subject': 'Temat',
      'hr.cast.body': 'Treść',
      'hr.cast.defSubject': 'Porządek zebrania z rodzicami',
      'hr.cast.defBody': 'W załączeniu porządek najbliższego zebrania z rodzicami klasy.',
      'hr.cast.sent.one': 'Wiadomość wysłana do {n} odbiorcy z załącznikiem.',
      'hr.cast.sent.few': 'Wiadomość wysłana do {n} odbiorców z załącznikiem.',
      'hr.cast.sent.many': 'Wiadomość wysłana do {n} odbiorców z załącznikiem.',
      'hr.grp.heading': 'Grupy międzyoddziałowe',
      'hr.grp.note': 'Uczniów swojej klasy można dopisać do grup zajęciowych utworzonych w innych oddziałach.',
      'hr.grp.members': 'uczestników: {n}',
      'hr.grp.mine': 'z mojej klasy: {s}',
      'hr.grp.nobody': 'nikt',
      'hr.grp.addAria': 'Dopisz ucznia do grupy {g}',
      'hr.grp.addOpt': '— dopisz ucznia —',
      'hr.grp.added': 'Dopisano ucznia do grupy {g}.',
      'hr.hrs.heading': 'Kontrola liczby godzin',
      'hr.hrs.ok': 'Liczba godzin zgodna z planem',
      'hr.hrs.bad': 'Rozbieżności: {n}',
      'hr.hrs.detail': 'Sprawdzono dni: {d}, godzin zapisanych: {r} wobec {p} z planu.',
      'hr.hrs.caption': 'Dni z rozbieżnością liczby godzin',
      'hr.hrs.day': 'Dzień',
      'hr.hrs.planned': 'Plan',
      'hr.hrs.recorded': 'Zapisano',
      'hr.hrs.note': 'Uwaga',
      'hr.print.heading': 'Wydruki dziennika',
      'hr.print.emergency': 'Strona alarmowa z kontaktami do rodziców',
      'hr.print.emergencyNote': 'Wydruk zawiera klauzulę poufności RODO.'
    },
    en: {
      'hr.title': 'Class {c} · classification and pastoral matters',
      'hr.sub.term': 'Semester {n}',
      'hr.sub.meeting': 'classification meeting {d}',
      'hr.sub.tutor': 'form tutor {t}',
      'hr.loadError': 'Could not load the class data',
      'hr.opFailed': 'The operation could not be completed.',
      'hr.pick': '— choose —',
      'hr.tabs': 'Form tutor sections',
      'hr.tab.classification': 'Classification',
      'hr.tab.excuses': 'Absence notes',
      'hr.tab.documents': 'Documents',
      'hr.tab.class': 'Class',
      'hr.stat.attendance': 'Class attendance',
      'hr.stat.attendanceHint': 'From the start of the semester to {d}',
      'hr.stat.average': 'Class average',
      'hr.stat.averageHint': 'From final, proposed and current grades',
      'hr.stat.atRisk': 'At risk',
      'hr.stat.atRiskHint': 'A fail grade at classification',
      'hr.stat.pending': 'Requests pending',
      'hr.stat.pendingHint': 'Absence notes from parents',
      'hr.stat.unread': 'Unread warnings',
      'hr.stat.unreadHint': 'Risk-of-failure letters with no read receipt',
      'hr.stat.logbook': 'Logbook',
      'hr.stat.logbookHint': 'Status of the class logbook',
      'hr.logbook.open': 'open',
      'hr.logbook.submitted': 'submitted',
      'hr.logbook.approved': 'approved',
      'hr.locked.title': 'Semester {n} closed',
      'hr.locked.body': 'Final grades are locked. Changing an entry requires formal approval from the head teacher.',
      'hr.cl.heading': 'Proposed and final grades',
      'hr.cl.note': 'All subjects taught in the class. The form tutor sets the behaviour grade from remark points, attendance and the opinions of the subject teachers.',
      'hr.cl.caption': 'Proposed and final grades · all subjects',
      'hr.cl.proposedOf': '{s}, proposed grade',
      'hr.cl.finalOf': '{s}, final grade',
      'hr.cl.behavior': 'Behaviour',
      'hr.cl.gradeLocked': 'grade locked',
      'hr.cl.behaviorFor': 'Behaviour grade · {n}',
      'hr.badge.risk': 'At risk',
      'hr.badge.complete': 'Complete',
      'hr.badge.inProgress': 'In progress',
      'hr.beh.heading': 'Proposed behaviour grades',
      'hr.beh.caption': 'Calculated proposals for behaviour grades',
      'hr.beh.points': 'Points',
      'hr.beh.remarks': 'Remarks +/−',
      'hr.beh.suggested': 'System suggestion',
      'hr.beh.entered': 'Entered',
      'hr.beh.reason': 'Set by the form tutor on the basis of points, attendance and remarks.',
      'hr.beh.saved': 'Behaviour grade saved: {v}.',
      'hr.risk.heading': 'At risk of not being classified',
      'hr.risk.alert': 'Over {p}% unexcused absence: {n}',
      'hr.risk.ok': 'No pupils above the unexcused-absence threshold',
      'hr.risk.bar': 'Unexcused absence · {s}',
      'hr.risk.barHint': '{h}; the {p}% threshold is marked on the scale.',
      'hr.risk.send': 'Send warnings to parents',
      'hr.risk.sent': 'Risk-of-failure warnings sent: {n} (deadline: {d}).',
      'hr.close.heading': 'Closing the semester and handing over the logbook',
      'hr.close.lockedBadge': 'Semester {n} closed',
      'hr.close.logbookBadge': 'Logbook: {s}',
      'hr.close.note': 'Once the semester is closed, subject teachers cannot enter or change a grade with a backdated date without formal approval from the head teacher. Only the head teacher can reopen it.',
      'hr.close.btn': 'Close semester {n}',
      'hr.close.submit': 'Hand the logbook to the head teacher',
      'hr.close.submitted': 'The class logbook has been handed to the head teacher for approval.',
      'hr.dlg.close.title': 'Close semester {n} in class {c}?',
      'hr.dlg.close.p1': 'Closing stops subject teachers from backdating grade changes. Reopening requires a decision by the head teacher and is written to the audit log.',
      'hr.dlg.close.p2': 'Final grades still missing: {n}. Basis: teaching council resolution no. {res}.',
      'hr.dlg.close.early': 'The classification meeting is set for {d}. Closing the semester earlier requires a written basis, which goes to the audit log.',
      'hr.dlg.close.reason': 'Basis for closing early',
      'hr.dlg.close.reasonPh': 'e.g. teaching council resolution no. 3/2026/2027 of 26.01.2027',
      'hr.dlg.close.ok': 'Close the semester',
      'hr.dlg.close.done': 'Semester closed. Subject teachers cannot backdate grade changes without the head teacher’s approval.',
      'hr.ex.heading': 'Absence notes to review',
      'hr.ex.note': 'Requests arrive from parent accounts. Approving turns nb absences into u (excused); rejecting requires a reason, which the parent sees in a message.',
      'hr.ex.caption': 'Requests to excuse an absence',
      'hr.ex.selectAria': 'Select request · {n}',
      'hr.ex.period': 'Period',
      'hr.ex.attachment': 'Attachment',
      'hr.ex.rejectReason': 'Reason for rejection: {r}',
      'hr.ex.hours': 'Lessons to be excused: {n}',
      'hr.ex.decision': 'Decision',
      'hr.ex.approve': 'Approve',
      'hr.ex.reject': 'Reject',
      'hr.ex.approveAria': 'Approve request · {n}',
      'hr.ex.rejectAria': 'Reject request · {n}',
      'hr.ex.approveSel': 'Approve selected',
      'hr.ex.rejectSel': 'Reject selected',
      'hr.ex.counts': 'Pending: {p} · selected: {s}',
      'hr.ex.selectAll': 'Select all pending',
      'hr.ex.clearSel': 'Clear the selection',
      'hr.ex.status.pending': 'Pending',
      'hr.ex.status.approved': 'Approved',
      'hr.ex.status.rejected': 'Rejected',
      'hr.ex.approved': 'Requests approved: {n}. Absences recorded as u (excused): {m}.',
      'hr.ex.rejected': 'Requests rejected: {n}. The reason was sent to parents and written to the log.',
      'hr.dlg.reject.one': 'Reject this request?',
      'hr.dlg.reject.many': 'Reject the selected requests?',
      'hr.dlg.reject.body': 'Requests: {names}. The absences stay marked as nb (unexcused).',
      'hr.dlg.reject.label': 'Reason for rejection',
      'hr.dlg.reject.ph': 'e.g. no reason for the absence given',
      'hr.dlg.reject.hint': 'The parent sees this reason in a message; it also goes to the audit log.',
      'hr.warn.heading': 'Risk-of-failure warnings · read receipts',
      'hr.warn.note': 'Letters go out by {d} at the latest, that is {days} before the classification meeting on {m}. Without a read receipt: {u}.',
      'hr.warn.days.one': '{n} day',
      'hr.warn.days.other': '{n} days',
      'hr.warn.noReceipt': 'no receipt',
      'hr.warn.none': 'No risk-of-failure letter has been sent yet.',
      'hr.doc.heading': 'School certificates',
      'hr.doc.note': 'Certificate with distinction: an average of at least {a} and behaviour graded {b}. Certificates carry a note about the teaching council resolution.',
      'hr.doc.caption': 'Certificates · average and behaviour',
      'hr.doc.col': 'Certificate',
      'hr.doc.honours': 'With distinction',
      'hr.doc.or': ' or ',
      'hr.doc.plain': 'standard',
      'hr.doc.generate': 'Generate certificates for the class',
      'hr.doc.print': 'Print certificates (HTML → PDF)',
      'hr.doc.printHonours': 'Certificates with distinction (batch)',
      'hr.doc.printTest': 'Test print on the ministry form (18 mm)',
      'hr.doc.generated': 'Certificates generated: {n}, with distinction: {hn}. {res}.',
      'hr.decl.heading': 'Check the locative forms of names and birthplaces',
      'hr.decl.note': 'The official ministry form cannot be corrected once printed, so the Polish locative forms are checked before the certificates are generated. To check: {n}.',
      'hr.decl.first': 'First name (locative)',
      'hr.decl.last': 'Surname (locative)',
      'hr.decl.place': 'Place of birth (locative)',
      'hr.decl.rule': 'Rule: {v}',
      'hr.decl.confirm': 'Confirm the forms',
      'hr.decl.saved': 'Forms saved: {n}.',
      'hr.att.heading': 'Monthly attendance report',
      'hr.att.month': 'Month',
      'hr.att.print': 'Print the report',
      'hr.att.csv': 'Download (CSV)',
      'hr.att.caption': 'Class attendance · {m}',
      'hr.att.excused': 'Excused',
      'hr.att.unexcused': 'Unexcused',
      'hr.att.late': 'Late arrivals',
      'hr.att.early': 'Early leave (zw)',
      'hr.ach.heading': 'Special achievements',
      'hr.ach.note': 'Only achievements from the list allowed by the regulations may go on a certificate. Entries on certificates: {n}.',
      'hr.ach.kind': 'Type of achievement',
      'hr.ach.text': 'Wording of the entry',
      'hr.ach.onCert': 'Print on the certificate',
      'hr.ach.save': 'Save the achievement',
      'hr.ach.saved': 'Achievement saved.',
      'hr.ach.caption': 'Recorded achievements',
      'hr.ach.col': 'Achievement',
      'hr.ach.colCert': 'On certificate',
      'hr.ach.archived': 'Archived',
      'hr.ach.no': 'no',
      'hr.hist.heading': 'Grades from a previous school',
      'hr.hist.note': 'For a pupil who transferred mid-cycle, the grades from earlier years are added to the certificate history.',
      'hr.hist.year': 'School year',
      'hr.hist.school': 'School',
      'hr.hist.schoolPh': 'Primary School No. 3 in Zakopane',
      'hr.hist.annual': 'Year-end grade',
      'hr.hist.add': 'Add to the certificate history',
      'hr.hist.saved': 'The grades were added to the certificate history.',
      'hr.hist.rowsH': 'Entries in the pupil history',
      'hr.hist.rowsNone': 'This pupil has no certificate history entries yet.',
      'hr.roll.heading': 'Roll numbers',
      'hr.roll.assign': 'Assign numbers to new pupils',
      'hr.roll.renumber': 'Renumber alphabetically',
      'hr.roll.renumberReason': 'Alphabetical renumbering ordered by the form tutor.',
      'hr.roll.assigned': 'Numbers assigned to new pupils: {n}. The others kept their numbers.',
      'hr.roll.renumbered': 'Renumbered alphabetically. Numbers changed: {n}.',
      'hr.roll.caption': 'Roll numbers',
      'hr.roll.no': 'No.',
      'hr.roll.alpha': 'Alphabetical',
      'hr.roll.since': 'In the class since',
      'hr.roll.sinceStart': 'since the start of the year',
      'hr.flags.heading': 'Pupil flags',
      'hr.flags.note': 'The homeroom teacher edits the flags of their own class; the registrar those of the whole school. Every change leaves a row in the audit log.',
      'hr.flags.welfare': 'Pupil under social welfare',
      'hr.flags.welfareHint': 'Turns on the three-day attendance alert for the counsellor.',
      'hr.flags.adult': 'Pupil of age',
      'hr.flags.selfExcuse': 'Excuses their own absences',
      'hr.flags.selfExcuseHint': 'Available only once the pupil is marked as of age.',
      'hr.flags.parentBlocked': 'Adult pupil objects to guardian access',
      'hr.flags.saved': 'Pupil flags saved.',
      'hr.flags.loading': 'Loading flags…',
      'hr.rem.heading': 'Removing a pupil',
      'hr.rem.note': 'Removal on the basis of an administrative decision archives the pupil’s achievements. No data is deleted from the database.',
      'hr.rem.btn': 'Remove the pupil from the class',
      'hr.dlg.rem.title': 'Remove the pupil from the class?',
      'hr.dlg.rem.body': 'Grades, attendance and achievements are archived and stay available in the pupil’s record.',
      'hr.dlg.rem.decisionNo': 'Decision number',
      'hr.dlg.rem.date': 'Date of the decision',
      'hr.dlg.rem.reason': 'Justification',
      'hr.dlg.rem.ok': 'Remove and archive',
      'hr.dlg.rem.done': 'Pupil removed. Achievements archived: {n}. The data stays in the database.',
      'hr.cast.heading': 'Message to the Parents’ Council (Rada Rodziców)',
      'hr.cast.members': 'Members of the class Parents’ Council: {n}',
      'hr.cast.audience': 'Recipients',
      'hr.cast.council': 'Class Parents’ Council',
      'hr.cast.allParents': 'All parents in the class',
      'hr.cast.subject': 'Subject',
      'hr.cast.body': 'Message',
      'hr.cast.defSubject': 'Agenda for the parents’ meeting',
      'hr.cast.defBody': 'Please find attached the agenda for the next parents’ meeting of the class.',
      'hr.cast.sent.one': 'Message sent to {n} recipient with an attachment.',
      'hr.cast.sent.other': 'Message sent to {n} recipients with an attachment.',
      'hr.grp.heading': 'Cross-class groups',
      'hr.grp.note': 'Pupils from your class can be added to teaching groups set up in other classes.',
      'hr.grp.members': 'members: {n}',
      'hr.grp.mine': 'from my class: {s}',
      'hr.grp.nobody': 'nobody',
      'hr.grp.addAria': 'Add a pupil to the group {g}',
      'hr.grp.addOpt': '— add a pupil —',
      'hr.grp.added': 'Pupil added to the group {g}.',
      'hr.hrs.heading': 'Lesson-count check',
      'hr.hrs.ok': 'The number of lessons matches the timetable',
      'hr.hrs.bad': 'Discrepancies: {n}',
      'hr.hrs.detail': 'Days checked: {d}, lessons recorded: {r} against {p} on the timetable.',
      'hr.hrs.caption': 'Days where the lesson count differs',
      'hr.hrs.day': 'Day',
      'hr.hrs.planned': 'Timetable',
      'hr.hrs.recorded': 'Recorded',
      'hr.hrs.note': 'Note',
      'hr.print.heading': 'Logbook printouts',
      'hr.print.emergency': 'Emergency sheet with parent contacts',
      'hr.print.emergencyNote': 'The printout carries a GDPR confidentiality clause.'
    }
  });

  function fmt(v) { return v == null ? '—' : A.fmtNum(v); }
  function openPrint(path) { A.openPrint(path + (path.indexOf('?') >= 0 ? '&' : '?') + 'print=1'); }
  function err(e) { A.toast((e && e.message) || A.t('hr.opFailed'), 'danger'); }
  function logbookLabel(s) { return A.t('hr.logbook.' + (s || 'open')); }

  function Screen(props) {
    var st = React.useState((props.route && props.route.query && props.route.query.tab) || 'klasyfikacja'), tab = st[0], setTab0 = st[1];
    /* The shell remounts the screen on a language change, so the tab has to live in the URL (as on /oceny). */
    function setTab(v) { setTab0(v); A.navigate('/wychowawca', { tab: v }); }
    var pickedSt = React.useState([]), picked = pickedSt[0], setPicked = pickedSt[1];
    var rejectSt = React.useState(null), reject = rejectSt[0], setReject = rejectSt[1];
    var reasonSt = React.useState(''), reason = reasonSt[0], setReason = reasonSt[1];
    var closeSt = React.useState(false), closeOpen = closeSt[0], setCloseOpen = closeSt[1];
    var closeReasonSt = React.useState(''), closeReason = closeReasonSt[0], setCloseReason = closeReasonSt[1];
    var removeSt = React.useState({ open: false, studentId: '', decisionNo: '', date: '2027-01-26', reason: '' }), rem = removeSt[0], setRem = removeSt[1];
    var castSt = React.useState({ subject: A.t('hr.cast.defSubject'), body: A.t('hr.cast.defBody'), audience: 'council' }), cast = castSt[0], setCast = castSt[1];
    var monthSt = React.useState(null), month = monthSt[0], setMonth = monthSt[1];
    var achSt = React.useState({ studentId: '', kind: 'konkurs_wojewodzki', title: '', onCertificate: true }), ach = achSt[0], setAch = achSt[1];
    var histSt = React.useState({ studentId: '', schoolYear: '2025/2026', className: '6a', schoolName: '', subjectId: 'mat', value: '4' }), hist = histSt[0], setHist = histSt[1];
    var declSt = React.useState({}), decl = declSt[0], setDecl = declSt[1];
    var flagSt = React.useState({ studentId: '' }), flags = flagSt[0], setFlags = flagSt[1];
    var saySt = React.useState(''), say = saySt[0], setSay = saySt[1];

    var ov = A.useApi('/api/homeroom/overview', []);
    var cls = A.useApi('/api/homeroom/classification', []);
    var beh = A.useApi('/api/homeroom/behavior', []);
    var risk = A.useApi('/api/homeroom/at-risk', []);
    var exc = A.useApi('/api/homeroom/excuses', []);
    var rec = A.useApi('/api/homeroom/warnings', []);
    var hon = A.useApi('/api/homeroom/honours', []);
    var dec = A.useApi('/api/homeroom/declension', []);
    var roll = A.useApi('/api/homeroom/roll-call', []);
    var council = A.useApi('/api/homeroom/council', []);
    var grp = A.useApi('/api/homeroom/groups', []);
    var hours = A.useApi('/api/homeroom/hours-check', []);
    var book = A.useApi('/api/homeroom/logbook', []);
    var achs = A.useApi('/api/homeroom/achievements', []);
    var curMonth = month || (ov.data ? ov.data.today.slice(0, 7) : '2026-10');
    var att = A.useApi('/api/homeroom/attendance/monthly?month=' + curMonth, [curMonth]);
    /* GAP-4 — flagi ucznia (pomoc społeczna, pełnoletność) idą tą samą trasą, co w sekretariacie. */
    var flagRow = A.useApi(flags.studentId ? '/api/registry/students/' + flags.studentId + '/flags' : null, [flags.studentId]);
    /* Historia świadectw wybranego ucznia — tylko po to, żeby każdy wiersz dało się skomentować. */
    var histRows = A.useApi(hist.studentId ? '/api/homeroom/history/' + encodeURIComponent(hist.studentId) : null, [hist.studentId]);
    function patchFlags(body) {
      A.api.patch('/api/registry/students/' + flags.studentId + '/flags', body)
        .then(function () { afterWrite(A.t('hr.flags.saved'), [flagRow]); }).catch(err);
    }

    /* E.Dialog restores focus to the button that opened it — which a decision has just disabled, so focus
       would fall back to <body>. Park it on the status line instead. */
    function announce(msg) { setSay(msg); setTimeout(function () { var el = document.getElementById('hr-say'); if (el) el.focus(); }, 0); }
    function afterWrite(text, list) { announce(text); A.toast(text, 'success'); (list || []).forEach(function (x) { x.reload(); }); }

    var o = ov.data || {}, C = cls.data, students = (C && C.students) || [];
    /* Zamknięcie semestru przed posiedzeniem rady serwer odrzuca (409 too_early) — dialog prosi wtedy o podstawę. */
    var earlyClose = !!(o.classificationMeeting && o.today && o.today < o.classificationMeeting);
    var subjects = ((C && C.subjects) || []).filter(function (s) {
      return students.some(function (st2) { var g = st2.subjects[s.id]; return g && (g.value || g.average != null); });
    });
    var pendingExcuses = (exc.data ? exc.data.excuses : []).filter(function (x) { return x.status === 'pending'; });

    /* ---------------- zapis ocen ---------------- */
    function setBehavior(studentId, value) {
      A.api.post('/api/homeroom/behavior', { studentId: studentId, value: value, kind: 'proposed', reason: A.t('hr.beh.reason') })
        .then(function () { afterWrite(A.t('hr.beh.saved', { v: value }), [beh, cls, hon]); }).catch(err);
    }
    function decideExcuses(ids, decision, why) {
      A.api.post('/api/homeroom/excuses/decide', { ids: ids, decision: decision, reason: why })
        .then(function (r) {
          setPicked([]); setReject(null); setReason('');
          afterWrite(decision === 'approve'
            ? A.t('hr.ex.approved', { n: r.count, m: r.changedAttendance })
            : A.t('hr.ex.rejected', { n: r.count }), [exc, ov, risk]);
        }).catch(err);
    }

    /* ---------------- zakładka: klasyfikacja ---------------- */
    function panelKlasyfikacja() {
      var behBy = {}; ((beh.data && beh.data.students) || []).forEach(function (b) { behBy[b.studentId] = b; });
      var cols = [{ key: 'name', title: A.t('common.student'), render: function (r) { return r.name; } }]
        .concat(subjects.map(function (sub) {
          var subName = A.subjectName(sub.id, sub.name);
          return { key: sub.id, title: subName, render: function (r) {
            var g = r.subjects[sub.id] || {};
            return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', whiteSpace: 'nowrap' } },
              h(E.GradeCell, { value: g.proposed || '', proposed: true, student: r.name, categoryName: A.t('hr.cl.proposedOf', { s: subName }) }),
              h('span', { className: 'muted', 'aria-hidden': 'true' }, '→'),
              h(E.GradeCell, { value: g.final || '', locked: !!g.final && o.locked, student: r.name, categoryName: A.t('hr.cl.finalOf', { s: subName }) }));
          } };
        }))
        .concat([
          { key: 'sr', title: A.t('common.average'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, fmt(r.average != null ? r.average : r.runningAverage)); } },
          { key: 'zach', title: A.t('hr.cl.behavior'), render: function (r) {
            var b = behBy[r.studentId] || {};
            if (o.locked) return h('span', null, r.behavior.value || '—', ' ', h(E.Icon, { name: 'lock', size: 14, label: A.t('hr.cl.gradeLocked') }));
            return h(E.Select, { label: '', 'aria-label': A.t('hr.cl.behaviorFor', { n: r.name }), width: 160, value: r.behavior.value || b.suggested || '', options: ((beh.data && beh.data.scale) || []).map(function (v) { return { value: v, label: v }; }), onChange: function (ev) { setBehavior(r.studentId, ev.target.value); } });
          } },
          { key: 'stat', title: A.t('common.status'), render: function (r) {
            if (r.failing.length) return h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('hr.badge.risk'));
            return r.complete ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('hr.badge.complete')) : h(E.Badge, { tone: 'outline' }, A.t('hr.badge.inProgress'));
          } }
        ]);
      return h('div', { className: 'stack' },
        h('section', { className: 'card', 'aria-labelledby': 'h-klas' },
          h('h2', { id: 'h-klas' }, A.t('hr.cl.heading')),
          h('p', { className: 'muted' }, A.t('hr.cl.note')),
          cls.loading ? h('p', null, A.t('common.loading')) : h(E.Table, { caption: A.t('hr.cl.caption'), columns: cols, rows: students.map(function (s) { return Object.assign({ id: s.studentId }, s); }) }),
          h('p', { id: 'hr-say', tabIndex: -1, className: 'muted', role: 'status', 'aria-live': 'polite' }, say)),
        h('section', { className: 'card', 'aria-labelledby': 'h-beh' },
          h('h2', { id: 'h-beh' }, A.t('hr.beh.heading')),
          h(E.Table, { caption: A.t('hr.beh.caption'), columns: [
            { key: 'n', title: A.t('common.student'), render: function (b) { return b.name; } },
            { key: 'p', title: A.t('hr.beh.points'), num: true, render: function (b) { return h('span', { className: 'ed-num' }, b.points); } },
            { key: 'u', title: A.t('hr.beh.remarks'), render: function (b) { return b.positive + ' / ' + b.negative; } },
            { key: 'f', title: A.t('common.attendance'), num: true, render: function (b) { return h('span', { className: 'ed-num' }, A.fmtPct(b.attendancePercent)); } },
            { key: 's', title: A.t('hr.beh.suggested'), render: function (b) { return h(E.Badge, { tone: 'outline' }, b.suggested); } },
            { key: 'c', title: A.t('hr.beh.entered'), render: function (b) { return b.current.value || '—'; } }
          ], rows: ((beh.data && beh.data.students) || []).map(function (b) { return Object.assign({ id: b.studentId }, b); }) })),
        h('section', { className: 'card', 'aria-labelledby': 'h-risk' },
          h('h2', { id: 'h-risk' }, A.t('hr.risk.heading')),
          risk.data && risk.data.count
            ? h(E.Alert, { tone: 'danger', title: A.t('hr.risk.alert', { p: risk.data.threshold, n: risk.data.count }) }, h('p', null, risk.data.note))
            : h(E.Alert, { tone: 'success', title: A.t('hr.risk.ok') }, h('p', null, (risk.data && risk.data.note) || '')),
          ((risk.data && risk.data.students) || []).map(function (r) {
            return h('div', { key: r.studentId, className: 'mt-4' },
              h('div', { className: 'body-strong' }, r.name),
              h(E.ProgressBar, { label: A.t('hr.risk.bar', { s: r.worst.subject }), value: r.worst.percent, valueText: A.fmtPct(r.worst.percent), tone: 'danger', mark: risk.data.threshold, hint: A.t('hr.risk.barHint', { h: r.worst.hours, p: risk.data.threshold }) }));
          }),
          h('div', { className: 'row mt-4' },
            h(E.Button, { icon: 'bell', onClick: function () {
              A.api.post('/api/homeroom/warnings', {}).then(function (r) { afterWrite(A.t('hr.risk.sent', { n: r.sent, d: A.fmtDate(r.deadline) }), [rec, ov]); }).catch(err);
            } }, A.t('hr.risk.send')))),
        h('section', { className: 'card', 'aria-labelledby': 'h-close' },
          h('h2', { id: 'h-close' }, A.t('hr.close.heading')),
          o.locked
            ? h('div', { className: 'row' }, h(E.Badge, { tone: 'outline', icon: 'lock' }, A.t('hr.close.lockedBadge', { n: o.semester })), h(E.Badge, { tone: book.data && book.data.status === 'approved' ? 'success' : 'accent', icon: 'shield' }, A.t('hr.close.logbookBadge', { s: logbookLabel(book.data && book.data.status) })))
            : h('p', null, A.t('hr.close.note')),
          h('div', { className: 'row mt-4' },
            !o.locked && h(E.Button, { variant: 'primary', icon: 'lock', onClick: function () { setCloseOpen(true); } }, A.t('hr.close.btn', { n: o.semester || 1 })),
            o.locked && h(E.Button, { icon: 'shield', disabled: !!(book.data && book.data.status !== 'open'), onClick: function () {
              A.api.post('/api/homeroom/logbook/submit', {}).then(function () { afterWrite(A.t('hr.close.submitted'), [book, ov]); }).catch(err);
            } }, A.t('hr.close.submit'))),
          book.data ? h(window.EdLogComments.Toggle, { kind: 'homeroom-logbook', entryId: book.data.classId, counts: book.data.comments, onChange: book.reload }) : null));
    }

    /* ---------------- zakładka: usprawiedliwienia ---------------- */
    function panelUsprawiedliwienia() {
      var rows = (exc.data ? exc.data.excuses : []);
      var STATUS = { pending: ['accent', 'pending'], approved: ['success', 'approved'], rejected: ['danger', 'rejected'] };
      var cols = [
        { key: 'sel', title: A.t('common.student'), render: function (r) {
          return h('span', { className: 'row', style: { gap: 'var(--space-2)' } },
            h(E.Checkbox, { label: '', 'aria-label': A.t('hr.ex.selectAria', { n: r.student }), checked: picked.indexOf(r.id) >= 0, disabled: r.status !== 'pending', onChange: function () { setPicked(picked.indexOf(r.id) >= 0 ? picked.filter(function (x) { return x !== r.id; }) : picked.concat([r.id])); } }),
            r.student);
        } },
        { key: 'okres', title: A.t('hr.ex.period'), render: function (r) { return A.fmtDate(r.from) + (r.to !== r.from ? ' – ' + A.fmtDate(r.to) : ''); } },
        { key: 'powod', title: A.t('common.reason'), render: function (r) {
          return h('span', { className: 'stack', style: { gap: 'var(--space-1)' } },
            h('span', null, r.reason, ' ', r.attachment ? h(E.Badge, { tone: 'info', icon: 'file' }, A.t('hr.ex.attachment')) : null),
            r.rejectReason ? h('span', { className: 'muted' }, A.t('hr.ex.rejectReason', { r: r.rejectReason })) : null,
            r.status === 'pending' && r.affectedLessons ? h('span', { className: 'muted' }, A.t('hr.ex.hours', { n: r.affectedLessons })) : null);
        } },
        { key: 'status', title: A.t('common.status'), render: function (r) { var s = STATUS[r.status]; return s ? h(E.Badge, { tone: s[0] }, A.t('hr.ex.status.' + s[1])) : h(E.Badge, { tone: 'outline' }, r.status); } },
        { key: 'akcje', title: A.t('hr.ex.decision'), render: function (r) {
          return h('span', { className: 'row', style: { gap: 'var(--space-2)' } },
            h(E.Button, { size: 'sm', disabled: r.status !== 'pending', 'aria-label': A.t('hr.ex.approveAria', { n: r.student }), onClick: function () { decideExcuses([r.id], 'approve'); } }, A.t('hr.ex.approve')),
            h(E.Button, { size: 'sm', variant: 'secondary', disabled: r.status !== 'pending', 'aria-label': A.t('hr.ex.rejectAria', { n: r.student }), onClick: function () { setReason(''); setReject({ ids: [r.id], names: [r.student] }); } }, A.t('hr.ex.reject')));
        } }
      ];
      return h('div', { className: 'stack' },
        h('section', { className: 'card', 'aria-labelledby': 'h-uspr' },
          h('h2', { id: 'h-uspr' }, A.t('hr.ex.heading')),
          h('p', { className: 'muted' }, A.t('hr.ex.note')),
          h('div', { className: 'row mb-4' },
            h(E.Button, { variant: 'primary', disabled: !picked.length, onClick: function () { decideExcuses(picked, 'approve'); } }, A.t('hr.ex.approveSel') + (picked.length ? ' (' + picked.length + ')' : '')),
            h(E.Button, { variant: 'secondary', disabled: !picked.length, onClick: function () { setReason(''); setReject({ ids: picked, names: rows.filter(function (x) { return picked.indexOf(x.id) >= 0; }).map(function (x) { return x.student; }) }); } }, A.t('hr.ex.rejectSel')),
            h(E.Button, { variant: 'quiet', disabled: !pendingExcuses.length || picked.length === pendingExcuses.length, onClick: function () { setPicked(pendingExcuses.map(function (x) { return x.id; })); } }, A.t('hr.ex.selectAll')),
            h(E.Button, { variant: 'quiet', disabled: !picked.length, onClick: function () { setPicked([]); } }, A.t('hr.ex.clearSel')),
            h('span', { className: 'muted' }, A.t('hr.ex.counts', { p: pendingExcuses.length, s: picked.length }))),
          h(E.Table, { caption: A.t('hr.ex.caption'), columns: cols, rows: rows.map(function (r) { return Object.assign({ selected: picked.indexOf(r.id) >= 0 }, r); }) }),
          h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, say)),
        h('section', { className: 'card', 'aria-labelledby': 'h-rec' },
          h('h2', { id: 'h-rec' }, A.t('hr.warn.heading')),
          rec.data && h('p', { className: 'muted' }, A.t('hr.warn.note', { d: A.fmtDate(rec.data.deadline), days: A.plural(rec.data.daysBefore, 'hr.warn.days'), m: A.fmtDate(rec.data.classificationMeeting), u: rec.data.unread })),
          ((rec.data && rec.data.warnings) || []).map(function (m) {
            return h('div', { key: m.messageId, className: 'stack', style: { gap: 'var(--space-1)', marginBottom: 'var(--space-3)' } },
              m.recipients.map(function (p) {
                return h(E.MessageItem, { key: m.messageId + p.userId, from: p.name, role: p.role, subject: m.subject, preview: m.preview, time: A.fmtDate(m.at), receipt: p.receipt, receiptDetail: p.receiptAt ? A.fmtDateTime(p.receiptAt) : A.t('hr.warn.noReceipt') });
              }));
          }),
          !(rec.data && rec.data.sent) && h('p', { className: 'muted' }, A.t('hr.warn.none'))));
    }

    /* ---------------- zakładka: dokumenty ---------------- */
    function panelDokumenty() {
      var honRows = (hon.data && hon.data.students) || [];
      var declRows = (dec.data && dec.data.students) || [];
      return h('div', { className: 'stack' },
        h('section', { className: 'card', 'aria-labelledby': 'h-swiad' },
          h('h2', { id: 'h-swiad' }, A.t('hr.doc.heading')),
          h('p', { className: 'muted' }, A.t('hr.doc.note', { a: fmt(hon.data && hon.data.honorsAverage), b: ((hon.data && hon.data.honorsBehavior) || []).join(A.t('hr.doc.or')) })),
          h(E.Table, { caption: A.t('hr.doc.caption'), columns: [
            { key: 'n', title: A.t('common.student'), render: function (r) { return r.name; } },
            { key: 'a', title: A.t('common.average'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, fmt(r.average)); } },
            { key: 'b', title: A.t('hr.cl.behavior'), render: function (r) { return r.behavior || '—'; } },
            { key: 'h', title: A.t('hr.doc.col'), render: function (r) { return r.honours ? h(E.Badge, { tone: 'brand', icon: 'check' }, A.t('hr.doc.honours')) : h('span', { className: 'muted' }, A.t('hr.doc.plain')); } }
          ], rows: honRows.map(function (r) { return Object.assign({ id: r.studentId }, r); }) }),
          h('div', { className: 'row mt-4' },
            h(E.Button, { variant: 'primary', icon: 'file', onClick: function () {
              A.api.post('/api/homeroom/report-cards', { resolutionNo: '3/2026/2027' }).then(function (r) { afterWrite(A.t('hr.doc.generated', { n: r.count, hn: r.honours, res: r.resolution }), [hon]); }).catch(err);
            } }, A.t('hr.doc.generate')),
            h(E.Button, { icon: 'print', onClick: function () { openPrint('/api/homeroom/report-cards/print'); } }, A.t('hr.doc.print')),
            h(E.Button, { icon: 'print', onClick: function () { openPrint('/api/homeroom/print/honours'); } }, A.t('hr.doc.printHonours')),
            h(E.Button, { icon: 'print', onClick: function () { openPrint('/api/homeroom/print/test-certificate'); } }, A.t('hr.doc.printTest')))),
        h('section', { className: 'card', 'aria-labelledby': 'h-odm' },
          h('h2', { id: 'h-odm' }, A.t('hr.decl.heading')),
          h('p', { className: 'muted' }, A.t('hr.decl.note', { n: (dec.data && dec.data.flagged) || 0 })),
          declRows.slice(0, 6).map(function (r) {
            var v = decl[r.studentId] || {};
            return h('div', { key: r.studentId, className: 'card mt-4' },
              h('h3', null, r.name),
              h('p', { className: 'muted' }, r.formula),
              h('div', { className: 'grid-3' },
                h(E.TextField, { label: A.t('hr.decl.first'), value: v.firstNameLocative != null ? v.firstNameLocative : (r.stored.firstNameLocative || r.suggested.firstNameLocative), hint: A.t('hr.decl.rule', { v: r.suggested.firstNameLocative }), onChange: function (ev) { var n = {}; n[r.studentId] = Object.assign({}, v, { firstNameLocative: ev.target.value }); setDecl(Object.assign({}, decl, n)); } }),
                h(E.TextField, { label: A.t('hr.decl.last'), value: v.lastNameLocative != null ? v.lastNameLocative : (r.stored.lastNameLocative || r.suggested.lastNameLocative), hint: A.t('hr.decl.rule', { v: r.suggested.lastNameLocative }), onChange: function (ev) { var n = {}; n[r.studentId] = Object.assign({}, v, { lastNameLocative: ev.target.value }); setDecl(Object.assign({}, decl, n)); } }),
                h(E.TextField, { label: A.t('hr.decl.place'), value: v.birthPlaceLocative != null ? v.birthPlaceLocative : (r.stored.birthPlaceLocative || r.suggested.birthPlaceLocative), hint: A.t('hr.decl.rule', { v: r.suggested.birthPlaceLocative }), onChange: function (ev) { var n = {}; n[r.studentId] = Object.assign({}, v, { birthPlaceLocative: ev.target.value }); setDecl(Object.assign({}, decl, n)); } })),
              h('div', { className: 'row mt-2' },
                h(E.Button, { size: 'sm', icon: 'check', onClick: function () {
                  A.api.patch('/api/homeroom/declension/' + r.studentId, Object.assign({ accept: true }, v)).then(function () { afterWrite(A.t('hr.decl.saved', { n: r.name }), [dec]); }).catch(err);
                } }, A.t('hr.decl.confirm'))));
          })),
        h('section', { className: 'card', 'aria-labelledby': 'h-raport' },
          h('h2', { id: 'h-raport' }, A.t('hr.att.heading')),
          h('div', { className: 'row mb-4' },
            h(E.Select, { label: A.t('hr.att.month'), width: 200, value: curMonth, options: ['2026-09', '2026-10', '2026-11', '2026-12'].map(function (m) { return { value: m, label: m }; }), onChange: function (ev) { setMonth(ev.target.value); } }),
            h(E.Button, { icon: 'print', onClick: function () { openPrint('/api/homeroom/print/attendance?month=' + curMonth); } }, A.t('hr.att.print')),
            h(E.Button, { icon: 'download', href: '/api/homeroom/attendance/monthly?month=' + curMonth + '&format=csv' }, A.t('hr.att.csv'))),
          h(E.Table, { caption: A.t('hr.att.caption', { m: curMonth }), columns: [
            { key: 'n', title: A.t('common.student'), render: function (r) { return r.name; } },
            { key: 'u', title: A.t('hr.att.excused'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.excused); } },
            { key: 'nb', title: A.t('hr.att.unexcused'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.unexcused); } },
            { key: 'sp', title: A.t('hr.att.late'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.late); } },
            { key: 'zw', title: A.t('hr.att.early'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.earlyLeave); } },
            { key: 'p', title: A.t('common.attendance'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, A.fmtPct(r.percent)); } }
          ], rows: ((att.data && att.data.rows) || []).map(function (r) { return Object.assign({ id: r.studentId }, r); }) })),
        h('div', { className: 'grid-2' },
          h('section', { className: 'card', 'aria-labelledby': 'h-osiag' },
            h('h2', { id: 'h-osiag' }, A.t('hr.ach.heading')),
            h('p', { className: 'muted' }, A.t('hr.ach.note', { n: (achs.data && achs.data.onCertificate) || 0 })),
            h('div', { className: 'stack' },
              h(E.Select, { label: A.t('common.student'), value: ach.studentId, options: [{ value: '', label: A.t('hr.pick') }].concat(students.map(function (s) { return { value: s.studentId, label: s.name }; })), onChange: function (ev) { setAch(Object.assign({}, ach, { studentId: ev.target.value })); } }),
              h(E.Select, { label: A.t('hr.ach.kind'), value: ach.kind, options: ((achs.data && achs.data.kinds) || []).map(function (k) { return { value: k.id, label: k.label }; }), onChange: function (ev) { setAch(Object.assign({}, ach, { kind: ev.target.value })); } }),
              h(E.TextField, { label: A.t('hr.ach.text'), value: ach.title, onChange: function (ev) { setAch(Object.assign({}, ach, { title: ev.target.value })); } }),
              h(E.Checkbox, { label: A.t('hr.ach.onCert'), checked: ach.onCertificate, onChange: function (ev) { setAch(Object.assign({}, ach, { onCertificate: ev.target.checked })); } }),
              h(E.Button, { disabled: !ach.studentId || !ach.title.trim(), onClick: function () {
                A.api.post('/api/homeroom/achievements', ach).then(function () { afterWrite(A.t('hr.ach.saved'), [achs]); setAch(Object.assign({}, ach, { title: '' })); }).catch(err);
              } }, A.t('hr.ach.save'))),
            h(E.Table, { caption: A.t('hr.ach.caption'), columns: [
              { key: 's', title: A.t('common.student'), render: function (r) { return r.student; } },
              { key: 't', title: A.t('hr.ach.col'), render: function (r) { return r.title; } },
              { key: 'c', title: A.t('hr.ach.colCert'), render: function (r) { return r.archived ? h(E.Badge, { tone: 'outline' }, A.t('hr.ach.archived')) : r.onCertificate ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('common.yes')) : h('span', { className: 'muted' }, A.t('hr.ach.no')); } }
            ], rows: ((achs.data && achs.data.achievements) || []).map(function (r) { return Object.assign({ id: r.id }, r); }) })),
          h('section', { className: 'card', 'aria-labelledby': 'h-hist' },
            h('h2', { id: 'h-hist' }, A.t('hr.hist.heading')),
            h('p', { className: 'muted' }, A.t('hr.hist.note')),
            h('div', { className: 'stack' },
              h(E.Select, { label: A.t('common.student'), value: hist.studentId, options: [{ value: '', label: A.t('hr.pick') }].concat(students.map(function (s) { return { value: s.studentId, label: s.name }; })), onChange: function (ev) { setHist(Object.assign({}, hist, { studentId: ev.target.value })); } }),
              h('div', { className: 'grid-2' },
                h(E.TextField, { label: A.t('hr.hist.year'), value: hist.schoolYear, onChange: function (ev) { setHist(Object.assign({}, hist, { schoolYear: ev.target.value })); } }),
                h(E.TextField, { label: A.t('common.class'), value: hist.className, onChange: function (ev) { setHist(Object.assign({}, hist, { className: ev.target.value })); } })),
              h(E.TextField, { label: A.t('hr.hist.school'), value: hist.schoolName, placeholder: A.t('hr.hist.schoolPh'), onChange: function (ev) { setHist(Object.assign({}, hist, { schoolName: ev.target.value })); } }),
              h('div', { className: 'grid-2' },
                h(E.Select, { label: A.t('common.subject'), value: hist.subjectId, options: ((cls.data && cls.data.subjects) || []).map(function (s) { return { value: s.id, label: A.subjectName(s.id, s.name) }; }), onChange: function (ev) { setHist(Object.assign({}, hist, { subjectId: ev.target.value })); } }),
                h(E.TextField, { label: A.t('hr.hist.annual'), value: hist.value, onChange: function (ev) { setHist(Object.assign({}, hist, { value: ev.target.value })); } })),
              h(E.Button, { disabled: !hist.studentId, onClick: function () {
                A.api.post('/api/homeroom/history', { studentId: hist.studentId, schoolYear: hist.schoolYear, className: hist.className, schoolName: hist.schoolName, grades: [{ subjectId: hist.subjectId, value: hist.value }] })
                  .then(function () { afterWrite(A.t('hr.hist.saved'), [histRows]); }).catch(err);
              } }, A.t('hr.hist.add'))),
            hist.studentId ? h('div', { className: 'stack mt-4' },
              h('h3', null, A.t('hr.hist.rowsH')),
              !((histRows.data && histRows.data.history) || []).length ? h('p', { className: 'muted' }, A.t('hr.hist.rowsNone')) : null,
              ((histRows.data && histRows.data.history) || []).map(function (x) {
                return h('div', { key: x.entryId, className: 'stack' },
                  h('p', { style: { margin: 0 } }, x.schoolYear + ' · ' + x.className + ' · ' + x.schoolName +
                    ' · ' + (x.grades || []).map(function (g) { return A.subjectName(g.subjectId, g.subjectId) + ' ' + g.value; }).join(', ')),
                  h(window.EdLogComments.Toggle, { kind: 'pupil-history', entryId: x.entryId, counts: x.comments, onChange: histRows.reload }));
              })) : null)));
    }

    /* ---------------- zakładka: klasa ---------------- */
    function panelKlasa() {
      var rollRows = (roll.data && roll.data.students) || [];
      return h('div', { className: 'stack' },
        h('section', { className: 'card', 'aria-labelledby': 'h-nr' },
          h('h2', { id: 'h-nr' }, A.t('hr.roll.heading')),
          h('div', { className: 'row mb-4' },
            h(E.Button, { variant: 'primary', icon: 'plus', onClick: function () {
              A.api.post('/api/homeroom/roll-call', { mode: 'assign' }).then(function (r) { afterWrite(A.t('hr.roll.assigned', { n: r.changed }), [roll, cls, ov]); }).catch(err);
            } }, A.t('hr.roll.assign')),
            h(E.Button, { icon: 'refresh', onClick: function () {
              A.api.post('/api/homeroom/roll-call', { mode: 'renumber', reason: A.t('hr.roll.renumberReason') }).then(function (r) { afterWrite(A.t('hr.roll.renumbered', { n: r.changed }), [roll, cls, ov]); }).catch(err);
            } }, A.t('hr.roll.renumber')),
            h('span', { className: 'muted' }, (roll.data && roll.data.note) || '')),
          h(E.Table, { caption: A.t('hr.roll.caption'), columns: [
            { key: 'nr', title: A.t('hr.roll.no'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.rollNo ? r.rollNo + '.' : '—'); } },
            { key: 'n', title: A.t('common.student'), render: function (r) { return r.name; } },
            { key: 'a', title: A.t('hr.roll.alpha'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.alphabeticalNo); } },
            { key: 'od', title: A.t('hr.roll.since'), render: function (r) { return r.joinedAt ? A.fmtDate(r.joinedAt) + (r.transferredFrom ? ' · ' + r.transferredFrom : '') : A.t('hr.roll.sinceStart'); } }
          ], rows: rollRows.map(function (r) { return Object.assign({ id: r.studentId }, r); }) })),
        h('section', { className: 'card', 'aria-labelledby': 'h-flags' },
          h('h2', { id: 'h-flags' }, A.t('hr.flags.heading')),
          h('p', { className: 'muted' }, A.t('hr.flags.note')),
          h(E.Select, { label: A.t('common.student'), value: flags.studentId,
            options: [{ value: '', label: A.t('hr.pick') }].concat(students.map(function (s) { return { value: s.studentId, label: s.name }; })),
            onChange: function (ev) { setFlags({ studentId: ev.target.value }); } }),
          flags.studentId && (!flagRow.data
            ? h('p', { className: 'muted' }, flagRow.error ? flagRow.error.message : A.t('hr.flags.loading'))
            : h('div', { className: 'stack mt-4' },
              h(E.Switch, { label: A.t('hr.flags.welfare'), hint: A.t('hr.flags.welfareHint'), checked: !!flagRow.data.socialWelfare, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patchFlags({ socialWelfare: v }); } }),
              h(E.Switch, { label: A.t('hr.flags.adult'), checked: !!flagRow.data.adult, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patchFlags(v ? { adult: true } : { adult: false, adultSelfExcuse: false, parentAccessBlocked: false }); } }),
              h(E.Switch, { label: A.t('hr.flags.selfExcuse'), hint: A.t('hr.flags.selfExcuseHint'), disabled: !flagRow.data.adult, checked: !!flagRow.data.adultSelfExcuse, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patchFlags({ adultSelfExcuse: v }); } }),
              h(E.Switch, { label: A.t('hr.flags.parentBlocked'), disabled: !flagRow.data.adult, checked: !!flagRow.data.parentAccessBlocked, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patchFlags({ parentAccessBlocked: v }); } })))),
        h('div', { className: 'grid-2' },
          h('section', { className: 'card', 'aria-labelledby': 'h-wyp' },
            h('h2', { id: 'h-wyp' }, A.t('hr.rem.heading')),
            h('p', { className: 'muted' }, A.t('hr.rem.note')),
            h(E.Select, { label: A.t('common.student'), value: rem.studentId, options: [{ value: '', label: A.t('hr.pick') }].concat(students.map(function (s) { return { value: s.studentId, label: s.name }; })), onChange: function (ev) { setRem(Object.assign({}, rem, { studentId: ev.target.value })); } }),
            h('div', { className: 'row mt-4' }, h(E.Button, { variant: 'danger', icon: 'log-out', disabled: !rem.studentId, onClick: function () { setRem(Object.assign({}, rem, { open: true, decisionNo: '' })); } }, A.t('hr.rem.btn')))),
          h('section', { className: 'card', 'aria-labelledby': 'h-cast' },
            h('h2', { id: 'h-cast' }, A.t('hr.cast.heading')),
            h('p', { className: 'muted' }, A.t('hr.cast.members', { n: (council.data && council.data.count) || 0 }) + ((council.data && council.data.members || []).length ? ' — ' + council.data.members.map(function (m) { return m.name; }).join(', ') : '')),
            h('div', { className: 'stack' },
              h(E.Select, { label: A.t('hr.cast.audience'), value: cast.audience, options: [{ value: 'council', label: A.t('hr.cast.council') }, { value: 'allParents', label: A.t('hr.cast.allParents') }], onChange: function (ev) { setCast(Object.assign({}, cast, { audience: ev.target.value })); } }),
              h(E.TextField, { label: A.t('hr.cast.subject'), value: cast.subject, onChange: function (ev) { setCast(Object.assign({}, cast, { subject: ev.target.value })); } }),
              h(E.TextField, { label: A.t('hr.cast.body'), multiline: 3, value: cast.body, onChange: function (ev) { setCast(Object.assign({}, cast, { body: ev.target.value })); } }),
              h('div', { className: 'row' },
                h(E.Badge, { tone: 'info', icon: 'file' }, A.t('hr.ex.attachment')),
                h('span', { className: 'muted' }, 'porzadek-zebrania.pdf · 128 kB'),
                h(E.Button, { icon: 'check', disabled: !cast.subject.trim(), onClick: function () {
                  A.api.post('/api/homeroom/broadcast', Object.assign({ attachments: [{ name: 'porzadek-zebrania.pdf', size: 131072, type: 'application/pdf' }] }, cast))
                    .then(function (r) { afterWrite(A.plural(r.recipients, 'hr.cast.sent'), [council]); }).catch(err);
                } }, A.t('common.send')))))),
        h('section', { className: 'card', 'aria-labelledby': 'h-grp' },
          h('h2', { id: 'h-grp' }, A.t('hr.grp.heading')),
          h('p', { className: 'muted' }, A.t('hr.grp.note')),
          ((grp.data && grp.data.groups) || []).map(function (g) {
            return h('div', { key: g.id, className: 'row mt-2' },
              h('span', { className: 'body-strong' }, g.name),
              h(E.Badge, { tone: 'outline' }, A.t('hr.grp.members', { n: g.members })),
              h('span', { className: 'muted' }, A.t('hr.grp.mine', { s: g.myStudents.length ? g.myStudents.map(function (s) { return s.name; }).join(', ') : A.t('hr.grp.nobody') })),
              h(E.Select, { label: '', 'aria-label': A.t('hr.grp.addAria', { g: g.name }), width: 220, value: '', options: [{ value: '', label: A.t('hr.grp.addOpt') }].concat(students.map(function (s) { return { value: s.studentId, label: s.name }; })), onChange: function (ev) {
                if (!ev.target.value) return;
                A.api.post('/api/homeroom/groups/' + g.id + '/members', { studentIds: [ev.target.value], action: 'add' }).then(function () { afterWrite(A.t('hr.grp.added', { g: g.name }), [grp]); }).catch(err);
              } }));
          })),
        h('section', { className: 'card', 'aria-labelledby': 'h-godz' },
          h('h2', { id: 'h-godz' }, A.t('hr.hrs.heading')),
          hours.data && (hours.data.ok
            ? h(E.Alert, { tone: 'success', title: A.t('hr.hrs.ok') }, h('p', null, A.t('hr.hrs.detail', { d: hours.data.checkedDays, r: hours.data.recordedHours, p: hours.data.plannedHours })))
            : h(E.Alert, { tone: 'warning', title: A.t('hr.hrs.bad', { n: hours.data.discrepancies.length }) }, h('p', null, A.t('hr.hrs.detail', { d: hours.data.checkedDays, r: hours.data.recordedHours, p: hours.data.plannedHours })))),
          h(E.Table, { caption: A.t('hr.hrs.caption'), columns: [
            { key: 'd', title: A.t('hr.hrs.day'), render: function (r) { return A.fmtDate(r.date); } },
            { key: 'p', title: A.t('hr.hrs.planned'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.planned); } },
            { key: 'z', title: A.t('hr.hrs.recorded'), num: true, render: function (r) { return h('span', { className: 'ed-num' }, r.recorded); } },
            { key: 't', title: A.t('hr.hrs.note'), render: function (r) { return r.text; } }
          ], rows: ((hours.data && hours.data.discrepancies) || []).map(function (r) { return Object.assign({ id: r.date }, r); }) })),
        h('section', { className: 'card', 'aria-labelledby': 'h-alarm' },
          h('h2', { id: 'h-alarm' }, A.t('hr.print.heading')),
          h('div', { className: 'row' },
            h(E.Button, { icon: 'print', onClick: function () { openPrint('/api/homeroom/print/emergency'); } }, A.t('hr.print.emergency')),
            h('span', { className: 'muted' }, A.t('hr.print.emergencyNote')))));
    }

    var TABS = [
      { id: 'klasyfikacja', label: A.t('hr.tab.classification') },
      { id: 'uspr', label: A.t('hr.tab.excuses'), count: pendingExcuses.length },
      { id: 'dok', label: A.t('hr.tab.documents') },
      { id: 'klasa', label: A.t('hr.tab.class') }
    ];

    return h(React.Fragment, null,
      h('h1', { className: 'display app-title' }, A.t('hr.title', { c: o.className || '' })),
      h('p', { className: 'app-sub' }, (props.config ? props.config.school.short : '') + ' · ' + (o.year || '') + ' · ' + (cls.data ? A.t('hr.sub.term', { n: cls.data.semester }) : '') + ' · ' + A.t('hr.sub.meeting', { d: A.fmtDate(o.classificationMeeting) }) + ' · ' + A.t('hr.sub.tutor', { t: o.homeroomTeacher || '' })),
      ov.error && h(E.Alert, { tone: 'danger', title: A.t('hr.loadError') }, h('p', null, ov.error.message)),
      h('div', { className: 'grid-3 mb-4' },
        h(E.StatTile, { label: A.t('hr.stat.attendance'), value: A.fmtPct(o.attendancePercent), hint: A.t('hr.stat.attendanceHint', { d: A.fmtDate(o.today) }) }),
        h(E.StatTile, { label: A.t('hr.stat.average'), value: fmt(o.classAverage), hint: A.t('hr.stat.averageHint') }),
        h(E.StatTile, { label: A.t('hr.stat.atRisk'), value: String(o.atRisk || 0), alert: !!o.atRisk, hint: A.t('hr.stat.atRiskHint') }),
        h(E.StatTile, { label: A.t('hr.stat.pending'), value: String(pendingExcuses.length), hint: A.t('hr.stat.pendingHint') }),
        h(E.StatTile, { label: A.t('hr.stat.unread'), value: String((rec.data && rec.data.unread) || 0), hint: A.t('hr.stat.unreadHint') }),
        h(E.StatTile, { label: A.t('hr.stat.logbook'), value: logbookLabel(book.data && book.data.status), hint: A.t('hr.stat.logbookHint') })),
      o.locked && h(E.Alert, { tone: 'info', title: A.t('hr.locked.title', { n: o.semester }) }, h('p', null, A.t('hr.locked.body'))),
      h(E.Tabs, { tabs: TABS, value: tab, onChange: setTab, label: A.t('hr.tabs') }, function (active) {
        if (active === 'klasyfikacja') return panelKlasyfikacja();
        if (active === 'uspr') return panelUsprawiedliwienia();
        if (active === 'dok') return panelDokumenty();
        return panelKlasa();
      }),
      reject && h(E.Dialog, {
        title: reject.ids.length === 1 ? A.t('hr.dlg.reject.one') : A.t('hr.dlg.reject.many'),
        onClose: function () { setReject(null); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setReject(null); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !reason.trim(), onClick: function () { decideExcuses(reject.ids, 'reject', reason); } }, A.t('hr.ex.reject'))]
      },
        h('p', null, A.t('hr.dlg.reject.body', { names: reject.names.join(', ') })),
        h(E.TextField, { label: A.t('hr.dlg.reject.label'), required: true, 'data-autofocus': true, value: reason, placeholder: A.t('hr.dlg.reject.ph'), hint: A.t('hr.dlg.reject.hint'), onChange: function (ev) { setReason(ev.target.value); } })),
      closeOpen && h(E.Dialog, {
        title: A.t('hr.dlg.close.title', { n: o.semester || 1, c: o.className || '' }),
        onClose: function () { setCloseOpen(false); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setCloseOpen(false); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'primary', icon: 'lock', disabled: earlyClose && !closeReason.trim(), onClick: function () {
            A.api.post('/api/homeroom/semester/close', Object.assign({ semester: o.semester, resolutionNo: '3/2026/2027' }, earlyClose ? { force: true, reason: closeReason.trim() } : {}))
              .then(function () { setCloseOpen(false); setCloseReason(''); afterWrite(A.t('hr.dlg.close.done'), [ov, cls, book]); }).catch(function (e) { setCloseOpen(false); err(e); });
          } }, A.t('hr.dlg.close.ok'))]
      },
        h('p', null, A.t('hr.dlg.close.p1')),
        h('p', null, A.t('hr.dlg.close.p2', { n: o.missingFinals || 0, res: '3/2026/2027' })),
        earlyClose && h(E.Alert, { tone: 'warning' }, A.t('hr.dlg.close.early', { d: A.fmtDate(o.classificationMeeting) })),
        earlyClose && h(E.TextField, { label: A.t('hr.dlg.close.reason'), required: true, 'data-autofocus': true, value: closeReason, placeholder: A.t('hr.dlg.close.reasonPh'), onChange: function (ev) { setCloseReason(ev.target.value); } })),
      rem.open && h(E.Dialog, {
        title: A.t('hr.dlg.rem.title'),
        onClose: function () { setRem(Object.assign({}, rem, { open: false })); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setRem(Object.assign({}, rem, { open: false })); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !rem.decisionNo.trim(), onClick: function () {
            A.api.post('/api/homeroom/students/' + rem.studentId + '/remove', { decisionNo: rem.decisionNo, date: rem.date, reason: rem.reason })
              .then(function (r) { setRem(Object.assign({}, rem, { open: false, studentId: '' })); afterWrite(A.t('hr.dlg.rem.done', { n: r.archivedAchievements }), [cls, roll, ov]); })
              .catch(function (e) { err(e); });
          } }, A.t('hr.dlg.rem.ok'))]
      },
        h('p', null, A.t('hr.dlg.rem.body')),
        h(E.TextField, { label: A.t('hr.dlg.rem.decisionNo'), mono: true, required: true, 'data-autofocus': true, value: rem.decisionNo, placeholder: 'SP12/1024/2027', onChange: function (ev) { setRem(Object.assign({}, rem, { decisionNo: ev.target.value })); } }),
        h(E.TextField, Object.assign({ label: A.t('hr.dlg.rem.date'), type: 'date', width: 200, value: rem.date, onChange: function (ev) { setRem(Object.assign({}, rem, { date: ev.target.value })); }, hint: A.dateHint(rem.date) }, A.dateInputProps())),
        h(E.TextField, { label: A.t('hr.dlg.rem.reason'), multiline: 2, value: rem.reason, onChange: function (ev) { setRem(Object.assign({}, rem, { reason: ev.target.value })); } })));
  }

  A.screen({ id: 'homeroom', path: '/wychowawca', title: 'Wychowawca', roles: ['homeroom', 'principal'], module: 'homeroom', nav: { key: 'nav.homeroom', label: 'Wychowawca', order: 30 }, component: Screen });
})();
