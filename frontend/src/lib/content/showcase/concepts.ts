/**
 * `/about/concepts` — one page per idea, and the prerequisite graph read as "before this, know…".
 *
 * `ConceptCard` is the real component on a real `ConceptListRow`. The path is a twin
 * (`components/showcase/PathSteps.svelte`) because the real one resolves every title against the
 * reader's own audience and language through an endpoint, and there is nothing to resolve here.
 *
 * The closure is bounded on purpose and the page says the bound out loud: depth four, twenty
 * concepts, cycles cut. A graph anybody can extend will eventually contain a cycle, and "A needs
 * B needs A" is a thing somebody wrote rather than an error to crash on.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ConceptListRow } from '$lib/types/concept';
import type { ShowcaseDeck, ShowcaseDoc } from './index';

/** One concept in a prerequisite path: how many hops back it is from where the reader started. */
export interface ShowcasePathStep {
	title: string;
	distance: number;
	note?: string;
}

export interface ConceptsShowcase extends ShowcaseDoc {
	cardsHeading: string;
	cards: ConceptListRow[];
	cardsCaption: string;
	audiencesHeading: string;
	audiencesBody: string[];
	audienceVersions: { band: string; opening: string }[];
	audiencesCaption: string;
	pathHeading: string;
	pathBody: string[];
	pathFrom: string;
	path: ShowcasePathStep[];
	pathCaption: string;
	learnFirstHeading: string;
	learnFirstLead: string;
	learnFirstExercise: string;
	learnFirstItems: string[];
	learnFirstCaption: string;
	deckHeading: string;
	deckBody: string[];
	deck: ShowcaseDeck;
	deckCaption: string;
	/** The link out, to the real concepts hub. */
	conceptsLinkLabel: string;
}

