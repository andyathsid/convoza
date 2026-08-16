#!/usr/bin/env node

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── CONFIG ──
const CHAT_ID = '14d238a8-7bd2-43cb-851c-19ca6bd31b25';
const USER_A_ID = 'svCgrBIjbrN64h4rDy2TooJWg9q2';
const USER_B_ID = 'BcKI9pzihLQPlJ922LyBWWa4fMD3';
const USER_A_NAME = 'SearchBot';
const USER_B_NAME = 'Alice';
const USER_A_AVATAR = '';
const USER_B_AVATAR = '';
const MESSAGE_COUNT = 500;
// ── END CONFIG ──

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const DEFAULT_CREDS = path.join(PROJECT_ROOT, 'backend', 'firebase-service-account.json');
const SAMPLES_DIR = path.join(SCRIPT_DIR, 'samples');

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

const users = {
  [USER_A_ID]: { name: USER_A_NAME, avatar: USER_A_AVATAR },
  [USER_B_ID]: { name: USER_B_NAME, avatar: USER_B_AVATAR },
};

const senderIds = [USER_A_ID, USER_B_ID];

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function uploadSamples() {
  let sampleUrls = [];

  try {
    const { getStorage } = require('firebase-admin/storage');
    const bucket = getStorage().bucket('andyathsid-hin-probation.firebasestorage.app');

    const files = fs.readdirSync(SAMPLES_DIR).filter(f =>
      IMAGE_EXTS.has(path.extname(f).toLowerCase())
    );

    if (files.length === 0) {
      console.error('No image files found in scripts/fixtures/samples/.');
      return sampleUrls;
    }

    console.log(`Uploading ${files.length} sample images to Firebase Storage...`);

    for (const file of files) {
      const localPath = path.join(SAMPLES_DIR, file);
      const dest = `seed-samples/${file}`;
      await bucket.upload(localPath, { destination: dest });
      const [signedUrl] = await bucket.file(dest).getSignedUrl({
        action: 'read',
        expires: '01-01-2030',
      });
      sampleUrls.push(signedUrl);
    }

    console.log(`Uploaded ${sampleUrls.length} images.`);
  } catch (err) {
    console.error('Storage upload failed (maybe Storage not enabled). Using placeholder URLs.', err.message);
    sampleUrls = ['https://via.placeholder.com/400'];
  }

  return sampleUrls;
}

(async () => {
  const chatRef = db.collection('chats').doc(CHAT_ID);
  const messagesRef = chatRef.collection('messages');

  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    console.error(`Chat ${CHAT_ID} not found.`);
    process.exit(1);
  }

  const mediaUrls = await uploadSamples();

  console.log(`Generating ${MESSAGE_COUNT} messages...`);

  const baseTime = new Date();
  baseTime.setMinutes(baseTime.getMinutes() - MESSAGE_COUNT);

  let lastMsgData = null;
  let batch = db.batch();
  let ops = 0;
  let globalIdx = 0;

  function writeMessage(msgData) {
    batch.set(messagesRef.doc(), msgData);
    ops++;
  }

  function makeTextMsg(content, senderId, senderName, senderAvatar, createdAt) {
    return {
      createdAt: Timestamp.fromDate(createdAt),
      type: 'text',
      content,
      senderId,
      senderName,
      senderAvatar,
      deliveredTo: {},
      readBy: {},
    };
  }

  function makeMediaMsg(mediaUrl, senderId, senderName, senderAvatar, createdAt, caption, groupId, groupIndex) {
    const msg = {
      createdAt: Timestamp.fromDate(createdAt),
      type: 'media',
      mediaType: 'image',
      mediaUrl,
      content: caption || '',
      senderId,
      senderName,
      senderAvatar,
      deliveredTo: {},
      readBy: {},
    };
    if (groupId != null) {
      msg.groupId = groupId;
      msg.groupIndex = groupIndex != null ? groupIndex : 0;
    }
    return msg;
  }

  while (globalIdx < MESSAGE_COUNT) {
    const senderId = senderIds[globalIdx % 2];
    const user = users[senderId];
    const createdAt = new Date(baseTime.getTime() + (globalIdx + 1) * 60_000);

    const roll = Math.random();
    const remaining = MESSAGE_COUNT - globalIdx;

    // ~60% text, ~40% media
    if (roll < 0.6 || mediaUrls.length === 0) {
      const msg = makeTextMsg(`Test pesan ke-${globalIdx + 1}`, senderId, user.name, user.avatar, createdAt);
      writeMessage(msg);
      lastMsgData = { content: msg.content, senderId, senderName: user.name, createdAt: msg.createdAt };
      globalIdx++;
      continue;
    }

    // Media: 35% single no caption, 20% single with caption, 45% group (2-3)
    const mediaRoll = Math.random();
    const imgUrl = pickRandom(mediaUrls);

    if (mediaRoll < 0.35) {
      // Single image, no caption
      const msg = makeMediaMsg(imgUrl, senderId, user.name, user.avatar, createdAt, '');
      writeMessage(msg);
      lastMsgData = { content: 'Photo', senderId, senderName: user.name, createdAt: msg.createdAt };
      globalIdx++;
    } else if (mediaRoll < 0.55) {
      // Single image with caption
      const captions = ['Lucu banget', 'Wah keren', 'LOL', 'Nice', '🗿', '🔥', 'Mantap', '👀'];
      const caption = pickRandom(captions);
      const msg = makeMediaMsg(imgUrl, senderId, user.name, user.avatar, createdAt, caption);
      writeMessage(msg);
      lastMsgData = { content: caption, senderId, senderName: user.name, createdAt: msg.createdAt };
      globalIdx++;
    } else {
      // Group of 2-3 images
      const groupSize = remaining >= 3 ? (Math.random() < 0.5 ? 2 : 3) : Math.min(remaining, 2);
      const groupId = crypto.randomUUID();

      for (let j = 0; j < groupSize; j++) {
        const ts = new Date(baseTime.getTime() + (globalIdx + 1) * 60_000);
        const gImgUrl = pickRandom(mediaUrls);
        const msg = makeMediaMsg(gImgUrl, senderId, user.name, user.avatar, ts, '', groupId, j);
        writeMessage(msg);
        if (j === groupSize - 1) {
          lastMsgData = { content: '', senderId, senderName: user.name, createdAt: msg.createdAt };
        }
        globalIdx++;
      }
    }

    if (ops >= 500) {
      await batch.commit();
      console.log(`  Committed ${ops} messages...`);
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
    console.log(`  Committed last ${ops} messages.`);
  }

  await chatRef.update({
    lastMessage: lastMsgData,
    updatedAt: Timestamp.fromDate(new Date()),
  });

  console.log(`Done. ${MESSAGE_COUNT} messages written.`);
  process.exit(0);
})();
