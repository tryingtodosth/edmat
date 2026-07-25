import type { Course, Field, Topic } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapCourse, mapField, type RawCourse, type RawField } from '$lib/api/mappers';

export async function getFields(): Promise<Field[]> {
	const raw = await apiClient.get<RawField[]>('/fields/');
	return raw.map(mapField);
}

export async function getFieldById(id: string): Promise<Field | undefined> {
	try {
		const raw = await apiClient.get<RawField>(`/fields/${encodeURIComponent(id)}/`);
		return mapField(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

export async function getCoursesForField(fieldId: string): Promise<Course[]> {
	const raw = await apiClient.get<RawCourse[]>(`/fields/${encodeURIComponent(fieldId)}/courses/`);
	return raw.map(mapCourse);
}

export async function getCourseById(id: string): Promise<Course | undefined> {
	try {
		const raw = await apiClient.get<RawCourse>(`/courses/${encodeURIComponent(id)}/`);
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
	const raw = await apiClient.get<RawCourse[]>('/courses/');
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
