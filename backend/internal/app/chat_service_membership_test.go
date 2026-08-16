package app

import (
	"context"
	"errors"
	"testing"
)

type fakeMembershipMirror struct {
	grantErr  error
	revokeErr error
	grants    [][2]string
	revokes   [][2]string
}

func (m *fakeMembershipMirror) Grant(_ context.Context, chatID, userID string) error {
	m.grants = append(m.grants, [2]string{chatID, userID})
	return m.grantErr
}

func (m *fakeMembershipMirror) Revoke(_ context.Context, chatID, userID string) error {
	m.revokes = append(m.revokes, [2]string{chatID, userID})
	return m.revokeErr
}

func TestGrantTypingMembership(t *testing.T) {
	mirror := &fakeMembershipMirror{}
	service := NewChatService(nil, nil, nil, mirror, nil)

	if err := service.grantTypingMembership(context.Background(), "chat-a", "alice"); err != nil {
		t.Fatalf("grant typing membership: %v", err)
	}
	if len(mirror.grants) != 1 || mirror.grants[0] != [2]string{"chat-a", "alice"} {
		t.Fatalf("unexpected grant calls: %#v", mirror.grants)
	}
}

func TestMembershipSynchronizationFailuresAreActionable(t *testing.T) {
	tests := []struct {
		name string
		call func(*ChatService) error
	}{
		{
			name: "grant",
			call: func(service *ChatService) error {
				return service.grantTypingMembership(context.Background(), "chat-a", "alice")
			},
		},
		{
			name: "revoke",
			call: func(service *ChatService) error {
				return service.revokeTypingMembership(context.Background(), "chat-a", "alice")
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mirror := &fakeMembershipMirror{
				grantErr:  errors.New("RTDB unavailable"),
				revokeErr: errors.New("RTDB unavailable"),
			}
			service := NewChatService(nil, nil, nil, mirror, nil)

			err := test.call(service)
			var serviceErr *ServiceError
			if !errors.As(err, &serviceErr) {
				t.Fatalf("expected ServiceError, got %v", err)
			}
			if serviceErr.Code != CodeDependencyUnavailable || serviceErr.Message == "" {
				t.Fatalf("unexpected service error: %#v", serviceErr)
			}
		})
	}
}
