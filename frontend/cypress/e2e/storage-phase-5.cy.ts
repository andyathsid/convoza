/// <reference types="cypress" />

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import { getStorage, ref, uploadBytes, type FirebaseStorage } from "firebase/storage";

export {};

interface Phase5Config {
  aliceEmail: string;
  alicePassword: string;
  bobEmail: string;
  bobPassword: string;
  chatId: string;
  chatLabel: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firestoreProjectId: string;
  storageBucket: string;
}

interface Actor {
  app: FirebaseApp;
  auth: Auth;
  storage: FirebaseStorage;
  uid: string;
}

let actors: Actor[] = [];

function requiredConfig(name: string): string {
  const value = Cypress.env(name);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing Cypress configuration value: ${name}`);
  return value;
}

function loadPhase5Config(): Phase5Config {
  if (!Cypress.config("baseUrl")) throw new Error("Set CYPRESS_BASE_URL to the development ChatApp URL before running this spec");
  return {
    aliceEmail: requiredConfig("ALICE_EMAIL"),
    alicePassword: requiredConfig("ALICE_PASSWORD"),
    bobEmail: requiredConfig("BOB_EMAIL"),
    bobPassword: requiredConfig("BOB_PASSWORD"),
    chatId: requiredConfig("PHASE5_CHAT_ID"),
    chatLabel: requiredConfig("PHASE5_CHAT_LABEL"),
    firebaseApiKey: requiredConfig("FIREBASE_API_KEY"),
    firebaseAuthDomain: requiredConfig("FIREBASE_AUTH_DOMAIN"),
    firestoreProjectId: requiredConfig("FIRESTORE_PROJECT_ID"),
    storageBucket: requiredConfig("FIREBASE_STORAGE_BUCKET"),
  };
}

async function signInActor(config: Phase5Config, label: string, email: string, password: string): Promise<Actor> {
  const app = initializeApp({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firestoreProjectId,
    storageBucket: config.storageBucket,
  }, `server-write-${label}-${crypto.randomUUID()}`);
  const auth = getAuth(app);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const actor = { app, auth, storage: getStorage(app), uid: credential.user.uid };
  actors.push(actor);
  return actor;
}

function expectStorageDenied(operation: Promise<unknown>) {
  return cy.wrap(operation.then(
    () => { throw new Error("Expected Firebase Storage operation to be denied"); },
    (error: { code?: string }) => error,
  ), { log: false }).then((error: unknown) => {
    expect((error as { code?: string }).code).to.eq("storage/unauthorized");
  });
}

describe("server-owned Storage deployed development contract", () => {
  beforeEach(() => { actors = []; });

  afterEach(() => cy.wrap(Promise.all(actors.map(async (actor) => {
    await signOut(actor.auth).catch(() => {});
    await deleteApp(actor.app);
  })), { log: false }));

  it("renders the disposable chat with the deployed application", () => {
    const config = loadPhase5Config();
    cy.intercept("POST", "**/api/v1/auth/sync").as("authSync");
    cy.visit("/sign-in");
    cy.get('[data-testid="sign-in-email"]', { timeout: 15_000 }).should("be.visible").type(config.aliceEmail);
    cy.get('[data-testid="sign-in-password"]').type(config.alicePassword, { log: false });
    cy.get('[data-testid="sign-in-submit"]').click();
    cy.wait("@authSync", { timeout: 15_000 }).its("response.statusCode").should("eq", 200);
    cy.visit(`/chat/${config.chatId}`);
    cy.contains(config.chatLabel, { timeout: 15_000 }).should("be.visible");
  });

  it("denies direct Storage writes to every authenticated browser user", () => {
    const config = loadPhase5Config();
    cy.wrap(Promise.all([
      signInActor(config, "alice", config.aliceEmail, config.alicePassword),
      signInActor(config, "bob", config.bobEmail, config.bobPassword),
    ]), { log: false }).then((result) => {
      const [alice, bob] = result as [Actor, Actor];
      return expectStorageDenied(uploadBytes(
        ref(alice.storage, `chats/${config.chatId}/media/${alice.uid}/${crypto.randomUUID()}`),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/jpeg" },
      )).then(() => expectStorageDenied(uploadBytes(
        ref(bob.storage, `chats/${config.chatId}/avatar/${bob.uid}/${crypto.randomUUID()}`),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/png" },
      )));
    });
  });
});
