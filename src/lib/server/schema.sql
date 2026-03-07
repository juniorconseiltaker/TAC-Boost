-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    image TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Scores table (only for official exam modes)
CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    exam_mode TEXT NOT NULL CHECK(exam_mode IN ('organisationnel', 'tresorerie')),
    score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    time_spent INTEGER NOT NULL,  -- in seconds
    category_scores TEXT,          -- JSON object
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
CREATE INDEX IF NOT EXISTS idx_scores_mode ON scores(exam_mode);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_created ON scores(created_at DESC);

-- Test sessions table
CREATE TABLE IF NOT EXISTS test_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pin TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES users(id),
    exam_mode TEXT NOT NULL CHECK(exam_mode IN ('organisationnel', 'tresorerie')),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'started', 'completed', 'cancelled')),
    question_count INTEGER NOT NULL,
    time_limit_seconds INTEGER NOT NULL,
    quiz_payload TEXT NOT NULL,      -- JSON array of questions used for this session
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    ended_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_test_sessions_pin ON test_sessions(pin);
CREATE INDEX IF NOT EXISTS idx_test_sessions_status ON test_sessions(status);
CREATE INDEX IF NOT EXISTS idx_test_sessions_created_by ON test_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_test_sessions_created_at ON test_sessions(created_at DESC);

-- Session participants
CREATE TABLE IF NOT EXISTS test_session_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    current_question_index INTEGER NOT NULL DEFAULT 0,
    progress_updated_at DATETIME,
    UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_test_session_participants_session ON test_session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_test_session_participants_user ON test_session_participants(user_id);

-- Session results (one row per participant)
CREATE TABLE IF NOT EXISTS test_session_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    time_spent INTEGER NOT NULL,     -- in seconds
    category_scores TEXT,            -- JSON object
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_test_session_results_session ON test_session_results(session_id);
CREATE INDEX IF NOT EXISTS idx_test_session_results_user ON test_session_results(user_id);

-- Per-question outcomes in a session (used for analytics)
CREATE TABLE IF NOT EXISTS test_session_result_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    question_id INTEGER NOT NULL REFERENCES questions(id),
    is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_test_session_answers_session ON test_session_result_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_test_session_answers_user ON test_session_result_answers(user_id);
CREATE INDEX IF NOT EXISTS idx_test_session_answers_question ON test_session_result_answers(question_id);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    question_text TEXT NOT NULL,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Answer options table
CREATE TABLE IF NOT EXISTS answer_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT 0,
    rationale TEXT,
    position INTEGER NOT NULL DEFAULT 0
);

-- User roles table
CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'user')),
    PRIMARY KEY (user_id, role)
);
