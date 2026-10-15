/**
 * `/about/events` — the deck a session leaves behind, and how an event meets a course.
 *
 * `EventCard` and `CourseCard` are the real components with real sample objects. The programme and
 * the "run by" line are drawn with the showcase's own row component, because on a real event page
 * they come from two endpoints.
 *
 * The second half of this page exists to say what is NOT built: there is no link from an event to a
 * course and there never will be one. Both hang off the organisation that runs them, which is the
 * hub rule (`prompts/00-DESIGN.md` §1 rule 1) — "this conference's workshops became these courses"
 * is a true sentence about an organisation, not about an event.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { EdmatEvent } from '$lib/types/event';
import type { Course } from '$lib/types/course';
import type { ShowcaseDeck, ShowcaseDoc, ShowcaseRow } from './index';

export interface EventsShowcase extends ShowcaseDoc {
	cardHeading: string;
	event: EdmatEvent;
	cardCaption: string;
	programmeHeading: string;
	trackName: string;
	sessionName: string;
	sessionTime: string;
	sessionRows: ShowcaseRow[];
	programmeCaption: string;
	takeHomeHeading: string;
	takeHomeBody: string[];
	deck: ShowcaseDeck;
	takeHomeCaption: string;
	crossHeading: string;
	crossBody: string[];
	runByLabel: string;
	runBy: string[];
	relatedCourse: Course;
	crossCaption: string;
	/** The link out, to the real events hub. */
	eventsLinkLabel: string;
}

