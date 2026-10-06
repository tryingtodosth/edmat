/**
 * The user manual at `/about/guide`: its chapter list, and the hub's own text.
 *
 * `GUIDE_CHAPTERS` is the single source of what exists. The hub lists it, the chapter route
 * resolves a slug through it, `svelte.config.js` prerenders one page per slug, and
 * `deploy/fuw/pack.sh` checks they are all in the build. Adding a chapter is: a file beside this
 * one, an entry here, a line in `svelte.config.js`, and a word to whoever maintains `pack.sh`.
 *
 * `flag` is the kill switch for the surface a chapter describes. A killed feature's chapter still
 * renders — it is prose, and a reader is entitled to know what the site can do — but the hub says
 * the feature is off here, which is the honest version of house rule 3 for a page that is only
 * writing. `null` is for the chapters that describe things no switch can remove.
 */
import type { FeatureFlagKey } from '$lib/types';
import type { GuideChapterDoc } from './types';
import { startChapterFor } from './start';
import { exercisesChapterFor } from './exercises';
import { submitChapterFor } from './submit';
import { coursesChapterFor } from './courses';
import { eventsChapterFor } from './events';
import { tutoringChapterFor } from './tutoring';
import { conceptsChapterFor } from './concepts';
import { helpChapterFor } from './help';
import { messagesChapterFor } from './messages';
import { moderationChapterFor } from './moderation';
import { flashcardsChapterFor } from './flashcards';

export interface GuideChapterEntry {
	/** The URL segment: `/about/guide/<slug>`. */
	slug: string;
	titleFor(locale: string): string;
	/** The whole chapter, in one language. */
	docFor(locale: string): GuideChapterDoc;
	/** One line for the hub's list. */
	blurbFor(locale: string): string;
	/** A design showcase page under `/about/` that draws the same thing from sample data. */
	showcase?: string;
	/** The kill switch for the surface described here, or `null` if there is none. */
	flag: FeatureFlagKey | null;
	/** True while the chapter is a placeholder (the screens do not exist yet). */
	pending?: boolean;
}

const BLURBS: Record<string, { en: string; pl: string }> = {
	start: {
		en: 'The front page, the bar, your language, and what an account changes.',
		pl: 'Strona główna, pasek, język i to, co zmienia konto.'
	},
	exercises: {
		en: 'Browsing to an exercise, revealing the solution, and building a set you can print.',
		pl: 'Droga do zadania, odsłanianie rozwiązania i składanie zestawu do druku.'
	},
	submit: {
		en: 'Adding an exercise or a material, and what review does with it.',
		pl: 'Dodawanie zadania albo materiału i co robi z nim sprawdzanie.'
	},
	courses: {
		en: 'Joining a course, and running one: chapters, lessons, people.',
		pl: 'Dołączanie do kursu i prowadzenie go: rozdziały, lekcje, ludzie.'
	},
	events: {
		en: 'Announcing a one-off, its programme, and registering for it.',
		pl: 'Ogłaszanie wydarzenia, jego program i zapisy.'
	},
	tutoring: {
		en: 'Listings, free hours, and asking for one.',
		pl: 'Ogłoszenia, wolne godziny i prośba o godzinę.'
	},
	concepts: {
		en: 'One idea, an article per kind of reader, and what to learn first.',
		pl: 'Jedna idea, artykuł na rodzaj czytelnika i co trzeba wiedzieć wcześniej.'
	},
	help: {
		en: 'What needs doing, and who is offering to do it.',
		pl: 'Co jest do zrobienia i kto chce to zrobić.'
	},
	messages: {
		en: 'The inbox, writing to somebody, and the notification list.',
		pl: 'Skrzynka, pisanie do kogoś i lista powiadomień.'
	},
	moderation: {
		en: 'The queues, the reports, and the switches — for the people who have them.',
		pl: 'Kolejki, zgłoszenia i wyłączniki — dla tych, którzy je mają.'
	},
	flashcards: {
		en: 'Not written yet — the design is at /about/flashcards.',
		pl: 'Jeszcze nienapisane — projekt jest pod /about/flashcards.'
	}
};

