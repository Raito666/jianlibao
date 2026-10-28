// Loaded only on iOS. Keeping plugin proxies inside this module avoids async thenable assimilation.
import { registerPlugin } from '@capacitor/core';
import type { HapticsPlugin } from '@capacitor/haptics';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import type { AppPlugin } from '@capacitor/app';
import type { FilesystemPlugin, Directory, Encoding } from '@capacitor/filesystem';
import type { SharePlugin } from '@capacitor/share';
import type { FileSharePort } from './export-text';
import type { SyncKeychain } from '../sync/native-store';

export const notifications = registerPlugin<LocalNotificationsPlugin>('LocalNotifications');
export const haptics = registerPlugin<HapticsPlugin>('Haptics');
export const app = registerPlugin<AppPlugin>('App');
export const syncKeychain = registerPlugin<SyncKeychain>('JianlibaoSyncKeychain');
export const http = registerPlugin<{ request(options: import('@capacitor/core').HttpOptions): Promise<import('@capacitor/core').HttpResponse> }>('CapacitorHttp');
const filesystem = registerPlugin<FilesystemPlugin>('Filesystem');
const share = registerPlugin<SharePlugin>('Share');
export const files: FileSharePort = {
  write: (path, text) => filesystem.writeFile({ path, data: text, directory: 'CACHE' as Directory, encoding: 'utf8' as Encoding, recursive: true }),
  remove: async path => { await filesystem.deleteFile({ path, directory: 'CACHE' as Directory }); },
  share: async (uri, title) => { await share.share({ files: [uri], title, dialogTitle: '导出训练记录' }); },
};
