#!/usr/bin/env node

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
const auth = getAuth();

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, 'backend', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const CHAT_COUNT = 20;
const DM_COUNT = 10;
const GROUP_COUNT = 10;
const MESSAGES_PER_CHAT = 500;
const USER_COUNT = 30;

const SUPER_USER = { username: 'SearchBot', email: 'searchbot.search@test.com' };

const USERNAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank',
  'Ivy', 'Jack', 'Karen', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul',
  'Quinn', 'Ryan', 'Sara', 'Tom', 'Uma', 'Victor', 'Wendy', 'Xander',
  'Yara', 'Zane', 'Aria', 'Blake', 'Cora', 'Derek',
];

const TEMPLATES = [
  "Hey, how are you doing?",
  "Are you coming to the meeting today?",
  "I just sent you the files you requested.",
  "Let's grab lunch together.",
  "Did you see the new project update?",
  "Can you review my pull request?",
  "The deployment went smoothly.",
  "I'll be late to the office today.",
  "Happy birthday! Hope you have a great day.",
  "Thanks for your help yesterday.",
  "Let me know when you're free to talk.",
  "I'm working on the bug fix right now.",
  "The client approved the design.",
  "Meeting rescheduled to 3 PM.",
  "Great job on the presentation!",
];

const GROUP_NAMES = [
  'Project Alpha', 'Design Team', 'Engineering', 'Marketing Hub',
  'Sales Squad', 'DevOps Crew', 'Product Team', 'Support Group',
  'Leadership', 'Random Chat',
];

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

let pgClient;

async function initPG() {
  pgClient = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL_MODE === 'require' ? { rejectUnauthorized: false } : false,
  });
  await pgClient.connect();
  console.log('Connected to PostgreSQL\n');
}

async function createUsers() {
  console.log(`Creating super user + ${USER_COUNT} regular users...`);
  const users = [];

  const superFirebaseUser = await auth.createUser({
    email: SUPER_USER.email,
    password: 'Password123!',
    displayName: SUPER_USER.username,
  });
  const superUid = superFirebaseUser.uid;

  await pgClient.query(
    `INSERT INTO users (id, username, email, avatar, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [superUid, SUPER_USER.username, SUPER_USER.email, '']
  );

  await db.collection('users').doc(superUid).set({
    email: SUPER_USER.email,
    avatar: '',
    username: SUPER_USER.username,
    updatedAt: Timestamp.fromDate(new Date()),
    online: false,
    last_changed: Timestamp.fromDate(new Date()),
  });

  const superUser = { uid: superUid, username: SUPER_USER.username, email: SUPER_USER.email, avatar: '' };
  users.push(superUser);
  console.log(`  Super user: ${SUPER_USER.username} (${superUid})`);

  for (let i = 0; i < USER_COUNT; i++) {
    const username = USERNAMES[i];
    const email = `${username.toLowerCase()}.search@test.com`;
    const password = 'Password123!';

    const firebaseUser = await auth.createUser({
      email,
      password,
      displayName: username,
    });
    const uid = firebaseUser.uid;

    await pgClient.query(
      `INSERT INTO users (id, username, email, avatar, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [uid, username, email, '']
    );

    await db.collection('users').doc(uid).set({
      email,
      avatar: '',
      username,
      updatedAt: Timestamp.fromDate(new Date()),
      online: false,
      last_changed: Timestamp.fromDate(new Date()),
    });

    users.push({ uid, username, email, avatar: '' });
    console.log(`  User ${i + 1}/${USER_COUNT}: ${username} (${uid})`);
  }

  console.log(`Done creating users.\n`);
  return users;
}

