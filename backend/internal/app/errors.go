package app

type ErrorCode string

const (
	CodeInvalidInput          ErrorCode = "invalid_input"
	CodeUnauthenticated       ErrorCode = "unauthenticated"
	CodeForbidden             ErrorCode = "forbidden"
	CodeNotFound              ErrorCode = "not_found"
	CodeConflict              ErrorCode = "conflict"
	CodePayloadTooLarge       ErrorCode = "payload_too_large"
	CodeDependencyUnavailable ErrorCode = "dependency_unavailable"
)

// ServiceError represents an expected application failure without HTTP coupling.
type ServiceError struct {
	Code    ErrorCode
	Message string
	Err     error
}

func (e *ServiceError) Error() string {
	if e.Message == "" {
		return "service error"
	}
	return e.Message
}

func (e *ServiceError) Unwrap() error { return e.Err }

func applicationError(code ErrorCode, message string, err error) *ServiceError {
	return &ServiceError{Code: code, Message: message, Err: err}
}
func InvalidInput(message string, err error) *ServiceError {
	return applicationError(CodeInvalidInput, message, err)
}
func Unauthenticated(message string, err error) *ServiceError {
	return applicationError(CodeUnauthenticated, message, err)
}
func Forbidden(message string, err error) *ServiceError {
	return applicationError(CodeForbidden, message, err)
}
func NotFound(message string, err error) *ServiceError {
	return applicationError(CodeNotFound, message, err)
}
func Conflict(message string, err error) *ServiceError {
	return applicationError(CodeConflict, message, err)
}
func PayloadTooLarge(message string, err error) *ServiceError {
	return applicationError(CodePayloadTooLarge, message, err)
}
func DependencyUnavailable(message string, err error) *ServiceError {
	return applicationError(CodeDependencyUnavailable, message, err)
}
