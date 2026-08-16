package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"golang.org/x/oauth2"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

const (
	allowedSource      = "andyathsid-hin-probation"
	allowedDestination = "andyathsid-migration-rehearsal"
)

type canonicalDocument struct {
	Path string         `json:"path"`
	Data map[string]any `json:"data"`
}

type snapshot struct {
	documents       map[string]canonicalDocument
	raw             map[string]map[string]any
	collectionGroup map[string]int
	timestampCount  int
	hash            string
}

type invariantReport struct {
	ParticipantsMissingProfile int `json:"participantsMissingProfile"`
	ParticipantsMissingMember  int `json:"participantsMissingActiveMember"`
	MembersMissingProfile      int `json:"activeMembersMissingProfile"`
	MembersMissingParticipant  int `json:"activeMembersMissingParticipant"`
	MemberUIDMismatch          int `json:"memberUidMismatch"`
	InvalidMemberRole          int `json:"invalidMemberRole"`
	CreatorInvariantFailure    int `json:"creatorInvariantFailure"`
	MessageMissingChat         int `json:"messagesMissingChat"`
	SenderMissingProfile       int `json:"nonSystemSendersMissingProfile"`
	ReplyMissingMessage        int `json:"repliesMissingMessage"`
	ReceiptUIDMissingProfile   int `json:"receiptUidsMissingProfile"`
}

func (r invariantReport) total() int {
	return r.ParticipantsMissingProfile +
		r.ParticipantsMissingMember +
		r.MembersMissingProfile +
		r.MembersMissingParticipant +
		r.MemberUIDMismatch +
		r.InvalidMemberRole +
		r.CreatorInvariantFailure +
		r.MessageMissingChat +
		r.SenderMissingProfile +
		r.ReplyMissingMessage +
		r.ReceiptUIDMissingProfile
}

type output struct {
	SourceProject          string          `json:"sourceProject"`
	DestinationProject     string          `json:"destinationProject"`
	SourceDocuments        int             `json:"sourceDocuments"`
	DestinationDocuments   int             `json:"destinationDocuments"`
	SourceCollectionGroups map[string]int  `json:"sourceCollectionGroups"`
	DestCollectionGroups   map[string]int  `json:"destinationCollectionGroups"`
	SourceUIDCount         int             `json:"sourceFirestoreUidCount"`
	DestinationUIDCount    int             `json:"destinationFirestoreUidCount"`
	SourceTimestampCount   int             `json:"sourceTimestampValueCount"`
	DestTimestampCount     int             `json:"destinationTimestampValueCount"`
	SourceCanonicalSHA256  string          `json:"sourceCanonicalSha256"`
	DestCanonicalSHA256    string          `json:"destinationCanonicalSha256"`
	DocumentPathsMatch     bool            `json:"documentPathsMatch"`
	TypedValuesMatch       bool            `json:"typedValuesMatch"`
	CollectionCountsMatch  bool            `json:"collectionGroupCountsMatch"`
	UIDSetsMatch           bool            `json:"firestoreUidSetsMatch"`
	TimestampCountsMatch   bool            `json:"timestampCountsMatch"`
	SourceInvariants       invariantReport `json:"sourceInvariantViolations"`
	DestInvariants         invariantReport `json:"destinationInvariantViolations"`
	Status                 string          `json:"status"`
}

type emptyOutput struct {
	Project          string         `json:"project"`
	DocumentCount    int            `json:"documentCount"`
	CollectionGroups map[string]int `json:"collectionGroups"`
	Status           string         `json:"status"`
}

