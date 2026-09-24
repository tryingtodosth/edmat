/**
 * The landing page, `/about`, in full, per locale.
 *
 * **The third page under the exception `content/privacy.ts` opened**, and for the same reason the
 * first two gave: this is one piece of writing that only reads properly end to end. Split across
 * forty message keys, a reviewer could not tell whether the Polish version still says what the
 * English one does, and a landing page whose two languages have drifted apart is worse than one
 * language. House rule 1's real purpose — nothing is ever English-only — is met exactly, because
 * both locales live here and a third cannot be added without adding all of it.
 *
 * **Everything on this page claims to describe the present**, so it is written against what is
 * actually built (`CLAUDE.md`, `PRODUCT.md` §2, `FINANCES.md` §1, `LEGAL.md` §1) and must be
 * changed when those change. Two deliberate silences: no content licence is named, because there
 * is none yet and `LEGAL.md` says to check with Piotr before writing any licensing text; and no
 * counts, because a number baked into a prerendered page is stale the day after the build.
 *
 * Feature cards carry the flag that governs their surface. The page hides a card whose flag is off
 * (house rule 3: a kill switch removes the links, not just the pages), so the two lists below must
 * name the flag exactly as `types/featureFlag.ts` spells it.
 */

import type { FeatureFlagKey } from '$lib/types';

export interface AboutFeature {
	/** Stable key for `{#each}` and for the one card the tests look for. */
	key: string;
	title: string;
	body: string;
	/** A route path — `/disciplines`, never a URL with a query string. */
	href: string;
	/** The kill switch for this surface; `null` for the two that are always on. */
	flag: FeatureFlagKey | null;
}

export interface AboutSection {
	heading: string;
	body: string[];
	bullets?: string[];
}

export interface AboutDoc {
	title: string;
	eyebrow: string;
	lead: string[];
	ctaBrowse: string;
	ctaRegister: string;
	ctaSubmit: string;
	/** The four browsing steps, drawn as a strip under the hero. */
	path: string[];
	pathLabel: string;
	/** An exercise's anatomy: the four fields a corpus row can carry, statement first. */
	fields: { label: string; note: string }[];
	anatomyLabel: string;
	origin: AboutSection;
	featuresHeading: string;
	featuresIntro: string;
	features: AboutFeature[];
	trust: AboutSection;
	audiences: AboutSection;
	money: AboutSection;
	open: AboutSection;
	links: {
		privacy: string;
		levels: string;
		legal: string;
		source: string;
	};
	closingTitle: string;
	closingBody: string;
}

