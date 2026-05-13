import { sqliteTable, text, integer, primaryKey, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	image: text('image'),
	role: text('role').default('user'),
	created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const scores = sqliteTable('scores', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	user_id: text('user_id')
		.notNull()
		.references(() => users.id),
	exam_mode: text('exam_mode').notNull(),
	score: integer('score').notNull(),
	total_questions: integer('total_questions').notNull(),
	correct_answers: integer('correct_answers').notNull(),
	time_spent: integer('time_spent').notNull(),
	category_scores: text('category_scores'),
	created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const testSessions = sqliteTable('test_sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	pin: text('pin').notNull().unique(),
	created_by: text('created_by')
		.notNull()
		.references(() => users.id),
	exam_mode: text('exam_mode').notNull(),
	custom_categories: text('custom_categories'),
	status: text('status').notNull().default('waiting'),
	question_count: integer('question_count').notNull(),
	time_limit_seconds: integer('time_limit_seconds').notNull(),
	quiz_payload: text('quiz_payload').notNull(),
	created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
	started_at: text('started_at'),
	ended_at: text('ended_at')
});

export const testSessionParticipants = sqliteTable(
	'test_session_participants',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		session_id: integer('session_id')
			.notNull()
			.references(() => testSessions.id, { onDelete: 'cascade' }),
		user_id: text('user_id')
			.notNull()
			.references(() => users.id),
		joined_at: text('joined_at').default(sql`CURRENT_TIMESTAMP`),
		current_question_index: integer('current_question_index').notNull().default(0),
		progress_updated_at: text('progress_updated_at')
	},
	(t) => [unique().on(t.session_id, t.user_id)]
);

export const testSessionResults = sqliteTable(
	'test_session_results',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		session_id: integer('session_id')
			.notNull()
			.references(() => testSessions.id, { onDelete: 'cascade' }),
		user_id: text('user_id')
			.notNull()
			.references(() => users.id),
		score: integer('score').notNull(),
		total_questions: integer('total_questions').notNull(),
		correct_answers: integer('correct_answers').notNull(),
		time_spent: integer('time_spent').notNull(),
		category_scores: text('category_scores'),
		submitted_at: text('submitted_at').default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => [unique().on(t.session_id, t.user_id)]
);

export const testSessionResultAnswers = sqliteTable('test_session_result_answers', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	session_id: integer('session_id')
		.notNull()
		.references(() => testSessions.id, { onDelete: 'cascade' }),
	user_id: text('user_id')
		.notNull()
		.references(() => users.id),
	question_id: integer('question_id')
		.notNull()
		.references(() => questions.id),
	is_correct: integer('is_correct').notNull()
});

export const categories = sqliteTable('categories', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	slug: text('slug').notNull().unique(),
	description: text('description'),
	created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const questions = sqliteTable('questions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	category_id: integer('category_id')
		.notNull()
		.references(() => categories.id),
	question_text: text('question_text').notNull(),
	success_count: integer('success_count').default(0),
	failure_count: integer('failure_count').default(0),
	created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
	updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const answerOptions = sqliteTable('answer_options', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	question_id: integer('question_id')
		.notNull()
		.references(() => questions.id, { onDelete: 'cascade' }),
	text: text('text').notNull(),
	is_correct: integer('is_correct').notNull().default(0),
	rationale: text('rationale'),
	position: integer('position').notNull().default(0)
});

export const userRoles = sqliteTable(
	'user_roles',
	{
		user_id: text('user_id')
			.notNull()
			.references(() => users.id),
		role: text('role').notNull()
	},
	(t) => [primaryKey({ columns: [t.user_id, t.role] })]
);
