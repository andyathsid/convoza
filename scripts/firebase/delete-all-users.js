#!/usr/bin/env node

/**
 * Delete ALL Firebase Auth users (dry-run by default)
 *
 * Usage:
 *   node scripts/firebase/delete-all-users.js [--creds <path>] [--execute]
 *
 * Flags:
 *   --creds    Path to service account JSON (default: backend/firebase-service-account.json)
 *   --execute  Actually delete. Without this flag, only prints users that would be deleted.
 *
 * Credentials resolution order:
 *   1. --creds flag
 *   2. BACKEND_SA env var
 *   3. backend/firebase-service-account.json
 *   4. ./serviceAccountKey.json (relative to CWD)
 *   5. GOOGLE_APPLICATION_CREDENTIALS env var
 *
 * Requires:
 *   npm i firebase-admin
 */

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const path = require('path');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const EXECUTE = has('--execute');

// ── Resolve credentials ──────────────────────────────────────────────────────
const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_CREDS = path.join(PROJECT_ROOT, 'backend', 'firebase-service-account.json');

let credPath = null;

if (get('--creds')) {
  credPath = path.resolve(get('--creds'));
} else if (process.env.BACKEND_SA) {
  credPath = path.resolve(process.env.BACKEND_SA);
} else if (fs.existsSync(DEFAULT_CREDS)) {
  credPath = DEFAULT_CREDS;
} else if (fs.existsSync(path.resolve('./serviceAccountKey.json'))) {
  credPath = path.resolve('./serviceAccountKey.json');
}

// ── Init Firebase ────────────────────────────────────────────────────────────
if (getApps().length === 0) {
  if (credPath && fs.existsSync(credPath)) {
    console.error(`Using credentials: ${credPath}\n`);
    initializeApp({ credential: cert(credPath) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(`Using credentials: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}\n`);
    initializeApp();
  } else {
    console.error('ERROR: No credentials found. Tried:');
    console.error(`  --  ${DEFAULT_CREDS}`);
    console.error('  --  ./serviceAccountKey.json');
    console.error('  --  GOOGLE_APPLICATION_CREDENTIALS env var');
    console.error('Fix: pass --creds <path> or place file at either location above.');
    process.exit(1);
  }
}

const auth = getAuth();

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // List all users
  const allUsers = [];
  let nextPageToken;
  do {
    const result = await auth.listUsers(1000, nextPageToken);
    allUsers.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  if (allUsers.length === 0) {
    console.log('No users found. Nothing to do.');
    process.exit(0);
  }

  console.log(`\nFound ${allUsers.length} user(s):\n`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`${'UID'.padEnd(30)} ${'Email'.padEnd(35)} ${'Provider'.padEnd(15)}`);
  console.log(`${'─'.repeat(80)}`);

  for (const user of allUsers) {
    const provider = user.providerData.map(p => p.providerId).join(', ') || '(none)';
    console.log(`${user.uid.padEnd(30)} ${(user.email || '(no email)').padEnd(35)} ${provider.padEnd(15)}`);
  }

  console.log(`${'─'.repeat(80)}\n`);

  if (!EXECUTE) {
    console.log(`DRY RUN — no users deleted. Re-run with --execute to actually delete all ${allUsers.length} users.`);
    process.exit(0);
  }

  // Confirm
  console.log(`⚠️  About to DELETE ${allUsers.length} users. This is IRREVERSIBLE.`);

  // Delete in batches of 1000
  const uids = allUsers.map(u => u.uid);
  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < uids.length; i += 1000) {
    const batch = uids.slice(i, i + 1000);
    const result = await auth.deleteUsers(batch);
    deleted += batch.length - result.errors.length;
    errors += result.errors.length;
    for (const err of result.errors) {
      console.error(`  ✗ Failed to delete ${uids[i + err.index]}: ${err.error.message}`);
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, Errors: ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
})();
