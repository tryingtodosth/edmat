// One batched request per page for every "AI-assisted" chip on it, shared by every component that
// draws one — the same split `pageDiscussions.svelte.ts` already uses, and for the same reason:
// the alternative is a request per row, and an exercise page draws a statement, several hints and
// solutions, a few reviews and a whole comment thread.
//
// A context rather than a module-level store, for the reason that file records: a module store
// survives a client-side navigation and would hand the next exercise the previous one's readings
// for a moment. A context dies with the component that set it.
//
// **Registration is in waves, deliberately.** The chips do not all mount at once: the statement is
// there on first paint, the reviews land with their own fetch, the thread lands after that. So
// components `register()` themselves whenever they appear and this holder coalesces whatever has
// arrived within a short window into one request, asking only for keys it does not already know.
// Two or three requests on a busy page, instead of twenty.
import { getContext, setContext } from 'svelte';
import { readingsFor } from '$lib/services/provenance';
import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
import type {
	AssistanceReading,
	AssistanceReadings,
	AssistanceTargetKind
} from '$lib/types/provenance';
import { assistanceKey } from '$lib/types/provenance';

const KEY = Symbol('ai-assistance');

/** Long enough for the chips of one fetched list to register together, short enough that nobody
 *  watches an empty space. */
const COALESCE_MS = 60;

export interface AiAssistance {
	reading(kind: AssistanceTargetKind, id: string): AssistanceReading | undefined;
	register(kind: AssistanceTargetKind, id: string): void;
	/** After a write: the endpoint answers with the whole new reading, so nothing re-fetches. */
	apply(reading: AssistanceReading): void;
}

class AiAssistanceState implements AiAssistance {
	private readings = $state<AssistanceReadings>({});
	private pending = new Set<string>();
	/** Every key already sent, answered or not. Plain, never reactive, and the reason this cannot
	 *  loop: the endpoint leaves out a target the reader may not see (a tombstoned comment), so its
	 *  key never lands in `readings` — and the chip's `$effect` reads `readings`, re-runs on every
	 *  flush, registers the same key again, and the page asked ~12 times a second until the
	 *  anonymous throttle locked the visitor out of the whole site for an hour (found by the
	 *  first-visitor audit, 2026-10-15, on `/exercises/1`). A key is asked for once per page. */
	private asked = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	reading(kind: AssistanceTargetKind, id: string): AssistanceReading | undefined {
		return this.readings[assistanceKey(kind, id)];
	}

	register(kind: AssistanceTargetKind, id: string) {
		// House rule 3's frontend half: with the switch off there is no chip to fill, so nothing is
		// asked for either. The endpoint would 403 an ordinary visitor anyway; not asking keeps a
		// killed feature from putting a failed request in everybody's console.
		if (!featureFlagsStore.isEnabled('ai_assisted')) return;
		if (!id) return;
		const key = assistanceKey(kind, id);
		if (this.asked.has(key) || this.readings[key] || this.pending.has(key)) return;
		this.pending.add(key);
		if (this.timer === null) this.timer = setTimeout(() => void this.flush(), COALESCE_MS);
	}

	apply(reading: AssistanceReading) {
		this.readings = { ...this.readings, [assistanceKey(reading.kind, reading.id)]: reading };
	}

	private async flush() {
		this.timer = null;
		const asking = [...this.pending];
		this.pending.clear();
		for (const key of asking) this.asked.add(key);
		if (asking.length === 0 || this.disposed) return;
		const targets = asking.map((key) => {
			const [kind, id] = key.split(':');
			return { kind: kind as AssistanceTargetKind, id };
		});
		try {
			const fetched = await readingsFor(targets);
			if (this.disposed) return;
			this.readings = { ...this.readings, ...fetched };
		} catch {
			// Swallowed on purpose, exactly as `pageDiscussions` swallows its own: there is nothing
			// sensible to show a reader about a badge request that did not come back, and the page's
			// content does not depend on it. The chips then draw nothing — the same thing they draw
			// when the feature is off.
		}
	}

	dispose() {
		this.disposed = true;
		if (this.timer !== null) clearTimeout(this.timer);
	}
}

/** Called once, during a page's init (`setContext` may only run then). The returned object is also
 *  what the page itself reads, for the rare case a route wants the reading it is drawing. */
export function provideAiAssistance(): AiAssistanceState {
	const state = new AiAssistanceState();
	setContext(KEY, state);
	return state;
}

/** `undefined` when no ancestor provided one — a chip rendered outside such a page draws nothing
 *  rather than throwing, so a component can be reused on a surface that has not opted in yet. */
export function useAiAssistance(): AiAssistance | undefined {
	return getContext<AiAssistance | undefined>(KEY);
}
