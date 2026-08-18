import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus, Linking } from 'react-native';
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
  openModal: () => void;
  closeModal: () => void;
  dismissBadge: () => void;
  triggerDownload: () => void;
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
  const appState = useRef(AppState.currentState);

  const checkForUpdate = useCallback(async () => {
    try {
      const info = await systemApi.getAppVersion();
      if (!info || !info.latest_version) return;

      const isNewer = info.latest_version !== currentVersion;
      if (isNewer && info.apk_url) {
        setLatestVersion(info.latest_version);
        setApkUrl(info.apk_url);
        setForceUpdate(Boolean(info.force_update));
        setUpdateAvailable(true);
        if (info.force_update) {
          setModalVisible(true);
        }
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
    if (!forceUpdate) {
      setModalVisible(false);
    }
  }, [forceUpdate]);

  const dismissBadge = useCallback(() => {
    if (!forceUpdate) {
      setIsDismissed(true);
    }
  }, [forceUpdate]);

  const triggerDownload = useCallback(() => {
    if (apkUrl) {
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
