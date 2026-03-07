import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { env } from '$env/dynamic/private';
import { EXAM_MODES } from '$lib/types.js';

import schema from './schema.sql?raw';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = env.DATABASE_PATH || join(__dirname, '../../../data/tac1.db');

// Ensure data directory exists
const dataDir = dirname(dbPath);
if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true });
}

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
	if (_db) return _db;

	_db = new Database(dbPath);
	_db.pragma('journal_mode = WAL');

	// Run migrations
	_db.exec(schema);

	// Migration for new user role column
	try {
		_db.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'").run();
	} catch {
		// Column probably already exists
	}

	// Migration for new question stats columns
	try {
		_db.prepare('ALTER TABLE questions ADD COLUMN success_count INTEGER DEFAULT 0').run();
		_db.prepare('ALTER TABLE questions ADD COLUMN failure_count INTEGER DEFAULT 0').run();
	} catch {
		// Columns probably already exist
	}

	// Migration for session participant progress tracking
	try {
		_db
			.prepare(
				'ALTER TABLE test_session_participants ADD COLUMN current_question_index INTEGER NOT NULL DEFAULT 0'
			)
			.run();
	} catch {
		// Column probably already exists
	}
	try {
		_db
			.prepare('ALTER TABLE test_session_participants ADD COLUMN progress_updated_at DATETIME')
			.run();
	} catch {
		// Column probably already exists
	}

	// Cleanup legacy data: session creator is a facilitator, not a participant.
	_db
		.prepare(
			`
		DELETE FROM test_session_participants
		WHERE id IN (
			SELECT p.id
			FROM test_session_participants p
			JOIN test_sessions s ON s.id = p.session_id
			WHERE p.user_id = s.created_by
		)
		`
		)
		.run();
	_db
		.prepare(
			`
		DELETE FROM test_session_results
		WHERE id IN (
			SELECT r.id
			FROM test_session_results r
			JOIN test_sessions s ON s.id = r.session_id
			WHERE r.user_id = s.created_by
		)
	`
		)
		.run();
	_db
		.prepare(
			`
		DELETE FROM test_session_result_answers
		WHERE id IN (
			SELECT a.id
			FROM test_session_result_answers a
			JOIN test_sessions s ON s.id = a.session_id
			WHERE a.user_id = s.created_by
		)
	`
		)
		.run();

	// Seed fixed categories
	const fixedCategories = [
		{ name: 'Mouvement', slug: 'mouvement' },
		{ name: 'CLR', slug: 'clr' },
		{ name: 'Organisationnel', slug: 'organisationnel' },
		{ name: 'Trésorerie', slug: 'tresorerie' }
	];

	const insertCategory = _db.prepare(
		'INSERT OR IGNORE INTO categories (name, slug) VALUES (@name, @slug)'
	);
	for (const cat of fixedCategories) {
		insertCategory.run(cat);
	}

	return _db;
}

// Global db export for backward compatibility where possible, but use getDb() for actual access.
// This ensures legacy call sites (db.prepare) keep working in SSR.
export const db = getDb();

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
	exam_mode: 'organisationnel' | 'tresorerie';
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
	is_correct: number; // SQLite uses 0/1 for booleans
	rationale: string | null;
	position: number;
}

export function isAdmin(email?: string | null): boolean {
	if (!email) return false;

	// Hardcoded fallback for bootstrap/security
	const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
	if (adminEmails.includes(email.toLowerCase())) return true;

	const user = getDb()
		.prepare('SELECT role FROM users WHERE email = ?')
		.get(email.toLowerCase()) as { role: string } | undefined;

	return user?.role === 'admin';
}

export function getOrCreateUser(user: Omit<DbUser, 'created_at' | 'role'>): DbUser {
	const existing = getDb().prepare('SELECT * FROM users WHERE email = ?').get(user.email) as
		| DbUser
		| undefined;
	if (existing) {
		// If user ID changed, update the FK references in scores table first
		if (existing.id !== user.id) {
			// Disable foreign keys before the transaction (must be outside transaction)
			getDb().pragma('foreign_keys = OFF');
			try {
				getDb()
					.prepare('UPDATE scores SET user_id = ? WHERE user_id = ?')
					.run(user.id, existing.id);
				getDb()
					.prepare('UPDATE users SET id = ?, name = ?, image = ? WHERE email = ?')
					.run(user.id, user.name, user.image, user.email);
			} finally {
				getDb().pragma('foreign_keys = ON');
			}
		} else {
			getDb()
				.prepare('UPDATE users SET name = ?, image = ? WHERE email = ?')
				.run(user.name, user.image, user.email);
		}
		return { ...existing, id: user.id, name: user.name, image: user.image };
	}

	// Automatic admin promotion if email is in ADMIN_EMAILS
	const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());
	const role = adminEmails.includes(user.email.toLowerCase()) ? 'admin' : 'user';

	getDb()
		.prepare('INSERT INTO users (id, email, name, image, role) VALUES (?, ?, ?, ?, ?)')
		.run(user.id, user.email, user.name, user.image, role);
	return { ...user, role } as DbUser;
}

