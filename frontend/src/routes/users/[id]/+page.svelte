<script lang="ts">
	// A stranger's public profile — reachable from any comment/review/submission byline throughout
	// the app once that becomes a real link (see the byline `<a>` this session added to CommentNode/
	// ReviewList/moderation's own name spans). Same client-side "$effect keyed off page.params, with
	// an id-changed idempotency guard" pattern the exercise/course detail pages already establish —
	// no +page.ts, this app has no server-rendered-auth story to back one (CLAUDE.md Section 16).
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate, formatRelativeDate } from '$lib/utils/format';
	import { getUserById, getUserEducation } from '$lib/services/users';
	import { getExercisesBySubmitter, getExercisesByIds } from '$lib/services/exercises';
	import { getReviewsByUser } from '$lib/services/reviews';
	import {
		getServiceById,
		getServiceReviewsByUser,
		getServicesByProvider
	} from '$lib/services/tutoring';
	import { getCourseById } from '$lib/services/taxonomy';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { Review, ResolvedExercise, Service, ServiceReview, User } from '$lib/types';
	import DonationLinksList from '$lib/components/shared/DonationLinksList.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import EducationCard from '$lib/components/shared/EducationCard.svelte';
	import ProfileExtras from '$lib/components/profile/ProfileExtras.svelte';
	import type { PublicEducation } from '$lib/types/identity';

	let user = $state<User | undefined>(undefined);

	/** Whether the badge row actually renders anything — the same four conditions the markup uses. A
	 * private profile with no roles renders an empty `.roles`, and hanging "what these badges mean" off
	 * a row with no badges in it would be explaining nothing. */
	const hasBadges = $derived(
		Boolean(
			user &&
			(user.isModerator ||
				user.isVerifiedContributor ||
				user.offersTutoring ||
				user.isProfilePublic)
		)
	);
	let loading = $state(true);
	let notFound = $state(false);

	let contributions = $state<ResolvedExercise[]>([]);
	let exerciseReviews = $state<Review[]>([]);
	let exerciseTitleById = $state<Record<string, string>>({});
	let serviceReviews = $state<ServiceReview[]>([]);
	let serviceTitleById = $state<Record<string, string>>({});
	let tutoringListings = $state<Service[]>([]);
	let listingCourseNamesById = $state<Record<string, string[]>>({});

	// A combined, chronologically-sorted feed of "their reviews" — exercise reviews and tutoring-
	// listing reviews are two genuinely separate backend resources (Review vs. ServiceReview, see
	// tutoring.ts's own doc comment on why they aren't merged into one shared type), but a visitor
	// reading someone's profile just wants "their reviews," not two artificially separate lists.
	type ProfileReviewRow =
		{ kind: 'exercise'; review: Review } | { kind: 'service'; review: ServiceReview };
	let combinedReviews = $derived<ProfileReviewRow[]>(
		[
			...exerciseReviews.map((review) => ({ kind: 'exercise' as const, review })),
			...serviceReviews.map((review) => ({ kind: 'service' as const, review }))
		].sort((a, b) => b.review.createdAt.localeCompare(a.review.createdAt))
	);

	async function loadContributions(userId: string, locale: string) {
		contributions = await getExercisesBySubmitter(userId, locale);
	}

	async function loadReviews(userId: string, locale: string) {
		const [exReviews, svcReviews] = await Promise.all([
			getReviewsByUser(userId),
			getServiceReviewsByUser(userId)
		]);
		exerciseReviews = exReviews;
		serviceReviews = svcReviews;

		const exerciseIds = [...new Set(exReviews.map((r) => r.exerciseId))];
		if (exerciseIds.length > 0) {
			const exercises = await getExercisesByIds(exerciseIds, locale);
			exerciseTitleById = Object.fromEntries(exercises.map((e) => [e.id, e.title]));
		} else {
			exerciseTitleById = {};
		}

		// Resolved from the reviewed SERVICES themselves, never from `tutoringListings` (that's this
		// profile owner's own listings — a review this person WROTE is almost always about someone
		// ELSE's listing, a completely different set of ids).
		const serviceIds = [...new Set(svcReviews.map((r) => r.serviceId))];
		if (serviceIds.length > 0) {
			const services = await Promise.all(serviceIds.map((id) => getServiceById(id)));
			serviceTitleById = Object.fromEntries(
				services.filter((s) => s !== undefined).map((s) => [s!.id, s!.title])
			);
		} else {
			serviceTitleById = {};
		}
	}

	async function loadTutoringListings(userId: string) {
		if (!featureFlagsStore.isEnabled('tutoring')) {
			tutoringListings = [];
			return;
		}
		const listings = await getServicesByProvider(userId);
		tutoringListings = listings;
		const entries = await Promise.all(
			listings.map(async (svc) => {
				const courses = await Promise.all(svc.courseIds.map((id) => getCourseById(id)));
				return [svc.id, courses.filter((c) => c !== undefined).map((c) => c!.name)] as const;
			})
		);
		listingCourseNamesById = Object.fromEntries(entries);
	}

	let education = $state<PublicEducation | null>(null);

	async function loadUser(id: string) {
		loading = true;
		notFound = false;
		const found = await getUserById(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		user = found;
		const locale = getLocale();
		await Promise.all([
			loadContributions(id, locale),
			loadReviews(id, locale),
			loadTutoringListings(id),
			// Null unless that account consented — see getUserEducation. A failure here must never
			// take the whole profile down over an optional section.
			getUserEducation(id)
				.then((res) => (education = res))
				.catch(() => (education = null))
		]);
		loading = false;
	}

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadUser(id);
	});
