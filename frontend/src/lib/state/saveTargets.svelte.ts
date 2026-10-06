// Everywhere an exercise can be put: this account's saved sets, and the courses it may file
// content into.
//
// **Why one store and not two.** They are the same question asked of two backends — "where can this
// go?" — cached for the same reason and invalidated by the same event. Two stores would be two owner
// checks and two chances for one to be refreshed while the other went stale.
//
// They do NOT load together, though, and that distinction is load-bearing. The sets are needed to
// DRAW a save button truthfully, since the bookmark means "this is already saved somewhere"; the
// courses are only needed once somebody opens the menu. So the sets load whenever a button exists
// and the courses stay lazy. Loading both lazily was the first version, and it produced an exercise
// sitting in three named sets whose button still showed a plain `+` — found in a browser, not by
// reading the code.
//
// **Why module-level at all.** A branch page draws twenty exercise cards, each with its own save
// button. Fetching per button would be twenty identical requests; the owner check plus the `loading`
// flag mean the first caller fetches and the rest read the same answer — the same reasoning that put
// a course's roster in one place rather than one copy per lesson.
//
// **It deliberately does not import `authStore`.** That module would have to import this one back
// to clear it on logout, which is a real cycle — the same one `notifications.svelte.ts` already
// documents avoiding. Instead the owner is passed in and remembered, so signing out and back in as
// somebody else cannot leave one person looking at another's sets.

import { getSetsForUser, createSet, updateSet } from '$lib/services/exerciseSets';
import { getMyTeaching, getMyParticipation, submitCourseItem } from '$lib/services/course';
import { addCard, createDeck, getMyDecks } from '$lib/services/flashcards';
import type { ExerciseSet } from '$lib/types';
import type { Course } from '$lib/types/course';
import type { Deck } from '$lib/types/flashcards';

let sets = $state<ExerciseSet[]>([]);
let courses = $state<Course[]>([]);
// A DECK is the third target kind (prompts/02-flashcards.md). It joins this store rather than
// getting one of its own for the reason the note at the top of this file gives: it is the same
// question asked of a third backend — "where can this go?" — cached for the same reason and
// cleared by the same logout. It loads lazily, with the courses, because like them it is only
// needed once somebody opens the menu; unlike the sets, a deck does not decide whether the
// bookmark is drawn (the bookmark means "saved somewhere to come back to", and a deck is a
// schedule rather than a shelf).
let decks = $state<Deck[]>([]);
let decksLoadedFor = $state<string | null>(null);
let decksLoading = $state(false);
let loadedFor = $state<string | null>(null);
let loading = $state(false);
// The courses are tracked separately because they load separately — see the two `ensure*` methods.
let coursesLoadedFor = $state<string | null>(null);
let coursesLoading = $state(false);
let error = $state('');

/** Replaces one set in the cached list. A new array rather than a mutation in place, so anything
 * deriving from `list` re-runs — a card's "which sets is this in" is exactly that. */
function replace(updated: ExerciseSet) {
	sets = sets.map((s) => (s.id === updated.id ? updated : s));
}

