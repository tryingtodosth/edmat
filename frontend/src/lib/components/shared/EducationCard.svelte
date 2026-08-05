<script lang="ts">
	// The education claim on a public profile — rendered only for whatever that account actually
	// consented to publish. Everything withheld simply is not in the response at all: the gating
	// happens server-side (identity/standing.py's `public_view`), so this component cannot leak
	// something by forgetting a condition, and there is nothing here to accidentally reveal.
	import { m } from '$lib/paraglide/messages.js';
	import type { PublicEducation } from '$lib/types/identity';

	let { education }: { education: PublicEducation } = $props();

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

	// Only a registry-backed claim gets a tick. A self-declared school is shown plainly, because a
	// badge on something nobody checked would be exactly as convincing to a reader whether or not
	// it were true.
	let verified = $derived(education.verification === 'usos');
</script>

<section class="profile-section education-card">
	<h2>{m.education_publicHeading()}</h2>

	<p class="school">
		<strong>{education.school}</strong>
		{#if verified}<span class="tick" title={VERIFICATION_LABEL[education.verification]()}>✓</span
			>{/if}
		<span class="meta">
			· {VERIFICATION_LABEL[education.verification]()}
			{#if education.status !== 'unknown'}· {STATUS_LABEL[education.status]()}{/if}
		</span>
	</p>
	{#if education.programme}
		<p class="meta">{education.programme}</p>
	{/if}

	{#if education.diplomas.length}
		<div class="block">
			<h3>{m.education_diplomasHeading()}</h3>
			<ul>
				{#each education.diplomas as diploma (diploma.title + diploma.issuedOn)}
					<li>
						<strong>{diploma.title}</strong>
						{#if diploma.issuedOn}<span class="meta"> · {diploma.issuedOn}</span>{/if}
						{#if diploma.finalGrade}<span class="meta"> · {diploma.finalGrade}</span>{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if education.grades.length}
		<div class="block">
			<h3>{m.education_gradesHeading({ count: education.grades.length })}</h3>
			{#if education.average !== null}
				<p class="meta">{m.education_weightedAverage({ average: education.average })}</p>
			{/if}
			<ul>
				{#each education.grades as grade (grade.name + grade.term)}
					<li>
						{grade.name}
						<span class="meta"> · {grade.term} · {grade.ects} ECTS</span>
						<strong> {grade.value}</strong>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<style lang="scss">
	.education-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h3 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.school {
		font-size: var(--font-size-md);
	}
	.tick {
		color: var(--accent);
		font-weight: 700;
	}
	.meta {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-left: var(--space-4);
		list-style: disc;
		font-size: var(--font-size-sm);
	}
</style>
