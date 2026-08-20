import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus, Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { systemApi } from '../services/api';

interface UpdateContextValue {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  apkUrl: string | null;
  forceUpdate: boolean;
  modalVisible: boolean;
  isDismissed: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  openModal: () => void;
  closeModal: () => void;
  dismissBadge: () => void;
  triggerDownload: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const currentVersion = Constants.expoConfig?.version ?? '0.0.0';
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const appState = useRef(AppState.currentState);

  const checkForUpdate = useCallback(async () => {
    try {
      const info = await systemApi.getAppVersion();
      if (!info || !info.latest_version) return;

      const isNewer = info.latest_version !== currentVersion;
      if (isNewer && info.apk_url) {
        setLatestVersion(info.latest_version);
        setApkUrl(info.apk_url);
        setForceUpdate(true); // all updates are mandatory
        setUpdateAvailable(true);
        setModalVisible(true); // always open modal when update is available
      } else {
        setUpdateAvailable(false);
      }
    } catch {
      // Non-fatal — ignore if backend is unreachable
    }
  }, [currentVersion]);

  useEffect(() => {
    checkForUpdate();

    const interval = setInterval(() => {
      checkForUpdate();
    }, CHECK_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        checkForUpdate();
      }
      appState.current = nextAppState;
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [checkForUpdate]);

  const openModal = useCallback(() => {
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    // Updates are always mandatory — modal cannot be dismissed
  }, []);

  const dismissBadge = useCallback(() => {
    // Updates are always mandatory — badge cannot be dismissed
  }, []);

  const triggerDownload = useCallback(async () => {
    if (!apkUrl) return;

    if (Platform.OS === 'android') {
      try {
        setIsDownloading(true);
        setDownloadProgress(0);

        const targetFile = `${FileSystem.cacheDirectory}app-update.apk`;

        const downloadResumable = FileSystem.createDownloadResumable(
          apkUrl,
          targetFile,
          {},
          (progress) => {
            if (progress.totalBytesExpectedToWrite > 0) {
              const p = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
              setDownloadProgress(Math.min(1, Math.max(0, p)));
            }
          }
        );

        const result = await downloadResumable.downloadAsync();
        if (result?.uri) {
          const contentUri = await FileSystem.getContentUriAsync(result.uri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: 'application/vnd.android.package-archive',
          });
        }
      } catch (err) {
        // Fallback to browser download if intent or file system fails
        Linking.openURL(apkUrl).catch(() => {});
      } finally {
        setIsDownloading(false);
      }
    } else {
      Linking.openURL(apkUrl).catch(() => {});
    }
  }, [apkUrl]);

  return (
    <UpdateContext.Provider
      value={{
        updateAvailable,
        latestVersion,
        currentVersion,
        apkUrl,
        forceUpdate,
        modalVisible,
        isDismissed,
        isDownloading,
        downloadProgress,
        openModal,
        closeModal,
        dismissBadge,
        triggerDownload,
        checkForUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error('useUpdate must be used within an UpdateProvider');
  }
  return ctx;
}
