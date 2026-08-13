import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { env } from './lib/env'

const dbPath = resolve(process.cwd(), env.databasePath)
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

export interface UserRow {
  id: number
  login: string
  password_hash: string
  created_at: string
}

export function findUserByLogin(login: string): UserRow | undefined {
  return db
    .prepare('SELECT id, login, password_hash, created_at FROM users WHERE login = ?')
    .get(login) as UserRow | undefined
}

export function findUserById(id: number): UserRow | undefined {
  return db
    .prepare('SELECT id, login, password_hash, created_at FROM users WHERE id = ?')
    .get(id) as UserRow | undefined
}

export function createUser(login: string, passwordHash: string): UserRow {
  const result = db
    .prepare('INSERT INTO users (login, password_hash) VALUES (?, ?)')
    .run(login, passwordHash)

  const user = findUserById(Number(result.lastInsertRowid))
  if (!user) {
    throw new Error('Failed to create user')
  }
  return user
}
