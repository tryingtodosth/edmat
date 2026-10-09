# Polish law on running a *konkurs* — research brief for an EdMat "contests" module

Researched 2026-10-09. Every claim carries the act, article and URL. Markers used:
**[VERIFIED]** — I opened a source carrying the text or an authoritative restatement.
**[UNVERIFIED]** — I could not open the consolidated text and the number/detail is from a secondary
source or from memory.
**[DISPUTED]** — the law is genuinely contested; a lawyer must pick a side.

Scope note: this is research for engineering, not legal advice. Nothing here was checked by a
Polish lawyer.

---

## 1. What a *konkurs* is legally — Kodeks cywilny art. 919–921

A contest in Polish law is not its own contract type. It is a **przyrzeczenie publiczne** (public
promise of a reward), governed by Kodeks cywilny (ustawa z 23 kwietnia 1964 r., Dz.U. 1964 nr 16
poz. 93) art. 919–921. It is a **unilateral juridical act**: the organiser binds himself by
announcing; the participant binds nobody by entering.

- **art. 919 § 1** — *"Kto przez ogłoszenie publiczne przyrzekł nagrodę za wykonanie oznaczonej
  czynności, obowiązany jest przyrzeczenia dotrzymać."* The promise must be made **by public
  announcement** and must promise **a nagroda** for **a specified action**. Those three elements are
  the whole constitutive test. **[VERIFIED]** — https://arslege.pl/odwolanie-przyrzeczenia-publicznego/k9/a6859/
- **art. 919 § 2** — *"Jeżeli w przyrzeczeniu nie był oznaczony termin wykonania czynności ani nie
  było zastrzeżenia, że przyrzeczenie jest nieodwołalne, przyrzekający może je odwołać. Odwołanie
  powinno nastąpić przez ogłoszenie publiczne w taki sam sposób, w jaki było uczynione przyrzeczenie.
  Odwołanie jest bezskuteczne względem osoby, która wcześniej czynność wykonała."* **[VERIFIED]**, same URL.
  Three engineering consequences: (a) revocability is the *default* unless a deadline or an
  irrevocability clause exists; (b) revocation must use **the same channel** as the announcement — so
  if EdMat hosted the announcement, EdMat must host the revocation, with the same visibility; (c)
  revocation **cannot** strip someone who already performed.
- **art. 920 §§ 1–3** — several independent performers each get the full prize **unless only one
  prize was promised**; if one prize, it goes to whoever reports first, and on simultaneous reports
  to whoever performed first; joint performers have the prize divided by a court on dispute.
  **[VERIFIED]** — https://e-prawnik.pl/kodeksy/kodeks-cywilny/zobowiazania-przyrzeczenie-publiczne/
- **art. 921 § 1** — *"Publiczne przyrzeczenie nagrody za najlepsze dzieło lub za najlepszą czynność
  jest bezskuteczne, jeśli nie został w nim oznaczony termin, w ciągu którego można ubiegać się o
  nagrodę."* This is the **konkurs** proper (prize for the *best* work, not merely for performing).
  **A missing deadline makes the whole promise ineffective (bezskuteczne).** **[VERIFIED]** —
  https://arslege.pl/przyrzeczenie-nagrody-konkursowej/k9/a6861/
- **art. 921 § 2** — *"Ocena, czy i które dzieło lub czynność zasługuje na nagrodę, należy do
  przyrzekającego, chyba że w przyrzeczeniu nagrody inaczej zastrzeżono."* The organiser judges by
  default; a jury exists only because the regulamin creates one. **[VERIFIED]**, same URL.
- **art. 921 § 3** — *"Przyrzekający nagrodę nabywa własność nagrodzonego dzieła tylko wtedy, gdy to
  zastrzegł w przyrzeczeniu. W wypadku takim nabycie własności następuje z chwilą wypłacenia
  nagrody. Przepis ten stosuje się również do nabycia praw autorskich albo praw wynalazczych."*
  **[VERIFIED]**, same URL. See §6 for why this is not as strong as it reads.

**If the regulamin is missing or defective.** A regulamin is not itself a statutory requirement —
art. 919 needs only an announcement. But:
1. No deadline for claiming the prize ⇒ **art. 921 § 1: bezskuteczność** of a "best work" contest.
   This is the one hard, mandatory field. Make it non-nullable in the schema.
2. No deadline *and* no irrevocability clause ⇒ freely revocable under art. 919 § 2.
3. No jury clause ⇒ the organiser decides alone (art. 921 § 2), which is lawful but is exactly the
   fact pattern that produces complaints.
4. No IP reservation ⇒ no transfer of ownership or copyright (art. 921 § 3 *a contrario*).
5. Gaps are then filled by general rules — and a court reads an ambiguous unilateral promise against
   its author. A defective regulamin does not void the contest; it voids *the organiser's
   protections*. **[UNVERIFIED]** as to the interpretive canon; the four statutory consequences are
   verified.

Background doctrine (useful, non-binding): N. Gralewska, *Jurydyczna konstrukcja przyrzeczenia
publicznego*, Folia Iuridica Universitatis Wratislaviensis 2016 vol. 5(1) 241–260 —
https://repozytorium.uni.wroc.pl/Content/79304/04_13_N_Gralewska_Jurydyczna_konstrukcja_przyrzeczenia_publicznego.pdf

---

## 2. The lottery boundary — ustawa o grach hazardowych

Ustawa z 19 listopada 2009 r. o grach hazardowych (Dz.U. 2009 nr 201 poz. 1540, consolidated
several times).

- **art. 2 ust. 1 pkt 10** defines **loteria promocyjna**: a *gra losowa* in which one participates
  by buying goods, a service or another proof of participation, and thereby participates in the
  lottery free of charge, the organiser offering cash or in-kind prizes. **[VERIFIED via secondary]**
  — https://www.prawo.pl/biznes/konkurs-a-loteria-promocyjna-roznice-i-przepisy,533760.html ;
  https://dudkowiak.pl/prawo-hazardowe/loterie-konkursy-i-akcje-promocyjne/
- **art. 2 ust. 1** generally defines *gry losowe* as games for cash or in-kind prizes **whose result
  depends in particular on chance** (*wynik w szczególności zależy od przypadku*). **[UNVERIFIED]**
  as to exact wording of the chapeau — I did not open the consolidated text.
- **Permit:** organising a loteria promocyjna requires a **zezwolenie** from the *dyrektor izby
  administracji skarbowej* — **regardless of scale or prize value**; art. 32 (competence) and art. 7
  ust. 1 (promotional/fantasy lotteries may be organised only on a permit) **[UNVERIFIED article
  numbers]** — https://www.abanana.pl/baza-wiedzy/zezwolenie-na-loterie-promocyjna-kiedy-jest-wymagane-i-jak-je-uzyskac
- **The decisive test** — and this is the hard rule for us: **the element of chance may not appear at
  any stage.** If the outcome of *any* stage of something called a "konkurs" is independent of the
  participant's will, knowledge or skill, and that stage affects the final result, the whole thing is
  a game of chance. A WSA Łódź judgment on a Facebook promotion is the usual citation.
  **[VERIFIED via secondary]** — https://lookreatywni.pl/baza-wiedzy/czy-to-jest-gra-losowa-czy-moze-nadal-konkurs/
  The signature of a genuine konkurs is therefore: (a) a *creative or knowledge task*, (b)
  **published merit criteria**, (c) a **jury (komisja konkursowa)** applying them, (d) results
  traceable to the criteria. A tie-break by draw is enough to contaminate it. **[VERIFIED via
  secondary]**, same sources.
