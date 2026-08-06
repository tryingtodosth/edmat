// Discipline (dziedzina) -> Branch (dział) -> Topic (temat, BRANCH-SCOPED — topics are never a
// global vocabulary, they're validated against one branch's own list).
//
// This used to be Field (kierunek) -> Course (przedmiot) -> Topic, where a przedmiot was one
// university's one subject and carried a `university` string. That is an offering, not knowledge:
// "Analiza I" for physicists and "Analiza Matematyczna II" for mathematicians are the same branch
// taught at different depths, and the depth belongs to whoever teaches it. The backend collapsed
// them accordingly, which is also what freed the word `Course` for the classes people actually run.

export interface Discipline {
	id: string; // slug, e.g. 'matematyka'
	name: string;
	description: string;
	published: boolean;
}

export interface Topic {
	id: string; // `${branchId}:${slug}` — composed so topic ids never collide across branches
	slug: string;
	branchId: string;
	name: string;
	order: number;
}

// A finer-grained breakdown within one Topic (e.g. within "extrema," a subtopic might be
// "constrained extrema") — backs Material's own coverage claims (material.ts's MaterialCoverage),
// not exposed via its own top-level list endpoint, same "only meaningful nested inside its parent"
// treatment Topic itself gets (no standalone /api/topics/ endpoint either).
export interface Subtopic {
	id: string;
	slug: string;
	topicId: string;
	name: string;
	order: number;
}

export interface Branch {
	id: string; // slug, e.g. 'analiza-matematyczna'
	disciplineId: string;
	name: string;
	description: string;
	published: boolean;
	order: number;
	topics: Topic[];
}
