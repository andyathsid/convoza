/// <reference types="cypress" />

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  getMetadata,
  getStorage,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

export {};

interface Phase5Config {
  aliceEmail: string;
  alicePassword: string;
  bobEmail: string;
  bobPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
  bobUid: string;
  chatId: string;
  chatLabel: string;
  apiUrl: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firestoreProjectId: string;
  storageBucket: string;
}

interface Actor {
  app: FirebaseApp;
  auth: Auth;
  storage: FirebaseStorage;
  idToken: string;
  uid: string;
}

let actors: Actor[] = [];
let bobWasRemoved = false;

function requiredConfig(name: string): string {
  const value = Cypress.env(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing Cypress configuration value: ${name}`);
  }
  return value;
}

function loadPhase5Config(): Phase5Config {
  if (!Cypress.config("baseUrl")) {
    throw new Error("Set CYPRESS_BASE_URL to the development ChatApp URL before running this spec");
  }

  return {
    aliceEmail: requiredConfig("ALICE_EMAIL"),
    alicePassword: requiredConfig("ALICE_PASSWORD"),
    bobEmail: requiredConfig("BOB_EMAIL"),
    bobPassword: requiredConfig("BOB_PASSWORD"),
    outsiderEmail: requiredConfig("OUTSIDER_EMAIL"),
    outsiderPassword: requiredConfig("OUTSIDER_PASSWORD"),
    bobUid: requiredConfig("PHASE5_BOB_UID"),
    chatId: requiredConfig("PHASE5_CHAT_ID"),
    chatLabel: requiredConfig("PHASE5_CHAT_LABEL"),
    apiUrl: requiredConfig("API_URL").replace(/\/$/, ""),
    firebaseApiKey: requiredConfig("FIREBASE_API_KEY"),
    firebaseAuthDomain: requiredConfig("FIREBASE_AUTH_DOMAIN"),
    firestoreProjectId: requiredConfig("FIRESTORE_PROJECT_ID"),
    storageBucket: requiredConfig("FIREBASE_STORAGE_BUCKET"),
  };
}

async function signInActor(
  config: Phase5Config,
  label: string,
  email: string,
  password: string,
): Promise<Actor> {
  const app = initializeApp(
    {
      apiKey: config.firebaseApiKey,
      authDomain: config.firebaseAuthDomain,
      projectId: config.firestoreProjectId,
      storageBucket: config.storageBucket,
    },
    `phase5-${label}-${crypto.randomUUID()}`,
  );
  const auth = getAuth(app);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const actor = {
    app,
    auth,
    storage: getStorage(app),
    idToken: await credential.user.getIdToken(),
    uid: credential.user.uid,
  };
  actors.push(actor);
  return actor;
}

function expectStorageDenied(operation: Promise<unknown>) {
  return cy.wrap(
    operation.then(
      () => {
        throw new Error("Expected Firebase Storage operation to be denied");
      },
      (error: { code?: string }) => error,
    ),
    { log: false },
  ).then((error: unknown) => {
    const storageError = error as { code?: string };
    expect(storageError.code).to.eq("storage/unauthorized");
  });
}

function backendRequest(
  config: Phase5Config,
  actor: string,
  path: string,
  idToken: string,
  body?: Cypress.RequestBody,
) {
  return cy.request({
    method: "POST",
    url: `${config.apiUrl}${path}`,
    headers: { Authorization: `Bearer ${idToken}` },
    body,
    failOnStatusCode: false,
    log: false,
  }).then((response) => {
    Cypress.log({
      name: "Backend",
      message: `${actor}: POST ${path} → ${response.status}`,
      consoleProps: () => ({ actor, path, status: response.status }),
    });
    return response;
  });
}

describe("Phase 5 Storage deployed development contract", () => {
  beforeEach(() => {
    actors = [];
    bobWasRemoved = false;
  });

  afterEach(() => {
    const config = loadPhase5Config();
    const cleanup = async () => {
      if (bobWasRemoved) {
        const alice = await signInActor(
          config,
          "restore-alice",
          config.aliceEmail,
          config.alicePassword,
        );
        const response = await fetch(`${config.apiUrl}/chat/${config.chatId}/members`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${alice.idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userIds: [config.bobUid] }),
        });
        if (!response.ok) {
          throw new Error(`Failed to restore Bob after Phase 5 test: ${response.status}`);
        }
      }
      await Promise.all(actors.map(async (actor) => {
        await signOut(actor.auth).catch(() => {});
        await deleteApp(actor.app);
      }));
    };
    return cy.wrap(cleanup(), { log: false });
  });

  it("renders the disposable chat with the deployed application", () => {
    const config = loadPhase5Config();

    cy.intercept("POST", "**/api/v1/auth/sync").as("authSync");
    cy.visit("/sign-in");
    cy.get('[data-testid="sign-in-email"]', { timeout: 15_000 })
      .should("be.visible")
      .type(config.aliceEmail);
    cy.get('[data-testid="sign-in-password"]').type(config.alicePassword, { log: false });
    cy.get('[data-testid="sign-in-submit"]').click();
    cy.wait("@authSync", { timeout: 15_000 }).its("response.statusCode").should("eq", 200);
    cy.location("pathname", { timeout: 15_000 }).should("eq", "/chat");

    cy.visit(`/chat/${config.chatId}`);
    cy.contains(config.chatLabel, { timeout: 15_000 }).should("be.visible");
    cy.get('[data-testid="chat-message-input"]', { timeout: 15_000 }).should("be.visible");
  });

  it("enforces owner, member, outsider, and group-role Storage access", () => {
    const config = loadPhase5Config();

    cy.wrap(Promise.all([
      signInActor(config, "alice", config.aliceEmail, config.alicePassword),
      signInActor(config, "bob", config.bobEmail, config.bobPassword),
      signInActor(config, "outsider", config.outsiderEmail, config.outsiderPassword),
    ]), { log: false }).then((result) => {
      const [alice, bob, outsider] = result as [Actor, Actor, Actor];
      const mediaPath = `chats/${config.chatId}/media/${alice.uid}/${crypto.randomUUID()}`;
      const groupAvatarPath = `chats/${config.chatId}/avatar/${alice.uid}/${crypto.randomUUID()}`;
      const bobGroupAvatarPath = `chats/${config.chatId}/avatar/${bob.uid}/${crypto.randomUUID()}`;

      return cy.wrap(uploadBytes(
        ref(alice.storage, mediaPath),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/jpeg" },
      ), { log: false }).then(() => {
        return cy.wrap(getMetadata(ref(bob.storage, mediaPath)), { log: false });
      }).then(() => {
        return expectStorageDenied(getMetadata(ref(outsider.storage, mediaPath)));
      }).then(() => {
        return cy.wrap(uploadBytes(
          ref(alice.storage, groupAvatarPath),
          new Uint8Array([1, 2, 3]),
          { contentType: "image/png" },
        ), { log: false });
      }).then(() => {
        return expectStorageDenied(uploadBytes(
          ref(bob.storage, bobGroupAvatarPath),
          new Uint8Array([1, 2, 3]),
          { contentType: "image/png" },
        ));
      });
    });
  });

  it("revokes SDK reads immediately after backend member removal", () => {
    const config = loadPhase5Config();

    cy.wrap(Promise.all([
      signInActor(config, "alice", config.aliceEmail, config.alicePassword),
      signInActor(config, "bob", config.bobEmail, config.bobPassword),
    ]), { log: false }).then((result) => {
      const [alice, bob] = result as [Actor, Actor];
      const mediaPath = `chats/${config.chatId}/media/${alice.uid}/${crypto.randomUUID()}`;

      return cy.wrap(uploadBytes(
        ref(alice.storage, mediaPath),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/jpeg" },
      ), { log: false }).then(() => {
        return backendRequest(
          config,
          "Alice removes Bob",
          `/chat/${config.chatId}/members/${config.bobUid}/remove`,
          alice.idToken,
        );
      }).then((response) => {
        expect(response.status).to.eq(200);
        bobWasRemoved = true;
        return expectStorageDenied(getMetadata(ref(bob.storage, mediaPath)));
      });
    });
  });
});
