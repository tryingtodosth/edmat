// Chapter: running a contest, entering one, judging it, and what a prize brings with it.
//
// Written 2026-10-09 by step B of the contests cycle (`prompts/19-contests-b-personalise.md`)
// against step A's pages as `CONTESTS-BRIEF.md` §3.A described them, before either half had been
// merged — so it first went out with no pictures and a note saying why. On 2026-10-14 (WP4 of the
// next loop) it was checked against the running pages, corrected where the design and the build
// had parted (the bar shows a rosette rather than the word, the tabs are "I run these", the button
// is "Hand it in", there is no file upload on an answer, the four verification labels are the
// interface's own words), and photographed: `frontend/e2e/guide-screenshots.mjs` makes three
// contests through the real API and shoots eleven pictures of them.
//
// The law is in here on purpose and kept to what changes what a reader does. The full reasoning,
// with sources and markers, is `/about/contests` and `CONTESTS-LAW.md`; this chapter's job is to
// stop somebody announcing a prize contest with no claim deadline, not to teach them KC art. 921.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Contests',
	lead: [
		'A contest is a competition somebody runs here: people enter, a jury scores what they send in, and a ranking is published at the end. It is the third thing you can run on EdMat, next to a course and a one-off event, and the ranking is what makes it a third thing rather than a setting on either.',
		'The person who founds it is the organiser, and that word is doing legal work: under Polish law the organiser is the one who promised the prize, decides the result, holds the entrants’ data and pays the tax. EdMat is where it happens. If something goes wrong with a prize, it is between you and the organiser, not between you and this site.'
	],
	steps: [
		{
			heading: 'Finding one',
			tryHref: '/contests',
			body: [
				'The rosette in the bar — it says "Contests" when you point at it — is the list, and "My contests" in your account menu opens it on the ones you are part of. Each card names the contest and, straight under it, its organiser; then what kind of contest it is, what state it is in, whether it promises a prize, and the next date that matters — when registration closes, or when the complaints window does.',
				'The tabs narrow it to the ones you have something to do with: "I run these" is the ones you organise or help run, "I am judging" is the ones you are on the jury of, and "I am taking part" is the ones you entered. A contest you can see at all is one its organiser has announced; while it is still being written it is visible only to the people organising it.'
			],
			screenshot: {
				src: '/guide/contests/01-hub.png',
				alt: 'The contests list, signed in as an organiser: a search box, status and kind filters, the tabs All, I run these, I am judging and I am taking part with counts, and three contest cards — each with its organiser, its kind, its state, whether it has a prize, and the next date.'
			}
		},
		{
			heading: 'Entering one',
			body: [
				'"Take part" on the contest page opens the entry form, and it is there only while registration is open — before and after, the page says which, with the date. The form says which version of the rules you are accepting; that version is stored with your entry.',
				'If you are under sixteen, you can only enter a contest whose rules allow it, and the form asks for a guardian’s name and their consent. That is not this site being careful: it is the law, and an entry without that consent recorded is one the organiser cannot act on.',
				'There is one more tick, and it is worth reading before you accept it: "Publish my full name if I place". The results list shows initials by default. Saying yes is a separate consent and you can take it back later — the list changes without the result changing.'
			],
			screenshot: {
				src: '/guide/contests/02-enter.png',
				alt: 'A contest page with registration open: the organiser named above the title, the status strip, the dates, a "No prize" box, the jury’s criteria, the one stage with "opens in 4 days", and the open entry form — school or faculty, the separate "Publish my full name if I place" tick, and "Enter the contest".'
			}
		},
		{
			heading: 'Answering the problems',
			body: [
				'A contest has one or more stages, and each stage has a page with its problems on it. The problems are hidden until the stage opens — the statements themselves are ordinary exercises from the database, but which ones a stage uses is not public before it starts.',
				'You write your answer under each problem, in the same way you would write anywhere else here: plain text with mathematics between \\( and \\), and "See it rendered" shows you how it will look. What you write is saved a moment after you stop typing — "Save the draft" does it at once — so a closed tab does not cost you an afternoon.',
				'"Hand it in" is the end of it for that stage, and it asks once more before it does. There is a countdown to the closing time at the top of the page, and after it the stage takes nothing more.'
			],
			screenshot: {
				src: '/guide/contests/03-stage.png',
				alt: 'An open stage seen by an entrant: the countdown "3 days and 23 hours left", problem 1 with its statement typeset and a half-written answer below it, and the start of problem 2.'
			}
		},
		{
			heading: 'Results, and what a title means',
			body: [
				'Once the organiser publishes, the results page shows the ranking: a place, initials (or a name, where its owner agreed), the points, and a title — laureate, finalist, distinction, or simply "took part". Your own row is marked.',
				'The points are the jury’s scores added up. Where more than one person scored a problem, the score is the mean of what they gave it — which is how 13.5 out of 15 happens — and it is computed fresh every time rather than stored, so a correction by one juror shows up straight away.',
				'A title comes from the organiser’s own thresholds, published with the rules. It is theirs, not this site’s: the ones that carry a consequence outside EdMat — a laureate of a kurator’s contest being excused part of an exam — belong to the kurator’s contest and not to anything here. A laureate or finalist finds "Certificate" beside their own row, prints it from there, and it names the organiser as the one who issued it.'
			],
			screenshot: {
				src: '/guide/contests/04-results.png',
				alt: 'A published ranking of four entrants shown by initials, with points out of 15 and the titles Laureate, Finalist, Distinction and Took part; the reader’s own row is highlighted, with a Certificate link beside it.'
			}
		},
		{
			heading: 'If you think the result is wrong',
			body: [
				'There is a complaints window after the results go out — at least fourteen days, and the results page says when it closes. Inside it, anybody who took part can write to the organiser in the box under the ranking, and the organiser owes an answer with reasons, not a yes or a no. The answer appears under your complaint, with who gave it.',
				'An account under sixteen cannot lodge one directly, because it is free text going to somebody they do not know; a guardian writes to the organiser, who records it. Going to court is not affected by any of this and the rules have to say so.'
			],
			screenshot: {
				src: '/guide/contests/05-complaints.png',
				alt: 'The complaints box under the results: the window and its closing date, a text box with "Lodge the complaint", and below it the reader’s own complaint with the organiser’s reasoned answer.'
			}
		},
		{
			heading: 'Founding one: pick the kind first',
			tryHref: '/contests/new',
			tryFor: 'members',
			body: [
				'"New contest" — in the Add… menu, or the button on the list — starts a wizard of four screens: what kind, the contest, the people, what the law asks. Nothing is saved until you press "Create the contest" on the last one, so you can go back.',
				'The first screen is ten kinds of contest, and choosing is the only decision that changes everything after it. A teacher’s contest inside one school, a university one, an open internet one with a prize, a kurator’s subject contest — these are genuinely different in law, and the kind you pick decides which fields are required, which tax paragraph the rules get and what the checklist asks of you.',
				'The first one in the list promises no prize, and it is the one to start with. A contest with a jury, stages and a published ranking, and nothing promised, stays outside the public-promise rules, the gambling act and income tax completely. Two of the ten — the kurator’s contest and the subject olympiad — can only be founded by a platform operator, because a false claim that a contest is one of those harms pupils who believe they are earning an exam exemption.'
			],
			screenshot: {
				src: '/guide/contests/06-kind.png',
				alt: 'The first screen of "New contest": the four steps across the top and the list of kinds, with "Challenge (no prize)" selected first, then the school contest, the multi-stage contest and the university contest, each with who organises it, whether it has a prize, its tax line and its minimum jury.'
			}
		},
		{
			heading: 'The contest itself',
			body: [
				'The second screen is the contest itself: title, description, who it is for, the dates, what the jury marks against, who is responsible for the entrants’ data, and the ladder of stages the kind you chose normally has. The kind fills in what it can — who it is for, whether a prize is promised, the stages — and the rest is yours. All of it is editable except the olympiad’s three stages, which the regulation fixes.',
				'The prize block is off until you turn it on, and turning it on is the moment the obligations arrive. The field it asks for first is the deadline within which the prize may be claimed, and it is not optional: without it the whole promise is ineffective in law, and this site will not let you announce the contest. The refusal says which field is missing rather than just refusing.',
				'There is no field for money anywhere — no entry fee, no prize pool, no payment. A prize’s value is recorded so the tax paragraph can be written, and nothing more; EdMat never handles a prize.'
			],
			screenshot: {
				src: '/guide/contests/07-form.png',
				alt: 'The second screen filled in: title, description, who it is for, the three dates, what the jury marks against with the note that it is required before announcing, and the prize block switched off.'
			}
		},
		{
			heading: 'The people, suggested rather than searched',
			body: [
				'The third screen fills the roles — jury, secretary, proctor — and it does it by offering the people you already work with: anybody who staffs a course you teach, staffs an event you host, is in one of your organisations, or writes a material with you. Beside each suggestion is the reason it appeared, so you are not guessing which Michał this is.',
				'There is no name search on this site, so if the person you want has never shared a roster with you, you need their account number; the box for it ("…or by account id") is right there. You count as a juror yourself; the kind sets the minimum — one for a challenge, two or three for the others — and three is the recommendation, because a contest with one juror is the fact pattern that produces complaints.'
			],
			screenshot: {
				src: '/guide/contests/08-people.png',
				alt: 'The third screen: a Jury picker and a Secretary picker, each suggesting two people with the reason under the name — "staff with you on Analiza matematyczna II — ćwiczenia" — one of them ticked and shown as chosen, and a box to add somebody by account id.'
			}
		},
		{
			heading: 'What the fourth screen shows you, and what founding writes',
			body: [
				'The last screen is the legal checklist for the kind you picked, with the article each item comes from and how well that article was checked. Four labels appear there: "text read" (checked against the statute itself), "restated" (from an authoritative restatement), "unchecked", and "disputed". Nothing EdMat says about the law is advice, and the markers are there so you can tell the firm parts from the parts that need a lawyer.',
				'Under it is a list of what founding the contest will create for you. It is not a formality: the moment the contest exists, its page carries a plan with the whole timeline and real dates, a goal whose lines are the definition of done, one task per checklist item on the right person with a deadline, "jury member wanted" as an open call anybody can answer, and a draft poll for the jury to confirm the final ranking.',
				'All of it is yours to edit or delete. If one of those modules is switched off on this site, it is not written, and the contest’s page says which afterwards — it does not pretend to have made something it did not.'
			],
			screenshot: {
				src: '/guide/contests/09-law.png',
				alt: 'The end of the legal checklist, each obligation with its articles and their labels — restated, unchecked, disputed, text read — and under it "What will be set up for you": the regulamin’s paragraphs, the stages, a plan, a goal with five criteria, ten tasks, a help-wanted posting and a poll for the jury.'
			}
		},
		{
			heading: 'The rules, and the compliance panel',
			body: [
				'Every contest has a rules page — the *regulamin* — and it starts as numbered sections, eleven or twelve depending on the kind, with a sentence in each saying what belongs there and why. Readers see them rendered, with the version number and date, and can print them. You also see "Edit the rules", which opens an editor with one block per section.',
				'Publishing the rules makes a version, and an entry stores which version it accepted. That matters more than it sounds: amended rules may not take away what somebody already earned, and the stored version is the evidence of what they agreed to.',
				'The compliance panel — "What the law asks of the organiser", on the contest page and on "Run this contest", for the people running it only — is the checklist evaluated against what you have actually filled in: the claim deadline present or not, the jury big enough or not, the prize value against the 2 000 zł exemption line, the complaints window long enough, the stage descriptions free of anything that reads like a draw. Every line is marked done, missing, or "check this" — the ones only a person can check, like actually handing the prize over — and carries its article and its label. It is a prompt, not a certificate.'
			],
			screenshot: {
				src: '/guide/contests/10-compliance.png',
				alt: 'The compliance panel on a finished contest with a prize: "Nothing here is legal advice", 14 done, 0 missing, 2 that only a person can check, the tax block for a 600 zł prize within the 2 000 zł exemption, and the first obligations marked DONE with their citations.'
			}
		},
		{
			heading: 'Judging',
			body: [
				'A stage can only be scored once it has closed. "Score the entries" on the contest page opens the jury’s sheet: one card per entry, a row per problem with the answer, your mark and a note, and the other jurors’ marks beside yours. Entries are shown by number, never by name.',
				'"Save my marks" under each entry saves your row for it, and the line at the top of the card says what it adds up to so far and whether your marks for it are complete — which is what tells the organiser the stage is ready. The organiser sees the ranking before it is published; everybody else sees it after.',
				'Advancing to the next stage is by the rule the stage carries — the top N, or everybody above a threshold, or everybody. There is no "pick by lot", anywhere, as a stage rule or as a tie-break: chance deciding any part of a contest with a prize would make the whole thing a lottery needing a permit. A stage whose description promises a *losowanie* is refused outright.'
			],
			screenshot: {
				src: '/guide/contests/11-judge.png',
				alt: 'The jury’s sheet for a closed stage: "Entrant #1", 13.5 of 15 so far and the juror’s marks complete, three problems with the answer, the juror’s mark and note, and the other juror’s mark beside it; "Save my marks" underneath.'
			}
		},
		{
			heading: 'What this chapter does not cover',
			body: [
				'The money side, because there is none: no payments, no fees, no prize pool, and EdMat never verifies that a prize exists or promises it will be given.',
				'Community voting deciding a prize is not built, and that is a decision rather than a gap — whether a reader vote is a merit criterion or a disguised draw is the first question on the list for a lawyer.',
				'Teams are a name on an entry and not yet a roster with a captain, and proctoring is a role somebody holds rather than anything this site watches through a camera — which is deliberate and not going to change.'
			]
		}
	],
	note: 'The pictures are of three contests the manual’s screenshot script makes on the development database, run by the demo accounts — nobody real entered them. The design, drawn on sample data with the law it rests on, is at /about/contests; the research behind it, with every source and the open questions ranked, is CONTESTS-LAW.md in the repository. Nothing on either has been read by a Polish lawyer.'
};

