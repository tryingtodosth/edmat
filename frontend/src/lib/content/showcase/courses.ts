/**
 * `/about/courses` — chapters and lessons built out of the catalogue, a week turned into a deck,
 * and the completion a course can issue.
 *
 * `CourseCard` and `MaterialCard` are the real components with real sample objects, so the card a
 * reader sees here is the card the courses hub draws. The certificate is a twin
 * (`components/showcase/CertificateSample.svelte`) because the real one is a print page for one
 * row that does not exist here — and because the only thing worth showing about it is what it says
 * and what it refuses to say.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { Material } from '$lib/types';
import type { Course } from '$lib/types/course';
import type { ShowcaseDeck, ShowcaseDoc, ShowcaseRow } from './index';

/** What a printed completion carries. No grade, no mark, no rank — that is the point of it. */
export interface ShowcaseCertificate {
	heading: string;
	courseTitle: string;
	organisation: string;
	holderLabel: string;
	holder: string;
	issuerLabel: string;
	issuer: string;
	periodLabel: string;
	period: string;
	issuedLabel: string;
	issuedOn: string;
	basisLabel: string;
	basis: string;
	disclaimer: string;
}

export interface CoursesShowcase extends ShowcaseDoc {
	cardHeading: string;
	course: Course;
	cardCaption: string;
	runByLine: string;
	structureHeading: string;
	chapterName: string;
	lessonName: string;
	lessonRows: ShowcaseRow[];
	structureCaption: string;
	materialHeading: string;
	material: Material;
	materialCaption: string;
	deckHeading: string;
	deckBody: string[];
	deck: ShowcaseDeck;
	deckCaption: string;
	certificateHeading: string;
	certificateBody: string[];
	certificate: ShowcaseCertificate;
	certificateCaption: string;
	/** The link out, to the real courses hub. */
	coursesLinkLabel: string;
}

function courseBase(): Omit<Course, 'title' | 'summary' | 'instructor' | 'language'> {
	return {
		id: '9100',
		// `school` arrived with learning step C (a course a school runs is a class); the sample is a
		// society's course, so none. Added at integration, 2026-10-05.
		school: null,
		// The course kind and the general/version shape (2026-10-14). The sample is a top-level
		// general course, so none of the university fields.
		kind: 'topic',
		parent: null,
		parentSummary: null,
		university: '',
		faculty: '',
		courseCode: '',
		currentTerm: '',
		description: '',
		subjectSlugs: ['uw-mat-analiza-i'],
		fieldSlug: 'uw-matematyka',
		visibility: 'public',
		status: 'running',
		enrollmentPolicy: 'approval',
		capacity: 24,
		discussionMode: 'participants',
		announceNewLessons: true,
		announceNewPosts: false,
		progressVisibility: 'shared_named',
		audience: 'university',
		startsOn: '2026-02-23',
		endsOn: '2026-06-12',
		price: null,
		currency: 'PLN',
		createdAt: '2026-01-30T10:00:00Z',
		lessons: [],
		participantCount: 18,
		seatsLeft: 6,
		isFull: false,
		myEnrollmentStatus: null,
		canEnrol: false,
		enrollmentBlockReason: null,
		isInstructor: false,
		canReadDiscussion: false,
		canPostDiscussion: false,
		notifyMe: null,
		contributionPolicy: 'approval',
		myRole: null,
		canAdminister: false,
		canCurate: false,
		canContribute: false,
		contributionNeedsApproval: true,
		chapters: [],
		unfiledItems: [],
		pendingContributionCount: 0
	};
}

function materialBase(): Omit<Material, 'title' | 'description' | 'author' | 'coverage'> {
	return {
		id: '9200',
		branchId: 'uw-mat-analiza-i',
		slug: 'notes-continuity',
		type: 'script',
		audience: 'university',
		licence: 'cc-by-sa-4.0',
		requirements: [],
		fileName: 'continuity.pdf',
		fileUrl: '',
		tags: [],
		published: true,
		featured: false,
		order: 0,
		averageRating: 4.8,
		reviewCount: 6,
		createdAt: '2026-03-02T08:00:00Z',
		priceCurrency: 'PLN',
		estimatedMinutes: 45
	};
}

