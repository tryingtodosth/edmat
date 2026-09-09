/** Which input a content field opens with (AUDIENCE-BRIEF.md §7): the rich editor or the
 * Markdown+LaTeX source box. A leaf module; localStorage for a guest, `Profile.editor_mode` for a
 * signed-in person (synced by the auth store). */
export type EditorMode = 'rich' | 'source';
const STORAGE_KEY = 'edmat.editorMode';

function readStored(): EditorMode {
	if (typeof localStorage === 'undefined') return 'source';
	try {
		return localStorage.getItem(STORAGE_KEY) === 'rich' ? 'rich' : 'source';
	} catch {
		return 'source';
	}
}

class EditorPrefsStore {
	mode = $state<EditorMode>(readStored());
	set(mode: EditorMode) {
		this.mode = mode;
		try {
			localStorage.setItem(STORAGE_KEY, mode);
		} catch {
			/* storage blocked */
		}
	}
	syncFromProfile(mode: EditorMode | undefined) {
		if (mode) this.set(mode);
	}
}
export const editorPrefsStore = new EditorPrefsStore();
