/**
 * `/about/flashcards` — decks, the two faces of a card, the four grades, and placement.
 *
 * The one genuinely interactive sample in the whole showcase lives on this page: a card you can
 * turn over and grade. It writes nothing anywhere — there is no deck behind it and no request —
 * which is the line `prompts/08-about-showcase.md` draws: a flip is fine, a grade that stores
 * nothing is fine, anything that calls the API is not.
 *
 * The intervals below are SM-2's arithmetic worked on ONE example card (one already seen a few
 * times, on a 10-day interval), not a promise about any particular card. Said so in `gradesNote`
 * rather than left to be mistaken for a table of fixed values.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseDeck, ShowcaseDoc } from './index';

export type ShowcaseGradeKey = 'again' | 'hard' | 'good' | 'easy';

export interface FlashcardsShowcase extends ShowcaseDoc {
	decksHeading: string;
	decks: ShowcaseDeck[];
	decksCaption: string;
	/** The link under the sample decks, to the reader's own real ones at `/flashcards`. */
	decksLinkLabel: string;
	cardHeading: string;
	card: { frontLabel: string; backLabel: string; front: string; back: string; hint: string };
	cardCaption: string;
	gradesHeading: string;
	/** `days` is what the example card's next interval would be; 0 means "again today". */
	grades: { key: ShowcaseGradeKey; meaning: string; days: number }[];
	gradesNote: string;
	queueHeading: string;
	queue: { due: number; fresh: number; learned: number; total: number };
	queueLabels: { due: string; fresh: string; learned: string; total: string };
	queueCaption: string;
	placementHeading: string;
	placementBody: string[];
	placedDeck: ShowcaseDeck;
	placementCaption: string;
}

