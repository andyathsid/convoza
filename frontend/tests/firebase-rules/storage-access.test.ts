import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, doc, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, listAll, ref as storageRef, uploadBytes } from "firebase/storage";
import { emulatorPorts } from "./emulator-config";

const projectId = "demo-chatapp-rules";
const aliceUid = "alice";
const bobUid = "bob";
const outsiderUid = "outsider";
const removedUid = "removed";
const chatId = "chat-active";
const seededFileId = "44444444-4444-4444-8444-444444444444";
const joinedAt = Timestamp.fromMillis(1_700_000_000_000);
const leftAt = Timestamp.fromMillis(1_700_000_001_000);

let testEnvironment: RulesTestEnvironment;

function member(uid: string, removed = false) {
  return { chatId, uid, role: uid === aliceUid ? "creator" : "member", joinedAt, leftAt: removed ? leftAt : null, removedBy: removed ? aliceUid : null };
}

async function seedFixtures() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "chats", chatId), { isGroup: true, participants: [aliceUid, bobUid] }),
      setDoc(doc(firestore, "chats", chatId, "members", aliceUid), member(aliceUid)),
      setDoc(doc(firestore, "chats", chatId, "members", bobUid), member(bobUid)),
      setDoc(doc(firestore, "chats", chatId, "members", removedUid), member(removedUid, true)),
      uploadBytes(storageRef(context.storage(), `users/${aliceUid}/avatar/${seededFileId}`), new Uint8Array([1]), { contentType: "image/jpeg" }),
      uploadBytes(storageRef(context.storage(), `chats/${chatId}/media/${aliceUid}/${seededFileId}`), new Uint8Array([1]), { contentType: "image/jpeg" }),
    ]);
  });
}

describe("Cloud Storage server-write Rules", () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: { host: "127.0.0.1", port: emulatorPorts.firestore, rules: readFileSync("firestore.rules", "utf8") },
      storage: { host: "127.0.0.1", port: emulatorPorts.storage, rules: readFileSync("storage.rules", "utf8") },
    });
  });

  beforeEach(async () => {
    await Promise.all([testEnvironment.clearFirestore(), testEnvironment.clearStorage()]);
    await seedFixtures();
  });

  after(async () => { await testEnvironment.cleanup(); });

  it("keeps authenticated reads scoped while server-created objects remain readable", async () => {
    const bob = testEnvironment.authenticatedContext(bobUid).storage();
    const outsider = testEnvironment.authenticatedContext(outsiderUid).storage();
    const removed = testEnvironment.authenticatedContext(removedUid).storage();
    const avatar = storageRef(bob, `users/${aliceUid}/avatar/${seededFileId}`);
    const mediaPath = `chats/${chatId}/media/${aliceUid}/${seededFileId}`;
    await assertSucceeds(getBytes(avatar));
    await assertSucceeds(getBytes(storageRef(bob, mediaPath)));
    await assertFails(getBytes(storageRef(outsider, mediaPath)));
    await assertFails(getBytes(storageRef(removed, mediaPath)));
  });

  it("denies every client Storage mutation, including uploads by authorized members", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).storage();
    const paths = [
      `users/${aliceUid}/avatar/11111111-1111-4111-8111-111111111111`,
      `chats/${chatId}/media/${aliceUid}/22222222-2222-4222-8222-222222222222`,
      `chats/${chatId}/thumbnails/${aliceUid}/33333333-3333-4333-8333-333333333333`,
      `chats/${chatId}/avatar/${aliceUid}/55555555-5555-4555-8555-855555555555`,
    ];
    for (const path of paths) await assertFails(uploadBytes(storageRef(alice, path), new Uint8Array([1]), { contentType: "image/jpeg" }));
  });

  it("continues to deny overwrite, delete, and listing", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).storage();
    const media = storageRef(alice, `chats/${chatId}/media/${aliceUid}/${seededFileId}`);
    await assertFails(uploadBytes(media, new Uint8Array([1]), { contentType: "image/jpeg" }));
    await assertFails(deleteObject(media));
    await assertFails(listAll(storageRef(alice, `chats/${chatId}/media/${aliceUid}`)));
  });
});
