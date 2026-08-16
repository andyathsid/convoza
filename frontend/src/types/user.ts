export interface User {
  id: string;
  username: string;
  email: string;
  avatar: string;
  created_at: string;
  updated_at: string | null;
}

// Alias for component compatibility
export type UserType = User;
