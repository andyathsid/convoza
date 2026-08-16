import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { get, ref as databaseRef, set as setDatabaseValue } from "firebase/database";
import { getBytes, ref as storageRef, uploadBytes } from "firebase/storage";
import { emulatorPorts } from "./emulator-config";

const projectId = "demo-chatapp-rules";
let testEnvironment: RulesTestEnvironment;

async function seedUnknownResources() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), "unknown", "known"), { seeded: true }),
      setDatabaseValue(databaseRef(context.database(), "unknown/known"), { seeded: true }),
      uploadBytes(storageRef(context.storage(), "unknown/known.txt"), new Uint8Array([1])),
    ]);
  });
}

describe("default-deny Firebase Rules foundation", () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: "127.0.0.1",
        port: emulatorPorts.firestore,
        rules: readFileSync("firestore.rules", "utf8"),
      },
      database: {
        host: "127.0.0.1",
        port: emulatorPorts.database,
        rules: readFileSync("database.rules.json", "utf8"),
      },
      storage: {
        host: "127.0.0.1",
        port: emulatorPorts.storage,
        rules: readFileSync("storage.rules", "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await Promise.all([
      testEnvironment.clearFirestore(),
      testEnvironment.clearDatabase(),
      testEnvironment.clearStorage(),
    ]);
  });

  after(async () => {
    await testEnvironment.cleanup();
  });

  it("seeds fixtures through the Rules-disabled setup context", async () => {
    await seedUnknownResources();
  });

  it("denies an anonymous Firestore read from an unknown collection", async () => {
    await seedUnknownResources();
    const client = testEnvironment.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(client, "unknown", "known")));
  });

  it("denies an authenticated Firestore read from an unknown collection", async () => {
    await seedUnknownResources();
    const client = testEnvironment.authenticatedContext("outsider").firestore();

    await assertFails(getDoc(doc(client, "unknown", "known")));
  });

  it("denies an anonymous Realtime Database read from an unknown root", async () => {
    await seedUnknownResources();
    const client = testEnvironment.unauthenticatedContext().database();

    await assertFails(get(databaseRef(client, "unknown/known")));
  });

  it("denies an authenticated Realtime Database read from an unknown root", async () => {
    await seedUnknownResources();
    const client = testEnvironment.authenticatedContext("outsider").database();

    await assertFails(get(databaseRef(client, "unknown/known")));
  });

  it("denies an anonymous Storage read from an unknown path", async () => {
    await seedUnknownResources();
    const client = testEnvironment.unauthenticatedContext().storage();

    await assertFails(getBytes(storageRef(client, "unknown/known.txt")));
  });

  it("denies an authenticated Storage read from an unknown path", async () => {
    await seedUnknownResources();
    const client = testEnvironment.authenticatedContext("outsider").storage();

    await assertFails(getBytes(storageRef(client, "unknown/known.txt")));
  });
});