const EN: AboutDoc = {
	title: 'About EdMat',
	eyebrow: 'What this is',
	lead: [
		'EdMat is a community database of exercises and teaching materials, grown into a place to learn together: worked solutions you can question, materials you can improve, courses people run, tutors you can actually book, and events you can sign up for.',
		'It started as one department’s exercise collection and is becoming a lifelong-learning portal — for school, for university, and for everyone learning on their own, at any age.'
	],
	ctaBrowse: 'Browse disciplines',
	ctaRegister: 'Create an account',
	ctaSubmit: 'Submit an exercise',
	path: ['Discipline', 'Subject', 'Topic', 'Exercise'],
	pathLabel: 'How the database is organised',
	fields: [
		{ label: 'Statement', note: 'Always. The problem itself, typeset as mathematics.' },
		{ label: 'Hint', note: 'Where to start, without giving it away.' },
		{ label: 'Answer', note: 'The result alone — empty for “prove that” exercises.' },
		{ label: 'Solution', note: 'The full working. Reviewed, it earns the “verified” badge.' }
	],
	anatomyLabel: 'What an exercise contains',
	origin: {
		heading: 'Where it comes from',
		body: [
			'Good exercises with correct, well-explained solutions already exist — in scanned PDFs, on course websites that vanish after a semester, and in files a teaching assistant hands to whoever asks. EdMat was seeded from one such collection: several hundred exercises from University of Warsaw mathematics and computer science courses, each with a statement and, where somebody wrote them, a hint, an answer and a full solution, all typeset as real mathematics.',
			'A static site could hold that corpus but could not let it improve. Nobody could flag a wrong solution, propose a clearer one, discuss where they got stuck, or translate an exercise for a classmate who studies in another language. EdMat is that same collection, made writable — carefully.'
		]
	},
	featuresHeading: 'What you can do here',
	featuresIntro:
		'Everything is browsable without an account. An account lets you rate, discuss, submit and join.',
	features: [
		{
			key: 'exercises',
			title: 'Exercises with solutions',
			body: 'Browse discipline → subject → topic, filter by difficulty and source, and read the statement, hint, answer and solution. Build your own study set and print it.',
			href: '/disciplines',
			flag: null
		},
		{
			key: 'materials',
			title: 'Teaching materials',
			body: 'Lecture notes, formula sheets, past exams and scripts, filed by subject and topic, with coverage claims that say what a material actually teaches.',
			href: '/materials',
			flag: null
		},
		{
			key: 'concepts',
			title: 'Concept articles',
			body: 'One page per idea, with a version written for each audience — the same theorem explained for a school pupil and for a university student.',
			href: '/concepts',
			flag: 'concepts'
		},
		{
			key: 'translations',
			title: 'Translations',
			body: 'Any exercise can be translated by the community and reviewed by a moderator, independently of the language you read the interface in.',
			href: '/disciplines',
			flag: null
		},
		{
			key: 'courses',
			title: 'Courses people run',
			body: 'A teacher or a student can open a course, add chapters and lessons that link into the database, and invite others to join.',
			href: '/courses',
			flag: 'courses'
		},
		{
			key: 'tutoring',
			title: 'Tutoring you can book',
			body: 'Tutors publish their subjects and availability; you book a real slot. EdMat handles the calendar and nothing else — no payment passes through it.',
			href: '/services',
			flag: 'tutoring'
		},
		{
			key: 'events',
			title: 'Events',
			body: 'Guest lectures, workshops, study sessions and conferences, with programmes, registration, tickets and a place for the organisers’ documents.',
			href: '/events',
			flag: 'events'
		},
		{
			key: 'community',
			title: 'Discussion and activity',
			body: 'A thread under every exercise, material and claim; a public activity feed of what changed; messages between members.',
			href: '/activity',
			flag: null
		}
	],
	trust: {
		heading: 'How it stays trustworthy',
		body: [
			'A database anybody can edit is only useful if the edits are reviewed. EdMat is moderated, not a free-for-all, and the quality bar is the one the original corpus set.'
		],
		bullets: [
			'New exercises, materials, corrections and translations go into a queue and are reviewed before they are published. A rejected submission stays on record with its reason.',
			'“Verified” is never toggled by hand: an exercise shows the badge because a reviewed solution exists, and loses it when that stops being true.',
			'Anything on the site can be reported, and the notice goes to a person. What you may do grows with standing you earn, and nobody may act on other people’s work alone.',
			'Uploaded images are re-encoded and stripped of metadata; text is sanitized on the way in and on the way out.'
		]
	},
	audiences: {
		heading: 'For every age',
		body: [
			'Every piece of content states who it is for, from early years through primary and secondary school, university, adult learners and seniors. Difficulty is read within that band — “hard” for a ten-year-old is not “hard” for a student — and the front page lets you pick your band once and keep it.',
			'Children under sixteen use EdMat through a guardian’s account. The site collects as little about anybody as it can, and the privacy page says exactly what.'
		]
	},
	money: {
		heading: 'What it costs',
		body: [
			'Nothing. EdMat processes no payments and has no paid tier. A tutor may write a rate on their listing and a material may show a price, but those are words a person typed, not a checkout; whatever changes hands does so outside the site, between the people involved.',
			'Contributors who want support can list a donation link on their profile. EdMat takes no cut, because it has no way to.'
		]
	},
	open: {
		heading: 'Open, bilingual, honest',
		body: [
			'The code is open source under the MIT licence and is developed in public. The interface is Polish and English from the first day, and which language an exercise is written in is a separate question from which language you read the menus in — lists tell you when they have hidden something you could not read.',
			'This is a prototype running on a real server: what you save is genuinely stored, and things will still change. The pages below say what is stored, how standing works, and where to send a notice.'
		]
	},
	links: {
		privacy: 'Privacy policy',
		levels: 'Levels and limits',
		legal: 'Legal & content notices',
		source: 'Source code on GitHub'
	},
	closingTitle: 'Start with one exercise.',
	closingBody:
		'Pick a discipline, open something you are stuck on, and see how somebody else solved it. If you can explain it better, tell us.'
};

