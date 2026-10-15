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
	import TranscriptView from '$lib/components/profile/TranscriptView.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { EducationSnapshot, School, StandingReason } from '$lib/types/identity';

	// `embedded` drops this component's own heading and lead paragraph, for the one caller that already
	// supplies both: the profile editor opens it inside a modal whose header says "Education", and a
	// second identical heading immediately underneath reads like a rendering fault.
	//
	// A prop rather than a second component, because the panel's whole content — the school picker, the
	// connect buttons, the transfers, the transcript, the three consents — is the same on both surfaces,
	// and the duplication a copy would create is exactly where the two would drift.
	let { embedded = false }: { embedded?: boolean } = $props();

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
	// The backend sends a CODE per line and the words live here, in both languages (house rule 1;
	// WP14a). It used to send English prose, which the Polish page showed verbatim — one line of it
	// still saying email confirmation was not built, after it was. Mirrors
	// `backend/identity/standing.py` and `usos.py: GRANT_CODES`; an unknown code shows the code
	// itself rather than nothing, so a new one added there is visible here rather than silently lost.
	const REASON_TEXT: Record<string, (r: StandingReason) => string> = {
		account_active: () => m.wp14a_reason_accountActive(), // "Active account. Your email address isn't confirmed yet."
		email_confirmed: () => m.wp14a_reason_emailConfirmed(), // "Active account, email address confirmed."
		declared_school: (r) => m.wp14a_reason_declaredSchool({ school: r.params.school ?? '' }), // "You declared {school}. …"
		school_email: () => m.wp14a_reason_schoolEmail(), // "Signed in with an address on the institution's own domain. …"
		usos_verified: () => m.wp14a_reason_usosVerified() // "Enrolment confirmed by the university's own registry. …"
	};
	const GRANT_TEXT: Record<string, () => string> = {
		verified_enrolment: () => m.wp14a_grant_verifiedEnrolment(), // "Verified enrolment — from the registry, not from anything you typed."
		ceiling_s: () => m.wp14a_grant_ceilingS(), // "Level S: full participation straight away, without waiting to earn it."
		no_moderation_authority: () => m.wp14a_grant_noModeration(), // "No authority over other people's work. …"
		no_vote_weight: () => m.wp14a_grant_noVoteWeight(), // "No extra weight for your votes until you earn a reputation."
		optional_transcript: () => m.wp14a_grant_optionalTranscript() // "Only if you ask for it separately: your diploma and transcript, …"
	};
	const STATUS_LABEL = {
		unknown: () => m.education_status_unknown(),
		student: () => m.education_status_student(),
		alumnus: () => m.education_status_alumnus(),
		staff: () => m.education_status_staff()
	};
</script>

<section class="education" class:education--embedded={embedded}>
	{#if !embedded}
		<h2>{m.education_heading()}</h2>
		<p class="lead">{m.education_lead()}</p>
	{/if}

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
			<!-- The protocol line ("OAuth 1.0a (HMAC-SHA1, three-legged). Credentials are issued per
			     university…") stood here; it was developer documentation in somebody's settings, and
			     it went (WP14a). Why a school cannot connect is said below, per school. -->

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
						<li>{GRANT_TEXT[grant]?.() ?? grant}</li>
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

				<!-- Grouped by academic year rather than one flat list of every result ever. A degree is
				     six semesters, so the flat version was fifteen-plus undifferentiated rows in which the
				     one thing a person looks for — how a particular year went — was the hardest thing to
				     find. The grouping and every average come from the server; see TranscriptView. -->
				<TranscriptView
					years={education.gradeYears}
					grades={education.grades}
					{busy}
					onRemoveYear={(year) => run(() => removeImportedGrades(year))}
				/>

				<button
					type="button"
					class="danger"
					onclick={() => run(() => removeImportedGrades())}
					disabled={busy}
				>
					{m.education_removeGrades()}
				</button>
				<p class="muted small">{m.education_removeGradesNote()}</p>
				<!-- "Removing everything also stops publishing it. Removing a single year leaves the rest
				     exactly as visible as they were." -->
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
			<!-- The learning record's own consent (backend/identity/record.py). Inside the same block as
			     the other three because it is the same kind of decision, and LAST because it is the one
			     that publishes nothing institutional — the order reads from "who I am" to "what I have
			     done here".
			
			     Behind `learning_record`: with the switch off the section it governs does not exist, and
			     a toggle for a feature nobody can see is house rule 3's exact failure — a control that
			     has not been hidden, only made to do nothing useful. -->
			{#if featureFlagsStore.isEnabled('learning_record')}
				<label class="check">
					<input
						type="checkbox"
						checked={education.shareActivity}
						disabled={busy}
						onchange={(e) => run(() => updateEducation({ shareActivity: e.currentTarget.checked }))}
					/>
					<span>{m.record_consentActivity()}</span>
					<!-- "Show what I have done on EdMat, as counts per subject" -->
				</label>
				<p class="muted small">{m.record_consentActivityHint()}</p>
				<!-- "Numbers only: how many sets you built, how many lessons you said you finished, how
				     many cards you reviewed — per subject, never a single item. Your marks stay under
				     their own consent above." -->
			{/if}
		</div>

		<!-- Standing ---------------------------------------------------------------------------- -->
		<div class="standing">
			<h3>{m.education_standingHeading()}</h3>
			<p class="tier">{m.education_standingTier({ tier: standing.tier })}</p>
			<!-- Itemised in full, never a bare letter: nobody should have to guess why they are
			     where they are, and the same instinct is why a ceiling is not blended into anything. -->
			<ul class="reasons">
				{#each standing.reasons as reason (reason.code)}
					<li>
						<strong>{reason.tier}</strong> — {REASON_TEXT[reason.code]?.(reason) ?? reason.code}
					</li>
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
	// Inside a modal the shell already supplies the padding and the scroll container, so the panel only
	// has to stop adding a second gap above its first row.
	.education--embedded {
		gap: var(--space-4);
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
	// `.matched` used to live here, styling the "matches a branch here" chip on each grade row. The
	// grade rows moved into TranscriptView along with the chip, so the rule went with them rather than
	// being left behind as a selector matching nothing.
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