const PL: GuideChapterDoc = {
	title: 'Konkursy',
	lead: [
		'Konkurs to zawody, które ktoś tu prowadzi: ludzie się zgłaszają, jury ocenia to, co przysłali, a na końcu publikowany jest ranking. To trzecia rzecz, którą można prowadzić w EdMacie, obok kursu i jednorazowego wydarzenia, i właśnie ranking sprawia, że jest trzecią rzeczą, a nie ustawieniem jednej z tych dwóch.',
		'Osoba, która go zakłada, jest organizatorem, a to słowo robi tu pracę prawną: w polskim prawie organizator to ten, kto przyrzekł nagrodę, rozstrzyga wynik, administruje danymi uczestników i płaci podatek. EdMat jest miejscem, w którym się to dzieje. Jeśli coś pójdzie nie tak z nagrodą, sprawa jest między Tobą a organizatorem, nie między Tobą a tym serwisem.'
	],
	steps: [
		{
			heading: 'Jak znaleźć konkurs',
			tryHref: '/contests',
			body: [
				'Rozeta w pasku — po najechaniu pokazuje napis „Konkursy” — to lista, a „Moje konkursy” w menu konta otwiera ją na tych, które Cię dotyczą. Każda karta podaje nazwę konkursu i tuż pod nią organizatora, potem rodzaj konkursu, jego stan, to, czy obiecuje nagrodę, i najbliższą ważną datę — kiedy kończą się zapisy albo kiedy zamyka się okno reklamacji.',
				'Zakładki zawężają listę do tych, z którymi masz coś do czynienia: „Prowadzę” to te, które organizujesz albo współprowadzisz, „Oceniam” to te, w których jesteś w jury, a „Biorę udział” to te, w których startujesz. Konkurs, który w ogóle widzisz, to taki, który organizator już ogłosił; dopóki jest pisany, widzą go tylko organizatorzy.'
			],
			screenshot: {
				src: '/guide/contests/01-hub.png',
				alt: 'Lista konkursów oczami organizatora: wyszukiwarka, filtry stanu i rodzaju, zakładki Wszystkie, Prowadzę, Oceniam i Biorę udział z liczbami oraz trzy karty konkursów — każda z organizatorem, rodzajem, stanem, informacją o nagrodzie i najbliższą datą.'
			}
		},
		{
			heading: 'Zgłoszenie',
			body: [
				'„Weź udział” na stronie konkursu otwiera formularz zgłoszenia i jest tam tylko wtedy, gdy zapisy są otwarte — przed i po strona mówi, który z tych stanów trwa, z datą. Formularz podaje, którą wersję regulaminu akceptujesz; ta wersja zostaje zapisana przy zgłoszeniu.',
				'Jeśli nie masz szesnastu lat, możesz wziąć udział tylko w konkursie, którego regulamin to dopuszcza, a formularz poprosi o imię opiekuna i jego zgodę. To nie nadmierna ostrożność serwisu: tak mówi prawo, a zgłoszenia bez zapisanej zgody organizator nie może rozpatrzyć.',
				'Jest jeszcze jedno pole do zaznaczenia i warto je przeczytać, zanim się je zaakceptuje: „Opublikujcie moje imię i nazwisko, jeśli znajdę się w wynikach”. Domyślnie lista wyników pokazuje inicjały. Zgoda jest osobna i można ją wycofać później — zmienia się lista, nie wynik.'
			],
			screenshot: {
				src: '/guide/contests/02-enter.png',
				alt: 'Strona konkursu z otwartymi zapisami: organizator nad tytułem, pasek stanów, terminy, ramka „Bez nagrody”, kryteria jury, jedyny etap z dopiskiem „otwiera się za 4 dni” i otwarty formularz zgłoszenia — szkoła albo wydział, osobne pole na zgodę na publikację imienia i nazwiska i przycisk zgłoszenia.'
			}
		},
		{
			heading: 'Rozwiązywanie zadań',
			body: [
				'Konkurs ma jeden albo więcej etapów, a każdy etap ma stronę z zadaniami. Zadania są ukryte, dopóki etap się nie otworzy — same treści to zwykłe zadania z bazy, ale to, których używa dany etap, nie jest publiczne przed jego startem.',
				'Odpowiedź pisze się pod każdym zadaniem, tak samo jak wszędzie tutaj: zwykły tekst z matematyką między \\( i \\), a „Zobacz złożony tekst” pokazuje ją złożoną. To, co piszesz, zapisuje się chwilę po tym, jak przestaniesz pisać — „Zapisz wersję roboczą” robi to od razu — więc zamknięta karta nie kosztuje całego popołudnia.',
				'„Oddaj pracę” zamyka sprawę dla tego etapu i przedtem pyta jeszcze raz. Na górze strony jest odliczanie do godziny zamknięcia, a po niej etap nie przyjmuje już niczego.'
			],
			screenshot: {
				src: '/guide/contests/03-stage.png',
				alt: 'Otwarty etap oczami uczestniczki: odliczanie do zamknięcia, zadanie 1 ze złożoną treścią i zaczętą odpowiedzią pod spodem oraz początek zadania 2.'
			}
		},
		{
			heading: 'Wyniki i co znaczy tytuł',
			body: [
				'Kiedy organizator opublikuje wyniki, strona wyników pokazuje ranking: miejsce, inicjały (albo imię i nazwisko, jeśli ich właściciel się zgodził), punkty i tytuł — laureat, finalista, wyróżnienie albo po prostu „Uczestnik”. Twój wiersz jest zaznaczony.',
				'Punkty to zsumowane oceny jury. Tam, gdzie zadanie oceniała więcej niż jedna osoba, liczy się średnia z tego, co dały — stąd 13,5 na 15 — i jest wyliczana na świeżo, a nie przechowywana, więc poprawkę jednego jurora widać od razu.',
				'Tytuł wynika z progów, które organizator ogłosił razem z regulaminem. Jest jego, nie tego serwisu: te, które mają skutki poza EdMatem — laureat konkursu kuratoryjnego zwolniony z części egzaminu — należą do konkursu kuratora, a nie do czegokolwiek tutaj. Laureat albo finalista znajdzie „Zaświadczenie” obok swojego wiersza i stamtąd je wydrukuje, a widnieje na nim organizator jako ten, kto je wystawił.'
			],
			screenshot: {
				src: '/guide/contests/04-results.png',
				alt: 'Opublikowany ranking czterech osób pokazanych inicjałami, z punktami na 15 i tytułami laureata, finalisty, wyróżnienia i uczestnika; wiersz czytającej osoby jest wyróżniony, a obok niego jest link do zaświadczenia.'
			}
		},
		{
			heading: 'Jeśli uważasz, że wynik jest zły',
			body: [
				'Po ogłoszeniu wyników jest okno reklamacji — co najmniej czternaście dni, a strona wyników mówi, kiedy się zamyka. W tym czasie każdy, kto brał udział, może napisać do organizatora w polu pod rankingiem, a organizator jest winien odpowiedź z uzasadnieniem, a nie „tak” albo „nie”. Odpowiedź pojawia się pod reklamacją, z nazwiskiem osoby, która jej udzieliła.',
				'Konto poniżej szesnastu lat nie może złożyć reklamacji samo, bo to wolny tekst do osoby, której nie zna; pisze opiekun, a organizator to zapisuje. Droga sądowa pozostaje otwarta niezależnie od wszystkiego powyżej i regulamin musi to mówić.'
			],
			screenshot: {
				src: '/guide/contests/05-complaints.png',
				alt: 'Pole reklamacji pod wynikami: okno i data jego zamknięcia, pole tekstowe z przyciskiem wysłania, a pod spodem reklamacja czytającej osoby z uzasadnioną odpowiedzią organizatorki.'
			}
		},
		{
			heading: 'Zakładanie: najpierw rodzaj',
			tryHref: '/contests/new',
			tryFor: 'members',
			body: [
				'„Nowy konkurs” — w menu Dodaj… albo przyciskiem na liście — otwiera kreator z czterech ekranów: rodzaj, konkurs, ludzie, czego wymaga prawo. Nic nie jest zapisywane, dopóki na ostatnim nie naciśniesz „Utwórz konkurs”, więc można się cofać.',
				'Pierwszy ekran to dziesięć rodzajów konkursu, a wybór jest jedyną decyzją, która zmienia wszystko dalej. Konkurs nauczyciela w jednej szkole, uczelniany, otwarty internetowy z nagrodą, kuratoryjny konkurs przedmiotowy — to naprawdę różne rzeczy w prawie, a wybrany rodzaj decyduje, które pola są wymagane, jaki paragraf podatkowy dostaje regulamin i czego żąda od Ciebie lista kontrolna.',
				'Pierwszy na liście nie obiecuje nagrody i od niego warto zacząć. Konkurs z jury, etapami i publikowanym rankingiem, który niczego nie obiecuje, zostaje całkowicie poza przepisami o przyrzeczeniu publicznym, ustawą hazardową i podatkiem dochodowym. Dwa z dziesięciu — konkurs kuratoryjny i olimpiadę — może założyć tylko operator platformy, bo fałszywe twierdzenie, że konkurs jest jednym z nich, szkodzi uczniom, którzy wierzą, że zdobywają zwolnienie z egzaminu.'
			],
			screenshot: {
				src: '/guide/contests/06-kind.png',
				alt: 'Pierwszy ekran „Nowego konkursu”: cztery kroki u góry i lista rodzajów z zaznaczonym pierwszym, wyzwaniem bez nagrody, a pod nim konkurs szkolny, wieloetapowy i uczelniany — każdy z tym, kto go organizuje, czy ma nagrodę, jaki ma wiersz podatkowy i jakie najmniejsze jury.'
			}
		},
		{
			heading: 'Sam konkurs',
			body: [
				'Drugi ekran to sam konkurs: tytuł, opis, dla kogo jest, terminy, według czego ocenia jury, kto odpowiada za dane uczestników i drabina etapów, którą wybrany rodzaj zwykle ma. Rodzaj wypełnia, co może — dla kogo jest konkurs, czy obiecuje nagrodę, etapy — a reszta należy do Ciebie. Wszystko da się zmienić poza trzema etapami olimpiady, które ustala rozporządzenie.',
				'Blok nagrody jest wyłączony, dopóki go nie włączysz, a włączenie jest chwilą, w której przychodzą obowiązki. Pierwsze pole, o które poprosi, to termin, w którym można ubiegać się o nagrodę, i nie jest opcjonalne: bez niego całe przyrzeczenie jest w prawie bezskuteczne, a ten serwis nie pozwoli ogłosić konkursu. Odmowa mówi, którego pola brakuje, a nie tylko odmawia.',
				'Nigdzie nie ma pola na pieniądze — ani opłaty za udział, ani puli nagród, ani płatności. Wartość nagrody jest zapisywana po to, żeby dało się napisać paragraf podatkowy, i po nic więcej; EdMat nigdy nie dotyka nagrody.'
			],
			screenshot: {
				src: '/guide/contests/07-form.png',
				alt: 'Drugi ekran po wypełnieniu: tytuł, opis, dla kogo jest, trzy daty, kryteria jury z dopiskiem, że są wymagane przed ogłoszeniem, i wyłączony blok nagrody.'
			}
		},
		{
			heading: 'Ludzie, podpowiadani, a nie wyszukiwani',
			body: [
				'Trzeci ekran obsadza role — jury, sekretarza, opiekuna etapu — i robi to, proponując osoby, z którymi już pracujesz: każdego, kto współprowadzi kurs, który uczysz, współorganizuje wydarzenie, które prowadzisz, jest w jednej z Twoich organizacji albo pisze z Tobą materiał. Przy każdej podpowiedzi stoi powód, dla którego się pojawiła, więc nie zgadujesz, który to Michał.',
				'W tym serwisie nie ma wyszukiwania po nazwisku, więc jeśli osoba, której szukasz, nigdy nie dzieliła z Tobą żadnej listy, potrzebujesz numeru jej konta; pole na to („…albo po numerze konta”) jest obok. Ty też liczysz się jako juror; minimum wyznacza rodzaj — jedna osoba przy wyzwaniu, dwie albo trzy przy pozostałych — a zalecane są trzy, bo konkurs z jednym jurorem to właśnie ta sytuacja, z której rodzą się reklamacje.'
			],
			screenshot: {
				src: '/guide/contests/08-people.png',
				alt: 'Trzeci ekran: wybór jury i sekretarza, w każdym dwie podpowiedziane osoby z powodem pod nazwiskiem — wspólna kadra kursu — jedna zaznaczona i pokazana jako wybrana, oraz pole na numer konta.'
			}
		},
		{
			heading: 'Co pokazuje czwarty ekran i co zapisuje założenie',
			body: [
				'Ostatni ekran to lista kontrolna dla wybranego rodzaju, z artykułem, z którego wynika każda pozycja, i z informacją, jak dobrze ten artykuł sprawdzono. Pojawiają się tam cztery etykiety: „tekst sprawdzony” (sprawdzone w samym przepisie), „źródło wtórne” (z autorytatywnego omówienia), „niesprawdzone” i „sporne”. Nic, co EdMat mówi o prawie, nie jest poradą, a oznaczenia są po to, żeby dało się odróżnić części pewne od tych, które potrzebują prawnika.',
				'Pod nią jest lista tego, co założenie konkursu dla Ciebie utworzy. To nie formalność: w chwili, w której konkurs zaczyna istnieć, jego strona ma plan z całym kalendarzem i prawdziwymi datami, cel, którego linie są definicją ukończenia, po jednym zadaniu na pozycję listy kontrolnej, na właściwej osobie i z terminem, „poszukiwany członek jury” jako otwarte ogłoszenie, na które każdy może odpowiedzieć, i roboczą ankietę, w której jury zatwierdzi końcowy ranking.',
				'Wszystko to można zmienić albo usunąć. Jeśli któryś z tych modułów jest w serwisie wyłączony, nie zostanie zapisany, a strona konkursu powie potem, który — nie udaje, że zrobiła coś, czego nie zrobiła.'
			],
			screenshot: {
				src: '/guide/contests/09-law.png',
				alt: 'Koniec listy kontrolnej, każdy obowiązek z artykułami i ich etykietami, a pod nią lista tego, co zostanie utworzone: paragrafy regulaminu, etapy, plan, cel z pięcioma kryteriami, dziesięć zadań, ogłoszenie o pomoc i ankieta dla jury.'
			}
		},
		{
			heading: 'Regulamin i panel zgodności',
			body: [
				'Każdy konkurs ma stronę regulaminu, a zaczyna się ona jako numerowane paragrafy — jedenaście albo dwanaście, zależnie od rodzaju — ze zdaniem w każdym, mówiącym, co tam należy i dlaczego. Czytający widzą je złożone, z numerem wersji i datą, i mogą je wydrukować. Ty widzisz też „Edytuj regulamin”, który otwiera edytor z blokiem na każdy paragraf.',
				'Opublikowanie regulaminu tworzy wersję, a zgłoszenie zapisuje, którą wersję przyjęło. To ważniejsze, niż brzmi: zmieniony regulamin nie może odbierać praw już nabytych, a zapisana wersja jest dowodem, na co ktoś się zgodził.',
				'Panel zgodności — „Czego prawo wymaga od organizatora”, na stronie konkursu i w „Prowadź ten konkurs”, widoczny tylko dla prowadzących — to lista kontrolna skonfrontowana z tym, co naprawdę zostało wypełnione: termin ubiegania się o nagrodę jest albo go nie ma, jury jest wystarczająco duże albo nie, wartość nagrody wobec granicy 2 000 zł, okno reklamacji dość długie, opisy etapów wolne od czegokolwiek, co brzmi jak losowanie. Każda linia jest oznaczona jako zrobiona, brakująca albo „do sprawdzenia” — te, które może sprawdzić tylko człowiek, jak samo wręczenie nagrody — i ma swój artykuł i swoją etykietę. To podpowiedź, nie zaświadczenie.'
			],
			screenshot: {
				src: '/guide/contests/10-compliance.png',
				alt: 'Panel zgodności zakończonego konkursu z nagrodą: zastrzeżenie, że to nie porada prawna, 14 zrobionych, 0 brakujących i 2 do sprawdzenia przez człowieka, blok podatkowy dla nagrody 600 zł mieszczącej się w zwolnieniu do 2 000 zł i pierwsze obowiązki oznaczone jako zrobione, z przepisami.'
			}
		},
		{
			heading: 'Ocenianie',
			body: [
				'Etap można oceniać tylko po jego zamknięciu. „Oceń prace” na stronie konkursu otwiera arkusz jury: karta na każde zgłoszenie, w niej wiersz na każde zadanie z odpowiedzią, Twoją oceną i notatką, a obok oceny pozostałych jurorów. Prace pokazywane są po numerze, nigdy po nazwisku.',
				'„Zapisz moje oceny” pod każdym zgłoszeniem zapisuje Twój wiersz, a linia na górze karty mówi, ile to na razie daje i czy Twoje oceny tej pracy są kompletne — i to właśnie mówi organizatorowi, że etap jest gotowy. Organizator widzi ranking przed publikacją; wszyscy inni po.',
				'Awans do następnego etapu idzie według zasady, którą nosi etap — pierwszych N, albo wszyscy powyżej progu, albo wszyscy. Nigdzie nie ma „wybierz losowo”, ani jako zasady etapu, ani jako rozstrzygnięcia remisu: gdyby los decydował o jakiejkolwiek części konkursu z nagrodą, całość byłaby grą losową wymagającą zezwolenia. Etap, którego opis obiecuje losowanie, zostaje odrzucony.'
			],
			screenshot: {
				src: '/guide/contests/11-judge.png',
				alt: 'Arkusz jury dla zamkniętego etapu: zgłoszenie nr 1, na razie 13,5 na 15 i komplet ocen jurora, trzy zadania z odpowiedzią, oceną i notatką jurora oraz oceną drugiej jurorki obok; pod spodem „Zapisz moje oceny”.'
			}
		},
		{
			heading: 'Czego ten rozdział nie opisuje',
			body: [
				'Strony pieniężnej, bo jej nie ma: żadnych płatności, opłat ani puli nagród, a EdMat nigdy nie sprawdza, czy nagroda istnieje, i nie obiecuje, że zostanie wydana.',
				'Głosowania społeczności rozstrzygającego o nagrodzie nie ma, i to decyzja, a nie luka — czy głos czytelników jest kryterium merytorycznym, czy przebranym losowaniem, to pierwsze pytanie na liście do prawnika.',
				'Zespoły to na razie nazwa przy zgłoszeniu, a nie lista z kapitanem, a opieka nad etapem to rola, którą ktoś pełni, a nie coś, co ten serwis obserwuje kamerą — co jest zamierzone i nie zmieni się.'
			]
		}
	],
	note: 'Obrazki przedstawiają trzy konkursy, które skrypt robiący zrzuty do podręcznika tworzy w bazie deweloperskiej, prowadzone przez konta demonstracyjne — nikt prawdziwy się do nich nie zgłosił. Projekt, narysowany na danych przykładowych razem z prawem, na którym się opiera, jest pod adresem /about/contests; badania, z każdym źródłem i z pytaniami otwartymi ułożonymi według wagi, są w pliku CONTESTS-LAW.md w repozytorium. Żadnego z tych tekstów nie czytał polski prawnik.'
};

export function contestsChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
