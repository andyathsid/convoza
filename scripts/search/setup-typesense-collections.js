#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const Typesense = require('typesense');

const client = new Typesense.Client({
  nodes: [{
    host: process.env.TYPESENSE_HOST || 'localhost',
    port: parseInt(process.env.TYPESENSE_PORT || '8108'),
    protocol: 'http',
  }],
  apiKey: process.env.TYPESENSE_API_KEY || 'xyz',
  connectionTimeoutSeconds: 10,
});

const collections = [
  {
    name: 'messages',
    fields: [
      { name: 'content', type: 'string' },
      { name: 'documentName', type: 'string', optional: true },
      { name: 'chatId', type: 'string' },
      { name: 'participants', type: 'string[]' },
      { name: 'createdAt', type: 'int64' },
      { name: 'senderId', type: 'string', optional: true, index: false },
      { name: 'mediaType', type: 'string', optional: true, index: false },
      { name: 'deliveredTo', type: 'string[]', optional: true, index: false },
      { name: 'readBy', type: 'string[]', optional: true, index: false },
    ],
    default_sorting_field: 'createdAt',
  },
  {
    name: 'chats',
    fields: [
      { name: 'groupName', type: 'string', optional: true },
      { name: 'participantNames', type: 'string[]' },
      { name: 'participants', type: 'string[]' },
      { name: 'updatedAt', type: 'int64' },
      { name: 'isGroup', type: 'bool', optional: true, index: false },
    ],
    default_sorting_field: 'updatedAt',
  },
  {
    name: 'contacts',
    fields: [
      { name: 'username', type: 'string' },
    ],
  },
  {
    name: 'groups',
    fields: [
      { name: 'participantNames', type: 'string[]' },
      { name: 'participants', type: 'string[]' },
      { name: 'updatedAt', type: 'int64' },
    ],
    default_sorting_field: 'updatedAt',
  },
];

(async () => {
  for (const schema of collections) {
    try {
      await client.collections(schema.name).delete();
      console.log(`Deleted existing "${schema.name}" collection.`);
    } catch (_) {
      // Collection doesn't exist, skip
    }

    await client.collections().create(schema);
    console.log(`Created "${schema.name}" collection.`);
  }

  console.log('\nDone. All collections created.');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
