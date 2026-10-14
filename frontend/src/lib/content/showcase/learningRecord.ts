/**
 * `/about/learning-record` — the two blocks a profile can carry, and why they never touch.
 *
 * The grades half is drawn with the REAL `EducationCard` and the REAL `TranscriptView`, because
 * both already exist and both take plain props; the activity half is drawn with a twin
 * (`components/showcase/RecordBlocks.svelte`), since on a real profile it arrives from an endpoint.
 *
 * The one claim this page exists to make is `prompts/00-DESIGN.md` §1 rule 3: an EdMat count is
 * never presented beside an institutional grade as if it were one. The layout is what says so —
 * two blocks, two headings, two different kinds of number, and a sentence between them.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { PublicEducation, GradeYear } from '$lib/types/identity';
import type { ShowcaseDoc } from './index';

/** The row shape `TranscriptView` takes — its own local interface, repeated here deliberately. */
export interface ShowcaseGradeRow {
	name: string;
	term: string;
	ects: number;
	value: string;
	branchSlug: string | null;
}

export interface LearningRecordShowcase extends ShowcaseDoc {
	gradesHeading: string;
	education: PublicEducation;
	transcriptYears: GradeYear[];
	transcriptRows: ShowcaseGradeRow[];
	educationCaption: string;
	transcriptCaption: string;
	recordHeading: string;
	/** The per-Branch table: the shared grades on one side, EdMat's own counts on the other. */
	gradeBlockHeading: string;
	gradeBlockNote: string;
	/** The two column headings of the grades table, plus the shared row-header heading. */
	subjectColumn: string;
	gradeColumns: { average: string; results: string };
	gradeRows: { branch: string; average: string; count: number }[];
	activityBlockHeading: string;
	activityBlockNote: string;
	activityColumns: { sets: string; lessons: string; cards: string };
	activityRows: { branch: string; sets: number; lessonsDone: number; cardsReviewed: number }[];
	recordCaption: string;
	consentHeading: string;
	consentBody: string[];
	/** The four consents, each with the honest sentence of what it shares. */
	consents: { label: string; shares: string; on: boolean }[];
	consentCaption: string;
	/** The link out, to where a reader sets their own consents. */
	settingsLinkLabel: string;
}

