# EdMat — jak to uruchomić

Instrukcja dla Ubuntu. Nie trzeba mieć wcześniej zainstalowanego Pythona, Node'a ani niczego innego
— skrypt sprawdza, czego brakuje, i dokłada to sam.

**Cały czas to ok. 5 minut**, z czego 4 to czekanie.

---

## Najkrótsza wersja

Otwórz terminal (`Ctrl` + `Alt` + `T`), wejdź do katalogu z projektem i wpisz dwie rzeczy:

```sh
./setup.sh
./run.sh
```

Potem otwórz w przeglądarce: **http://localhost:5173**

Zaloguj się jako **`kasia@edmat.example`**, hasło **`password123`**.

Żeby zatrzymać — wróć do terminala i naciśnij `Ctrl` + `C`.

Następnym razem wystarczy samo `./run.sh`. `setup.sh` uruchamiasz tylko raz.

---

## Gdyby coś nie zadziałało

**`bash: ./setup.sh: Permission denied`**
Pliki straciły prawo do uruchamiania (zdarza się po przesłaniu przez maila albo dysk sieciowy):

```sh
chmod +x setup.sh run.sh
./setup.sh
```

**Pyta o hasło**
To normalne — `setup.sh` instaluje brakujące programy przez `apt`, a to wymaga hasła do Twojego
konta. Pyta tylko raz i tylko jeśli czegoś rzeczywiście brakuje.

**`Port 5173 is already in use` albo `Address already in use`**
Coś już działa na tym porcie — najczęściej poprzednie uruchomienie, które nie zostało zamknięte:

```sh
fuser -k 5173/tcp
fuser -k 8000/tcp
./run.sh
```

**Strona się otwiera, ale jest pusta / wszędzie „nothing here yet”**
Nie wgrały się przykładowe dane. Uruchom:

```sh
cd backend
../.venv/bin/python3 manage.py seed_demo_content
cd ..
./run.sh
```

**Chcę zacząć od zera**
Kasujesz bazę i budujesz ją jeszcze raz. Nic poza bazą nie zniknie:

```sh
rm backend/db.sqlite3
./setup.sh
```

---

## Co można łatwo zmienić

Na samej górze `setup.sh` są cztery linijki — to jedyne miejsce, które warto ruszać:

```sh
BACKEND_PORT=8000        # port serwera z danymi
FRONTEND_PORT=5173       # port strony
SEED_DEMO_CONTENT=yes    # 'no' = pusty serwis, bez przykładowych profili i kursów
IMPORT_EXERCISES=yes     # 'no' = bez 742 zadań (szybciej, ale serwis jest wtedy pusty)
```

Jeśli zmienisz `BACKEND_PORT`, zmień go też na górze `run.sh` — muszą się zgadzać.

---

## Konta, na które można się zalogować

Hasło do **wszystkich**: `password123`

| E-mail | Kim jest |
|---|---|
| `kasia@edmat.example` | moderatorka — widzi kolejkę moderacji (zakładka „Moderation”) |
| `michal@edmat.example` | zwykły użytkownik |
| `ania@edmat.example` | prowadzi kurs „Analiza od zera”, ma w nim troje uczestników |
| `piotr@edmat.example` | prowadzi kurs z zapisami za zgodą — **czeka u niego jedna prośba do rozpatrzenia** |
| `zofia@edmat.example` | ma kurs opublikowany i jeden szkic (szkic widzi tylko ona) |
| `jakub@edmat.example` | uczestnik, który poprosił o dołączenie i czeka na decyzję |

Możesz też założyć własne konto przez „Sign up”.

---

## Co warto kliknąć, żeby zobaczyć, że to działa

Kolejność jest celowa — każdy punkt pokazuje coś innego.

1. **Bez logowania**, wejdź na **Courses** → „Analiza od zera”.
   Zobaczysz tytuły zajęć, ale nie notatki do nich — notatki są dla uczestników.

2. Zaloguj się jako **`jakub@edmat.example`** i otwórz ten sam kurs.
   Teraz notatki są widoczne, bo Jakub jest uczestnikiem. Jest też dyskusja i suwak
   „Powiadamiaj mnie o tym kursie”.

3. Zaloguj się jako **`piotr@edmat.example`** → **Courses** → jego kurs.
   Na dole czeka prośba o dołączenie, z wiadomością od proszącego, oraz przyciski
   „Przyjmij / Odrzuć”. Przyjmij ją i zobacz, że liczba uczestników rośnie.

4. Kliknij czyjeś nazwisko przy komentarzu → trafisz na **profil**.
   Jest tam doświadczenie, umiejętności (z zaznaczeniem, co jest tylko deklaracją, a co
   zaliczonym przedmiotem) i lista aktywności, którą można **sortować, filtrować po rodzaju
   i po tagu**.

5. Wejdź na dowolne **zadanie** z „Browse fields”.
   Są tam oceny z komentarzem i wątek dyskusji z odpowiedziami.

6. **Log in** → na dole strony logowania są cztery przyciski (Google, Apple, GitHub, uczelnia).
   To **szkice** — kliknięcie otwiera okienko, które mówi dokładnie, co już jest gotowe, a czego
   brakuje, żeby zaczęły działać naprawdę. Żaden z nich nikogo nie loguje.

7. **Settings** → sekcja „Education”: można zadeklarować uczelnię i (na razie na atrapie danych)
   przenieść dyplom i oceny. Osobno decydujesz, co z tego jest widoczne dla innych.

---

## Czego tu jeszcze nie ma

Żeby nie było niespodzianek:

- **Logowanie przez Google/Apple/GitHub nie działa** — to szkice, i same to o sobie mówią.
- **Połączenie z USOS-em nie jest prawdziwe** — działa na atrapie, żeby dało się zobaczyć całą
  ścieżkę. Prawdziwe wymaga zgody każdej uczelni z osobna.
- **Nikt nie wysyła e-maili.** Powiadomienia są tylko w serwisie, pod dzwonkiem.
- **Nie ma płatności.** Cena przy kursie to tylko informacja.
- To działa **na Twoim komputerze**, pod adresem `localhost` — nikt z zewnątrz tego nie widzi.

---

## Dla ciekawych: co robi `setup.sh`

Nic magicznego, sześć kroków, wszystkie do zrobienia ręcznie:

1. sprawdza i doinstalowuje `python3`, `python3-venv`, `nodejs`, `npm` (Node musi być w wersji 20+),
2. tworzy `.venv` i instaluje do niego pakiety z `requirements.txt`,
3. instaluje pakiety strony (`npm install`),
4. tworzy bazę (`migrate` **oraz** `migrate_log_shards` — o tym drugim łatwo zapomnieć),
5. wgrywa 742 prawdziwe zadania i przykładowe profile, kursy, oceny i komentarze,
6. buduje stronę.

Można go uruchomić drugi raz — każdy krok najpierw sprawdza, czy nie jest już zrobiony.

Jeśli kiedyś zechcesz zajrzeć głębiej: `README.md` opisuje projekt, `test.md` — jak uruchomić testy.