const EN: ConceptsShowcase = {
	title: 'Concepts, and what to learn first',
	description:
		'One EdMat page per idea, written separately for a school pupil and for a university student, with a prerequisite graph that an exercise page reads as “before this, know…”.',
	lead: [
		'An exercise says “compute this”. A material says “here are twelve pages”. Neither says what the thing is, which is what somebody who is stuck actually needs. A concept is one page per idea, and it carries an article for each kind of reader — the same theorem written once for a fifteen-year-old and once for a second-year student, not one article with a difficulty label on it.',
		'Concepts are also the only place this site says what has to come before what. An edge from “uniform continuity” to “continuity” means you should know the second first, and walking those edges is how an exercise page can tell a reader, before they start, which three things are assumed.'
	],
	points: [
		{
			heading: 'A concept has no title of its own',
			body: 'Only its articles do, so what you see on a card is the title of whichever article was resolved for you. When none was written for your band, the card says so rather than quietly showing somebody else’s.'
		},
		{
			heading: 'The prerequisite walk is bounded, and the bound is stated',
			body: 'Four hops, twenty concepts, and a cycle is cut where it closes. A reader gets the nearest things first; nobody gets a list of everything in mathematics.'
		},
		{
			heading: 'Only prerequisite edges are followed',
			body: '“Related” edges are drawn from links somebody wrote in a body; prerequisites are stated on purpose. Following the first kind would turn “learn this first” into “here is everything this mentions”.'
		},
		{
			heading: 'Switching the feature off leaves an empty line, not a broken page',
			body: 'The exercise page keeps working with concepts turned off: the endpoint answers an empty list rather than a refusal, so the “before this, know…” line simply is not there.'
		}
	],
	cardsHeading: 'Two concepts, as the hub lists them',
	cards: [
		{
			id: '9400',
			slug: 'continuity',
			title: 'Continuity of a function',
			summary:
				'A function is continuous at a point when small changes in the input make only small changes in the output — made precise by limits.',
			audience: 'university',
			locale: 'en',
			articleCount: 3,
			audiences: ['secondary', 'university', 'adult'],
			locales: ['en', 'pl'],
			branchIds: ['uw-mat-analiza-i'],
			branchNames: ['Mathematical Analysis I'],
			tags: ['analysis'],
			updatedAt: '2026-04-02T12:00:00Z',
			isFallback: false
		},
		{
			id: '9401',
			slug: 'compactness',
			title: 'Compactness',
			summary:
				'A set is compact when every sequence in it has a subsequence converging inside it — the property that makes “a continuous function attains its maximum” true.',
			audience: 'university',
			locale: 'en',
			articleCount: 1,
			audiences: ['university'],
			locales: ['en'],
			branchIds: ['uw-mat-analiza-i'],
			branchNames: ['Mathematical Analysis I'],
			tags: ['analysis', 'topology'],
			updatedAt: '2026-04-05T12:00:00Z',
			isFallback: true
		}
	],
	cardsCaption:
		'The second card is marked as a fallback: nothing has been written for the reader’s own band, so what they are being shown is the university article. Said on the card rather than discovered after the click.',
	audiencesHeading: 'The same idea, twice',
	audiencesBody: [
		'An article belongs to a band, and a concept collects however many have been written. This is not the same as writing simply: the school article is allowed to leave out the part that needs limits, and the university one is allowed to assume them. One article with a “simplified” section at the top would have to do both badly.'
	],
	audienceVersions: [
		{
			band: 'Secondary school',
			opening:
				'A graph you can draw without lifting the pencil is continuous. That is not a definition, but it is the right picture, and the definition below is what makes it exact.'
		},
		{
			band: 'University',
			opening:
				'\\( f \\) is continuous at \\( x_0 \\) when for every \\( \\varepsilon > 0 \\) there is a \\( \\delta > 0 \\) such that \\( |x - x_0| < \\delta \\) implies \\( |f(x) - f(x_0)| < \\varepsilon \\).'
		}
	],
	audiencesCaption:
		'The opening sentence of two articles about the same concept. A reader gets the one for their band, and can ask for the other.',
	pathHeading: 'What comes before what',
	pathBody: [
		'Each concept names the things that have to come before it. Walking those names outward gives a path — nearest first, then one step further back, and so on — which is a more useful answer to “I do not understand this” than a flat list of everything related.',
		'The walk stops at four steps, at twenty concepts, and at any cycle it meets. In the path below, “limit of a sequence” is reached twice by two different routes and appears once, at the shorter distance.'
	],
	pathFrom: 'Compactness',
	path: [
		{ title: 'Continuity of a function', distance: 1 },
		{ title: 'Convergent sequence', distance: 1 },
		{ title: 'Limit of a sequence', distance: 2, note: 'reached by both routes above' },
		{ title: 'Supremum and infimum', distance: 2 },
		{ title: 'Ordered field', distance: 3 }
	],
	pathCaption:
		'Five concepts at three distances. A reader who knows the first two can stop reading there; one who knows none of them has a reading order.',
	learnFirstHeading: 'And how an exercise page uses it',
	learnFirstLead:
		'The exercise is linked to one or two concepts; the line below is the union of their prerequisites, nearest first, each title resolved for whoever is reading.',
	learnFirstExercise:
		'Exercise 206 · Show that a continuous function on a closed interval is bounded',
	learnFirstItems: [
		'Continuity of a function',
		'Convergent sequence',
		'Limit of a sequence',
		'Supremum and infimum'
	],
	learnFirstCaption:
		'Not a gate and not a warning — a reading order, offered before somebody spends twenty minutes finding out they needed it.',
	deckHeading: 'A deck from a concept',
	deckBody: [
		'A concept gathers the exercises that are about it, so “make a deck from this concept” is a deck of every exercise linked to it that the reader may see. For a concept card the front is the resolved article’s title and the back is its summary; for an exercise card it is the statement and the published answer.',
		'The card keeps a live reference to the concept, so an article rewritten next month reaches the card. A frozen card — one that keeps the wording it was made from — is deliberately not offered, because a flashcard of a superseded explanation is a flashcard of something wrong.'
	],
	deck: { name: 'Compactness', cardCount: 9, dueCount: 9, source: 'concept', isPublic: false },
	conceptsLinkLabel: 'Browse the concepts',
	deckCaption:
		'Nine exercises linked to the concept, as nine cards. The button is not shown at all when a concept has no exercises on it yet.',
	closing:
		'A path you can tick off as you go would be a course, and this site already has those. What a concept offers is the order, not the teaching.',
	tryIt: [{ label: 'Browse the concepts', route: '/concepts' }],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/concepts/01-hub.png',
			focus: [98, 1182],
			width: 1280,
			height: 780,
			route: '/concepts',
			alt: 'Screenshot of the Concepts page: search, subject, tag and order filters, an A to Z row, and concept cards — Integral, Mechanika kwantowa, Limit, Derivative — each with its level, language, number of articles, a one-line summary, its subject and tags.',
			caption:
				'The concepts list: one card per idea, with its level, its language and how many articles it has.'
		}
	]
};

