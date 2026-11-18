import { Directory, File, Paths } from 'expo-file-system';

// Recording audio lives under Documents/recordings; the database stores each
// file's URI (tech-stack doc). Nothing here is uploaded.

export function recordingsDir(): Directory {
  return new Directory(Paths.document, 'recordings');
}

export function deleteRecordings(): void {
  const dir = recordingsDir();
  if (dir.exists) dir.delete();
}

/**
 * iOS keeps Keychain items after the app is deleted, but deletes its files.
 * A marker file tells a fresh install apart from a normal launch, so a
 * reinstall doesn't inherit an old PIN or database key.
 */
function installMarker(): File {
  return new File(Paths.document, '.installed');
}

export function isFreshInstall(): boolean {
  return !installMarker().exists;
}

/** Call after the fresh-install cleanup has succeeded. */
export function markInstalled(): void {
  installMarker().create();
}
