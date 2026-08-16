package services

// ServiceError represents an expected error with a specific HTTP status.
type ServiceError struct {
	Status  int
	Message interface{}
	Err     error
}

func (e *ServiceError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}

	switch msg := e.Message.(type) {
	case string:
		return msg
	default:
		return "service error"
	}
}
