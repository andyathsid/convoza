ALTER TABLE messages ADD COLUMN media_group_id VARCHAR(128) DEFAULT '';
ALTER TABLE messages ADD COLUMN media_group_index INT DEFAULT 0;
ALTER TABLE messages ADD COLUMN media_group_total INT DEFAULT 0;
ALTER TABLE messages ADD COLUMN thumbnail_url TEXT DEFAULT '';

CREATE INDEX idx_messages_media_group ON messages(media_group_id) WHERE media_group_id != '';
