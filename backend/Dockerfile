FROM golang:1.26-alpine

WORKDIR /app

# Install air for hot-reload
RUN go install github.com/air-verse/air@v1.65.3

# Copy dependency files and download
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

CMD ["air"]