func main() {
	log.SetFlags(0)
	var source, destination, mode string
	var allowCustomTargets bool
	flag.StringVar(&source, "source-project", "", "exact source Google Cloud project ID")
	flag.StringVar(&destination, "destination-project", "", "exact destination Google Cloud project ID")
	flag.StringVar(&mode, "mode", "compare", "audit mode: compare or assert-destination-empty")
	flag.BoolVar(&allowCustomTargets, "allow-custom-targets", false, "permit a non-default source and destination pair")
	flag.Parse()

	if mode != "compare" && mode != "assert-destination-empty" {
		log.Fatalf("unsupported mode %q", mode)
	}
	if source == "" || destination == "" {
		log.Fatal("both --source-project and --destination-project are required")
	}
	if !allowCustomTargets && (source != allowedSource || destination != allowedDestination) {
		log.Fatalf("refusing unexpected targets: source must be %q and destination must be %q", allowedSource, allowedDestination)
	}
	if source == destination {
		log.Fatal("source and destination must differ")
	}

	ctx := context.Background()
	if mode == "assert-destination-empty" {
		destinationSnapshot, err := readProject(ctx, destination)
		if err != nil {
			log.Fatalf("audit destination: %v", err)
		}
		result := emptyOutput{
			Project:          destination,
			DocumentCount:    len(destinationSnapshot.documents),
			CollectionGroups: destinationSnapshot.collectionGroup,
			Status:           "empty",
		}
		if result.DocumentCount != 0 {
			result.Status = "not_empty"
		}
		writeJSON(result)
		if result.Status != "empty" {
			os.Exit(1)
		}
		return
	}

	sourceSnapshot, err := readProject(ctx, source)
	if err != nil {
		log.Fatalf("audit source: %v", err)
	}
	destinationSnapshot, err := readProject(ctx, destination)
	if err != nil {
		log.Fatalf("audit destination: %v", err)
	}

	sourceUIDs := userIDs(sourceSnapshot.raw)
	destinationUIDs := userIDs(destinationSnapshot.raw)
	sourceInvariants := evaluateInvariants(sourceSnapshot.raw, sourceUIDs)
	destinationInvariants := evaluateInvariants(destinationSnapshot.raw, destinationUIDs)

	pathsMatch := equalStringSets(documentPaths(sourceSnapshot.raw), documentPaths(destinationSnapshot.raw))
	valuesMatch := sourceSnapshot.hash == destinationSnapshot.hash
	result := output{
		SourceProject:          source,
		DestinationProject:     destination,
		SourceDocuments:        len(sourceSnapshot.documents),
		DestinationDocuments:   len(destinationSnapshot.documents),
		SourceCollectionGroups: sourceSnapshot.collectionGroup,
		DestCollectionGroups:   destinationSnapshot.collectionGroup,
		SourceUIDCount:         len(sourceUIDs),
		DestinationUIDCount:    len(destinationUIDs),
		SourceTimestampCount:   sourceSnapshot.timestampCount,
		DestTimestampCount:     destinationSnapshot.timestampCount,
		SourceCanonicalSHA256:  sourceSnapshot.hash,
		DestCanonicalSHA256:    destinationSnapshot.hash,
		DocumentPathsMatch:     pathsMatch,
		TypedValuesMatch:       valuesMatch,
		CollectionCountsMatch:  equalCounts(sourceSnapshot.collectionGroup, destinationSnapshot.collectionGroup),
		UIDSetsMatch:           equalStringSets(sourceUIDs, destinationUIDs),
		TimestampCountsMatch:   sourceSnapshot.timestampCount == destinationSnapshot.timestampCount,
		SourceInvariants:       sourceInvariants,
		DestInvariants:         destinationInvariants,
	}
	if result.DocumentPathsMatch &&
		result.TypedValuesMatch &&
		result.CollectionCountsMatch &&
		result.UIDSetsMatch &&
		result.TimestampCountsMatch &&
		sourceInvariants.total() == 0 &&
		destinationInvariants.total() == 0 {
		result.Status = "passed"
	} else {
		result.Status = "failed"
	}

	writeJSON(result)
	if result.Status != "passed" {
		os.Exit(1)
	}
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		log.Fatalf("encode report: %v", err)
	}
}