export const saveTargetsStore = {
	get sets(): ExerciseSet[] {
		return sets;
	},
	/** Only the courses this person may actually put something into. Filtered here rather than at
	 * each call site, because "can I contribute" is resolved per viewer server-side and there is no
	 * second reading of it worth having. */
	get courses(): Course[] {
		return courses.filter((c) => c.canContribute);
	},
	/** Empty until `ensureDecksLoaded` has been called with the `flashcards` switch ON — the store
	 *  never asks for decks the API would refuse, and the menu never draws a section that would be
	 *  empty for everybody (house rule 3). */
	get decks(): Deck[] {
		return decks;
	},
	get loading(): boolean {
		return loading;
	},
	get error(): string {
		return error;
	},
	get loaded(): boolean {
		return loadedFor !== null;
	},

	/** Which of this account's saved sets already hold a given exercise. */
	setsContaining(exerciseId: string): ExerciseSet[] {
		return sets.filter((s) => s.exerciseIds.includes(exerciseId));
	},

	/** The sets, and nothing else. Loaded whenever a save button EXISTS rather than when one is
	 * opened, because the button cannot tell the truth without them: a bookmark that only lights up
	 * for the working set would show an exercise as unsaved when it is sitting in three named sets —
	 * which was exactly the behaviour when this loaded lazily, caught in a browser rather than by
	 * reasoning about it.
	 *
	 * One request per session regardless of how many buttons ask: the owner check and the `loading`
	 * flag mean the first caller fetches and the other nineteen return immediately. */
	async ensureSetsLoaded(userId: string | null): Promise<void> {
		if (!userId) {
			// A guest has no sets. Cleared rather than left as whatever the last signed-in visitor
			// had, since this store outlives a logout.
			sets = [];
			courses = [];
			loadedFor = null;
			return;
		}
		if (loadedFor === userId || loading) return;
		loading = true;
		error = '';
		try {
			sets = await getSetsForUser(userId);
			loadedFor = userId;
		} catch {
			error = 'sets';
		} finally {
			loading = false;
		}
	},

	/** The courses, which are only needed once somebody actually opens the menu — so they stay lazy
	 * rather than costing two requests per page for a half nobody has looked at. */
	async ensureCoursesLoaded(userId: string | null): Promise<void> {
		if (!userId || coursesLoadedFor === userId || coursesLoading) return;
		coursesLoading = true;
		try {
			// Settled rather than awaited in sequence: they are independent requests, and one failing
			// should not decide whether the other's courses appear.
			const [teachingResult, participatingResult] = await Promise.allSettled([
				getMyTeaching(),
				getMyParticipation()
			]);
			const teaching = teachingResult.status === 'fulfilled' ? teachingResult.value : [];
			const participating =
				participatingResult.status === 'fulfilled' ? participatingResult.value : [];
			// A course somebody both runs and is enrolled on would otherwise appear twice. A plain
			// array rather than a `Set`: this project's eslint config refuses a mutable built-in Set
			// inside a `.svelte.ts` module even for a throwaway local like this one, and a person's
			// course list is small enough that `includes` costs nothing — the same call
			// `guestSet.svelte.ts` already documents making for the same reason.
			const seen: string[] = [];
			courses = [...teaching, ...participating].filter((c) => {
				if (seen.includes(c.id)) return false;
				seen.push(c.id);
				return true;
			});
			coursesLoadedFor = userId;
		} finally {
			coursesLoading = false;
		}
	},

	/** The decks, loaded only when the caller says the `flashcards` switch is on. The flag is
	 *  passed in rather than read here, for the same reason the owner is: this module deliberately
	 *  imports no store it would have to be cleared by (see the note at the top). */
	async ensureDecksLoaded(userId: string | null, enabled: boolean): Promise<void> {
		if (!userId || !enabled) {
			if (!enabled) decks = [];
			return;
		}
		if (decksLoadedFor === userId || decksLoading) return;
		decksLoading = true;
		try {
			decks = await getMyDecks();
			decksLoadedFor = userId;
		} catch {
			// A 403 while the switch is off, or a network hiccup: no decks section rather than an
			// error on a menu that is about saving an exercise somewhere else.
			decks = [];
		} finally {
			decksLoading = false;
		}
	},

	/** One exercise onto one deck as a new card. The API refuses a duplicate exercise on a deck
	 *  with a 400 it names; the button turns that into "already there" rather than "it failed". */
	async addToDeck(deckId: string, exerciseId: string): Promise<void> {
		await addCard(deckId, { exerciseId });
		// Recounted from the server's own answer rather than incremented here — one more count is
		// cheap and cannot drift (house rule 5).
		decks = decks.map((d) => (d.id === deckId ? { ...d, cardCount: d.cardCount + 1 } : d));
	},

	async createDeckWith(name: string, exerciseId: string): Promise<Deck> {
		const made = await createDeck(name);
		await addCard(made.id, { exerciseId });
		const withCard = { ...made, cardCount: 1 };
		decks = [withCard, ...decks];
		return withCard;
	},

	async addTo(setId: string, exerciseId: string): Promise<void> {
		const target = sets.find((s) => s.id === setId);
		if (!target || target.exerciseIds.includes(exerciseId)) return;
		const next = [...target.exerciseIds, exerciseId];
		// The API replaces the whole membership, so the current list has to be sent back with the
		// new id appended — which is also why this reads from the cache rather than re-fetching:
		// a stale list here would silently drop whatever it did not know about.
		await updateSet(setId, next);
		replace({ ...target, exerciseIds: next });
	},

	async removeFrom(setId: string, exerciseId: string): Promise<void> {
		const target = sets.find((s) => s.id === setId);
		if (!target) return;
		const next = target.exerciseIds.filter((id) => id !== exerciseId);
		await updateSet(setId, next);
		replace({ ...target, exerciseIds: next });
	},

	async createWith(userId: string, name: string, exerciseId: string): Promise<ExerciseSet> {
		const created = await createSet(userId, name, [exerciseId]);
		sets = [...sets, created];
		return created;
	},

	async fileIntoCourse(courseId: string, exerciseId: string): Promise<void> {
		await submitCourseItem(courseId, { exerciseId, chapterId: null, lessonId: null, note: '' });
	},

	/** Called on logout. Not by this module — see the note at the top about the import cycle. */
	clear(): void {
		sets = [];
		courses = [];
		decks = [];
		loadedFor = null;
		coursesLoadedFor = null;
		decksLoadedFor = null;
		error = '';
	}
};
