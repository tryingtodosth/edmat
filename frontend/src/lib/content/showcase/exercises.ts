/**
 * `/about/exercises` — one row of the corpus, a set of them, and the deck a set becomes.
 *
 * The sample exercises are REAL objects of the real `ResolvedExercise` type, so `ExerciseCard`
 * renders them exactly as a branch page does; TypeScript is what stops this file drifting from the
 * shape the API actually serves. The maths in them is literal LaTeX in the storage format the
 * whole site uses (`\( … \)` inline, `\[ … \]` display) and goes through `MathContent`, so this
 * page is also a live check that the content pipeline typesets a prerendered page.
 *
 * `\\(` in this file is `\(` in the string — a lone backslash before a bracket is dropped by
 * JavaScript, which would silently hand KaTeX nothing to find.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ResolvedExercise } from '$lib/types';
import type { ShowcaseDeck, ShowcaseDoc, ShowcaseRow } from './index';

export interface ExercisesShowcase extends ShowcaseDoc {
	cardsHeading: string;
	/** Rendered through the real `ExerciseCard`, with the branch name it shows above the badges. */
	cards: { exercise: ResolvedExercise; branchName: string }[];
	cardsCaption: string;
	/** The four faces a row can carry, statement first — the only one that is never empty. */
	facesHeading: string;
	faces: { label: string; note: string; body: string }[];
	facesCaption: string;
	setHeading: string;
	setName: string;
	setRows: ShowcaseRow[];
	setCaption: string;
	deckHeading: string;
	deck: ShowcaseDeck;
	deckCaption: string;
	snapshotNote: string;
	/** Labels for the two links out of this page, to surfaces that really exist. */
	browseLinkLabel: string;
	setLinkLabel: string;
}

/** Everything the two sample rows share, so each literal below says only what differs. */
function base(): Omit<
	ResolvedExercise,
	'id' | 'number' | 'title' | 'statement' | 'answer' | 'difficulty' | 'verified'
> {
	return {
		branchId: 'uw-mat-analiza-i',
		topicIds: ['limits'],
		audience: 'university',
		licence: 'cc-by-sa-4.0',
		canEdit: false,
		textLicence: 'cc-by-sa-4.0',
		source: { type: 'midterm', name: '' },
		tags: [],
		published: true,
		originalLocale: 'pl',
		createdAt: '2026-02-11T09:00:00Z',
		averageRating: 4.6,
		reviewCount: 11,
		locale: 'pl',
		isOriginal: true,
		entries: [],
		availableLocales: ['pl', 'en'],
		requirements: [],
		contributors: []
	};
}

