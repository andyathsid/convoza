package firebase

import (
	"context"
	"fmt"
	"log"
	"strings"

	"firebase.google.com/go/v4/db"
)

type MembershipMirror interface {
	Grant(ctx context.Context, chatID, userID string) error
	Revoke(ctx context.Context, chatID, userID string) error
}

type rtdbMembershipMirror struct {
	client *db.Client
}

func newMembershipMirror(client *db.Client) MembershipMirror {
	return &rtdbMembershipMirror{client: client}
}

func (m *rtdbMembershipMirror) Grant(ctx context.Context, chatID, userID string) error {
	ref, err := m.memberRef(chatID, userID)
	if err != nil {
		return err
	}

	if err := ref.Set(ctx, true); err != nil {
		log.Printf("[rtdb] membership grant failed chatID=%s userID=%s: %v", chatID, userID, err)
		return fmt.Errorf("grant typing membership for chat %q user %q: %w", chatID, userID, err)
	}

	log.Printf("[rtdb] membership granted chatID=%s userID=%s", chatID, userID)
	return nil
}

func (m *rtdbMembershipMirror) Revoke(ctx context.Context, chatID, userID string) error {
	ref, err := m.memberRef(chatID, userID)
	if err != nil {
		return err
	}

	if err := ref.Delete(ctx); err != nil {
		log.Printf("[rtdb] membership revoke failed chatID=%s userID=%s: %v", chatID, userID, err)
		return fmt.Errorf("revoke typing membership for chat %q user %q: %w", chatID, userID, err)
	}

	log.Printf("[rtdb] membership revoked chatID=%s userID=%s", chatID, userID)
	return nil
}

func (m *rtdbMembershipMirror) memberRef(chatID, userID string) (*db.Ref, error) {
	if !validRTDBKey(chatID) || !validRTDBKey(userID) {
		return nil, fmt.Errorf("invalid chat membership key")
	}

	return m.client.NewRef("chatMembers").Child(chatID).Child(userID), nil
}

func validRTDBKey(value string) bool {
	return value != "" && !strings.ContainsAny(value, ".#$[]/")
}
