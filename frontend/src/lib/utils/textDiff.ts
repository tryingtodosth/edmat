// A word-level text diff, in-house, for the co-authoring version page ("what changed against the
// version this one was written against"). No dependency: the whole job is one longest-common-
// subsequence table over word tokens, and a diff library would be a second copy of the same
// thirty lines plus options nobody here needs.
//
// Loaded on demand (root CLAUDE.md house rule 11): only the version page imports it, and only once
// it has two versions to compare. Nothing in the layout tree may import it statically.

/** One run of the result. Joining every `same` + `removed` text gives back the old text exactly,
 *  and every `same` + `added` text the new one — nothing is normalised away. */
export interface DiffPart {
	type: 'same' | 'added' | 'removed';
	text: string;
}

/** Past this many tokens per side (words and the whitespace between them each count as one) the
 *  comparison is refused rather than attempted: the table is tokens × tokens entries, and 4000 ×
 *  4000 is already ~32 MB for a moment. Counted AFTER the common beginning and end are set aside,
 *  so a long text with one corrected word in the middle still compares. */
export const MAX_DIFF_TOKENS = 4000;

/**
 * Compare two texts word by word.
 *
 * Returns the runs in reading order, or `null` when the part that differs is too long to compare
 * (see `MAX_DIFF_TOKENS`) — the caller says so rather than showing a partial answer. Whitespace is
 * kept as its own tokens, so a changed paragraph break is a change and the raw source (Markdown,
 * LaTeX, HTML) is compared exactly as it is stored.
 */
export function diffWords(before: string, after: string): DiffPart[] | null {
	const a = tokenize(before);
	const b = tokenize(after);

	// Most edits touch one place, and everything before and after it is identical: setting those
	// runs aside first keeps the table the size of the edit rather than the size of the document.
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	if (endA - start > MAX_DIFF_TOKENS || endB - start > MAX_DIFF_TOKENS) return null;

	const parts: DiffPart[] = [];
	push(parts, 'same', a.slice(0, start).join(''));
	for (const part of middle(a.slice(start, endA), b.slice(start, endB))) {
		push(parts, part.type, part.text);
	}
	push(parts, 'same', a.slice(endA).join(''));
	return tidy(parts);
}

/** Alternating runs of whitespace and non-whitespace; joined back together they are the input. */
function tokenize(text: string): string[] {
	return text.match(/\s+|\S+/g) ?? [];
}

/** Appends, merging into the previous run when it is the same kind. Empty text is dropped. */
function push(parts: DiffPart[], type: DiffPart['type'], text: string) {
	if (!text) return;
	const last = parts[parts.length - 1];
	if (last && last.type === type) last.text += text;
	else parts.push({ type, text });
}

/** The classic LCS walk over the part that differs. The table holds, for every pair of positions,
 *  the length of the longest common subsequence of the two suffixes starting there, so the walk
 *  can run forwards and emit the runs in reading order. */
function middle(a: string[], b: string[]): DiffPart[] {
	const out: DiffPart[] = [];
	const n = a.length;
	const m = b.length;
	if (n === 0 || m === 0) {
		push(out, 'removed', a.join(''));
		push(out, 'added', b.join(''));
		return out;
	}

	const width = m + 1;
	// Uint16 is enough: an entry never exceeds MAX_DIFF_TOKENS.
	const table = new Uint16Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		const row = i * width;
		const below = row + width;
		for (let j = m - 1; j >= 0; j--) {
			table[row + j] =
				a[i] === b[j] ? table[below + j + 1] + 1 : Math.max(table[below + j], table[row + j + 1]);
		}
	}

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push(out, 'same', a[i]);
			i++;
			j++;
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
			push(out, 'removed', a[i]);
			i++;
		} else {
			push(out, 'added', b[j]);
			j++;
		}
	}
	while (i < n) push(out, 'removed', a[i++]);
	while (j < m) push(out, 'added', b[j++]);
	return out;
}

/**
 * Makes the result readable without changing what it says.
 *
 * A word-level LCS happily keeps the single spaces between two rewritten phrases as "unchanged",
 * which turns "a b c" → "x y z" into six fragments. A whitespace-only run sitting inside a
 * replacement (removed AND added text before it, more changes right after) is folded into BOTH
 * sides instead, so the replacement reads as one phrase struck out and one phrase put in. Within
 * every change the removed text comes first. Both reconstructions stay exact: the folded
 * whitespace lands in the old text and in the new one.
 */
function tidy(parts: DiffPart[]): DiffPart[] {
	const out: DiffPart[] = [];
	let removed = '';
	let added = '';
	const flush = () => {
		push(out, 'removed', removed);
		push(out, 'added', added);
		removed = '';
		added = '';
	};
	parts.forEach((part, index) => {
		if (part.type === 'removed') {
			removed += part.text;
		} else if (part.type === 'added') {
			added += part.text;
		} else {
			const next = parts[index + 1];
			if (removed && added && next && next.type !== 'same' && /^\s+$/.test(part.text)) {
				removed += part.text;
				added += part.text;
				return;
			}
			flush();
			push(out, 'same', part.text);
		}
	});
	flush();
	return out;
}