const EN: FlashcardsShowcase = {
	title: 'Flashcards and spaced review',
	description:
		'How a deck of flashcards is made from exercises or concepts in EdMat, what the four grades do to the schedule, and how a deck placed on a course becomes something a whole class can study.',
	lead: [
		'A flashcard is the shortest possible use of something already in the database: the front is an exercise’s statement or a concept’s title, the back is its published answer or its summary, and nothing is retyped. Cards live in decks, and a deck is made in one press from a set you built, a week of a course, a session of an event or a concept.',
		'Reviewing is scheduled rather than endless. Each card has its own next date, and the four grades you give are what move it — a card you found easy comes back in a month, one you got wrong comes back today.'
	],
	points: [
		{
			heading: 'A review log is the first measurement this site keeps about a learner',
			body: 'Everything else here is a statement somebody made: a set they built, a lesson they marked done. How well you answered is different, so it is private by construction, aggregated before it is ever shown, and shown on a profile only behind a consent of its own.'
		},
		{
			heading: 'A deck is private; a placement is the sharing',
			body: 'Nothing you make is world-readable in this cycle. What a deck can do is sit on a course or an event — and then everybody who can see that course can study it, which is what makes “make a deck from this week” worth a teacher’s press.'
		},
		{
			heading: 'Due is counted on the server’s day',
			body: 'There are no per-account time zones here yet, so “due today” means today in UTC, the server’s clock — which in Poland turns over at 1 or 2 in the morning, not at midnight. Said rather than quietly rounded.'
		}
	],
	decksHeading: 'Three decks, as a reader’s own list shows them',
	decks: [
		{
			name: 'Midterm 2 — limits and series',
			cardCount: 24,
			dueCount: 7,
			source: 'set',
			isPublic: false
		},
		{
			name: 'Week 4: continuity',
			cardCount: 12,
			dueCount: 0,
			source: 'lesson',
			placedOn: { kind: 'course', name: 'Analysis I, spring group' },
			isPublic: false
		},
		{
			name: 'Compactness',
			cardCount: 9,
			dueCount: 3,
			source: 'concept',
			isPublic: false
		}
	],
	decksLinkLabel: 'Open your own decks',
	decksCaption:
		'Each deck says how many cards it holds and how many are due today, and where it came from. The middle one is placed on a course, so the class can study it too.',
	cardHeading: 'One card, both faces',
	card: {
		frontLabel: 'Front — the exercise’s statement',
		backLabel: 'Back — its published answer',
		front: 'Compute \\( \\lim_{n\\to\\infty} \\dfrac{3n^{2}+2n}{n^{2}-1} \\).',
		back: '\\( 3 \\)',
		hint: 'Divide the numerator and the denominator by \\( n^{2} \\).'
	},
	cardCaption:
		'Turn it over and grade it. This one is a working demonstration and the only one on these pages — it stores nothing, because there is no deck behind it.',
	gradesHeading: 'What the four grades do',
	grades: [
		{
			key: 'again',
			meaning: 'You did not know it. The card comes back in this session and its interval resets.',
			days: 0
		},
		{
			key: 'hard',
			meaning:
				'You got there, slowly. The interval grows a little and the card gets marginally harder in the scheduler’s eyes.',
			days: 7
		},
		{
			key: 'good',
			meaning: 'You knew it. The interval grows by the card’s own ease factor.',
			days: 25
		},
		{
			key: 'easy',
			meaning:
				'You knew it at once. The interval grows further and the card becomes easier, so it is asked less often.',
			days: 36
		}
	],
	gradesNote:
		'The days are SM-2’s arithmetic on one example card — one already seen a few times, currently on a ten-day interval. A fresh card’s first intervals are much shorter, and every card keeps its own ease factor, so no two decks behave identically.',
	queueHeading: 'The review queue',
	queue: { due: 7, fresh: 5, learned: 12, total: 24 },
	queueLabels: {
		due: 'Due today',
		fresh: 'Never seen',
		learned: 'Scheduled further out',
		total: 'Cards in the deck'
	},
	queueCaption:
		'Due cards first, then cards you have never seen. The end screen says what you did; it does not score you.',
	placementHeading: 'A deck placed on a course',
	placementBody: [
		'A placement is a row saying “this deck belongs on that course”, and it is what makes a deck reach other people. Whoever can see the course can study the deck; whoever runs the course can place one and take it away again. The deck itself does not change hands — it stays its maker’s, and removing the placement removes the sharing rather than the deck.',
		'A deck can sit on a course or on an event, and nothing else. A profile, a material and a concept are not places a group of people study together, so they are not offered.'
	],
	placedDeck: {
		name: 'Week 4: continuity',
		cardCount: 12,
		dueCount: 4,
		source: 'lesson',
		placedOn: { kind: 'course', name: 'Analysis I, spring group' },
		isPublic: false
	},
	placementCaption:
		'The same deck as a participant of that course sees it: theirs to study, with their own schedule, not the teacher’s.',
	closing:
		'A public deck library, decks you can copy from strangers, and a reminder when cards fall due are all deliberately not in this first version. What exists is enough to revise from and enough for a teacher to hand a week of cards to a class.',
	tryIt: [
		{ label: 'Open your decks', route: '/flashcards' },
		{ label: 'Build a set to make a deck from', route: '/my-set' }
	],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/flashcards/02-decks.png',
			focus: [268, 1012],
			width: 1280,
			height: 580,
			route: '/flashcards',
			alt: 'Screenshot of My decks: “5 cards waiting across 2 decks”, a box to name a new deck, and two decks — “Definitions I keep forgetting”, built by hand, and “Limits and sequences”, made from an exercise set — each with Open and Review buttons and a count to review.',
			caption:
				'Your decks: how many cards are waiting across all of them, and a Review button on each.'
		},
		{
			src: '/guide/flashcards/06-grades.png',
			focus: [308, 972],
			width: 1280,
			height: 700,
			route: '/flashcards',
			alt: 'Screenshot of a review session in the deck “Limits and sequences”, card 1 of 3: an exercise statement asking for partial derivatives, the answer revealed under it, and four buttons — Again, Hard, Good, Easy — numbered 1 to 4.',
			caption:
				'A review: the card turned over and the four grades — the same four the sample card below lets you try.',
			linkLabel: 'Open a deck and review it'
		}
	]
};

