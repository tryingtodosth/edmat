<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import type { NotificationType } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, locales } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import { authStore } from '$lib/state/auth.svelte';
	import { materialsUiStore, type MaterialsUiMode } from '$lib/state/materialsUi.svelte';
	import { NOTIFICATION_TYPE_CATEGORY, NOTIFICATION_TYPE_LABELS } from '$lib/utils/labels';
	import AvatarEditor from '$lib/components/settings/AvatarEditor.svelte';
	import EducationPanel from '$lib/components/settings/EducationPanel.svelte';
	import DonationLinksEditor from '$lib/components/settings/DonationLinksEditor.svelte';
	import TagFollowsEditor from '$lib/components/settings/TagFollowsEditor.svelte';

	let displayName = $state('');
	let preferredLocale = $state('en');
	let showProfilePublicly = $state(true);
	let notifyOnCommentReply = $state(true);
	let notifyOnModerationDecision = $state(true);
	let notifyOnContentAction = $state(true);
	let notifyOnCourseActivity = $state(true);
	let notifyOnBooking = $state(true);
	// Display preferences, with this app's own defaults rather than whatever the browser's locale
	// would pick — see state/displayPrefs.svelte.ts for why those two are not the same question.
	let timeFormat = $state<'24h' | '12h'>('24h');
	let weekStartsOn = $state<'monday' | 'sunday'>('monday');
	// Tutoring opt-in badge (User.offersTutoring/tutoringNote) - a deliberately lightweight
	// signal distinct from a real, course-scoped services.Service listing (see accounts/models.py's
	// own doc comment): "I'm open to being asked," shown on the public profile.
	let offersTutoring = $state(false);
	let tutoringNote = $state('');
	// Finer-grained than the three booleans above, layered on top — see Profile
	// .muted_notification_types' own doc comment (accounts/models.py) for the full reasoning. A
	// type in here is muted even while its own coarse category above stays on. `SvelteSet`, not a
	// plain `Set` in `$state()` — this project's own eslint config (svelte/prefer-svelte-reactivity)
	// flags calling `.add()`/`.delete()` on a bare Set; `SvelteSet` is reactive to in-place
	// mutation directly, so `toggleMuted` below never needs to reconstruct/reassign the whole thing.
	let mutedTypes = new SvelteSet<NotificationType>();
	let seeded = $state(false);
	let saving = $state(false);
	let saveError = $state('');
	let saved = $state(false);

	// Static (NOTIFICATION_TYPE_CATEGORY never changes at runtime) — every type that belongs to the
	// "moderation decision"/"content action" coarse categories, the two with more than one member
	// and therefore something genuine to fine-tune. `commentReply` has no sibling in its own
	// category, so its coarse checkbox above already says everything a per-type row would.
	const moderationDecisionTypes = (
		Object.keys(NOTIFICATION_TYPE_CATEGORY) as NotificationType[]
	).filter((t) => NOTIFICATION_TYPE_CATEGORY[t] === 'notifyOnModerationDecision');
	const contentActionTypes = (Object.keys(NOTIFICATION_TYPE_CATEGORY) as NotificationType[]).filter(
		(t) => NOTIFICATION_TYPE_CATEGORY[t] === 'notifyOnContentAction'
	);
	const courseActivityTypes = (
		Object.keys(NOTIFICATION_TYPE_CATEGORY) as NotificationType[]
	).filter((t) => NOTIFICATION_TYPE_CATEGORY[t] === 'notifyOnCourseActivity');
	const bookingTypes = (Object.keys(NOTIFICATION_TYPE_CATEGORY) as NotificationType[]).filter(
		(t) => NOTIFICATION_TYPE_CATEGORY[t] === 'notifyOnBooking'
	);

	function toggleMuted(type: NotificationType) {
		if (mutedTypes.has(type)) {
			mutedTypes.delete(type);
		} else {
			mutedTypes.add(type);
		}
	}

	// Seeds the editable form fields from the loaded user exactly once — the same "one-time read,
	// not a live `$derived` mirror" discipline this app already applies wherever a form starts from
	// server state but is then locally editable, so typing into a field doesn't fight a reactive
	// re-seed on every unrelated authStore change.
	$effect(() => {
		if (seeded || !authStore.user) return;
		seeded = true;
		displayName = authStore.user.displayName;
		preferredLocale = authStore.user.preferredLocale;
		showProfilePublicly = authStore.user.showProfilePublicly ?? true;
		notifyOnCommentReply = authStore.user.notifyOnCommentReply ?? true;
		notifyOnModerationDecision = authStore.user.notifyOnModerationDecision ?? true;
		notifyOnContentAction = authStore.user.notifyOnContentAction ?? true;
		notifyOnCourseActivity = authStore.user.notifyOnCourseActivity ?? true;
		notifyOnBooking = authStore.user.notifyOnBooking ?? true;
		timeFormat = authStore.user.timeFormat ?? '24h';
		weekStartsOn = authStore.user.weekStartsOn ?? 'monday';
		offersTutoring = authStore.user.offersTutoring;
		tutoringNote = authStore.user.tutoringNote;
		// Mutate the existing SvelteSet in place, not a reassignment — `mutedTypes` is a plain `let`
		// (SvelteSet is already reactive to `.add()` on its own, so it was never wrapped in `$state()`
		// to begin with), and a bare `let` reassignment wouldn't be tracked the way `$state` is.
		for (const type of authStore.user.mutedNotificationTypes ?? []) {
			mutedTypes.add(type);
		}
	});

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saveError = '';
		saved = false;
		const result = await authStore.updateProfile({
			displayName,
			preferredLocale,
			showProfilePublicly,
			notifyOnCommentReply,
			notifyOnModerationDecision,
			notifyOnContentAction,
			notifyOnCourseActivity,
			notifyOnBooking,
			timeFormat,
			weekStartsOn,
			mutedNotificationTypes: Array.from(mutedTypes),
			offersTutoring,
			tutoringNote
		});
		saving = false;
		if (result.ok) {
			saved = true;
		} else {
			saveError = result.error;
		}
	}
