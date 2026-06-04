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
 * Contacts belong to the currently logged-in Clerk user and are identified
 * using the normalized email address.
 */
export async function saveContactLocally(
  input: ContactCreateInput,
): Promise<Contact | null> {
  const db = await getDatabase();

  const name = input.name.trim();
  const email = input.email.trim();
  const normalizedEmail = normalizeEmail(email);
  const now = getUtcNowIsoTimestamp();

  if (!input.clerkUserId) {
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
    [input.clerkUserId, name, email, normalizedEmail, now, now],
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

/**
 * Returns all locally saved contacts for the current user.
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
 * Returns a saved contact using the email shown by the selected conversation.
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
 * Renames a saved contact for the current user only.
 *
 * This also updates the local conversation title so that ChatListScreen and
 * ChatScreen can immediately show the changed saved name.
 *
 * It does not change the other user's real profile name.
 */
export async function renameSavedContact(
  clerkUserId: string,
  contactEmail: string,
  conversationId: number,
  savedName: string,
): Promise<void> {
  const db = await getDatabase();

  const trimmedName = savedName.trim();
  const trimmedEmail = contactEmail.trim();
  const normalizedEmail = normalizeEmail(trimmedEmail);
  const now = getUtcNowIsoTimestamp();

  if (!clerkUserId) {
    throw new Error('Logged-in user is unavailable.');
  }

  if (!trimmedName) {
    throw new Error('Contact name is required.');
  }

  if (!isValidEmail(trimmedEmail)) {
    throw new Error('A valid contact email is required.');
  }

  await db.withTransactionAsync(async () => {
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
      [
        clerkUserId,
        trimmedName,
        trimmedEmail,
        normalizedEmail,
        now,
        now,
      ],
    );

    await db.runAsync(
      `
        UPDATE conversations
        SET title = ?,
            updated_at = ?
        WHERE id = ?;
      `,
      [trimmedName, now, conversationId],
    );
  });
}

/**
 * Deletes the saved contact and the selected local conversation.
 *
 * This removes:
 * - the contact from the current user's contacts
 * - the selected conversation from the current user's chat list
 * - all locally stored messages inside that selected conversation
 *
 * It does not delete the other participant's copy of the chat.
 */
export async function deleteContactAndConversation(
  clerkUserId: string,
  contactEmail: string,
  conversationId: number,
): Promise<void> {
  const db = await getDatabase();

  const normalizedEmail = normalizeEmail(contactEmail);

  if (!clerkUserId) {
    throw new Error('Logged-in user is unavailable.');
  }

  if (!normalizedEmail) {
    throw new Error('Contact email is unavailable.');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        DELETE FROM messages
        WHERE conversation_id = ?;
      `,
      [conversationId],
    );

    await db.runAsync(
      `
        DELETE FROM conversations
        WHERE id = ?;
      `,
      [conversationId],
    );

    await db.runAsync(
      `
        DELETE FROM contacts
        WHERE clerk_user_id = ?
          AND normalized_email = ?;
      `,
      [clerkUserId, normalizedEmail],
    );
  });
}

/**
 * Debug helper for inspecting locally saved contacts.
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