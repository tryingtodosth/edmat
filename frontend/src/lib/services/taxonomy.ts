import type { Course, Field, Topic } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapCourse, mapField, type RawCourse, type RawField } from '$lib/api/mappers';
import { getLocale } from '$lib/paraglide/runtime';

// Every taxonomy request carries `?lang=`, resolved HERE from the interface locale rather than
// taken as a parameter the way `services/exercises.ts` takes one — a deliberate difference, not an
// inconsistency. CLAUDE.md Section 10 keeps interface language and content language independent
// because a reader may genuinely want the original Polish *statement* under an English UI, and the
// exercise detail page gives them a picker for exactly that. A field/course/topic NAME is not that
// kind of content: it's a navigation label (breadcrumbs, filter dropdowns, the fields index), and
// nobody wants an English interface whose breadcrumb still reads "Matematyka". So the locale isn't
// a caller's decision here, and making it one is what caused the bug this replaces: these calls
// sent no `lang` at all, the backend's `request_locale` defaulted to 'en' (config/i18n_utils.py),
// and the moment a real `en` FieldTranslation row was added in the admin, EVERY reader saw the
// English name — including Polish-interface ones. Resolving it inside these six functions makes
// that class of omission unrepresentable at the call sites, of which there are ~36.
function langQuery(): string {
	return `?lang=${encodeURIComponent(getLocale())}`;
}

export async function getFields(): Promise<Field[]> {
	const raw = await apiClient.get<RawField[]>(`/fields/${langQuery()}`);
	return raw.map(mapField);
}

export async function getFieldById(id: string): Promise<Field | undefined> {
	try {
		const raw = await apiClient.get<RawField>(`/fields/${encodeURIComponent(id)}/${langQuery()}`);
		return mapField(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

export async function getCoursesForField(fieldId: string): Promise<Course[]> {
	const raw = await apiClient.get<RawCourse[]>(
		`/fields/${encodeURIComponent(fieldId)}/courses/${langQuery()}`
	);
	return raw.map(mapCourse);
}

export async function getCourseById(id: string): Promise<Course | undefined> {
	try {
		const raw = await apiClient.get<RawCourse>(
			`/courses/${encodeURIComponent(id)}/${langQuery()}`
		);
		return mapCourse(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

// Used by the "Submit exercise" course picker — no single "list every course" endpoint distinct
// from /api/courses/ exists, and none is needed: that endpoint already returns every published
// course regardless of field.
export async function getAllCourses(): Promise<Course[]> {
	const raw = await apiClient.get<RawCourse[]>(`/courses/${langQuery()}`);
	return raw.map(mapCourse);
}

// Topics come nested in the course detail response — no separate topics endpoint exists, matching
// how course.yaml itself stores them (CLAUDE.md Section 9). Known, accepted cost: a call site that
// already has a Course object in hand (e.g. exercises/[id]/+page.svelte, which fetches the course
// once and then calls this too) re-fetches the same course detail a second time rather than reading
// `.topics` off the object it already has — a real, minor redundancy, left as-is rather than
// touching that route's own call pattern (CLAUDE.md Section 13's service-layer boundary is about
// swapping internals, not chasing every call site's own efficiency during the swap).
export async function getTopicsForCourse(courseId: string): Promise<Topic[]> {
	const course = await getCourseById(courseId);
	return course?.topics ?? [];
}
