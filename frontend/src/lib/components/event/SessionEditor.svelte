<script lang="ts">
	/** One programme block, edited as one thing: time, place, speakers, and what it points at.
	 * Speakers and links are lists replaced whole on save (the backend's shape). A link is pasted
	 * as an address — an exercise/material/set URL from this site, or any other URL — read by the
	 * same parser the course dialogs use, so nobody has to know an id. */
	import { m } from '$lib/paraglide/messages.js';
	import type {
		Session,
		SessionDraft,
		SessionKind,
		SessionLinkDraft,
		SessionLinkRole,
		SessionSpeakerDraft,
		Track
	} from '$lib/types/event';
	import { parseContentRef } from '$lib/utils/contentLinks';
	import { untrack } from 'svelte';
	import { SESSION_KIND_LABELS, SESSION_LINK_ROLE_LABELS } from '$lib/utils/labels';

	let {
		initial = null,
		tracks,
		busy = false,
		error = '',
		onsubmit,
		oncancel
	}: {
		initial?: Session | null;
		tracks: Track[];
		busy?: boolean;
		error?: string;
		onsubmit: (draft: SessionDraft) => void;
		oncancel: () => void;
	} = $props();

	function toLocalInput(iso: string | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	let title = $state(untrack(() => initial?.title ?? ''));
	let kind = $state<SessionKind>(untrack(() => initial?.kind ?? 'talk'));
	let trackId = $state(untrack(() => initial?.trackId ?? ''));
	let startsLocal = $state(untrack(() => toLocalInput(initial?.startsAt)));
	let duration = $state(untrack(() => String(initial?.durationMinutes ?? 60)));
	let locationText = $state(untrack(() => initial?.locationText ?? ''));
	let onlineUrl = $state(untrack(() => initial?.onlineUrl ?? ''));
	let capacity = $state(untrack(() => String(initial?.capacity ?? 0)));
	let abstract = $state(untrack(() => initial?.abstract ?? ''));
	let speakers = $state<SessionSpeakerDraft[]>(
		untrack(() =>
			(initial?.speakers ?? []).map((s) => ({
				userId: s.user?.id ?? null,
				name: s.name,
				affiliation: s.affiliation,
				bio: s.bio
			}))
		)
	);
	type LinkRow = SessionLinkDraft & { address: string; title: string };
	let links = $state<LinkRow[]>(
		untrack(() =>
			(initial?.links ?? []).map((l) => ({
				materialId: l.materialId,
				exerciseId: l.exerciseId,
				setSlug: l.setSlug,
				url: l.url,
				role: l.role,
				label: l.label,
				note: l.note,
				address: l.url,
				title: l.title
			}))
		)
	);
	let newSpeaker = $state('');
	let newAddress = $state('');
	let newRole = $state<SessionLinkRole>('prepare');
	let linkError = $state('');

	const KIND_LABELS = SESSION_KIND_LABELS;
	const ROLE_LABELS = SESSION_LINK_ROLE_LABELS;

	function addSpeaker() {
		const name = newSpeaker.trim();
		if (!name) return;
		speakers = [...speakers, { name, affiliation: '', bio: '' }];
		newSpeaker = '';
	}
	function addLink() {
		linkError = '';
		const raw = newAddress.trim();
		if (!raw) return;
		const ref = parseContentRef(raw, 'exercise');
		let row: LinkRow;
		if (ref && ref.kind === 'exercise')
			row = { exerciseId: ref.id, role: newRole, address: raw, title: raw };
		else if (ref && ref.kind === 'material')
			row = { materialId: ref.id, role: newRole, address: raw, title: raw };
		else if (ref && ref.kind === 'set')
			row = { setSlug: ref.slug, role: newRole, address: raw, title: raw };
		else if (/^https?:\/\//i.test(raw)) row = { url: raw, role: newRole, address: raw, title: raw };
		else {
			linkError = m.events_linkUnreadable();
			return;
		}
		links = [...links, row];
		newAddress = '';
	}
	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim() || !startsLocal) return;
		onsubmit({
			trackId: trackId || null,
			kind,
			title: title.trim(),
			abstract: abstract.trim(),
			startsAt: new Date(startsLocal).toISOString(),
			durationMinutes: Math.max(5, parseInt(duration, 10) || 60),
			locationText: locationText.trim(),
			onlineUrl: onlineUrl.trim(),
			capacity: Math.max(0, parseInt(capacity, 10) || 0),
			speakers,
			links: links.map(({ address: _a, title: _t, ...rest }) => rest)
		});
	}
