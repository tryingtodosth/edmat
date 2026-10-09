<script lang="ts">
	/**
	 * The founding wizard (CONTESTS-BRIEF.md §3.A item 2): four screens, back-navigable, and
	 * **nothing is saved until the last one**.
	 *
	 * That last part is the design. A contest is a public promise the moment it is announced, and
	 * half of what the wizard asks for exists only because of the law — the claim deadline, the
	 * controller, the criteria, the jury. A wizard that saved a draft on screen two would leave
	 * half-built promises lying around with none of them, and the compliance panel would be
	 * reporting on a form somebody abandoned.
	 *
	 * The four screens:
	 *   1. the preset — the ten cards, each with what it is for and what the law brings with it;
	 *   2. the prefilled form, including the has-prize toggle that reveals the prize block;
	 *   3. **the roles, prefilled from the people the founder already works with** (`RolePicker`);
	 *   4. the legal checklist as a preview, and "what will be created for you".
	 *
	 * Screen 3 is the owner's own ask ("prefilling with current users"). The pickers are fed by
	 * `/api/contests/people-suggestions/`, each candidate carrying the line that says why they are
	 * suggested, and the account-id box stays underneath as the fallback the rest of the site uses.
	 *
	 * Creating is three calls, in this order and for this reason: the contest (which is what
	 * `apply_preset` needs to exist), then the staff rows, then the event for an on-site stage if
	 * the founder asked for one. A failure after the first leaves a real draft the founder can
	 * finish on `/manage` rather than nothing at all, and the page says which step failed.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { creationStore } from '$lib/state/creation.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import RolePicker from '$lib/components/contest/RolePicker.svelte';
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import {
		addContestStaff,
		createContest,
		getContestPresets,
		getPeopleSuggestions,
		refusalWord
	} from '$lib/services/contests';
	import { getOrganizations } from '$lib/services/organizations';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import { lawMarkerLabel, organiserKindLabel, prizeRegimeLabel } from '$lib/utils/labels';
	import type {
		ContestPreset,
		ContestStaffRole,
		LawCitation,
		SuggestedPerson
	} from '$lib/types/contest';
	import type { OrganizationSummary } from '$lib/types/organization';
	import type { Audience } from '$lib/types';
	import { AUDIENCES } from '$lib/utils/labels';

	let step = $state(1);
	let presets = $state<ContestPreset[]>([]);
	let law = $state<Record<string, LawCitation>>({});
	let people = $state<SuggestedPerson[]>([]);
	let organizations = $state<OrganizationSummary[]>([]);
	let peopleLoading = $state(true);
	let loading = $state(true);
	let failed = $state(false);
	let busy = $state(false);
	let error = $state('');

	let presetKey = $state('');
	const preset = $derived(presets.find((p) => p.key === presetKey) ?? null);

	// Screen 2 — the form. Dates as `yyyy-mm-dd` text, converted on submit: a date input's own
	// value is already a string, and `type="text"` is the house rule for anything bound (trap 1).
	let title = $state('');
	let description = $state('');
	let audience = $state<Audience | ''>('university');
	let startsOn = $state('');
	let endsOn = $state('');
	let registrationClosesOn = $state('');
	let hasPrize = $state(false);
	let prizeDescription = $state('');
	let prizeValue = $state('');
	let prizeClaimOn = $state('');
	let organiserIsBusiness = $state(false);
	let organizationId = $state('');
	let externalReference = $state('');
	let meritCriteria = $state('');
	let controllerName = $state('');
	let controllerContact = $state('');
	let accommodationContact = $state('');
	let createEventForOnsite = $state(false);

	// Screen 3 — the chosen people, one list per role slot.
	let chosen = $state<Record<string, string[]>>({});

	const locale = $derived(getLocale());
	const canCreate = $derived(creationStore.allows('contest'));

	onMount(async () => {
		void creationStore.ensureLoaded(authStore.user?.id ?? null);
		try {
			const payload = await getContestPresets();
			presets = payload.presets;
			law = payload.law;
			presetKey = presets[0]?.key ?? '';
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
		try {
			people = await getPeopleSuggestions();
		} catch {
			people = [];
		} finally {
			peopleLoading = false;
		}
		try {
			organizations = await getOrganizations({ mine: true });
		} catch {
			organizations = [];
		}
	});

	/** The preset's own answers, copied into the form the moment a preset is chosen — this IS the
	 *  "prefilled" of screen 2. Re-run on every change of preset, deliberately overwriting: a
	 *  founder who changes their mind about the kind of contest means it. */
	function applyPreset(next: ContestPreset) {
		presetKey = next.key;
		// The preset's band is a free string server-side; the picker's type is the bounded one.
		audience = (AUDIENCES as string[]).includes(next.audience)
			? (next.audience as Audience)
			: 'all';
		hasPrize = next.hasPrize;
		organiserIsBusiness = false;
		chosen = Object.fromEntries(next.roles.map((slot) => [slot.role, chosen[slot.role] ?? []]));
	}

	function name(p: ContestPreset): string {
		return locale === 'en' ? p.nameEn : p.namePl;
	}

	function summary(p: ContestPreset): string {
		return locale === 'en' ? p.summaryEn : p.summaryPl;
	}

	function infoLine(entry: { en: string; pl: string }): string {
		return locale === 'en' ? entry.en : entry.pl;
	}

	function checklistTitle(item: { titleEn: string; titlePl: string }): string {
		return locale === 'en' ? item.titleEn : item.titlePl;
	}

	/** `yyyy-mm-dd` -> an ISO instant at the start of that local day, or null. */
	function toIso(value: string): string | null {
		if (!value) return null;
		const date = new Date(`${value}T09:00`);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	const canGoOn = $derived.by(() => {
		if (step === 1) return !!presetKey;
		if (step === 2) return title.trim().length > 2;
		return true;
	});

	async function create() {
		if (!preset) return;
		busy = true;
		error = '';
		try {
			const contest = await createContest({
				title: title.trim(),
				description: description.trim(),
				presetKey: preset.key,
				audience,
				startsAt: toIso(startsOn),
				endsAt: toIso(endsOn),
				registrationOpensAt: toIso(startsOn),
				registrationClosesAt: toIso(registrationClosesOn),
				hasPrize,
				...(hasPrize
					? {
							prizeDescription: prizeDescription.trim(),
							prizeTotalValuePln: prizeValue.trim() ? Number(prizeValue.trim()) : null,
							prizeClaimDeadline: toIso(prizeClaimOn)
						}
					: {}),
				organiserIsBusiness,
				...(organizationId ? { organization: organizationId } : {}),
				externalReferenceUrl: externalReference.trim(),
				meritCriteria: meritCriteria.trim(),
				dataControllerName: controllerName.trim(),
				dataControllerContact: controllerContact.trim(),
				accommodationContact: accommodationContact.trim()
			});

			// The roles, after the contest exists. A failure here is reported and does NOT discard
			// the contest: the roster is editable on `/manage`, and throwing away a founded contest
			// because one account id was wrong would be the worse answer.
			const failures: string[] = [];
			for (const [role, ids] of Object.entries(chosen)) {
				for (const id of ids) {
					try {
						await addContestStaff(contest.id, id, role as ContestStaffRole);
					} catch {
						failures.push(id);
					}
				}
			}
			if (failures.length) {
				// Said on the way out rather than swallowed (house rule 10).
				const withNote = `${resolve('/contests/[id]', { id: contest.id })}?rolesFailed=${failures.length}`;
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- `resolve()` IS used, one line up; the rule cannot see through the query string appended to its result (the same disable every `localizedPath` call site carries)
				await goto(withNote);
				return;
			}
			await goto(resolve('/contests/[id]', { id: contest.id }));
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}
</script>

<PageHead title={m.contests_newContest()} description={m.contests_wizardDescription()} />
<!-- "New contest" / "Found a contest: choose what kind it is, fill in what the law asks for, and put the people you already work with on its jury." -->

<FeatureGate feature="contests">
	<div class="page">
		<h1>{m.contests_newContest()}</h1>

		{#if !canCreate}
			<CreationGateNote kind="contest" />
		{:else if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if failed}
			<p class="error" role="alert">{m.common_error()}</p>
		{:else}
			<ol class="steps" aria-label={m.contests_wizardStepsLabel()}>
				<!-- "The four steps" -->
				{#each [1, 2, 3, 4] as number (number)}
					<li class:now={step === number} class:done={step > number}>
						{number}.
						{#if number === 1}{m.contests_step1()}{:else if number === 2}{m.contests_step2()}{:else if number === 3}{m.contests_step3()}{:else}{m.contests_step4()}{/if}
						<!-- "What kind" / "The contest" / "The people" / "What the law asks" -->
					</li>
				{/each}
			</ol>

			{#if step === 1}
				<section class="screen">
					<h2>{m.contests_step1Heading()}</h2>
					<!-- "What kind of contest is this?" -->
					<p class="hint">{m.contests_step1Hint()}</p>
					<!-- "The kind decides what the law asks of you. The first one promises no prize, which keeps it outside the public-promise, gambling and tax rules entirely — add a prize later if you want one." -->
					<ul class="presets">
						{#each presets as option (option.key)}
							<li>
								<label class="preset" class:preset--chosen={presetKey === option.key}>
									<input
										type="radio"
										name="preset"
										value={option.key}
										checked={presetKey === option.key}
										onchange={() => applyPreset(option)}
									/>
									<span class="preset__body">
										<span class="preset__name">{name(option)}</span>
										<span class="preset__chips">
											<span class="chip">{organiserKindLabel(option.organiserKind)()}</span>
											<span class="chip">
												{option.hasPrize ? m.contests_chipHasPrize() : m.contests_chipNoPrize()}
											</span>
											{#if option.hasPrize}
												<span class="chip">{prizeRegimeLabel(option.prizeRegime)()}</span>
											{/if}
											<span class="chip">
												{m.contests_chipJuryMin({ count: option.juryMin })}
												<!-- "jury of {count}+" -->
											</span>
											{#if option.staffOnly}
												<span class="chip chip--staff">{m.contests_chipStaffOnly()}</span>
												<!-- "site operators only" -->
											{/if}
										</span>
										<span class="preset__summary">{summary(option)}</span>
									</span>
								</label>
							</li>
						{/each}
					</ul>
					{#if preset?.info.length}
						<ul class="info">
							{#each preset.info as entry, index (index)}
								<li>
									<p>{infoLine(entry)}</p>
									<ul class="law">
										{#each entry.law as key (key)}
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
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{:else if step === 2}
				<section class="screen">
					<h2>{m.contests_step2Heading()}</h2>
					<!-- "The contest itself" -->
					<div class="grid">
						<label class="field">
							<span>{m.contests_fieldTitle()}</span>
							<!-- "Title" -->
							<input type="text" bind:value={title} />
						</label>
						<label class="field field--wide">
							<span>{m.contests_fieldDescription()}</span>
							<!-- "What it is, in a few sentences" -->
							<textarea rows="4" bind:value={description}></textarea>
						</label>
						<div class="field">
							<AudienceSelect bind:value={audience} />
						</div>
						<label class="field">
							<span>{m.contests_fieldStarts()}</span>
							<!-- "Starts on" -->
							<input type="date" bind:value={startsOn} />
						</label>
						<label class="field">
							<span>{m.contests_fieldRegistrationCloses()}</span>
							<!-- "Entries close on" -->
							<input type="date" bind:value={registrationClosesOn} />
						</label>
						<label class="field">
							<span>{m.contests_fieldEnds()}</span>
							<!-- "Ends on" -->
							<input type="date" bind:value={endsOn} />
						</label>
						<label class="field field--wide">
							<span>{m.contests_fieldCriteria()}</span>
							<!-- "What the jury marks against, and the weights" -->
							<textarea rows="3" bind:value={meritCriteria}></textarea>
							<small>{m.contests_fieldCriteriaHint()}</small>
							<!-- "Required before the contest can be announced: published criteria, applied by a named jury, are what keep a contest from being treated as a lottery. Never a draw, and never a tie broken by lot." -->
						</label>
					</div>

					{#if preset}
						<fieldset class="block">
							<legend>{m.contests_prizeLegend()}</legend>
							<!-- "A prize" -->
							<label class="tick">
								<input type="checkbox" bind:checked={hasPrize} />
								<span>{m.contests_prizeToggle()}</span>
								<!-- "This contest promises a prize" -->
							</label>
							{#if !hasPrize}
								<p class="hint">{m.contests_prizeNoneHint()}</p>
								<!-- "With no prize there is no public promise under the civil code, no gambling exposure and no tax — and no claim deadline to set. This is the simplest contest to run and the default." -->
							{:else}
								<p class="hint">{m.contests_prizeSomeHint()}</p>
								<!-- "A promised prize makes this a public promise under the civil code. Three things follow: a deadline within which the prize may be claimed (without it the promise is ineffective), a tax decision, and somebody named as responsible for it." -->
								<div class="grid">
									<label class="field field--wide">
										<span>{m.contests_fieldPrize()}</span>
										<!-- "What the prize is" -->
										<input type="text" bind:value={prizeDescription} />
									</label>
									<label class="field">
										<span>{m.contests_fieldPrizeValue()}</span>
										<!-- "Its value, in zł" -->
										<input type="text" inputmode="numeric" bind:value={prizeValue} />
									</label>
									<label class="field">
										<span>{m.contests_fieldClaimDeadline()}</span>
										<!-- "Claimable until" -->
										<input type="date" bind:value={prizeClaimOn} />
									</label>
								</div>
							{/if}
						</fieldset>

						<fieldset class="block">
							<legend>{m.contests_organiserLegend()}</legend>
							<!-- "Who is organising it" -->
							<p class="hint">
								{m.contests_organiserHint({ kind: organiserKindLabel(preset.organiserKind)() })}
								<!-- "This kind of contest is organised by: {kind}. Whoever that is promises the prize, judges, answers complaints and is responsible for the entrants' data. EdMat hosts it and nothing more." -->
							</p>
							{#if preset.organiserKind === 'organization'}
								<label class="field">
									<span>{m.contests_fieldOrganization()}</span>
									<!-- "The organisation behind it" -->
									<select bind:value={organizationId}>
										<option value="">{m.contests_fieldOrganizationNone()}</option>
										<!-- "— none —" -->
										{#each organizations as org (org.id)}
											<option value={org.id}>{org.name}</option>
										{/each}
									</select>
									{#if organizations.length === 0}
										<small>{m.contests_fieldOrganizationEmpty()}</small>
										<!-- "You do not belong to an organisation here yet. You can add one later from the contest's manage page." -->
									{/if}
								</label>
							{/if}
							{#if preset.externalReferenceRequired}
								<label class="field field--wide">
									<span>{m.contests_fieldExternalReference()}</span>
									<!-- "Link to the kurator's or committee's own announcement" -->
									<input type="text" bind:value={externalReference} />
									<small>{m.contests_fieldExternalReferenceHint()}</small>
									<!-- "Required: a contest that claims to be the kurator's when it is not misleads pupils who believe they are earning an exam exemption." -->
								</label>
							{/if}
							{#if preset.consumerBlock !== 'never'}
								<label class="tick">
									<input type="checkbox" bind:checked={organiserIsBusiness} />
									<span>{m.contests_fieldIsBusiness()}</span>
									<!-- "The organiser is a business (przedsiębiorca)" -->
								</label>
							{/if}
							<div class="grid">
								<label class="field">
									<span>{m.contests_fieldController()}</span>
									<!-- "Who is responsible for the entrants' data" -->
									<input type="text" bind:value={controllerName} />
								</label>
								<label class="field">
									<span>{m.contests_fieldControllerContact()}</span>
									<!-- "…and how to reach them" -->
									<input type="text" bind:value={controllerContact} />
								</label>
								<label class="field field--wide">
									<span>{m.contests_fieldAccommodation()}</span>
									<!-- "Contact for entrants with special needs" -->
									<input type="text" bind:value={accommodationContact} />
								</label>
							</div>
						</fieldset>

						<fieldset class="block">
							<legend>{m.contests_stagesLegend()}</legend>
							<!-- "The stages" -->
							<p class="hint">
								{preset.stagesLocked
									? m.contests_stagesLockedHint()
									: m.contests_stagesEditableHint()}
								<!-- "An olympiad's three stages come from the 2002 regulation and cannot be changed." / "These come from the kind you chose. You can edit, add and remove them on the contest's own page afterwards." -->
							</p>
							<ol class="stage-preview">
								{#each preset.stages as stage, index (stage.key)}
									<li>
										<strong>{locale === 'en' ? stage.nameEn : stage.namePl}</strong>
										<span class="muted">
											{m.contests_stagePreviewMeta({
												day: stage.offsetDays,
												days: stage.durationDays
											})}
											<!-- "day {day}, open for {days} days" -->
										</span>
										{#if stage.mode === 'onsite' || stage.mode === 'either'}
											<span class="muted">· {m.contests_stageOnsite()}</span>
										{/if}
										{#if index === preset.stages.length - 1}
											<span class="muted">· {m.contests_stageFinalNote()}</span>
											<!-- "the last one" -->
										{/if}
									</li>
								{/each}
							</ol>
							{#if preset.stages.some((s) => s.mode !== 'online')}
								<label class="tick">
									<input type="checkbox" bind:checked={createEventForOnsite} />
									<span>{m.contests_createEventToggle()}</span>
									<!-- "I will want an event for the on-site stage (a room, documents, a rota)" -->
								</label>
								{#if createEventForOnsite}
									<p class="hint">{m.contests_createEventHint()}</p>
									<!-- "Create it from the stage's own page once the contest exists — the stage then carries the event, and its venue, documents, volunteer rota and cloakroom come with it." -->
								{/if}
							{/if}
						</fieldset>
					{/if}
				</section>
			{:else if step === 3}
				<section class="screen">
					<h2>{m.contests_step3Heading()}</h2>
					<!-- "The people who will run it with you" -->
					<p class="hint">{m.contests_step3Hint()}</p>
					<!-- "A contest needs a named jury before it can be announced — the organiser judges by default and that is exactly the arrangement that produces complaints. These are people you already share a course, an event, an organisation or a material project with." -->
					{#if preset}
						<div class="pickers">
							{#each preset.roles as slot (slot.role)}
								<RolePicker
									role={slot.role}
									count={slot.count}
									required={slot.required}
									{people}
									loading={peopleLoading}
									bind:chosen={chosen[slot.role]}
								/>
							{/each}
						</div>
						<p class="hint">
							{m.contests_juryNote({
								min: preset.juryMin,
								recommended: preset.juryRecommended
							})}
							<!-- "You count as a juror yourself, so this contest can be announced with {min} on the jury; {recommended} is the recommendation." -->
						</p>
					{/if}
				</section>
			{:else}
				<section class="screen">
					<h2>{m.contests_step4Heading()}</h2>
					<!-- "What the law asks of you" -->
					<p class="disclaimer">{m.contests_notLegalAdvice()}</p>
					{#if preset}
						<ul class="checklist">
							{#each preset.checklist as item (item.key)}
								<li>
									<p class="checklist__title">{checklistTitle(item)}</p>
									<ul class="law">
										{#each item.law as key (key)}
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
								</li>
							{/each}
						</ul>

						<section class="will-create">
							<h3>{m.contests_willCreateHeading()}</h3>
							<!-- "What will be set up for you" -->
							<p class="hint">{m.contests_willCreateHint()}</p>
							<!-- "Creating the contest also lays out the work behind it on the contest's own page, so none of it has to be remembered." -->
							<ul>
								<li>{m.contests_willCreateRules({ count: preset.rulesSections.length })}</li>
								<!-- "the regulamin's {count} paragraphs, each with the guidance for what belongs in it" -->
								<li>{m.contests_willCreateStages({ count: preset.stages.length })}</li>
								<!-- "{count} stages, with dates worked out from the start date" -->
								<li>{m.contests_willCreatePlan()}</li>
								<!-- "a plan with the timeline from announcement to prize handover" -->
								<li>{m.contests_willCreateGoal({ count: preset.goalCriteria.length })}</li>
								<!-- "a goal with {count} criteria that say when the contest is done" -->
								<li>{m.contests_willCreateTasks({ count: preset.checklist.length })}</li>
								<!-- "{count} tasks, one per legal obligation, each dated and assigned" -->
								<li>{m.contests_willCreateNeeds({ count: preset.needs.length })}</li>
								<!-- "{count} “help wanted” postings, so you can ask for jurors publicly" -->
								<li>{m.contests_willCreatePoll()}</li>
								<!-- "a poll for the jury to confirm the final ranking" -->
							</ul>
							<p class="hint">{m.contests_willCreateHonest()}</p>
							<!-- "Whatever is switched off on this site, or not built yet, will be listed honestly on the contest's page afterwards rather than quietly skipped." -->
						</section>
					{/if}
				</section>
			{/if}

			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<div class="nav">
				<button type="button" disabled={step === 1 || busy} onclick={() => (step -= 1)}>
					{m.contests_back()}
					<!-- "Back" -->
				</button>
				{#if step < 4}
					<button
						type="button"
						class="primary"
						disabled={!canGoOn || busy}
						onclick={() => (step += 1)}
					>
						{m.contests_next()}
						<!-- "Next" -->
					</button>
				{:else}
					<button type="button" class="primary" disabled={busy} onclick={create}>
						{busy ? m.contests_creating() : m.contests_create()}
						<!-- "Creating…" / "Create the contest" -->
					</button>
				{/if}
				<p class="nav__note">{m.contests_nothingSavedYet()}</p>
				<!-- "Nothing is saved until you press Create." -->
			</div>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 860px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		margin: 0;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: var(--font-size-lg);
	}
	h3 {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-md);
	}
	.steps {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.steps .now {
		color: var(--accent);
		font-weight: 600;
	}
	.steps .done {
		color: var(--status-neutral);
	}
	.screen {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: var(--space-4);
	}
	.hint,
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.hint {
		margin: 0 0 0.6rem;
		max-width: 68ch;
	}
	.disclaimer {
		margin: 0 0 0.6rem;
		border-left: 3px solid var(--status-warning);
		padding-left: 0.6rem;
		font-size: var(--font-size-sm);
	}
	.presets {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.preset {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0.55rem 0.7rem;
		cursor: pointer;
	}
	.preset--chosen {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.preset__body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.preset__name {
		font-weight: 600;
	}
	.preset__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		@include mix.neutral-pill;
		font-size: var(--font-size-xs);
	}
	.chip--staff {
		border-color: var(--status-warning);
		color: var(--status-warning);
	}
	.preset__summary {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.info,
	.checklist {
		list-style: none;
		margin: 0.8rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.info li,
	.checklist li {
		border-left: 3px solid var(--border-color);
		padding-left: 0.6rem;
	}
	.info p,
	.checklist__title {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.law {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.law li {
		border: 0;
		padding: 0;
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
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.6rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-sm);
	}
	.field--wide {
		grid-column: 1 / -1;
	}
	.field input,
	.field select,
	.field textarea {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
	}
	.field small {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.block {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0.7rem 0.9rem;
		margin: 0.8rem 0 0;
	}
	legend {
		font-weight: 600;
		padding: 0 0.3rem;
	}
	.tick {
		display: flex;
		gap: 0.45rem;
		align-items: flex-start;
		font-size: var(--font-size-sm);
		margin: 0.3rem 0;
	}
	.stage-preview {
		margin: 0 0 0.5rem;
		padding-left: 1.2rem;
		font-size: var(--font-size-sm);
	}
	.pickers {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.will-create {
		margin-top: 0.9rem;
		border-top: 1px solid var(--border-color);
		padding-top: 0.7rem;
	}
	.will-create ul {
		margin: 0 0 0.5rem;
		padding-left: 1.2rem;
		font-size: var(--font-size-sm);
	}
	.nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.nav__note {
		flex: 1 1 14rem;
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	button {
		padding: 0.4rem 0.9rem;
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
	.error {
		color: var(--status-danger);
		margin: 0;
	}
</style>
