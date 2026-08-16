#!/usr/bin/env node

/**
 * Firestore Schema + Data Dumper
 *
 * Usage:
 *   node scripts/firebase/dump-firestore-schema.js [--creds <path>] [--sample <n>] [--json]
 *
 * Flags:
 *   --creds    Path to service account JSON (default: backend/firebase-service-account.json)
 *   --sample   Max docs per collection to scan (default: 5)
 *   --json     Output raw JSON tree instead of pretty text
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
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const SAMPLE = parseInt(get('--sample') || '1', 10);
const OUTPUT_JSON = has('--json');

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

const db = getFirestore();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return a type descriptor for a single value. */
function typeOf(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (val instanceof Timestamp) return 'Timestamp';
  if (val instanceof Date) return 'Date';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'Array<empty>';
    // Unify array element types
    const types = [...new Set(val.map(typeOf))];
    return `Array<${types.join('|')}>[${val.length}]`;
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return 'Object{}';
    return `Object{${keys.length} fields}`;
  }
  return typeof val;
}

/** Recursively describe a single value's shape (nested objects expanded). */
function schemaOf(val, depth = 0, maxDepth = 4) {
  if (depth >= maxDepth) return typeOf(val);
  if (val === null) return null;
  if (val === undefined) return undefined;
  if (val instanceof Timestamp) return 'Timestamp';
  if (val instanceof Date) return 'Date';
  if (typeof val !== 'object') return typeof val;

  if (Array.isArray(val)) {
    if (val.length === 0) return 'Array<empty>';
    if (depth + 1 >= maxDepth) return `Array<${typeOf(val[0])}>[${val.length}]`;
    // Show up to 3 sample element shapes
    const samples = val.slice(0, 3).map((v) => schemaOf(v, depth + 1, maxDepth));
    const suffix = val.length > 3 ? `…+${val.length - 3} more` : '';
    return `Array[samples: ${samples.join(', ')}${suffix}]`;
  }

  // Plain object → expand fields
  const keys = Object.keys(val);
  if (keys.length === 0) return {};
  const fields = {};
  for (const k of keys) fields[k] = schemaOf(val[k], depth + 1, maxDepth);
  return fields;
}

/** Merge two schema trees: union of keys, union of types for same key. */
function mergeSchema(a, b) {
  // Handle actual null values (from schemaOf returning null for null fields)
  if (a === null && b === null) return null;
  if (a === null) return b; // null + object → object (fields expand, nullability implicit)
  if (b === null) return a;
  // Handle undefined
  if (a === undefined) return b;
  if (b === undefined) return a;
  // Both non-null, non-undefined
  if (typeof a !== 'object' || typeof b !== 'object') {
    if (a === b) return a;
    return [a, b].filter((v, i, arr) => arr.indexOf(v) === i).join(' | ');
  }
  if (Array.isArray(a) && Array.isArray(b)) return a; // keep first
  // Both plain objects
  const merged = { ...a };
  for (const [k, v] of Object.entries(b)) {
    merged[k] = k in merged ? mergeSchema(merged[k], v) : v;
  }
  return merged;
}

/** Build a unified schema from an array of doc data objects. */
function unifiedSchema(docs) {
  let schema = {};
  for (const data of docs) {
    const s = schemaOf(data, 0, 4);
    schema = mergeSchema(schema, s);
  }
  return schema;
}

/** Format a schema tree into indented lines. */
function formatSchema(schema, indent = 0) {
  const pad = '    '.repeat(indent);
  if (schema === null) return [`${pad}null`];
  if (schema === undefined) return [`${pad}undefined`];
  if (typeof schema === 'string') return [`${pad}${schema}`];
  if (typeof schema === 'number' || typeof schema === 'boolean') return [`${pad}${schema}`];
  if (Array.isArray(schema)) return [`${pad}${schema.join(', ')}`];
  if (typeof schema === 'object') {
    const lines = [];
    for (const [k, v] of Object.entries(schema)) {
      if (typeof v === 'object' && v !== null) {
        lines.push(`${pad}${k}:`);
        lines.push(...formatSchema(v, indent + 1));
      } else {
        lines.push(`${pad}${k}: ${v}`);
      }
    }
    return lines;
  }
  return [`${pad}${String(schema)}`];
}

// ── Recursive dump ───────────────────────────────────────────────────────────
async function dumpCollection(collRef, depth, visited) {
  const collPath = collRef.path;
  if (visited.has(collPath)) return { _ref: collPath, note: '(recursive ref, skipped)' };
  visited.add(collPath);

  const snap = await collRef.get();

  // Count subcollections per doc (parallel), keep refs for reuse
  const docMeta = await Promise.all(
    snap.docs.map(async (doc) => {
      const subs = await doc.ref.listCollections();
      return { doc, subs };
    })
  );

  // Sort by subcollection count descending, take top SAMPLE
  docMeta.sort((a, b) => b.subs.length - a.subs.length);
  const topDocs = docMeta.slice(0, SAMPLE);

  // Collect ALL doc data for unified schema, but only expand subcollections for top docs
  const allData = snap.docs.map((d) => d.data());
  const schema = unifiedSchema(allData);

  const docs = [];
  for (const { doc, subs } of topDocs) {
    const entry = {
      _id: doc.id,
    };

    if (subs.length > 0) {
      entry._subcollections = {};
      for (const sub of subs) {
        entry._subcollections[sub.id] = await dumpCollection(sub, depth + 1, visited);
      }
    }

    docs.push(entry);
  }

  return {
    _path: collPath,
    _totalDocs: snap.size,
    _schema: schema,
    _sample: docs,
  };
}

// ── Pretty printer ───────────────────────────────────────────────────────────
function printTree(node, indent = 0) {
  const pad = '  '.repeat(indent);

  if (Array.isArray(node)) {
    for (const doc of node) {
      console.log(`${pad}📄 ${doc._id}`);
      if (doc._subcollections) {
        for (const [name, sub] of Object.entries(doc._subcollections)) {
          console.log(`${pad}  📁 ${name}/`);
          printTree(sub, indent + 2);
        }
      }
    }
    return;
  }

  if (node._path) {
    const short = node._path.split('/').pop();
    console.log(`${pad}📁 ${short}/  (${node._sample.length} of ${node._totalDocs} docs, most subcollections first)`);

    // Print unified schema derived from ALL docs
    if (node._schema && typeof node._schema === 'object' && Object.keys(node._schema).length > 0) {
      console.log(`${pad}  ── schema (merged from ${node._totalDocs} docs) ──`);
      for (const line of formatSchema(node._schema, 0)) {
        console.log(`${pad}  ${line}`);
      }
    }

    if (node._sample) printTree(node._sample, indent + 1);
    return;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n🔥 Firestore Schema Dump (top ${SAMPLE} docs/coll by subcollection count)\n${'─'.repeat(50)}\n`);

  const topColls = await db.listCollections();

  if (OUTPUT_JSON) {
    const tree = {};
    for (const coll of topColls) {
      tree[coll.id] = await dumpCollection(coll, 0, new Set());
    }
    console.log(JSON.stringify(tree, null, 2));
  } else {
    for (const coll of topColls) {
      const node = await dumpCollection(coll, 0, new Set());
      printTree(node, 0);
      console.log('');
    }
  }

  process.exit(0);
})();
