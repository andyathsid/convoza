import { create } from "zustand";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  onIdTokenChanged,
  sendEmailVerification,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  GoogleAuthProvider,
  type User as FirebaseUser,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth, googleProvider } from "@/lib/firebase";
import { api, clearApiSession, createApiSession } from "@/lib/api";
import type { User } from "@/types/user";
import { startPresence, stopPresence } from "../lib/presence-session";

// When "Create multiple accounts" is enabled in Firebase Auth, the top-level
// .email on a FirebaseUser can be null. The real email lives in providerData.
export function getFirebaseEmail(user: FirebaseUser): string | null {
  return user.email ?? user.providerData[0]?.email ?? null;
}

interface AuthState {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  pendingGoogleCredential: { email: string; credential: ReturnType<typeof GoogleAuthProvider.credentialFromError> } | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  linkGoogleAccount: () => Promise<void>;
  signOut: () => Promise<void>;
  initAuth: () => () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  firebaseUser: null,
  isLoading: true,
  pendingGoogleCredential: null,

  signIn: async (email, password) => {
    if (!auth) throw new Error("Firebase not initialized");
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const res = await createApiSession(cred.user);
    set({ user: res.user, firebaseUser: cred.user });
    // Auto-link pending Google credential (from account-exists-with-different-credential flow)
    const pending = useAuth.getState().pendingGoogleCredential;
    if (pending && pending.email === email) {
      try {
        if (cred.user && pending.credential) {
          await linkWithCredential(cred.user, pending.credential);
        }
      } catch {
        // Best-effort; linking failure should not block sign-in
      }
      set({ pendingGoogleCredential: null });
    }
    startPresence(res.user.id);
  },

  signUp: async (email, password, username) => {
    if (!auth) throw new Error("Firebase not initialized");
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "auth/email-already-in-use") {
        // Check if the existing account uses Google sign-in
        const methods = await fetchSignInMethodsForEmail(auth, email);
        if (methods.includes("google.com")) {
          throw new Error(
            "This email is linked to a Google account. Please sign in with Google."
          );
        }
        throw new Error(
          "An account with this email already exists. Try signing in instead."
        );
      }
      throw err;
    }
    await sendEmailVerification(cred.user);
    const res = await createApiSession(cred.user, {
      username,
      avatar: "",
    });
    set({ user: res.user, firebaseUser: cred.user });
    startPresence(res.user.id);
  },

  signInWithGoogle: async () => {
    if (!auth || !googleProvider) throw new Error("Firebase not initialized");
    const cred = await signInWithPopup(auth, googleProvider);
    // if(!cred.user.email && cred.user.uid) {
    //   throw new Error("An account with this Google profile has no email associated. Sign in with email/password instead and link the accounts.");
    // }
    console.log("Google sign-in successful, syncing with backend...", cred.user);
    const res = await createApiSession(cred.user, {
      username: cred.user.displayName || getFirebaseEmail(cred.user)?.split("@")[0] || "User",
      avatar: cred.user.photoURL || "",
    });
    set({ user: res.user, firebaseUser: cred.user });
    startPresence(res.user.id);
  },

  linkGoogleAccount: async () => {
    const state = useAuth.getState();
    if (!auth || !state.pendingGoogleCredential) {
      throw new Error("No pending Google credential to link");
    }
    const { email, credential } = state.pendingGoogleCredential;
    if (!email || !credential || !auth.currentUser) {
      set({ pendingGoogleCredential: null });
      throw new Error("Cannot link Google account. Please sign in again with Google.");
    }
    const currentEmail = auth.currentUser.email;
    if (currentEmail !== email) {
      set({ pendingGoogleCredential: null });
      throw new Error(
        "Signed-in email doesn't match. Please sign out and sign in with the correct account."
      );
    }
    try {
      await linkWithCredential(auth.currentUser, credential);
      set({ pendingGoogleCredential: null });
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "auth/credential-already-in-use") {
        set({ pendingGoogleCredential: null });
        throw new Error(
          "This Google account is already linked to another account."
        );
      }
      throw err;
    }
  },

  signOut: async () => {
    if (!auth) return;
    stopPresence();
    // Clear the backend-owned httpOnly session cookie FIRST. If this fails, we stop here
    // so the user stays fully authenticated and can retry. Proceeding with
    // firebaseSignOut after a failed cookie clear would leave the client
    // signed out while the API session remains valid until it expires.
    await clearApiSession();
    await firebaseSignOut(auth);
    set({ user: null, firebaseUser: null });
  },

  initAuth: () => {
    if (!auth) {
      set({ isLoading: false });
      return () => {};
    }
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const res = await api.get("/auth/session");
          set({ user: res.user, firebaseUser, isLoading: false });
          startPresence(res.user.id);
        } catch {
          set({ firebaseUser, isLoading: false });
        }
      } else {
        set({ user: null, firebaseUser: null, isLoading: false });
      }
    });

    return () => {
      unsubscribe();
    };
  },

}));