</script>

<svelte:head>
	<title>{m.settings_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.settings_heading()}</h1>

	<!-- The materials search/filter/sort overhaul's own "parallel interface" switch — the settings
	     button that's also going to handle language (preferredLocale, below, and the header's own
	     LocaleSwitcher) also handles which of the two materials browsing interfaces is active.
	     Deliberately OUTSIDE the auth gate below: an anonymous visitor is a real persona this app
	     designs for (CLAUDE.md Section 5), and gets the same real choice a registered user does —
	     same reasoning theme/guest-set already work without an account. -->
	<section class="browsing">
		<h2>{m.settings_browsingHeading()}</h2>
		<p class="field-hint">{m.settings_browsingHint()}</p>
		<div class="mode-options" role="radiogroup" aria-label={m.settings_browsingHeading()}>
			{#each ['simple', 'advanced'] as mode (mode)}
				<label class="mode-option">
					<input
						type="radio"
						name="materials-mode"
						checked={materialsUiStore.mode === mode}
						onchange={() => materialsUiStore.setMode(mode as MaterialsUiMode)}
					/>
					<span>
						{mode === 'simple' ? m.settings_browsingSimple() : m.settings_browsingAdvanced()}
						<small>
							{mode === 'simple'
								? m.settings_browsingSimpleHint()
								: m.settings_browsingAdvancedHint()}
						</small>
					</span>
				</label>
			{/each}
		</div>
	</section>

	{#if !authStore.isAuthenticated || !authStore.user}
		<p class="login-prompt"><a href={resolve('/login')}>{m.settings_loginRequired()}</a></p>
	{:else}
		{@const user = authStore.user}
		<section class="profile">
			<h2>{m.settings_profile_heading()}</h2>
			<dl>
				<dt>{m.settings_email()}</dt>
				<dd>{user.email}</dd>
			</dl>
			<p class="joined">
				{m.settings_joined({
					date: formatDate(user.joinedAt ?? new Date().toISOString(), getLocale())
				})}
			</p>
			<div class="roles">
				{#if user.isModerator}
					<span class="badge">{m.settings_role_moderator()}</span>
				{/if}
				{#if user.isVerifiedContributor}
					<span class="badge">{m.settings_role_verifiedContributor()}</span>
				{/if}
				{#if !user.isModerator && !user.isVerifiedContributor}
					<span class="badge badge--neutral">{m.settings_role_member()}</span>
				{/if}
			</div>
			<a class="view-public" href={resolve('/users/[id]', { id: user.id })}>
				{m.profile_viewPublic()}
			</a>
		</section>

		<!-- Its own section, deliberately outside the `edit-form` below: the avatar has its own
		     multipart endpoint and saves immediately on its own action, so folding it into a form
		     whose Save button posts a JSON PATCH would imply it's part of that same submit when it
		     isn't. Same standalone-section shape DonationLinksEditor/TagFollowsEditor already use. -->
		<section class="avatar">
			<h2>{m.settings_avatarHeading()}</h2>
			<AvatarEditor />
		</section>

		<!-- Standalone for the same reason as the avatar above: it saves through its own endpoints
		     as you go (each consent toggle is its own decision, and batching three of them behind a
		     Save button would blur exactly the distinction the feature exists to make). -->
		<section class="education-section">
			<EducationPanel />
		</section>

		<form class="edit-form" onsubmit={handleSave}>
			<section class="field-group">
				<h2>{m.settings_editHeading()}</h2>
				<label>
					<span>{m.settings_displayName()}</span>
					<input type="text" bind:value={displayName} maxlength="100" required />
				</label>
				<label>
					<span>{m.settings_preferredLocale()}</span>
					<select bind:value={preferredLocale}>
						{#each locales as locale (locale)}
							<option value={locale}>{locale.toUpperCase()}</option>
						{/each}
					</select>
				</label>
			</section>

			<section class="field-group">
				<h2>{m.settings_privacyHeading()}</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={showProfilePublicly} />
					<span>{m.settings_showProfilePublicly()}</span>
				</label>
				<p class="field-hint">{m.settings_showProfilePubliclyHint()}</p>
			</section>

			<section class="field-group">
				<h2>{m.settings_tutoringHeading()}</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={offersTutoring} />
					<span>{m.settings_offersTutoring()}</span>
				</label>
				<p class="field-hint">{m.settings_offersTutoringHint()}</p>
				{#if offersTutoring}
					<label>
						<span>{m.settings_tutoringNote()}</span>
						<input type="text" bind:value={tutoringNote} maxlength="200" />
					</label>
				{/if}
			</section>

			<!-- Its own section rather than folded in beside the interface language, because they are
			     genuinely different questions: reading the English interface is not a statement about
			     wanting a 12-hour clock, and letting the locale decide is how somebody ends up looking
			     at the wrong one with no way to say so. -->
			<section class="field-group">
				<h2>{m.settings_datesHeading()}</h2>
				<label>
					<span>{m.settings_timeFormat()}</span>
					<select bind:value={timeFormat}>
						<option value="24h">{m.settings_timeFormat_24h()}</option>
						<option value="12h">{m.settings_timeFormat_12h()}</option>
					</select>
				</label>
				<label>
					<span>{m.settings_weekStartsOn()}</span>
					<select bind:value={weekStartsOn}>
						<option value="monday">{m.booking_weekday_monday()}</option>
						<option value="sunday">{m.booking_weekday_sunday()}</option>
					</select>
				</label>
				<p class="field-hint">{m.settings_datesHint()}</p>
			</section>

			<section class="field-group">
				<h2>{m.settings_notificationsHeading()}</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnCommentReply} />
					<span>{m.settings_notifyOnCommentReply()}</span>
				</label>
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnModerationDecision} />
					<span>{m.settings_notifyOnModerationDecision()}</span>
				</label>
				{#if notifyOnModerationDecision}
					<ul class="fine-tune">
						{#each moderationDecisionTypes as type (type)}
							<li>
								<label class="checkbox checkbox--sub">
									<input
										type="checkbox"
										checked={!mutedTypes.has(type)}
										onchange={() => toggleMuted(type)}
									/>
									<span>{NOTIFICATION_TYPE_LABELS[type]?.()}</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnCourseActivity} />
					<span>{m.settings_notifyOnCourseActivity()}</span>
				</label>
				{#if notifyOnCourseActivity}
					<ul class="fine-tune">
						{#each courseActivityTypes as type (type)}
							<li>
								<label class="checkbox checkbox--sub">
									<input
										type="checkbox"
										checked={!mutedTypes.has(type)}
										onchange={() => toggleMuted(type)}
									/>
									<span>{NOTIFICATION_TYPE_LABELS[type]?.()}</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
				<!-- Its own coarse category, and the copy names the consequence rather than leaving it to
				     be discovered: a tutor who turns this off stops being told that anybody has asked for
				     an hour of their time. -->
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnBooking} />
					<span>{m.settings_notifyOnBooking()}</span>
				</label>
				{#if notifyOnBooking}
					<ul class="fine-tune">
						{#each bookingTypes as type (type)}
							<li>
								<label class="checkbox checkbox--sub">
									<input
										type="checkbox"
										checked={!mutedTypes.has(type)}
										onchange={() => toggleMuted(type)}
									/>
									<span>{NOTIFICATION_TYPE_LABELS[type]?.()}</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnContentAction} />
					<span>{m.settings_notifyOnContentAction()}</span>
				</label>
				{#if notifyOnContentAction}
					<ul class="fine-tune">
						{#each contentActionTypes as type (type)}
							<li>
								<label class="checkbox checkbox--sub">
									<input
										type="checkbox"
										checked={!mutedTypes.has(type)}
										onchange={() => toggleMuted(type)}
									/>
									<span>{NOTIFICATION_TYPE_LABELS[type]?.()}</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
				<label class="checkbox">
					<input
						type="checkbox"
						checked={!mutedTypes.has('newTaggedContent')}
						onchange={() => toggleMuted('newTaggedContent')}
					/>
					<span>{NOTIFICATION_TYPE_LABELS.newTaggedContent?.()}</span>
				</label>
				<p class="field-hint">{m.settings_notifyNewTaggedContentHint()}</p>
			</section>

			<div class="save-row">
				<button type="submit" disabled={saving}
					>{saving ? m.common_loading() : m.common_save()}</button
				>
				{#if saved}
					<span class="saved">{m.settings_saved()}</span>
				{/if}
				{#if saveError}
					<span class="error">{saveError}</span>
				{/if}
			</div>
		</form>

		<section class="donations">
			<h2>{m.settings_donationsHeading()}</h2>
			<p class="field-hint">{m.settings_donationsHint()}</p>
			<DonationLinksEditor />
		</section>

		<section class="tags">
			<h2>{m.settings_tagsHeading()}</h2>
			<p class="field-hint">{m.settings_tagsHint()}</p>
			<TagFollowsEditor />
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 480px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.browsing {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.browsing h2 {
		font-size: var(--font-size-base);
	}
	.mode-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.mode-option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.mode-option input {
		margin-top: 3px;
	}
	.mode-option small {
		display: block;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 400;
	}
	.profile,
	.edit-form,
	.avatar,
	.donations,
	.tags {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.profile h2,
	.field-group h2,
	.avatar h2,
	.donations h2,
	.tags h2 {
		font-size: var(--font-size-base);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
	}
	.joined {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.roles {
		display: flex;
		gap: var(--space-1);
	}
	.badge {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.badge--neutral {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
	.view-public {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--accent);
	}
	.edit-form {
		gap: var(--space-4);
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field-group label:not(.checkbox) {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		span {
			color: var(--text-secondary);
		}
		input,
		select {
			@include mix.focus-ring;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
		}
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.fine-tune {
		list-style: none;
		margin: 0 0 0 var(--space-4);
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		border-left: 2px solid var(--border-color);
		padding-left: var(--space-3);
	}
	.checkbox--sub {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.save-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		button {
			@include mix.button-primary;
		}
	}
	.saved {
		font-size: var(--font-size-sm);
		color: var(--status-success);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
