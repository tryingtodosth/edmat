# Formularz zgłoszeniowy — odpowiedzi do wklejenia (kolejność jak w formularzu)

Pola oznaczone ⟦…⟧ uzupełnia Piotr. Bez limitów znaków w formularzu (3 000 znaków przyjęte w teście);
każda odpowiedź ma 1 000–2 500 znaków, żeby dało się ją przeczytać w minutę. Tekst w wersji
z 16.09 wieczorem: bez myślników w roli pauzy, z poprawkami faktów (brak istniejącego zespołu
recenzentów, kanał dotarcia przez prodziekanów, „Marc Ploeg”).

---

## Zgłaszam się jako
**Naukowiec** (Młody Naukowiec: student Wydziału Fizyki Uniwersytetu Warszawskiego, reprezentujący Zespół).

## Nazwa rozwiązania
EdMat.net: otwarta baza zadań z rozwiązaniami weryfikowanymi przez ludzi, dla uczących się w każdym wieku

## Liczba osób pracujących nad rozwiązaniem
4 (członkowie założyciele; dodatkowo stała współpraca przy module finansowym z Natalią Prus oraz
potwierdzone wsparcie promocyjne prof. Andrzeja Dragana; ⟦Piotr decyduje: 4 czy 5⟧)

## Opisz kompetencje osób pracujących nad rozwiązaniem
Piotr Putyło: student Wydziału Fizyki Uniwersytetu Warszawskiego, inicjator i koordynator
przedsięwzięcia. Odpowiada za architekturę technologiczną i większość kodu (Django REST Framework,
SvelteKit, 1 441 testów automatycznych). Projekt rozwija od lipca 2026 r. Zgłasza rozwiązanie jako
Młody Naukowiec reprezentujący Zespół.
Marysia Nazarczuk: matematyka, licencjat i II rok studiów magisterskich; studia licencjackie z fizyki
i informatyki. Czuwa nad całością materiałów ścisłych: opracowanie, weryfikacja i korekta kompletnej
bazy 745 zadań uniwersyteckich oraz nadzór nad wersjami językowymi.
Marc Ploeg: strategia wdrożeniowa, dobór modeli organizacyjnych i struktura budżetowa. Doświadczony
ekspert ds. innowacji w biznesie, wieloletni juror konkursów start-upowych, w tym w programach grupy
ING. Zapewnia rynkowe spojrzenie na projekt.
dr hab. Katarzyna Grabowska: opieka naukowa i kierownictwo badawcze przedsięwzięcia. Katedra Metod
Matematycznych Fizyki, Wydział Fizyki UW.
Współpraca merytoryczna i promocja: Natalia Prus prowadzi sekcję „Finanse osobiste" i tworzy autorski
program z zakresu finansów i przedsiębiorczości. Wsparcie w kanałach społecznościowych potwierdził
prof. Andrzej Dragan z Wydziału Fizyki UW.
Nasz skład łączy trzy kompetencje niezbędne temu projektowi: akademickie zrozumienie matematyki
i fizyki (jakość treści), rzetelne inżynierskie podejście do budowy stabilnego oprogramowania
(działający system z pełnym pokryciem testami) oraz trzeźwą ocenę mechanizmów rynkowych (edukacja
finansowa i model instytucjonalny). Brakujące ogniwo, animatora społeczności seniorów, nazywamy
otwarcie i finansujemy z grantu.

## Poziom dojrzałości rozwiązania
**Liga Seed**

## Prezentacja
Plik `EdMat-ING-2026.pdf` (PDF, poniżej 15 MB).

---

## Opisz krótko swoje rozwiązanie
EdMat.net to w pełni funkcjonujący, publicznie dostępny portal na otwartej licencji MIT, w którym
każde zadanie z matematyki, fizyki i informatyki ma rozpisane rozwiązanie, za które konkretny człowiek
odpowiada własnym nazwiskiem i dorobkiem. Nie polegamy na anonimowym tłumie ani na bezkrytycznie
przyjmowanych odpowiedziach z generatorów tekstu.

Dziś baza obejmuje 745 zadań z dwóch trudnych przedmiotów Uniwersytetu Warszawskiego (Analiza
Matematyczna II oraz Rachunek Prawdopodobieństwa I); 742 z nich mają potwierdzone, poprawne
rozwiązania. W serwisie jest też 9 skryptów i zbiorów dydaktycznych. System działa po polsku i po
angielsku, przy czym wersje językowe samych zadań podlegają niezależnej recenzji.

