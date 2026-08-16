/// <reference types="cypress" />

export {};

interface AuthSession {
  idToken: string;
  localId: string;
}

interface Phase4Config {
  aliceEmail: string;
  alicePassword: string;
  bobEmail: string;
  bobPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
  chatId: string;
  chatLabel: string;
  apiUrl: string;
  firebaseApiKey: string;
  firestoreProjectId: string;
}

let bobWasRemoved = false;

function requiredConfig(name: string): string {
  const value = Cypress.env(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing Cypress configuration value: ${name}`);
  }
  return value;
}

function loadPhase4Config(): Phase4Config {
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
    chatId: requiredConfig("PHASE4_CHAT_ID"),
    chatLabel: requiredConfig("PHASE4_CHAT_LABEL"),
    apiUrl: requiredConfig("API_URL").replace(/\/$/, ""),
    firebaseApiKey: requiredConfig("FIREBASE_API_KEY"),
    firestoreProjectId: requiredConfig("FIRESTORE_PROJECT_ID"),
  };
}

function signInWithFirebase(actor: string, email: string, password: string, apiKey: string) {
  return cy.request<AuthSession>({
    method: "POST",
    url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    body: { email, password, returnSecureToken: true },
    log: false,
  }).then((response) => {
    Cypress.log({ name: "Firebase Auth", message: `${actor}: sign in → ${response.status}` });
    return response;
  });
}

function firestoreBaseUrl(projectId: string) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function firestoreDocumentRequest(
  config: Phase4Config,
  actor: string,
  path: string,
  method: "GET" | "PATCH",
  idToken: string,
  body?: Cypress.RequestBody,
) {
  return cy.request({
    method,
    url: `${firestoreBaseUrl(config.firestoreProjectId)}/${path}`,
    headers: { Authorization: `Bearer ${idToken}` },
    body,
    failOnStatusCode: false,
    log: false,
  }).then((response) => {
    Cypress.log({
      name: "Firestore",
      message: `${actor}: ${method} /${path} → ${response.status}`,
      consoleProps: () => ({ actor, method, path: `/${path}`, status: response.status }),
    });
    return response;
  });
}

function firestoreQueryRequest(
  config: Phase4Config,
  actor: string,
  idToken: string,
  body: Cypress.RequestBody,
) {
  return cy.request({
    method: "POST",
    url: `${firestoreBaseUrl(config.firestoreProjectId)}:runQuery`,
    headers: { Authorization: `Bearer ${idToken}` },
    body,
    failOnStatusCode: false,
    log: false,
  }).then((response) => {
    Cypress.log({
      name: "Firestore",
      message: `${actor}: POST /:runQuery → ${response.status}`,
      consoleProps: () => ({ actor, method: "POST", path: "/:runQuery", status: response.status }),
    });
    return response;
  });
}

function backendRequest(config: Phase4Config, actor: string, path: string, idToken: string, body?: Cypress.RequestBody) {
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
      consoleProps: () => ({ actor, method: "POST", path, status: response.status }),
    });
    return response;
  });
}

function chatListQuery(uid: string) {
  return {
    structuredQuery: {
      from: [{ collectionId: "chats" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "participants" },
          op: "ARRAY_CONTAINS",
          value: { stringValue: uid },
        },
      },
      orderBy: [{ field: { fieldPath: "updatedAt" }, direction: "DESCENDING" }],
      limit: 20,
    },
  };
}

describe("Phase 4 Firestore deployed development contract", () => {
  beforeEach(() => {
    bobWasRemoved = false;
  });

  afterEach(() => {
    const config = loadPhase4Config();
    if (!bobWasRemoved) return;

    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey)
      .then((aliceResponse) => backendRequest(
        config,
        "Alice restores Bob",
        `/chat/${config.chatId}/members`,
        aliceResponse.body.idToken,
        { userIds: [requiredConfig("PHASE4_BOB_UID")] },
      ))
      .its("status")
      .should("eq", 200);
  });

  it("renders an authorized chat in the browser", () => {
    const config = loadPhase4Config();

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

  it("allows member reads and denies outsider reads and direct writes", () => {
    const config = loadPhase4Config();

    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey).then((aliceResponse) => {
      const alice = aliceResponse.body;
      signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((bobResponse) => {
        const bob = bobResponse.body;
        signInWithFirebase("Outsider", config.outsiderEmail, config.outsiderPassword, config.firebaseApiKey).then((outsiderResponse) => {
          const outsider = outsiderResponse.body;

          firestoreDocumentRequest(config, "Alice", `chats/${config.chatId}`, "GET", alice.idToken)
            .its("status").should("eq", 200);
          firestoreQueryRequest(config, "Alice", alice.idToken, chatListQuery(alice.localId))
            .its("status").should("eq", 200);
          firestoreDocumentRequest(config, "Bob", `chats/${config.chatId}/messages`, "GET", bob.idToken)
            .its("status").should("eq", 200);

          firestoreDocumentRequest(config, "Outsider", `chats/${config.chatId}`, "GET", outsider.idToken)
            .its("status").should("be.oneOf", [401, 403]);
          firestoreDocumentRequest(config, "Outsider", `chats/${config.chatId}/messages`, "GET", outsider.idToken)
            .its("status").should("be.oneOf", [401, 403]);
          firestoreQueryRequest(config, "Outsider", outsider.idToken, chatListQuery(alice.localId))
            .its("status").should("be.oneOf", [401, 403]);
          firestoreDocumentRequest(
            config,
            "Alice direct write",
            `chats/${config.chatId}?updateMask.fieldPaths=groupName`,
            "PATCH",
            alice.idToken,
            { fields: { groupName: { stringValue: "client-write-must-fail" } } },
          ).its("status").should("be.oneOf", [401, 403]);
        });
      });
    });
  });

  it("revokes Firestore reads after backend member removal", () => {
    const config = loadPhase4Config();
    const bobUid = requiredConfig("PHASE4_BOB_UID");

    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey).then((aliceResponse) => {
      signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((bobResponse) => {
        backendRequest(config, "Alice removes Bob", `/chat/${config.chatId}/members/${bobUid}/remove`, aliceResponse.body.idToken)
          .then((remove) => {
            expect(remove.status).to.equal(200);
            bobWasRemoved = true;

            firestoreDocumentRequest(config, "Removed Bob", `chats/${config.chatId}`, "GET", bobResponse.body.idToken)
              .its("status").should("be.oneOf", [401, 403]);
            firestoreDocumentRequest(config, "Removed Bob", `chats/${config.chatId}/messages`, "GET", bobResponse.body.idToken)
              .its("status").should("be.oneOf", [401, 403]);
          });
      });
    });
  });
});
