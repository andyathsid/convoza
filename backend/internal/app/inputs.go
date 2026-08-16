package app

type CreateChatInput struct {
	ParticipantID string
	IsGroup       bool
	Participants  []string
	GroupName     string
}
type SendMessageInput struct {
	ChatID, Content, ReplyToID, MediaURL, MediaPath, MediaType, ThumbnailURL, ThumbnailPath, DocumentName, GroupID string
	MediaWidth, MediaHeight, GroupIndex                                                                            int
}
type ReceiptInput struct {
	ChatID               string
	MessageIDs           []string
	ReadThroughMessageID string
}
