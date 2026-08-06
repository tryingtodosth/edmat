<script lang="ts">
	// A real tab list: ARIA roles, a roving tabindex, Left/Right/Home/End, and the active tab in the
	// URL so a reload keeps your place, the back button steps between tabs, and a link to one can be
	// sent to somebody.
	//
	// Extracted from the homepage, which had all of this inline. None of it is decoration —
	// `role="tablist"` is a promise to a screen-reader user that arrow keys work, and a tab list
	// that does not answer them is a page that lied about what it is. That is exactly the kind of
	// subtle thing that rots when it exists in two copies, which is why this is one component rather
	// than a second implementation on the course page.
	//
	// The panel is NOT rendered here. Callers own their own `{#if}` per tab, because each panel
	// loads its own data and a snippet-per-tab prop would make that harder to read, not easier.

	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	export interface TabDef {
		id: string;
		label: string;
		/** Optional count shown beside the label — a pending queue nobody is told about stalls. */
		badge?: number;
	}

	let {
		tabs,
		active,
		/** The tab whose URL is the bare page, with no `?tab=` at all. Usually the first. */
		defaultTab,
		/** Query parameter name, so two tab lists could coexist on one page if it ever came to that. */
		param = 'tab',
		idPrefix = 'tab',
		/** Must match the id the CALLER gives its panel — the panel is rendered by the caller, since
		 * each one loads its own data and a snippet-per-tab prop would obscure that. */
		panelPrefix = 'tabpanel',
		ariaLabel = undefined
	}: {
		tabs: TabDef[];
		active: string;
		defaultTab: string;
		param?: string;
		idPrefix?: string;
		panelPrefix?: string;
		ariaLabel?: string;
	} = $props();

	function select(id: string) {
		// Built from the live URL rather than from `resolve()`, deliberately: the locale prefix and
		// any other query parameters already on the page have to survive a tab switch, and only the
		// current URL knows what they are. `resolve` cannot express "this page, one parameter
		// changed", which is why the rule is suppressed rather than worked around.
		const url = new URL(page.url);
		if (id === defaultTab) url.searchParams.delete(param);
		else url.searchParams.set(param, id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, one query parameter changed
		goto(url, { keepFocus: true, noScroll: true });
	}

	function onKeydown(event: KeyboardEvent) {
		const ids = tabs.map((t) => t.id);
		const at = ids.indexOf(active);
		let next: number | null = null;
		if (event.key === 'ArrowRight') next = (at + 1) % ids.length;
		else if (event.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = ids.length - 1;
		if (next === null) return;
		event.preventDefault();
		const target = ids[next];
		select(target);
		// Focus follows selection, as it must in an automatically-activated tab list — otherwise the
		// arrow key moves the panel and leaves focus behind on a tab that is no longer selected.
		document.getElementById(`${idPrefix}-${target}`)?.focus();
	}
</script>

<!-- `tabindex="-1"` on the list itself, with the roving tabindex on the tabs: the container must not
     be its own stop in the tab order, or reaching the panel takes two extra presses. -->
<div class="tabs" role="tablist" tabindex="-1" aria-label={ariaLabel} onkeydown={onKeydown}>
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			role="tab"
			id="{idPrefix}-{tab.id}"
			aria-selected={active === tab.id}
			aria-controls="{panelPrefix}-{tab.id}"
			tabindex={active === tab.id ? 0 : -1}
			class:active={active === tab.id}
			onclick={() => select(tab.id)}
		>
			{tab.label}
			{#if tab.badge}<span class="tabs__badge">{tab.badge}</span>{/if}
		</button>
	{/each}
</div>

<style lang="scss">
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
		/* Scrolls rather than wrapping: a wrapped tab row reads as two rows of unrelated buttons. */
		overflow-x: auto;
	}
	.tabs button {
		background: none;
		border: none;
		padding: var(--space-2) var(--space-1);
		font-weight: 600;
		color: var(--text-secondary);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.tabs button.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.tabs__badge {
		background: var(--accent);
		color: var(--accent-contrast);
		border-radius: var(--radius-sm);
		padding: 0 0.35rem;
		font-size: var(--font-size-xs);
	}
</style>
