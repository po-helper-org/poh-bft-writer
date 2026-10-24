-- Т10 (ADR-0004): отдельная база Трекера в общем postgres.
-- Выполняется однократно при инициализации тома pgdata (docker-entrypoint-initdb.d).
CREATE DATABASE vikunja;
GRANT ALL PRIVILEGES ON DATABASE vikunja TO box;
