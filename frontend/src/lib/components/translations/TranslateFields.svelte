<script lang="ts">
	// The translate interface the owner asked for on 2026-10-08: *"side by side original and the
	// translation (up and bottom for mobiles), so that if a user translates and edit/update/new
	// content, there's no sth like 'newer in PL by 4 minutes'"*.
	//
	// **It is one form, not two.** Both languages are written in one submission, which is the whole
	// point: the backend stamps a single timestamp across everything this sends, so the two are
	// exactly as new as each other and `LanguageNote` has nothing to report. An editor that saved
	// one language at a time would MANUFACTURE the staleness it exists to avoid.
	//
	// It is also the EDIT form, not an extra step after one. The meatballs "Edit" on a plan, a need
	// or a poll opens this, so writing a change and translating it are the same action — the owner's
	// reason for asking for the two things in one breath.
	//
	// Side by side above 800px and stacked below it, through a container-less media query rather
	// than a container query: the panels this sits in are already narrow columns on a phone, and the
	// viewport is what decides whether two columns of prose fit.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, locales } from '$lib/paraglide/runtime';
	import { writeTextVersions, type WrittenText } from '$lib/services/textVersions';
	import type { TextVersion, TranslatableKind } from '$lib/types/translation';

	let {
		kind,
		id,
		versions,
		fallbackHeading = '',
		fallbackBody = '',
		withBody = true,
		withHeading = true,
		headingLabel,
		bodyLabel,
		onSaved,
		onCancel
	}: {
		kind: TranslatableKind;
		id: string;
		/** What has already been written. Empty for every row from before this existed. */
		versions: TextVersion[];
		/** The row's own column, used to seed the original pane when nothing has been written yet —
		 *  so an existing row opens with its current text rather than blank, and the person edits
		 *  what they can see. */
		fallbackHeading?: string;
		fallbackBody?: string;
		/** False for a poll option, which is one line of text and has no body. */
		withBody?: boolean;
		/** False for an organisation, which has a description and no translatable heading — its
		 *  `name` is a registered name and the same in every language. The two flags are mirror
		 *  images and the registry (`backend/translations/targets.py`) is where each kind's pair of
		 *  fields is actually decided; this just draws what it is told. */
		withHeading?: boolean;
		headingLabel: string;
		bodyLabel?: string;
		onSaved: (written: WrittenText) => void;
		onCancel: () => void;
	} = $props();

	type Draft = { heading: string; body: string };

	// The interface locales, which are the languages this editor offers. A third one needs a
	// Paraglide catalogue and appears here on its own — `locale` is a free string server-side, so
	// nothing below is capped at two.
	const choices = [...locales];

	/** Which language this was WRITTEN in, which pane is the translation, and one draft per
	 *  language — all three settled ONCE, by the effect below.
	 *
	 *  Seeded in an effect rather than in the `$state(…)` initialisers because reading a prop or a
	 *  `$derived` there captures only its first value, which `svelte-check` says out loud
	 *  (`state_referenced_locally`) and which this project holds at zero warnings. Drafts are kept
	 *  for EVERY language, not just the two on screen, so switching a pane never loses typing. */
	let originalLocale = $state('');
	let otherLocale = $state('');
	let drafts = $state<Record<string, Draft>>({});
	let seeded = $state(false);

	$effect(() => {
		if (seeded) return;
		seeded = true;
		const written = versions.find((version) => version.isOriginal);
		// For a row that has never been through here: `pl`, the project's base locale and the
		// language the seeded management content actually is — never the reader's own, which would
		// relabel somebody else's Polish as English the first time an English reader opened this.
		const original = written?.locale || 'pl';
		const reader = getLocale();
		originalLocale = original;
		otherLocale = reader !== original ? reader : (choices.find((c) => c !== original) ?? '');

		const existing = new Map(versions.map((version) => [version.locale, version]));
		const next: Record<string, Draft> = {};
		for (const choice of choices) {
			const version = existing.get(choice);
			next[choice] = { heading: version?.heading ?? '', body: version?.body ?? '' };
		}
		if (!written) {
			// Nothing written yet: the original pane opens with the row's own text, so the person
			// edits what they can already see rather than a blank box.
			next[original] = { heading: fallbackHeading, body: fallbackBody };
		}
		drafts = next;
	});

	/** Changing which language is the original. Handled here rather than by a second `$effect`
	 *  keeping the two in step: an effect that reads the state it writes re-runs itself
	 *  (frontend/CLAUDE.md trap 4), and the fix it names is to do it in the event handler. */
	function chooseOriginal(locale: string) {
		originalLocale = locale;
		if (otherLocale === locale) {
			otherLocale = choices.find((choice) => choice !== locale) ?? '';
		}
	}

	let busy = $state(false);
	let error = $state<string | null>(null);

	const originalDraft = $derived(drafts[originalLocale] ?? { heading: '', body: '' });
	const otherDraft = $derived(drafts[otherLocale] ?? { heading: '', body: '' });
	// The same rule the server applies: say SOMETHING in the language you wrote it in — the heading
	// when there is one, the body when there is not (`translations/services.py`).
	const canSave = $derived(
		!busy &&
			(withHeading ? originalDraft.heading.trim().length > 0 : originalDraft.body.trim().length > 0)
	);
	// Said plainly rather than left to be discovered: this is the state the whole feature exists to
	// avoid, and it is avoidable right here, in this form.
	const otherEmpty = $derived(
		otherLocale !== '' && (withHeading ? otherDraft.heading : otherDraft.body).trim().length === 0
	);

	function update(locale: string, field: keyof Draft, value: string) {
		drafts = {
			...drafts,
			[locale]: { ...(drafts[locale] ?? { heading: '', body: '' }), [field]: value }
		};
	}

	async function save() {
		busy = true;
		error = null;
		try {
			// BOTH panes in one call, always — including an emptied one, which the server reads as
			// "take that translation down" rather than as an omission.
			const shape = (draft: Draft) => ({
				...(withHeading ? { heading: draft.heading } : {}),
				...(withBody ? { body: draft.body } : {})
			});
			const payload: Record<string, { heading?: string; body?: string }> = {
				[originalLocale]: shape(originalDraft)
			};
			if (otherLocale) payload[otherLocale] = shape(otherDraft);
			onSaved(await writeTextVersions(kind, id, originalLocale, payload));
		} catch {
			error = m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	const upper = (locale: string) => locale.toUpperCase();
</script>

<form class="translate" onsubmit={(event) => (event.preventDefault(), save())}>
	<p class="intro">{m.translate_intro()}</p>
	<!-- "Write both languages here. Sent together, they stay equally up to date — so nobody is ever told one of them is newer than the other." -->

	<div class="panes">
		<section class="pane">
			<header class="pane__head">
				<label class="pane__locale">
					<span>{m.translate_originalLanguage()}</span>
					<!-- "Written in" -->
					<select
						value={originalLocale}
						onchange={(event) => chooseOriginal(event.currentTarget.value)}
						disabled={busy}
					>
						{#each choices as choice (choice)}
							<option value={choice}>{upper(choice)}</option>
						{/each}
					</select>
				</label>
			</header>
			{#if withHeading}
				<label class="field">
					<span>{headingLabel}</span>
					<input
						type="text"
						value={originalDraft.heading}
						oninput={(event) => update(originalLocale, 'heading', event.currentTarget.value)}
						disabled={busy}
						required
					/>
				</label>
			{/if}
			{#if withBody && bodyLabel}
				<label class="field field--grow">
					<span>{bodyLabel}</span>
					<textarea
						rows="8"
						value={originalDraft.body}
						oninput={(event) => update(originalLocale, 'body', event.currentTarget.value)}
						disabled={busy}></textarea>
				</label>
			{/if}
		</section>

		{#if otherLocale}
			<section class="pane">
				<header class="pane__head">
					<label class="pane__locale">
						<span>{m.translate_translationLanguage()}</span>
						<!-- "Translated into" -->
						<select bind:value={otherLocale} disabled={busy}>
							{#each choices.filter((choice) => choice !== originalLocale) as choice (choice)}
								<option value={choice}>{upper(choice)}</option>
							{/each}
						</select>
					</label>
					{#if otherEmpty}
						<span class="pane__missing">{m.translate_notWrittenYet()}</span>
						<!-- "not written yet" -->
					{/if}
				</header>
				{#if withHeading}
					<label class="field">
						<span>{headingLabel}</span>
						<input
							type="text"
							value={otherDraft.heading}
							oninput={(event) => update(otherLocale, 'heading', event.currentTarget.value)}
							disabled={busy}
						/>
					</label>
				{/if}
				{#if withBody && bodyLabel}
					<label class="field field--grow">
						<span>{bodyLabel}</span>
						<textarea
							rows="8"
							value={otherDraft.body}
							oninput={(event) => update(otherLocale, 'body', event.currentTarget.value)}
							disabled={busy}></textarea>
					</label>
				{/if}
				<p class="pane__hint">{m.translate_emptyRemoves()}</p>
				<!-- "Leave both boxes empty to take this translation down." -->
			</section>
		{/if}
	</div>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={busy}>
			{m.common_cancel()}
		</button>
		<button type="submit" class="primary" disabled={!canSave}>{m.common_save()}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.translate {
		display: grid;
		gap: var(--space-3);
	}
	.intro {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.panes {
		display: grid;
		gap: var(--space-3);
	}
	// "up and bottom for mobiles" — one column by default, two once two columns of prose fit.
	@media (min-width: 800px) {
		.panes {
			grid-template-columns: 1fr 1fr;
		}
	}
	.pane {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
	}
	.pane__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.pane__locale {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.pane__missing {
		@include mix.pending-pill;
	}
	.pane__hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: var(--font-size-sm);
	}
	.field--grow {
		flex: 1;
	}
	input,
	textarea,
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--font-size-sm);
	}
	textarea {
		resize: vertical;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		justify-self: start;
	}
</style>
