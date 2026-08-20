package search

import (
	"context"
	"log"
	"os"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
)

// Reconciler periodically scans Firestore and re-indexes changed data to Meilisearch.
// It also writes lastReconcileTime to Firestore for frontend coordination.
type Reconciler struct {
	sync      *SyncService
	firestore *firestore.Client
	interval  time.Duration
}

// NewReconciler creates a Reconciler. interval defaults to 6h if zero.
func NewReconciler(sync *SyncService, fsClient *firestore.Client, interval time.Duration) *Reconciler {
	if interval == 0 {
		interval = 6 * time.Hour
	}
	return &Reconciler{
		sync:      sync,
		firestore: fsClient,
		interval:  interval,
	}
}

// Start launches the reconciliation loop in a background goroutine.
// It waits one interval before the first run, so write-time indexing has time to work.
// Cancel ctx to stop the loop.
func (r *Reconciler) Start(ctx context.Context) {
	go func() {
		log.Printf("[search] Reconciler started, interval=%s", r.interval)
		ticker := time.NewTicker(r.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("[search] Reconciler stopped")
				return
			case <-ticker.C:
				if err := r.reconcile(ctx); err != nil {
					log.Printf("[search] Reconcile error: %v", err)
				}
			}
		}
	}()
}

// RunOnce executes a single reconciliation pass. Useful for manual triggers or testing.
func (r *Reconciler) RunOnce(ctx context.Context) error {
	return r.reconcile(ctx)
}

const lastReconcileDocPath = "system/search-sync"

func (r *Reconciler) reconcile(ctx context.Context) error {
	start := time.Now()
	log.Println("[search] Reconciliation started")

	// Load last reconcile time from Firestore
	lastSync, err := r.loadLastReconcileTime(ctx)
	if err != nil {
		log.Printf("[search] No lastReconcileTime found, doing full sync: %v", err)
		lastSync = time.Time{}
	}

	// Load all users for name resolution
	userMap, err := r.loadUsers(ctx)
	if err != nil {
		return err
	}

	// Reconcile chats + messages
	chatCount, msgCount, err := r.reconcileChats(ctx, lastSync, userMap)
	if err != nil {
		return err
	}

	// Reconcile contacts (always full, it's cheap)
	contactCount, err := r.reconcileContacts(ctx, userMap)
	if err != nil {
		return err
	}

	// Write lastReconcileTime
	now := time.Now()
	if err := r.saveLastReconcileTime(ctx, now); err != nil {
		log.Printf("[search] Failed to save lastReconcileTime: %v", err)
	}

	log.Printf("[search] Reconciliation done in %s: %d chats, %d messages, %d contacts",
		time.Since(start).Round(time.Millisecond), chatCount, msgCount, contactCount)
	return nil
}

func (r *Reconciler) loadLastReconcileTime(ctx context.Context) (time.Time, error) {
	doc, err := r.firestore.Doc(lastReconcileDocPath).Get(ctx)
	if err != nil {
		return time.Time{}, err
	}
	ts, err := doc.DataAt("lastReconcileTime")
	if err != nil {
		return time.Time{}, err
	}
	if t, ok := ts.(time.Time); ok {
		return t, nil
	}
	return time.Time{}, nil
}

func (r *Reconciler) saveLastReconcileTime(ctx context.Context, t time.Time) error {
	_, err := r.firestore.Doc(lastReconcileDocPath).Set(ctx, map[string]interface{}{
		"lastReconcileTime": t,
	})
	return err
}

func (r *Reconciler) loadUsers(ctx context.Context) (map[string]string, error) {
	allUsers, err := r.firestore.Collection("users").Documents(ctx).GetAll()
	if err != nil {
		return nil, err
	}
	m := make(map[string]string, len(allUsers))
	for _, user := range allUsers {
		m[user.Ref.ID] = getString(user.Data(), "username")
	}
	return m, nil
}

func (r *Reconciler) reconcileChats(ctx context.Context, since time.Time, userMap map[string]string) (int, int, error) {
	var query firestore.Query
	if since.IsZero() {
		// Full sync: all chats
		query = r.firestore.Collection("chats").Query
	} else {
		// Incremental: only chats updated since last sync
		query = r.firestore.Collection("chats").Where("updatedAt", ">", since)
	}

	docs, err := query.Documents(ctx).GetAll()
	if err != nil {
		return 0, 0, err
	}

	var chatDocs []ChatIndexDoc
	var msgDocs []MessageIndexDoc
	groupDocs := make(map[string]GroupIndexDoc)
	systemSkipped := 0

	for _, doc := range docs {
		data := doc.Data()
		chatID := doc.Ref.ID

		chatDoc, groupDoc, msgs, skipped := r.buildChatDocs(chatID, data, userMap)
		chatDocs = append(chatDocs, chatDoc)
		if groupDoc != nil {
			groupDocs[chatID] = *groupDoc
		}
		msgDocs = append(msgDocs, msgs...)
		systemSkipped += skipped
	}

	// If incremental, also fetch messages from chats that were updated
	if !since.IsZero() {
		for _, doc := range docs {
			chatID := doc.Ref.ID
			msgQuery := r.firestore.Collection("chats").Doc(chatID).Collection("messages").
				Where("createdAt", ">", since)
			msgSnapshots, err := msgQuery.Documents(ctx).GetAll()
			if err != nil {
				log.Printf("[search] Error fetching messages for chat %s: %v", chatID, err)
				continue
			}
			participants := getStringSlice(doc.Data(), "participants")
			for _, msgDoc := range msgSnapshots {
				msgData := msgDoc.Data()
				msgDoc, ok := buildMessageIndexDocument(msgDoc.Ref.ID, chatID, participants, msgData)
				if !ok {
					systemSkipped++
					continue
				}
				msgDocs = append(msgDocs, msgDoc)
			}
		}
	}

	// Bulk upsert
	if len(chatDocs) > 0 {
		if err := r.sync.BulkIndexChats(ctx, chatDocs); err != nil {
			return 0, 0, err
		}
	}
	groupList := make([]GroupIndexDoc, 0, len(groupDocs))
	for _, g := range groupDocs {
		groupList = append(groupList, g)
	}
	if len(groupList) > 0 {
		if err := r.sync.BulkIndexGroups(ctx, groupList); err != nil {
			return 0, 0, err
		}
	}
	if len(msgDocs) > 0 {
		if err := r.sync.BulkIndexMessages(ctx, msgDocs); err != nil {
			return 0, 0, err
		}
	}

	if systemSkipped > 0 {
		log.Printf("[search] Skipped %d system messages", systemSkipped)
	}

	return len(chatDocs), len(msgDocs), nil
}

