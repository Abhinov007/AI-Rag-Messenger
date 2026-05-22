import { getDatabase } from './database';
import type { Contact, ContactCreateInput } from '../types/contacts';

type ContactRow = {
  id: number;
  clerk_user_id: string;
  name: string;
  email: string;
  normalized_email: string;
  remote_id: string | null;
  synced: number;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    name: row.name,
    email: row.email,
    normalizedEmail: row.normalized_email,
    remoteId: row.remote_id,
    synced: Boolean(row.synced),
    syncError: row.sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function saveContactLocally(
  input: ContactCreateInput,
): Promise<Contact | null> {
  const db = await getDatabase();

  const name = input.name.trim();
  const email = input.email.trim();
  const normalizedEmail = normalizeEmail(email);

  await db.runAsync(
    `
    INSERT INTO contacts
    (
      clerk_user_id,
      name,
      email,
      normalized_email,
      synced,
      sync_error
    )
    VALUES (?, ?, ?, ?, 0, NULL)
    ON CONFLICT(clerk_user_id, normalized_email)
    DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      updated_at = CURRENT_TIMESTAMP,
      synced = 0,
      sync_error = NULL;
    `,
    [input.clerkUserId, name, email, normalizedEmail],
  );

  const row = await db.getFirstAsync<ContactRow>(
    `
    SELECT *
    FROM contacts
    WHERE clerk_user_id = ?
    AND normalized_email = ?
    LIMIT 1;
    `,
    [input.clerkUserId, normalizedEmail],
  );

  return row ? mapContact(row) : null;
}

export async function getContactsForUser(
  clerkUserId: string,
): Promise<Contact[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<ContactRow>(
    `
    SELECT *
    FROM contacts
    WHERE clerk_user_id = ?
    ORDER BY name COLLATE NOCASE ASC;
    `,
    [clerkUserId],
  );

  return rows.map(mapContact);
}

export async function debugContactsForUser(clerkUserId: string) {
  const contacts = await getContactsForUser(clerkUserId);

  console.log('Contacts DB check:', {
    clerkUserId,
    count: contacts.length,
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      normalizedEmail: contact.normalizedEmail,
      synced: contact.synced,
      remoteId: contact.remoteId,
    })),
  });
}