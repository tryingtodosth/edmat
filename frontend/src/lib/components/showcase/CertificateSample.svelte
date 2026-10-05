<script lang="ts">
	/**
	 * A course's record of completion, as it prints.
	 *
	 * A twin of step C's print page, and the one place in this showcase where the twin is clearly
	 * the right thing: the real page is a print view of one `CourseCompletion` row, and what is
	 * worth showing about it is not how it is fetched but what it says — and, more to the point,
	 * what it refuses to say. No grade, no mark, no rank, no signature. The disclaimer at the
	 * bottom is part of the document rather than a note about it, exactly as on the real one.
	 *
	 * Drawn on a sheet rather than in a card, because that is what it is: a thing somebody prints
	 * on a browser's own print dialogue and hands over, like the volunteer-hours certificate it
	 * copies its posture from.
	 */
	import type { ShowcaseCertificate } from '$lib/content/showcase/courses';

	let { certificate }: { certificate: ShowcaseCertificate } = $props();
</script>

<div class="sheet">
	<p class="sheet__kind">{certificate.heading}</p>
	<p class="sheet__course">{certificate.courseTitle}</p>
	<p class="sheet__org">{certificate.organisation}</p>

	<dl class="sheet__facts">
		<div>
			<dt>{certificate.holderLabel}</dt>
			<dd>{certificate.holder}</dd>
		</div>
		<div>
			<dt>{certificate.issuerLabel}</dt>
			<dd>{certificate.issuer}</dd>
		</div>
		<div>
			<dt>{certificate.periodLabel}</dt>
			<dd>{certificate.period}</dd>
		</div>
		<div>
			<dt>{certificate.issuedLabel}</dt>
			<dd>{certificate.issuedOn}</dd>
		</div>
		<div class="sheet__basis">
			<dt>{certificate.basisLabel}</dt>
			<dd>{certificate.basis}</dd>
		</div>
	</dl>

	<p class="sheet__disclaimer">{certificate.disclaimer}</p>
</div>

<style lang="scss">
	.sheet {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: var(--space-5) var(--space-4);
		max-width: 38rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.sheet__kind {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--text-secondary);
	}
	.sheet__course {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 700;
	}
	.sheet__org {
		margin: 0 0 var(--space-3);
		color: var(--text-secondary);
	}
	.sheet__facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-3);
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);

		dt {
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-secondary);
			margin-bottom: 2px;
		}
		dd {
			margin: 0;
		}
	}
	.sheet__basis {
		grid-column: 1 / -1;
	}
	.sheet__disclaimer {
		margin: var(--space-3) 0 0;
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		line-height: 1.6;
	}
</style>
