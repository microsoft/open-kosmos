import { CardStore } from "../lib/store";

// VENDOR PATCH: upstream calls autoSync() (git cross-device sync) after archiving;
// removed — OpenKosmos does not use memex sync. See vendor/PATCHES.md.
interface ArchiveResult {
  success: boolean;
  error?: string;
}

export async function archiveCommand(store: CardStore, slug: string): Promise<ArchiveResult> {
  try {
    await store.archiveCard(slug);
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