func (r *Reconciler) buildChatDocs(chatID string, data map[string]interface{}, userMap map[string]string) (ChatIndexDoc, *GroupIndexDoc, []MessageIndexDoc, int) {
	chatDoc, groupDoc := buildChatIndexDocuments(chatID, data, userMap)

	// Load messages subcollection
	msgDocs, skipped := r.loadChatMessages(chatID, chatDoc.Participants)

	return chatDoc, groupDoc, msgDocs, skipped
}

func (r *Reconciler) loadChatMessages(chatID string, participants []string) ([]MessageIndexDoc, int) {
	ctx := context.Background()
	msgSnap, err := r.firestore.Collection("chats").Doc(chatID).Collection("messages").Documents(ctx).GetAll()
	if err != nil {
		log.Printf("[search] Error loading messages for chat %s: %v", chatID, err)
		return nil, 0
	}

	var docs []MessageIndexDoc
	skipped := 0

	for _, doc := range msgSnap {
		data := doc.Data()
		messageDoc, ok := buildMessageIndexDocument(doc.Ref.ID, chatID, participants, data)
		if !ok {
			skipped++
			continue
		}
		docs = append(docs, messageDoc)
	}

	return docs, skipped
}

func (r *Reconciler) reconcileContacts(ctx context.Context, userMap map[string]string) (int, error) {
	docs := make([]ContactIndexDoc, 0, len(userMap))
	for uid, username := range userMap {
		docs = append(docs, ContactIndexDoc{
			ID:       uid,
			Username: username,
		})
	}
	if err := r.sync.BulkIndexContacts(ctx, docs); err != nil {
		return 0, err
	}
	return len(docs), nil
}

// ReconcileIntervalFromEnv reads SEARCH_RECONCILE_INTERVAL env var, defaulting to 6h.
func ReconcileIntervalFromEnv() time.Duration {
	s := os.Getenv("SEARCH_RECONCILE_INTERVAL")
	if s == "" {
		return 6 * time.Hour
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		log.Printf("[search] Invalid SEARCH_RECONCILE_INTERVAL=%q, using 6h", s)
		return 6 * time.Hour
	}
	return d
}

// Helpers

func getString(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}

func getStringSlice(m map[string]interface{}, key string) []string {
	if values, ok := m[key].([]string); ok {
		return values
	}
	arr, ok := m[key].([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok {
			result = append(result, s)
		}
	}
	return result
}

func getTimeMillis(m map[string]interface{}, key string) int64 {
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch t := v.(type) {
	case time.Time:
		return t.UnixMilli()
	case *time.Time:
		if t == nil {
			return 0
		}
		return t.UnixMilli()
	default:
		return 0
	}
}

func getMapKeys(m map[string]interface{}, key string) []string {
	v, ok := m[key].(map[string]interface{})
	if !ok || len(v) == 0 {
		return nil
	}
	keys := make([]string, 0, len(v))
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func buildChatIndexDocuments(chatID string, data map[string]interface{}, usernames map[string]string) (ChatIndexDoc, *GroupIndexDoc) {
	isGroup, _ := data["isGroup"].(bool)
	participantIDs := getStringSlice(data, "participants")
	participantNames := make([]string, len(participantIDs))
	for i, userID := range participantIDs {
		participantNames[i] = usernames[userID]
		if participantNames[i] == "" {
			participantNames[i] = userID
		}
	}

	chatDoc := ChatIndexDoc{
		ID:               chatID,
		GroupName:        getString(data, "groupName"),
		IsGroup:          isGroup,
		Participants:     participantIDs,
		ParticipantNames: participantNames,
		UpdatedAt:        getTimeMillis(data, "updatedAt"),
	}
	if isGroup && chatDoc.GroupName == "" {
		chatDoc.GroupName = "Unnamed Group"
	}
	if !isGroup {
		return chatDoc, nil
	}
	return chatDoc, &GroupIndexDoc{
		ID:               chatID,
		Participants:     participantIDs,
		ParticipantNames: participantNames,
		UpdatedAt:        chatDoc.UpdatedAt,
	}
}

func buildMessageIndexDocument(messageID string, chatID string, participants []string, data map[string]interface{}) (MessageIndexDoc, bool) {
	if getString(data, "type") == "system" {
		return MessageIndexDoc{}, false
	}
	return MessageIndexDoc{
		ID:           messageID,
		Content:      getString(data, "content"),
		SenderID:     getString(data, "senderId"),
		ChatID:       chatID,
		Participants: participants,
		MediaType:    getString(data, "mediaType"),
		DocumentName: getString(data, "documentName"),
		CreatedAt:    getTimeMillis(data, "createdAt"),
		DeliveredTo:  getMapKeys(data, "deliveredTo"),
		ReadBy:       getMapKeys(data, "readBy"),
	}, true
}
