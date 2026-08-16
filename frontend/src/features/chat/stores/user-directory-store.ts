import { create } from "zustand";
import {
	collection,
	doc,
	documentId,
	getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
	type DocumentData,
	type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getSearchClient } from "@/features/chat/lib/search-client";
import type { User } from "@/types/user";

const pageSize = 50;

export class ContactSearchUnavailableError extends Error {
  constructor() {
    super("Contact search is unavailable. Please try again later.");
  }
}

interface ContactSearchResult {
  hits?: Array<{ id?: string; document?: { id?: string } }>;
}

interface UserDirectoryState {
  users: Map<string, User>;
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
  loadNextPage: (currentUserID: string) => Promise<void>;
  search: (value: string, currentUserID: string) => Promise<User[]>;
}

function profileFromDocument(document: QueryDocumentSnapshot<DocumentData>): User {
  const data = document.data();
  return { id: document.id, username: String(data.username || ""), avatar: String(data.avatar || "") };
}

export const useUserDirectory = create<UserDirectoryState>((set, get) => ({
  users: new Map(),
  cursor: null,
  hasMore: true,
  isLoading: false,
  error: null,

  reset: () => set({ users: new Map(), cursor: null, hasMore: true, isLoading: false, error: null }),

  loadNextPage: async (currentUserID) => {
    const state = get();
    if (!db || state.isLoading || !state.hasMore) return;
    set({ isLoading: true, error: null });
    try {
		const constraints: QueryConstraint[] = [
        orderBy("usernameNormalized"),
        orderBy(documentId()),
        limit(pageSize),
      ];
      if (state.cursor) constraints.push(startAfter(state.cursor));
      const snapshot = await getDocs(query(collection(db, "users"), ...constraints));
      set((current) => {
        const users = new Map(current.users);
        for (const document of snapshot.docs) {
          if (document.id !== currentUserID) users.set(document.id, profileFromDocument(document));
        }
        return {
          users,
          cursor: snapshot.docs.at(-1) ?? current.cursor,
          hasMore: snapshot.docs.length === pageSize,
          isLoading: false,
        };
      });
    } catch (error) {
      console.error("Failed to load user directory:", error);
      set({ isLoading: false, error: "Contacts could not be loaded." });
    }
  },

  search: async (value, currentUserID) => {
    const searchValue = value.trim();
    if (!searchValue) return [];
    if (process.env.NEXT_PUBLIC_SEARCH_ENGINE !== "typesense") {
      throw new ContactSearchUnavailableError();
    }
    try {
      const client = await getSearchClient();
      const response = await client.search([{ indexName: "contacts", params: { query: searchValue, hitsPerPage: 20 } }]);
      const result = response.results[0] as ContactSearchResult | undefined;
      const ids = (result?.hits ?? [])
        .map((hit) => hit.id ?? hit.document?.id)
        .filter((id): id is string => Boolean(id) && id !== currentUserID);
		const firestore = db;
		if (!firestore || ids.length === 0) return [];

		const documents = await Promise.all(ids.map((id) => getDoc(doc(firestore, "users", id))));
		const byID = new Map<string, User>();
		for (const snapshot of documents) {
			if (snapshot.exists()) {
				byID.set(snapshot.id, {
					id: snapshot.id,
					username: String(snapshot.data().username || ""),
					avatar: String(snapshot.data().avatar || ""),
				});
			}
      }
      return ids.flatMap((id) => {
        const user = byID.get(id);
        return user ? [user] : [];
      });
    } catch (error) {
      console.error("Contact search failed:", error);
      throw new ContactSearchUnavailableError();
    }
  },
}));