const PL: ConceptsShowcase = {
	title: 'Pojęcia i co trzeba wiedzieć wcześniej',
	description:
		'Jedna strona EdMatu na jedno pojęcie, napisana osobno dla ucznia i dla studenta, z grafem wymagań, który strona zadania czyta jako „wcześniej warto wiedzieć…”.',
	lead: [
		'Zadanie mówi „oblicz to”. Materiał mówi „oto dwanaście stron”. Żadne nie mówi, czym ta rzecz jest — a tego właśnie potrzebuje ktoś, kto utknął. Pojęcie to jedna strona na jedną ideę, a nosi po jednym artykule dla każdego rodzaju czytelnika — to samo twierdzenie napisane raz dla piętnastolatka i raz dla studenta drugiego roku, a nie jeden artykuł z etykietką trudności.',
		'Pojęcia są też jedynym miejscem, w którym ten serwis mówi, co musi być przed czym. Krawędź od „ciągłości jednostajnej” do „ciągłości” znaczy, że drugie trzeba znać pierwsze, a chodzenie po tych krawędziach pozwala stronie zadania powiedzieć czytelnikowi, zanim zacznie, które trzy rzeczy są tu założone.'
	],
	points: [
		{
			heading: 'Pojęcie nie ma własnego tytułu',
			body: 'Mają go tylko jego artykuły, więc to, co widać na karcie, jest tytułem tego artykułu, który został dla ciebie dobrany. Gdy dla twojej grupy nic nie napisano, karta mówi to wprost, zamiast cicho pokazać czyjś inny.'
		},
		{
			heading: 'Przejście po wymaganiach jest ograniczone i ograniczenie jest podane',
			body: 'Cztery kroki, dwadzieścia pojęć, a cykl jest przerwany tam, gdzie się zamyka. Czytelnik dostaje najpierw rzeczy najbliższe; nikt nie dostaje listy całej matematyki.'
		},
		{
			heading: 'Chodzi się tylko po krawędziach wymagań',
			body: 'Krawędzie „powiązane” powstają z odnośników, które ktoś wpisał w treść; wymagania są podane celowo. Chodzenie po pierwszych zamieniłoby „naucz się tego wcześniej” w „oto wszystko, co jest tu wspomniane”.'
		},
		{
			heading: 'Wyłączenie funkcji zostawia puste miejsce, nie zepsutą stronę',
			body: 'Strona zadania działa z wyłączonymi pojęciami: endpoint odpowiada pustą listą, a nie odmową, więc linijki „wcześniej warto wiedzieć…” po prostu nie ma.'
		}
	],
	cardsHeading: 'Dwa pojęcia tak, jak wypisuje je lista',
	cards: [
		{
			id: '9400',
			slug: 'continuity',
			title: 'Ciągłość funkcji',
			summary:
				'Funkcja jest ciągła w punkcie, gdy małe zmiany argumentu dają tylko małe zmiany wartości — uściślone przez granice.',
			audience: 'university',
			locale: 'pl',
			articleCount: 3,
			audiences: ['secondary', 'university', 'adult'],
			locales: ['en', 'pl'],
			branchIds: ['uw-mat-analiza-i'],
			branchNames: ['Analiza matematyczna I'],
			tags: ['analiza'],
			updatedAt: '2026-04-02T12:00:00Z',
			isFallback: false
		},
		{
			id: '9401',
			slug: 'compactness',
			title: 'Zwartość',
			summary:
				'Zbiór jest zwarty, gdy każdy ciąg w nim ma podciąg zbieżny do punktu tego zbioru — to własność, dzięki której „funkcja ciągła osiąga maksimum” jest prawdą.',
			audience: 'university',
			locale: 'pl',
			articleCount: 1,
			audiences: ['university'],
			locales: ['pl'],
			branchIds: ['uw-mat-analiza-i'],
			branchNames: ['Analiza matematyczna I'],
			tags: ['analiza', 'topologia'],
			updatedAt: '2026-04-05T12:00:00Z',
			isFallback: true
		}
	],
	cardsCaption:
		'Druga karta jest oznaczona jako zastępcza: dla grupy czytelnika nic nie napisano, więc pokazywany jest artykuł dla studentów. Powiedziane na karcie, a nie odkryte po kliknięciu.',
	audiencesHeading: 'To samo pojęcie dwa razy',
	audiencesBody: [
		'Artykuł należy do grupy odbiorców, a pojęcie zbiera tyle artykułów, ile ktoś napisał. To nie to samo co pisanie prościej: artykuł szkolny ma prawo pominąć część, która wymaga granic, a akademicki ma prawo je założyć. Jeden artykuł z „uproszczoną” sekcją na górze musiałby robić jedno i drugie źle.'
	],
	audienceVersions: [
		{
			band: 'Szkoła średnia',
			opening:
				'Wykres, który da się narysować bez odrywania ołówka, jest ciągły. To nie definicja, ale to właściwy obraz — a definicja poniżej jest tym, co czyni go dokładnym.'
		},
		{
			band: 'Studia',
			opening:
				'\\( f \\) jest ciągła w \\( x_0 \\), gdy dla każdego \\( \\varepsilon > 0 \\) istnieje \\( \\delta > 0 \\) takie, że \\( |x - x_0| < \\delta \\) pociąga \\( |f(x) - f(x_0)| < \\varepsilon \\).'
		}
	],
	audiencesCaption:
		'Pierwsze zdanie dwóch artykułów o tym samym pojęciu. Czytelnik dostaje ten dla swojej grupy i może poprosić o drugi.',
	pathHeading: 'Co jest przed czym',
	pathBody: [
		'Każde pojęcie wymienia rzeczy, które muszą być przed nim. Chodzenie po tych nazwach na zewnątrz daje ścieżkę — najpierw najbliższe, potem o krok dalej i tak dalej — co jest bardziej użyteczną odpowiedzią na „nie rozumiem tego” niż płaska lista wszystkiego powiązanego.',
		'Przejście zatrzymuje się na czterech krokach, na dwudziestu pojęciach i na każdym napotkanym cyklu. W ścieżce poniżej „granica ciągu” jest osiągalna dwiema różnymi drogami i występuje raz, na krótszym dystansie.'
	],
	pathFrom: 'Zwartość',
	path: [
		{ title: 'Ciągłość funkcji', distance: 1 },
		{ title: 'Ciąg zbieżny', distance: 1 },
		{ title: 'Granica ciągu', distance: 2, note: 'osiągalna obiema drogami powyżej' },
		{ title: 'Kresy górny i dolny', distance: 2 },
		{ title: 'Ciało uporządkowane', distance: 3 }
	],
	pathCaption:
		'Pięć pojęć na trzech dystansach. Czytelnik, który zna dwa pierwsze, może przestać czytać; ten, który nie zna żadnego, ma kolejność czytania.',
	learnFirstHeading: 'I jak używa tego strona zadania',
	learnFirstLead:
		'Zadanie jest powiązane z jednym albo dwoma pojęciami; linijka poniżej jest sumą ich wymagań, od najbliższych, z każdym tytułem dobranym dla tego, kto czyta.',
	learnFirstExercise:
		'Zadanie 206 · Wykaż, że funkcja ciągła na odcinku domkniętym jest ograniczona',
	learnFirstItems: ['Ciągłość funkcji', 'Ciąg zbieżny', 'Granica ciągu', 'Kresy górny i dolny'],
	learnFirstCaption:
		'To nie bramka ani ostrzeżenie — to kolejność czytania, podana, zanim ktoś wyda dwadzieścia minut na odkrycie, że była mu potrzebna.',
	deckHeading: 'Talia z pojęcia',
	deckBody: [
		'Pojęcie zbiera zadania, które są o nim, więc „zrób talię z tego pojęcia” to talia każdego powiązanego z nim zadania, które czytelnik może widzieć. Dla fiszki z pojęcia przodem jest tytuł dobranego artykułu, a tyłem jego streszczenie; dla fiszki z zadania — treść i opublikowana odpowiedź.',
		'Fiszka trzyma żywe odniesienie do pojęcia, więc artykuł przepisany w przyszłym miesiącu dociera do fiszki. Fiszka zamrożona — trzymająca brzmienie, z którego powstała — celowo nie jest proponowana, bo fiszka z nieaktualnego wyjaśnienia jest fiszką z czegoś błędnego.'
	],
	deck: { name: 'Zwartość', cardCount: 9, dueCount: 9, source: 'concept', isPublic: false },
	conceptsLinkLabel: 'Przeglądaj pojęcia',
	deckCaption:
		'Dziewięć zadań powiązanych z pojęciem jako dziewięć fiszek. Przycisku nie ma wcale, gdy pojęcie nie ma jeszcze żadnych zadań.',
	closing:
		'Ścieżka, którą da się odhaczać po kolei, byłaby kursem, a te ten serwis już ma. Pojęcie oferuje kolejność, nie nauczanie.',
	tryIt: [{ label: 'Przeglądaj pojęcia', route: '/concepts' }],
	// Screenshots of the running site (`e2e/guide-screenshots.mjs`), each checked against the
	// current screen before it was used here — see `ShowcaseShot` in `index.ts`.
	shots: [
		{
			src: '/guide/concepts/01-hub.png',
			focus: [98, 1182],
			width: 1280,
			height: 780,
			route: '/concepts',
			alt: 'Zrzut ekranu strony Pojęcia: filtry wyszukiwania, przedmiotu, tagu i kolejności, rząd liter od A do Z i karty pojęć — Integral, Mechanika kwantowa, Limit, Derivative — każda z poziomem, językiem, liczbą artykułów, jednozdaniowym opisem, przedmiotem i tagami.',
			caption: 'Lista pojęć: jedna karta na jedną ideę, z poziomem, językiem i liczbą artykułów.'
		}
	]
};

export function conceptsShowcaseFor(locale: string): ConceptsShowcase {
	return locale === 'pl' ? PL : EN;
}
