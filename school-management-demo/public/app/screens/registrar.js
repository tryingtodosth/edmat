/* 3.5 — Sekretariat: księga uczniów, legitymacje cyfrowe, duplikaty świadectw, rejestr obwodowy. */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'rg.title': 'Sekretariat',
      'rg.sub': '{school} · rok szkolny {year} · stan na {date}',
      'rg.loading': 'Wczytywanie księgi uczniów…',
      'rg.tabsLabel': 'Sekcje sekretariatu',
      'rg.tab.book': 'Księga uczniów',
      'rg.tab.docs': 'Legitymacje i duplikaty',
      'rg.tab.district': 'Rejestr obwodowy',
      'rg.popupBlocked': 'Przeglądarka zablokowała nowe okno — zezwól na wyskakujące okna, aby wydrukować dokument.',

      'rg.pesel.idle': 'Jedenaście cyfr. Cyfra kontrolna liczona wagami 1, 3, 7, 9, 1, 3, 7, 9, 1, 3 sprawdzana jest przy każdym znaku.',
      'rg.pesel.notDigit': 'Pozycja {pos}: znak „{ch}” nie jest cyfrą. Numer PESEL to 11 cyfr bez spacji i myślników.',
      'rg.pesel.short': 'Wpisano {got} z 11 cyfr; brakuje {left}. Cyfra kontrolna zostanie sprawdzona po ostatniej cyfrze.',
      'rg.pesel.long': 'Wpisano {got} cyfr, a numer PESEL ma 11. Usuń {extra} ostatnich cyfr.',
      'rg.pesel.checksum': 'Pozycja 11 (cyfra kontrolna): wpisano {typed}, a z cyfr na pozycjach 1–10 wynika {expected}.',
      'rg.pesel.month': 'Pozycje 3–4 („{raw}”) nie kodują miesiąca urodzenia. Dopuszczalne zakresy to 01–12, 21–32, 41–52, 61–72, 81–92.',
      'rg.pesel.day': 'Pozycje 5–6 („{raw}”) nie kodują dnia miesiąca: {month} {year} ma {days} dni.',
      'rg.pesel.mismatch': 'Z pozycji 1–6 numeru PESEL wynika data urodzenia {born}, a w polu „Data urodzenia” wpisano {typed}. Popraw jedno z pól.',
      'rg.pesel.ok': 'Numer poprawny: cyfra kontrolna {ctrl} zgodna, data urodzenia {born}, zakodowana płeć {sex}.',
      'rg.sex.male': 'męska',
      'rg.sex.female': 'żeńska',
      'rg.monthOf.1': 'stycznia', 'rg.monthOf.2': 'lutego', 'rg.monthOf.3': 'marca', 'rg.monthOf.4': 'kwietnia', 'rg.monthOf.5': 'maja', 'rg.monthOf.6': 'czerwca',
      'rg.monthOf.7': 'lipca', 'rg.monthOf.8': 'sierpnia', 'rg.monthOf.9': 'września', 'rg.monthOf.10': 'października', 'rg.monthOf.11': 'listopada', 'rg.monthOf.12': 'grudnia',

      'rg.new.title': 'Nowy uczeń',
      'rg.new.sub': 'Wpis do księgi uczniów · rok szkolny {year} · kolejny numer księgi {no}',
      'rg.new.idDoc': 'Dokument tożsamości',
      'rg.new.peselOpt': 'PESEL',
      'rg.new.peselOptHint': 'Uczeń z nadanym numerem PESEL',
      'rg.new.passportOpt': 'Inny dokument (paszport, karta pobytu)',
      'rg.new.passportOptHint': 'Uczeń bez numeru PESEL, np. przybywający z zagranicy (§ 4 rozporządzenia o dokumentacji)',
      'rg.new.docType': 'Rodzaj dokumentu',
      'rg.new.docTypeHint': 'Rodzaj i numer dokumentu zastępują w księdze numer PESEL.',
      'rg.doc.passport': 'Paszport',
      'rg.doc.residence-card': 'Karta pobytu',
      'rg.doc.other': 'Inny dokument tożsamości',
      'rg.doc.missing': 'brak numeru PESEL i dokumentu',
      'rg.new.lastName': 'Nazwisko',
      'rg.new.firstName': 'Imię',
      'rg.new.passportNo': 'Numer dokumentu',
      'rg.new.passportHint': 'Co najmniej 6 znaków; rodzaj, numer i kraj wydania trafiają do pakietu SIO.',
      'rg.new.country': 'Kraj wydania dokumentu',
      'rg.country.UA': 'Ukraina',
      'rg.country.BY': 'Białoruś',
      'rg.country.DE': 'Niemcy',
      'rg.country.XX': 'Inny',
      'rg.new.birthDate': 'Data urodzenia',
      'rg.new.birthDateHintPesel': 'Sprawdzana z pozycjami 1–6 numeru PESEL',
      'rg.new.birthDateHintPassport': 'Wymagana przy dokumencie zagranicznym',
      'rg.new.birthPlace': 'Miejsce urodzenia',
      'rg.new.birthPlaceHint': 'Miejscownik na świadectwie: „w Krakowie”',
      'rg.new.class': 'Oddział',
      'rg.new.parents': 'Dane rodziców i opiekunów prawnych',
      'rg.new.mother': 'Matka lub opiekun prawny',
      'rg.new.father': 'Ojciec lub opiekun prawny',
      'rg.new.phone': 'Telefon kontaktowy',
      'rg.new.email': 'Adres e-mail do konta rodzica',
      'rg.new.address': 'Adres zamieszkania ucznia',
      'rg.new.submit': 'Wpisz do księgi',
      'rg.new.notReady': 'Przycisk odblokuje się, gdy nazwisko, imię, data i miejsce urodzenia oraz dane opiekuna będą wypełnione, a dokument tożsamości przejdzie walidację.',
      'rg.new.savedLive': '{message} {name}, oddział {cls}.',
      'rg.new.savedToast': 'Wpisano do księgi pod numerem {no}.',
      'rg.new.passportOk': 'Dokument przyjęty',
      'rg.new.passportTodo': 'Uzupełnij dokument tożsamości',
      'rg.new.checksumOk': 'Suma kontrolna zgodna',
      'rg.new.numberBad': 'Numer błędny',
      'rg.new.todo': 'Do uzupełnienia',

      'rg.gu.title': 'Opiekunowie i zakres dostępu',
      'rg.gu.sub': 'Zakres jest parą (opiekun, dziecko): ten sam rodzic może mieć pełny wgląd przy jednym dziecku i informacyjny przy drugim. Zapis przy uczniu ma pierwszeństwo przed domyślnym zakresem konta.',
      'rg.gu.caption': 'Opiekunowie ucznia i ich zakres dostępu',
      'rg.gu.colGuardian': 'Opiekun',
      'rg.gu.colScope': 'Zakres dostępu',
      'rg.gu.colBasis': 'Uwaga do wpisu',
      'rg.gu.colActions': 'Działania',
      'rg.gu.scope': 'Zakres dostępu — {name}',
      'rg.gu.basis': 'Uwaga do wpisu — {name}',
      'rg.gu.basisPh': 'np. „wniosek matki z 12.10.2026, przyjęty w sekretariacie”',
      'rg.gu.basisHint': 'Rodzaj podstawy i sygnaturę wpisujesz w kolumnie obok; tu opisz, skąd wpis się wziął.',
      'rg.gu.statusHelp': 'Władza rodzicielska to prawo do decydowania o dziecku. Jej ograniczenie samo w sobie NIE odbiera prawa do informacji o nauce i frekwencji — dostęp zawęża się dopiero wtedy, gdy tak postanowi sąd albo gdy sekretariat nadpisze zakres ręcznie. Pozbawienie władzy i ograniczenie orzeczeniem sądu zapisuje się wyłącznie na postanowieniu z sygnaturą; zdjęcie ich wymaga nowego dokumentu.',
      'rg.gu.save': 'Zapisz zakres',
      'rg.gu.saveAria': 'Zapisz zakres dostępu — {name}',
      'rg.gu.saveWhy': 'Przycisk odblokuje się po wpisaniu podstawy zmiany (ostatnia kolumna).',
      'rg.gu.saveWhyBasis': 'Zdjęcie ograniczenia orzeczonego przez sąd wymaga rodzaju podstawy i sygnatury dokumentu.',
      'rg.gu.scope.full': 'pełny — oceny, uwagi, zadania, frekwencja',
      'rg.gu.scope.info': 'informacyjny — frekwencja, plan, wiadomości, bez ocen',
      'rg.gu.scope.none': 'brak — dostęp do danych dziecka wstrzymany',
      'rg.gu.perChild': 'zapis przy uczniu',
      'rg.gu.fromAccount': 'domyślny zakres konta',
      'rg.gu.none': 'Ten uczeń nie ma jeszcze przypisanego opiekuna — kod rejestracyjny czeka na odbiór.',
      'rg.gu.saved': 'Zakres opiekuna {name} przy uczniu {student}: {scope}.',
      'rg.gu.live': 'Opiekunów przypisanych: {n}.',
      'rg.gu.loading': 'Wczytywanie opiekunów…',
      'rg.gu.colStatus': 'Władza rodzicielska i podstawa',
      'rg.gu.status': 'Status władzy rodzicielskiej — {name}',
      'rg.gu.status.full': 'pełna',
      'rg.gu.status.limited': 'ograniczona (prawo do informacji zostaje)',
      'rg.gu.status.deprived': 'pozbawiony władzy rodzicielskiej',
      'rg.gu.status.court-restricted': 'ograniczona orzeczeniem sądu w zakresie informacji',
      'rg.gu.basisKind': 'Rodzaj podstawy — {name}',
      'rg.gu.basisKind.': '— nie podano —',
      'rg.gu.basisKind.court-order': 'postanowienie sądu',
      'rg.gu.basisKind.declaration': 'oświadczenie opiekuna',
      'rg.gu.basisRef': 'Sygnatura albo numer pisma — {name}',
      'rg.gu.basisRefPh': 'np. III Nsm 88/26',
      'rg.gu.basisDate': 'Data podstawy — {name}',
      'rg.gu.derived': 'Ze statusu wynika zakres: {scope}',
      'rg.gu.override': 'Nadpisz zakres ręcznie',
      'rg.gu.overrideAria': 'Nadpisz zakres ręcznie — opiekun {name}',
      'rg.gu.courtNeeded': 'Ten status wymaga postanowienia sądu z sygnaturą.',
      'rg.gu.adultTitle': 'Uczeń pełnoletni — dostęp opiekunów',
      'rg.gu.adultSince': 'Pełnoletni od {date}.',
      'rg.gu.rule.until-objection': 'Reguła szkoły: opiekunowie widzą dane ucznia pełnoletniego do chwili, w której uczeń wniesie sprzeciw.',
      'rg.gu.rule.consent-required': 'Reguła szkoły: od 18. urodzin opiekunowie nie widzą danych ucznia, dopóki uczeń nie wyrazi zgody.',
      'rg.gu.access.open': 'Opiekunowie mają wgląd zgodny z zapisanym zakresem.',
      'rg.gu.access.blocked': 'Uczeń wniósł sprzeciw — konta opiekunów nie mają wglądu.',
      'rg.gu.access.pending-consent': 'Uczeń nie zapisał jeszcze zgody — konta opiekunów nie mają wglądu.',
      'rg.flags.adultRule': 'Dostęp opiekunów do danych ucznia pełnoletniego',

      'rg.flags.title': 'Flagi ucznia',
      'rg.flags.sub': 'Pomoc społeczna uruchamia alert pedagoga po trzech dniach nieobecności bez informacji od opiekuna. Pełnoletność decyduje o tym, kto usprawiedliwia nieobecności.',
      'rg.flags.welfare': 'Uczeń objęty pomocą społeczną',
      'rg.flags.welfareHint': 'Włącza 3-dniowy alert frekwencyjny dla pedagoga.',
      'rg.flags.adult': 'Uczeń pełnoletni',
      'rg.flags.selfExcuse': 'Usprawiedliwia się sam',
      'rg.flags.selfExcuseHint': 'Dostępne dopiero po zaznaczeniu pełnoletności.',
      'rg.flags.parentBlocked': 'Sprzeciw pełnoletniego wobec wglądu opiekunów',
      'rg.flags.nationality': 'Obywatelstwo',
      'rg.flags.identityKind': 'Dokument tożsamości',
      'rg.flags.ident.pesel': 'PESEL',
      'rg.flags.ident.passport': 'Inny dokument (paszport, karta pobytu)',
      'rg.flags.docLegend': 'Dokument tożsamości ucznia',
      'rg.flags.docSave': 'Zapisz dokument', 'rg.flags.docCancel': 'Anuluj',
      'rg.flags.docWhy': 'Rodzaj, numer i kod kraju wydania są wymagane — bez nich księga uczniów nie przyjmie wpisu (§ 4 rozporządzenia o dokumentacji).',
      'rg.flags.peselLegend': 'Numer PESEL nadany w trakcie roku',
      'rg.flags.peselSave': 'Zapisz PESEL',
      'rg.flags.peselHint': 'Uczeń, który dostał numer PESEL już po wpisaniu do księgi (np. po otrzymaniu decyzji o pobycie), zachowuje numer księgi, konto i wszystkie oceny — poprzedni dokument zostaje w historii wpisu.',
      'rg.flags.peselAdd': 'Dopisz numer PESEL',
      'rg.flags.identHistory': 'Historia tożsamości: {n}',
      'rg.flags.identHistoryTitle': 'Historia tożsamości',
      'rg.flags.identHistoryHint': 'Poprzednie numery i dokumenty zostają w księdze (§ 4). Wpisu nie da się zmienić — uwagę dopisuje się komentarzem obok.',
      'rg.flags.identEntry': '{date} · {what}',
      'rg.flags.saved': 'Zapisano flagi ucznia {name}.',
      'rg.flags.live': 'Zmiany flag zapisują się od razu i zostawiają wpis w rejestrze audytowym.',
      'rg.book.title': 'Księga uczniów {year}',
      'rg.book.caption': 'Księga uczniów szkoły',
      'rg.book.colNo': 'Nr księgi',
      'rg.book.colIdent': 'PESEL lub dokument tożsamości',
      'rg.book.passport': '{doc} (brak numeru PESEL)',
      'rg.book.colClass': 'Oddział',
      'rg.book.colActions': 'Akcje',
      'rg.book.transferred': 'Przeniesiony {date}',
      'rg.book.active': 'Aktywny',
      'rg.book.printTranscript': 'Drukuj odpis',
      'rg.book.printTranscriptAria': 'Drukuj odpis arkusza ocen – {name}',
      'rg.book.transfer': 'Przenieś',
      'rg.book.transferAria': 'Przenieś do innej szkoły – {name}',
      'rg.book.entries.one': '{n} wpis w księdze',
      'rg.book.entries.few': '{n} wpisy w księdze',
      'rg.book.entries.many': '{n} wpisów w księdze',
      'rg.book.closed.one': '{n} zamknięty z powodu przeniesienia',
      'rg.book.closed.few': '{n} zamknięte z powodu przeniesienia',
      'rg.book.closed.many': '{n} zamkniętych z powodu przeniesienia',

      'rg.tr.title': 'Przeniesienie do innej szkoły',
      'rg.tr.text': 'Wpis zostanie zamknięty z datą odejścia. Dane pozostaną w księdze uczniów zgodnie z okresem przechowywania 50 lat.',
      'rg.tr.date': 'Data przeniesienia',
      'rg.tr.school': 'Szkoła docelowa',
      'rg.tr.close': 'Zamknij wpis w księdze',
      'rg.tr.generate': 'Wygeneruj odpis arkusza ocen',
      'rg.tr.ready': 'Odpis gotowy',
      'rg.tr.readyTitle': 'Odpis arkusza ocen przygotowany',
      'rg.tr.readyText': 'Odpis zawiera oceny semestralne i frekwencję na dzień wystawienia. Wydaje się go za potwierdzeniem odbioru.',
      'rg.tr.needTranscript': 'Wpis można zamknąć po wygenerowaniu odpisu arkusza ocen.',

      'rg.id.title': 'Legitymacja cyfrowa (mObywatel)',
      'rg.id.sub': 'Legitymacja cyfrowa zastępuje mLegitymację i jest wydawana razem z jednorazowym kodem autoryzacyjnym.',
      'rg.id.issue': 'Wydaj legitymację',
      'rg.id.issued': 'Wydano · ważna do {date}',
      'rg.id.issuedToast': 'Wydano legitymację cyfrową.',
      'rg.id.codeLive': 'Kod autoryzacyjny {code} jest jednorazowy — przekaż go rodzicowi w sekretariacie.',
      'rg.id.count.one': '{n} ważna legitymacja cyfrowa.',
      'rg.id.count.few': '{n} ważne legitymacje cyfrowe.',
      'rg.id.count.many': '{n} ważnych legitymacji cyfrowych.',
      'rg.id.caption': 'Wydane legitymacje cyfrowe',
      'rg.id.colCode': 'Kod',
      'rg.id.colValidTo': 'Ważna do',

      'rg.dup.title': 'Duplikaty świadectw',
      'rg.dup.sub': 'Na każdym duplikacie drukowana jest adnotacja z datą wydania i numerem decyzji administracyjnej.',
      'rg.dup.legend': 'Świadectwa do powtórnego wydania',
      'rg.dup.hint': 'Nr księgi {no} · {cls}',
      'rg.dup.certName': 'Nazwa świadectwa',
      'rg.dup.decisionNo': 'Nr decyzji administracyjnej',
      'rg.dup.decisionHint': 'Numer z rejestru decyzji sekretariatu',
      'rg.dup.print': 'Drukuj duplikaty (z adnotacją)',
      'rg.dup.selected': 'Wybrano: {n}',
      'rg.dup.queuedTitle': 'Duplikaty w kolejce druku',
      'rg.dup.queuedToast': 'Duplikaty w kolejce druku.',
      'rg.dup.queuedLive': 'Skierowano do druku {n} duplikatów z adnotacją: „Duplikat · data wydania {date} · decyzja nr {no}”.',

      'rg.dist.title': 'Obowiązek przygotowania przedszkolnego',
      'rg.dist.sub': 'Dzieci z obwodu szkoły · rejestr obwodowy i kompletność zgłoszeń',
      'rg.dist.loading': 'Wczytywanie…',
      'rg.dist.completeness': 'Kompletność obwodu',
      'rg.dist.completenessHint': '{reported} z {total} dzieci ma potwierdzone zgłoszenie',
      'rg.dist.missing': 'Bez zgłoszenia',
      'rg.dist.missingHint': 'wymaga wezwania opiekunów',
      'rg.dist.summonedTile': 'Wezwania wysłane',
      'rg.dist.summonedHint': 'opiekunowie wezwani do wskazania placówki',
      'rg.dist.caption': 'Rejestr obwodowy · realizacja przygotowania przedszkolnego',
      'rg.dist.colChild': 'Dziecko z obwodu',
      'rg.dist.colYear': 'Rocznik',
      'rg.dist.colInstitution': 'Placówka realizująca obowiązek',
      'rg.dist.colReport': 'Zgłoszenie',
      'rg.dist.colComments': 'Komentarze',
      'rg.dist.reported': 'Zgłoszony',
      'rg.dist.summonedOn': 'Brak — wezwano {date}',
      'rg.dist.noReport': 'Brak zgłoszenia',
      'rg.dist.registered': 'Zarejestrowane',
      'rg.dist.registeredAria': 'Zgłoszenie zarejestrowane – {name}',
      'rg.dist.register': 'Zarejestruj',
      'rg.dist.registerAria': 'Zarejestruj zgłoszenie – {name}',
      'rg.dist.summon': 'Wezwij',
      'rg.dist.summonAria': 'Wezwij opiekunów – {name}',
      'rg.dist.reportLive': 'Zarejestrowano zgłoszenie: {name}. Kompletność obwodu: {pct}.',
      'rg.dist.summonLive': 'Wysłano wezwanie do opiekunów: {name}.',
      'rg.dist.live': 'Zaznaczone braki są podstawą wezwania opiekunów do wskazania placówki.'
    },
    en: {
      'rg.title': 'Registrar',
      'rg.sub': '{school} · school year {year} · as at {date}',
      'rg.loading': 'Loading the student register…',
      'rg.tabsLabel': 'Registrar sections',
      'rg.tab.book': 'Student register',
      'rg.tab.docs': 'Student IDs and duplicates',
      'rg.tab.district': 'Catchment register',
      'rg.popupBlocked': 'The browser blocked the new window — allow pop-ups to print the document.',

      'rg.pesel.idle': 'Eleven digits. The check digit, computed with the weights 1, 3, 7, 9, 1, 3, 7, 9, 1, 3, is verified as you type.',
      'rg.pesel.notDigit': 'Position {pos}: the character “{ch}” is not a digit. A PESEL number is 11 digits with no spaces or dashes.',
      'rg.pesel.short': '{got} of 11 digits entered; {left} to go. The check digit is verified after the last digit.',
      'rg.pesel.long': '{got} digits entered, but a PESEL number has 11. Remove the last {extra}.',
      'rg.pesel.checksum': 'Position 11 (check digit): {typed} was entered, but digits 1–10 give {expected}.',
      'rg.pesel.month': 'Positions 3–4 (“{raw}”) do not encode a month of birth. The allowed ranges are 01–12, 21–32, 41–52, 61–72, 81–92.',
      'rg.pesel.day': 'Positions 5–6 (“{raw}”) do not encode a day of the month: {month} {year} has {days} days.',
      'rg.pesel.mismatch': 'Positions 1–6 of the PESEL number give the date of birth {born}, while “Date of birth” says {typed}. Correct one of the fields.',
      'rg.pesel.ok': 'The number is valid: check digit {ctrl} matches, date of birth {born}, encoded sex {sex}.',
      'rg.sex.male': 'male',
      'rg.sex.female': 'female',
      'rg.monthOf.1': 'January', 'rg.monthOf.2': 'February', 'rg.monthOf.3': 'March', 'rg.monthOf.4': 'April', 'rg.monthOf.5': 'May', 'rg.monthOf.6': 'June',
      'rg.monthOf.7': 'July', 'rg.monthOf.8': 'August', 'rg.monthOf.9': 'September', 'rg.monthOf.10': 'October', 'rg.monthOf.11': 'November', 'rg.monthOf.12': 'December',

      'rg.new.title': 'New student',
      'rg.new.sub': 'Entry in the student register · school year {year} · next register number {no}',
      'rg.new.idDoc': 'Identity document',
      'rg.new.peselOpt': 'PESEL',
      'rg.new.peselOptHint': 'A student with a PESEL (national identification) number',
      'rg.new.passportOpt': 'Other document (passport, residence card)',
      'rg.new.passportOptHint': 'A pupil with no PESEL number, e.g. arriving from abroad (§ 4 of the records regulation)',
      'rg.new.docType': 'Document type',
      'rg.new.docTypeHint': 'The document type and number replace the PESEL number in the register.',
      'rg.doc.passport': 'Passport',
      'rg.doc.residence-card': 'Residence card',
      'rg.doc.other': 'Other identity document',
      'rg.doc.missing': 'no PESEL number and no document',
      'rg.new.lastName': 'Last name',
      'rg.new.firstName': 'First name',
      'rg.new.passportNo': 'Document number',
      'rg.new.passportHint': 'At least 6 characters; type, number and country of issue all go into the SIO package.',
      'rg.new.country': 'Country of issue',
      'rg.country.UA': 'Ukraine',
      'rg.country.BY': 'Belarus',
      'rg.country.DE': 'Germany',
      'rg.country.XX': 'Other',
      'rg.new.birthDate': 'Date of birth',
      'rg.new.birthDateHintPesel': 'Checked against positions 1–6 of the PESEL number',
      'rg.new.birthDateHintPassport': 'Required with a foreign document',
      'rg.new.birthPlace': 'Place of birth',
      'rg.new.birthPlaceHint': 'Printed on the certificate as “w Krakowie” (locative case)',
      'rg.new.class': 'Class',
      'rg.new.parents': 'Details of parents and legal guardians',
      'rg.new.mother': 'Mother or legal guardian',
      'rg.new.father': 'Father or legal guardian',
      'rg.new.phone': 'Contact phone',
      'rg.new.email': 'E-mail address for the parent account',
      'rg.new.address': 'Student’s home address',
      'rg.new.submit': 'Enter in the register',
      'rg.new.notReady': 'The button unlocks once the last name, first name, date and place of birth and the guardian details are filled in, and the identity document passes validation.',
      'rg.new.savedLive': '{message} {name}, class {cls}.',
      'rg.new.savedToast': 'Entered in the register under number {no}.',
      'rg.new.passportOk': 'Document accepted',
      'rg.new.passportTodo': 'Complete the identity document',
      'rg.new.checksumOk': 'Checksum matches',
      'rg.new.numberBad': 'Number is invalid',
      'rg.new.todo': 'To be completed',

      'rg.gu.title': 'Guardians and access scope',
      'rg.gu.sub': 'The scope is a pair (guardian, child): the same parent can hold full access for one child and information-only for another. The entry on the pupil takes precedence over the account default.',
      'rg.gu.caption': 'A pupil’s guardians and their access scope',
      'rg.gu.colGuardian': 'Guardian',
      'rg.gu.colScope': 'Access scope',
      'rg.gu.colBasis': 'Note on this entry',
      'rg.gu.colActions': 'Actions',
      'rg.gu.scope': 'Access scope — {name}',
      'rg.gu.basis': 'Note on this entry — {name}',
      'rg.gu.basisPh': 'e.g. “the mother’s request of 12.10.2026, received at the office”',
      'rg.gu.basisHint': 'The basis kind and the reference go in the column next to this one; here, say where the entry came from.',
      'rg.gu.statusHelp': 'Parental authority is the right to decide about the child. Limiting it does not by itself cut off the right to information about schooling and attendance — access narrows only when a court says so, or when the office overrides the scope by hand. Depriving a parent of authority, and a court-ordered restriction, are recorded on a court order with its reference; lifting either needs a fresh document.',
      'rg.gu.save': 'Save the scope',
      'rg.gu.saveAria': 'Save the scope — {name}',
      'rg.gu.saveWhy': 'The button unlocks once the basis for the change is filled in (the last column).',
      'rg.gu.saveWhyBasis': 'Lifting a court-ordered restriction needs a basis kind and the document reference.',
      'rg.gu.scope.full': 'full — grades, remarks, homework, attendance',
      'rg.gu.scope.info': 'information — attendance, timetable, messages, no grades',
      'rg.gu.scope.none': 'none — access to the child’s data is suspended',
      'rg.gu.perChild': 'set on this pupil',
      'rg.gu.fromAccount': 'account default',
      'rg.gu.none': 'This pupil has no guardian attached yet — the registration code is waiting to be collected.',
      'rg.gu.saved': 'Scope of {name} for {student}: {scope}.',
      'rg.gu.live': 'Guardians attached: {n}.',
      'rg.gu.loading': 'Loading guardians…',
      'rg.gu.colStatus': 'Parental authority and its basis',
      'rg.gu.status': 'Parental authority status — {name}',
      'rg.gu.status.full': 'full',
      'rg.gu.status.limited': 'limited (the right to information stays)',
      'rg.gu.status.deprived': 'deprived of parental authority',
      'rg.gu.status.court-restricted': 'restricted by a court order as to information',
      'rg.gu.basisKind': 'Kind of basis — {name}',
      'rg.gu.basisKind.': '— not given —',
      'rg.gu.basisKind.court-order': 'court order',
      'rg.gu.basisKind.declaration': 'guardian declaration',
      'rg.gu.basisRef': 'Case or document reference — {name}',
      'rg.gu.basisRefPh': 'e.g. III Nsm 88/26',
      'rg.gu.basisDate': 'Date of the basis — {name}',
      'rg.gu.derived': 'The status gives the scope: {scope}',
      'rg.gu.override': 'Override the scope by hand',
      'rg.gu.overrideAria': 'Override the scope by hand — guardian {name}',
      'rg.gu.courtNeeded': 'This status needs a court order with a reference.',
      'rg.gu.adultTitle': 'Adult pupil — guardian access',
      'rg.gu.adultSince': 'An adult since {date}.',
      'rg.gu.rule.until-objection': 'School rule: guardians keep access to an adult pupil’s data until the pupil files an objection.',
      'rg.gu.rule.consent-required': 'School rule: from the 18th birthday guardians see nothing until the pupil gives consent.',
      'rg.gu.access.open': 'Guardians see what their recorded scope allows.',
      'rg.gu.access.blocked': 'The pupil filed an objection — guardian accounts have no access.',
      'rg.gu.access.pending-consent': 'The pupil has not recorded consent yet — guardian accounts have no access.',
      'rg.flags.adultRule': 'Guardian access to an adult pupil’s data',

      'rg.flags.title': 'Pupil flags',
      'rg.flags.sub': 'Social welfare turns on the counsellor’s alert after three days of absence with no word from a guardian. Adulthood decides who may excuse an absence.',
      'rg.flags.welfare': 'Pupil under social welfare',
      'rg.flags.welfareHint': 'Turns on the three-day attendance alert for the counsellor.',
      'rg.flags.adult': 'Pupil of age',
      'rg.flags.selfExcuse': 'Excuses their own absences',
      'rg.flags.selfExcuseHint': 'Available only once the pupil is marked as of age.',
      'rg.flags.parentBlocked': 'Adult pupil objects to guardian access',
      'rg.flags.nationality': 'Citizenship',
      'rg.flags.identityKind': 'Identity document',
      'rg.flags.ident.pesel': 'PESEL',
      'rg.flags.ident.passport': 'Other document (passport, residence card)',
      'rg.flags.docLegend': 'The pupil’s identity document',
      'rg.flags.docSave': 'Save the document', 'rg.flags.docCancel': 'Cancel',
      'rg.flags.docWhy': 'The kind, the number and the issuing country code are all required — without them the pupil register will not take the entry (§ 4 of the records regulation).',
      'rg.flags.peselLegend': 'A PESEL number assigned during the year',
      'rg.flags.peselSave': 'Save the PESEL',
      'rg.flags.peselHint': 'A pupil who receives a PESEL number after being entered in the register keeps their register number, their account and every grade — the previous document stays in the entry’s history.',
      'rg.flags.peselAdd': 'Add a PESEL number',
      'rg.flags.identHistory': 'Identity history: {n}',
      'rg.flags.identHistoryTitle': 'Identity history',
      'rg.flags.identHistoryHint': 'Previous numbers and documents stay in the register (§ 4). The entry cannot be changed — a remark goes beside it as a comment.',
      'rg.flags.identEntry': '{date} · {what}',
      'rg.flags.saved': 'Flags saved for {name}.',
      'rg.flags.live': 'A flag change is saved at once and leaves a row in the audit log.',
      'rg.book.title': 'Student register {year}',
      'rg.book.caption': 'The school’s student register',
      'rg.book.colNo': 'Register no.',
      'rg.book.colIdent': 'PESEL or identity document',
      'rg.book.passport': '{doc} (no PESEL number)',
      'rg.book.colClass': 'Class',
      'rg.book.colActions': 'Actions',
      'rg.book.transferred': 'Transferred {date}',
      'rg.book.active': 'Active',
      'rg.book.printTranscript': 'Print the transcript',
      'rg.book.printTranscriptAria': 'Print the transcript of records – {name}',
      'rg.book.transfer': 'Transfer',
      'rg.book.transferAria': 'Transfer to another school – {name}',
      'rg.book.entries.one': '{n} entry in the register',
      'rg.book.entries.other': '{n} entries in the register',
      'rg.book.closed.one': '{n} closed on transfer',
      'rg.book.closed.other': '{n} closed on transfer',

      'rg.tr.title': 'Transfer to another school',
      'rg.tr.text': 'The entry will be closed with the date of leaving. The data stays in the student register for the statutory retention period of 50 years.',
      'rg.tr.date': 'Date of transfer',
      'rg.tr.school': 'Receiving school',
      'rg.tr.close': 'Close the register entry',
      'rg.tr.generate': 'Generate the transcript of records',
      'rg.tr.ready': 'Transcript ready',
      'rg.tr.readyTitle': 'Transcript of records prepared',
      'rg.tr.readyText': 'The transcript holds the semester grades and the attendance as at the day of issue. It is handed over against a receipt.',
      'rg.tr.needTranscript': 'The entry can be closed once the transcript of records has been generated.',

      'rg.id.title': 'Digital student ID (mObywatel, the national mobile-ID app)',
      'rg.id.sub': 'The digital student ID replaces the mLegitymacja card and is issued together with a one-time authorisation code.',
      'rg.id.issue': 'Issue the ID',
      'rg.id.issued': 'Issued · valid until {date}',
      'rg.id.issuedToast': 'Digital student ID issued.',
      'rg.id.codeLive': 'The authorisation code {code} is single-use — hand it to the parent at the school office.',
      'rg.id.count.one': '{n} valid digital student ID.',
      'rg.id.count.other': '{n} valid digital student IDs.',
      'rg.id.caption': 'Digital student IDs issued',
      'rg.id.colCode': 'Code',
      'rg.id.colValidTo': 'Valid until',

      'rg.dup.title': 'Duplicate certificates',
      'rg.dup.sub': 'Every duplicate is printed with an annotation carrying the date of issue and the number of the administrative decision.',
      'rg.dup.legend': 'Certificates to be reissued',
      'rg.dup.hint': 'Register no. {no} · {cls}',
      'rg.dup.certName': 'Name of the certificate',
      'rg.dup.decisionNo': 'Administrative decision no.',
      'rg.dup.decisionHint': 'The number from the school office’s register of decisions',
      'rg.dup.print': 'Print the duplicates (with the annotation)',
      'rg.dup.selected': 'Selected: {n}',
      'rg.dup.queuedTitle': 'Duplicates queued for printing',
      'rg.dup.queuedToast': 'Duplicates queued for printing.',
      'rg.dup.queuedLive': '{n} duplicates sent to the printer with the annotation “Duplikat · date of issue {date} · decision no. {no}”.',

      'rg.dist.title': 'Compulsory pre-school preparation',
      'rg.dist.sub': 'Children from the school catchment area · catchment register and completeness of the returns',
      'rg.dist.loading': 'Loading…',
      'rg.dist.completeness': 'Catchment completeness',
      'rg.dist.completenessHint': '{reported} of {total} children have a confirmed return',
      'rg.dist.missing': 'No return',
      'rg.dist.missingHint': 'the guardians have to be summoned',
      'rg.dist.summonedTile': 'Summonses sent',
      'rg.dist.summonedHint': 'guardians asked to name the institution',
      'rg.dist.caption': 'Catchment register · delivery of pre-school preparation',
      'rg.dist.colChild': 'Child from the catchment area',
      'rg.dist.colYear': 'Year of birth',
      'rg.dist.colInstitution': 'Institution delivering the obligation',
      'rg.dist.colReport': 'Return',
      'rg.dist.colComments': 'Comments',
      'rg.dist.reported': 'Returned',
      'rg.dist.summonedOn': 'Missing — summoned {date}',
      'rg.dist.noReport': 'No return',
      'rg.dist.registered': 'Registered',
      'rg.dist.registeredAria': 'Return registered – {name}',
      'rg.dist.register': 'Register',
      'rg.dist.registerAria': 'Register the return – {name}',
      'rg.dist.summon': 'Summon',
      'rg.dist.summonAria': 'Summon the guardians – {name}',
      'rg.dist.reportLive': 'Return registered: {name}. Catchment completeness: {pct}.',
      'rg.dist.summonLive': 'A summons was sent to the guardians: {name}.',
      'rg.dist.live': 'The gaps marked here are the basis for summoning the guardians to name an institution.'
    }
  });

  var PESEL_W = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  var BANDS = [[1, 12, 1900], [21, 32, 2000], [41, 52, 2100], [61, 72, 2200], [81, 92, 1800]];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Ta sama reguła co util.validatePesel na serwerze — tu liczona przy każdym znaku, żeby wskazać pozycję cyfry. */
  function checkPesel(raw, birthDate) {
    var s = String(raw == null ? '' : raw).trim(), i;
    if (s === '') return { tone: 'idle', msg: A.t('rg.pesel.idle') };
    for (i = 0; i < s.length; i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return { tone: 'error', msg: A.t('rg.pesel.notDigit', { pos: i + 1, ch: s.charAt(i) }) };
    if (s.length < 11) return { tone: 'partial', msg: A.t('rg.pesel.short', { got: s.length, left: 11 - s.length }) };
    if (s.length > 11) return { tone: 'error', msg: A.t('rg.pesel.long', { got: s.length, extra: s.length - 11 }) };
    var sum = 0; for (i = 0; i < 10; i++) sum += PESEL_W[i] * (+s.charAt(i));
    var ctrl = (10 - (sum % 10)) % 10, typed = +s.charAt(10);
    if (ctrl !== typed) return { tone: 'error', msg: A.t('rg.pesel.checksum', { typed: typed, expected: ctrl }) };
    var yy = +s.slice(0, 2), mmRaw = +s.slice(2, 4), dd = +s.slice(4, 6), month = null, century = null, b;
    for (b = 0; b < BANDS.length; b++) if (mmRaw >= BANDS[b][0] && mmRaw <= BANDS[b][1]) { month = mmRaw - (BANDS[b][0] - 1); century = BANDS[b][2]; }
    if (month === null) return { tone: 'error', msg: A.t('rg.pesel.month', { raw: s.slice(2, 4) }) };
    var year = century + yy, dim = new Date(year, month, 0).getDate();
    if (dd < 1 || dd > dim) return { tone: 'error', msg: A.t('rg.pesel.day', { raw: s.slice(4, 6), month: A.t('rg.monthOf.' + month), year: year, days: dim }) };
    var born = year + '-' + pad2(month) + '-' + pad2(dd);
    if (birthDate && birthDate !== born) return { tone: 'error', born: born, msg: A.t('rg.pesel.mismatch', { born: A.fmtDate(born), typed: A.fmtDate(birthDate) }) };
    return { tone: 'ok', born: born, msg: A.t('rg.pesel.ok', { ctrl: ctrl, born: A.fmtDate(born), sex: A.t((+s.charAt(9)) % 2 ? 'rg.sex.male' : 'rg.sex.female') }) };
  }

  /* R7 — dokument tożsamości ucznia bez numeru PESEL: rodzaje i jeden podpis do tabeli/kart. */
  var DOC_TYPES = ['passport', 'residence-card', 'other'];
  function docLabel(doc) {
    if (!doc || !doc.number) return A.t('rg.doc.missing');
    return A.t('rg.doc.' + (DOC_TYPES.indexOf(doc.type) >= 0 ? doc.type : 'other')) + ' ' + doc.number + (doc.country ? ' (' + doc.country + ')' : '');
  }

  /** Otwiera dokument do druku (HTML z serwera) w nowej karcie. */
  function openPrint(html) {
    var w = window.open('', '_blank');
    if (!w) { A.toast(A.t('rg.popupBlocked'), 'danger'); return; }
    w.document.open(); w.document.write(html); w.document.close(); w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 300);
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  /* U3-28 — jedyny inny nagłówek na tym ekranie to `h1`, więc karta musi być `h2`: inaczej nawigacja
     po nagłówkach przeskakuje poziom przy każdej karcie (axe `heading-order`). */
  function Card(p) {
    return h('section', { className: 'card' + (p.className ? ' ' + p.className : ''), 'aria-labelledby': p.id },
      p.title && h('h2', { id: p.id, className: 'heading' }, p.title),
      p.sub && h('p', { className: 'muted' }, p.sub),
      h('div', { className: 'stack' }, p.children));
  }
  function Live(p) { return h('p', { className: 'muted', role: 'status' }, p.children); }

  /* ------------------------------------------------------------------ nowy uczeń (3.5.1) */
  function NowyUczen(p) {
    /* R7 — uczeń bez numeru PESEL legitymuje się dokumentem: rodzaj + numer + kraj wydania. */
    var s0 = React.useState({ identityKind: 'pesel', documentType: 'passport', firstName: '', lastName: '', pesel: '', passport: '', passportCountry: 'UA', birthDate: '', birthPlace: 'Kraków', classId: (p.classes[0] || {}).id || '', mother: '', father: '', phone: '', email: '', address: '' });
    var f = s0[0], setF = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var s2 = React.useState(false), busy = s2[0], setBusy = s2[1];
    function set(k) { return function (e) { var v = e && e.target ? e.target.value : e; setF(function (prev) { var n = Object.assign({}, prev); n[k] = v; return n; }); }; }

    var st = checkPesel(f.pesel, f.birthDate);
    var identOk = f.identityKind === 'pesel' ? st.tone === 'ok' : (f.passport.trim().length >= 6 && !!f.passportCountry.trim() && !!f.birthDate);
    var ready = identOk && f.firstName.trim() && f.lastName.trim() && f.birthPlace.trim() && f.classId && (f.mother.trim() || f.father.trim());

    function submit() {
      setBusy(true);
      var body = Object.assign({}, f, { birthDate: f.identityKind === 'pesel' ? (st.born || f.birthDate) : f.birthDate });
      if (f.identityKind === 'passport') body.identityDocument = { type: f.documentType, number: f.passport.trim(), country: f.passportCountry.trim() };
      A.api.post('/api/registry/students', body).then(function (r) {
        setSaid(A.t('rg.new.savedLive', { message: r.message, name: r.student.lastName + ' ' + r.student.firstName, cls: r.student.classId }));
        A.toast(A.t('rg.new.savedToast', { no: r.registerNo }), 'success');
        setF(Object.assign({}, f, { firstName: '', lastName: '', pesel: '', passport: '', birthDate: '', mother: '', father: '', phone: '', email: '', address: '' }));
        p.onSaved();
      }).catch(function (err) { setSaid(err.message); A.toast(err.message, 'danger'); }).then(function () { setBusy(false); });
    }

    var badge = f.identityKind === 'passport'
      ? h(E.Badge, { tone: identOk ? 'success' : 'outline', icon: identOk ? 'check' : 'info' }, A.t(identOk ? 'rg.new.passportOk' : 'rg.new.passportTodo'))
      : st.tone === 'ok' ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('rg.new.checksumOk'))
        : st.tone === 'error' ? h(E.Badge, { tone: 'danger', icon: 'alert-circle' }, A.t('rg.new.numberBad'))
          : h(E.Badge, { tone: 'outline', icon: 'info' }, A.t('rg.new.todo'));

    return h(Card, { id: 'nowy-uczen', title: A.t('rg.new.title'), sub: A.t('rg.new.sub', { year: p.year, no: p.nextRegisterNo }) },
      h(E.RadioGroup, {
        legend: A.t('rg.new.idDoc'), row: true, value: f.identityKind, onChange: set('identityKind'),
        options: [{ value: 'pesel', label: A.t('rg.new.peselOpt'), hint: A.t('rg.new.peselOptHint') }, { value: 'passport', label: A.t('rg.new.passportOpt'), hint: A.t('rg.new.passportOptHint') }]
      }),
      h('div', { className: 'grid-3' },
        h(E.TextField, { label: A.t('rg.new.lastName'), required: true, value: f.lastName, onChange: set('lastName') }),
        h(E.TextField, { label: A.t('rg.new.firstName'), required: true, value: f.firstName, onChange: set('firstName') }),
        f.identityKind === 'pesel'
          ? h(E.TextField, { label: 'PESEL', mono: true, required: true, inputMode: 'numeric', maxLength: 11, autoComplete: 'off', value: f.pesel, onChange: set('pesel'), error: st.tone === 'error' ? st.msg : undefined, hint: st.tone === 'error' ? undefined : st.msg })
          : h(E.TextField, { label: A.t('rg.new.passportNo'), mono: true, required: true, value: f.passport, placeholder: 'EA1234567', onChange: set('passport'), hint: A.t('rg.new.passportHint') }),
        f.identityKind === 'passport' && h(E.Select, { label: A.t('rg.new.docType'), required: true, value: f.documentType, onChange: set('documentType'), hint: A.t('rg.new.docTypeHint'), options: DOC_TYPES.map(function (t) { return { value: t, label: A.t('rg.doc.' + t) }; }) }),
        f.identityKind === 'passport' && h(E.Select, { label: A.t('rg.new.country'), required: true, value: f.passportCountry, onChange: set('passportCountry'), options: ['UA', 'BY', 'DE', 'XX'].map(function (c) { return { value: c, label: A.t('rg.country.' + c) }; }) }),
        h(E.TextField, Object.assign({ label: A.t('rg.new.birthDate'), type: 'date', required: true, value: f.birthDate, onChange: set('birthDate'), hint: A.t(f.identityKind === 'pesel' ? 'rg.new.birthDateHintPesel' : 'rg.new.birthDateHintPassport') + ' · ' + A.dateHint(f.birthDate) }, A.dateInputProps())),
        h(E.TextField, { label: A.t('rg.new.birthPlace'), required: true, value: f.birthPlace, onChange: set('birthPlace'), hint: A.t('rg.new.birthPlaceHint') }),
        h(E.Select, { label: A.t('rg.new.class'), value: f.classId, onChange: set('classId'), options: p.classes.map(function (c) { return { value: c.id, label: c.name }; }) })),
      h('p', { className: 'body-strong' }, A.t('rg.new.parents')),
      h('div', { className: 'grid-3' },
        h(E.TextField, { label: A.t('rg.new.mother'), required: true, value: f.mother, onChange: set('mother') }),
        h(E.TextField, { label: A.t('rg.new.father'), value: f.father, onChange: set('father') }),
        h(E.TextField, { label: A.t('rg.new.phone'), inputMode: 'tel', value: f.phone, onChange: set('phone') }),
        h(E.TextField, { label: A.t('rg.new.email'), type: 'email', value: f.email, onChange: set('email') }),
        h(E.TextField, { label: A.t('rg.new.address'), value: f.address, onChange: set('address') })),
      h('div', { className: 'row' }, badge, h(E.Button, { variant: 'primary', icon: 'plus', disabled: !ready || busy, loading: busy, onClick: submit }, A.t('rg.new.submit'))),
      !ready && h('p', { className: 'muted' }, A.t('rg.new.notReady')),
      h(Live, null, said));
  }

  /* ----------------------------------------------------- księga i przeniesienie (3.5.8) */
  function Ksiega(p) {
    var s0 = React.useState(null), target = s0[0], setTarget = s0[1];
    var s1 = React.useState({ date: p.today, school: '', reason: '', transcript: false }), tf = s1[0], setT = s1[1];
    var s2 = React.useState(''), said = s2[0], setSaid = s2[1];

    function open(row) { setTarget(row); setT({ date: p.today, school: '', reason: '', transcript: false }); }
    function transcript(row) { A.api.get('/api/registry/students/' + row.id + '/transcript').then(openPrint).catch(function (e) { A.toast(e.message, 'danger'); }); }
    function doTransfer() {
      A.api.post('/api/registry/students/' + target.id + '/transfer', { date: tf.date, school: tf.school.trim(), reason: tf.reason.trim() }).then(function (r) {
        setSaid(r.message); A.toast(r.message, 'success'); setTarget(null); p.onSaved();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }

    var columns = [
      { key: 'registerNo', title: A.t('rg.book.colNo'), num: true, render: function (r) { return h('span', { className: 'code' }, r.registerNo); } },
      { key: 'name', title: A.t('common.student'), render: function (r) { return r.lastName + ' ' + r.firstName; } },
      /* R7: uczeń bez numeru PESEL pokazuje rodzaj, numer i kraj dokumentu — nigdy puste pole. */
      { key: 'ident', title: A.t('rg.book.colIdent'), render: function (r) { return h('span', { className: 'code' }, r.pesel || A.t('rg.book.passport', { doc: docLabel(r.identityDocument) })); } },
      { key: 'classId', title: A.t('rg.book.colClass') },
      { key: 'status', title: A.t('common.status'), render: function (r) {
        return r.status === 'transferred'
          ? h(E.Badge, { tone: 'outline', icon: 'log-out' }, A.t('rg.book.transferred', { date: A.fmtDate(r.departureDate) }))
          : h(E.Badge, { tone: 'success', icon: 'check' }, A.t('rg.book.active'));
      } },
      { key: 'akcje', title: A.t('rg.book.colActions'), render: function (r) {
        return h('div', { className: 'ed-row-actions' }, r.status === 'transferred'
          ? h(E.Button, { size: 'sm', icon: 'print', variant: 'quiet', 'aria-label': A.t('rg.book.printTranscriptAria', { name: r.lastName + ' ' + r.firstName }), onClick: function () { transcript(r); } }, A.t('rg.book.printTranscript'))
          : h(E.Button, { size: 'sm', icon: 'log-out', 'aria-label': A.t('rg.book.transferAria', { name: r.lastName + ' ' + r.firstName }), onClick: function () { open(r); } }, A.t('rg.book.transfer')));
      } }
    ];
    var closed = p.students.filter(function (r) { return r.status === 'transferred'; }).length;

    return h(Card, { id: 'ksiega', title: A.t('rg.book.title', { year: p.year }) },
      h(E.Table, { caption: A.t('rg.book.caption'), hideCaption: true, columns: columns, rows: p.students.map(function (r) { return Object.assign({ id: r.id }, r); }) }),
      h(Live, null, said || (A.plural(p.students.length, 'rg.book.entries') + ' · ' + A.plural(closed, 'rg.book.closed') + '.')),
      target && h(E.Dialog, {
        title: A.t('rg.tr.title'), onClose: function () { setTarget(null); },
        actions: [h(E.Button, { key: 'x', variant: 'secondary', onClick: function () { setTarget(null); } }, A.t('common.cancel')),
          h(E.Button, { key: 'ok', variant: 'primary', disabled: !tf.date || !tf.school.trim() || !tf.transcript, onClick: doTransfer }, A.t('rg.tr.close'))]
      },
        h('p', null, target.registerNo + ' · ' + target.lastName + ' ' + target.firstName + ' · ' + target.classId),
        h('p', null, A.t('rg.tr.text')),
        h('div', { className: 'grid-2' },
          h(E.TextField, Object.assign({ label: A.t('rg.tr.date'), type: 'date', required: true, value: tf.date, 'data-autofocus': true, onChange: function (e) { var v = e.target.value; setT(function (x) { return Object.assign({}, x, { date: v }); }); }, hint: A.dateHint(tf.date) }, A.dateInputProps())),
          h(E.TextField, { label: A.t('rg.tr.school'), required: true, value: tf.school, onChange: function (e) { var v = e.target.value; setT(function (x) { return Object.assign({}, x, { school: v }); }); } })),
        h(E.TextField, { label: A.t('common.reason'), value: tf.reason, onChange: function (e) { var v = e.target.value; setT(function (x) { return Object.assign({}, x, { reason: v }); }); } }),
        h('div', { className: 'row' },
          h(E.Button, { icon: 'file', onClick: function () { transcript(target); setT(function (x) { return Object.assign({}, x, { transcript: true }); }); } }, A.t('rg.tr.generate')),
          tf.transcript && h(E.Badge, { tone: 'success', icon: 'check' }, A.t('rg.tr.ready'))),
        tf.transcript
          ? h(E.Alert, { tone: 'success', title: A.t('rg.tr.readyTitle') }, A.t('rg.tr.readyText'))
          : h('p', { className: 'muted' }, A.t('rg.tr.needTranscript'))));
  }

  /* --------------------------------------------------------- legitymacja cyfrowa (3.5.2) */
  function Legitymacja(p) {
    var active = p.students.filter(function (s) { return s.status !== 'transferred'; });
    var s0 = React.useState(''), who = s0[0], setWho = s0[1];
    var s1 = React.useState(null), issued = s1[0], setIssued = s1[1];
    var ids = A.useApi('/api/registry/student-ids', [p.version]);
    React.useEffect(function () { if (!who && active.length) setWho(active[0].id); }, [p.students.length]);

    function issue() {
      A.api.post('/api/registry/students/' + who + '/student-id').then(function (r) {
        setIssued(r); A.toast(A.t('rg.id.issuedToast'), 'success'); ids.reload();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var current = (ids.data ? ids.data.studentIds : []).filter(function (x) { return x.status === 'issued'; });
    return h(Card, { id: 'legitymacja', title: A.t('rg.id.title'), sub: A.t('rg.id.sub') },
      h(E.Select, { label: A.t('common.student'), value: who, onChange: function (e) { setWho(e.target.value); setIssued(null); }, options: active.map(function (s) { return { value: s.id, label: s.registerNo + ' · ' + s.lastName + ' ' + s.firstName + ' · ' + s.classId }; }) }),
      h('div', { className: 'row' },
        h(E.Button, { icon: 'barcode', onClick: issue }, A.t('rg.id.issue')),
        issued && h(E.Badge, { tone: 'success', icon: 'check' }, A.t('rg.id.issued', { date: A.fmtDate(issued.validTo) }))),
      issued && h('p', { className: 'code', style: { fontSize: '1.25rem', letterSpacing: '0.1em' } }, issued.code),
      h(Live, null, issued ? A.t('rg.id.codeLive', { code: issued.code }) : A.plural(current.length, 'rg.id.count')),
      current.length > 0 && h(E.Table, {
        caption: A.t('rg.id.caption'), hideCaption: true,
        columns: [{ key: 'student', title: A.t('common.student') }, { key: 'code', title: A.t('rg.id.colCode'), render: function (r) { return h('span', { className: 'code' }, r.code); } }, { key: 'validTo', title: A.t('rg.id.colValidTo'), render: function (r) { return A.fmtDate(r.validTo); } }],
        rows: current.slice(0, 6).map(function (x) { return Object.assign({ id: x.id }, x); })
      }));
  }

  /* ------------------------------------------------------------- duplikaty świadectw (3.5.10) */
  function Duplikaty(p) {
    var s0 = React.useState({}), sel = s0[0], setSel = s0[1];
    var s1 = React.useState('SO.4424.17.2026'), nr = s1[0], setNr = s1[1];
    /* Nazwa świadectwa trafia na polski dokument urzędowy — domyślna wartość pozostaje po polsku. */
    var s2 = React.useState('świadectwo ukończenia klasy 6'), cert = s2[0], setCert = s2[1];
    var s3 = React.useState(''), said = s3[0], setSaid = s3[1];
    var active = p.students.filter(function (s) { return s.status !== 'transferred'; }).slice(0, 8);
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });

    function print() {
      A.api.post('/api/registry/duplicates/print', { studentIds: ids, decisionNo: nr.trim(), certificate: cert.trim(), issueDate: p.today }).then(function (html) {
        openPrint(html);
        setSaid(A.t('rg.dup.queuedLive', { n: ids.length, date: A.fmtDate(p.today), no: nr.trim() }));
        A.toast(A.t('rg.dup.queuedToast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    return h(Card, { id: 'duplikaty', title: A.t('rg.dup.title'), sub: A.t('rg.dup.sub') },
      h('fieldset', { style: { border: 0, margin: 0, padding: 0 } },
        h('legend', { className: 'muted' }, A.t('rg.dup.legend')),
        h('div', { className: 'stack', style: { gap: 'var(--space-2)' } }, active.map(function (s) {
          return h(E.Checkbox, { key: s.id, label: s.lastName + ' ' + s.firstName, hint: A.t('rg.dup.hint', { no: s.registerNo, cls: s.classId }), checked: !!sel[s.id],
            onChange: function (e) { var v = e.target.checked; setSel(function (prev) { var n = Object.assign({}, prev); n[s.id] = v; return n; }); setSaid(''); } });
        }))),
      h('div', { className: 'grid-2' },
        h(E.TextField, { label: A.t('rg.dup.certName'), value: cert, onChange: function (e) { setCert(e.target.value); } }),
        h(E.TextField, { label: A.t('rg.dup.decisionNo'), mono: true, required: true, value: nr, onChange: function (e) { setNr(e.target.value); }, hint: A.t('rg.dup.decisionHint') })),
      h('div', { className: 'row' },
        h(E.Button, { icon: 'print', disabled: !ids.length || !nr.trim(), onClick: print }, A.t('rg.dup.print')),
        h(E.Badge, { tone: ids.length ? 'brand' : 'outline' }, A.t('rg.dup.selected', { n: ids.length }))),
      said ? h(E.Alert, { tone: 'success', title: A.t('rg.dup.queuedTitle') }, said) : null,
      h('p', { className: 'ed-sr', role: 'status' }, said));
  }

  /* ------------------------------- GAP-3: zakres dostępu opiekuna przy JEDNYM dziecku (REG-17) */
  function Opiekunowie(p) {
    var active = p.students.filter(function (s) { return s.status !== 'transferred'; });
    var s0 = React.useState(''), who = s0[0], setWho = s0[1];
    var s1 = React.useState({}), draft = s1[0], setDraft = s1[1];
    var s2 = React.useState(''), said = s2[0], setSaid = s2[1];
    React.useEffect(function () { if (!who && active.length) setWho(active[0].id); }, [p.students.length]);
    var api = A.useApi(who ? '/api/registry/students/' + who + '/guardians' : null, [who, p.version]);
    var d = api.data;
    /* R3: zakres wynika ze statusu władzy rodzicielskiej, dopóki sekretariat go nie nadpisze. */
    var STATUS_SCOPE = (d && d.statusScopes) || { full: 'full', limited: 'full', deprived: 'none', 'court-restricted': 'info' };
    var STATUSES = (d && d.statuses) || ['full', 'limited', 'deprived', 'court-restricted'];
    var BASIS_KINDS = (d && d.basisKinds) || ['court-order', 'declaration'];
    /* U3-10 — `legalBasis` startowało puste, więc „Zapisz zakres” było martwe przy KAŻDYM opiekunie
       (przycisk `disabled` wypada z kolejności tabulacji, więc przejście klawiaturą kończyło się
       niczym), a zapisana wcześniej podstawa świeciła wyłącznie jako podpowiedź pod polem — zmiana
       statusu znaczyła przepisanie jej z podpowiedzi. Startujemy od tego, co jest w księdze. */
    function blank(g) {
      return { status: g.guardianStatus || 'full', accessScope: g.accessScope, override: g.scopeSource === 'explicit',
        basisKind: (g.basis && g.basis.kind) || '', basisRef: (g.basis && g.basis.reference) || '', basisDate: (g.basis && g.basis.date) || '',
        legalBasis: g.legalBasis || '' };
    }
    /* Zdjęcie ograniczenia orzeczonego przez sąd wymaga świeżego dokumentu (S3-10) — mówimy to
       przy przycisku, zamiast pozwolić serwerowi odpowiedzieć czerwonym komunikatem. */
    var COURT = ['deprived', 'court-restricted'];
    function why(g) {
      var e = entry(g);
      if (!e.legalBasis.trim()) return A.t('rg.gu.saveWhy');
      if (COURT.indexOf(g.guardianStatus) >= 0 && COURT.indexOf(e.status) < 0 && !(e.basisKind && e.basisRef.trim())) return A.t('rg.gu.saveWhyBasis');
      return null;
    }
    function entry(g) { return draft[g.userId] || blank(g); }
    function setEntry(g, k, v) {
      setDraft(function (prev) { var n = Object.assign({}, prev); n[g.userId] = Object.assign(blank(g), n[g.userId]); n[g.userId][k] = v; return n; });
    }
    var derived = function (status) { return STATUS_SCOPE[status] || 'full'; };
    var scopeOf = function (e) { return e.override ? e.accessScope : derived(e.status); };
    function save(g) {
      var e = entry(g);
      var body = { status: e.status, legalBasis: e.legalBasis.trim(),
        basis: { kind: e.basisKind || null, reference: e.basisRef.trim(), date: e.basisDate || null } };
      if (e.override) body.accessScope = e.accessScope;
      A.api.patch('/api/registry/students/' + who + '/guardians/' + g.userId, body)
        .then(function (r) {
          setDraft(function (prev) { var n = Object.assign({}, prev); delete n[g.userId]; return n; });
          setSaid(A.t('rg.gu.saved', { name: r.guardian.name, student: (d && d.student) || '', scope: A.t('rg.gu.scope.' + r.guardian.accessScope) }));
          A.toast(r.message, 'success'); api.reload();
        }).catch(function (e2) { A.toast(e2.message, 'danger'); });
    }
    var scopes = ['full', 'info', 'none'];
    var columns = [
      { key: 'g', title: A.t('rg.gu.colGuardian'), render: function (r) {
        return h('span', null, r.name, ' ', h('span', { className: 'muted' }, '(' + r.login + ')'), ' ',
          h(E.Badge, { tone: r.perChild ? 'brand' : 'outline' }, A.t(r.perChild ? 'rg.gu.perChild' : 'rg.gu.fromAccount')), ' ',
          h(E.Badge, { tone: r.guardianStatus === 'full' ? 'outline' : 'danger', icon: r.guardianStatus === 'full' ? undefined : 'alert-circle' }, A.t('rg.gu.status.' + (r.guardianStatus || 'full'))));
      } },
      { key: 'status', title: A.t('rg.gu.colStatus'), render: function (r) {
        var e = entry(r); var court = e.status === 'deprived' || e.status === 'court-restricted';
        return h('div', { className: 'stack' },
          h(E.Select, { label: '', 'aria-label': A.t('rg.gu.status', { name: r.name }), width: 280, value: e.status,
            onChange: function (ev) { setEntry(r, 'status', ev.target.value); },
            options: STATUSES.map(function (v) { return { value: v, label: A.t('rg.gu.status.' + v) }; }) }),
          h(E.Select, { label: '', 'aria-label': A.t('rg.gu.basisKind', { name: r.name }), width: 280, value: e.basisKind,
            hint: court ? A.t('rg.gu.courtNeeded') : undefined,
            onChange: function (ev) { setEntry(r, 'basisKind', ev.target.value); },
            options: [{ value: '', label: A.t('rg.gu.basisKind.') }].concat(BASIS_KINDS.map(function (v) { return { value: v, label: A.t('rg.gu.basisKind.' + v) }; })) }),
          h(E.TextField, { label: '', 'aria-label': A.t('rg.gu.basisRef', { name: r.name }), value: e.basisRef,
            placeholder: A.t('rg.gu.basisRefPh'), onChange: function (ev) { setEntry(r, 'basisRef', ev.target.value); } }),
          h(E.TextField, Object.assign({ label: '', type: 'date', 'aria-label': A.t('rg.gu.basisDate', { name: r.name }), value: e.basisDate,
            hint: A.dateHint(e.basisDate), onChange: function (ev) { setEntry(r, 'basisDate', ev.target.value); } }, A.dateInputProps())));
      } },
      { key: 'scope', title: A.t('rg.gu.colScope'), render: function (r) {
        var e = entry(r);
        return h('div', { className: 'stack' },
          h(E.Checkbox, { label: A.t('rg.gu.override'), 'aria-label': A.t('rg.gu.overrideAria', { name: r.name }), checked: e.override,
            onChange: function (ev) { setEntry(r, 'override', ev && ev.target ? !!ev.target.checked : !!ev); } }),
          h(E.Select, { label: '', 'aria-label': A.t('rg.gu.scope', { name: r.name }), width: 280, value: scopeOf(e), disabled: !e.override,
            hint: A.t('rg.gu.derived', { scope: A.t('rg.gu.scope.' + derived(e.status)) }),
            onChange: function (ev) { setEntry(r, 'accessScope', ev.target.value); },
            options: scopes.map(function (v) { return { value: v, label: A.t('rg.gu.scope.' + v) }; }) }));
      } },
      { key: 'basis', title: A.t('rg.gu.colBasis'), render: function (r) {
        return h(E.TextField, { label: '', 'aria-label': A.t('rg.gu.basis', { name: r.name }), value: entry(r).legalBasis,
          placeholder: A.t('rg.gu.basisPh'), hint: A.t('rg.gu.basisHint'), onChange: function (ev) { setEntry(r, 'legalBasis', ev.target.value); } });
      } },
      { key: 'akcje', title: A.t('rg.gu.colActions'), render: function (r) {
        var blocked = why(r);
        return h('div', { className: 'stack' },
          h(E.Button, { size: 'sm', icon: 'check', disabled: !!blocked, 'aria-label': A.t('rg.gu.saveAria', { name: r.name }), onClick: function () { save(r); } }, A.t('rg.gu.save')),
          blocked ? h('p', { className: 'muted' }, blocked) : null);
      } }
    ];
    var adult = d && d.adultAccess && d.adultAccess.adult ? d.adultAccess : null;
    return h(Card, { id: 'opiekunowie', title: A.t('rg.gu.title'), sub: A.t('rg.gu.sub') },
      h(E.Alert, { tone: 'info', title: A.t('rg.gu.colStatus') }, A.t('rg.gu.statusHelp')),
      h(E.Select, { label: A.t('common.student'), value: who, onChange: function (e) { setWho(e.target.value); setDraft({}); setSaid(''); },
        options: active.map(function (s) { return { value: s.id, label: s.registerNo + ' · ' + s.lastName + ' ' + s.firstName + ' · ' + s.classId }; }) }),
      adult && h(E.Alert, { tone: adult.guardianAccess === 'open' ? 'info' : 'warning', title: A.t('rg.gu.adultTitle') },
        A.t('rg.gu.adultSince', { date: A.fmtDate(adult.adultSince) }) + ' ' + A.t('rg.gu.rule.' + adult.mode) + ' ' + A.t('rg.gu.access.' + adult.guardianAccess)),
      !d ? h('p', { className: 'muted' }, api.error ? api.error.message : A.t('rg.gu.loading'))
        : (d.guardians.length
          ? h(E.Table, { caption: A.t('rg.gu.caption'), hideCaption: true, stack: true, columns: columns, rows: d.guardians.map(function (g) { return Object.assign({ id: g.userId }, g); }) })
          : h(E.Alert, { tone: 'info' }, A.t('rg.gu.none'))),
      h(Live, null, said || A.t('rg.gu.live', { n: d ? d.guardians.length : 0 })));
  }

  /* ------------------------------------------------------ GAP-4: flagi ucznia (pomoc społeczna) */
  function Flagi(p) {
    var active = p.students.filter(function (s) { return s.status !== 'transferred'; });
    var s0 = React.useState(''), who = s0[0], setWho = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var s2 = React.useState(null), nat = s2[0], setNat = s2[1];
    var s3 = React.useState(null);
    var s4 = React.useState(null);
    React.useEffect(function () { if (!who && active.length) setWho(active[0].id); }, [p.students.length]);
    var s = active.filter(function (x) { return x.id === who; })[0] || null;
    React.useEffect(function () { setNat(null); s3[1](null); s4[1](null); }, [who]);
    function patch(body) {
      A.api.patch('/api/registry/students/' + who + '/flags', body).then(function (r) {
        setSaid(A.t('rg.flags.saved', { name: s.lastName + ' ' + s.firstName }));
        A.toast(r.message, 'success'); p.onSaved();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    /* U3-24 — przełącznik „Dokument tożsamości” wysyłał samo `identityKind: 'passport'`, a serwer
       odpowiadał 400 („księga wymaga rodzaju, numeru i kodu kraju wydania”), bo karta nie miała
       gdzie ich wpisać: opcji nie dało się wybrać z tego ekranu w ogóle. Wybór rodzaju otwiera teraz
       trzy pola na miejscu i leci jednym żądaniem razem z `identityKind`.
       Drugą stroną tej samej monety jest D3-45: uczeń, który dostał numer PESEL w listopadzie, też
       nie miał gdzie go wpisać. Tu jest to pole. */
    var docDraft = s3[0], setDocDraft = s3[1];
    var peselDraft = s4[0], setPeselDraft = s4[1];
    function openDoc() { var dd = s.identityDocument || {}; setDocDraft({ type: dd.type || 'passport', number: dd.number || '', country: dd.country || 'UA' }); }
    function saveDoc() {
      patch({ identityKind: 'passport', identityDocument: { type: docDraft.type, number: docDraft.number.trim(), country: docDraft.country.trim() } });
      setDocDraft(null);
    }
    var docReady = docDraft && docDraft.type && docDraft.number.trim().length >= 6 && docDraft.country.trim();
    return h(Card, { id: 'flagi', title: A.t('rg.flags.title'), sub: A.t('rg.flags.sub') },
      h(E.Select, { label: A.t('common.student'), value: who, onChange: function (e) { setWho(e.target.value); setSaid(''); },
        options: active.map(function (x) { return { value: x.id, label: x.registerNo + ' · ' + x.lastName + ' ' + x.firstName + ' · ' + x.classId }; }) }),
      s && h('div', { className: 'stack' },
        h(E.Switch, { label: A.t('rg.flags.welfare'), hint: A.t('rg.flags.welfareHint'), checked: !!s.socialWelfare, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patch({ socialWelfare: v }); } }),
        h(E.Switch, { label: A.t('rg.flags.adult'), checked: !!s.adult, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patch(v ? { adult: true } : { adult: false, adultSelfExcuse: false, parentAccessBlocked: false }); } }),
        h(E.Switch, { label: A.t('rg.flags.selfExcuse'), hint: A.t('rg.flags.selfExcuseHint'), disabled: !s.adult, checked: !!s.adultSelfExcuse, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patch({ adultSelfExcuse: v }); } }),
        h(E.Switch, { label: A.t('rg.flags.parentBlocked'), disabled: !s.adult, checked: !!s.parentAccessBlocked, states: [A.t('common.no'), A.t('common.yes')], onChange: function (v) { patch({ parentAccessBlocked: v }); } }),
        /* R3: przy uczniu pełnoletnim sekretariat widzi regułę szkoły i stan dostępu opiekunów. */
        s.adultAccess && s.adultAccess.adult && h(E.Alert, { tone: s.adultAccess.guardianAccess === 'open' ? 'info' : 'warning', title: A.t('rg.flags.adultRule') },
          A.t('rg.gu.adultSince', { date: A.fmtDate(s.adultAccess.adultSince) }) + ' ' + A.t('rg.gu.rule.' + s.adultAccess.mode) + ' ' + A.t('rg.gu.access.' + s.adultAccess.guardianAccess)),
        h('div', { className: 'grid-2' },
          h(E.TextField, { label: A.t('rg.flags.nationality'), value: nat == null ? (s.nationality || '') : nat,
            onChange: function (e) { setNat(e.target.value); },
            onBlur: function (e) { if ((s.nationality || '') !== e.target.value) patch({ nationality: e.target.value }); } }),
          h(E.Select, { label: A.t('rg.flags.identityKind'), value: s.identityKind || 'pesel',
            /* R7: przy dokumencie pokazujemy rodzaj, numer i kraj — nigdy samo „paszport”. */
            hint: s.pesel ? 'PESEL ' + s.pesel : docLabel(s.identityDocument),
            onChange: function (e) { if (e.target.value === 'passport') openDoc(); else patch({ identityKind: 'pesel' }); },
            options: [{ value: 'pesel', label: A.t('rg.flags.ident.pesel') }, { value: 'passport', label: A.t('rg.flags.ident.passport') }] })),
        docDraft && h('div', { className: 'stack', role: 'group', 'aria-label': A.t('rg.flags.docLegend') },
          h('p', { className: 'muted' }, A.t('rg.flags.docWhy')),
          h('div', { className: 'grid-3' },
            h(E.Select, { label: A.t('rg.new.docType'), required: true, value: docDraft.type,
              onChange: function (e) { setDocDraft(Object.assign({}, docDraft, { type: e.target.value })); },
              options: DOC_TYPES.map(function (x) { return { value: x, label: A.t('rg.doc.' + x) }; }) }),
            h(E.TextField, { label: A.t('rg.new.passportNo'), mono: true, required: true, value: docDraft.number, placeholder: 'EA1234567',
              onChange: function (e) { setDocDraft(Object.assign({}, docDraft, { number: e.target.value })); }, hint: A.t('rg.new.passportHint') }),
            h(E.Select, { label: A.t('rg.new.country'), required: true, value: docDraft.country,
              onChange: function (e) { setDocDraft(Object.assign({}, docDraft, { country: e.target.value })); },
              options: ['UA', 'BY', 'DE', 'XX'].map(function (c) { return { value: c, label: A.t('rg.country.' + c) }; }) })),
          h('div', { className: 'row' },
            h(E.Button, { size: 'sm', icon: 'check', disabled: !docReady, onClick: saveDoc }, A.t('rg.flags.docSave')),
            h(E.Button, { size: 'sm', variant: 'quiet', onClick: function () { setDocDraft(null); } }, A.t('rg.flags.docCancel')))),
        /* D3-45 — numer PESEL nadany w trakcie roku. */
        peselDraft === null
          ? (!s.pesel ? h(E.Button, { size: 'sm', variant: 'quiet', icon: 'plus', onClick: function () { setPeselDraft(''); } }, A.t('rg.flags.peselAdd')) : null)
          : h('div', { className: 'stack', role: 'group', 'aria-label': A.t('rg.flags.peselLegend') },
            h('p', { className: 'muted' }, A.t('rg.flags.peselHint')),
            h('div', { className: 'row' },
              h(E.TextField, { label: 'PESEL', mono: true, inputMode: 'numeric', maxLength: 11, autoComplete: 'off', value: peselDraft,
                onChange: function (e) { setPeselDraft(e.target.value.replace(/\D/g, '').slice(0, 11)); } }),
              h(E.Button, { size: 'sm', icon: 'check', disabled: peselDraft.length !== 11,
                onClick: function () { patch({ pesel: peselDraft, reason: 'nadanie numeru PESEL w trakcie roku szkolnego' }); setPeselDraft(null); } }, A.t('rg.flags.peselSave')),
              h(E.Button, { size: 'sm', variant: 'quiet', onClick: function () { setPeselDraft(null); } }, A.t('rg.flags.docCancel')))),
        /* § 4 — historia tożsamości jest wpisem księgi: zamrożonym, więc komentowanym obok. */
        (s.identityHistory && s.identityHistory.length)
          ? h('div', { className: 'stack', role: 'group', 'aria-label': A.t('rg.flags.identHistoryTitle') },
            h(E.Badge, { tone: 'outline', icon: 'info' }, A.t('rg.flags.identHistory', { n: s.identityHistory.length })),
            h('p', { className: 'caption muted' }, A.t('rg.flags.identHistoryHint')),
            h('ul', { className: 'stack', style: { listStyle: 'none', margin: 0, padding: 0 } }, s.identityHistory.map(function (e) {
              return h('li', { key: e.id },
                h('div', { className: 'caption' }, A.t('rg.flags.identEntry', { date: A.fmtDate(e.date || e.at), what: e.reason || e.change || '' })),
                h(window.EdLogComments.Toggle, { kind: 'identity-history', entryId: e.id, counts: (p.identityComments || {})[e.id], onChange: p.onSaved }));
            })))
          : null),
      h(Live, null, said || A.t('rg.flags.live')));
  }

  /* ---------------------------------------------------------------- rejestr obwodowy (3.5.14) */
  function Obwod() {
    var api = A.useApi('/api/registry/district', []);
    var s0 = React.useState(''), said = s0[0], setSaid = s0[1];
    var d = api.data;
    if (!d) return h(Card, { id: 'obwod', title: A.t('rg.dist.title') }, h('p', { className: 'muted' }, api.error ? api.error.message : A.t('rg.dist.loading')));

    function act(child, path, body) {
      A.api.post('/api/registry/district/' + child.id + '/' + path, body || {}).then(function (r) {
        setSaid(path === 'report'
          ? A.t('rg.dist.reportLive', { name: child.lastName + ' ' + child.firstName, pct: A.fmtPct(r.stats.completeness) })
          : A.t('rg.dist.summonLive', { name: child.lastName + ' ' + child.firstName }));
        api.reload();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var columns = [
      { key: 'name', title: A.t('rg.dist.colChild'), render: function (r) { return r.lastName + ' ' + r.firstName; } },
      { key: 'birthYear', title: A.t('rg.dist.colYear') },
      { key: 'institution', title: A.t('rg.dist.colInstitution'), render: function (r) { return r.institution || '—'; } },
      { key: 'reported', title: A.t('rg.dist.colReport'), render: function (r) {
        return r.reported ? h(E.Badge, { tone: 'success', icon: 'check' }, A.t('rg.dist.reported'))
          : h(E.Badge, { tone: 'danger', icon: 'alert-circle' }, r.summonedAt ? A.t('rg.dist.summonedOn', { date: A.fmtDate(r.summonedAt) }) : A.t('rg.dist.noReport'));
      } },
      { key: 'comments', title: A.t('rg.dist.colComments'), render: function (r) {
        /* Komentuje każdy, kto widzi rejestr obwodowy — ta sama bramka, co GET /api/registry/district. */
        return h(window.EdLogComments.Toggle, { kind: 'district-register', entryId: r.id, counts: (d.comments || {})[r.id], onChange: api.reload });
      } },
      { key: 'akcje', title: A.t('rg.book.colActions'), render: function (r) {
        return h('div', { className: 'ed-row-actions' }, r.reported
          ? h(E.Button, { size: 'sm', variant: 'quiet', icon: 'file', disabled: true, 'aria-label': A.t('rg.dist.registeredAria', { name: r.lastName }) }, A.t('rg.dist.registered'))
          : h(React.Fragment, null,
            h(E.Button, { size: 'sm', icon: 'check', 'aria-label': A.t('rg.dist.registerAria', { name: r.lastName }), onClick: function () { act(r, 'report'); } }, A.t('rg.dist.register')),
            !r.summonedAt && h(E.Button, { size: 'sm', variant: 'quiet', icon: 'bell', 'aria-label': A.t('rg.dist.summonAria', { name: r.lastName }), onClick: function () { act(r, 'summon'); } }, A.t('rg.dist.summon'))));
      } }
    ];
    return h(Card, { id: 'obwod', title: A.t('rg.dist.title'), sub: A.t('rg.dist.sub') },
      h('div', { className: 'grid-3' },
        h(E.StatTile, { label: A.t('rg.dist.completeness'), value: A.fmtPct(d.stats.completeness), hint: A.t('rg.dist.completenessHint', { reported: d.stats.reported, total: d.stats.total }), alert: d.stats.missing > 0 }),
        h(E.StatTile, { label: A.t('rg.dist.missing'), value: String(d.stats.missing), hint: A.t('rg.dist.missingHint'), alert: d.stats.missing > 0 }),
        h(E.StatTile, { label: A.t('rg.dist.summonedTile'), value: String(d.stats.summoned), hint: A.t('rg.dist.summonedHint') })),
      h(E.Table, { caption: A.t('rg.dist.caption'), hideCaption: true, columns: columns, rows: d.children.map(function (c) { return Object.assign({ id: c.id }, c); }) }),
      h(Live, null, said || A.t('rg.dist.live')));
  }

  /* ------------------------------------------------------------------------------ ekran */
  function Screen(props) {
    var reg = A.useApi('/api/registry/students', []);
    var s0 = React.useState(props.route.query.tab || 'ksiega'), tab = s0[0], setTab = s0[1];
    var s1 = React.useState(0), version = s1[0], bump = s1[1];
    var today = (props.config && props.config.today) || A.isoToday();
    function onSaved() { reg.reload(); bump(function (v) { return v + 1; }); }

    var d = reg.data;
    var TABS = [{ id: 'ksiega', label: A.t('rg.tab.book'), count: d ? d.students.length : undefined }, { id: 'dokumenty', label: A.t('rg.tab.docs') }, { id: 'obwod', label: A.t('rg.tab.district') }];
    return h('div', null,
      h('h1', { className: 'display app-title' }, A.t('rg.title')),
      h('p', { className: 'app-sub' }, A.t('rg.sub', { school: props.config ? props.config.school.name : '', year: d ? d.year : '', date: A.fmtDate(today) })),
      reg.error && h(E.Alert, { tone: 'danger' }, reg.error.message),
      !d ? h('p', { className: 'muted' }, A.t('rg.loading')) : h(E.Tabs, { tabs: TABS, value: tab, onChange: function (t) { setTab(t); A.navigate('/sekretariat', { tab: t }); }, label: A.t('rg.tabsLabel') },
        h('div', { className: 'stack mt-4' },
          h('div', { hidden: tab !== 'ksiega' }, h('div', { className: 'stack' },
            h(NowyUczen, { classes: d.classes, year: d.year, nextRegisterNo: d.nextRegisterNo, onSaved: onSaved }),
            h(Ksiega, { students: d.students, year: d.year, today: today, onSaved: onSaved }),
            /* U3-01 — tabela opiekunów potrzebuje 1048 px, a w połówce `grid-2` dostawała 532: przycisk
               „Zapisz zakres” lądował 403 px poza widokiem, za przewijakiem bez żadnego uchwytu, razem
               z całą kolumną podstawy, od której zależy. Karta, która przyznaje albo odbiera opiekunowi
               dostęp do danych dziecka, dostaje własny wiersz na pełną szerokość. */
            h(Opiekunowie, { students: d.students, version: version }),
            h(Flagi, { students: d.students, identityComments: d.identityComments, onSaved: onSaved }))),
          h('div', { hidden: tab !== 'dokumenty' }, h('div', { className: 'grid-2' },
            h(Legitymacja, { students: d.students, version: version }),
            h(Duplikaty, { students: d.students, today: today }))),
          h('div', { hidden: tab !== 'obwod' }, h(Obwod, null)))));
  }

  A.screen({ id: 'registrar', path: '/sekretariat', title: 'Sekretariat', module: 'registry', roles: ['registrar', 'admin', 'principal'], nav: { key: 'nav.registrar', label: 'Sekretariat', order: 50 }, component: Screen });
})();