</script>

<svelte:head>
	<title>{user?.displayName ?? m.profile_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if notFound || !user}
		<p class="status">{m.profile_notFound()}</p>
	{:else}
		<section class="profile">
			<h1>{user.displayName}</h1>
			<div class="roles">
				{#if user.isModerator}
					<span class="badge">{m.settings_role_moderator()}</span>
				{/if}
				{#if user.isVerifiedContributor}
					<span class="badge">{m.settings_role_verifiedContributor()}</span>
				{/if}
				{#if user.offersTutoring}
					<span class="badge badge--tutoring">{m.profile_offersTutoring()}</span>
				{/if}
				{#if !user.isModerator && !user.isVerifiedContributor && !user.offersTutoring && user.isProfilePublic}
					<span class="badge badge--neutral">{m.settings_role_member()}</span>
				{/if}
				<!-- In the badge row itself rather than below it, so it reads as a caption on the badges
				     and not as a second thing to click. Worded for somebody looking at SOMEBODY ELSE'S
				     profile, which is the common case here and the one where "what does Verified
				     contributor actually mean?" is a real question — the same link on /settings asks it
				     the other way round, about your own. -->
				{#if hasBadges}
					<a class="badge-help" href={resolve('/levels')}>{m.profile_levelsHint()}</a>
				{/if}
			</div>

			{#if user.bio}
				<p class="bio">{user.bio}</p>
			{/if}

			{#if user.offersTutoring && user.tutoringNote}
				<p class="tutoring-note">{user.tutoringNote}</p>
			{/if}

			{#if authStore.isAuthenticated && authStore.user?.id !== user.id}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- an internal route built from resolve('/messages/new') plus a query string the eslint rule can't statically see through -->
				<a
					class="message-link"
					href={`${resolve('/messages/new')}?to=${encodeURIComponent(user.id)}`}
				>
					{m.profile_sendMessage()}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}

			{#if user.isProfilePublic === false}
				<p class="private-notice">{m.profile_private()}</p>
			{:else if user.joinedAt}
				<p class="joined">{m.settings_joined({ date: formatDate(user.joinedAt, getLocale()) })}</p>
			{/if}

			{#if user.donationLinks && user.donationLinks.length > 0}
				<div class="donations">
					<h2>{m.profile_supportHeading()}</h2>
					<DonationLinksList links={user.donationLinks} />
				</div>
			{/if}
		</section>

		{#if education}
			<EducationCard {education} />
		{/if}

		<!-- Your own profile is the same page everybody else sees; the ⋯ menus are the only difference,
		     so what you edit is what you are looking at rather than a separate form you then have to
		     imagine the public version of. -->
		<ProfileExtras userId={user.id} canEdit={authStore.user?.id === user.id} />

		{#if tutoringListings.length > 0}
			<section class="profile-section">
				<h2>{m.profile_tutoringListingsHeading()}</h2>
				<div class="listings-grid">
					{#each tutoringListings as service (service.id)}
						<ServiceCard {service} courseNames={listingCourseNamesById[service.id] ?? []} />
					{/each}
				</div>
			</section>
		{/if}

		<section class="profile-section">
			<h2>{m.profile_contributionsHeading()}</h2>
			{#if contributions.length === 0}
				<p class="status">{m.profile_contributionsEmpty()}</p>
			{:else}
				<div class="contributions-grid">
					{#each contributions as exercise (exercise.id)}
						<ExerciseCard {exercise} />
					{/each}
				</div>
			{/if}
		</section>

		<section class="profile-section">
			<h2>{m.profile_reviewsHeading()}</h2>
			{#if combinedReviews.length === 0}
				<p class="status">{m.profile_reviewsEmpty()}</p>
			{:else}
				<ul class="review-feed">
					{#each combinedReviews as row (`${row.kind}-${row.review.id}`)}
						<li class="review-feed__item">
							<div class="review-feed__top">
								{#if row.kind === 'exercise'}
									<!-- An exercise's own title can contain real LaTeX (the corpus's whole content
									     model, CLAUDE.md Section 11) — interpolating it into a plain m.*() message
									     string (as the service-review branch below correctly does, since a Service
									     title is always plain text) would leave raw, unrendered `\( \)` delimiters
									     visible; MathTitle is the same real KaTeX pipeline the exercise card/detail
									     page already render this exact string through elsewhere. -->
									<a href={resolve('/exercises/[id]', { id: row.review.exerciseId })}>
										{m.profile_reviewOnPrefix()}
										<MathTitle
											text={exerciseTitleById[row.review.exerciseId] ?? row.review.exerciseId}
										/>
									</a>
								{:else}
									<a href={resolve('/services/[id]', { id: row.review.serviceId })}>
										{m.profile_reviewOn({
											title: serviceTitleById[row.review.serviceId] ?? row.review.serviceId
										})}
									</a>
								{/if}
								<span class="review-feed__date">
									{formatRelativeDate(row.review.createdAt, getLocale())}
								</span>
							</div>
							<span class="review-feed__rating">{'★'.repeat(row.review.rating)}</span>
							{#if row.review.body}
								<p class="review-feed__body">{row.review.body}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.profile {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.roles {
		display: flex;
		gap: var(--space-1);
		// Wraps rather than squeezing the link onto the badge line: three badges plus a caption does not
		// fit a phone, and a badge row that scrolls sideways would hide the badges themselves.
		flex-wrap: wrap;
		align-items: center;
	}
	.badge-help {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin-left: var(--space-1);
		// Underlined explicitly. The global reset sets `text-decoration: none` on every anchor, which
		// is fine where colour, weight or a button shape already says "clickable" — here it left a
		// small grey caption that gave a reader no reason to think it could be followed at all, which
		// was visible the moment the row was looked at rather than in any assertion.
		text-decoration: underline;
		text-underline-offset: 0.2em;

		&:hover {
			color: var(--accent);
		}
	}
	.badge {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.badge--neutral {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
	.badge--tutoring {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.bio {
		white-space: pre-wrap;
	}
	.tutoring-note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		font-style: italic;
	}
	.message-link {
		@include mix.button-secondary;
		align-self: flex-start;
	}
	.private-notice {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		font-style: italic;
	}
	.joined {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.donations {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
		h2 {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
		}
	}
	.profile-section {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.profile-section h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.listings-grid,
	.contributions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: var(--space-3);
	}
	.review-feed {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.review-feed__item {
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-3);
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.review-feed__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
		a {
			font-weight: 600;
			color: var(--text-primary);
			&:hover {
				color: var(--accent);
			}
		}
	}
	.review-feed__date {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.review-feed__rating {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
	.review-feed__body {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
