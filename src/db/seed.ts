/**
 * Starter data for local development.
 *
 * This gives the chat list something real to render from SQLite before the app
 * has a create-chat screen.
 */
import { createConversation, listConversations } from './conversationRepository';
import { addMessage } from './messageRepository';

/**
 * Inserts demo conversations only when the database is empty.
 */
export async function seedStarterConversations() {
  const existingConversations = await listConversations();

  if (existingConversations.length > 0) {
    return;
  }

  const projectNotesId = await createConversation('Project Notes');
  await addMessage(
    projectNotesId,
    'system',
    'Local summaries and smart reply testing will live here.',
  );
  await addMessage(
    projectNotesId,
    'assistant',
    'Conversation tables are ready for message history and future RAG lookup.',
  );

  const familyId = await createConversation('Family');
  await addMessage(
    familyId,
    'user',
    'Placeholder chat thread for the next messaging step.',
  );

  const workId = await createConversation('Work');
  await addMessage(
    workId,
    'assistant',
    'RAG-backed search can surface older decisions here later.',
  );
}
