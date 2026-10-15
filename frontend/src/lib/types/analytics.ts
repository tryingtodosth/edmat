// Usage analytics (backend `analytics/`, 2026-10-14) — the staff dashboard at /moderation/analytics.
//
// Every number here is an AGGREGATE computed on the server from the request log and the main
// database; nothing about a visitor is collected for it in the browser (no cookie, no storage, no
// beacon). A `PeopleCount` is a count of PEOPLE: `null` means "between 1 and 9", suppressed by the
// server (`analytics/privacy.py`, k = 10), and is drawn as "<10". Counts about content are plain
// numbers and are never null.

/** A count of people; `null` = 1–9, suppressed (k = 10). */
export type PeopleCount = number | null;

export type AnalyticsDays = 7 | 30 | 90 | 365;

export type AnalyticsPeriod = { days: AnalyticsDays; first: string; last: string };

/** `compared: false` = there is no previous value at all. Needed because on a PeopleCount a null
 *  `previous` means "suppressed (<10)", which is a different statement. */
export type Delta<T> = { value: T; previous: T | null; compared: boolean };

export type AnalyticsFreshness = {
	lastRollupAt: string | null;
	daysRolledUp: number;
	daysMissing: string[];
	excludedByObjection: number;
};

export type OverviewDay = {
	date: string;
	rolledUp: boolean;
	anon: number;
	auth: number;
	bot: number;
	errors5xx: number;
	views: number;
	activeUsers: PeopleCount;
};

export type AnalyticsOverview = {
	period: AnalyticsPeriod;
	freshness: AnalyticsFreshness;
	kpis: {
		humanRequests: Delta<number>;
		contentViews: Delta<number>;
		avgDailyActiveUsers: Delta<PeopleCount>;
		peakDailyActiveUsers: Delta<PeopleCount>;
		registrations: Delta<PeopleCount>;
		submissions: Delta<number>;
		comments: Delta<number>;
		searches: Delta<number>;
		/** A fraction (0.003 = 0.3 %); null when there was no traffic to divide by. */
		errorRate: Delta<number | null>;
		pendingInQueues: Delta<number>;
	};
	daily: OverviewDay[];
};

export type TrafficDay = {
	date: string;
	anon: number;
	auth: number;
	bot: number;
	searches: number;
	status4xx: number;
	status5xx: number;
	throttled: number;
};

export type RouteStat = {
	route: string;
	method: string;
	requests: number;
	anon: number;
	auth: number;
	bot: number;
	status4xx: number;
	status5xx: number;
	throttled: number;
	searches: number;
	/** Request-weighted mean of the daily medians. */
	p50Ms: number;
	/** Request-weighted mean of the daily 95th percentiles — a typical day's slow tail. */
	p95Ms: number;
	/** The worst single day's 95th percentile — percentiles of different days cannot be merged. */
	p95MsWorstDay: number;
};

export type AnalyticsTraffic = {
	period: AnalyticsPeriod;
	daily: TrafficDay[];
	routes: RouteStat[];
	routeCount: number;
};

export type TopExercise = {
	id: string;
	title: string;
	branch: string;
	number: number;
	views: number;
};
export type TopMaterial = { id: string; title: string; views: number };
export type LeastCoveredBranch = {
	slug: string;
	name: string;
	discipline: string;
	exercises: number;
	withSolution: number;
	solutionShare: number;
};

export type AnalyticsContent = {
	period: AnalyticsPeriod;
	byKind: { kind: string; views: number }[];
	daily: { date: string; views: number }[];
	topExercises: TopExercise[];
	topMaterials: TopMaterial[];
	leastCovered: LeastCoveredBranch[];
};

export type WeeklySeries = {
	weekly: { week: string; count: number }[];
	periodTotal: number;
	allTime: number;
};

