// Chapter: running a contest, entering one, judging it, and what a prize brings with it.
//
// Written 2026-10-09 by step B of the contests cycle (`prompts/19-contests-b-personalise.md`)
// **against step A's pages as `CONTESTS-BRIEF.md` §3.A describes them**, not against a running
// app — the two steps were built at the same time, so the screens this chapter describes did not
// exist on the branch it was written on. That is why it carries NO screenshots and says so in its
// note: a manual whose pictures are drawings would be the one thing this manual has never been
// (`content/guide/types.ts`: "every picture in this manual is a screenshot of the running site").
// The integrator re-shoots them with `frontend/e2e/guide-screenshots.mjs` after the merge and
// drops the sentence.
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
			body: [
				'"Contests" in the bar is the list. Each card names the organiser first, then what kind of contest it is, what state it is in and what happens next — "registration opens in 3 days", "judging", "results published".',
				'The tabs narrow it to the ones you have something to do with: "mine" is the ones you run or help run, "I am judging" is the ones you are on the jury of, and "I am taking part" is the ones you entered. A contest you can see at all is one its organiser has announced; while it is still being written it is visible only to the people organising it.'
			]
		},
		{
			heading: 'Entering one',
			body: [
				'The contest page has the entry button, and it is live only while registration is open — before and after, it says which, with the date.',
				'If you are under sixteen, you can only enter a contest whose rules allow it, and the form asks for a guardian’s name and their consent. That is not this site being careful: it is the law, and an entry without that consent recorded is one the organiser cannot act on.',
				'There is one more tick, and it is worth reading before you accept it: whether your full name may be published if you win. The results list shows initials by default. Saying yes is a separate consent and you can take it back later — the list changes without the result changing.'
			]
		},
		{
			heading: 'Answering the problems',
			body: [
				'A contest has one or more stages, and each stage has a page with its problems on it. The problems are hidden until the stage opens — the statements themselves are ordinary exercises from the database, but which ones a stage uses is not public before it starts.',
				'You write your answer under each problem, in the same way you would write anywhere else here: plain text with mathematics between \\( and \\). You can attach a file if the problem wants one, and what you write is saved as you go, so a closed tab does not cost you an afternoon.',
				'"Submit" is the end of it for that stage. There is a countdown to the closing time on the page, and after it the stage takes nothing more.'
			]
		},
		{
			heading: 'Results, and what a title means',
			body: [
				'Once the organiser publishes, the results page shows the ranking: a place, a name or initials, the points, and a title where one was earned — laureate, finalist, distinction, or simply participant.',
				'The points are the jury’s scores added up. Where more than one person scored a problem, the score is the mean of what they gave it, and it is computed fresh every time rather than stored, so a correction by one juror shows up straight away.',
				'A title comes from the organiser’s own thresholds, published with the rules. It is theirs, not this site’s: the ones that carry a consequence outside EdMat — a laureate of a kurator’s contest being excused part of an exam — belong to the kurator’s contest and not to anything here. A laureate or finalist can print a certificate from the results page, and it names the organiser as the one who issued it.'
			]
		},
		{
			heading: 'If you think the result is wrong',
			body: [
				'There is a complaints window after the results go out — at least fourteen days, and the page says when it closes. Inside it, anybody who took part can write to the organiser through the contest, and the organiser owes an answer with reasons, not a yes or a no.',
				'An account under sixteen cannot lodge one directly, because it is free text going to somebody they do not know; a guardian writes to the organiser, who records it. Going to court is not affected by any of this and the rules have to say so.'
			]
		},
		{
			heading: 'Founding one: pick the kind first',
			body: [
				'"New contest" in the Add… menu starts a wizard of four screens, and nothing is saved until the last one, so you can go back.',
				'The first screen is ten kinds of contest, and choosing is the only decision that changes everything after it. A teacher’s contest inside one school, a university one, an open internet one with a prize, a kurator’s subject contest — these are genuinely different in law, and the kind you pick decides which fields are required, which tax paragraph the rules get and what the checklist asks of you.',
				'The first one in the list promises no prize, and it is the one to start with. A contest with a jury, stages and a published ranking, and nothing promised, stays outside the public-promise rules, the gambling act and income tax completely. Two of the ten — the kurator’s contest and the subject olympiad — can only be founded by a platform operator, because a false claim that a contest is one of those harms pupils who believe they are earning an exam exemption.'
			]
		},
		{
			heading: 'The form, already filled in',
			body: [
				'The second screen is the contest itself: title, description, who it is for, the dates, and the ladder of stages the kind you chose normally has. All of it is editable except the olympiad’s three stages, which the regulation fixes.',
				'The prize block is off until you turn it on, and turning it on is the moment the obligations arrive. The field it asks for first is the deadline within which the prize may be claimed, and it is not optional: without it the whole promise is ineffective in law, and this site will not let you announce the contest. The refusal says which field is missing rather than just refusing.',
				'There is no field for money anywhere — no entry fee, no prize pool, no payment. A prize’s value is recorded so the tax paragraph can be written, and nothing more; EdMat never handles a prize.'
			]
		},
		{
			heading: 'The people, suggested rather than searched',
			body: [
				'The third screen fills the roles — jury, secretary, proctor — and it does it by offering the people you already work with: anybody who staffs a course you teach, staffs an event you host, is in one of your organisations, or writes a material with you. Beside each suggestion is the reason it appeared, so you are not guessing which Michał this is.',
				'There is no name search on this site, so if the person you want has never shared a roster with you, you need their account number; the box for it is right there. A jury of at least one is required to announce; three is the recommendation, and a contest with one juror is the fact pattern that produces complaints.'
			]
		},
		{
			heading: 'What the fourth screen shows you, and what founding writes',
			body: [
				'The last screen is the legal checklist for the kind you picked, with the article each item comes from and how well that article was checked. Four words appear there: checked against the text, from an authoritative restatement, not checked, and disputed. Nothing EdMat says about the law is advice, and the markers are there so you can tell the firm parts from the parts that need a lawyer.',
				'Beside it is a list of what founding the contest will create for you. It is not a formality: the moment the contest exists, its page carries a plan with the whole timeline and real dates, a goal whose lines are the definition of done, one task per checklist item on the right person with a deadline, "jury member wanted" as an open call anybody can answer, and a draft poll for the jury to confirm the final ranking.',
				'All of it is yours to edit or delete. If a moderator has one of those modules switched off, it is not written, and the page after founding says which — it does not pretend to have made something it did not.'
			]
		},
		{
			heading: 'The rules, and the compliance panel',
			body: [
				'Every contest has a rules page — the *regulamin* — and it starts as twelve numbered sections with a sentence in each saying what belongs there and why. Readers see them rendered, with the version number and date, and can print them. You see an editor, one block per section.',
				'Publishing the rules makes a version, and an entry stores which version it accepted. That matters more than it sounds: amended rules may not take away what somebody already earned, and the stored version is the evidence of what they agreed to.',
				'The compliance panel on the contest page is the checklist evaluated against what you have actually filled in: the claim deadline present or not, the jury big enough or not, the prize value against the 2 000 zł exemption line, the complaints window long enough, the stage descriptions free of anything that reads like a draw. Every line carries its article and its marker. It is a prompt, not a certificate.'
			]
		},
		{
			heading: 'Judging',
			body: [
				'A stage can only be scored once it has closed, and the jury page is a grid: submissions down one side, problems across the top, points and a note in each cell. Entries are shown by number, not by name, unless you turn that off.',
				'You can mark your own scoring of one submission complete, which is what tells the organiser the stage is ready. The organiser sees the ranking before it is published; everybody else sees it after.',
				'Advancing to the next stage is by the rule the stage carries — the top N, or everybody above a threshold, or everybody. There is no "pick by lot", anywhere, as a stage rule or as a tie-break: chance deciding any part of a contest with a prize would make the whole thing a lottery needing a permit. A stage whose description promises a *losowanie* is refused outright.'
			]
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
	note: 'This chapter was written against the contest pages as they were designed rather than as they were photographed: the screenshots are taken after the two halves of this feature are merged, and until then there are none. The design, drawn on sample data with the law it rests on, is at /about/contests; the research behind it, with every source and the open questions ranked, is CONTESTS-LAW.md in the repository. Nothing on either has been read by a Polish lawyer.'
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
			body: [
				'„Konkursy” w pasku to lista. Każda karta najpierw nazywa organizatora, potem rodzaj konkursu, jego stan i to, co będzie dalej — „zapisy za 3 dni”, „ocenianie”, „wyniki ogłoszone”.',
				'Zakładki zawężają listę do tych, z którymi masz coś do czynienia: „moje” to te, które prowadzisz albo współprowadzisz, „oceniam” to te, w których jesteś w jury, a „biorę udział” to te, do których się zgłosiłeś. Konkurs, który w ogóle widzisz, to taki, który organizator już ogłosił; dopóki jest pisany, widzą go tylko organizatorzy.'
			]
		},
		{
			heading: 'Zgłoszenie',
			body: [
				'Na stronie konkursu jest przycisk zgłoszenia i działa tylko wtedy, gdy zapisy są otwarte — przed i po mówi, który z tych stanów trwa, z datą.',
				'Jeśli nie masz szesnastu lat, możesz wziąć udział tylko w konkursie, którego regulamin to dopuszcza, a formularz poprosi o imię opiekuna i jego zgodę. To nie nadmierna ostrożność serwisu: tak mówi prawo, a zgłoszenia bez zapisanej zgody organizator nie może rozpatrzyć.',
				'Jest jeszcze jedno pole do zaznaczenia i warto je przeczytać, zanim się je zaakceptuje: czy w razie zwycięstwa można opublikować Twoje pełne imię i nazwisko. Domyślnie lista wyników pokazuje inicjały. Zgoda jest osobna i można ją wycofać później — zmienia się lista, nie wynik.'
			]
		},
		{
			heading: 'Rozwiązywanie zadań',
			body: [
				'Konkurs ma jeden albo więcej etapów, a każdy etap ma stronę z zadaniami. Zadania są ukryte, dopóki etap się nie otworzy — same treści to zwykłe zadania z bazy, ale to, których używa dany etap, nie jest publiczne przed jego startem.',
				'Odpowiedź pisze się pod każdym zadaniem, tak samo jak wszędzie tutaj: zwykły tekst z matematyką między \\( i \\). Można dołączyć plik, jeśli zadanie tego wymaga, a to, co piszesz, zapisuje się na bieżąco, więc zamknięta karta nie kosztuje całego popołudnia.',
				'„Wyślij” zamyka sprawę dla tego etapu. Na stronie jest odliczanie do godziny zamknięcia, a po niej etap nie przyjmuje już niczego.'
			]
		},
		{
			heading: 'Wyniki i co znaczy tytuł',
			body: [
				'Kiedy organizator opublikuje wyniki, strona wyników pokazuje ranking: miejsce, nazwisko albo inicjały, punkty i tytuł, jeśli ktoś go zdobył — laureat, finalista, wyróżnienie albo po prostu uczestnik.',
				'Punkty to zsumowane oceny jury. Tam, gdzie zadanie oceniała więcej niż jedna osoba, liczy się średnia z tego, co dały, i jest wyliczana na świeżo, a nie przechowywana, więc poprawka jednego jurora widać od razu.',
				'Tytuł wynika z progów, które organizator ogłosił razem z regulaminem. Jest jego, nie tego serwisu: te, które mają skutki poza EdMatem — laureat konkursu kuratoryjnego zwolniony z części egzaminu — należą do konkursu kuratora, a nie do czegokolwiek tutaj. Laureat albo finalista może wydrukować zaświadczenie ze strony wyników, a widnieje na nim organizator jako ten, kto je wystawił.'
			]
		},
		{
			heading: 'Jeśli uważasz, że wynik jest zły',
			body: [
				'Po ogłoszeniu wyników jest okno reklamacji — co najmniej czternaście dni, a strona mówi, kiedy się zamyka. W tym czasie każdy, kto brał udział, może napisać do organizatora przez konkurs, a organizator jest winien odpowiedź z uzasadnieniem, a nie „tak” albo „nie”.',
				'Konto poniżej szesnastu lat nie może złożyć reklamacji samo, bo to wolny tekst do osoby, której nie zna; pisze opiekun, a organizator to zapisuje. Droga sądowa pozostaje otwarta niezależnie od wszystkiego powyżej i regulamin musi to mówić.'
			]
		},
		{
			heading: 'Zakładanie: najpierw rodzaj',
			body: [
				'„Nowy konkurs” w menu Dodaj… otwiera kreator z czterech ekranów; nic nie jest zapisywane przed ostatnim, więc można się cofać.',
				'Pierwszy ekran to dziesięć rodzajów konkursu, a wybór jest jedyną decyzją, która zmienia wszystko dalej. Konkurs nauczyciela w jednej szkole, uczelniany, otwarty internetowy z nagrodą, kuratoryjny konkurs przedmiotowy — to naprawdę różne rzeczy w prawie, a wybrany rodzaj decyduje, które pola są wymagane, jaki paragraf podatkowy dostaje regulamin i czego żąda od Ciebie lista kontrolna.',
				'Pierwszy na liście nie obiecuje nagrody i od niego warto zacząć. Konkurs z jury, etapami i publikowanym rankingiem, który niczego nie obiecuje, zostaje całkowicie poza przepisami o przyrzeczeniu publicznym, ustawą hazardową i podatkiem dochodowym. Dwa z dziesięciu — konkurs kuratoryjny i olimpiadę — może założyć tylko operator platformy, bo fałszywe twierdzenie, że konkurs jest jednym z nich, szkodzi uczniom, którzy wierzą, że zdobywają zwolnienie z egzaminu.'
			]
		},
		{
			heading: 'Formularz, już wypełniony',
			body: [
				'Drugi ekran to sam konkurs: tytuł, opis, dla kogo jest, terminy i drabina etapów, którą wybrany rodzaj zwykle ma. Wszystko da się zmienić poza trzema etapami olimpiady, które ustala rozporządzenie.',
				'Blok nagrody jest wyłączony, dopóki go nie włączysz, a włączenie jest chwilą, w której przychodzą obowiązki. Pierwsze pole, o które poprosi, to termin, w którym można ubiegać się o nagrodę, i nie jest opcjonalne: bez niego całe przyrzeczenie jest w prawie bezskuteczne, a ten serwis nie pozwoli ogłosić konkursu. Odmowa mówi, którego pola brakuje, a nie tylko odmawia.',
				'Nigdzie nie ma pola na pieniądze — ani opłaty za udział, ani puli nagród, ani płatności. Wartość nagrody jest zapisywana po to, żeby dało się napisać paragraf podatkowy, i po nic więcej; EdMat nigdy nie dotyka nagrody.'
			]
		},
		{
			heading: 'Ludzie, podpowiadani, a nie wyszukiwani',
			body: [
				'Trzeci ekran obsadza role — jury, sekretarza, opiekuna etapu — i robi to, proponując osoby, z którymi już pracujesz: każdego, kto współprowadzi kurs, który uczysz, współorganizuje wydarzenie, które prowadzisz, jest w jednej z Twoich organizacji albo pisze z Tobą materiał. Przy każdej podpowiedzi stoi powód, dla którego się pojawiła, więc nie zgadujesz, który to Michał.',
				'W tym serwisie nie ma wyszukiwania po nazwisku, więc jeśli osoba, której szukasz, nigdy nie dzieliła z Tobą żadnej listy, potrzebujesz numeru jej konta; pole na to jest obok. Żeby ogłosić konkurs, trzeba jury złożonego z co najmniej jednej osoby; zalecane są trzy, a konkurs z jednym jurorem to właśnie ta sytuacja, z której rodzą się reklamacje.'
			]
		},
		{
			heading: 'Co pokazuje czwarty ekran i co zapisuje założenie',
			body: [
				'Ostatni ekran to lista kontrolna dla wybranego rodzaju, z artykułem, z którego wynika każda pozycja, i z informacją, jak dobrze ten artykuł sprawdzono. Pojawiają się tam cztery słowa: sprawdzone w tekście, z autorytatywnego omówienia, niesprawdzone i sporne. Nic, co EdMat mówi o prawie, nie jest poradą, a oznaczenia są po to, żeby dało się odróżnić części pewne od tych, które potrzebują prawnika.',
				'Obok jest lista tego, co założenie konkursu dla Ciebie utworzy. To nie formalność: w chwili, w której konkurs zaczyna istnieć, jego strona ma plan z całym kalendarzem i prawdziwymi datami, cel, którego linie są definicją ukończenia, po jednym zadaniu na pozycję listy kontrolnej, na właściwej osobie i z terminem, „poszukiwany członek jury” jako otwarte ogłoszenie, na które każdy może odpowiedzieć, i roboczą ankietę, w której jury zatwierdzi końcowy ranking.',
				'Wszystko to można zmienić albo usunąć. Jeśli moderator wyłączył któryś z tych modułów, nie zostanie zapisany, a strona po założeniu mówi, który — nie udaje, że zrobiła coś, czego nie zrobiła.'
			]
		},
		{
			heading: 'Regulamin i panel zgodności',
			body: [
				'Każdy konkurs ma stronę regulaminu, a zaczyna się ona jako dwanaście numerowanych paragrafów ze zdaniem w każdym, mówiącym, co tam należy i dlaczego. Czytający widzą je złożone, z numerem wersji i datą, i mogą je wydrukować. Ty widzisz edytor, blok na paragraf.',
				'Opublikowanie regulaminu tworzy wersję, a zgłoszenie zapisuje, którą wersję przyjęło. To ważniejsze, niż brzmi: zmieniony regulamin nie może odbierać praw już nabytych, a zapisana wersja jest dowodem, na co ktoś się zgodził.',
				'Panel zgodności na stronie konkursu to lista kontrolna skonfrontowana z tym, co naprawdę wypełniłeś: termin ubiegania się o nagrodę jest albo go nie ma, jury jest wystarczająco duże albo nie, wartość nagrody wobec granicy 2 000 zł, okno reklamacji dość długie, opisy etapów wolne od czegokolwiek, co brzmi jak losowanie. Każda linia ma swój artykuł i swoje oznaczenie. To podpowiedź, nie zaświadczenie.'
			]
		},
		{
			heading: 'Ocenianie',
			body: [
				'Etap można oceniać tylko po jego zamknięciu, a strona jury to siatka: zgłoszenia w pionie, zadania w poziomie, punkty i notatka w każdej komórce. Prace pokazywane są po numerze, a nie po nazwisku, chyba że to wyłączysz.',
				'Można oznaczyć swoją ocenę jednego zgłoszenia jako skończoną, i to właśnie mówi organizatorowi, że etap jest gotowy. Organizator widzi ranking przed publikacją; wszyscy inni po.',
				'Awans do następnego etapu idzie według zasady, którą nosi etap — pierwszych N, albo wszyscy powyżej progu, albo wszyscy. Nigdzie nie ma „wybierz losowo”, ani jako zasady etapu, ani jako rozstrzygnięcia remisu: gdyby los decydował o jakiejkolwiek części konkursu z nagrodą, całość byłaby grą losową wymagającą zezwolenia. Etap, którego opis obiecuje losowanie, zostaje odrzucony.'
			]
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
	note: 'Ten rozdział powstał na podstawie stron konkursu w wersji zaprojektowanej, a nie sfotografowanej: zrzuty ekranu są robione po połączeniu obu połówek tej funkcji, a do tego czasu ich nie ma. Projekt, narysowany na danych przykładowych razem z prawem, na którym się opiera, jest pod adresem /about/contests; badania, z każdym źródłem i z pytaniami otwartymi ułożonymi według wagi, są w pliku CONTESTS-LAW.md w repozytorium. Żadnego z tych tekstów nie czytał polski prawnik.'
};

export function contestsChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
