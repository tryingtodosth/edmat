/**
 * `/about/schools` — what a school is on EdMat, and where the full register lives instead.
 *
 * There is NO data link between this site and the school-management demonstration at `/dziennik`,
 * by owner decision (HISTORY.md §17BO): that demonstration is a recorded snapshot with no server
 * behind it, roles chosen rather than authenticated, and it must stay that way. The link between
 * the two is by example only, which is exactly what this page is for — so the one link out of it
 * is a plain `<a href="/dziennik/" rel="external">`, like the footer's, and it is gated on the
 * `school_demo` flag the same way.
 *
 * **The school is invented and its name says so.** An earlier draft used a real Warsaw secondary
 * school, which put named pupils and named guardians on a page claiming — inside a sample frame,
 * but still — that that school teaches here. The university on `/about/learning-record` stays real,
 * because it is this site's own provenance (`content/about.ts` already names it); a school with a
 * roster of children is not the place to borrow a real institution's name.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseDoc, ShowcaseRow } from './index';

/** One line of a class roster, as a teacher of a school course sees it. */
export interface ShowcaseRosterRow {
	pupil: string;
	guardian: string;
	progress: string;
}

export interface SchoolsShowcase extends ShowcaseDoc {
	orgHeading: string;
	org: { name: string; kind: string; place: string; summary: string; runs: string };
	orgCaption: string;
	classesHeading: string;
	classes: ShowcaseRow[];
	classesCaption: string;
	rosterHeading: string;
	rosterBody: string[];
	rosterColumns: { pupil: string; guardian: string; progress: string };
	roster: ShowcaseRosterRow[];
	rosterCaption: string;
	demoHeading: string;
	demoBody: string[];
	demoLinkLabel: string;
	demoLimits: string[];
	/** The link out, to the real organisations hub. */
	organizationsLinkLabel: string;
}

const EN: SchoolsShowcase = {
	title: 'A school on EdMat',
	description:
		'A school here is an organisation whose courses are classes, with guardians on the roster and staff who can see how everybody is getting on. The full school register is a separate demonstration.',
	lead: [
		'EdMat has no “school” model, and deliberately does not get one. A school is an organisation — the same thing a faculty, a student circle or an NGO is — whose kind happens to be “school”, and whose courses are its classes. Everything a class needs already exists: a roster, chapters and lessons, progress statements, a discussion, somebody who runs it.',
		'What being a school changes is who may see what. Pupils may be children, which means guardians; a teacher of a class needs to see how each pupil is getting on, which an ordinary course leaves to the course’s own setting. School mode is those two differences and nothing else.'
	],
	points: [
		{
			heading: 'A class is a course run by a school',
			body: 'There is no second kind of course and no new model. Asking “is this a class?” means asking whether an organisation of kind school runs it — one link, which the organisations layer already had.'
		},
		{
			heading: 'Children use EdMat through a guardian',
			body: 'Under sixteen, an account is created and held by a guardian. The roster shows a pupil’s guardian to the class’s staff, so a teacher knows who to write to, and to nobody else.'
		},
		{
			heading: 'Staff of a class see every pupil’s statements',
			body: 'An ordinary course decides for itself who sees progress, including the option of blinding its own staff. A class does not get that option: a teacher responsible for children can see how they say they are getting on.'
		},
		{
			heading: 'No marks',
			body: 'A class can issue a record of completion, which is not a grade. EdMat holds no gradebook, so a school that needs one needs a school register — and that is the next section.'
		}
	],
	orgHeading: 'The organisation',
	org: {
		name: 'Hilbert Secondary School',
		kind: 'School',
		place: 'Warsaw',
		summary:
			'A secondary school running two mathematics classes on EdMat, with the exercise sheets the teachers already used in print.',
		runs: 'Runs 2 courses · 1 event'
	},
	orgCaption:
		'An organisation page as it exists today: who it is, what it runs, and what it stands behind. The kind is one field; “school” is one of six values it can take.',
	classesHeading: 'Its classes',
	classes: [
		{ label: 'Class', title: 'Mathematics, 2B — extended', note: '26 pupils · running' },
		{ label: 'Class', title: 'Mathematics, 3A — matura preparation', note: '22 pupils · running' }
	],
	classesCaption:
		'Two courses, listed as the school’s own. From the inside they are ordinary courses: chapters, lessons, exercises from the catalogue.',
	rosterHeading: 'A roster, as the class teacher sees it',
	rosterBody: [
		'The guardian column appears for the staff of a school’s course and for nobody else. It is there for one practical reason — a teacher who needs to say that a pupil has stopped handing anything in has to know whom to tell — and it carries no more than the name.',
		'The progress column is the pupils’ own statements, which is both less and more honest than a mark: less, because nobody checked; more, because it says what the pupil thinks rather than what a test caught them on one morning.'
	],
	rosterColumns: { pupil: 'Pupil', guardian: 'Guardian', progress: 'Lessons marked done' },
	roster: [
		{ pupil: 'Marta Kowalska', guardian: 'Ewa Kowalska', progress: '12 of 12' },
		{ pupil: 'Jan Nowak', guardian: 'Piotr Nowak', progress: '9 of 12' },
		{ pupil: 'Zofia Wiśniewska', guardian: 'Anna Wiśniewska', progress: '12 of 12' },
		{ pupil: 'Tomasz Zieliński', guardian: 'Maria Zielińska', progress: '4 of 12' }
	],
	rosterCaption:
		'Four of twenty-six. A completion can be issued to the two whose own statements say they are done, and the teacher is refused for the other two, with the reason on screen.',
	demoHeading: 'The full register is somewhere else',
	demoBody: [
		'A school needs much more than a class on EdMat: a timetable, attendance, marks, a head teacher’s view, a parent’s view, messages home. That is a different product, and one of them is published on this site as a demonstration — the same data a real school logbook holds, recorded once and served as a page.',
		'It is a recording, not a running system. The roles are chosen rather than signed into, nothing can be saved, and the published files contain exactly one outbound call: reporting a problem back to EdMat. That is what makes it safe to put on a public site, and it is also what it cannot do.'
	],
	demoLinkLabel: 'Open the school logbook demonstration',
	organizationsLinkLabel: 'Browse the organisations',
	demoLimits: [
		'Nothing saves. Pressing “add a grade” says so rather than pretending.',
		'A role is picked from a list; there is no password and nothing to steal.',
		'The data is one recorded snapshot of one invented school, frozen on one date.',
		'There is no connection between it and anything on EdMat — not a link, not an account, not a row.'
	],
	closing:
		'So: a school can teach on EdMat today, with classes, guardians and the whole catalogue behind it. What it cannot do here is keep its official register, and the demonstration is how to see what that would look like instead of guessing.',
	tryIt: [
		{ label: 'Browse the organisations', route: '/organizations' },
		{ label: 'Browse the courses', route: '/courses' }
	]
};