func readProject(ctx context.Context, projectID string) (*snapshot, error) {
	var clientOptions []option.ClientOption
	if accessToken := os.Getenv("FIRESTORE_AUDIT_ACCESS_TOKEN"); accessToken != "" {
		// A short-lived operator token avoids persisting ADC credentials on a migration host.
		clientOptions = append(clientOptions, option.WithTokenSource(
			oauth2.StaticTokenSource(&oauth2.Token{AccessToken: accessToken}),
		))
	}
	client, err := firestore.NewClientWithDatabase(ctx, projectID, "(default)", clientOptions...)
	if err != nil {
		return nil, fmt.Errorf("create Firestore client: %w", err)
	}
	defer client.Close()

	result := &snapshot{
		documents:       make(map[string]canonicalDocument),
		raw:             make(map[string]map[string]any),
		collectionGroup: make(map[string]int),
	}
	collections := client.Collections(ctx)
	for {
		collection, err := collections.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("list root collections: %w", err)
		}
		if err := readCollection(ctx, collection, result); err != nil {
			return nil, err
		}
	}

	paths := make([]string, 0, len(result.documents))
	for path := range result.documents {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	hash := sha256.New()
	for _, path := range paths {
		encoded, err := json.Marshal(result.documents[path])
		if err != nil {
			return nil, fmt.Errorf("encode canonical document: %w", err)
		}
		hash.Write(encoded)
		hash.Write([]byte{'\n'})
	}
	result.hash = hex.EncodeToString(hash.Sum(nil))
	return result, nil
}

func readCollection(ctx context.Context, collection *firestore.CollectionRef, result *snapshot) error {
	documents := collection.Documents(ctx)
	for {
		document, err := documents.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return fmt.Errorf("scan Firestore collection: %w", err)
		}
		data := document.Data()
		canonical, timestampCount, err := canonicalMap(data)
		if err != nil {
			return fmt.Errorf("canonicalize Firestore document: %w", err)
		}
		documentPath := relativeDocumentPath(document.Ref.Path)
		result.documents[documentPath] = canonicalDocument{Path: documentPath, Data: canonical}
		result.raw[documentPath] = data
		result.collectionGroup[document.Ref.Parent.ID]++
		result.timestampCount += timestampCount

		subcollections := document.Ref.Collections(ctx)
		for {
			subcollection, err := subcollections.Next()
			if errors.Is(err, iterator.Done) {
				break
			}
			if err != nil {
				return fmt.Errorf("list Firestore subcollections: %w", err)
			}
			if err := readCollection(ctx, subcollection, result); err != nil {
				return err
			}
		}
	}
	return nil
}

func canonicalMap(data map[string]any) (map[string]any, int, error) {
	canonical := make(map[string]any, len(data))
	timestamps := 0
	for key, value := range data {
		converted, count, err := canonicalValue(value)
		if err != nil {
			return nil, 0, err
		}
		canonical[key] = converted
		timestamps += count
	}
	return canonical, timestamps, nil
}

func canonicalValue(value any) (any, int, error) {
	switch typed := value.(type) {
	case time.Time:
		return map[string]any{"$type": "timestamp", "value": typed.UTC().Format(time.RFC3339Nano)}, 1, nil
	case *firestore.DocumentRef:
		return map[string]any{"$type": "reference", "value": relativeDocumentPath(typed.Path)}, 0, nil
	case []byte:
		return map[string]any{"$type": "bytes", "sha256": fmt.Sprintf("%x", sha256.Sum256(typed))}, 0, nil
	case []any:
		values := make([]any, len(typed))
		count := 0
		for index, item := range typed {
			converted, nestedCount, err := canonicalValue(item)
			if err != nil {
				return nil, 0, err
			}
			values[index] = converted
			count += nestedCount
		}
		return values, count, nil
	case []string:
		values := make([]any, len(typed))
		for index, item := range typed {
			values[index] = item
		}
		return values, 0, nil
	case map[string]any:
		return canonicalMap(typed)
	case nil, bool, string, int64, float64:
		return typed, 0, nil
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil, 0, fmt.Errorf("unsupported value type %T", value)
		}
		decoder := json.NewDecoder(bytes.NewReader(encoded))
		decoder.UseNumber()
		var fallback any
		if err := decoder.Decode(&fallback); err != nil {
			return nil, 0, fmt.Errorf("decode canonical fallback for %T: %w", value, err)
		}
		return map[string]any{"$type": fmt.Sprintf("%T", value), "value": fallback}, 0, nil
	}
}

func relativeDocumentPath(path string) string {
	const marker = "/documents/"
	if index := strings.Index(path, marker); index >= 0 {
		return path[index+len(marker):]
	}
	return path
}