const EN: ExercisesShowcase = {
	title: 'An exercise, a set, a deck',
	description:
		'What one exercise in EdMat carries, how you collect exercises into a set of your own, and what happens when that set becomes a deck of flashcards.',
	lead: [
		'An exercise is the smallest thing on this site, and the thing everything else points at. It is never copied: a course that teaches it, a set you build for an exam, a concept it belongs to and a flashcard made from it all reference the same row, so a corrected solution is corrected everywhere at once.',
		'This page shows one row as a reader meets it, then the two things you can do with a handful of them — collect them into a set, and turn that set into something to revise from.'
	],
	points: [
		{
			heading: 'The statement is the only face that is always there',
			body: 'A hint, an answer and a full solution are each written by somebody, at some point, or not at all. A “prove that” exercise has no answer to give, and an empty answer is the honest rendering of that rather than a gap to be filled.'
		},
		{
			heading: '“Verified” is not a switch anybody flips',
			body: 'The badge means a reviewed solution exists for this exercise. It appears when one does and disappears when that stops being true, so nobody can award it to their own work.'
		},
		{
			heading: 'A set is yours until you share it',
			body: 'Collect exercises as you browse, name the set, print it, or make it public with a link. A set of somebody else’s exercises is still a piece of your own work — it says what you decided was worth revising.'
		}
	],
	cardsHeading: 'One row of the corpus, twice',
	cards: [
		{
			exercise: {
				...base(),
				id: '9001',
				number: 184,
				difficulty: 'medium',
				verified: true,
				title: 'Limit of a rational sequence',
				statement: 'Compute \\( \\lim_{n\\to\\infty} \\dfrac{3n^{2}+2n}{n^{2}-1} \\).',
				answer: '\\( 3 \\)'
			},
			branchName: 'Mathematical Analysis I'
		},
		{
			exercise: {
				...base(),
				id: '9002',
				number: 185,
				difficulty: 'hard',
				verified: false,
				source: { type: 'exam', name: '' },
				title: 'A root that tends to one',
				statement: 'Show that \\[ \\lim_{n\\to\\infty} \\sqrt[n]{n} = 1. \\]',
				answer: ''
			},
			branchName: 'Mathematical Analysis I'
		}
	],
	cardsCaption:
		'Two sample exercises in the card the branch and search pages use. The second has no answer — it is a “show that”, and its solution is the whole of it.',
	facesHeading: 'The four faces of one exercise',
	faces: [
		{
			label: 'Statement',
			note: 'Always present.',
			body: 'Compute \\( \\lim_{n\\to\\infty} \\dfrac{3n^{2}+2n}{n^{2}-1} \\).'
		},
		{
			label: 'Hint',
			note: 'Where to start, without giving it away.',
			body: 'Divide the numerator and the denominator by \\( n^{2} \\).'
		},
		{ label: 'Answer', note: 'The result alone.', body: '\\( 3 \\)' },
		{
			label: 'Solution',
			note: 'The full working. Reviewed, it earns the “verified” badge.',
			body: 'Dividing through by \\( n^{2} \\) gives\n\n\\[ \\frac{3n^{2}+2n}{n^{2}-1} = \\frac{3 + \\frac{2}{n}}{1 - \\frac{1}{n^{2}}}, \\]\n\nand both \\( \\frac{2}{n} \\) and \\( \\frac{1}{n^{2}} \\) tend to zero, so the quotient tends to \\( 3 \\).'
		}
	],
	facesCaption:
		'One exercise, read the way the exercise page reveals it: the statement, then whichever of the three others somebody has written.',
	setHeading: 'A set you build yourself',
	setName: 'Midterm 2 — limits and series',
	setRows: [
		{ label: 'Exercise', title: 'Limit of a rational sequence', note: 'medium' },
		{ label: 'Exercise', title: 'A root that tends to one', note: 'hard' },
		{ label: 'Exercise', title: 'Comparison test for a positive series', note: 'medium' }
	],
	setCaption:
		'A set is an ordered list of exercises with your own name on it. Three here; the real ones run to thirty.',
	deckHeading: 'And the deck that set becomes',
	deck: {
		name: 'Midterm 2 — limits and series',
		cardCount: 3,
		dueCount: 3,
		source: 'set',
		isPublic: false
	},
	deckCaption:
		'The same three exercises as a deck: front the statement, back the published answer. Every card is due on the day it is made.',
	browseLinkLabel: 'Browse the disciplines',
	setLinkLabel: 'Open My set',
	snapshotNote:
		'The membership is a snapshot and the content is not. Which exercises went into the deck was decided when you pressed the button, so adding a fourth to the set later does not change the deck — but each card still points at the live exercise, so a corrected answer reaches the card without anybody rebuilding it.',
	tryIt: [
		{ label: 'Browse the exercises', route: '/disciplines' },
		{ label: 'Open My set', route: '/my-set' },
		{ label: 'Your flashcard decks', route: '/flashcards' }
	],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/exercises/02-branch.png',
			focus: [98, 1182],
			width: 1280,
			height: 820,
			route: '/disciplines',
			alt: 'Screenshot of a branch page: a filter panel with search, topic, difficulty and source on the left, and exercise cards on the right — “Całka Gaussa”, “Granica ciągu”, “Normy ℓ¹ i ℓ∞” and more — each with difficulty, level and source badges, a star rating and a plus button.',
			caption:
				'A branch page: every exercise of one subject as a card, with the filters on the left and a plus on each card to put it in your set.',
			linkLabel: 'Browse to a branch'
		},
		{
			src: '/guide/exercises/06-my-set.png',
			focus: [258, 1022],
			width: 1280,
			height: 800,
			route: '/my-set',
			alt: 'Screenshot of My set: Export to PDF and Clear set buttons, a box to save the set under a name, a saved set called “Before the midterm” with Share, Load and “Make a deck from this set”, and the first two exercises with Hint, Answer and Solution checkboxes.',
			caption:
				'My set: the exercises you collected, what to print with each, a name to save them under — and “Make a deck from this set”.'
		}
	]
};

