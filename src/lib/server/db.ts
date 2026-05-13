import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { sql, eq, and, ne, desc, asc, like, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { env } from '$env/dynamic/private';
import { EXAM_MODES } from '$lib/types.js';
import * as schema from './schema.js';
import {
	users,
	scores,
	testSessions,
	testSessionParticipants,
	testSessionResults,
	testSessionResultAnswers,
	categories,
	questions,
	answerOptions
} from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = env.DATABASE_PATH || join(__dirname, '../../../data/tac1.db');

const dataDir = dirname(dbPath);
if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

const migrationsFolder = process.env.MIGRATIONS_PATH ?? join(process.cwd(), 'drizzle');
try {
	migrate(db, { migrationsFolder });
} catch (e) {
	throw new Error(
		`Drizzle migration failed (folder: ${migrationsFolder}). ` +
			`Ensure the 'drizzle/' folder is present relative to your server's working directory, ` +
			`or set the MIGRATIONS_PATH env var to its absolute path.\nCause: ${e}`
	);
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface DbUser {
	id: string;
	email: string;
	name: string;
	image: string | null;
	role: 'admin' | 'user';
	created_at?: string;
}

export interface DbScore {
	id: number;
	user_id: string;
	exam_mode: 'organisationnel' | 'tresorerie';
	score: number;
	total_questions: number;
	correct_answers: number;
	time_spent: number;
	category_scores: string;
	created_at: string;
}

export type TestSessionStatus = 'waiting' | 'started' | 'completed' | 'cancelled';

export interface DbTestSession {
	id: number;
	pin: string;
	created_by: string;
	exam_mode: 'organisationnel' | 'tresorerie' | 'custom';
	custom_categories: string | null;
	status: TestSessionStatus;
	question_count: number;
	time_limit_seconds: number;
	quiz_payload: string;
	created_at: string;
	started_at: string | null;
	ended_at: string | null;
}

export interface DbTestSessionParticipant {
	id: number;
	session_id: number;
	user_id: string;
	joined_at: string;
	current_question_index: number;
	progress_updated_at: string | null;
}

export interface DbTestSessionResult {
	id: number;
	session_id: number;
	user_id: string;
	score: number;
	total_questions: number;
	correct_answers: number;
	time_spent: number;
	category_scores: string | null;
	submitted_at: string;
}

export interface DbCategory {
	id: number;
	name: string;
	slug: string;
	description: string | null;
	created_at: string;
}

export interface DbQuestion {
	id: number;
	category_id: number;
	question_text: string;
	success_count: number;
	failure_count: number;
	created_at: string;
	updated_at: string;
}

export interface DbAnswerOption {
	id: number;
	question_id: number;
	text: string;
	is_correct: number;
	rationale: string | null;
	position: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSqliteTimestamp(date: Date): string {
	return date.toISOString().slice(0, 19).replace('T', ' ');
}

const SQLITE_TIMESTAMP_NO_TZ_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function normalizeTimestamp(value: string | null): string | null {
	if (!value) return null;
	if (SQLITE_TIMESTAMP_NO_TZ_REGEX.test(value)) {
		return `${value.replace(' ', 'T')}Z`;
	}
	return value;
}

function getLeaderboardWeekWindow(now = new Date()): { weekStartAt: Date; nextResetAt: Date } {
	const weekStartAt = new Date(now);
	weekStartAt.setHours(0, 0, 0, 0);
	const daysSinceMonday = (weekStartAt.getDay() + 6) % 7;
	weekStartAt.setDate(weekStartAt.getDate() - daysSinceMonday);
	const nextResetAt = new Date(weekStartAt);
	nextResetAt.setDate(nextResetAt.getDate() + 7);
	return { weekStartAt, nextResetAt };
}

export function getLeaderboardResetInfo(now = new Date()): {
	weekStartAt: string;
	nextResetAt: string;
} {
	const { weekStartAt, nextResetAt } = getLeaderboardWeekWindow(now);
	return {
		weekStartAt: weekStartAt.toISOString(),
		nextResetAt: nextResetAt.toISOString()
	};
}

function shuffleArray<T>(items: T[]): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function generateSessionPin(): string {
	return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateUniqueSessionPin(): string {
	for (let i = 0; i < 50; i++) {
		const pin = generateSessionPin();
		const exists = db.select({ pin: testSessions.pin }).from(testSessions).where(eq(testSessions.pin, pin)).get();
		if (!exists) return pin;
	}
	throw new Error('Unable to generate unique PIN');
}

// ─── User functions ───────────────────────────────────────────────────────────

export function isAdmin(email?: string | null): boolean {
	if (!email) return false;
	const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
	if (adminEmails.includes(email.toLowerCase())) return true;
	const user = db
		.select({ role: users.role })
		.from(users)
		.where(eq(users.email, email.toLowerCase()))
		.get();
	return user?.role === 'admin';
}

export function getUserById(id: string): DbUser | undefined {
	return db.select().from(users).where(eq(users.id, id)).get() as DbUser | undefined;
}

export function getOrCreateUser(user: Omit<DbUser, 'created_at' | 'role'>): DbUser {
	const existing = db.select().from(users).where(eq(users.email, user.email)).get() as
		| DbUser
		| undefined;
	if (existing) {
		if (existing.id !== user.id) {
			sqlite.pragma('foreign_keys = OFF');
			try {
				db.update(scores).set({ user_id: user.id }).where(eq(scores.user_id, existing.id)).run();
				db.update(users)
					.set({ id: user.id, name: user.name, image: user.image })
					.where(eq(users.email, user.email))
					.run();
			} finally {
				sqlite.pragma('foreign_keys = ON');
			}
		} else {
			db.update(users)
				.set({ name: user.name, image: user.image })
				.where(eq(users.email, user.email))
				.run();
		}
		return { ...existing, id: user.id, name: user.name, image: user.image };
	}

	const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
	const role = adminEmails.includes(user.email.toLowerCase()) ? 'admin' : 'user';

	db.insert(users)
		.values({ id: user.id, email: user.email, name: user.name, image: user.image, role })
		.run();

	return { ...user, role: role as 'admin' | 'user' };
}

export function getAllUsers(): (DbUser & { isHardcodedAdmin: boolean })[] {
	const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
	const rows = db.select().from(users).orderBy(desc(users.created_at)).all() as DbUser[];
	return rows.map((u) => ({
		...u,
		role: (u.role || 'user') as 'admin' | 'user',
		isHardcodedAdmin: adminEmails.includes(u.email.toLowerCase())
	}));
}

export function updateUserRole(userId: string, role: string): boolean {
	const result = db.update(users).set({ role }).where(eq(users.id, userId)).run();
	return result.changes > 0;
}

export function deleteUser(userId: string): boolean {
	return db.transaction((tx) => {
		// Delete child records first — foreign_keys = ON requires this order
		tx.delete(testSessionResultAnswers).where(eq(testSessionResultAnswers.user_id, userId)).run();
		tx.delete(testSessionResults).where(eq(testSessionResults.user_id, userId)).run();
		tx.delete(testSessionParticipants).where(eq(testSessionParticipants.user_id, userId)).run();
		tx.delete(testSessions).where(eq(testSessions.created_by, userId)).run();
		tx.delete(scores).where(eq(scores.user_id, userId)).run();
		const result = tx.delete(users).where(eq(users.id, userId)).run();
		return result.changes > 0;
	});
}

// ─── Score functions ──────────────────────────────────────────────────────────

export function saveScore(score: Omit<DbScore, 'id' | 'created_at'>): DbScore {
	const result = db
		.insert(scores)
		.values({
			user_id: score.user_id,
			exam_mode: score.exam_mode,
			score: score.score,
			total_questions: score.total_questions,
			correct_answers: score.correct_answers,
			time_spent: score.time_spent,
			category_scores: score.category_scores
		})
		.run();
	return {
		...score,
		id: result.lastInsertRowid as number,
		created_at: new Date().toISOString()
	};
}

export function getUserScores(userId: string, examMode?: string): DbScore[] {
	if (examMode) {
		return db
			.select()
			.from(scores)
			.where(and(eq(scores.user_id, userId), eq(scores.exam_mode, examMode)))
			.orderBy(desc(scores.created_at))
			.all() as DbScore[];
	}
	return db
		.select()
		.from(scores)
		.where(eq(scores.user_id, userId))
		.orderBy(desc(scores.created_at))
		.all() as DbScore[];
}

export interface LeaderboardEntry {
	id: number;
	user_id: string;
	user_name: string;
	user_image: string | null;
	score: number;
	total_questions: number;
	correct_answers: number;
	time_spent: number;
	attempt_count: number;
	created_at: string;
}

export function getLeaderboard(
	examMode: 'organisationnel' | 'tresorerie',
	limit = 20
): LeaderboardEntry[] {
	const { weekStartAt } = getLeaderboardWeekWindow();
	const weekStartSql = formatSqliteTimestamp(weekStartAt);

	return db.all<LeaderboardEntry>(sql`
		SELECT
			s.id, s.user_id, u.name as user_name, u.image as user_image,
			s.score, s.total_questions, s.correct_answers, s.time_spent, s.created_at,
			(
				SELECT COUNT(*)
				FROM scores s3
				WHERE s3.user_id = s.user_id
					AND s3.exam_mode = s.exam_mode
					AND s3.created_at >= ${weekStartSql}
			) as attempt_count
		FROM scores s
		JOIN users u ON s.user_id = u.id
		WHERE s.exam_mode = ${examMode}
		AND s.created_at >= ${weekStartSql}
		AND s.id = (
			SELECT s2.id FROM scores s2
			WHERE s2.user_id = s.user_id
				AND s2.exam_mode = s.exam_mode
				AND s2.created_at >= ${weekStartSql}
			ORDER BY s2.score DESC, s2.time_spent ASC, s2.created_at ASC
			LIMIT 1
		)
		ORDER BY s.score DESC, s.time_spent ASC, s.created_at ASC
		LIMIT ${limit}
	`);
}

export interface UserStats {
	totalAttempts: number;
	bestScoreOrga: number | null;
	bestScoreTreso: number | null;
	avgScore: number;
	categoryStats: Record<string, { correct: number; total: number; percentage: number }>;
	progression: {
		organisationnel: { date: string; score: number }[];
		tresorerie: { date: string; score: number }[];
	};
	recentAttempts: DbScore[];
}

export function getUserStats(userId: string): UserStats {
	const allScores = db
		.select()
		.from(scores)
		.where(eq(scores.user_id, userId))
		.orderBy(asc(scores.created_at))
		.all() as DbScore[];

	const totalAttempts = allScores.length;
	const orgaScores = allScores.filter((s) => s.exam_mode === 'organisationnel');
	const tresoScores = allScores.filter((s) => s.exam_mode === 'tresorerie');

	const bestScoreOrga = orgaScores.length > 0 ? Math.max(...orgaScores.map((s) => s.score)) : null;
	const bestScoreTreso =
		tresoScores.length > 0 ? Math.max(...tresoScores.map((s) => s.score)) : null;
	const avgScore =
		totalAttempts > 0
			? Math.round(allScores.reduce((sum, s) => sum + s.score, 0) / totalAttempts)
			: 0;

	const categoryStats: Record<string, { correct: number; total: number; percentage: number }> = {};
	for (const score of allScores) {
		if (score.category_scores) {
			try {
				const cats = JSON.parse(score.category_scores) as Record<
					string,
					{ correct: number; total: number }
				>;
				for (const [cat, data] of Object.entries(cats)) {
					if (!categoryStats[cat]) {
						categoryStats[cat] = { correct: 0, total: 0, percentage: 0 };
					}
					categoryStats[cat].correct += data.correct;
					categoryStats[cat].total += data.total;
				}
			} catch {
				// ignore malformed JSON
			}
		}
	}

	for (const cat of Object.keys(categoryStats)) {
		const { correct, total } = categoryStats[cat];
		categoryStats[cat].percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
	}

	const progression = {
		organisationnel: orgaScores.map((s) => ({ date: s.created_at, score: s.score })),
		tresorerie: tresoScores.map((s) => ({ date: s.created_at, score: s.score }))
	};

	return {
		totalAttempts,
		bestScoreOrga,
		bestScoreTreso,
		avgScore,
		categoryStats,
		progression,
		recentAttempts: allScores.slice(-10).reverse()
	};
}

// ─── Session participant helpers ──────────────────────────────────────────────

export interface TestSessionParticipantView {
	userId: string;
	userName: string;
	userImage: string | null;
	joinedAt: string;
	currentQuestionIndex: number;
	progressUpdatedAt: string | null;
	hasSubmitted: boolean;
	submittedAt: string | null;
	score?: number;
	correctAnswers?: number;
	totalQuestions?: number;
	timeSpent?: number;
}

export interface TestSessionQuestionStat {
	question: string;
	successRate: number;
	count: number;
}

export interface TestSessionCategoryStat {
	name: string;
	successRate: number;
	totalAnswers: number;
}

export interface TestSessionResultView {
	score: number;
	correctAnswers: number;
	totalQuestions: number;
	timeSpent: number;
	submittedAt: string;
}

export interface TestSessionView {
	id: number;
	pin: string;
	examMode: 'organisationnel' | 'tresorerie' | 'custom';
	customCategories: string[] | null;
	status: TestSessionStatus;
	questionCount: number;
	timeLimitSeconds: number;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
	createdByUserId: string;
	createdByName: string;
	isCreator: boolean;
	participants: TestSessionParticipantView[];
	myResult: TestSessionResultView | null;
	quizPayload?: QuestionWithAnswers[];
	categoryPerformance?: TestSessionCategoryStat[];
	topQuestions?: TestSessionQuestionStat[];
	flopQuestions?: TestSessionQuestionStat[];
}

export interface TestSessionHistoryItem {
	id: number;
	pin: string;
	examMode: 'organisationnel' | 'tresorerie' | 'custom';
	customCategories: string[] | null;
	status: TestSessionStatus;
	questionCount: number;
	timeLimitSeconds: number;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
	createdByName: string;
	participantCount: number;
	submittedCount: number;
	avgScore: number | null;
	bestScore: number | null;
	worstScore: number | null;
}

function getSessionParticipants(
	sessionId: number,
	includeScores: boolean
): TestSessionParticipantView[] {
	const rows = db.all<{
		user_id: string;
		user_name: string;
		user_image: string | null;
		joined_at: string;
		current_question_index: number | null;
		progress_updated_at: string | null;
		submitted_at: string | null;
		score: number | null;
		correct_answers: number | null;
		total_questions: number | null;
		time_spent: number | null;
	}>(sql`
		SELECT
			p.user_id,
			u.name as user_name,
			u.image as user_image,
			p.joined_at,
			p.current_question_index,
			p.progress_updated_at,
			r.submitted_at,
			r.score,
			r.correct_answers,
			r.total_questions,
			r.time_spent
		FROM test_session_participants p
		JOIN test_sessions s ON s.id = p.session_id
		JOIN users u ON u.id = p.user_id
		LEFT JOIN test_session_results r ON r.session_id = p.session_id AND r.user_id = p.user_id
		WHERE p.session_id = ${sessionId} AND p.user_id != s.created_by
		ORDER BY p.joined_at ASC
	`);

	return rows.map((row) => ({
		userId: row.user_id,
		userName: row.user_name,
		userImage: row.user_image,
		joinedAt: normalizeTimestamp(row.joined_at) ?? row.joined_at,
		currentQuestionIndex: Math.max(0, row.current_question_index ?? 0),
		progressUpdatedAt: normalizeTimestamp(row.progress_updated_at),
		hasSubmitted: Boolean(row.submitted_at),
		submittedAt: normalizeTimestamp(row.submitted_at),
		...(includeScores && row.submitted_at
			? {
					score: row.score ?? undefined,
					correctAnswers: row.correct_answers ?? undefined,
					totalQuestions: row.total_questions ?? undefined,
					timeSpent: row.time_spent ?? undefined
				}
			: {})
	}));
}

function getSessionAnalytics(sessionId: number): {
	categoryPerformance: TestSessionCategoryStat[];
	topQuestions: TestSessionQuestionStat[];
	flopQuestions: TestSessionQuestionStat[];
} {
	const categoryRows = db.all<{ name: string; success_count: number; total_count: number }>(sql`
		SELECT
			c.name as name,
			SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as success_count,
			COUNT(*) as total_count
		FROM test_session_result_answers a
		JOIN test_sessions s ON s.id = a.session_id
		JOIN questions q ON q.id = a.question_id
		JOIN categories c ON c.id = q.category_id
		WHERE a.session_id = ${sessionId} AND a.user_id != s.created_by
		GROUP BY c.id
	`);

	const categoryPerformance = categoryRows
		.map((row) => ({
			name: row.name,
			successRate:
				row.total_count > 0 ? Math.round((row.success_count / row.total_count) * 100) : 0,
			totalAnswers: row.total_count
		}))
		.sort((a, b) => b.successRate - a.successRate || b.totalAnswers - a.totalAnswers);

	const questionRows = db.all<{
		question: string;
		success_count: number;
		total_count: number;
	}>(sql`
		SELECT
			q.question_text as question,
			SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as success_count,
			COUNT(*) as total_count
		FROM test_session_result_answers a
		JOIN test_sessions s ON s.id = a.session_id
		JOIN questions q ON q.id = a.question_id
		WHERE a.session_id = ${sessionId} AND a.user_id != s.created_by
		GROUP BY q.id
		HAVING COUNT(*) >= 1
	`);

	const processed = questionRows.map((row) => ({
		question: row.question,
		successRate: row.total_count > 0 ? Math.round((row.success_count / row.total_count) * 100) : 0,
		count: row.total_count
	}));

	return {
		categoryPerformance,
		topQuestions: [...processed]
			.sort((a, b) => b.successRate - a.successRate || b.count - a.count)
			.slice(0, 5),
		flopQuestions: [...processed]
			.sort((a, b) => a.successRate - b.successRate || b.count - a.count)
			.slice(0, 5)
	};
}

// ─── Test session I/O ─────────────────────────────────────────────────────────

export interface CreateTestSessionInput {
	createdByUserId: string;
	examMode: 'organisationnel' | 'tresorerie' | 'custom';
	customCategories?: string[];
	customQuestionCount?: number;
	customTimeLimitMinutes?: number;
}

export interface SubmitTestSessionResultInput {
	pin: string;
	userId: string;
	score: number;
	totalQuestions: number;
	correctAnswers: number;
	timeSpent: number;
	categoryScores: Record<string, { correct: number; total: number }>;
	questionResults: { questionId: string; isCorrect: boolean }[];
}

function buildTestSessionQuizPayload(
	examMode: 'organisationnel' | 'tresorerie' | 'custom',
	customCategories?: string[],
	customQuestionCount?: number
): QuestionWithAnswers[] {
	let cats: string[];
	let questionCount: number;

	if (examMode === 'custom') {
		cats = customCategories ?? [];
		questionCount = customQuestionCount ?? 20;
	} else {
		const modeConfig = EXAM_MODES[examMode];
		cats = modeConfig.categories;
		questionCount = modeConfig.questionCount;
	}

	const filtered = getAllQuestionsWithAnswers().filter(
		(q): q is QuestionWithAnswers & { category: string } =>
			typeof q.category === 'string' && cats.includes(q.category)
	);

	return shuffleArray(filtered)
		.slice(0, Math.min(questionCount, filtered.length))
		.map((q) => ({ ...q, answerOptions: shuffleArray(q.answerOptions) }));
}

export function createTestSession(input: CreateTestSessionInput): {
	id: number;
	pin: string;
	status: TestSessionStatus;
	examMode: 'organisationnel' | 'tresorerie' | 'custom';
	customCategories: string[] | null;
	questionCount: number;
	timeLimitSeconds: number;
	createdAt: string;
} {
	const quizPayload = buildTestSessionQuizPayload(
		input.examMode,
		input.customCategories,
		input.customQuestionCount
	);
	if (quizPayload.length === 0) {
		throw new Error('No questions available for this exam mode');
	}

	const pin = generateUniqueSessionPin();
	const questionCount = quizPayload.length;
	const timeLimitSeconds =
		input.examMode === 'custom'
			? (input.customTimeLimitMinutes ?? 15) * 60
			: EXAM_MODES[input.examMode].timeLimit * 60;
	const customCategoriesJson =
		input.examMode === 'custom' ? JSON.stringify(input.customCategories ?? []) : null;
	const nowIso = new Date().toISOString();

	const sessionId = db.transaction((tx) => {
		const result = tx
			.insert(testSessions)
			.values({
				pin,
				created_by: input.createdByUserId,
				exam_mode: input.examMode,
				custom_categories: customCategoriesJson,
				status: 'waiting',
				question_count: questionCount,
				time_limit_seconds: timeLimitSeconds,
				quiz_payload: JSON.stringify(quizPayload)
			})
			.run();
		return result.lastInsertRowid as number;
	});

	return {
		id: sessionId,
		pin,
		status: 'waiting',
		examMode: input.examMode,
		customCategories: input.customCategories ?? null,
		questionCount,
		timeLimitSeconds,
		createdAt: nowIso
	};
}

export function joinTestSession(pin: string, userId: string): { id: number; pin: string } {
	const session = db
		.select({ id: testSessions.id, status: testSessions.status, created_by: testSessions.created_by })
		.from(testSessions)
		.where(eq(testSessions.pin, pin))
		.get();

	if (!session) throw new Error('Session not found');
	if (session.created_by === userId) throw new Error('Session creator cannot join as participant');

	const alreadyParticipant = db
		.select({ id: testSessionParticipants.id })
		.from(testSessionParticipants)
		.where(
			and(
				eq(testSessionParticipants.session_id, session.id),
				eq(testSessionParticipants.user_id, userId)
			)
		)
		.get();

	if (session.status === 'waiting') {
		db.insert(testSessionParticipants)
			.values({ session_id: session.id, user_id: userId })
			.onConflictDoNothing()
			.run();
		return { id: session.id, pin };
	}

	if (!alreadyParticipant) throw new Error('Session is no longer joinable');
	return { id: session.id, pin };
}

export function startTestSession(
	pin: string,
	userId: string
): {
	id: number;
	pin: string;
	status: TestSessionStatus;
	startedAt: string;
} {
	const session = db
		.select({ id: testSessions.id, created_by: testSessions.created_by, status: testSessions.status })
		.from(testSessions)
		.where(eq(testSessions.pin, pin))
		.get();

	if (!session) throw new Error('Session not found');
	if (session.created_by !== userId) throw new Error('Only the session creator can start this test');
	if (session.status !== 'waiting') throw new Error('Session cannot be started');

	const participantCount =
		db
			.select({ value: count() })
			.from(testSessionParticipants)
			.where(eq(testSessionParticipants.session_id, session.id))
			.get()?.value ?? 0;

	if (participantCount === 0) {
		throw new Error('At least one participant must join before starting');
	}

	const startedAt = new Date().toISOString();
	db.update(testSessions)
		.set({ status: 'started', started_at: startedAt })
		.where(eq(testSessions.id, session.id))
		.run();

	return { id: session.id, pin, status: 'started', startedAt };
}

export function updateTestSessionParticipantProgress(input: {
	pin: string;
	userId: string;
	currentQuestion: number;
}): { currentQuestion: number } {
	const session = db
		.select({
			id: testSessions.id,
			status: testSessions.status,
			question_count: testSessions.question_count,
			created_by: testSessions.created_by
		})
		.from(testSessions)
		.where(eq(testSessions.pin, input.pin))
		.get();

	if (!session) throw new Error('Session not found');
	if (session.created_by === input.userId) throw new Error('Session creator cannot report progress');
	if (session.status !== 'started' && session.status !== 'completed') {
		throw new Error('Session is not started');
	}

	const participant = db
		.select({ id: testSessionParticipants.id })
		.from(testSessionParticipants)
		.where(
			and(
				eq(testSessionParticipants.session_id, session.id),
				eq(testSessionParticipants.user_id, input.userId)
			)
		)
		.get();

	if (!participant) throw new Error('You are not part of this session');

	const boundedQuestion = Math.max(
		0,
		Math.min(session.question_count, Math.floor(input.currentQuestion))
	);

	db.update(testSessionParticipants)
		.set({
			current_question_index: boundedQuestion,
			progress_updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where(
			and(
				eq(testSessionParticipants.session_id, session.id),
				eq(testSessionParticipants.user_id, input.userId)
			)
		)
		.run();

	return { currentQuestion: boundedQuestion };
}

export function submitTestSessionResult(input: SubmitTestSessionResultInput): {
	status: TestSessionStatus;
	allParticipantsSubmitted: boolean;
} {
	const session = db
		.select({
			id: testSessions.id,
			status: testSessions.status,
			question_count: testSessions.question_count,
			created_by: testSessions.created_by
		})
		.from(testSessions)
		.where(eq(testSessions.pin, input.pin))
		.get();

	if (!session) throw new Error('Session not found');

	const isParticipant = db
		.select({ id: testSessionParticipants.id })
		.from(testSessionParticipants)
		.where(
			and(
				eq(testSessionParticipants.session_id, session.id),
				eq(testSessionParticipants.user_id, input.userId)
			)
		)
		.get();

	if (!isParticipant) throw new Error('You are not part of this session');
	if (session.status !== 'started' && session.status !== 'completed') {
		throw new Error('Session is not accepting submissions');
	}

	const allParticipantsSubmitted = db.transaction((tx) => {
		tx.insert(testSessionResults)
			.values({
				session_id: session.id,
				user_id: input.userId,
				score: input.score,
				total_questions: input.totalQuestions,
				correct_answers: input.correctAnswers,
				time_spent: input.timeSpent,
				category_scores: JSON.stringify(input.categoryScores || {})
			})
			.onConflictDoUpdate({
				target: [testSessionResults.session_id, testSessionResults.user_id],
				set: {
					score: sql`excluded.score`,
					total_questions: sql`excluded.total_questions`,
					correct_answers: sql`excluded.correct_answers`,
					time_spent: sql`excluded.time_spent`,
					category_scores: sql`excluded.category_scores`,
					submitted_at: sql`CURRENT_TIMESTAMP`
				}
			})
			.run();

		tx.delete(testSessionResultAnswers)
			.where(
				and(
					eq(testSessionResultAnswers.session_id, session.id),
					eq(testSessionResultAnswers.user_id, input.userId)
				)
			)
			.run();

		tx.update(testSessionParticipants)
			.set({
				current_question_index: session.question_count,
				progress_updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where(
				and(
					eq(testSessionParticipants.session_id, session.id),
					eq(testSessionParticipants.user_id, input.userId)
				)
			)
			.run();

		const validAnswers = (input.questionResults ?? [])
			.map((a) => ({ questionId: Number.parseInt(a.questionId, 10), isCorrect: a.isCorrect }))
			.filter((a) => Number.isFinite(a.questionId));

		if (validAnswers.length > 0) {
			tx.insert(testSessionResultAnswers)
				.values(
					validAnswers.map((a) => ({
						session_id: session.id,
						user_id: input.userId,
						question_id: a.questionId,
						is_correct: a.isCorrect ? 1 : 0
					}))
				)
				.run();
		}

		const participantCount =
			tx
				.select({ value: count() })
				.from(testSessionParticipants)
				.where(
					and(
						eq(testSessionParticipants.session_id, session.id),
						ne(testSessionParticipants.user_id, session.created_by)
					)
				)
				.get()?.value ?? 0;

		const submittedCount =
			tx
				.select({ value: count() })
				.from(testSessionResults)
				.where(
					and(
						eq(testSessionResults.session_id, session.id),
						ne(testSessionResults.user_id, session.created_by)
					)
				)
				.get()?.value ?? 0;

		const allDone = participantCount > 0 && submittedCount >= participantCount;
		if (allDone) {
			tx.update(testSessions)
				.set({
					status: 'completed',
					ended_at: sql`COALESCE(${testSessions.ended_at}, CURRENT_TIMESTAMP)`
				})
				.where(eq(testSessions.id, session.id))
				.run();
		}

		return allDone;
	});

	return {
		status: allParticipantsSubmitted ? 'completed' : (session.status as TestSessionStatus),
		allParticipantsSubmitted
	};
}

export function getTestSessionView(pin: string, userId: string): TestSessionView | null {
	const session = db.get<DbTestSession & { created_by_name: string }>(sql`
		SELECT
			s.id, s.pin, s.created_by, s.exam_mode, s.custom_categories,
			s.status, s.question_count, s.time_limit_seconds, s.quiz_payload,
			s.created_at, s.started_at, s.ended_at,
			u.name as created_by_name
		FROM test_sessions s
		JOIN users u ON u.id = s.created_by
		WHERE s.pin = ${pin}
	`);

	if (!session) return null;

	const isParticipant = db
		.select({ id: testSessionParticipants.id })
		.from(testSessionParticipants)
		.where(
			and(
				eq(testSessionParticipants.session_id, session.id),
				eq(testSessionParticipants.user_id, userId)
			)
		)
		.get();

	if (!isParticipant && session.created_by !== userId) return null;

	const isCreator = session.created_by === userId;
	const participants = getSessionParticipants(session.id, isCreator);

	const myResultRow = db
		.select({
			score: testSessionResults.score,
			correct_answers: testSessionResults.correct_answers,
			total_questions: testSessionResults.total_questions,
			time_spent: testSessionResults.time_spent,
			submitted_at: testSessionResults.submitted_at
		})
		.from(testSessionResults)
		.where(
			and(
				eq(testSessionResults.session_id, session.id),
				eq(testSessionResults.user_id, userId)
			)
		)
		.get();

	let quizPayload: QuestionWithAnswers[] | undefined;
	if (session.status !== 'waiting') {
		try {
			quizPayload = JSON.parse(session.quiz_payload) as QuestionWithAnswers[];
		} catch {
			quizPayload = undefined;
		}
	}

	let categoryPerformance: TestSessionCategoryStat[] | undefined;
	let topQuestions: TestSessionQuestionStat[] | undefined;
	let flopQuestions: TestSessionQuestionStat[] | undefined;
	if (isCreator) {
		const analytics = getSessionAnalytics(session.id);
		categoryPerformance = analytics.categoryPerformance;
		topQuestions = analytics.topQuestions;
		flopQuestions = analytics.flopQuestions;
	}

	let customCategories: string[] | null = null;
	if (session.exam_mode === 'custom' && session.custom_categories) {
		try {
			customCategories = JSON.parse(session.custom_categories);
		} catch {
			customCategories = null;
		}
	}

	return {
		id: session.id,
		pin: session.pin,
		examMode: session.exam_mode,
		customCategories,
		status: session.status,
		questionCount: session.question_count,
		timeLimitSeconds: session.time_limit_seconds,
		createdAt: normalizeTimestamp(session.created_at) ?? session.created_at,
		startedAt: normalizeTimestamp(session.started_at),
		endedAt: normalizeTimestamp(session.ended_at),
		createdByUserId: session.created_by,
		createdByName: session.created_by_name,
		isCreator,
		participants,
		myResult: myResultRow
			? {
					score: myResultRow.score!,
					correctAnswers: myResultRow.correct_answers!,
					totalQuestions: myResultRow.total_questions!,
					timeSpent: myResultRow.time_spent!,
					submittedAt:
						normalizeTimestamp(myResultRow.submitted_at ?? null) ?? myResultRow.submitted_at ?? ''
				}
			: null,
		quizPayload,
		categoryPerformance,
		topQuestions,
		flopQuestions
	};
}

export function getTestSessionHistory(limit = 100): TestSessionHistoryItem[] {
	return db
		.all<{
			id: number;
			pin: string;
			exam_mode: 'organisationnel' | 'tresorerie' | 'custom';
			custom_categories: string | null;
			status: TestSessionStatus;
			question_count: number;
			time_limit_seconds: number;
			created_at: string;
			started_at: string | null;
			ended_at: string | null;
			created_by_name: string;
			participant_count: number;
			submitted_count: number;
			avg_score: number | null;
			best_score: number | null;
			worst_score: number | null;
		}>(sql`
			SELECT
				s.id, s.pin, s.exam_mode, s.custom_categories, s.status,
				s.question_count, s.time_limit_seconds, s.created_at, s.started_at, s.ended_at,
				u.name as created_by_name,
				(SELECT COUNT(*) FROM test_session_participants p WHERE p.session_id = s.id AND p.user_id != s.created_by) as participant_count,
				(SELECT COUNT(*) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as submitted_count,
				(SELECT ROUND(AVG(r.score), 0) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as avg_score,
				(SELECT MAX(r.score) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as best_score,
				(SELECT MIN(r.score) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as worst_score
			FROM test_sessions s
			JOIN users u ON u.id = s.created_by
			ORDER BY s.created_at DESC
			LIMIT ${limit}
		`)
		.map((row) => {
			let customCategories: string[] | null = null;
			if (row.exam_mode === 'custom' && row.custom_categories) {
				try {
					customCategories = JSON.parse(row.custom_categories);
				} catch {
					customCategories = null;
				}
			}
			return {
				id: row.id,
				pin: row.pin,
				examMode: row.exam_mode,
				customCategories,
				status: row.status,
				questionCount: row.question_count,
				timeLimitSeconds: row.time_limit_seconds,
				createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
				startedAt: normalizeTimestamp(row.started_at),
				endedAt: normalizeTimestamp(row.ended_at),
				createdByName: row.created_by_name,
				participantCount: row.participant_count,
				submittedCount: row.submitted_count,
				avgScore: row.avg_score,
				bestScore: row.best_score,
				worstScore: row.worst_score
			};
		});
}

export function getTestSessionAdminDetails(sessionId: number): TestSessionView | null {
	const row = db
		.select({ pin: testSessions.pin, created_by: testSessions.created_by })
		.from(testSessions)
		.where(eq(testSessions.id, sessionId))
		.get();
	if (!row) return null;
	return getTestSessionView(row.pin, row.created_by);
}

// ─── Category functions ───────────────────────────────────────────────────────

export function getCategories(): DbCategory[] {
	return db
		.select()
		.from(categories)
		.orderBy(asc(categories.name))
		.all() as DbCategory[];
}

export function createCategory(data: { name: string; slug: string; description?: string }): number {
	const result = db
		.insert(categories)
		.values({ name: data.name, slug: data.slug, description: data.description ?? null })
		.run();
	return result.lastInsertRowid as number;
}

// ─── Question functions ───────────────────────────────────────────────────────

export interface QuestionFilter {
	categoryId?: number;
	search?: string;
	limit?: number;
	offset?: number;
}

export function getQuestions(
	filter: QuestionFilter = {}
): (DbQuestion & { category_name: string; answer_count: number })[] {
	const conditions: SQL[] = [];
	if (filter.categoryId) conditions.push(eq(questions.category_id, filter.categoryId));
	if (filter.search) conditions.push(like(questions.question_text, `%${filter.search}%`));

	const base = db
		.select({
			id: questions.id,
			category_id: questions.category_id,
			question_text: questions.question_text,
			success_count: questions.success_count,
			failure_count: questions.failure_count,
			created_at: questions.created_at,
			updated_at: questions.updated_at,
			category_name: categories.name,
			answer_count: sql<number>`(SELECT COUNT(*) FROM answer_options WHERE question_id = ${questions.id})`
		})
		.from(questions)
		.innerJoin(categories, eq(questions.category_id, categories.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(questions.created_at));

	if (filter.limit) {
		return base
			.limit(filter.limit)
			.offset(filter.offset ?? 0)
			.all() as (DbQuestion & { category_name: string; answer_count: number })[];
	}
	return base.all() as (DbQuestion & { category_name: string; answer_count: number })[];
}

export function getQuestion(id: number): (DbQuestion & { answers: DbAnswerOption[] }) | undefined {
	const question = db.select().from(questions).where(eq(questions.id, id)).get() as
		| DbQuestion
		| undefined;
	if (!question) return undefined;
	const answers = db
		.select()
		.from(answerOptions)
		.where(eq(answerOptions.question_id, id))
		.orderBy(asc(answerOptions.position), asc(answerOptions.id))
		.all() as DbAnswerOption[];
	return { ...question, answers };
}

export interface QuestionData {
	categoryId: number;
	questionText: string;
	answers: {
		text: string;
		isCorrect: boolean;
		rationale?: string;
	}[];
}

export function createQuestion(data: QuestionData): number {
	return db.transaction((tx) => {
		const result = tx
			.insert(questions)
			.values({ category_id: data.categoryId, question_text: data.questionText })
			.run();
		const questionId = result.lastInsertRowid as number;
		data.answers.forEach((ans, index) => {
			tx.insert(answerOptions)
				.values({
					question_id: questionId,
					text: ans.text,
					is_correct: ans.isCorrect ? 1 : 0,
					rationale: ans.rationale ?? null,
					position: index
				})
				.run();
		});
		return questionId;
	});
}

export function updateQuestion(id: number, data: QuestionData): void {
	db.transaction((tx) => {
		tx.update(questions)
			.set({
				category_id: data.categoryId,
				question_text: data.questionText,
				updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where(eq(questions.id, id))
			.run();
		tx.delete(answerOptions).where(eq(answerOptions.question_id, id)).run();
		data.answers.forEach((ans, index) => {
			tx.insert(answerOptions)
				.values({
					question_id: id,
					text: ans.text,
					is_correct: ans.isCorrect ? 1 : 0,
					rationale: ans.rationale ?? null,
					position: index
				})
				.run();
		});
	});
}

export function deleteQuestion(id: number): void {
	db.delete(questions).where(eq(questions.id, id)).run();
}

export function importQuestionsFromJSON(
	jsonContent: unknown,
	categoryId: number
): { added: number; errors: string[] } {
	if (!Array.isArray(jsonContent)) {
		return { added: 0, errors: ['JSON content must be an array'] };
	}

	let added = 0;
	const errors: string[] = [];

	db.transaction((tx) => {
		for (let i = 0; i < jsonContent.length; i++) {
			const q = jsonContent[i] as {
				question: string;
				answerOptions: { text: string; isCorrect: boolean; rationale?: string }[];
			};
			if (!q.question || !Array.isArray(q.answerOptions)) {
				errors.push(`Question at index ${i} is missing required fields`);
				continue;
			}
			try {
				const result = tx
					.insert(questions)
					.values({ category_id: categoryId, question_text: q.question })
					.run();
				const qId = result.lastInsertRowid as number;
				q.answerOptions.forEach((ans, idx) => {
					tx.insert(answerOptions)
						.values({
							question_id: qId,
							text: ans.text,
							is_correct: ans.isCorrect ? 1 : 0,
							rationale: ans.rationale ?? null,
							position: idx
						})
						.run();
				});
				added++;
			} catch (e: unknown) {
				errors.push(
					`Error saving question at index ${i}: ${e instanceof Error ? e.message : 'Unknown error'}`
				);
			}
		}
	});

	return { added, errors };
}

export interface QuestionWithAnswers {
	id: string;
	question: string;
	answerOptions: {
		text: string;
		isCorrect: boolean;
		rationale?: string;
	}[];
	category: string | undefined;
}

export function getAllQuestionsWithAnswers(): QuestionWithAnswers[] {
	const allQuestions = db.select().from(questions).all() as DbQuestion[];
	const allAnswers = db
		.select()
		.from(answerOptions)
		.orderBy(asc(answerOptions.position))
		.all() as DbAnswerOption[];
	const allCategories = db.select().from(categories).all() as DbCategory[];

	const catMap = new Map(allCategories.map((c) => [c.id, c.name]));

	return allQuestions.map((q) => ({
		id: q.id.toString(),
		question: q.question_text,
		answerOptions: allAnswers
			.filter((a) => a.question_id === q.id)
			.map((a) => ({ text: a.text, isCorrect: a.is_correct === 1, rationale: a.rationale || undefined })),
		category: catMap.get(q.category_id)
	}));
}

export function updateQuestionStats(results: { questionId: string; isCorrect: boolean }[]) {
	db.transaction((tx) => {
		for (const item of results) {
			const qId = Number(item.questionId);
			if (!Number.isFinite(qId)) continue;
			if (item.isCorrect) {
				tx.update(questions)
					.set({ success_count: sql`${questions.success_count} + 1` })
					.where(eq(questions.id, qId))
					.run();
			} else {
				tx.update(questions)
					.set({ failure_count: sql`${questions.failure_count} + 1` })
					.where(eq(questions.id, qId))
					.run();
			}
		}
	});
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export interface DashboardStats {
	questions: number;
	users: number;
	dailyParticipation: { date: string; count: number }[];
	avgScoreEvolution: {
		organisationnel: { date: string; score: number }[];
		tresorerie: { date: string; score: number }[];
	};
	categoryPerformance: { name: string; successRate: number; totalQuestions: number }[];
	topQuestions: { question: string; successRate: number; count: number }[];
	flopQuestions: { question: string; successRate: number; count: number }[];
}

export function getDashboardStats(): DashboardStats {
	const questionCount =
		db.select({ value: count() }).from(questions).get()?.value ?? 0;
	const userCount =
		db.select({ value: count() }).from(users).get()?.value ?? 0;

	const dailyParticipation = db.all<{ date: string; count: number }>(sql`
		SELECT date(created_at) as date, COUNT(*) as count
		FROM scores
		WHERE created_at >= date('now', '-30 days')
		GROUP BY date(created_at)
		ORDER BY date ASC
	`);

	const scoreRows = db.all<{ date: string; exam_mode: string; avg_score: number }>(sql`
		SELECT date(created_at) as date, exam_mode, AVG(score) as avg_score
		FROM scores
		WHERE created_at >= date('now', '-30 days')
		GROUP BY date(created_at), exam_mode
		ORDER BY date ASC
	`);

	const avgScoreEvolution = {
		organisationnel: scoreRows
			.filter((s) => s.exam_mode === 'organisationnel')
			.map((s) => ({ date: s.date, score: Math.round(s.avg_score) })),
		tresorerie: scoreRows
			.filter((s) => s.exam_mode === 'tresorerie')
			.map((s) => ({ date: s.date, score: Math.round(s.avg_score) }))
	};

	const catStats = db.all<{ name: string; success: number; failure: number }>(sql`
		SELECT c.name, SUM(q.success_count) as success, SUM(q.failure_count) as failure
		FROM questions q
		JOIN categories c ON q.category_id = c.id
		GROUP BY c.id
	`);

	const categoryPerformance = catStats
		.map((c) => {
			const total = c.success + c.failure;
			return {
				name: c.name,
				successRate: total > 0 ? Math.round((c.success / total) * 100) : 0,
				totalQuestions: total
			};
		})
		.sort((a, b) => b.successRate - a.successRate);

	const rawQuestions = db.all<{
		question: string;
		success_count: number;
		failure_count: number;
	}>(sql`
		SELECT question_text as question, success_count, failure_count
		FROM questions
		WHERE (success_count + failure_count) >= 1
	`);

	const processedQuestions = rawQuestions.map((q) => {
		const total = q.success_count + q.failure_count;
		return {
			question: q.question,
			successRate: total > 0 ? Math.round((q.success_count / total) * 100) : 0,
			count: total
		};
	});

	return {
		questions: questionCount,
		users: userCount,
		dailyParticipation,
		avgScoreEvolution,
		categoryPerformance,
		topQuestions: [...processedQuestions]
			.sort((a, b) => b.successRate - a.successRate || b.count - a.count)
			.slice(0, 3),
		flopQuestions: [...processedQuestions]
			.sort((a, b) => a.successRate - b.successRate || b.count - a.count)
			.slice(0, 3)
	};
}
