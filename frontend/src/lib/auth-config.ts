import { readFileSync, existsSync } from "fs";

interface ServiceAccount {
  projectId: string;
  privateKey: string;
  clientEmail: string;
}

export interface AuthConfig {
  apiKey: string;
  cookieName: string;
  cookieSignatureKeys: string[];
  cookieSerializeOptions: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    maxAge: number;
  };
  serviceAccount: ServiceAccount;
  loginPath: string;
  logoutPath: string;
}

function loadServiceAccount(): ServiceAccount {
  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json";

  if (!existsSync(serviceAccountPath)) {
    throw new Error(
      `Firebase service account file not found at ${serviceAccountPath}. ` +
        "Generate it from Firebase Console > Project Settings > Service Accounts " +
        "and save it to frontend/firebase-service-account.json"
    );
  }

  const raw = readFileSync(serviceAccountPath, "utf-8");
  const parsed = JSON.parse(raw);

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function parseCookieSignatureKeys(): string[] {
  const raw = process.env.AUTH_COOKIE_SIGNATURE_KEYS;
  if (!raw) {
    console.warn(
      "[AuthConfig] AUTH_COOKIE_SIGNATURE_KEYS not set. Using default dev key. " +
        "Set a secure random key in production (32+ bytes)."
    );
    return ["insecure-dev-key-must-be-at-least-32-bytes-long!"];
  }
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

export function getAuthConfig(): AuthConfig {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set");
  }

  return {
    apiKey,
    cookieName: process.env.AUTH_COOKIE_NAME || "__session",
    cookieSignatureKeys: parseCookieSignatureKeys(),
    cookieSerializeOptions: {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 12 * 60 * 60 * 24, // 12 days
    },
    serviceAccount: loadServiceAccount(),
    loginPath: "/api/login",
    logoutPath: "/api/logout",
  };
}