async function createChats(users) {
  console.log(`Creating ${CHAT_COUNT} chats (super user in all)...`);
  const chats = [];
  const superUser = users[0];
  const regularUsers = users.slice(1);

  for (let i = 0; i < DM_COUNT; i++) {
    const otherUser = regularUsers[i];
    const chatId = require('crypto').randomUUID();
    const now = Timestamp.fromDate(new Date());

    await db.collection('chats').doc(chatId).set({
      isGroup: false,
      groupName: '',
      createdBy: superUser.uid,
      initiator: superUser.uid,
      createdAt: now,
      participants: [superUser.uid, otherUser.uid],
      lastMessage: null,
      updatedAt: now,
      groupAvatar: '',
    });

    await db.collection('chats').doc(chatId).collection('members').doc(superUser.uid).set({
      role: 'admin',
      joinedAt: now,
      leftAt: null,
      removedBy: null,
      uid: superUser.uid,
    });
    await db.collection('chats').doc(chatId).collection('members').doc(otherUser.uid).set({
      role: 'member',
      joinedAt: now,
      leftAt: null,
      removedBy: null,
      uid: otherUser.uid,
    });

    chats.push({ chatId, isGroup: false, participants: [superUser, otherUser] });
  }

  for (let i = 0; i < GROUP_COUNT; i++) {
    const memberCount = randInt(4, 8);
    const shuffledRegular = [...regularUsers].sort(() => Math.random() - 0.5);
    const otherMembers = shuffledRegular.slice(0, memberCount - 1);
    const members = [superUser, ...otherMembers];
    const chatId = require('crypto').randomUUID();
    const now = Timestamp.fromDate(new Date());

    await db.collection('chats').doc(chatId).set({
      isGroup: true,
      groupName: GROUP_NAMES[i],
      createdBy: superUser.uid,
      initiator: superUser.uid,
      createdAt: now,
      participants: members.map(m => m.uid),
      groupAvatar: '',
      lastMessage: null,
      updatedAt: now,
    });

    for (let j = 0; j < members.length; j++) {
      await db.collection('chats').doc(chatId).collection('members').doc(members[j].uid).set({
        role: j === 0 ? 'admin' : 'member',
        joinedAt: now,
        leftAt: null,
        removedBy: null,
        uid: members[j].uid,
      });
    }

    chats.push({ chatId, isGroup: true, participants: members, groupName: GROUP_NAMES[i] });
  }

  console.log(`Done. ${DM_COUNT} DMs + ${GROUP_COUNT} groups (super user in all).\n`);
  return chats;
}

async function generateMessages(chats, users) {
  const usersMap = {};
  for (const u of users) usersMap[u.uid] = u;

  console.log(`Generating ${CHAT_COUNT * MESSAGES_PER_CHAT} messages...`);

  for (let c = 0; c < chats.length; c++) {
    const chat = chats[c];
    const messagesRef = db.collection('chats').doc(chat.chatId).collection('messages');
    const participantUids = chat.participants.map(p => p.uid);

    const baseTime = new Date();
    baseTime.setMinutes(baseTime.getMinutes() - MESSAGES_PER_CHAT);

    let lastMsg = null;
    let batch = db.batch();
    let ops = 0;

    for (let m = 0; m < MESSAGES_PER_CHAT; m++) {
      const senderUid = pickRandom(participantUids);
      const sender = usersMap[senderUid];
      const createdAt = Timestamp.fromDate(new Date(baseTime.getTime() + (m + 1) * 60000));

      const msgData = {
        type: 'text',
        content: pickRandom(TEMPLATES),
        senderId: senderUid,
        createdAt,
      };

      batch.set(messagesRef.doc(), msgData);
      ops++;

      lastMsg = { content: msgData.content, senderId: senderUid, createdAt };

      if (ops >= 500) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();

    if (lastMsg) {
      const sender = usersMap[lastMsg.senderId];
      await db.collection('chats').doc(chat.chatId).update({
        lastMessage: {
          content: lastMsg.content,
          senderId: lastMsg.senderId,
          senderName: sender.username,
          senderAvatar: sender.avatar,
          createdAt: lastMsg.createdAt,
          mediaUrl: '',
          mediaType: '',
          thumbnailUrl: '',
        },
        updatedAt: lastMsg.createdAt,
      });
    }

    console.log(`  Chat ${c + 1}/${CHAT_COUNT}: ${chat.isGroup ? chat.groupName : chat.participants.map(p => p.username).join(' & ')} → ${MESSAGES_PER_CHAT} messages`);
  }

  console.log(`\nDone. ${CHAT_COUNT * MESSAGES_PER_CHAT} messages written.`);
}

(async () => {
  try {
    await initPG();
    const users = await createUsers();
    const chats = await createChats(users);
    await generateMessages(chats, users);
    await pgClient.end();
    console.log('\nAll done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    if (pgClient) await pgClient.end().catch(() => {});
    process.exit(1);
  }
})();