Pojedyncze zadanie odsłania się etapami: uczeń widzi najpierw treść, potem może poprosić
o wskazówkę, następnie podejrzeć sam wynik, a pełne rozwiązanie zobaczyć na samym końcu. Uczymy
myślenia, nie kopiowania gotowców. Dla każdego zadania powstaje pula alternatywnych dróg do wyniku.
Społeczność ocenia materiały, ale formalny znak weryfikacji przyznają wyłącznie uprawnieni
współtwórcy i opiekunowie działów (docelowo nauczyciele, asystenci, doktoranci, emerytowani
wykładowcy; rekrutowani, nie zakładani). Każda edycja zostawia czytelny ślad w historii zmian.

Równolegle działa zaplecze: dyskusje pod zadaniami, „Mój zestaw" generujący arkusze powtórkowe
w PDF, przestrzeń do prowadzenia autorskich kursów, moduł warsztatów i spotkań naukowych,
ogłoszenia korepetycji na mapie OpenStreetMap oraz bezpieczne konta rodzicielskie dla osób poniżej
16. roku życia (art. 8 RODO). Interfejs pozwala powiększyć tekst i włączyć wysoki kontrast. W serwisie
nie ma reklam ani skryptów śledzących.

Startujemy od środowiska akademickiego, bo tu mamy gotowe treści i kanał dotarcia: prodziekani
ds. studenckich MIM i FUW roześlą informację o EdMat mailem do pracowników i studentów obu wydziałów,
a stamtąd rekrutujemy pierwszych recenzentów. Ten sam mechanizm przenosimy potem na poziom
maturalny, do dorosłych zmieniających kwalifikacje oraz do seniorów w ramach praktycznej edukacji
ekonomicznej.

Całość grantu koncentrujemy na trzech filarach: rozwoju zweryfikowanej bazy zadań maturalnych
i akademickich, pilotażu międzypokoleniowym z seniorami oraz module finansowym. Moduły poboczne
(korepetycje, komunikator, wydarzenia) są gotowe w kodzie, ale zamrożone do czasu potwierdzenia
głównej osi projektu.

## Kto jest odbiorcą Twojego rozwiązania?
Projekt adresujemy do czterech precyzyjnie zdefiniowanych grup, w kolejności, w jakiej je obsługujemy.

1. Studenci kierunków ścisłych przed sesją egzaminacyjną. W skali kraju to 1,32 mln osób (GUS
2025/26). Punktem startowym jest Wydział Fizyki i MIM UW, gdzie mamy bazę 745 zadań i kanał dotarcia:
prodziekani ds. studenckich obu wydziałów roześlą informację o EdMat do pracowników i studentów.
Typowy scenariusz: studentka Ola na kilka dni przed kolokwium z Analizy II filtruje całki o wysokim
stopniu trudności, podejmuje samodzielną próbę, w razie problemów odkrywa wskazówkę, a na końcu
porównuje swoje notatki ze zweryfikowanym rozwiązaniem. Jeśli ma wątpliwości do konkretnego przejścia,
pyta w komentarzu i generuje zestaw do druku. To wszystko działa w serwisie w tej chwili.

2. Maturzyści oraz ich rodzice (321 tys. zdających w 2026 r. wg CKE). Użytkownicy poniżej 16 lat
korzystają z profilu założonego przez rodzica, który ma pełny wgląd w publikowane treści i prawo ich
usunięcia. Komentarze i załączniki dodawane przez młodzież trafiają do publikacji dopiero po akceptacji
moderatora.

3. Dorośli podnoszący kwalifikacje: osoby przygotowujące się do pracy w IT, uczące się podstaw
statystyki, rachunku prawdopodobieństwa lub matematyki finansowej.

