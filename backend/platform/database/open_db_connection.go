package database

import "github.com/jmoiron/sqlx"

// OpenDBConnection func for opening database connection.
func OpenDBConnection() (*sqlx.DB, error) {
	return PostgreSQLConnection()
}
