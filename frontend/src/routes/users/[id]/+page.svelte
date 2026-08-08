<script lang="ts">
	// A profile as one screen, with the detail behind modals.
	//
	// It used to be a long scroll: an identity card, an education card, experience, skills, a filterable
	// activity feed, tutoring listings, a grid of every contributed exercise, and every review in full.
	// On a phone that is eight or nine screens, and the question somebody actually opens a profile to
	// answer — "who is this, and what have they done here?" — was answerable only by scrolling past all
	// of it. So the page now summarises, and every section that was a wall is a row that opens onto the
	// same content in a dialog.
	//
	// **Designed at phone width first**, which is why the summary is rows and tiles rather than columns:
	// a row with a label, a count and a chevron reads identically at 390px and at 1200px, where a
	// two-column card layout has to be invented twice.
	//
	// Same client-side "$effect keyed off page.params, with an id-changed idempotency guard" pattern the
	// rest of this app uses — no +page.ts, since there is no server-rendered-auth story to back one.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate, formatRelativeDate } from '$lib/utils/format';
	import { getUserById, getUserEducation } from '$lib/services/users';
	import { getUserActivity, getUserExtras } from '$lib/services/profileExtras';
	import { getReviewsByUser } from '$lib/services/reviews';
	import { getExercisesByIds } from '$lib/services/exercises';
	import {
		getServiceById,
		getServiceReviewsByUser,
		getServicesByProvider
	} from '$lib/services/tutoring';
	import { getBranchById } from '$lib/services/taxonomy';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { Review, Service, ServiceReview, User } from '$lib/types';
	import type { PublicEducation } from '$lib/types/identity';
	import type {
		ActivityFeed,
		ActivityKind,
		Certificate,
		ExperienceEntry,
		SkillEntry
	} from '$lib/types/profileExtras';
	import DonationLinksList from '$lib/components/shared/DonationLinksList.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import ActivityList from '$lib/components/profile/ActivityList.svelte';
	import CertificatesList from '$lib/components/profile/CertificatesList.svelte';
	import ExperienceList from '$lib/components/profile/ExperienceList.svelte';
	import SkillsList from '$lib/components/profile/SkillsList.svelte';
	import TranscriptView from '$lib/components/profile/TranscriptView.svelte';

	let user = $state<User | undefined>(undefined);
	let loading = $state(true);
	let notFound = $state(false);

	let experience = $state<ExperienceEntry[]>([]);
	let skills = $state<SkillEntry[]>([]);
	let certificates = $state<Certificate[]>([]);
	let feed = $state<ActivityFeed>({ items: [], tags: [], kinds: [], counts: {} });
	let education = $state<PublicEducation | null>(null);
	let exerciseReviews = $state<Review[]>([]);
	let serviceReviews = $state<ServiceReview[]>([]);
	let exerciseTitleById = $state<Record<string, string>>({});
	let serviceTitleById = $state<Record<string, string>>({});
	let listings = $state<Service[]>([]);
	let listingBranchNames = $state<Record<string, string[]>>({});

	/** Which dialog is open. One value rather than a boolean per modal: only one can be open at a time,
	 * and a set of booleans makes "two at once" representable — a state every close handler would then
	 * have to defend against. */
	type Modal =
		| 'activity'
		| 'education'
		| 'experience'
		| 'skills'
		| 'certificates'
		| 'reviews'
		| 'listings'
		| 'bio';
	let modal = $state<Modal | null>(null);
	let activityFilter = $state<ActivityKind | ''>('');

	function openActivity(kind: ActivityKind | '') {
		activityFilter = kind;
		modal = 'activity';
	}

	const isMe = $derived(Boolean(user && authStore.user?.id === user.id));

	/** Whether the badge row renders anything — the same four conditions the markup uses. A private
	 * profile with no roles renders an empty row, and hanging "what these badges mean" off a row with no
	 * badges in it would be explaining nothing. */
	const hasBadges = $derived(
		Boolean(
			user &&
			(user.isModerator ||
				user.isVerifiedContributor ||
				user.offersTutoring ||
				user.isProfilePublic)
		)
	);

	/** The tiles, in a fixed order, one per kind the feed actually contains.
	 *
	 * Driven from the server's own per-kind counts rather than from invented groupings ("contributions",
	 * "engagement"): those counts are computed from what THIS reader was given, so a tile can never
	 * advertise a row the feed then withholds — which is exactly what a client-side count over a
	 * pre-filtered list would do. */
	const TILE_ORDER: ActivityKind[] = [
		'exercise',
		'material',
		'review',
		'service_review',
		'comment',
		'lesson_done',
		'saved_set',
		'course_taught',
		'course_joined'
	];
	const TILE_LABEL: Record<ActivityKind, () => string> = {
		exercise: () => m.profile_tile_exercises(), // "Exercises"
		material: () => m.profile_tile_materials(), // "Materials"
		review: () => m.profile_tile_reviews(), // "Reviews"
		service_review: () => m.profile_tile_serviceReviews(), // "Tutor reviews"
		comment: () => m.profile_tile_comments(), // "Comments"
		lesson_done: () => m.profile_tile_finished(), // "Finished"
		saved_set: () => m.profile_tile_sets(), // "Saved sets"
		course_taught: () => m.profile_tile_teaching(), // "Runs"
		course_joined: () => m.profile_tile_taking() // "Takes"
	};
	const tiles = $derived(
		TILE_ORDER.filter((kind) => (feed.counts[kind] ?? 0) > 0).map((kind) => ({
			kind,
			count: feed.counts[kind] ?? 0
		}))
	);

	/** Both kinds of review in one list, newest first. They are two backend resources (an exercise
	 * review and a tutoring-listing review) and one question to a reader. */
	type ReviewRow =
		{ kind: 'exercise'; review: Review } | { kind: 'service'; review: ServiceReview };
	const reviewRows = $derived<ReviewRow[]>(
		[
			...exerciseReviews.map((review) => ({ kind: 'exercise' as const, review })),
			...serviceReviews.map((review) => ({ kind: 'service' as const, review }))
		].sort((a, b) => b.review.createdAt.localeCompare(a.review.createdAt))
	);

	/** Whether the bio is actually being cut off, measured rather than guessed from its length.
	 *
	 * The first version compared `bio.length` against a character threshold, which disagreed with the
	 * CSS line clamp doing the real cutting: a 174-character bio wrapped to four lines at 390px and was
	 * visibly truncated while sitting under a 180-character threshold, so the way to read the rest was
	 * never offered. A character count cannot know the width, the font or the line height; asking the
	 * element is the only answer that is right at every size. */
	let bioEl: HTMLElement | undefined = $state();
	let bioClamped = $state(false);
	$effect(() => {
		// Reading `user?.bio` is what makes this re-measure when the text changes rather than only on
		// first render.
		void user?.bio;
		bioClamped = bioEl ? bioEl.scrollHeight > bioEl.clientHeight + 1 : false;
	});

	async function loadReviews(id: string, locale: string) {
		const [exercise, service] = await Promise.all([
			getReviewsByUser(id),
			getServiceReviewsByUser(id)
		]);
		exerciseReviews = exercise;
		serviceReviews = service;

		const exerciseIds = [...new Set(exercise.map((r) => r.exerciseId))];
		exerciseTitleById = exerciseIds.length
			? Object.fromEntries(
					(await getExercisesByIds(exerciseIds, locale)).map((e) => [e.id, e.title])
				)
			: {};

		// Resolved from the reviewed SERVICES, never from this person's own listings — a review they
		// wrote is almost always about somebody else's offering, a completely different set of ids.
		const serviceIds = [...new Set(service.map((r) => r.serviceId))];
		const resolved = await Promise.all(serviceIds.map((id) => getServiceById(id)));
		serviceTitleById = Object.fromEntries(
			resolved.filter((s) => s !== undefined).map((s) => [s!.id, s!.title])
		);
	}

	async function loadListings(id: string) {
		if (!featureFlagsStore.isEnabled('tutoring')) {
			listings = [];
			return;
		}
		listings = await getServicesByProvider(id);
		const entries = await Promise.all(
			listings.map(async (service) => {
				const branches = await Promise.all(service.branchIds.map((b) => getBranchById(b)));
				return [service.id, branches.filter((b) => b !== undefined).map((b) => b!.name)] as const;
			})
		);
		listingBranchNames = Object.fromEntries(entries);
	}

	async function load(id: string) {
		loading = true;
		notFound = false;
		modal = null;
		const found = await getUserById(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		user = found;
		const locale = getLocale();
		await Promise.all([
			getUserExtras(id).then((extras) => {
				experience = extras.experience;
				skills = extras.skills;
				certificates = extras.certificates;
			}),
			getUserActivity(id).then((res) => (feed = res)),
			loadReviews(id, locale),
			loadListings(id),
			// Null unless that account consented. A failure here must never take the whole profile down
			// over one optional section.
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
		load(id);
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
		<section class="identity">
			<div class="identity__head">
				{#if user.avatarUrl}
					<img class="avatar" src={user.avatarUrl} alt="" width="64" height="64" />
				{:else}
					<!-- A plain initial rather than a generated identicon: inventing a second visual identity
					     for an account is a bigger decision than this page, and an empty circle reads as
					     broken. `aria-hidden` because the name is right beside it. -->
					<span class="avatar avatar--empty" aria-hidden="true">
						{(user.displayName || '?').slice(0, 1).toUpperCase()}
					</span>
				{/if}
				<div class="identity__names">
					<h1>{user.displayName}</h1>
					{#if user.isProfilePublic === false}
						<p class="muted">{m.profile_private()}</p>
					{:else if user.joinedAt}
						<p class="muted">
							{m.settings_joined({ date: formatDate(user.joinedAt, getLocale()) })}
						</p>
					{/if}
				</div>
			</div>

			<div class="badges">
				{#if user.isModerator}
					<span class="badge">{m.settings_role_moderator()}</span>
				{/if}
				{#if user.isVerifiedContributor}
					<span class="badge">{m.settings_role_verifiedContributor()}</span>
				{/if}
				{#if user.offersTutoring}
					<span class="badge">{m.profile_offersTutoring()}</span>
				{/if}
				{#if !user.isModerator && !user.isVerifiedContributor && !user.offersTutoring && user.isProfilePublic}
					<span class="badge badge--neutral">{m.settings_role_member()}</span>
				{/if}
				{#if hasBadges}
					<a class="badge-help" href={resolve('/levels')}>{m.profile_levelsHint()}</a>
				{/if}
			</div>

			{#if user.bio}
				<!-- The full text, visually clamped by CSS, rather than a hand-sliced copy of it. Slicing
				     as well produced two ellipses — one from the slice and one from the clamp — on a line
				     the reader could see was cut twice. -->
				<p class="bio" bind:this={bioEl}>{user.bio}</p>
				{#if bioClamped}
					<button type="button" class="link" onclick={() => (modal = 'bio')}>
						{m.profile_readMore()}
						<!-- "Read all" -->
					</button>
				{/if}
			{/if}

			{#if user.offersTutoring && user.tutoringNote}
				<p class="tutoring-note">{user.tutoringNote}</p>
			{/if}

			<div class="identity__actions">
				{#if isMe}
					<a class="button-primary" href={resolve('/settings/profile')}>
						{m.profile_editProfile()}
						<!-- "Edit my profile" -->
					</a>
				{:else if authStore.isAuthenticated}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- an internal route built from resolve('/messages/new') plus a query string the eslint rule can't statically see through -->
					<a
						class="button-secondary"
						href={`${resolve('/messages/new')}?to=${encodeURIComponent(user.id)}`}
					>
						{m.profile_sendMessage()}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</div>
		</section>

		{#if tiles.length > 0}
			<!-- Not a `role="tablist"`: these are six buttons that each open a dialog, not a tab strip
			     over one panel, and claiming otherwise would promise a screen-reader user arrow-key
			     navigation this does not implement. -->
			<ul class="tiles">
				{#each tiles as tile (tile.kind)}
					<li>
						<button type="button" class="tile" onclick={() => openActivity(tile.kind)}>
							<span class="tile__count">{tile.count}</span>
							<span class="tile__label">{TILE_LABEL[tile.kind]()}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<section class="rows">
			<h2>{m.profile_aboutHeading()}</h2>
			<!-- "About" -->
			{#if education}
				<button type="button" class="row" onclick={() => (modal = 'education')}>
					<span class="row__label">{m.education_publicHeading()}</span>
					<span class="row__value">
						{education.school}
						{#if education.gradeYears.length > 0}
							· {m.profile_rowYears({ count: education.gradeYears.length })}
							<!-- "{count} years of results" -->
						{/if}
					</span>
					<span class="row__go" aria-hidden="true">›</span>
				</button>
			{/if}
			<button type="button" class="row" onclick={() => (modal = 'experience')}>
				<span class="row__label">{m.profile_experienceHeading()}</span>
				<span class="row__value">
					{experience.length > 0 ? (experience[0].title ?? '') : m.profile_rowNothing()}
					<!-- "Nothing added" -->
				</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>
			<button type="button" class="row" onclick={() => (modal = 'skills')}>
				<span class="row__label">{m.profile_skillsHeading()}</span>
				<span class="row__value">
					{skills.length > 0
						? skills
								.slice(0, 3)
								.map((s) => s.label)
								.join(', ')
						: m.profile_rowNothing()}
				</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>
			<button type="button" class="row" onclick={() => (modal = 'certificates')}>
				<span class="row__label">{m.profile_certificatesHeading()}</span>
				<span class="row__value">
					{certificates.length > 0
						? m.profile_rowCount({ count: certificates.length })
						: m.profile_rowNothing()}
					<!-- "{count}" -->
				</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>
			{#if reviewRows.length > 0}
				<button type="button" class="row" onclick={() => (modal = 'reviews')}>
					<span class="row__label">{m.profile_reviewsHeading()}</span>
					<span class="row__value">{m.profile_rowCount({ count: reviewRows.length })}</span>
					<span class="row__go" aria-hidden="true">›</span>
				</button>
			{/if}
			{#if listings.length > 0}
				<button type="button" class="row" onclick={() => (modal = 'listings')}>
					<span class="row__label">{m.profile_tutoringListingsHeading()}</span>
					<span class="row__value">{m.profile_rowCount({ count: listings.length })}</span>
					<span class="row__go" aria-hidden="true">›</span>
				</button>
			{/if}
		</section>

		<section class="recent">
			<div class="recent__head">
				<h2>{m.profile_activityHeading()}</h2>
				<button type="button" class="link" onclick={() => openActivity('')}>
					{m.profile_seeAll()}
					<!-- "See all" -->
				</button>
			</div>
			<ActivityList {feed} limit={3} />
		</section>

		{#if user.donationLinks && user.donationLinks.length > 0}
			<section class="rows">
				<h2>{m.profile_supportHeading()}</h2>
				<DonationLinksList links={user.donationLinks} />
			</section>
		{/if}
	{/if}
</div>

{#if modal === 'bio' && user}
	<ModalShell title={user.displayName} onClose={() => (modal = null)}>
		<!-- `.bio--full`, not the summary's own `.bio`: that class carries the three-line clamp, so
		     reusing it here showed the reader the same truncated text they had just tapped "Read all" to
		     escape. Caught by measuring the rendered element rather than by trusting that a dialog
		     labelled "read all" reads all. -->
		<p class="bio bio--full">{user.bio}</p>
	</ModalShell>
{:else if modal === 'activity'}
	<ModalShell title={m.profile_activityHeading()} onClose={() => (modal = null)}>
		<ActivityList {feed} bind:kindFilter={activityFilter} />
	</ModalShell>
{:else if modal === 'education' && education}
	<ModalShell title={m.education_publicHeading()} onClose={() => (modal = null)}>
		<dl class="facts">
			<dt>{m.education_factSchool()}</dt>
			<dd>{education.school}</dd>
			{#if education.programme}
				<dt>{m.education_factProgramme()}</dt>
				<dd>{education.programme}</dd>
			{/if}
		</dl>
		{#if education.diplomas.length > 0}
			<div>
				<h3>{m.education_diplomasHeading()}</h3>
				<ul class="plain">
					{#each education.diplomas as diploma (diploma.title + diploma.issuedOn)}
						<li>
							<strong>{diploma.title}</strong>
							{#if diploma.issuedOn}<span class="muted"> · {diploma.issuedOn}</span>{/if}
							{#if diploma.finalGrade}<span class="muted"> · {diploma.finalGrade}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if education.gradeYears.length > 0}
			<div>
				<h3>{m.education_gradesHeading({ count: education.grades.length })}</h3>
				{#if education.average !== null}
					<p class="muted">{m.education_weightedAverage({ average: education.average })}</p>
				{/if}
				<TranscriptView years={education.gradeYears} grades={education.grades} />
			</div>
		{/if}
	</ModalShell>
{:else if modal === 'experience'}
	<ModalShell title={m.profile_experienceHeading()} onClose={() => (modal = null)}>
		<ExperienceList entries={experience} />
	</ModalShell>
{:else if modal === 'skills'}
	<ModalShell title={m.profile_skillsHeading()} onClose={() => (modal = null)}>
		<SkillsList {skills} />
	</ModalShell>
{:else if modal === 'certificates'}
	<ModalShell title={m.profile_certificatesHeading()} onClose={() => (modal = null)}>
		<CertificatesList {certificates} />
	</ModalShell>
{:else if modal === 'reviews'}
	<ModalShell title={m.profile_reviewsHeading()} onClose={() => (modal = null)}>
		<ul class="review-feed">
			{#each reviewRows as row (`${row.kind}-${row.review.id}`)}
				<li class="review">
					<div class="review__top">
						{#if row.kind === 'exercise'}
							<!-- An exercise's own title can contain real LaTeX, so it goes through the same KaTeX
							     pipeline the exercise card uses; a Service title is always plain text, so
							     interpolating it into a message is correct there. -->
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
						<span class="muted">{formatRelativeDate(row.review.createdAt, getLocale())}</span>
					</div>
					<span class="review__rating">{'★'.repeat(row.review.rating)}</span>
					{#if row.review.body}
						<p class="review__body">{row.review.body}</p>
					{/if}
				</li>
			{/each}
		</ul>
	</ModalShell>
{:else if modal === 'listings'}
	<ModalShell title={m.profile_tutoringListingsHeading()} onClose={() => (modal = null)}>
		<div class="listings">
			{#each listings as service (service.id)}
				<ServiceCard {service} branchNames={listingBranchNames[service.id] ?? []} />
			{/each}
		</div>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		// Narrower than the app's usual 780: a profile is a single column of summary rows, and stretching
		// those to 780 leaves the label and its value at opposite ends of an empty line.
		max-width: 560px;
		margin: 0 auto;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		// space-2 rather than space-3 between cards: at 390px the six gaps this page has were costing
		// nearly 50px of the one screen the summary has to fit into, for separation the card borders
		// already provide.
		gap: var(--space-2);
	}
	.status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.identity,
	.rows,
	.recent {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.identity__head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.avatar {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	.avatar--empty {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: var(--font-size-xl);
		font-weight: 600;
	}
	.identity__names {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	h1 {
		font-size: var(--font-size-lg);
		// A long display name must wrap rather than widen the card past the viewport.
		overflow-wrap: anywhere;
	}
	h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	h3 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-bottom: var(--space-1);
	}
	.muted {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.badges {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
		align-items: center;
	}
	.badge {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.badge--neutral {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
	.badge-help {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		&:hover {
			color: var(--accent);
		}
	}
	.bio {
		white-space: pre-wrap;
		font-size: var(--font-size-sm);
		// Clamped to three lines with the full text one tap away, rather than letting a long bio push
		// the tiles and the summary rows off the screen this page exists to fit into. The character
		// cut in the markup is a different bound and both are needed: that one decides whether "Read
		// all" appears at all, this one decides how much of what remains is drawn.
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.bio--full {
		display: block;
		overflow: visible;
	}
	.tutoring-note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		font-style: italic;
		// One line: it is a note beside a badge, not a second bio.
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.link {
		@include mix.focus-ring;
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--accent);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.identity__actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.button-primary {
		@include mix.button-primary;
	}
	.button-secondary {
		@include mix.button-secondary;
	}

	.tiles {
		display: grid;
		// Four columns at every width, rather than as many as fit. `auto-fit` gave three on a phone —
		// which put eight tiles on three rows and cost the summary the ~70px it needed to fit one
		// screen — and seven on a desktop, which left the eighth alone on a row of its own. A fixed
		// four is two tidy rows in both places, and the labels were already wrapping at either size, so
		// the narrower cell loses nothing.
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-1);
	}
	.tile {
		@include mix.card-surface;
		@include mix.focus-ring;
		width: 100%;
		// Comfortably past the 44px a thumb needs; these are this page's main navigation.
		min-height: 56px;
		padding: var(--space-1);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		&:hover {
			border-color: var(--accent);
		}
	}
	.tile__count {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--text-primary);
	}
	.tile__label {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-align: center;
	}

	.row {
		@include mix.focus-ring;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 44px;
		padding: var(--space-2) 0;
		background: none;
		border: none;
		border-bottom: 1px solid var(--border-color);
		cursor: pointer;
		text-align: left;
		&:last-child {
			border-bottom: none;
		}
		&:hover .row__label {
			color: var(--accent);
		}
	}
	.row__label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-primary);
		flex-shrink: 0;
	}
	.row__value {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		// Truncates rather than wrapping: the row is a summary, the modal behind it is the full answer,
		// and a two-line summary row defeats the point of the layout.
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: right;
	}
	.row__go {
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.recent__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
		dt {
			color: var(--text-secondary);
		}
	}
	.plain {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.review-feed {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.review {
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 2px;
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.review__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
		a {
			font-weight: 600;
			color: var(--text-primary);
			font-size: var(--font-size-sm);
			&:hover {
				color: var(--accent);
			}
		}
	}
	.review__rating {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
	.review__body {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.listings {
		display: grid;
		gap: var(--space-3);
	}
</style>
