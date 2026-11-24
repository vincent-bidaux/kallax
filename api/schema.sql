-- D1 schema for kallax-db (applied once)
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, last_login INTEGER);
CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS code_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, ip TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_code_requests_email ON code_requests(email, created_at);
CREATE INDEX IF NOT EXISTS idx_code_requests_ip ON code_requests(ip, created_at);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS projects (id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, items INTEGER NOT NULL DEFAULT 0, thumb TEXT, doc TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id));
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at);
