import { readFileSync } from "node:fs";

type EmulatorName = "firestore" | "database" | "storage";

interface FirebaseConfig {
  emulators?: Partial<Record<EmulatorName, { port?: unknown }>>;
}

const firebaseConfig = JSON.parse(readFileSync("firebase.json", "utf8")) as FirebaseConfig;

function emulatorPort(name: EmulatorName): number {
  const port = firebaseConfig.emulators?.[name]?.port;
  if (typeof port !== "number") {
    throw new Error(`firebase.json must configure an emulator port for ${name}`);
  }
  return port;
}

export const emulatorPorts = {
  firestore: emulatorPort("firestore"),
  database: emulatorPort("database"),
  storage: emulatorPort("storage"),
};
