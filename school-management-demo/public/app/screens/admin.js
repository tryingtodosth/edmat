/* 3.5 — Administracja: struktura roku, import planu, pakiet SIO, konta i 2FA, uprawnienia wiadomości,
   kody rejestracyjne, lista dozwolonych IP, anonimizowana kopia testowa, retencja logów. */
(function () {
  var React = window.React, h = React.createElement, E = window.EdMat, A = window.EdApp;

  window.EdI18n.add({
    pl: {
      'ad.title': 'Administracja',
      'ad.sub': '{school} · rok szkolny {year} · stan na {date}',
      'ad.tabsLabel': 'Sekcje administracji',
      'ad.tab.year': 'Rok szkolny i plan',
      'ad.tab.security': 'Bezpieczeństwo i konta',
      'ad.tab.data': 'Dane i archiwum',
      'ad.loading': 'Wczytywanie…',
      'ad.popupBlocked': 'Przeglądarka zablokowała nowe okno — zezwól na wyskakujące okna, aby wydrukować dokument.',

      'ad.year.titleBare': 'Struktura roku szkolnego',
      'ad.year.title': 'Struktura roku {year}',
      'ad.year.sub': 'Semestry, ferie, przerwy świąteczne i dni wolne od zajęć dydaktycznych. Dni wolne są od razu widoczne w planie lekcji i w kalendarzu sprawdzianów.',
      'ad.year.from': 'Początek',
      'ad.year.to': 'Koniec',
      'ad.year.winter': 'Ferie zimowe',
      'ad.year.name': 'Nazwa',
      'ad.year.fromShort': 'Od',
      'ad.year.toShort': 'Do',
      'ad.year.holidays': 'Przerwy świąteczne',
      'ad.year.holidayName': 'Nazwa przerwy {n}',
      'ad.year.daysOff': 'Dodatkowe dni wolne od zajęć dydaktycznych',
      'ad.year.dayOffName': 'Nazwa dnia wolnego {n}',
      'ad.year.removeDayOff': 'Usuń dzień wolny {name}',
      'ad.year.errorsTitle': 'Terminy wymagają poprawy',
      'ad.year.addDayOff': 'Dodaj dzień wolny',
      'ad.year.save': 'Zapisz strukturę roku',
      'ad.year.savedToast': 'Struktura roku zapisana.',
      'ad.year.savedLive': 'Zapisano strukturę roku: {semesters}, {breaks} przerw, {daysOff} dni wolnych.',

      'ad.bells.title': 'Plan dzwonków',
      'ad.bells.hint': 'Numery lekcji z planu muszą mieć tu swój dzwonek — eksport z aSc bywa numerowany od zera („godzina zerowa”, zwykle 7:10). Godziny nie mogą na siebie nachodzić, a numer może być tylko jeden raz.',
      'ad.bells.no': 'Nr lekcji',
      'ad.bells.start': 'Początek',
      'ad.bells.end': 'Koniec',
      'ad.bells.add': 'Dodaj kolejną lekcję',
      'ad.bells.addZero': 'Dodaj godzinę 0 (7:10)',
      'ad.bells.remove': 'Usuń lekcję {no} z planu dzwonków',
      'ad.year.anchorTitle': 'Cykl dwutygodniowy A/B',
      'ad.year.anchor': 'Pierwszy tydzień A (kotwica)',
      'ad.year.anchorHint': 'Puste pole = pierwszy poniedziałek roku szkolnego ({anchor}). Szkoła, która zaczyna rok od tygodnia II, wpisuje tu jedną datę zamiast poprawiać plan.',

      'ad.actions': 'Działania',
      'ad.subj.title': 'Przedmioty szkoły',
      'ad.subj.sub': 'Lista, z której korzystają plan lekcji, karty nauczycieli i oceny. Identyfikator jest niezmienny — plan i oceny wiszą na nim. Przedmiot, którego coś używa, nie da się usunąć.',
      'ad.subj.name': 'Nazwa',
      'ad.subj.id': 'Identyfikator',
      'ad.subj.idPlaceholder': 'np. wdz',
      'ad.subj.idHint': 'Puste = wyliczymy z nazwy. 2–24 znaki: małe litery, cyfry, kropka, myślnik, podkreślenie.',
      'ad.subj.short': 'Skrót',
      'ad.subj.usage': 'W użyciu',
      'ad.subj.usageText': '{timetable} w planie · {lessons} lekcji · {teachers} nauczycieli',
      'ad.subj.addTitle': 'Dodaj przedmiot',
      'ad.subj.add': 'Dodaj przedmiot',
      'ad.subj.confirmDelete': 'Usunąć przedmiot „{name}”? Nic go dziś nie używa.',
      'ad.subj.deleted': 'Przedmiot „{name}” usunięty.',

      'ad.cls.title': 'Oddziały',
      'ad.cls.sub': 'Oddział można założyć przed listą uczniów — publikacja planu wgrywana we wrześniu zwykle przychodzi pierwsza. Usunąć wolno tylko oddział pusty i nieużywany w planie.',
      'ad.cls.name': 'Nazwa',
      'ad.cls.id': 'Oznaczenie',
      'ad.cls.idHint': 'Jedna lub dwie cyfry poziomu i litera oddziału, np. 7b.',
      'ad.cls.homeroom': 'Wychowawca',
      'ad.cls.noHomeroom': '— bez wychowawcy —',
      'ad.cls.usage': 'W użyciu',
      'ad.cls.usageText': '{students} uczniów · {timetable} w planie · {groups} grup',
      'ad.cls.addTitle': 'Dodaj oddział',
      'ad.cls.add': 'Dodaj oddział',
      'ad.cls.confirmDelete': 'Usunąć pusty oddział {name}?',
      'ad.cls.deleted': 'Oddział {name} usunięty.',

      'ad.import.title': 'Import planu lekcji',
      'ad.import.sub': 'Wgraj plik z aSc Timetables (XML) albo publikację „Plan lekcji Optivum” (HTML); można też wkleić CSV lub JSON. Import jest dwufazowy: najpierw przebieg próbny z dopasowaniem encji, potem zapis. Nie nadpisuje tematów lekcji ani frekwencji.',
      'ad.import.data': 'Dane z programu układającego plan (CSV albo JSON)',
      'ad.import.dataHint': 'Pusta kolumna „group” oznacza lekcję z całym oddziałem.',
      'ad.import.dry': 'Sprawdź (import próbny)',
      'ad.import.apply': 'Zaimportuj i zastąp plan',
      'ad.import.noConflicts': 'Bez konfliktów',
      'ad.import.toDecide': '{n} do decyzji',
      'ad.import.doneTitle': 'Plan zaimportowany',
      'ad.import.doneText': '{rows} lekcji · {groups} podziałów na grupy · {rooms} sal · {teachers} nauczycieli.',
      'ad.import.dryTitle': 'Import próbny — nic nie zapisano',
      'ad.import.dryText': '{rows} lekcji gotowych do zapisu; zastąpią {replacing} obecnych wpisów planu.',
      'ad.import.errorsTitle': '{n} błędnych wierszy',
      'ad.import.conflicts': 'Konflikty importu',
      'ad.import.colConflict': 'Konflikt',
      'ad.import.colLesson': 'Lekcja',
      'ad.import.colDetail': 'Szczegóły',
      'ad.import.kind.teacher': 'Nauczyciel w dwóch miejscach',
      'ad.import.kind.room': 'Sala zajęta',
      'ad.import.kind.class': 'Oddział bez rozłącznego podziału',
      'ad.import.format': 'Format pliku',
      'ad.import.formatAuto': 'Rozpoznaj automatycznie',
      'ad.import.dropHint': 'Wskaż plik poniżej (aSc XML, publikacja Optivum HTML, CSV, JSON) albo przeciągnij go tutaj. Cały katalog publikacji Optivum wgrywa się jako katalog.',
      'ad.import.pickFile': 'Plik planu',
      'ad.import.pickDir': 'Katalog publikacji Optivum',
      'ad.import.picked': 'Wczytano: {name} ({n}).',
      'ad.import.filesN': '{n} plików',
      'ad.import.filesRead': 'Wczytano {n} plików — uruchom import próbny.',
      'ad.import.noFiles': 'Wśród wskazanych plików nie ma ani jednego XML, HTML, CSV ani JSON.',
      'ad.import.clearFile': 'Usuń wczytane pliki',
      'ad.import.warningsTitle': 'Uwagi do pliku ({n})',
      'ad.import.blockingTitle': '{n} encji bez odpowiednika',
      'ad.import.blockingText': 'Uzupełnij dopasowanie w tabeli poniżej albo wybierz „pomiń”. Dopóki coś zostaje bez decyzji, import nie zapisze niczego.',
      'ad.import.weeksTitle': 'Cykl dwutygodniowy',
      'ad.import.weeksText': 'Co tydzień: {every} pozycji · tydzień A: {a} · tydzień B: {b}. Tydzień A liczymy od {anchor}.',
      'ad.import.weekMarkers': 'Tydzień rozpoznany heurystycznie ze znaczników przy nazwie przedmiotu: {markers}. Publikacja Optivum nie ma własnego wymiaru tygodnia — sprawdź to, zanim zapiszesz.',
      'ad.import.mapTitle': 'Dopasowanie encji z pliku ({tool} · {ref})',
      'ad.import.acceptExact': 'Przyjmij wszystkie dokładne dopasowania',
      'ad.import.acceptedExact': 'Przyjęto {n} dokładnych dopasowań. Naciśnij „Sprawdź ponownie z tym dopasowaniem”.',
      'ad.import.recheck': 'Sprawdź ponownie z tym dopasowaniem',
      'ad.import.skip': '— pomiń —',
      'ad.import.selectFor': 'Odpowiednik dla: {name}',
      'ad.import.colForeign': 'W pliku',
      'ad.import.colRows': 'Wierszy',
      'ad.import.colHow': 'Dopasowanie',
      'ad.import.colLocal': 'U nas',
      'ad.import.map.teachers': 'Nauczyciele',
      'ad.import.map.classes': 'Oddziały',
      'ad.import.map.subjects': 'Przedmioty',
      'ad.import.map.rooms': 'Sale',
      'ad.import.map.groups': 'Podziały na grupy',
      'ad.import.newTarget': '+ załóż u nas',
      'ad.import.dataExample': 'Wstaw przykład',
      'ad.import.applyBlocked': 'Przycisk odblokuje się po imporcie próbnym bez konfliktów i bez encji bez decyzji.',
      'ad.import.createdTitle': 'Założone przy imporcie',
      'ad.import.createdText': 'Przedmioty: {subjects} · oddziały: {classes} · grupy: {groups}. Skład grup z pliku jest propozycją — sprawdź go w „Grupach w oddziale”.',
      'ad.import.how.short': 'po skrócie',
      'ad.import.how.name': 'po nazwie',
      'ad.import.how.key': 'po kluczu',
      'ad.import.how.fuzzy': 'przybliżone',
      'ad.import.how.mapping': 'ręcznie',
      'ad.import.how.ambiguous': 'niejednoznaczne',
      'ad.import.how.unmatched': 'brak odpowiednika',
      'ad.import.how.skipped': 'pomijane',
      'ad.import.how.unknown_target': 'wskazano nieistniejący wpis',
      'ad.import.how.create': 'zostanie założone',
      'ad.import.how.verbatim': 'tekst z pliku',
      'ad.import.kind.group': 'Grupa',

      'ad.sio.title': 'Pakiet SIO',
      'ad.sio.sub': 'Eksport struktury oddziałów i liczby uczniów zgodny ze specyfikacją techniczną Systemu Informacji Oświatowej. Numery PESEL trafiają do pakietu tylko wtedy, gdy baza nie jest anonimizowana.',
      'ad.sio.validate': 'Waliduj pakiet',
      'ad.sio.generate': 'Generuj XML',
      'ad.sio.okLive': 'Walidacja bez błędów: {classes} oddziałów, {students} uczniów.',
      'ad.sio.failLive': 'Walidacja zakończona {n} błędami; pakiet nie zostanie zapisany.',
      'ad.sio.downloaded': 'Pakiet SIO wygenerowany i pobrany: {file}.',
      'ad.sio.downloadedToast': 'Pakiet SIO pobrany.',
      'ad.sio.readyTitle': 'Pakiet gotowy do wysłania',
      'ad.sio.readyText': '{classes} oddziałów · {students} uczniów · 0 błędów walidacji schematu. Liczby uczniów w oddziałach: {perClass}.',
      'ad.sio.errorsTitle': 'Walidacja pakietu: {n} błędów',
      'ad.sio.errorsText': 'Pakiet nie został zapisany. Popraw wskazane wpisy w księdze uczniów i wygeneruj XML ponownie.',

      'ad.staff.title': 'Konta pracowników',
      'ad.staff.sub': 'Pedagog, psycholog, logopeda, pielęgniarka, świetlica, stołówka, biblioteka, IOD, sekretariat i drugi administrator — kreator zakłada tylko nauczycieli, uczniów i rodziców. Konta pracowników się nie kasuje: dezaktywacja odbiera dostęp, a wpisy w dzienniku zostają przy autorze.',
      'ad.staff.caption': 'Konta pracowników szkoły',
      'ad.staff.colName': 'Pracownik',
      'ad.staff.colRole': 'Rola',
      'ad.staff.colContact': 'Kontakt',
      'ad.staff.colStatus': 'Stan konta',
      'ad.staff.colActions': 'Działania',
      'ad.staff.add': 'Dodaj konto pracownika',
      'ad.staff.dialogTitle': 'Nowe konto pracownika',
      'ad.staff.role': 'Rola',
      'ad.staff.firstName': 'Imię',
      'ad.staff.lastName': 'Nazwisko',
      'ad.staff.titleField': 'Tytuł (np. mgr)',
      'ad.staff.login': 'Login',
      'ad.staff.loginHint': 'Puste = login z inicjału i nazwiska. 3–32 znaki, małe litery, cyfry i kropki.',
      'ad.staff.email': 'E-mail służbowy',
      'ad.staff.phone': 'Telefon',
      'ad.staff.subjects': 'Przedmioty (tylko nauczyciel)',
      'ad.staff.homeroom': 'Wychowawstwo oddziału',
      'ad.staff.homeroomNone': 'bez wychowawstwa',
      'ad.staff.create': 'Załóż konto',
      'ad.staff.pwTitle': 'Hasło jednorazowe — pokazujemy je tylko raz',
      'ad.staff.pwNote': 'Przekaż je innym kanałem niż e-mail. Przy pierwszym logowaniu wymagana jest zmiana zgodna z polityką złożoności.',
      'ad.staff.pwClose': 'Zapisałem hasło',
      'ad.staff.keys': 'Para kluczy do notatek poufnych',
      'ad.staff.mustChange': 'Zmiana hasła przy logowaniu',
      'ad.staff.blocked': 'Zablokowane',
      'ad.staff.active': 'Czynne',
      'ad.staff.homeroomOf': 'wych. {cls}',
      'ad.staff.deactivate': 'Dezaktywuj',
      'ad.staff.deactivateAria': 'Dezaktywuj konto {name}',
      'ad.staff.restore': 'Przywróć',
      'ad.staff.restoreAria': 'Przywróć konto {name}',
      'ad.staff.reasonTitle': 'Dezaktywacja konta {name}',
      'ad.staff.reason': 'Podstawa (np. rozwiązanie umowy)',
      'ad.staff.reasonNote': 'Konto zostaje w bazie, traci dostęp natychmiast — także w aplikacji mobilnej. Wpisy w dzienniku pozostają nienaruszone.',
      'ad.staff.lastAdmin': 'To jedyne czynne konto administratora — najpierw załóż albo odblokuj inne.',
      'ad.staff.created': 'Założono konto {name} ({login}).',
      'ad.staff.deactivated': 'Dezaktywowano konto {name}.',
      'ad.staff.restored': 'Przywrócono konto {name}.',
      'ad.staff.live': 'Kont pracowników: {n}, w tym czynnych administratorów: {admins}.',
      'ad.staff.loading': 'Wczytywanie kont pracowników…',
      'ad.reset.title': 'Reset hasła',
      'ad.reset.sub': 'Hasło jednorazowe pokazujemy tylko raz — przekaż je innym kanałem niż e-mail.',
      'ad.reset.account': 'Konto użytkownika',
      'ad.reset.do': 'Resetuj i wymuś zmianę',
      'ad.reset.badge': 'Wymagana zmiana przy logowaniu',
      'ad.reset.policy': 'Polityka złożoności sprawdzana przy zmianie: co najmniej 12 znaków, wielka i mała litera, cyfra oraz znak specjalny. Do czasu zmiany hasła pozostałe funkcje dziennika są zablokowane.',
      'ad.reset.toast': 'Hasło zresetowane.',
      'ad.reset.live': 'Zresetowano hasło: {name} ({login}). Przy najbliższym logowaniu wymagana jest zmiana hasła.',

      'ad.totp.title': 'Uwierzytelnianie dwuskładnikowe (TOTP)',
      'ad.totp.sub': 'Wymóg obejmuje wszystkie osoby uprawnione do edycji ocen i frekwencji: {roles}.',
      'ad.totp.switch': 'Wymagaj 2FA dla edytujących oceny i frekwencję',
      'ad.totp.off': 'wyłączone',
      'ad.totp.on': 'włączone',
      'ad.totp.warnTitle': 'Drugi składnik nie jest wymagany',
      'ad.totp.warnText': 'Oceny i frekwencję można edytować po podaniu samego hasła. Ustawienie odbiega od polityki bezpieczeństwa szkoły.',
      'ad.totp.colPerson': 'Osoba',
      'ad.totp.colRights': 'Uprawnienia',
      'ad.totp.homeroomOf': 'wychowawca {cls}',
      'ad.totp.enabled': '2FA włączone',
      'ad.totp.pending': 'Oczekuje na powiązanie',
      'ad.totp.notRequired': 'Niewymagane',
      'ad.totp.caption': 'Stan 2FA w kadrze',
      'ad.totp.live.one': '{n} osoba musi jeszcze powiązać aplikację uwierzytelniającą.',
      'ad.totp.live.few': '{n} osoby muszą jeszcze powiązać aplikację uwierzytelniającą.',
      'ad.totp.live.many': '{n} osób musi jeszcze powiązać aplikację uwierzytelniającą.',

      'ad.msg.title': 'Uprawnienia wiadomości',
      'ad.msg.legend': 'Rodzice mogą pisać do',
      'ad.msg.all': 'wszystkich nauczycieli',
      'ad.msg.allHint': 'Każdy rodzic widzi całą kadrę na liście odbiorców.',
      'ad.msg.limited': 'tylko wychowawcy i nauczycieli przedmiotu',
      'ad.msg.limitedHint': 'Lista odbiorców ograniczona do osób uczących dziecko; sekretariat i dyrekcja pozostają dostępne.',
      'ad.msg.live': 'Ustawienie obowiązuje od następnego zalogowania rodzica.',
      'ad.msg.saved': 'Zapisano: {message}',
      'ad.msg.savedToast': 'Uprawnienia wiadomości zapisane.',

      'ad.codes.title': 'Kody rejestracyjne dla rodziców klas pierwszych',
      'ad.codes.sub': 'Kod jest jednorazowy, wiąże konto rodzica z konkretnym uczniem i wygasa po 30 dniach. Rodzic zakłada konto sam, przez publiczny formularz rejestracji.',
      'ad.codes.class': 'Oddział',
      'ad.codes.generate': 'Wygeneruj kody',
      'ad.codes.print': 'Drukuj listę do kopert',
      'ad.codes.printed': 'Lista kodów skierowana do druku — kody wydaje się w zaklejonych kopertach.',
      'ad.codes.unusedBadge': '{n} niewykorzystanych',
      'ad.codes.colCode': 'Kod rejestracyjny',
      'ad.codes.colValidTo': 'Ważny do',
      'ad.codes.used': 'Wykorzystany {date}',
      'ad.codes.unused': 'Niewykorzystany',
      'ad.codes.caption': 'Kody rejestracyjne',
      'ad.codes.none': 'Kody nie zostały jeszcze wygenerowane.',

      'ad.ip.titleBare': 'Lista dozwolonych adresów IP',
      'ad.ip.title': 'Lista dozwolonych adresów IP (logowania administracyjne)',
      'ad.ip.sub': 'Ograniczenie dotyczy kont administracyjnych. Nauczyciele, rodzice i uczniowie logują się bez ograniczeń adresowych. Twój adres: {ip}.',
      'ad.ip.field': 'Adres lub zakres IP',
      'ad.ip.error': 'Wpisz adres IPv4 (np. 193.219.28.14) albo zakres w notacji CIDR (np. 10.12.0.0/24).',
      'ad.ip.hint': 'IPv4 lub CIDR · przykłady z konfiguracji: {examples}',
      'ad.ip.colAddress': 'Adres lub zakres',
      'ad.ip.colActions': 'Akcje',
      'ad.ip.remove': 'Usuń adres {ip} z listy dozwolonych',
      'ad.ip.caption': 'Lista dozwolonych adresów IP',
      'ad.ip.emptyTitle': 'Lista jest pusta',
      'ad.ip.emptyText': 'Logowania administracyjne nie są ograniczone adresem IP. Dodaj co najmniej adres sieci szkolnej.',

      'ad.anon.title': 'Anonimizacja kopii testowej',
      'ad.anon.sub': 'Kopia bazy dla środowiska testowego. Pseudonimy liczone są deterministycznie (SHA-256), więc ten sam uczeń ma ten sam pseudonim w każdej kopii.',
      'ad.anon.run': 'Uruchom anonimizację i pobierz',
      'ad.anon.badge': 'Dane zanonimizowane',
      'ad.anon.doneTitle': 'Kopia testowa zanonimizowana',
      'ad.anon.doneText': 'Zastąpiono {replaced} danych identyfikujących; zachowano {audit} wpisów rejestru audytowego. W kopii ustawiono znacznik „anonimizowana”, więc nagłówek środowiska testowego nosi oznaczenie „Dane zanonimizowane”.',
      'ad.anon.idle': 'Bez anonimizacji kopia z danymi uczniów nie może być użyta w środowisku testowym.',
      'ad.anon.toast': 'Kopia zanonimizowana i pobrana.',
      'ad.anon.dialogTitle': 'Uruchomić anonimizację kopii testowej?',
      'ad.anon.confirm': 'Anonimizuj',
      'ad.anon.p1': 'Zastąpione zostaną: imiona i nazwiska, numery PESEL i paszportów, adresy zamieszkania, numery telefonów, adresy e-mail oraz treści wiadomości i notatek poufnych.',
      'ad.anon.p2': 'Zachowane zostaną: oceny, frekwencja, tematy lekcji, struktura oddziałów i rejestr audytowy, aby testy odwzorowywały ruch produkcyjny.',
      'ad.anon.p3': 'Baza produkcyjna nie jest zmieniana — powstaje osobny plik do pobrania.',

      'ad.push.title': 'Powiadomienia push na telefony',
      'ad.push.sub': 'Web Push bez pośredników: treść szyfrujemy kluczem urządzenia, usługa push przeglądarki przenosi wyłącznie szyfrogram.',
      'ad.push.switch': 'Wysyłaj powiadomienia na telefony',
      'ad.push.hint': 'Po włączeniu dziennik generuje własne klucze VAPID i wysyła pilne powiadomienia (np. nieobecność na 1. lekcji) na urządzenia, które zgodziły się je odbierać. Wymagane jest połączenie HTTPS.',
      'ad.push.subject': 'Kontakt dla usługi push (VAPID)',
      'ad.push.subjectHint': 'Adres „mailto:…”, pod który dostawca usługi push zgłosi problem z wysyłką. Wymaga go RFC 8292.',
      'ad.push.devices': 'Urządzenia: {n}',
      'ad.push.sent': 'Doręczone: {n}',
      'ad.push.failed': 'Nieudane: {n}',
      'ad.push.queued': 'W kolejce: {n}',
      'ad.push.on': 'Powiadomienia push włączone w szkole.',
      'ad.push.off': 'Powiadomienia push wyłączone — nic nie wychodzi poza szkolny serwer.',
      'ad.push.privacy': 'W powiadomieniu wysyłamy wyłącznie tytuł, treść widoczną też w dzienniku i odnośnik. Temat wiadomości zastępujemy zdaniem neutralnym, a notatek pomocy psychologiczno-pedagogicznej i gabinetu nie wysyłamy w ogóle. Szczegóły: docs/PUSH.md.',

      'ad.ret.title': 'Retencja logów',
      'ad.ret.sub': 'Okres liczony od zakończenia roku szkolnego, w którym powstał wpis.',
      'ad.ret.select': 'Okres przechowywania logów systemowych',
      'ad.ret.opt2': '2 lata (poniżej minimum ustawowego — nie do zapisania)',
      'ad.ret.opt5': '5 lat (logi techniczne i logi logowań)',
      'ad.ret.opt10': '10 lat (dziennik lekcyjny, frekwencja)',
      'ad.ret.opt50': '50 lat (arkusze ocen i księga uczniów)',
      'ad.ret.hint': 'Minimum wymagane przepisami: {n} lat. Krótszy okres zostanie odrzucony.',
      'ad.ret.worm': 'Niezmienne (WORM)',
      'ad.ret.archive': 'Arkusze ocen i księga uczniów: {n} lat',
      'ad.ret.reportTitle': 'Raport retencji — zadanie nic nie usuwa',
      'ad.ret.reportText': '{would} z {total} wpisów audytowych przekroczyłoby okres {years} lat (granica {cutoff}). Usunięcie wymaga odrębnej decyzji i protokołu brakowania.',
      'ad.ret.savedToast': 'Polityka retencji zapisana.',

      'ad.ret.classesTitle': 'Klasy dokumentacji i kategorie archiwalne',
      'ad.ret.classesCaption': 'Okresy przechowywania według kategorii archiwalnych JRWA',
      'ad.ret.colClass': 'Klasa dokumentacji',
      'ad.ret.colCategory': 'Kategoria',
      'ad.ret.colRule': 'Reguła',
      'ad.ret.colDue': 'Wpisów po terminie',
      'ad.ret.colNext': 'Najbliższy termin',
      'ad.ret.colVerified': 'Weryfikacja',
      'ad.ret.kind.archival': 'archiwalna',
      'ad.ret.kind.operational': 'operacyjna',
      'ad.ret.verifiedYes': 'zgodna z podstawą prawną',
      'ad.ret.verifiedNo': 'do sprawdzenia z wykazem akt (JRWA)',
      'ad.ret.never': 'nie usuwamy',
      'ad.ret.unverifiedTitle': 'Kategorie wymagają potwierdzenia wykazem akt szkoły',
      'ad.ret.unverifiedText': 'Nie potwierdzono {n} z {total} klas dokumentacji. Domyślne kategorie pochodzą z modelowego JRWA i z raportu badawczego — rozstrzyga jednolity rzeczowy wykaz akt tej szkoły, zatwierdzony przez Archiwum Państwowe. Do czasu weryfikacji traktuj je jak propozycję. Opis: docs/RETENTION.md.',
      'ad.ret.opsTitle': 'Klasy operacyjne a archiwalne',
      'ad.ret.opsText': 'Klasy operacyjne (rejestr zdarzeń, sesje, doręczenia push, powiadomienia, wiadomości, kody rejestracyjne) zadanie sprząta samo, według okna przesuwnego. Klasy archiwalne usuwa się wyłącznie przez brakowanie akt, czyli usunięcie dokumentacji, której minął okres przechowywania: lista → zatwierdzenie przez drugą osobę z sygnaturą zgody Archiwum Państwowego → wykonanie. Dane robocze programu (plan lekcji, słowniki, konta) nie mają okresu i nie są brakowane. Kategoria A i księga uczniów nie trafiają na listę nigdy.',
      'ad.ret.brak.title': 'Brakowanie akt',
      'ad.ret.brak.what': 'Brakowanie akt to usunięcie dokumentacji, której minął okres przechowywania — wolno je wykonać wyłącznie za pisemną zgodą właściwego Archiwum Państwowego. Listę układa jedna osoba, a zatwierdza druga.',
      'ad.ret.legend': 'Kategorie archiwalne: A — materiały archiwalne, przechowywane wieczyście i przekazywane do Archiwum Państwowego; B5, B20, B25, B50 — dokumentacja niearchiwalna przechowywana odpowiednio 5, 20, 25 i 50 lat; Bc — dokumentacja o krótkotrwałym znaczeniu praktycznym. JRWA to jednolity rzeczowy wykaz akt szkoły.',
      /* Protokoły wykonanych brakowań — wpis zamrożony, uwagi dopisuje się komentarzem obok. */
      'ad.ret.runsTitle': 'Wykonane brakowania',
      'ad.ret.runsSub': 'Protokół brakowania jest kategorią A — zostaje na zawsze i nie da się go zmienić. Uwagi do niego dopisuje się komentarzem obok; notatkę prywatną widzi wyłącznie jej autor.',
      'ad.ret.runsCaption': 'Protokoły brakowania i propozycje',
      'ad.ret.runsNone': 'Nie wykonano jeszcze żadnego brakowania.',
      'ad.ret.runsColAt': 'Data', 'ad.ret.runsColWhat': 'Zakres', 'ad.ret.runsColConsent': 'Zgoda archiwum', 'ad.ret.runsColComments': 'Komentarze',
      'ad.ret.runsWhat': 'usunięto {n} · komentarzy {lc}',
      'ad.ret.propsTitle': 'Propozycje brakowania',
      'ad.ret.propsNone': 'Nie ułożono jeszcze żadnej propozycji.',
      'ad.ret.propStatus': 'stan: {s} · pozycji: {n}',
      'ad.ret.uncoveredTitle': 'Kolekcje bez klasy dokumentacji',
      'ad.ret.uncoveredSome': 'Do żadnej klasy dokumentacji nie należy {n}: {list}. Te dane nie mają okresu przechowywania, nie są liczone w raporcie i nigdy nie trafią do brakowania. Przypisz im klasę albo zapisz decyzję, że są poza zakresem.',
      'ad.ret.uncoveredNone': 'Każda z {total} kolekcji w bazie należy do jakiejś klasy dokumentacji. Gdy przybędzie nowa bez klasy, pojawi się tutaj.',
      'ad.ret.brak.fourEyesTitle': 'Zatwierdza druga osoba',
      'ad.ret.brak.fourEyes': 'Kto ułożył listę, ten jej nie zatwierdzi. Poproś dyrektora albo drugiego administratora — zatwierdzenie wydaje jednorazowe potwierdzenie, bez którego brakowanie nie ruszy.',
      'ad.ret.brak.reasonHint': 'Ten tekst trafia dosłownie do protokołu brakowania i do rejestru zdarzeń, których nie da się później zmienić. Napisz, na jakiej podstawie i co brakujesz (minimum 5 znaków).',
      'ad.ret.brak.reasonRequired': 'Bez uzasadnienia brakowanie nie ruszy.',
      'ad.ret.brak.confirmTitle': 'Wykonać brakowanie?',
      'ad.ret.brak.confirmLead': 'Za chwilę zostanie trwale usuniętych {n} pozycji dokumentacji szkolnej z propozycji {id}:',
      'ad.ret.brak.confirmDo': 'Tak, brakuj akta',
      'ad.ret.brak.confirmWarnTitle': 'Tego nie da się cofnąć',
      'ad.ret.brak.confirmWarn': 'Usuniętych akt nie odtworzy ani kopia zapasowa sprzed brakowania, ani program. Protokół z liczbami, sygnaturą zgody i Twoim uzasadnieniem zostanie w rejestrze zdarzeń na stałe.',
      'ad.ret.brak.prepare': 'Przygotuj listę do brakowania',
      'ad.ret.brak.none': 'Na dziś żadna klasa archiwalna nie przekroczyła okresu przechowywania — nie ma czego brakować.',
      'ad.ret.brak.total': 'Do zbrakowania: {n} w {c} klasach dokumentacji. Numer propozycji: {id}.',
      'ad.ret.brak.consent': 'Sygnatura zgody Archiwum Państwowego',
      'ad.ret.brak.consentHint': 'Na przykład „AP Kraków, zgoda nr 17/2033 z 12.01.2033”. Bez niej brakowanie jest niedopuszczalne.',
      'ad.ret.brak.approve': 'Zatwierdź brakowanie',
      'ad.ret.brak.approved': 'Zatwierdzone — zgoda: {ref}',
      'ad.ret.brak.reason': 'Uzasadnienie do protokołu',
      'ad.ret.brak.execute': 'Wykonaj brakowanie',
      'ad.ret.brak.executed': 'Wykonano. Protokół nr {id} pozostaje w rejestrze zdarzeń.',
      'ad.ret.brak.blocked': 'Nigdy nie brakujemy: {list}.',
      'ad.ret.brak.approvedToast': 'Brakowanie zatwierdzone.',
      'ad.ret.brak.executedToast': 'Brakowanie wykonane.'
    },
    en: {
      'ad.title': 'Administration',
      'ad.sub': '{school} · school year {year} · as at {date}',
      'ad.tabsLabel': 'Administration sections',
      'ad.tab.year': 'School year and timetable',
      'ad.tab.security': 'Security and accounts',
      'ad.tab.data': 'Data and archive',
      'ad.loading': 'Loading…',
      'ad.popupBlocked': 'The browser blocked the new window — allow pop-ups to print the document.',

      'ad.year.titleBare': 'Structure of the school year',
      'ad.year.title': 'Structure of {year}',
      'ad.year.sub': 'Semesters, the winter break, holiday breaks and days free from teaching. Days off show up straight away in the timetable and in the test calendar.',
      'ad.year.from': 'Start',
      'ad.year.to': 'End',
      'ad.year.winter': 'Winter break',
      'ad.year.name': 'Name',
      'ad.year.fromShort': 'From',
      'ad.year.toShort': 'To',
      'ad.year.holidays': 'Holiday breaks',
      'ad.year.holidayName': 'Name of break {n}',
      'ad.year.daysOff': 'Additional days free from teaching',
      'ad.year.dayOffName': 'Name of day off {n}',
      'ad.year.removeDayOff': 'Remove the day off {name}',
      'ad.year.errorsTitle': 'The dates need fixing',
      'ad.year.addDayOff': 'Add a day off',
      'ad.year.save': 'Save the year structure',
      'ad.year.savedToast': 'Year structure saved.',
      'ad.year.savedLive': 'Year structure saved: {semesters}, {breaks} breaks, {daysOff} days off.',

      'ad.bells.title': 'Bell schedule',
      'ad.bells.hint': 'Every lesson number in the timetable needs a bell here — an aSc export is sometimes numbered from zero (“period 0”, usually 7:10). Times may not overlap and a number may appear only once.',
      'ad.bells.no': 'Lesson no.',
      'ad.bells.start': 'Starts',
      'ad.bells.end': 'Ends',
      'ad.bells.add': 'Add another lesson',
      'ad.bells.addZero': 'Add period 0 (7:10)',
      'ad.bells.remove': 'Remove lesson {no} from the bell schedule',
      'ad.year.anchorTitle': 'Two-week A/B cycle',
      'ad.year.anchor': 'First week A (anchor)',
      'ad.year.anchorHint': 'Empty = the first Monday of the school year ({anchor}). A school that starts the year in week II sets one date here instead of editing the timetable.',

      'ad.actions': 'Actions',
      'ad.subj.title': 'School subjects',
      'ad.subj.sub': 'The list the timetable, the staff records and the grades all use. The identifier never changes — the timetable and the grades hang on it. A subject something uses cannot be removed.',
      'ad.subj.name': 'Name',
      'ad.subj.id': 'Identifier',
      'ad.subj.idPlaceholder': 'e.g. wdz',
      'ad.subj.idHint': 'Empty = derived from the name. 2–24 characters: lower case, digits, dot, dash, underscore.',
      'ad.subj.short': 'Short code',
      'ad.subj.usage': 'In use',
      'ad.subj.usageText': '{timetable} in the timetable · {lessons} lessons · {teachers} teachers',
      'ad.subj.addTitle': 'Add a subject',
      'ad.subj.add': 'Add subject',
      'ad.subj.confirmDelete': 'Remove the subject “{name}”? Nothing uses it today.',
      'ad.subj.deleted': 'Subject “{name}” removed.',

      'ad.cls.title': 'Classes',
      'ad.cls.sub': 'A class can exist before the roll — the timetable publication usually arrives first in September. Only an empty class that nothing uses can be removed.',
      'ad.cls.name': 'Name',
      'ad.cls.id': 'Designation',
      'ad.cls.idHint': 'One or two digits for the level and a letter for the class, e.g. 7b.',
      'ad.cls.homeroom': 'Homeroom teacher',
      'ad.cls.noHomeroom': '— no homeroom teacher —',
      'ad.cls.usage': 'In use',
      'ad.cls.usageText': '{students} pupils · {timetable} in the timetable · {groups} groups',
      'ad.cls.addTitle': 'Add a class',
      'ad.cls.add': 'Add class',
      'ad.cls.confirmDelete': 'Remove the empty class {name}?',
      'ad.cls.deleted': 'Class {name} removed.',

      'ad.import.title': 'Timetable import',
      'ad.import.sub': 'Upload a file from aSc Timetables (XML) or an Optivum “Plan lekcji” publication (HTML); you can also paste CSV or JSON. The import is two-phase: a dry run with entity matching first, then the write. It overwrites neither lesson topics nor attendance.',
      'ad.import.data': 'Data from the timetabling program (CSV or JSON)',
      'ad.import.dataHint': 'An empty “group” column means a lesson with the whole class.',
      'ad.import.dry': 'Check (dry run)',
      'ad.import.apply': 'Import and replace the timetable',
      'ad.import.noConflicts': 'No conflicts',
      'ad.import.toDecide': '{n} to decide',
      'ad.import.doneTitle': 'Timetable imported',
      'ad.import.doneText': '{rows} lessons · {groups} group splits · {rooms} rooms · {teachers} teachers.',
      'ad.import.dryTitle': 'Dry run — nothing was saved',
      'ad.import.dryText': '{rows} lessons ready to save; they will replace {replacing} current timetable entries.',
      'ad.import.errorsTitle': '{n} invalid rows',
      'ad.import.conflicts': 'Import conflicts',
      'ad.import.colConflict': 'Conflict',
      'ad.import.colLesson': 'Lesson',
      'ad.import.colDetail': 'Details',
      'ad.import.kind.teacher': 'Teacher in two places',
      'ad.import.kind.room': 'Room already taken',
      'ad.import.kind.class': 'Class without a disjoint split',
      'ad.import.format': 'File format',
      'ad.import.formatAuto': 'Detect automatically',
      'ad.import.dropHint': 'Pick a file below (aSc XML, an Optivum HTML publication, CSV, JSON) or drop it here. A whole Optivum publication goes in as a folder.',
      'ad.import.pickFile': 'Timetable file',
      'ad.import.pickDir': 'Optivum publication folder',
      'ad.import.picked': 'Loaded: {name} ({n}).',
      'ad.import.filesN': '{n} files',
      'ad.import.filesRead': 'Read {n} files — now run the dry run.',
      'ad.import.noFiles': 'None of the chosen files is an XML, HTML, CSV or JSON file.',
      'ad.import.clearFile': 'Remove the loaded files',
      'ad.import.warningsTitle': 'Notes about the file ({n})',
      'ad.import.blockingTitle': '{n} entities without a local match',
      'ad.import.blockingText': 'Complete the matching in the table below or choose “skip”. While anything is undecided the import writes nothing.',
      'ad.import.weeksTitle': 'Two-week cycle',
      'ad.import.weeksText': 'Every week: {every} entries · week A: {a} · week B: {b}. Week A is counted from {anchor}.',
      'ad.import.weekMarkers': 'The week was detected heuristically from markers next to the subject name: {markers}. An Optivum publication has no week dimension of its own — check this before you save.',
      'ad.import.mapTitle': 'Matching the entities from the file ({tool} · {ref})',
      'ad.import.acceptExact': 'Accept all exact matches',
      'ad.import.acceptedExact': 'Accepted {n} exact matches. Press “Check again with this matching”.',
      'ad.import.recheck': 'Check again with this matching',
      'ad.import.skip': '— skip —',
      'ad.import.selectFor': 'Local match for: {name}',
      'ad.import.colForeign': 'In the file',
      'ad.import.colRows': 'Rows',
      'ad.import.colHow': 'Match',
      'ad.import.colLocal': 'Here',
      'ad.import.map.teachers': 'Teachers',
      'ad.import.map.classes': 'Classes',
      'ad.import.map.subjects': 'Subjects',
      'ad.import.map.rooms': 'Rooms',
      'ad.import.map.groups': 'Group splits',
      'ad.import.newTarget': '+ create it here',
      'ad.import.dataExample': 'Insert the example',
      'ad.import.applyBlocked': 'The button unlocks after a dry run with no conflicts and nothing left undecided.',
      'ad.import.createdTitle': 'Created by this import',
      'ad.import.createdText': 'Subjects: {subjects} · classes: {classes} · groups: {groups}. Group membership taken from the file is a proposal — check it under “Groups in a class”.',
      'ad.import.how.short': 'by short code',
      'ad.import.how.name': 'by name',
      'ad.import.how.key': 'by key',
      'ad.import.how.fuzzy': 'approximate',
      'ad.import.how.mapping': 'manual',
      'ad.import.how.ambiguous': 'ambiguous',
      'ad.import.how.unmatched': 'no local match',
      'ad.import.how.skipped': 'skipped',
      'ad.import.how.unknown_target': 'points at a missing record',
      'ad.import.how.create': 'will be created',
      'ad.import.how.verbatim': 'text from the file',
      'ad.import.kind.group': 'Group',

      'ad.sio.title': 'SIO package',
      'ad.sio.sub': 'An export of the class structure and student numbers that follows the technical specification of SIO (the national education information system). PESEL numbers go into the package only when the database is not anonymised.',
      'ad.sio.validate': 'Validate the package',
      'ad.sio.generate': 'Generate XML',
      'ad.sio.okLive': 'Validation passed with no errors: {classes} classes, {students} students.',
      'ad.sio.failLive': 'Validation finished with {n} errors; the package will not be saved.',
      'ad.sio.downloaded': 'SIO package generated and downloaded: {file}.',
      'ad.sio.downloadedToast': 'SIO package downloaded.',
      'ad.sio.readyTitle': 'The package is ready to send',
      'ad.sio.readyText': '{classes} classes · {students} students · 0 schema validation errors. Students per class: {perClass}.',
      'ad.sio.errorsTitle': 'Package validation: {n} errors',
      'ad.sio.errorsText': 'The package was not saved. Fix the entries listed below in the student register and generate the XML again.',

      'ad.staff.title': 'Staff accounts',
      'ad.staff.sub': 'Counsellor, psychologist, speech therapist, nurse, after-school care, cafeteria, library, DPO, registrar and a second administrator — the wizard only creates teachers, pupils and parents. A staff account is never deleted: deactivation cuts access while the logbook entries stay with their author.',
      'ad.staff.caption': 'School staff accounts',
      'ad.staff.colName': 'Member of staff',
      'ad.staff.colRole': 'Role',
      'ad.staff.colContact': 'Contact',
      'ad.staff.colStatus': 'Account',
      'ad.staff.colActions': 'Actions',
      'ad.staff.add': 'Add a staff account',
      'ad.staff.dialogTitle': 'New staff account',
      'ad.staff.role': 'Role',
      'ad.staff.firstName': 'First name',
      'ad.staff.lastName': 'Last name',
      'ad.staff.titleField': 'Title (e.g. mgr)',
      'ad.staff.login': 'Login',
      'ad.staff.loginHint': 'Empty = initial plus surname. 3–32 characters, lower case, digits and dots.',
      'ad.staff.email': 'Work e-mail',
      'ad.staff.phone': 'Phone',
      'ad.staff.subjects': 'Subjects (teachers only)',
      'ad.staff.homeroom': 'Homeroom class',
      'ad.staff.homeroomNone': 'no homeroom',
      'ad.staff.create': 'Create the account',
      'ad.staff.pwTitle': 'One-time password — shown once only',
      'ad.staff.pwNote': 'Hand it over by a channel other than e-mail. The first sign-in requires a change that meets the complexity policy.',
      'ad.staff.pwClose': 'I have saved the password',
      'ad.staff.keys': 'Key pair for confidential notes',
      'ad.staff.mustChange': 'Password change at sign-in',
      'ad.staff.blocked': 'Blocked',
      'ad.staff.active': 'Active',
      'ad.staff.homeroomOf': 'homeroom {cls}',
      'ad.staff.deactivate': 'Deactivate',
      'ad.staff.deactivateAria': 'Deactivate the account of {name}',
      'ad.staff.restore': 'Restore',
      'ad.staff.restoreAria': 'Restore the account of {name}',
      'ad.staff.reasonTitle': 'Deactivating the account of {name}',
      'ad.staff.reason': 'Legal basis (e.g. end of contract)',
      'ad.staff.reasonNote': 'The account stays in the database and loses access at once, in the mobile app too. Logbook entries are left untouched.',
      'ad.staff.lastAdmin': 'This is the only active administrator account — create or unblock another one first.',
      'ad.staff.created': 'Account created: {name} ({login}).',
      'ad.staff.deactivated': 'Account deactivated: {name}.',
      'ad.staff.restored': 'Account restored: {name}.',
      'ad.staff.live': 'Staff accounts: {n}, active administrators: {admins}.',
      'ad.staff.loading': 'Loading staff accounts…',
      'ad.reset.title': 'Password reset',
      'ad.reset.sub': 'The one-time password is shown only once — hand it over through a channel other than e-mail.',
      'ad.reset.account': 'User account',
      'ad.reset.do': 'Reset and force a change',
      'ad.reset.badge': 'A change is required at sign-in',
      'ad.reset.policy': 'The complexity policy checked on change: at least 12 characters, an upper and a lower case letter, a digit and a special character. Until the password is changed, the rest of the logbook stays locked.',
      'ad.reset.toast': 'Password reset.',
      'ad.reset.live': 'Password reset: {name} ({login}). A password change is required at the next sign-in.',

      'ad.totp.title': 'Two-factor authentication (TOTP)',
      'ad.totp.sub': 'The requirement covers everyone allowed to edit grades and attendance: {roles}.',
      'ad.totp.switch': 'Require 2FA for everyone who edits grades and attendance',
      'ad.totp.off': 'off',
      'ad.totp.on': 'on',
      'ad.totp.warnTitle': 'The second factor is not required',
      'ad.totp.warnText': 'Grades and attendance can be edited with a password alone. This setting departs from the school security policy.',
      'ad.totp.colPerson': 'Person',
      'ad.totp.colRights': 'Rights',
      'ad.totp.homeroomOf': 'homeroom teacher of {cls}',
      'ad.totp.enabled': '2FA on',
      'ad.totp.pending': 'Waiting to be paired',
      'ad.totp.notRequired': 'Not required',
      'ad.totp.caption': 'State of 2FA across the staff',
      'ad.totp.live.one': '{n} person still has to pair an authenticator app.',
      'ad.totp.live.other': '{n} people still have to pair an authenticator app.',

      'ad.msg.title': 'Messaging permissions',
      'ad.msg.legend': 'Parents may write to',
      'ad.msg.all': 'all teachers',
      'ad.msg.allHint': 'Every parent sees the whole staff in the recipient list.',
      'ad.msg.limited': 'the homeroom teacher and subject teachers only',
      'ad.msg.limitedHint': 'The recipient list is limited to the people who teach the child; the school office and the principal stay available.',
      'ad.msg.live': 'The setting takes effect the next time a parent signs in.',
      'ad.msg.saved': 'Saved: {message}',
      'ad.msg.savedToast': 'Messaging permissions saved.',

      'ad.codes.title': 'Registration codes for parents of first-year classes',
      'ad.codes.sub': 'A code is single-use, ties the parent account to one student and expires after 30 days. The parent creates the account themselves, through the public registration form.',
      'ad.codes.class': 'Class',
      'ad.codes.generate': 'Generate the codes',
      'ad.codes.print': 'Print the list for envelopes',
      'ad.codes.printed': 'The list of codes was sent to the printer — the codes are handed out in sealed envelopes.',
      'ad.codes.unusedBadge': '{n} unused',
      'ad.codes.colCode': 'Registration code',
      'ad.codes.colValidTo': 'Valid until',
      'ad.codes.used': 'Used {date}',
      'ad.codes.unused': 'Unused',
      'ad.codes.caption': 'Registration codes',
      'ad.codes.none': 'No codes have been generated yet.',

      'ad.ip.titleBare': 'IP allowlist',
      'ad.ip.title': 'IP allowlist (administrative sign-ins)',
      'ad.ip.sub': 'The restriction applies to administrative accounts. Teachers, parents and students sign in with no address restriction. Your address: {ip}.',
      'ad.ip.field': 'IP address or range',
      'ad.ip.error': 'Enter an IPv4 address (e.g. 193.219.28.14) or a range in CIDR notation (e.g. 10.12.0.0/24).',
      'ad.ip.hint': 'IPv4 or CIDR · examples from the configuration: {examples}',
      'ad.ip.colAddress': 'Address or range',
      'ad.ip.colActions': 'Actions',
      'ad.ip.remove': 'Remove the address {ip} from the allowlist',
      'ad.ip.caption': 'IP allowlist',
      'ad.ip.emptyTitle': 'The list is empty',
      'ad.ip.emptyText': 'Administrative sign-ins are not restricted by IP address. Add at least the school network address.',

      'ad.anon.title': 'Anonymising the test copy',
      'ad.anon.sub': 'A copy of the database for the test environment. Pseudonyms are computed deterministically (SHA-256), so the same student gets the same pseudonym in every copy.',
      'ad.anon.run': 'Run the anonymisation and download',
      'ad.anon.badge': 'Data anonymised',
      'ad.anon.doneTitle': 'The test copy has been anonymised',
      'ad.anon.doneText': '{replaced} identifying values were replaced; {audit} audit-trail entries were kept. The copy carries the “anonymised” marker, so the test environment header reads “Data anonymised”.',
      'ad.anon.idle': 'Without anonymisation, a copy holding student data cannot be used in the test environment.',
      'ad.anon.toast': 'The copy was anonymised and downloaded.',
      'ad.anon.dialogTitle': 'Run the anonymisation of the test copy?',
      'ad.anon.confirm': 'Anonymise',
      'ad.anon.p1': 'These will be replaced: first and last names, PESEL and passport numbers, home addresses, phone numbers, e-mail addresses and the content of messages and confidential notes.',
      'ad.anon.p2': 'These will be kept: grades, attendance, lesson topics, the class structure and the audit trail, so that tests mirror production traffic.',
      'ad.anon.p3': 'The production database is not changed — a separate file is produced for download.',

      'ad.push.title': 'Push notifications to phones',
      'ad.push.sub': 'Web Push with no middleman: the content is encrypted with the device key, and the push service carries ciphertext only.',
      'ad.push.switch': 'Send notifications to phones',
      'ad.push.hint': 'Once on, the logbook generates its own VAPID keys and sends urgent notifications (an absence in lesson 1, for example) to the devices that agreed to receive them. HTTPS is required.',
      'ad.push.subject': 'Contact for the push service (VAPID)',
      'ad.push.subjectHint': 'The “mailto:…” address the push provider uses to report a delivery problem. Required by RFC 8292.',
      'ad.push.devices': 'Devices: {n}',
      'ad.push.sent': 'Delivered: {n}',
      'ad.push.failed': 'Failed: {n}',
      'ad.push.queued': 'Queued: {n}',
      'ad.push.on': 'Push notifications are on for this school.',
      'ad.push.off': 'Push notifications are off — nothing leaves the school server.',
      'ad.push.privacy': 'A notification carries only a title, the text you also see in the logbook and a link. A message subject is replaced with a neutral sentence, and support-team or nurse notes are never sent. Details: docs/PUSH.md.',

      'ad.ret.title': 'Log retention',
      'ad.ret.sub': 'The period runs from the end of the school year in which the entry was made.',
      'ad.ret.select': 'Retention period for system logs',
      'ad.ret.opt2': '2 years (below the statutory minimum \u2014 cannot be saved)',
      'ad.ret.opt5': '5 years (technical logs and sign-in logs)',
      'ad.ret.opt10': '10 years (lesson logbook, attendance)',
      'ad.ret.opt50': '50 years (transcripts of records and the student register)',
      'ad.ret.hint': 'The minimum required by law: {n} years. A shorter period will be rejected.',
      'ad.ret.worm': 'Immutable (WORM)',
      'ad.ret.archive': 'Transcripts of records and the student register: {n} years',
      'ad.ret.reportTitle': 'Retention report — the job deletes nothing',
      'ad.ret.reportText': '{would} of {total} audit entries would exceed the {years}-year period (cut-off {cutoff}). Deleting them requires a separate decision and a disposal record.',
      'ad.ret.savedToast': 'Retention policy saved.',

      'ad.ret.classesTitle': 'Record classes and archival categories',
      'ad.ret.classesCaption': 'Retention periods by JRWA archival category',
      'ad.ret.colClass': 'Record class',
      'ad.ret.colCategory': 'Category',
      'ad.ret.colRule': 'Rule',
      'ad.ret.colDue': 'Entries past due',
      'ad.ret.colNext': 'Next deadline',
      'ad.ret.colVerified': 'Verification',
      'ad.ret.kind.archival': 'archival',
      'ad.ret.kind.operational': 'operational',
      'ad.ret.verifiedYes': 'matches a cited legal basis',
      'ad.ret.verifiedNo': 'check against the school\u2019s records schedule (JRWA)',
      'ad.ret.never': 'never deleted',
      'ad.ret.unverifiedTitle': 'These categories still need the school\u2019s own records schedule',
      'ad.ret.unverifiedText': '{n} of {total} record classes are unconfirmed. The defaults come from a model JRWA and from the research report; what decides is this school\u2019s own records schedule (JRWA) approved by the State Archive. Until then treat them as a proposal. See docs/RETENTION.md.',
      'ad.ret.opsTitle': 'Operational versus archival classes',
      'ad.ret.opsText': 'Operational classes (audit log, sessions, push deliveries, notifications, messages, registration codes) are swept automatically on a rolling window. Archival classes are only ever removed through records disposal (\u201Cbrakowanie\u201D \u2014 removing documentation whose retention period has ended): a proposal, a second person\u2019s approval with the State Archive consent reference, then execution. The program\u2019s working data (timetable, dictionaries, accounts) has no period and is never disposed of. Category A and the student register never reach the list.',
      'ad.ret.brak.title': 'Records disposal (brakowanie)',
      'ad.ret.brak.what': 'Records disposal (\u201Cbrakowanie\u201D) is the removal of documentation whose retention period has ended. It is lawful only with the written consent of the competent State Archive. One person prepares the list; a different one approves it.',
      'ad.ret.legend': 'Archival categories: A \u2014 archival material, kept for ever and transferred to the State Archive; B5, B20, B25, B50 \u2014 non-archival documentation kept for 5, 20, 25 and 50 years; Bc \u2014 documentation of short-term practical value. JRWA is the school\u2019s own records schedule.',
      'ad.ret.runsTitle': 'Completed disposals',
      'ad.ret.runsSub': 'A disposal record is category A — it stays for ever and cannot be changed. Remarks go beside it as a comment; a private note is visible only to its author.',
      'ad.ret.runsCaption': 'Disposal records and proposals',
      'ad.ret.runsNone': 'No disposal has been carried out yet.',
      'ad.ret.runsColAt': 'Date', 'ad.ret.runsColWhat': 'Scope', 'ad.ret.runsColConsent': 'Archive consent', 'ad.ret.runsColComments': 'Comments',
      'ad.ret.runsWhat': 'removed {n} · comments {lc}',
      'ad.ret.propsTitle': 'Disposal proposals',
      'ad.ret.propsNone': 'No proposal has been prepared yet.',
      'ad.ret.propStatus': 'status: {s} · items: {n}',
      'ad.ret.uncoveredTitle': 'Collections with no record class',
      'ad.ret.uncoveredSome': '{n} collection(s) belong to no record class: {list}. That data has no retention period, is not counted in the report and will never be proposed for disposal. Give it a class, or record the decision that it is out of scope.',
      'ad.ret.uncoveredNone': 'All {total} collections in the store belong to a record class. A new one without a class will show up here.',
      'ad.ret.brak.fourEyesTitle': 'A second person approves',
      'ad.ret.brak.fourEyes': 'Whoever prepared the list cannot approve it. Ask the head teacher or a second administrator \u2014 approval issues a one-time confirmation, and without it disposal will not run.',
      'ad.ret.brak.reasonHint': 'This text goes verbatim into the disposal record and into the audit log, neither of which can be changed afterwards. State on what basis and what you are disposing of (at least 5 characters).',
      'ad.ret.brak.reasonRequired': 'Without a justification the disposal will not run.',
      'ad.ret.brak.confirmTitle': 'Run the disposal?',
      'ad.ret.brak.confirmDo': 'Yes, dispose of these records',
      'ad.ret.brak.confirmLead': '{n} items of school documentation from proposal {id} are about to be destroyed permanently:',
      'ad.ret.brak.confirmWarnTitle': 'This cannot be undone',
      'ad.ret.brak.confirmWarn': 'Neither a backup taken before the run nor the program can bring the records back. The record of the run \u2014 the counts, the consent reference and your justification \u2014 stays in the audit log for good.',
      'ad.ret.brak.prepare': 'Prepare the disposal list',
      'ad.ret.brak.none': 'Nothing is past its retention period today \u2014 there is nothing to dispose of.',
      'ad.ret.brak.total': 'Due for disposal: {n} across {c} record classes. Proposal number: {id}.',
      'ad.ret.brak.consent': 'State Archive consent reference',
      'ad.ret.brak.consentHint': 'For example \u201cAP Krak\u00f3w, consent 17/2033 of 12.01.2033\u201d. Without it disposal is not allowed.',
      'ad.ret.brak.approve': 'Approve the disposal',
      'ad.ret.brak.approved': 'Approved \u2014 consent: {ref}',
      'ad.ret.brak.reason': 'Justification for the protocol',
      'ad.ret.brak.execute': 'Run the disposal',
      'ad.ret.brak.executed': 'Done. Protocol {id} stays in the audit log.',
      'ad.ret.brak.blocked': 'Never disposed of: {list}.',
      'ad.ret.brak.approvedToast': 'Disposal approved.',
      'ad.ret.brak.executedToast': 'Disposal executed.'
    }
  });

  function openPrint(html) {
    var w = window.open('', '_blank');
    if (!w) { A.toast(A.t('ad.popupBlocked'), 'danger'); return; }
    w.document.open(); w.document.write(html); w.document.close(); w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 300);
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  /* U3-28 — każda karta na tym ekranie miała tytuł `h3`, a jedynym innym nagłówkiem był `h1` ekranu:
     nawigacja po nagłówkach przeskakiwała poziom na każdej karcie (axe `heading-order`, 12 wystąpień).
     Tytuł karty to `h2`; nagłówki wewnątrz karty schodzą na `h3`. */
  function Card(p) {
    return h('section', { className: 'card', 'aria-labelledby': p.id },
      p.title && h('h2', { id: p.id, className: 'heading' }, p.title),
      p.sub && h('p', { className: 'muted' }, p.sub),
      h('div', { className: 'stack' }, p.children));
  }
  function Live(p) { return h('p', { className: 'muted', role: 'status' }, p.children); }

  /* ------------------------------------------------------------- struktura roku (3.5.4) */
  function StrukturaRoku() {
    var api = A.useApi('/api/admin/year', []);
    var s0 = React.useState(null), form = s0[0], setForm = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var s2 = React.useState([]), errors = s2[0], setErrors = s2[1];
    React.useEffect(function () { if (api.data) setForm(JSON.parse(JSON.stringify(api.data))); }, [api.data]);
    if (!form) return h(Card, { id: 'rok', title: A.t('ad.year.titleBare') }, h('p', { className: 'muted' }, A.t('ad.loading')));

    function setSem(i, k, v) { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.semesters[i][k] = v; return n; }); setSaid(''); }
    function setBreak(i, k, v) { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.holidays[i][k] = v; return n; }); setSaid(''); }
    function setWinter(k, v) { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.winterBreak = Object.assign({}, n.winterBreak); n.winterBreak[k] = v; return n; }); setSaid(''); }
    function setDay(i, k, v) { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.daysOff[i][k] = v; return n; }); setSaid(''); }
    function setBell(i, k, v) { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.lessonTimes[i][k] = v; return n; }); setSaid(''); }
    function save() {
      setErrors([]);
      A.api.patch('/api/admin/year', { semesters: form.semesters, winterBreak: form.winterBreak, holidays: form.holidays, daysOff: form.daysOff, lessonTimes: form.lessonTimes, weekCycleAnchor: form.weekCycleAnchor || null }).then(function (r) {
        setSaid(A.t('ad.year.savedLive', {
          semesters: r.semesters.map(function (s) { return s.name + ' ' + A.fmtDate(s.from) + '–' + A.fmtDate(s.to); }).join(', '),
          breaks: r.holidays.length, daysOff: r.daysOff.length
        }));
        A.toast(A.t('ad.year.savedToast'), 'success'); api.reload();
      }).catch(function (e) { setErrors((e.data && e.data.errors) || [e.message]); A.toast(e.message, 'danger'); });
    }
    return h(Card, { id: 'rok', title: A.t('ad.year.title', { year: form.year }), sub: A.t('ad.year.sub') },
      h('div', { className: 'grid-2' }, form.semesters.map(function (s, i) {
        return h('div', { key: s.id, className: 'stack', style: { gap: 'var(--space-2)' } },
          h('p', { className: 'body-strong' }, s.name),
          h(E.TextField, Object.assign({ label: A.t('ad.year.from'), type: 'date', value: s.from, onChange: function (e) { setSem(i, 'from', e.target.value); }, hint: A.dateHint(s.from) }, A.dateInputProps())),
          h(E.TextField, Object.assign({ label: A.t('ad.year.to'), type: 'date', value: s.to, onChange: function (e) { setSem(i, 'to', e.target.value); }, hint: A.dateHint(s.to) }, A.dateInputProps())));
      })),
      h('p', { className: 'body-strong' }, A.t('ad.year.winter')),
      h('div', { className: 'grid-3' },
        h(E.TextField, { label: A.t('ad.year.name'), value: (form.winterBreak && form.winterBreak.name) || A.t('ad.year.winter'), onChange: function (e) { setWinter('name', e.target.value); } }),
        h(E.TextField, Object.assign({ label: A.t('ad.year.fromShort'), type: 'date', value: form.winterBreak ? form.winterBreak.from : '', onChange: function (e) { setWinter('from', e.target.value); }, hint: A.dateHint(form.winterBreak ? form.winterBreak.from : '') }, A.dateInputProps())),
        h(E.TextField, Object.assign({ label: A.t('ad.year.toShort'), type: 'date', value: form.winterBreak ? form.winterBreak.to : '', onChange: function (e) { setWinter('to', e.target.value); }, hint: A.dateHint(form.winterBreak ? form.winterBreak.to : '') }, A.dateInputProps()))),
      h('p', { className: 'body-strong' }, A.t('ad.year.holidays')),
      form.holidays.map(function (b, i) {
        return h('div', { className: 'grid-3', key: i },
          h(E.TextField, { label: A.t('ad.year.holidayName', { n: i + 1 }), value: b.name || '', onChange: function (e) { setBreak(i, 'name', e.target.value); } }),
          h(E.TextField, Object.assign({ label: A.t('ad.year.fromShort'), type: 'date', value: b.from, onChange: function (e) { setBreak(i, 'from', e.target.value); }, hint: A.dateHint(b.from) }, A.dateInputProps())),
          h(E.TextField, Object.assign({ label: A.t('ad.year.toShort'), type: 'date', value: b.to, onChange: function (e) { setBreak(i, 'to', e.target.value); }, hint: A.dateHint(b.to) }, A.dateInputProps())));
      }),
      /* OPS3-03 — plan dzwonków. Szkoła z „godziną zerową” (7:10, realny kształt eksportów aSc) nie
         mogła wgrać planu: komunikat importu odsyłał do ustawień, a ustawienia nie miały tego pola —
         jedyną drogą było ręczne przepisanie pliku data/school/config.json. */
      h('h3', { className: 'subheading' }, A.t('ad.bells.title')),
      h('p', { className: 'muted' }, A.t('ad.bells.hint')),
      (form.lessonTimes || []).map(function (bell, i) {
        return h('div', { className: 'grid-3', key: i },
          h(E.TextField, { label: A.t('ad.bells.no'), type: 'number', mono: true, value: String(bell.no), onChange: function (e) { setBell(i, 'no', e.target.value === '' ? '' : +e.target.value); } }),
          h(E.TextField, { label: A.t('ad.bells.start'), type: 'time', mono: true, value: bell.start, onChange: function (e) { setBell(i, 'start', e.target.value); } }),
          h('div', { className: 'row' },
            h(E.TextField, { label: A.t('ad.bells.end'), type: 'time', mono: true, value: bell.end, onChange: function (e) { setBell(i, 'end', e.target.value); } }),
            h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', iconOnly: true, label: A.t('ad.bells.remove', { no: bell.no }), onClick: function () { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.lessonTimes.splice(i, 1); return n; }); setSaid(''); } })));
      }),
      h('div', { className: 'row' },
        h(E.Button, { size: 'sm', icon: 'plus', onClick: function () { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); var last = n.lessonTimes[n.lessonTimes.length - 1] || { no: 0, end: '08:00' }; n.lessonTimes.push({ no: (+last.no || 0) + 1, start: last.end, end: last.end }); return n; }); setSaid(''); } }, A.t('ad.bells.add')),
        !(form.lessonTimes || []).some(function (x) { return +x.no === 0; }) && h(E.Button, { size: 'sm', icon: 'plus', onClick: function () { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.lessonTimes.unshift({ no: 0, start: '07:10', end: '07:55' }); return n; }); setSaid(''); } }, A.t('ad.bells.addZero'))),
      h('h3', { className: 'subheading' }, A.t('ad.year.anchorTitle')),
      h('div', { className: 'grid-2' },
        h(E.TextField, Object.assign({ label: A.t('ad.year.anchor'), type: 'date', value: form.weekCycleAnchor || '', hint: A.t('ad.year.anchorHint', { anchor: A.fmtDate(form.weekAnchor || '') }), onChange: function (e) { setForm(function (f) { return Object.assign({}, f, { weekCycleAnchor: e.target.value }); }); setSaid(''); } }, A.dateInputProps()))),
      h('p', { className: 'body-strong' }, A.t('ad.year.daysOff')),
      form.daysOff.map(function (dd, i) {
        return h('div', { className: 'grid-2', key: i },
          h(E.TextField, { label: A.t('ad.year.dayOffName', { n: i + 1 }), value: dd.name || '', onChange: function (e) { setDay(i, 'name', e.target.value); } }),
          h('div', { className: 'row' },
            h(E.TextField, Object.assign({ label: A.t('common.date'), type: 'date', value: dd.date, onChange: function (e) { setDay(i, 'date', e.target.value); }, hint: A.dateHint(dd.date) }, A.dateInputProps())),
            h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', iconOnly: true, label: A.t('ad.year.removeDayOff', { name: dd.name || dd.date }), onClick: function () { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.daysOff.splice(i, 1); return n; }); setSaid(''); } })));
      }),
      errors.length > 0 && h(E.Alert, { tone: 'danger', title: A.t('ad.year.errorsTitle') }, h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, errors.map(function (t, i) { return h('li', { key: i }, t); }))),
      h('div', { className: 'row' },
        h(E.Button, { icon: 'plus', onClick: function () { setForm(function (f) { var n = JSON.parse(JSON.stringify(f)); n.daysOff.push({ date: '', name: '' }); return n; }); } }, A.t('ad.year.addDayOff')),
        h(E.Button, { variant: 'primary', icon: 'check', onClick: save }, A.t('ad.year.save'))),
      h(Live, null, said));
  }

  /* ------------------------------------------------------------ import planu lekcji (3.5.5) */
  /* R1 — dwufazowy import prawdziwych formatów: wklejony CSV/JSON albo plik z aSc (XML) / publikacja
     Optivum (HTML, także cały katalog). Próbny przebieg zwraca propozycję dopasowania encji, którą
     człowiek poprawia w tabeli, i dopiero potem zapisuje. docs/IMPORT.md */
  var MAP_KINDS = ['teachers', 'classes', 'subjects', 'rooms', 'groups'];
  var CREATABLE = ['subjects', 'classes', 'groups'];      // OPS3-02/04/14: „załóż u nas” wprost z tabeli
  function ImportPlanu() {
    var fmt = A.useApi('/api/admin/timetable/format', []);
    var s0 = React.useState(''), csv = s0[0], setCsv = s0[1];
    var s1 = React.useState(null), report = s1[0], setReport = s1[1];
    var s2 = React.useState(''), said = s2[0], setSaid = s2[1];
    var s3 = React.useState('auto'), format = s3[0], setFormat = s3[1];
    var s4 = React.useState(null), files = s4[0], setFiles = s4[1];        // { name, count, payload }
    var s5 = React.useState(null), mapping = s5[0], setMapping = s5[1];
    var s6 = React.useState(false), busy = s6[0], setBusy = s6[1];
    var s7 = React.useState(false), over = s7[0], setOver = s7[1];
    /* U3-21 — przykład był **wartością** pola, nie podpowiedzią: administrator otwierał kartę,
       naciskał „Sprawdź”, widział „3 lekcje gotowe do zapisu” i „Zaimportuj i zastąp plan” zastępował
       cały plan szkoły trzema wierszami z przykładu. Przykład jest teraz placeholderem, a wstawia go
       osobny przycisk. */
    var example = (fmt.data && fmt.data.example) || '';

    function readFiles(list) {
      var arr = Array.prototype.slice.call(list || []).filter(function (f) { return /\.(xml|html?|csv|json)$/i.test(f.name); });
      if (!arr.length) { A.toast(A.t('ad.import.noFiles'), 'danger'); return; }
      Promise.all(arr.map(function (f) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res({ path: f.webkitRelativePath || f.name, data: String(fr.result).split(',').pop() }); };
          fr.readAsDataURL(f);
        });
      })).then(function (out) {
        var payload = {};
        out.forEach(function (x) { payload[x.path] = x.data; });
        setFiles({ name: out.length === 1 ? out[0].path : A.t('ad.import.filesN', { n: out.length }), count: out.length, payload: payload, single: out.length === 1 ? out[0].data : null });
        setReport(null); setMapping(null);
        setSaid(A.t('ad.import.filesRead', { n: out.length }));
      });
    }

    function body(dryRun) {
      var b = { dryRun: dryRun, format: format === 'auto' ? undefined : format };
      if (files) { if (files.count === 1) { b.dataBase64 = files.single; b.ref = files.name; } else { b.files = files.payload; b.ref = files.name; } }
      else b.data = csv;
      if (mapping) b.mapping = mapping;
      if (!dryRun) b.force = true;
      return b;
    }
    function run(dryRun) {
      setBusy(true);
      A.api.post('/api/admin/timetable/import', body(dryRun)).then(function (r) {
        setBusy(false); setReport(r); setSaid(r.message);
        if (r.mapping && !mapping) setMapping(r.mapping);
        if (!dryRun) { A.toast(r.message, 'success'); setMapping(null); }
      }).catch(function (e) {
        setBusy(false);
        setReport(Object.assign({ ok: false, applied: false, rows: 0, conflicts: [], errors: [] }, e.data || {}));
        if (e.data && e.data.mapping && !mapping) setMapping(e.data.mapping);
        setSaid(e.message); A.toast(e.message, 'danger');
      });
    }
    function setMap(kind, key, value) {
      setMapping(function (prev) {
        var next = JSON.parse(JSON.stringify(prev || {}));
        next[kind] = next[kind] || {};
        /* Dla sal puste pole znaczy „skasuj numer sali” (jawne ""), a nie „pomiń” — reszta encji
           używa `null` jako świadomej decyzji „pomiń wiersze tej encji”. */
        next[kind][key] = kind === 'rooms' ? String(value == null ? '' : value) : (value || null);
        return next;
      });
    }
    function acceptExact() {
      var prop = report && report.proposal; if (!prop) return;
      var next = JSON.parse(JSON.stringify(mapping || {}));
      var n = 0;
      MAP_KINDS.forEach(function (kind) {
        next[kind] = next[kind] || {};
        (prop[kind] || []).forEach(function (ent) {
          if (['short', 'name', 'key'].indexOf(ent.how) >= 0 && ent.matched) { next[kind][ent.key] = ent.matched; n++; }
        });
      });
      setMapping(next); setSaid(A.t('ad.import.acceptedExact', { n: n }));
    }

    var conflicts = (report && report.conflicts) || [], errors = (report && report.errors) || [];
    var warnings = (report && report.warnings) || [];
    var proposal = report && report.proposal;
    var blocking = (proposal && proposal.blocking) || [];
    var formatOptions = [{ value: 'auto', label: A.t('ad.import.formatAuto') }].concat(((fmt.data && fmt.data.formats) || []).map(function (f) { return { value: f.id, label: f.name }; }));

    function mapTable(kind) {
      var list = (proposal && proposal[kind]) || [];
      if (!list.length) return null;
      var options = [{ value: '', label: A.t('ad.import.skip') }]
        .concat(CREATABLE.indexOf(kind) >= 0 ? [{ value: '@new', label: A.t('ad.import.newTarget') }] : [])
        .concat(((proposal.options && proposal.options[kind]) || []).map(function (o) { return { value: o.id, label: o.label }; }));
      return h(E.Table, {
        key: kind, caption: A.t('ad.import.map.' + kind), stack: true,
        columns: [
          { key: 'label', title: A.t('ad.import.colForeign'), render: function (r) { var base = r.short && r.short !== r.label ? r.label + ' (' + r.short + ')' : r.label; return r.classId ? r.classId + ' · ' + base : base; } },
          { key: 'rows', title: A.t('ad.import.colRows') },
          { key: 'how', title: A.t('ad.import.colHow'), render: function (r) {
            var tone = r.matched ? (['short', 'name', 'key'].indexOf(r.how) >= 0 ? 'success' : 'info') : 'warning';
            return h(E.Badge, { tone: tone, icon: r.matched ? 'check' : 'alert-circle' }, A.t('ad.import.how.' + r.how));
          } },
          { key: 'matched', title: A.t('ad.import.colLocal'), render: function (r) {
            var value = mapping && mapping[kind] && mapping[kind][r.key] != null ? mapping[kind][r.key] : (r.how === 'create' ? '@new' : (r.matched || ''));
            /* Sala to wolny tekst: pole pokazuje to, co pojedzie do planu — dopasowanie albo tekst z
               pliku. Puste pole (jawne „”) kasuje numer sali; `null` w mapowaniu znaczy „zostaw plik”. */
            if (kind === 'rooms') return h(E.TextField, { label: '', 'aria-label': A.t('ad.import.selectFor', { name: r.label }), value: value || r.key, onChange: function (e) { setMap(kind, r.key, e.target.value); } });
            return h(E.Select, { label: '', 'aria-label': A.t('ad.import.selectFor', { name: r.label }), value: value || '', options: options, onChange: function (e) { setMap(kind, r.key, e.target.value); } });
          } }],
        rows: list.map(function (x, i) { return Object.assign({ id: kind + i }, x); })
      });
    }

    return h(Card, { id: 'import', title: A.t('ad.import.title'), sub: A.t('ad.import.sub', { format: fmt.data ? fmt.data.format : '' }) },
      h('div', { className: 'row' },
        h(E.Select, { label: A.t('ad.import.format'), value: format, width: 260, options: formatOptions, onChange: function (e) { setFormat(e.target.value); setReport(null); setMapping(null); } })),
      h('div', {
        className: 'card', style: { padding: 'var(--space-4)', outline: over ? '2px dashed var(--color-accent, currentColor)' : 'none' },
        onDragOver: function (e) { e.preventDefault(); setOver(true); },
        onDragLeave: function () { setOver(false); },
        onDrop: function (e) { e.preventDefault(); setOver(false); readFiles(e.dataTransfer && e.dataTransfer.files); }
      },
        h('p', { className: 'muted', style: { margin: '0 0 var(--space-2)' } }, A.t('ad.import.dropHint')),
        h('div', { className: 'row' },
          h('label', { htmlFor: 'tt-file' }, A.t('ad.import.pickFile')),
          h('input', { id: 'tt-file', type: 'file', multiple: true, accept: '.xml,.html,.htm,.csv,.json', onChange: function (e) { readFiles(e.target.files); } })),
        h('div', { className: 'row' },
          h('label', { htmlFor: 'tt-dir' }, A.t('ad.import.pickDir')),
          h('input', { id: 'tt-dir', type: 'file', multiple: true, webkitdirectory: '', directory: '', onChange: function (e) { readFiles(e.target.files); } })),
        files && h('p', { className: 'body-strong' }, A.t('ad.import.picked', { name: files.name, n: files.count }))),
      !files && h(E.TextField, { label: A.t('ad.import.data'), multiline: 8, mono: true, value: csv, placeholder: example, onChange: function (e) { setCsv(e.target.value); setReport(null); setMapping(null); }, hint: A.t('ad.import.dataHint') }),
      !files && example && h(E.Button, { size: 'sm', variant: 'quiet', icon: 'plus', onClick: function () { setCsv(example); setReport(null); setMapping(null); } }, A.t('ad.import.dataExample')),
      files && h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', onClick: function () { setFiles(null); setReport(null); setMapping(null); } }, A.t('ad.import.clearFile')),
      h('div', { className: 'row' },
        h(E.Button, { icon: 'search', disabled: busy, onClick: function () { run(true); } }, A.t('ad.import.dry')),
        h(E.Button, { variant: 'primary', icon: 'download', disabled: busy || !report || !report.ok, onClick: function () { run(false); } }, A.t('ad.import.apply')),
        report && h(E.Badge, { tone: report.ok ? 'success' : 'danger', icon: report.ok ? 'check' : 'alert-circle' }, report.ok ? A.t('ad.import.noConflicts') : A.t('ad.import.toDecide', { n: conflicts.length + errors.length + blocking.length }))),
      (!report || !report.ok) && h('p', { className: 'muted', style: { margin: 0 } }, A.t('ad.import.applyBlocked')),
      report && report.applied && h(E.Alert, { tone: 'success', title: A.t('ad.import.doneTitle') }, A.t('ad.import.doneText', { rows: report.rows, groups: report.groups, rooms: report.rooms, teachers: report.teachers })),
      report && report.created && (report.created.subjects.length + report.created.classes.length + report.created.groups.length) > 0 &&
        h(E.Alert, { tone: 'info', title: A.t('ad.import.createdTitle') }, A.t('ad.import.createdText', { subjects: report.created.subjects.join(', ') || '—', classes: report.created.classes.join(', ') || '—', groups: report.created.groups.join(', ') || '—' })),
      report && !report.applied && report.ok && h(E.Alert, { tone: 'info', title: A.t('ad.import.dryTitle') }, A.t('ad.import.dryText', { rows: report.rows, replacing: report.replacing })),
      report && report.weeks && (report.weeks.A || report.weeks.B) > 0 && h(E.Alert, { tone: 'info', title: A.t('ad.import.weeksTitle') },
        h('div', null,
          h('p', { style: { margin: 0 } }, A.t('ad.import.weeksText', { every: report.weeks.every, a: report.weeks.A, b: report.weeks.B, anchor: fmt.data && fmt.data.weekCycle ? A.fmtDate(fmt.data.weekCycle.anchor) : '' })),
          (report.weekMarkers || []).length > 0 && h('p', { style: { margin: 'var(--space-2) 0 0' } },
            A.t('ad.import.weekMarkers', { markers: report.weekMarkers.map(function (m) { return '„-' + m.marker + '” → ' + m.week; }).join(', ') })))),
      warnings.length > 0 && h(E.Alert, { tone: 'warning', title: A.t('ad.import.warningsTitle', { n: warnings.length }) },
        h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, warnings.map(function (t, i) { return h('li', { key: i }, t); }))),
      blocking.length > 0 && h(E.Alert, { tone: 'danger', title: A.t('ad.import.blockingTitle', { n: blocking.length }) }, A.t('ad.import.blockingText')),
      proposal && h('div', { className: 'stack' },
        h('div', { className: 'row' },
          h('p', { className: 'body-strong', style: { margin: 0 } }, A.t('ad.import.mapTitle', { tool: proposal.tool, ref: proposal.ref || '' })),
          h(E.Button, { size: 'sm', icon: 'check', onClick: acceptExact }, A.t('ad.import.acceptExact')),
          h(E.Button, { size: 'sm', variant: 'quiet', icon: 'search', disabled: busy, onClick: function () { run(true); } }, A.t('ad.import.recheck'))),
        MAP_KINDS.map(mapTable)),
      errors.length > 0 && h(E.Alert, { tone: 'danger', title: A.t('ad.import.errorsTitle', { n: errors.length }) }, h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, errors.map(function (t, i) { return h('li', { key: i }, t); }))),
      conflicts.length > 0 && h(E.Table, {
        caption: A.t('ad.import.conflicts'), columns: [
          { key: 'kind', title: A.t('ad.import.colConflict'), render: function (r) { var k = A.t('ad.import.kind.' + r.kind); return k === 'ad.import.kind.' + r.kind ? r.kind : k; } },
          { key: 'at', title: A.t('ad.import.colLesson') }, { key: 'detail', title: A.t('ad.import.colDetail') }],
        rows: conflicts.map(function (c, i) { return Object.assign({ id: 'c' + i }, c); })
      }),
      h(Live, null, said));
  }

  /* --------------------------------------------------- przedmioty i oddziały (OPS3-04, OPS3-14) */
  function Przedmioty() {
    var api = A.useApi('/api/admin/subjects', []);
    var s0 = React.useState({ id: '', name: '', nameEn: '', short: '' }), f = s0[0], setF = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var upd = function (k) { return function (e) { var o = {}; o[k] = e.target.value; setF(Object.assign({}, f, o)); }; };
    function add() {
      A.api.post('/api/admin/subjects', f).then(function (r) { setSaid(r.message); A.toast(r.message, 'success'); setF({ id: '', name: '', nameEn: '', short: '' }); api.reload(); })
        .catch(function (e) { setSaid(e.message); A.toast(e.message, 'danger'); });
    }
    function del(id, name) {
      if (!window.confirm(A.t('ad.subj.confirmDelete', { name: name }))) return;
      A.api.delete('/api/admin/subjects/' + encodeURIComponent(id)).then(function () { A.toast(A.t('ad.subj.deleted', { name: name }), 'success'); api.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var rows = (api.data && api.data.subjects) || [];
    return h(Card, { id: 'przedmioty', title: A.t('ad.subj.title'), sub: A.t('ad.subj.sub') },
      h(E.Table, { caption: A.t('ad.subj.title'), hideCaption: true, stack: true,
        columns: [
          { key: 'name', title: A.t('ad.subj.name') },
          { key: 'id', title: A.t('ad.subj.id'), render: function (r) { return h('code', { className: 'ed-mono' }, r.id); } },
          { key: 'usage', title: A.t('ad.subj.usage'), render: function (r) { return A.t('ad.subj.usageText', { timetable: r.usage.timetable, lessons: r.usage.lessons, teachers: r.usage.teachers }); } },
          { key: 'act', title: A.t('ad.actions'), render: function (r) {
            var used = r.usage.timetable + r.usage.lessons + r.usage.grades + r.usage.groups + r.usage.teachers;
            return h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', disabled: used > 0, onClick: function () { del(r.id, r.name); } }, A.t('common.delete'));
          } }],
        rows: rows.map(function (x) { return Object.assign({}, x); }) }),
      h('h3', { className: 'subheading' }, A.t('ad.subj.addTitle')),
      h('div', { className: 'grid-3' },
        h(E.TextField, { label: A.t('ad.subj.name'), value: f.name, onChange: upd('name') }),
        h(E.TextField, { label: A.t('ad.subj.id'), mono: true, value: f.id, placeholder: A.t('ad.subj.idPlaceholder'), hint: A.t('ad.subj.idHint'), onChange: upd('id') }),
        h(E.TextField, { label: A.t('ad.subj.short'), mono: true, value: f.short, onChange: upd('short') })),
      h('div', { className: 'row' }, h(E.Button, { variant: 'primary', icon: 'plus', disabled: !f.name.trim(), onClick: add }, A.t('ad.subj.add'))),
      h(Live, null, said));
  }

  function Oddzialy() {
    var api = A.useApi('/api/admin/classes', []);
    var s0 = React.useState({ id: '', name: '', level: '', homeroomTeacherId: '' }), f = s0[0], setF = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var upd = function (k) { return function (e) { var o = {}; o[k] = e.target.value; setF(Object.assign({}, f, o)); }; };
    function add() {
      A.api.post('/api/admin/classes', { id: f.id, name: f.name || undefined, level: f.level === '' ? undefined : +f.level, homeroomTeacherId: f.homeroomTeacherId || undefined })
        .then(function (r) { setSaid(r.message); A.toast(r.message, 'success'); setF({ id: '', name: '', level: '', homeroomTeacherId: '' }); api.reload(); })
        .catch(function (e) { setSaid(e.message); A.toast(e.message, 'danger'); });
    }
    function del(id) {
      if (!window.confirm(A.t('ad.cls.confirmDelete', { name: id }))) return;
      A.api.delete('/api/admin/classes/' + encodeURIComponent(id)).then(function () { A.toast(A.t('ad.cls.deleted', { name: id }), 'success'); api.reload(); })
        .catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var rows = (api.data && api.data.classes) || [];
    var teachers = [{ value: '', label: A.t('ad.cls.noHomeroom') }].concat(((api.data && api.data.teachers) || []).map(function (x) { return { value: x.id, label: x.label }; }));
    return h(Card, { id: 'oddzialy', title: A.t('ad.cls.title'), sub: A.t('ad.cls.sub') },
      h(E.Table, { caption: A.t('ad.cls.title'), hideCaption: true, stack: true,
        columns: [
          { key: 'name', title: A.t('ad.cls.name') },
          { key: 'homeroomTeacher', title: A.t('ad.cls.homeroom'), render: function (r) { return r.homeroomTeacher || '—'; } },
          { key: 'usage', title: A.t('ad.cls.usage'), render: function (r) { return A.t('ad.cls.usageText', { students: r.usage.students, timetable: r.usage.timetable, groups: r.usage.groups }); } },
          { key: 'act', title: A.t('ad.actions'), render: function (r) {
            var used = r.usage.allStudents + r.usage.timetable + r.usage.lessons + r.usage.groups;
            return h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', disabled: used > 0, onClick: function () { del(r.id); } }, A.t('common.delete'));
          } }],
        rows: rows.map(function (x) { return Object.assign({}, x); }) }),
      h('h3', { className: 'subheading' }, A.t('ad.cls.addTitle')),
      h('div', { className: 'grid-3' },
        h(E.TextField, { label: A.t('ad.cls.id'), mono: true, value: f.id, placeholder: '7b', hint: A.t('ad.cls.idHint'), onChange: upd('id') }),
        h(E.TextField, { label: A.t('ad.cls.name'), value: f.name, onChange: upd('name') }),
        h(E.Select, { label: A.t('ad.cls.homeroom'), value: f.homeroomTeacherId, options: teachers, onChange: upd('homeroomTeacherId') })),
      h('div', { className: 'row' }, h(E.Button, { variant: 'primary', icon: 'plus', disabled: !f.id.trim(), onClick: add }, A.t('ad.cls.add'))),
      h(Live, null, said));
  }

  /* -------------------------------------------------------------------- pakiet SIO (3.5.3) */
  function Sio(p) {
    var s0 = React.useState(null), res = s0[0], setRes = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    function validate() {
      A.api.post('/api/registry/sio/validate', {}).then(function (r) {
        setRes(r);
        setSaid(r.ok ? A.t('ad.sio.okLive', { classes: r.counts.classes, students: r.counts.students }) : A.t('ad.sio.failLive', { n: r.errors.length }));
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function generate() {
      A.api.get('/api/registry/sio/package').then(function (xml) {
        download('sio-' + p.today + '.xml', xml, 'application/xml');
        setSaid(A.t('ad.sio.downloaded', { file: 'sio-' + p.today + '.xml' }));
        A.toast(A.t('ad.sio.downloadedToast'), 'success');
      }).catch(function (e) { setRes({ ok: false, errors: (e.data && e.data.errors) || [e.message] }); setSaid(e.message); A.toast(e.message, 'danger'); });
    }
    return h(Card, { id: 'sio', title: A.t('ad.sio.title'), sub: A.t('ad.sio.sub') },
      h('div', { className: 'row' },
        h(E.Button, { icon: 'check', onClick: validate }, A.t('ad.sio.validate')),
        h(E.Button, { icon: 'download', onClick: generate }, A.t('ad.sio.generate'))),
      res && res.ok && h(E.Alert, { tone: 'success', title: A.t('ad.sio.readyTitle') },
        A.t('ad.sio.readyText', { classes: res.counts.classes, students: res.counts.students, perClass: res.counts.perClass.map(function (x) { return x.classId + ' — ' + x.count; }).join(', ') })),
      res && !res.ok && h(E.Alert, { tone: 'danger', title: A.t('ad.sio.errorsTitle', { n: res.errors.length }) },
        h('div', null, h('p', { style: { margin: '0 0 var(--space-2)' } }, A.t('ad.sio.errorsText')),
          h('ul', { style: { margin: 0, paddingLeft: 'var(--space-5)' } }, res.errors.map(function (t, i) { return h('li', { key: i }, t); })))),
      h(Live, null, said));
  }

  /* -------------------------------------------------- GAP-1: konta pracowników (3.5.6) */
  function KontaPracownikow() {
    var api = A.useApi('/api/admin/staff', []);
    var s0 = React.useState(false), open = s0[0], setOpen = s0[1];
    var s1 = React.useState({ role: 'counselor', firstName: '', lastName: '', title: '', login: '', email: '', phone: '', subjects: [], homeroomOf: '' }), f = s1[0], setF = s1[1];
    var s2 = React.useState(null), made = s2[0], setMade = s2[1];
    var s3 = React.useState(null), off = s3[0], setOff = s3[1];
    var s4 = React.useState(''), reason = s4[0], setReason = s4[1];
    var s5 = React.useState(''), said = s5[0], setSaid = s5[1];
    var d = api.data;
    function set(k, v) { setF(function (prev) { var n = Object.assign({}, prev); n[k] = v; return n; }); }
    if (!d) return h(Card, { id: 'staff', title: A.t('ad.staff.title') }, h('p', { className: 'muted' }, api.error ? api.error.message : A.t('ad.staff.loading')));

    function create() {
      A.api.post('/api/admin/staff', {
        role: f.role, firstName: f.firstName.trim(), lastName: f.lastName.trim(), title: f.title.trim(),
        login: f.login.trim(), email: f.email.trim(), phone: f.phone.trim(),
        subjects: f.role === 'teacher' ? f.subjects : [], homeroomOf: f.role === 'teacher' ? (f.homeroomOf || null) : null
      }).then(function (r) {
        setOpen(false); setMade(r);
        setF({ role: 'counselor', firstName: '', lastName: '', title: '', login: '', email: '', phone: '', subjects: [], homeroomOf: '' });
        setSaid(A.t('ad.staff.created', { name: r.user.name, login: r.user.login }));
        A.toast(A.t('ad.staff.created', { name: r.user.name, login: r.user.login }), 'success'); api.reload();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function deactivate() {
      A.api.delete('/api/admin/staff/' + off.id, { reason: reason.trim() }).then(function (r) {
        setOff(null); setReason(''); setSaid(A.t('ad.staff.deactivated', { name: r.user.name }));
        A.toast(A.t('ad.staff.deactivated', { name: r.user.name }), 'success'); api.reload();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    function restore(u) {
      A.api.patch('/api/admin/staff/' + u.id, { blocked: false }).then(function (r) {
        setSaid(A.t('ad.staff.restored', { name: r.user.name })); A.toast(A.t('ad.staff.restored', { name: r.user.name }), 'success'); api.reload();
      }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    var columns = [
      { key: 'name', title: A.t('ad.staff.colName'), render: function (r) { return h('span', null, r.name, ' ', h('span', { className: 'muted' }, '(' + r.login + ')')); } },
      { key: 'role', title: A.t('ad.staff.colRole'), render: function (r) {
        return (A.ROLE_LABEL[r.role] || r.role)
          + (r.homeroomOf ? ' · ' + A.t('ad.staff.homeroomOf', { cls: r.homeroomOf }) : '')
          + (r.subjects && r.subjects.length ? ' · ' + r.subjects.map(function (id) { return A.subjectName(id); }).join(', ') : '');
      } },
      { key: 'contact', title: A.t('ad.staff.colContact'), render: function (r) { return r.email || r.phone || '—'; } },
      { key: 'status', title: A.t('ad.staff.colStatus'), render: function (r) {
        return h('span', { className: 'row', style: { gap: 'var(--space-2)', flexWrap: 'wrap' } },
          r.blocked ? h(E.Badge, { tone: 'danger', icon: 'lock' }, A.t('ad.staff.blocked')) : h(E.Badge, { tone: 'success', icon: 'check' }, A.t('ad.staff.active')),
          r.mustChangePassword && h(E.Badge, { tone: 'accent', icon: 'key' }, A.t('ad.staff.mustChange')),
          r.hasKeys && h(E.Badge, { tone: 'outline', icon: 'shield' }, A.t('ad.staff.keys')));
      } },
      { key: 'akcje', title: A.t('ad.staff.colActions'), render: function (r) {
        return h('div', { className: 'ed-row-actions' }, r.blocked
          ? h(E.Button, { size: 'sm', icon: 'refresh', variant: 'quiet', 'aria-label': A.t('ad.staff.restoreAria', { name: r.name }), onClick: function () { restore(r); } }, A.t('ad.staff.restore'))
          : h(E.Button, { size: 'sm', icon: 'lock', variant: 'quiet', 'aria-label': A.t('ad.staff.deactivateAria', { name: r.name }), onClick: function () { setOff(r); setReason(''); } }, A.t('ad.staff.deactivate')));
      } }
    ];
    var ready = f.firstName.trim() && f.lastName.trim();
    return h(Card, { id: 'staff', title: A.t('ad.staff.title'), sub: A.t('ad.staff.sub') },
      h('div', { className: 'row' },
        h(E.Button, { icon: 'plus', onClick: function () { setOpen(true); setMade(null); } }, A.t('ad.staff.add')),
        d.activeAdmins <= 1 && h(E.Badge, { tone: 'warning', icon: 'alert-circle' }, A.t('ad.staff.lastAdmin'))),
      h(E.Table, { caption: A.t('ad.staff.caption'), hideCaption: true, columns: columns, rows: d.staff.map(function (u) { return Object.assign({ id: u.id }, u); }) }),
      h(Live, null, said || A.t('ad.staff.live', { n: d.staff.length, admins: d.activeAdmins })),
      open && h(E.Dialog, {
        title: A.t('ad.staff.dialogTitle'), onClose: function () { setOpen(false); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setOpen(false); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', icon: 'check', disabled: !ready, onClick: create }, A.t('ad.staff.create'))]
      },
        h('div', { className: 'stack' },
          h(E.Select, { label: A.t('ad.staff.role'), value: f.role, 'data-autofocus': true, onChange: function (e) { set('role', e.target.value); },
            options: d.roles.map(function (r) { return { value: r, label: A.ROLE_LABEL[r] || r }; }) }),
          h('div', { className: 'grid-2' },
            h(E.TextField, { label: A.t('ad.staff.firstName'), required: true, value: f.firstName, onChange: function (e) { set('firstName', e.target.value); } }),
            h(E.TextField, { label: A.t('ad.staff.lastName'), required: true, value: f.lastName, onChange: function (e) { set('lastName', e.target.value); } })),
          h('div', { className: 'grid-2' },
            h(E.TextField, { label: A.t('ad.staff.titleField'), value: f.title, onChange: function (e) { set('title', e.target.value); } }),
            h(E.TextField, { label: A.t('ad.staff.login'), mono: true, value: f.login, hint: A.t('ad.staff.loginHint'), onChange: function (e) { set('login', e.target.value); } })),
          h('div', { className: 'grid-2' },
            h(E.TextField, { label: A.t('ad.staff.email'), type: 'email', value: f.email, onChange: function (e) { set('email', e.target.value); } }),
            h(E.TextField, { label: A.t('ad.staff.phone'), value: f.phone, onChange: function (e) { set('phone', e.target.value); } })),
          f.role === 'teacher' && h(E.Select, { label: A.t('ad.staff.homeroom'), value: f.homeroomOf, onChange: function (e) { set('homeroomOf', e.target.value); },
            options: [{ value: '', label: A.t('ad.staff.homeroomNone') }].concat(d.classes.map(function (c) { return { value: c.id, label: c.name }; })) }),
          f.role === 'teacher' && h('fieldset', { style: { border: 0, margin: 0, padding: 0 } },
            h('legend', { className: 'muted' }, A.t('ad.staff.subjects')),
            h('div', { className: 'row', style: { flexWrap: 'wrap' } }, d.subjects.map(function (su) {
              return h(E.Checkbox, { key: su.id, label: su.name, checked: f.subjects.indexOf(su.id) >= 0, onChange: function (e) {
                var on = e.target.checked;
                set('subjects', on ? f.subjects.concat([su.id]) : f.subjects.filter(function (x) { return x !== su.id; }));
              } });
            }))))),
      made && h(E.Dialog, {
        title: A.t('ad.staff.pwTitle'), onClose: function () { setMade(null); },
        actions: [h(E.Button, { key: 'o', icon: 'check', 'data-autofocus': true, onClick: function () { setMade(null); } }, A.t('ad.staff.pwClose'))]
      },
        h('p', null, made.user.name + ' · ' + made.user.login),
        h('p', { className: 'code', style: { fontSize: '1.25rem', letterSpacing: '0.08em' } }, made.temporaryPassword),
        h('p', { className: 'muted' }, A.t('ad.staff.pwNote'))),
      off && h(E.Dialog, {
        title: A.t('ad.staff.reasonTitle', { name: off.name }), onClose: function () { setOff(null); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', onClick: function () { setOff(null); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', icon: 'lock', disabled: !reason.trim(), onClick: deactivate }, A.t('ad.staff.deactivate'))]
      },
        h('p', null, A.t('ad.staff.reasonNote')),
        h(E.TextField, { label: A.t('ad.staff.reason'), required: true, 'data-autofocus': true, value: reason, onChange: function (e) { setReason(e.target.value); } })));
  }

  /* ------------------------------------------------------------------- reset hasła (3.5.6) */
  function ResetHasla() {
    var users = A.useApi('/api/admin/users', []);
    var s0 = React.useState(''), who = s0[0], setWho = s0[1];
    var s1 = React.useState(null), done = s1[0], setDone = s1[1];
    React.useEffect(function () { if (!who && users.data && users.data.users.length) setWho(users.data.users[0].id); }, [users.data]);
    function reset() { A.api.post('/api/admin/users/' + who + '/reset-password', {}).then(function (r) { setDone(r); A.toast(A.t('ad.reset.toast'), 'success'); users.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); }
    var list = users.data ? users.data.users : [];
    return h(Card, { id: 'reset', title: A.t('ad.reset.title'), sub: A.t('ad.reset.sub') },
      h(E.Select, { label: A.t('ad.reset.account'), value: who, onChange: function (e) { setWho(e.target.value); setDone(null); }, options: list.map(function (u) { return { value: u.id, label: u.name + ' · ' + (A.ROLE_LABEL[u.role] || u.role) + ' (' + u.login + ')' }; }) }),
      h('div', { className: 'row' },
        h(E.Button, { icon: 'refresh', onClick: reset }, A.t('ad.reset.do')),
        done && h(E.Badge, { tone: 'accent', icon: 'lock' }, A.t('ad.reset.badge'))),
      done && h('p', { className: 'code', style: { fontSize: '1.25rem', letterSpacing: '0.08em' } }, done.temporaryPassword),
      h('p', { className: 'muted' }, A.t('ad.reset.policy')),
      h(Live, null, done ? A.t('ad.reset.live', { name: done.name, login: done.login }) : ''));
  }

  /* ---------------------------------------------------------------- 2FA dla kadry (3.5.7) */
  function Totp() {
    var api = A.useApi('/api/admin/2fa', []);
    var s0 = React.useState(''), said = s0[0], setSaid = s0[1];
    var d = api.data;
    if (!d) return h(Card, { id: 'totp', title: A.t('ad.totp.title') }, h('p', { className: 'muted' }, A.t('ad.loading')));
    function toggle(v) { A.api.post('/api/admin/2fa/require', { required: v }).then(function (r) { setSaid(r.message); A.toast(r.message, 'success'); api.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); }
    var columns = [
      { key: 'name', title: A.t('ad.totp.colPerson') },
      { key: 'role', title: A.t('ad.totp.colRights'), render: function (r) { return (A.ROLE_LABEL[r.role] || r.role) + (r.homeroomOf ? ' · ' + A.t('ad.totp.homeroomOf', { cls: r.homeroomOf }) : '') + (r.subjects && r.subjects.length ? ' · ' + r.subjects.map(function (sid) { return A.subjectName(sid); }).join(', ') : ''); } },
      { key: 'status', title: '2FA', render: function (r) {
        return r.totpEnabled ? h(E.Badge, { tone: 'success', icon: 'shield' }, A.t('ad.totp.enabled'))
          : r.mustSetup2FA ? h(E.Badge, { tone: 'accent', icon: 'clock' }, A.t('ad.totp.pending'))
            : h(E.Badge, { tone: 'outline', icon: 'info' }, A.t('ad.totp.notRequired'));
      } }
    ];
    return h(Card, { id: 'totp', title: A.t('ad.totp.title'), sub: A.t('ad.totp.sub', { roles: d.roles.map(function (r) { return A.ROLE_LABEL[r] || r; }).join(', ') }) },
      h(E.Switch, { label: A.t('ad.totp.switch'), checked: !!d.required, states: [A.t('ad.totp.off'), A.t('ad.totp.on')], onChange: toggle }),
      !d.required && h(E.Alert, { tone: 'warning', title: A.t('ad.totp.warnTitle') }, A.t('ad.totp.warnText')),
      h(E.Table, { caption: A.t('ad.totp.caption'), hideCaption: true, columns: columns, rows: d.users.map(function (u) { return Object.assign({ id: u.id }, u); }) }),
      h(Live, null, said || A.plural(d.users.filter(function (u) { return u.mustSetup2FA; }).length, 'ad.totp.live')));
  }

  /* ------------------------------------------------------- uprawnienia wiadomości (3.5.9) */
  function Wiadomosci(p) {
    var s0 = React.useState((p.config && p.config.messaging && p.config.messaging.parentsCanMessage) || 'homeroomAndSubject'), val = s0[0], setVal = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    function change(v) {
      setVal(v);
      A.api.patch('/api/admin/messaging', { parentsCanMessage: v }).then(function (r) { setSaid(A.t('ad.msg.saved', { message: r.message })); A.toast(A.t('ad.msg.savedToast'), 'success'); }).catch(function (e) { A.toast(e.message, 'danger'); });
    }
    return h(Card, { id: 'wiadomosci', title: A.t('ad.msg.title') },
      h(E.RadioGroup, {
        legend: A.t('ad.msg.legend'), value: val, onChange: change,
        options: [
          { value: 'all', label: A.t('ad.msg.all'), hint: A.t('ad.msg.allHint') },
          { value: 'homeroomAndSubject', label: A.t('ad.msg.limited'), hint: A.t('ad.msg.limitedHint') }]
      }),
      h(Live, null, said || A.t('ad.msg.live')));
  }

  /* ----------------------------------------------------------- kody rejestracyjne (3.5.11) */
  function Kody(p) {
    var api = A.useApi('/api/admin/registration-codes', []);
    var s0 = React.useState('1a'), cls = s0[0], setCls = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    function generate() { A.api.post('/api/admin/registration-codes', { classId: cls, expiresInDays: 30 }).then(function (r) { setSaid(r.message); A.toast(r.message, 'success'); api.reload(); }).catch(function (e) { A.toast(e.message, 'danger'); }); }
    function print() { A.api.post('/api/admin/registration-codes/print', { classId: cls }).then(function (html) { openPrint(html); setSaid(A.t('ad.codes.printed')); }).catch(function (e) { A.toast(e.message, 'danger'); }); }
    var codes = api.data ? api.data.codes : [];
    var columns = [
      { key: 'student', title: A.t('common.student') }, { key: 'classId', title: A.t('ad.codes.class') },
      { key: 'code', title: A.t('ad.codes.colCode'), render: function (r) { return h('span', { className: 'code' }, r.code); } },
      { key: 'expiresAt', title: A.t('ad.codes.colValidTo'), render: function (r) { return A.fmtDate(r.expiresAt); } },
      { key: 'status', title: A.t('common.status'), render: function (r) { return r.usedAt ? h(E.Badge, { tone: 'outline', icon: 'check' }, A.t('ad.codes.used', { date: A.fmtDate(r.usedAt) })) : h(E.Badge, { tone: 'accent', icon: 'clock' }, A.t('ad.codes.unused')); } }
    ];
    return h(Card, { id: 'kody', title: A.t('ad.codes.title'), sub: A.t('ad.codes.sub') },
      h('div', { className: 'row' },
        h(E.Select, { label: A.t('ad.codes.class'), value: cls, width: 160, onChange: function (e) { setCls(e.target.value); }, options: (p.classes || []).map(function (c) { return { value: c.id, label: c.name }; }) }),
        h(E.Button, { icon: 'plus', onClick: generate }, A.t('ad.codes.generate')),
        h(E.Button, { icon: 'print', variant: 'quiet', disabled: !codes.length, onClick: print }, A.t('ad.codes.print')),
        h(E.Badge, { tone: codes.length ? 'success' : 'outline' }, A.t('ad.codes.unusedBadge', { n: codes.filter(function (c) { return !c.usedAt; }).length }))),
      codes.length ? h(E.Table, { caption: A.t('ad.codes.caption'), hideCaption: true, columns: columns, rows: codes.map(function (c) { return Object.assign({ id: c.id }, c); }) })
        : h('p', { className: 'muted' }, A.t('ad.codes.none')),
      h(Live, null, said));
  }

  /* ---------------------------------------------------------------- lista adresów IP (3.5.12) */
  function IpLista() {
    var api = A.useApi('/api/admin/ip-allowlist', []);
    var s0 = React.useState(''), ip = s0[0], setIp = s0[1];
    var s1 = React.useState(''), said = s1[0], setSaid = s1[1];
    var d = api.data;
    var valid = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/.test(ip.trim()) && ip.trim().split(/[./]/).slice(0, 4).every(function (o) { return +o <= 255; });
    function save(list, force) {
      A.api.patch('/api/admin/ip-allowlist', { ipAllowlist: list, force: !!force }).then(function (r) { setSaid(r.message); setIp(''); api.reload(); }).catch(function (e) { setSaid(e.message); A.toast(e.message, 'danger'); });
    }
    if (!d) return h(Card, { id: 'ip', title: A.t('ad.ip.titleBare') }, h('p', { className: 'muted' }, A.t('ad.loading')));
    var columns = [
      { key: 'ip', title: A.t('ad.ip.colAddress'), render: function (r) { return h('span', { className: 'code' }, r.ip); } },
      { key: 'akcje', title: A.t('ad.ip.colActions'), render: function (r) {
        return h('div', { className: 'ed-row-actions' }, h(E.Button, { size: 'sm', variant: 'quiet', icon: 'trash', iconOnly: true, label: A.t('ad.ip.remove', { ip: r.ip }), onClick: function () { save(d.ipAllowlist.filter(function (x) { return x !== r.ip; })); } }));
      } }
    ];
    return h(Card, { id: 'ip', title: A.t('ad.ip.title'), sub: A.t('ad.ip.sub', { ip: d.yourIp || '—' }) },
      h('div', { className: 'row' },
        h(E.TextField, { label: A.t('ad.ip.field'), mono: true, value: ip, placeholder: '10.12.0.0/24', width: 220, onChange: function (e) { setIp(e.target.value); },
          error: ip.trim() && !valid ? A.t('ad.ip.error') : undefined,
          hint: ip.trim() && !valid ? undefined : A.t('ad.ip.hint', { examples: (d.example || []).join(', ') }) }),
        h(E.Button, { icon: 'plus', disabled: !valid, onClick: function () { save(d.ipAllowlist.concat([ip.trim()])); } }, A.t('common.add'))),
      d.ipAllowlist.length
        ? h(E.Table, { caption: A.t('ad.ip.caption'), hideCaption: true, columns: columns, rows: d.ipAllowlist.map(function (x) { return { id: x, ip: x }; }) })
        : h(E.Alert, { tone: 'warning', title: A.t('ad.ip.emptyTitle') }, A.t('ad.ip.emptyText')),
      h(Live, null, said || d.note));
  }

  /* --------------------------------------------------- anonimizacja kopii testowej (3.5.13) */
  function Anonimizacja(p) {
    var s0 = React.useState(false), open = s0[0], setOpen = s0[1];
    var s1 = React.useState(null), done = s1[0], setDone = s1[1];
    var s2 = React.useState(false), busy = s2[0], setBusy = s2[1];
    function run() {
      setOpen(false); setBusy(true);
      A.api.post('/api/admin/backup/anonymized', { json: true }).then(function (r) {
        download('edmat-kopia-anonimizowana-' + p.today + '.json', JSON.stringify(r.snapshot, null, 2), 'application/json');
        setDone(r); A.toast(A.t('ad.anon.toast'), 'success');
      }).catch(function (e) { A.toast(e.message, 'danger'); }).then(function () { setBusy(false); });
    }
    return h(Card, { id: 'anon', title: A.t('ad.anon.title'), sub: A.t('ad.anon.sub') },
      h('div', { className: 'row' },
        h(E.Button, { variant: 'danger', icon: 'shield', loading: busy, onClick: function () { setOpen(true); } }, A.t('ad.anon.run')),
        done && h(E.Badge, { tone: 'success', icon: 'shield' }, A.t('ad.anon.badge'))),
      done
        ? h(E.Alert, { tone: 'success', title: A.t('ad.anon.doneTitle') }, A.t('ad.anon.doneText', { replaced: done.replaced, audit: done.auditKept }))
        : h('p', { className: 'muted' }, A.t('ad.anon.idle')),
      open && h(E.Dialog, {
        title: A.t('ad.anon.dialogTitle'), onClose: function () { setOpen(false); },
        actions: [h(E.Button, { key: 'x', variant: 'secondary', onClick: function () { setOpen(false); } }, A.t('common.cancel')), h(E.Button, { key: 'ok', variant: 'danger', 'data-autofocus': true, onClick: run }, A.t('ad.anon.confirm'))]
      },
        h('p', null, A.t('ad.anon.p1')),
        h('p', null, A.t('ad.anon.p2')),
        h('p', null, A.t('ad.anon.p3'))));
  }

  /* ---------------------------------------------------------------- retencja logów (3.5.15) */
  function Retencja() {
    var api = A.useApi('/api/admin/retention', []);
    var rep = A.useApi('/api/admin/retention/report', []);
    var s0 = React.useState(''), said = s0[0], setSaid = s0[1];
    var d = api.data;
    if (!d) return h(Card, { id: 'retencja', title: A.t('ad.ret.title') }, h('p', { className: 'muted' }, A.t('ad.loading')));
    function setYears(v) {
      A.api.patch('/api/admin/retention', { logRetentionYears: +v }).then(function (r) { setSaid(r.message); A.toast(A.t('ad.ret.savedToast'), 'success'); api.reload(); rep.reload(); })
        .catch(function (e) { setSaid(e.message); A.toast(e.message, 'danger'); });
    }
    return h(Card, { id: 'retencja', title: A.t('ad.ret.title'), sub: A.t('ad.ret.sub') },
      h(E.Select, {
        label: A.t('ad.ret.select'), value: String(d.logRetentionYears),
        onChange: function (e) { setYears(e.target.value); },
        /* U3: „2 lata” zostaje na liście, żeby było widać, że jest poniżej minimum — ale nie da się go wybrać. */
        options: ['2', '5', '10', '50'].map(function (v) { return { value: v, label: A.t('ad.ret.opt' + v), disabled: +v < (d.logRetentionMinYears || 5) }; }),
        hint: A.t('ad.ret.hint', { n: d.logRetentionMinYears })
      }),
      h('div', { className: 'row' },
        h(E.Badge, { tone: 'info', icon: 'lock' }, A.t('ad.ret.worm')),
        h(E.Badge, { tone: 'outline', icon: 'clock' }, A.t('ad.ret.archive', { n: d.gradesArchiveRetentionYears }))),
      h('p', { className: 'muted' }, d.note),
      rep.data && h(E.Alert, { tone: 'info', title: A.t('ad.ret.reportTitle') },
        A.t('ad.ret.reportText', { would: rep.data.wouldExpire, total: rep.data.total, years: rep.data.logRetentionYears, cutoff: A.fmtDate(rep.data.cutoff) })),
      h(Live, null, said),
      h(KlasyDokumentacji, { report: rep.data, reload: rep.reload }),
      h(Brakowania, null));
  }

  /* Protokoły wykonanych brakowań i propozycje — lista z GET /api/admin/retention/runs, a pod
     każdym wierszem komentarze. Protokół jest zamrożony (kategoria A), więc uwaga do niego nie
     zmienia protokołu: staje obok. */
  function Brakowania() {
    var api = A.useApi('/api/admin/retention/runs', []);
    var d = api.data;
    var runs = (d && d.runs) || [];
    var props = (d && d.proposals) || [];
    var counts = (d && d.comments) || {};
    var propCounts = (d && d.proposalComments) || {};
    var runColumns = [
      { key: 'at', title: A.t('ad.ret.runsColAt'), render: function (r) { return A.fmtDateTime(r.at); } },
      { key: 'what', title: A.t('ad.ret.runsColWhat'), render: function (r) {
        var del = r.deleted || {};
        var n = Object.keys(del).reduce(function (s, k) { return s + (k === 'logComments' ? 0 : del[k]); }, 0);
        return A.t('ad.ret.runsWhat', { n: n, lc: (r.logComments && r.logComments.removed) || del.logComments || 0 });
      } },
      { key: 'consent', title: A.t('ad.ret.runsColConsent'), render: function (r) { return r.archiveConsentReference || '—'; } },
      { key: 'comments', title: A.t('ad.ret.runsColComments'), render: function (r) {
        return h(window.EdLogComments.Toggle, { kind: 'retention-runs', entryId: r.id, counts: counts[r.id], onChange: api.reload });
      } }
    ];
    var propColumns = [
      { key: 'at', title: A.t('ad.ret.runsColAt'), render: function (r) { return A.fmtDateTime(r.at); } },
      { key: 'status', title: A.t('ad.ret.runsColWhat'), render: function (r) { return A.t('ad.ret.propStatus', { s: r.status, n: r.total || 0 }); } },
      { key: 'consent', title: A.t('ad.ret.runsColConsent'), render: function (r) { return r.archiveConsentReference || '—'; } },
      { key: 'comments', title: A.t('ad.ret.runsColComments'), render: function (r) {
        return h(window.EdLogComments.Toggle, { kind: 'retention-proposals', entryId: r.id, counts: propCounts[r.id], onChange: api.reload });
      } }
    ];
    return h('div', { className: 'stack' },
      h('h3', { className: 'heading' }, A.t('ad.ret.runsTitle')),
      h('p', { className: 'muted' }, A.t('ad.ret.runsSub')),
      api.error ? h(E.Alert, { tone: 'danger' }, api.error.message) : null,
      d && !runs.length ? h('p', { className: 'muted' }, A.t('ad.ret.runsNone')) : null,
      runs.length ? h(E.Table, { caption: A.t('ad.ret.runsCaption'), hideCaption: true, stack: true, columns: runColumns, rows: runs }) : null,
      h('h3', { className: 'heading' }, A.t('ad.ret.propsTitle')),
      d && !props.length ? h('p', { className: 'muted' }, A.t('ad.ret.propsNone')) : null,
      props.length ? h(E.Table, { caption: A.t('ad.ret.propsTitle'), hideCaption: true, stack: true, columns: propColumns, rows: props }) : null);
  }

  /* Tabela klas dokumentacji z kategoriami archiwalnymi (JRWA) i ścieżka brakowania: lista →
     zatwierdzenie dyrektora z sygnaturą zgody Archiwum Państwowego → wykonanie. Kategoria A i
     księga uczniów nie trafiają na listę w ogóle — serwer ich tam nie wpisze. docs/RETENTION.md */
  function KlasyDokumentacji(p) {
    var s0 = React.useState(null), prop = s0[0], setProp = s0[1];
    var s1 = React.useState(''), consent = s1[0], setConsent = s1[1];
    var s2 = React.useState(''), reason = s2[0], setReason = s2[1];
    var s3 = React.useState(''), said = s3[0], setSaid = s3[1];
    var s4 = React.useState(false), confirming = s4[0], setConfirming = s4[1];
    var rows = (p.report && p.report.classes) || [];
    var unverified = rows.filter(function (x) { return !x.verified; });
    var uncovered = (p.report && p.report.uncovered) || [];
    var reasonOk = reason.trim().length >= 5;
    function fail(e) { setSaid(e.message); A.toast(e.message, 'danger'); }
    function prepare() {
      A.api.get('/api/admin/retention/proposal').then(function (r) { setProp(r); setSaid(r.message); })
        .catch(fail);
    }
    function approve() {
      A.api.post('/api/admin/retention/approve', { proposalId: prop.proposalId, archiveConsentReference: consent })
        .then(function (r) { setProp(Object.assign({}, prop, { status: r.status, archiveConsentReference: r.archiveConsentReference, confirmationToken: r.confirmationToken, approvedBy: r.approvedBy })); setSaid(r.message); A.toast(A.t('ad.ret.brak.approvedToast'), 'success'); })
        .catch(fail);
    }
    /* U3-04: brakowanie niszczy dokumentację szkoły — najpierw dialog z liczbami i sygnaturą zgody,
       dopiero potem żądanie. U3-05: uzasadnienie trafia do protokołu dosłownie, więc jest wymagane
       i nigdy nie podstawiamy za nie nagłówka karty. */
    function execute() {
      if (!reasonOk) return;
      setConfirming(false);
      A.api.post('/api/admin/retention/run', { confirm: true, proposalId: prop.proposalId, confirmationToken: prop.confirmationToken, reason: reason.trim() })
        .then(function (r) { setProp(null); setReason(''); setConsent(''); setSaid(A.t('ad.ret.brak.executed', { id: r.runId })); A.toast(A.t('ad.ret.brak.executedToast'), 'success'); p.reload(); })
        .catch(fail);
    }
    var columns = [
      { key: 'label', title: A.t('ad.ret.colClass'), render: function (r) { return h('span', null, r.label, ' ', h(E.Badge, { tone: 'outline' }, A.t('ad.ret.kind.' + r.kind))); } },
      { key: 'category', title: A.t('ad.ret.colCategory'), render: function (r) { return h(E.Badge, { tone: r.neverDeletes ? 'info' : 'outline', icon: r.neverDeletes ? 'lock' : null }, r.category); } },
      { key: 'rule', title: A.t('ad.ret.colRule') },
      { key: 'due', title: A.t('ad.ret.colDue'), render: function (r) { return r.neverDeletes ? A.t('ad.ret.never') : String(r.due); } },
      { key: 'nextDeadline', title: A.t('ad.ret.colNext'), render: function (r) { return r.nextDeadline ? A.fmtDate(r.nextDeadline) : '—'; } },
      { key: 'verified', title: A.t('ad.ret.colVerified'), render: function (r) { return h(E.Badge, { tone: r.verified ? 'success' : 'danger', icon: r.verified ? 'check' : 'warning' }, A.t(r.verified ? 'ad.ret.verifiedYes' : 'ad.ret.verifiedNo')); } }
    ];
    return h('div', { className: 'stack' },
      h('h3', { className: 'heading' }, A.t('ad.ret.classesTitle')),
      unverified.length > 0 && h(E.Alert, { tone: 'warning', title: A.t('ad.ret.unverifiedTitle') },
        A.t('ad.ret.unverifiedText', { n: unverified.length, total: rows.length })),
      rows.length > 0 && h(E.Table, { caption: A.t('ad.ret.classesCaption'), hideCaption: true, columns: columns,
        rows: rows.map(function (r) { return Object.assign({ id: r['class'] }, r); }) }),
      h('p', { className: 'muted' }, A.t('ad.ret.legend')),
      /* D3-13: wiersz „bez klasy” jest zawsze — także gdy jest pusty. Inaczej pominięcie nie widać. */
      h(E.Alert, { tone: uncovered.length ? 'warning' : 'success', title: A.t('ad.ret.uncoveredTitle') },
        uncovered.length
          ? A.t('ad.ret.uncoveredSome', { n: uncovered.length, list: uncovered.join(', ') })
          : A.t('ad.ret.uncoveredNone', { total: (p.report && p.report.collectionsTotal) || rows.length })),
      h(E.Alert, { tone: 'info', title: A.t('ad.ret.opsTitle') }, A.t('ad.ret.opsText')),
      h('h3', { className: 'heading' }, A.t('ad.ret.brak.title')),
      h('p', { className: 'muted' }, A.t('ad.ret.brak.what')),
      h('div', { className: 'row' }, h(E.Button, { variant: 'secondary', icon: 'file', onClick: prepare }, A.t('ad.ret.brak.prepare'))),
      prop && prop.total === 0 && h('p', { className: 'muted' }, A.t('ad.ret.brak.none')),
      prop && prop.total > 0 && h('div', { className: 'stack' },
        h('p', null, A.t('ad.ret.brak.total', { n: prop.total, c: (prop.classes || []).length, id: prop.proposalId })),
        h('ul', null, (prop.classes || []).map(function (x) { return h('li', { key: x['class'] }, x.label, ': ', String(x.due), ' — ', x.category); })),
        h('p', { className: 'muted' }, A.t('ad.ret.brak.blocked', { list: (prop.neverDeleted || []).map(function (x) { return x.label + ' (' + x.category + ')'; }).join('; ') })),
        prop.status !== 'approved' && h(E.Alert, { tone: 'info', title: A.t('ad.ret.brak.fourEyesTitle') }, A.t('ad.ret.brak.fourEyes')),
        prop.status !== 'approved' && h(E.TextField, { label: A.t('ad.ret.brak.consent'), value: consent, width: 360, required: true,
          hint: A.t('ad.ret.brak.consentHint'), onChange: function (e) { setConsent(e.target.value); } }),
        prop.status !== 'approved' && h('div', { className: 'row' },
          h(E.Button, { icon: 'check', disabled: consent.trim().length < 3, onClick: approve }, A.t('ad.ret.brak.approve'))),
        prop.status === 'approved' && h('div', { className: 'stack' },
          h(E.Badge, { tone: 'success', icon: 'check' }, A.t('ad.ret.brak.approved', { ref: prop.archiveConsentReference })),
          h(E.TextField, { label: A.t('ad.ret.brak.reason'), value: reason, width: 360, multiline: true, required: true,
            hint: A.t('ad.ret.brak.reasonHint'), onChange: function (e) { setReason(e.target.value); } }),
          h('div', { className: 'row' },
            h(E.Button, { variant: 'danger', icon: 'trash', disabled: !reasonOk, onClick: function () { setConfirming(true); } }, A.t('ad.ret.brak.execute'))),
          !reasonOk && h('p', { className: 'muted' }, A.t('ad.ret.brak.reasonRequired')))),
      confirming && prop && h(E.Dialog, {
        title: A.t('ad.ret.brak.confirmTitle'), onClose: function () { setConfirming(false); },
        actions: [h(E.Button, { key: 'c', variant: 'secondary', 'data-autofocus': true, onClick: function () { setConfirming(false); } }, A.t('common.cancel')),
          h(E.Button, { key: 'o', variant: 'danger', icon: 'trash', onClick: execute }, A.t('ad.ret.brak.confirmDo'))]
      },
        h('div', { className: 'stack' },
          h('p', null, A.t('ad.ret.brak.confirmLead', { n: prop.total, id: prop.proposalId })),
          h('ul', null, (prop.classes || []).map(function (x) { return h('li', { key: x['class'] }, x.label, ' (', x.category, '): ', String(x.due)); })),
          h('p', null, h('b', null, A.t('ad.ret.brak.consent')), ': ', prop.archiveConsentReference || '—'),
          h('p', null, h('b', null, A.t('ad.ret.brak.reason')), ': ', reason.trim()),
          h(E.Alert, { tone: 'danger', title: A.t('ad.ret.brak.confirmWarnTitle') }, A.t('ad.ret.brak.confirmWarn')))),
      h(Live, null, said));
  }

  /* Włącznik powiadomień push dla całej szkoły: przełącznik, adres kontaktowy do nagłówka VAPID
     (wymaga go RFC 8292 — usługa push musi wiedzieć, do kogo zadzwonić przy problemie) i licznik
     doręczeń. Klucze szkoły powstają przy pierwszym włączeniu i zostają w bazie. */
  function PushSzkola(p) {
    var api = A.useApi('/api/push/stats', []);
    var s0 = React.useState(''), said = s0[0], setSaid = s0[1];
    var d = api.data;
    var schoolMail = (p.config && p.config.school && p.config.school.email) || '';
    var s1 = React.useState(null), draft = s1[0], setDraft = s1[1];
    if (!d) return h(Card, { id: 'push', title: A.t('ad.push.title') }, h('p', { className: 'muted' }, A.t('ad.loading')));
    var subject = draft == null ? (d.subject || (schoolMail ? 'mailto:' + schoolMail : '')) : draft;
    function save(patch) {
      A.api.post('/api/push/config', Object.assign({ subject: subject }, patch))
        .then(function (r) { setSaid(A.t(r.enabled ? 'ad.push.on' : 'ad.push.off')); A.toast(A.t(r.enabled ? 'ad.push.on' : 'ad.push.off'), 'success'); api.reload(); })
        .catch(function (e) { setSaid(e.message); A.toast(e.message, 'danger'); });
    }
    var counts = d.byStatus || {};
    return h(Card, { id: 'push', title: A.t('ad.push.title'), sub: A.t('ad.push.sub') },
      h(E.Switch, { label: A.t('ad.push.switch'), hint: A.t('ad.push.hint'), checked: !!d.enabled, states: [A.t('se.off'), A.t('se.on')], onChange: function (v) { save({ enabled: v }); } }),
      h(E.TextField, {
        label: A.t('ad.push.subject'), value: subject, width: 320, placeholder: 'mailto:sekretariat@szkola.pl',
        hint: A.t('ad.push.subjectHint'), onChange: function (e) { setDraft(e.target.value); },
        onBlur: function () { if (subject && subject !== d.subject) save({}); }
      }),
      h('div', { className: 'row' },
        h(E.Badge, { tone: d.enabled ? 'success' : 'outline', icon: 'bell' }, A.t('ad.push.devices', { n: d.subscriptions })),
        h(E.Badge, { tone: 'outline', icon: 'check' }, A.t('ad.push.sent', { n: counts.sent || 0 })),
        (counts.failed || counts.gone) ? h(E.Badge, { tone: 'warning', icon: 'warning' }, A.t('ad.push.failed', { n: (counts.failed || 0) + (counts.gone || 0) })) : null,
        d.queued ? h(E.Badge, { tone: 'info', icon: 'clock' }, A.t('ad.push.queued', { n: d.queued })) : null),
      h('p', { className: 'muted' }, A.t('ad.push.privacy')),
      h(Live, null, said));
  }

  /* ------------------------------------------------------------------------------ ekran */
  function Screen(props) {
    var reg = A.useApi('/api/registry/students', []);
    var s0 = React.useState(props.route.query.tab || 'rok'), tab = s0[0], setTab = s0[1];
    var today = (props.config && props.config.today) || A.isoToday();
    var classes = reg.data ? reg.data.classes : [];
    var TABS = [{ id: 'rok', label: A.t('ad.tab.year') }, { id: 'bezp', label: A.t('ad.tab.security') }, { id: 'dane', label: A.t('ad.tab.data') }];
    return h('div', null,
      h('h1', { className: 'display app-title' }, A.t('ad.title')),
      h('p', { className: 'app-sub' }, A.t('ad.sub', { school: props.config ? props.config.school.name : '', year: props.config ? props.config.year : '', date: A.fmtDate(today) })),
      h(E.Tabs, { tabs: TABS, value: tab, onChange: function (t) { setTab(t); A.navigate('/administracja', { tab: t }); }, label: A.t('ad.tabsLabel') },
        h('div', { className: 'stack mt-4' },
          h('div', { hidden: tab !== 'rok' }, h('div', { className: 'stack' }, h(StrukturaRoku, null), h('div', { className: 'grid-2' }, h(Przedmioty, null), h(Oddzialy, null)), h(ImportPlanu, null), h(Sio, { today: today }))),
          h('div', { hidden: tab !== 'bezp' }, h('div', { className: 'stack' },
            h('div', { className: 'grid-2' }, h(ResetHasla, null), h(Wiadomosci, { config: props.config })),
            h(KontaPracownikow, null), h(Totp, null), h(PushSzkola, { config: props.config }), h(IpLista, null), h(Kody, { classes: classes }))),
          h('div', { hidden: tab !== 'dane' }, h('div', { className: 'grid-2' }, h(Anonimizacja, { today: today }), h(Retencja, null))))));
  }

  /* OPS3-11 — kreator (public/app/screens/setup.js) wstawia tę samą kartę w kroku „Plan lekcji”
     zamiast własnego pola tekstowego: pliki, katalogi, cztery formaty, tabela dopasowania i przebieg
     próbny są jedną implementacją, a nie dwiema. */
  A.AdminCards = Object.assign(A.AdminCards || {}, { ImportPlanu: ImportPlanu, Przedmioty: Przedmioty, Oddzialy: Oddzialy });
  A.screen({ id: 'admin', path: '/administracja', title: 'Administracja', module: 'registry', roles: ['admin'], nav: { key: 'nav.admin', label: 'Administracja', order: 55 }, component: Screen });
})();