const EN: EventsShowcase = {
	title: 'What an event leaves behind',
	description:
		'How one session of an event’s programme becomes a deck of flashcards placed on the event, and how an event and a course meet — through the organisation that runs both, never directly.',
	lead: [
		'An event happens once. That is the whole difference between it and a course, and it is why everything about an event is built around a day rather than a term: a programme with tracks and sessions, registration, tickets at the door, a rota of volunteers, somewhere to put the organisers’ documents.',
		'The problem with happening once is that afterwards there is nothing to go back to. A session that linked three exercises and a sheet has them in its programme entry and nowhere else. This cycle adds the one thing that fixes that: you can take the session home.'
	],
	points: [
		{
			heading: 'Take home gathers what the session pointed at',
			body: 'Every exercise the session links to, and every exercise in the sets it links to, in order. Nothing is invented and nothing is copied — the deck references the same rows the programme did.'
		},
		{
			heading: 'An organiser’s deck goes on the event; a visitor’s is their own',
			body: 'Press it as an organiser and the deck is placed on the event, where everybody who can see the event can study it. Press it as somebody who attended and you get a deck of your own.'
		},
		{
			heading: 'A set linked to a session is readable through it',
			body: 'Even a private set, because the organiser chose to put it on the programme. That is a deliberate widening, written down where the endpoint is defined rather than left to be discovered.'
		},
		{
			heading: 'Events and courses meet at the organisation, not at each other',
			body: 'There is no field on an event naming a course and none on a course naming an event. Both say who runs them, and the answer to “what else do these people do?” comes from asking that organisation.'
		}
	],
	cardHeading: 'An event as the hub lists it',
	event: {
		id: '9500',
		host: { id: '502', displayName: 'Students’ Mathematical Society' },
		title: 'Spring Workshop on Analysis',
		summary:
			'One Saturday, four tracks, and the exercise sheets the speakers actually used. Open to anybody from the second year up.',
		description: '',
		subjectSlugs: ['uw-mat-analiza-i'],
		disciplineSlug: 'uw-matematyka',
		status: 'published',
		visibility: 'public',
		startsAt: '2026-04-18T09:00:00Z',
		eventTime: null,
		endsAt: '2026-04-18T17:00:00Z',
		durationMinutes: 480,
		locationKind: 'onsite',
		locationText: 'Banacha 2, Warsaw',
		onlineUrl: '',
		capacity: 120,
		language: 'en',
		audience: 'university',
		runsUntil: null,
		goingCount: 86,
		declinedCount: 0,
		postCount: 2,
		seatsLeft: 34,
		isFull: false,
		isPast: false,
		myAttendance: null,
		isHost: false,
		canOrganise: false,
		canCheckIn: false,
		registrationMode: 'rsvp',
		showAttendeesPublicly: true,
		registrationFields: [],
		waitlistCount: 0,
		pendingCount: 0,
		myRegistration: null,
		myWaitlistPosition: null,
		cfpOpen: false,
		cfpDeadline: null,
		callIsOpen: false,
		contributionCounts: { accepted: 7 },
		canRespond: true,
		responseBlockReason: null,
		parent: null,
		subEvents: [],
		createdAt: '2026-02-01T10:00:00Z'
	},
	cardCaption:
		'The card leads with the date, unlike every other card in this app. It is the one fact that decides whether the rest is worth reading.',
	programmeHeading: 'One session of its programme',
	trackName: 'Track B — problem sessions',
	sessionName: 'Sequences and series, from the ground up',
	sessionTime: 'Saturday 11:15 – 12:45 · Room 3120',
	sessionRows: [
		{ label: 'Set', title: 'Workshop sheet B2', note: '10 exercises' },
		{ label: 'Exercise', title: 'Limit of a rational sequence', note: 'medium' },
		{ label: 'Material', title: 'Slides: three convergence tests', note: 'lecture slides' },
		{ label: 'Link', title: 'The speaker’s own notes', note: 'external' }
	],
	programmeCaption:
		'A session’s links, each exactly one kind of thing. Two of these four hold exercises, which is what the take-home button collects.',
	takeHomeHeading: 'Take it home',
	takeHomeBody: [
		'The button sits beside the session, and it appears only for a session that actually links at least one exercise — a button that would make an empty deck is worse than no button.',
		'What it makes is a deck of eleven cards: the ten exercises of the linked sheet and the one linked directly. The sheet’s membership is pinned at that moment; the exercises stay live, so a solution corrected in June reaches a card made in April.'
	],
	deck: {
		name: 'Sequences and series, from the ground up',
		cardCount: 11,
		dueCount: 11,
		source: 'session',
		placedOn: { kind: 'event', name: 'Spring Workshop on Analysis' },
		isPublic: false
	},
	takeHomeCaption:
		'The deck an organiser’s press makes, placed on the event. Three weeks later it is the only part of that ninety minutes anybody can still revise from.',
	crossHeading: 'And what the event leads to',
	crossBody: [
		'An event page says who runs it, and under that it lists the courses those same people run. That is the whole of the link between the two: “this workshop’s problem sessions became a course that meets every week” is a fact about the society that did both, so it is read off the society.',
		'Doing it the other way — a field on the event pointing at a course — would be a fourth way of saying the same thing and a fourth thing to keep in step. It would also be wrong as often as it was right, because the course that follows a workshop is usually run by somebody who spoke at it rather than by the workshop.'
	],
	runByLabel: 'Run by',
	runBy: ['Students’ Mathematical Society', 'Faculty of Mathematics, Informatics and Mechanics'],
	relatedCourse: {
		id: '9100',
		school: null, // learning step C's field; added at integration, 2026-10-05
		// The course kind and the general/version shape (2026-10-14). The sample is a top-level
		// general course, so none of the university fields.
		kind: 'topic',
		parent: null,
		parentSummary: null,
		university: '',
		faculty: '',
		courseCode: '',
		currentTerm: '',
		instructor: { id: '501', displayName: 'Dr Anna Lewandowska' },
		title: 'Analysis I, spring group',
		summary:
			'Weekly problem sessions following the lecture, with the exercise sheets and a short deck of cards for each week.',
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
		language: 'en',
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
	},
	eventsLinkLabel: 'Browse what is coming up',
	crossCaption:
		'One course, filtered by its own visibility: a private course run by the same society does not appear here just because somebody can see the event.',
	closing:
		'The mirror image — a course page listing the events its organisation has run — is not built yet, and is named here so that nobody assumes it is missing by accident. Nor is a take-home of a session’s materials: a deck holds exercises and concepts, not files.',
	tryIt: [{ label: 'See what is coming up', route: '/events' }],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/events/01-hub.png',
			focus: [98, 826],
			width: 1280,
			height: 480,
			route: '/events',
			alt: 'Screenshot of the Events page: a short explanation, Coming up and Already happened tabs, and two event cards with their date, title, level, host, format and places left.',
			caption:
				'The events list as it really is. On the development server these pictures come from, both upcoming events are test rows, which their “TEST=FAKE” titles say.'
		}
	]
};

