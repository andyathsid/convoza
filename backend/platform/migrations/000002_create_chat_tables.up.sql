-- Drop old tables
DROP TABLE IF EXISTS books CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chat_participants CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table (Firebase UID as primary key)
CREATE TABLE users (
    id VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL,
    avatar TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Chats table
CREATE TABLE chats (
    id VARCHAR(128) PRIMARY KEY,
    is_group BOOLEAN NOT NULL DEFAULT FALSE,
    group_name VARCHAR(255) DEFAULT '',
    created_by VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat participants junction table
CREATE TABLE chat_participants (
    chat_id VARCHAR(128) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

-- Messages table
CREATE TABLE messages (
    id VARCHAR(128) PRIMARY KEY,
    chat_id VARCHAR(128) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    audio_url TEXT DEFAULT '',
    document_url TEXT DEFAULT '',
    document_name VARCHAR(255) DEFAULT '',
    reply_to_id VARCHAR(128) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX idx_chat_participants_chat ON chat_participants(chat_id);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_chats_created_by ON chats(created_by);