const PL: SchoolsShowcase = {
	title: 'Szkoła w EdMacie',
	description:
		'Szkoła jest tutaj organizacją, której kursy są klasami, z opiekunami na liście uczestników i prowadzącymi, którzy widzą, jak każdemu idzie. Pełny dziennik szkolny to osobne demo.',
	lead: [
		'EdMat nie ma modelu „szkoła” i celowo go nie dostanie. Szkoła jest organizacją — tym samym, czym wydział, koło naukowe albo stowarzyszenie — której rodzaj to „szkoła”, a której kursy są jej klasami. Wszystko, czego klasa potrzebuje, już istnieje: lista uczestników, rozdziały i lekcje, oświadczenia o postępie, dyskusja, ktoś, kto to prowadzi.',
		'To, co zmienia bycie szkołą, to kto co widzi. Uczniowie mogą być dziećmi, a to znaczy opiekunowie; nauczyciel klasy musi widzieć, jak idzie każdemu uczniowi, co zwykły kurs zostawia własnemu ustawieniu. Tryb szkolny to te dwie różnice i nic więcej.'
	],
	points: [
		{
			heading: 'Klasa to kurs prowadzony przez szkołę',
			body: 'Nie ma drugiego rodzaju kursu ani nowego modelu. Pytanie „czy to klasa?” znaczy pytanie, czy prowadzi go organizacja rodzaju szkoła — jedno powiązanie, które warstwa organizacji już miała.'
		},
		{
			heading: 'Dzieci korzystają z EdMatu przez opiekuna',
			body: 'Poniżej szesnastu lat konto zakłada i prowadzi opiekun. Lista uczestników pokazuje opiekuna ucznia prowadzącym klasy, żeby nauczyciel wiedział, do kogo napisać — i nikomu więcej.'
		},
		{
			heading: 'Prowadzący klasę widzą oświadczenia każdego ucznia',
			body: 'Zwykły kurs sam decyduje, kto widzi postęp, włącznie z możliwością zaślepienia własnych prowadzących. Klasa tej możliwości nie dostaje: nauczyciel odpowiadający za dzieci widzi, jak według nich samych im idzie.'
		},
		{
			heading: 'Żadnych stopni',
			body: 'Klasa może wydać zapis ukończenia, który nie jest oceną. EdMat nie prowadzi dziennika ocen, więc szkoła, która go potrzebuje, potrzebuje dziennika szkolnego — i o tym jest następna sekcja.'
		}
	],
	orgHeading: 'Organizacja',
	org: {
		name: 'Liceum Ogólnokształcące im. Davida Hilberta',
		kind: 'Szkoła',
		place: 'Warszawa',
		summary:
			'Liceum prowadzące w EdMacie dwie klasy matematyczne, z listami zadań, których nauczyciele używali już na papierze.',
		runs: 'Prowadzi 2 kursy · 1 wydarzenie'
	},
	orgCaption:
		'Strona organizacji taka, jaka już istnieje: kto to jest, co prowadzi i za czym stoi. Rodzaj to jedno pole; „szkoła” jest jedną z sześciu jego wartości.',
	classesHeading: 'Jej klasy',
	classes: [
		{ label: 'Klasa', title: 'Matematyka, 2B — rozszerzona', note: '26 uczniów · w toku' },
		{
			label: 'Klasa',
			title: 'Matematyka, 3A — przygotowanie do matury',
			note: '22 uczniów · w toku'
		}
	],
	classesCaption:
		'Dwa kursy wypisane jako własne szkoły. Od wewnątrz są zwykłymi kursami: rozdziały, lekcje, zadania z katalogu.',
	rosterHeading: 'Lista uczestników widziana przez wychowawcę',
	rosterBody: [
		'Kolumna z opiekunem pojawia się dla prowadzących kurs szkoły i dla nikogo więcej. Jest z jednego praktycznego powodu — nauczyciel, który musi powiedzieć, że uczeń przestał cokolwiek oddawać, musi wiedzieć, komu — i nie zawiera nic poza nazwiskiem.',
		'Kolumna postępu to własne oświadczenia uczniów, co jest jednocześnie mniej i bardziej uczciwe niż stopień: mniej, bo nikt tego nie sprawdził; bardziej, bo mówi, co uczeń o sobie sądzi, a nie na czym go złapał sprawdzian jednego poranka.'
	],
	rosterColumns: {
		pupil: 'Uczeń',
		guardian: 'Opiekun',
		progress: 'Lekcje oznaczone jako zrobione'
	},
	roster: [
		{ pupil: 'Marta Kowalska', guardian: 'Ewa Kowalska', progress: '12 z 12' },
		{ pupil: 'Jan Nowak', guardian: 'Piotr Nowak', progress: '9 z 12' },
		{ pupil: 'Zofia Wiśniewska', guardian: 'Anna Wiśniewska', progress: '12 z 12' },
		{ pupil: 'Tomasz Zieliński', guardian: 'Maria Zielińska', progress: '4 z 12' }
	],
	rosterCaption:
		'Czworo z dwudziestu sześciu. Zaświadczenie można wydać dwóm osobom, których oświadczenia mówią, że skończyły; przy dwóch pozostałych nauczyciel dostaje odmowę z powodem na ekranie.',
	demoHeading: 'Pełny dziennik jest gdzie indziej',
	demoBody: [
		'Szkoła potrzebuje znacznie więcej niż klasy w EdMacie: planu lekcji, frekwencji, ocen, widoku dyrektora, widoku rodzica, wiadomości do domu. To inny produkt — i jeden taki jest na tej stronie opublikowany jako demonstracja: te same dane, które trzyma prawdziwy dziennik szkolny, nagrane raz i podane jako strona.',
		'To nagranie, nie działający system. Rolę się wybiera, a nie loguje, nic nie da się zapisać, a opublikowane pliki zawierają dokładnie jedno wyjście na sieć: zgłoszenie problemu z powrotem do EdMatu. To właśnie czyni je bezpiecznymi na publicznej stronie — i to samo jest tym, czego nie potrafią.'
	],
	demoLinkLabel: 'Otwórz demonstrację dziennika szkolnego',
	organizationsLinkLabel: 'Przeglądaj organizacje',
	demoLimits: [
		'Nic się nie zapisuje. Naciśnięcie „dodaj ocenę” mówi to wprost, zamiast udawać.',
		'Rolę wybiera się z listy; nie ma hasła i nie ma czego ukraść.',
		'Dane to jedna nagrana migawka jednej wymyślonej szkoły, zatrzymana na jednej dacie.',
		'Nie ma żadnego połączenia między nią a czymkolwiek w EdMacie — ani linku, ani konta, ani wiersza w bazie.'
	],
	closing:
		'Czyli: szkoła może dziś uczyć w EdMacie, z klasami, opiekunami i całym katalogiem za plecami. Czego nie może, to prowadzić tutaj swojego urzędowego dziennika — a demonstracja jest sposobem, by zobaczyć, jak to by wyglądało, zamiast zgadywać.',
	tryIt: [
		{ label: 'Przeglądaj organizacje', route: '/organizations' },
		{ label: 'Przeglądaj kursy', route: '/courses' }
	]
};

export function schoolsShowcaseFor(locale: string): SchoolsShowcase {
	return locale === 'pl' ? PL : EN;
}
