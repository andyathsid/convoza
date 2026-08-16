-- Chat App Database Migration
-- Run this on your Supabase PostgreSQL database

-- Note: User ID is the Firebase UID (VARCHAR), not a generated UUID.

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(128) PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    avatar TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(128) PRIMARY KEY,
    is_group BOOLEAN DEFAULT FALSE,
    group_name VARCHAR(100) DEFAULT '',
    created_by VARCHAR(128) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id VARCHAR(128) REFERENCES chats(id) ON DELETE CASCADE,
    user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(128) PRIMARY KEY,
    chat_id VARCHAR(128) REFERENCES chats(id) ON DELETE CASCADE,
    sender_id VARCHAR(128) REFERENCES users(id),
    content TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    audio_url TEXT DEFAULT '',
    document_url TEXT DEFAULT '',
    document_name VARCHAR(255) DEFAULT '',
    reply_to_id VARCHAR(128) REFERENCES messages(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
