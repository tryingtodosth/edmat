<script lang="ts">
	/** The building's checklist for one event (CONFERENCE-BRIEF.md §3.A).
	 *
	 * Three things this component says out loud rather than leaving implicit, because each is a real
	 * rule somebody will otherwise discover by being refused:
	 *
	 * 1. **The publish block.** An event with an approved room cannot leave `draft` while a required
	 *    item has not been started. The panel counts them and says so, so that the 409 from the
	 *    Publish button is never the first the organiser hears of it.
	 * 2. **The snapshot.** A later edit by the building is OFFERED (`templateHasNewItems` → "Add the
	 *    new items"), never applied — an item somebody has already ticked and signed is exactly what
	 *    the copy exists to protect.
	 * 3. **Who may tick what.** An item the building signs off is disabled for the organiser with the
	 *    reason in words on it, rather than accepted and then refused.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDateTime } from '$lib/utils/datetime';
	import {
		CHECKLIST_EVIDENCE_LABELS,
		CHECKLIST_OWNER_LABELS,
		CHECKLIST_STATUS_LABELS,
		VENUE_BLOCK_LABELS
	} from '$lib/utils/labels';
	import {
		getEventBookings,
		getEventChecklists,
		getVenueTemplates,
		setChecklistItem,
		signOffChecklistItem,
		startChecklist,
		syncChecklist,
		VenueRefusedError
	} from '$lib/services/venues';
	import type {
		ChecklistInstance,
		ChecklistItem,
		ChecklistItemStatus,
		ChecklistTemplate
	} from '$lib/types/venue';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';

	let {
		eventId,
		canOrganise,
		onchanged
	}: { eventId: string; canOrganise: boolean; onchanged?: () => void } = $props();

	// The kill switch is checked HERE rather than by wrapping this panel in `FeatureGate` on the
	// event page, and that is a bug fix rather than a preference: `FeatureGate` renders a
	// "this feature is unavailable" NOTICE in place of what it wraps, which is right for a whole
	// route and wrong for a panel — with the switch off the event page grew two grey paragraphs in
	// the middle of somebody else's page. House rule 3 says a killed feature takes its own surface
	// away; it does not leave a sign where it used to be. Found by looking at the screenshot.
	// `isModerator` mirrors the backend's own `is_staff` bypass, exactly as `FeatureGate` does.
	let venuesOn = $derived(featureFlagsStore.isEnabled('venues') || authStore.isModerator);

	let instances = $state<ChecklistInstance[]>([]);
	let templates = $state<ChecklistTemplate[]>([]);
	let templateVenueId = $state('');
	let chosenTemplate = $state('');
	let loaded = $state(false);
	let busy = $state('');
	let error = $state('');
	let naFor = $state('');
	let naReason = $state('');

	let loadedForEvent = $state('');
	// frontend/CLAUDE.md trap 2: an `$effect` keyed on a prop re-fires with no navigation at all.
	$effect(() => {
		// See `venuesOn` above: with the switch off these calls are 403s for a panel nobody will see.
		if (!venuesOn || eventId === loadedForEvent) return;
		loadedForEvent = eventId;
		void load();
	});

	async function load() {
		try {
			instances = await getEventChecklists(eventId);
		} catch {
			instances = [];
		}
		if (canOrganise && instances.length === 0) {
			// Which building's checklists to offer is answered by the event's own booking — the
			// checklist is a contract with a building, and there is nothing to offer before one has
			// said yes.
			try {
				const booking = (await getEventBookings(eventId)).find((b) => b.status === 'approved');
				if (booking) {
					templateVenueId = booking.venue.id;
					templates = await getVenueTemplates(booking.venue.id);
				}
			} catch {
				templates = [];
			}
		}
		loaded = true;
	}

	function title(item: { titleEn: string; titlePl: string }): string {
		// The item carries both languages in its own row — a building's rule is not community
		// content and has no translation workflow (backend/venues/models.py says why).
		return getLocale() === 'pl' ? item.titlePl || item.titleEn : item.titleEn || item.titlePl;
	}

	function body(item: { descriptionEn: string; descriptionPl: string }): string {
		return getLocale() === 'pl'
			? item.descriptionPl || item.descriptionEn
			: item.descriptionEn || item.descriptionPl;
	}

	function say(e: unknown): string {
		if (e instanceof VenueRefusedError) {
			const line = VENUE_BLOCK_LABELS[e.reason];
			if (line) return line();
		}
		return m.checklist_error(); // "That did not work. Try again."
	}

	async function refresh() {
		instances = await getEventChecklists(eventId);
		onchanged?.();
	}

	async function begin(event: SubmitEvent) {
		event.preventDefault();
		if (!chosenTemplate) return;
		error = '';
		busy = 'start';
		try {
			await startChecklist(eventId, chosenTemplate, templateVenueId);
			await refresh();
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	async function pullNew(instanceId: string) {
		error = '';
		busy = instanceId;
		try {
			await syncChecklist(instanceId);
			await refresh();
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	async function setStatus(item: ChecklistItem, status: ChecklistItemStatus) {
		error = '';
		busy = item.id;
		try {
			await setChecklistItem(item.id, { status });
			await refresh();
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	async function markNotApplicable(event: SubmitEvent, item: ChecklistItem) {
		event.preventDefault();
		error = '';
		busy = item.id;
		try {
			await setChecklistItem(item.id, {
				status: 'not_applicable',
				naReason: naReason.trim()
			});
			naFor = '';
			naReason = '';
			await refresh();
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	async function sign(item: ChecklistItem) {
		error = '';
		busy = item.id;
		try {
			await signOffChecklistItem(item.id);
			await refresh();
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	async function saveEvidence(event: SubmitEvent, item: ChecklistItem, value: string) {
		event.preventDefault();
		error = '';
		busy = item.id;
		try {
			await setChecklistItem(
				item.id,
				item.evidenceKind === 'link' ? { evidenceUrl: value } : { evidenceText: value }
			);
			await refresh();
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	let totalPending = $derived(
		instances.reduce((sum, instance) => sum + instance.mandatoryPending, 0)
	);
</script>

{#if venuesOn && loaded && (instances.length > 0 || (canOrganise && templates.length > 0))}
	<section class="checklist-panel">
		<h3>{m.checklist_panelTitle()}</h3>
		<!-- "The building's checklist" -->
		<p class="hint">{m.checklist_panelIntro()}</p>
		<!-- "What has to happen before the doors open, and afterwards…" -->

		{#if instances.length === 0}
			<p class="hint">{m.checklist_none()}</p>
			<!-- "No checklist has been started for this event." -->
			{#if canOrganise}
				<form class="start" onsubmit={begin}>
					<label>
						<span>{m.checklist_pickTemplate()}</span>
						<!-- "Choose a checklist" -->
						<select bind:value={chosenTemplate}>
							<option value="">{m.venues_pickPrompt()}</option>
							<!-- "Choose…" -->
							{#each templates as template (template.id)}
								<option value={template.id}>
									{template.name} — {template.items.length}
									{m.venues_templateItems()}
									<!-- "items" -->
								</option>
							{/each}
						</select>
					</label>
					<button type="submit" disabled={busy === 'start' || !chosenTemplate}>
						{busy === 'start' ? m.checklist_starting() : m.checklist_start()}
						<!-- "Starting…" / "Start this checklist" -->
					</button>
					<p class="hint">{m.checklist_snapshotNote()}</p>
					<!-- "Your copy is a snapshot…" -->
				</form>
			{/if}
		{:else}
			{#if totalPending > 0}
				<p class="blocked" role="status">
					<strong>{m.checklist_mandatoryPending()}: {totalPending}</strong>
					<!-- "Required items not yet started" -->
					<br />
					{m.checklist_publishBlocked()}
					<!-- "This event has a room, so it cannot be published until every required item is at least under way." -->
				</p>
			{:else}
				<p class="hint">{m.checklist_allSettled()}</p>
				<!-- "Everything required is under way or done." -->
			{/if}

			{#each instances as instance (instance.id)}
				<article class="instance">
					<h4>
						{instance.templateName}
						<span class="where">
							{m.checklist_venueLabel()}: {instance.venue.name}
							<!-- "Building" -->
						</span>
					</h4>
					{#if instance.templateHasNewItems}
						<p class="notice">
							{m.checklist_newItems()}
							<!-- "This building has changed this checklist since you started." -->
							<button
								type="button"
								disabled={busy === instance.id}
								onclick={() => pullNew(instance.id)}
							>
								{busy === instance.id ? m.checklist_syncing() : m.checklist_sync()}
								<!-- "Adding…" / "Add the new items" -->
							</button>
						</p>
					{/if}
					<ul class="items">
						{#each instance.items as item (item.id)}
							<li class="item item--{item.status}" class:item--overdue={item.isOverdue}>
								<div class="item__head">
									<span class="title">{title(item)}</span>
									<span class="pill">{CHECKLIST_STATUS_LABELS[item.status]()}</span>
									{#if item.isMandatory}
										<span class="pill pill--need">{m.checklist_mandatory()}</span>
										<!-- "Required" -->
									{:else}
										<span class="pill pill--soft">{m.checklist_optional()}</span>
										<!-- "Optional" -->
									{/if}
									<span class="pill pill--soft">{CHECKLIST_OWNER_LABELS[item.ownerRole]()}</span>
								</div>
								{#if body(item)}
									<p class="item__body">{body(item)}</p>
								{/if}
								<p class="item__due">
									{#if item.computedDueAt}
										{m.checklist_due()}: {formatDateTime(item.computedDueAt)}
										<!-- "Due" -->
										{#if item.isOverdue}
											<span class="late">{m.checklist_overdue()}</span>
											<!-- "Overdue" -->
										{/if}
									{:else}
										{m.checklist_noDue()}
										<!-- "No date — this event has no time set yet." -->
									{/if}
								</p>
								{#if item.requiresVenueSignoff}
									<p class="item__signoff">
										{m.checklist_signoffNeeded()}
										<!-- "The building signs this one off" -->
										{#if item.signedOffBy}
											— {m.checklist_signedOffBy()}
											<!-- "Signed off by" -->
											{item.signedOffBy.displayName}
											<!-- "Signed off by" -->
										{/if}
									</p>
								{/if}
								{#if item.status === 'not_applicable' && item.naReason}
									<p class="item__na">{item.naReason}</p>
								{/if}

								{#if item.evidenceKind !== 'none'}
									<form
										class="evidence"
										onsubmit={(e) =>
											saveEvidence(
												e,
												item,
												(e.currentTarget.elements.namedItem('value') as HTMLInputElement).value
											)}
									>
										<label>
											<span>
												{m.checklist_evidenceHeading()}: {CHECKLIST_EVIDENCE_LABELS[
													item.evidenceKind
												]()}
												<!-- "What the building asks for" -->
											</span>
											{#if item.evidenceKind === 'file'}
												<em class="hint">{m.checklist_evidenceFileNotYet()}</em>
												<!-- "Attaching a file here is not built yet — leave a note or a link instead." -->
												<input type="text" name="value" value={item.evidenceText} maxlength="400" />
											{:else if item.evidenceKind === 'link'}
												<input type="url" name="value" value={item.evidenceUrl} />
											{:else}
												<input type="text" name="value" value={item.evidenceText} maxlength="400" />
											{/if}
										</label>
										<button type="submit" disabled={busy === item.id}>
											{busy === item.id ? m.checklist_saving() : m.checklist_save()}
											<!-- "Saving…" / "Save" -->
										</button>
									</form>
								{/if}

								<div class="item__actions">
									{#if item.status !== 'in_progress' && item.status !== 'done'}
										<button
											type="button"
											disabled={busy === item.id}
											onclick={() => setStatus(item, 'in_progress')}
										>
											{m.checklist_status_in_progress()}
											<!-- "Being done" -->
										</button>
									{/if}
									{#if item.status !== 'done'}
										<button
											type="button"
											disabled={busy === item.id ||
												(item.requiresVenueSignoff && !instance.canSignOff)}
											title={item.requiresVenueSignoff && !instance.canSignOff
												? m.checklist_block_needs_venue_signoff()
												: undefined}
											onclick={() => setStatus(item, 'done')}
										>
											{m.checklist_status_done()}
											<!-- "Done" -->
										</button>
									{/if}
									{#if item.naAllowed && item.status !== 'not_applicable'}
										<button
											type="button"
											onclick={() => (naFor = naFor === item.id ? '' : item.id)}
										>
											{m.checklist_markNa()}
											<!-- "Mark as not applicable" -->
										</button>
									{/if}
									{#if item.requiresVenueSignoff && instance.canSignOff && !item.signedOffAt}
										<button type="button" disabled={busy === item.id} onclick={() => sign(item)}>
											{m.checklist_signOff()}
											<!-- "Sign off" -->
										</button>
									{/if}
								</div>
								{#if naFor === item.id}
									<form class="na" onsubmit={(e) => markNotApplicable(e, item)}>
										<label>
											<span>{m.checklist_naReason()}</span>
											<!-- "Why does this not apply?" -->
											<input
												type="text"
												bind:value={naReason}
												placeholder={m.checklist_naReasonPlaceholder()}
												maxlength="300"
												required
											/>
										</label>
										<button type="submit" disabled={busy === item.id}>{m.checklist_save()}</button>
										<!-- "Save" -->
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</section>
{/if}

<style lang="scss">
	.checklist-panel {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0 0 0.25rem;
	}
	h4 {
		margin: 0.8rem 0 0.2rem;
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.where {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--text-secondary);
	}
	.hint {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0.25rem 0;
	}
	.error {
		font-size: 0.9rem;
		color: var(--status-danger);
	}
	.blocked {
		font-size: 0.9rem;
		border-left: 3px solid var(--status-danger);
		padding-left: 0.6rem;
		margin: 0.6rem 0;
	}
	.notice {
		font-size: 0.85rem;
		background: var(--accent-soft);
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.items {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0;
		display: grid;
		gap: 0.7rem;
	}
	.item {
		border-left: 3px solid var(--border);
		padding-left: 0.6rem;
	}
	.item--done {
		border-left-color: var(--status-success, var(--accent));
	}
	.item--not_applicable {
		border-left-color: var(--text-secondary);
	}
	.item--overdue {
		border-left-color: var(--status-danger);
	}
	.item__head {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.title {
		font-weight: 600;
	}
	.item__body,
	.item__due,
	.item__signoff,
	.item__na {
		margin: 0.15rem 0;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.late {
		color: var(--status-danger);
		font-weight: 600;
	}
	.pill {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill--need {
		background: var(--status-danger);
		color: #fff;
	}
	.pill--soft {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-secondary);
	}
	.item__actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-top: 0.3rem;
	}
	.evidence,
	.na,
	.start {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-top: 0.35rem;
	}
	.evidence label,
	.na label,
	.start label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.8rem;
		flex: 1 1 220px;
	}
</style>
