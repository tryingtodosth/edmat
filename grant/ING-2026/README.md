# ING "W rytmie pokoleń" (9. edycja) — application kit for EdMat.net

**Deadline: 17 September 2026** (no hour given in the rules — treat it as end of day, submit earlier).
Form: https://www.ing.pl/o-banku/esg/program-grantowy-edycja-9/formularz-zgloszeniowy
Rules: https://www.ing.pl/_fileserver/item/6yfzahx · Privacy notice: https://www.ing.pl/_fileserver/item/owpzjvu
Contact: programgrantowy@ing.pl

What is in this folder:

| file | what |
|---|---|
| `README.md` | this: rules digest, the form field by field, the checklist of things only Piotr can do, and the source of every number used |
| `formularz.md` | the answers to paste into the form, in Polish, in the form's order |
| `build_deck.py` | generates the presentation as a draw.io file (one page per slide) plus PNG previews and the PDF to upload |
| `EdMat-ING-2026.drawio` | the deck — open in draw.io (the drawio-lasso build) to edit; team slide is last and is a placeholder |
| `EdMat-ING-2026.pdf` | the same deck as a PDF, ready for the form's upload field (limit 15 MB, PDF/PPT/PPTX) |
| `slides/` | one PNG per slide, rendered by draw.io itself, for a quick look |

## The rules, digested (Regulamin obowiązuje od 8 lipca 2026)

**Who may apply.** A *Start-up* (a Polish business younger than 5 years: JDG, spółka cywilna, spółka
handlowa, spółdzielnia) **or** a *Młody Naukowiec*: a current student (BA/MA/PhD) or a graduate at most
5 years after finishing, a Polish citizen and tax resident, applying alone or **as the representative
of a Zespół** — a team in which at least one person is a Młody Naukowiec (the others need not be; FAQ
confirms). Bank employees are excluded. **EdMat applies as Naukowiec + Zespół** — no company or
foundation is needed, and the deck says so.

**Leagues.** *Liga Seed* — prototype/MVP, first user tests, no or limited sales, no repeatable sales
model. *Liga Growth* — product on the market, documented traction, repeatable acquisition channels.
EdMat is Seed: a live product, first users, no revenue.

**Evaluation criteria** (the ranking that picks up to 12 finalists is built on these, so the form
answers and the deck are written against them, in this order):
1. formal — rules met, consents given;
2. the solution, from the form and the attached presentation:
   i. innovativeness, knowledge of the expected results, degree to which it answers the challenge
      ("Jak możemy zapewnić jakościową edukację niezależnie od wieku?");
   ii. knowledge of the target group and their needs, **size** of the target group;
   iii. knowledge of the competition and similar solutions, competitive advantage;
   iv. experience of the participant/team in the area, competences needed to develop it;
   v. quality and manner of presentation.

**Timeline.** Applications to 17.09 · evaluation 21.09–13.10 · finalists announced 14.10 (by e-mail and
on the site) · finalist workshops 26.10–6.11 (voluntary, **except the individual pitch workshop, which
is mandatory**) · Final 25.11 in Warsaw: **5-minute pitch + ~3 minutes Q&A** · winners list published by
30.11. Format may be online, hybrid or on site.

**Prizes.** Per league: 450k / 300k / 200k PLN, plus a 100k "Nagroda pracowników ING" decided by a vote
of ING employees watching the Final. Grants are "for the further development of the submitted
solution"; ING may ask how the money was used and the winner must answer. ING may also not award
some or all prizes. No appeal against the jury. Applying transfers no IP. Finalists sign an image
consent (promotion of the programme).

**Money mechanics for a team of young scientists (matters for us).** If the winner has no business
activity, ING adds an extra cash prize equal to the 10% flat income tax and pays that tax itself, so
the team receives the nominal grant net. **The grant is split equally and paid to the bank accounts
of the team members** listed in the application (a start-up gets it on its company account). So:
decide who is on the team before submitting, and agree in writing how the money flows into the
project — a foundation does not exist yet and cannot be the recipient.

**Data processed:** name, e-mail, phone, solution/team name; for a start-up also NIP and website;
finalists' image.

## The form, field by field (as it renders on forms.ing.pl on 16.09.2026)

The form is one page, no character limits on the text areas (3,000 characters were accepted in a
test), one file upload (PDF/PPT/PPTX, max 15 MB, Polish or English). Choosing **Naukowiec** reveals
three extra fields. Order:

1. Zgłaszam się jako: **Naukowiec**
2. Imię i nazwisko · Adres e-mail (twice) · Numer telefonu (with country) — *Piotr*
3. Nazwa rozwiązania — see `formularz.md`
4. Liczba osób pracujących nad rozwiązaniem — *Piotr* (a number)
5. Opisz kompetencje osób pracujących nad rozwiązaniem — `formularz.md`, fill the names
6. Poziom dojrzałości: **Liga Seed**
7. Dodaj prezentację — upload `EdMat-ING-2026.pdf` (there is also a link "Sprawdź nasze wskazówki,
   jak przygotować prezentację" inside the form; it is a custom element that did not open in a
   headless browser — **open it yourself before uploading** and check the deck against it)
