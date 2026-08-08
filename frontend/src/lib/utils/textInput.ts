// Text inputs that must not react to a keystroke the typist has not finished making.
//
// Two problems with one cause. An input method editor — how Chinese, Japanese and Korean are
// typed, and how the compose sequences on some Polish and Ukrainian layouts work — turns several
// keystrokes into one character. While that is happening the input's own `value` holds a partial,
// meaningless intermediate string, and **Enter means "accept the candidate I am looking at", not
// "submit"**. A handler that acts on either one acts on text nobody wrote. The visible symptom is
// specific and bad: a form that submits on Enter eats the first word of every IME user's input.
//
// So there are two guards here, because a handler keyed on a KEY and a handler keyed on the VALUE
// need different information:
//
//   * `isComposingKey` — for a handler that acts on a key (Enter adds a chip, Enter runs a search,
//     Escape closes a dialog). `KeyboardEvent.isComposing` is already true for every key delivered
//     mid-composition, so this needs no state of its own and is the cheaper check.
//   * `compositionTracker`, and `createSearchCommitter` built on it — for a handler that acts on
//     the value. An `input` event carries no reliable composition flag of its own, so the state has
//     to be tracked from `compositionstart`/`compositionend` around it.
//
// Deliberately plain functions rather than a Svelte action or a `.svelte.ts` rune module: nothing
// in here renders, so nothing in here needs to be reactive, and a closure is easier to reason
// about — and to test — than a store whose lifetime has to be kept in step with an element's.

/**
 * True when this key event is part of an in-progress IME composition and the handler should let it
 * pass untouched.
 *
 * The `keyCode === 229` arm is not redundant with `isComposing`. 229 is the "the IME swallowed this
 * key" sentinel, and some browsers report it on the keystroke that *opens* a composition, before
 * `isComposing` has flipped — so checking only the modern flag still lets the very first keystroke
 * of a composition through, which is precisely the one that gets eaten.
 */
export function isComposingKey(event: KeyboardEvent): boolean {
	return event.isComposing || event.keyCode === 229;
}

export interface CompositionTracker {
	/** True between `compositionstart` and `compositionend` — the window in which the input's value
	 *  is a candidate being chosen rather than anything the typist has committed to. */
	readonly active: boolean;
	start(): void;
	end(): void;
}

/** Composition state for one input. See `createSearchCommitter` for the usual consumer. */
export function compositionTracker(): CompositionTracker {
	let active = false;
	return {
		get active() {
			return active;
		},
		start() {
			active = true;
		},
		end() {
			active = false;
		}
	};
}

/** Trailing debounce for a browse search box. Long enough that a word typed at speed is one
 *  request, short enough that the results still feel like they answer the typing. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Below this many characters a query is treated as no query at all: one letter matches most of the
 *  corpus, so it is never a question worth a round trip. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

export interface SearchCommitter {
	/** What this committer last pushed through `commit`. A caller watching the committed value for
	 *  outside changes compares against this to tell a genuine one from its own echo. */
	readonly committed: string;
	/** Call from `oninput` with the input's current value. */
	typed(raw: string): void;
	/** Call from `oncompositionstart`. */
	compositionStart(): void;
	/** Call from `oncompositionend` with the input's current value. */
	compositionEnd(raw: string): void;
	/** The committed value was changed by somebody other than this box — Clear filters, or a
	 *  navigation resetting the whole filter object. Drop anything still waiting, since it is now
	 *  answering a question nobody is asking, and take `value` as the new baseline. */
	adopt(value: string): void;
}

/**
 * Turns a stream of keystrokes into the far smaller stream of questions actually worth asking.
 *
 * Three rules, and each exists because leaving it out is a visible defect:
 *
 *  * **Trailing debounce.** Undebounced, typing "całkowanie" is eleven requests, ten of them
 *    thrown away, and the results flicker through partial matches on the way.
 *  * **A minimum length, where anything shorter counts as no query.** Treating "too short" as ''
 *    rather than as a short query is what makes backspacing out of a search restore the full list,
 *    instead of leaving the results filtered by a word the box no longer shows.
 *  * **Nothing fires mid-composition.** An IME user pauses constantly while picking a candidate,
 *    and every one of those pauses is longer than the debounce — so without this guard the debounce
 *    makes the problem *worse*, faithfully searching for each half-formed intermediate string.
 *
 * What it deliberately does NOT do is guard against a stale response: whether an older, slower
 * request may still overwrite fresher results depends on how the caller holds its results, so it
 * belongs at the call site. In this codebase that is a `$effect` cleanup marking its own run
 * superseded.
 */
export function createSearchCommitter(
	commit: (query: string) => void,
	options: { delayMs?: number; minLength?: number; initial?: string } = {}
): SearchCommitter {
	const delayMs = options.delayMs ?? SEARCH_DEBOUNCE_MS;
	const minLength = options.minLength ?? SEARCH_MIN_QUERY_LENGTH;
	const composing = compositionTracker();

	let timer: ReturnType<typeof setTimeout> | undefined;
	let committed = options.initial ?? '';

	function schedule(raw: string) {
		clearTimeout(timer);
		const trimmed = raw.trim();
		const next = trimmed.length >= minLength ? trimmed : '';
		timer = setTimeout(() => {
			timer = undefined;
			// Re-typing your way back to the same question is not a new question. This is what keeps
			// a one-character query silent: it resolves to '', which is already what is committed.
			if (next === committed) return;
			committed = next;
			commit(next);
		}, delayMs);
	}

	return {
		get committed() {
			return committed;
		},
		typed(raw: string) {
			if (composing.active) return;
			schedule(raw);
		},
		compositionStart() {
			composing.start();
		},
		compositionEnd(raw: string) {
			composing.end();
			schedule(raw);
		},
		adopt(value: string) {
			clearTimeout(timer);
			timer = undefined;
			committed = value;
		}
	};
}
