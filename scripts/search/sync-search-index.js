#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_CREDS = path.join(PROJECT_ROOT, 'backend', 'firebase-service-account.json');

let credPath = null;
if (process.env.BACKEND_SA) {
  credPath = path.resolve(process.env.BACKEND_SA);
} else if (fs.existsSync(DEFAULT_CREDS)) {
  credPath = DEFAULT_CREDS;
} else if (fs.existsSync(path.resolve('./serviceAccountKey.json'))) {
  credPath = path.resolve('./serviceAccountKey.json');
}

if (getApps().length === 0) {
  if (credPath && fs.existsSync(credPath)) {
    console.error(`Using credentials: ${credPath}\n`);
    initializeApp({ credential: cert(credPath) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp();
  } else {
    console.error('ERROR: No credentials found.');
    process.exit(1);
  }
}

const db = getFirestore();
async function getMeiliClient() {
  const { Meilisearch } = require('meilisearch');
  const host = process.env.MEILI_URL;
  const apiKey = process.env.MEILI_API_KEY;
  if (!host) {
    throw new Error('MEILI_URL is required, for example http://localhost:7700.');
  }
  if (!apiKey) {
    throw new Error('MEILI_API_KEY is required and must permit index creation, settings, and document writes.');
  }
  return new Meilisearch({
    host,
    apiKey,
  });
}

async function waitForMeiliTask(taskPromise) {
  // Benchmarking and one-shot sync both need writes fully applied before continuing,
  // otherwise follow-up reads can measure queueing latency instead of index state.
  return taskPromise.waitTask();
}

async function setupMeili(client) {
  for (const name of ['messages', 'chats', 'contacts', 'groups']) {
    try { await waitForMeiliTask(client.deleteIndex(name)); } catch (_) {}
  }

  await waitForMeiliTask(client.createIndex('messages', { primaryKey: 'id' }));
  const msgIndex = client.index('messages');
  await waitForMeiliTask(msgIndex.updateSettings({
    searchableAttributes: ['content', 'documentName'],
    filterableAttributes: ['chatId', 'participants', 'createdAt'],
    sortableAttributes: ['createdAt'],
    displayedAttributes: ['id', 'content', 'documentName', 'chatId', 'participants', 'createdAt', 'senderId', 'mediaType', 'deliveredTo', 'readBy'],
  }));

  await waitForMeiliTask(client.createIndex('chats', { primaryKey: 'id' }));
  const chatIndex = client.index('chats');
  await waitForMeiliTask(chatIndex.updateSettings({
    searchableAttributes: ['groupName', 'participantNames'],
    filterableAttributes: ['participants'],
    sortableAttributes: ['updatedAt'],
    displayedAttributes: ['id', 'groupName', 'participantNames', 'participants', 'updatedAt', 'isGroup'],
  }));

  await waitForMeiliTask(client.createIndex('contacts', { primaryKey: 'id' }));
  const contactIndex = client.index('contacts');
  await waitForMeiliTask(contactIndex.updateSettings({
    searchableAttributes: ['username'],
    filterableAttributes: [],
    sortableAttributes: [],
    displayedAttributes: ['id', 'username'],
  }));

  await waitForMeiliTask(client.createIndex('groups', { primaryKey: 'id' }));
  const groupIndex = client.index('groups');
  await waitForMeiliTask(groupIndex.updateSettings({
    searchableAttributes: ['participantNames'],
    filterableAttributes: ['participants'],
    sortableAttributes: ['updatedAt'],
    displayedAttributes: ['id', 'participantNames', 'participants', 'updatedAt'],
  }));
}

async function pushMeiliMessages(client, docs) {
  const index = client.index('messages');
  for (let i = 0; i < docs.length; i += 1000) {
    const batch = docs.slice(i, i + 1000);
    await waitForMeiliTask(index.addDocuments(batch, { primaryKey: 'id' }));
  }
}

async function pushMeiliChats(client, docs) {
  if (docs.length === 0) return;
  await waitForMeiliTask(client.index('chats').addDocuments(docs, { primaryKey: 'id' }));
}

async function pushMeiliContacts(client, docs) {
  if (docs.length === 0) return;
  await waitForMeiliTask(client.index('contacts').addDocuments(docs, { primaryKey: 'id' }));
}

async function pushMeiliGroups(client, docs) {
  if (docs.length === 0) return;
  await waitForMeiliTask(client.index('groups').addDocuments(docs, { primaryKey: 'id' }));
}

(async () => {
  try {
    console.log('Search engine: Meilisearch\n');

     console.log('Loading users from Firestore...');
     const usersSnap = await db.collection('users').get();
     const usersMap = {};
     const missingUsernameUsers = [];
     usersSnap.forEach(doc => {
       const data = doc.data();
       const username = data.username || '';
       usersMap[doc.id] = { username, email: data.email || '', displayName: data.displayName || '' };
       if (!username) {
         missingUsernameUsers.push(doc.id);
       }
     });
     console.log(`Loaded ${Object.keys(usersMap).length} users.`);

     if (missingUsernameUsers.length > 0) {
       console.warn(`WARNING: ${missingUsernameUsers.length} users missing 'username' in Firestore: ${missingUsernameUsers.slice(0, 5).join(', ')}${missingUsernameUsers.length > 5 ? '...' : ''}`);
       console.warn('Attempting fallback: fetching displayName from Firebase Auth...');
       const auth = getAuth();
       for (const uid of missingUsernameUsers) {
         try {
           const record = await auth.getUser(uid);
           const displayName = record.displayName || record.email || '';
           if (displayName) {
             usersMap[uid].username = displayName;
             console.log(`  Fallback for ${uid}: ${displayName}`);
           }
         } catch (err) {
           console.warn(`  Could not fetch Auth record for ${uid}: ${err.message}`);
         }
       }
     }
     console.log();

    console.log('Loading chats from Firestore...');
    const chatsSnap = await db.collection('chats').get();
    const chatDocs = [];
    chatsSnap.forEach(doc => chatDocs.push({ id: doc.id, ...doc.data() }));
    console.log(`Found ${chatDocs.length} chats.\n`);

    const searchClient = await getMeiliClient();
    await setupMeili(searchClient);

    const allMessageDocs = [];
    const allChatDocs = [];
    const allContactDocs = [];
    const allGroupDocs = [];
    let totalSystemSkipped = 0;

    for (let c = 0; c < chatDocs.length; c++) {
      const chat = chatDocs[c];

      const updatedAt = chat.updatedAt?.toMillis
        ? chat.updatedAt.toMillis()
        : 0;

       const participants = chat.participants || [];
       const participantNames = participants.map(uid => {
         const name = usersMap[uid]?.username;
         if (!name) {
           console.warn(`  Chat ${chat.id}: participant ${uid} has no resolved username, using UID`);
           return uid;
         }
         return name;
       });

      if (chat.isGroup) {
        const groupName = chat.groupName || 'Unnamed Group';

        allGroupDocs.push({ id: chat.id, participants, participantNames, updatedAt });
        allChatDocs.push({ id: chat.id, groupName, isGroup: true, participants, participantNames, updatedAt });
      } else {
        allChatDocs.push({ id: chat.id, isGroup: false, participants, participantNames, updatedAt });
      }

      const messagesSnap = await db.collection('chats').doc(chat.id).collection('messages').get();
      let indexed = 0;
      let skipped = 0;

      messagesSnap.forEach(doc => {
        const msg = doc.data();
        if (msg.type === 'system') {
          skipped++;
          return;
        }

        const createdAt = msg.createdAt?.toMillis
          ? msg.createdAt.toMillis()
          : Date.now();
        const deliveredTo = Object.keys(msg.deliveredTo || {});
        const readBy = Object.keys(msg.readBy || {});

        const msgDoc = {
          id: doc.id,
          content: msg.content || '',
          senderId: msg.senderId || '',
          mediaType: msg.mediaType || '',
          documentName: msg.documentName || '',
          chatId: chat.id,
          participants,
          createdAt,
          deliveredTo,
          readBy,
        };
        allMessageDocs.push(msgDoc);
        indexed++;
      });

      totalSystemSkipped += skipped;
      const label = chat.isGroup ? (chat.groupName || 'Unnamed Group') : 'DM';
      console.log(`  Chat ${c + 1}/${chatDocs.length}: "${label}" → ${indexed} messages indexed${skipped > 0 ? ` (${skipped} system skipped)` : ''}`);
    }

     console.log(`\nBuilding contacts index...`);
     let emptyUsernameCount = 0;
     Object.entries(usersMap).forEach(([uid, user]) => {
       if (!user.username) {
         emptyUsernameCount++;
       }
       allContactDocs.push({ id: uid, username: user.username || uid });
     });
     if (emptyUsernameCount > 0) {
       console.warn(`WARNING: ${emptyUsernameCount} contacts have empty username, falling back to UID`);
     }
     console.log(`Loaded ${allContactDocs.length} contacts.\n`);

    console.log(`\nPushing ${allChatDocs.length} chats, ${allGroupDocs.length} groups, ${allContactDocs.length} contacts, and ${allMessageDocs.length} messages to Meilisearch...`);
    await pushMeiliChats(searchClient, allChatDocs);
    await pushMeiliGroups(searchClient, allGroupDocs);
    await pushMeiliContacts(searchClient, allContactDocs);
    await pushMeiliMessages(searchClient, allMessageDocs);

    console.log(`\nDone. ${allChatDocs.length} chats, ${allGroupDocs.length} groups, ${allContactDocs.length} contacts, ${allMessageDocs.length} messages indexed. ${totalSystemSkipped} system messages skipped.`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
