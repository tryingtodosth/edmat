// Tracks which exercises a visitor has viewed and which topics they view most — the two "tries to"
// personalization inputs for the Random Exercise picker (RandomExerciseButton.svelte /
// lib/services/exercises.ts's getRandomExercise). Browser-local only (localStorage), same honesty as
// guestSetStore/themeStore — there's no real backend to persist this to yet; once real accounts
// exist this naturally becomes a server-side signal instead (see getRandomExercise's own @mock note).

const STORAGE_KEY = 'edmat-browsing-history';

interface StoredHistory {
	seenIds: string[];
	topicAffinity: Record<string, number>;
}

function readStored(): StoredHistory {
	if (typeof window === 'undefined') return { seenIds: [], topicAffinity: {} };
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		if (parsed && Array.isArray(parsed.seenIds) && typeof parsed.topicAffinity === 'object') {
			return { seenIds: parsed.seenIds, topicAffinity: parsed.topicAffinity };
		}
	} catch {
		// localStorage/JSON can throw in a locked-down context — fall back silently.
	}
	return { seenIds: [], topicAffinity: {} };
}

function persist(history: StoredHistory) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
	} catch {
		// Best-effort only.
	}
}

const initial = readStored();
let seenIds = $state<string[]>(initial.seenIds);
let topicAffinity = $state<Record<string, number>>(initial.topicAffinity);

export const browsingHistoryStore = {
	get seenIds(): string[] {
		return seenIds;
	},
	get topicAffinity(): Record<string, number> {
		return topicAffinity;
	},
	/**
	 * Called once an exercise detail page finishes loading a real exercise — records the view and
	 * increments affinity for each of its topics. Idempotent on `seenIds` (won't re-add the same
	 * id), but deliberately NOT idempotent on `topicAffinity` — re-visiting the same exercise is a
	 * genuine second signal that the visitor cares about that topic, not a no-op. Switching content
	 * language on an already-loaded exercise does NOT call this again (see the exercise detail
	 * page's own `switchLocale` vs. `loadAll` split) — reading a translation of something you're
	 * already viewing isn't a second view.
	 */
	markSeen(exerciseId: string, topicIds: string[]): void {
		if (!seenIds.includes(exerciseId)) {
			seenIds = [...seenIds, exerciseId];
		}
		const next = { ...topicAffinity };
		for (const topicId of topicIds) {
			next[topicId] = (next[topicId] ?? 0) + 1;
		}
		topicAffinity = next;
		persist({ seenIds, topicAffinity });
	}
};