export function getAllUsers(): (DbUser & { isHardcodedAdmin: boolean })[] {
	const users = (
		getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as DbUser[]
	).map((u) => ({
		...u,
		role: u.role || 'user'
	}));
	const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());

	return users.map((user) => ({
		...user,
		// We flag if it's a hardcoded admin so we can prevent role changes in UI?
		// Or just to show they have special "super-admin" status.
		isHardcodedAdmin: adminEmails.includes(user.email.toLowerCase())
	}));
}

export function updateUserRole(userId: string, role: string): boolean {
	const result = getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
	return result.changes > 0;
}

export function deleteUser(userId: string): boolean {
	const result = getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
	// Optional: Cascade delete scores? SQLite typically handles this via ON DELETE CASCADE if configured.
	// Check schema.sql if scores ref users. Our schema calls it `user_id TEXT NOT NULL REFERENCES users(id)`
	// but default SQLite might not enforce FKs unless PRAGMA foreign_keys = ON; is set (it is not in db.ts currently).
	// Let's manually clean up scores just in case for now.
	if (result.changes > 0) {
		getDb().prepare('DELETE FROM scores WHERE user_id = ?').run(userId);
		getDb().prepare('DELETE FROM test_session_participants WHERE user_id = ?').run(userId);
		getDb().prepare('DELETE FROM test_session_results WHERE user_id = ?').run(userId);
		getDb().prepare('DELETE FROM test_session_result_answers WHERE user_id = ?').run(userId);
		getDb().prepare('DELETE FROM test_sessions WHERE created_by = ?').run(userId);
		return true;
	}
	return false;
}

