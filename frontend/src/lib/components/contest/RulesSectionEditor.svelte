<script lang="ts">
	/** The regulamin editor: one block per paragraph, each carrying the guidance that says what
	 * belongs in it and the citations it rests on.
	 *
	 * The guidance is the point. A blank twelve-box form teaches nobody what §10 is for, and §10 —
	 * the personal-data clause with a legal basis per purpose and a retention period per purpose —
	 * is exactly the paragraph every amateur regulamin gets wrong. So every block shows the
	 * sentence from `presets.RULES_SECTIONS` in the reader's own language, and the article numbers
	 * beside it with their verification markers.
	 *
	 * **Saving and publishing are two acts.** Saving writes the sections; publishing freezes a
	 * numbered version, and a registration stores the number it accepted (KC art. 384), so a later
	 * edit can never retroactively become the rules somebody agreed to. The button says so.
	 */
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { lawMarkerLabel } from '$lib/utils/labels';
	import type { LawCitation, RulesSectionRow } from '$lib/types/contest';

	interface Props {
		sections: RulesSectionRow[];
		law: Record<string, LawCitation>;
		version: number;
		busy?: boolean;
		onsave: (sections: { key: string; order: number; body: string }[]) => Promise<void>;
		onpublish: () => Promise<void>;
	}

	let { sections, law, version, busy = false, onsave, onpublish }: Props = $props();

	let bodies = $state<Record<string, string>>({});
	let loadedFor = $state('');

	// The id-changed guard (frontend/CLAUDE.md trap 2), keyed on the set of sections AND the
	// version — publishing re-reads them and the editor must take the fresh text.
	$effect(() => {
		const key = `${version}:${sections.map((s) => s.id).join(',')}`;
		if (key === loadedFor) return;
		loadedFor = key;
		bodies = Object.fromEntries(sections.map((s) => [s.key, s.body]));
	});

	const locale = $derived(getLocale());

	function heading(section: RulesSectionRow): string {
		return locale === 'en' ? section.heading.en : section.heading.pl;
	}

	function guidance(section: RulesSectionRow): string {
		return locale === 'en' ? section.guidance.en : section.guidance.pl;
	}

	const emptyRequired = $derived(
		sections.filter((s) => s.required && !(bodies[s.key] ?? '').trim()).length
	);

	async function save() {
		await onsave(
			sections.map((s, index) => ({
				key: s.key,
				order: s.order ?? index,
				body: bodies[s.key] ?? ''
			}))
		);
	}
</script>

<div class="editor">
	<p class="state">
		{version > 0 ? m.contests_rulesVersionNow({ version }) : m.contests_rulesNeverPublished()}
		<!-- "Published version: {version}" / "This regulamin has never been published, so the contest cannot be announced." -->
		{#if emptyRequired > 0}
			· {m.contests_rulesEmptyRequired({ count: emptyRequired })}
			<!-- "{count} required paragraphs are still empty" -->
		{/if}
	</p>

	{#each sections as section (section.id)}
		<section class="block">
			<h4>{heading(section)}</h4>
			<p class="guidance">{guidance(section)}</p>
			{#if section.law.length}
				<ul class="law">
					{#each section.law as key (key)}
						{#if law[key]}
							<li>
								<span class="marker marker--{law[key].marker}">
									{lawMarkerLabel(law[key].marker)()}
								</span>
								<span>{law[key].citation}</span>
							</li>
						{/if}
					{/each}
				</ul>
			{/if}
			<label>
				<span class="sr-only">{heading(section)}</span>
				<textarea rows="5" bind:value={bodies[section.key]}></textarea>
			</label>
		</section>
	{/each}

	<div class="actions">
		<button type="button" class="primary" disabled={busy} onclick={save}>
			{m.contests_rulesSave()}
			<!-- "Save the text" -->
		</button>
		<button type="button" disabled={busy} onclick={onpublish}>
			{m.contests_rulesPublish()}
			<!-- "Publish as a new version" -->
		</button>
		<p class="hint">{m.contests_rulesPublishHint()}</p>
		<!-- "Publishing freezes the text as a numbered version. Everyone who enters after it stores the number they accepted, so a later edit can never become the rules they agreed to." -->
	</div>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.state {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.block {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		padding: 0.6rem 0.8rem;
	}
	h4 {
		margin: 0 0 0.2rem;
		font-size: var(--font-size-md);
	}
	.guidance {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.law {
		list-style: none;
		margin: 0 0 0.4rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.law li {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.marker {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0 0.3rem;
	}
	.marker--verified {
		border-color: var(--status-success);
		color: var(--status-success);
	}
	.marker--secondary {
		border-color: var(--status-info);
		color: var(--status-info);
	}
	.marker--unverified {
		border-color: var(--status-warning);
		color: var(--status-warning);
	}
	.marker--disputed {
		border-color: var(--status-danger);
		color: var(--status-danger);
	}
	textarea {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		resize: vertical;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	button {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		cursor: pointer;
	}
	button.primary {
		@include mix.button-primary;
	}
	button:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.hint {
		flex: 1 1 18rem;
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
