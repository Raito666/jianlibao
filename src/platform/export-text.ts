export type ExportFile = { name: string; text: string; type: string };
export type ExportResult = 'shared' | 'downloaded' | 'cancelled' | 'busy';
export interface FileSharePort {
  write(path: string, text: string): Promise<{ uri: string }>;
  remove(path: string): Promise<void>;
  share(uri: string, title: string): Promise<void>;
}
export function createFileExporter(ports: {
  native: () => boolean;
  load: () => Promise<FileSharePort>;
  download: (file: ExportFile) => void;
}) {
  let busy = false;
  return async (file: ExportFile): Promise<ExportResult> => {
    if (!file.name || /[\\/\x00-\x1f]/.test(file.name) || file.name === '.' || file.name === '..') throw new Error('导出文件名无效');
    if (!ports.native()) { ports.download(file); return 'downloaded'; }
    if (busy) return 'busy';
    busy = true;
    let port: FileSharePort | undefined;
    const path = `exports/${crypto.randomUUID()}-${file.name}`;
    let written = false;
    try {
      port = await ports.load();
      const { uri } = await port.write(path, file.text);
      written = true;
      if (!uri.startsWith('file://')) throw new Error('未取得可分享的本地文件');
      await port.share(uri, file.name);
      return 'shared';
    } catch (error) {
      if (error instanceof Error && /^(Share canceled|Share cancelled)$/i.test(error.message)) return 'cancelled';
      throw error;
    } finally {
      if (written && port) { try { await port.remove(path); } catch { /* Cache is reclaimable; sharing already finished. */ } }
      busy = false;
    }
  };
}
