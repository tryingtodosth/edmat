<script lang="ts">
	/** A guardian's children (AUDIENCE-BRIEF.md §2): make an account (username + password, no
	 * email), read what the child wrote — held items marked — remove an item, delete the account. */
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import type { Child, ChildContent } from '$lib/services/children';
	import {
		createChild,
		deleteChild,
		getChildContent,
		getChildren,
		removeChildItem
	} from '$lib/services/children';
	import { authStore } from '$lib/state/auth.svelte';
	import { ApiError } from '$lib/api/client';
	import { formatDateTime } from '$lib/utils/datetime';

	let children = $state<Child[]>([]);
	let username = $state('');
	let displayName = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state('');
	let open = $state<string | null>(null);
	let content = $state<Record<string, ChildContent>>({});

	onMount(async () => {
		children = await getChildren();
	});
	async function add(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			children = [...children, await createChild(username.trim(), password, displayName.trim())];
			username = '';
			displayName = '';
			password = '';
			await authStore.init();
		} catch (err) {
			error =
				err instanceof ApiError
					? Object.values((err.body as Record<string, unknown>) ?? {})
							.flat()
							.join(' ') || m.common_error()
					: m.common_error();
		} finally {
			busy = false;
		}
	}
	async function remove(c: Child) {
		if (!confirm(m.guardian_deleteConfirm({ name: c.displayName }))) return;
		await deleteChild(c.id);
		children = children.filter((x) => x.id !== c.id);
		await authStore.init();
	}
	async function toggle(c: Child) {
		if (open === c.id) {
			open = null;
			return;
		}
		open = c.id;
		if (!content[c.id]) content = { ...content, [c.id]: await getChildContent(c.id) };
	}
	async function removeItem(c: Child, kind: 'comment' | 'post', id: string) {
		await removeChildItem(c.id, kind, id);
		content = { ...content, [c.id]: await getChildContent(c.id) };
	}
</script>

<section class="guardian">
	<h2>{m.guardian_heading()}</h2>
	<p class="hint">{m.guardian_hint()}</p>
	{#if children.length > 0}
		<ul class="children">
			{#each children as c (c.id)}
				<li>
					<div class="row">
						<strong>{c.displayName}</strong> <span class="user">@{c.username}</span>
						<button type="button" onclick={() => toggle(c)} aria-expanded={open === c.id}
							>{m.guardian_whatTheyWrote()}</button
						>
						<button type="button" class="danger" onclick={() => remove(c)}
							>{m.guardian_deleteAccount()}</button
						>
					</div>
					{#if open === c.id}
						{@const cc = content[c.id]}
						{#if !cc}
							<p class="hint">{m.common_loading()}</p>
						{:else if cc.comments.length === 0 && cc.posts.length === 0}
							<p class="hint">{m.guardian_nothingYet()}</p>
						{:else}
							<ul class="items">
								{#each cc.comments as it (it.id)}
									<li>
										<span class="kind">{m.guardian_comment()}</span>
										{it.body} <span class="when">{formatDateTime(it.createdAt)}</span>{#if it.held}
											<span class="held">{m.guardian_held()}</span>{/if}
										<button
											type="button"
											class="link danger"
											onclick={() => removeItem(c, 'comment', it.id)}>{m.common_remove()}</button
										>
									</li>
								{/each}
								{#each cc.posts as it (it.id)}
									<li>
										<span class="kind">{m.guardian_post()}</span>
										{it.body} <span class="when">{formatDateTime(it.createdAt)}</span>{#if it.held}
											<span class="held">{m.guardian_held()}</span>{/if}
										<button
											type="button"
											class="link danger"
											onclick={() => removeItem(c, 'post', it.id)}>{m.common_remove()}</button
										>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<form class="add" onsubmit={add}>
		<h3>{m.guardian_addChild()}</h3>
		<div class="fields">
			<label
				><span>{m.guardian_childName()}</span><input
					type="text"
					bind:value={displayName}
					maxlength="100"
				/></label
			>
			<label
				><span>{m.guardian_childUsername()}</span><input
					type="text"
					bind:value={username}
					required
					autocomplete="off"
				/></label
			>
			<label
				><span>{m.guardian_childPassword()}</span><input
					type="password"
					bind:value={password}
					required
					minlength="8"
					autocomplete="new-password"
				/></label
			>
		</div>
		<p class="hint">{m.guardian_consent()}</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button type="submit" class="primary" disabled={busy}>{m.guardian_create()}</button>
	</form>
</section>

<style lang="scss">
	.guardian {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem;
		margin-top: 1rem;
	}
	h2,
	h3 {
		margin: 0 0 0.3rem;
	}
	.hint,
	.when,
	.user,
	.kind {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
	.children,
	.items {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
		display: grid;
		gap: 0.5rem;
	}
	.items li {
		padding: 0.3rem 0.5rem;
		background: var(--bg-surface-alt);
		border-radius: 6px;
		font-size: 0.9rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.held {
		font-size: 0.75rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--status-warning-bg);
		color: var(--status-warning);
	}
	button {
		min-height: 36px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
		min-height: 44px;
	}
	.danger {
		color: var(--status-danger);
	}
	.link {
		border: 0;
		background: none;
		min-height: 0;
		padding: 0;
	}
	.add {
		margin-top: 0.8rem;
		display: grid;
		gap: 0.5rem;
	}
	.fields {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.fields label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
		flex: 1 1 10rem;
	}
	input {
		font: inherit;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
</style>
