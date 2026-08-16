/// <reference types="cypress" />

export {};

const validSessionId = "11111111-1111-4111-8111-111111111111";

interface AuthSession {
  idToken: string;
  localId: string;
}

interface Phase2Config {
  aliceEmail: string;
  alicePassword: string;
  bobDisplayName: string;
  bobEmail: string;
  bobPassword: string;
  chatId: string;
  databaseUrl: string;
  firebaseApiKey: string;
}

function requiredConfig(name: string): string {
  const value = Cypress.env(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing Cypress configuration value: ${name}`);
  }
  return value;
}

function loadPhase2Config(): Phase2Config {
  if (!Cypress.config("baseUrl")) {
    throw new Error("Set CYPRESS_BASE_URL to the development ChatApp URL before running this spec");
  }

  return {
    aliceEmail: requiredConfig("ALICE_EMAIL"),
    alicePassword: requiredConfig("ALICE_PASSWORD"),
    bobDisplayName: requiredConfig("BOB_DISPLAY_NAME"),
    bobEmail: requiredConfig("BOB_EMAIL"),
    bobPassword: requiredConfig("BOB_PASSWORD"),
    chatId: requiredConfig("PHASE2_CHAT_ID"),
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
  config: Phase2Config,
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

describe("Phase 2 RTDB deployed development smoke", () => {
  afterEach(() => {
    const config = loadPhase2Config();

    signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((response) => {
      const bob = response.body;

      databaseRequest(config, "Bob cleanup", `typing/${config.chatId}/${bob.localId}/${validSessionId}`, "DELETE", bob.idToken);
      databaseRequest(config, "Bob cleanup", `status/${bob.localId}`, "PUT", bob.idToken, {
        state: "offline",
        last_changed: { ".sv": "timestamp" },
      });
    });
  });

  it("denies anonymous access to deployed presence and typing paths", () => {
    const config = loadPhase2Config();

    databaseRequest(config, "Anonymous", "status", "GET").then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
    databaseRequest(config, "Anonymous", `typing/${config.chatId}`, "GET").then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });

  it("updates the ChatApp UI from deployed presence and typing events", () => {
    const config = loadPhase2Config();

    signInWithFirebase("Alice", config.aliceEmail, config.alicePassword, config.firebaseApiKey).then((aliceResponse) => {
      const alice = aliceResponse.body;

      signInWithFirebase("Bob", config.bobEmail, config.bobPassword, config.firebaseApiKey).then((bobResponse) => {
        const bob = bobResponse.body;

        databaseRequest(config, "Bob", `status/${bob.localId}`, "PUT", bob.idToken, {
          state: "online",
          last_changed: { ".sv": "timestamp" },
        }).then((response) => {
          expect(response.status).to.equal(200);
        });

        cy.intercept("POST", "**/api/v1/auth/sync").as("authSync");
        cy.visit("/sign-in");
        cy.get('[data-testid="sign-in-email"]', { timeout: 15_000 })
          .should("be.visible")
          .type(config.aliceEmail);
        cy.get('[data-testid="sign-in-password"]').type(config.alicePassword, { log: false });
        cy.get('[data-testid="sign-in-submit"]').click();
        cy.wait("@authSync", { timeout: 15_000 }).then(({ response }) => {
          expect(response?.statusCode).to.equal(200);
        });
        cy.location("pathname", { timeout: 15_000 }).should("eq", "/chat");

        cy.visit(`/chat/${config.chatId}`);
        cy.get('[data-testid="chat-presence"]', { timeout: 15_000 }).should("have.text", "Online");

        cy.get('[data-testid="chat-message-input"]').type("Cypress typing smoke");
        cy.wait(500);
        databaseRequest(config, "Alice", `typing/${config.chatId}/${alice.localId}`, "GET", alice.idToken).then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body).to.be.an("object").and.not.be.empty;
        });

        databaseRequest(config, "Bob", `typing/${config.chatId}/${bob.localId}/${validSessionId}`, "PUT", bob.idToken, {
          ".sv": "timestamp",
        }).then((response) => {
          expect(response.status).to.equal(200);
        });

        cy.get('[data-testid="chat-typing-indicator"]', { timeout: 15_000 })
          .should("contain.text", `${config.bobDisplayName} is typing...`);

        databaseRequest(config, "Bob", `typing/${config.chatId}/${bob.localId}/${validSessionId}`, "DELETE", bob.idToken).then((response) => {
          expect(response.status).to.equal(200);
        });
        cy.get('[data-testid="chat-typing-indicator"]', { timeout: 15_000 }).should("not.exist");

        cy.get('[data-testid="chat-message-input"]').blur();
        cy.wait(500);
        databaseRequest(config, "Alice", `typing/${config.chatId}/${alice.localId}`, "GET", alice.idToken).then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body).to.equal(null);
        });

        databaseRequest(config, "Bob", `status/${bob.localId}`, "PUT", bob.idToken, {
          state: "offline",
          last_changed: { ".sv": "timestamp" },
        }).then((response) => {
          expect(response.status).to.equal(200);
        });
      });
    });
  });
});
