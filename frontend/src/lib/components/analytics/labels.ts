// Human-readable labels for the keys the analytics API sends as DATA (a content kind, a queue, a
// registry feature, a browser family …). Each map goes key -> Paraglide message function, and an
// unknown key falls back to the raw key, so a registry that grows on the backend shows its new
// entry unlabelled rather than blank or broken.
//
// HAND-MAINTAINED MIRROR (house rule 13): this file mirrors backend/analytics/live.py
// (FEATURE_REGISTRY, COMMUNITY_REGISTRY, QUEUE_REGISTRY) and backend/analytics/classify.py
// (CONTENT_DETAIL_ROUTES, BROWSER_FAMILIES, OS_FAMILIES, device families). Adding a registry entry
// there means adding its message here (and in messages/en.json + pl.json) too.

import { m } from '$lib/paraglide/messages.js';

type Labels = Record<string, () => string>;

function pick(map: Labels, key: string): string {
	const fn = map[key];
	return fn ? fn() : key;
}

const KIND: Labels = {
	exercise: m.analytics_kind_exercise, // "Exercises"
	material: m.analytics_kind_material, // "Materials"
	course: m.analytics_kind_course, // "Courses"
	event: m.analytics_kind_event, // "Events"
	concept: m.analytics_kind_concept, // "Concepts"
	contest: m.analytics_kind_contest, // "Contests"
	deck: m.analytics_kind_deck, // "Flashcard decks"
	tutoring: m.analytics_kind_tutoring, // "Tutoring listings"
	need: m.analytics_kind_need, // "Needs"
	volunteering: m.analytics_kind_volunteering, // "Volunteering offers"
	post: m.analytics_kind_post, // "Posts"
	goal: m.analytics_kind_goal, // "Goals"
	plan: m.analytics_kind_plan, // "Plans"
	organization: m.analytics_kind_organization, // "Organisations"
	material_project: m.analytics_kind_material_project, // "Material projects"
	branch: m.analytics_kind_branch, // "Branches"
	discipline: m.analytics_kind_discipline, // "Disciplines"
};

export const kindLabel = (key: string): string => pick(KIND, key);

const QUEUE: Labels = {
	exercise_submissions: m.analytics_queue_exercise_submissions, // "Exercise submissions"
	edit_suggestions: m.analytics_queue_edit_suggestions, // "Edit suggestions"
	translations: m.analytics_queue_translations, // "Translations"
	solution_entries: m.analytics_queue_solution_entries, // "Hints and solutions"
	reports: m.analytics_queue_reports, // "Reports"
	material_versions: m.analytics_queue_material_versions, // "Material versions"
	concept_revisions: m.analytics_queue_concept_revisions, // "Concept revisions"
	governor_applications: m.analytics_queue_governor_applications, // "Governor applications"
};

export const queueLabel = (key: string): string => pick(QUEUE, key);

const ACTIVITY: Labels = {
	comments: m.analytics_activity_comments, // "Comments"
	reviews: m.analytics_activity_reviews, // "Exercise reviews"
	solution_entries: m.analytics_activity_solution_entries, // "Hints and solutions"
	translations: m.analytics_activity_translations, // "Translations"
	exercise_claims: m.analytics_activity_exercise_claims, // "Exercise coverage claims"
	material_claims: m.analytics_activity_material_claims, // "Material coverage claims"
	course_claims: m.analytics_activity_course_claims, // "Course coverage claims"
	material_reviews: m.analytics_activity_material_reviews, // "Material reviews"
};

export const activityLabel = (key: string): string => pick(ACTIVITY, key);

const FEATURE: Labels = {
	exercises: m.analytics_feature_exercises, // "Exercises"
	materials: m.analytics_feature_materials, // "Materials"
	material_versions: m.analytics_feature_material_versions, // "Material versions"
	concepts: m.analytics_feature_concepts, // "Concepts"
	courses: m.analytics_feature_courses, // "Courses"
	enrollments: m.analytics_feature_enrollments, // "Course enrolments"
	events: m.analytics_feature_events, // "Events"
	event_registrations: m.analytics_feature_event_registrations, // "Event registrations"
	decks: m.analytics_feature_decks, // "Flashcard decks"
	flashcard_reviews: m.analytics_feature_flashcard_reviews, // "Flashcard reviews"
	contests: m.analytics_feature_contests, // "Contests"
	tutoring_listings: m.analytics_feature_tutoring_listings, // "Tutoring listings"
	bookings: m.analytics_feature_bookings, // "Bookings"
	study_sets: m.analytics_feature_study_sets, // "Study sets"
	posts: m.analytics_feature_posts, // "Posts"
	needs: m.analytics_feature_needs, // "Needs"
	tasks: m.analytics_feature_tasks, // "Tasks"
	plans: m.analytics_feature_plans, // "Plans"
	goals: m.analytics_feature_goals, // "Goals"
	polls: m.analytics_feature_polls, // "Polls"
	organizations: m.analytics_feature_organizations, // "Organisations"
	attachments: m.analytics_feature_attachments, // "Attachments"
};

export const featureLabel = (key: string): string => pick(FEATURE, key);

const BROWSER: Labels = {
	chrome: m.analytics_browser_chrome, // "Chrome"
	firefox: m.analytics_browser_firefox, // "Firefox"
	safari: m.analytics_browser_safari, // "Safari"
	edge: m.analytics_browser_edge, // "Edge"
	opera: m.analytics_browser_opera, // "Opera"
	samsung: m.analytics_browser_samsung, // "Samsung Internet"
	other: m.analytics_browser_other, // "Other"
	bot: m.analytics_browser_bot, // "Bots"
};

export const browserLabel = (key: string): string => pick(BROWSER, key);

const OS: Labels = {
	windows: m.analytics_os_windows, // "Windows"
	macos: m.analytics_os_macos, // "macOS"
	linux: m.analytics_os_linux, // "Linux"
	android: m.analytics_os_android, // "Android"
	ios: m.analytics_os_ios, // "iOS"
	chromeos: m.analytics_os_chromeos, // "ChromeOS"
	other: m.analytics_os_other, // "Other"
	bot: m.analytics_os_bot, // "Bots"
};

export const osLabel = (key: string): string => pick(OS, key);

const DEVICE: Labels = {
	desktop: m.analytics_device_desktop, // "Desktop"
	mobile: m.analytics_device_mobile, // "Phone"
	tablet: m.analytics_device_tablet, // "Tablet"
	bot: m.analytics_device_bot, // "Bots"
};

export const deviceLabel = (key: string): string => pick(DEVICE, key);

const STATUS: Labels = {
	'2xx': m.analytics_status_2xx, // "Successful (2xx)"
	'3xx': m.analytics_status_3xx, // "Redirects (3xx)"
	'4xx': m.analytics_status_4xx, // "Client errors (4xx)"
	'5xx': m.analytics_status_5xx, // "Server errors (5xx)"
	throttled: m.analytics_status_throttled, // "Throttled (429)"
};

export const statusLabel = (key: string): string => pick(STATUS, key);

// Mirrors backend/analytics/models.py's CLIENT_ERROR_KIND_CHOICES (house rule 13 — said there too).
const ERROR_KIND: Labels = {
	error: m.analytics_errors_kind_error, // "Uncaught error"
	rejection: m.analytics_errors_kind_rejection, // "Unhandled promise rejection"
	sveltekit: m.analytics_errors_kind_sveltekit // "Error while loading or drawing a page"
};

export const errorKindLabel = (key: string): string => pick(ERROR_KIND, key);