func userIDs(documents map[string]map[string]any) map[string]struct{} {
	result := make(map[string]struct{})
	for path := range documents {
		parts := strings.Split(path, "/")
		if len(parts) == 2 && parts[0] == "users" {
			result[parts[1]] = struct{}{}
		}
	}
	return result
}

func documentPaths(documents map[string]map[string]any) map[string]struct{} {
	result := make(map[string]struct{}, len(documents))
	for path := range documents {
		result[path] = struct{}{}
	}
	return result
}

func evaluateInvariants(documents map[string]map[string]any, profiles map[string]struct{}) invariantReport {
	var report invariantReport
	for path, data := range documents {
		parts := strings.Split(path, "/")
		switch {
		case len(parts) == 2 && parts[0] == "chats":
			chatID := parts[1]
			participants := stringSet(data["participants"])
			for participant := range participants {
				if _, exists := profiles[participant]; !exists {
					report.ParticipantsMissingProfile++
				}
				memberPath := "chats/" + chatID + "/members/" + participant
				if member, exists := documents[memberPath]; !exists || !isActiveMember(member) {
					report.ParticipantsMissingMember++
				}
			}
			creator, _ := data["createdBy"].(string)
			if creator != "" {
				member := documents["chats/"+chatID+"/members/"+creator]
				role, _ := member["role"].(string)
				if _, exists := participants[creator]; !exists || !isActiveMember(member) || role != "creator" {
					report.CreatorInvariantFailure++
				}
			}
		case len(parts) == 4 && parts[0] == "chats" && parts[2] == "members":
			uid := parts[3]
			fieldUID, _ := data["uid"].(string)
			if fieldUID != uid {
				report.MemberUIDMismatch++
			}
			role, _ := data["role"].(string)
			if role != "creator" && role != "admin" && role != "member" {
				report.InvalidMemberRole++
			}
			if isActiveMember(data) {
				if _, exists := profiles[uid]; !exists {
					report.MembersMissingProfile++
				}
				chat := documents["chats/"+parts[1]]
				if _, exists := stringSet(chat["participants"])[uid]; !exists {
					report.MembersMissingParticipant++
				}
			}
		case len(parts) == 4 && parts[0] == "chats" && parts[2] == "messages":
			chatID, messageID := parts[1], parts[3]
			if _, exists := documents["chats/"+chatID]; !exists {
				report.MessageMissingChat++
			}
			messageType, _ := data["type"].(string)
			senderID, _ := data["senderId"].(string)
			if messageType != "system" && senderID != "" {
				if _, exists := profiles[senderID]; !exists {
					report.SenderMissingProfile++
				}
			}
			replyID, _ := data["replyToId"].(string)
			if replyID != "" && replyID != messageID {
				if _, exists := documents["chats/"+chatID+"/messages/"+replyID]; !exists {
					report.ReplyMissingMessage++
				}
			}
			for _, field := range []string{"deliveredTo", "readBy"} {
				for uid := range mapKeys(data[field]) {
					if _, exists := profiles[uid]; !exists {
						report.ReceiptUIDMissingProfile++
					}
				}
			}
		}
	}
	return report
}

func isActiveMember(data map[string]any) bool {
	return data != nil && data["leftAt"] == nil
}

func stringSet(value any) map[string]struct{} {
	result := make(map[string]struct{})
	switch values := value.(type) {
	case []any:
		for _, value := range values {
			if text, ok := value.(string); ok {
				result[text] = struct{}{}
			}
		}
	case []string:
		for _, value := range values {
			result[value] = struct{}{}
		}
	}
	return result
}

func mapKeys(value any) map[string]struct{} {
	result := make(map[string]struct{})
	if values, ok := value.(map[string]any); ok {
		for key := range values {
			result[key] = struct{}{}
		}
	}
	return result
}

func equalStringSets(left, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for item := range left {
		if _, exists := right[item]; !exists {
			return false
		}
	}
	return true
}

func equalCounts(left, right map[string]int) bool {
	if len(left) != len(right) {
		return false
	}
	for key, count := range left {
		if right[key] != count {
			return false
		}
	}
	return true
}
