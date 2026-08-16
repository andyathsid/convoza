import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL,
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    testIsolation: true,
  },
  screenshotOnRunFailure: true,
  video: false,
  viewportWidth: 1280,
  viewportHeight: 720,
});
