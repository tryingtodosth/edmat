// A tag's own follow state for the CURRENT user — the tag-hover action menu's source of truth
// (TagChip.svelte). `notify` is a separate, mutable control from `following` itself: you can follow
// a tag and later mute just the notifications for it without unfollowing — see the backend's own
// exercises.TagFollow model doc comment for the full reasoning.
export interface TagFollowState {
	tag: string; // the tag's own slug — the id every tag reference throughout this app already uses
	notify: boolean;
}

// The two content kinds a tag can currently be attached to — the tag-hover menu's "add to different
// content" action (TagChip.svelte's own picker modal).
export type TaggableKind = 'exercise' | 'material';