</script>

<form class="session-editor" onsubmit={submit}>
	<h3>{initial ? m.events_sessionEdit() : m.events_sessionAdd()}</h3>
	<div class="row">
		<label class="field grow">
			<span>{m.events_sessionTitle()}</span>
			<input type="text" bind:value={title} required maxlength="200" />
		</label>
		<label class="field">
			<span>{m.events_sessionKind()}</span>
			<select bind:value={kind}>
				{#each Object.keys(KIND_LABELS) as k (k)}
					<option value={k}>{KIND_LABELS[k as SessionKind]()}</option>
				{/each}
			</select>
		</label>
		{#if tracks.length > 0}
			<label class="field">
				<span>{m.events_track()}</span>
				<select bind:value={trackId}>
					<option value="">{m.events_trackNone()}</option>
					{#each tracks as t (t.id)}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>
	<div class="row">
		<label class="field">
			<span>{m.events_form_startsAt()}</span>
			<input type="datetime-local" bind:value={startsLocal} required />
		</label>
		<label class="field">
			<span>{m.events_form_duration()}</span>
			<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={duration} />
		</label>
		<label class="field">
			<span>{m.events_form_capacity()}</span>
			<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={capacity} />
		</label>
	</div>
	<div class="row">
		<label class="field grow">
			<span>{m.events_form_locationText()}</span>
			<input type="text" bind:value={locationText} maxlength="300" />
		</label>
		<label class="field grow">
			<span>{m.events_form_onlineUrl()}</span>
			<input type="text" inputmode="url" bind:value={onlineUrl} />
		</label>
	</div>
	<label class="field">
		<span>{m.events_sessionAbstract()}</span>
		<textarea rows="3" bind:value={abstract}></textarea>
	</label>

	<fieldset>
		<legend>{m.events_speakers()}</legend>
		<ul class="chips">
			{#each speakers as s, i (i)}
				<li>
					<span>{s.name}{s.affiliation ? ` · ${s.affiliation}` : ''}</span>
					<button
						type="button"
						class="x"
						aria-label={m.common_remove()}
						onclick={() => (speakers = speakers.filter((_, j) => j !== i))}>×</button
					>
				</li>
			{/each}
		</ul>
		<div class="inline">
			<input
				type="text"
				bind:value={newSpeaker}
				placeholder={m.events_speakerNamePlaceholder()}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						addSpeaker();
					}
				}}
			/>
			<button type="button" onclick={addSpeaker}>{m.common_add()}</button>
		</div>
	</fieldset>

	<fieldset>
		<legend>{m.events_links()}</legend>
		<p class="hint">{m.events_linksHint()}</p>
		<ul class="chips">
			{#each links as l, i (i)}
				<li>
					<span class="role">{ROLE_LABELS[l.role]()}</span>
					<span>{l.title}</span>
					<button
						type="button"
						class="x"
						aria-label={m.common_remove()}
						onclick={() => (links = links.filter((_, j) => j !== i))}>×</button
					>
				</li>
			{/each}
		</ul>
		<div class="inline">
			<select bind:value={newRole} aria-label={m.events_linkRole()}>
				{#each Object.keys(ROLE_LABELS) as r (r)}
					<option value={r}>{ROLE_LABELS[r as SessionLinkRole]()}</option>
				{/each}
			</select>
			<input
				type="text"
				class="grow"
				bind:value={newAddress}
				placeholder={m.events_linkAddressPlaceholder()}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						addLink();
					}
				}}
			/>
			<button type="button" onclick={addLink}>{m.common_add()}</button>
		</div>
		{#if linkError}<p class="error">{linkError}</p>{/if}
	</fieldset>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="actions">
		<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
		<button type="button" onclick={oncancel}>{m.common_cancel()}</button>
	</div>
</form>

<style lang="scss">
	.session-editor {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem;
		display: grid;
		gap: 0.7rem;
		background: var(--bg-surface);
	}
	h3 {
		margin: 0;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}
	.grow {
		flex: 1 1 12rem;
	}
	input,
	select,
	textarea {
		font: inherit;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
	fieldset {
		border: 1px dashed var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
	}
	.chips {
		list-style: none;
		padding: 0;
		margin: 0 0 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: var(--bg-surface-alt);
		font-size: 0.85rem;
	}
	.role {
		color: var(--text-secondary);
	}
	.x {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		color: var(--text-secondary);
	}
	.inline {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.hint {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0 0 0.4rem;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.actions button {
		min-height: 44px;
		padding: 0 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
</style>