const EN: LearningRecordShowcase = {
	title: 'The learning record',
	description:
		'What a public EdMat profile can say about somebody’s studies and about what they have done here — two separate blocks, each behind its own consent, neither pretending to be the other.',
	lead: [
		'A profile here starts empty. Everything on it is there because its owner turned something on, and each thing is its own switch: the school, the diplomas, the transferred grades, and — new in this cycle — what they have actually done on EdMat.',
		'The last of those is the interesting one, because it is the only place where a number this site computed sits anywhere near a number a university awarded. They are kept in two blocks with a sentence between them, because collapsing them into one table would be a claim nobody can support: three hundred flashcards reviewed in Analysis I is not a grade in Analysis I, and a reader must never be able to read it as one.'
	],
	points: [
		{
			heading: 'Withheld means absent, not blank',
			body: 'What somebody has not shared is not in the response at all. A page cannot leak a grade it was never sent, and there is no “hidden” row for a reader to wonder about.'
		},
		{
			heading: 'Counted per subject, never per item',
			body: 'The activity block says “14 lessons marked done in Analysis I”. It never says which lessons, which exercises or which cards, because that would be a log of somebody’s studying rather than a summary of it.'
		},
		{
			heading: 'Off by default, and never public for a child',
			body: 'The activity consent starts off for everybody. A minor’s profile is not public at all, whatever they switch on — the consent screen says so rather than letting somebody find out later.'
		},
		{
			heading: 'Recounted every time it is read',
			body: 'No stored totals. Two counts over an indexed column are cheap, and a counter that misses one code path is wrong for good.'
		}
	],
	gradesHeading: 'The institutional half',
	education: {
		school: 'University of Warsaw',
		verification: 'usos',
		status: 'student',
		programme: 'Mathematics, second year',
		diplomas: [],
		grades: [
			{
				name: 'Mathematical Analysis I',
				term: '2025Z',
				ects: 10,
				value: '4.5',
				scale: 'pl',
				branchSlug: 'uw-mat-analiza-i'
			},
			{
				name: 'Linear Algebra I',
				term: '2025Z',
				ects: 8,
				value: '4.0',
				scale: 'pl',
				branchSlug: 'uw-mat-algebra-i'
			},
			{
				name: 'Introduction to Programming',
				term: '2025Z',
				ects: 6,
				value: '5.0',
				scale: 'pl',
				branchSlug: 'uw-inf-wstep-prog'
			}
		],
		gradeYears: [{ year: '2025/26', terms: ['2025Z'], count: 3, ects: 24, average: 4.46 }],
		average: 4.46
	},
	transcriptYears: [{ year: '2025/26', terms: ['2025Z'], count: 3, ects: 24, average: 4.46 }],
	transcriptRows: [
		{
			name: 'Mathematical Analysis I',
			term: '2025Z',
			ects: 10,
			value: '4.5',
			branchSlug: 'uw-mat-analiza-i'
		},
		{
			name: 'Linear Algebra I',
			term: '2025Z',
			ects: 8,
			value: '4.0',
			branchSlug: 'uw-mat-algebra-i'
		},
		{
			name: 'Introduction to Programming',
			term: '2025Z',
			ects: 6,
			value: '5.0',
			branchSlug: 'uw-inf-wstep-prog'
		}
	],
	educationCaption:
		'The education block as a stranger sees it. The tick is only ever on a registry-backed claim — a school somebody typed in themselves is shown plainly, because a badge on something nobody checked would look exactly as convincing either way.',
	transcriptCaption:
		'The same results read a year at a time. Every average comes from the server, because an average has real rules — ECTS-weighted, and no number at all for a year that mixes grading scales.',
	recordHeading: 'And the two blocks side by side',
	gradeBlockHeading: 'Shared results',
	gradeBlockNote: 'Awarded by a university, transferred with consent, weighted by ECTS.',
	subjectColumn: 'Subject',
	gradeColumns: { average: 'Weighted average', results: 'Results' },
	gradeRows: [
		{ branch: 'Mathematical Analysis I', average: '4.5', count: 1 },
		{ branch: 'Linear Algebra I', average: '4.0', count: 1 },
		{ branch: 'Introduction to Programming', average: '5.0', count: 1 }
	],
	activityBlockHeading: 'What they have done on EdMat',
	activityBlockNote:
		'Counted by this site. Not a result, not a mark, and not comparable to anything in the block above.',
	activityColumns: { sets: 'Sets', lessons: 'Lessons marked done', cards: 'Cards reviewed' },
	activityRows: [
		{ branch: 'Mathematical Analysis I', sets: 3, lessonsDone: 14, cardsReviewed: 312 },
		{ branch: 'Linear Algebra I', sets: 1, lessonsDone: 0, cardsReviewed: 48 },
		{ branch: 'Introduction to Programming', sets: 0, lessonsDone: 6, cardsReviewed: 0 }
	],
	recordCaption:
		'Both blocks group by subject, which is exactly what lets them share a page without sharing a column: the subject is the only thing the two kinds of number genuinely have in common.',
	consentHeading: 'The four switches',
	consentBody: [
		'Each of these is a separate decision, asked once and changeable at any time. Turning one off takes the block off the profile immediately; it does not delete what was transferred, because a consent is permission to show something, not a copy of it.'
	],
	consents: [
		{
			label: 'Show my school',
			shares:
				'The institution, the programme and whether the claim was checked against a registry.',
			on: true
		},
		{
			label: 'Show my diplomas',
			shares: 'Each diploma’s title, date and final grade.',
			on: false
		},
		{
			label: 'Show my grades',
			shares: 'Every transferred result, with its term and ECTS, and the weighted averages.',
			on: true
		},
		{
			label: 'Show what I have done on EdMat',
			shares:
				'Per subject: how many sets you made, how many lessons you marked done, how many cards you reviewed. Counts only — never which ones.',
			on: true
		}
	],
	settingsLinkLabel: 'Your own profile settings',
	consentCaption:
		'The fourth switch is the new one. It starts off, and the sentence under it is the whole of what it does.',
	closing:
		'A record for one term rather than all of them, a record a course’s staff can see for their own participants, and a record anybody can print are all left for later. What exists is one honest summary on one page, under four switches its owner controls.',
	tryIt: [{ label: 'Choose what your profile shows', route: '/settings' }]
};