export function saveScore(score: Omit<DbScore, 'id' | 'created_at'>): DbScore {
	const stmt = getDb().prepare(`
		INSERT INTO scores (user_id, exam_mode, score, total_questions, correct_answers, time_spent, category_scores)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);
	const result = stmt.run(
		score.user_id,
		score.exam_mode,
		score.score,
		score.total_questions,
		score.correct_answers,
		score.time_spent,
		score.category_scores
	);

	return {
		...score,
		id: result.lastInsertRowid as number,
		created_at: new Date().toISOString()
	};
}

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

	// Weeks reset every Monday at 00:00 (server local timezone).
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
		const exists = getDb().prepare('SELECT 1 FROM test_sessions WHERE pin = ?').get(pin);
		if (!exists) return pin;
	}
	throw new Error('Unable to generate unique PIN');
}

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
	examMode: 'organisationnel' | 'tresorerie';
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
	examMode: 'organisationnel' | 'tresorerie';
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

export interface CreateTestSessionInput {
	createdByUserId: string;
	examMode: 'organisationnel' | 'tresorerie';
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
	examMode: 'organisationnel' | 'tresorerie'
): QuestionWithAnswers[] {
	const modeConfig = EXAM_MODES[examMode];
	const filteredQuestions = getAllQuestionsWithAnswers().filter(
		(q): q is QuestionWithAnswers & { category: string } =>
			typeof q.category === 'string' &&
			modeConfig.categories.includes(
				q.category as 'CLR' | 'Mouvement' | 'Organisationnel' | 'Trésorerie'
			)
	);

	const selectedQuestions = shuffleArray(filteredQuestions).slice(
		0,
		Math.min(modeConfig.questionCount, filteredQuestions.length)
	);

	return selectedQuestions.map((question) => ({
		...question,
		answerOptions: shuffleArray(question.answerOptions)
	}));
}

function getSessionParticipants(
	sessionId: number,
	includeScores: boolean
): TestSessionParticipantView[] {
	const rows = getDb()
		.prepare(
			`
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
		WHERE p.session_id = ? AND p.user_id != s.created_by
		ORDER BY p.joined_at ASC
	`
		)
		.all(sessionId) as {
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
	}[];

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
	const categoryRows = getDb()
		.prepare(
			`
		SELECT
			c.name as name,
			SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as success_count,
			COUNT(*) as total_count
		FROM test_session_result_answers a
		JOIN test_sessions s ON s.id = a.session_id
		JOIN questions q ON q.id = a.question_id
		JOIN categories c ON c.id = q.category_id
		WHERE a.session_id = ? AND a.user_id != s.created_by
		GROUP BY c.id
	`
		)
		.all(sessionId) as {
		name: string;
		success_count: number;
		total_count: number;
	}[];

	const categoryPerformance = categoryRows
		.map((row) => ({
			name: row.name,
			successRate:
				row.total_count > 0 ? Math.round((row.success_count / row.total_count) * 100) : 0,
			totalAnswers: row.total_count
		}))
		.sort((a, b) => b.successRate - a.successRate || b.totalAnswers - a.totalAnswers);

	const questionRows = getDb()
		.prepare(
			`
		SELECT
			q.question_text as question,
			SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as success_count,
			COUNT(*) as total_count
		FROM test_session_result_answers a
		JOIN test_sessions s ON s.id = a.session_id
		JOIN questions q ON q.id = a.question_id
		WHERE a.session_id = ? AND a.user_id != s.created_by
		GROUP BY q.id
		HAVING COUNT(*) >= 1
	`
		)
		.all(sessionId) as {
		question: string;
		success_count: number;
		total_count: number;
	}[];

	const processed = questionRows.map((row) => ({
		question: row.question,
		successRate: row.total_count > 0 ? Math.round((row.success_count / row.total_count) * 100) : 0,
		count: row.total_count
	}));

	const topQuestions = [...processed]
		.sort((a, b) => b.successRate - a.successRate || b.count - a.count)
		.slice(0, 5);

	const flopQuestions = [...processed]
		.sort((a, b) => a.successRate - b.successRate || b.count - a.count)
		.slice(0, 5);

	return { categoryPerformance, topQuestions, flopQuestions };
}

export function createTestSession(input: CreateTestSessionInput): {
	id: number;
	pin: string;
	status: TestSessionStatus;
	examMode: 'organisationnel' | 'tresorerie';
	questionCount: number;
	timeLimitSeconds: number;
	createdAt: string;
} {
	const quizPayload = buildTestSessionQuizPayload(input.examMode);
	if (quizPayload.length === 0) {
		throw new Error('No questions available for this exam mode');
	}

	const pin = generateUniqueSessionPin();
	const questionCount = quizPayload.length;
	const timeLimitSeconds = EXAM_MODES[input.examMode].timeLimit * 60;
	const nowIso = new Date().toISOString();

	const tx = getDb().transaction(() => {
		const sessionInsert = getDb()
			.prepare(
				`
			INSERT INTO test_sessions (
				pin, created_by, exam_mode, status, question_count, time_limit_seconds, quiz_payload
			) VALUES (?, ?, ?, 'waiting', ?, ?, ?)
		`
			)
			.run(
				pin,
				input.createdByUserId,
				input.examMode,
				questionCount,
				timeLimitSeconds,
				JSON.stringify(quizPayload)
			);

		return sessionInsert.lastInsertRowid as number;
	});

	const sessionId = tx();

	return {
		id: sessionId,
		pin,
		status: 'waiting',
		examMode: input.examMode,
		questionCount,
		timeLimitSeconds,
		createdAt: nowIso
	};
}

export function joinTestSession(pin: string, userId: string): { id: number; pin: string } {
	const session = getDb()
		.prepare('SELECT id, status, created_by FROM test_sessions WHERE pin = ?')
		.get(pin) as { id: number; status: TestSessionStatus; created_by: string } | undefined;

	if (!session) {
		throw new Error('Session not found');
	}

	if (session.created_by === userId) {
		throw new Error('Session creator cannot join as participant');
	}

	const alreadyParticipant = getDb()
		.prepare('SELECT 1 FROM test_session_participants WHERE session_id = ? AND user_id = ?')
		.get(session.id, userId);

	if (session.status === 'waiting') {
		getDb()
			.prepare(
				'INSERT OR IGNORE INTO test_session_participants (session_id, user_id) VALUES (?, ?)'
			)
			.run(session.id, userId);
		return { id: session.id, pin };
	}

	if (!alreadyParticipant) {
		throw new Error('Session is no longer joinable');
	}

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
	const session = getDb()
		.prepare('SELECT id, created_by, status FROM test_sessions WHERE pin = ?')
		.get(pin) as { id: number; created_by: string; status: TestSessionStatus } | undefined;

	if (!session) {
		throw new Error('Session not found');
	}

	if (session.created_by !== userId) {
		throw new Error('Only the session creator can start this test');
	}

	if (session.status !== 'waiting') {
		throw new Error('Session cannot be started');
	}

	const participantCount = (
		getDb()
			.prepare('SELECT COUNT(*) as count FROM test_session_participants WHERE session_id = ?')
			.get(session.id) as { count: number }
	).count;
	if (participantCount === 0) {
		throw new Error('At least one participant must join before starting');
	}

	const startedAt = new Date().toISOString();

	getDb()
		.prepare("UPDATE test_sessions SET status = 'started', started_at = ? WHERE id = ?")
		.run(startedAt, session.id);

	return {
		id: session.id,
		pin,
		status: 'started',
		startedAt
	};
}

export function updateTestSessionParticipantProgress(input: {
	pin: string;
	userId: string;
	currentQuestion: number;
}): { currentQuestion: number } {
	const session = getDb()
		.prepare('SELECT id, status, question_count, created_by FROM test_sessions WHERE pin = ?')
		.get(input.pin) as
		| {
				id: number;
				status: TestSessionStatus;
				question_count: number;
				created_by: string;
		  }
		| undefined;

	if (!session) {
		throw new Error('Session not found');
	}
	if (session.created_by === input.userId) {
		throw new Error('Session creator cannot report progress');
	}
	if (session.status !== 'started' && session.status !== 'completed') {
		throw new Error('Session is not started');
	}

	const participant = getDb()
		.prepare('SELECT 1 FROM test_session_participants WHERE session_id = ? AND user_id = ?')
		.get(session.id, input.userId);
	if (!participant) {
		throw new Error('You are not part of this session');
	}

	const boundedQuestion = Math.max(
		0,
		Math.min(session.question_count, Math.floor(input.currentQuestion))
	);

	getDb()
		.prepare(
			`
		UPDATE test_session_participants
		SET current_question_index = ?, progress_updated_at = CURRENT_TIMESTAMP
		WHERE session_id = ? AND user_id = ?
	`
		)
		.run(boundedQuestion, session.id, input.userId);

	return { currentQuestion: boundedQuestion };
}

export function submitTestSessionResult(input: SubmitTestSessionResultInput): {
	status: TestSessionStatus;
	allParticipantsSubmitted: boolean;
} {
	const session = getDb()
		.prepare('SELECT id, status, question_count, created_by FROM test_sessions WHERE pin = ?')
		.get(input.pin) as
		| {
				id: number;
				status: TestSessionStatus;
				question_count: number;
				created_by: string;
		  }
		| undefined;

	if (!session) {
		throw new Error('Session not found');
	}

	const isParticipant = getDb()
		.prepare('SELECT 1 FROM test_session_participants WHERE session_id = ? AND user_id = ?')
		.get(session.id, input.userId);
	if (!isParticipant) {
		throw new Error('You are not part of this session');
	}

	if (session.status !== 'started' && session.status !== 'completed') {
		throw new Error('Session is not accepting submissions');
	}

	const tx = getDb().transaction(() => {
		getDb()
			.prepare(
				`
			INSERT INTO test_session_results (
				session_id, user_id, score, total_questions, correct_answers, time_spent, category_scores
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_id, user_id) DO UPDATE SET
				score = excluded.score,
				total_questions = excluded.total_questions,
				correct_answers = excluded.correct_answers,
				time_spent = excluded.time_spent,
				category_scores = excluded.category_scores,
				submitted_at = CURRENT_TIMESTAMP
		`
			)
			.run(
				session.id,
				input.userId,
				input.score,
				input.totalQuestions,
				input.correctAnswers,
				input.timeSpent,
				JSON.stringify(input.categoryScores || {})
			);

		getDb()
			.prepare('DELETE FROM test_session_result_answers WHERE session_id = ? AND user_id = ?')
			.run(session.id, input.userId);

		getDb()
			.prepare(
				`
			UPDATE test_session_participants
			SET current_question_index = ?, progress_updated_at = CURRENT_TIMESTAMP
			WHERE session_id = ? AND user_id = ?
		`
			)
			.run(session.question_count, session.id, input.userId);

		const insertAnswer = getDb().prepare(
			'INSERT INTO test_session_result_answers (session_id, user_id, question_id, is_correct) VALUES (?, ?, ?, ?)'
		);
		for (const answer of input.questionResults || []) {
			const questionId = Number.parseInt(answer.questionId, 10);
			if (!Number.isFinite(questionId)) continue;
			insertAnswer.run(session.id, input.userId, questionId, answer.isCorrect ? 1 : 0);
		}

		const participantCount = (
			getDb()
				.prepare(
					'SELECT COUNT(*) as count FROM test_session_participants WHERE session_id = ? AND user_id != ?'
				)
				.get(session.id, session.created_by) as { count: number }
		).count;

		const submittedCount = (
			getDb()
				.prepare(
					'SELECT COUNT(*) as count FROM test_session_results WHERE session_id = ? AND user_id != ?'
				)
				.get(session.id, session.created_by) as { count: number }
		).count;

		const allParticipantsSubmitted = participantCount > 0 && submittedCount >= participantCount;
		if (allParticipantsSubmitted) {
			getDb()
				.prepare(
					"UPDATE test_sessions SET status = 'completed', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP) WHERE id = ?"
				)
				.run(session.id);
		}

		return allParticipantsSubmitted;
	});

	const allParticipantsSubmitted = tx();

	return {
		status: allParticipantsSubmitted ? 'completed' : session.status,
		allParticipantsSubmitted
	};
}

export function getTestSessionView(pin: string, userId: string): TestSessionView | null {
	const session = getDb()
		.prepare(
			`
		SELECT
			s.id,
			s.pin,
			s.created_by,
			s.exam_mode,
			s.status,
			s.question_count,
			s.time_limit_seconds,
			s.quiz_payload,
			s.created_at,
			s.started_at,
			s.ended_at,
			u.name as created_by_name
		FROM test_sessions s
		JOIN users u ON u.id = s.created_by
		WHERE s.pin = ?
	`
		)
		.get(pin) as
		| (DbTestSession & {
				created_by_name: string;
		  })
		| undefined;

	if (!session) return null;

	const isParticipant = getDb()
		.prepare('SELECT 1 FROM test_session_participants WHERE session_id = ? AND user_id = ?')
		.get(session.id, userId);
	if (!isParticipant && session.created_by !== userId) {
		return null;
	}

	const isCreator = session.created_by === userId;
	const participants = getSessionParticipants(session.id, isCreator);

	const myResultRow = getDb()
		.prepare(
			`
		SELECT score, correct_answers, total_questions, time_spent, submitted_at
		FROM test_session_results
		WHERE session_id = ? AND user_id = ?
	`
		)
		.get(session.id, userId) as
		| {
				score: number;
				correct_answers: number;
				total_questions: number;
				time_spent: number;
				submitted_at: string;
		  }
		| undefined;

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

	return {
		id: session.id,
		pin: session.pin,
		examMode: session.exam_mode,
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
					score: myResultRow.score,
					correctAnswers: myResultRow.correct_answers,
					totalQuestions: myResultRow.total_questions,
					timeSpent: myResultRow.time_spent,
					submittedAt: normalizeTimestamp(myResultRow.submitted_at) ?? myResultRow.submitted_at
				}
			: null,
		quizPayload,
		categoryPerformance,
		topQuestions,
		flopQuestions
	};
}

export function getTestSessionHistory(limit = 100): TestSessionHistoryItem[] {
	return getDb()
		.prepare(
			`
		SELECT
			s.id,
			s.pin,
			s.exam_mode,
			s.status,
			s.question_count,
			s.time_limit_seconds,
			s.created_at,
			s.started_at,
			s.ended_at,
			u.name as created_by_name,
			(SELECT COUNT(*) FROM test_session_participants p WHERE p.session_id = s.id AND p.user_id != s.created_by) as participant_count,
			(SELECT COUNT(*) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as submitted_count,
			(SELECT ROUND(AVG(r.score), 0) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as avg_score,
			(SELECT MAX(r.score) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as best_score,
			(SELECT MIN(r.score) FROM test_session_results r WHERE r.session_id = s.id AND r.user_id != s.created_by) as worst_score
		FROM test_sessions s
		JOIN users u ON u.id = s.created_by
		ORDER BY s.created_at DESC
		LIMIT ?
	`
		)
		.all(limit)
		.map((row) => {
			const typedRow = row as {
				id: number;
				pin: string;
				exam_mode: 'organisationnel' | 'tresorerie';
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
			};

			return {
				id: typedRow.id,
				pin: typedRow.pin,
				examMode: typedRow.exam_mode,
				status: typedRow.status,
				questionCount: typedRow.question_count,
				timeLimitSeconds: typedRow.time_limit_seconds,
				createdAt: normalizeTimestamp(typedRow.created_at) ?? typedRow.created_at,
				startedAt: normalizeTimestamp(typedRow.started_at),
				endedAt: normalizeTimestamp(typedRow.ended_at),
				createdByName: typedRow.created_by_name,
				participantCount: typedRow.participant_count,
				submittedCount: typedRow.submitted_count,
				avgScore: typedRow.avg_score,
				bestScore: typedRow.best_score,
				worstScore: typedRow.worst_score
			};
		});
}

export function getTestSessionAdminDetails(sessionId: number): TestSessionView | null {
	const session = getDb().prepare('SELECT pin FROM test_sessions WHERE id = ?').get(sessionId) as
		| { pin: string }
		| undefined;
	if (!session) return null;

	const creator = getDb()
		.prepare('SELECT created_by FROM test_sessions WHERE id = ?')
		.get(sessionId) as { created_by: string } | undefined;
	if (!creator) return null;

	return getTestSessionView(session.pin, creator.created_by);
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

	return getDb()
		.prepare(
			`
		SELECT 
			s.id, s.user_id, u.name as user_name, u.image as user_image,
			s.score, s.total_questions, s.correct_answers, s.time_spent, s.created_at,
			(
				SELECT COUNT(*)
				FROM scores s3
				WHERE s3.user_id = s.user_id
					AND s3.exam_mode = s.exam_mode
					AND s3.created_at >= ?
			) as attempt_count
		FROM scores s
		JOIN users u ON s.user_id = u.id
		WHERE s.exam_mode = ?
		AND s.created_at >= ?
		AND s.id = (
			SELECT s2.id FROM scores s2 
			WHERE s2.user_id = s.user_id
				AND s2.exam_mode = s.exam_mode
				AND s2.created_at >= ?
			ORDER BY s2.score DESC, s2.time_spent ASC, s2.created_at ASC
			LIMIT 1
		)
		ORDER BY s.score DESC, s.time_spent ASC, s.created_at ASC
		LIMIT ?
	`
		)
		.all(weekStartSql, examMode, weekStartSql, weekStartSql, limit) as LeaderboardEntry[];
}

export function getUserScores(userId: string, examMode?: string): DbScore[] {
	if (examMode) {
		return getDb()
			.prepare('SELECT * FROM scores WHERE user_id = ? AND exam_mode = ? ORDER BY created_at DESC')
			.all(userId, examMode) as DbScore[];
	}
	return getDb()
		.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY created_at DESC')
		.all(userId) as DbScore[];
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
	const allScores = getDb()
		.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY created_at ASC')
		.all(userId) as DbScore[];

	// Calculate stats
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

	// Aggregate category stats
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
				// Ignore malformed JSON
			}
		}
	}

	// Calculate percentages
	for (const cat of Object.keys(categoryStats)) {
		const { correct, total } = categoryStats[cat];
		categoryStats[cat].percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
	}

	// Progression data for charts
	const progression = {
		organisationnel: orgaScores.map((s) => ({
			date: s.created_at,
			score: s.score
		})),
		tresorerie: tresoScores.map((s) => ({
			date: s.created_at,
			score: s.score
		}))
	};

	// Recent attempts (last 10)
	const recentAttempts = allScores.slice(-10).reverse();

	return {
		totalAttempts,
		bestScoreOrga,
		bestScoreTreso,
		avgScore,
		categoryStats,
		progression,
		recentAttempts
	};
}

// --- Admin Functions ---

export function getCategories(): DbCategory[] {
	return getDb().prepare('SELECT * FROM categories ORDER BY name ASC').all() as DbCategory[];
}

export function createCategory(data: { name: string; slug: string; description?: string }): number {
	const info = getDb()
		.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)')
		.run(data.name, data.slug, data.description || null);
	return info.lastInsertRowid as number;
}

export interface QuestionFilter {
	categoryId?: number;
	search?: string;
	limit?: number;
	offset?: number;
}

export function getQuestions(
	filter: QuestionFilter = {}
): (DbQuestion & { category_name: string; answer_count: number })[] {
	let query = `
		SELECT q.*, c.name as category_name,
		(SELECT COUNT(*) FROM answer_options WHERE question_id = q.id) as answer_count
		FROM questions q
		JOIN categories c ON q.category_id = c.id
		WHERE 1=1
	`;
	const params: (string | number)[] = [];

	if (filter.categoryId) {
		query += ' AND q.category_id = ?';
		params.push(filter.categoryId);
	}

	if (filter.search) {
		query += ' AND q.question_text LIKE ?';
		params.push(`%${filter.search}%`);
	}

	query += ' ORDER BY q.created_at DESC';

	if (filter.limit) {
		query += ' LIMIT ?';
		params.push(filter.limit);
		if (filter.offset) {
			query += ' OFFSET ?';
			params.push(filter.offset);
		}
	}

	return getDb()
		.prepare(query)
		.all(...params) as (DbQuestion & { category_name: string; answer_count: number })[];
}

export function getQuestion(id: number): (DbQuestion & { answers: DbAnswerOption[] }) | undefined {
	const question = getDb().prepare('SELECT * FROM questions WHERE id = ?').get(id) as
		| DbQuestion
		| undefined;
	if (!question) return undefined;

	const answers = getDb()
		.prepare('SELECT * FROM answer_options WHERE question_id = ? ORDER BY position ASC, id ASC')
		.all(id) as DbAnswerOption[];
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
	const insertQuestion = getDb().prepare(
		'INSERT INTO questions (category_id, question_text) VALUES (?, ?)'
	);
	const insertAnswer = getDb().prepare(
		'INSERT INTO answer_options (question_id, text, is_correct, rationale, position) VALUES (?, ?, ?, ?, ?)'
	);

	const createTx = getDb().transaction((questionData: QuestionData) => {
		const info = insertQuestion.run(questionData.categoryId, questionData.questionText);
		const questionId = info.lastInsertRowid as number;

		questionData.answers.forEach((ans, index) => {
			insertAnswer.run(questionId, ans.text, ans.isCorrect ? 1 : 0, ans.rationale || null, index);
		});

		return questionId;
	});

	return createTx(data);
}

export function updateQuestion(id: number, data: QuestionData): void {
	const updateQuestionStmt = getDb().prepare(
		'UPDATE questions SET category_id = ?, question_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
	);
	const deleteAnswers = getDb().prepare('DELETE FROM answer_options WHERE question_id = ?');
	const insertAnswer = getDb().prepare(
		'INSERT INTO answer_options (question_id, text, is_correct, rationale, position) VALUES (?, ?, ?, ?, ?)'
	);

	const updateTx = getDb().transaction((qId: number, questionData: QuestionData) => {
		updateQuestionStmt.run(questionData.categoryId, questionData.questionText, qId);
		deleteAnswers.run(qId);
		questionData.answers.forEach((ans, index) => {
			insertAnswer.run(qId, ans.text, ans.isCorrect ? 1 : 0, ans.rationale || null, index);
		});
	});

	updateTx(id, data);
}

export function deleteQuestion(id: number): void {
	getDb().prepare('DELETE FROM questions WHERE id = ?').run(id);
}

export function importQuestionsFromJSON(
	jsonContent: unknown,
	categoryId: number
): { added: number; errors: string[] } {
	// Expects an array of question objects based on the index.ts transformData structure or raw JSON
	// We handle the structure: { question: string, answerOptions: { text: string, isCorrect: boolean, rationale?: string }[] }

	if (!Array.isArray(jsonContent)) {
		return { added: 0, errors: ['JSON content must be an array'] };
	}

	let added = 0;
	const errors: string[] = [];

	const insertQuestion = getDb().prepare(
		'INSERT INTO questions (category_id, question_text) VALUES (?, ?)'
	);
	const insertAnswer = getDb().prepare(
		'INSERT INTO answer_options (question_id, text, is_correct, rationale, position) VALUES (?, ?, ?, ?, ?)'
	);

	const importTx = getDb().transaction(
		(
			questions: {
				question: string;
				answerOptions: { text: string; isCorrect: boolean; rationale?: string }[];
			}[]
		) => {
			for (let i = 0; i < questions.length; i++) {
				const q = questions[i];
				if (!q.question || !Array.isArray(q.answerOptions)) {
					errors.push(`Question at index ${i} is missing required fields`);
					continue;
				}

				try {
					const info = insertQuestion.run(categoryId, q.question);
					const qId = info.lastInsertRowid as number;

					q.answerOptions.forEach((ans, idx: number) => {
						insertAnswer.run(qId, ans.text, ans.isCorrect ? 1 : 0, ans.rationale || null, idx);
					});
					added++;
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : 'Unknown error';
					errors.push(`Error saving question at index ${i}: ${message}`);
				}
			}
		}
	);

	importTx(jsonContent);
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
	const questions = getDb().prepare('SELECT * FROM questions').all() as DbQuestion[];
	const answers = getDb()
		.prepare('SELECT * FROM answer_options ORDER BY position ASC')
		.all() as DbAnswerOption[];
	const categories = getDb().prepare('SELECT * FROM categories').all() as DbCategory[];

	const catMap = new Map(categories.map((c) => [c.id, c.name]));

	return questions.map((q) => {
		const qAnswers = answers
			.filter((a) => a.question_id === q.id)
			.map((a) => ({
				text: a.text,
				isCorrect: a.is_correct === 1,
				rationale: a.rationale || undefined
			}));

		return {
			id: q.id.toString(),
			question: q.question_text,
			answerOptions: qAnswers,
			category: catMap.get(q.category_id)
		};
	});
}

export function updateQuestionStats(results: { questionId: string; isCorrect: boolean }[]) {
	const updateSuccess = getDb().prepare(
		'UPDATE questions SET success_count = success_count + 1 WHERE id = ?'
	);
	const updateFailure = getDb().prepare(
		'UPDATE questions SET failure_count = failure_count + 1 WHERE id = ?'
	);

	const tx = getDb().transaction((items: { questionId: string; isCorrect: boolean }[]) => {
		for (const item of items) {
			if (item.isCorrect) {
				updateSuccess.run(item.questionId);
			} else {
				updateFailure.run(item.questionId);
			}
		}
	});

	tx(results);
}

export interface DashboardStats {
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
	// 1. Daily Participation (Last 30 days)
	const dailyParticipation = getDb()
		.prepare(
			`
		SELECT date(created_at) as date, COUNT(*) as count 
		FROM scores 
		WHERE created_at >= date('now', '-30 days')
		GROUP BY date(created_at) 
		ORDER BY date ASC
	`
		)
		.all() as { date: string; count: number }[];

	// 2. Avg Score Evolution (Last 30 days, by mode)
	const scores = getDb()
		.prepare(
			`
		SELECT date(created_at) as date, exam_mode, AVG(score) as avg_score
		FROM scores
		WHERE created_at >= date('now', '-30 days')
		GROUP BY date(created_at), exam_mode
		ORDER BY date ASC
	`
		)
		.all() as { date: string; exam_mode: string; avg_score: number }[];

	const avgScoreEvolution = {
		organisationnel: scores
			.filter((s) => s.exam_mode === 'organisationnel')
			.map((s) => ({ date: s.date, score: Math.round(s.avg_score) })),
		tresorerie: scores
			.filter((s) => s.exam_mode === 'tresorerie')
			.map((s) => ({ date: s.date, score: Math.round(s.avg_score) }))
	};

	// 3. Category Performance (Aggregated from question stats)
	// We join questions with categories and sum up success/failure counts
	const catStats = getDb()
		.prepare(
			`
		SELECT c.name, SUM(q.success_count) as success, SUM(q.failure_count) as failure
		FROM questions q
		JOIN categories c ON q.category_id = c.id
		GROUP BY c.id
	`
		)
		.all() as { name: string; success: number; failure: number }[];

	const categoryPerformance = catStats
		.map((c) => {
			const total = c.success + c.failure;
			return {
				name: c.name,
				successRate: total > 0 ? Math.round((c.success / total) * 100) : 0,
				totalQuestions: total
			};
		})
		.sort((a, b) => b.successRate - a.successRate); // Best categories first

	// 4. Top/Flop Questions
	// We select questions with at least 1 attempt
	const questions = getDb()
		.prepare(
			`
		SELECT question_text as question, success_count, failure_count
		FROM questions
		WHERE (success_count + failure_count) >= 1
	`
		)
		.all() as { question: string; success_count: number; failure_count: number }[];

	const processedQuestions = questions.map((q) => {
		const total = q.success_count + q.failure_count;
		return {
			question: q.question,
			successRate: total > 0 ? Math.round((q.success_count / total) * 100) : 0,
			count: total
		};
	});

	// Top 3 (Highest Success Rate)
	const topQuestions = [...processedQuestions]
		.sort((a, b) => b.successRate - a.successRate || b.count - a.count)
		.slice(0, 3);

	// Flop 3 (Lowest Success Rate)
	const flopQuestions = [...processedQuestions]
		.sort((a, b) => a.successRate - b.successRate || b.count - a.count)
		.slice(0, 3);

	return {
		dailyParticipation,
		avgScoreEvolution,
		categoryPerformance,
		topQuestions,
		flopQuestions
	};
}
