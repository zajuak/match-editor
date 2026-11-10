CREATE TABLE tournaments (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE CHECK(name = trim(name) AND length(name) BETWEEN 1 AND 80),
  lineups INTEGER NOT NULL DEFAULT 1 CHECK(lineups IN (0,1)),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0)
);
CREATE TABLE teams (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(name = trim(name) AND length(name) BETWEEN 1 AND 80),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
  UNIQUE(tournament_id,name)
);
CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(name = trim(name) AND length(name) BETWEEN 1 AND 80),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
  legacy_key TEXT UNIQUE,
  UNIQUE(team_id,name)
);
CREATE INDEX teams_parent_position ON teams(tournament_id,position,id);
CREATE INDEX players_parent_position ON players(team_id,position,id);
CREATE TABLE roster_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0,
  mutation_token TEXT NOT NULL DEFAULT ''
);
INSERT INTO roster_state(id) VALUES(1);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  password_version TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
