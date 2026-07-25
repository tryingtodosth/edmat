// Field (kierunek) -> Course (przedmiot) -> Topic (dział, COURSE-SCOPED — see CLAUDE.md Section 9,
// topics are never a global vocabulary, they're validated against one course's own list). Mirrors
// the real content/fields/*.yaml + course.yaml shape in Database-of-Student-Exercise exactly.

export interface Field {
	id: string; // slug, e.g. 'matematyka'
	name: string;
	description: string;
	published: boolean;
}

export interface Topic {
	id: string; // `${courseId}:${slug}` — composed so topic ids never collide across courses
	slug: string;
	courseId: string;
	name: string;
	order: number;
}

export interface Course {
	id: string; // slug, e.g. 'uw-matematyka-am2'
	fieldId: string;
	name: string;
	description: string;
	university: string;
	published: boolean;
	order: number;
	topics: Topic[];
}
