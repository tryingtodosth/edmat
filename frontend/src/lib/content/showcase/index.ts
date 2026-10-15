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
 * **Every SAMPLE on these pages is sample data.** Nothing is seeded into a production table, nothing
 * is fetched, and no id here points at a real row — which is why every sample is rendered inside
 * `components/showcase/SampleFrame.svelte`, whose `inert` wrapper means a reader cannot click
 * through to a row that does not exist. That posture is `/dziennik`'s (HISTORY.md §17BO), applied
 * to one page at a time rather than to a whole second product: a recorded picture with no server
 * behind it, honest about being one.
 *
 * **Beside the samples, real screens and real links (2026-10-14).** A page may also carry `shots` —
 * screenshots of the running site the manual already took, drawn outside the frame by
 * `ShowcaseShot.svelte` — and `tryIt`, the live pages to go and use. The two kinds never mix: a
 * framed thing is a drawing and cannot be clicked, a screenshot is a picture of the real page and
 * links to it. Every live link answers to its feature's kill switch (`components/showcase/hrefs.ts`).
 *
 * **These pages describe the learning cycle of 2026-10-05** (`prompts/00-DESIGN.md`) — flashcards,
 * the learning record, school mode and the completion certificate, concept paths, event take-home
 * decks. They are written from the briefs rather than from the merged code, because the showcase
 * was built beside the seven features it shows rather than after them, so each page says what the
 * design is and must be re-read once its feature has actually landed.
 */

/** The fourteen pages, by their URL segment under `/about/`. `contests` is the eighth (2026-10-09,
 *  CONTESTS-BRIEF.md §3.B) and the only one whose subject is mostly law rather than design — see
 *  `content/showcase/contests.ts` for what that changes about how it is written. The last four
 *  (2026-10-14, WP5) show modules that had no page here: the management layer, tutoring,
 *  materials and the conference layer. They are written against the merged code rather than a
 *  brief, lean on screenshots more than on samples, and share one section shape
 *  (`ShowcaseModuleDoc` below). */
export type ShowcaseSlug =
	| 'exercises'
	| 'flashcards'
	| 'learning-record'
	| 'courses'
	| 'schools'
	| 'concepts'
	| 'events'
	| 'contests'
	| 'goals-and-work'
	| 'tutoring'
	| 'materials'
	| 'conference'
	// WP6 (2026-10-15): not a module but the person — the account and what it controls, and the
	// licence and data questions every module shares. Same `ShowcaseModuleDoc` shape.
	| 'account'
	| 'licences-and-data';

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
 * The live pages a showcase page may send a reader to — "Try it yourself" and a screenshot's
 * "Open the real page". A union of route strings rather than hrefs, because this file is data and
 * must not import `$app/paths`: `components/showcase/hrefs.ts: SHOWCASE_LIVE` resolves each one
 * once and pairs it with the kill switch it answers to, so a killed feature's link disappears
 * everywhere it is drawn and no content file can forget the flag. Adding a route is a line here
 * and a line there; TypeScript refuses the build until both exist.
 */
export type ShowcaseLiveRoute =
	| '/disciplines'
	| '/my-set'
	| '/flashcards'
	| '/concepts'
	| '/contests'
	| '/courses'
	| '/events'
	| '/organizations'
	| '/settings'
	| '/about'
	| '/work'
	| '/tasks'
	| '/needs'
	| '/tutoring'
	| '/bookings'
	| '/materials'
	| '/material-projects'
	| '/conference'
	| '/venues'
	| '/volunteering/hours'
	// WP6 (2026-10-15). `/settings#account` is the one key here that is not a bare route: `/settings`
	// is already keyed for the learning record and answers to `learning_record` there, while the
	// account page links the same page for its e-mail, password and children cards, which no switch
	// removes. The key is a purpose, not an address — `SHOWCASE_LIVE` resolves it to `/settings`.
	| '/register'
	| '/login'
	| '/settings#account'
	| '/settings/account'
	| '/submit'
	| '/submit-material'
	| '/terms'
	| '/privacy';

/** One link in the "Try it yourself" row: a real page, named for what the reader will do there. */
export interface ShowcaseTryLink {
	label: string;
	route: ShowcaseLiveRoute;
}

/**
 * A screenshot of the running site, drawn OUTSIDE `SampleFrame` by `ShowcaseShot.svelte` — it is a
 * picture of the real page, not a sample, and it says so.
 *
 * Only pictures that already exist under `static/guide/` are used: `e2e/guide-screenshots.mjs`
 * takes them against seeded data, and re-running it keeps these current too. They are of the
 * English interface, one set only (`content/guide/types.ts` says why); the caption and alt text
 * are in the page's language. `width`/`height` are the PNG's real pixel size, so the browser
 * reserves the box before the lazy image arrives and nothing below it moves.
 */
