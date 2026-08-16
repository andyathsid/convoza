import { after, before, beforeEach, describe, it } from "node:test";
import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  get,
  onDisconnect,
  ref as databaseRef,
  remove,
  serverTimestamp,
  set,
} from "firebase/database";
import { emulatorPorts } from "./emulator-config";

const projectId = "demo-chatapp-rules";
const aliceUid = "alice";
const bobUid = "bob";
const chatId = "chat-a";
const validSessionOne = "11111111-1111-4111-8111-111111111111";
const validSessionTwo = "22222222-2222-4222-8222-222222222222";
let testEnvironment: RulesTestEnvironment;

const onlineStatus = () => ({ state: "online", last_changed: serverTimestamp() });
const offlineStatus = () => ({ state: "offline", last_changed: serverTimestamp() });

async function setChatMembers(targetChatID: string, userIDs: string[]) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await Promise.all(
      userIDs.map((userID) =>
        set(databaseRef(context.database(), `chatMembers/${targetChatID}/${userID}`), true),
      ),
    );
  });
}

describe("Realtime Database presence and membership-scoped typing Rules", () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      database: {
        host: "127.0.0.1",
        port: emulatorPorts.database,
        rules: readFileSync("database.rules.json", "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearDatabase();
  });

  after(async () => {
    await testEnvironment.cleanup();
  });

  it("denies anonymous reads and writes to status and typing", async () => {
    const client = testEnvironment.unauthenticatedContext().database();

    await assertFails(get(databaseRef(client, "status")));
    await assertFails(set(databaseRef(client, `status/${aliceUid}`), onlineStatus()));
    await assertFails(get(databaseRef(client, `typing/${chatId}`)));
    await assertFails(set(databaseRef(client, `typing/${chatId}/${aliceUid}/${validSessionOne}`), serverTimestamp()));
  });

  it("allows an authenticated user to read the presence tree", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await set(databaseRef(context.database(), `status/${bobUid}`), {
        state: "online",
        last_changed: 1,
      });
    });
    const client = testEnvironment.authenticatedContext(aliceUid).database();

    const snapshot = await assertSucceeds(get(databaseRef(client, "status")));

    deepStrictEqual(snapshot.val(), {
      [bobUid]: { state: "online", last_changed: 1 },
    });
  });

  it("allows an authenticated user to write their complete online and offline status", async () => {
    const client = testEnvironment.authenticatedContext(aliceUid).database();
    const statusRef = databaseRef(client, `status/${aliceUid}`);

    await assertSucceeds(set(statusRef, onlineStatus()));
    await assertSucceeds(set(statusRef, offlineStatus()));
  });

  it("denies spoofed, deleted, malformed, and client-timestamp status writes", async () => {
    const client = testEnvironment.authenticatedContext(aliceUid).database();

    await assertFails(set(databaseRef(client, `status/${bobUid}`), onlineStatus()));
    await assertFails(remove(databaseRef(client, `status/${aliceUid}`)));
    await assertFails(set(databaseRef(client, `status/${aliceUid}`), {
      state: "away",
      last_changed: serverTimestamp(),
    }));
    await assertFails(set(databaseRef(client, `status/${aliceUid}`), {
      state: "online",
    }));
    await assertFails(set(databaseRef(client, `status/${aliceUid}`), {
      state: "online",
      last_changed: serverTimestamp(),
      extra: true,
    }));
    await assertFails(set(databaseRef(client, `status/${aliceUid}`), {
      state: "online",
      last_changed: 1,
    }));
  });

  it("allows a self-owned offline onDisconnect registration", async () => {
    const client = testEnvironment.authenticatedContext(aliceUid).database();
    const statusRef = databaseRef(client, `status/${aliceUid}`);
    const disconnect = onDisconnect(statusRef);

    await assertSucceeds(disconnect.set(offlineStatus()));
    await assertSucceeds(disconnect.cancel());
  });

  it("allows a user to create and remove their own typing session", async () => {
    await setChatMembers(chatId, [aliceUid]);
    const client = testEnvironment.authenticatedContext(aliceUid).database();
    const typingRef = databaseRef(client, `typing/${chatId}/${aliceUid}/${validSessionOne}`);

    await assertSucceeds(set(typingRef, serverTimestamp()));
    await assertSucceeds(remove(typingRef));
  });

  it("denies another user's typing session writes and deletes", async () => {
    await setChatMembers(chatId, [aliceUid, bobUid]);
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await set(
        databaseRef(context.database(), `typing/${chatId}/${bobUid}/${validSessionOne}`),
        1,
      );
    });
    const client = testEnvironment.authenticatedContext(aliceUid).database();
    const bobTypingRef = databaseRef(client, `typing/${chatId}/${bobUid}/${validSessionOne}`);

    await assertFails(set(bobTypingRef, serverTimestamp()));
    await assertFails(remove(bobTypingRef));
  });

  it("denies invalid typing IDs, values, and parent-level writes", async () => {
    await setChatMembers(chatId, [aliceUid]);
    const client = testEnvironment.authenticatedContext(aliceUid).database();

    await assertFails(set(databaseRef(client, `typing/${chatId}/${aliceUid}/not-a-uuid`), serverTimestamp()));
    await assertFails(set(databaseRef(client, `typing/${chatId}/${aliceUid}/${validSessionOne}`), "typing"));
    await assertFails(set(databaseRef(client, `typing/${chatId}/${aliceUid}/${validSessionOne}`), 1));
    await assertFails(set(databaseRef(client, `typing/${chatId}/${aliceUid}/${validSessionOne}`), {
      startedAt: serverTimestamp(),
    }));
    await assertFails(set(databaseRef(client, `typing/${chatId}/${aliceUid}`), {
      [validSessionOne]: serverTimestamp(),
    }));
  });

  it("allows two sessions for the same user without overwriting either session", async () => {
    await setChatMembers(chatId, [aliceUid]);
    const firstTab = testEnvironment.authenticatedContext(aliceUid).database();
    const secondTab = testEnvironment.authenticatedContext(aliceUid).database();

    await Promise.all([
      assertSucceeds(set(databaseRef(firstTab, `typing/${chatId}/${aliceUid}/${validSessionOne}`), serverTimestamp())),
      assertSucceeds(set(databaseRef(secondTab, `typing/${chatId}/${aliceUid}/${validSessionTwo}`), serverTimestamp())),
    ]);

    const snapshot = await assertSucceeds(get(databaseRef(firstTab, `typing/${chatId}/${aliceUid}`)));
    const sessions = snapshot.val() as Record<string, number>;

    deepStrictEqual(Object.keys(sessions).sort(), [validSessionOne, validSessionTwo]);
  });

  it("allows a chat member to read typing for that chat", async () => {
    await setChatMembers(chatId, [aliceUid, bobUid]);
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await set(
        databaseRef(context.database(), `typing/${chatId}/${bobUid}/${validSessionOne}`),
        1,
      );
    });
    const client = testEnvironment.authenticatedContext(aliceUid).database();

    const snapshot = await assertSucceeds(get(databaseRef(client, `typing/${chatId}`)));

    deepStrictEqual(snapshot.val(), {
      [bobUid]: { [validSessionOne]: 1 },
    });
  });

  it("denies typing reads and writes to outsiders and members of another chat", async () => {
    const otherChatID = "chat-b";
    await setChatMembers(chatId, [aliceUid, bobUid]);
    await setChatMembers(otherChatID, [bobUid]);
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await set(
        databaseRef(context.database(), `typing/${chatId}/${bobUid}/${validSessionOne}`),
        1,
      );
    });

    const outsider = testEnvironment.authenticatedContext("outsider").database();
    const alice = testEnvironment.authenticatedContext(aliceUid).database();

    await assertFails(get(databaseRef(outsider, `typing/${chatId}`)));
    await assertFails(set(
      databaseRef(outsider, `typing/${chatId}/outsider/${validSessionOne}`),
      serverTimestamp(),
    ));
    await assertFails(get(databaseRef(alice, `typing/${otherChatID}`)));
    await assertFails(set(
      databaseRef(alice, `typing/${otherChatID}/${aliceUid}/${validSessionOne}`),
      serverTimestamp(),
    ));
  });

  it("revokes typing access as soon as a member mirror entry is removed", async () => {
    await setChatMembers(chatId, [aliceUid]);
    const alice = testEnvironment.authenticatedContext(aliceUid).database();

    await assertSucceeds(get(databaseRef(alice, `typing/${chatId}`)));

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await remove(databaseRef(context.database(), `chatMembers/${chatId}/${aliceUid}`));
    });

    await assertFails(get(databaseRef(alice, `typing/${chatId}`)));
    await assertFails(set(
      databaseRef(alice, `typing/${chatId}/${aliceUid}/${validSessionOne}`),
      serverTimestamp(),
    ));
  });

  it("denies all client access to chat membership mirrors", async () => {
    await setChatMembers(chatId, [aliceUid]);
    const alice = testEnvironment.authenticatedContext(aliceUid).database();

    await assertFails(get(databaseRef(alice, `chatMembers/${chatId}`)));
    await assertFails(set(databaseRef(alice, `chatMembers/${chatId}/${aliceUid}`), true));
    await assertFails(remove(databaseRef(alice, `chatMembers/${chatId}/${aliceUid}`)));
  });
});