4. Najważniejsza grupa w tej edycji: seniorzy (blisko 10 mln osób 60+ w Polsce, w tym 125,9 tys.
słuchaczy UTW). Wiemy, że starsze osoby nie szukają technologicznej nowinki dla samej idei korzystania
z komputera. Nie oferujemy im gadżetu, tylko realną rolę. Wiemy też, że wykształcenie matematyczne ma
znikomy ułamek seniorów, dlatego otwieramy trzy ścieżki:
- Recenzent merytoryczny: emerytowani nauczyciele i wykładowcy (jak pani Halina, lat 68), którzy
sprawdzają zadania maturalne i z pierwszego roku, odpowiadają na pytania uczniów i utrzymują
sprawność intelektualną w kontakcie z żywą nauką. Rekrutujemy ich wśród emerytowanej kadry FUW
i MIM UW, w sekcjach emerytów ZNP i w liceach.
- Czytelnik i tester: dowolny słuchacz UTW sprawdzający czytelność poleceń, poprawność językową
i przejrzystość wskazówek w materiałach dla szkół podstawowych.
- Współtwórca modułu finansów: każdy senior z bagażem doświadczeń. Wspólnie weryfikujemy domowy
budżet, bezpieczne lokowanie oszczędności oraz ochronę przed wyłudzeniami socjotechnicznymi
(oszustwa telefoniczne, podszywanie się pod bliskich, wyłudzenia na BLIK).
Dostęp nie wymaga instalacji, a interfejs ma powiększoną czcionkę i wysoki kontrast. Pilotaż prowadzimy
tak, jak każą badania nad seniorami w wolontariacie cyfrowym: rekrutujemy 35 osób na 30 miejsc,
kotwicą jest biblioteka publiczna, zadania mają do 20 minut i przechodzą przez kilka par oczu, 5 dni
ciszy uruchamia telefon animatora w ciągu doby, a zobowiązanie podpisuje się na 3-miesięczne cykle.
Cel: 30 seniorów w trzech miastach, w tym co najmniej 10 recenzentów merytorycznych; jeśli zgłosi się
ich mniej, ciężar pilotażu przejmują role testerów i konsultantów finansowych.

Główne wyzwania adaptacyjne rozwiązujemy pragmatycznie. Zapracowany student nie instaluje nowych
aplikacji, dlatego docieramy do niego mailingiem prodziekanów ds. studenckich MIM i FUW oraz z polecenia
prowadzących ćwiczenia, w newralgicznym momencie sesji zimowej; do czytania nie trzeba konta. Opór
przed dzieleniem się materiałami zdejmujemy dedykowaną funkcją: student może po prostu wkleić
roboczą konwersację z ChatGPT, a my oznaczamy ją jako „z pomocą AI, czeka na recenzję" i przekazujemy
recenzentowi. Student zyskuje potwierdzenie poprawności i reputację, a baza sprawdzoną treść.
Mierniki na zimę: 300 aktywnych studentów, 30 autorów wpisów i czas recenzji poniżej 7 dni.

## Jak Twoje rozwiązanie odpowiada na wyzwanie konkursowe?
Odpowiadamy wprost na pytanie „Jak możemy zapewnić jakościową edukację niezależnie od wieku?",
rozwijając oba człony.

Jakość w naukach ścisłych to brak błędów merytorycznych, klarowny wywód i osobista odpowiedzialność
recenzenta za publikowany materiał. W EdMat realizujemy to mechanicznie: pula rozwiązań pod każdym
zadaniem, reputacja wpływająca na wagę głosu, weryfikacja przez opiekunów sekcji, znak weryfikacji
wynikający ze stanu faktycznego w bazie oraz automatyczna kwarantanna treści zgłaszanych przez
społeczność. To zaprzeczenie chaosu na forach z zadaniami domowymi i halucynacji botów.

Niezależnie od wieku oznacza u nas jedną spójną architekturę z widokami dla poszczególnych pokoleń:
bezpieczne konto dla ucznia, akademicki zbiór dla studenta, kursy praktyczne dla dorosłego oraz
ergonomiczny, pozbawiony barier panel dla seniora-mentora. Filtr grupy wiekowej działa na poziomie
bazy danych: uczeń podstawówki widzi inny zestaw funkcji niż emerytowany profesor, lecz obaj mogą
wymieniać wiedzę wokół tego samego zadania.