function entry(
	slug: string,
	docFor: (locale: string) => GuideChapterDoc,
	flag: FeatureFlagKey | null,
	extra: { showcase?: string; pending?: boolean } = {}
): GuideChapterEntry {
	return {
		slug,
		docFor,
		titleFor: (locale: string) => docFor(locale).title,
		blurbFor: (locale: string) => (locale === 'en' ? BLURBS[slug].en : BLURBS[slug].pl),
		flag,
		...extra
	};
}

export const GUIDE_CHAPTERS: GuideChapterEntry[] = [
	entry('start', startChapterFor, null),
	entry('exercises', exercisesChapterFor, null, { showcase: '/about/exercises' }),
	entry('submit', submitChapterFor, 'exercise_submissions'),
	entry('courses', coursesChapterFor, 'courses', { showcase: '/about/courses' }),
	entry('events', eventsChapterFor, 'events', { showcase: '/about/events' }),
	entry('tutoring', tutoringChapterFor, 'tutoring'),
	entry('concepts', conceptsChapterFor, 'concepts', { showcase: '/about/concepts' }),
	entry('help', helpChapterFor, 'needs'),
	entry('messages', messagesChapterFor, 'messaging'),
	entry('moderation', moderationChapterFor, null),
	entry('flashcards', flashcardsChapterFor, 'flashcards', {
		showcase: '/about/flashcards',
		pending: true
	})
];

export function chapterBySlug(slug: string): GuideChapterEntry | undefined {
	return GUIDE_CHAPTERS.find((chapter) => chapter.slug === slug);
}

// ---- the hub's own text -------------------------------------------------------------------------

export interface GuideHubDoc {
	title: string;
	eyebrow: string;
	lead: string[];
	chaptersHeading: string;
	/** What this manual does NOT cover, said out loud rather than left to be discovered. */
	gaps: { heading: string; body: string; items: string[] };
}

const HUB_EN: GuideHubDoc = {
	title: 'How to use EdMat',
	eyebrow: 'The manual',
	lead: [
		'One chapter per thing a person does here, each written against the screens as they actually are — every picture in this manual is a screenshot of the running site, taken by a script, not a drawing.',
		'Nothing here needs to be read in order. If you are new, "Getting started" is the five minutes before an account.'
	],
	chaptersHeading: 'Chapters',
	gaps: {
		heading: 'Not written yet',
		body: 'These parts of the site are real and working; they simply have no chapter here. Listed so that nobody takes the silence for an absence.',
		items: [
			'Flashcards — being built now; the design is at /about/flashcards.',
			'Your learning record and what a profile shows about you.',
			'Co-authoring a material: versions, a team, an invite link.',
			'Organisations, tasks, plans, decisions and the work dashboard.',
			'The conference desks: tickets, the cloakroom, the shifts rota, rooms and buildings.',
			'The activity feed, reporting content, and the legal notice channel.'
		]
	}
};

const HUB_PL: GuideHubDoc = {
	title: 'Jak korzystać z EdMatu',
	eyebrow: 'Podręcznik',
	lead: [
		'Jeden rozdział na jedną rzecz, którą się tu robi, każdy napisany pod ekrany takie, jakie naprawdę są — każdy obrazek w tym podręczniku to zrzut działającego serwisu zrobiony skryptem, a nie rysunek.',
		'Nic tu nie musi być czytane po kolei. Jeśli jesteś tu pierwszy raz, „Pierwsze kroki” to pięć minut przed założeniem konta.'
	],
	chaptersHeading: 'Rozdziały',
	gaps: {
		heading: 'Jeszcze nieopisane',
		body: 'Te części serwisu istnieją i działają; po prostu nie mają jeszcze rozdziału. Wypisane po to, żeby nikt nie wziął milczenia za brak.',
		items: [
			'Fiszki — właśnie powstają; projekt jest pod /about/flashcards.',
			'Twój zapis nauki i to, co profil o Tobie pokazuje.',
			'Współtworzenie materiału: wersje, zespół, link zapraszający.',
			'Organizacje, zadania, plany, decyzje i panel pracy.',
			'Stanowiska konferencyjne: bilety, szatnia, grafik dyżurów, sale i budynki.',
			'Strumień aktywności, zgłaszanie treści i kanał zgłoszeń prawnych.'
		]
	}
};

export function guideHubFor(locale: string): GuideHubDoc {
	return locale === 'en' ? HUB_EN : HUB_PL;
}