8. Opisz krótko swoje rozwiązanie — `formularz.md`
9. Kto jest odbiorcą Twojego rozwiązania? — `formularz.md`
10. Jak Twoje rozwiązanie odpowiada na wyzwanie konkursowe? — `formularz.md`
11. Jak Twoje rozwiązanie wyróżnia się na tle konkurencji? — `formularz.md`
12. Czego potrzebujesz do rozwoju rozwiązania? — tick: Wsparcie finansowe, Wsparcie merytoryczne,
    Kontakty biznesowe, Promocja
13. Na co przeznaczysz nagrodę? — `formularz.md`
14. Skąd wiesz o naszym programie grantowym? — *Piotr* (checkboxes)
15. Consents: privacy notice ✔, rules ✔; the third (post-competition survey contact) is optional
16. Wyślij zgłoszenie — you get an on-screen confirmation **and** an automatic e-mail; if no e-mail
    arrives, write to programgrantowy@ing.pl

## Only Piotr can do these — in this order

- [ ] Decide the team list (who is on the application) and the money agreement (see above).
- [ ] The **Team** slide and the "kompetencje" answer name the four founding members (Piotr, Marysia
      Nazarczuk, Marc Ploeg, prof. Katarzyna Grabowska), Andrzej Dragan as supporter and Natalia Prus
      as collaborator. **Confirm with each person that they agree to be named** — Marysia first, then
      Marc, then Kasia (the order they are likely to answer). Check Marysia's degrees wording
      ("matematyka: licencjat, II rok mgr; studia licencjackie z fizyki i informatyki") and add Natalia's
      affiliation if she wants it there. The deck gives no follower numbers for Dragan, because none
      is verified.
- [ ] Open the form's "wskazówki, jak przygotować prezentację" link and compare with the deck.
- [ ] Export/upload: `EdMat-ING-2026.pdf` is generated; if you edit the `.drawio` in draw.io, re-export
      with File → Export as → PDF (all pages, no page selection) and check it is under 15 MB.
- [ ] Clean the live site before the jury visits it (they will — the deck says "edmat.net, działa"):
      - discipline **"Chemia" has description "asd"** and no branches; "Biznes" has an empty
        description and a branch named "intro"; the physics branch "Waves" is in English;
      - the Activity page shows a comment titled "kok" and two exercises named "Phase 3 e2e submitted
        exercise";
      - Events and Tutoring are empty ("Nic jeszcze nie jest zaplanowane", "Brak ofert korepetycji") —
        one real event (an exam-prep session at FUW) and one real tutoring listing would remove the
        empty-site impression Marc described;
      - the footer says "Prototyp — to prawdziwy serwer…" — fine for users, odd for a juror; consider
        "Wersja pilotażowa".
- [ ] Submit on 16.09 or early 17.09, not at the last hour.

## Where every number comes from (verified 16.09.2026)

| claim | source |
|---|---|
| 745 zadań, 742 ze zweryfikowanym rozwiązaniem, 2 przedmioty UW (388 Analiza matematyczna, 357 Rachunek prawdopodobieństwa) | live `https://edmat.net/api/exercises/` |
| 9 materiałów (skrypty, zbiory ćwiczeń, w tym "Blog – Marcin Iwuć", "50 modeli biznesowych") | live `https://edmat.net/api/materials/` |
| 1 441 testów backendu, wszystkie zielone | `manage.py test --parallel 4` run 16.09, `Ran 1441 tests in 301.888s — OK` |
| 1 314 sprawdzeń w przeglądarce w 46 scenariuszach e2e | `test.md` summary lines, `frontend/e2e/*.mjs` count |
| 2 094 komunikaty interfejsu w każdym z 2 języków | `frontend/messages/{en,pl}.json` |
| audyt dostępności: 22 strony, 0 naruszeń | `npm run check:katex`/`check:a11y` results in root `CLAUDE.md` §17AT |
| 19 modułów backendu, 161 migracji, ~111 tys. linii kodu | repo |
| kod otwarty, licencja MIT; rozwijany od lipca 2026 (pierwszy commit 25.07.2026, 248 commitów) | `LICENSE`, `git log` |
| 1 280 tys. studentów (2024/25) | GUS, "Szkolnictwo wyższe w roku akademickim 2024/2025" |
| 321 314 zdających maturę w 2026 | CKE, wyniki matur 2026 |
| ~10 mln osób 60+, 26,6% ludności (2024) | GUS, "Informacja o sytuacji osób starszych w Polsce za 2024 r." |
| 747 uniwersytetów trzeciego wieku, 125,9 tys. słuchaczy (2024/25) | GUS, "Uniwersytety trzeciego wieku" 2024/25 |

Numbers **not** used because they could not be verified: prof. Dragan's audience size, the count
of registered users on the live server (the API does not expose it — Piotr can read it from the
admin and add it to the traction slide if it is worth stating).