- **Penalties.** Administrative: **art. 89** u.g.h. — *kary pieniężne* on whoever organises games
  without a permit/concession/notification, and also on participants in such games; amounts vary by
  game type. **[VERIFIED via secondary]** — https://arslege.pl/kary-pieniezne/k185/a17527/ ;
  https://standardyprawa.pl/akt/95/art/16357 . Penal-fiscal: **Kodeks karny skarbowy art. 108** —
  organising or conducting a loteria promocyjna, loteria fantowa, gra bingo fantowe or loteria
  audiotekstowa contrary to the Act or the permit's conditions: fine up to **240 stawek dziennych**.
  **[VERIFIED via secondary]** — https://arslege.pl/urzadzanie-lub-prowadzenie-loterii-wbrew-przepisom-ustawy-lub-warunkom-zezwolenia/k12/a3299/
  The two regimes stack (administrative + penal-fiscal).

**Validation rule for EdMat (hard):** the module must make a random draw structurally impossible —
no "losowanie" mechanism, no random tie-break, a **required** free-text merit-criteria field, a
**required** jury (≥1 named judge, and the UI should push ≥3), and a refusal (400) with a reason if
the organiser's own description matches a draw. A prize-free challenge is outside the Act anyway
(no cash or in-kind prize ⇒ no *gra losowa*), which is why preset (g) in §13 is the safe default.

---

## 3. Tax on prizes (PIT)

Ustawa z 26 lipca 1991 r. o podatku dochodowym od osób fizycznych (Dz.U. 1991 nr 80 poz. 350).

**art. 21 ust. 1 pkt 68 — the 2 000 PLN exemption.** Exempt is the value of winnings in *konkursy i
gry* **organised and announced (emitowane/ogłaszane) by the mass media (prasa, radio, telewizja)**,
and of prizes in **konkursy w dziedzinie nauki, kultury, sztuki, dziennikarstwa i sportu**, and of
prizes connected with *sprzedaż premiowa* of goods or services — **if the single prize value does not
exceed 2 000 zł**; it does not apply to prizes received in connection with the recipient's
non-agricultural business. **[VERIFIED via secondary]** —
https://poradnikprzedsiebiorcy.pl/-nagroda-w-konkursie-jak-rozliczyc ;
https://www.podatki.biz/artykuly/pit-opodatkowanie-nagrod-rzeczowych-i-pienieznych-w-konkursach-obowiazki-zwyciezcow-i-organizatorow_65_51225.htm

Two separate limbs, and the second one matters most to EdMat: **a contest "w dziedzinie nauki" does
not need to be in mass media at all.** A maths or physics exercise contest is squarely *nauka*. That
limb is the one to rely on; it is also the one tax authorities read narrowly (they want a genuine
scientific/educational subject matter, not a marketing game dressed up).

**"Środki masowego przekazu" and the internet — [DISPUTED].** The statute names *prasa, radio,
telewizja*. Whether a website or a social-media profile counts is the long-running dispute. The
Dyrektor KIS line in ordinary company contests run on the company's own site or social media is that
the exemption does **not** apply and 10% must be withheld from the whole prize. **[VERIFIED via
secondary]** — https://poradnikprzedsiebiorcy.pl/-nagroda-w-konkursie-jak-rozliczyc . Courts have
been more willing to treat internet media as mass media where the announcement is genuinely public
and the publisher is media-like; a 2024 NSA judgment is cited as the current position but I could not
open it. **[UNVERIFIED]** — the specific NSA judgment of 10 October 2024 referenced at
https://poradnikprzedsiebiorcy.pl/-nagroda-w-konkursie-jak-rozliczyc . **Engineering stance:** do
not let the UI promise the mass-media limb. Promise nothing; surface the *nauka/kultura/sztuka/sport*
limb as a checkbox the organiser asserts, with the 2 000 zł threshold shown.

**art. 30 ust. 1 pkt 2 — the 10% flat tax.** 10% *zryczałtowany podatek dochodowy* on income from
*wygrane w konkursach, grach i zakładach wzajemnych lub nagrody związane ze sprzedażą premiową*,
computed on the prize's value, with **no cost deduction and no aggregation into the annual return**.
**[VERIFIED via secondary]** — https://www.podatki.biz/artykuly/pit-opodatkowanie-nagrod-rzeczowych-i-pienieznych-w-konkursach-obowiazki-zwyciezcow-i-organizatorow_65_51225.htm

**Who withholds.** The **organiser is the płatnik** (art. 41 ust. 4 PIT), remits to the US and files
**PIT-8AR** annually (art. 42 ust. 1a PIT) — the payment deadline being the 20th of the following
month. **[UNVERIFIED]** as to art. 42 ust. 1a and the 20th; the płatnik role and PIT-8AR are
**[VERIFIED via secondary]** at the same URL and
https://lex4you.pl/podatkowe-skutki-nagrod-w-konkursach-firmowych-jak-rozliczyc-pracownika-zleceniobiorce-i-przedsiebiorce/

