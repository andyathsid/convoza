-- Rollback: recreate chat/message tables

CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(128) PRIMARY KEY,
    is_group BOOLEAN DEFAULT false,
    group_name VARCHAR(255) DEFAULT '',
    created_by VARCHAR(128) REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id VARCHAR(128) REFERENCES chats(id) ON DELETE CASCADE,
    user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT NOW(),
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
    document_name TEXT DEFAULT '',
    reply_to_id VARCHAR(128) REFERENCES messages(id),
    thumbnail_url TEXT DEFAULT '',
    media_group_id VARCHAR(128) DEFAULT '',
    media_group_index INT DEFAULT 0,
    media_group_total INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_chat ON chat_participants(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chats_created_by ON chats(created_by);
CREATE INDEX IF NOT EXISTS idx_messages_media_group ON messages(media_group_id) WHERE media_group_id != '';