export type AnalyticsCommunity = {
	period: AnalyticsPeriod;
	weeks: string[];
	/** Keys: comments, reviews, solution_entries, translations, exercise_claims, material_claims,
	 *  course_claims, material_reviews — whatever the backend registry holds. */
	activity: Record<string, WeeklySeries>;
	/** Keys: the backend's `FEATURE_REGISTRY` (exercises, courses, events, decks, …). */
	features: Record<string, WeeklySeries>;
	accounts: {
		weekly: { week: string; count: PeopleCount }[];
		registered: PeopleCount;
		/** A fraction; null when either side of it would be a suppressed count. */
		confirmationRate: number | null;
		guardianCreated: PeopleCount;
		totalAccounts: PeopleCount;
	};
	funnel: { registered: PeopleCount; submitted: PeopleCount; accepted: PeopleCount };
};

export type QueueStat = {
	queue: string;
	pending: number;
	submitted: number;
	decided: number;
	/** null for a queue with no notion of "accepted" (reports). */
	accepted: number | null;
	/** How `decided` was counted: decisions made IN the period (a timestamp exists), or decisions
	 *  among what was SUBMITTED in the period (no decision timestamp was ever recorded). */
	decidedBasis: 'decided_in_period' | 'submitted_in_period';
	timingRecorded: boolean;
	medianHoursToDecision: number | null;
};

export type AnalyticsModeration = { period: AnalyticsPeriod; queues: QueueStat[] };

export type CoverageBranch = {
	slug: string;
	name: string;
	exercises: number;
	withHint: number;
	withSolution: number;
	verified: number;
	translated: Record<string, number>;
};

export type AnalyticsCoverage = {
	period: AnalyticsPeriod;
	locales: string[];
	disciplines: { slug: string; name: string; branches: CoverageBranch[] }[];
};

export type CohortCell = { offset: number; users: PeopleCount; rate: number | null };

export type AnalyticsCohorts = {
	period: AnalyticsPeriod;
	maxOffset: number;
	k: number;
	cohorts: { cohortWeek: string; size: PeopleCount; cells: CohortCell[] }[];
};

export type FamilyCount = { name: string; count: PeopleCount };

export type AnalyticsClients = {
	period: AnalyticsPeriod;
	browsers: FamilyCount[];
	os: FamilyCount[];
	devices: FamilyCount[];
	humanRequests: number;
	botRequests: number;
	botShare: number | null;
	referrers: { host: string; count: number }[];
	/** Requests from hosts seen fewer than k times — counted, never named. */
	referrersOther: number;
};

export type AnalyticsHealth = {
	windowDays: number;
	statuses: Record<string, number>;
	errors: {
		route: string;
		method: string;
		count: number;
		lastSeen: string;
		requestIds: string[];
	}[];
	slowest: {
		route: string;
		method: string;
		requests: number;
		p50Ms: number;
		p95Ms: number;
		maxMs: number;
	}[];
};

export type RecomputeResult = {
	days: {
		date: string;
		rows: number;
		skippedOptOut: number;
		routes: number;
		views: number;
		activeUsers: number;
	}[];
};

/** `GET /api/analytics/client-errors/` — browser error reports (backend `analytics/client_errors.py`).
 *  Counts of errors, not of people, so nothing here is suppressed. */
export type ClientErrorFacet = { name: string; count: number };

export type ClientErrorSample = {
	receivedAt: string;
	kind: string;
	message: string;
	stack: string;
	route: string;
	build: string;
	locale: string;
	browser: string;
	os: string;
	device: string;
};

export type ClientErrorGroupRow = {
	id: string;
	kind: string;
	message: string;
	topFrame: string;
	count: number;
	firstSeen: string;
	lastSeen: string;
	daily: number[];
	routes: ClientErrorFacet[];
	builds: ClientErrorFacet[];
	browsers: ClientErrorFacet[];
	samples: ClientErrorSample[];
};

export type AnalyticsClientErrors = {
	period: AnalyticsPeriod;
	total: number;
	groups: ClientErrorGroupRow[];
	reportsKeptDays: number;
	countsKeptDays: number;
};
