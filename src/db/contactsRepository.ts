import { getDatabase } from './database';
import type { Contact, ContactCreateInput } from '../types/contacts';
import { getUtcNowIsoTimestamp } from '../utils/timestamps';

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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Creates a new local contact or updates an existing saved contact.
 *
 * The saved name belongs only to the currently logged-in user.
 */
export async function saveContactLocally(
  input: ContactCreateInput,
): Promise<Contact | null> {
  const db = await getDatabase();

  const clerkUserId = input.clerkUserId.trim();
  const name = input.name.trim();
  const email = input.email.trim();
  const normalizedEmail = normalizeEmail(email);
  const now = getUtcNowIsoTimestamp();

  if (!clerkUserId) {
    throw new Error('Logged-in user is unavailable.');
  }

  if (!name) {
    throw new Error('Contact name is required.');
  }

  if (!isValidEmail(email)) {
    throw new Error('Enter a valid email address.');
  }

  await db.runAsync(
    `
      INSERT INTO contacts
      (
        clerk_user_id,
        name,
        email,
        normalized_email,
        created_at,
        updated_at,
        synced,
        sync_error
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
      ON CONFLICT(clerk_user_id, normalized_email)
      DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        updated_at = excluded.updated_at,
        synced = 0,
        sync_error = NULL;
    `,
    [clerkUserId, name, email, normalizedEmail, now, now],
  );

  const row = await db.getFirstAsync<ContactRow>(
    `
      SELECT *
      FROM contacts
      WHERE clerk_user_id = ?
        AND normalized_email = ?
      LIMIT 1;
    `,
    [clerkUserId, normalizedEmail],
  );

  return row ? mapContact(row) : null;
}

/**
 * Updates the private saved name for another user.
 *
 * This function intentionally writes only to contacts.
 * It does not update conversations.title or the other user's profile.
 */
export async function renameContactLocally(
  clerkUserId: string,
  contactEmail: string,
  savedName: string,
): Promise<Contact> {
  const contact = await saveContactLocally({
    clerkUserId,
    email: contactEmail,
    name: savedName,
  });

  if (!contact) {
    throw new Error('Unable to save contact name.');
  }

  return contact;
}

/**
 * Returns every saved contact for the logged-in user.
 */
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

/**
 * Returns one saved contact using the email stored on a conversation.
 */
export async function getContactByEmail(
  clerkUserId: string,
  contactEmail: string,
): Promise<Contact | null> {
  const db = await getDatabase();
  const normalizedEmail = normalizeEmail(contactEmail);

  const row = await db.getFirstAsync<ContactRow>(
    `
      SELECT *
      FROM contacts
      WHERE clerk_user_id = ?
        AND normalized_email = ?
      LIMIT 1;
    `,
    [clerkUserId, normalizedEmail],
  );

  return row ? mapContact(row) : null;
}

/**
 * Debug helper for checking locally saved contacts.
 */
export async function debugContactsForUser(
  clerkUserId: string,
): Promise<void> {
  const contacts = await getContactsForUser(clerkUserId);

  console.log('Contacts DB check:', {
    clerkUserId,
    count: contacts.length,
    contacts: contacts.map(contact => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      normalizedEmail: contact.normalizedEmail,
      synced: contact.synced,
      remoteId: contact.remoteId,
    })),
  });
}