export interface ChatSearchDocument {
  id: string;
  groupName?: string;
  isGroup: boolean;
  participants: string[];
  participantNames: string[];
  updatedAt: number;
}

export interface ContactSearchDocument {
  id: string;
  username: string;
}

export interface GroupSearchDocument {
  id: string;
  participants: string[];
  participantNames: string[];
  updatedAt: number;
}

export interface MessageSearchDocument {
  id: string;
  content: string;
  documentName?: string;
  chatId: string;
  participants: string[];
  createdAt: number;
  senderId: string;
  mediaType?: string;
  deliveredTo?: string[];
  readBy?: string[];
}
