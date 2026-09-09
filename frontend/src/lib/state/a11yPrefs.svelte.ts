/** Reading comfort (AUDIENCE-BRIEF.md §8): three text sizes and a high-contrast palette. A leaf
 * module like the theme store: applied to the root element as `data-text-size` /
 * `data-contrast` (the stylesheet does the rest), remembered in localStorage — restored before
 * first paint by app.html's inline script — and synced from the profile once one is known. */
export type TextSize = 'normal' | 'large' | 'larger';
export const TEXT_SIZES: TextSize[] = ['normal', 'large', 'larger'];
const SIZE_KEY = 'edmat.textSize';
const CONTRAST_KEY = 'edmat.highContrast';

function read<T>(key: string, ok: (v: string | null) => T): T {
	if (typeof localStorage === 'undefined') return ok(null);
	try {
		return ok(localStorage.getItem(key));
	} catch {
		return ok(null);
	}
}
function apply(size: TextSize, contrast: boolean) {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-text-size', size);
	if (contrast) document.documentElement.setAttribute('data-contrast', 'high');
	else document.documentElement.removeAttribute('data-contrast');
}

class A11yPrefsStore {
	textSize = $state<TextSize>(
		read(SIZE_KEY, (v) => (v === 'large' || v === 'larger' ? v : 'normal'))
	);
	highContrast = $state<boolean>(read(CONTRAST_KEY, (v) => v === '1'));

	setTextSize(size: TextSize) {
		this.textSize = size;
		try {
			localStorage.setItem(SIZE_KEY, size);
		} catch {
			/* blocked storage */
		}
		apply(this.textSize, this.highContrast);
	}
	cycleTextSize(): TextSize {
		const next = TEXT_SIZES[(TEXT_SIZES.indexOf(this.textSize) + 1) % TEXT_SIZES.length];
		this.setTextSize(next);
		return next;
	}
	setHighContrast(on: boolean) {
		this.highContrast = on;
		try {
			localStorage.setItem(CONTRAST_KEY, on ? '1' : '0');
		} catch {
			/* blocked storage */
		}
		apply(this.textSize, this.highContrast);
	}
	syncFromProfile(size: TextSize | undefined, contrast: boolean | undefined) {
		if (size) this.setTextSize(size);
		if (contrast !== undefined) this.setHighContrast(contrast);
	}
	/** Re-apply what is stored (the root layout calls this once on mount). */
	applyStored() {
		apply(this.textSize, this.highContrast);
	}
}
export const a11yPrefsStore = new A11yPrefsStore();
