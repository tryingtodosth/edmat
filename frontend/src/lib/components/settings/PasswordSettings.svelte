<script lang="ts">
	/** Settings → Password (backend `accounts/password.py`). Without a usable password — an account
	 *  that signs in only through a provider — it offers "Set a password" and asks for no current
	 *  one; with a password it is an ordinary change, which needs the current password. Each refusal
	 *  has its own line (house rule 6). */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { getHasPassword, PASSWORD_CHANGED_EVENT, setPassword } from '$lib/services/password';

	let hasPassword = $state<boolean | null>(null);
	let open = $state(false);
	let current = $state('');
	let next = $state('');
	let repeat = $state('');
	let busy = $state(false);
	let errors = $state<{ current?: string; next?: string; repeat?: string; form?: string }>({});
	let done = $state('');

	onMount(() => {
		getHasPassword()
			.then((v) => (hasPassword = v))
			.catch(() => {});
	});

	function first(body: Record<string, unknown>, key: string): string[] {
		const v = body[key];
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errors = {};
		done = '';
		if (next !== repeat) {
			errors = { repeat: m.sso_password_mismatch() }; // "The two new passwords are not the same."
			return;
		}
		busy = true;
		const wasSet = hasPassword;
		try {
			await setPassword(next, hasPassword ? current : undefined);
			hasPassword = true;
			open = false;
			current = next = repeat = '';
			done = wasSet
				? m.sso_password_changed() // "Your password has been changed."
				: m.sso_password_set(); // "Your password is set. You can now also sign in with it."
			window.dispatchEvent(new CustomEvent(PASSWORD_CHANGED_EVENT));
		} catch (e) {
			const body =
				e instanceof ApiError && e.body && typeof e.body === 'object'
					? (e.body as Record<string, unknown>)
					: {};
			const c = first(body, 'current_password')[0];
			const n = first(body, 'new_password');
			errors = {
				current:
					c === 'current_password_wrong'
						? m.sso_password_currentWrong() // "That is not your current password."
						: c
							? m.sso_password_currentRequired() // "Type your current password."
							: undefined,
				next:
					n[0] === 'new_password_required'
						? m.sso_password_newRequired() // "Type a new password."
						: n.length
							? n.join(' ')
							: undefined,
				form:
					!c && !n.length
						? e instanceof ApiError && e.status === 429
							? m.sso_tooMany() // "Too many attempts — wait a while and try again."
							: m.sso_password_failed() // "The password could not be saved. Try again."
						: undefined
			};
		} finally {
			busy = false;
		}
	}
</script>

{#if hasPassword !== null}
	<section class="password-settings" data-testid="password-settings">
		<h2>{m.sso_settings_password()}</h2>
		<!-- "Password" -->
		{#if !open}
			<p class="hint">
				{hasPassword
					? m.sso_password_hasOne() // "You sign in with a password."
					: m.sso_password_none()}
				<!-- "This account has no password: you sign in through an outside account. Set one to be able to sign in without it." -->
			</p>
			<button type="button" class="secondary" onclick={() => ((open = true), (done = ''))}>
				{hasPassword
					? m.sso_password_changeButton() // "Change password"
					: m.sso_password_setButton()}
				<!-- "Set a password" -->
			</button>
		{:else}
			<form onsubmit={submit}>
				{#if hasPassword}
					<label class="field">
						<span>{m.sso_password_current()}</span>
						<!-- "Current password" -->
						<input
							type="password"
							name="current_password"
							autocomplete="current-password"
							bind:value={current}
						/>
						{#if errors.current}<span class="error">{errors.current}</span>{/if}
					</label>
				{/if}
				<label class="field">
					<span>{m.sso_password_new()}</span>
					<!-- "New password" -->
					<input
						type="password"
						name="new_password"
						autocomplete="new-password"
						bind:value={next}
					/>
					<span class="hint">{m.auth_register_passwordHint()}</span>
					{#if errors.next}<span class="error">{errors.next}</span>{/if}
				</label>
				<label class="field">
					<span>{m.sso_password_repeat()}</span>
					<!-- "New password again" -->
					<input
						type="password"
						name="repeat_password"
						autocomplete="new-password"
						bind:value={repeat}
					/>
					{#if errors.repeat}<span class="error">{errors.repeat}</span>{/if}
				</label>
				{#if errors.form}<p class="error" role="alert">{errors.form}</p>{/if}
				<div class="buttons">
					<button type="submit" class="primary" disabled={busy}>
						{hasPassword ? m.sso_password_changeButton() : m.sso_password_setButton()}
					</button>
					<button type="button" class="link" onclick={() => ((open = false), (errors = {}))}>
						{m.sso_complete_cancel()}
						<!-- "Cancel" -->
					</button>
				</div>
			</form>
		{/if}
		{#if done}<p class="ok-text" role="status" data-testid="password-done">{done}</p>{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.password-settings {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}
	h2 {
		font-size: var(--font-size-base);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		max-width: 24rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.hint {
		font-size: var(--font-size-sm);
		font-weight: 400;
		color: var(--text-secondary);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		font-weight: 400;
	}
	.buttons {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.link {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}
	.ok-text {
		color: var(--status-success);
		font-size: var(--font-size-sm);
	}
</style>
