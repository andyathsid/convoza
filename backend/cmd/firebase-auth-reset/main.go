package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

const allowedDestination = "andyathsid-migration-rehearsal"

type serviceAccount struct {
	ProjectID string `json:"project_id"`
}

type result struct {
	Project        string `json:"project"`
	UsersBefore    int    `json:"usersBefore"`
	DeletedUsers   int    `json:"deletedUsers"`
	DeletionErrors int    `json:"deletionErrors"`
	UsersAfter     int    `json:"usersAfter"`
	Status         string `json:"status"`
}

func main() {
	log.SetFlags(0)

	var projectID, credentialsFile, confirmation string
	var execute bool
	flag.StringVar(&projectID, "project", "", "exact destination Firebase project ID")
	flag.StringVar(&credentialsFile, "credentials", "", "destination service-account JSON file")
	flag.StringVar(&confirmation, "confirm-project", "", "exact destination project ID required with --execute")
	flag.BoolVar(&execute, "execute", false, "delete all destination Authentication users")
	flag.Parse()

	if projectID != allowedDestination {
		log.Fatalf("refusing project %q: only %q is allowed", projectID, allowedDestination)
	}
	if credentialsFile == "" {
		log.Fatal("--credentials is required")
	}
	if execute && confirmation != projectID {
		log.Fatalf("--execute requires --confirm-project=%s", projectID)
	}

	credentialProject, err := readCredentialProject(credentialsFile)
	if err != nil {
		log.Fatal(err)
	}
	if credentialProject != projectID {
		log.Fatalf("credential project %q does not match destination %q", credentialProject, projectID)
	}

	ctx := context.Background()
	app, err := firebase.NewApp(
		ctx,
		&firebase.Config{ProjectID: projectID},
		option.WithAuthCredentialsFile(option.ServiceAccount, credentialsFile),
	)
	if err != nil {
		log.Fatalf("initialize Firebase Admin SDK: %v", err)
	}
	client, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("initialize Firebase Authentication client: %v", err)
	}

	uids, err := listUIDs(ctx, client)
	if err != nil {
		log.Fatalf("list destination Authentication users: %v", err)
	}

	report := result{
		Project:     projectID,
		UsersBefore: len(uids),
		UsersAfter:  len(uids),
		Status:      "dry_run",
	}
	if !execute {
		writeJSON(report)
		return
	}

	// Firebase limits batch deletion to 1,000 users and approximately one request
	// per second, so bounded batches keep large rehearsals inside the documented API limit.
	for start := 0; start < len(uids); start += 1000 {
		end := min(start+1000, len(uids))
		deletion, err := client.DeleteUsers(ctx, uids[start:end])
		if err != nil {
			log.Fatalf("delete Authentication user batch: %v", err)
		}
		report.DeletedUsers += deletion.SuccessCount
		report.DeletionErrors += deletion.FailureCount
		if end < len(uids) {
			time.Sleep(1100 * time.Millisecond)
		}
	}

	remaining, err := listUIDs(ctx, client)
	if err != nil {
		log.Fatalf("verify destination Authentication users: %v", err)
	}
	report.UsersAfter = len(remaining)
	report.Status = "empty"
	if report.DeletionErrors != 0 || report.UsersAfter != 0 {
		report.Status = "failed"
	}
	writeJSON(report)
	if report.Status != "empty" {
		os.Exit(1)
	}
}

func readCredentialProject(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read credentials: %w", err)
	}
	var credential serviceAccount
	if err := json.Unmarshal(data, &credential); err != nil {
		return "", fmt.Errorf("parse credentials: %w", err)
	}
	if credential.ProjectID == "" {
		return "", errors.New("credentials do not contain project_id")
	}
	return credential.ProjectID, nil
}

func listUIDs(ctx context.Context, client *auth.Client) ([]string, error) {
	var uids []string
	users := client.Users(ctx, "")
	for {
		user, err := users.Next()
		if errors.Is(err, iterator.Done) {
			return uids, nil
		}
		if err != nil {
			return nil, err
		}
		uids = append(uids, user.UID)
	}
}

func writeJSON(value result) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		log.Fatalf("encode result: %v", err)
	}
}
