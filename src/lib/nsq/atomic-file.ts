/** File System Access commits replacement bytes only on close(). */
export interface NsqWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
export interface NsqSaveHandle {
  name: string;
  createWritable(): Promise<NsqWritable>;
}
export async function writeAtomically<T extends { blob: Blob }>(
  handle: NsqSaveHandle,
  build: () => Promise<T>,
): Promise<T> {
  // Validation/compression finishes before touching the destination.
  const result = await build();
  const writable = await handle.createWritable();
  try {
    await writable.write(result.blob);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
  return result;
}
