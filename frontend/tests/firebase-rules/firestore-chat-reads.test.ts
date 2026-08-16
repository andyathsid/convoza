import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import { emulatorPorts } from "./emulator-config";

const projectId = "demo-chatapp-rules";
const aliceUid = "alice";
const bobUid = "bob";
const outsiderUid = "outsider";
const removedUid = "removed";
const activeChatId = "chat-active";
const outsiderChatId = "chat-outsider";
const removedChatId = "chat-removed";
const createdAt = Timestamp.fromMillis(1_700_000_000_000);
const laterCreatedAt = Timestamp.fromMillis(1_700_000_001_000);
const latestCreatedAt = Timestamp.fromMillis(1_700_000_002_000);

let testEnvironment: RulesTestEnvironment;

function activeMember(chatId: string, uid: string, hasUnread = false) {
  return {
    chatId,
    uid,
    role: uid === aliceUid ? "creator" : "member",
    joinedAt: createdAt,
    leftAt: null,
    removedBy: null,
    hasUnread,
    unreadCount: hasUnread ? 1 : 0,
    lastUnreadAt: hasUnread ? latestCreatedAt : null,
    latestUnreadMessageId: hasUnread ? "message-latest" : null,
  };
}

async function seedFixtures() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "users", aliceUid), { username: "Alice", email: "alice@example.com", avatar: "" }),
      setDoc(doc(firestore, "users", bobUid), { username: "Bob", email: "bob@example.com", avatar: "" }),
      setDoc(doc(firestore, "users", outsiderUid), { username: "Outsider", email: "outsider@example.com", avatar: "" }),
      setDoc(doc(firestore, "chats", activeChatId), {
        participants: [aliceUid, bobUid],
        isGroup: true,
        groupName: "Active group",
        createdAt,
        updatedAt: latestCreatedAt,
        lastMessage: { id: "message-latest", createdAt: latestCreatedAt },
      }),
      setDoc(doc(firestore, "chats", outsiderChatId), {
        participants: [outsiderUid],
        isGroup: false,
        createdAt,
        updatedAt: latestCreatedAt,
        lastMessage: { id: "outsider-message", createdAt: latestCreatedAt },
      }),
      setDoc(doc(firestore, "chats", removedChatId), {
        participants: [aliceUid],
        isGroup: true,
        createdAt,
        updatedAt: latestCreatedAt,
        lastMessage: { id: "removed-message", createdAt: latestCreatedAt },
      }),
      setDoc(doc(firestore, "chats", activeChatId, "members", aliceUid), activeMember(activeChatId, aliceUid, true)),
      setDoc(doc(firestore, "chats", activeChatId, "members", bobUid), activeMember(activeChatId, bobUid)),
      setDoc(doc(firestore, "chats", outsiderChatId, "members", outsiderUid), activeMember(outsiderChatId, outsiderUid, true)),
      setDoc(doc(firestore, "chats", removedChatId, "members", removedUid), {
        ...activeMember(removedChatId, removedUid),
        leftAt: laterCreatedAt,
        removedBy: aliceUid,
      }),
      setDoc(doc(firestore, "chats", activeChatId, "messages", "message-first"), {
        type: "text", content: "first", senderId: aliceUid, createdAt,
      }),
      setDoc(doc(firestore, "chats", activeChatId, "messages", "message-middle"), {
        type: "media", content: "photo", senderId: bobUid, mediaType: "image", createdAt: laterCreatedAt,
      }),
      setDoc(doc(firestore, "chats", activeChatId, "messages", "message-latest"), {
        type: "media", content: "document", senderId: aliceUid, mediaType: "document", createdAt: latestCreatedAt,
      }),
      setDoc(doc(firestore, "chats", outsiderChatId, "messages", "outsider-message"), {
        type: "text", content: "private", senderId: outsiderUid, createdAt,
      }),
      setDoc(doc(firestore, "chats", removedChatId, "messages", "removed-message"), {
        type: "text", content: "revoked", senderId: aliceUid, createdAt,
      }),
      setDoc(doc(firestore, "system", "search-sync"), { lastReconcileTime: latestCreatedAt }),
      setDoc(doc(firestore, "unknown", "known"), { seeded: true }),
    ]);
  });
}