const PL: AboutDoc = {
	title: 'O EdMacie',
	eyebrow: 'Co to jest',
	lead: [
		'EdMat to społecznościowa baza zadań i materiałów dydaktycznych, która wyrosła w miejsce do wspólnej nauki: rozwiązania, o które można pytać, materiały, które można poprawiać, kursy prowadzone przez użytkowników, korepetytorzy, u których naprawdę można się umówić, i wydarzenia, na które można się zapisać.',
		'Zaczęło się od zbioru zadań jednego wydziału, a staje się portalem do uczenia się przez całe życie — dla szkoły, dla studiów i dla każdego, kto uczy się sam, w każdym wieku.'
	],
	ctaBrowse: 'Przeglądaj dziedziny',
	ctaRegister: 'Załóż konto',
	ctaSubmit: 'Dodaj zadanie',
	path: ['Dziedzina', 'Przedmiot', 'Temat', 'Zadanie'],
	pathLabel: 'Jak uporządkowana jest baza',
	fields: [
		{ label: 'Treść', note: 'Zawsze. Samo zadanie, złożone jako matematyka.' },
		{ label: 'Wskazówka', note: 'Od czego zacząć, bez zdradzania reszty.' },
		{ label: 'Odpowiedź', note: 'Sam wynik — pusta w zadaniach typu „wykaż, że”.' },
		{ label: 'Rozwiązanie', note: 'Pełny tok. Sprawdzone, daje odznakę „zweryfikowane”.' }
	],
	anatomyLabel: 'Z czego składa się zadanie',
	origin: {
		heading: 'Skąd się wziął',
		body: [
			'Dobre zadania z poprawnymi, dobrze wyjaśnionymi rozwiązaniami już istnieją — w zeskanowanych PDF-ach, na stronach kursów, które znikają po semestrze, i w plikach, które prowadzący ćwiczenia wysyła temu, kto poprosi. EdMat wyrósł z jednego takiego zbioru: kilkuset zadań z kursów matematyki i informatyki na Uniwersytecie Warszawskim, z których każde ma treść, a tam, gdzie ktoś je napisał, także wskazówkę, odpowiedź i pełne rozwiązanie, złożone jako prawdziwa matematyka.',
			'Statyczna strona mogła ten zbiór przechowywać, ale nie pozwalała mu się poprawiać. Nikt nie mógł zgłosić błędnego rozwiązania, zaproponować jaśniejszego, opisać, gdzie utknął, ani przetłumaczyć zadania dla kolegi studiującego w innym języku. EdMat to ten sam zbiór, tylko taki, do którego można pisać — ostrożnie.'
		]
	},
	featuresHeading: 'Co tu można robić',
	featuresIntro:
		'Wszystko da się przeglądać bez konta. Konto pozwala oceniać, dyskutować, dodawać i dołączać.',
	features: [
		{
			key: 'exercises',
			title: 'Zadania z rozwiązaniami',
			body: 'Przeglądaj dziedzina → przedmiot → temat, filtruj po trudności i źródle, czytaj treść, wskazówkę, odpowiedź i rozwiązanie. Ułóż własny zestaw i wydrukuj go.',
			href: '/disciplines',
			flag: null
		},
		{
			key: 'materials',
			title: 'Materiały dydaktyczne',
			body: 'Notatki z wykładów, ściągi ze wzorami, stare egzaminy i skrypty, uporządkowane po przedmiocie i temacie, z deklaracjami zakresu mówiącymi, czego materiał naprawdę uczy.',
			href: '/materials',
			flag: null
		},
		{
			key: 'concepts',
			title: 'Artykuły o pojęciach',
			body: 'Jedna strona na jedno pojęcie, z wersją napisaną dla każdej grupy odbiorców — to samo twierdzenie wyjaśnione uczniowi i studentowi.',
			href: '/concepts',
			flag: 'concepts'
		},
		{
			key: 'translations',
			title: 'Tłumaczenia',
			body: 'Każde zadanie może zostać przetłumaczone przez społeczność i sprawdzone przez moderatora — niezależnie od tego, w jakim języku czytasz interfejs.',
			href: '/disciplines',
			flag: null
		},
		{
			key: 'courses',
			title: 'Kursy prowadzone przez ludzi',
			body: 'Nauczyciel albo student może otworzyć kurs, dodać rozdziały i lekcje odsyłające do bazy i zaprosić innych.',
			href: '/courses',
			flag: 'courses'
		},
		{
			key: 'tutoring',
			title: 'Korepetycje z rezerwacją',
			body: 'Korepetytorzy publikują przedmioty i dostępność; ty rezerwujesz prawdziwy termin. EdMat prowadzi kalendarz i nic więcej — nie przechodzi przez niego żadna płatność.',
			href: '/services',
			flag: 'tutoring'
		},
		{
			key: 'events',
			title: 'Wydarzenia',
			body: 'Wykłady gościnne, warsztaty, sesje nauki i konferencje — z programem, rejestracją, biletami i miejscem na dokumenty organizatorów.',
			href: '/events',
			flag: 'events'
		},
		{
			key: 'community',
			title: 'Dyskusja i aktywność',
			body: 'Wątek pod każdym zadaniem, materiałem i deklaracją; publiczny strumień tego, co się zmieniło; wiadomości między użytkownikami.',
			href: '/activity',
			flag: null
		}
	],
	trust: {
		heading: 'Skąd wiadomo, że można mu ufać',
		body: [
			'Baza, którą każdy może edytować, jest użyteczna tylko wtedy, gdy edycje są sprawdzane. EdMat jest moderowany, nie otwarty na wszystko, a poprzeczkę jakości ustawił pierwotny zbiór.'
		],
		bullets: [
			'Nowe zadania, materiały, poprawki i tłumaczenia trafiają do kolejki i są sprawdzane przed publikacją. Odrzucone zgłoszenie zostaje w rejestrze razem z powodem.',
			'„Zweryfikowane” nigdy nie jest przełączane ręcznie: zadanie ma tę odznakę, bo istnieje sprawdzone rozwiązanie, i traci ją, gdy przestaje to być prawdą.',
			'Wszystko na stronie można zgłosić, a zgłoszenie trafia do człowieka. Zakres tego, co wolno, rośnie wraz z wypracowaną pozycją, a nikt nie może sam decydować o cudzej pracy.',
			'Przesłane obrazy są przekodowywane i pozbawiane metadanych; tekst jest oczyszczany przy zapisie i przy odczycie.'
		]
	},
	audiences: {
		heading: 'W każdym wieku',
		body: [
			'Każda treść mówi, dla kogo jest: od najmłodszych, przez szkołę podstawową i średnią, studia, dorosłych uczących się, po seniorów. Trudność czyta się w obrębie tej grupy — „trudne” dla dziesięciolatka to nie „trudne” dla studenta — a na stronie głównej wybierasz swoją grupę raz i zostaje.',
			'Dzieci poniżej szesnastu lat korzystają z EdMatu przez konto opiekuna. Strona zbiera o każdym tak mało, jak się da, a polityka prywatności mówi dokładnie co.'
		]
	},
	money: {
		heading: 'Ile to kosztuje',
		body: [
			'Nic. EdMat nie obsługuje płatności i nie ma płatnego planu. Korepetytor może wpisać stawkę w ogłoszeniu, a materiał może mieć podaną cenę, ale to słowa, które ktoś wpisał, a nie koszyk; jeśli coś przechodzi z rąk do rąk, dzieje się to poza stroną, między zainteresowanymi.',
			'Autorzy, którzy chcą wsparcia, mogą podać link do dobrowolnych wpłat w profilu. EdMat nie pobiera prowizji, bo nie ma jak.'
		]
	},
	open: {
		heading: 'Otwarty, dwujęzyczny, uczciwy',
		body: [
			'Kod jest otwarty na licencji MIT i rozwijany publicznie. Interfejs jest polski i angielski od pierwszego dnia, a język, w którym napisano zadanie, to inna sprawa niż język, w którym czytasz menu — listy mówią, kiedy ukryły coś, czego nie dałoby się przeczytać.',
			'To prototyp na prawdziwym serwerze: to, co zapiszesz, naprawdę zostaje zapisane, a wiele rzeczy jeszcze się zmieni. Strony poniżej mówią, co jest przechowywane, jak działa pozycja i gdzie wysłać zgłoszenie.'
		]
	},
	links: {
		privacy: 'Polityka prywatności',
		levels: 'Poziomy i ograniczenia',
		legal: 'Kontakt prawny i zgłoszenia treści',
		source: 'Kod źródłowy na GitHubie'
	},
	closingTitle: 'Zacznij od jednego zadania.',
	closingBody:
		'Wybierz dziedzinę, otwórz coś, co sprawia ci trudność, i zobacz, jak rozwiązał to ktoś inny. Jeśli umiesz wytłumaczyć to lepiej — powiedz nam.'
};

export function aboutDocFor(locale: string): AboutDoc {
	return locale === 'pl' ? PL : EN;
}