const PL: EventsShowcase = {
	title: 'Co zostaje po wydarzeniu',
	description:
		'Jak jedna sesja z programu wydarzenia staje się fiszkami położonymi na tym wydarzeniu i jak wydarzenie spotyka się z kursem — przez organizację prowadzącą jedno i drugie, nigdy bezpośrednio.',
	lead: [
		'Wydarzenie dzieje się raz. To cała różnica między nim a kursem i dlatego wszystko w wydarzeniu zbudowane jest wokół dnia, a nie semestru: program ze ścieżkami i sesjami, rejestracja, bilety przy wejściu, grafik wolontariuszy, miejsce na dokumenty organizatorów.',
		'Kłopot z dzianiem się raz jest taki, że potem nie ma do czego wrócić. Sesja, która dołączyła trzy zadania i listę, ma je we wpisie programu i nigdzie więcej. Ten etap dodaje jedną rzecz, która to naprawia: sesję można zabrać do domu.'
	],
	points: [
		{
			heading: 'Zabranie do domu zbiera to, na co wskazywała sesja',
			body: 'Każde zadanie, do którego sesja odsyła, i każde zadanie z dołączonych do niej zestawów, po kolei. Nic nie jest wymyślane i nic kopiowane — fiszki odsyłają do tych samych wierszy, do których odsyłał program.'
		},
		{
			heading: 'Fiszki organizatora idą na wydarzenie; fiszki uczestnika są jego własne',
			body: 'Naciśnij jako organizator i fiszki zostają położone na wydarzeniu, gdzie może się z nich uczyć każdy, kto widzi wydarzenie. Naciśnij jako uczestnik i dostajesz własne fiszki.'
		},
		{
			heading: 'Zestaw dołączony do sesji jest przez nią czytelny',
			body: 'Nawet prywatny, bo organizator sam zdecydował się umieścić go w programie. To celowe poszerzenie, zapisane tam, gdzie definiowany jest endpoint, a nie zostawione do odkrycia.'
		},
		{
			heading: 'Wydarzenia i kursy spotykają się w organizacji, nie ze sobą',
			body: 'Nie ma pola w wydarzeniu nazywającego kurs ani pola w kursie nazywającego wydarzenie. Jedno i drugie mówi, kto je prowadzi, a odpowiedź na „co jeszcze robią ci ludzie?” bierze się z zapytania tej organizacji.'
		}
	],
	cardHeading: 'Wydarzenie tak, jak wypisuje je lista',
	event: {
		id: '9500',
		host: { id: '502', displayName: 'Koło Naukowe Matematyków' },
		title: 'Wiosenne warsztaty z analizy',
		summary:
			'Jedna sobota, cztery ścieżki i listy zadań, z których prelegenci naprawdę korzystali. Otwarte dla każdego od drugiego roku.',
		description: '',
		subjectSlugs: ['uw-mat-analiza-i'],
		disciplineSlug: 'uw-matematyka',
		status: 'published',
		visibility: 'public',
		startsAt: '2026-04-18T09:00:00Z',
		eventTime: null,
		endsAt: '2026-04-18T17:00:00Z',
		durationMinutes: 480,
		locationKind: 'onsite',
		locationText: 'Banacha 2, Warszawa',
		onlineUrl: '',
		capacity: 120,
		language: 'pl',
		audience: 'university',
		runsUntil: null,
		goingCount: 86,
		declinedCount: 0,
		postCount: 2,
		seatsLeft: 34,
		isFull: false,
		isPast: false,
		myAttendance: null,
		isHost: false,
		canOrganise: false,
		canCheckIn: false,
		registrationMode: 'rsvp',
		showAttendeesPublicly: true,
		registrationFields: [],
		waitlistCount: 0,
		pendingCount: 0,
		myRegistration: null,
		myWaitlistPosition: null,
		cfpOpen: false,
		cfpDeadline: null,
		callIsOpen: false,
		contributionCounts: { accepted: 7 },
		canRespond: true,
		responseBlockReason: null,
		parent: null,
		subEvents: [],
		createdAt: '2026-02-01T10:00:00Z'
	},
	cardCaption:
		'Karta zaczyna od daty, inaczej niż każda inna karta w tej aplikacji. To jedyny fakt, który decyduje, czy resztę warto czytać.',
	programmeHeading: 'Jedna sesja z jego programu',
	trackName: 'Ścieżka B — ćwiczenia',
	sessionName: 'Ciągi i szeregi od podstaw',
	sessionTime: 'Sobota 11:15 – 12:45 · sala 3120',
	sessionRows: [
		{ label: 'Zestaw', title: 'Lista warsztatowa B2', note: '10 zadań' },
		{ label: 'Zadanie', title: 'Granica ciągu wymiernego', note: 'średnie' },
		{ label: 'Materiał', title: 'Slajdy: trzy kryteria zbieżności', note: 'slajdy z wykładu' },
		{ label: 'Odnośnik', title: 'Własne notatki prelegenta', note: 'zewnętrzny' }
	],
	programmeCaption:
		'Odnośniki sesji, każdy dokładnie jednego rodzaju. Dwa z tych czterech zawierają zadania — i to właśnie zbiera przycisk zabrania do domu.',
	takeHomeHeading: 'Zabierz do domu',
	takeHomeBody: [
		'Przycisk stoi przy sesji i pojawia się tylko przy sesji, która naprawdę odsyła do co najmniej jednego zadania — przycisk, który nie miałby z czego zrobić ani jednej fiszki, jest gorszy niż brak przycisku.',
		'Powstaje jedenaście fiszek: dziesięć zadań z dołączonej listy i jedno dołączone bezpośrednio. Skład listy jest przypięty w tej chwili; zadania pozostają żywe, więc rozwiązanie poprawione w czerwcu dociera do fiszki zrobionej w kwietniu.'
	],
	deck: {
		name: 'Ciągi i szeregi od podstaw',
		cardCount: 11,
		dueCount: 11,
		source: 'session',
		placedOn: { kind: 'event', name: 'Wiosenne warsztaty z analizy' },
		isPublic: false
	},
	takeHomeCaption:
		'Fiszki, które robi naciśnięcie organizatora, położone na wydarzeniu. Trzy tygodnie później są jedyną częścią tych dziewięćdziesięciu minut, z której da się jeszcze powtarzać.',
	crossHeading: 'I do czego wydarzenie prowadzi',
	crossBody: [
		'Strona wydarzenia mówi, kto je prowadzi, a pod tym wypisuje kursy prowadzone przez tych samych ludzi. To cały związek między jednym a drugim: „ćwiczenia z tych warsztatów stały się kursem, który spotyka się co tydzień” jest faktem o kole, które zrobiło jedno i drugie, więc czyta się go z tego koła.',
		'Zrobienie tego odwrotnie — pole w wydarzeniu wskazujące na kurs — byłoby czwartym sposobem powiedzenia tego samego i czwartą rzeczą do pilnowania. Byłoby też błędne tak samo często, jak trafne, bo kurs powstający po warsztatach prowadzi zwykle ktoś, kto na nich mówił, a nie same warsztaty.'
	],
	runByLabel: 'Prowadzą',
	runBy: ['Koło Naukowe Matematyków', 'Wydział Matematyki, Informatyki i Mechaniki'],
	relatedCourse: {
		id: '9100',
		school: null, // learning step C's field; added at integration, 2026-10-05
		// The course kind and the general/version shape (2026-10-14). The sample is a top-level
		// general course, so none of the university fields.
		kind: 'topic',
		parent: null,
		parentSummary: null,
		university: '',
		faculty: '',
		courseCode: '',
		currentTerm: '',
		instructor: { id: '501', displayName: 'dr Anna Lewandowska' },
		title: 'Analiza I, grupa wiosenna',
		summary:
			'Cotygodniowe ćwiczenia idące za wykładem, z listami zadań i garścią fiszek na każdy tydzień.',
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
		language: 'pl',
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
	},
	eventsLinkLabel: 'Przeglądaj najbliższe wydarzenia',
	crossCaption:
		'Jeden kurs, przefiltrowany przez własną widoczność: prywatny kurs prowadzony przez to samo koło nie pojawi się tutaj tylko dlatego, że ktoś widzi wydarzenie.',
	closing:
		'Odbicie w drugą stronę — strona kursu wypisująca wydarzenia prowadzone przez jego organizację — nie jest jeszcze zbudowane i jest tu nazwane, żeby nikt nie uznał, że zniknęło przez przypadek. Nie ma też zabrania do domu materiałów sesji: w fiszkach są zadania i pojęcia, nie pliki.',
	tryIt: [{ label: 'Zobacz, co się zbliża', route: '/events' }],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/events/01-hub.png',
			focus: [98, 826],
			width: 1280,
			height: 480,
			route: '/events',
			alt: 'Zrzut ekranu strony Wydarzenia: krótkie wyjaśnienie, zakładki Coming up i Already happened oraz dwie karty wydarzeń z datą, tytułem, poziomem, organizatorem, formą i liczbą wolnych miejsc.',
			caption:
				'Lista wydarzeń taka, jaka naprawdę jest. Na serwerze deweloperskim, z którego pochodzą zrzuty, oba nadchodzące wydarzenia są testowe — mówią to ich tytuły „TEST=FAKE”.'
		}
	]
};

export function eventsShowcaseFor(locale: string): EventsShowcase {
	return locale === 'pl' ? PL : EN;
}
