<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Course, MaterialType } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getAllCourses } from '$lib/services/taxonomy';
	import { submitMaterial } from '$lib/services/materials';
	import { authStore } from '$lib/state/auth.svelte';
	import { MATERIAL_CURRENCIES, MATERIAL_TYPES, MATERIAL_TYPE_LABELS } from '$lib/utils/labels';

	// "exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word document should be accepted
	// too, scanned and kept safe" — the actual real content-type sniffing + optional malware scan
	// both run server-side (materials/validators.py); this `accept` attribute is a real, matching
	// convenience for the file PICKER, not the security boundary itself — the backend still
	// re-checks every upload's real bytes regardless of what this hints the OS file dialog toward.
	const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.tex,.doc,.docx,.odt';

	let courses = $state<Course[]>([]);
	let courseId = $state('');
	let type = $state<MaterialType>('examCollection');
	let title = $state('');
	let description = $state('');
	let locale = $state('pl');
	let file = $state<File | null>(null);
	let submitting = $state(false);
	let success = $state(false);
	let errorMessage = $state('');

	// All three genuinely optional, matching the real Material fields they'll eventually become
	// (materials/models.py) — a submission that leaves them all unset behaves exactly as before this
	// feature existed. `requirementDraft` is the plain-text add-one-at-a-time input; `requirements`
	// is the accumulated list actually submitted.
	//
	// `priceAmount`/`estimatedMinutes` are deliberately `type="text" inputmode="decimal"/"numeric"`,
	// NOT `type="number"` — a real, live-reproduced bug found during this feature's own end-to-end
	// verification, the exact same class Section 17M's own node-governor grant form already hit:
	// Svelte 5's `bind:value` on a real `<input type="number">` binds a genuine JS `number` (or
	// `undefined`), not the `string` `handleSubmit`'s own `.trim()` calls below assume — the first
	// live submit attempt threw a real `$.get(...).trim is not a function` in the browser console,
	// caught only because this was actually driven through a headless browser, not just
	// `svelte-check`'d. Kept as `string` state end to end, matching every other text field on this
	// same form, exactly the fix that section already established for the identical mismatch.
	let requirements = $state<string[]>([]);
	let requirementDraft = $state('');
	let priceAmount = $state('');
	let priceCurrency = $state('PLN');
	let estimatedMinutes = $state('');

	function addRequirement() {
		const trimmed = requirementDraft.trim();
		if (!trimmed) return;
		requirements = [...requirements, trimmed];
		requirementDraft = '';
	}

	function removeRequirement(index: number) {
		requirements = requirements.filter((_, i) => i !== index);
	}

	async function init() {
		courses = await getAllCourses();
		if (courses.length) courseId = courses[0].id;
	}
	init();

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	let canSubmit = $derived(Boolean(courseId && title.trim() && file));

	async function handleSubmit() {
		if (!authStore.user || !canSubmit || !file) return;
		errorMessage = '';
		submitting = true;
		try {
			await submitMaterial(
				{
					courseId,
					type,
					title: title.trim(),
					description: description.trim(),
					locale,
					requirements: requirements.length > 0 ? requirements : undefined,
					priceAmount: priceAmount.trim() ? Number(priceAmount) : undefined,
					priceCurrency: priceAmount.trim() ? priceCurrency.trim() || 'PLN' : undefined,
					estimatedMinutes: estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined
				},
				file
			);
			success = true;
			title = description = '';
			file = null;
			requirements = [];
			requirementDraft = '';
			priceAmount = '';
			estimatedMinutes = '';
			const input = document.getElementById('material-file-input') as HTMLInputElement | null;
			if (input) input.value = '';
		} catch {
			// A rejected content-type/oversized-file/failed-scan upload all come back as a real 400
			// from the backend (materials/validators.py's own validator, or MaterialSubmissionViewSet
			// .perform_create's scan check) — one honest, generic message covers every case, matching
			// this app's own established convention for the material-submission upload form
			// (materials/views.py's own doc comment).
			errorMessage = m.submitMaterial_uploadFailed();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.submitMaterial_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.submitMaterial_heading()}</h1>
	<p class="subtitle">{m.submitMaterial_subtitle()}</p>

	{#if !authStore.isAuthenticated}
		<p class="login-prompt"><a href={resolve('/login')}>{m.submitMaterial_loginRequired()}</a></p>
	{:else}
		{#if success}
			<p class="notice">{m.submitMaterial_success()}</p>
		{/if}
		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}

		<form class="submit-form" onsubmit={(e) => (e.preventDefault(), handleSubmit())}>
			<label class="field">
				<span>{m.submitMaterial_field_course()}</span>
				<select bind:value={courseId}>
					{#each courses as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.submitMaterial_field_title()}</span>
				<input type="text" bind:value={title} required />
			</label>

			<div class="field-row">
				<label class="field">
					<span>{m.submitMaterial_field_type()}</span>
					<select bind:value={type}>
						{#each MATERIAL_TYPES as t (t)}
							<option value={t}>{MATERIAL_TYPE_LABELS[t]()}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>{m.submitMaterial_field_language()}</span>
					<select bind:value={locale}>
						<option value="pl">PL</option>
						<option value="en">EN</option>
					</select>
				</label>
			</div>

			<label class="field">
				<span>{m.submitMaterial_field_description()} <em>({m.common_optional()})</em></span>
				<textarea rows="3" bind:value={description}></textarea>
			</label>

			<label class="field">
				<span>{m.submitMaterial_field_file()}</span>
				<input
					id="material-file-input"
					type="file"
					accept={ACCEPTED_EXTENSIONS}
					onchange={handleFileChange}
					required
				/>
				<span class="file-hint">{m.submitMaterial_fileHint()}</span>
				{#if file}
					<span class="file-picked">{file.name}</span>
				{/if}
			</label>

			<div class="field">
				<span>{m.submitMaterial_field_requirements()} <em>({m.common_optional()})</em></span>
				{#if requirements.length > 0}
					<ul class="requirements-list">
						{#each requirements as requirement, index (index)}
							<li>
								<span>{requirement}</span>
								<button type="button" onclick={() => removeRequirement(index)}>&times;</button>
							</li>
						{/each}
					</ul>
				{/if}
				<input
					type="text"
					placeholder={m.submitMaterial_requirementsAddPlaceholder()}
					bind:value={requirementDraft}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addRequirement();
						}
					}}
				/>
				<span class="file-hint">{m.submitMaterial_requirementsHint()}</span>
			</div>

			<div class="field-row">
				<label class="field">
					<span>{m.submitMaterial_field_price()} <em>({m.common_optional()})</em></span>
					<div class="price-inputs">
						<input
							type="text"
							inputmode="decimal"
							placeholder={m.submitMaterial_priceAmountPlaceholder()}
							bind:value={priceAmount}
						/>
						<select
							class="currency-input"
							aria-label={m.submitMaterial_field_priceCurrency()}
							bind:value={priceCurrency}
						>
							{#each MATERIAL_CURRENCIES as currency (currency)}
								<option value={currency}>{currency}</option>
							{/each}
						</select>
					</div>
				</label>
				<label class="field">
					<span>{m.submitMaterial_field_estimatedMinutes()} <em>({m.common_optional()})</em></span>
					<input
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						placeholder={m.submitMaterial_estimatedMinutesPlaceholder()}
						bind:value={estimatedMinutes}
					/>
				</label>
			</div>

			<button type="submit" class="submit" disabled={!canSubmit || submitting}>
				{m.common_submit()}
			</button>
		</form>
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.submit-form {
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
		em {
			color: var(--text-secondary);
			font-weight: 400;
		}
	}
	.field-row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
	}
	input,
	select,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.file-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 400;
	}
	.file-picked {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
	.requirements-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		li {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-2);
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			font-weight: 400;
			font-size: var(--font-size-sm);
			button {
				background: none;
				border: none;
				color: var(--text-secondary);
				cursor: pointer;
				font-size: var(--font-size-base);
				line-height: 1;
				&:hover {
					color: var(--status-danger);
				}
			}
		}
	}
	.price-inputs {
		display: flex;
		gap: var(--space-2);
		input {
			flex: 1;
		}
		.currency-input {
			flex: 0 0 4.5em;
			text-transform: uppercase;
		}
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
