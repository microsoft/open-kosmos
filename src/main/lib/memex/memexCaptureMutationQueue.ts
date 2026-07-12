const captureMutationLocks = new Map<string, Promise<void>>();

export async function withSerializedCaptureMutation<T>(cardsDir: string, action: () => Promise<T>): Promise<T> {
  const previous = captureMutationLocks.get(cardsDir) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chained = previous.then(() => current);
  captureMutationLocks.set(cardsDir, chained);

  await previous;
  try {
    return await action();
  } finally {
    releaseCurrent();
    if (captureMutationLocks.get(cardsDir) === chained) {
      captureMutationLocks.delete(cardsDir);
    }
  }
}
