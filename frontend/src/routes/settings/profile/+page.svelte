<script lang="ts">
	// The profile editor: one screen of rows, one modal per area.
	//
	// **Its own route rather than more sections on /settings**, for two reasons. That page is already
	// eleven sections of account preferences — notifications, dates and times, privacy, donation links,
	// followed tags — and a profile is a different job: it is the thing other people read, so it wants
	// to be edited against a preview of itself rather than buried among switches. And a person who wants
	// to fix their bio should not have to scroll past six notification checkboxes to reach it.
	//
	// **Mirrors the public profile's own shape deliberately** — the same summary rows in the same order,
	// each opening a dialog instead of a read-only one. What you edit is laid out like what a visitor
	// sees, so nothing has to be imagined.
	//
	// Nothing here batches. Every modal saves through its own endpoint the moment it is used, which is
	// why there is no page-level Save button: one would imply the modals were drafts, and the education
	// consents in particular must never look like something a later click confirms.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getUserExtras } from '$lib/services/profileExtras';
	import AvatarModal from '$lib/components/profile/edit/AvatarModal.svelte';
	import BasicsModal from '$lib/components/profile/edit/BasicsModal.svelte';
	import CertificatesModal from '$lib/components/profile/edit/CertificatesModal.svelte';
	import EducationModal from '$lib/components/profile/edit/EducationModal.svelte';
	import ExperienceModal from '$lib/components/profile/edit/ExperienceModal.svelte';
	import SkillsModal from '$lib/components/profile/edit/SkillsModal.svelte';
	import type { Certificate, ExperienceEntry, SkillEntry } from '$lib/types/profileExtras';

	let experience = $state<ExperienceEntry[]>([]);
	let skills = $state<SkillEntry[]>([]);
	let certificates = $state<Certificate[]>([]);
	let loaded = $state(false);

	type Modal = 'basics' | 'avatar' | 'education' | 'experience' | 'skills' | 'certificates';
	let modal = $state<Modal | null>(null);

	/** The page owns the three lists and every modal reloads through here.
	 *
	 * One fetch rather than three modals each loading their own: the rows on this page show a summary of
	 * all three, so they all have to be present before anything renders anyway — and a modal that
	 * fetched its own copy would leave the row behind it stale after a save. */
	async function reload() {
		const id = authStore.user?.id;
		if (!id) return;
		const extras = await getUserExtras(id);
		experience = extras.experience;
		skills = extras.skills;
		certificates = extras.certificates;
	}

	// Keyed on the account rather than run once at mount: `authStore.init()` resolves asynchronously, so
	// a hard reload of this URL reaches the component before there is an id to fetch with. This is the
	// same fix `/messages` needed for the identical reason — an `onMount` that checks once is a race.
	let loadedFor = $state<string | undefined>(undefined);
	$effect(() => {
		const id = authStore.user?.id;
		if (!id || id === loadedFor) return;
		loadedFor = id;
		reload().finally(() => (loaded = true));
	});
</script>

<svelte:head>
	<title>{m.profile_edit_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.profile_edit_heading()}</h1>
	<!-- "My profile" -->

	{#if authStore.restoring}
		<p class="session-restoring">{m.common_loading()}</p>
	{:else if !authStore.isAuthenticated}
		<p data-session-hidden class="status">{m.settings_loginRequired()}</p>
		<!-- "Log in to view your settings." -->
	{:else}
		{@const user = authStore.user}
		<section class="card">
			<div class="preview">
				{#if user?.avatarUrl}
					<img class="avatar" src={user.avatarUrl} alt="" width="56" height="56" />
				{:else}
					<span class="avatar avatar--empty" aria-hidden="true">
						{(user?.displayName || '?').slice(0, 1).toUpperCase()}
					</span>
				{/if}
				<div class="preview__text">
					<strong>{user?.displayName}</strong>
					<span class="muted">{user?.email}</span>
				</div>
			</div>
			<a class="link" href={resolve('/users/[id]', { id: user?.id ?? '' })}>
				{m.profile_viewPublic()}
				<!-- "View my public profile →" -->
			</a>
		</section>

		<section class="card">
			<h2>{m.profile_edit_sectionsHeading()}</h2>
			<!-- "What your profile says" -->

			<button type="button" class="row" onclick={() => (modal = 'basics')}>
				<span class="row__label">{m.profile_edit_basicsHeading()}</span>
				<!-- "Name and bio" -->
				<span class="row__value">
					{user?.bio ? m.profile_edit_bioSet() : m.profile_edit_bioUnset()}
					<!-- "Written" / "Not written yet" -->
				</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>

			<button type="button" class="row" onclick={() => (modal = 'avatar')}>
				<span class="row__label">{m.settings_avatarHeading()}</span>
				<span class="row__value">
					{user?.avatarUrl ? m.profile_edit_avatarSet() : m.profile_edit_avatarUnset()}
					<!-- "Uploaded" / "None" -->
				</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>

			<button type="button" class="row" onclick={() => (modal = 'education')}>
				<span class="row__label">{m.education_heading()}</span>
				<span class="row__value">{m.profile_edit_educationValue()}</span>
				<!-- "School, USOS, transcript, what is public" -->
				<span class="row__go" aria-hidden="true">›</span>
			</button>

			<button type="button" class="row" onclick={() => (modal = 'experience')} disabled={!loaded}>
				<span class="row__label">{m.profile_experienceHeading()}</span>
				<span class="row__value">{m.profile_rowCount({ count: experience.length })}</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>

			<button type="button" class="row" onclick={() => (modal = 'skills')} disabled={!loaded}>
				<span class="row__label">{m.profile_skillsHeading()}</span>
				<span class="row__value">{m.profile_rowCount({ count: skills.length })}</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>

			<button type="button" class="row" onclick={() => (modal = 'certificates')} disabled={!loaded}>
				<span class="row__label">{m.profile_certificatesHeading()}</span>
				<span class="row__value">{m.profile_rowCount({ count: certificates.length })}</span>
				<span class="row__go" aria-hidden="true">›</span>
			</button>
		</section>

		<section class="card">
			<h2>{m.profile_edit_elsewhereHeading()}</h2>
			<!-- "Elsewhere in settings" -->
			<p class="muted">{m.profile_edit_elsewhereNote()}</p>
			<!-- "Notifications, how dates are shown, donation links and followed tags are account
			     preferences rather than things your profile says, so they stay on the settings page." -->
			<a class="link" href={resolve('/settings')}>{m.profile_edit_toSettings()}</a>
			<!-- "Open settings →" -->
		</section>
	{/if}
</div>

{#if modal === 'basics'}
	<BasicsModal onClose={() => (modal = null)} />
{:else if modal === 'avatar'}
	<AvatarModal onClose={() => (modal = null)} />
{:else if modal === 'education'}
	<EducationModal onClose={() => (modal = null)} />
{:else if modal === 'experience'}
	<ExperienceModal entries={experience} onChanged={reload} onClose={() => (modal = null)} />
{:else if modal === 'skills'}
	<SkillsModal {skills} onChanged={reload} onClose={() => (modal = null)} />
{:else if modal === 'certificates'}
	<CertificatesModal {certificates} onChanged={reload} onClose={() => (modal = null)} />
{/if}

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.status,
	.muted {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.preview {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.avatar {
		width: 56px;
		height: 56px;
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
		font-size: var(--font-size-lg);
		font-weight: 600;
	}
	.preview__text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.link {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 0.2em;
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
		&:disabled {
			opacity: 0.5;
			cursor: default;
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
</style>
