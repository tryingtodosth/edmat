<script lang="ts">
	/** Event ↔ course, through the organisation (`prompts/06-event-takeaways.md`, `00-DESIGN.md` §2
	 * row "event ↔ course"): the bodies behind this event, and the courses those bodies run —
	 * "this conference's workshops became these courses".
	 *
	 * There is deliberately **no** event↔course foreign key. A conference and the courses that came
	 * out of it are related because one body ran both, and the body outlives either of them, so the
	 * link goes through the `organizations.Organization` hub (§1 rule 1). That is also why this
	 * panel names the organisation *before* it lists the courses: a list of courses with no stated
	 * reason for being on an event page is a connection the reader has to guess at.
	 *
	 * **It draws nothing when there are no courses to show.** Not tidiness: the organisation badges
	 * are already on this page (`OrganizationsPanel`, one marker up), so a "run by" line with
	 * nothing under it would repeat them and add a grey box to the page for no information. That is
	 * the same reasoning that made `VenuePanel` and `OrganizationsPanel` check their own kill switch
	 * instead of being wrapped in `FeatureGate` — which renders an "unavailable" notice, right for a
	 * route and wrong for a panel sitting mid-page. Found, both times, by looking at a screenshot.
	 *
	 * The kill switch is `organizations`: with it off this renders nothing, and the API answers `[]`
	 * rather than 403 so the event page itself keeps working (house rule 3's documented exception —
	 * `backend/events/learning_views.py` carries the reasoning).
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getRelatedCourses } from '$lib/services/events';
	import { getNodeOrganizations } from '$lib/services/organizations';
	import type { Course } from '$lib/types/course';
	import type { OrganizationLink } from '$lib/types/organization';
	import CourseCard from '$lib/components/course/CourseCard.svelte';

	let { eventId }: { eventId: string } = $props();

	// Checked here rather than by a wrapper — see the comment above. `isModerator` mirrors the
	// backend's own `is_staff` bypass in `feature_gate`, so the panel and the API agree about who
	// still sees data while the switch is off.
	let organizationsOn = $derived(
		featureFlagsStore.isEnabled('organizations') || authStore.isModerator
	);

	let courses = $state<Course[]>([]);
	let behind = $state<OrganizationLink[]>([]);

	// The id-changed guard `frontend/CLAUDE.md` trap 2 asks for: an `$effect` reading a prop re-fires
	// with no navigation at all. Keyed on the reader too, because both lists are narrowed by who is
	// asking (an unlisted course is visible to its own roster) and `authStore` resolves async.
	let loadedFor = $state('');
	$effect(() => {
		if (!organizationsOn) return;
		const key = `${eventId}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load(key);
	});

	async function load(key: string) {
		// Two reads, in parallel, and a failure in either leaves the panel silent: a panel that
		// cannot say whose courses these are has nothing honest to draw.
		const [rows, links] = await Promise.all([
			getRelatedCourses(eventId).catch(() => [] as Course[]),
			getNodeOrganizations('event', eventId).catch(() => [] as OrganizationLink[])
		]);
		if (loadedFor !== key) return;
		courses = rows;
		behind = links;
	}

	let runners = $derived(behind.filter((link) => link.kind === 'runs'));
	let supporters = $derived(behind.filter((link) => link.kind === 'supports'));
</script>

{#if organizationsOn && courses.length > 0}
	<section class="related-courses">
		<h2>{m.takehome_relatedHeading()}</h2>
		<!-- "Courses from the same organisations" -->
		{#if runners.length > 0}
			<p class="behind">
				<span class="behind__label">{m.takehome_relatedRunBy()}</span>
				<!-- "Run by" -->
				{#each runners as link, i (link.id)}{i > 0 ? ', ' : ''}<a
						href={resolve('/organizations/[slug]', { slug: link.organization.slug })}
						>{link.organization.name}</a
					>{/each}
			</p>
		{/if}
		{#if supporters.length > 0}
			<p class="behind">
				<span class="behind__label">{m.takehome_relatedSupportedBy()}</span>
				<!-- "Supported by" -->
				{#each supporters as link, i (link.id)}{i > 0 ? ', ' : ''}<a
						href={resolve('/organizations/[slug]', { slug: link.organization.slug })}
						>{link.organization.name}</a
					>{/each}
			</p>
		{/if}
		<p class="note">{m.takehome_relatedNote()}</p>
		<!-- "This event and these courses are connected through the body that stands behind both — there is no direct link between them." -->
		<div class="grid">
			{#each courses as course (course.id)}
				<CourseCard {course} />
			{/each}
		</div>
	</section>
{/if}

<style lang="scss">
	.related-courses {
		margin-top: 1.5rem;
	}
	h2 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-base);
	}
	.behind {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-sm);
	}
	.behind__label {
		color: var(--text-secondary);
	}
	.note {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.grid {
		display: grid;
		gap: var(--space-2);
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	}
</style>