const NO_VOTES = {
	agreeCount: 0,
	disagreeCount: 0,
	agreeWeight: 0,
	disagreeWeight: 0,
	netWeight: 0
};

const EN: CoursesShowcase = {
	title: 'A course, a week, a certificate',
	description:
		'How a course on EdMat is built out of exercises and materials that already exist, how one week of it becomes a deck of flashcards, and what the completion a course can issue does and does not say.',
	lead: [
		'A course is somebody teaching, not a folder of files. It has chapters and, inside them, lessons; a lesson points at exercises, materials, an event or a discussion that already answered this week’s question. Nothing is uploaded twice — a lesson references the catalogue, so the same material can be taught in six courses and corrected once.',
		'The course is the unit of teaching here. That is why what a course can hand somebody at the end is a record of having taken part, and not a mark.'
	],
	points: [
		{
			heading: 'A week can become a deck in one press',
			body: 'Every exercise a lesson points at, and every exercise in the sets linked to it, go into a deck placed on the course. Which exercises went in is fixed at that moment; the exercises themselves stay live.'
		},
		{
			heading: 'Progress is a statement, never a measurement',
			body: '“Done” on a lesson is a button a participant pressed. The course decides who may see it, and one of the options blinds its own staff — deliberately, because some courses should not be watching.'
		},
		{
			heading: 'A completion is issued by hand',
			body: 'Staff issue it, to somebody whose own statements say every lesson is done, and it records that basis in its own text. Nothing is ever issued automatically, and nothing is issued to somebody who did not say they had finished.'
		},
		{
			heading: 'It is not a grade, and it says so',
			body: 'No mark, no rank, no percentage, no signature. EdMat has no gradebook and is not getting one: it can say somebody took part and what they said they did, which is exactly as much as it honestly knows.'
		}
	],
	cardHeading: 'A course as the hub lists it',
	course: {
		...courseBase(),
		title: 'Analysis I, spring group',
		summary:
			'Weekly problem sessions following the lecture, with the exercise sheets and a short deck of cards for each week.',
		instructor: { id: '501', displayName: 'Dr Anna Lewandowska' },
		language: 'en'
	},
	cardCaption:
		'An uncapped course says how many people are in it; a capped one counts down. “Approval” means the instructor decides on each request.',
	runByLine: 'Run by the Faculty of Mathematics, Informatics and Mechanics',
	structureHeading: 'One week of it',
	chapterName: 'Chapter 2 — continuity',
	lessonName: 'Week 4: continuity and the intermediate value theorem',
	lessonRows: [
		{ label: 'Material', title: 'Lecture notes: continuity', note: 'script, 45 min' },
		{ label: 'Set', title: 'Sheet 4 — continuity', note: '8 exercises' },
		{ label: 'Exercise', title: 'A root that tends to one', note: 'hard' },
		{ label: 'Discussion', title: 'Where does uniform continuity fail?', note: '11 replies' }
	],
	structureCaption:
		'A lesson’s items, each exactly one kind of thing. The set is a snapshot of somebody’s own exercise set, pinned when it was linked.',
	materialHeading: 'One of those items, in full',
	material: {
		...materialBase(),
		title: 'Lecture notes: continuity',
		description:
			'Twelve pages following the lecture, with the two proofs that were only sketched in the hall written out.',
		author: 'Dr Anna Lewandowska',
		coverage: [
			{
				id: '9301',
				ownerKind: 'material',
				ownerId: '9200',
				kind: 'covers',
				topicId: 'continuity',
				topicName: 'Continuity',
				level: 80,
				createdAt: '2026-03-02T08:00:00Z',
				voteSummary: { ...NO_VOTES, agreeCount: 4, agreeWeight: 5, netWeight: 5 },
				importanceSummary: { ...NO_VOTES },
				commentCount: 0
			},
			{
				id: '9302',
				ownerKind: 'material',
				ownerId: '9200',
				kind: 'requires',
				topicId: 'limits',
				topicName: 'Limits of sequences',
				level: 40,
				createdAt: '2026-03-02T08:00:00Z',
				voteSummary: { ...NO_VOTES, agreeCount: 2, agreeWeight: 2, netWeight: 2 },
				importanceSummary: { ...NO_VOTES },
				commentCount: 0
			}
		]
	},
	materialCaption:
		'A material carries claims about itself: what it covers, and what you should already know. Both are proposed by readers and corrected by their votes, so “covers continuity” is a community reading rather than the uploader’s word.',
	deckHeading: 'Make a deck from this week',
	deckBody: [
		'The button sits beside the lesson and is there for everybody in the course, not only its staff. A participant gets a deck of their own; a member of staff gets one placed on the course, so everybody who can see the course can study it.',
		'The exercises come from the lesson’s own exercise items and from every set linked to it, in order, skipping anything the person pressing the button is not allowed to see.'
	],
	deck: {
		name: 'Week 4: continuity',
		cardCount: 12,
		dueCount: 12,
		source: 'lesson',
		placedOn: { kind: 'course', name: 'Analysis I, spring group' },
		isPublic: false
	},
	deckCaption:
		'Nine exercises from the linked sheet and three from the lesson itself, as twelve cards placed on the course.',
	certificateHeading: 'And a completion, at the end',
	certificateBody: [
		'A course’s staff may issue a completion to a participant whose own progress statements say every lesson is done. It prints from the browser, in both languages, unsigned — the same posture the volunteer-hours certificate already takes, because an unsigned honest document is worth more than a signed one nobody can check.',
		'It carries its own basis in its text: how many lessons of how many, and that the source is the participant’s own statements. Anybody reading it can therefore tell exactly what it is evidence of.'
	],
	certificate: {
		heading: 'Record of completion',
		courseTitle: 'Analysis I, spring group',
		organisation: 'Faculty of Mathematics, Informatics and Mechanics',
		holderLabel: 'Issued to',
		holder: 'Marta Kowalska',
		issuerLabel: 'Issued by',
		issuer: 'Dr Anna Lewandowska, course owner',
		periodLabel: 'Course ran',
		period: '23 February – 12 June 2026',
		issuedLabel: 'Issued on',
		issuedOn: '15 June 2026',
		basisLabel: 'Basis',
		basis: '12 of 12 lessons, by the participant’s own statements',
		disclaimer:
			'This records participation in a course run on EdMat. It is not a grade, a mark or a qualification, and EdMat has not examined anybody.'
	},
	coursesLinkLabel: 'Browse the courses people run',
	certificateCaption:
		'The whole document. Everything it does not say is as deliberate as everything it does.',
	closing:
		'A gradebook, a guardian’s signature on a completion and a class timetable are all left out on purpose. The school half of this — a course run by a school, with guardians on its roster — has its own page.',
	tryIt: [
		{ label: 'Browse the courses', route: '/courses' },
		{ label: 'Your flashcard decks', route: '/flashcards' }
	],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/courses/03-content.png',
			focus: [248, 1032],
			width: 1280,
			height: 760,
			route: '/courses',
			alt: 'Screenshot of a course’s content as the person running it sees it: a chapter called “Program” with two lessons, “Ciągi i granice” and “Szeregi liczbowe”, each with a description, “Make a deck from this week”, “Link a saved set”, a progress bar reading “0 of 4 have finished this” and a folded discussion.',
			caption:
				'A course’s content, as the person running it sees it: lessons with how many have finished them, and “Make a deck from this week” on each.',
			linkLabel: 'Find a course'
		}
	]
};

