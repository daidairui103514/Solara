-- Solara D1 数据库初始化脚本
-- 执行方式：npx wrangler d1 execute solara-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS playback_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