describe("Firestore chat read Rules", () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: "127.0.0.1",
        port: emulatorPorts.firestore,
        rules: readFileSync("firestore.rules", "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    await seedFixtures();
  });

  after(async () => {
    await testEnvironment.cleanup();
  });

  it("allows authenticated profile reads and denies anonymous profiles", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).firestore();
    const anonymous = testEnvironment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(alice, "users", bobUid)));
    await assertSucceeds(getDocs(query(collection(alice, "users"), limit(20))));
    await assertFails(getDoc(doc(anonymous, "users", bobUid)));
  });

  it("permits the chat-list query, group variant, and cursor pagination only to participants", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).firestore();
    const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
    const activeChats = collection(alice, "chats");
    const firstPage = await assertSucceeds(getDocs(query(
      activeChats,
      where("participants", "array-contains", aliceUid),
      orderBy("updatedAt", "desc"),
      limit(1),
    )));

    await assertSucceeds(getDocs(query(
      activeChats,
      where("participants", "array-contains", aliceUid),
      where("isGroup", "==", true),
      orderBy("updatedAt", "desc"),
      limit(20),
    )));
    await assertSucceeds(getDocs(query(
      activeChats,
      where("participants", "array-contains", aliceUid),
      orderBy("updatedAt", "desc"),
      startAfter(firstPage.docs[0]),
      limit(20),
    )));
    await assertSucceeds(getDoc(doc(alice, "chats", activeChatId)));
    await assertFails(getDoc(doc(outsider, "chats", activeChatId)));
    await assertFails(getDocs(query(
      collection(outsider, "chats"),
      where("participants", "array-contains", aliceUid),
      orderBy("updatedAt", "desc"),
      limit(20),
    )));
  });

  it("permits group member lists to active participants and the unread collection-group index only to its owner", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).firestore();
    const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
    const removed = testEnvironment.authenticatedContext(removedUid).firestore();

    await assertSucceeds(getDoc(doc(alice, "chats", activeChatId, "members", aliceUid)));
    await assertSucceeds(getDocs(collection(alice, "chats", activeChatId, "members")));
    await assertFails(getDocs(collection(outsider, "chats", activeChatId, "members")));
    await assertFails(getDocs(collection(removed, "chats", removedChatId, "members")));

    const unreadQuery = query(
      collectionGroup(alice, "members"),
      where("uid", "==", aliceUid),
      where("leftAt", "==", null),
      where("hasUnread", "==", true),
      orderBy("lastUnreadAt", "desc"),
      limit(20),
    );
    const unreadPage = await assertSucceeds(getDocs(unreadQuery));
    await assertSucceeds(getCountFromServer(unreadQuery));
    await assertSucceeds(getDocs(query(
      collectionGroup(alice, "members"),
      where("uid", "==", aliceUid),
      where("leftAt", "==", null),
      where("hasUnread", "==", true),
      orderBy("lastUnreadAt", "desc"),
      startAfter(unreadPage.docs[0]),
      limit(20),
    )));
    await assertFails(getDocs(query(collectionGroup(alice, "members"), limit(20))));
    await assertFails(getDocs(query(
      collectionGroup(outsider, "members"),
      where("uid", "==", aliceUid),
      where("leftAt", "==", null),
      where("hasUnread", "==", true),
      orderBy("lastUnreadAt", "desc"),
      limit(20),
    )));
  });

  it("permits every message query shape to active participants", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).firestore();
    const messages = collection(alice, "chats", activeChatId, "messages");
    const descendingPage = await assertSucceeds(getDocs(query(messages, orderBy("createdAt", "desc"), limit(1))));
    const ascendingPage = await assertSucceeds(getDocs(query(messages, orderBy("createdAt", "asc"), limit(1))));

    await assertSucceeds(getDoc(doc(alice, "chats", activeChatId, "messages", "message-middle")));
    await assertSucceeds(getDocs(query(messages, orderBy("createdAt", "desc"), startAfter(descendingPage.docs[0]), limit(20))));
    await assertSucceeds(getDocs(query(messages, orderBy("createdAt", "asc"), startAfter(ascendingPage.docs[0]), limit(20))));
    await assertSucceeds(getDocs(query(messages, where(documentId(), "in", ["message-first", "message-middle"]), limit(20))));
    await assertSucceeds(getDocs(query(
      messages,
      where("createdAt", ">=", createdAt),
      where("createdAt", "<=", latestCreatedAt),
      orderBy("createdAt", "desc"),
      limit(20),
    )));
    await assertSucceeds(getDocs(query(
      messages,
      where("mediaType", "in", ["image", "video"]),
      orderBy("createdAt", "desc"),
      limit(20),
    )));
    await assertSucceeds(getDocs(query(
      messages,
      where("mediaType", "==", "document"),
      orderBy("createdAt", "desc"),
      limit(20),
    )));
    await assertSucceeds(getDocs(query(
      messages,
      where("mediaType", "==", "audio"),
      orderBy("createdAt", "desc"),
      limit(20),
    )));
  });

  it("denies anonymous, outsider, and removed-member reads from known protected paths", async () => {
    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
    const removed = testEnvironment.authenticatedContext(removedUid).firestore();

    await assertFails(getDoc(doc(anonymous, "chats", activeChatId)));
    await assertFails(getDoc(doc(outsider, "chats", activeChatId, "messages", "message-middle")));
    await assertFails(getDocs(query(
      collection(outsider, "chats", activeChatId, "messages"),
      orderBy("createdAt", "desc"),
      limit(20),
    )));
    await assertFails(getDoc(doc(removed, "chats", removedChatId)));
    await assertFails(getDoc(doc(removed, "chats", removedChatId, "messages", "removed-message")));
    await assertFails(getDoc(doc(anonymous, "system", "search-sync")));
    await assertFails(getDoc(doc(outsider, "unknown", "known")));
  });

  it("denies all direct client Firestore writes", async () => {
    const alice = testEnvironment.authenticatedContext(aliceUid).firestore();

    await assertFails(setDoc(doc(alice, "users", aliceUid), { username: "spoofed" }));
    await assertFails(updateDoc(doc(alice, "chats", activeChatId), { groupName: "spoofed" }));
    await assertFails(setDoc(doc(alice, "chats", activeChatId, "messages", "client-message"), { content: "spoofed" }));
    await assertFails(updateDoc(doc(alice, "chats", activeChatId, "members", aliceUid), { role: "admin" }));
    await assertFails(updateDoc(doc(alice, "chats", activeChatId, "messages", "message-first"), { readBy: { [aliceUid]: createdAt } }));
    await assertFails(setDoc(doc(alice, "system", "client-write"), { spoofed: true }));
    await assertFails(deleteDoc(doc(alice, "unknown", "known")));
  });
});
