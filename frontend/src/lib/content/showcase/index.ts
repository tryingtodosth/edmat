/**
 * The design showcase under `/about/<feature>` — the index, and the shapes every page of it shares.
 *
 * **Why the text is here and not in the message catalogues.** `content/about.ts` opened this
 * exception and its header sets out the reason: a page that only reads properly end to end is one
 * piece of writing, and split across forty keys a reviewer cannot tell whether the Polish still
 * says what the English does. House rule 1's real purpose — nothing is ever English-only — is met
 * exactly, because both locales live in the same file and a third cannot be added without adding
 * all of it. The *chrome* around the writing (the "sample" badge, the grade buttons, the
 * back-link) is ordinary UI and does live in the catalogues, under the `showcase_` prefix.
 *
 * **Everything on these pages is sample data.** Nothing is seeded into a production table, nothing
 * is fetched, and no id here points at a real row — which is why every sample is rendered inside
 * `components/showcase/SampleFrame.svelte`, whose `inert` wrapper means a reader cannot click
 * through to a row that does not exist. That posture is `/dziennik`'s (HISTORY.md §17BO), applied
 * to one page at a time rather than to a whole second product: a recorded picture with no server
 * behind it, honest about being one.
 *
 * **These pages describe the learning cycle of 2026-10-05** (`prompts/00-DESIGN.md`) — flashcards,
 * the learning record, school mode and the completion certificate, concept paths, event take-home
 * decks. They are written from the briefs rather than from the merged code, because the showcase
 * was built beside the seven features it shows rather than after them, so each page says what the
 * design is and must be re-read once its feature has actually landed.
 */

/** The seven pages, by their URL segment under `/about/`. */
export type ShowcaseSlug =
	'exercises' | 'flashcards' | 'learning-record' | 'courses' | 'schools' | 'concepts' | 'events';

/**
 * One entry of the index. The shape is fixed by `prompts/08-about-showcase.md` because step H (the
 * manual) reads this list to link each of its chapters to the showcase that illustrates it —
 * `slug` and `titleFor(locale)` are the two fields it needs. `blurbFor` is this file's own
 * addition, for the card grid on `/about`.
 */
export interface ShowcasePage {
	slug: ShowcaseSlug;
	titleFor(locale: string): string;
	blurbFor(locale: string): string;
}

/** Interface-language helper: everything here is EN or PL, the same two the catalogues carry. */
function pick(locale: string, en: string, pl: string): string {
	return locale === 'pl' ? pl : en;
}

/**
 * What every showcase page carries. The page-specific sample objects live in each page's own
 * module, which extends this.
 */
export interface ShowcaseDoc {
	/** The `<h1>`, and the page's own name in the tab title. */
	title: string;
	/** One sentence for `PageHead` — the search snippet and the link preview. */
	description: string;
	/** The "what this is" paragraphs, in the voice of `/about`: plain, no marketing. */
	lead: string[];
	/** Numbered points under the lead — how the thing actually works, one claim each. */
	points?: { heading: string; body: string }[];
	/** Closing paragraph. Optional; most pages have one. */
	closing?: string;
}

/** A labelled row — a lesson's item, a session's link, a class in a school, a card in a deck. */
export interface ShowcaseRow {
	/** The kind, drawn as a small pill: "Exercise", "Material", "Set", "Class". */
	label: string;
	title: string;
	/** A short right-hand note: a count, a date, a state. */
	note?: string;
}

/** A deck as its own summary tile — `card_count`, `due_count`, where it came from, where it sits. */
export interface ShowcaseDeck {
	name: string;
	cardCount: number;
	dueCount: number;
	source: 'set' | 'lesson' | 'session' | 'concept' | null;
	/** The course or event a placement puts it on, already named for the reader. */
	placedOn?: { kind: 'course' | 'event'; name: string };
	/** False for every deck in this cycle — `is_public` exists and defaults off. */
	isPublic: boolean;
}

/** The index itself: what the section on `/about` says above the grid of seven cards. */
export interface ShowcaseIndexDoc {
	heading: string;
	intro: string;
	/** The link label on each card — one phrase, repeated. */
	cardCta: string;
}

const INDEX_EN: ShowcaseIndexDoc = {
	heading: 'See how each part of it works',
	intro:
		'Seven pages, one per piece of the site, each drawn with the real components and sample data — so you can see what a course with a deck on it, a learning record or a school on EdMat actually looks like without signing in or joining anything. Nothing on them is live.',
	cardCta: 'See the design'
};

