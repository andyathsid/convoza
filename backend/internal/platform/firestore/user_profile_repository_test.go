package firestore

import (
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMissingProfileTransactionCanContinue(t *testing.T) {
	if status.Code(status.Error(codes.NotFound, "users/alice not found")) != codes.NotFound {
		t.Fatal("a missing profile must be handled as a new user")
	}
}
