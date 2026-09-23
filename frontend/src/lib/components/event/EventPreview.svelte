<script lang="ts">
	/** "See this page as somebody else" — the whole of CONFERENCE-BRIEF.md §3.B's second
	 * deliverable, mounted at the event page's `<!-- conference: preview -->` marker.
	 *
	 * WHAT THIS IS NOT. It is not "log in as". No token belonging to anybody else is ever minted,
	 * fetched or held; the viewer stays themselves throughout. The visitor preview re-runs the same
	 * four reads through `client.ts` with `{ anonymous: true }`, which simply omits the
	 * `Authorization` header — so what is rendered is literally the server's answer to a signed-out
	 * request, not this component's guess at one.
	 *
	 * That distinction is the lesson of the 2018 Facebook "View As" breach
	 * (`CONFERENCE-RESEARCH-REPORT.md` §5): their preview was meant to be read-only, one embedded
	 * widget inside it stayed interactive, and that widget minted an access token for the person
	 * being viewed. Three rules follow, and all three are held here:
	 *
	 *   1. A preview never carries or issues a token for anybody. (`anonymous: true`, and nothing
	 *      else.)
	 *   2. A preview renders no interactive control at all — the body below contains no button, no
	 *      form and no link. The one control that exists is the way out, and it lives in the bar.
	 *   3. The bar cannot be dismissed while the preview is on: the only thing that removes it is
	 *      leaving the preview, so there is no state where somebody is looking at a preview and
	 *      does not know it.
	 *
	 * TWO MODES, AND THEY ARE NOT THE SAME KIND OF THING.
	 *   - "a signed-out visitor" is a real permission check: the data is what the API gives with no
	 *     sign-in. A draft honestly comes back as nothing.
	 *   - "somebody going" is a LAYOUT preview and says so on its face. It renders the viewer's own
	 *     responses with the controls the API's `can_*` fields say an attendee lacks taken away. It
	 *     cannot prove a permission, because the data behind it is still the organiser's — proving
	 *     an attendee's permissions is what `events/test_permission_matrix.py` is for, and what the
	 *     `persona.attendee` account is for.
	 */
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { formatDateTime } from '$lib/utils/datetime';
	import { getContributions, getEvent, getEventAttendees, getSessions } from '$lib/services/events';
	import type { Contribution, EdmatEvent, EventAttendee, Session } from '$lib/types/event';

	let { event }: { event: EdmatEvent } = $props();

	type Mode = 'off' | 'visitor' | 'attendee';
	let mode = $state<Mode>('off');
	let loading = $state(false);
	/** The event as the preview's own fetch returned it — `null` when that fetch found nothing,
	 * which is the honest answer for a draft seen by a stranger and is rendered as such. */
	let shown = $state<EdmatEvent | null>(null);
	let sessions = $state<Session[]>([]);
	let roster = $state<EventAttendee[]>([]);
	let contributions = $state<Contribution[]>([]);
	/** The roster answering 403 is a RESULT, not an error: it is the rule working, and saying so is
	 * more useful than an empty list that looks like "nobody is coming". */
	let rosterRefused = $state(false);
	/** The preview is mounted where the marker is — below the organiser's own panels — so entering
	 * it without moving the page leaves the reader looking at the controls the bar has just said
	 * cannot be used. Scrolled to on entry; `scroll-margin-top` keeps it clear of the fixed bar. */
	let viewEl = $state<HTMLDivElement | null>(null);

	// The same one-line gate the header uses (`featureFlagsStore.isEnabled || isModerator`), so a
	// moderator can still see the preview with the switch off and decide whether to turn it back on.
	const can = (key: Parameters<typeof featureFlagsStore.isEnabled>[0]) =>
		featureFlagsStore.isEnabled(key) || authStore.isModerator;
	// Only somebody who runs the event has anything to preview — an attendee looking at "what a
	// stranger sees" is looking at very nearly their own page.
	let visible = $derived(can('role_preview') && (event.canOrganise || event.canCheckIn));

	async function enter(next: Exclude<Mode, 'off'>) {
		mode = next;
		loading = true;
		shown = null;
		sessions = [];
		roster = [];
		contributions = [];
		// `anonymous: true` for the visitor, nothing for the layout preview: the difference between
		// the two modes is exactly this one option, which is what makes the first a real check and
		// the second honestly only a layout.
		const options = next === 'visitor' ? { anonymous: true } : undefined;
		try {
			shown = await getEvent(event.id, options);
		} catch {
			// Not a failure: a draft, or a private event, genuinely does not exist for a signed-out
			// visitor, and saying so is the most useful thing this preview can say.
			shown = null;
			loading = false;
			await tick();
			viewEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
			return;
		}
		// Each of the three is allowed to refuse on its own — a private roster answers 403 to a
		// stranger, and that is a rendered line here rather than an error.
		const [s, r, c] = await Promise.all([
			getSessions(event.id, options).catch(() => null),
			getEventAttendees(event.id, options).catch(() => null),
			getContributions(event.id, options).catch(() => null)
		]);
		sessions = s ?? [];
		roster = r ?? [];
		contributions = c ?? [];
		rosterRefused = r === null;
		loading = false;
		await tick();
		viewEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	function leave() {
		mode = 'off';
		shown = null;
		sessions = [];
		roster = [];
		contributions = [];
		rosterRefused = false;
	}

	const LOCATION_LABEL = {
		onsite: () => m.events_locationKind_onsite(), // "In person"
		online: () => m.events_locationKind_online(), // "Online"
		hybrid: () => m.events_locationKind_hybrid() // "Hybrid"
	};
</script>

{#if visible}
	<section class="preview-switch">
		<h3>{m.preview_heading()}</h3>
		<!-- "See this page as somebody who is not you" -->
		<p class="preview-switch__lead">{m.preview_lead()}</p>
		<!-- "Nobody is ever signed in as anybody else: the page is simply asked again without your sign-in." -->
		<div class="preview-switch__buttons">
			<button
				type="button"
				class:is-on={mode === 'visitor'}
				onclick={() => (mode === 'visitor' ? leave() : enter('visitor'))}
			>
				{m.preview_asVisitor()}
				<!-- "As a signed-out visitor" -->
			</button>
			<button
				type="button"
				class:is-on={mode === 'attendee'}
				onclick={() => (mode === 'attendee' ? leave() : enter('attendee'))}
			>
				{m.preview_asAttendee()}
				<!-- "As somebody going" -->
			</button>
		</div>
		<p class="preview-switch__note">{m.preview_matrixNote()}</p>
		<!-- "What each role may actually do is proved endpoint by endpoint in the permission matrix, and can be tried by signing in as one of the seeded personas." -->
	</section>
{/if}

{#if visible && mode !== 'off'}
	<!-- The bar. Fixed to the top of the viewport rather than sitting where this component is
	     mounted, because a preview nobody can see they are in is the failure mode this whole
	     feature exists to avoid. It carries exactly one control, and that control is the way out. -->
	<div class="preview-bar" role="status">
		<span class="preview-bar__text">
			{mode === 'visitor' ? m.preview_barVisitor() : m.preview_barAttendee()}
			<!-- "Viewing as a signed-out visitor — nothing here can be changed" /
			     "Viewing the layout somebody going sees — nothing here can be changed" -->
		</span>
		<button type="button" class="preview-bar__exit" onclick={leave}>{m.preview_leave()}</button>
		<!-- "Leave the preview" -->
	</div>

	<div class="preview-view" data-preview-mode={mode} bind:this={viewEl}>
		<p class="preview-view__kind">
			{mode === 'visitor' ? m.preview_kindVisitor() : m.preview_kindAttendee()}
			<!-- "Fetched with no sign-in. This is the API's own answer to a stranger, not a guess at one." /
			     "Your own data with an attendee's controls taken away. A layout preview, not a permission check." -->
		</p>

		{#if loading}
			<p class="preview-view__status">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if shown === null}
			<p class="preview-view__status preview-view__status--none">{m.preview_nothingThere()}</p>
			<!-- "Nothing at all: a signed-out visitor gets a 404 here. That is what a draft or a private event looks like from outside." -->
		{:else}
			<header class="preview-view__head">
				<p class="preview-view__title">{shown.title}</p>
				<p class="preview-view__host">{m.events_byHost({ name: shown.host.displayName })}</p>
				{#if shown.summary}
					<p class="preview-view__summary">{shown.summary}</p>
				{/if}
			</header>

			<dl class="preview-view__facts">
				<div>
					<dt>{m.events_when()}</dt>
					<!-- "When" -->
					<dd>
						{shown.startsAt ? formatDateTime(shown.startsAt) : m.events_unscheduled()}
						<!-- "Not scheduled yet" -->
					</dd>
				</div>
				<div>
					<dt>{m.events_where()}</dt>
					<!-- "Where" -->
					<dd>
						{LOCATION_LABEL[shown.locationKind]()}{shown.locationText
							? ` · ${shown.locationText}`
							: ''}
					</dd>
				</div>
				<div>
					<dt>{m.events_attendees()}</dt>
					<!-- "Who is coming" -->
					<dd>{m.events_goingCount({ count: shown.goingCount })}</dd>
					<!-- "{count} going" -->
				</div>
			</dl>

			{#if shown.description}
				<p class="preview-view__description">{shown.description}</p>
			{/if}

			<section class="preview-view__block">
				<p class="preview-view__blockHead">{m.preview_blockProgramme()}</p>
				<!-- "Programme" -->
				{#if sessions.length === 0}
					<p class="preview-view__empty">{m.preview_blockEmpty()}</p>
					<!-- "Nothing here for them." -->
				{:else}
					<ul>
						{#each sessions as session (session.id)}
							<li>
								<span class="preview-view__when">{formatDateTime(session.startsAt)}</span>
								{session.title}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="preview-view__block">
				<p class="preview-view__blockHead">{m.preview_blockRoster()}</p>
				<!-- "Who is coming" -->
				{#if rosterRefused}
					<p class="preview-view__empty">{m.preview_rosterRefused()}</p>
					<!-- "The roster is refused outright — they are not told who is on it." -->
				{:else if roster.length === 0}
					<p class="preview-view__empty">{m.preview_blockEmpty()}</p>
				{:else}
					<ul>
						{#each roster as row (row.id)}
							<li>{row.attendee.displayName}</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="preview-view__block">
				<p class="preview-view__blockHead">{m.preview_blockContributions()}</p>
				<!-- "Proposals" -->
				{#if contributions.length === 0}
					<p class="preview-view__empty">{m.preview_blockEmpty()}</p>
				{:else}
					<ul>
						{#each contributions as contribution (contribution.id)}
							<li>{contribution.title}</li>
						{/each}
					</ul>
				{/if}
			</section>

			<p class="preview-view__hidden">
				{mode === 'visitor' ? m.preview_hiddenVisitor() : m.preview_hiddenAttendee()}
				<!-- "Every control is gone, not disabled: there is no Edit, no Cancel, no staff panel, no registrations and no check-in in this view." /
				     "Hidden here: editing the event, the staff panel, the registrations list and check-in — everything can_organise and can_check_in deny." -->
			</p>
		{/if}
	</div>
{/if}

<style lang="scss">
	.preview-switch {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h3 {
			margin: 0;
			font-size: var(--text-lg);
		}
	}
	.preview-switch__lead,
	.preview-switch__note {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	.preview-switch__buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);

		button {
			padding: var(--space-2) var(--space-3);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			background: var(--surface);
			color: var(--text-primary);
			cursor: pointer;
		}
		button.is-on {
			border-color: #b45309;
			background: #fde68a;
			color: #451a03;
		}
	}

	.preview-bar {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 1000;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		// Fixed amber rather than a theme token on purpose: this bar has to read as "not the
		// ordinary page" in both themes, and a token that follows the theme would stop doing that in
		// one of them.
		background: #f59e0b;
		color: #1c1917;
		font-weight: 600;
		box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
	}
	.preview-bar__text {
		font-size: var(--text-sm);
	}
	.preview-bar__exit {
		padding: var(--space-1) var(--space-3);
		border: 1px solid #1c1917;
		border-radius: var(--radius-sm);
		background: #fffbeb;
		color: #1c1917;
		font-weight: 600;
		cursor: pointer;
	}

	.preview-view {
		scroll-margin-top: 4rem;
		border: 2px solid #f59e0b;
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--surface);
	}
	.preview-view__kind,
	.preview-view__hidden,
	.preview-view__empty,
	.preview-view__status {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	.preview-view__status--none {
		font-weight: 600;
	}
	.preview-view__head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.preview-view__title {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 700;
	}
	.preview-view__host,
	.preview-view__summary,
	.preview-view__description {
		margin: 0;
		color: var(--text-secondary);
	}
	.preview-view__facts {
		margin: 0;
		display: grid;
		gap: var(--space-2);

		dt {
			font-size: var(--text-sm);
			color: var(--text-secondary);
		}
		dd {
			margin: 0;
		}
	}
	.preview-view__block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		ul {
			margin: 0;
			padding-left: var(--space-4);
		}
	}
	.preview-view__blockHead {
		margin: 0;
		font-weight: 600;
	}
	.preview-view__when {
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
</style>