Trzy obszary konkursowe:
- Uczenie się przez całe życie: fundament platformy. Użytkownicy sami inicjują kursy i spotkania,
a starsi pedagodzy dostają decyzyjne uprawnienia w systemie zamiast roli biernych odbiorców.
- Sztuczna inteligencja: odrzucamy budowę własnych modeli na rzecz warstwy kontrolnej. AI działa
u nas jako filtr podsuwający wyłącznie wskazówki z bazy zrecenzowanej przez człowieka; pomaga też
porządkować zgłoszenia i przygotowywać wstępne tłumaczenia z zachowaniem zapisu LaTeX, ale ostateczna
decyzja zawsze należy do człowieka.
- Edukacja finansowa: gotowy dział w serwisie, program Natalii Prus, zadania obliczeniowe (procent
składany, koszt kredytu, mechanika inflacji) weryfikowane tak samo jak zadania z analizy, uzupełnione
o perspektywę seniorów w zakresie bezpieczeństwa kapitału i obrony przed wyłudzeniami.

## Jak Twoje rozwiązanie wyróżnia się na tle konkurencji?
Znamy wady istniejących rozwiązań z własnego doświadczenia studenckiego.
- Brainly i pokrewne serwisy: szybkie odpowiedzi bez kontroli merytorycznej, nachalne reklamy, brak
treści akademickich, częste błędy w toku obliczeń.
- ChatGPT i komercyjne LLM: duża elastyczność, ale stała niepewność wyniku w naukach ścisłych,
nieznajomość polskiej podstawy programowej i skłonność do podawania gotowych wyników bez metody.
- Khan Academy: znakomite wideo, ale brak zadań z polskich uczelni i lokalnego środowiska.
- Uczelniany Moodle i systemy LMS: hermetyczne środowiska zamykane po semestrze, bez wielowariantowych
rozwiązań i ciągłości bazy wiedzy.
- Librus i Vulcan: narzędzia administracyjne, nie platformy do nauki.
- Math StackExchange: znakomity poziom, ale język angielski, brak odniesień do polskiego programu
i forma niesprzyjająca nauce przed egzaminem.
- Portale ogłoszeń korepetycji: kojarzenie zleceń bez wspólnej bazy materiałów do pracy.

Nasze przewagi działające w kodzie:
1. Prawdziwa weryfikacja toku rozumowania: proces recenzji, ważenie głosów i formalne kryteria.
2. Układ treści odzwierciedlający strukturę edukacyjną: od dziedziny i działu, przez temat, po
pojedyncze zadanie.
3. Integracja narzędzi: jedno zadanie może być elementem kursu, tematem warsztatu i bazą do korepetycji.
4. Rozdzielenie języka interfejsu od języka zadania, z niezależną recenzją treści (student z Ukrainy
czyta treść w ojczystym języku, polski wykładowca sprawdza jego tok rozumowania).
5. Dostosowanie do wieku od podstaw: premoderacja i kontrola rodzicielska dla nieletnich, duża
typografia i kontrast dla seniorów.
6. Otwartość: licencja MIT, brak reklam, brak profilowania, swoboda uruchomienia lokalnej instancji
przez szkołę lub uniwersytet.
7. Rzetelne rzemiosło: 1 441 testów backendu, 1 314 sprawdzeń w przeglądarce, czysty audyt
dostępności, podwójna sanityzacja danych.

Barierą wejścia dla konkurencji nie jest kod, który udostępniamy za darmo. Jest nią zweryfikowany
zbiór wiedzy dopasowany do polskich realiów oraz społeczność recenzentów ręczących za poprawność
własnym nazwiskiem. Tego kapitału nie da się wygenerować automatycznie w jeden kwartał.

## Czego potrzebujesz do rozwoju rozwiązania?
☑ Wsparcie finansowe ☑ Wsparcie merytoryczne (warsztaty, mentoring) ☑ Kontakty biznesowe ☑ Promocja

## Na co przeznaczysz nagrodę?
Wnioskowaną kwotę 450 tys. zł rozkładamy na 15 miesięcy (grudzień 2026 – luty 2028), wyłącznie na
trzy filary, z weryfikowalnymi celami:

1. Treści i weryfikacja merytoryczna: 35% (157 tys. zł). Wynagrodzenia recenzenckie dla 6–8
doktorantów, młodszych pracowników naukowych i emerytowanych nauczycieli; 1 500 nowych zadań
z pełnymi rozwiązaniami (matura rozszerzona z matematyki i fizyki oraz pierwszy rok studiów ścisłych);
kurs finansów osobistych w wersji dla młodzieży i dla seniorów.
2. Rozwój technologiczny: 25% (112 tys. zł). Dwoje inżynierów w niepełnym wymiarze przez 12 miesięcy:
podpowiedzi AI oparte na zamkniętej bazie rozwiązań, generator sprawdzianów dla nauczycieli,
jednoekranowy panel recenzencki dla seniorów z logowaniem linkiem bez hasła i stałym przyciskiem
„poproś o telefon".
3. Pilotaż międzypokoleniowy: 20% (90 tys. zł). Trzy miasta, we współpracy z sekcjami emerytów ZNP,
emerytowaną kadrą UW i UTW; 30 seniorów w trzech rolach (rekrutujemy 35), w tym co najmniej
10 recenzentów; biblioteka publiczna jako kotwica, zadania do 20 minut, telefon animatora w ciągu doby
po 5 dniach ciszy, 3-miesięczne cykle zobowiązania; animator społeczności seniorów na pół etatu,
rozliczany z retencji i liczby zrecenzowanych wpisów.
4. Infrastruktura, bezpieczeństwo i kwestie formalne: 10% (45 tys. zł). Serwery i kopie zapasowe,
zewnętrzny audyt kodu, rejestracja fundacji w I kwartale 2027, audyt procedur RODO dla kont dzieci,
przygotowanie wniosków o granty instytucjonalne.
5. Badania z użytkownikami: 5% (23 tys. zł). 60 pogłębionych wywiadów i testów użyteczności (uczniowie,
studenci, nauczyciele, seniorzy), po dwie tury przed publikacją kluczowych zmian.
6. Komunikacja i społeczność: 5% (23 tys. zł). Działania z prof. Andrzejem Draganem, warsztaty na UW
i w szkołach średnich.

Kamienie milowe:
- Koniec 2026 r.: 300 aktywnych studentów UW w sesji zimowej, z czego 30 dodało własne rozwiązanie
(także wypracowane z AI); pierwsze 30 wywiadów; wersja bazowa kursu finansowego; zrekrutowany zrąb
zespołu recenzenckiego.
- Lato 2027 r.: 500 rozwiązanych zadań maturalnych; pilotaż seniorów w pierwszym mieście (10 osób
w trzech rolach); fundacja zarejestrowana (I kwartał 2027), żeby zamknąć pierwszy rok obrotowy przed
naborami z progiem obrotu; testy podpowiedzi AI i generatora sprawdzianów w 2 liceach.
- Koniec 2027 r.: 5 000 kont, 3 000 zadań, 3 uczelnie; 30 aktywnych seniorów z retencją po
3 miesiącach co najmniej 60%; pierwszy wniosek do inkubatora innowacji społecznych FERS 05.01
(mikrogranty 50–120 tys. zł, 100% finansowania, bez wymogu historii obrotów); 10 szkół z generatorem
sprawdzianów; pierwszy partner CSR modułu finansowego.

Utrzymanie po grancie, realistycznie: baza wiedzy pozostanie bezpłatna. Nie liczymy na hosting dla
szkół ani prowizje od korepetycji. Trzy filary: (1) mecenat i CSR partnerów finansowych
i technologicznych (Fundacja PFR 15–50 tys. zł na edukację ekonomiczną, Fundacja Empiria i Wiedza
20–100 tys. zł na STEAM, Fundacja Orange, mPotęga Fundacji mBanku); (2) granty publiczne w kolejności
dostępności dla młodej fundacji: inkubatory FERS 05.01, programy MEN (50 tys.–1 mln zł), NOWEFIO
i Erasmus+ KA210, a duże nabory FERS 01.04/01.08 i NCBR wyłącznie w konsorcjum z UW jako liderem;
(3) freemium: generator sprawdzianów wyceniony pod realia zakupów szkolnych (licencja szkolna 3–8 tys.
zł rocznie mieści się w zakupie bezpośrednim dyrektora poniżej 20 tys. zł netto; rada rodziców może
sfinansować go darowizną celową na rachunek szkoły, a umowę i powierzenie danych podpisuje dyrektor;
program „Cyfrowy Uczeń 2025–2029" pokrywa takie licencje w 80%). Przy mniejszej nagrodzie (300 lub
200 tys. zł) proporcjonalnie zmniejszamy pule, bezwzględnie zachowując 20% na moduł senioralny.

## Skąd wiesz o naszym programie grantowym?
⟦zaznaczyć odpowiednie pole⟧

## Zgody
☑ Klauzula informacyjna ☑ Regulamin programu grantowego ☐/☑ zgoda na kontakt po konkursie (dobrowolna)