const PL: FlashcardsShowcase = {
	title: 'Fiszki i powtórki w odstępach',
	description:
		'Jak w EdMacie powstają fiszki z zadań albo pojęć, co cztery oceny robią z harmonogramem i jak fiszki położone na kursie stają się czymś, z czego uczy się cała klasa.',
	lead: [
		'Fiszka to najkrótsze możliwe użycie czegoś, co już jest w bazie: z przodu treść zadania albo tytuł pojęcia, z tyłu opublikowana odpowiedź albo streszczenie — i nic nie jest przepisywane. Fiszki powstają jednym naciśnięciem z ułożonego zestawu, z tygodnia kursu, z sesji wydarzenia albo z pojęcia.',
		'Powtarzanie jest zaplanowane, nie bez końca. Każda fiszka ma własną następną datę, a przesuwają ją cztery oceny, które jej dajesz — fiszka, która była łatwa, wróci za miesiąc; ta, którą pomyliłeś, wróci dziś.'
	],
	points: [
		{
			heading: 'Dziennik powtórek to pierwszy pomiar, jaki ten serwis trzyma o uczącym się',
			body: 'Wszystko inne tutaj jest oświadczeniem: zestaw, który ktoś ułożył, lekcja, którą oznaczył jako zrobioną. To, jak dobrze odpowiadałeś, jest czymś innym — więc jest prywatne z konstrukcji, agregowane przed jakimkolwiek pokazaniem i widoczne w profilu wyłącznie za osobną zgodą.'
		},
		{
			heading: 'Twoje fiszki są prywatne; udostępnieniem jest położenie ich na czymś',
			body: 'Nic, co zrobisz, nie jest w tym etapie czytelne dla świata. Fiszki mogą natomiast leżeć na kursie albo na wydarzeniu — i wtedy każdy, kto widzi ten kurs, może się z nich uczyć. To właśnie czyni „zrób fiszki z tego tygodnia” wartym naciśnięcia przez prowadzącego.'
		},
		{
			heading: '„Do powtórki dziś” liczy się według dnia serwera',
			body: 'Nie ma tu jeszcze stref czasowych per konto, więc „dziś” to dzień według zegara serwera, czyli UTC — w Polsce zmienia się o 1 albo 2 w nocy, a nie o północy. Powiedziane, a nie cicho zaokrąglone.'
		}
	],
	decksHeading: 'Fiszki z trzech źródeł, tak jak pokazuje je własna lista',
	decks: [
		{
			name: 'Kolokwium 2 — granice i szeregi',
			cardCount: 24,
			dueCount: 7,
			source: 'set',
			isPublic: false
		},
		{
			name: 'Tydzień 4: ciągłość',
			cardCount: 12,
			dueCount: 0,
			source: 'lesson',
			placedOn: { kind: 'course', name: 'Analiza I, grupa wiosenna' },
			isPublic: false
		},
		{ name: 'Zwartość', cardCount: 9, dueCount: 3, source: 'concept', isPublic: false }
	],
	decksLinkLabel: 'Otwórz swoje fiszki',
	decksCaption:
		'Przy każdych fiszkach widać, ile ich jest, ile z nich jest dziś do powtórki i skąd powstały. Środkowe leżą na kursie, więc klasa też może się z nich uczyć.',
	cardHeading: 'Jedna fiszka, obie strony',
	card: {
		frontLabel: 'Przód — treść zadania',
		backLabel: 'Tył — opublikowana odpowiedź',
		front: 'Oblicz \\( \\lim_{n\\to\\infty} \\dfrac{3n^{2}+2n}{n^{2}-1} \\).',
		back: '\\( 3 \\)',
		hint: 'Podziel licznik i mianownik przez \\( n^{2} \\).'
	},
	cardCaption:
		'Odwróć ją i oceń. To jedyna działająca demonstracja na tych stronach — nic nie zapisuje, bo ta fiszka nie leży na niczyim koncie.',
	gradesHeading: 'Co robią cztery oceny',
	grades: [
		{
			key: 'again',
			meaning: 'Nie wiedziałeś. Fiszka wróci w tej sesji, a jej odstęp zaczyna się od nowa.',
			days: 0
		},
		{
			key: 'hard',
			meaning:
				'Doszedłeś, ale z trudem. Odstęp rośnie niewiele, a fiszka staje się w oczach harmonogramu trochę trudniejsza.',
			days: 7
		},
		{
			key: 'good',
			meaning: 'Wiedziałeś. Odstęp rośnie o własny współczynnik łatwości tej fiszki.',
			days: 25
		},
		{
			key: 'easy',
			meaning:
				'Wiedziałeś od razu. Odstęp rośnie bardziej, a fiszka staje się łatwiejsza, więc pyta rzadziej.',
			days: 36
		}
	],
	gradesNote:
		'Liczby dni to arytmetyka SM-2 na jednej przykładowej fiszce — takiej już kilka razy widzianej, w tej chwili z odstępem dziesięciu dni. Pierwsze odstępy świeżej fiszki są znacznie krótsze, a każda fiszka ma własny współczynnik łatwości, więc żadne dwie fiszki nie zachowują się identycznie.',
	queueHeading: 'Kolejka powtórek',
	queue: { due: 7, fresh: 5, learned: 12, total: 24 },
	queueLabels: {
		due: 'Dziś do powtórki',
		fresh: 'Nigdy niewidziane',
		learned: 'Zaplanowane dalej',
		total: 'Fiszek łącznie'
	},
	queueCaption:
		'Najpierw fiszki do powtórki, potem te, których jeszcze nie widziałeś. Ekran końcowy mówi, co zrobiłeś; nie wystawia oceny.',
	placementHeading: 'Fiszki położone na kursie',
	placementBody: [
		'Położenie to wiersz mówiący „te fiszki należą do tego kursu” i właśnie ono sprawia, że fiszki docierają do innych ludzi. Kto widzi kurs, może się z nich uczyć; kto prowadzi kurs, może je położyć i zabrać. Same fiszki nie zmieniają właściciela — zostają przy tym, kto je zrobił, a usunięcie położenia usuwa udostępnienie, nie fiszki.',
		'Fiszki mogą leżeć na kursie albo na wydarzeniu i na niczym więcej. Profil, materiał i pojęcie nie są miejscami, w których grupa ludzi uczy się razem, więc nie są proponowane.'
	],
	placedDeck: {
		name: 'Tydzień 4: ciągłość',
		cardCount: 12,
		dueCount: 4,
		source: 'lesson',
		placedOn: { kind: 'course', name: 'Analiza I, grupa wiosenna' },
		isPublic: false
	},
	placementCaption:
		'Te same fiszki widziane przez uczestnika kursu: do uczenia się, z własnym harmonogramem, nie z harmonogramem prowadzącego.',
	closing:
		'Publiczna biblioteka fiszek, kopiowanie fiszek od obcych i przypomnienie, gdy powtórki się nazbierają, celowo nie weszły do tej pierwszej wersji. To, co jest, wystarcza, by powtarzać, i wystarcza, by prowadzący podał klasie tydzień fiszek.',
	tryIt: [
		{ label: 'Otwórz swoje fiszki', route: '/flashcards' },
		{ label: 'Złóż zestaw, z którego zrobisz fiszki', route: '/my-set' }
	],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/flashcards/02-decks.png',
			focus: [268, 1012],
			width: 1280,
			height: 580,
			route: '/flashcards',
			alt: 'Zrzut ekranu strony z fiszkami: „5 cards waiting across 2 decks”, pole na nazwę nowych fiszek i dwie pozycje na liście — „Definitions I keep forgetting”, ułożona ręcznie, oraz „Limits and sequences”, zrobiona z zestawu zadań — każda z przyciskami Open i Review i liczbą kart do powtórki.',
			caption: 'Twoje fiszki: ile kart czeka łącznie i przycisk powtórki przy każdej pozycji.'
		},
		{
			src: '/guide/flashcards/06-grades.png',
			focus: [308, 972],
			width: 1280,
			height: 700,
			route: '/flashcards',
			alt: 'Zrzut ekranu powtórki fiszek „Limits and sequences”, karta 1 z 3: treść zadania o pochodnych cząstkowych, odsłonięta pod nią odpowiedź i cztery przyciski — Again, Hard, Good, Easy — ponumerowane od 1 do 4.',
			caption:
				'Powtórka: odwrócona karta i cztery oceny — te same, które można wypróbować na przykładowej karcie poniżej.',
			linkLabel: 'Otwórz fiszki i powtórz je'
		}
	]
};

export function flashcardsShowcaseFor(locale: string): FlashcardsShowcase {
	return locale === 'pl' ? PL : EN;
}
