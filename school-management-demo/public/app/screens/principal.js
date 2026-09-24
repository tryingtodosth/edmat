/* 3.3 — Dyrekcja: zastępstwa i odwołania lekcji, nadzór pedagogiczny i rozliczenia, rejestr audytowy,
   komunikaty, statystyki logowań rodziców, wycieczki i dziennik specjalistów. */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'pr.title': 'Panel dyrekcji',
      'pr.sub': '{school} · rok szkolny {y} · stan na {d}',
      'pr.tabs': 'Sekcje panelu dyrekcji',
      'pr.tab.subs': 'Zastępstwa',
      'pr.tab.supervision': 'Nadzór',
      'pr.tab.audit': 'Audyt',
      'pr.tab.announcements': 'Komunikaty',
      'pr.popupBlocked': 'Przeglądarka zablokowała nowe okno — zezwól na wyskakujące okna, aby wydrukować dokument.',
      'pr.act.login': 'zalogował(a) się',
      'pr.act.login_failed': 'nieudane logowanie',
      'pr.act.logout': 'wylogował(a) się',
      'pr.act.password_changed': 'zmienił(a) hasło',
      'pr.act.totp_enabled': 'włączył(a) 2FA',
      'pr.act.grade_value_edit': 'zmienił(a) ocenę',
      'pr.act.grade_update': 'zmienił(a) ocenę',
      'pr.act.grade_create': 'dodał(a) ocenę',
      'pr.act.grade_delete': 'usunął/usunęła ocenę',
      'pr.act.attendance_entry_delete': 'usunął/usunęła wpis frekwencji',
      'pr.act.attendance_update': 'zmienił(a) frekwencję',
      'pr.act.grades_export': 'wyeksportował(a) oceny',
      'pr.act.classification_grade_invalidated': 'unieważnił(a) ocenę klasyfikacyjną',
      'pr.act.account_blocked': 'zablokował(a) konto',
      'pr.act.account_unblocked': 'odblokował(a) konto',
      'pr.act.announcement_published': 'opublikował(a) komunikat',
      'pr.act.announcement_acknowledged': 'potwierdził(a) odczyt komunikatu',
      'pr.act.substitution_created': 'zarejestrował(a) nieobecność',
      'pr.act.substitution_assigned': 'przydzielił(a) zastępstwo',
      'pr.act.substitution_published': 'opublikował(a) zastępstwa',
      'pr.act.trip_approved': 'zatwierdził(a) wycieczkę',
      'pr.act.archive_generated': 'wygenerował(a) pakiet archiwalny',
      'pr.act.archive_exported': 'pobrał(a) pakiet archiwalny',
      'pr.act.archive_signature_attached': 'dołączył(a) podpis do pakietu archiwalnego',
      'pr.act.payroll_exported': 'wyeksportował(a) rozliczenie godzin',
      'pr.act.visibility_changed': 'zmienił(a) ustawienia widoczności',
      'pr.act.acting_homeroom_assigned': 'powierzył(a) obowiązki wychowawcy',
      'pr.act.acting_homeroom_revoked': 'wycofał(a) powierzenie obowiązków',
      'pr.act.confidential_note_access_denied': 'próbował(a) odczytać notatkę poufną (odmowa)',

      'pr.sb.reportTitle': 'Zgłoś nieobecność nauczyciela',
      'pr.sb.reportSub': 'Po zapisaniu system wskazuje wszystkie lekcje w tym okresie i proponuje obsadę.',
      'pr.sb.pickTeacher': 'Wybierz nauczyciela',
      'pr.sb.reasonLabel': 'Podstawa nieobecności',
      'pr.sb.reason.sick': 'Zwolnienie lekarskie (L4)',
      'pr.sb.reason.childcare': 'Opieka nad dzieckiem',
      'pr.sb.reason.training': 'Urlop szkoleniowy',
      'pr.sb.reason.travel': 'Delegacja służbowa',
      'pr.sb.from': 'Nieobecność od',
      'pr.sb.to': 'Nieobecność do',
      'pr.sb.run': 'Uruchom dobór zastępstw',
      'pr.sb.started': 'Dobór uruchomiony · {t}, {f} – {to} · lekcji do obsady: {n}.',
      'pr.sb.saved': 'Zgłoszenie nieobecności zapisane.',
      'pr.sb.assigned': 'Przydzielono obsadę · {n}. lekcja, {s} {c}, {d}{tail}',
      'pr.sb.combinedTail': ' · klasy połączone w auli, jedna płatna godzina doraźna.',
      'pr.sb.cancelled': 'Lekcja odwołana · powiadomiono rodziców uczniów klasy {c} (wysłano: {n}).',
      'pr.sb.moved': 'Lekcja przeniesiona · rodzice powiadomieni.',
      'pr.sb.cleared': 'Obsada zdjęta — wybierz nauczyciela z listy propozycji.',
      'pr.sb.scheduled': 'Publikacja zaplanowana na {d} — plany zaktualizują się o tej godzinie.',
      'pr.sb.publishedMsg': 'Zastępstwa opublikowane {d} · powiadomień: {n}.',
      'pr.sb.toastScheduled': 'Publikacja zaplanowana.',
      'pr.sb.toastPublished': 'Zastępstwa opublikowane.',
      'pr.sb.publishedDue': 'Opublikowano arkuszy o zaplanowanej godzinie: {n}.',
      'pr.sb.tier': 'Podstawa doboru',
      'pr.sb.why': 'Uzasadnienie',
      'pr.sb.adHocWeek': 'Godziny doraźne w tyg.',
      'pr.sb.action': 'Akcja',
      'pr.sb.assign': 'Przydziel',
      'pr.sb.assignAria': 'Przydziel {name} — {n}. lekcja, {s} {c}',
      'pr.sb.listTitle': 'Zgłoszenia zastępstw',
      'pr.sb.chosen': 'Wybrane zgłoszenie',
      'pr.sb.lessons.one': '{n} lekcja',
      'pr.sb.lessons.few': '{n} lekcje',
      'pr.sb.lessons.many': '{n} lekcji',
      'pr.sb.publishedWord': 'opublikowane',
      'pr.sb.draftWord': 'wersja robocza',
      'pr.sb.lessonsTitle': 'Lekcje objęte doborem · {f} – {t}',
      'pr.sb.publishedBadge': 'Opublikowano {d}',
      'pr.sb.draftBadge': 'Wersja robocza',
      'pr.sb.statPaid': 'Godziny doraźne do rozliczenia',
      'pr.sb.statPaidCombined': 'Połączone klasy liczone jako jedna godzina',
      'pr.sb.statPaidSeparate': 'Każda klasa liczona osobno',
      'pr.sb.statOpen': 'Lekcje bez obsady',
      'pr.sb.statOpenHint': 'Obsadź wszystkie lekcje przed publikacją',
      'pr.sb.statReady': 'Plan gotowy do publikacji',
      'pr.sb.statCancelled': 'Lekcje odwołane',
      'pr.sb.statCancelledHint': 'Rodzice powiadomieni o zmianie planu',
      'pr.sb.combine': 'Połącz równoległe klasy w auli (jeden nauczyciel)',
      'pr.sb.combineHint': 'Zgoda dyrektora na łączenie oddziałów · jedna płatna godzina doraźna zamiast dwóch',
      'pr.sb.absentTeacher': '{n} (nieobecny)',
      'pr.sb.noteCancel': 'lekcja odwołana',
      'pr.sb.noteCombine': ' · klasy połączone w auli, jedna obsada',
      'pr.sb.noteOpen': ' · lekcja bez obsady',
      'pr.sb.parentsNotified': 'Powiadomienia do rodziców: {n} · {tail}',
      'pr.sb.comesLater': 'klasa przychodzi na kolejną lekcję.',
      'pr.sb.leavesEarlier': 'klasa kończy zajęcia wcześniej.',
      'pr.sb.suggCaption': 'Propozycje zastępstw · {n}. lekcja, {s} {c}, {d}',
      'pr.sb.cancelFirst': 'Odwołaj (klasa przychodzi później)',
      'pr.sb.cancelLast': 'Odwołaj (klasa wychodzi wcześniej)',
      'pr.sb.coverBadge': 'Obsada: {n}{tail}',
      'pr.sb.hallTail': ' · aula',
      'pr.sb.changeCover': 'Zmień obsadę',
      'pr.sb.publishAt': 'Godzina publikacji',
      'pr.sb.publishAtHint': 'Zwyczajowo 15:00 dnia poprzedzającego',
      'pr.sb.publish': 'Opublikuj zastępstwa',
      'pr.sb.publishDue': 'Opublikuj zaplanowane',
      'pr.sb.publishedAlert': 'Zastępstwa opublikowane',
      'pr.sb.publishedBody': 'Zmiany są widoczne w planach uczniów, nauczycieli i rodziców.',
      'pr.sb.publishedCount': ' Wysłano powiadomień: {n}.',

      'pr.sv.statTopic': 'Braki tematów w tym tygodniu',
      'pr.sv.statTopicHint': 'Sprawdzono lekcji: {n}',
      'pr.sv.statAtt': 'Braki frekwencji',
      'pr.sv.statTests': 'Klasy ponad limitem sprawdzianów',
      'pr.sv.statTestsHint': 'Ostatnie {w}',
      'pr.sv.weeks.one': '{n} tydzień',
      'pr.sv.weeks.few': '{n} tygodnie',
      'pr.sv.weeks.many': '{n} tygodni',
      'pr.sv.statCurr': 'Realizacja podstawy',
      'pr.sv.statCurrHint': 'Plan na dziś: {p} %',
      'pr.sv.compTitle': 'Audyt kompletności wpisów',
      'pr.sv.compRange': ' · {f} – {t}',
      'pr.sv.classes.one': '{n} klasa',
      'pr.sv.classes.few': '{n} klasy',
      'pr.sv.classes.many': '{n} klas',
      'pr.sv.gapLessons.one': '{n} lekcja z brakami',
      'pr.sv.gapLessons.few': '{n} lekcje z brakami',
      'pr.sv.gapLessons.many': '{n} lekcji z brakami',
      'pr.sv.compCaption': 'Braki tematów i frekwencji w minionym tygodniu',
      'pr.sv.subjects': 'Przedmioty',
      'pr.sv.missTopic': 'Brak tematu',
      'pr.sv.missAtt': 'Brak frekwencji',
      'pr.sv.gaps': 'Braki',
      'pr.sv.compNote': 'Lista rozbieżności zawiera nazwiska nauczycieli odpowiedzialnych za wpisy (przy zastępstwie — nauczyciela zastępującego).',
      'pr.sv.currTitle': 'Realizacja podstawy programowej',
      'pr.sv.currSem': ' · semestr {n}',
      'pr.sv.currHint': 'Zrealizowano {d} z {p} godzin · jednostki: {a}/{b}',
      'pr.sv.currNote': 'Znacznik na pasku pokazuje plan na dziś ({p} % jednostek tematycznych).',
      'pr.sv.loadTitle': 'Obciążenie sprawdzianami',
      'pr.sv.loadCaption': 'Liczba sprawdzianów wobec limitów statutowych',
      'pr.sv.tests': 'Sprawdziany',
      'pr.sv.maxDay': 'Maks. w dniu',
      'pr.sv.maxWeek': 'Maks. w tygodniu',
      'pr.sv.over': 'Limit przekroczony · {n}',
      'pr.sv.within': 'W limicie',
      'pr.sv.limits': 'Limity statutowe: {d} sprawdzian dziennie, {w} w tygodniu.',
      'pr.sv.payTitle': 'Nadgodziny i doraźne zastępstwa',
      'pr.sv.period': 'Okres rozliczeniowy',
      'pr.sv.payCaption': 'Godziny ponadwymiarowe i doraźne zastępstwa wg Karty Nauczyciela',
      'pr.sv.level': 'Stopień awansu',
      'pr.sv.pensum': 'Pensum',
      'pr.sv.held': 'Zrealizowane',
      'pr.sv.overtime': 'Ponadwymiarowe',
      'pr.sv.adhoc': 'Doraźne',
      'pr.sv.total': 'Razem',
      'pr.sv.weeksNote': '{b} · tygodni nauki w okresie: {n}.',
      'pr.sv.exportCsv': 'Eksport CSV',
      'pr.sv.exportXml': 'Eksport XML (Rozliczenie)',
      'pr.sv.xmlFmt': 'XML (Rozliczenie)',
      'pr.sv.reportKN': 'Raport wg Karty Nauczyciela',
      'pr.sv.exportDone': 'Eksport gotowy: rozliczenie za {m} w formacie {f} · nauczycieli: {t}, godzin doraźnych: {h}.',

      'pr.au.filters': 'Filtry rejestru',
      'pr.au.events': 'Zdarzeń: {n} z {t}',
      'pr.au.ip': 'Adres IP',
      'pr.au.ipHint': 'Dopasowanie po początku adresu',
      'pr.au.user': 'Użytkownik',
      'pr.au.allUsers': 'Wszyscy',
      'pr.au.operation': 'Operacja',
      'pr.au.allOps': 'Wszystkie operacje',
      'pr.au.editOrDelete': 'Edycje i usunięcia (oceny, frekwencja)',
      'pr.au.dateFrom': 'Data od',
      'pr.au.dateTo': 'Data do',
      'pr.au.entity': 'Obiekt',
      'pr.au.clear': 'Wyczyść filtry',
      'pr.au.logTitle': 'Rejestr zdarzeń · edycje, logowania, eksporty, blokady',
      'pr.au.loadError': 'Nie udało się wczytać rejestru: {m}',
      'pr.au.empty': 'Brak zdarzeń dla wybranych filtrów. Rozszerz zakres dat lub wyczyść pole adresu IP.',
      'pr.au.immutable': 'Rejestr jest niezmienialny; każdy wpis zachowuje wartość pierwotną, powód, adres IP i identyfikator zdarzenia.',
      'pr.au.voidTitle': 'Unieważnienie oceny klasyfikacyjnej (komisja odwoławcza)',
      'pr.au.gradePick': 'Uczeń i ocena',
      'pr.au.gradePickPh': 'Wybierz ocenę klasyfikacyjną',
      'pr.au.kindFinal': 'roczna',
      'pr.au.kindMid': 'śródroczna',
      'pr.au.newGrade': 'Nowa ocena',
      'pr.au.newGradeHint': 'Ocena z egzaminu sprawdzającego (1–6)',
      'pr.au.protocolNo': 'Nr protokołu komisji',
      'pr.au.attach': 'Załącz protokół',
      'pr.au.origGrade': 'Ocena pierwotna: {v} · {s}. Podstawa: art. 44n ustawy o systemie oświaty.',
      'pr.au.void': 'Unieważnij i wpisz nową',
      'pr.au.voidHint': 'Wybierz ocenę, wpisz nową, podaj numer protokołu i załącz skan.',
      'pr.au.voided': 'Ocena unieważniona · wpisano ocenę {v} z egzaminu sprawdzającego, protokół nr {p}. Wartość pierwotna zachowana w rejestrze audytowym.',
      'pr.au.voidedToast': 'Ocena klasyfikacyjna unieważniona.',
      'pr.dlg.void.title': 'Unieważnić ocenę klasyfikacyjną?',
      'pr.dlg.void.body': '{s} · {sub}: ocena {v} zostanie unieważniona i zastąpiona oceną {nv} z egzaminu sprawdzającego.',
      'pr.dlg.void.reason': 'Powód unieważnienia',
      'pr.dlg.void.hint': 'Powód trafi do rejestru audytowego i do uzasadnienia decyzji',
      'pr.dlg.void.ph': 'np. wniosek komisji odwoławczej z 22.10.2026',
      'pr.au.accounts': 'Konta pracowników',
      'pr.au.account': 'Konto',
      'pr.au.pickStaff': 'Wybierz pracownika',
      'pr.au.sessions': 'sesje: {n}',
      'pr.au.blockedTag': ' · ZABLOKOWANE',
      'pr.au.block': 'Zablokuj konto i unieważnij sesje',
      'pr.au.blocked': 'Konto {n} zablokowane · unieważniono sesji: {t} (web: {w}, mobile: {m}).',
      'pr.au.blockedToast': 'Konto zablokowane, sesje unieważnione.',
      'pr.dlg.block.title': 'Zablokować konto i unieważnić sesje?',
      'pr.dlg.block.body': 'Konto straci dostęp natychmiast — w aplikacji webowej i mobilnej. Wpisy pracownika w dzienniku pozostaną nienaruszone.',
      'pr.dlg.block.reason': 'Powód blokady',
      'pr.dlg.block.ph': 'np. rozwiązanie umowy o pracę z 31.10.2026',
      'pr.dlg.block.ok': 'Zablokuj konto',
      'pr.au.acting': 'p.o. wychowawcy',
      'pr.au.pickClass': 'Wybierz klasę',
      'pr.au.actingPrefix': ' · p.o. {n}',
      'pr.au.pickTeacher': 'Wybierz nauczyciela',
      'pr.au.from': 'Od',
      'pr.au.to': 'Do',
      'pr.au.entrust': 'Powierz obowiązki',
      'pr.au.actingReason': 'Długotrwała nieobecność wychowawcy',
      'pr.au.actingDone': 'p.o. wychowawcy klasy {c}: {n} ({f} – {t}). {r}',
      'pr.au.actingNote': 'Wychowawca z arkusza organizacyjnego pozostaje odpowiedzialny za klasyfikację i dokumentację klasy.',
      'pr.au.archive': 'Archiwum roczne',
      'pr.au.sealed': 'Opieczętowano {d}',
      'pr.au.noPackage': 'Brak pakietu',
      'pr.au.window': 'Termin ustawowy: {f} – {t} · {s}',
      'pr.au.windowOpen': 'okno otwarte',
      /* U3-06: „poza terminem” i „okno jeszcze się nie otworzyło” to dwa różne stany — przed
         zakończeniem zajęć termin nie minął, on się jeszcze nie zaczął. */
      'pr.au.windowNotYet': 'okno jeszcze się nie otworzyło — teraz pakiet powstanie tylko pokazowo, z wpisem do rejestru',
      'pr.au.windowOver': 'po terminie — pakiet powstanie z wpisem do rejestru i z uzasadnieniem',
      'pr.au.yearEnd': 'Koniec roku szkolnego: {d} · zajęcia kończą się {f}',
      'pr.au.genArchive': 'Generuj pakiet archiwalny',
      'pr.au.verify': 'Zweryfikuj pieczęć',
      'pr.au.printPackage': 'Wydruk pakietu',
      'pr.au.archiveForce': 'Pokaz działania pakietu poza terminem ustawowym',
      'pr.au.archived': 'Pakiet {y} wygenerowany ({kb} kB) · pieczęć {alg}, skrót {d}…{tail}',
      'pr.au.archivedToast': 'Pakiet archiwalny opieczętowany.',
      'pr.au.sealOk': 'Pieczęć poprawna · skrót {d}… zgodny z podpisem szkoły.',
      'pr.au.sealBad': 'Pieczęć niepoprawna — pakiet został zmieniony po podpisaniu.',
      'pr.au.st.not-started': 'Nie rozpoczęto',
      'pr.au.st.package-ready': 'Pakiet gotowy, bez podpisu',
      'pr.au.st.signed': 'Pakiet podpisany',
      'pr.au.st.overdue': 'Po terminie',
      'pr.au.st.signature-unverified': 'Podpis przyjęty, niezweryfikowany',
      'pr.au.deadline': 'Termin z § 22 rozporządzenia o dokumentacji przebiegu nauczania: {d}',
      'pr.au.daysLeft': 'zostało dni: {n}',
      'pr.au.daysLeft0': 'ostatni dzień terminu',
      'pr.au.overdueBy': 'po terminie o dni: {n}',
      'pr.au.dlPackage': 'Pobierz pakiet (.zip)',
      /* U3-07: instrukcja opisuje przyciski, które pojawiają się dopiero z pakietem — więc i ona
         pojawia się dopiero z pakietem, a przedtem mówi, od czego zacząć. */
      'pr.au.steps': 'Po wygenerowaniu pakietu dyrektor podpisuje go poza dziennikiem, w trzech krokach:',
      'pr.au.stepsNone': 'Najpierw wygeneruj pakiet — podpis dołączysz w trzech krokach, które pojawią się tutaj.',
      'pr.au.step1': 'Pobierz pakiet (.zip) i zapisz go na informatycznym nośniku danych.',
      'pr.au.step2': 'Podpisz plik manifest.sha256 z pakietu (albo cały .zip) podpisem zaufanym (gov.pl), e-Dowodem lub podpisem kwalifikowanym.',
      'pr.au.step3': 'Wróć tutaj i dołącz plik podpisu, który zwróciła podpisywarka.',
      'pr.au.sigKind': 'Rodzaj podpisu',
      'pr.au.sigWhat': 'Co zostało podpisane',
      'pr.au.sf.manifest': 'plik manifest.sha256',
      'pr.au.sf.package': 'cały pakiet .zip',
      'pr.au.sigk.xades': 'XAdES (XML)',
      'pr.au.sigk.pades': 'PAdES (PDF)',
      'pr.au.sigk.zaufany': 'Podpis zaufany (gov.pl)',
      'pr.au.sigk.qualified': 'Podpis kwalifikowany',
      'pr.au.sigk.osobisty': 'Podpis osobisty (e-Dowód)',
      'pr.au.sigPick': 'Plik podpisu',
      'pr.au.sigSend': 'Dołącz podpis',
      'pr.au.sigMatched': 'Skrót zgodny — podpisany skrót odpowiada plikowi „{f}” z tego pakietu.',
      'pr.au.sigStored': 'Przyjęty, niezweryfikowany — w pliku podpisu nie ma skrótu tego pakietu.',
      'pr.au.sigNone': 'Do pakietu nie dołączono jeszcze podpisu.',
      'pr.au.sigHave': 'Podpis: {n} · {k} · dołączył(a) {b}, {d}',
      'pr.au.sigDownload': 'Pobierz plik podpisu',
      'pr.au.sigNote': 'Dziennik nie jest kwalifikowaną usługą zaufania: sprawdzamy wyłącznie zgodność skrótu, nie ważność podpisu ani łańcuch certyfikatów. Pieczęć kluczem szkoły to dowód spójności, nie podpis z § 22.',
      'pr.au.sigToast': 'Podpis dołączony do pakietu.',
      'pr.au.sigReminder': 'Przypomnienie o terminie z § 22 nadal działa: ten plik nie potwierdza naszego pakietu. Dołącz właściwy podpis albo odnotuj przyjęcie bez weryfikacji.',
      'pr.au.acceptTitle': 'Przyjmij podpis bez weryfikacji skrótu',
      'pr.au.acceptReason': 'Na jakiej podstawie',
      'pr.au.acceptReasonHint': 'Np. „zweryfikowano w walidatorze dostawcy zaufania 12.09.2027”. Wpis trafia do rejestru audytowego.',
      'pr.au.acceptSend': 'Odnotuj przyjęcie',
      'pr.au.accepted': 'Przyjęto bez weryfikacji skrótu · {b}, {d} — {r}',
      'pr.au.acceptedToast': 'Odnotowano przyjęcie podpisu bez weryfikacji.',
      'pr.au.superseded': 'Ten podpis dotyczy poprzedniej wersji pakietu i nie zamyka już terminu — rocznik przebudowano {d}.',
      'pr.au.rebuildTitle': 'Rocznik jest już podpisany',
      'pr.au.rebuildBody': 'Ponowne wygenerowanie pakietu unieważnia dołączony podpis: zostanie on przy poprzednim pakiecie i przestanie zamykać termin z § 22. Podaj powód przebudowy.',
      'pr.au.rebuildReason': 'Powód przebudowy',
      'pr.au.rebuildConfirm': 'Przebuduj i unieważnij podpis',
      'pr.au.rebuilt': 'Rocznik przebudowany · poprzedni podpis unieważniony (pakiet {p}).',
      'pr.au.delete': 'Usuń pakiet',
      'pr.au.deleteTitle': 'Usunąć pakiet archiwalny?',
      'pr.au.deleteBody': 'Pakiet {y} z {d} zniknie razem z plikami XML, wydrukiem i archiwum ZIP. Wpis w rejestrze audytowym z powodem zostaje. Podpisanego pakietu usunąć nie można.',
      'pr.au.deleteReason': 'Powód usunięcia',
      'pr.au.deleteConfirm': 'Usuń pakiet',
      'pr.au.deleted': 'Pakiet {y} usunięty · plików skasowanych: {n}.',
      'pr.au.deletedToast': 'Pakiet archiwalny usunięty.',
      'pr.au.visibility': 'Widoczność na kontach rodziców',
      'pr.au.visRank': 'Pokazuj rankingi klas rodzicom',
      'pr.au.visAvg': 'Pokazuj średnią klasy',
      'pr.au.visAvgParents': 'Pokazuj średnie ocen rodzicom',
      'pr.au.off': 'wył.',
      'pr.au.on': 'wł.',
      'pr.au.visNote': 'Ustawienia obowiązują wszystkie konta rodziców i uczniów w szkole.',
      'pr.au.visRankOn': 'Rankingi klas są widoczne na kontach rodziców.',
      'pr.au.visRankOff': 'Rankingi klas ukryte — porównywanie uczniów wyłączone.',
      'pr.au.visAvgOn': 'Średnia klasy widoczna na kontach rodziców.',
      'pr.au.visAvgOff': 'Średnia klasy ukryta na kontach rodziców.',

      'pr.an.title': 'Komunikat globalny dla rodziców i pracowników',
      'pr.an.titleField': 'Tytuł komunikatu',
      'pr.an.bodyField': 'Treść komunikatu',
      'pr.an.bodyHint': 'Treść widzą wszyscy odbiorcy; numery uchwał podaje się dosłownie',
      'pr.an.parents': 'Rodzice',
      'pr.an.staff': 'Pracownicy',
      'pr.an.students': 'Uczniowie',
      'pr.an.requireAck': 'Wymagaj potwierdzenia odczytu (blokuje inne widoki)',
      'pr.an.requireAckHint': 'Do potwierdzenia odczytu pozostałe widoki dziennika są zablokowane',
      'pr.an.publish': 'Opublikuj',
      'pr.an.published': 'Komunikat „{t}” opublikowany · odbiorców: {n}{tail}',
      'pr.an.ackTail': ' · wymaga potwierdzenia odczytu (blokuje pozostałe widoki).',
      'pr.an.publishedToast': 'Komunikat opublikowany.',
      'pr.an.receipts': 'Potwierdzenia odczytu · {t}',
      'pr.an.ackOf': '{a} z {b}',
      'pr.an.receiptsBar': 'Potwierdzenia odczytu',
      'pr.an.receiptsCaption': 'Potwierdzenia według grup odbiorców',
      'pr.an.group': 'Grupa',
      'pr.an.acked': 'Potwierdziło',
      'pr.an.recipients': 'Odbiorców',
      'pr.an.complete': 'Komplet',
      'pr.an.awaiting': 'Oczekuje {n}',
      'pr.an.pendingNames': 'Bez potwierdzenia pozostają: {names}{tail}',
      'pr.an.andOthers': ' i {n} innych',
      'pr.dlg.preview.back': 'Wróć do edycji',
      'pr.dlg.preview.publish': 'Opublikuj komunikat',
      'pr.dlg.preview.ack': 'Tak zobaczą komunikat odbiorcy. Pozostałe widoki dziennika będą zablokowane do potwierdzenia odczytu; potwierdzenie zapisze się z datą i godziną.',
      'pr.dlg.preview.noAck': 'Tak zobaczą komunikat odbiorcy. Potwierdzenie odczytu nie jest wymagane.',

      'pr.lg.title': 'Statystyki logowań rodziców',
      'pr.lg.stale': 'Konta bez logowania > 30 dni',
      'pr.lg.staleHint': 'Ryzyko wykluczenia cyfrowego',
      'pr.lg.never': 'Konta bez żadnego logowania',
      'pr.lg.active': 'Rodzice z regularnym kontaktem',
      'pr.lg.activeHint': '{n} kont rodziców',
      'pr.lg.caption': 'Logowania rodziców i gospodarstw domowych',
      'pr.lg.parent': 'Rodzic',
      'pr.lg.children': 'Dzieci',
      'pr.lg.last': 'Ostatnie logowanie',
      'pr.lg.noLogin': 'brak logowania',
      'pr.lg.count': 'Logowania',
      'pr.lg.badgeNever': 'Nigdy się nie zalogował',
      'pr.lg.badgeStale': 'Brak logowania > 30 dni',
      'pr.lg.badgeOk': 'Kontakt regularny',
      'pr.lg.note': 'Dla kont bez logowania wychowawca przekazuje informacje w formie papierowej. Gospodarstw domowych zagrożonych: {n}.',

      'pr.tr.title': 'Wycieczki do zatwierdzenia',
      'pr.tr.approved': 'Plan zatwierdzony',
      'pr.tr.pending': 'Do zatwierdzenia',
      'pr.tr.meta': 'Kierownik: {l} · opiekunowie: {c} · uczestników: {n}{ins}',
      'pr.tr.insurance': ' · ubezpieczenie {i} {p}',
      'pr.tr.approve': 'Zatwierdź plan',
      'pr.tr.approveReason': 'Zatwierdzono zgodnie z regulaminem wycieczek',
      'pr.tr.approvedMsg': 'Plan wycieczki zatwierdzony · uczniom wpisano status „w” na {n} lekcjach, przygotowano zastępstwa dla {s} opiekunów.',
      'pr.tr.approvedToast': 'Wycieczka zatwierdzona.',
      'pr.tr.approvedNote': 'Uczestnicy mają status „w” (wycieczka) — nie obniża frekwencji. Zastępstwa za opiekunów czekają na publikację.',
      'pr.tr.none': 'Brak złożonych planów wycieczek.',

      'pr.sp.title': 'Dziennik psychologa i pedagoga',
      'pr.sp.activities': 'Wpisy w dzienniku zajęć',
      'pr.sp.activitiesHint': '{f} – {t} · godzin: {h}',
      'pr.sp.documents': 'Dokumenty wsparcia',
      'pr.sp.documentsHint': 'WOPFU, IPET, opinie · chronionych poza wglądem: {n}',
      'pr.sp.caption': 'Aktywność specjalistów',
      'pr.sp.specialist': 'Specjalista',
      'pr.sp.entries': 'Wpisy',
      'pr.sp.consultations': 'Konsultacje',
      'pr.sp.hours': 'Godziny',
      'pr.sp.students': 'Uczniowie',
      'pr.sp.noteAuthor': 'autor notatki',
      'pr.sp.sealedText': 'Dyrektor widzi statystyki konsultacji i dokumenty wsparcia, bez treści notatek. Odczyt wymaga klucza specjalisty.',
      'pr.sp.meta': 'Szyfrowanie {alg} · odbiorców klucza: {n}',
      /* komentarze i notatki prywatne do wpisów rejestrów (screens/00-log-comments.js) */
      'pr.lc.col': 'Komentarze'
    },
    en: {
      'pr.title': 'Head teacher’s desk',
      'pr.sub': '{school} · school year {y} · as at {d}',
      'pr.tabs': 'Head teacher’s desk sections',
      'pr.tab.subs': 'Cover',
      'pr.tab.supervision': 'Supervision',
      'pr.tab.audit': 'Audit',
      'pr.tab.announcements': 'Announcements',
      'pr.popupBlocked': 'The browser blocked the new window — allow pop-ups to print the document.',
      'pr.act.login': 'signed in',
      'pr.act.login_failed': 'failed sign-in',
      'pr.act.logout': 'signed out',
      'pr.act.password_changed': 'changed their password',
      'pr.act.totp_enabled': 'enabled 2FA',
      'pr.act.grade_value_edit': 'changed a grade',
      'pr.act.grade_update': 'changed a grade',
      'pr.act.grade_create': 'added a grade',
      'pr.act.grade_delete': 'deleted a grade',
      'pr.act.attendance_entry_delete': 'deleted an attendance entry',
      'pr.act.attendance_update': 'changed attendance',
      'pr.act.grades_export': 'exported grades',
      'pr.act.classification_grade_invalidated': 'annulled a final grade',
      'pr.act.account_blocked': 'blocked an account',
      'pr.act.account_unblocked': 'unblocked an account',
      'pr.act.announcement_published': 'published an announcement',
      'pr.act.announcement_acknowledged': 'confirmed reading an announcement',
      'pr.act.substitution_created': 'recorded an absence',
      'pr.act.substitution_assigned': 'assigned cover',
      'pr.act.substitution_published': 'published cover arrangements',
      'pr.act.trip_approved': 'approved a trip',
      'pr.act.archive_generated': 'generated an archive package',
      'pr.act.archive_exported': 'downloaded an archive package',
      'pr.act.archive_signature_attached': 'attached a signature to an archive package',
      'pr.act.payroll_exported': 'exported the hours settlement',
      'pr.act.visibility_changed': 'changed the visibility settings',
      'pr.act.acting_homeroom_assigned': 'assigned acting form tutor duties',
      'pr.act.acting_homeroom_revoked': 'withdrew acting form tutor duties',
      'pr.act.confidential_note_access_denied': 'tried to read a confidential note (denied)',

      'pr.sb.reportTitle': 'Report a teacher absence',
      'pr.sb.reportSub': 'Once saved, the system lists every lesson in that period and suggests who can cover it.',
      'pr.sb.pickTeacher': 'Choose a teacher',
      'pr.sb.reasonLabel': 'Grounds for the absence',
      'pr.sb.reason.sick': 'Sick leave (L4)',
      'pr.sb.reason.childcare': 'Childcare leave',
      'pr.sb.reason.training': 'Training leave',
      'pr.sb.reason.travel': 'Official travel',
      'pr.sb.from': 'Absent from',
      'pr.sb.to': 'Absent until',
      'pr.sb.run': 'Find cover',
      'pr.sb.started': 'Cover search started · {t}, {f} – {to} · lessons to cover: {n}.',
      'pr.sb.saved': 'The absence report has been saved.',
      'pr.sb.assigned': 'Cover assigned · lesson {n}, {s} {c}, {d}{tail}',
      'pr.sb.combinedTail': ' · classes combined in the hall, one paid cover hour.',
      'pr.sb.cancelled': 'Lesson cancelled · parents of class {c} notified (sent: {n}).',
      'pr.sb.moved': 'Lesson moved · parents notified.',
      'pr.sb.cleared': 'Cover removed — pick a teacher from the suggestions.',
      'pr.sb.scheduled': 'Publication scheduled for {d} — timetables will update at that time.',
      'pr.sb.publishedMsg': 'Cover arrangements published {d} · notifications: {n}.',
      'pr.sb.toastScheduled': 'Publication scheduled.',
      'pr.sb.toastPublished': 'Cover arrangements published.',
      'pr.sb.publishedDue': 'Scheduled sheets published: {n}.',
      'pr.sb.tier': 'Selection basis',
      'pr.sb.why': 'Rationale',
      'pr.sb.adHocWeek': 'Cover hours this week',
      'pr.sb.action': 'Action',
      'pr.sb.assign': 'Assign',
      'pr.sb.assignAria': 'Assign {name} — lesson {n}, {s} {c}',
      'pr.sb.listTitle': 'Absence reports',
      'pr.sb.chosen': 'Selected report',
      'pr.sb.lessons.one': '{n} lesson',
      'pr.sb.lessons.other': '{n} lessons',
      'pr.sb.publishedWord': 'published',
      'pr.sb.draftWord': 'draft',
      'pr.sb.lessonsTitle': 'Lessons needing cover · {f} – {t}',
      'pr.sb.publishedBadge': 'Published {d}',
      'pr.sb.draftBadge': 'Draft',
      'pr.sb.statPaid': 'Cover hours to be paid',
      'pr.sb.statPaidCombined': 'Combined classes count as one hour',
      'pr.sb.statPaidSeparate': 'Each class counted separately',
      'pr.sb.statOpen': 'Lessons without cover',
      'pr.sb.statOpenHint': 'Cover every lesson before publishing',
      'pr.sb.statReady': 'The plan is ready to publish',
      'pr.sb.statCancelled': 'Lessons cancelled',
      'pr.sb.statCancelledHint': 'Parents notified of the timetable change',
      'pr.sb.combine': 'Combine parallel classes in the hall (one teacher)',
      'pr.sb.combineHint': 'Head teacher’s consent to combine classes · one paid cover hour instead of two',
      'pr.sb.absentTeacher': '{n} (absent)',
      'pr.sb.noteCancel': 'lesson cancelled',
      'pr.sb.noteCombine': ' · classes combined in the hall, one teacher',
      'pr.sb.noteOpen': ' · lesson without cover',
      'pr.sb.parentsNotified': 'Notifications to parents: {n} · {tail}',
      'pr.sb.comesLater': 'the class arrives for the next lesson.',
      'pr.sb.leavesEarlier': 'the class finishes early.',
      'pr.sb.suggCaption': 'Cover suggestions · lesson {n}, {s} {c}, {d}',
      'pr.sb.cancelFirst': 'Cancel (class arrives later)',
      'pr.sb.cancelLast': 'Cancel (class leaves earlier)',
      'pr.sb.coverBadge': 'Cover: {n}{tail}',
      'pr.sb.hallTail': ' · main hall',
      'pr.sb.changeCover': 'Change cover',
      'pr.sb.publishAt': 'Publication time',
      'pr.sb.publishAtHint': 'Customarily 15:00 on the preceding day',
      'pr.sb.publish': 'Publish the cover arrangements',
      'pr.sb.publishDue': 'Publish scheduled sheets',
      'pr.sb.publishedAlert': 'Cover arrangements published',
      'pr.sb.publishedBody': 'The changes are visible in the timetables of pupils, teachers and parents.',
      'pr.sb.publishedCount': ' Notifications sent: {n}.',

      'pr.sv.statTopic': 'Missing lesson topics this week',
      'pr.sv.statTopicHint': 'Lessons checked: {n}',
      'pr.sv.statAtt': 'Missing attendance',
      'pr.sv.statTests': 'Classes over the test limit',
      'pr.sv.statTestsHint': 'Last {w}',
      'pr.sv.weeks.one': '{n} week',
      'pr.sv.weeks.other': '{n} weeks',
      'pr.sv.statCurr': 'Curriculum coverage',
      'pr.sv.statCurrHint': 'Plan for today: {p}%',
      'pr.sv.compTitle': 'Audit of logbook completeness',
      'pr.sv.compRange': ' · {f} – {t}',
      'pr.sv.classes.one': '{n} class',
      'pr.sv.classes.other': '{n} classes',
      'pr.sv.gapLessons.one': '{n} lesson with gaps',
      'pr.sv.gapLessons.other': '{n} lessons with gaps',
      'pr.sv.compCaption': 'Missing topics and attendance in the past week',
      'pr.sv.subjects': 'Subjects',
      'pr.sv.missTopic': 'Topic missing',
      'pr.sv.missAtt': 'Attendance missing',
      'pr.sv.gaps': 'Gaps',
      'pr.sv.compNote': 'The list of gaps names the teachers responsible for the entries (for a covered lesson, the covering teacher).',
      'pr.sv.currTitle': 'Coverage of the national curriculum',
      'pr.sv.currSem': ' · semester {n}',
      'pr.sv.currHint': '{d} of {p} hours taught · units: {a}/{b}',
      'pr.sv.currNote': 'The marker on the bar shows the plan for today ({p}% of curriculum units).',
      'pr.sv.loadTitle': 'Test load',
      'pr.sv.loadCaption': 'Number of tests against the limits in the school statute',
      'pr.sv.tests': 'Tests',
      'pr.sv.maxDay': 'Max. per day',
      'pr.sv.maxWeek': 'Max. per week',
      'pr.sv.over': 'Over the limit · {n}',
      'pr.sv.within': 'Within the limit',
      'pr.sv.limits': 'Statute limits: {d} test per day, {w} per week.',
      'pr.sv.payTitle': 'Overtime and cover lessons',
      'pr.sv.period': 'Settlement period',
      'pr.sv.payCaption': 'Overtime and cover lessons under the Teachers’ Charter (Karta Nauczyciela)',
      'pr.sv.level': 'Career stage',
      'pr.sv.pensum': 'Contracted hours',
      'pr.sv.held': 'Taught',
      'pr.sv.overtime': 'Overtime',
      'pr.sv.adhoc': 'Cover',
      'pr.sv.total': 'Total',
      'pr.sv.weeksNote': '{b} · teaching weeks in the period: {n}.',
      'pr.sv.exportCsv': 'Export CSV',
      'pr.sv.exportXml': 'Export XML (Rozliczenie)',
      'pr.sv.xmlFmt': 'XML (Rozliczenie)',
      'pr.sv.reportKN': 'Teachers’ Charter settlement (Karta Nauczyciela)',
      'pr.sv.exportDone': 'Export ready: settlement for {m} as {f} · teachers: {t}, cover hours: {h}.',

      'pr.au.filters': 'Log filters',
      'pr.au.events': 'Events: {n} of {t}',
      'pr.au.ip': 'IP address',
      'pr.au.ipHint': 'Matched on the start of the address',
      'pr.au.user': 'User',
      'pr.au.allUsers': 'Everyone',
      'pr.au.operation': 'Operation',
      'pr.au.allOps': 'All operations',
      'pr.au.editOrDelete': 'Edits and deletions (grades, attendance)',
      'pr.au.dateFrom': 'Date from',
      'pr.au.dateTo': 'Date to',
      'pr.au.entity': 'Object',
      'pr.au.clear': 'Clear the filters',
      'pr.au.logTitle': 'Event log · edits, sign-ins, exports, blocks',
      'pr.au.loadError': 'Could not load the log: {m}',
      'pr.au.empty': 'No events for the chosen filters. Widen the date range or clear the IP address field.',
      'pr.au.immutable': 'The log is immutable; every entry keeps the original value, the reason, the IP address and the event id.',
      'pr.au.voidTitle': 'Annulling a final grade (appeals board)',
      'pr.au.gradePick': 'Pupil and grade',
      'pr.au.gradePickPh': 'Choose a final grade',
      'pr.au.kindFinal': 'annual',
      'pr.au.kindMid': 'mid-year',
      'pr.au.newGrade': 'New grade',
      'pr.au.newGradeHint': 'Grade from the re-examination (1–6)',
      'pr.au.protocolNo': 'Board minutes number',
      'pr.au.attach': 'Attach the minutes',
      'pr.au.origGrade': 'Original grade: {v} · {s}. Basis: art. 44n of the Education System Act (ustawa o systemie oświaty).',
      'pr.au.void': 'Annul and enter a new grade',
      'pr.au.voidHint': 'Choose the grade, enter the new one, give the minutes number and attach the scan.',
      'pr.au.voided': 'Grade annulled · grade {v} from the re-examination entered, minutes no. {p}. The original value is kept in the audit log.',
      'pr.au.voidedToast': 'The final grade has been annulled.',
      'pr.dlg.void.title': 'Annul the final grade?',
      'pr.dlg.void.body': '{s} · {sub}: grade {v} will be annulled and replaced with grade {nv} from the re-examination.',
      'pr.dlg.void.reason': 'Reason for annulment',
      'pr.dlg.void.hint': 'The reason goes to the audit log and to the statement of reasons',
      'pr.dlg.void.ph': 'e.g. request of the appeals board of 22/10/2026',
      'pr.au.accounts': 'Staff accounts',
      'pr.au.account': 'Account',
      'pr.au.pickStaff': 'Choose a staff member',
      'pr.au.sessions': 'sessions: {n}',
      'pr.au.blockedTag': ' · BLOCKED',
      'pr.au.block': 'Block the account and revoke sessions',
      'pr.au.blocked': 'Account {n} blocked · sessions revoked: {t} (web: {w}, mobile: {m}).',
      'pr.au.blockedToast': 'Account blocked, sessions revoked.',
      'pr.dlg.block.title': 'Block the account and revoke its sessions?',
      'pr.dlg.block.body': 'The account loses access immediately — in the web and mobile apps alike. The member of staff’s logbook entries stay untouched.',
      'pr.dlg.block.reason': 'Reason for blocking',
      'pr.dlg.block.ph': 'e.g. contract of employment terminated on 31/10/2026',
      'pr.dlg.block.ok': 'Block the account',
      'pr.au.acting': 'Acting form tutor',
      'pr.au.pickClass': 'Choose a class',
      'pr.au.actingPrefix': ' · acting {n}',
      'pr.au.pickTeacher': 'Choose a teacher',
      'pr.au.from': 'From',
      'pr.au.to': 'Until',
      'pr.au.entrust': 'Assign the duties',
      'pr.au.actingReason': 'Extended absence of the form tutor',
      'pr.au.actingDone': 'Acting form tutor of class {c}: {n} ({f} – {t}). {r}',
      'pr.au.actingNote': 'The form tutor named in the staffing plan stays responsible for classification and the class records.',
      'pr.au.archive': 'Annual archive',
      'pr.au.sealed': 'Sealed {d}',
      'pr.au.noPackage': 'No package',
      'pr.au.window': 'Statutory window: {f} – {t} · {s}',
      'pr.au.windowOpen': 'window open',
      'pr.au.windowNotYet': 'the window has not opened yet — a package built now is a demonstration, with an audit entry',
      'pr.au.windowOver': 'past the deadline — a package built now needs a reason and is recorded in the audit register',
      'pr.au.yearEnd': 'End of the school year: {d} · teaching ends {f}',
      'pr.au.genArchive': 'Generate the archive package',
      'pr.au.verify': 'Verify the seal',
      'pr.au.printPackage': 'Print the package',
      'pr.au.archiveForce': 'Demonstration of the package outside the statutory window',
      'pr.au.archived': 'Package {y} generated ({kb} kB) · seal {alg}, digest {d}…{tail}',
      'pr.au.archivedToast': 'The archive package has been sealed.',
      'pr.au.sealOk': 'Seal valid · digest {d}… matches the school signature.',
      'pr.au.sealBad': 'Seal invalid — the package was changed after signing.',
      'pr.au.st.not-started': 'Not started',
      'pr.au.st.package-ready': 'Package ready, not signed',
      'pr.au.st.signed': 'Package signed',
      'pr.au.st.overdue': 'Past the deadline',
      'pr.au.st.signature-unverified': 'Signature stored, not verified',
      'pr.au.deadline': 'Deadline under § 22 of the school-records regulation: {d}',
      'pr.au.daysLeft': 'days left: {n}',
      'pr.au.daysLeft0': 'last day of the deadline',
      'pr.au.overdueBy': 'days past the deadline: {n}',
      'pr.au.dlPackage': 'Download the package (.zip)',
      'pr.au.steps': 'Once the package exists, the head teacher signs it outside the logbook, in three steps:',
      'pr.au.stepsNone': 'Generate the package first — the three signing steps appear here once it exists.',
      'pr.au.step1': 'Download the package (.zip) and write it to a data carrier.',
      'pr.au.step2': 'Sign the manifest.sha256 file from the package (or the whole .zip) with a Trusted Profile signature (podpis zaufany, gov.pl), an e-ID card or a qualified signature.',
      'pr.au.step3': 'Come back here and attach the signature file the signing tool returned.',
      'pr.au.sigKind': 'Signature type',
      'pr.au.sigWhat': 'What was signed',
      'pr.au.sf.manifest': 'the manifest.sha256 file',
      'pr.au.sf.package': 'the whole .zip package',
      'pr.au.sigk.xades': 'XAdES (XML)',
      'pr.au.sigk.pades': 'PAdES (PDF)',
      'pr.au.sigk.zaufany': 'Podpis zaufany (gov.pl)',
      'pr.au.sigk.qualified': 'Qualified signature',
      'pr.au.sigk.osobisty': 'Podpis osobisty (e-ID card)',
      'pr.au.sigPick': 'Signature file',
      'pr.au.sigSend': 'Attach the signature',
      'pr.au.sigMatched': 'Digest matched — the signed digest is that of “{f}” in this package.',
      'pr.au.sigStored': 'Stored, not verified — the signature file carries no digest of this package.',
      'pr.au.sigNone': 'No signature has been attached to this package yet.',
      'pr.au.sigHave': 'Signature: {n} · {k} · attached by {b}, {d}',
      'pr.au.sigDownload': 'Download the signature file',
      'pr.au.sigNote': 'The logbook is not a qualified trust service: we check the digest only, never the validity of the signature or its certificate chain. The school-key seal proves integrity, it is not the § 22 signature.',
      'pr.au.sigToast': 'The signature has been attached to the package.',
      'pr.au.sigReminder': 'The § 22 deadline reminder keeps running: this file carries no digest of our package. Attach the right signature, or record that you accept it without verification.',
      'pr.au.acceptTitle': 'Accept the signature without digest verification',
      'pr.au.acceptReason': 'On what basis',
      'pr.au.acceptReasonHint': 'E.g. “verified in the trust provider’s validator on 12.09.2027”. The entry goes into the audit register.',
      'pr.au.acceptSend': 'Record the acceptance',
      'pr.au.accepted': 'Accepted without digest verification · {b}, {d} — {r}',
      'pr.au.acceptedToast': 'Acceptance without verification recorded.',
      'pr.au.superseded': 'This signature covers an earlier version of the package and no longer closes the deadline — the year was rebuilt on {d}.',
      'pr.au.rebuildTitle': 'This school year is already signed',
      'pr.au.rebuildBody': 'Rebuilding the package invalidates the attached signature: it stays with the previous package and stops closing the § 22 deadline. Give a reason for the rebuild.',
      'pr.au.rebuildReason': 'Reason for the rebuild',
      'pr.au.rebuildConfirm': 'Rebuild and invalidate the signature',
      'pr.au.rebuilt': 'School year rebuilt · the previous signature has been invalidated (package {p}).',
      'pr.au.delete': 'Delete the package',
      'pr.au.deleteTitle': 'Delete the archive package?',
      'pr.au.deleteBody': 'Package {y} from {d} disappears together with its XML, printout and ZIP files. The audit entry with the reason stays. A signed package cannot be deleted.',
      'pr.au.deleteReason': 'Reason for deleting',
      'pr.au.deleteConfirm': 'Delete the package',
      'pr.au.deleted': 'Package {y} deleted · files removed: {n}.',
      'pr.au.deletedToast': 'The archive package has been deleted.',
      'pr.au.visibility': 'Visibility on parent accounts',
      'pr.au.visRank': 'Show class rankings to parents',
      'pr.au.visAvg': 'Show the class average',
      'pr.au.visAvgParents': 'Show grade averages to parents',
      'pr.au.off': 'off',
      'pr.au.on': 'on',
      'pr.au.visNote': 'The settings apply to every parent and pupil account in the school.',
      'pr.au.visRankOn': 'Class rankings are visible on parent accounts.',
      'pr.au.visRankOff': 'Class rankings hidden — comparing pupils is switched off.',
      'pr.au.visAvgOn': 'The class average is visible on parent accounts.',
      'pr.au.visAvgOff': 'The class average is hidden on parent accounts.',

      'pr.an.title': 'School-wide announcement for parents and staff',
      'pr.an.titleField': 'Announcement title',
      'pr.an.bodyField': 'Announcement text',
      'pr.an.bodyHint': 'Every recipient sees this text; resolution numbers are quoted verbatim',
      'pr.an.parents': 'Parents',
      'pr.an.staff': 'Staff',
      'pr.an.students': 'Pupils',
      'pr.an.requireAck': 'Require a read receipt (blocks other views)',
      'pr.an.requireAckHint': 'Until the receipt is given, the other logbook views are blocked',
      'pr.an.publish': 'Publish',
      'pr.an.published': 'Announcement “{t}” published · recipients: {n}{tail}',
      'pr.an.ackTail': ' · requires a read receipt (blocks the other views).',
      'pr.an.publishedToast': 'Announcement published.',
      'pr.an.receipts': 'Read receipts · {t}',
      'pr.an.ackOf': '{a} of {b}',
      'pr.an.receiptsBar': 'Read receipts',
      'pr.an.receiptsCaption': 'Receipts by recipient group',
      'pr.an.group': 'Group',
      'pr.an.acked': 'Confirmed',
      'pr.an.recipients': 'Recipients',
      'pr.an.complete': 'Complete',
      'pr.an.awaiting': 'Awaiting {n}',
      'pr.an.pendingNames': 'Still without a receipt: {names}{tail}',
      'pr.an.andOthers': ' and {n} others',
      'pr.dlg.preview.back': 'Back to editing',
      'pr.dlg.preview.publish': 'Publish the announcement',
      'pr.dlg.preview.ack': 'This is how recipients will see the announcement. The other logbook views stay blocked until they confirm; the confirmation is recorded with date and time.',
      'pr.dlg.preview.noAck': 'This is how recipients will see the announcement. No read receipt is required.',

      'pr.lg.title': 'Parent sign-in statistics',
      'pr.lg.stale': 'Accounts with no sign-in for 30+ days',
      'pr.lg.staleHint': 'Risk of digital exclusion',
      'pr.lg.never': 'Accounts that have never signed in',
      'pr.lg.active': 'Parents in regular contact',
      'pr.lg.activeHint': '{n} parent accounts',
      'pr.lg.caption': 'Sign-ins by parents and households',
      'pr.lg.parent': 'Parent',
      'pr.lg.children': 'Children',
      'pr.lg.last': 'Last sign-in',
      'pr.lg.noLogin': 'never signed in',
      'pr.lg.count': 'Sign-ins',
      'pr.lg.badgeNever': 'Never signed in',
      'pr.lg.badgeStale': 'No sign-in for 30+ days',
      'pr.lg.badgeOk': 'Regular contact',
      'pr.lg.note': 'For accounts with no sign-in, the form tutor passes the information on paper. Households at risk: {n}.',

      'pr.tr.title': 'Trips awaiting approval',
      'pr.tr.approved': 'Plan approved',
      'pr.tr.pending': 'Awaiting approval',
      'pr.tr.meta': 'Trip leader: {l} · chaperones: {c} · participants: {n}{ins}',
      'pr.tr.insurance': ' · insurance {i} {p}',
      'pr.tr.approve': 'Approve the plan',
      'pr.tr.approveReason': 'Approved in line with the school trip rules',
      'pr.tr.approvedMsg': 'Trip plan approved · pupils marked with status “w” for {n} lessons, cover prepared for {s} chaperones.',
      'pr.tr.approvedToast': 'Trip approved.',
      'pr.tr.approvedNote': 'Participants carry the status “w” (school trip) — it does not lower attendance. Cover for the chaperones is waiting to be published.',
      'pr.tr.none': 'No trip plans have been submitted.',

      'pr.sp.title': 'Psychologist and counsellor logbook',
      'pr.sp.activities': 'Entries in the activity log',
      'pr.sp.activitiesHint': '{f} – {t} · hours: {h}',
      'pr.sp.documents': 'Support documents',
      'pr.sp.documentsHint': 'WOPFU, IPET, opinions · protected from view: {n}',
      'pr.sp.caption': 'Specialist activity',
      'pr.sp.specialist': 'Specialist',
      'pr.sp.entries': 'Entries',
      'pr.sp.consultations': 'Consultations',
      'pr.sp.hours': 'Hours',
      'pr.sp.students': 'Pupils',
      'pr.sp.noteAuthor': 'the note’s author',
      'pr.sp.sealedText': 'The head teacher sees consultation statistics and support documents, but not the content of the notes. Reading them requires the specialist’s key.',
      'pr.sp.meta': 'Encryption {alg} · key holders: {n}',
      'pr.lc.col': 'Comments'
    }
  });
  /* Native date inputs render in the BROWSER locale (a Polish UI gets mm/dd/yyyy in an English Chrome),
     so every date field repeats the chosen day in the interface locale. */

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function openPrint(html) {
    var w = window.open('', '_blank');
    if (!w) { A.toast(A.t('pr.popupBlocked'), 'danger'); return; }
    w.document.open(); w.document.write(html); w.document.close(); w.focus();
  }
  function Card(p) {
    return h('section', { className: 'card', 'aria-labelledby': p.id },
      h('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
        /* U3-28: jedyny nagłówek poza `h1` ekranu — `h2`, żeby nawigacja po nagłówkach nie
           przeskakiwała poziomu na każdej karcie (axe `heading-order`, 12 wystąpień). */
        p.title && h('h2', { id: p.id, className: 'heading', style: { margin: 0 } }, p.title),
        p.aside),
      p.sub && h('p', { className: 'muted', style: { marginTop: 'var(--space-2)' } }, p.sub),
      h('div', { className: 'stack', style: { marginTop: 'var(--space-3)' } }, p.children));
  }
  function Live(p) { return h('p', { className: 'muted', role: 'status', 'aria-live': 'polite' }, p.children || ''); }
  var TONE = ['brand', 'accent', 'outline', 'outline'];
  var ACTIONS = ['login', 'login_failed', 'logout', 'password_changed', 'totp_enabled', 'grade_value_edit', 'grade_update', 'grade_create', 'grade_delete',
    'attendance_entry_delete', 'attendance_update', 'grades_export', 'classification_grade_invalidated', 'account_blocked', 'account_unblocked',
    'announcement_published', 'announcement_acknowledged', 'substitution_created', 'substitution_assigned', 'substitution_published',
    'trip_approved', 'archive_generated', 'archive_exported', 'archive_signature_attached', 'payroll_exported', 'visibility_changed',
    'acting_homeroom_assigned', 'acting_homeroom_revoked', 'confidential_note_access_denied'];
  function actionLabel(a) { return ACTIONS.indexOf(a) >= 0 ? A.t('pr.act.' + a) : a; }
  /* Server sends some subject lists as Polish names only; map them back to ids through the shared subject dictionary. */
  var SUBJ_BY_PL = null;
  function subjectByName(name) {
    if (!SUBJ_BY_PL) { SUBJ_BY_PL = {}; var d = (window.EdI18n.dict && window.EdI18n.dict.pl) || {}; Object.keys(d).forEach(function (k) { if (k.indexOf('subject.') === 0) SUBJ_BY_PL[d[k]] = k.slice(8); }); }
    var id = SUBJ_BY_PL[name]; return id ? A.subjectName(id, name) : name;
  }

  /* ============================================================ 1. Zastępstwa (3.3.1–3.3.7 część planistyczna) */
  function Zastepstwa() {
    var staff = A.useApi('/api/principal/staff', []);
    var list = A.useApi('/api/substitutions', []);
    var REASONS = ['sick', 'childcare', 'training', 'travel'].map(function (k) { return A.t('pr.sb.reason.' + k); });
    var s0 = React.useState({ teacherId: '', from: '', to: '', reason: REASONS[0] }), form = s0[0], setForm = s0[1];
    var s1 = React.useState(null), currentId = s1[0], setCurrentId = s1[1];
    var s2 = React.useState(''), said = s2[0], setSaid = s2[1];
    var s3 = React.useState(false), combine = s3[0], setCombine = s3[1];
    var s4 = React.useState(''), publishAt = s4[0], setPublishAt = s4[1];
    var subs = (list.data && list.data.substitutions) || [];
    var chosen = currentId || (subs[0] && subs[0].id) || null;
    var detail = A.useApi(chosen ? '/api/substitutions/' + chosen : null, [chosen, list.data]);
    var d = detail.data;

    function submit(e) {
      e.preventDefault();
      A.api.post('/api/substitutions', form).then(function (r) {
        setCurrentId(r.id); list.reload();
        setSaid(A.t('pr.sb.started', { t: r.teacherName, f: A.fmtDate(r.from), to: A.fmtDate(r.to), n: r.stats.open }));
        A.toast(A.t('pr.sb.saved'), 'success');
      }).catch(function (err) { A.toast(err.message, 'danger'); });
    }
    function assign(lesson, teacherId) {
      var pair = combine && parallelOf(lesson);
      var body = pair
        ? { lessonId: lesson.id, kind: 'combine', combineWithLessonId: pair.id, substituteTeacherId: teacherId, room: 'aula' }
        : { lessonId: lesson.id, substituteTeacherId: teacherId };
      A.api.post('/api/substitutions/' + d.id + '/assign', body).then(function () {
        detail.reload(); list.reload();
        setSaid(A.t('pr.sb.assigned', { n: lesson.lessonNo, s: A.subjectName(lesson.subjectId, lesson.subjectName), c: lesson.className, d: A.fmtDate(lesson.date), tail: pair ? A.t('pr.sb.combinedTail') : '.' }));
      }).catch(function (err) { A.toast(err.message, 'danger'); });
    }
    function act(lesson, kind) {
      A.api.post('/api/substitutions/' + d.id + '/assign', { lessonId: lesson.id, kind: kind }).then(function (r) {
        detail.reload();
        var a = r.assignments.filter(function (x) { return x.lessonId === lesson.id; })[0];
        setSaid(kind === 'cancel'
          ? A.t('pr.sb.cancelled', { c: lesson.className, n: a.parentsNotified })
          : A.t('pr.sb.moved'));
      }).catch(function (err) { A.toast(err.message, 'danger'); });
    }
    function clear(lesson) { A.api.post('/api/substitutions/' + d.id + '/clear', { lessonId: lesson.id }).then(function () { detail.reload(); setSaid(A.t('pr.sb.cleared')); }); }
    function parallelOf(lesson) {
      return (d.lessons || []).filter(function (x) { return x.id !== lesson.id && x.date === lesson.date && x.lessonNo === lesson.lessonNo; })[0] || null;
    }
    function publish() {
      /* The picker hands us local wall time ('2026-10-24T07:00'). We still send the instant, because
         substitutions.js compares publishAt against util.now(), but the wall time the principal actually
         typed travels with it so the server can stamp the school's zone instead of the browser's. */
      A.api.post('/api/substitutions/' + d.id + '/publish', publishAt ? { publishAt: new Date(publishAt).toISOString(), publishAtLocal: publishAt } : {}).then(function (r) {
        detail.reload(); list.reload();
        setSaid(r.scheduled
          ? A.t('pr.sb.scheduled', { d: A.fmtDateTime(r.publishAt) })
          : A.t('pr.sb.publishedMsg', { d: A.fmtDateTime(r.publishedAt), n: r.notifications }));
        A.toast(r.scheduled ? A.t('pr.sb.toastScheduled') : A.t('pr.sb.toastPublished'), 'success');
      }).catch(function (err) { A.toast(err.message, 'danger'); });
    }
    function publishDue() {
      A.api.post('/api/substitutions/publish-due', {}).then(function (r) { detail.reload(); list.reload(); setSaid(A.t('pr.sb.publishedDue', { n: r.published })); });
    }

    var teachers = ((staff.data && staff.data.staff) || []).filter(function (u) { return u.role === 'teacher' || u.role === 'principal'; });
    var suggCols = function (lesson) {
      return [
        { key: 'name', title: A.t('common.teacher') },
        { key: 'tier', title: A.t('pr.sb.tier'), render: function (r) { return h(E.Badge, { tone: TONE[r.tier] }, r.tierLabel); } },
        { key: 'why', title: A.t('pr.sb.why') },
        { key: 'adHocHours', title: A.t('pr.sb.adHocWeek'), num: true },
        { key: 'akcja', title: A.t('pr.sb.action'), render: function (r) {
            return h(E.Button, { size: 'sm', 'aria-label': A.t('pr.sb.assignAria', { name: r.name, n: lesson.lessonNo, s: A.subjectName(lesson.subjectId, lesson.subjectName), c: lesson.className }), onClick: function () { assign(lesson, r.teacherId); } }, A.t('pr.sb.assign'));
          } }
      ];
    };

    return h('div', { className: 'stack' },
      h(Card, { id: 'zg', title: A.t('pr.sb.reportTitle'), sub: A.t('pr.sb.reportSub') },
        h('form', { className: 'grid-2', onSubmit: submit },
          h(E.Select, { label: A.t('common.teacher'), required: true, value: form.teacherId, placeholder: A.t('pr.sb.pickTeacher'),
            options: teachers.map(function (u) { return { value: u.userId, label: u.name + (u.subjects.length ? ' · ' + u.subjects.join(', ') : '') }; }),
            onChange: function (e) { setForm(Object.assign({}, form, { teacherId: e.target.value })); } }),
          h(E.Select, { label: A.t('pr.sb.reasonLabel'), value: form.reason, onChange: function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); },
            options: REASONS.map(function (x) { return { value: x, label: x }; }) }),
          h(E.TextField, Object.assign({ label: A.t('pr.sb.from'), type: 'date', required: true, value: form.from, hint: A.dateHint(form.from), onChange: function (e) { setForm(Object.assign({}, form, { from: e.target.value })); } }, A.dateInputProps())),
          h(E.TextField, Object.assign({ label: A.t('pr.sb.to'), type: 'date', required: true, value: form.to, hint: A.dateHint(form.to), onChange: function (e) { setForm(Object.assign({}, form, { to: e.target.value })); } }, A.dateInputProps())),
          h('div', { className: 'row' }, h(E.Button, { variant: 'primary', icon: 'refresh', type: 'submit' }, A.t('pr.sb.run')))),
        h(Live, null, said)),

      subs.length ? h(Card, { id: 'wyb', title: A.t('pr.sb.listTitle') },
        h(E.Select, { label: A.t('pr.sb.chosen'), value: chosen || '', onChange: function (e) { setCurrentId(e.target.value); },
          options: subs.map(function (s) { return { value: s.id, label: s.teacherName + ' · ' + A.fmtDate(s.from) + '–' + A.fmtDate(s.to) + ' · ' + A.plural(s.stats.lessons, 'pr.sb.lessons') + ' · ' + (s.published ? A.t('pr.sb.publishedWord') : A.t('pr.sb.draftWord')) }; }) })) : null,

      d ? h(Card, {
        id: 'lek', title: A.t('pr.sb.lessonsTitle', { f: A.fmtDate(d.from), t: A.fmtDate(d.to) }),
        aside: d.published ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pr.sb.publishedBadge', { d: A.fmtDateTime(d.publishedAt) })) : h(E.Badge, { tone: 'accent', icon: 'clock' }, A.t('pr.sb.draftBadge'))
      },
        h('div', { className: 'grid-3' },
          h(E.StatTile, { label: A.t('pr.sb.statPaid'), value: String(d.stats.paidHours), hint: combine ? A.t('pr.sb.statPaidCombined') : A.t('pr.sb.statPaidSeparate') }),
          h(E.StatTile, { label: A.t('pr.sb.statOpen'), value: String(d.stats.open), alert: d.stats.open > 0, hint: d.stats.open ? A.t('pr.sb.statOpenHint') : A.t('pr.sb.statReady') }),
          h(E.StatTile, { label: A.t('pr.sb.statCancelled'), value: String(d.stats.cancelled), hint: A.t('pr.sb.statCancelledHint') })),
        h(E.Checkbox, { label: A.t('pr.sb.combine'), checked: combine, disabled: d.published,
          hint: A.t('pr.sb.combineHint'),
          onChange: function (e) { setCombine(e.target.checked); } }),
        h('div', { className: 'stack' }, (d.lessons || []).map(function (l) {
          var a = l.assignment || {};
          var pair = parallelOf(l);
          return h('div', { key: l.id, className: 'stack', style: { gap: 'var(--space-2)' } },
            h(E.LessonCard, {
              no: l.lessonNo, start: l.start, end: l.end, subject: A.subjectName(l.subjectId, l.subjectName),
              group: a.kind === 'combine' && pair ? l.className + ' + ' + pair.className : (l.groupName || l.className),
              room: a.room || l.room, teacher: A.t('pr.sb.absentTeacher', { n: d.teacherName }),
              state: a.kind === 'cancel' ? 'cancel' : (a.substituteTeacherId ? 'sub' : 'normal'),
              sub: a.substituteTeacherId ? l.substituteName : undefined,
              note: A.fmtDate(l.date) + (a.kind === 'cancel' ? ' · ' + (a.note || A.t('pr.sb.noteCancel'))
                : a.kind === 'combine' ? A.t('pr.sb.noteCombine')
                : a.substituteTeacherId ? '' : A.t('pr.sb.noteOpen'))
            }),
            a.kind === 'cancel' && h('p', { className: 'muted' }, A.t('pr.sb.parentsNotified', { n: a.parentsNotified || 0, tail: l.first ? A.t('pr.sb.comesLater') : A.t('pr.sb.leavesEarlier') })),
            !d.published && !a.substituteTeacherId && a.kind !== 'cancel' && h('div', { className: 'stack', style: { gap: 'var(--space-2)' } },
              h(E.Table, { caption: A.t('pr.sb.suggCaption', { n: l.lessonNo, s: A.subjectName(l.subjectId, l.subjectName), c: l.className, d: A.fmtDate(l.date) }),
                columns: suggCols(l), rows: (l.suggestions || []).map(function (s, i) { return Object.assign({ id: l.id + '-' + i }, s, { name: (i + 1) + '. ' + s.name }); }) }),
              (l.first || l.last) && h('div', { className: 'row' },
                h(E.Button, { size: 'sm', variant: 'quiet', icon: 'x', onClick: function () { act(l, 'cancel'); } },
                  l.first ? A.t('pr.sb.cancelFirst') : A.t('pr.sb.cancelLast')))),
            !d.published && a.substituteTeacherId && h('div', { className: 'row' },
              h(E.Badge, { tone: 'accent', icon: 'check' }, A.t('pr.sb.coverBadge', { n: l.substituteName, tail: a.kind === 'combine' ? A.t('pr.sb.hallTail') : '' })),
              h(E.Button, { size: 'sm', variant: 'quiet', onClick: function () { clear(l); } }, A.t('pr.sb.changeCover'))));
        })),
        !d.published && h('div', { className: 'grid-2' },
          h(E.TextField, Object.assign({ label: A.t('pr.sb.publishAt'), type: 'datetime-local', value: publishAt, hint: A.t('pr.sb.publishAtHint') + ' · ' + A.dateHint(publishAt, 'datetime'), onChange: function (e) { setPublishAt(e.target.value); } }, A.dateInputProps('datetime'))),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'primary', icon: 'bell', disabled: d.stats.open > 0, onClick: publish }, A.t('pr.sb.publish')),
            h(E.Button, { variant: 'quiet', icon: 'clock', onClick: publishDue }, A.t('pr.sb.publishDue')))),
        d.published && h(E.Alert, { tone: 'success', title: A.t('pr.sb.publishedAlert') },
          h('p', null, A.t('pr.sb.publishedBody') + (d.notifications ? A.t('pr.sb.publishedCount', { n: d.notifications }) : '')))) : null);
  }

  /* ============================================================ 2. Nadzór (3.3.8, 3.3.9, 3.3.14, 3.3.6, 3.3.7) */
  function Nadzor() {
    var comp = A.useApi('/api/principal/completeness', []);
    var cur = A.useApi('/api/principal/curriculum', []);
    var load = A.useApi('/api/principal/test-load?weeks=4', []);
    var s0 = React.useState(''), month = s0[0], setMonth = s0[1];
    var pay = A.useApi('/api/payroll/settlement' + (month ? '?month=' + month : ''), [month]);
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var c = comp.data, cu = cur.data, lo = load.data, p = pay.data;

    function exportPay(format) {
      var url = '/api/payroll/settlement/export?month=' + (p ? p.month : '') + '&format=' + format;
      A.api.get(url).then(function (txt) {
        download('rozliczenie-' + p.month + '.' + format, txt, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/xml;charset=utf-8');
        setSaid(A.t('pr.sv.exportDone', { m: p.month, f: format === 'csv' ? 'CSV' : A.t('pr.sv.xmlFmt'), t: p.totals.teachers, h: p.totals.adHocHours }));
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var months = [];
    for (var i = 0; i < 3; i++) { var dte = new Date((A.state.config ? A.state.config.today : '2026-10-23') + 'T00:00:00Z'); dte.setUTCMonth(dte.getUTCMonth() - i); months.push(dte.toISOString().slice(0, 7)); }

    return h('div', { className: 'stack' },
      h('div', { className: 'grid-3' },
        h(E.StatTile, { label: A.t('pr.sv.statTopic'), value: c ? String(c.totals.missingTopic) : '—', alert: !!(c && c.totals.missingTopic), hint: c ? A.t('pr.sv.statTopicHint', { n: c.lessonsChecked }) : '' }),
        h(E.StatTile, { label: A.t('pr.sv.statAtt'), value: c ? String(c.totals.missingAttendance) : '—', alert: !!(c && c.totals.missingAttendance) }),
        h(E.StatTile, { label: A.t('pr.sv.statTests'), value: lo ? String(lo.totals.exceeded) : '—', alert: !!(lo && lo.totals.exceeded), hint: lo ? A.t('pr.sv.statTestsHint', { w: A.plural(lo.weeks, 'pr.sv.weeks') }) : '' }),
        h(E.StatTile, { label: A.t('pr.sv.statCurr'), value: cu && cu.rows.length ? A.fmtPct(cu.rows.reduce(function (s, r) { return s + (r.percent || 0); }, 0) / cu.rows.length) : '—', hint: cu ? A.t('pr.sv.statCurrHint', { p: A.fmtNum(cu.expectedPercent, 1) }) : '' })),

      h(Card, { id: 'komp', title: A.t('pr.sv.compTitle') + (c ? A.t('pr.sv.compRange', { f: A.fmtDate(c.from), t: A.fmtDate(c.to) }) : ''),
        aside: c ? h(E.Badge, { tone: 'outline' }, A.plural(c.totals.classes, 'pr.sv.classes') + ' · ' + A.plural(c.totals.lessonsWithGaps, 'pr.sv.gapLessons')) : null },
        h(E.Table, { caption: A.t('pr.sv.compCaption'),
          columns: [
            { key: 'className', title: A.t('common.class') }, { key: 'teacherName', title: A.t('common.teacher') },
            { key: 'subjects', title: A.t('pr.sv.subjects'), render: function (r) { return r.subjects.map(subjectByName).join(', '); } },
            { key: 'missingTopic', title: A.t('pr.sv.missTopic'), num: true }, { key: 'missingAttendance', title: A.t('pr.sv.missAtt'), num: true },
            { key: 'st', title: A.t('common.status'), render: function () { return h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('pr.sv.gaps')); } }
          ], rows: c ? c.groups.map(function (g, i) { return Object.assign({ id: 'g' + i }, g); }) : [] }),
        h('p', { className: 'muted' }, A.t('pr.sv.compNote'))),

      h(Card, { id: 'pp', title: A.t('pr.sv.currTitle') + (cu ? A.t('pr.sv.currSem', { n: cu.semester }) : '') },
        h('div', { className: 'grid-2' }, (cu ? cu.rows.slice(0, 8) : []).map(function (r) {
          return h(E.ProgressBar, { key: r.classId + r.subjectId, label: A.subjectName(r.subjectId, r.subjectName) + ' · ' + r.className, value: r.percent || 0, mark: cu.expectedPercent,
            tone: r.behind ? 'danger' : undefined, valueText: A.fmtPct(r.percent),
            hint: A.t('pr.sv.currHint', { d: r.doneHours, p: r.plannedHours, a: r.itemsCovered, b: r.itemsTotal }) });
        })),
        h('p', { className: 'muted' }, A.t('pr.sv.currNote', { p: cu ? A.fmtNum(cu.expectedPercent, 1) : '—' }))),

      h(Card, { id: 'obc', title: A.t('pr.sv.loadTitle') + (lo ? A.t('pr.sv.compRange', { f: A.fmtDate(lo.from), t: A.fmtDate(lo.to) }) : '') },
        h(E.Table, { caption: A.t('pr.sv.loadCaption'),
          columns: [
            { key: 'className', title: A.t('common.class') }, { key: 'tests', title: A.t('pr.sv.tests'), num: true },
            { key: 'maxPerDay', title: A.t('pr.sv.maxDay'), num: true }, { key: 'maxPerWeek', title: A.t('pr.sv.maxWeek'), num: true },
            { key: 'st', title: A.t('common.status'), render: function (r) {
                return r.exceeded ? h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('pr.sv.over', { n: r.violations }))
                  : h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pr.sv.within'));
              } }
          ], rows: lo ? lo.rows.map(function (r) { return Object.assign({ id: r.classId }, r); }) : [] }),
        lo && h('p', { className: 'muted' }, A.t('pr.sv.limits', { d: lo.limits.perDay, w: lo.limits.perWeek }))),

      h(Card, { id: 'nadg', title: A.t('pr.sv.payTitle') + (p ? ' · ' + p.month : ''),
        aside: p ? h(E.Badge, { tone: 'outline' }, A.fmtMoney(p.totals.amount)) : null },
        h(E.Select, { label: A.t('pr.sv.period'), value: month || (p ? p.month : ''), options: months.map(function (m) { return { value: m, label: m }; }), onChange: function (e) { setMonth(e.target.value); } }),
        h(E.Table, { caption: A.t('pr.sv.payCaption'),
          columns: [
            { key: 'name', title: A.t('common.teacher') }, { key: 'levelName', title: A.t('pr.sv.level') },
            { key: 'pensum', title: A.t('pr.sv.pensum'), num: true }, { key: 'heldHours', title: A.t('pr.sv.held'), num: true },
            { key: 'overtimeHours', title: A.t('pr.sv.overtime'), num: true }, { key: 'adHocHours', title: A.t('pr.sv.adhoc'), num: true },
            { key: 'total', title: A.t('pr.sv.total'), num: true, render: function (r) { return A.fmtMoney(r.total); } }
          ], rows: p ? p.rows.map(function (r) { return Object.assign({ id: r.teacherId }, r); }) : [] }),
        p && h('p', { className: 'muted' }, A.t('pr.sv.weeksNote', { b: p.legalBasis, n: A.fmtNum(p.weeks, 1) })),
        h('div', { className: 'row' },
          h(E.Button, { icon: 'download', onClick: function () { exportPay('csv'); } }, A.t('pr.sv.exportCsv')),
          h(E.Button, { icon: 'download', onClick: function () { exportPay('xml'); } }, A.t('pr.sv.exportXml')),
          h(E.Button, { icon: 'print', onClick: function () { A.api.get('/api/payroll/settlement/print?month=' + (p ? p.month : '')).then(openPrint); } }, A.t('pr.sv.reportKN'))),
        h(Live, null, said)));
  }

  /* ============================================================ 2b. Rejestr zdarzeń (3.3.16)
     Filtry + lista wpisów z komentarzami. Osobny komponent, bo czyta go nie tylko dyrektor: trasa
     GET /api/principal/audit wpuszcza też IOD-a, więc ekran zgodności montuje ten sam widok
     (window.EdPrincipal.AuditRegister). Wzór z 2do.net: dziennik audytu jest zakładką w sekcji
     „Ustawienia i bezpieczeństwo” każdego, kto ma do niego prawo, a nie ekranem jednej roli.
     `staff` (lista do filtra „użytkownik”) jest opcjonalna — IOD nie ma trasy /api/principal/staff,
     więc dla niego opcje bierzemy z aktorów widocznych wpisów. */
  function RejestrZdarzen(p) {
    var s0 = React.useState({ ip: '', userId: '', from: '', to: '', action: '' }), f = s0[0], setF = s0[1];
    var qs = Object.keys(f).filter(function (k) { return f[k]; }).map(function (k) { return k + '=' + encodeURIComponent(f[k]); }).join('&');
    var log = A.useApi('/api/principal/audit' + (qs ? '?' + qs : ''), [qs, p.refresh || 0]);
    var L = log.data;
    var userOptions = p.staff ? p.staff.map(function (u) { return { value: u.userId, label: u.name }; })
      : (function () { var seen = {}, out = []; ((L && L.rows) || []).forEach(function (a) { if (a.userId && !seen[a.userId]) { seen[a.userId] = true; out.push({ value: a.userId, label: a.actor }); } }); return out; })();
    return h(React.Fragment, null,
      h(Card, { id: 'filtry', title: A.t('pr.au.filters'), aside: L ? h(E.Badge, { tone: 'outline' }, A.t('pr.au.events', { n: L.shown, t: L.total })) : null },
        h('div', { className: 'grid-3' },
          h(E.TextField, { label: A.t('pr.au.ip'), mono: true, value: f.ip, placeholder: '10.0.12.', hint: A.t('pr.au.ipHint'), onChange: function (e) { setF(Object.assign({}, f, { ip: e.target.value })); } }),
          h(E.Select, { label: A.t('pr.au.user'), value: f.userId, placeholder: A.t('pr.au.allUsers'), options: userOptions, onChange: function (e) { setF(Object.assign({}, f, { userId: e.target.value })); } }),
          h(E.Select, { label: A.t('pr.au.operation'), value: f.action, placeholder: A.t('pr.au.allOps'),
            options: [{ value: 'edit_or_delete', label: A.t('pr.au.editOrDelete') }].concat(((L && L.actions) || []).map(function (a) { return { value: a, label: actionLabel(a) }; })),
            onChange: function (e) { setF(Object.assign({}, f, { action: e.target.value })); } }),
          h(E.TextField, Object.assign({ label: A.t('pr.au.dateFrom'), type: 'date', value: f.from, onChange: function (e) { setF(Object.assign({}, f, { from: e.target.value })); }, hint: A.dateHint(f.from) }, A.dateInputProps())),
          h(E.TextField, Object.assign({ label: A.t('pr.au.dateTo'), type: 'date', value: f.to, onChange: function (e) { setF(Object.assign({}, f, { to: e.target.value })); }, hint: A.dateHint(f.to) }, A.dateInputProps())),
          h(E.Select, { label: A.t('pr.au.entity'), value: f.entity || '', placeholder: A.t('common.all'), options: ((L && L.entities) || []).map(function (a) { return { value: a, label: a }; }), onChange: function (e) { setF(Object.assign({}, f, { entity: e.target.value })); } })),
        h('div', { className: 'row' }, h(E.Button, { variant: 'quiet', icon: 'x', onClick: function () { setF({ ip: '', userId: '', from: '', to: '', action: '' }); } }, A.t('pr.au.clear')))),

      h(Card, { id: 'log', title: A.t('pr.au.logTitle') },
        log.error && h(E.Alert, { tone: 'danger' }, A.t('pr.au.loadError', { m: log.error.message })),
        !log.loading && !log.error && !((L && L.rows) || []).length && h('p', { className: 'muted' }, A.t('pr.au.empty')),
        /* Wiersz rejestru jest niezmienny — komentarz żyje obok niego, nie w nim (S-15). */
        h('div', null, ((L && L.rows) || []).slice(0, 25).map(function (a) {
          return h('div', { key: a.id },
            h(E.AuditEntry, {
              kind: a.kind, actor: a.actor, action: actionLabel(a.action), target: (a.entity || '') + (a.entityId ? ' · ' + a.entityId : ''),
              time: A.fmtDateTime(a.at), iso: a.at, reason: a.reason || undefined,
              from: a.before && (a.before.value || a.before.status) ? String(a.before.value || a.before.status) : undefined,
              to: a.after && (a.after.value || a.after.status) ? String(a.after.value || a.after.status) : undefined,
              meta: { ip: a.ip || undefined, id: a.id, device: a.client || undefined }
            }),
            h(window.EdLogComments.Toggle, { kind: 'audit', entryId: a.id, counts: (L && L.comments && L.comments[a.id]) || null, onChange: function () { log.reload(); } }));
        })),
        h(Live, null, p.status || A.t('pr.au.immutable'))));
  }

  /* ============================================================ 3. Audyt (3.3.16, 3.3.10, 3.3.11, 3.3.17, 3.3.18, 3.3.20) */
  function Audyt() {
    /* Rejestr zdarzeń jest osobnym komponentem (RejestrZdarzen), dzielonym z ekranem zgodności IOD-a;
       po każdej decyzji dyrektora podbijamy `rev`, żeby rejestr wczytał się na nowo. */
    var sR = React.useState(0), rev = sR[0];
    function bumpLog() { sR[1](function (x) { return x + 1; }); }
    var staff = A.useApi('/api/principal/staff', []);
    var classes = A.useApi('/api/principal/classes', []);
    var grades = A.useApi('/api/principal/classification-grades', []);
    var arch = A.useApi('/api/principal/archive', []);
    var vis = A.useApi('/api/principal/visibility', []);
    var s1 = React.useState({ gradeId: '', value: '', protocolNo: '', reason: '', attached: false }), inv = s1[0], setInv = s1[1];
    var s2 = React.useState(false), askVoid = s2[0], setAskVoid = s2[1];
    var s3 = React.useState({ userId: '', reason: '' }), blk = s3[0], setBlk = s3[1];
    var s4 = React.useState(false), askBlock = s4[0], setAskBlock = s4[1];
    var s5 = React.useState(''), said = s5[0], setSaid = s5[1];
    var s6 = React.useState({ classId: '', teacherId: '', from: '', to: '' }), act = s6[0], setAct = s6[1];
    /* R2 — podpis pod pakietem archiwalnym dyrektor składa poza dziennikiem; tutaj tylko go wnosi. */
    var s7 = React.useState({ kind: 'zaufany', signedFile: 'manifest.sha256', file: null, busy: false }), sig = s7[0], setSig = s7[1];
    /* S3-08/S3-13/H-9 — trzy decyzje dyrektora, których do R3 nie było na ekranie: przyjęcie
       podpisu bez weryfikacji skrótu, usunięcie niepodpisanego pakietu i przebudowa podpisanego. */
    var s8 = React.useState(''), acc = s8[0], setAcc = s8[1];
    var s9 = React.useState(null), askDel = s9[0], setAskDel = s9[1];
    var s10 = React.useState(null), askRebuild = s10[0], setAskRebuild = s10[1];
    var V = vis.data && vis.data.visibility;

    function voidGrade() {
      A.api.post('/api/principal/grades/' + inv.gradeId + '/invalidate', {
        value: inv.value, protocolNo: inv.protocolNo, reason: inv.reason,
        minutes: { name: 'protokol-komisji-' + inv.protocolNo.replace(/\//g, '-') + '.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK', size: 240000 }
      }).then(function (r) {
        setAskVoid(false); setInv({ gradeId: '', value: '', protocolNo: '', reason: '', attached: false });
        grades.reload(); bumpLog();
        setSaid(A.t('pr.au.voided', { v: r.grade.value, p: r.grade.appeal.protocolNo }));
        A.toast(A.t('pr.au.voidedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function blockAccount() {
      A.api.post('/api/principal/users/' + blk.userId + '/block', { reason: blk.reason }).then(function (r) {
        setAskBlock(false); staff.reload(); bumpLog();
        setSaid(A.t('pr.au.blocked', { n: r.name, t: r.revokedSessions.total, w: r.revokedSessions.web, m: r.revokedSessions.mobile }));
        A.toast(A.t('pr.au.blockedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function setActing() {
      A.api.post('/api/principal/classes/' + act.classId + '/acting-homeroom', { teacherId: act.teacherId, from: act.from, to: act.to, reason: A.t('pr.au.actingReason') })
        .then(function (r) { classes.reload(); setSaid(A.t('pr.au.actingDone', { c: r.className, n: r.actingHomeroomTeacherName, f: A.fmtDate(r.actingFrom), t: A.fmtDate(r.actingTo), r: r.responsibility })); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function makeArchive(force, rebuild) {
      var reason = rebuild && rebuild.reason ? rebuild.reason : force ? A.t('pr.au.archiveForce') : null;
      A.api.post('/api/principal/archive', { force: !!force, reason: reason, rebuild: !!(rebuild && rebuild.reason) }).then(function (r) {
        setAskRebuild(null);
        arch.reload(); bumpLog();
        setSaid(A.t('pr.au.archived', { y: r.year, kb: Math.round(r.bytes / 1024), alg: r.seal.alg, d: r.seal.digest.slice(0, 16), tail: r.forced ? ' · ' + r.forceNote : '' })
          + (r.supersededPackageId ? ' · ' + A.t('pr.au.rebuilt', { p: r.supersededPackageId }) : ''));
        A.toast(A.t('pr.au.archivedToast'), 'success');
      }).catch(function (e) {
        /* H-9: rocznik jest podpisany — nie przebudowujemy go po cichu, tylko pytamy o powód. */
        if (e.data && e.data.code === 'year_signed') { setAskRebuild({ packageId: e.data.packageId, reason: '' }); return; }
        A.toast(e.message, 'danger');
      });
    }
    function acceptUnverified(id) {
      A.api.post('/api/principal/archive/' + id + '/accept-unverified', { reason: acc }).then(function (r) {
        setAcc(''); arch.reload(); bumpLog();
        setSaid(A.t('pr.au.accepted', { b: r.signature.accepted.by, d: A.fmtDateTime(r.signature.accepted.at), r: r.signature.accepted.reason }));
        A.toast(A.t('pr.au.acceptedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function deleteArchive() {
      var d = askDel;
      A.api.delete('/api/principal/archive/' + d.id, { reason: d.reason }).then(function (r) {
        setAskDel(null); arch.reload(); bumpLog();
        setSaid(A.t('pr.au.deleted', { y: d.year, n: r.removedFiles }));
        A.toast(A.t('pr.au.deletedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function verify(id) { A.api.get('/api/principal/archive/' + id + '/verify').then(function (r) { setSaid(r.valid ? A.t('pr.au.sealOk', { d: r.digest.slice(0, 24) }) : A.t('pr.au.sealBad')); }); }
    /* Pakiet to bajty (ZIP), nie JSON — pobieramy go zwykłym odnośnikiem z ciasteczkiem sesji. */
    function fetchFile(path) {
      var a = document.createElement('a');
      a.href = A.base + path; a.rel = 'noopener'; a.download = '';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    function pickSignature(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); setSig(Object.assign({}, sig, { file: { name: f.name, base64: s.slice(s.indexOf(',') + 1) } })); };
      fr.readAsDataURL(f);
    }
    function sendSignature(id) {
      if (!sig.file) return;
      setSig(Object.assign({}, sig, { busy: true }));
      A.api.post('/api/principal/archive/' + id + '/signature', { name: sig.file.name, contentBase64: sig.file.base64, kind: sig.kind, signedFile: sig.signedFile })
        .then(function (r) {
          setSig({ kind: sig.kind, signedFile: sig.signedFile, file: null, busy: false });
          arch.reload(); bumpLog();
          setSaid(r.signature.verification === 'digest-matched' ? A.t('pr.au.sigMatched', { f: (r.signature.matched[0] || {}).file || '' }) : A.t('pr.au.sigStored'));
          A.toast(A.t('pr.au.sigToast'), 'success');
        })
        .catch(function (e) { setSig(Object.assign({}, sig, { busy: false })); A.toast(e.message, 'danger'); });
    }
    function patchVis(k, v) { A.api.patch('/api/principal/visibility', (function () { var o = {}; o[k] = v; return o; })()).then(function () { vis.reload(); setSaid(k === 'rankings' ? A.t(v ? 'pr.au.visRankOn' : 'pr.au.visRankOff') : A.t(v ? 'pr.au.visAvgOn' : 'pr.au.visAvgOff')); }); }

    var chosenGrade = ((grades.data && grades.data.grades) || []).filter(function (g) { return g.id === inv.gradeId; })[0];
    return h('div', { className: 'stack' },
      h(RejestrZdarzen, { staff: (staff.data && staff.data.staff) || null, status: said, refresh: rev }),

      h('div', { className: 'grid-2' },
        h(Card, { id: 'uniew', title: A.t('pr.au.voidTitle') },
          h(E.Select, { label: A.t('pr.au.gradePick'), value: inv.gradeId, placeholder: A.t('pr.au.gradePickPh'),
            options: ((grades.data && grades.data.grades) || []).map(function (g) { return { value: g.id, label: g.className + ' · ' + g.studentName + ' · ' + A.subjectName(g.subjectId, g.subjectName) + ' · ' + (g.kind === 'final' ? A.t('pr.au.kindFinal') : A.t('pr.au.kindMid')) + ' ' + g.value }; }),
            onChange: function (e) { setInv(Object.assign({}, inv, { gradeId: e.target.value })); } }),
          h('div', { className: 'grid-2' },
            h(E.TextField, { label: A.t('pr.au.newGrade'), mono: true, value: inv.value, hint: A.t('pr.au.newGradeHint'), onChange: function (e) { setInv(Object.assign({}, inv, { value: e.target.value })); } }),
            h(E.TextField, { label: A.t('pr.au.protocolNo'), mono: true, value: inv.protocolNo, placeholder: '12/2026/2027', onChange: function (e) { setInv(Object.assign({}, inv, { protocolNo: e.target.value })); } })),
          h('div', { className: 'row' },
            h(E.Button, { icon: 'file', onClick: function () { setInv(Object.assign({}, inv, { attached: true })); } }, A.t('pr.au.attach')),
            inv.attached && h(E.Badge, { tone: 'info', icon: 'file' }, 'protokol-komisji.pdf · 240 kB')),
          chosenGrade && h('p', { className: 'muted' }, A.t('pr.au.origGrade', { v: chosenGrade.value, s: A.subjectName(chosenGrade.subjectId, chosenGrade.subjectName) })),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'danger', icon: 'warning', disabled: !(inv.gradeId && inv.value && inv.protocolNo && inv.attached), onClick: function () { setAskVoid(true); } }, A.t('pr.au.void')),
            !(inv.gradeId && inv.value && inv.protocolNo && inv.attached) && h('span', { className: 'muted' }, A.t('pr.au.voidHint')))),

        h('div', { className: 'stack' },
          h(Card, { id: 'konta', title: A.t('pr.au.accounts') },
            h(E.Select, { label: A.t('pr.au.account'), value: blk.userId, placeholder: A.t('pr.au.pickStaff'),
              options: ((staff.data && staff.data.staff) || []).filter(function (u) { return u.role !== 'principal'; }).map(function (u) { return { value: u.userId, label: u.name + ' · ' + A.t('role.' + u.role) + ' · ' + A.t('pr.au.sessions', { n: u.sessions }) + (u.blocked ? A.t('pr.au.blockedTag') : '') }; }),
              onChange: function (e) { setBlk(Object.assign({}, blk, { userId: e.target.value })); } }),
            h('div', { className: 'row' },
              h(E.Button, { variant: 'danger', icon: 'log-out', disabled: !blk.userId, onClick: function () { setAskBlock(true); } }, A.t('pr.au.block')))),

          h(Card, { id: 'po', title: A.t('pr.au.acting') },
            h('div', { className: 'grid-2' },
              h(E.Select, { label: A.t('common.class'), value: act.classId, placeholder: A.t('pr.au.pickClass'), options: ((classes.data && classes.data.classes) || []).map(function (c) { return { value: c.classId, label: c.className + ' · ' + c.homeroomTeacherName + (c.actingHomeroomTeacherName ? A.t('pr.au.actingPrefix', { n: c.actingHomeroomTeacherName }) : '') }; }), onChange: function (e) { setAct(Object.assign({}, act, { classId: e.target.value })); } }),
              h(E.Select, { label: A.t('common.teacher'), value: act.teacherId, placeholder: A.t('pr.au.pickTeacher'), options: ((staff.data && staff.data.staff) || []).filter(function (u) { return u.role === 'teacher'; }).map(function (u) { return { value: u.userId, label: u.name }; }), onChange: function (e) { setAct(Object.assign({}, act, { teacherId: e.target.value })); } }),
              h(E.TextField, Object.assign({ label: A.t('pr.au.from'), type: 'date', value: act.from, onChange: function (e) { setAct(Object.assign({}, act, { from: e.target.value })); }, hint: A.dateHint(act.from) }, A.dateInputProps())),
              h(E.TextField, Object.assign({ label: A.t('pr.au.to'), type: 'date', value: act.to, onChange: function (e) { setAct(Object.assign({}, act, { to: e.target.value })); }, hint: A.dateHint(act.to) }, A.dateInputProps()))),
            h('div', { className: 'row' }, h(E.Button, { disabled: !(act.classId && act.teacherId && act.to), onClick: setActing }, A.t('pr.au.entrust'))),
            h('p', { className: 'muted' }, A.t('pr.au.actingNote'))),

          (function () {
            /* R2 — archiwum roczne jako pakiet do podpisania na zewnątrz (docs/ARCHIVE.md).
               R3: U3-06 (dwa różne stany okna), U3-07 (instrukcja pojawia się razem z przyciskami,
               o których mówi), S3-08 (przyjęcie bez weryfikacji jako osobna, uzasadniona decyzja),
               S3-13 (usunięcie niepodpisanego pakietu), H-9 (przebudowa podpisanego rocznika). */
            var W = arch.data && arch.data.window;
            var last = arch.data && arch.data.packages.length ? arch.data.packages[arch.data.packages.length - 1] : null;
            var has = last && last.signature && last.signature.present;
            var matched = has && last.signature.verification === 'digest-matched';
            var accepted = has && last.signature.accepted;
            var TONE = { 'not-started': 'outline', 'package-ready': 'info', 'signature-unverified': 'warning', signed: 'success', overdue: 'danger' };
            var GLYPH = { 'not-started': 'clock', 'package-ready': 'file', 'signature-unverified': 'warning', signed: 'shield', overdue: 'warning' };
            var left = !W ? '' : W.daysLeft > 0 ? A.t('pr.au.daysLeft', { n: W.daysLeft }) : W.daysLeft === 0 ? A.t('pr.au.daysLeft0') : A.t('pr.au.overdueBy', { n: -W.daysLeft });
            /* U3-06: okno zamknięte, bo jeszcze się nie otworzyło, to nie to samo, co po terminie. */
            var windowState = !W ? '' : W.open ? A.t('pr.au.windowOpen') : W.notYetOpen ? A.t('pr.au.windowNotYet') : A.t('pr.au.windowOver');
            return h(Card, { id: 'arch', title: A.t('pr.au.archive'),
              aside: W ? h(E.Badge, { tone: TONE[W.status] || 'outline', icon: GLYPH[W.status] || 'clock' }, A.t('pr.au.st.' + W.status)) : h(E.Badge, { tone: 'outline', icon: 'clock' }, A.t('pr.au.noPackage')) },
              W && h('p', { className: 'muted' }, A.t('pr.au.deadline', { d: A.fmtDate(W.deadline) }) + ' · ' + left),
              W && h('p', { className: 'muted' }, A.t('pr.au.yearEnd', { d: A.fmtDate(W.yearEnd), f: A.fmtDate(W.teachingEnd || W.from) })),
              W && h('p', { className: 'muted' }, A.t('pr.au.window', { f: A.fmtDate(W.from), t: A.fmtDate(W.to), s: windowState })),
              h('div', { className: 'row' },
                h(E.Button, { icon: 'download', onClick: function () { makeArchive(!(W && W.open)); } }, A.t('pr.au.genArchive')),
                last && h(E.Button, { variant: 'quiet', icon: 'download', onClick: function () { fetchFile('/api/principal/archive/' + last.id + '/package'); } }, A.t('pr.au.dlPackage')),
                last && h(E.Button, { variant: 'quiet', icon: 'shield', onClick: function () { verify(last.id); } }, A.t('pr.au.verify')),
                last && h(E.Button, { variant: 'quiet', icon: 'print', onClick: function () { A.api.get('/api/principal/archive/' + last.id + '/print').then(openPrint); } }, A.t('pr.au.printPackage')),
                /* S3-13: literówka w roku albo zacięty przycisk nie mogą zostać w kolekcji na zawsze. */
                last && !last.signature.attested && h(E.Button, { variant: 'danger', icon: 'trash', onClick: function () { setAskDel({ id: last.id, year: last.year, at: last.at, reason: '' }); } }, A.t('pr.au.delete'))),
              /* U3-07: instrukcja opisuje przyciski, których bez pakietu na ekranie nie ma. */
              h('p', { className: 'muted', style: { marginBottom: 0 } }, A.t(last ? 'pr.au.steps' : 'pr.au.stepsNone')),
              last && h('ol', { className: 'muted', style: { margin: 0, paddingInlineStart: '1.4em' } },
                h('li', { key: '1' }, A.t('pr.au.step1')), h('li', { key: '2' }, A.t('pr.au.step2')), h('li', { key: '3' }, A.t('pr.au.step3'))),
              last && h('div', { className: 'grid-2' },
                h(E.Select, { label: A.t('pr.au.sigKind'), value: sig.kind,
                  options: ['zaufany', 'osobisty', 'qualified', 'xades', 'pades'].map(function (k) { return { value: k, label: A.t('pr.au.sigk.' + k) }; }),
                  onChange: function (e) { setSig(Object.assign({}, sig, { kind: e.target.value })); } }),
                h(E.Select, { label: A.t('pr.au.sigWhat'), value: sig.signedFile,
                  options: [{ value: 'manifest.sha256', label: A.t('pr.au.sf.manifest') }, { value: 'package', label: A.t('pr.au.sf.package') }],
                  onChange: function (e) { setSig(Object.assign({}, sig, { signedFile: e.target.value })); } })),
              last && h('div', { className: 'row' },
                h('label', { className: 'label', htmlFor: 'arch-sig' }, A.t('pr.au.sigPick')),
                h('input', { id: 'arch-sig', type: 'file', accept: '.xml,.xades,.xsig,.pdf,.sig,.p7s', onChange: pickSignature })),
              last && h('div', { className: 'row' },
                h(E.Button, { icon: 'shield', disabled: !sig.file || sig.busy, loading: sig.busy, onClick: function () { sendSignature(last.id); } }, A.t('pr.au.sigSend')),
                sig.file && h(E.Badge, { tone: 'info', icon: 'file' }, sig.file.name)),
              last && (has
                ? h(E.Alert, { tone: matched ? 'success' : accepted ? 'info' : 'warning',
                  title: A.t(matched ? 'pr.au.sigMatched' : 'pr.au.sigStored', { f: ((last.signature.matched || [])[0] || {}).file || '' }),
                  actions: h(E.Button, { size: 'sm', variant: 'quiet', icon: 'download', onClick: function () { fetchFile('/api/principal/archive/' + last.id + '/signature'); } }, A.t('pr.au.sigDownload')) },
                  A.t('pr.au.sigHave', { n: last.signature.name, k: A.t('pr.au.sigk.' + last.signature.kind), b: last.signature.by || '', d: A.fmtDateTime(last.signature.at) }),
                  accepted && h('p', { style: { marginBottom: 0 } }, A.t('pr.au.accepted', { b: last.signature.accepted.by, d: A.fmtDateTime(last.signature.accepted.at), r: last.signature.accepted.reason })),
                  last.signature.superseded && h('p', { style: { marginBottom: 0 } }, A.t('pr.au.superseded', { d: A.fmtDateTime(last.signature.superseded.at) })))
                : h('p', { className: 'muted' }, A.t('pr.au.sigNone'))),
              /* S3-08: „przyjęty, niezweryfikowany” NIE ucisza terminu z § 22 — ucisza go dopiero
                 świadoma decyzja dyrektora, z uzasadnieniem i z wpisem w rejestrze. */
              last && has && !matched && !accepted && h('div', { className: 'stack' },
                h(E.Alert, { tone: 'warning', title: A.t('pr.au.acceptTitle') }, A.t('pr.au.sigReminder')),
                h(E.TextField, { label: A.t('pr.au.acceptReason'), value: acc, multiline: true, hint: A.t('pr.au.acceptReasonHint'),
                  onChange: function (e) { setAcc(e.target.value); } }),
                h('div', { className: 'row' },
                  h(E.Button, { icon: 'shield', disabled: !acc.trim(), onClick: function () { acceptUnverified(last.id); } }, A.t('pr.au.acceptSend')))),
              h('p', { className: 'muted' }, A.t('pr.au.sigNote')));
          })(),

          h(Card, { id: 'widok', title: A.t('pr.au.visibility') },
            h(E.Switch, { label: A.t('pr.au.visRank'), checked: !!(V && V.rankings), states: [A.t('pr.au.off'), A.t('pr.au.on')], onChange: function (v) { patchVis('rankings', v); } }),
            h(E.Switch, { label: A.t('pr.au.visAvg'), checked: !!(V && V.classAverage), states: [A.t('pr.au.off'), A.t('pr.au.on')], onChange: function (v) { patchVis('classAverage', v); } }),
            h(E.Switch, { label: A.t('pr.au.visAvgParents'), checked: !!(V && V.averagesToParents), states: [A.t('pr.au.off'), A.t('pr.au.on')], onChange: function (v) { patchVis('averagesToParents', v); } }),
            h('p', { className: 'muted' }, A.t('pr.au.visNote'))))),

      askVoid && h(E.Dialog, { title: A.t('pr.dlg.void.title'), onClose: function () { setAskVoid(false); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setAskVoid(false); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !inv.reason.trim(), onClick: voidGrade }, A.t('pr.au.void'))] },
        h('p', null, chosenGrade ? A.t('pr.dlg.void.body', { s: chosenGrade.studentName, sub: A.subjectName(chosenGrade.subjectId, chosenGrade.subjectName), v: chosenGrade.value, nv: inv.value }) : ''),
        h(E.TextField, { label: A.t('pr.dlg.void.reason'), required: true, value: inv.reason, 'data-autofocus': 'true',
          hint: A.t('pr.dlg.void.hint'), placeholder: A.t('pr.dlg.void.ph'),
          onChange: function (e) { setInv(Object.assign({}, inv, { reason: e.target.value })); } })),

      askBlock && h(E.Dialog, { title: A.t('pr.dlg.block.title'), onClose: function () { setAskBlock(false); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setAskBlock(false); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !blk.reason.trim(), onClick: blockAccount }, A.t('pr.dlg.block.ok'))] },
        h('p', null, A.t('pr.dlg.block.body')),
        h(E.TextField, { label: A.t('pr.dlg.block.reason'), required: true, value: blk.reason, 'data-autofocus': 'true', placeholder: A.t('pr.dlg.block.ph'), onChange: function (e) { setBlk(Object.assign({}, blk, { reason: e.target.value })); } })),

      askDel && h(E.Dialog, { title: A.t('pr.au.deleteTitle'), onClose: function () { setAskDel(null); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setAskDel(null); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !askDel.reason.trim(), onClick: deleteArchive }, A.t('pr.au.deleteConfirm'))] },
        h('p', null, A.t('pr.au.deleteBody', { y: askDel.year, d: A.fmtDateTime(askDel.at) })),
        h(E.TextField, { label: A.t('pr.au.deleteReason'), required: true, value: askDel.reason, 'data-autofocus': 'true',
          onChange: function (e) { setAskDel(Object.assign({}, askDel, { reason: e.target.value })); } })),

      askRebuild && h(E.Dialog, { title: A.t('pr.au.rebuildTitle'), onClose: function () { setAskRebuild(null); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setAskRebuild(null); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', disabled: !askRebuild.reason.trim(), onClick: function () { makeArchive(true, { reason: askRebuild.reason }); } }, A.t('pr.au.rebuildConfirm'))] },
        h('p', null, A.t('pr.au.rebuildBody')),
        h(E.TextField, { label: A.t('pr.au.rebuildReason'), required: true, value: askRebuild.reason, 'data-autofocus': 'true',
          onChange: function (e) { setAskRebuild(Object.assign({}, askRebuild, { reason: e.target.value })); } })));
  }

  /* ============================================================ 4. Komunikaty (3.3.12, 3.3.19, 3.3.15, 3.3.13) */
  function Komunikaty() {
    var anns = A.useApi('/api/announcements', []);
    var logins = A.useApi('/api/principal/parent-logins', []);
    var trips = A.useApi('/api/principal/trips', []);
    var spec = A.useApi('/api/principal/specialist-log', []);
    var s0 = React.useState({ title: '', body: '', requiresAck: true, parent: true, staff: true, student: false }), f = s0[0], setF = s0[1];
    var s1 = React.useState(false), preview = s1[0], setPreview = s1[1];
    var s2 = React.useState(''), said = s2[0], setSaid = s2[1];
    var list = (anns.data && anns.data.announcements) || [];
    var latest = list[0];
    var GROUP = { parent: 'pr.an.parents', staff: 'pr.an.staff', student: 'pr.an.students' };

    function publish() {
      var audience = []; if (f.parent) audience.push('parent'); if (f.staff) audience.push('staff'); if (f.student) audience.push('student');
      A.api.post('/api/announcements', { title: f.title, body: f.body, requiresAck: f.requiresAck, audience: audience }).then(function (r) {
        setPreview(false); setF(Object.assign({}, f, { title: '', body: '' })); anns.reload();
        setSaid(A.t('pr.an.published', { t: r.title, n: r.recipients, tail: r.requiresAck ? A.t('pr.an.ackTail') : '.' }));
        A.toast(A.t('pr.an.publishedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function approveTrip(trip) {
      A.api.post('/api/principal/trips/' + trip.id + '/approve', { reason: A.t('pr.tr.approveReason') }).then(function (r) {
        trips.reload();
        setSaid(A.t('pr.tr.approvedMsg', { n: r.attendanceMarked, s: r.substitutions.length }));
        A.toast(A.t('pr.tr.approvedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }

    var lg = logins.data;
    return h('div', { className: 'stack' },
      h(Card, { id: 'glob', title: A.t('pr.an.title') },
        h(E.TextField, { label: A.t('pr.an.titleField'), value: f.title, onChange: function (e) { setF(Object.assign({}, f, { title: e.target.value })); } }),
        h(E.TextField, { label: A.t('pr.an.bodyField'), multiline: 4, value: f.body, hint: A.t('pr.an.bodyHint'), onChange: function (e) { setF(Object.assign({}, f, { body: e.target.value })); } }),
        h('div', { className: 'row' },
          h(E.Checkbox, { label: A.t('pr.an.parents'), checked: f.parent, onChange: function (e) { setF(Object.assign({}, f, { parent: e.target.checked })); } }),
          h(E.Checkbox, { label: A.t('pr.an.staff'), checked: f.staff, onChange: function (e) { setF(Object.assign({}, f, { staff: e.target.checked })); } }),
          h(E.Checkbox, { label: A.t('pr.an.students'), checked: f.student, onChange: function (e) { setF(Object.assign({}, f, { student: e.target.checked })); } })),
        h(E.Checkbox, { label: A.t('pr.an.requireAck'), checked: f.requiresAck, hint: A.t('pr.an.requireAckHint'), onChange: function (e) { setF(Object.assign({}, f, { requiresAck: e.target.checked })); } }),
        h('div', { className: 'row' }, h(E.Button, { variant: 'primary', icon: 'bell', disabled: !(f.title.trim() && f.body.trim()), onClick: function () { setPreview(true); } }, A.t('pr.an.publish'))),
        h(Live, null, said)),

      latest ? h(Card, { id: 'potw', title: A.t('pr.an.receipts', { t: latest.title }),
        aside: h(E.Badge, { tone: latest.stats.percent === 100 ? 'success' : 'accent', icon: 'check' }, A.t('pr.an.ackOf', { a: latest.stats.ackedCount, b: latest.stats.audienceCount })) },
        h(E.ProgressBar, { label: A.t('pr.an.receiptsBar'), value: latest.stats.percent || 0, valueText: A.fmtPct(latest.stats.percent) }),
        h(E.Table, { caption: A.t('pr.an.receiptsCaption'),
          columns: [{ key: 'grupa', title: A.t('pr.an.group') }, { key: 'acked', title: A.t('pr.an.acked'), num: true }, { key: 'total', title: A.t('pr.an.recipients'), num: true },
            { key: 'st', title: A.t('common.status'), render: function (r) { return r.acked === r.total ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pr.an.complete')) : h(E.Badge, { tone: 'accent', icon: 'clock' }, A.t('pr.an.awaiting', { n: r.total - r.acked })); } }],
          rows: Object.keys(latest.stats.byRole).map(function (k) { return Object.assign({ id: k, grupa: A.t(GROUP[k] || k) }, latest.stats.byRole[k]); }) }),
        h('p', { className: 'muted' }, A.t('pr.an.pendingNames', { names: latest.stats.pending.slice(0, 5).map(function (p) { return p.name; }).join(', '), tail: latest.stats.pending.length > 5 ? A.t('pr.an.andOthers', { n: latest.stats.pending.length - 5 }) : '' }))) : null,

      h(Card, { id: 'logow', title: A.t('pr.lg.title') },
        h('div', { className: 'grid-3' },
          h(E.StatTile, { label: A.t('pr.lg.stale'), value: lg ? String(lg.totals.stale) : '—', alert: !!(lg && lg.totals.stale), hint: A.t('pr.lg.staleHint') }),
          h(E.StatTile, { label: A.t('pr.lg.never'), value: lg ? String(lg.totals.never) : '—', alert: !!(lg && lg.totals.never) }),
          h(E.StatTile, { label: A.t('pr.lg.active'), value: lg ? A.fmtPct(lg.totals.activePercent) : '—', hint: lg ? A.t('pr.lg.activeHint', { n: lg.totals.parents }) : '' })),
        h(E.Table, { caption: A.t('pr.lg.caption'),
          columns: [
            { key: 'name', title: A.t('pr.lg.parent') },
            { key: 'children', title: A.t('pr.lg.children'), render: function (r) { return r.children.map(function (c) { return c.name + ' (' + c.classId + ')'; }).join(', '); } },
            { key: 'last', title: A.t('pr.lg.last'), render: function (r) { return r.lastLogin ? A.fmtDate(r.lastLogin) : A.t('pr.lg.noLogin'); } },
            { key: 'loginCount', title: A.t('pr.lg.count'), num: true },
            { key: 'st', title: A.t('common.status'), render: function (r) {
                return r.flag === 'never' ? h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('pr.lg.badgeNever'))
                  : r.flag === 'stale' ? h(E.Badge, { tone: 'danger', icon: 'warning' }, A.t('pr.lg.badgeStale'))
                  : h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pr.lg.badgeOk'));
              } },
            { key: 'lc', title: A.t('pr.lc.col'), render: function (r) {
                return h(window.EdLogComments.Toggle, { kind: 'parent-logins', entryId: r.entryId, counts: (lg && lg.comments && lg.comments[r.entryId]) || null, onChange: function () { logins.reload(); } });
              } }
          ], rows: lg ? lg.rows.map(function (r) { return Object.assign({ id: r.userId }, r); }) : [] }),
        h('p', { className: 'muted' }, A.t('pr.lg.note', { n: lg ? lg.totals.householdsAtRisk : '—' }))),

      h('div', { className: 'grid-2' },
        h(Card, { id: 'wyc', title: A.t('pr.tr.title') },
          ((trips.data && trips.data.trips) || []).map(function (trip) {
            return h('div', { key: trip.id, className: 'stack', style: { gap: 'var(--space-2)' } },
              h('div', { className: 'row', style: { justifyContent: 'space-between' } },
                h('span', { className: 'body-strong' }, trip.name + ' · ' + A.fmtDate(trip.from) + ' – ' + A.fmtDate(trip.to)),
                trip.status === 'approved' ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('pr.tr.approved')) : h(E.Badge, { tone: 'accent', icon: 'clock' }, A.t('pr.tr.pending'))),
              h('p', { className: 'muted' }, A.t('pr.tr.meta', { l: trip.leaderName, c: trip.chaperoneNames.join(', ') || '—', n: trip.students, ins: trip.insurance ? A.t('pr.tr.insurance', { i: trip.insurance.insurer, p: trip.insurance.policyNo }) : '' })),
              trip.status !== 'approved' && h('div', { className: 'row' }, h(E.Button, { icon: 'check', onClick: function () { approveTrip(trip); } }, A.t('pr.tr.approve'))),
              trip.status === 'approved' && h('p', { className: 'muted' }, A.t('pr.tr.approvedNote')));
          }),
          !((trips.data && trips.data.trips) || []).length && h('p', { className: 'muted' }, A.t('pr.tr.none'))),

        h(Card, { id: 'psych', title: A.t('pr.sp.title') },
          h('div', { className: 'grid-2' },
            h(E.StatTile, { label: A.t('pr.sp.activities'), value: spec.data ? String(spec.data.totals.activities) : '—', hint: spec.data ? A.t('pr.sp.activitiesHint', { f: A.fmtDate(spec.data.from), t: A.fmtDate(spec.data.to), h: A.fmtNum(spec.data.totals.hours, 1) }) : '' }),
            h(E.StatTile, { label: A.t('pr.sp.documents'), value: spec.data ? String(spec.data.totals.documents) : '—', hint: spec.data ? A.t('pr.sp.documentsHint', { n: spec.data.totals.protectedDocuments }) : '' })),
          h(E.Table, { caption: A.t('pr.sp.caption'),
            columns: [{ key: 'name', title: A.t('pr.sp.specialist') }, { key: 'activities', title: A.t('pr.sp.entries'), num: true }, { key: 'consultations', title: A.t('pr.sp.consultations'), num: true }, { key: 'hours', title: A.t('pr.sp.hours'), num: true }, { key: 'students', title: A.t('pr.sp.students'), num: true },
              { key: 'lc', title: A.t('pr.lc.col'), render: function (r) {
                  return h(window.EdLogComments.Toggle, { kind: 'specialist-log', entryId: r.entryId, counts: (spec.data && spec.data.comments && spec.data.comments[r.entryId]) || null, onChange: function () { spec.reload(); } });
                } }],
            rows: spec.data ? spec.data.specialists.map(function (s) { return Object.assign({ id: s.userId }, s); }) : [] }),
          /* Komentarz do pieczęci notatki, nie do jej treści — treści dyrektor nie widzi. */
          ((spec.data && spec.data.notes) || []).slice(0, 2).map(function (n) {
            return h('div', { key: n.id },
              h(E.ConfidentialNote, { title: n.title + ' · ' + A.fmtDate(n.at), readers: n.readerNames || A.t('pr.sp.noteAuthor'), sealed: true,
                sealedText: A.t('pr.sp.sealedText'),
                author: n.authorName, date: A.fmtDateTime(n.at), meta: A.t('pr.sp.meta', { alg: n.alg, n: n.readers }) }),
              h(window.EdLogComments.Toggle, { kind: 'specialist-log', entryId: n.entryId, counts: (spec.data.comments && spec.data.comments[n.entryId]) || null, onChange: function () { spec.reload(); } }));
          }),
          spec.data && h('p', { className: 'muted' }, spec.data.access))),

      preview && h(E.Dialog, { title: A.t('shell.announcement'), onClose: function () { setPreview(false); },
        actions: [h(E.Button, { key: 'b', variant: 'secondary', onClick: function () { setPreview(false); } }, A.t('pr.dlg.preview.back')),
          h(E.Button, { key: 'o', variant: 'primary', onClick: publish }, A.t('pr.dlg.preview.publish'))] },
        h('p', { className: 'body-strong' }, f.title),
        h('p', null, f.body),
        h('p', null, f.requiresAck ? A.t('pr.dlg.preview.ack') : A.t('pr.dlg.preview.noAck'))));
  }

  /* ============================================================ ekran */
  function Screen(props) {
    var s0 = React.useState((props.route && props.route.query.tab) || 'zast'), tab = s0[0], setTab0 = s0[1];
    /* M8: the shell remounts the screen on a language change, so the tab belongs in the URL. */
    function setTab(v) { setTab0(v); A.navigate('/dyrekcja', { tab: v }); }
    var cfg = props.config || {};
    return h('div', null,
      h('h1', { className: 'display app-title' }, A.t('pr.title')),
      h('p', { className: 'app-sub' }, A.t('pr.sub', { school: cfg.school ? cfg.school.name : '', y: cfg.year || '', d: A.fmtDate(cfg.today || '') })),
      h(E.Tabs, { label: A.t('pr.tabs'), value: tab, onChange: setTab,
        tabs: [{ id: 'zast', label: A.t('pr.tab.subs') }, { id: 'nadzor', label: A.t('pr.tab.supervision') }, { id: 'audyt', label: A.t('pr.tab.audit') }, { id: 'komunikaty', label: A.t('pr.tab.announcements') }] },
        function (active) {
          if (active === 'zast') return h(Zastepstwa, null);
          if (active === 'nadzor') return h(Nadzor, null);
          if (active === 'audyt') return h(Audyt, null);
          return h(Komunikaty, null);
        }));
  }

  A.screen({ id: 'principal', path: '/dyrekcja', title: 'Dyrekcja', roles: ['principal'], module: 'principal', nav: { key: 'nav.principal', label: 'Dyrekcja', order: 5 }, component: Screen });
  /* Rejestr zdarzeń dla ekranu zgodności (IOD) — patrz RejestrZdarzen wyżej. */
  window.EdPrincipal = { AuditRegister: RejestrZdarzen };
})();
