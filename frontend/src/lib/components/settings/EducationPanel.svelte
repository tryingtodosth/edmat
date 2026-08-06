<script lang="ts">
	// Where a person declares their institution, connects USOS, transfers a diploma and a
	// transcript, and — separately, always separately — decides how much of any of it is public.
	//
	// The separation is the design, not a nicety. Importing something and publishing it are two
	// different decisions, so they are two different controls: connecting USOS to prove you are a
	// student and never showing a single mark is a first-class outcome here rather than an edge case.
	import { m } from '$lib/paraglide/messages.js';
	import {
		connectUsos,
		disconnectUsos,
		getEducation,
		getSchools,
		importFromUsos,
		removeImportedGrades,
		updateEducation,
		UsosUnavailableError
	} from '$lib/services/identity';
	import type { EducationSnapshot, School } from '$lib/types/identity';

	let snapshot = $state<EducationSnapshot | null>(null);
	let schools = $state<School[]>([]);
	let schoolChoice = $state('');
	let otherName = $state('');
	let busy = $state(false);
	let blockers = $state<string[]>([]);
	let loadFailed = $state(false);

	// Load once. `loadedFor` guards against the effect re-running on its own writes — the same
	// pattern the rest of this app uses for a one-shot fetch inside a rune component.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		loaded = true;
		Promise.all([getEducation(), getSchools()])
			.then(([snap, list]) => {
				snapshot = snap;
				schools = list;
				schoolChoice = snap.education.school ?? (snap.education.otherSchoolName ? 'other' : '');
				otherName = snap.education.otherSchoolName;
			})
			.catch(() => (loadFailed = true));
	});

	async function run(fn: () => Promise<EducationSnapshot>) {
		busy = true;
		blockers = [];
		try {
			snapshot = await fn();
		} catch (e) {
			if (e instanceof UsosUnavailableError) blockers = e.blockers;
		} finally {
			busy = false;
		}
	}

	function saveSchool() {
		if (schoolChoice === 'other') {
			return run(() => updateEducation({ otherSchoolName: otherName.trim() }));
		}
		return run(() => updateEducation({ school: schoolChoice }));
	}

	let education = $derived(snapshot?.education);
	let standing = $derived(snapshot?.standing);
	let usos = $derived(snapshot?.usos);
	let canConnect = $derived(Boolean(education?.school) && usos?.schoolRunsUsos);
	let hasGradesScope = $derived(
		Boolean(education?.usosScopes.includes(usos?.gradesScope ?? 'grades'))
	);

	const VERIFICATION_LABEL = {
		self_declared: () => m.education_verification_selfDeclared(),
		school_email: () => m.education_verification_schoolEmail(),
		usos: () => m.education_verification_usos()
	};
	const STATUS_LABEL = {
		unknown: () => m.education_status_unknown(),
		student: () => m.education_status_student(),
		alumnus: () => m.education_status_alumnus(),
		staff: () => m.education_status_staff()
	};
</script>

