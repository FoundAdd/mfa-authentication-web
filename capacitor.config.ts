import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.hy.mfaauthenticator',
  appName: 'MFA Authenticator',
  webDir: 'dist',
  android: {
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