export interface ShowcaseShot {
	/** Path under `static/`, e.g. `/guide/flashcards/02-decks.png`. */
	src: string;
	width: number;
	height: number;
	/** What the picture shows, for a reader who cannot see it. Never empty. */
	alt: string;
	/** One sentence under the picture: what to look at in it. */
	caption: string;
	/**
	 * The live page this is a picture of — or, for one row's page, the list that leads to it.
	 *
	 * Optional since 2026-10-14: a picture of a page a visitor cannot open — the door scanner, the
	 * cloakroom desk, a ticket, each behind an event id and a staff or attendee right — carries no
	 * link at all rather than one to a page that would refuse them. The caption says who sees it.
	 */
	route?: ShowcaseLiveRoute;
	/** Overrides "Open the real page" when `route` is the list rather than the page pictured. */
	linkLabel?: string;
	/**
	 * The columns of the PNG worth showing, `[left, right]` in its own pixels. The manual shoots
	 * every page at 1280 wide, so a centred page is a third empty margin; drawn whole in a column
	 * under 1000 px its text shrinks to unreadable. The shell crops to these columns with CSS alone
	 * (the file is not touched) and never draws them wider than they are. Omitted = the full width.
	 */
	focus?: [number, number];
	/**
	 * The rows worth showing, `[top, bottom]` in the PNG's own pixels — the vertical twin of
	 * `focus`, for a picture the manual took with something below the subject (its 760-px tutoring
	 * shot ends in the site footer). Same CSS-only crop; the file is not touched. Omitted = the full
	 * height.
	 */
	focusY?: [number, number];
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
	/** The real pages to go and use, drawn as a row under the hero. A killed feature's link is
	 *  dropped by the shell, not here. */
	tryIt?: ShowcaseTryLink[];
	/** Screenshots of the running site, drawn after the hero and before the samples. */
	shots?: ShowcaseShot[];
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

/**
 * One section of a module page (the four added 2026-10-14): a heading, its prose, and optionally a
 * framed sample of rows or a plain list of facts. `key` is the section's discussion key AND the key
 * the route page uses to say which kill switch the section answers to — the route, not this file,
 * names flags, the same division `SHOWCASE_LIVE` keeps.
 */
export interface ShowcaseModuleSection {
	key: string;
	heading: string;
	body: string[];
	/** A framed sample, drawn by `SampleRows` inside `SampleFrame` — only where it adds something
	 *  a screenshot does not show. */
	sample?: { caption: string; title?: string; rows: ShowcaseRow[] };
	/** A plain definition list of facts (not a sample: nothing invented in it). */
	facts?: { term: string; detail: string }[];
}

/** A module page: the shared shell's fields plus its sections, in order. */
export interface ShowcaseModuleDoc extends ShowcaseDoc {
	sections: ShowcaseModuleSection[];
}

/** The index itself: what the section on `/about` says above the grid of cards. */
export interface ShowcaseIndexDoc {
	heading: string;
	intro: string;
	/** The link label on each card — one phrase, repeated. */
	cardCta: string;
}

const INDEX_EN: ShowcaseIndexDoc = {
	heading: 'See how each part of it works',
	intro:
		'Fourteen pages, one per piece of the site, each drawn with the real components, sample data and screenshots — so you can see what a course with a deck on it, a learning record, a tutoring booking, a team’s task board or a conference door scanner actually looks like without signing in or joining anything. The framed samples are not live; the screenshots are of the running site, and every page links to the real thing so you can try it yourself.',
	cardCta: 'See the design'
};

const INDEX_PL: ShowcaseIndexDoc = {
	heading: 'Zobacz, jak działa każda część',
	intro:
		'Czternaście stron, jedna na każdy element serwisu, pokazanych prawdziwymi komponentami, przykładowymi danymi i zrzutami ekranu — żeby dało się zobaczyć, jak naprawdę wygląda kurs z fiszkami, rejestr nauki, rezerwacja korepetycji, tablica zadań zespołu albo skaner biletów na konferencji, bez zakładania konta i bez dołączania do czegokolwiek. Przykłady w ramkach nie są prawdziwe, zrzuty ekranu pochodzą z działającego serwisu, a każda strona prowadzi do prawdziwej wersji, żeby można było samemu spróbować.',
	cardCta: 'Zobacz'
};

export function showcaseIndexFor(locale: string): ShowcaseIndexDoc {
	return locale === 'pl' ? INDEX_PL : INDEX_EN;
}

export const SHOWCASE_PAGES: ShowcasePage[] = [
	{
		slug: 'exercises',
		titleFor: (l) => pick(l, 'An exercise, a set, a deck', 'Zadanie, zestaw, fiszki'),
		blurbFor: (l) =>
			pick(
				l,
				'What one row of the corpus carries, how you collect rows into a set of your own, and what happens when that set becomes a deck of flashcards.',
				'Co zawiera jeden wiersz bazy, jak zbiera się zadania we własny zestaw i co się dzieje, gdy ten zestaw staje się fiszkami.'
			)
	},
	{
		slug: 'flashcards',
		titleFor: (l) => pick(l, 'Flashcards and spaced review', 'Fiszki i powtórki w odstępach'),
		blurbFor: (l) =>
			pick(
				l,
				'A deck, a card with two faces, four grades and the schedule they move. Turn one over here — it saves nothing.',
				'Fiszki, każda z dwiema stronami, cztery oceny i harmonogram, który one przesuwają. Odwróć jedną tutaj — nic się nie zapisze.'
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
				'Rozdziały i lekcje ułożone z katalogu, fiszki zrobione z jednego tygodnia i zaświadczenie, które kurs może wydać — a które nie jest oceną.'
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
				'Sesja z programu, którą można zabrać do domu jako fiszki, i kursy, z którymi wydarzenie spotyka się przez organizację prowadzącą jedno i drugie.'
			)
	},
	{
		slug: 'contests',
		titleFor: (l) =>
			pick(l, 'Contests, and what a prize brings', 'Konkursy i to, co przynosi nagroda'),
		blurbFor: (l) =>
			pick(
				l,
				'A jury, stages and a published ranking — and the Polish law that a promised prize turns on, with every citation saying how well it was checked.',
				'Jury, etapy i publikowany ranking — oraz polskie prawo, które włącza przyrzeczona nagroda, z informacją przy każdym powołaniu, jak dobrze zostało sprawdzone.'
			)
	},
	{
		slug: 'goals-and-work',
		titleFor: (l) =>
			pick(l, 'Goals, plans and the work behind them', 'Cele, plany i praca za nimi'),
		blurbFor: (l) =>
			pick(
				l,
				'A goal with its definition of done, plans and tasks that serve it, help wanted, polls with a written decision — and one page listing everything waiting on you.',
				'Cel z definicją ukończenia, plany i zadania, które mu służą, prośby o pomoc, głosowania z zapisaną decyzją — i jedna strona ze wszystkim, co czeka na ciebie.'
			)
	},
	{
		slug: 'tutoring',
		titleFor: (l) => pick(l, 'Tutoring you can book', 'Korepetycje z rezerwacją'),
		blurbFor: (l) =>
			pick(
				l,
				'A listing, the hours a tutor publishes, and a booking that is a request until the tutor confirms it. No money passes through EdMat.',
				'Ogłoszenie, godziny, które publikuje korepetytor, i rezerwacja, która jest prośbą, dopóki korepetytor jej nie potwierdzi. Przez EdMat nie przechodzą żadne pieniądze.'
			)
	},
	{
		slug: 'materials',
		titleFor: (l) => pick(l, 'Materials, co-authored', 'Materiały pisane wspólnie'),
		blurbFor: (l) =>
			pick(
				l,
				'A material with what it covers, a team that publishes it version by version, files attached to the work around it, and the licence each one carries.',
				'Materiał z tym, co omawia, zespół, który publikuje go wersja po wersji, pliki dołączone do pracy wokół niego i licencja, którą ma każdy z nich.'
			)
	},
	{
		slug: 'conference',
		titleFor: (l) => pick(l, 'Running a conference', 'Prowadzenie konferencji'),
		blurbFor: (l) =>
			pick(
				l,
				'A building and its rooms, documents by who may read them, tickets scanned at the door, a volunteer rota and a cloakroom desk — on an invented demo conference.',
				'Budynek i jego sale, dokumenty według tego, kto może je czytać, bilety skanowane przy wejściu, grafik wolontariuszy i szatnia — na wymyślonej konferencji demonstracyjnej.'
			)
	},
	// WP6 (2026-10-15).
	{
		slug: 'account',
		titleFor: (l) => pick(l, 'Your account', 'Twoje konto'),
		blurbFor: (l) =>
			pick(
				l,
				'Opening an account and the age check, accounts a guardian runs for a child, signing in with a provider, e-mail and passwords — and downloading your data or deleting the account.',
				'Zakładanie konta i sprawdzenie wieku, konta prowadzone przez opiekuna dla dziecka, logowanie przez dostawcę, e-mail i hasło — oraz pobranie swoich danych albo usunięcie konta.'
			)
	},
	{
		slug: 'licences-and-data',
		titleFor: (l) => pick(l, 'Licences, and what EdMat counts', 'Licencje i to, co EdMat liczy'),
		blurbFor: (l) =>
			pick(
				l,
				'Why CC BY 4.0 is suggested for your own work, what the other licences allow, and the statistics EdMat keeps without placing anything in your browser.',
				'Dlaczego dla własnej pracy sugerujemy CC BY 4.0, na co pozwalają inne licencje i jakie statystyki EdMat prowadzi bez umieszczania czegokolwiek w twojej przeglądarce.'
			)
	}
];
