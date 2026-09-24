/* Moduły szkolne (3.8): świetlica, stołówka, wycieczka, biblioteka i gabinet profilaktyki w jednym
   dzienniku. Zakładki pokazujemy zgodnie z rolą konta (GET /api/modules/tabs).
   Port ../design-system/components/SchoolModules/preview.html podłączony do /api/modules/*. */
(function () {
  var E = window.EdMat, A = window.EdApp, h = React.createElement, F = React.Fragment;

  window.EdI18n.add({
    pl: {
      'mo.title': 'Moduły szkolne',
      'mo.sub': 'świetlica, stołówka, wycieczki, biblioteka i gabinet w jednym dzienniku. Widoczne są wyłącznie moduły przypisane do Twojej roli.',
      'mo.noModules': 'Brak modułów dla tej roli', 'mo.noModulesText': 'To konto nie prowadzi żadnego z modułów uzupełniających.',
      'mo.tabsLabel': 'Moduły uzupełniające', 'mo.opFailed': 'Nie udało się wykonać operacji.',
      'mo.tab.swietlica': 'Świetlica', 'mo.tab.stolowka': 'Stołówka', 'mo.tab.wycieczka': 'Wycieczka', 'mo.tab.biblioteka': 'Biblioteka', 'mo.tab.gabinet': 'Gabinet',
      'mo.careTitle': 'Zapis do świetlicy', 'mo.scanCard': 'Skanuj kod legitymacji',
      'mo.scanHint': 'Czytnik wpisuje kod i zatwierdza Enterem; kod można też wpisać ręcznie (np. 7B-007).',
      'mo.checkIn': 'Zapisz wejście', 'mo.presentNow': 'W świetlicy teraz', 'mo.openUntil': 'świetlica czynna do {time}',
      'mo.checkInNote': 'Każde wejście zapisuje godzinę i osobę prowadzącą zajęcia.',
      'mo.quickList': 'Szybka lista klasy',
      'mo.students.one': '{name} · {n} uczeń', 'mo.students.few': '{name} · {n} uczniów', 'mo.students.many': '{name} · {n} uczniów',
      'mo.classStudents': 'Uczniowie klasy {class}', 'mo.code': 'Kod', 'mo.enteredAt': 'Wejście {time}',
      'mo.checkInAria': 'Zapisz do świetlicy: {name}', 'mo.loadingList': 'Wczytywanie listy…',
      'mo.pickupTitle': 'Odbiór dziecka', 'mo.authorizedCaption': 'Osoby upoważnione do odbioru',
      'mo.child': 'Dziecko', 'mo.collects': 'Odbiera', 'mo.permission': 'Uprawnienie',
      'mo.authorized': 'Upoważniony', 'mo.outdated': 'Nieaktualne', 'mo.releaseCol': 'Wydanie',
      'mo.notInCare': 'Nie jest w świetlicy', 'mo.releaseAria': 'Wydaj dziecko: {name}', 'mo.releaseChild': 'Wydaj dziecko',
      'mo.releasedAction': 'wydał(a) dziecko', 'mo.pickupReason': 'Odbiór: {person} ({relation}). Tożsamość potwierdzona na miejscu.',
      'mo.device': 'terminal świetlicy', 'mo.pickupNote': 'Wydanie dziecka zapisuje godzinę i tożsamość osoby odbierającej.',
      'mo.loadingPickups': 'Wczytywanie listy odbiorów…',
      'mo.mealsToday': 'Wydania na dziś', 'mo.lunchesToday': 'Obiady dziś', 'mo.vsEnrolled': '−{n} wobec zapisanych',
      'mo.enrolledLunch': 'Zapisani na obiad', 'mo.mealContracts': 'umowy obiadowe',
      'mo.mealsValue': 'Wartość wydań', 'mo.mealPrice': 'cena posiłku {v}',
      'mo.mealsCaption': 'Obiady według klas · z porannej frekwencji {date}',
      'mo.enrolled': 'Zapisani', 'mo.absentMorning': 'Nieobecni rano', 'mo.cancelled': 'Odwołane', 'mo.blocked': 'Wstrzymane', 'mo.portions': 'Porcje',
      'mo.loadingReport': 'Wczytywanie raportu…',
      'mo.debts': 'Zaległości', 'mo.debtsCaption': 'Konta z zaległościami za obiady', 'mo.debt': 'Zaległość', 'mo.period': 'Okres',
      'mo.servingBlocked': 'Wydawanie wstrzymane', 'mo.noDebt': 'Bez zaległości', 'mo.action': 'Działanie',
      'mo.guardianNotified': 'Opiekun dostał wiadomość w aplikacji', 'mo.blockAria': 'Wstrzymaj wydawanie posiłków: {name}',
      'mo.blockBtn': 'Wstrzymaj wydawanie + powiadom opiekuna', 'mo.discretion': 'Dyskrecja przy okienku',
      'mo.discretionText': 'Blokada nie jest widoczna na liście wydawania ani w koncie ucznia. Uczeń nie jest informowany przy okienku — wiadomość trafia wyłącznie do opiekuna w aplikacji.',
      'mo.loadingAccounts': 'Wczytywanie kont…',
      'mo.setupAccounts': 'Założenie kont stołówkowych',
      'mo.setupAccountsHint': 'Konto zakłada się całemu oddziałowi naraz albo pojedynczemu uczniowi. Uczeń, który konto już ma, zostaje pominięty.',
      'mo.setupTarget': 'Dla kogo', 'mo.setupWholeClass': 'Cały oddział', 'mo.setupOnePupil': 'Jeden uczeń',
      'mo.mealPlan': 'Plan posiłku', 'mo.mealPriceField': 'Cena posiłku (zł)', 'mo.periodField': 'Okres rozliczeniowy',
      'mo.studentIdField': 'Identyfikator ucznia',
      'mo.createAccounts': 'Załóż konta',
      'mo.accountsCaption': 'Konta stołówkowe',
      'mo.plan': 'Plan', 'mo.price': 'Cena', 'mo.balance': 'Saldo', 'mo.activeCol': 'Aktywne',
      'mo.setupLibrary': 'Wprowadzenie stanu biblioteki',
      'mo.setupLibraryHint': 'Wklej arkusz kolumnami {cols} (średnik) albo dodaj jedną pozycję. Ten sam kod kreskowy aktualizuje pozycję, zamiast zakładać drugą.',
      'mo.libCsv': 'Arkusz biblioteki (CSV)', 'mo.libCsvPh': 'barcode;title;kind',
      'mo.libCheck': 'Sprawdź bez zapisywania', 'mo.libApply': 'Zapisz stan biblioteki',
      'mo.libDry': 'Próbny przebieg: nowych {created}, aktualizowanych {updated}, pominiętych {skipped}.',
      'mo.libApplied': 'Zapisano: nowych {created}, aktualizowanych {updated}.',
      'mo.libOne': 'Pojedyncza pozycja', 'mo.libBarcode': 'Kod kreskowy', 'mo.libTitleField': 'Tytuł', 'mo.libKind': 'Rodzaj',
      'mo.libKind.textbook': 'Podręcznik', 'mo.libKind.book': 'Książka', 'mo.libKind.reading': 'Lektura', 'mo.libKind.other': 'Inne',
      'mo.libAdd': 'Dodaj pozycję do biblioteki',
      'mo.libStockCaption': 'Stan biblioteki',
      'mo.errorsTitle': 'Wiersze do poprawy', 'mo.errLine': 'wiersz {line}: {error}',
      'mo.loadingTrips': 'Wczytywanie kart wycieczek…', 'mo.noTrips': 'Brak kart wycieczek', 'mo.noTripsText': 'Kartę wycieczki zakłada kierownik wycieczki.',
      'mo.tripCard': 'Karta wycieczki', 'mo.tripName': 'Cel wycieczki', 'mo.tripPeriod': 'Termin', 'mo.tripLeader': 'Kierownik',
      'mo.transport': 'Transport', 'mo.classes': 'Klasy', 'mo.chaperones': 'Opiekunowie', 'mo.groupShort': '{name} (gr. {n})',
      'mo.insuranceBadge': 'Ubezpieczenie: {insurer} · polisa {policy}', 'mo.consentsBadge': 'Zgody rodziców: {n} z {of}',
      'mo.submitTrip': 'Wyślij do zatwierdzenia', 'mo.printTrip': 'Karta wycieczki do druku',
      'mo.tripApprovedNote': 'Uczestnicy mają w dziennikach status „w” (wycieczka) na wszystkich lekcjach z dni wyjazdu.',
      'mo.tripDraftNote': 'Zatwierdza dyrektor; karta trafia do dziennika i do teczki wycieczek.',
      'mo.participants': 'Uczestnicy i grupy opiekunów', 'mo.participantsCaption': 'Uczestnicy wycieczki',
      'mo.group': 'Grupa', 'mo.groupN': 'Grupa {n}', 'mo.consent': 'Zgoda', 'mo.signed': 'Podpisana', 'mo.pending': 'Oczekuje',
      'mo.statusInLogbook': 'Status w dzienniku',
      'mo.staying': 'Uczniowie pozostający w szkole', 'mo.stayingCaption': 'Nieuczestniczący w wycieczce i ich grupy tymczasowe',
      'mo.tempGroup': 'Grupa tymczasowa', 'mo.tempGroupAria': 'Grupa tymczasowa — {name}',
      'mo.tempGroupSaved': 'Zapisano przydział grupy tymczasowej.', 'mo.unassigned': ' Bez przydziału: {n}.',
      'mo.libTitle': 'Wypożyczenie kompletu podręczników', 'mo.scanBook': 'Skanuj kod kreskowy podręcznika',
      'mo.scanBookHint': 'Enter dodaje pozycję do kompletu; po zeskanowaniu całego kompletu wypożycz go całej klasie.',
      'mo.unknownCode': 'Kod {code} nie należy do żadnego kompletu w bibliotece.',
      'mo.addedToSet': 'Dodano do kompletu: {title}. Skanuj kolejny kod.',
      'mo.addItem': 'Dodaj pozycję', 'mo.lendSet': 'Wypożycz komplet klasie {class}',
      'mo.setItems': 'Pozycje w komplecie', 'mo.scannedCodes': 'skanowane kody',
      'mo.libNote': 'Skanowanie kolejnych kodów buduje komplet; wypożyczenie obejmuje wszystkich uczniów klasy.',
      'mo.loansCaption': 'Wypożyczenia klasy {class}', 'mo.item': 'Pozycja', 'mo.dueDate': 'Termin zwrotu', 'mo.loadingLoans': 'Wczytywanie wypożyczeń…',
      'mo.settlement': 'Rozliczenie przed wydaniem świadectw', 'mo.settlementCaption': 'Stan rozliczenia z biblioteką · klasa {class}',
      'mo.settlementCol': 'Rozliczenie', 'mo.settled': 'Rozliczony', 'mo.details': 'Szczegóły', 'mo.certificates': 'Świadectwa',
      'mo.unsettledText': 'Uczniów bez rozliczenia: {n}. Sekretariat widzi tę listę przed wydrukiem świadectw.',
      'mo.allSettled': 'Cała klasa rozliczona z materiałów.', 'mo.loadingSettlement': 'Wczytywanie rozliczenia…',
      'mo.nurseTitle': 'Wizyta w gabinecie profilaktyki', 'mo.studentIdLabel': 'Identyfikator ucznia albo kod legitymacji',
      'mo.time': 'Godzina', 'mo.eventKind': 'Rodzaj zdarzenia', 'mo.eventDesc': 'Opis zdarzenia',
      'mo.eventDescPh': 'np. otarcie kolana na przerwie',
      'mo.eventDescHint': 'Opis trafia do dokumentacji zdrowotnej; nie pojawia się w dzienniku lekcyjnym ani w eksportach.',
      'mo.aid': 'Udzielona pomoc', 'mo.aidPh': 'przemycie, opatrunek, powrót na lekcję', 'mo.outcome': 'Zakończenie',
      'mo.saveVisit': 'Zapisz wizytę', 'mo.kindFallback': 'Otarcie lub skaleczenie', 'mo.outcomeFallback': 'Powrót na lekcję',
      'mo.visitTitle': 'Wizyta {time} · {name}', 'mo.visitReaders': 'pielęgniarka i opiekunowie ucznia',
      'mo.entryNo': 'wpis nr {no}', 'mo.parentNotified': ' Opiekun powiadomiony w aplikacji.',
      'mo.noVisits': 'Brak wpisów w dokumentacji gabinetu.', 'mo.healthData': 'Dane o zdrowiu',
      'mo.healthText': 'Wpisy gabinetu to dane szczególnej kategorii (art. 9 RODO). Widzi je pielęgniarka i opiekunowie ucznia; nauczyciel widzi w dzienniku najwyżej status „zw”. Każdy wgląd zostaje w rejestrze.',
      'mo.visitsCaption': 'Wizyty zarejestrowane w gabinecie', 'mo.event': 'Zdarzenie', 'mo.entryNoCol': 'Nr wpisu',
      /* rejestr wglądów + komentarze do jego wpisów (screens/00-log-comments.js) */
      'mo.accessLog': 'Rejestr wglądów do dokumentacji gabinetu', 'mo.accessLogCaption': 'Kto i kiedy zaglądał do wpisów gabinetu',
      'mo.accessWho': 'Kto', 'mo.accessResult': 'Rozstrzygnięcie', 'mo.accessAllowed': 'Wgląd', 'mo.accessDenied': 'Odmowa',
      'mo.accessNone': 'Nikt jeszcze nie zaglądał do dokumentacji gabinetu.', 'mo.lcCol': 'Komentarze'
    },
    en: {
      'mo.title': 'School modules',
      'mo.sub': 'after-school care, cafeteria, trips, library and the nurse’s office in one logbook. Only the modules assigned to your role are visible.',
      'mo.noModules': 'No modules for this role', 'mo.noModulesText': 'This account does not run any of the supplementary modules.',
      'mo.tabsLabel': 'Supplementary modules', 'mo.opFailed': 'The operation could not be completed.',
      'mo.tab.swietlica': 'After-school care', 'mo.tab.stolowka': 'Cafeteria', 'mo.tab.wycieczka': 'School trip', 'mo.tab.biblioteka': 'Library', 'mo.tab.gabinet': 'Nurse’s office',
      'mo.careTitle': 'Check in to after-school care', 'mo.scanCard': 'Scan the student card',
      'mo.scanHint': 'The reader types the code and confirms with Enter; the code can also be typed by hand (e.g. 7B-007).',
      'mo.checkIn': 'Record the check-in', 'mo.presentNow': 'In care right now', 'mo.openUntil': 'care open until {time}',
      'mo.checkInNote': 'Every check-in records the time and the member of staff on duty.',
      'mo.quickList': 'Quick class list',
      'mo.students.one': '{name} · {n} student', 'mo.students.other': '{name} · {n} students',
      'mo.classStudents': 'Students of class {class}', 'mo.code': 'Code', 'mo.enteredAt': 'In at {time}',
      'mo.checkInAria': 'Check in to after-school care: {name}', 'mo.loadingList': 'Loading the list…',
      'mo.pickupTitle': 'Child pick-up', 'mo.authorizedCaption': 'People authorised to collect',
      'mo.child': 'Child', 'mo.collects': 'Collected by', 'mo.permission': 'Authorisation',
      'mo.authorized': 'Authorised', 'mo.outdated': 'Out of date', 'mo.releaseCol': 'Release',
      'mo.notInCare': 'Not in after-school care', 'mo.releaseAria': 'Release the child: {name}', 'mo.releaseChild': 'Release the child',
      'mo.releasedAction': 'released the child', 'mo.pickupReason': 'Pick-up: {person} ({relation}). Identity confirmed on the spot.',
      'mo.device': 'after-school care terminal', 'mo.pickupNote': 'Releasing a child records the time and the identity of the person collecting.',
      'mo.loadingPickups': 'Loading the pick-up list…',
      'mo.mealsToday': 'Meals served today', 'mo.lunchesToday': 'Lunches today', 'mo.vsEnrolled': '−{n} against enrolled',
      'mo.enrolledLunch': 'Enrolled for lunch', 'mo.mealContracts': 'meal agreements',
      'mo.mealsValue': 'Value of the meals', 'mo.mealPrice': 'meal price {v}',
      'mo.mealsCaption': 'Lunches by class · from the morning attendance of {date}',
      'mo.enrolled': 'Enrolled', 'mo.absentMorning': 'Absent in the morning', 'mo.cancelled': 'Cancelled', 'mo.blocked': 'On hold', 'mo.portions': 'Portions',
      'mo.loadingReport': 'Loading the report…',
      'mo.debts': 'Arrears', 'mo.debtsCaption': 'Accounts with lunch arrears', 'mo.debt': 'Arrears', 'mo.period': 'Period',
      'mo.servingBlocked': 'Serving on hold', 'mo.noDebt': 'No arrears', 'mo.action': 'Action',
      'mo.guardianNotified': 'The guardian has been messaged in the app', 'mo.blockAria': 'Put meal serving on hold: {name}',
      'mo.blockBtn': 'Hold serving + notify the guardian', 'mo.discretion': 'Discretion at the counter',
      'mo.discretionText': 'The hold is not visible on the serving list or in the student account. The student is not told at the counter — the message goes only to the guardian in the app.',
      'mo.loadingAccounts': 'Loading accounts…',
      'mo.setupAccounts': 'Open cafeteria accounts',
      'mo.setupAccountsHint': 'An account is opened for a whole class at once, or for a single pupil. A pupil who already has one is skipped.',
      'mo.setupTarget': 'For whom', 'mo.setupWholeClass': 'A whole class', 'mo.setupOnePupil': 'One pupil',
      'mo.mealPlan': 'Meal plan', 'mo.mealPriceField': 'Meal price (PLN)', 'mo.periodField': 'Billing period',
      'mo.studentIdField': 'Pupil identifier',
      'mo.createAccounts': 'Open the accounts',
      'mo.accountsCaption': 'Cafeteria accounts',
      'mo.plan': 'Plan', 'mo.price': 'Price', 'mo.balance': 'Balance', 'mo.activeCol': 'Active',
      'mo.setupLibrary': 'Enter the library stock',
      'mo.setupLibraryHint': 'Paste a sheet with the columns {cols} (semicolons), or add a single item. The same barcode updates the item instead of creating a second one.',
      'mo.libCsv': 'Library sheet (CSV)', 'mo.libCsvPh': 'barcode;title;kind',
      'mo.libCheck': 'Check without saving', 'mo.libApply': 'Save the library stock',
      'mo.libDry': 'Dry run: {created} new, {updated} updated, {skipped} skipped.',
      'mo.libApplied': 'Saved: {created} new, {updated} updated.',
      'mo.libOne': 'A single item', 'mo.libBarcode': 'Barcode', 'mo.libTitleField': 'Title', 'mo.libKind': 'Kind',
      'mo.libKind.textbook': 'Textbook', 'mo.libKind.book': 'Book', 'mo.libKind.reading': 'Set reading', 'mo.libKind.other': 'Other',
      'mo.libAdd': 'Add the item to the library',
      'mo.libStockCaption': 'Library stock',
      'mo.errorsTitle': 'Rows to fix', 'mo.errLine': 'row {line}: {error}',
      'mo.loadingTrips': 'Loading trip cards…', 'mo.noTrips': 'No trip cards', 'mo.noTripsText': 'A trip card is created by the trip leader.',
      'mo.tripCard': 'Trip card', 'mo.tripName': 'Destination', 'mo.tripPeriod': 'Dates', 'mo.tripLeader': 'Trip leader',
      'mo.transport': 'Transport', 'mo.classes': 'Classes', 'mo.chaperones': 'Chaperones', 'mo.groupShort': '{name} (gr. {n})',
      'mo.insuranceBadge': 'Insurance: {insurer} · policy {policy}', 'mo.consentsBadge': 'Parent consents: {n} of {of}',
      'mo.submitTrip': 'Send for approval', 'mo.printTrip': 'Trip card for printing',
      'mo.tripApprovedNote': 'Participants carry the “w” (school trip) status in the logbook for every lesson on the trip days.',
      'mo.tripDraftNote': 'The principal approves it; the card goes to the logbook and to the trip file.',
      'mo.participants': 'Participants and chaperone groups', 'mo.participantsCaption': 'Trip participants',
      'mo.group': 'Group', 'mo.groupN': 'Group {n}', 'mo.consent': 'Consent', 'mo.signed': 'Signed', 'mo.pending': 'Pending',
      'mo.statusInLogbook': 'Status in the logbook',
      'mo.staying': 'Students staying at school', 'mo.stayingCaption': 'Students not on the trip and their temporary groups',
      'mo.tempGroup': 'Temporary group', 'mo.tempGroupAria': 'Temporary group — {name}',
      'mo.tempGroupSaved': 'The temporary group assignment has been saved.', 'mo.unassigned': ' Unassigned: {n}.',
      'mo.libTitle': 'Lending a set of textbooks', 'mo.scanBook': 'Scan the textbook barcode',
      'mo.scanBookHint': 'Enter adds the item to the set; once the whole set is scanned, lend it to the whole class.',
      'mo.unknownCode': 'Code {code} does not belong to any set in the library.',
      'mo.addedToSet': 'Added to the set: {title}. Scan the next code.',
      'mo.addItem': 'Add the item', 'mo.lendSet': 'Lend the set to class {class}',
      'mo.setItems': 'Items in the set', 'mo.scannedCodes': 'scanned codes',
      'mo.libNote': 'Scanning further codes builds the set; the loan covers every student in the class.',
      'mo.loansCaption': 'Loans of class {class}', 'mo.item': 'Item', 'mo.dueDate': 'Return date', 'mo.loadingLoans': 'Loading loans…',
      'mo.settlement': 'Settlement before the certificates are issued', 'mo.settlementCaption': 'Library settlement status · class {class}',
      'mo.settlementCol': 'Settlement', 'mo.settled': 'Settled', 'mo.details': 'Details', 'mo.certificates': 'Certificates',
      'mo.unsettledText': 'Students not settled: {n}. The school office sees this list before printing the certificates.',
      'mo.allSettled': 'The whole class has settled its materials.', 'mo.loadingSettlement': 'Loading the settlement…',
      'mo.nurseTitle': 'Visit to the nurse’s office', 'mo.studentIdLabel': 'Student identifier or card code',
      'mo.time': 'Time', 'mo.eventKind': 'Type of incident', 'mo.eventDesc': 'Description of the incident',
      'mo.eventDescPh': 'e.g. grazed knee during the break',
      'mo.eventDescHint': 'The description goes into the health record; it does not appear in the lesson logbook or in exports.',
      'mo.aid': 'First aid given', 'mo.aidPh': 'cleaning, dressing, return to the lesson', 'mo.outcome': 'Outcome',
      'mo.saveVisit': 'Save the visit', 'mo.kindFallback': 'Graze or cut', 'mo.outcomeFallback': 'Return to the lesson',
      'mo.visitTitle': 'Visit {time} · {name}', 'mo.visitReaders': 'the nurse and the student’s guardians',
      'mo.entryNo': 'entry no. {no}', 'mo.parentNotified': ' The guardian has been notified in the app.',
      'mo.noVisits': 'No entries in the nurse’s records.', 'mo.healthData': 'Health data',
      'mo.healthText': 'Nurse entries are special category data (art. 9 GDPR). The nurse and the student’s guardians can see them; a teacher sees at most the “zw” status in the logbook. Every access is recorded.',
      'mo.visitsCaption': 'Visits recorded at the nurse’s office', 'mo.event': 'Incident', 'mo.entryNoCol': 'Entry no.',
      'mo.accessLog': 'Access log for the nurse’s records', 'mo.accessLogCaption': 'Who looked at the nurse’s entries, and when',
      'mo.accessWho': 'Who', 'mo.accessResult': 'Outcome', 'mo.accessAllowed': 'Access granted', 'mo.accessDenied': 'Refused',
      'mo.accessNone': 'Nobody has looked at the nurse’s records yet.', 'mo.lcCol': 'Comments'
    }
  });

  /* Zapisywane w karcie wycieczki jako powód — zostaje po polsku. */
  var NO_SIGNUP_REASON = 'Brak zgłoszenia na wycieczkę';

  function tabTitle(t) { var k = 'mo.tab.' + t.id, s = A.t(k); return s === k ? t.label : s; }
  function err(e) { A.toast(e.message || A.t('mo.opFailed'), 'danger'); }

  /* ---------------------------------------------------------------- świetlica */
  function Swietlica() {
    var s1 = React.useState(''), code = s1[0], setCode = s1[1];
    var s2 = React.useState(''), line = s2[0], setLine = s2[1];
    var s3 = React.useState(null), codeErr = s3[0], setCodeErr = s3[1];
    var s4 = React.useState('7b'), cls = s4[0], setCls = s4[1];
    var roster = A.useApi('/api/modules/care/roster?classId=' + cls, [cls]);
    var pick = A.useApi('/api/modules/care/pickups', []);
    function reload() { roster.reload(); pick.reload(); }
    function checkIn(body, label) {
      setCodeErr(null);
      A.api.post('/api/modules/care/checkin', body).then(function (r) { setLine(r.confirmation); setCode(''); reload(); })
        .catch(function (x) { setCodeErr(x.message); setLine(''); void label; });
    }
    var classes = roster.data ? roster.data.classes : [];
    return h('div', { className: 'stack' },
      h('h3', { className: 'heading' }, A.t('mo.careTitle')),
      h('div', { className: 'grid-2' },
        h('div', { className: 'card' },
          h(E.TextField, {
            label: A.t('mo.scanCard'), mono: true, value: code, error: codeErr || undefined,
            hint: A.t('mo.scanHint'),
            placeholder: '7B-007',
            onChange: function (e) { setCode(e.target.value); setCodeErr(null); },
            onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); checkIn({ barcode: code }); } }
          }),
          h('div', { className: 'row mt-4' },
            h(E.Button, { icon: 'barcode', variant: 'primary', onClick: function () { checkIn({ barcode: code }); } }, A.t('mo.checkIn')),
            h(E.StatTile, { label: A.t('mo.presentNow'), value: String(roster.data ? roster.data.present : 0), hint: A.t('mo.openUntil', { time: roster.data ? roster.data.openUntil : '' }) })),
          h('p', { className: 'caption muted', 'aria-live': 'polite' }, line || A.t('mo.checkInNote'))),
        h('div', { className: 'card' },
          h(E.Select, {
            label: A.t('mo.quickList'), value: cls, options: classes.map(function (c) { return { value: c.id, label: A.plural(c.students, 'mo.students').split('{name}').join(c.name) }; }),
            onChange: function (e) { setCls(e.target.value); }
          }),
          roster.data ? h(E.Table, {
            caption: A.t('mo.classStudents', { 'class': cls }), hideCaption: true,
            columns: [
              { key: 'label', title: A.t('common.student') },
              { key: 'barcode', title: A.t('mo.code'), className: 'ed-mono' },
              { key: 'status', title: A.t('mo.tab.swietlica'), render: function (r) {
                return r.checkedIn ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('mo.enteredAt', { time: r.inAt }))
                  : h(E.Button, { size: 'sm', 'aria-label': A.t('mo.checkInAria', { name: r.label }), onClick: function () { checkIn({ studentId: r.studentId }); } }, A.t('common.save'));
              } }],
            rows: roster.data.students
          }) : h('p', { className: 'muted' }, A.t('mo.loadingList')))),

      h('h3', { className: 'heading' }, A.t('mo.pickupTitle')),
      pick.data ? h(F, null,
        h(E.Table, {
          caption: A.t('mo.authorizedCaption'),
          columns: [
            { key: 'label', title: A.t('mo.child') },
            { key: 'person', title: A.t('mo.collects'), render: function (r) { return h(F, null, r.person + ' (' + r.relation + ')', h('div', { className: 'caption muted' }, r.note)); } },
            { key: 'badge', title: A.t('mo.permission'), render: function (r) { return r.valid ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('mo.authorized')) : h(E.Badge, { tone: 'danger', icon: 'alert-circle' }, A.t('mo.outdated')); } },
            { key: 'akcja', title: A.t('mo.releaseCol'), render: function (r) {
              var inCare = (pick.data.inCare || []).some(function (c) { return c.studentId === r.studentId; });
              if (!inCare) return h('span', { className: 'caption muted' }, A.t('mo.notInCare'));
              return h(E.Button, { size: 'sm', 'aria-label': A.t('mo.releaseAria', { name: r.label }), onClick: function () {
                A.api.post('/api/modules/care/pickup', { studentId: r.studentId, pickupId: r.pickupId })
                  .then(function (x) { setLine(x.confirmation); A.toast(x.confirmation, 'success'); reload(); }).catch(err);
              } }, A.t('mo.releaseChild'));
            } }],
          rows: pick.data.authorized
        }),
        pick.data.log.length ? h('div', { className: 'stack mt-4' }, pick.data.log.map(function (l) {
          return h(E.AuditEntry, {
            key: l.id, kind: 'create', actor: l.by, action: A.t('mo.releasedAction'), target: l.label,
            time: A.fmtDateTime(l.at), iso: String(l.at).slice(0, 10),
            reason: A.t('mo.pickupReason', { person: l.person, relation: l.relation }),
            meta: { id: l.id, device: A.t('mo.device') }
          });
        })) : h('p', { className: 'caption muted' }, A.t('mo.pickupNote'))) : h('p', { className: 'muted' }, A.t('mo.loadingPickups')));
  }

  /* ---------------------------------------------------------------- stołówka: zakładanie kont
     GAP-5 — do tej rundy konto stołówkowe potrafił założyć wyłącznie zasiew demo, więc w nowej
     szkole raport obiadów i blokada przy zaległości czytały pustą kolekcję. */
  function AccountSetup(p) {
    var s1 = React.useState({ target: 'class', classId: (p.classes[0] || {}).id || '', studentId: '', mealPlan: 'obiad', mealPrice: '', period: '' });
    var f = s1[0], set = s1[1];
    var upd = function (k) { return function (ev) { var o = {}; o[k] = ev.target.value; set(Object.assign({}, f, o)); }; };
    /* Lista oddziałów przychodzi po pierwszym renderze — pole wyboru musi ją wtedy przyjąć. */
    React.useEffect(function () {
      if (!f.classId && p.classes.length) set(Object.assign({}, f, { classId: p.classes[0].id }));
    }, [p.classes.length]);
    var ready = f.target === 'class' ? !!f.classId : !!f.studentId.trim();
    function create() {
      var body = { mealPlan: f.mealPlan };
      if (f.mealPrice !== '') body.mealPrice = f.mealPrice;
      if (f.period.trim()) body.period = f.period.trim();
      if (f.target === 'class') body.classId = f.classId; else body.studentId = f.studentId.trim();
      A.api.post('/api/modules/cafeteria/accounts', body)
        .then(function (r) { A.toast(r.confirmation, 'success'); set(Object.assign({}, f, { studentId: '' })); p.onDone(); })
        .catch(err);
    }
    return h('section', { className: 'card', 'aria-labelledby': 'h-mo-caf-setup' },
      h('h3', { id: 'h-mo-caf-setup', className: 'heading' }, A.t('mo.setupAccounts')),
      h('div', { className: 'grid-2' },
        h(E.Select, {
          label: A.t('mo.setupTarget'), value: f.target, onChange: upd('target'),
          options: [{ value: 'class', label: A.t('mo.setupWholeClass') }, { value: 'student', label: A.t('mo.setupOnePupil') }]
        }),
        f.target === 'class'
          ? h(E.Select, { label: A.t('common.class'), value: f.classId, onChange: upd('classId'), options: p.classes.map(function (c) { return { value: c.id, label: c.name || c.id }; }) })
          : h(E.TextField, { label: A.t('mo.studentIdField'), mono: true, value: f.studentId, placeholder: 'st_kowalczyk_anna', onChange: upd('studentId') })),
      h('div', { className: 'grid-3' },
        h(E.TextField, { label: A.t('mo.mealPlan'), value: f.mealPlan, placeholder: 'obiad', onChange: upd('mealPlan') }),
        h(E.TextField, { label: A.t('mo.mealPriceField'), value: f.mealPrice, inputMode: 'decimal', placeholder: '4,20', onChange: upd('mealPrice') }),
        h(E.TextField, { label: A.t('mo.periodField'), value: f.period, placeholder: 'listopad 2026', onChange: upd('period') })),
      h('div', { className: 'row mt-4' },
        h(E.Button, { variant: 'primary', icon: 'plus', disabled: !ready, onClick: create }, A.t('mo.createAccounts'))),
      h('p', { className: 'caption muted' }, A.t('mo.setupAccountsHint')));
  }

  /* ---------------------------------------------------------------- stołówka */
  function Stolowka() {
    var rep = A.useApi('/api/modules/cafeteria/meal-report', []);
    var acc = A.useApi('/api/modules/cafeteria/accounts', []);
    var classList = acc.data && acc.data.classes ? acc.data.classes : [];
    var d = rep.data;
    return h('div', { className: 'stack' },
      h(AccountSetup, { classes: classList, onDone: function () { acc.reload(); rep.reload(); } }),
      acc.data && acc.data.accounts.length ? h(E.Table, {
        caption: A.t('mo.accountsCaption'), stack: true,
        columns: [
          { key: 'label', title: A.t('common.student') },
          { key: 'mealPlan', title: A.t('mo.plan') },
          { key: 'mealPrice', title: A.t('mo.price'), num: true, render: function (r) { return A.fmtMoney(r.mealPrice || 0); } },
          { key: 'balance', title: A.t('mo.balance'), num: true, render: function (r) { return A.fmtMoney(r.balance || 0); } },
          { key: 'active', title: A.t('mo.activeCol'), render: function (r) { return r.active ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('common.yes')) : h(E.Badge, { tone: 'outline' }, A.t('common.no')); } }],
        rows: acc.data.accounts.slice(0, 40)
      }) : null,
      h('h3', { className: 'heading' }, A.t('mo.mealsToday')),
      d ? h(F, null,
        h('div', { className: 'row' },
          h(E.StatTile, { label: A.t('mo.lunchesToday'), value: String(d.totals.portions), delta: { dir: 'down', text: A.t('mo.vsEnrolled', { n: d.totals.enrolled - d.totals.portions }) }, hint: d.source }),
          h(E.StatTile, { label: A.t('mo.enrolledLunch'), value: String(d.totals.enrolled), hint: A.t('mo.mealContracts') }),
          h(E.StatTile, { label: A.t('mo.mealsValue'), value: A.fmtMoney(d.value), hint: A.t('mo.mealPrice', { v: A.fmtMoney(d.mealPrice) }) })),
        h(E.Table, {
          caption: A.t('mo.mealsCaption', { date: A.fmtDate(d.date) }),
          columns: [
            { key: 'className', title: A.t('common.class') },
            { key: 'enrolled', title: A.t('mo.enrolled'), num: true },
            { key: 'absentMorning', title: A.t('mo.absentMorning'), num: true },
            { key: 'cancelled', title: A.t('mo.cancelled'), num: true },
            { key: 'blocked', title: A.t('mo.blocked'), num: true },
            { key: 'portions', title: A.t('mo.portions'), num: true }],
          rows: d.rows.map(function (r) { return Object.assign({ id: r.classId }, r); })
        })) : h('p', { className: 'muted' }, A.t('mo.loadingReport')),

      h('h3', { className: 'heading' }, A.t('mo.debts')),
      acc.data ? h(F, null,
        h(E.Table, {
          caption: A.t('mo.debtsCaption'),
          columns: [
            { key: 'label', title: A.t('common.student') },
            { key: 'debt', title: A.t('mo.debt'), num: true, render: function (r) { return A.fmtMoney(r.debt); } },
            { key: 'period', title: A.t('mo.period') },
            { key: 'status', title: A.t('common.status'), render: function (r) {
              return r.blocked ? h(E.Badge, { tone: 'outline', icon: 'lock' }, A.t('mo.servingBlocked'))
                : r.overdue ? h(E.Badge, { tone: 'danger', icon: 'alert-circle' }, A.t('mo.debt'))
                  : h(E.Badge, { tone: 'success', icon: 'check' }, A.t('mo.noDebt'));
            } },
            { key: 'akcja', title: A.t('mo.action'), render: function (r) {
              if (r.blocked) return h('span', { className: 'caption muted' }, A.t('mo.guardianNotified'));
              if (!r.overdue) return h('span', { className: 'caption muted' }, '—');
              return h(E.Button, { size: 'sm', 'aria-label': A.t('mo.blockAria', { name: r.label }), onClick: function () {
                A.api.post('/api/modules/cafeteria/accounts/' + r.id + '/block', {})
                  .then(function (x) { A.toast(x.confirmation, 'success'); acc.reload(); rep.reload(); }).catch(err);
              } }, A.t('mo.blockBtn'));
            } }],
          rows: acc.data.accounts.filter(function (r) { return r.overdue || r.blocked; })
        }),
        h(E.Alert, { tone: 'info', title: A.t('mo.discretion') }, A.t('mo.discretionText'))) : h('p', { className: 'muted' }, A.t('mo.loadingAccounts')));
  }

  /* ---------------------------------------------------------------- wycieczka */
  function Wycieczka() {
    var trips = A.useApi('/api/modules/trips', []);
    var s1 = React.useState(null), picked = s1[0], setPicked = s1[1];
    var list = trips.data ? trips.data.trips : [];
    var id = picked || (list[0] && list[0].id);
    var np = A.useApi(id ? '/api/modules/trips/' + id + '/non-participants' : null, [id]);
    var t = list.filter(function (x) { return x.id === id; })[0];
    if (!trips.data) return h('p', { className: 'muted' }, A.t('mo.loadingTrips'));
    if (!t) return h(E.Alert, { tone: 'info', title: A.t('mo.noTrips') }, A.t('mo.noTripsText'));
    return h('div', { className: 'stack' },
      h(E.Select, {
        label: A.t('mo.tripCard'), value: id, options: list.map(function (x) { return { value: x.id, label: x.name + ' · ' + x.period + ' · ' + x.statusLabel }; }),
        onChange: function (e) { setPicked(e.target.value); }
      }),
      h('div', { className: 'card' },
        h('div', { className: 'grid-3' },
          h(E.TextField, { label: A.t('mo.tripName'), value: t.name, readOnly: true }),
          h(E.TextField, { label: A.t('mo.tripPeriod'), value: t.period, readOnly: true }),
          h(E.TextField, { label: A.t('mo.tripLeader'), value: t.leader, readOnly: true }),
          h(E.TextField, { label: A.t('mo.transport'), value: t.transport || '—', readOnly: true }),
          h(E.TextField, { label: A.t('mo.classes'), value: (t.classIds || []).join(', '), readOnly: true }),
          h(E.TextField, { label: A.t('mo.chaperones'), value: t.chaperones.map(function (c) { return A.t('mo.groupShort', { name: c.name, n: c.groupNo }); }).join(', ') || '—', readOnly: true })),
        h('div', { className: 'row mt-4' },
          h(E.Badge, { tone: 'info', icon: 'shield' }, A.t('mo.insuranceBadge', { insurer: (t.insurance || {}).insurer || '—', policy: (t.insurance || {}).policyNo || '—' })),
          h(E.Badge, { tone: 'outline', icon: 'map-pin' }, A.t('mo.consentsBadge', { n: t.consentCount, of: t.participantCount })),
          h(E.Badge, { tone: t.status === 'approved' ? 'success' : 'accent', icon: t.status === 'approved' ? 'check' : 'clock' }, t.statusLabel)),
        h('div', { className: 'row mt-4' },
          t.status === 'draft'
            ? h(E.Button, { variant: 'primary', onClick: function () {
              A.api.post('/api/modules/trips/' + t.id + '/submit', {}).then(function (r) { A.toast(r.message, 'success'); trips.reload(); }).catch(err);
            } }, A.t('mo.submitTrip'))
            : null,
          h(E.Button, { icon: 'printer', onClick: function () { A.openPrint('/api/modules/trips/' + t.id + '/print'); } }, A.t('mo.printTrip')),
          h('span', { className: 'caption muted', 'aria-live': 'polite' },
            t.status === 'approved' ? A.t('mo.tripApprovedNote') : A.t('mo.tripDraftNote'))),
        (t.schedule || []).length ? h('ul', { style: { margin: 'var(--space-3) 0 0', paddingLeft: 'var(--space-5)' } }, t.schedule.map(function (x, i) {
          return h('li', { key: i }, A.fmtDate(x.day) + ': ' + x.text);
        })) : null),

      h('h3', { className: 'heading' }, A.t('mo.participants')),
      h(E.Table, {
        caption: A.t('mo.participantsCaption'),
        columns: [
          { key: 'label', title: A.t('common.student') },
          { key: 'groupNo', title: A.t('mo.group'), render: function (r) { return r.groupNo ? A.t('mo.groupN', { n: r.groupNo }) : '—'; } },
          { key: 'consent', title: A.t('mo.consent'), render: function (r) { return r.signed ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('mo.signed')) : h(E.Badge, { tone: 'outline', icon: 'clock' }, A.t('mo.pending')); } },
          { key: 'status', title: A.t('mo.statusInLogbook'), render: function () { return t.status === 'approved' ? h(E.AttendanceChip, { status: 'w', word: true }) : h(E.AttendanceChip, { status: 'none' }); } }],
        rows: t.students
      }),

      h('h3', { className: 'heading' }, A.t('mo.staying')),
      np.data ? h(F, null,
        h(E.Table, {
          caption: A.t('mo.stayingCaption'),
          columns: [
            { key: 'label', title: A.t('common.student') },
            { key: 'reason', title: A.t('common.reason'), render: function (r) { return r.reason || '—'; } },
            { key: 'temp', title: A.t('mo.tempGroup'), render: function (r) {
              return h(E.Select, {
                label: '', 'aria-label': A.t('mo.tempGroupAria', { name: r.label }), value: r.tempGroup || '', options: np.data.options,
                onChange: function (e) {
                  A.api.post('/api/modules/trips/' + t.id + '/non-participants', { studentId: r.studentId, tempGroup: e.target.value, reason: r.reason || NO_SIGNUP_REASON })
                    .then(function () { np.reload(); A.toast(A.t('mo.tempGroupSaved'), 'success'); }).catch(err);
                }
              });
            } }],
          rows: np.data.students
        }),
        h('p', { className: 'caption muted' }, np.data.note + A.t('mo.unassigned', { n: np.data.unassigned }))) : h('p', { className: 'muted' }, A.t('mo.loadingList')));
  }

  /* ---------------------------------------------------------------- biblioteka: stan zbiorów
     GAP-5 — `libraryItems` wypełniał dotąd wyłącznie zasiew demo, więc w nowej szkole nie było
     czego wypożyczyć. Arkusz wkleja się w całości (`barcode;title;kind`), pojedynczą pozycję
     dodaje się formularzem obok. */
  function LibrarySetup(p) {
    var s1 = React.useState(''), csv = s1[0], setCsv = s1[1];
    var s2 = React.useState(null), res = s2[0], setRes = s2[1];
    var s3 = React.useState({ barcode: '', title: '', kind: 'textbook' }), f = s3[0], set = s3[1];
    var upd = function (k) { return function (ev) { var o = {}; o[k] = ev.target.value; set(Object.assign({}, f, o)); }; };
    var KINDS = ['textbook', 'book', 'reading', 'other'];
    function send(dry) {
      A.api.post('/api/modules/library/items', { csv: csv, dryRun: !!dry })
        .then(function (r) { setRes(r); if (!dry) { A.toast(r.confirmation, 'success'); setCsv(''); p.onDone(); } })
        .catch(function (e) { setRes((e && e.extra) || null); err(e); });
    }
    function addOne() {
      A.api.post('/api/modules/library/items', { barcode: f.barcode.trim(), title: f.title.trim(), kind: f.kind })
        .then(function (r) { A.toast(r.confirmation, 'success'); set({ barcode: '', title: '', kind: f.kind }); p.onDone(); })
        .catch(err);
    }
    return h('section', { className: 'card', 'aria-labelledby': 'h-mo-lib-setup' },
      h('h3', { id: 'h-mo-lib-setup', className: 'heading' }, A.t('mo.setupLibrary')),
      h('div', { className: 'grid-2' },
        h('div', { className: 'stack' },
          h(E.TextField, {
            label: A.t('mo.libCsv'), multiline: 5, mono: true, value: csv, placeholder: A.t('mo.libCsvPh'),
            hint: A.t('mo.setupLibraryHint', { cols: 'barcode;title;kind' }),
            onChange: function (ev) { setCsv(ev.target.value); }
          }),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'secondary', icon: 'eye', disabled: !csv.trim(), onClick: function () { send(true); } }, A.t('mo.libCheck')),
            h(E.Button, { variant: 'primary', icon: 'upload', disabled: !csv.trim(), onClick: function () { send(false); } }, A.t('mo.libApply'))),
          h('p', { className: 'caption muted', role: 'status', 'aria-live': 'polite' },
            res ? (res.dryRun
              ? A.t('mo.libDry', { created: res.created || 0, updated: res.updated || 0, skipped: res.skipped || 0 })
              : A.t('mo.libApplied', { created: res.created || 0, updated: res.updated || 0 })) : ''),
          res && res.errors && res.errors.length
            ? h(E.Alert, { tone: 'warning', title: A.t('mo.errorsTitle') },
              h('ul', { className: 'stack' }, res.errors.slice(0, 8).map(function (x, i) { return h('li', { key: i }, A.t('mo.errLine', { line: x.line, error: x.error })); })))
            : null),
        h('div', { className: 'stack' },
          h('h4', null, A.t('mo.libOne')),
          h(E.TextField, { label: A.t('mo.libBarcode'), mono: true, value: f.barcode, placeholder: '9788390000016', onChange: upd('barcode') }),
          h(E.TextField, { label: A.t('mo.libTitleField'), value: f.title, onChange: upd('title') }),
          h(E.Select, { label: A.t('mo.libKind'), value: f.kind, onChange: upd('kind'), options: KINDS.map(function (k) { return { value: k, label: A.t('mo.libKind.' + k) }; }) }),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'secondary', icon: 'plus', disabled: !f.barcode.trim() || !f.title.trim(), onClick: addOne }, A.t('mo.libAdd'))))));
  }

  /* ---------------------------------------------------------------- biblioteka */
  function Biblioteka() {
    var s1 = React.useState('7b'), cls = s1[0], setCls = s1[1];
    var s2 = React.useState(''), scan = s2[0], setScan = s2[1];
    var s3 = React.useState([]), codes = s3[0], setCodes = s3[1];
    var s4 = React.useState(''), line = s4[0], setLine = s4[1];
    var items = A.useApi('/api/modules/library/items', []);
    var loans = A.useApi('/api/modules/library/loans?classId=' + cls + '&open=1', [cls]);
    var settle = A.useApi('/api/modules/library/settlement?classId=' + cls, [cls]);
    function add() {
      var code = scan.trim(); if (!code) return;
      var known = (items.data ? items.data.items : []).filter(function (i) { return i.barcode === code; })[0];
      if (!known) { setLine(A.t('mo.unknownCode', { code: code })); return; }
      if (codes.indexOf(code) < 0) setCodes(codes.concat([code]));
      setLine(A.t('mo.addedToSet', { title: known.title })); setScan('');
    }
    return h('div', { className: 'stack' },
      h(LibrarySetup, { onDone: function () { items.reload(); } }),
      h('h3', { className: 'heading' }, A.t('mo.libTitle')),
      h('div', { className: 'grid-2' },
        h('div', { className: 'card' },
          h(E.Select, { label: A.t('common.class'), value: cls, options: ['1a', '3a', '7a', '7b', '8b'].map(function (c) { return { value: c, label: c }; }), onChange: function (e) { setCls(e.target.value); } }),
          h(E.TextField, {
            label: A.t('mo.scanBook'), mono: true, value: scan, placeholder: '978830123…',
            hint: A.t('mo.scanBookHint'),
            onChange: function (e) { setScan(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } }
          }),
          h('div', { className: 'row mt-4' },
            h(E.Button, { icon: 'barcode', onClick: add }, A.t('mo.addItem')),
            h(E.Button, { variant: 'primary', disabled: !codes.length, onClick: function () {
              A.api.post('/api/modules/library/batch-checkout', { classId: cls, barcodes: codes })
                .then(function (r) { setLine(r.confirmation); setCodes([]); loans.reload(); settle.reload(); A.toast(r.confirmation, 'success'); }).catch(err);
            } }, A.t('mo.lendSet', { 'class': cls })),
            h(E.StatTile, { label: A.t('mo.setItems'), value: String(codes.length), hint: A.t('mo.scannedCodes') })),
          codes.length ? h('div', { className: 'row' }, codes.map(function (c) { return h(E.Badge, { key: c, tone: 'outline', icon: 'file' }, c); })) : null,
          h('p', { className: 'caption muted', 'aria-live': 'polite' }, line || A.t('mo.libNote'))),
        loans.data ? h(E.Table, {
          caption: A.t('mo.loansCaption', { 'class': cls }),
          columns: [
            { key: 'title', title: A.t('mo.item') },
            { key: 'barcode', title: A.t('mo.code'), className: 'ed-mono' },
            { key: 'label', title: A.t('common.student') },
            { key: 'dueDate', title: A.t('mo.dueDate'), render: function (r) { return r.dueDate ? A.fmtDate(r.dueDate) : '—'; } }],
          rows: loans.data.loans
        }) : h('p', { className: 'muted' }, A.t('mo.loadingLoans'))),

      h('h3', { className: 'heading' }, A.t('mo.settlement')),
      settle.data ? h(F, null,
        h(E.Table, {
          caption: A.t('mo.settlementCaption', { 'class': cls }),
          columns: [
            { key: 'label', title: A.t('common.student') },
            { key: 'ok', title: A.t('mo.settlementCol'), render: function (r) { return r.settled ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('mo.settled')) : h(E.Badge, { tone: 'danger', icon: 'alert-circle' }, A.t('mo.debt')); } },
            { key: 'detail', title: A.t('mo.details') }],
          rows: settle.data.students
        }),
        settle.data.unsettled
          ? h(E.Alert, { tone: 'warning', title: A.t('mo.certificates') }, A.t('mo.unsettledText', { n: settle.data.unsettled }))
          : h(E.Alert, { tone: 'success', title: A.t('mo.certificates') }, A.t('mo.allSettled'))) : h('p', { className: 'muted' }, A.t('mo.loadingSettlement')));
  }

  /* ---------------------------------------------------------------- gabinet */
  function Gabinet() {
    var s1 = React.useState({ studentId: '', kind: 'otarcie', time: '', description: '', aid: '', outcome: 'return' }), f = s1[0], set = s1[1];
    var visits = A.useApi('/api/modules/nurse/visits', []);
    var alog = A.useApi('/api/modules/nurse/access-log', []);          // rejestr wglądów — komentowalny (3.8.10)
    var kinds = visits.data && visits.data.kinds ? visits.data.kinds : [{ value: 'otarcie', label: A.t('mo.kindFallback') }];
    var outcomes = visits.data && visits.data.outcomes ? visits.data.outcomes : [{ value: 'return', label: A.t('mo.outcomeFallback') }];
    var last = visits.data && visits.data.visits.length ? visits.data.visits[0] : null;
    return h('div', { className: 'stack' },
      h('h3', { className: 'heading' }, A.t('mo.nurseTitle')),
      h('div', { className: 'grid-2' },
        h('div', { className: 'card' },
          h(E.TextField, { label: A.t('mo.studentIdLabel'), mono: true, value: f.studentId, placeholder: 'st_kowalczyk_anna', onChange: function (e) { set(Object.assign({}, f, { studentId: e.target.value })); } }),
          h('div', { className: 'grid-2' },
            h(E.TextField, { label: A.t('mo.time'), value: f.time, placeholder: '11:20', onChange: function (e) { set(Object.assign({}, f, { time: e.target.value })); } }),
            h(E.Select, { label: A.t('mo.eventKind'), value: f.kind, options: kinds, onChange: function (e) { set(Object.assign({}, f, { kind: e.target.value })); } })),
          h(E.TextField, {
            label: A.t('mo.eventDesc'), multiline: 3, value: f.description, placeholder: A.t('mo.eventDescPh'),
            hint: A.t('mo.eventDescHint'),
            onChange: function (e) { set(Object.assign({}, f, { description: e.target.value })); }
          }),
          h(E.TextField, { label: A.t('mo.aid'), multiline: 2, value: f.aid, placeholder: A.t('mo.aidPh'), onChange: function (e) { set(Object.assign({}, f, { aid: e.target.value })); } }),
          h(E.Select, { label: A.t('mo.outcome'), value: f.outcome, options: outcomes, onChange: function (e) { set(Object.assign({}, f, { outcome: e.target.value })); } }),
          h('div', { className: 'row mt-4' },
            h(E.Button, { variant: 'primary', icon: 'check', disabled: !f.studentId.trim() || !f.description.trim(), onClick: function () {
              A.api.post('/api/modules/nurse/visits', f).then(function (r) {
                A.toast(r.confirmation, 'success'); set(Object.assign({}, f, { description: '', aid: '' })); visits.reload();
              }).catch(err);
            } }, A.t('mo.saveVisit')))),
        h('div', { className: 'stack' },
          last ? h(E.ConfidentialNote, {
            title: A.t('mo.visitTitle', { time: last.time, name: last.label }), readers: A.t('mo.visitReaders'),
            author: last.nurse, date: A.fmtDate(last.date), meta: A.t('mo.entryNo', { no: last.no })
          }, last.description + (last.aid ? ' ' + last.aid : '') + (last.parentNotified ? A.t('mo.parentNotified') : ''))
            : h('p', { className: 'muted' }, A.t('mo.noVisits')),
          h(E.Alert, { tone: 'info', title: A.t('mo.healthData') }, A.t('mo.healthText')))),
      visits.data && visits.data.visits.length ? h(E.Table, {
        caption: A.t('mo.visitsCaption'),
        columns: [
          { key: 'date', title: A.t('common.date'), render: function (r) { return A.fmtDate(r.date) + ' ' + r.time; } },
          { key: 'label', title: A.t('common.student') },
          { key: 'kindLabel', title: A.t('mo.event') },
          { key: 'outcomeLabel', title: A.t('mo.outcome') },
          { key: 'no', title: A.t('mo.entryNoCol'), className: 'ed-mono' }],
        rows: visits.data.visits
      }) : null,
      /* Każdy wgląd — także odmowa — zostaje w rejestrze; wpis rejestru można skomentować. */
      alog.data ? h('div', { className: 'stack' },
        h('h4', { className: 'heading' }, A.t('mo.accessLog')),
        alog.data.log.length ? h(E.Table, {
          caption: A.t('mo.accessLogCaption'),
          columns: [
            { key: 'at', title: A.t('common.date'), render: function (r) { return A.fmtDateTime(r.at); } },
            { key: 'user', title: A.t('mo.accessWho'), render: function (r) { return r.user + ' · ' + A.t('role.' + r.role); } },
            { key: 'res', title: A.t('mo.accessResult'), render: function (r) {
                return r.allowed ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('mo.accessAllowed')) : h(E.Badge, { tone: 'danger', icon: 'lock' }, A.t('mo.accessDenied'));
              } },
            { key: 'lc', title: A.t('mo.lcCol'), render: function (r) {
                return h(window.EdLogComments.Toggle, { kind: 'nurse-access-log', entryId: r.id, counts: (alog.data.comments || {})[r.id] || null, onChange: function () { alog.reload(); } });
              } }],
          rows: alog.data.log
        }) : h('p', { className: 'muted' }, A.t('mo.accessNone'))) : null);
  }

  var PANELS = { swietlica: Swietlica, stolowka: Stolowka, wycieczka: Wycieczka, biblioteka: Biblioteka, gabinet: Gabinet };

  A.screen({
    id: 'modules', path: '/moduly', title: 'Moduły szkolne', module: 'school',
    roles: ['careEducator', 'cafeteria', 'librarian', 'nurse', 'teacher', 'principal'],
    nav: { key: 'nav.modules', label: 'Moduły', order: 60 },
    component: function ModulesScreen(props) {
      var tabsApi = A.useApi('/api/modules/tabs', []);
      var st = React.useState(null), tab = st[0], setTab = st[1];
      var tabs = tabsApi.data ? tabsApi.data.tabs : [];
      var active = tab || (tabs[0] && tabs[0].id);
      return h('div', { className: 'stack' },
        h('div', null,
          h('h1', { className: 'display app-title' }, A.t('mo.title')),
          h('p', { className: 'app-sub' }, (tabsApi.data ? A.fmtDate(tabsApi.data.today) + ' · ' : '') + A.t('mo.sub'))),
        tabsApi.error ? h(E.Alert, { tone: 'danger' }, tabsApi.error.message) : null,
        !tabs.length && !tabsApi.loading ? h(E.Alert, { tone: 'info', title: A.t('mo.noModules') }, A.t('mo.noModulesText')) : null,
        tabs.length ? h(E.Tabs, {
          label: A.t('mo.tabsLabel'), value: active, onChange: setTab,
          tabs: tabs.map(function (t) { return { id: t.id, label: tabTitle(t) }; })
        }, function (id) { var P = PANELS[id]; return P ? h(P, { user: props.user }) : null; }) : null);
    }
  });
})();
