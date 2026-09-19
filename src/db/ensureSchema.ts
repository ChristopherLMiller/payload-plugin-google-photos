import type { Payload } from 'payload'

type SqlAdapter = {
  defaultIDType?: 'number' | 'text'
  drizzle?: {
    execute?: (query: unknown) => Promise<unknown>
    run?: (query: unknown) => Promise<unknown>
  }
  name?: string
  packageName?: string
  pool?: {
    query: (text: string) => Promise<unknown>
  }
}

function tableName(slug: string): string {
  return slug.replace(/-/g, '_')
}

function isSqlAdapter(db: SqlAdapter): boolean {
  const id = `${db.packageName || ''} ${db.name || ''}`.toLowerCase()
  return id.includes('postgres') || id.includes('sqlite') || id.includes('vercel-postgres')
}

function isSqlite(db: SqlAdapter): boolean {
  return `${db.packageName || ''} ${db.name || ''}`.toLowerCase().includes('sqlite')
}

export function buildPluginSchemaStatements(args: {
  idType: 'number' | 'text'
  sqlite?: boolean
  usersTable: string
}): string[] {
  const idColumn =
    args.idType === 'number' ? 'serial PRIMARY KEY NOT NULL' : 'varchar PRIMARY KEY NOT NULL'
  const fkType = args.idType === 'number' ? 'integer' : 'varchar'
  const timestamp = args.sqlite
    ? 'timestamp DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')) NOT NULL'
    : 'timestamp(3) with time zone DEFAULT now() NOT NULL'

  const statements = [
    `CREATE TABLE IF NOT EXISTS "google_photos_oauth" (
      "id" ${idColumn},
      "user_id" ${fkType} NOT NULL,
      "google_email" varchar,
      "encrypted_refresh_token" varchar NOT NULL,
      "access_token" varchar,
      "access_token_expires_at" ${args.sqlite ? 'timestamp' : 'timestamp(3) with time zone'},
      "scope" varchar,
      "updated_at" ${timestamp},
      "created_at" ${timestamp}
    )`,
    `CREATE TABLE IF NOT EXISTS "google_photos_imports" (
      "id" ${idColumn},
      "google_photos_id" varchar NOT NULL,
      "target_collection" varchar NOT NULL,
      "document_id" varchar NOT NULL,
      "filename" varchar,
      "updated_at" ${timestamp},
      "created_at" ${timestamp}
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "google_photos_oauth_user_idx" ON "google_photos_oauth" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "google_photos_oauth_updated_at_idx" ON "google_photos_oauth" ("updated_at")`,
    `CREATE INDEX IF NOT EXISTS "google_photos_oauth_created_at_idx" ON "google_photos_oauth" ("created_at")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "google_photos_imports_google_photos_id_target_collecti_idx" ON "google_photos_imports" ("google_photos_id", "target_collection")`,
    `CREATE INDEX IF NOT EXISTS "google_photos_imports_google_photos_id_idx" ON "google_photos_imports" ("google_photos_id")`,
    `CREATE INDEX IF NOT EXISTS "google_photos_imports_target_collection_idx" ON "google_photos_imports" ("target_collection")`,
    `CREATE INDEX IF NOT EXISTS "google_photos_imports_updated_at_idx" ON "google_photos_imports" ("updated_at")`,
    `CREATE INDEX IF NOT EXISTS "google_photos_imports_created_at_idx" ON "google_photos_imports" ("created_at")`,
    `ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "google_photos_oauth_id" ${fkType}`,
    `ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "google_photos_imports_id" ${fkType}`,
    `ALTER TABLE "payload_preferences_rels" ADD COLUMN IF NOT EXISTS "google_photos_oauth_id" ${fkType}`,
    `ALTER TABLE "payload_preferences_rels" ADD COLUMN IF NOT EXISTS "google_photos_imports_id" ${fkType}`,
    `CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_google_photos_oauth_id_idx" ON "payload_locked_documents_rels" ("google_photos_oauth_id")`,
    `CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_google_photos_imports_id_idx" ON "payload_locked_documents_rels" ("google_photos_imports_id")`,
    `CREATE INDEX IF NOT EXISTS "payload_preferences_rels_google_photos_oauth_id_idx" ON "payload_preferences_rels" ("google_photos_oauth_id")`,
    `CREATE INDEX IF NOT EXISTS "payload_preferences_rels_google_photos_imports_id_idx" ON "payload_preferences_rels" ("google_photos_imports_id")`,
  ]

  if (!args.sqlite) {
    statements.push(
      `DO $$ BEGIN
        ALTER TABLE "google_photos_oauth"
          ADD CONSTRAINT "google_photos_oauth_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."${args.usersTable}"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
      `DO $$ BEGIN
        ALTER TABLE "payload_locked_documents_rels"
          ADD CONSTRAINT "payload_locked_documents_rels_google_photos_oauth_fk"
          FOREIGN KEY ("google_photos_oauth_id") REFERENCES "public"."google_photos_oauth"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
      `DO $$ BEGIN
        ALTER TABLE "payload_locked_documents_rels"
          ADD CONSTRAINT "payload_locked_documents_rels_google_photos_imports_fk"
          FOREIGN KEY ("google_photos_imports_id") REFERENCES "public"."google_photos_imports"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
      `DO $$ BEGIN
        ALTER TABLE "payload_preferences_rels"
          ADD CONSTRAINT "payload_preferences_rels_google_photos_oauth_fk"
          FOREIGN KEY ("google_photos_oauth_id") REFERENCES "public"."google_photos_oauth"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
      `DO $$ BEGIN
        ALTER TABLE "payload_preferences_rels"
          ADD CONSTRAINT "payload_preferences_rels_google_photos_imports_fk"
          FOREIGN KEY ("google_photos_imports_id") REFERENCES "public"."google_photos_imports"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    )
  }

  return statements
}

async function executeStatement(db: SqlAdapter, statement: string): Promise<void> {
  if (typeof db.pool?.query === 'function') {
    await db.pool.query(statement)
    return
  }

  if (typeof db.drizzle?.execute === 'function') {
    await db.drizzle.execute(statement)
    return
  }

  if (typeof db.drizzle?.run === 'function') {
    await db.drizzle.run(statement)
  }
}

export async function ensurePluginSchema(payload: Payload, usersSlug = 'users'): Promise<void> {
  const db = payload.db as unknown as SqlAdapter
  if (!isSqlAdapter(db)) {
    return
  }

  const statements = buildPluginSchemaStatements({
    idType: db.defaultIDType === 'text' ? 'text' : 'number',
    sqlite: isSqlite(db),
    usersTable: tableName(usersSlug),
  })

  for (const statement of statements) {
    try {
      await executeStatement(db, statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const ignorable =
        /already exists|duplicate column|duplicate_object|duplicate key/i.test(message) ||
        message.includes('SQLITE_ERROR: duplicate')
      if (!ignorable) {
        payload.logger.error({
          err: error,
          msg: `Google Photos plugin could not apply SQL schema: ${message}`,
        })
        throw error
      }
    }
  }
}