const PL: LearningRecordShowcase = {
	title: 'Rejestr nauki',
	description:
		'Co publiczny profil w EdMacie może powiedzieć o czyichś studiach i o tym, co ta osoba tutaj zrobiła — dwa osobne bloki, każdy za własną zgodą, żaden nieudający drugiego.',
	lead: [
		'Profil startuje tutaj pusty. Wszystko, co na nim jest, jest tam, bo właściciel coś włączył, a każda rzecz ma własny przełącznik: szkoła, dyplomy, przeniesione oceny i — nowe w tym etapie — to, co ktoś naprawdę zrobił w EdMacie.',
		'To ostatnie jest najciekawsze, bo to jedyne miejsce, w którym liczba policzona przez ten serwis leży gdziekolwiek blisko liczby wystawionej przez uczelnię. Są trzymane w dwóch blokach, ze zdaniem pomiędzy, bo zwinięcie ich w jedną tabelę byłoby twierdzeniem, którego nikt nie obroni: trzysta powtórzonych fiszek z analizy nie jest oceną z analizy i czytelnik nigdy nie może móc tak tego przeczytać.'
	],
	points: [
		{
			heading: 'Niepokazane znaczy nieobecne, nie puste',
			body: 'To, czego ktoś nie udostępnił, w ogóle nie trafia do odpowiedzi. Strona nie wycieknie oceny, której nigdy nie dostała, i nie ma „ukrytego” wiersza, nad którym czytelnik miałby się zastanawiać.'
		},
		{
			heading: 'Liczone per przedmiot, nigdy per rzecz',
			body: 'Blok aktywności mówi „14 lekcji oznaczonych jako zrobione z Analizy I”. Nigdy nie mówi, które lekcje, które zadania ani które fiszki — bo to byłby dziennik czyjejś nauki, a nie jej podsumowanie.'
		},
		{
			heading: 'Domyślnie wyłączone i nigdy publiczne dla dziecka',
			body: 'Zgoda na aktywność startuje wyłączona dla wszystkich. Profil osoby niepełnoletniej nie jest publiczny wcale, cokolwiek włączy — i ekran zgód mówi to wprost, zamiast pozwalać dowiedzieć się tego później.'
		},
		{
			heading: 'Przeliczane przy każdym odczycie',
			body: 'Żadnych przechowywanych sum. Dwa zapytania zliczające po indeksowanej kolumnie są tanie, a licznik, który przeoczy jedną ścieżkę w kodzie, jest błędny na zawsze.'
		}
	],
	gradesHeading: 'Połowa instytucjonalna',
	education: {
		school: 'Uniwersytet Warszawski',
		verification: 'usos',
		status: 'student',
		programme: 'Matematyka, drugi rok',
		diplomas: [],
		grades: [
			{
				name: 'Analiza matematyczna I',
				term: '2025Z',
				ects: 10,
				value: '4,5',
				scale: 'pl',
				branchSlug: 'uw-mat-analiza-i'
			},
			{
				name: 'Algebra liniowa I',
				term: '2025Z',
				ects: 8,
				value: '4,0',
				scale: 'pl',
				branchSlug: 'uw-mat-algebra-i'
			},
			{
				name: 'Wstęp do programowania',
				term: '2025Z',
				ects: 6,
				value: '5,0',
				scale: 'pl',
				branchSlug: 'uw-inf-wstep-prog'
			}
		],
		gradeYears: [{ year: '2025/26', terms: ['2025Z'], count: 3, ects: 24, average: 4.46 }],
		average: 4.46
	},
	transcriptYears: [{ year: '2025/26', terms: ['2025Z'], count: 3, ects: 24, average: 4.46 }],
	transcriptRows: [
		{
			name: 'Analiza matematyczna I',
			term: '2025Z',
			ects: 10,
			value: '4,5',
			branchSlug: 'uw-mat-analiza-i'
		},
		{
			name: 'Algebra liniowa I',
			term: '2025Z',
			ects: 8,
			value: '4,0',
			branchSlug: 'uw-mat-algebra-i'
		},
		{
			name: 'Wstęp do programowania',
			term: '2025Z',
			ects: 6,
			value: '5,0',
			branchSlug: 'uw-inf-wstep-prog'
		}
	],
	educationCaption:
		'Blok wykształcenia tak, jak widzi go obcy. Ptaszek jest tylko przy deklaracji potwierdzonej w rejestrze — szkołę wpisaną ręcznie pokazuje się zwyczajnie, bo odznaka przy czymś, czego nikt nie sprawdził, wyglądałaby dokładnie tak samo przekonująco w obie strony.',
	transcriptCaption:
		'Te same wyniki czytane rok po roku. Każda średnia pochodzi z serwera, bo średnia ma prawdziwe reguły — waga w ECTS i żadnej liczby dla roku mieszającego skale ocen.',
	recordHeading: 'I dwa bloki obok siebie',
	gradeBlockHeading: 'Udostępnione wyniki',
	gradeBlockNote: 'Wystawione przez uczelnię, przeniesione za zgodą, ważone punktami ECTS.',
	subjectColumn: 'Przedmiot',
	gradeColumns: { average: 'Średnia ważona', results: 'Wyników' },
	gradeRows: [
		{ branch: 'Analiza matematyczna I', average: '4,5', count: 1 },
		{ branch: 'Algebra liniowa I', average: '4,0', count: 1 },
		{ branch: 'Wstęp do programowania', average: '5,0', count: 1 }
	],
	activityBlockHeading: 'Co ta osoba zrobiła w EdMacie',
	activityBlockNote:
		'Policzone przez ten serwis. To nie wynik, nie ocena i nie da się tego porównywać z niczym z bloku powyżej.',
	activityColumns: {
		sets: 'Zestawy',
		lessons: 'Lekcje oznaczone jako zrobione',
		cards: 'Powtórzone fiszki'
	},
	activityRows: [
		{ branch: 'Analiza matematyczna I', sets: 3, lessonsDone: 14, cardsReviewed: 312 },
		{ branch: 'Algebra liniowa I', sets: 1, lessonsDone: 0, cardsReviewed: 48 },
		{ branch: 'Wstęp do programowania', sets: 0, lessonsDone: 6, cardsReviewed: 0 }
	],
	recordCaption:
		'Oba bloki grupują po przedmiocie i właśnie to pozwala im dzielić stronę bez dzielenia kolumny: przedmiot jest jedyną rzeczą, którą te dwa rodzaje liczb naprawdę mają wspólną.',
	consentHeading: 'Cztery przełączniki',
	consentBody: [
		'Każdy z nich jest osobną decyzją, pytaną raz i zmienialną w każdej chwili. Wyłączenie jednego natychmiast zdejmuje blok z profilu; nie usuwa tego, co zostało przeniesione, bo zgoda jest pozwoleniem na pokazanie czegoś, a nie kopią tego.'
	],
	consents: [
		{
			label: 'Pokazuj moją szkołę',
			shares: 'Uczelnię, kierunek i to, czy deklaracja była sprawdzona w rejestrze.',
			on: true
		},
		{
			label: 'Pokazuj moje dyplomy',
			shares: 'Tytuł, datę i ocenę końcową każdego dyplomu.',
			on: false
		},
		{
			label: 'Pokazuj moje oceny',
			shares: 'Każdy przeniesiony wynik z semestrem i punktami ECTS oraz średnie ważone.',
			on: true
		},
		{
			label: 'Pokazuj, co zrobiłem w EdMacie',
			shares:
				'Per przedmiot: ile zestawów ułożyłeś, ile lekcji oznaczyłeś jako zrobione, ile fiszek powtórzyłeś. Tylko liczby — nigdy które.',
			on: true
		}
	],
	settingsLinkLabel: 'Twoje własne ustawienia profilu',
	consentCaption:
		'Czwarty przełącznik jest nowy. Startuje wyłączony, a zdanie pod nim jest całością tego, co robi.',
	closing:
		'Rejestr za jeden semestr zamiast za wszystkie, rejestr widoczny dla prowadzących własnego kursu i rejestr do wydruku zostały na później. To, co jest, to jedno uczciwe podsumowanie na jednej stronie, pod czterema przełącznikami jego właściciela.',
	tryIt: [{ label: 'Wybierz, co pokazuje Twój profil', route: '/settings' }]
};

export function learningRecordShowcaseFor(locale: string): LearningRecordShowcase {
	return locale === 'pl' ? PL : EN;
}
