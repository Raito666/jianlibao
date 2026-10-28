/// <reference types="@capacitor/splash-screen" />
/// <reference types="@capacitor-community/sqlite" />
/// <reference types="@capacitor/local-notifications" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jianlibao.app',
  appName: '健力宝',
  webDir: 'dist',
  // Debug bridge logs include plugin results, including Keychain reads.
  loggingBehavior: 'none',
  backgroundColor: '#0A0C0A',
  // Keep the native origin stable for future storage migration; bundle local assets, never a dev server.
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
  },
  ios: {
    scheme: 'App',
    // The existing CSS owns safe-area padding; avoid applying a second native content inset.
    contentInset: 'never',
  },
  plugins: {
    // Foreground feedback is owned by the existing Web audio + Haptics controller, avoiding double alerts.
    LocalNotifications: { presentationOptions: [] },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 0,
      showSpinner: false,
      backgroundColor: '#0A0C0A',
    },
    SystemBars: {
      style: 'DARK',
      hidden: false,
      animation: 'NONE',
    },
  },
};

export default config;