const PL: ExercisesShowcase = {
	title: 'Zadanie, zestaw, fiszki',
	description:
		'Co zawiera jedno zadanie w EdMacie, jak zbiera się zadania we własny zestaw i co się dzieje, gdy ten zestaw staje się fiszkami.',
	lead: [
		'Zadanie to najmniejsza rzecz w tym serwisie i to, na co wskazuje wszystko inne. Nigdy nie jest kopiowane: kurs, który go uczy, zestaw układany przed kolokwium, pojęcie, do którego należy, i fiszka z niego zrobiona — wszystkie odsyłają do tego samego wiersza, więc poprawione rozwiązanie poprawia się wszędzie naraz.',
		'Ta strona pokazuje jeden wiersz tak, jak widzi go czytelnik, a potem dwie rzeczy, które można zrobić z kilkoma — zebrać je w zestaw i zamienić ten zestaw w coś, z czego da się powtarzać.'
	],
	points: [
		{
			heading: 'Treść to jedyna część, która jest zawsze',
			body: 'Wskazówkę, odpowiedź i pełne rozwiązanie ktoś kiedyś napisał albo nie napisał. Zadanie „wykaż, że” nie ma odpowiedzi do podania, a pusta odpowiedź jest uczciwym tego zapisem, nie luką do zapełnienia.'
		},
		{
			heading: '„Zweryfikowane” nie jest przełącznikiem',
			body: 'Odznaka znaczy, że istnieje sprawdzone rozwiązanie tego zadania. Pojawia się, gdy takie jest, i znika, gdy przestaje to być prawdą — więc nikt nie przyzna jej własnej pracy.'
		},
		{
			heading: 'Zestaw jest twój, dopóki go nie udostępnisz',
			body: 'Zbieraj zadania, przeglądając bazę, nazwij zestaw, wydrukuj go albo udostępnij linkiem. Zestaw czyichś zadań wciąż jest twoją pracą — mówi, co uznałeś za warte powtórzenia.'
		}
	],
	cardsHeading: 'Jeden wiersz bazy, dwa razy',
	cards: [
		{
			exercise: {
				...base(),
				id: '9001',
				number: 184,
				difficulty: 'medium',
				verified: true,
				title: 'Granica ciągu wymiernego',
				statement: 'Oblicz \\( \\lim_{n\\to\\infty} \\dfrac{3n^{2}+2n}{n^{2}-1} \\).',
				answer: '\\( 3 \\)'
			},
			branchName: 'Analiza matematyczna I'
		},
		{
			exercise: {
				...base(),
				id: '9002',
				number: 185,
				difficulty: 'hard',
				verified: false,
				source: { type: 'exam', name: '' },
				title: 'Pierwiastek, który dąży do jedynki',
				statement: 'Wykaż, że \\[ \\lim_{n\\to\\infty} \\sqrt[n]{n} = 1. \\]',
				answer: ''
			},
			branchName: 'Analiza matematyczna I'
		}
	],
	cardsCaption:
		'Dwa przykładowe zadania w karcie, której używają strony przedmiotu i wyszukiwania. Drugie nie ma odpowiedzi — to „wykaż, że”, a jego rozwiązanie jest całością.',
	facesHeading: 'Cztery części jednego zadania',
	faces: [
		{
			label: 'Treść',
			note: 'Zawsze obecna.',
			body: 'Oblicz \\( \\lim_{n\\to\\infty} \\dfrac{3n^{2}+2n}{n^{2}-1} \\).'
		},
		{
			label: 'Wskazówka',
			note: 'Od czego zacząć, bez zdradzania reszty.',
			body: 'Podziel licznik i mianownik przez \\( n^{2} \\).'
		},
		{ label: 'Odpowiedź', note: 'Sam wynik.', body: '\\( 3 \\)' },
		{
			label: 'Rozwiązanie',
			note: 'Pełny tok. Sprawdzone, daje odznakę „zweryfikowane”.',
			body: 'Po podzieleniu przez \\( n^{2} \\) dostajemy\n\n\\[ \\frac{3n^{2}+2n}{n^{2}-1} = \\frac{3 + \\frac{2}{n}}{1 - \\frac{1}{n^{2}}}, \\]\n\na \\( \\frac{2}{n} \\) i \\( \\frac{1}{n^{2}} \\) dążą do zera, więc iloraz dąży do \\( 3 \\).'
		}
	],
	facesCaption:
		'Jedno zadanie, czytane tak, jak odsłania je strona zadania: najpierw treść, potem te z trzech pozostałych części, które ktoś napisał.',
	setHeading: 'Zestaw, który układasz sam',
	setName: 'Kolokwium 2 — granice i szeregi',
	setRows: [
		{ label: 'Zadanie', title: 'Granica ciągu wymiernego', note: 'średnie' },
		{ label: 'Zadanie', title: 'Pierwiastek, który dąży do jedynki', note: 'trudne' },
		{ label: 'Zadanie', title: 'Kryterium porównawcze dla szeregu dodatniego', note: 'średnie' }
	],
	setCaption:
		'Zestaw to uporządkowana lista zadań z twoją własną nazwą. Tutaj trzy; prawdziwe mają po trzydzieści.',
	deckHeading: 'I fiszki, którymi ten zestaw się staje',
	deck: {
		name: 'Kolokwium 2 — granice i szeregi',
		cardCount: 3,
		dueCount: 3,
		source: 'set',
		isPublic: false
	},
	deckCaption:
		'Te same trzy zadania jako fiszki: z przodu treść, z tyłu opublikowana odpowiedź. Każda jest do powtórki w dniu, w którym powstała.',
	browseLinkLabel: 'Przeglądaj dziedziny',
	setLinkLabel: 'Otwórz Mój zestaw',
	snapshotNote:
		'Skład jest migawką, a treść nie. To, z których zadań powstały fiszki, zostało ustalone w chwili naciśnięcia przycisku, więc dodanie czwartego do zestawu później nie dokłada fiszki — ale każda fiszka wciąż wskazuje na żywe zadanie, więc poprawiona odpowiedź dociera do fiszki bez przebudowywania czegokolwiek.',
	tryIt: [
		{ label: 'Przeglądaj zadania', route: '/disciplines' },
		{ label: 'Otwórz Mój zestaw', route: '/my-set' },
		{ label: 'Twoje fiszki', route: '/flashcards' }
	],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/exercises/02-branch.png',
			focus: [98, 1182],
			width: 1280,
			height: 820,
			route: '/disciplines',
			alt: 'Zrzut ekranu strony przedmiotu: po lewej panel filtrów z wyszukiwarką, tematem, trudnością i źródłem, po prawej karty zadań — „Całka Gaussa”, „Granica ciągu”, „Normy ℓ¹ i ℓ∞” i kolejne — każda z oznaczeniem trudności, poziomu i źródła, oceną w gwiazdkach i przyciskiem plusa.',
			caption:
				'Strona przedmiotu: każde zadanie jako karta, filtry po lewej i plus na każdej karcie, żeby dodać zadanie do zestawu.',
			linkLabel: 'Przejdź do przedmiotu'
		},
		{
			src: '/guide/exercises/06-my-set.png',
			focus: [258, 1022],
			width: 1280,
			height: 800,
			route: '/my-set',
			alt: 'Zrzut ekranu Mojego zestawu: przyciski eksportu do PDF i czyszczenia zestawu, pole do zapisania zestawu pod nazwą, zapisany zestaw „Before the midterm” z przyciskami udostępniania, wczytania i „Make a deck from this set” oraz dwa pierwsze zadania z polami Hint, Answer i Solution.',
			caption:
				'Mój zestaw: zebrane zadania, co wydrukować przy każdym, nazwa, pod którą go zapisać — i „zrób fiszki z tego zestawu”.'
		}
	]
};

export function exercisesShowcaseFor(locale: string): ExercisesShowcase {
	return locale === 'pl' ? PL : EN;
}
