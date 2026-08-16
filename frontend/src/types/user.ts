export interface User {
  id: string;
  username: string;
  // Email is only populated for the authenticated account response.
  email?: string;
  avatar: string;
  created_at?: string;
  updated_at?: string | null;
}
