export type Contact = {
    id: number;
    clerkUserId: string;
    name: string;
    email: string;
    normalizedEmail: string;
    remoteId: string | null;
    synced: boolean;
    syncError: string | null;
    createdAt: string;
    updatedAt: string;
  };
  
  export type ContactCreateInput = {
    clerkUserId: string;
    name: string;
    email: string;
  };