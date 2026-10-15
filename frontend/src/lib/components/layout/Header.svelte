<script lang="ts">
	import TextSizeControl from './TextSizeControl.svelte';
	// **Rebuilt from a flat row of ten links into three groups, and again for phones.**
	//
	// The bar had grown one link per feature — browse, materials, my set, submit exercise, submit
	// material, branches, tutoring, watchlist, schedule, messages, moderation — every one competing for
	// the same attention and wrapping onto a second line before a laptop was even narrow. The rebuild
	// removes nothing; it sorts what was there by what each link is FOR:
	//
	//  - **Browsing** stays in the nav, because that is what a nav is: places to go and look at things.
	//  - **Making** collapses into one "Add…" popover. Five of the old links were create flows sharing
	//    one question ("I want to make something") that the bar was asking five times.
	//  - **You** collapses into the account button, which already carried the person's name and did
	//    nothing except link to Settings, while Log out sat beside it and My Set sat over in the nav.
	//
	// Messages moved into the action area as an icon, alongside the bell it is a sibling of: both are
	// inboxes, both carry an unread count, and one being a word in the nav while the other was an icon
	// on the right was an accident of the order they were built in rather than a distinction.
	//
	// **On a phone the same content becomes one row and a drawer.** Three rules drove that, and each
	// one shows up in the markup rather than only in the styles:
	//
	//  1. **One row.** The bar is the brand and nothing else; everything that lives across the top on a
	//     desktop lives in the drawer instead. Previously the nav collapsed behind a toggle while the
	//     action row stayed and wrapped, which meant the "one row" was frequently three.
	//  2. **It gets out of the way.** Scrolling down tucks the bar away; scrolling up brings it back at
	//     once. A sticky bar on a 390px-tall reading surface is a real cost, and the thing people do to
	//     get it back is exactly the gesture that returns it.
	//  3. **The menu button never goes anywhere.** It is rendered OUTSIDE `<header>` on purpose — the
	//     header is what slides away, so a button inside it would slide away too, and the one control
	//     that must survive the bar hiding is the one that brings everything back.
	//
	// **Every entry stays gated by the same feature flag its own route and API are gated by**, on both
	// surfaces — the item lists are snippets rendered in both the popovers and the drawer, so a flag
	// can never hide an entry in one place and leave it in the other. A kill switch that leaves its
	// buttons on the page does not hide a feature, it only moves where the error appears.
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { localizedPath } from '$lib/utils/localizedPath';
	import { page } from '$app/state';
	import { authStore } from '$lib/state/auth.svelte';
	import { displayPrefs } from '$lib/state/displayPrefs.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import { moderationQueueStore } from '$lib/state/moderationQueue.svelte';
	import { venueStaffStore } from '$lib/state/venueStaff.svelte'; // conference step A
	import { saveTargetsStore } from '$lib/state/saveTargets.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { creationStore } from '$lib/state/creation.svelte'; // learning step F
	import { issueReportStore } from '$lib/state/issueReport.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import Popover from '$lib/components/shared/Popover.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LocaleSwitcher from './LocaleSwitcher.svelte';
	import RandomExerciseButton from './RandomExerciseButton.svelte';
	import NotificationBell from './NotificationBell.svelte';
	import BellIcon from './BellIcon.svelte';

	// `|| authStore.isModerator` everywhere, mirroring `FeatureGate` and the backend's own
	// `feature_gate`: a moderator can still reach a killed feature, both to check what is live and to
	// decide when to turn it back on.
	const can = (key: Parameters<typeof featureFlagsStore.isEnabled>[0]) =>
		featureFlagsStore.isEnabled(key) || authStore.isModerator;

	// Derived rather than computed once, because `featureFlagsStore` fetches on boot and `authStore`
	// resolves asynchronously — anything read once at mount here would bake in the pre-fetch defaults
	// and never correct itself.
	let canSubmitExercise = $derived(can('exercise_submissions'));
	let canSubmitMaterial = $derived(can('material_submissions'));
	// Two abilities, two switches (COAUTHORING-BRIEF.md §0): `material_submissions` gates STARTING a
	// material — the submit form and a new project alike — while `coauthoring` gates everything that
	// happens inside a project afterwards. So the Add… entry below hangs off the first and the
	// account entry off this one, and turning either off leaves the other's link exactly where it was.
	let canCoauthoring = $derived(can('coauthoring'));
	// The `courses` flag is read here again (2026-10-14): the browse link and the "Start a course
	// or community" item came back by owner decision, so the switch takes both away (house rule 3).
	// Founding one is also one of `config/creation.py`'s kinds, so the Add… entry additionally asks
	// the creation gate — exactly the wrapping "New event" has. (No minors clause here: the gate's
	// own `minor` answer already covers a course, `config/creation.py` §3.)
	let canCourses = $derived(can('courses'));
	let canCreateCourse = $derived(canCourses && creationStore.allows('course'));
	// The `concepts` flag is deliberately NOT read here any more (2026-10-01). Both entries this
	// header used to carry — the browse link and the "New concept" item — were removed by owner
	// decision, so the header has nothing left for the flag to govern. `/concepts` and its hub's
	// own controls are still gated, by `FeatureGate` on the routes themselves.
	// A minor's account may not host, list tutoring, or message (accounts/minors.py); the links go
	// with the abilities, the kill-switch rule.
	let isMinor = $derived(authStore.user?.isMinor ?? false);
	let canTutoring = $derived(can('tutoring') && !isMinor);
	let canIssues = $derived(can('issues'));
	let canEvents = $derived(can('events'));
	let canPosts = $derived(can('posts'));
	let canMessaging = $derived(can('messaging') && !isMinor);
	// Conference step A (CONFERENCE-BRIEF.md §3.A). The Add… entry is for **staff of a venue only**,
	// so it hangs off two things: the kill switch, and whether this account actually runs a building.
	// The `/venues` browse link is in the footer, not here.
	let canVenues = $derived(can('venues'));
	let runsAVenue = $derived(canVenues && venueStaffStore.runsSomething);
	// Management flags (MANAGEMENT-BRIEF.md §4 rule 4): one `let can… = $derived(can('…'))` line per
	// step, appended directly below this comment in step order (A organizations, B tasks, C needs,
	// D plans, E decisions, F work_dashboard). Nothing else in this block is touched by a step.
	let canNeeds = $derived(can('needs'));

	let canTasks = $derived(can('tasks'));

	let canOrganizations = $derived(can('organizations'));
	// Volunteering OFFERS (needs.VolunteeringOffer) — not the shifts rota, which answers to
	// `shifts` and whose own page is `/volunteering/hours`. Two features, one word, two switches.
	let canOffers = $derived(can('volunteering'));

	let canWork = $derived(can('work_dashboard'));
	// Learning-cycle flags (prompts/README.md §5 rule 4): one `let can… = $derived(can('…'))` line
	// per step, appended directly below this comment in step order (A flashcards, B learning_record,
	// F the creation gate — F reads `GET /api/creation/`, not a flag). Nothing else in this block
	// is touched by a step.
	let canFlashcards = $derived(can('flashcards'));
	// Contests flag (CONTESTS-BRIEF.md §4 rule 4): the prep added this one line; step A reads it at
	// its three markers and ALSO wraps "New contest" in the creation gate's `contest` answer.
	let canContests = $derived(can('contests'));

	// Step F, the creation gate (prompts/07-creation-gate.md). NOT a flag read: the flag
	// (`creation_requires_verification`) is read server-side, because the answer also depends on
	// `Profile.is_verified_contributor` and on being 16, and a client that assembled the rule from
	// three pieces would be a second implementation of it — the one thing `config/creation.py`
	// exists to prevent. So the header asks the server, once, and these two lines AND the server's
	// own four create paths are then saying the same thing by construction.
	//
	// Each `can…` below keeps the switch it always had: a kill switch and the creation gate are
	// different questions ("does this feature exist here?" and "may you found one?"), and either
	// one alone must still take the entry away.
	let canCreateEvent = $derived(canEvents && !isMinor && creationStore.allows('event'));
	let canCreateService = $derived(canTutoring && creationStore.allows('service'));
	// Founding a contest promises a prize to strangers under KC art. 919–921 — the most
	// consequential founding act here — so it is wrapped exactly like "New event": the flag, the
	// minors rule and the creation gate, and any one of the three takes the entry away
	// (CONTESTS-BRIEF.md §2, the markers table).
	let canCreateContest = $derived(canContests && !isMinor && creationStore.allows('contest'));

	// The account menu's groups (WP8, 2026-10-14). A heading whose entries are all switched off
	// must go with them (house rule 3), so each group asks exactly the switches its own entries
	// read — keep these in step with `accountItems` below, one line per group. ("My agenda" needs
	// `canTutoring` as well as `events`, so it adds nothing to the Taking part line.)
	let canShifts = $derived(can('shifts'));
	let hasLearningItems = $derived(canFlashcards);
	let hasTakingPartItems = $derived(canContests || canTutoring || canShifts || canOffers);
	let hasTogetherItems = $derived(canCoauthoring || canTasks || canOrganizations || canWork);

	// An empty menu is worse than no menu: it invites a click and then explains nothing. So the
	// trigger itself disappears when a moderator has switched off everything under it.
	// The waiting-decisions count, loaded whenever a moderator's navigation is drawn. An effect
	// rather than `onMount`, because signing in later in the same session never re-runs mount — the
	// same trap the notification badge already hit once and fixed the same way.
	$effect(() => {
		moderationQueueStore.ensureLoaded(authStore.canModerate ? (authStore.user?.id ?? null) : null);
	});

	// Same shape and the same reason: signing in later in the same session never re-runs `onMount`.
	// Passing `null` while the switch is off is what takes the menu entry away WITHOUT a second
	// condition anywhere — house rule 3 (a killed feature removes its links, and stops asking).
	$effect(() => {
		venueStaffStore.ensureLoaded(canVenues ? (authStore.user?.id ?? null) : null);
	});

	// The creation gate's one request (learning step F). Same shape and the same reason as the two
	// above: signing in later in the same session never re-runs `onMount`. `null` is passed while
	// signed out, which is what tells the store it is a visitor rather than an account it has not
	// asked about yet — the two are different answers (lib/state/creation.svelte.ts).
	$effect(() => {
		creationStore.ensureLoaded(authStore.user?.id ?? null);
	});

	// One flag per entry the Add… menu can still carry, so the trigger disappears when it would
	// open on nothing. `canOrganizations` left this list on 2026-10-01 with "New organisation"
	// itself, and `canConcepts` with "New concept": a flag that governs no entry must not keep the
	// menu alive, or somebody with only that switch on opens an empty popover.
	// Learning step F: the two create entries are counted through their GATED flags, not their raw
	// ones, so an account the server would refuse at both does not open a popover holding nothing
	// it may use. `canSubmitExercise`/`canSubmitMaterial` are untouched — submitting an exercise or
	// a material is not founding anything and the gate says nothing about them.
	// 2026-10-14: `canCreateCourse` joined with its entry, and `canPosts` / `canCreateContest` —
	// whose entries were already in the menu but missing here, so somebody with only those left
	// lost the trigger while still being allowed both.
	let hasAnythingToAdd = $derived(
		canSubmitExercise ||
			canSubmitMaterial ||
			canCreateCourse ||
			canCreateService ||
			canCreateEvent ||
			canPosts ||
			canCreateContest ||
			runsAVenue
	);

	function logout() {
		authStore.logout();
		notificationStore.clear();
		messagesStore.clear();
		// Learning step F: whose turn it is to be refused changes with who is signed in.
		creationStore.clear();
		// The save menu's cached sets and courses belong to whoever was signed in. `saveTargets`
		// keys its cache by owner and so would refetch anyway, but leaving one person's set names
		// in memory after they sign out is not something to rely on a later check to undo.
		saveTargetsStore.clear();
		moderationQueueStore.clear();
		venueStaffStore.clear();
	}

	// ---- the drawer -----------------------------------------------------------------------------
	let drawerOpen = $state(false);
	let drawerEl = $state<HTMLElement | null>(null);
	let toggleEl = $state<HTMLButtonElement | null>(null);

	async function openDrawer() {
		drawerOpen = true;
		// The background must not scroll under an open drawer: on a phone the drawer is most of the
		// screen, and a page scrolling behind it is how somebody loses their place in an article by
		// opening a menu.
		document.body.style.overflow = 'hidden';
		await tick();
		drawerEl?.focus();
	}

	function closeDrawer(returnFocus = true) {
		if (!drawerOpen) return;
		drawerOpen = false;
		document.body.style.overflow = '';
		if (returnFocus) toggleEl?.focus();
	}

	// Every link inside the drawer closes it. Under client-side routing the component is not torn down
	// by the navigation, so a drawer left open would sit over whatever page it just went to.
	const closeOnNavigate = () => closeDrawer(false);

	// A route change from anywhere — including the browser's own back button, which no click handler
	// sees — leaves nothing hanging over the new page.
	//
	// **`untrack` is load-bearing, and its absence was a real bug** caught by looking at a screenshot
	// rather than by any assertion: the drawer opened and shut again in the same frame, so the page
	// looked as though the menu button did nothing at all. Reading `drawerOpen` inside an effect makes
	// the effect depend on it, so setting it to `true` re-ran the very effect whose job is to close it.
	// The dependency this effect is supposed to have is the pathname and nothing else.
	$effect(() => {
		// Read so the effect depends on it; the value itself is not needed.
		const _here = page.url.pathname;
		void _here;
		untrack(() => {
			if (drawerOpen) closeDrawer(false);
		});
	});

	// Which browse link is "where you are". A prefix table, not a route match, so the localized
	// addresses (/korki, /materialy) and the content routes a section owns all count. Every new
	// route family must be added here or it silently shows no current section. The personal
	// pages (/flashcards, /my-set, /sets) are deliberately absent: a reader on "Moje talie" is not
	// in "Zadania", and no current section is the honest answer there.
	const SECTION_PREFIXES: Record<
		| 'disciplines'
		| 'materials'
		| 'courses'
		| 'needs'
		| 'services'
		| 'events'
		| 'about'
		| 'contests',
		string[]
	> = {
		disciplines: ['/disciplines', '/branches', '/exercises', '/concepts', '/articles'],
		// Materials and Courses have their own links again (2026-10-14), so they mark themselves.
		materials: ['/materialy', '/materials', '/submit-material', '/material-projects'],
		courses: ['/courses'],
		needs: ['/needs', '/volunteering'],
		// Contests (step A, CONTESTS-BRIEF.md §3.A item 10). The ONE line this step adds outside
		// its own three markers, and it is here because `aria-current` on the nav link it appends
		// is otherwise dead: the link would never mark itself as the current page for a
		// screen-reader user. Step B does not touch the nav, so nothing collides with it.
		contests: ['/contests'],
		services: ['/korki', '/tutoring', '/bookings'],
		events: ['/events'],
		about: ['/about', '/legal', '/privacy', '/levels']
	};
	const currentSection = $derived.by(() => {
		const p = page.url.pathname;
		for (const [key, prefixes] of Object.entries(SECTION_PREFIXES))
			if (prefixes.some((pre) => p === pre || p.startsWith(pre + '/'))) return key;
		return null;
	});

	// ---- the focus trap --------------------------------------------------------------------------
	// Without this, tabbing past the last item in an open drawer walks into the page behind it: the
	// links there are still focusable, so a keyboard user ends up driving a page they cannot see while
	// a full-screen panel sits over it.
	//
	// A keydown cycle rather than `inert` on the rest of the document. `inert` is the tidier idea and
	// would also take the background out of the accessibility tree, but from inside this component
	// "the rest of the document" means iterating the body's children and skipping our own three
	// elements — a DOM-wide side effect to undo correctly on every exit path, including teardown.
	// This stays inside the component and needs nothing cleaned up.
	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function drawerFocusables(): HTMLElement[] {
		if (!drawerEl) return [];
		return Array.from(drawerEl.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			// Anything genuinely not rendered — a section behind an `{#if}`, or the whole drawer on a
			// desktop, where it is `display: none` — has no boxes and must not be a stop on the way round.
			(el) => el.getClientRects().length > 0
		);
	}

	function trapFocus(event: KeyboardEvent) {
		// Scoped to the drawer: its ✕ is inside it now (`.drawer__close`), and the toggle in the bar
		// is under the scrim while the drawer is open, so it is deliberately not a stop.
		const items = drawerFocusables();
		if (items.length === 0) return;

		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;

		// Focus sitting outside the loop is the normal state immediately after opening: `openDrawer`
		// puts it on the drawer container itself, which is `tabindex="-1"` and so is not a stop. Send it
		// to whichever end the direction implies instead of letting the browser carry on into the page.
		if (!active || !items.includes(active)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
			return;
		}
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (!drawerOpen) return;
		if (event.key === 'Escape') {
			closeDrawer();
			return;
		}
		if (event.key === 'Tab') trapFocus(event);
	}

	// ---- hide on scroll down, reveal on scroll up -------------------------------------------------
	// Only ever acts on a phone: the CSS transform lives inside the same breakpoint the drawer does, so
	// this flag is inert on a desktop rather than needing a second source of truth about the viewport.
	let tucked = $state(false);

	onMount(() => {
		let lastY = window.scrollY;
		let frame = 0;

		function measure() {
			frame = 0;
			const y = window.scrollY;
			// Near the top the bar is always out — otherwise a page that starts scrolled (a reload
			// half-way down an article) can open with no bar and no obvious reason.
			if (y < 72 || drawerOpen) {
				tucked = false;
			} else if (y > lastY + 6) {
				tucked = true;
			} else if (y < lastY - 6) {
				tucked = false;
			}
			// The 6px deadband is not decoration: without it, the sub-pixel scroll jitter a phone
			// produces while a finger rests on the screen flickers the bar in and out.
			lastY = y;
		}

		function onScroll() {
			// One measurement per frame. `scroll` fires far more often than the screen redraws, and
			// reading `scrollY` in the handler itself is a layout read on every one of them.
			if (!frame) frame = requestAnimationFrame(measure);
		}

		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			if (frame) cancelAnimationFrame(frame);
			// A drawer open at teardown would otherwise leave the page permanently unscrollable.
			document.body.style.overflow = '';
		};
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Item lists as snippets, rendered by BOTH the desktop popovers and the mobile drawer, so a
     feature flag cannot hide an entry in one surface and leave it in the other. -->
{#snippet browseLinks(onclick: () => void)}
	<!-- The per-link classes are the staged collapse's handles: each names the width stage at which
	     the link swaps its text for its icon — IN PLACE, keeping its nav position and order, rather
	     than moving into the action row (that rearranging scheme was dropped by owner decision).
	     Every anchor carries an aria-label so the accessible name survives the text hiding. The
	     stage rules are all scoped under `.site-nav`, so in the drawer these render as plain text
	     links (the icon spans are hidden by their base rule).

	     **Materials, Courses and Concepts left this bar on 2026-10-01**, by owner decision; Materials
	     and Courses came back on 2026-10-14, by the owner's later decision (see below), and
	     Concepts stays out. Events is last and drawn as an icon. Whatever is in THIS snippet is in
	     the phone drawer as well, which is the point: the drawer is the phone's navbar, not a
	     second surface that may disagree with it. -->
	<a
		class="nav-link nav-link--disciplines"
		aria-current={currentSection === 'disciplines' ? 'page' : undefined}
		href={resolve('/disciplines')}
		aria-label={m.nav_browse()}
		title={m.nav_browse()}
		{onclick}
	>
		<span class="nav-link__icon" aria-hidden="true">{@render exerciseIcon()}</span>
		<span class="nav-link__text">{m.nav_browse()}</span>
	</a>
	<!-- **Materials and Courses came back on 2026-10-14**, by owner decision, reversing the
	     2026-10-01 trim for these two: "bring back materials to navbar and adding, as it's a crucial
	     module. also, let's bring back courses" — courses being where people build communities
	     around a general topic or a specific university course, with all the materials in one
	     place. They sit right after Exercises because they are the same family: the things to
	     learn from, and the places that gather them. Materials has no kill switch of its own (the
	     browse surface was never gated); Courses answers to `courses`, exactly as its routes do. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address (/materialy); the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts. The href is inside a multi-line tag, where a next-line comment cannot be placed. -->
	<a
		class="nav-link nav-link--materials"
		aria-current={currentSection === 'materials' ? 'page' : undefined}
		href={localizedPath(resolve('/materials'))}
		aria-label={m.nav_materials()}
		title={m.nav_materials()}
		{onclick}
	>
		<span class="nav-link__icon" aria-hidden="true">{@render bookIcon()}</span>
		<span class="nav-link__text">{m.nav_materials()}</span>
		<!-- "Materials" -->
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{#if canCourses}
		<a
			class="nav-link nav-link--classroom"
			aria-current={currentSection === 'courses' ? 'page' : undefined}
			href={resolve('/courses')}
			aria-label={m.nav_classroom()}
			title={m.nav_classroom()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render capIcon()}</span>
			<span class="nav-link__text">{m.nav_classroom()}</span>
			<!-- "Courses" -->
		</a>
	{/if}
	<!-- Management nav marker (MANAGEMENT-BRIEF.md §4 rule 4): step C appends its "Help wanted"
	     link directly below this comment, behind its flag. No other step touches the nav. -->
	<!-- Learning nav marker (prompts/README.md §5 rule 4): NO learning step appends a main-bar link —
	     the bar was trimmed by owner decision on 2026-10-01 and stays trimmed. Decks live in the
	     account menu (marker below). The marker exists so that the question is answered here. -->
	<!-- Contests nav marker (CONTESTS-BRIEF.md §4 rule 4): step A appends ONE "Contests" link
	     (→ /contests, behind `contests`) directly below this comment, with an inline icon like the
	     others in this bar. Step B does not touch the nav. -->
	{#if canContests}
		<a
			class="nav-link nav-link--contests"
			aria-current={currentSection === 'contests' ? 'page' : undefined}
			href={resolve('/contests')}
			aria-label={m.contests_title()}
			title={m.contests_title()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">
				<!-- A rosette: the one shape that reads as "judged and placed" rather than
				     "scheduled" (a calendar) or "taught" (a book). -->
				<svg
					viewBox="0 0 24 24"
					width="20"
					height="20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="8" r="5" />
					<path d="M9 13l-2 8 5-3 5 3-2-8" />
				</svg>
			</span>
			<span class="nav-link__text">{m.contests_title()}</span>
			<!-- "Contests" -->
		</a>
	{/if}
	{#if canNeeds}
		<a
			class="nav-link nav-link--needs"
			aria-current={currentSection === 'needs' ? 'page' : undefined}
			href={resolve('/needs')}
			aria-label={m.nav_needs()}
			title={m.nav_needs()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render needsIcon()}</span>
			<span class="nav-link__text">{m.nav_needs()}</span>
		</a>
	{/if}
	{#if canTutoring}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts. The href is inside a multi-line tag, where a next-line comment cannot be placed. -->
		<a
			class="nav-link nav-link--services"
			aria-current={currentSection === 'services' ? 'page' : undefined}
			href={localizedPath(resolve('/tutoring'))}
			aria-label={m.nav_services()}
			title={m.nav_services()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render moneyIcon()}</span>
			<span class="nav-link__text">{m.nav_services()}</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
	<a
		class="nav-link nav-link--about"
		aria-current={currentSection === 'about' ? 'page' : undefined}
		href={resolve('/about')}
		aria-label={m.nav_about()}
		title={m.nav_about()}
		{onclick}
	>
		<span class="nav-link__icon" aria-hidden="true">{@render infoIcon()}</span>
		<span class="nav-link__text">{m.nav_about()}</span>
		<!-- "About" -->
	</a>
	<!-- Events is LAST, and an icon at every width the bar exists at (owner's call, 2026-10-01): a
	     dated happening is something a reader comes back for occasionally, not something they
	     navigate by, so it keeps a place in the bar without spending a label on it. The drawer still
	     renders it as a word — `.nav-link__icon`'s base rule hides the icon everywhere outside
	     `.site-nav`, and the matching text rule below is scoped the same way. -->
	{#if canEvents}
		<a
			class="nav-link nav-link--events"
			aria-current={currentSection === 'events' ? 'page' : undefined}
			href={resolve('/events')}
			aria-label={m.nav_events()}
			title={m.nav_events()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render calendarIcon()}</span>
			<span class="nav-link__text">{m.nav_events()}</span>
		</a>
	{/if}
{/snippet}

{#snippet createItems(itemClass: string, onclick: () => void)}
	{#if canSubmitExercise}
		<a role="menuitem" class={itemClass} href={resolve('/submit')} {onclick}>{m.nav_submit()}</a>
	{/if}
	{#if canSubmitMaterial}
		<a role="menuitem" class={itemClass} href={resolve('/submit-material')} {onclick}>
			{m.nav_submitMaterial()}
		</a>
		<!-- "Start a material with others" used to sit on the line below this one, under the same
		     flag — the two were one question with two answers ("by myself" / "with other people").
		     The owner moved it out of this menu on 2026-10-01 and asked for it to live on
		     `/materials` (and its Polish address `/materialy`) instead, which is where somebody
		     already looking at materials is. `MaterialsAddBar` on that page carries BOTH answers
		     now, so the pair stays together where it matters; this menu keeps only the plain one,
		     because "submit a material" is the common act and the hub is one click away.
		     The flag is still `material_submissions`, deliberately NOT `coauthoring`: that one
		     gates collaborating on a material, and a project with a team of one is still somebody
		     uploading a material. -->
	{/if}
	<!-- "Add a course" left this menu on 2026-10-01 and came BACK on 2026-10-14, by owner decision
	     both times — the second time as "Start a course or community", because a course is now
	     also where people gather around a topic or a university course. Wrapped like "New event":
	     the `courses` switch AND the creation gate's `course` answer, either one alone removes it. -->
	{#if canCreateCourse}
		<a role="menuitem" class={itemClass} href={resolve('/courses/new')} {onclick}>
			{m.nav_add_course()}
			<!-- "Start a course or community" -->
		</a>
	{/if}
	{#if canCreateEvent}
		<a role="menuitem" class={itemClass} href={resolve('/events/new')} {onclick}>
			{m.nav_add_event()}
		</a>
	{/if}
	{#if canCreateService}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts. -->
		<a role="menuitem" class={itemClass} href={localizedPath(resolve('/tutoring/new'))} {onclick}>
			{m.nav_add_service()}
		</a>
	{/if}
	{#if canPosts}
		<!-- The composer lives at the top of /activity — this entry is what makes it findable
		     from anywhere, the same job every other create action in this menu does. -->
		<a role="menuitem" class={itemClass} href={resolve('/activity')} {onclick}>
			{m.nav_add_post()}
		</a>
	{/if}
	<!-- "New concept" left this menu on 2026-10-01, by owner decision, the same pass that took
	     Concepts out of the navbar. The surface is NOT killed — the `concepts` flag is untouched,
	     `/concepts/new` still works and the hub still carries its own "New concept" control, which
	     is where somebody who is already reading concepts makes one. What went away is the offer
	     to start one from anywhere, which is a different claim about how central the feature is.
	     (It is deliberately not gated on being an adult the way Events is: a minor may write a
	     concept article, their revision simply always queues, CONCEPTS-BRIEF.md §0.) -->
	{#if runsAVenue}
		<!-- Conference step A. Not a "create" action like the rest of this menu, and deliberately
		     placed last: it is the one entry here that only exists for the handful of people who run
		     a building, and it is where they go to answer the room requests sitting in their queue.
		     A venue's own page carries the link onward when somebody runs more than one. -->
		<a
			role="menuitem"
			class={itemClass}
			href={resolve('/venues/[slug]/manage', { slug: venueStaffStore.venues[0].slug })}
			{onclick}
		>
			{m.venues_navAdd()}
			<!-- "Venues you run" -->
		</a>
	{/if}
	<!-- Management Add… marker (MANAGEMENT-BRIEF.md §4 rule 4): step A appended "New organisation"
	     directly below this comment, behind its flag and for adults only.

	     It left again on 2026-10-01, by owner decision, with "New concept" and the school-demo
	     link — see the note on those. The surface is NOT killed: the `organizations` flag is
	     untouched, "Organisations" is still in the account menu below, and `/organizations/new`
	     still works and is still reachable from the hub. Founding a body is a rare act and a
	     deliberate one; offering it from every page of the site said otherwise.
	     (It was, and still is where it remains, closed to an under-16: founding a body means
	     standing publicly behind it, which `accounts/minors.py` closes exactly as it closes event
	     hosting.) -->
	<!-- Learning Add… marker (prompts/README.md §5 rule 4): step F hides the "New event" and "New
	     listing" entries above for an account `GET /api/creation/` refuses (courses and organisations
	     left this menu on 2026-10-01 and are founded from their hubs, which F gates the same way),
	     by appending its `creation` state in the script block and wrapping nothing but those two
	     `{#if}`s. No learning step ADDS an entry here. -->
	<!-- Contests Add… marker (CONTESTS-BRIEF.md §4 rule 4): step A appends "New contest" (→
	     /contests/new) directly below this comment, behind `contests`, for adults only, and hidden
	     for an account `GET /api/creation/` refuses for the `contest` kind — the same wrapping step
	     F gave "New event". Step B does not touch this menu. -->
	{#if canCreateContest}
		<a role="menuitem" class={itemClass} href={resolve('/contests/new')} {onclick}>
			{m.contests_newContest()}
			<!-- "New contest" -->
		</a>
	{/if}
{/snippet}

<!-- **The account menu, grouped (WP8, 2026-10-14).** It had grown to fourteen flat entries, one per
     feature, in the order the features were built — which is no order a reader can use. They are
     now sorted under four small headings by what each entry is FOR: what you are learning, what
     you are taking part in, what you work on with other people, and the account itself. The
     groups were chosen from what is actually here, not from a wish list: the learning record has
     no page of its own (it is a panel on the profile), so it is not an entry.

     **A heading never outlives its entries** (house rule 3): each group is drawn only when at
     least one entry under it survives its own switch (`hasLearningItems` & co. in the script, one
     line per group, listing exactly the `can…` its entries read). Every entry keeps the gating it
     had before.

     **One snippet, both surfaces**, like the rest of this header: `surface` picks a `role="group"`
     with an `aria-label` inside the desktop `role="menu"`, and a `.drawer__section` per group in
     the phone drawer, so the two can never sort the same entries differently. The visible heading
     is `aria-hidden` — the group's label already says it, once — and it is a plain span, never a
     `menuitem`, so neither Tab nor the arrow keys ever stop on it. In the drawer the entries carry
     no `menuitem` role: the drawer is not a menu, and a `menuitem` outside one is an orphan. -->
{#snippet accountItems(surface: 'menu' | 'drawer', onclick: () => void)}
	{@const itemClass = surface === 'menu' ? 'menu-item' : 'drawer__item'}
	{@const itemRole = surface === 'menu' ? 'menuitem' : undefined}

	{#snippet learningItems()}
		<!-- Learning account-menu marker (prompts/README.md §5 rule 4): step A appended "My decks"
		     (→ /flashcards, behind `flashcards`). Contests account-menu marker (CONTESTS-BRIEF.md
		     §4 rule 4): step A appended "My contests" (→ /contests?mine=1, behind `contests`). WP8
		     put both here; the owner moved "My contests" to Taking part on 2026-10-15. -->
		{#if canFlashcards}
			<!-- A thing of theirs to come back to, like "My tasks", rather than something to make —
			     which is why it is here and not in the Add… menu. A deck is created from a set, a
			     lesson or this page, never from a global "new…" entry. -->
			<a role={itemRole} class={itemClass} href={resolve('/flashcards')} {onclick}>
				{m.decks_navMine()}
				<!-- "My decks" -->
			</a>
		{/if}
	{/snippet}

	{#snippet takingPartItems()}
		{#if canContests}
			<!-- `?mine=1` is the hub's own tab, not a second page. Under Taking part by the owner's call
			     (2026-10-15): entering, judging and running a contest are all taking part in one. -->
			<a role={itemRole} class={itemClass} href="{resolve('/contests')}?mine=1" {onclick}>
				{m.contests_navMine()}
				<!-- "My contests" -->
			</a>
		{/if}
		{#if canTutoring}
			<a role={itemRole} class={itemClass} href={resolve('/bookings')} {onclick}>
				{m.nav_bookings()}
				<!-- "My schedule" -->
			</a>
			{#if canEvents}
				<a role={itemRole} class={itemClass} href={resolve('/events/agenda')} {onclick}>
					{m.events_myAgenda()}
					<!-- "My agenda" -->
				</a>
			{/if}
		{/if}
		{#if canShifts}
			<!-- The rota, from the volunteer's side (CONFERENCE-BRIEF.md §3.E): every event they have
			     helped run, the hours, and the certificate for each. It moved to `/volunteering/hours`
			     on 2026-10-01, when the public offers board took the `/volunteering` address (owner's
			     call: the public noun gets the public address). Still `shifts`, not `volunteering` —
			     these are two features that happen to share a word. -->
			<a role={itemRole} class={itemClass} href={resolve('/volunteering/hours')} {onclick}>
				{m.shifts_volunteeringTitle()}
				<!-- "Volunteering" -->
			</a>
		{/if}
		{#if canOffers}
			<!-- The offers this person has posted (needs.VolunteeringOffer). Its own flag, because the
			     rota above answers to `shifts` and this to `volunteering`; a reader may well have one
			     switched on and the other off. -->
			<a role={itemRole} class={itemClass} href={resolve('/volunteering/mine')} {onclick}>
				{m.offers_mineHeading()}
				<!-- "My volunteering offers" -->
			</a>
		{/if}
	{/snippet}

	{#snippet togetherItems()}
		{#if canCoauthoring}
			<!-- The list of materials this person is a co-author of — a thing of theirs to come back
			     to, not something to make. `?tab=mine` is the page's own default tab spelled out, so
			     the link lands on the half that belongs to them rather than on the public "looking for
			     co-authors" board. A block disable pair rather than `-next-line`: Prettier reflows this
			     tag across several lines, and the rule reports at the `href` attribute's own line. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -- built on resolve('/material-projects'), query parameter only -->
			<a
				role={itemRole}
				class={itemClass}
				href={`${resolve('/material-projects')}?tab=mine`}
				{onclick}
			>
				{m.nav_coauthoring()}
				<!-- "Co-authoring" -->
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
		<!-- Management account-menu marker (MANAGEMENT-BRIEF.md §4 rule 4): A "My organisations",
		     B "My tasks", F "My work", each behind its own flag — in this group since WP8. -->
		{#if canTasks}
			<!-- Everything waiting on this person across every course, event and material they help
			     run (MANAGEMENT-BRIEF.md §3.B). -->
			<a role={itemRole} class={itemClass} href={resolve('/tasks')} {onclick}>
				{m.tasks_myTitle()}
				<!-- "My tasks" -->
			</a>
		{/if}
		{#if canOrganizations}
			<!-- Not gated on being an adult: a minor may be ON a roster somebody else put them on, and
			     this is the list of the bodies they are in. -->
			<a role={itemRole} class={itemClass} href={resolve('/organizations')} {onclick}>
				{m.orgs_navMine()}
				<!-- "My organisations" -->
			</a>
		{/if}
		{#if canWork}
			<a role={itemRole} class={itemClass} href={resolve('/work')} {onclick}>
				{m.work_title()}
				<!-- "My work" -->
			</a>
		{/if}
		<!-- The school-management demo (HISTORY.md §17BO) was linked from this menu until 2026-10-01,
		     when the owner took it out. The demo is untouched and still served at /dziennik/ by the
		     vhost — a separate static bundle, not a SvelteKit route — and the `school_demo` flag is
		     now read nowhere in this file. -->
	{/snippet}

	{#snippet accountBlock()}
		{#if authStore.user?.id}
			<a
				role={itemRole}
				class={itemClass}
				href={resolve('/users/[id]', { id: authStore.user.id })}
				{onclick}
			>
				{m.nav_profile()}
				<!-- "Profile" -->
			</a>
		{/if}
		<a role={itemRole} class={itemClass} href={resolve('/settings')} {onclick}>
			{m.nav_settings()}
			<!-- "Settings" -->
		</a>
		<!-- Help, one click from anywhere (WP8). The manual had exactly one way in — a button on
		     /about — so somebody stuck on a page had to know the manual existed to find it. No
		     switch: the manual is a standing page, and its chapters say for themselves when the
		     feature they describe is switched off here. -->
		<a role={itemRole} class="{itemClass} help-link" href={resolve('/about/guide')} {onclick}>
			{m.accountMenu_help()}
			<!-- "Help & manual" -->
		</a>
		{#if canIssues}
			<button
				type="button"
				role={itemRole}
				class="{itemClass} menu-item--button"
				onclick={() => {
					onclick();
					issueReportStore.open();
				}}
			>
				{m.nav_reportIssue()}
				<!-- "Report issue" -->
			</button>
		{/if}
		<button
			type="button"
			role={itemRole}
			class="{itemClass} menu-item--button"
			onclick={() => {
				onclick();
				logout();
			}}
		>
			{m.nav_logout()}
			<!-- "Log out" -->
		</button>
	{/snippet}

	{#if hasLearningItems}
		{@render menuGroup(surface, 'learning', m.accountMenu_groupLearning(), learningItems)}
		<!-- "Learning" -->
	{/if}
	{#if hasTakingPartItems}
		{@render menuGroup(surface, 'taking-part', m.accountMenu_groupTakingPart(), takingPartItems)}
		<!-- "Taking part" -->
	{/if}
	{#if hasTogetherItems}
		{@render menuGroup(surface, 'together', m.accountMenu_groupTogether(), togetherItems)}
		<!-- "Working together" -->
	{/if}
	{@render menuGroup(surface, 'account', m.nav_account(), accountBlock)}
	<!-- "Your account" -->
{/snippet}

<!-- One group of the account menu, on either surface. `key` is a stable handle for the e2e scripts
     (`data-group`), which must not depend on the heading's words — they change with the language. -->
{#snippet menuGroup(surface: 'menu' | 'drawer', key: string, label: string, items: Snippet)}
	{#if surface === 'menu'}
		<div class="menu-group" role="group" aria-label={label} data-group={key}>
			<span class="menu-group__heading" aria-hidden="true">{label}</span>
			{@render items()}
		</div>
	{:else}
		<div class="drawer__section" role="group" aria-label={label} data-group={key}>
			<p class="drawer__heading" aria-hidden="true">{label}</p>
			{@render items()}
		</div>
	{/if}
{/snippet}

{#snippet mySetIcon()}
	<!-- The same bookmark the save button on every exercise card uses. That is the whole point of
	     picking it: what you press to save and where saved things live should look like each other. -->
	<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
	</svg>
{/snippet}

{#snippet shieldIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6z" />
	</svg>
{/snippet}

{#snippet messagesIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
		<path d="m3 6.5 8.2 6.1a1.4 1.4 0 0 0 1.6 0L21 6.5" />
	</svg>
{/snippet}

<!-- The staged-collapse icons (NAVBAR-BRIEF stages 1–6): inline SVG rather than emoji, decided
     with the owner — SVG inherits the theme's text colour and sits on a line the way the messages
     envelope above already does. Every icon-only control they end up on carries a real aria-label. -->
{#snippet calendarIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="3" y="5" width="18" height="16" rx="2" />
		<path d="M3 9.5h18M8 3v4M16 3v4" />
	</svg>
{/snippet}

{#snippet moneyIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="6" width="19" height="12" rx="2" />
		<circle cx="12" cy="12" r="2.5" />
		<path d="M6.5 12h.01M17.5 12h.01" />
	</svg>
{/snippet}

{#snippet exerciseIcon()}
	<!-- Exercises: a worksheet with a tick — a task to do, and done. The link was "Disciplines" and
	     drew a compass ("explore the catalogue"); once the word became Exercises/Zadania the compass
	     stood for nothing a reader could name, so the picture changed with the word. Distinct from
	     Materials' book (a thing to read) and Courses' mortarboard (a thing to attend). -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M7 3h7l5 5v13H7z" />
		<path d="M14 3v5h5" />
		<path d="M9.5 15.5l2 2 3.5-4" />
		<path d="M10 11h2" />
	</svg>
{/snippet}

{#snippet bookIcon()}
	<!-- Materials: a book — a thing to read. Restored with the link on 2026-10-14. -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22z" />
		<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
	</svg>
{/snippet}

{#snippet capIcon()}
	<!-- Courses: a mortarboard — the thing people run and others join. Restored 2026-10-14. -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="m12 4 10 4.5-10 4.5L2 8.5z" />
		<path d="M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11" />
	</svg>
{/snippet}

{#snippet infoIcon()}
	<!-- About: the information mark. The one link in the bar that describes the site rather than
	     holding any of it, so it gets the generic sign rather than a picture of a thing. -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5.5" />
		<path d="M12 7.6h.01" />
	</svg>
{/snippet}

{#snippet needsIcon()}
	<!-- Help wanted: a raised hand — deliberately not the money icon tutoring uses above (this
	     platform never takes or mentions money, FINANCES.md). -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M8 21v-7.5L4.6 9.9a1.6 1.6 0 0 1 2.2-2.3L8 8.7V4a1.4 1.4 0 0 1 2.8 0v6" />
		<path d="M10.8 10V3.4a1.4 1.4 0 0 1 2.8 0V10" />
		<path d="M13.6 10.2V4.6a1.4 1.4 0 0 1 2.8 0V11" />
		<path d="M16.4 11.2 17.9 10a1.4 1.4 0 0 1 2 2l-2.9 3.3c-.7.9-1 1.9-1 3v2.7H8" />
	</svg>
{/snippet}

{#snippet personIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="8" r="3.5" />
		<path d="M5 20c1.2-3.4 3.9-5 7-5s5.8 1.6 7 5" />
	</svg>
{/snippet}

<header class="site-header" class:site-header--tucked={tucked}>
	<div class="site-header__row">
		<a class="brand" href={resolve('/')}>
			<span class="brand__mark" aria-hidden="true">∫</span>
			<span class="brand__name">{m.common_appName()}</span>
		</a>
		{#if canIssues}
			<!-- Drawn OVER the bar, under the wordmark, rather than in the flow: the bar must not grow
			     for it. Absolutely positioned against the row, with padding around the text so the hit
			     area is comfortably larger than the 11px label itself. -->
			<button type="button" class="brand__report no-print" onclick={() => issueReportStore.open()}>
				{m.nav_reportIssue()}
				<!-- "Report issue" -->
			</button>
		{/if}

		<!-- Places to go and look at things. Create flows are deliberately not in here any more, and
		     neither is moderation — see the shield in the icon cluster for where that went. -->
		<nav class="site-nav no-print" aria-label={m.nav_mainNavigation()}>
			{@render browseLinks(() => {})}
		</nav>

		<div class="site-header__actions no-print">
			<RandomExerciseButton />

			<ThemeToggle />
			<TextSizeControl />
			<!-- Stage 8: once somebody HAS an account, the language picker moves into the account
			     menu at narrow widths — a signed-out visitor keeps it here at every width, since the
			     one control a person may need before they can read anything else must not be behind
			     a menu labelled in a language they cannot read. -->
			<span class="row-locale" class:row-locale--signed-in={authStore.isAuthenticated}>
				<LocaleSwitcher />
			</span>

			<!-- Everything addressed to YOU, together at the right-hand end: work waiting for you,
			     what somebody sent, what the site is telling you, what you saved, what you can make,
			     and who you are signed in as.

			     Icon-only, with real accessible names: an envelope and a bell are universally read,
			     and the words were costing nav slots to say what the icons already say. -->
			<div class="site-header__you">
				<!-- Moderation is not a place to browse, it is work waiting for you — which is why it
				     left the nav, and why it is a count rather than a word. It was drawn with its
				     label first and a breakpoint to drop it; the screenshot settled that: this row is
				     capped at 1100px, so with the word present the browse links were already being
				     scrolled out of reach at 1280px, and no wider viewport gives the row more room to
				     earn it back. So the word is gone at every width. Nothing is lost by it — the
				     accessible name carries the same text, and the number is the part a moderator
				     actually reads. -->
				{#if authStore.canModerate}
					<a
						class="icon-button mod-link"
						href={resolve('/moderation')}
						aria-label={m.nav_moderation()}
						title={m.nav_moderation()}
					>
						{@render shieldIcon()}
						{#if moderationQueueStore.total > 0}
							<span class="badge badge--floating">{moderationQueueStore.total}</span>
						{/if}
					</a>
				{/if}

				<!-- The envelope, unless this person has asked for one inbox (2026-10-01, owner:
				     "make it personal option of a user to turn this off, default: split"). With the
				     preference on, the bell carries both counts and `/notifications` lists the
				     unread conversations above the notifications, so a second icon pointing at half
				     of what the first one now shows is exactly the duplication they turned off.
				     `/messages` is NOT gated by the preference — it is still a real page, still in
				     the drawer, and every conversation row still links to it. -->
				{#if authStore.isAuthenticated && canMessaging && !displayPrefs.combinedInbox}
					<a class="icon-button" href={resolve('/messages')} aria-label={m.nav_messages()}>
						{@render messagesIcon()}
						{#if messagesStore.unreadCount > 0}
							<span class="badge badge--floating">{messagesStore.unreadCount}</span>
						{/if}
					</a>
				{/if}

				{#if authStore.isAuthenticated}
					<NotificationBell />
				{/if}

				<!-- My Set, for everybody including guests: a guest's set is the more fragile of the
				     two, since it lives only in this browser until they make an account, so it should
				     not be the one hidden behind a menu. Kept immediately right of the bell, where it
				     was asked for. -->
				<a class="icon-button" href={resolve('/my-set')} aria-label={m.nav_mySet()}>
					{@render mySetIcon()}
					{#if guestSetStore.count > 0}
						<span class="badge badge--floating badge--count">{guestSetStore.count}</span>
					{/if}
				</a>

				<!-- Add… sits with the personal group rather than beside the nav, now that the row no
				     longer wraps — the reason it was over there was that it used to wrap down with the
				     icons, stranding the one create affordance on a second line. -->
				{#if authStore.isAuthenticated && hasAnythingToAdd}
					<Popover label={m.nav_add()} closeOnFocusOut>
						{#snippet trigger(open: boolean)}
							<span class="add-trigger" class:add-trigger--open={open}>
								<span aria-hidden="true">+</span>
								<span class="add-trigger__text">{m.nav_add()}</span>
							</span>
						{/snippet}
						{#snippet children(close: () => void)}
							{@render createItems('menu-item', close)}
						{/snippet}
					</Popover>
				{/if}

				{#if authStore.isAuthenticated}
					<Popover label={m.nav_account()} closeOnFocusOut>
						{#snippet trigger(open: boolean)}
							<!-- A chevron, because looking at a screenshot of this is what showed the problem: a
						     person's own name sitting in a row of icons reads as a label, not as something
						     to press. It rotates on open so the control says which way it will go.

						     Stage 2 swaps the name for their avatar (or a plain person icon — there is
						     deliberately no identicon, §17Q "Left open"). The Popover's own `label` keeps
						     the accessible name either way. -->
							<span class="account-trigger">
								<span class="account-trigger__name">{authStore.user?.displayName}</span>
								<span class="account-trigger__avatar" aria-hidden="true">
									{#if authStore.user?.avatarUrl}
										<!-- Explicit dimensions because this one is in the ROOT LAYOUT, so it is on
										     every page, and it appears late — only once authStore.init() has
										     answered. An unsized image arriving after first paint is the textbook
										     way to shift a header that had already settled. Avatars are stored
										     square (accounts/avatar.py centre-crops to 512x512), so the ratio
										     these reserve is always the right one. -->
										<img
											class="account-trigger__img"
											src={authStore.user.avatarUrl}
											alt=""
											width="28"
											height="28"
										/>
									{:else}
										{@render personIcon()}
									{/if}
								</span>
								<span class="chevron" class:chevron--open={open} aria-hidden="true">▾</span>
							</span>
						{/snippet}
						{#snippet children(close: () => void)}
							<!-- Stage 8: the language picker's narrow-width home once somebody has an
							     account. The row keeps it for guests — see `.row-locale` above.

							     FIRST in the menu, not last (2026-09-23, owner's request). It was at the
							     bottom, under every account link, which is the wrong end for the one control
							     somebody may need BEFORE they can read the words above it: a person who
							     opened this menu because they cannot read the interface had to scan past the
							     whole list to find the only item that would help them. Same reasoning, and
							     same position, as the drawer's own picker beside its ✕ below. -->
							<div class="menu-locale">
								<LocaleSwitcher />
							</div>
							<!-- Stage 7 removes the logo — the bar's only link home — so a Home entry appears
							     in this menu at exactly the widths where that happens. Page breadcrumbs keep
							     home reachable for guests in the same band. -->
							<a role="menuitem" class="menu-item menu-home" href={resolve('/')} onclick={close}>
								{m.nav_home()}
							</a>
							{@render accountItems('menu', close)}
						{/snippet}
					</Popover>
				{:else}
					<!-- `data-session-hidden` rather than an {#if} on `authStore.restoring` alone: the
					     server-rendered HTML cannot know about a session, so these two links are in the
					     first paint no matter what this component does, and the bundle that could
					     remove them is the slow part. app.html's marker plus the CSS in global.scss
					     covers that window; the store's own flag covers the tail after hydration. -->
					<div class="signed-out-actions" data-session-hidden class:hidden={authStore.restoring}>
						<a href={resolve('/login')}>{m.nav_login()}</a>
						<a href={resolve('/register')} class="primary-link">{m.nav_register()}</a>
					</div>
				{/if}
			</div>
		</div>
		<!-- In the bar's own flow, at the owner's request (it used to float outside the header so it
		     would outlive the bar tucking away on scroll). It now tucks with the bar; scrolling up brings
		     both back. While the drawer is open this button sits under the scrim, so the drawer carries
		     its own ✕ in `.drawer__top`. Three lines, no border, 30×30 — people know what they mean. -->
		<button
			class="drawer-toggle no-print"
			type="button"
			bind:this={toggleEl}
			aria-expanded={drawerOpen}
			aria-controls="site-drawer"
			aria-label={m.nav_openMenu()}
			onclick={() => openDrawer()}
		>
			<span aria-hidden="true">☰</span>
		</button>
	</div>
</header>

{#if drawerOpen}
	<!-- A real <button> rather than a <div> with a click handler: it makes the scrim an interactive
	     element by construction instead of by assertion, so no a11y suppression is needed. It is kept
	     OUT of the tab order and hidden from the accessibility tree on purpose — it is a convenience
	     for a pointer, and a keyboard user already has Escape and the ✕, so announcing a third,
	     unlabelled way to do the same thing would be noise. -->
	<button
		class="drawer-scrim no-print"
		type="button"
		tabindex="-1"
		aria-hidden="true"
		onclick={() => closeDrawer()}
	></button>
{/if}

<div
	id="site-drawer"
	class="drawer no-print"
	class:drawer--open={drawerOpen}
	bind:this={drawerEl}
	tabindex="-1"
	aria-label={m.nav_mainNavigation()}
	aria-hidden={!drawerOpen}
>
	<!-- The language sits on the close button's own line. It is the one control somebody may need
	     BEFORE they can read anything else in here, so it should not be below a list of words they
	     cannot read; and the top-right corner already belongs to the drawer's chrome rather than to
	     its contents. The padding keeps it clear of the ✕, which floats over the drawer. -->
	<div class="drawer__top">
		<LocaleSwitcher />
		<button
			class="drawer__close"
			type="button"
			aria-label={m.nav_closeMenu()}
			onclick={() => closeDrawer()}
		>
			<span aria-hidden="true">✕</span>
		</button>
	</div>

	{#if authStore.isAuthenticated}
		<div class="drawer__identity">
			<span class="drawer__name">{authStore.user?.displayName}</span>
		</div>
	{/if}

	<!-- Everything that is YOURS, directly under your name: what is waiting for you, what you were
	     sent, what you saved, and what you have to decide on. This used to be scattered — the saved
	     set in one section, the two inboxes in another below the browse list, and moderation filed
	     among the browse links as though it were a place to go and look at things. -->
	<div class="drawer__section drawer__section--you">
		{#if authStore.isAuthenticated}
			<a class="drawer__link" href={resolve('/notifications')} onclick={closeOnNavigate}>
				<BellIcon />
				<span>{m.notification_inboxHeading()}</span>
				{#if notificationStore.unreadCount > 0}
					<span class="badge">{notificationStore.unreadCount}</span>
				{/if}
			</a>
			{#if canMessaging}
				<!-- A link to the page rather than the desktop bell/icon pair. Both of those open their
				     own popover, and a popover inside a drawer is a worse interaction than simply going
				     to the inbox — the unread counts, which are the reason they are worth surfacing at
				     all, come along as text. -->
				<a class="drawer__link" href={resolve('/messages')} onclick={closeOnNavigate}>
					{@render messagesIcon()}
					<span>{m.nav_messages()}</span>
					{#if messagesStore.unreadCount > 0}
						<span class="badge">{messagesStore.unreadCount}</span>
					{/if}
				</a>
			{/if}
		{/if}

		<!-- Offered signed out as well: the icon row this mirrors is not rendered at this width, and a
		     guest's set lives only in this browser, so it is the one that would go missing. -->
		<a class="drawer__link" href={resolve('/my-set')} onclick={closeOnNavigate}>
			{@render mySetIcon()}
			<span>{m.nav_mySet()}</span>
			{#if guestSetStore.count > 0}
				<span class="badge badge--count">{guestSetStore.count}</span>
			{/if}
		</a>

		{#if authStore.canModerate}
			<a class="drawer__link" href={resolve('/moderation')} onclick={closeOnNavigate}>
				{@render shieldIcon()}
				<span>{m.nav_moderation()}</span>
				{#if moderationQueueStore.total > 0}
					<!-- How many decisions are actually waiting. A moderation link with no number says
					     "there is a queue somewhere"; with one it says whether opening it is worth
					     doing now, which is the only reason to surface it in navigation at all. -->
					<span class="badge">{moderationQueueStore.total}</span>
				{/if}
			</a>
		{/if}
	</div>

	<!-- The remaining utilities, below the personal block: a random exercise and the theme are things
	     somebody reaches for without reading, but neither is about them. -->
	<div class="drawer__utilities">
		<RandomExerciseButton />
		<ThemeToggle />
	</div>

	<nav class="drawer__section" aria-label={m.nav_mainNavigation()}>
		{@render browseLinks(closeOnNavigate)}
	</nav>

	{#if authStore.isAuthenticated}
		{#if hasAnythingToAdd}
			<div class="drawer__section">
				<p class="drawer__heading">{m.nav_add()}</p>
				{@render createItems('drawer__item', closeOnNavigate)}
			</div>
		{/if}

		<!-- One `.drawer__section` per group, headed exactly as the desktop menu is (WP8). -->
		{@render accountItems('drawer', closeOnNavigate)}
	{:else}
		<div class="drawer__section">
			<a class="drawer__item" href={resolve('/login')} onclick={closeOnNavigate}>
				{m.nav_login()}
			</a>
			<!-- Help for a visitor too (WP8). A signed-out reader has no menu on a desktop — the bar
			     offers them only Log in and Sign up, and /about's own link — so the drawer is the one
			     menu they have, and this is where it goes. -->
			<a class="drawer__item help-link" href={resolve('/about/guide')} onclick={closeOnNavigate}>
				{m.accountMenu_help()}
				<!-- "Help & manual" -->
			</a>
			{#if canIssues}
				<button
					type="button"
					class="drawer__item menu-item--button"
					onclick={() => {
						closeOnNavigate();
						issueReportStore.open();
					}}
				>
					{m.nav_reportIssue()}
				</button>
			{/if}
			<a
				class="drawer__item drawer__item--primary"
				href={resolve('/register')}
				onclick={closeOnNavigate}
			>
				{m.nav_register()}
			</a>
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.site-header {
		@include mix.card-surface;
		border-left: none;
		border-right: none;
		border-top: none;
		border-radius: 0;
		position: sticky;
		top: 0;
		z-index: var(--z-dropdown);

		// The bar's dimensions as a LINEAR function of window width, not stepped at breakpoints
		// (NAVBAR-BRIEF §2): each clamp()'s vw middle term is a straight line between the two
		// endpoints — full size at ≥1200px, minimum at ≤720px (where the phone drawer takes over).
		// Defined once here so everything reads the same endpoints and the bar cannot end up with a
		// linear height and stepped padding. The height itself is content + 2×padding, so it shrinks
		// on the same line the padding does.
		--hdr-pad-y: clamp(6px, 1.25vw - 3px, 12px); // 12px @1200 → 6px @720
		--hdr-pad-x: clamp(8px, 1.667vw - 4px, 16px); // 16px → 8px
		--hdr-gap: clamp(6px, 1.25vw - 3px, 12px); // 12px → 6px
		// 7px, not 8: the brand tile (2026-10-07 colour pass) is 11px wider than the bare glyph was,
		// and the signed-in staff bar had no slack at 1100px — this gap, the brand gap and the tile's
		// own size give the pixels back, each change below the eye's threshold.
		--hdr-gap-sm: clamp(4px, 0.75vw - 2px, 7px); // 7px → 4px
		--hdr-border: clamp(0.5px, 0.10417vw - 0.25px, 1px); // 1px → 0.5px

		border-bottom-width: var(--hdr-border);
	}
	.site-header__row {
		// 1280, up from 1100 (2026-10-14): Materials and Courses came back into the bar, and at the
		// old cap the nav had ~385px beside a signed-in account's controls — less than the eight
		// links need even in English. The bar is chrome, not a reading column, so it may run wider
		// than the page content under it; the footer keeps 1100.
		max-width: 1280px;
		margin: 0 auto;
		position: relative; // the anchor for .brand__report
		display: flex;
		align-items: center;
		gap: var(--hdr-gap);
		padding: var(--hdr-pad-y) var(--hdr-pad-x);
		// One row, which is the whole point: the brand and the browse links on the left, the controls
		// on the right, nothing on a second line. The nav is what gives when the width does not add
		// up — it is the only part here that can shed something (the moderation label goes first,
		// then the browse links scroll) without a control disappearing.
		flex-wrap: nowrap;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 6px; // see --hdr-gap-sm above
		font-weight: 700;
		font-size: var(--font-size-lg);
		color: var(--text-primary);
	}
	// Drawn like static/favicon.svg — one brand in the tab and in the bar. The one place in the
	// chrome where the accent is a filled surface; everything else in the bar is currentColor.
	.brand__mark {
		display: inline-grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: 13px;
		line-height: 1;
	}
	// Under the wordmark, over the bar's bottom padding — the row never grows for it. The padding
	// is the hit area: the label is 11px, the target is ~19px tall and wider than the text by 12px.
	.brand__report {
		@include mix.focus-ring;
		position: absolute;
		left: calc(var(--hdr-pad-x) + 26px); // under the wordmark, not the ∫ tile (20px + 6px gap)
		top: calc(50% + 0.65em);
		z-index: 1;
		padding: 4px 6px;
		font-size: 11px;
		line-height: 1;
		white-space: nowrap;
		color: var(--text-secondary);
		background: none;
		border: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
		&:hover {
			color: var(--accent);
		}
	}
	.site-nav {
		display: flex;
		// Down from --space-4. The row is capped at 1100px and, measured, was 21px short of holding
		// five browse links and the controls at that width — so the last link was clipped on a full
		// desktop. Four gaps at 4px less each buys 16px, and the row's own gap below buys the rest.
		// Now the linear token, whose wide endpoint is the same 12px this was.
		gap: var(--hdr-gap);
		// `min-width: 0` is what actually lets the row stay one row: a flex item will not shrink
		// below its content by default, so without this the nav holds the line at its natural width
		// and pushes the controls off the right-hand end instead of giving way. It is the item that
		// should give — a browse link scrolled out of reach is recoverable, a missing account menu
		// is not — hence the scroll rather than a wrap.
		flex: 0 1 auto;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		&::-webkit-scrollbar {
			display: none;
		}
		> :global(a) {
			white-space: nowrap;
			// A link never shrinks below its content: the nav scrolls instead, so an icon can never be
			// cut mid-glyph (which is what the brand tile's extra width did at 1280 before the gaps
			// above were trimmed).
			flex: none;
		}
		a {
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
			font-weight: 500;
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			&:hover {
				color: var(--text-primary);
			}
		}
	}
	// "You are here": the accent as a current/selected mark, one of its three meanings. A box-shadow,
	// not a border, so the bar's height does not move; at an icon-only stage the line sits under the
	// icon, so both collapse states read.
	.site-nav .nav-link[aria-current='page'] {
		color: var(--text-primary);
		box-shadow: inset 0 -2px 0 var(--accent);
	}
	// Each browse link carries both forms; the stage rules below swap text for icon IN PLACE, so a
	// collapsed link keeps its position and order in the nav (Materials stays between Disciplines
	// and Courses). The base rule hides every icon, which is also what keeps the drawer — where the
	// same snippet renders and none of the `.site-nav`-scoped stage rules apply — text-only.
	.nav-link__icon {
		display: none;
		align-items: center;
	}
	.badge {
		@include mix.count-badge;
	}
	.badge--floating {
		position: absolute;
		top: -2px;
		right: -4px;
	}
	// A number of things I saved is not a number waiting on me: the saved set's count is a plain
	// neutral, so the info fill means "waiting for you" and nothing else.
	.badge--count {
		background: var(--status-neutral-bg);
		color: var(--text-primary);
	}
	/* The personal group — messages, notifications, who you are. The whole actions block is pushed
	   to the right-hand end by its own `margin-left: auto`; inside it, plain gaps and nothing else
	   (the divider that used to mark this boundary is gone — one auto margin is the separation). */
	.site-header__you {
		display: flex;
		align-items: center;
		gap: var(--hdr-gap-sm);
	}

	// Moderation: a word while there is room for one, a shield with a count when there is not. One
	// element either way rather than a wide version and a narrow version — two of them is how the
	// two drift, and how a feature flag eventually hides one and leaves the other.
	.mod-link {
		color: var(--text-secondary);
		&:hover {
			color: var(--text-primary);
		}
	}

	// A wrapper purely so the pair can be hidden as one thing while a session is being restored;
	// it reproduces the gap they used to get from being direct children of .site-header__you.
	.signed-out-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.signed-out-actions.hidden {
		display: none;
	}

	.site-header__actions {
		display: flex;
		align-items: center;
		gap: var(--hdr-gap-sm);
		font-size: var(--font-size-sm);
		/* One row. This used to be `flex: 1 1 100%` — its own full-width line — which was an honest
		   description of what the row did rather than what it should do: the header wrapped, so the
		   controls sat under the nav instead of beside it. Now it takes only the width it needs and
		   the auto margin pushes it to the right-hand end of the same line. */
		flex: 0 0 auto;
		margin-left: auto;
		a {
			color: var(--text-secondary);
			&:hover {
				color: var(--text-primary);
			}
		}
		.primary-link {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.icon-button {
		@include mix.focus-ring;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.icon {
		width: 20px;
		height: 20px;
		flex: none;
	}
	.add-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 600;
		color: var(--accent);
	}
	.add-trigger--open {
		opacity: 0.75;
	}
	.account-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 600;
		color: var(--text-primary);
	}
	.chevron {
		font-size: 10px;
		color: var(--text-secondary);
		transition: transform 120ms ease;
	}
	.chevron--open {
		transform: rotate(180deg);
	}
	.menu-item {
		@include mix.focus-ring;
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-primary) !important;
		white-space: nowrap;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	// The account menu's groups (WP8). A heading is a label, not a stop: small, quiet, uppercase like
	// the drawer's own headings, with a rule between groups so the eye finds the next one without
	// reading. The first group gets no rule — the panel's own edge is already there.
	.menu-group {
		display: flex;
		flex-direction: column;
	}
	.menu-group ~ .menu-group {
		border-top: 1px solid var(--border-color);
		margin-top: var(--space-1);
		padding-top: var(--space-1);
	}
	.menu-group__heading {
		padding: var(--space-1) var(--space-3) 2px;
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.menu-item--button {
		background: none;
		border: none;
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	// ---- the staged collapse (NAVBAR-BRIEF §2, simplified 2026-08-10) ----------------------------
	// As the window narrows the bar gives up the cheapest thing first, one stage at a time, instead
	// of falling off a cliff at one breakpoint. Each stage is a media query; the *sizes* between
	// stages shrink linearly via the --hdr-* tokens above. Media queries rather than a container
	// query on the header: the bar spans the full viewport, so the two are equivalent here, and
	// media queries are the tool this app already uses. The order of stages IS the specification.
	//
	// Each browse link swaps its text for its own icon IN PLACE, at the same widths as before —
	// the earlier scheme (collapsed icons migrating to the action row beside the dice, Disciplines
	// merging into a search icon by Add, Courses vanishing outright) was dropped by owner decision:
	// a link that collapses should stay where it was. Every rule here is scoped under `.site-nav`,
	// so the drawer's copies of the same links stay text-only at every width.

	.account-trigger__avatar {
		display: none;
		align-items: center;
		justify-content: center;
	}
	.account-trigger__img {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}
	.menu-home,
	.menu-locale {
		display: none;
	}
	.menu-locale {
		padding: var(--space-2) var(--space-3);
	}

	// Events is an icon at every width, not at a stage (owner's call, 2026-10-01). It used to be
	// stage 1 of the staged collapse; now the calendar is simply what Events looks like in the bar,
	// so the rule carries no media query. Scoped under `.site-nav` like every other rule here, so
	// the drawer's copy of the same anchor stays a word.
	.site-nav .nav-link--events .nav-link__text {
		display: none;
	}
	.site-nav .nav-link--events .nav-link__icon {
		display: inline-flex;
	}

	// **Re-staged 2026-10-14**, when Materials and Courses came back: eight destinations beside a
	// signed-in account's ~560px of controls do not fit as words even at the 1280px cap (measured:
	// 81px short in Polish for a moderator, whose shield adds a control). So three things now spend
	// their label at EVERY width, like Events already did — About (the page a reader visits once),
	// Contests (occasional, and its rosette reads), and Events — and the account name is capped
	// with an ellipsis rather than allowed to be as long as a person's name. The links the owner
	// called crucial (Exercises, Materials, Courses) keep their words longest, down to 960px.
	// `e2e/navbar-stages.mjs` drives this order; `e2e/courses-communities.mjs` checks the bar does
	// not overflow at 1280 and 1024.
	.site-nav .nav-link--about .nav-link__text,
	.site-nav .nav-link--contests .nav-link__text {
		display: none;
	}
	.site-nav .nav-link--about .nav-link__icon,
	.site-nav .nav-link--contests .nav-link__icon {
		display: inline-flex;
	}
	.account-trigger__name {
		max-width: 8em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	// Stage 2 — the account trigger becomes an icon: their avatar if they have one. Below the cap
	// (1279px, was 1120 before 2026-10-14) — measured, the name and eight links share 1280 exactly.
	@media (max-width: 1279px) {
		.account-trigger__name {
			display: none;
		}
		.account-trigger__avatar {
			display: inline-flex;
		}
	}

	// (Stage 3, Watchlists → eye icon, is deliberately absent: Watchlists was already removed from
	// the navbar — it lives on the Tutoring page — and the owner confirmed the spec line was written
	// from an older memory of the bar, not as a request to re-add it.)

	// Stage 3½ — Help wanted becomes its hand icon, in place (it is the longest label in Polish).
	@media (max-width: 1160px) {
		.site-nav .nav-link--needs .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--needs .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 4½ — Tutoring becomes a money icon, in place.
	@media (max-width: 1060px) {
		.site-nav .nav-link--services .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--services .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 5 — the Add trigger keeps only its plus.
	@media (max-width: 1000px) {
		.add-trigger__text {
			display: none;
		}
	}

	// Stage 5½ — Courses becomes a mortarboard, in place.
	@media (max-width: 960px) {
		.site-nav .nav-link--classroom .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--classroom .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 5¾ — Materials becomes a book, in place.
	@media (max-width: 930px) {
		.site-nav .nav-link--materials .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--materials .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 6 — Exercises (formerly Disciplines) becomes a worksheet icon, in place.
	@media (max-width: 900px) {
		.site-nav .nav-link--disciplines .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--disciplines .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 7 — the logo disappears. The lower bound matters: at ≤720px the phone bar is exactly
	// the brand plus the drawer button, so the brand must come back there. In the 721–850px band a
	// Home entry appears in the account menu, and page breadcrumbs keep home reachable for guests.
	@media (max-width: 850px) and (min-width: 721px) {
		.brand,
		.brand__report {
			display: none;
		}
	}
	@media (max-width: 850px) {
		.menu-home {
			display: block;
		}
		// Home is not one of the account groups, so a rule sets it apart from the first of them.
		.menu-home + .menu-group {
			border-top: 1px solid var(--border-color);
			margin-top: var(--space-1);
			padding-top: var(--space-1);
		}
	}

	// Stage 8 — once somebody has an account, the language picker moves into the account menu.
	// `.row-locale--signed-in` is only ever set for an authenticated session, so a guest's picker
	// stays in the row at every width.
	@media (max-width: 800px) {
		.row-locale--signed-in {
			display: none;
		}
		.menu-locale {
			display: block;
		}
	}

	// Stage 10 is the existing phone drawer, below — everything collapses into it at ≤720px.

	// ---- the drawer, and the button that opens it ------------------------------------------------
	// Both are desktop-hidden rather than mobile-added, so the desktop bar is exactly what it was.
	.drawer-toggle,
	.drawer,
	.drawer-scrim {
		display: none;
	}

	@media (max-width: 720px) {
		// One row: the bar is the brand, and everything else has moved into the drawer.
		.site-nav,
		.site-header__actions {
			display: none;
		}
		.site-header__row {
			flex-wrap: nowrap;
		}
		// On a phone the bar is short, so the link cannot hang under the wordmark without leaving the
		// bar's box — it sits beside the brand instead, in the flow, still inside the bar.
		.brand__report {
			position: static;
			margin-left: var(--space-1);
			padding: 6px;
		}
		.site-header {
			transition: transform 180ms ease;
			will-change: transform;
		}
		.site-header--tucked {
			transform: translateY(-100%);
		}

		.drawer-toggle {
			@include mix.focus-ring;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			margin-left: auto;
			flex: 0 0 auto;
			width: 30px;
			height: 30px;
			padding: 0;
			border: 0;
			border-radius: var(--radius-sm);
			background: none;
			color: var(--text-primary);
			font-size: var(--font-size-base);
			line-height: 1;
			cursor: pointer;
		}

		.drawer-scrim {
			display: block;
			border: none;
			padding: 0;
			position: fixed;
			inset: 0;
			z-index: var(--z-modal-scrim);
			background: var(--backdrop);
		}

		.drawer {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(20rem, 86vw);
			z-index: var(--z-modal);
			// The bottom padding is not symmetry, it is clearance. An in-app browser (Facebook
			// Messenger's is the one this was reported from) draws its own toolbar OVER the bottom
			// edge of the viewport, and it is not reported through `env(safe-area-inset-bottom)` —
			// that inset describes the device's own chrome (a home indicator, a notch), which is why
			// both are added rather than either being trusted alone. Without the fixed part, the last
			// item in a drawer long enough to scroll sits flush against the bottom edge and is
			// covered by a bar the page cannot see. Measured at ~60px in Messenger; 64px is that plus
			// room to be wrong.
			padding: var(--space-2) var(--space-4)
				calc(var(--space-6) + var(--space-3) + env(safe-area-inset-bottom, 0px));
			background: var(--bg-surface);
			border-left: 1px solid var(--border-color);
			overflow-y: auto;
			// Off-canvas rather than unmounted, so it slides rather than appears. `visibility` is what
			// keeps it out of the tab order while it is off-screen — a translated element is still
			// focusable, and a hidden drawer full of reachable links is a real keyboard trap.
			transform: translateX(100%);
			visibility: hidden;
			transition:
				transform 200ms ease,
				visibility 200ms;
		}
		.drawer--open {
			transform: translateX(0);
			visibility: visible;
		}
		.drawer:focus {
			outline: none;
		}

		.drawer__identity {
			padding-bottom: var(--space-2);
			border-bottom: 1px solid var(--border-color);
		}
		.drawer__name {
			font-weight: 700;
		}
		.drawer__top {
			display: flex;
			align-items: center;
			justify-content: space-between;
			min-height: 40px;
			// Sticky, so the two controls that are here BECAUSE they must always be available — the
			// way out, and the way to a language you can read — stay on screen however far down the
			// drawer is scrolled. The drawer is its own scroll container, so this is `top: 0` against
			// it rather than against the page. The background is what stops links scrolling
			// underneath it visibly; the negative margins plus matching padding let it span the
			// drawer's full width so nothing shows through at the edges.
			position: sticky;
			top: 0;
			z-index: 1;
			margin: calc(var(--space-2) * -1) calc(var(--space-4) * -1) 0;
			padding: var(--space-2) var(--space-4);
			background: var(--bg-surface);
			// The sticky edge is measured inside the drawer's own top padding, so the bar sticks 8px
			// below the top and a sliver of every link scrolled through the gap above it — seen in a
			// screenshot of the grouped drawer (WP8), which is longer and so scrolls more. This
			// covers the gap without moving the bar.
			&::before {
				content: '';
				position: absolute;
				left: 0;
				right: 0;
				bottom: 100%;
				height: var(--space-2);
				background: var(--bg-surface);
			}
		}
		// The ✕ keeps the look the floating toggle had in production — a bordered 40px box on the
		// surface colour with the modal shadow — at the owner's request; only the ☰ in the bar went
		// borderless. Laid out in `.drawer__top` rather than fixed, at the same spot it used to float.
		.drawer__close {
			@include mix.focus-ring;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			padding: 0;
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			font-size: var(--font-size-base);
			line-height: 1;
			cursor: pointer;
			box-shadow: var(--shadow-modal);
		}

		.drawer__section--you {
			border-bottom: 1px solid var(--border-color);
			padding-bottom: var(--space-2);
		}

		.drawer__utilities {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			flex-wrap: wrap;
		}
		.drawer__section {
			display: flex;
			flex-direction: column;
			padding-top: var(--space-2);
			border-top: 1px solid var(--border-color);
			// The browse links are `<a>`s styled by `.site-nav` on a desktop; in here they need their
			// own size, since that rule is scoped to a container this drawer is not inside.
			a {
				color: var(--text-primary);
			}
		}
		.drawer__heading {
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-secondary);
			padding: var(--space-1) 0;
		}
		.drawer__item,
		.drawer__link,
		.drawer__section > :global(a) {
			@include mix.focus-ring;
			display: flex;
			align-items: center;
			gap: var(--space-2);
			// 44px of target, which is the size a thumb actually hits.
			min-height: 44px;
			padding: var(--space-2) 0;
			font-size: var(--font-size-base);
			text-align: left;
			background: none;
			border: none;
			font-family: inherit;
			color: var(--text-primary);
			cursor: pointer;
		}
		.drawer__item--primary {
			color: var(--accent);
			font-weight: 600;
		}
		// The drawer's copy of the current section — the same aria-current the bar reads, since the
		// snippet renders both, so the two surfaces cannot disagree about where you are.
		.drawer__section > :global(a[aria-current='page']) {
			color: var(--accent);
			font-weight: 600;
		}
	}

	// Somebody who has asked for less motion gets the same behaviour with none of it: the bar still
	// tucks away and the drawer still opens, they simply do so at once.
	@media (prefers-reduced-motion: reduce) {
		.site-header,
		.drawer,
		.chevron {
			transition: none;
		}
	}
</style>