**Prizes in kind (nagrody rzeczowe).** **art. 41 ust. 7 PIT**: where the prize is not money, the
**taxpayer (the winner) must pay the płatnik the tax amount before the prize is handed over**.
**[VERIFIED via secondary]** —
https://epodatnik.pl/interpretacje-podatkowe/interpretacje-do-przepisu.php?art=41&i=0&lit=&pkt=&ust=7&ustawy=o-podatku-dochodowym-od-osob-fizycznych
If the organiser hands the prize over anyway without collecting, **the organiser is liable from his
own assets** (Ordynacja podatkowa art. 30 §1 — płatnik's liability) **[UNVERIFIED article]**, same
source. Hence the universal **"ubruttowienie" / gross-up** practice: the regulamin declares the prize
to consist of the item **plus a cash component equal to the tax**, the whole being the taxable base,
so 10% of the grossed-up value is withheld from the cash part and the winner pays nothing out of
pocket. The arithmetic is prize_net / 0.9 (i.e. add 11.11%). This is **practice, not statute**
**[VERIFIED as practice via secondary]** — https://www.pluxee.pl/blog/podatek-od-nagrod-i-benefitow/
Warning: one secondary source still quotes a **760 zł** threshold for art. 41 ust. 7 — that is the
pre-2015 *sprzedaż premiowa* figure and is **obsolete**; the current figure is 2 000 zł. Flagged
because the error is in circulation: https://www.podatki.biz/artykuly/pit-opodatkowanie-nagrod-rzeczowych-i-pienieznych-w-konkursach-obowiazki-zwyciezcow-i-organizatorow_65_51225.htm

**art. 21 ust. 1 pkt 115 — pupils' prizes.** Exempt are *wygrane i nagrody otrzymane przez uczniów
za udział w konkursach, turniejach i olimpiadach organizowanych na podstawie przepisów o systemie
oświaty*. **No value cap.** **[VERIFIED via secondary]** —
https://e-prawnik.pl/interpretacje-podatkowe/ibpbii1415-95510bd-1.html . This is why preset (a) and
(b) in §13 are tax-clean and preset (e) is not: the exemption hangs on the contest being organised
**on the basis of the education-system rules** (see §7), i.e. the MENiS 2002 regulation, not merely
on the winner being a pupil.

**art. 21 ust. 1 pkt 39 / pkt 40 — scholarships.** pkt 39 covers *stypendia naukowe i za wyniki w
nauce* under rules approved by the minister / certain bodies; pkt 40 covers *świadczenia pomocy
materialnej dla uczniów i studentów* from the state budget or local-government budget.
**[UNVERIFIED]** — numbers and scope from memory; I did not open either. **Relevant to EdMat only if
a "contest" is really a scholarship competition**, which is a different legal animal (a grant
procedure, not a przyrzeczenie publiczne). Keep it out of scope; if an organiser calls a stypendium a
konkurs, the tax treatment changes entirely.

**A non-profit or private-individual organiser.** The *płatnik* obligation under art. 41 ust. 4 is
not limited to businesses: *osoby prawne i ich jednostki organizacyjne oraz jednostki organizacyjne
niemające osobowości prawnej* are płatnicy. A **stowarzyszenie or fundacja is therefore a płatnik**
and must register, withhold and file PIT-8AR. **[UNVERIFIED]** as to the exact chapeau wording. A
**natural person not running a business** is generally **not** a płatnik under art. 41 ust. 1/4 —
with the consequence that the winner must self-report. Which rule applies to an individual teacher
organising a prize contest is genuinely unclear to me; this is lawyer question #2 in §14.
**[UNVERIFIED / UNCERTAIN]**

---

## 4. Minors

**Capacity — Kodeks cywilny.** **[UNVERIFIED verbatim]** — I could not open a page carrying arts.
12–21; the following is from memory of the code and is standard, but the wording should be checked.
- **art. 12** — no capacity for legal acts: persons under 13 and persons fully incapacitated.
- **art. 14 § 1** — an act by a person with no capacity is **nieważna** (void).
- **art. 15** — **limited** capacity: minors who have turned **13**, and partially incapacitated
  persons.
- **art. 17** — an act by which a limited-capacity person **disposes of a right or incurs an
  obligation** requires the **consent of the statutory representative** (parent/guardian).
- **art. 18 § 1** — such a contract becomes valid on the representative's **confirmation
  (potwierdzenie)**, including after the fact.
- **art. 20** — a limited-capacity person may, **without consent**, conclude contracts of the kind
  commonly concluded in *drobne bieżące sprawy życia codziennego*.
- **art. 21** — may freely dispose of his own earnings.

Applied to a contest: entering a contest, on the dominant reading, is **not** merely a "drobna
bieżąca sprawa" once it involves granting a copyright licence, consenting to image publication or
accepting a prize of value; so **a 13–17-year-old needs guardian consent** and an **under-13 cannot
enter in his own name at all** — the guardian acts. **[UNVERIFIED as applied]** — this is the
conclusion every practitioner source reaches but it is interpretation, not statute. Note the
asymmetry: *performing* the contest action is a factual act, not a legal one, so the minor's *work*
is valid; the shaky parts are the licence, the image consent and the receipt of the prize.

**GDPR consent age.** **GDPR art. 8(1)**: for *information-society services offered directly to a
child*, processing on consent is lawful where the child is **at least 16**; below that, consent must
be given or authorised by the holder of parental responsibility. Member States may lower it, but
**not below 13**. **art. 8(2)**: the controller must make *reasonable efforts to verify* the consent,
taking available technology into account. **[VERIFIED]** —
https://gdpr.pl/baza-wiedzy/akty-prawne/interaktywny-tekst-gdpr/artykul-8-warunki-wyrazenia-zgody-przez-dziecko-w-przypadku-uslug-spoleczenstwa-informacyjnego

**Poland did not lower it.** The **ustawa z 10 maja 2018 r. o ochronie danych osobowych** (Dz.U. 2018
poz. 1000) contains **no provision on the child-consent age** — a draft lowering it to 13 was removed
before adoption — so **GDPR's default 16 applies directly in Poland**. **[VERIFIED via secondary]** —
https://prawo.gazetaprawna.pl/artykuly/1113981,rodo-dane-osobowe-dzieci-pod-ochrona-az-do-16-lat.html ;
https://gdpr.pl/omowienie-ustawy-o-ochronie-danych-osobowych-z-10-maja-2018-roku
**Correction to the brief's premise:** there is **no art. 8 of the Polish ustawa o ochronie danych
osobowych transposing GDPR art. 8**. Cite GDPR art. 8 directly and note the absence of a national
derogation. (The Polish act does have an art. 8, but on a different subject; I could not open it to
say what, so: **[UNVERIFIED]** what art. 8 u.o.d.o. actually regulates — just do not cite it for the
age.)

**Image (wizerunek).** **Prawo autorskie art. 81 ust. 1**: *"Rozpowszechnianie wizerunku wymaga
zezwolenia osoby na nim przedstawionej. W braku wyraźnego zastrzeżenia zezwolenie nie jest wymagane,
jeżeli osoba ta otrzymała umówioną zapłatę za pozowanie."* **art. 81 ust. 2** — no permission needed
for a *osoba powszechnie znana* where the image was made in connection with public functions, or
where the person is only a **detail of a larger whole** (gathering, landscape, public event).
**[VERIFIED]** — https://przepisy.gofin.pl/przepisy,6,29,29,1022,34260,20160101,art-81-ustawa-z-dnia-4021994-r-o-prawie-autorskim-i-prawach.html ;
https://arslege.pl/ochrona-wizerunku/k442/a36817/ . For a child, the **guardians' permission** is
required (and for an older minor, practice takes both the minor's and the guardians'). Form is free,
written recommended. **[VERIFIED via secondary]** —
https://poradnikprzedsiebiorcy.pl/-wizerunek-dziecka-dobro-dziecka-czy-jego-rodzicow

**UODO practice on children's contests.** UODO runs its own national pupil contests and its
*regulamin* is the best available model of what the regulator itself thinks is adequate: processing
on **GDPR art. 6(1)(a) consent**; a **separate** parental consent for publishing the child's **name,
surname and school** and the entry itself on the UODO site, distinct from the consent to participate;
data provision voluntary but a condition of participation; parents/guardians authorise both
participation and processing. **[VERIFIED]** — https://uodo.gov.pl/pl/file/7098 ;
https://uodo.gov.pl/pl/file/5600 ; https://uodo.gov.pl/pl/file/2568 . The separation of consents is
the lesson: **publication of a winner's name must be its own, separately revocable consent**, not
bundled into entry.

---

## 5. RODO / GDPR for the organiser

- **Controller identity.** The **organiser is the administrator** of entrants' data for the contest.
  In UODO's own contests, UODO names itself administrator. **[VERIFIED]** — https://uodo.gov.pl/pl/file/7098
- **Legal basis — [DISPUTED] and the most consequential design choice.** Two candidates:
  **art. 6(1)(b)** (necessary for performance of a contract — the regulamin as the contract) and
  **art. 6(1)(a)** (consent). UODO's own regulaminy use **consent**, art. 6(1)(a).
  **[VERIFIED]** — https://uodo.gov.pl/pl/file/7098 . The practitioner argument for (b) is strong on
  doctrine (a przyrzeczenie publiczne plus entry creates an obligational relationship) and avoids the
  absurdity that a withdrawn consent mid-judging destroys the entry. The pragmatic answer most
  regulaminy adopt: **art. 6(1)(b)/(c) for conducting and settling the contest and for the tax
  records** (art. 6(1)(c) + the PIT płatnik duty), and **art. 6(1)(a) consent only for the optional
  extras** — publishing the name, publishing the image, publishing the entry, marketing. Build it
  that way: it is the union of both views and nothing breaks if a consent is withdrawn.
- **Information clause (art. 13 GDPR).** Must state: identity and contact of the controller (and of
  the IOD if appointed), purposes and legal bases, recipients (explicitly: **the platform as
  processor**, the tax office, the courier), retention, data-subject rights (access, rectification,
  erasure, restriction, objection, portability — and **withdrawal of consent** where (a) is used),
  the right to lodge a complaint with the **Prezes UODO**, whether provision is voluntary and the
  consequence of not providing, and whether there is automated decision-making. **[UNVERIFIED
  verbatim]** — art. 13 content from memory of the Regulation; the inventory matches the UODO model
  clause at https://uodo.gov.pl/pl/file/7098
- **Retention.** Two clocks, and they differ: contest administration and complaint window (short —
  weeks after results), versus **tax documentation, 5 years from the end of the calendar year in
  which the tax fell due** (Ordynacja podatkowa art. 70 §1 limitation) **[UNVERIFIED article]**, and
  the civil limitation period for a prize claim (general 6 years, KC art. 118) **[UNVERIFIED]**. A
  single retention field in the UI is wrong; store **purpose → period** pairs.
- **Publishing the winners list.** Lawful, but it is a **separate purpose** and in UODO's own model it
  rests on **separate consent**, and the published set is deliberately minimal (imię, nazwisko,
  szkoła). **[VERIFIED]** — https://uodo.gov.pl/pl/file/7098 . Design: default the public list to
  **pseudonym or initials**, with full name only on opt-in; for minors, opt-in by the guardian. Also
  make the list **retractable** — a withdrawn consent must be able to remove a name without
  rewriting history (tombstone, per house rule 12).
- **Platform ↔ organiser relationship.** EdMat hosting the entry form, storing the entries and
  rendering the public list is processing **on behalf of** the organiser ⇒ **processor** (GDPR art.
  4(8)), requiring a **umowa powierzenia / DPA under art. 28(3)** with the mandatory content (act on
  instructions only, confidentiality, security, sub-processors, assistance, deletion/return,
  audits). **[UNVERIFIED verbatim]** — art. 28(3) content from memory. **Caveat and risk:** the more
  EdMat decides (who may enter, what the template says, which fields exist, how long data is kept,
  what the public list shows), the closer it drifts to **joint controllership (art. 26)**, which the
  CJEU has read broadly (*Wirtschaftsakademie* C-210/16, *Fashion ID* C-40/17 — **[UNVERIFIED]**,
  cited from memory). Mitigation: let the organiser set retention, visibility and eligibility; EdMat
  supplies the mechanism, not the policy. Note EdMat is **separately a controller** for its own
  account data — one user, two capacities.

---

## 6. Copyright in entries

The tension is between **KC art. 921 § 3** (reservation in the promise ⇒ acquisition of copyright on
payment of the prize) and **prawo autorskie** (ustawa z 4 lutego 1994 r., Dz.U. 1994 nr 24 poz. 83):
- **art. 41 ust. 1 pkt 1** — autorskie prawa majątkowe pass by inheritance **or by contract**.
- **art. 41 ust. 2** — a transfer or licence covers **only the fields of exploitation expressly
  named** in it (*pola eksploatacji wyraźnie w niej wymienione*).
- **art. 41 ust. 4** — a contract may not cover **fields of exploitation unknown at the time**.
- **art. 53** — *"Umowa o przeniesienie autorskich praw majątkowych wymaga zachowania formy pisemnej
  pod rygorem nieważności."* Written form **on pain of nullity**.
- **art. 67 ust. 5** — an **exclusive** licence also requires written form on pain of nullity;
  a **non-exclusive licence has no form requirement** and may be granted by accepting a regulamin.
  **[VERIFIED via secondary for 41 ust. 2, 41 ust. 4, 53]** —
  https://poradnikprzedsiebiorcy.pl/-przeniesienie-autorskich-praw-majatkowych-dobre-praktyki-w-umowach ;
  https://www.kancelariatmh.pl/przeniesienie-praw-autorskich-zasady/ . **[UNVERIFIED]** for art. 67
  ust. 5 — number from memory.

**[DISPUTED] — the core question.** Does art. 921 § 3 transfer copyright *ex lege* on a mere
reservation in the regulamin, or is it only a permission to agree, still subject to art. 53's written
form? Both positions are held in the literature. The *ex lege* camp treats the transfer as the
counter-performance for the prize, with acceptance of the regulamin plus submission as offer and
acceptance. T. Targosz holds the opposite: a copyright transfer must respect copyright law's own
construction rules (art. 41 ust. 2, art. 41 ust. 4), and where a form is required for validity the
offer must also be in that form — so **no written agreement, no transfer**. **[VERIFIED that the
dispute exists, with that attribution]** —
https://lgl-iplaw.pl/2023/09/nabycie-praw-do-prac-konkursowych-przez-przyrzekajacego-nagrode/

**What this means for an online regulamin.**
- **Can** do: grant the organiser (and the platform, for display) a **non-exclusive licence**, with
  the fields of exploitation **enumerated** (storage, reproduction, public display on the site,
  publication in a results report, print in a school bulletin, …), a term, a territory, sub-licensing
  if wanted, and a statement on derivative works (*prawo zależne* — needs a separate express
  permission, art. 2 ust. 2 / art. 46 **[UNVERIFIED]**).
- **Cannot** reliably do: **transfer** the economic rights, or grant an **exclusive** licence. Both
  need writing; an online checkbox is not *forma pisemna* (which under KC art. 78 needs a handwritten
  signature; an **electronic form with a qualified e-signature is equivalent** under KC art. 78¹ §2
  **[UNVERIFIED articles]** — and a qualified e-signature is not something EdMat's users have).
- **Never** does: waive **autorskie prawa osobiste** (art. 16 pr.aut.) — they are **inalienable and
  not waivable**. The most a regulamin can do is an undertaking not to exercise them in a defined way
  and a consent to publish anonymously or without naming. **[UNVERIFIED]** — art. 16 from memory;
  the inalienability is uncontested doctrine.
- Must handle the **minor author**: the licence is a legal act, so §4 applies — guardian consent or
  confirmation.
- **Engineering consequence:** the module should offer **licence presets only** (default: "author
  keeps everything; organiser may display the entry on EdMat and name the author"), and where an
  organiser wants a transfer, the module should generate a **separate umowa to be signed on paper
  with the prize**, and say in the UI that the regulamin clause alone is **[DISPUTED]**. Do not ship a
  "I transfer all rights" checkbox.

---

## 7. School subject contests and olympiads

**Rozporządzenie Ministra Edukacji Narodowej i Sportu z 29 stycznia 2002 r. w sprawie organizacji
oraz sposobu przeprowadzania konkursów, turniejów i olimpiad**, Dz.U. 2002 nr 13 poz. 125 — **still in
force**, consolidated by obwieszczenie MEN of 25 May 2020, **Dz.U. 2020 poz. 1036**; amended inter
alia by Dz.U. 2017 poz. 1580. **[VERIFIED]** —
https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20020130125 ;
https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20200001036 ; consolidated text at
https://eli.gov.pl/api/acts/DU/2020/1036/text.html

- **Statutory authorisation:** **art. 22 ust. 2 pkt 8 ustawy z 7 września 1991 r. o systemie oświaty**.
  **[VERIFIED]** — the consolidated text's preamble, same eli.gov.pl URL.
- **Structure.** **Olimpiady and turnieje are three-stage**: *zawody pierwszego stopnia (szkolne i
  międzyszkolne)*, *drugiego stopnia (okręgowe)*, *trzeciego stopnia (centralne)* — **§ 8**.
  **Konkursy do not have a stage structure fixed by the regulation**: the number and kind of stages
  are set by **the konkurs's own regulamin** (**§ 4 ust. 2 pkt 1**). **[VERIFIED]** from the
  consolidated text, same URL. **Correction to the brief's premise:** the familiar
  *szkolny/rejonowy/wojewódzki* ladder is **kuratorium practice encoded in each kurator's regulamin**,
  not a requirement of the 2002 regulation — several kuratoria now run two stages. Treat the stage
  ladder as **configurable**, with that triple as the default template.
- **Who may organise.** **Konkursy:** the **kurator oświaty** (§ 3 ust. 2). **Olimpiady and turnieje:**
  *szkoły wyższe, jednostki naukowe* and similar bodies whose statutory activity covers education,
  acting through a **komitet główny** (§ 9 ust. 1), typically selected by the minister in an open
  call. **[VERIFIED]** for § 3 ust. 2 and § 9 ust. 1, same URL; **[UNVERIFIED]** for the open-call
  selection mechanism.
- **Required regulamin content.** **§ 4 ust. 2** for konkursy: the elimination procedure, the scope of
  knowledge and skills, the literature list, qualification criteria for the next stage, and the
  *tryb pracy komisji*. **§ 9 ust. 4** for olimpiady, additionally including the committee's
  procedures, the **tryb odwoływania się przez uczestników od oceny prac** (§ 9 ust. 4 pkt 4) and the
  documentation to be kept. **[VERIFIED]**, same URL.
- **Appeal windows.** The regulation **mandates that an appeal procedure exist** but **specifies no
  deadlines** — each regulamin sets its own. **[VERIFIED]** (absence confirmed from the consolidated
  text), same URL. In kuratoria practice the windows are short, commonly 2–7 working days from
  publication of results, with a *wgląd do pracy* right. **[UNVERIFIED]** — practice, not read from a
  source.
- **Laureat / finalista.** The regulation leaves the thresholds to each regulamin and provides for
  *zaświadczenia* (§ 5, § 13). **[VERIFIED]**, same URL.

**What the titles are worth** — this is why the preset must be distinct:
- **Egzamin ósmoklasisty:** a **laureat of a konkurs przedmiotowy of wojewódzki or ponadwojewódzki
  scope**, and a **laureat or finalista of a listed olimpiada przedmiotowa**, is **exempt** from the
  relevant part; the result is recorded as **100% and the 100th centile**, with "zwolniony/zwolniona"
  on the certificate. **ustawa o systemie oświaty art. 44zx**. **[VERIFIED]** —
  https://arslege.pl/zwolnienie-z-czesci-egzaminu-osmoklasisty/k469/a83399/
- **Matura:** a **laureat or finalista of a listed olimpiada przedmiotowa** is **exempt** from the
  matura in that subject; **100% and the 100th centile**, on presentation of the **zaświadczenie** to
  the *przewodniczący zespołu egzaminacyjnego*. **ustawa o systemie oświaty art. 44zzh**.
  **[VERIFIED]** — https://arslege.pl/zwolnienie-z-egzaminu-maturalnego-z-danego-przedmiotu/k469/a83419/ ;
  https://lexlege.pl/ustawa-o-systemie-oswiaty/art-44zzh/ (and **not** art. 44zzzd, which is the
  egzamin zawodowy).
- **Secondary-school admission:** **ustawa z 14 grudnia 2016 r. Prawo oświatowe art. 132** gives
  laureaci/finaliści standing in recruitment, and the points for lesser placings are set by the
  recruitment rozporządzenie (commonly: 10 pts for a finalista of a ponadwojewódzki konkurs
  przedmiotowy, 7 for a laureat of a ponadwojewódzki konkurs tematyczny/interdyscyplinarny, 5 for its
  finalista, capped at 18 for multiple achievements). **[VERIFIED for art. 132]**, **[UNVERIFIED for
  the point values]** — relayed from a subagent's search, not read from the rozporządzenie.
- **University admission:** **ustawa z 20 lipca 2018 r. Prawo o szkolnictwie wyższym i nauce art. 70
  ust. 6** requires the senate to adopt and publish, **in advance**, the rules on admitting
  **laureaci and finaliści of central-stage olimpiady** (and universities may extend this to
  international and nationwide konkursy). The advance-publication horizon is cited as **4 years**
  before the recruitment year. **[UNVERIFIED article number — 70 ust. 6 is from secondary sources
  only]** — https://www.bip.uni.lodz.pl/fileadmin/user_upload/t.j.uchwa%C5%82a.olimpiady.2026_2027.pdf ;
  https://rekrutacja.uw.edu.pl/files/pdf/Uchwala_270_Olimpiady_2027-2028.pdf . Typical senate practice
  lets the privilege be used in the diploma year and the following year.
- **The lists that confer all of this** are annual **komunikaty Ministra Edukacji** (wykaz olimpiad
  przedmiotowych i konkursów), published on gov.pl/web/edukacja and in CKE's BIP. **[VERIFIED]** —
  https://bip.cke.gov.pl/artykul/290/1951/harmonogram-komunikaty-i-informacje-w-2026-r

**konkurs kuratoryjny vs a private contest.** A *konkurs kuratoryjny* is organised **by the kurator**
under the 2002 regulation, is listed by the minister, and **its titles carry the statutory
privileges** and the **art. 21 ust. 1 pkt 115 PIT exemption**. A privately organised contest —
however prestigious — carries **none of those**, no matter what the organiser calls it. EdMat must
not let an organiser mark a contest as "kuratoryjny"/"olimpiada" without an **external reference**
(the kurator's or komitet główny's own page), and the UI must never imply that a user's contest
exempts anybody from an exam.

---

## 8. University contests

- **Disambiguation first:** in Polish university usage "konkurs" most often means a **competition for
  an academic post** (*konkurs na stanowisko nauczyciela akademickiego*, PSWiN art. 119
  **[UNVERIFIED article]**) or a **grant call** (NCN/NCBR *konkursy*). **Neither is this module's
  subject.** EdMat's "konkurs" is the KC art. 919–921 kind. The module's copy should avoid the bare
  word in any faculty-facing context, or qualify it (*konkurs dla studentów / dla uczniów*).
- **Who may run a student contest.** Anybody. A **uczelnia** or a **wydział** is a legal person (or
  its unit) and can be *przyrzekający* under art. 919; so can a **koło naukowe**, though a koło is
  usually not a separate legal person — the uczelnia is, and that matters for who is the PIT płatnik
  and the GDPR controller. **[UNVERIFIED]** — reasoned from the general rules, not from a source on
  koła.
- **PSWiN hooks that do exist:** art. 70 ust. 6 (admission rules for olympiad laureates, §7 above);
  the *samorząd studencki* and *koła naukowe* provisions (PSWiN arts. 110, 111 **[UNVERIFIED]**); and
  **świadczenia dla studentów** (stypendium rektora for outstanding achievements, PSWiN art. 86 ust.
  1 pkt 4 / art. 91 **[UNVERIFIED]**) — which is where a contest win can turn into money through a
  **different** legal route with a **different** tax treatment (§3, art. 21 ust. 1 pkt 39/40).
- **Prizes to students** have **no special regime**: the ordinary art. 30 ust. 1 pkt 2 10% applies,
  with art. 21 ust. 1 pkt 68's *nauka* limb usually available up to 2 000 zł. The pkt 115 pupil
  exemption does **not** reach students (it says *uczniowie*). **[VERIFIED via secondary]** —
  https://e-prawnik.pl/interpretacje-podatkowe/ibpbii1415-95510bd-1.html

---

## 9. Consumer / marketing law

Applies **only if** the organiser is a *przedsiębiorca* and the participant a *konsument*. For most of
EdMat's organisers — a teacher, a koło naukowe, a kurator — **it does not apply at all**, and the
module should not impose consumer machinery on them. It does apply to a *konkurs promocyjny* run by a
business.

- **Ustawa z 23 sierpnia 2007 r. o przeciwdziałaniu nieuczciwym praktykom rynkowym** (Dz.U. 2007 nr
  171 poz. 1206): a *praktyka rynkowa* is unfair if contrary to good morals and materially distorts
  the average consumer's conduct (art. 4 ust. 1); misleading action/omission (arts. 5–6); and
  **Annex-style black-listed practices in art. 7**, two of which are contest-specific:
  **art. 7 pkt 16** (claiming a product can increase chances of winning in games of chance) and
  **art. 7 pkt 17** (creating the false impression that the consumer has won a prize, where none
  exists or claiming it requires payment). **[UNVERIFIED]** — the act, its arts. 4–7 and the two
  black-list items are from memory; I did not open the consolidated text.
- **UOKiK positions / abusive clauses.** The *rejestr klauzul niedozwolonych* and UOKiK decisions have
  bitten contest regulaminy on the complaint procedure: **a 7-day window from publication of the
  winners list to lodge a complaint was held abusive as too short**, and a clause allowing **14
  *working* days** to answer a complaint was entered in the register. **[VERIFIED via secondary]** —
  https://www.saos.org.pl/judgments/content/13076.html (as summarised) ;
  https://rejestr.uokik.gov.pl/index.php?page=524&view= . Practical norm: **≥14 calendar days to
  lodge**, **14 calendar days to answer**, in writing or by e-mail, with reasons.
- **Regulamin availability.** A consumer-facing regulamin is a *wzorzec umowy* and must be **made
  available before entry in a way that lets it be stored and reproduced** (KC art. 384 §§ 1 and 4;
  ustawa o świadczeniu usług drogą elektroniczną art. 8 ust. 1 pkt 1 — a service provider must make
  the regulamin available free of charge before the contract and on demand in a form that permits
  acquiring, reproducing and storing it). **[UNVERIFIED]** — both articles from memory. Engineering:
  a versioned, timestamped, downloadable regulamin; the version the entrant accepted stored with the
  entry. That is good practice even where consumer law does not apply.
- **Sprzedaż premiowa — the thing to distinguish.** A promotional action in which **buying** a good or
  service is rewarded with a prize; the sale and the premium are linked, and the premium's value is
  not included in the price. It is **not a konkurs** (no merit assessment) and **not a lottery** (no
  chance) — a third category, with its own art. 21 ust. 1 pkt 68 limb and the same 2 000 zł cap, not
  available to recipients acting in business. **[VERIFIED via secondary]** —
  https://poradnikprzedsiebiorcy.pl/-rozliczenie-sprzedazy-premiowej-na-gruncie-ustawy-o-pit ;
  https://isp-modzelewski.pl/serwis/zwolnienie-od-podatku-nagrod-zwiazanych-ze-sprzedaza-premiowa/
  **EdMat takes no money, so sprzedaż premiowa is structurally impossible here** — and the module
  should refuse any entry condition that is a purchase.

---

## 10. Accessibility and equal treatment

- **Ustawa z 19 lipca 2019 r. o zapewnianiu dostępności osobom ze szczególnymi potrzebami** (Dz.U.
  2019 poz. 1696; consolidated Dz.U. 2024 poz. 1411) binds **podmioty publiczne** — organs of public
  administration, local-government units, and certain bodies created to meet general-interest needs
  that are majority-financed or majority-controlled by them. **It does not bind private entities
  directly**; a non-public entity is obliged **only** where it performs a publicly-funded task **under
  a contract with a public body, and only to the extent that contract defines**. **[VERIFIED]** —
  https://api.sejm.gov.pl/eli/acts/DU/2019/1696/text.html ;
  https://www.gov.pl/web/uw-mazowiecki/nowe-przepisy-w-zakresie-zapewniania-dostepnosci-osobom-ze-szczegolnymi-potrzebami
  **Consequence for EdMat:** a contest organised by a **kurator oświaty or a public school** is a
  public-entity activity and the accessibility duties travel with it — architectural, digital and
  information-and-communication (art. 6). A private teacher's contest is outside the act. The
  **ustawa z 4 kwietnia 2019 r. o dostępności cyfrowej stron internetowych i aplikacji mobilnych
  podmiotów publicznych** likewise binds only public entities **[UNVERIFIED]**, though the
  **European Accessibility Act** transposition will reach private services later —
  **[UNVERIFIED]** as to Polish status in 2026.
- **Anti-discrimination.** Konstytucja art. 32 (equality) and art. 70 (right to education)
  **[UNVERIFIED]**; **ustawa z 3 grudnia 2010 r. o wdrożeniu niektórych przepisów Unii Europejskiej w
  zakresie równego traktowania** ("ustawa równościowa") covering, inter alia, education and services
  **[UNVERIFIED]**; and for schools, **Prawo oświatowe** and the **Konwencja o prawach osób
  niepełnosprawnych** (ratified 2012) **[UNVERIFIED]**. Practical rule: eligibility criteria must be
  **relevant to the contest's subject**. "Only pupils of school X" is fine (a scope). "Only boys" or
  "no pupils with an IEP" is not.
- **Engineering, regardless of whether the statute binds:** require an **accommodation contact** field
  on any contest aimed at pupils; make the entry form reachable without JS-only widgets; keep the
  announcement and the regulamin in plain text (house rule 11's lazy loading must not gate reading
  the rules). This is best practice, not a statutory duty, for a private organiser.

---

## 11. The platform's position

**EdMat hosts; the user organises.** Legally that must be made explicit in three places: the terms of
use, the contest template, and the public contest page.

- **The przyrzeczenie publiczne is the organiser's.** Under KC art. 919 § 1 the obligation falls on
  *whoever publicly promised*. EdMat promises nothing, so EdMat is not a party, cannot be sued for the
  prize, and cannot revoke. The page must name the organiser as *przyrzekający* and say EdMat is only
  the medium. **[VERIFIED as to art. 919 § 1]**, §1 above.
- **Could EdMat be deemed co-organiser?** Yes, on a bad fact pattern. The risks: EdMat funding or
  supplying a prize; EdMat sitting on the jury; EdMat's branding dominating the announcement; EdMat
  choosing winners or breaking ties; EdMat promising to enforce the result; marketing the contest as
  "EdMat's contest". **[UNVERIFIED]** — reasoned from the general law, not from a source on platform
  co-organisation. Mitigations are structural, not textual: no platform-funded prizes, no platform
  jury seat, organiser identity rendered above the fold, EdMat branding subordinate on the contest
  page, and no EdMat role in judging or tie-breaking.
- **DSA.** Regulation (EU) 2022/2065. EdMat is a **hosting service** and an **online platform**
  (users' contest announcements and entries are disseminated to the public). Relevant: **art. 6**
  (conditional exemption from liability for user content, lost on actual knowledge without expeditious
  removal); **art. 14** (terms and conditions must state content restrictions, in clear language, and
  changes must be notified); **art. 16** (notice-and-action mechanism — EdMat already has
  `moderation.Report`); **art. 17** (statement of reasons for every restriction); **art. 20**
  (internal complaint-handling); **art. 25** (no dark patterns); **art. 28** (protection of minors —
  high default privacy/safety/security, no advertising based on profiling of minors). **art. 19**
  exempts providers qualifying as **micro or small enterprises** from Section 3 (which includes arts.
  20–28) — EdMat plainly qualifies, but **arts. 6, 14, 16 and 17 are in Section 2 and still apply**.
  **[UNVERIFIED]** — the DSA article numbers are from memory; verify against the Regulation.
- **Poland's DSA enforcement.** The **ustawa o zmianie ustawy o świadczeniu usług drogą elektroniczną
  oraz niektórych innych ustaw** was signed on **25 September 2026** and takes effect **6 November
  2026** (30 days after publication); the **Prezes UKE** becomes the **Koordynator ds. usług
  cyfrowych**, with KRRiT for video platforms and UOKiK for consumer-interest breaches; a Polish user
  may complain to the Prezes UKE. An earlier bill was vetoed on 9 January 2026. **[VERIFIED via
  secondary]** — https://uke.gov.pl/uslugi-cyfrowe/aktualnosci/sejm-uchwalil-ustawe-wdrazajaca-przepisy-aktu-o-uslugach-cyfrowych-prezes-uke-koordynatorem-ds-uslug-cyfrowych,26.html ;
  https://dsk-kancelaria.pl/blog/prezydent-rp-podpisal-jedna-z-ustaw-wdrazajacych-dsa-w-polsce
  This is **new since the project's last legal pass** and `LEGAL.md` should record it.
- **"EdMat never takes money" — does hosting a prize contest change that?** No, provided three
  separations hold: (1) **no prize funds pass through EdMat** — the organiser pays or hands the prize
  directly, and the module has no payment field, no escrow, no "prize pool"; (2) **no entry fee** —
  the module must refuse any paid condition of entry (which also keeps us out of *loteria promocyjna*,
  §2, and *sprzedaż premiowa*, §9); (3) **no EdMat guarantee** of prize delivery — the terms must say
  EdMat does not verify that a prize exists or will be given, and that a prize dispute is between the
  entrant and the organiser. With those, hosting creates **no tax, payment-services or gambling
  obligation for the platform**. The residual exposure is **reputational and DSA-shaped**: EdMat must
  act on notices about a fraudulent contest. **[UNVERIFIED]** — reasoned, not sourced.
- **Terms-of-use clause should say:** the contest is organised solely by the user named as organiser,
  who is the *przyrzekający* under KC art. 919–921, the sole **administrator danych** of entrants'
  data, and the sole **płatnik** of any PIT; EdMat provides the technical means only, is **not** a
  party to the przyrzeczenie publiczne and gives no warranty that prizes exist or will be delivered;
  EdMat processes entrants' data **as processor** under a DPA (GDPR art. 28); EdMat may remove a
  contest that breaches the terms or the law, with a statement of reasons (DSA art. 17) and an
  internal appeal; organisers warrant they have the rights and consents they rely on, including
  guardians' consents for minors; EdMat does not fund prizes and accepts no payment.

---

## 12. A recommended *regulamin konkursu* skeleton

Order matters less than completeness, but this is the order Polish regulaminy conventionally take.
Each section is annotated with what makes it necessary.

1. **§1 Organizator** — full identity (name, legal form, address, NIP/REGON if any, contact,
   IOD if appointed). *KC art. 919 §1 (who is bound); GDPR art. 13(1)(a)–(b).*
2. **§2 Przedmiot i cel konkursu; definicje** — the task, the subject field, the aim. *KC art. 919 §1
   ("oznaczona czynność") must be specific enough to perform; and the "w dziedzinie nauki" limb of
   PIT art. 21 ust. 1 pkt 68 is pleaded here.*
3. **§3 Terminy** — start, entry deadline, **the deadline within which the prize may be claimed**,
   results date, prize-handover date. ***KC art. 921 §1 — mandatory; a missing claim deadline makes
   the contest bezskuteczne.*** Also carries art. 919 §2 (deadline defeats free revocability).
4. **§4 Uczestnicy i warunki uczestnictwa** — who may enter, exclusions (organiser, jury, their
   relatives), **age rules and guardian consent**, no purchase required. *KC arts. 15/17/18 (minors);
   §10 above (eligibility must be relevant); ustawa o grach hazardowych (no paid condition).*
5. **§5 Zgłoszenie** — how to enter, required form, number of entries, technical requirements,
   acceptance of the regulamin. *Best practice + KC art. 384 §§1, 4 and u.ś.u.d.e. art. 8 where
   consumer law applies.*
6. **§6 Kryteria oceny i komisja konkursowa** — the merit criteria, their weights, the named jury,
   its procedure, **how ties are broken by merit (never by draw)**, whether the decision is final.
   ***Ustawa o grach hazardowych — this section is what keeps the contest out of the lottery regime;
   KC art. 921 §2 — a jury exists only if reserved here.***
7. **§7 Nagrody** — what each prize is, its value, whether it is cash or in kind, **the tax clause**
   (which exemption is relied on, or that the organiser withholds 10% as płatnik, or the
   **ubruttowienie** formula), handover mechanics, non-exchangeability, what happens to an unclaimed
   prize. *PIT art. 30 ust. 1 pkt 2, art. 41 ust. 4, art. 41 ust. 7, art. 21 ust. 1 pkt 68/115.*
8. **§8 Ogłoszenie wyników** — where and when, **what is published about a winner** (and that fuller
   publication rests on separate consent). *GDPR art. 6(1)(a); UODO model regulamin.*
9. **§9 Reklamacje** — who to write to, how, **≥14 days to lodge**, 14 days to answer, with reasons,
   and that court recourse is unaffected. *Best practice generally; **required shape** where the
   organiser is a przedsiębiorca — UOKiK register, §9 above. The 2002 MENiS regulation's §9 ust. 4
   pkt 4 makes an appeal procedure mandatory for olimpiady.*
10. **§10 Dane osobowe** — the full GDPR art. 13 clause: controller, purposes **and the legal basis
    per purpose**, recipients (**including EdMat as processor**), **retention per purpose**, rights,
    withdrawal of consent, complaint to Prezes UODO, voluntariness and consequences, no automated
    decision-making. *GDPR arts. 13, 6, 28; for under-16s, GDPR art. 8.*
11. **§11 Prawa autorskie i wizerunek** — warranty of authorship, the **non-exclusive licence** with
    **enumerated fields of exploitation**, term and territory, derivative-works permission if needed,
    **no waiver of moral rights** (undertaking + anonymity consent instead), image consent as a
    **separate** clause. *Pr.aut. arts. 41 ust. 2, 41 ust. 4, 53, 67 ust. 5 (form), 16 (moral
    rights), 81 (image); KC art. 921 §3 — and **flag that a transfer needs a written annex**.*
12. **§12 Postanowienia końcowe** — availability of the regulamin and its version, how it may be
    amended (and that amendments do not worsen acquired rights), whether the promise is
    **nieodwołalne**, what happens if the contest is cancelled, applicable law, EdMat's role as
    medium only, effective date. *KC art. 919 §2 (revocability and the same-channel rule);
    best practice.*

Attachments, where relevant: **consent form for a guardian**; **image-consent form**; **umowa o
przeniesienie praw autorskich** where a transfer is actually wanted (§6 above).

---

## 13. Preset types to offer

For each: what changes in required fields and checks. `R` = required, `H` = hidden/locked.

**(a) Konkurs przedmiotowy kuratoryjny** — `R`: external reference to the kurator's own announcement;
kurator identity as organiser (EdMat user must be verified as acting for it); stage ladder
(configurable, default szkolny → rejonowy → wojewódzki); scope (wojewódzki / ponadwojewódzki);
scope of knowledge + literature list; qualification thresholds per stage; **komisja** per stage;
**appeal procedure with a deadline**; laureat/finalista thresholds; zaświadczenie issuance.
`H`: prize/tax block (**PIT art. 21 ust. 1 pkt 115** exempts without a cap); platform-side prize
machinery. Show: "laureat → art. 44zx exemption, 100%" as *information about the kurator's contest*,
never as an EdMat promise. Checklist: is it on the minister's **wykaz**? *Basis: rozporządzenie MENiS
2002 §3 ust. 2, §4 ust. 2, §5; u.s.o. arts. 22 ust. 2 pkt 8, 44zx; Prawo oświatowe art. 132.*

**(b) Olimpiada przedmiotowa** — as (a) plus: **three stages fixed and locked** (I szkolny/
międzyszkolny, II okręgowy, III centralny); organiser must be a **uczelnia / jednostka naukowa** with
a **komitet główny**; `R` external reference to the komitet; `R` the **tryb odwoływania się**;
documentation retention. Show the art. 44zzh matura consequence and PSWiN art. 70 ust. 6 admission
rules as information. *Basis: rozporządzenie MENiS 2002 §8, §9 ust. 1 and ust. 4, §13.*

**(c) Konkurs szkolny / wewnątrzszkolny run by a teacher** — the common case, and the one that must be
easiest. `R`: organiser (school or teacher — and the module must make them choose, because it decides
the płatnik and the controller); claim deadline; criteria; jury (≥1); prize or "no prize"; guardian
consent flow for every entrant (all are minors); accommodation contact. Tax: if the school organises
under its statute and the contest is not on the MENiS basis, **pkt 115 does not apply** — surface
pkt 68's *nauka* limb and the 2 000 zł line. No consumer machinery (not a przedsiębiorca).
Publication defaults to initials. *Basis: KC arts. 919–921, 15/17; GDPR art. 8; pr.aut. art. 81.*

**(d) Konkurs uczelniany / wydziałowy** — `R`: which legal person is the organiser (the **uczelnia**,
not the wydział, for płatnik/controller purposes); unit; student/doctoral/open scope; criteria; jury;
prize + tax block (10% default, pkt 68 *nauka* limb available). Copy must disambiguate from a
**konkurs na stanowisko** (§8). Optional: link to a stypendium rektora route rather than a cash
prize. *Basis: KC arts. 919–921; PIT arts. 30 ust. 1 pkt 2, 21 ust. 1 pkt 68.*

**(e) Konkurs internetowy otwarty (open, with prizes)** — the highest-risk preset. `R`: everything in
§12; **full tax block with ubruttowienie calculator**; organiser's full identity and whether a
przedsiębiorca (if yes → **consumer block unlocks**: ≥14-day complaint window, availability/versioning
of the regulamin, UONPR art. 7 warnings); **explicit no-draw attestation**; licence preset; minors
either excluded or the full guardian flow. Warn on the art. 21 ust. 1 pkt 68 mass-media **[DISPUTED]**
point: do not rely on it. *Basis: KC arts. 919–921; u.g.h. arts. 2 ust. 1 pkt 10, 7, 89 + KKS art.
108; PIT arts. 30 ust. 1 pkt 2, 41 ust. 4/7; UONPR arts. 4–7; GDPR arts. 6, 8, 13.*

**(f) Konkurs koła naukowego** — as (d) but `R` an explicit note that the **uczelnia** is the legal
person behind the koło (so the koło cannot be the płatnik or the controller), and an "approved by"
field for the koło's supervisor/uczelnia unit. Prizes typically small and in kind → surface pkt 68 and
art. 41 ust. 7. *Basis: PSWiN (koła naukowe — **[UNVERIFIED]** art. 111); PIT as (d).*

**(g) Prize-free "challenge"** — **no nagroda ⇒ no przyrzeczenie publiczne at all** (KC art. 919 §1
needs a promised prize), therefore: **no art. 921 §1 deadline requirement** (so no bezskuteczność
risk), **no gambling-law exposure** (no cash or in-kind prize ⇒ not a *gra losowa*), **no PIT
anything** (no income), **no płatnik**, **no 2 000 zł question. What remains**: GDPR (still processing
data), image and copyright if entries are published, minors' capacity for the *licence* (not for
entering), DSA for the platform, and whatever the organiser voluntarily promised — a public statement
of criteria and results can still ground a claim in *culpa in contrahendo* or unfair-practice terms
if the organiser is a business, and non-monetary recognition (a certificate, a leaderboard place) is
**[UNVERIFIED / UNCERTAIN]** as to whether a court would treat it as a *nagroda* and pull the whole
KC regime back in. **Make this the default preset** and make adding a prize a deliberate step that
unlocks obligations.

**Missing presets worth adding:**
- **(h) Konkurs on behalf of an organisation EdMat already models** (`organizations.Organization`) —
  because the płatnik/controller is the organisation, not the user, and the module should inherit the
  identity rather than re-ask for it.
- **(i) Team contest (konkurs zespołowy)** — because **KC art. 920 § 3** makes a disputed joint prize
  a matter for a court unless the regulamin apportions it. `R`: how a team prize is split, and who
  receives it for tax purposes (each member's share is each member's income).
- **(j) Multi-stage non-school contest** — a staged contest that is *not* kuratoryjny. Needed so that
  (a)/(b) are not abused as the only way to get stages, which is how a private contest ends up
  wearing kuratorium clothing.
- **(k) Peer-reviewed / community-judged contest** — if EdMat wants reader voting, the criteria must
  still be merit-based and the vote must not be a disguised lottery; and a vote count is a weak
  defence against the §2 chance test if the field is large. **[UNVERIFIED / UNCERTAIN]** — this is a
  real open question, worth asking the lawyer about rather than building first.

---

## 14. Open questions and risks, ranked

1. **Is a community vote or a reader poll a merit criterion, or does it tip into *gra losowa* /
   arbitrariness?** Consequences are the worst on the list (art. 89 u.g.h. + KKS art. 108). Until
   answered, do not ship a voting-decides-the-prize mode. **[UNVERIFIED / UNCERTAIN]**
2. **Is an individual (non-business) organiser a PIT *płatnik*?** Determines whether EdMat's tax block
   says "you must withhold and file PIT-8AR" or "your winner self-reports". Getting it backwards
   exposes individual teachers to płatnik liability from their own assets. **[UNVERIFIED / UNCERTAIN]**
3. **Can an online regulamin alone transfer copyright under KC art. 921 §3, or does pr.aut. art. 53's
   written form defeat it?** Genuinely **[DISPUTED]** in the literature (Targosz contra). Decide
   whether the module offers transfers at all; my recommendation is licence-only plus a paper annex.
4. **Does the "w dziedzinie nauki" limb of PIT art. 21 ust. 1 pkt 68 cover a university-exercise
   contest, and does an internet announcement ever satisfy the *mass media* limb?** The second is the
   long-running dispute; a 2024 NSA judgment is cited but unread. Affects every preset's tax copy.
   **[DISPUTED]**
5. **Processor or joint controller?** How much contest configuration can EdMat impose before it
   becomes a joint controller under GDPR art. 26 — with its own information duties and its own
   liability. Draft the DPA and the joint-controller fallback together. **[UNVERIFIED]**
6. **Co-organiser risk.** Would a court treat EdMat as co-*przyrzekający* given branding, templating
   and hosting? Cheap to mitigate now (branding subordinate, organiser named, no platform jury, no
   platform prize), expensive to litigate later. **[UNVERIFIED]**
7. **Minors' entry and licence.** Whether entering a prize contest is a *drobna bieżąca sprawa życia
   codziennego* (KC art. 20) — and what verification of guardian consent is "reasonable" under GDPR
   art. 8(2) for a platform with no identity layer. Current EdMat `accounts/minors.py` already holds
   rules; this extends them. **[UNVERIFIED as applied]**
8. **The new Polish DSA act (effective 6 November 2026)** — what concrete duties it adds for a small
   hosting provider beyond the Regulation, and whether any registration or contact-point notification
   to the Prezes UKE is required. Verify before launch; it is three weeks away as of this brief.
   **[VERIFIED that the act exists; UNVERIFIED as to its duties]**
9. **May a user mark a contest as kuratoryjny/olimpiada at all?** If yes, what proof. The harm of a
   false claim is to pupils who believe they are earning an art. 44zx/44zzh exemption. Recommendation:
   staff-only flag, with the external reference mandatory.
10. **Point values and the Prawo oświatowe art. 132 mechanism** — relayed second-hand, not read from
    the recruitment rozporządzenie. Verify before displaying any points. **[UNVERIFIED]**
11. **Verbatim KC arts. 12–21 and the DSA article numbers** used above — read from memory, not opened.
    Low risk, but they will appear in user-facing copy. **[UNVERIFIED]**
12. **Accessibility when a public-entity organiser uses EdMat** — the 2019 act's duties travel with the
    kurator or public school, and may reach the platform through their procurement contract. Clarify
    before courting kuratoria. **[VERIFIED as to the mechanism; UNVERIFIED as to EdMat's exposure]**

---

All sources are cited inline, section by section; there is no separate appendix
(every URL above is the one I actually opened or, where marked, the secondary source I relied on).
