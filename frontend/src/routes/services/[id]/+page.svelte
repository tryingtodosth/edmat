<script lang="ts">
	// A tutoring listing's own detail page — the host for reviews/comments/watchlist-toggle, the
	// same reasoning the material detail page's own doc comment already gives for why this couldn't
	// just be crammed into the compact ServiceCard grid component: reviews+discussion+a watchlist
	// toggle need real page-level space, not a card. Reuses ServiceCard directly for the listing's
	// own info (title, description, courses, contact/report — the exact "one card component, reused
	// at a different weight/context" economy CLAUDE.md's Section 17G already establishes for
	// Material), rather than re-rendering any of that by hand here.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Comment, Course, Service, ServiceReview, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		AlreadyWatchingError,
		getServiceById,
		getServiceReviews,
		getWatchlist,
		submitServiceReview,
		unwatchService,
		watchService
	} from '$lib/services/tutoring';
	import { getCourseById } from '$lib/services/taxonomy';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import ReviewList from '$lib/components/review/ReviewList.svelte';
	import LocationMap from '$lib/components/service/LocationMap.svelte';
	import ReviewForm from '$lib/components/review/ReviewForm.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import BookingPanel from '$lib/components/booking/BookingPanel.svelte';

	let service = $state<Service | undefined>(undefined);
	let courseNames = $state<string[]>([]);
	let reviews = $state<ServiceReview[]>([]);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let loading = $state(true);
	let notFound = $state(false);
	let submissionNotice = $state<'review' | null>(null);

	// The current watch, if the logged-in visitor already has this listing on their own watchlist —
	// `undefined` means "not watched" (or not logged in), matching `guestSetStore`'s own honest
	// "absence means not present" convention rather than a separate boolean-plus-id pair.
	let watchId = $state<string | undefined>(undefined);
	let watchlistError = $state(false);

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function loadWatchState(serviceId: string) {
		if (!authStore.isAuthenticated) {
			watchId = undefined;
			return;
		}
		try {
			const watchlist = await getWatchlist();
			watchId = watchlist.find((w) => w.service.id === serviceId)?.id;
		} catch {
			watchId = undefined;
		}
	}

	async function loadAll(id: string) {
		loading = true;
		notFound = false;
		submissionNotice = null;
		watchlistError = false;

		const svc = await getServiceById(id);
		if (!svc) {
			notFound = true;
			loading = false;
			return;
		}
		service = svc;

		const [courses, revs, cmts] = await Promise.all([
			Promise.all(svc.courseIds.map((cid) => getCourseById(cid))),
			getServiceReviews(id),
			getCommentsForTarget('service', id),
			loadWatchState(id)
		]);
		courseNames = (courses as (Course | undefined)[])
			.filter((c): c is Course => c !== undefined)
			.map((c) => c.name);
		reviews = revs;
		comments = cmts;

		await resolveUsers([...revs.map((r) => r.userId), ...cmts.map((c) => c.authorId)]);
		loading = false;
	}

	// Same id-changed idempotency guard the exercise/material detail pages already established —
	// a plain `$effect(() => loadAll(page.params.id!))` re-fires spuriously even with no navigation.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadAll(id);
	});

	async function handleReviewSubmit(rating: number, body: string) {
		if (!service || !authStore.user) return;
		const review = await submitServiceReview(service.id, authStore.user.id, rating, body);
		// The same resubmit-replaces-not-duplicates fix the exercise detail page already needed
		// (ServiceReview has the identical unique_together = [('service', 'author')] upsert path).
		reviews = [review, ...reviews.filter((r) => r.id !== review.id)];
		await resolveUsers([review.userId]);
		submissionNotice = 'review';
		// The service's own averageRating/reviewCount summary (rendered via the reused ServiceCard)
		// only reflects what the last fetch saw — refetch so a fresh review is reflected there too.
		const refreshed = await getServiceById(service.id);
		if (refreshed) service = refreshed;
	}

	async function handleCommentSubmit(body: string, parentId?: string) {
		if (!service || !authStore.user) return;
		const comment = await submitComment('service', service.id, authStore.user.id, body, parentId);
		comments = [...comments, comment];
	}

	async function toggleWatch() {
		if (!service) return;
		watchlistError = false;
		try {
			if (watchId) {
				await unwatchService(watchId);
				watchId = undefined;
			} else {
				const watch = await watchService(service.id);
				watchId = watch.id;
			}
		} catch (e) {
			if (e instanceof AlreadyWatchingError) {
				await loadWatchState(service.id);
			} else {
				watchlistError = true;
			}
		}
	}
</script>

<svelte:head>
	<title>{service ? service.title : m.services_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound || !service}
		<p class="empty">{m.services_notFound()}</p>
	{:else}
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/fields')}>{m.common_home()}</a> ›
			<a href={resolve('/services')}>{m.services_heading()}</a>
		</nav>

		<ServiceCard {service} {courseNames} linkTitle={false} />

		<!-- The map lives on the detail page only, never on the browse card. A Leaflet instance per
		     card would mean a dozen map widgets and a tile request storm on one browse page, for
		     information the card's own location line already conveys in text. Here, where a student
		     is deciding whether they can actually get there, the map is the point. -->
		{#if service.location}
			<section class="content-section location-section">
				<h2>{m.services_field_location()}</h2>
				<p class="location-address">
					{service.location.label || m.services_locationNoLabel()}
				</p>
				<LocationMap
					lat={service.location.lat}
					lon={service.location.lon}
					label={service.location.label}
				/>
			</section>
		{/if}

		<!-- Above reviews and discussion: somebody who has read the card and the map is deciding
		     whether they can actually get an hour, and that question comes before what other people
		     thought of it. -->
		<BookingPanel {service} />

		{#if authStore.isAuthenticated && authStore.user?.id !== service.providerId}
			<section class="watchlist-action no-print">
				<button
					type="button"
					class="watch-button"
					class:watch-button--active={!!watchId}
					onclick={toggleWatch}
				>
					{watchId ? m.services_removeFromWatchlist() : m.services_addToWatchlist()}
				</button>
				{#if watchlistError}
					<p class="error">{m.services_watchlistAddFailed()}</p>
				{/if}
			</section>
		{/if}

		<section class="content-section">
			<h2>{m.review_heading()}</h2>
			{#if reviews.length > 0}
				<p class="review-summary">
					{m.review_average({
						average:
							Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10,
						count: reviews.length
					})}
				</p>
			{/if}
			<ReviewList {reviews} {usersById} kind="service_review" />
			{#if authStore.isAuthenticated}
				{#if submissionNotice === 'review'}
					<p class="notice">{m.review_thanks()}</p>
				{/if}
				<ReviewForm onSubmit={handleReviewSubmit} />
			{:else}
				<p class="login-prompt"><a href={resolve('/login')}>{m.review_loginToReview()}</a></p>
			{/if}
		</section>

		<section class="content-section">
			<h2>{m.discussion_heading()}</h2>
			<DiscussionThread {comments} {usersById} onSubmit={handleCommentSubmit} />
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;
	.location-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.location-address {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin: 0;
		overflow-wrap: anywhere;
	}

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.watchlist-action {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;
	}
	.watch-button {
		@include mix.button-secondary;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		&--active {
			background: var(--accent);
			color: var(--accent-contrast);
			border-color: var(--accent);
		}
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.content-section {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.content-section h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.review-summary {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.login-prompt {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
