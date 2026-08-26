// The "Report issue" modal is one component mounted once in the root layout and opened from three
// places (under the logo, the account menu, the footer). A rune module is what lets those three
// share one dialog rather than each mounting its own copy of the form.
//
// `open()` captures where the person is at the moment they ask — the path and the page title —
// because that is the context the report is about, and by the time the dialog renders they have
// not moved. The rest of the context (locale, viewport, browser) is read by the modal itself.

let isOpen = $state(false);
let path = $state('');
let pageTitle = $state('');

export const issueReportStore = {
	get isOpen(): boolean {
		return isOpen;
	},
	get path(): string {
		return path;
	},
	get pageTitle(): string {
		return pageTitle;
	},
	open(): void {
		if (typeof window !== 'undefined') {
			path = window.location.pathname + window.location.search;
			pageTitle = document.title;
		}
		isOpen = true;
	},
	close(): void {
		isOpen = false;
	}
};