const PL: CoursesShowcase = {
	title: 'Kurs, tydzień, zaświadczenie',
	description:
		'Jak kurs w EdMacie buduje się z zadań i materiałów, które już są, jak jeden jego tydzień staje się talią fiszek i co zaświadczenie wydawane przez kurs mówi, a czego nie mówi.',
	lead: [
		'Kurs to ktoś, kto uczy, a nie katalog plików. Ma rozdziały, a w nich lekcje; lekcja wskazuje na zadania, materiały, wydarzenie albo dyskusję, która już odpowiedziała na pytanie tego tygodnia. Nic nie jest wgrywane dwa razy — lekcja odsyła do katalogu, więc ten sam materiał może być uczony w sześciu kursach i poprawiony raz.',
		'Kurs jest tutaj jednostką nauczania. Właśnie dlatego to, co kurs może komuś wręczyć na koniec, jest zapisem udziału, a nie oceną.'
	],
	points: [
		{
			heading: 'Tydzień może stać się talią jednym naciśnięciem',
			body: 'Każde zadanie, na które wskazuje lekcja, i każde zadanie z zestawów do niej dołączonych wchodzi do talii położonej na kursie. To, które zadania weszły, jest ustalone w tej chwili; same zadania pozostają żywe.'
		},
		{
			heading: 'Postęp jest oświadczeniem, nie pomiarem',
			body: '„Zrobione” przy lekcji to przycisk, który wcisnął uczestnik. Kurs decyduje, kto to widzi, a jedna z opcji zaślepia także jego własnych prowadzących — celowo, bo niektóre kursy nie powinny patrzeć.'
		},
		{
			heading: 'Zaświadczenie wydaje się ręcznie',
			body: 'Wydają je prowadzący, komuś, czyje własne oświadczenia mówią, że wszystkie lekcje są zrobione, a podstawę zapisuje się w jego treści. Nic nie jest wydawane automatycznie i nic nie jest wydawane komuś, kto nie powiedział, że skończył.'
		},
		{
			heading: 'To nie jest ocena i tak jest napisane',
			body: 'Żadnego stopnia, miejsca w rankingu, procentu ani podpisu. EdMat nie ma dziennika ocen i nie będzie go mieć: może powiedzieć, że ktoś brał udział i co o sobie oświadczył — dokładnie tyle, ile uczciwie wie.'
		}
	],
	cardHeading: 'Kurs tak, jak wypisuje go lista',
	course: {
		...courseBase(),
		title: 'Analiza I, grupa wiosenna',
		summary:
			'Cotygodniowe ćwiczenia idące za wykładem, z listami zadań i krótką talią fiszek na każdy tydzień.',
		instructor: { id: '501', displayName: 'dr Anna Lewandowska' },
		language: 'pl'
	},
	cardCaption:
		'Kurs bez limitu mówi, ile osób w nim jest; kurs z limitem odlicza miejsca. „Za zgodą” znaczy, że prowadzący decyduje o każdym zgłoszeniu.',
	runByLine: 'Prowadzony przez Wydział Matematyki, Informatyki i Mechaniki',
	structureHeading: 'Jeden jego tydzień',
	chapterName: 'Rozdział 2 — ciągłość',
	lessonName: 'Tydzień 4: ciągłość i własność Darboux',
	lessonRows: [
		{ label: 'Materiał', title: 'Notatki z wykładu: ciągłość', note: 'skrypt, 45 min' },
		{ label: 'Zestaw', title: 'Lista 4 — ciągłość', note: '8 zadań' },
		{ label: 'Zadanie', title: 'Pierwiastek, który dąży do jedynki', note: 'trudne' },
		{ label: 'Dyskusja', title: 'Gdzie zawodzi ciągłość jednostajna?', note: '11 odpowiedzi' }
	],
	structureCaption:
		'Elementy lekcji, każdy dokładnie jednego rodzaju. Zestaw jest migawką czyjegoś własnego zestawu zadań, przypiętą w chwili dołączenia.',
	materialHeading: 'Jeden z tych elementów w całości',
	material: {
		...materialBase(),
		title: 'Notatki z wykładu: ciągłość',
		description:
			'Dwanaście stron idących za wykładem, z dwoma dowodami, które na sali były tylko naszkicowane, rozpisanymi w całości.',
		author: 'dr Anna Lewandowska',
		coverage: [
			{
				id: '9301',
				ownerKind: 'material',
				ownerId: '9200',
				kind: 'covers',
				topicId: 'continuity',
				topicName: 'Ciągłość',
				level: 80,
				createdAt: '2026-03-02T08:00:00Z',
				voteSummary: { ...NO_VOTES, agreeCount: 4, agreeWeight: 5, netWeight: 5 },
				importanceSummary: { ...NO_VOTES },
				commentCount: 0
			},
			{
				id: '9302',
				ownerKind: 'material',
				ownerId: '9200',
				kind: 'requires',
				topicId: 'limits',
				topicName: 'Granice ciągów',
				level: 40,
				createdAt: '2026-03-02T08:00:00Z',
				voteSummary: { ...NO_VOTES, agreeCount: 2, agreeWeight: 2, netWeight: 2 },
				importanceSummary: { ...NO_VOTES },
				commentCount: 0
			}
		]
	},
	materialCaption:
		'Materiał nosi deklaracje o sobie: co obejmuje i co trzeba już wiedzieć. Jedno i drugie proponują czytelnicy, a ich głosy to poprawiają — więc „obejmuje ciągłość” jest odczytem społeczności, a nie słowem wgrywającego.',
	deckHeading: 'Zrób talię z tego tygodnia',
	deckBody: [
		'Przycisk stoi przy lekcji i jest dla wszystkich w kursie, nie tylko dla prowadzących. Uczestnik dostaje własną talię; prowadzący dostaje talię położoną na kursie, więc każdy, kto widzi kurs, może się z niej uczyć.',
		'Zadania biorą się z własnych elementów-zadań lekcji i z każdego dołączonego do niej zestawu, po kolei, z pominięciem tego, czego osoba naciskająca przycisk nie ma prawa widzieć.'
	],
	deck: {
		name: 'Tydzień 4: ciągłość',
		cardCount: 12,
		dueCount: 12,
		source: 'lesson',
		placedOn: { kind: 'course', name: 'Analiza I, grupa wiosenna' },
		isPublic: false
	},
	deckCaption:
		'Dziewięć zadań z dołączonej listy i trzy z samej lekcji jako dwanaście fiszek położonych na kursie.',
	certificateHeading: 'A na koniec zaświadczenie',
	certificateBody: [
		'Prowadzący kursu mogą wydać zaświadczenie uczestnikowi, którego własne oświadczenia o postępie mówią, że wszystkie lekcje są zrobione. Drukuje się z przeglądarki, dwujęzycznie, bez podpisu — tak samo jak zaświadczenie o godzinach wolontariatu, bo niepodpisany uczciwy dokument jest wart więcej niż podpisany, którego nikt nie może sprawdzić.',
		'Nosi w treści własną podstawę: ile lekcji z ilu i że źródłem są oświadczenia uczestnika. Każdy, kto to czyta, może więc dokładnie powiedzieć, czego to jest dowodem.'
	],
	certificate: {
		heading: 'Zapis ukończenia',
		courseTitle: 'Analiza I, grupa wiosenna',
		organisation: 'Wydział Matematyki, Informatyki i Mechaniki',
		holderLabel: 'Wydane dla',
		holder: 'Marta Kowalska',
		issuerLabel: 'Wydał',
		issuer: 'dr Anna Lewandowska, właścicielka kursu',
		periodLabel: 'Kurs trwał',
		period: '23 lutego – 12 czerwca 2026',
		issuedLabel: 'Data wydania',
		issuedOn: '15 czerwca 2026',
		basisLabel: 'Podstawa',
		basis: '12 z 12 lekcji, według własnych oświadczeń uczestniczki',
		disclaimer:
			'Ten dokument zapisuje udział w kursie prowadzonym w EdMacie. Nie jest oceną, stopniem ani kwalifikacją, a EdMat nikogo nie egzaminował.'
	},
	coursesLinkLabel: 'Przeglądaj kursy prowadzone przez użytkowników',
	certificateCaption:
		'Cały dokument. Wszystko, czego nie mówi, jest tak samo celowe jak wszystko, co mówi.',
	closing:
		'Dziennik ocen, podpis opiekuna na zaświadczeniu i plan lekcji celowo zostały pominięte. Szkolna połowa tego — kurs prowadzony przez szkołę, z opiekunami na liście uczestników — ma własną stronę.',
	tryIt: [
		{ label: 'Przeglądaj kursy', route: '/courses' },
		{ label: 'Twoje talie fiszek', route: '/flashcards' }
	],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/courses/03-content.png',
			focus: [248, 1032],
			width: 1280,
			height: 760,
			route: '/courses',
			alt: 'Zrzut ekranu treści kursu oczami osoby, która go prowadzi: rozdział „Program” z dwiema lekcjami, „Ciągi i granice” i „Szeregi liczbowe”, każda z opisem, przyciskami „Make a deck from this week” i „Link a saved set”, paskiem postępu „0 of 4 have finished this” i zwiniętą dyskusją.',
			caption:
				'Treść kursu oczami prowadzącej osoby: lekcje z liczbą osób, które je skończyły, i „zrób talię z tego tygodnia” przy każdej.',
			linkLabel: 'Znajdź kurs'
		}
	]
};

export function coursesShowcaseFor(locale: string): CoursesShowcase {
	return locale === 'pl' ? PL : EN;
}