const INDEX_PL: ShowcaseIndexDoc = {
	heading: 'Zobacz, jak działa każda część',
	intro:
		'Siedem stron, jedna na każdy element serwisu, narysowanych prawdziwymi komponentami na przykładowych danych — żeby dało się zobaczyć, jak naprawdę wygląda kurs z talią fiszek, rejestr nauki albo szkoła w EdMacie, bez zakładania konta i bez dołączania do czegokolwiek. Nic na nich nie jest prawdziwe.',
	cardCta: 'Zobacz'
};

export function showcaseIndexFor(locale: string): ShowcaseIndexDoc {
	return locale === 'pl' ? INDEX_PL : INDEX_EN;
}

export const SHOWCASE_PAGES: ShowcasePage[] = [
	{
		slug: 'exercises',
		titleFor: (l) => pick(l, 'An exercise, a set, a deck', 'Zadanie, zestaw, talia'),
		blurbFor: (l) =>
			pick(
				l,
				'What one row of the corpus carries, how you collect rows into a set of your own, and what happens when that set becomes a deck of flashcards.',
				'Co zawiera jeden wiersz bazy, jak zbiera się zadania we własny zestaw i co się dzieje, gdy ten zestaw staje się talią fiszek.'
			)
	},
	{
		slug: 'flashcards',
		titleFor: (l) => pick(l, 'Flashcards and spaced review', 'Fiszki i powtórki w odstępach'),
		blurbFor: (l) =>
			pick(
				l,
				'A deck, a card with two faces, four grades and the schedule they move. Turn one over here — it saves nothing.',
				'Talia, fiszka z dwiema stronami, cztery oceny i harmonogram, który one przesuwają. Odwróć jedną tutaj — nic się nie zapisze.'
			)
	},
	{
		slug: 'learning-record',
		titleFor: (l) => pick(l, 'The learning record', 'Rejestr nauki'),
		blurbFor: (l) =>
			pick(
				l,
				'Two blocks on a profile: the grades somebody chose to share, and what they have done here — counted per subject, never mixed with the grades.',
				'Dwa bloki w profilu: oceny, które ktoś zdecydował się pokazać, i to, co zrobił tutaj — zliczone per przedmiot i nigdy nie mieszane z ocenami.'
			)
	},
	{
		slug: 'courses',
		titleFor: (l) => pick(l, 'A course, a week, a certificate', 'Kurs, tydzień, zaświadczenie'),
		blurbFor: (l) =>
			pick(
				l,
				'Chapters and lessons built out of the catalogue, a deck made from one week of them, and the completion a course can issue — which is not a grade.',
				'Rozdziały i lekcje ułożone z katalogu, talia zrobiona z jednego tygodnia i zaświadczenie, które kurs może wydać — a które nie jest oceną.'
			)
	},
	{
		slug: 'schools',
		titleFor: (l) => pick(l, 'A school on EdMat', 'Szkoła w EdMacie'),
		blurbFor: (l) =>
			pick(
				l,
				'A school is an organisation whose courses are classes, with guardians on the roster. The full school register is a separate demonstration.',
				'Szkoła to organizacja, której kursy są klasami, a na liście uczestników są opiekunowie. Pełny dziennik to osobne demo.'
			)
	},
	{
		slug: 'concepts',
		titleFor: (l) =>
			pick(l, 'Concepts, and what to learn first', 'Pojęcia i co trzeba wiedzieć wcześniej'),
		blurbFor: (l) =>
			pick(
				l,
				'One page per idea, written once for each kind of reader, with a prerequisite graph that an exercise page reads as "before this, know…".',
				'Jedna strona na jedno pojęcie, napisana osobno dla każdego czytelnika, z grafem wymagań, który strona zadania czyta jako „wcześniej warto wiedzieć…”.'
			)
	},
	{
		slug: 'events',
		titleFor: (l) => pick(l, 'What an event leaves behind', 'Co zostaje po wydarzeniu'),
		blurbFor: (l) =>
			pick(
				l,
				'A programme session you can take home as a deck, and the courses an event meets through the organisation that runs both.',
				'Sesja z programu, którą można zabrać do domu jako talię, i kursy, z którymi wydarzenie spotyka się przez organizację prowadzącą jedno i drugie.'
			)
	}
];
