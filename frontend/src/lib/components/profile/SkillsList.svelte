<script lang="ts">
	// What somebody claims to be good at, and — the interesting part — what backs each claim.
	//
	// Only a registry-backed row gets the strong treatment. A badge on something nobody checked would
	// be exactly as convincing to a reader whether or not it were true, which is the whole reason
	// `evidence` exists as a field rather than being implied.
	import { m } from '$lib/paraglide/messages.js';
	import type { SkillEntry } from '$lib/types/profileExtras';

	let { skills }: { skills: SkillEntry[] } = $props();

	const LEVEL_LABEL: Record<string, () => string> = {
		learning: () => m.profile_skill_learning(), // "Learning it"
		comfortable: () => m.profile_skill_comfortable(), // "Comfortable"
		teaching: () => m.profile_skill_teaching() // "Could teach it"
	};
	const EVIDENCE_LABEL: Record<string, () => string> = {
		self_declared: () => m.profile_skill_selfDeclared(), // "self-declared"
		coursework: () => m.profile_skill_coursework(), // "coursework here"
		registry: () => m.profile_skill_registry() // "confirmed by the registry"
	};
</script>

{#if skills.length === 0}
	<p class="empty">{m.profile_skillsEmpty()}</p>
	<!-- "Nothing added yet." -->
{:else}
	<ul class="skills">
		{#each skills as skill (skill.id)}
			<li class="skill">
				<span class="skill__label">{skill.label}</span>
				<span class="skill__level">{LEVEL_LABEL[skill.level]?.() ?? skill.level}</span>
				<span class="skill__evidence" class:skill__evidence--strong={skill.evidence === 'registry'}>
					{EVIDENCE_LABEL[skill.evidence]?.() ?? skill.evidence}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.skills {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.skill {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		// Wraps rather than squeezing three pieces onto one phone-width line, where the evidence label
		// is the longest of them and the one that must stay readable.
		flex-wrap: wrap;
	}
	.skill__label {
		font-weight: 600;
	}
	.skill__level {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.skill__evidence {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
		margin-left: auto;
	}
	.skill__evidence--strong {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