<section class="education">
	<h2>{m.education_heading()}</h2>
	<p class="lead">{m.education_lead()}</p>

	{#if loadFailed}
		<p class="error">{m.common_error_generic()}</p>
	{:else if !snapshot || !education || !standing || !usos}
		<p class="muted">{m.common_loading()}</p>
	{:else}
		<div class="row">
			<label class="field">
				<span>{m.education_schoolLabel()}</span>
				<select bind:value={schoolChoice} disabled={busy}>
					<option value="">{m.education_schoolPlaceholder()}</option>
					{#each schools as school (school.slug)}
						<option value={school.slug}>{school.name} ({school.shortName})</option>
					{/each}
					<!-- A real first-class answer, not a fallback. Secondary schools are deliberately
					     not enumerated — there are tens of thousands — so this carries no verification,
					     which is the honest outcome rather than a gap. -->
					<option value="other">{m.education_schoolOther()}</option>
				</select>
			</label>
			{#if schoolChoice === 'other'}
				<label class="field">
					<span>{m.education_otherSchoolLabel()}</span>
					<input type="text" bind:value={otherName} maxlength="200" disabled={busy} />
				</label>
			{/if}
			<button type="button" class="primary" onclick={saveSchool} disabled={busy}>
				{m.common_save()}
			</button>
		</div>

		<!-- Changing this drops any verification the previous institution backed, so it is said
		     before the click rather than discovered after it. -->
		<p class="muted small">{m.education_schoolChangeWarning()}</p>

		<dl class="facts">
			<div>
				<dt>{m.education_factSchool()}</dt>
				<dd>{education.schoolLabel || m.education_factNothing()}</dd>
			</div>
			<div>
				<dt>{m.education_factVerification()}</dt>
				<dd>{VERIFICATION_LABEL[education.verification]()}</dd>
			</div>
			<div>
				<dt>{m.education_factStatus()}</dt>
				<dd>{STATUS_LABEL[education.status]()}</dd>
			</div>
			{#if education.programme}
				<div>
					<dt>{m.education_factProgramme()}</dt>
					<dd>{education.programme}</dd>
				</div>
			{/if}
			{#if education.usosStudentNumber}
				<div>
					<dt>{m.education_factStudentNumber()}</dt>
					<dd>{education.usosStudentNumber}</dd>
				</div>
			{/if}
		</dl>

		{#if snapshot.schoolEmailEligible && education.verification === 'self_declared'}
			<!-- The address is on the institution's domain, and that still verifies nothing, because
			     EdMat cannot confirm an address yet. Explaining that is more useful than silently
			     granting nothing. -->
			<p class="note">{m.education_emailEligibleNote()}</p>
		{/if}

		<!-- USOS ------------------------------------------------------------------------------ -->
		<div class="usos">
			<h3>{m.education_usosHeading()}</h3>
			<p class="muted small">{m.education_usosProtocol({ protocol: usos.protocol })}</p>

			{#if usos.isMock}
				<p class="note">{m.education_usosMockNote()}</p>
			{/if}

			{#if !education.school}
				<p class="muted">{m.education_usosPickSchoolFirst()}</p>
			{:else if !usos.schoolRunsUsos}
				<p class="muted">{m.education_usosNoInstallation({ school: education.schoolLabel })}</p>
			{:else if !education.usosConnected}
				<ul class="grants">
					{#each usos.grants as grant (grant)}
						<li>{grant}</li>
					{/each}
				</ul>
				<div class="actions">
					<button
						type="button"
						class="primary"
						onclick={() => run(() => connectUsos(false))}
						disabled={busy || !canConnect}
					>
						{m.education_usosConnect()}
					</button>
					<!-- A second, deliberately separate authorization. Grades are never part of the
					     default grant — asking a university for more than is used is both a privacy
					     failure and a reason for them to refuse the registration outright. -->
					<button
						type="button"
						onclick={() => run(() => connectUsos(true))}
						disabled={busy || !canConnect}
					>
						{m.education_usosConnectWithGrades()}
					</button>
				</div>
			{:else}
				<div class="actions">
					<button
						type="button"
						onclick={() => run(() => importFromUsos('diploma'))}
						disabled={busy}
					>
						{m.education_transferDiploma()}
					</button>
					<button
						type="button"
						onclick={() => run(() => importFromUsos('grades'))}
						disabled={busy || !hasGradesScope}
						title={hasGradesScope ? undefined : m.education_gradesScopeMissing()}
					>
						{m.education_transferGrades()}
					</button>
					<button type="button" class="danger" onclick={() => run(disconnectUsos)} disabled={busy}>
						{m.education_usosDisconnect()}
					</button>
				</div>
				{#if !hasGradesScope}
					<p class="muted small">{m.education_gradesScopeMissing()}</p>
				{/if}
			{/if}

			{#if blockers.length}
				<div class="blockers">
					<h4>{m.education_usosBlockersHeading()}</h4>
					<ul>
						{#each blockers as blocker (blocker)}
							<li>{blocker}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<!-- Transferred records ----------------------------------------------------------------- -->
		{#if education.diplomas.length}
			<div class="records">
				<h3>{m.education_diplomasHeading()}</h3>
				<ul>
					{#each education.diplomas as diploma (diploma.id)}
						<li>
							<strong>{diploma.title}</strong>
							{#if diploma.issuedOn}<span class="muted"> · {diploma.issuedOn}</span>{/if}
							{#if diploma.finalGrade}<span class="muted"> · {diploma.finalGrade}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if education.grades.length}
			<div class="records">
				<h3>{m.education_gradesHeading({ count: education.grades.length })}</h3>
				{#if standing.average !== null}
					<p class="muted small">{m.education_weightedAverage({ average: standing.average })}</p>
				{/if}
				<ul>
					{#each education.grades as grade (grade.id)}
						<li>
							{grade.name}
							<span class="muted"> · {grade.term} · {grade.ects} ECTS</span>
							<strong> {grade.value}</strong>
							{#if grade.branchSlug}
								<!-- The reason a transcript is worth more here than a badge: this result
								     names a branch this site actually has. -->
								<span class="matched">{m.education_matchedBranch()}</span>
							{/if}
						</li>
					{/each}
				</ul>
				<button
					type="button"
					class="danger"
					onclick={() => run(removeImportedGrades)}
					disabled={busy}
				>
					{m.education_removeGrades()}
				</button>
			</div>
		{/if}

		<!-- Consent ----------------------------------------------------------------------------- -->
		<div class="consent">
			<h3>{m.education_consentHeading()}</h3>
			<p class="muted small">{m.education_consentLead()}</p>
			<label class="check">
				<input
					type="checkbox"
					checked={education.shareSchool}
					disabled={busy}
					onchange={(e) => run(() => updateEducation({ shareSchool: e.currentTarget.checked }))}
				/>
				<span>{m.education_consentSchool()}</span>
			</label>
			<label class="check">
				<input
					type="checkbox"
					checked={education.shareDiploma}
					disabled={busy || !education.diplomas.length}
					onchange={(e) => run(() => updateEducation({ shareDiploma: e.currentTarget.checked }))}
				/>
				<span>{m.education_consentDiploma()}</span>
			</label>
			<label class="check">
				<input
					type="checkbox"
					checked={education.shareGrades}
					disabled={busy || !education.grades.length}
					onchange={(e) => run(() => updateEducation({ shareGrades: e.currentTarget.checked }))}
				/>
				<span>{m.education_consentGrades()}</span>
			</label>
		</div>

		<!-- Standing ---------------------------------------------------------------------------- -->
		<div class="standing">
			<h3>{m.education_standingHeading()}</h3>
			<p class="tier">{m.education_standingTier({ tier: standing.tier })}</p>
			<!-- Itemised in full, never a bare letter: nobody should have to guess why they are
			     where they are, and the same instinct is why a ceiling is not blended into anything. -->
			<ul class="reasons">
				{#each standing.reasons as reason (reason.code)}
					<li><strong>{reason.tier}</strong> — {reason.detail}</li>
				{/each}
				{#if !standing.reasons.length}
					<li class="muted">{m.education_standingNothing()}</li>
				{/if}
			</ul>
			<p class="muted small">{m.education_standingNoAuthority()}</p>
			{#if standing.skillSeeds.length}
				<p class="muted small">
					{m.education_skillSeeds({
						count: standing.skillSeeds.length,
						branches: standing.skillSeeds.map((s) => s.courseName).join(', ')
					})}
				</p>
			{/if}
		</div>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.education {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h2 {
		font-size: var(--font-size-lg);
	}
	h3 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	h4 {
		font-size: var(--font-size-sm);
	}
	.lead {
		font-size: var(--font-size-sm);
	}
	.muted {
		color: var(--text-secondary);
	}
	.small {
		font-size: var(--font-size-xs);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
		flex: 1;
		min-width: 12rem;
	}
	select,
	input[type='text'] {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
	}
	button {
		@include mix.focus-ring;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		cursor: pointer;
		font-size: var(--font-size-sm);
		&:disabled {
			opacity: 0.55;
			cursor: not-allowed;
		}
	}
	.primary {
		@include mix.button-primary;
	}
	.danger {
		color: var(--status-danger);
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		div {
			display: flex;
			gap: var(--space-2);
		}
		dt {
			min-width: 10rem;
			color: var(--text-secondary);
		}
	}
	.note {
		font-size: var(--font-size-sm);
		border-left: 3px solid var(--accent);
		padding-left: var(--space-3);
	}
	.usos,
	.records,
	.consent,
	.standing {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.grants,
	.reasons,
	.blockers ul,
	.records ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		padding-left: var(--space-4);
		list-style: disc;
	}
	.matched {
		font-size: var(--font-size-xs);
		color: var(--accent);
		margin-left: var(--space-1);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.tier {
		font-size: var(--font-size-lg);
		font-weight: 700;
	}
	.records button {
		align-self: flex-start;
	}
</style>
