/// <reference types="cypress" />

export {};

const validSessionId = "11111111-1111-4111-8111-111111111111";

interface AuthSession {
  idToken: string;
  localId: string;
}

interface Phase3Config {
  aliceEmail: string;
  alicePassword: string;
  bobEmail: string;
  bobPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
  chatId: string;
  apiUrl: string;
  databaseUrl: string;
  firebaseApiKey: string;
}

let bobWasRemoved = false;

function requiredConfig(name: string): string {
  const value = Cypress.env(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing Cypress configuration value: ${name}`);
  }
  return value;
}

function loadPhase3Config(): Phase3Config {
  return {
    aliceEmail: requiredConfig("ALICE_EMAIL"),
    alicePassword: requiredConfig("ALICE_PASSWORD"),
    bobEmail: requiredConfig("BOB_EMAIL"),
    bobPassword: requiredConfig("BOB_PASSWORD"),
    outsiderEmail: requiredConfig("OUTSIDER_EMAIL"),
    outsiderPassword: requiredConfig("OUTSIDER_PASSWORD"),
    chatId: requiredConfig("PHASE3_CHAT_ID"),
    apiUrl: requiredConfig("API_URL").replace(/\/$/, ""),
    databaseUrl: requiredConfig("DATABASE_URL").replace(/\/$/, ""),
    firebaseApiKey: requiredConfig("FIREBASE_API_KEY"),
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

function databaseRequest(
  config: Phase3Config,
  actor: string,
  path: string,
  method: "GET" | "PUT" | "DELETE",
  idToken?: string,
  body?: Cypress.RequestBody,
) {
  const auth = idToken ? `?auth=${encodeURIComponent(idToken)}` : "";
  return cy.request({
    method,
    url: `${config.databaseUrl}/${path}.json${auth}`,
    body,
    failOnStatusCode: false,
    log: false,
  }).then((response) => {
    Cypress.log({
      name: "RTDB",
      message: `${actor}: ${method} /${path}.json → ${response.status}`,
      consoleProps: () => ({ actor, method, path: `/${path}.json`, status: response.status }),
    });
    return response;
  });
}

function backendRequest(
  config: Phase3Config,
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
      consoleProps: () => ({ actor, method: "POST", path, status: response.status }),
    });
    return response;
  });
}

describe("Phase 3 RTDB membership mirror deployed development contract", () => {
  beforeEach(() => {
    bobWasRemoved = false;
  });

  afterEach(() => {
    const config = loadPhase3Config();
    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey).then((response) => {
      signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((bobResponse) => {
        const cleanupTyping = () => databaseRequest(
          config,
          "Bob cleanup",
          `typing/${config.chatId}/${bobResponse.body.localId}/${validSessionId}`,
          "DELETE",
          bobResponse.body.idToken,
        ).its("status").should("eq", 200);

        if (!bobWasRemoved) {
          cleanupTyping();
          return;
        }

        backendRequest(config, "Alice restores Bob", `/chat/${config.chatId}/members`, response.body.idToken, {
          userIds: [bobResponse.body.localId],
        }).then((restore) => {
          expect(restore.status).to.equal(200);
          cleanupTyping();
        });
      });
    });
  });

  it("allows members and denies outsiders or direct mirror access", () => {
    const config = loadPhase3Config();

    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey).then((aliceResponse) => {
      const alice = aliceResponse.body;
      signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((bobResponse) => {
        const bob = bobResponse.body;
        signInWithFirebase("Outsider", config.outsiderEmail, config.outsiderPassword, config.firebaseApiKey).then((outsiderResponse) => {
          const outsider = outsiderResponse.body;

          databaseRequest(config, "Alice", `typing/${config.chatId}`, "GET", alice.idToken)
            .its("status").should("eq", 200);
          databaseRequest(config, "Bob", `typing/${config.chatId}/${bob.localId}/${validSessionId}`, "PUT", bob.idToken, {
            ".sv": "timestamp",
          }).its("status").should("eq", 200);

          databaseRequest(config, "Outsider", `typing/${config.chatId}`, "GET", outsider.idToken)
            .its("status").should("be.oneOf", [401, 403]);
          databaseRequest(config, "Outsider", `typing/${config.chatId}/${outsider.localId}/${validSessionId}`, "PUT", outsider.idToken, {
            ".sv": "timestamp",
          }).its("status").should("be.oneOf", [401, 403]);
          databaseRequest(config, "Alice", `chatMembers/${config.chatId}`, "GET", alice.idToken)
            .its("status").should("be.oneOf", [401, 403]);
          databaseRequest(config, "Alice", `chatMembers/${config.chatId}/${alice.localId}`, "PUT", alice.idToken, true)
            .its("status").should("be.oneOf", [401, 403]);
        });
      });
    });
  });

  it("revokes typing access before removing a group member", () => {
    const config = loadPhase3Config();

    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey).then((aliceResponse) => {
      const alice = aliceResponse.body;
      signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((bobResponse) => {
        const bob = bobResponse.body;
        backendRequest(config, "Alice removes Bob", `/chat/${config.chatId}/members/${bob.localId}/remove`, alice.idToken)
          .then((remove) => {
            expect(remove.status).to.equal(200);
            bobWasRemoved = true;

            databaseRequest(config, "Removed Bob", `typing/${config.chatId}`, "GET", bob.idToken)
              .its("status").should("be.oneOf", [401, 403]);
            databaseRequest(config, "Removed Bob", `typing/${config.chatId}/${bob.localId}/${validSessionId}`, "PUT", bob.idToken, {
              ".sv": "timestamp",
            }).its("status").should("be.oneOf", [401, 403]);
          });
      });
    });
  });
});
