// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		/** Shallow-routing state (`pushState` from `$app/navigation`). A board opens a task in a
		 *  modal while pushing `/tasks/<id>` as the URL, and a plan opens a step the same way with
		 *  `?step=<id>` — so a refresh lands on the full page, and the modal's close is a `back()`.
		 *  The state is what tells the still-mounted page "you are showing this in a modal"; it is
		 *  gone after a reload, which is exactly when the real route should render instead. */
		interface PageState {
			/** The task shown in a modal over a board (`TasksPanel`). */
			taskModal?: string;
			/** The plan step shown in a modal over its plan (`/plans/[id]`). */
			stepModal?: string;
		}
		// interface Platform {}
	}
}

export {};
