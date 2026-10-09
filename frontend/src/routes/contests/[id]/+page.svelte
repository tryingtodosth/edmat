<script lang="ts">
	/**
	 * One contest (CONTESTS-BRIEF.md §3.A item 3). Replaces the prep's placeholder whole.
	 *
	 * **The organiser's name and kind are the first thing on the page, above everything else.**
	 * That is not a layout preference. EdMat is never the *przyrzekający*: it hosts the
	 * announcement, the entries and the scoring, and a page that showed a prize and a deadline
	 * without saying whose promise they were would be this site appearing to make the promise
	 * (CONTESTS-BRIEF.md §1, last row; `LEGAL.md`).
	 *
	 * Then the status strip, the stage ladder, and whichever of the four faces this reader has:
	 * a stranger, somebody who may enter, an entrant, or staff. Each one is a different set of
	 * sentences rather than a different set of enabled buttons — `registerBlockReason` comes back
	 * from the server as a WORD on every read and `contestRefusalMessage` turns it into the one
	 * sentence that fits (house rule 6).
	 *
	 * The three markers at the bottom are the integrator's (CONTESTS-BRIEF.md §2, §5): the
	 * compliance panel is already mounted here because it is step A's own; the translations panel
	 * and the discussion are step B's pieces and are wired in at integration.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import ManagementPanels from '$lib/components/management/ManagementPanels.svelte';
	import StatusStrip from '$lib/components/contest/StatusStrip.svelte';
	import StageLadder from '$lib/components/contest/StageLadder.svelte';
	import GuardianConsentBlock from '$lib/components/contest/GuardianConsentBlock.svelte';
	import CompliancePanel from '$lib/components/contest/CompliancePanel.svelte';
	// Mounted at integration (CONTESTS-BRIEF.md §5): the bilingual title and description
	// (`translations/`, step B's `contest` kind) and the contest's own thread (`contests/<id>` in
	// `community/discussions.py`, the organisation page's shape).
	import ManagementTextMenu from '$lib/components/translations/ManagementTextMenu.svelte';
	import RowDiscussion from '$lib/components/discussion/RowDiscussion.svelte';
	import { RowDiscussions } from '$lib/components/discussion/rowDiscussions.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import {
		getCompliance,
		getContest,
		getContestPresets,
		getStages,
		refusalWord,
		registerForContest,
		setPublishName,
		withdrawRegistration
	} from '$lib/services/contests';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import {
		contestStaffRoleLabel,
		organiserKindLabel,
		prizeRegimeLabel
	} from '$lib/utils/labels';
	import { formatDate } from '$lib/utils/datetime';
	import type {
		CompliancePayload,
		Contest,
		ContestStage,
		LawCitation
	} from '$lib/types/contest';

	let contest = $state<Contest | null>(null);

	// The thread under the page, keyed by id the way `/contests/[id]` is addressed. One key, batched
	// anyway, for the reader-keyed guard `RowDiscussions` carries (frontend/CLAUDE.md trap 2).
	const rowDiscussions = new RowDiscussions();
	const discussionKey = $derived(contest ? discussionKeyFor('contests', contest.id) : '');
	$effect(() =>
		rowDiscussions.load(discussionKey ? [discussionKey] : [], authStore.user?.id ?? 'anon')
	);
	let stages = $state<ContestStage[]>([]);
	let compliance = $state<CompliancePayload | null>(null);
	let law = $state<Record<string, LawCitation>>({});
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');
	let busy = $state(false);
	let loadedFor = $state('');

	// The register form.
	let showRegister = $state(false);
	let affiliation = $state('');
	let teamName = $state('');
	let guardianName = $state('');
	let guardianConsent = $state(false);
	let publishName = $state(false);

	const locale = $derived(getLocale());
	const rolesFailed = $derived(Number(page.url.searchParams.get('rolesFailed') ?? '0'));

	// Keyed on the id AND on who is asking (frontend/CLAUDE.md traps 2 and 3): `$effect` re-fires
	// with no navigation at all, and a session resolving after mount changes every answer on this
	// page — whether you may enter, whether you are on the jury, whether the panel exists.
	$effect(() => {
		const id = page.params.id;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (!id || key === loadedFor) return;
		loadedFor = key;
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		notFound = false;
		error = '';
		try {
			contest = await getContest(id);
			stages = await getStages(id);
			publishName = contest.myRegistration?.publishName ?? false;
			if (contest.myRole) {
				try {
					compliance = await getCompliance(id);
					law = (await getContestPresets()).law;
				} catch {
					compliance = null;
				}
			}
		} catch {
			// A draft a stranger asked for is a 404 — for them it does not exist, which is the
			// honest answer as well as the safe one (house rule 4). So this page says "not here",
			// never "you are not allowed".
			notFound = true;
		} finally {
			loading = false;
		}
	}

	async function register() {
		if (!contest) return;
		busy = true;
		error = '';
		try {
			await registerForContest(contest.id, {
				affiliation: affiliation.trim(),
				teamName: teamName.trim(),
				guardianName: guardianName.trim(),
				guardianConsent,
				publishName
			});
			showRegister = false;
			loadedFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function withdraw() {
		if (!contest?.myRegistration) return;
		busy = true;
		error = '';
		try {
			await withdrawRegistration(contest.myRegistration.id);
			loadedFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function togglePublishName() {
		if (!contest?.myRegistration) return;
		busy = true;
		error = '';
		try {
			const row = await setPublishName(contest.myRegistration.id, !publishName);
			publishName = row.publishName;
			loadedFor = '';
		} catch {
			error = m.common_error();
		} finally {
			busy = false;
		}
	}

	const organiserKind = $derived(contest?.preset?.organiserKind ?? 'person');
	const canEnter = $derived(contest !== null && contest.registerBlockReason === null);
	const isMinorRefusal = $derived(contest?.registerBlockReason === 'guardian_consent_required');
	const presetName = $derived(
		contest?.preset ? (locale === 'en' ? contest.preset.nameEn : contest.preset.namePl) : ''
	);
</script>

<PageHead
	title={contest?.title ?? m.contests_title()}
	description={contest?.description || m.contests_hubDescription()}
/>

<FeatureGate feature="contests">
	<div class="page">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !contest}
			<p class="muted">{m.contests_notFound()}</p>
			<!-- "There is no contest here." -->
		{:else}
			<!-- The organiser FIRST, before the title: see the module comment. -->
			<header class="hero">
				<p class="organiser">
					<span class="organiser__who">
						{m.contests_organisedBy({ name: contest.organiser?.displayName ?? '—' })}
					</span>
					<span class="organiser__kind">{organiserKindLabel(organiserKind)()}</span>
				</p>
				<h1><MathTitle text={contest.title} /></h1>
				{#if presetName}
					<p class="preset">{presetName}</p>
				{/if}
				<p class="medium">{m.contests_edmatIsTheMedium()}</p>
				<!-- "EdMat hosts this contest. It does not organise it, judge it, fund any prize or guarantee anything about it — the organiser named above does all of that." -->
			</header>

			{#if rolesFailed > 0}
				<p class="warn" role="alert">
					{m.contests_rolesFailedNote({ count: rolesFailed })}
					<!-- "{count} of the people you picked could not be added — the account ids may be wrong. Add them from the manage page." -->
				</p>
			{/if}

			<StatusStrip status={contest.status} />

			{#if contest.description}
				<section class="prose"><MathContent source={contest.description} /></section>
			{/if}

			<section class="facts">
				<dl>
					{#if contest.startsAt}
						<dt>{m.contests_factStarts()}</dt>
						<dd>{formatDate(contest.startsAt)}</dd>
					{/if}
					{#if contest.registrationClosesAt}
						<dt>{m.contests_factRegistrationCloses()}</dt>
						<!-- "Entries close" -->
						<dd>{formatDate(contest.registrationClosesAt)}</dd>
					{/if}
					{#if contest.endsAt}
						<dt>{m.contests_factEnds()}</dt>
						<!-- "Ends" -->
						<dd>{formatDate(contest.endsAt)}</dd>
					{/if}
					<dt>{m.contests_factJury()}</dt>
					<!-- "On the jury" -->
					<dd>{contest.juryCount}</dd>
					<dt>{m.contests_factEntrants()}</dt>
					<dd>{contest.registrationCount}</dd>
				</dl>

				{#if contest.hasPrize}
					<div class="prize">
						<h2>{m.contests_prizeHeading()}</h2>
						<!-- "The prize" -->
						{#if contest.prizeDescription}
							<p>{contest.prizeDescription}</p>
						{/if}
						{#if contest.prizeClaimDeadline}
							<p>
								{m.contests_prizeClaimBy({ date: formatDate(contest.prizeClaimDeadline) })}
								<!-- "Claimable until {date}" -->
							</p>
						{/if}
						<p class="muted">{prizeRegimeLabel(contest.prizeRegime)()}</p>
						<p class="muted">{m.contests_prizeWhoPays()}</p>
						<!-- "The organiser promises and hands over the prize. EdMat holds no prize fund and takes no money of any kind." -->
					</div>
				{:else}
					<div class="prize prize--none">
						<h2>{m.contests_noPrizeHeading()}</h2>
						<!-- "No prize" -->
						<p class="muted">{m.contests_noPrizeNote()}</p>
						<!-- "This contest promises no prize: a jury, a ranking and feedback, and none of the obligations a promised prize brings." -->
					</div>
				{/if}
			</section>

			{#if contest.meritCriteria}
				<section class="block">
					<h2>{m.contests_criteriaHeading()}</h2>
					<!-- "What the jury marks against" -->
					<MathContent source={contest.meritCriteria} />
				</section>
			{/if}

			<section class="block">
				<h2>{m.contests_stagesHeading()}</h2>
				<!-- "The stages" -->
				<StageLadder
					contestId={contest.id}
					{stages}
					isStaff={contest.myRole !== null}
				/>
			</section>

			<nav class="links" aria-label={m.contests_linksLabel()}>
				<!-- "This contest's pages" -->
				<a href={resolve('/contests/[id]/rules', { id: contest.id })}>
					{contest.rulesVersion > 0
						? m.contests_rulesLinkVersion({ version: contest.rulesVersion })
						: m.contests_rulesLink()}
					<!-- "The rules (version {version})" / "The rules" -->
				</a>
				{#if contest.resultsArePublished}
					<a href={resolve('/contests/[id]/results', { id: contest.id })}>
						{m.contests_resultsLink()}
						<!-- "Results" -->
					</a>
				{/if}
				{#if contest.canScore}
					<a href={resolve('/contests/[id]/judge', { id: contest.id })}>
						{m.contests_judgeLink()}
						<!-- "Score the entries" -->
					</a>
				{/if}
				{#if contest.canManage}
					<a href={resolve('/contests/[id]/manage', { id: contest.id })}>
						{m.contests_manageLink()}
						<!-- "Run this contest" -->
					</a>
				{/if}
				{#if contest.externalReferenceUrl}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the organiser's OWN announcement, on their own site: an absolute URL they typed, which `resolve()` has nothing to do with -->
					<a href={contest.externalReferenceUrl} rel="noopener noreferrer" target="_blank">
						{m.contests_externalReferenceLink()}
						<!-- "The organiser's own announcement" -->
					</a>
				{/if}
			</nav>

			<!-- Where this reader stands. Four faces, four sets of sentences. -->
			<section class="standing">
				{#if contest.myRole}
					<p class="standing__line">
						{m.contests_youHelpRun({ role: contestStaffRoleLabel(contest.myRole)() })}
						<!-- "You are on this contest's staff as: {role}" -->
					</p>
					{#if contest.announceBlockReason}
						<p class="warn">
							{m.contests_cannotAnnounceYet()}
							<!-- "This contest cannot be announced yet:" -->
							{contestRefusalMessage(contest.announceBlockReason)}
						</p>
					{/if}
				{:else if contest.myRegistration}
					{@const mine = contest.myRegistration}
					<p class="standing__line">
						{m.contests_yourEntry({ number: mine.number })}
						<!-- "You are entrant #{number} in this contest." -->
						{#if mine.status === 'requested'}
							{m.contests_entryWaiting()}
							<!-- "The organiser has not decided on your entry yet." -->
						{:else if mine.status === 'accepted'}
							{m.contests_entryAccepted()}
							<!-- "Your entry was accepted." -->
						{:else if mine.status === 'declined'}
							{m.contests_entryDeclined()}
							<!-- "The organiser declined your entry." -->
						{:else if mine.status === 'withdrawn'}
							{m.contests_entryWithdrawn()}
							<!-- "You withdrew." -->
						{:else}
							{m.contests_entryDisqualified()}
							<!-- "The organiser disqualified you from this contest." -->
						{/if}
					</p>
					{#if mine.status === 'requested' || mine.status === 'accepted'}
						<div class="consent">
							<label class="tick">
								<input
									type="checkbox"
									checked={publishName}
									disabled={busy}
									onchange={togglePublishName}
								/>
								<span>{m.contests_publishNameToggle()}</span>
								<!-- "Publish my full name if I place" -->
							</label>
							<p class="muted">
								{contest.publicationDefault === 'initials'
									? m.contests_publishNameInitialsOnly()
									: m.contests_publishNameOptIn()}
								<!-- "This contest publishes initials only, so your name will not appear even with this ticked — but the consent is recorded, and you can withdraw it at any time." / "Without this, the results list shows your initials. You can withdraw it at any time." -->
							</p>
						</div>
						<button type="button" disabled={busy} onclick={withdraw}>
							{m.contests_withdrawEntry()}
							<!-- "Withdraw from this contest" -->
						</button>
					{/if}
				{:else if canEnter}
					{#if !showRegister}
						<button type="button" class="primary" onclick={() => (showRegister = true)}>
							{m.contests_enter()}
							<!-- "Take part" -->
						</button>
					{:else}
						<form class="register" onsubmit={(event) => event.preventDefault()}>
							<h2>{m.contests_enterHeading()}</h2>
							<!-- "Taking part" -->
							<p class="muted">
								{m.contests_enterRulesNote({ version: contest.rulesVersion })}
								<!-- "Entering means accepting version {version} of the rules. The version you accept is stored with your entry, so a later change to the rules cannot become the ones you agreed to." -->
							</p>
							<label class="field">
								<span>{m.contests_fieldAffiliation()}</span>
								<!-- "Your school, faculty or circle" -->
								<input type="text" bind:value={affiliation} />
							</label>
							{#if contest.team}
								<label class="field">
									<span>{m.contests_fieldTeamName()}</span>
									<!-- "Your team's name" -->
									<input type="text" bind:value={teamName} />
								</label>
							{/if}
							<label class="tick">
								<input type="checkbox" bind:checked={publishName} />
								<span>{m.contests_publishNameToggle()}</span>
							</label>
							<p class="muted">{m.contests_publishNameSeparate()}</p>
							<!-- "A separate consent, not a condition of entering — and you can withdraw it at any time afterwards." -->
							<div class="actions">
								<button type="button" class="primary" disabled={busy} onclick={register}>
									{m.contests_enterConfirm()}
									<!-- "Enter the contest" -->
								</button>
								<button type="button" disabled={busy} onclick={() => (showRegister = false)}>
									{m.common_cancel()}
								</button>
							</div>
						</form>
					{/if}
				{:else if isMinorRefusal}
					<form class="register" onsubmit={(event) => event.preventDefault()}>
						<h2>{m.contests_enterHeading()}</h2>
						<GuardianConsentBlock bind:guardianName bind:consented={guardianConsent} />
						<label class="field">
							<span>{m.contests_fieldAffiliation()}</span>
							<input type="text" bind:value={affiliation} />
						</label>
						<label class="tick">
							<input type="checkbox" bind:checked={publishName} />
							<span>{m.contests_publishNameToggle()}</span>
						</label>
						<div class="actions">
							<button
								type="button"
								class="primary"
								disabled={busy || !guardianConsent || !guardianName.trim()}
								onclick={register}
							>
								{m.contests_enterConfirm()}
							</button>
						</div>
						<p class="muted">{m.contests_minorComplaintNote()}</p>
						<!-- "One more thing an under-16 cannot do here: lodge a complaint about the result. A guardian asks the organiser, who records it." -->
					</form>
				{:else if contest.registerBlockReason}
					<p class="standing__line">{contestRefusalMessage(contest.registerBlockReason)}</p>
					{#if contest.registerBlockReason === 'anonymous'}
						<a href={resolve('/login')}>{m.nav_login()}</a>
					{/if}
				{/if}
				{#if error}
					<p class="error" role="alert">{error}</p>
				{/if}
			</section>

			<!-- contests: compliance (A) -->
			{#if compliance}
				<CompliancePanel
					report={compliance}
					{law}
					checklist={contest.preset?.checklist ?? []}
					compact
				/>
			{/if}

			<!-- contests: translations (integration) -->
			{#if contest.canManage}
				<!-- The title and description in both languages, edited in ONE submission so a row never
				     tells a reader the Polish is four minutes newer (root CLAUDE.md, i18n). -->
				<div class="text-menu">
					<ManagementTextMenu
						kind="contest"
						id={contest.id}
						versions={contest.textVersions}
						fallbackHeading={contest.title}
						fallbackBody={contest.description}
						headingLabel={m.contests_fieldTitle()}
						bodyLabel={m.contests_fieldDescription()}
						label={m.contests_textMenuLabel()}
						onSaved={() => void load(contest!.id)}
					/>
					<!-- "Title" · "What it is, in a few sentences" · "Title and description, in both languages" -->
				</div>
			{/if}

			<!-- contests: discussion (integration) -->
			<!-- Draws nothing until the policy lands and nothing when the location is off (house rule 3). -->
			<RowDiscussion policy={rowDiscussions.byKey[discussionKey]} title={contest.title} />

			<ManagementPanels nodeKind="contest" nodeId={contest.id} />
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 900px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.hero {
		border-left: 3px solid var(--accent);
		padding-left: 0.8rem;
	}
	.organiser {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		font-size: var(--font-size-sm);
	}
	.organiser__who {
		font-weight: 600;
	}
	.organiser__kind {
		@include mix.neutral-pill;
		font-size: var(--font-size-xs);
	}
	h1 {
		margin: 0.2rem 0 0;
	}
	h2 {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-md);
	}
	.preset {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.medium {
		margin: 0.4rem 0 0;
		max-width: 68ch;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0.8rem;
	}
	.facts dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.7rem;
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.facts dt {
		color: var(--text-secondary);
	}
	.facts dd {
		margin: 0;
	}
	.prize,
	.block,
	.standing,
	.prose {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		padding: 0.7rem 0.9rem;
	}
	.prize {
		background: var(--status-warning-bg);
	}
	.prize--none {
		background: var(--bg-surface-alt);
	}
	.prize p {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-sm);
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
		font-size: var(--font-size-sm);
	}
	.standing__line {
		margin: 0 0 0.4rem;
	}
	.consent {
		margin: 0.4rem 0;
	}
	.register {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-sm);
		max-width: 26rem;
	}
	.field input {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.tick {
		display: flex;
		gap: 0.45rem;
		align-items: flex-start;
		font-size: var(--font-size-sm);
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
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
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0;
	}
	.warn {
		margin: 0;
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--status-warning);
		background: var(--status-warning-bg);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger);
		margin: 0.3rem 0 0;
	}
</style>
