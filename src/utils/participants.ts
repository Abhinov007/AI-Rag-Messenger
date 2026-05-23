export function createParticipantKey(userA: string, userB: string) {
    return [userA, userB].sort().join('__');
  }