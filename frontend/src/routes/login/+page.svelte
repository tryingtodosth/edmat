<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { DEMO_PASSWORD } from '$lib/demo';

	let email = $state('');
	let password = $state('');
	let error = $state(false);
	let submitting = $state(false);

	async function handleSubmit() {
		submitting = true;
		error = false;
		const result = await authStore.login(email, password);
		submitting = false;
		if (result.ok) {
			goto(resolve('/'));
		} else {
			error = true;
		}
	}
</script>

<svelte:head>
	<title>{m.auth_login_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.auth_login_heading()}</h1>

	<form onsubmit={(e) => (e.preventDefault(), handleSubmit())}>
		<label class="field">
			<span>{m.auth_login_email()}</span>
			<input type="email" bind:value={email} required />
		</label>
		<label class="field">
			<span>{m.auth_login_password()}</span>
			<input type="password" bind:value={password} required />
		</label>

		{#if error}
			<p class="error">{m.auth_login_error()}</p>
		{/if}

		<button type="submit" class="submit" disabled={submitting}>{m.auth_login_submit()}</button>
	</form>

	<p class="demo-note">{m.auth_login_demoNote({ password: DEMO_PASSWORD })}</p>

	<p class="switch">
		{m.auth_login_noAccount()}
		<a href={resolve('/register')}>{m.auth_login_registerLink()}</a>
	</p>
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 400px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
		text-align: center;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
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
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.submit {
		@include mix.button-primary;
	}
	.demo-note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-align: center;
	}
	.switch {
		text-align: center;
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
