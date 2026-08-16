-- Drop chat/message tables (data now lives in Firestore only)
-- Users and auth tables remain in PostgreSQL.

DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chat_participants CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
