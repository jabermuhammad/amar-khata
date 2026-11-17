import { deleteField } from 'firebase/firestore';

/** Persist one sender/recipient request at a stable path; transactions serialize concurrent sends. */
export async function persistConnectionInvite({ database, inviteRef, invitation, firestore, assertCurrentUser = () => {} }) {
  const { runTransaction } = firestore;
  return runTransaction(database, async transaction => {
    assertCurrentUser();
    const current = await transaction.get(inviteRef);
    assertCurrentUser();
    if (current.exists()) {
      const prior = current.data();
      const expiry = prior.expiresAt?.toMillis?.() ?? prior.expiresAt?.getTime?.() ?? 0;
      if (prior.status === 'accepted') throw new Error('এই ব্যক্তি ইতিমধ্যে আপনার পরিচিতি।');
      if (prior.status === 'pending' && expiry > Date.now()) return inviteRef.id;
      assertCurrentUser();
      transaction.update(inviteRef, {
        ...invitation,
        declinedAt: deleteField(), acceptedBy: deleteField(), acceptedAt: deleteField(), connectionId: deleteField(),
      });
    } else { assertCurrentUser(); transaction.set(inviteRef, invitation); }
    return inviteRef.id;
  });
}
