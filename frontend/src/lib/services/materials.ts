import type { Material } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapMaterial, type RawMaterial } from '$lib/api/mappers';

export async function getMaterialsForCourse(courseId: string): Promise<Material[]> {
	const raw = await apiClient.get<RawMaterial[]>(
		`/courses/${encodeURIComponent(courseId)}/materials/`
	);
	return raw.map(mapMaterial);
}

export async function getMaterialById(id: string): Promise<Material | undefined> {
	try {
		const raw = await apiClient.get<RawMaterial>(`/materials/${encodeURIComponent(id)}/`);
		return mapMaterial(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}
