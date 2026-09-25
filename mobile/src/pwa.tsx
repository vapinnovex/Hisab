import React, { useEffect, useState } from 'react';
import { Platform, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, colors, styles } from './components/ui';
import { ApiError, request } from './api';
import { browserOffline, hasPendingWrites, setConnection, useConnection } from './connection';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const drafts = new Set<symbol>();
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const id = Symbol();
    drafts.add(id);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      drafts.delete(id);
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
}

export function InstallHelp() {
  if (Platform.OS !== 'web') return null;
  return (
    <Card>
      <Text style={styles.heading}>Hishob on your home screen</Text>
      <Text style={styles.subtitle}>
        Android: open in Chrome, then choose “Install app” or “Add to Home screen” from the menu.
      </Text>
      <Text style={styles.subtitle}>
        iPhone: open in Safari, tap Share → Add to Home Screen → enable Open as Web App if shown →
        Add.
      </Text>
      <Text style={styles.small}>
        Use the installed app for everyday work. Your login stays active until it expires or is
        signed out. A browser and its installed app may require separate logins.
      </Text>
    </Card>
  );
}

export function WebExperience() {
  const connection = useConnection();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [help, setHelp] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updateError, setUpdateError] = useState('');
  const [checking, setChecking] = useState(false);
  const [installError, setInstallError] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const standalone = window.matchMedia('(display-mode: standalone)');
    const isInstalled = () =>
      setInstalled(
        standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    isInstalled();
    standalone.addEventListener('change', isInstalled);
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const complete = () => {
      setInstalled(true);
      setInstall(null);
      setHelp(false);
    };
    const offline = () => setConnection('offline');
    const probe = () => {
      void request('/auth/me').catch(() => undefined);
    };
    if (browserOffline()) offline();
    window.addEventListener('beforeinstallprompt', prompt);
    window.addEventListener('appinstalled', complete);
    window.addEventListener('offline', offline);
    window.addEventListener('online', probe);
    return () => {
      standalone.removeEventListener('change', isInstalled);
      window.removeEventListener('beforeinstallprompt', prompt);
      window.removeEventListener('appinstalled', complete);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', probe);
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || connection === 'online') return;
    const timer = setInterval(() => {
      if (!browserOffline() && document.visibilityState === 'visible')
        void request('/auth/me').catch(() => undefined);
    }, 10000);
    return () => clearInterval(timer);
  }, [connection]);
  useEffect(() => {
    if (Platform.OS !== 'web' || __DEV__ || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    let cleanup = () => {};
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        if (cancelled) return;
        const inspect = () => {
          setWaiting(navigator.serviceWorker.controller ? registration.waiting : null);
        };
        const found = () => {
          registration.installing?.addEventListener('statechange', inspect);
        };
        inspect();
        registration.addEventListener('updatefound', found);
        const check = () => {
          if (document.visibilityState === 'visible' && !browserOffline())
            void registration.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', check);
        cleanup = () => {
          registration.removeEventListener('updatefound', found);
          document.removeEventListener('visibilitychange', check);
        };
      })
      .catch(() =>
        setInstallError(
          'Offline app setup could not finish. Reopen Hishob when connected to try again.',
        ),
      );
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);
  if (Platform.OS !== 'web') return null;
  const retry = async () => {
    setChecking(true);
    try {
      await request('/auth/me');
    } catch (error) {
      if (!(error instanceof ApiError)) return;
    } finally {
      setChecking(false);
    }
  };
  const applyUpdate = () => {
    if (hasPendingWrites()) {
      setUpdateError('Wait for the current request to finish before updating.');
      return;
    }
    if (drafts.size) {
      setUpdateError('Save or leave your open forms before updating. Your entries have been kept.');
      return;
    }
    if (browserOffline()) {
      setUpdateError('Reconnect before updating Hishob.');
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
  return (
    <>
      {connection !== 'online' && (
        <View accessibilityRole="alert" style={{ backgroundColor: '#FFF0D0', padding: 12, gap: 6 }}>
          <Text style={[styles.label, { color: colors.ink }]}>
            {connection === 'offline' ? 'You’re offline' : 'Connection interrupted'}
          </Text>
          <Text style={styles.small}>
            Shown information may be out of date. Reconnect to load the latest data and save
            changes.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
            disabled={checking}
            onPress={() => void retry()}
          >
            <Text style={{ color: colors.green, fontWeight: '700' }}>
              {checking ? 'Checking…' : 'Retry connection'}
            </Text>
          </Pressable>
        </View>
      )}
      {waiting ? (
        <View style={{ backgroundColor: colors.mint, padding: 10, gap: 6 }}>
          <Text style={styles.small}>
            A new Hishob version is ready. Save your work before updating.
          </Text>
          {!!updateError && (
            <Text accessibilityRole="alert" style={styles.small}>
              {updateError}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Update Hishob"
            onPress={applyUpdate}
          >
            <Text style={styles.label}>Update Hishob</Text>
          </Pressable>
        </View>
      ) : !installed && !dismissed ? (
        <View
          style={{
            backgroundColor: colors.mint,
            paddingHorizontal: 16,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Install Hishob"
            onPress={() => setHelp(true)}
          >
            <Text style={styles.label}>＋ Install Hishob</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss install suggestion"
            hitSlop={10}
            onPress={() => setDismissed(true)}
          >
            <Text style={styles.small}>Later</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal visible={help} transparent animationType="none" onRequestClose={() => setHelp(false)}>
        <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 }}>
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: colors.background,
              borderRadius: 24,
              padding: 20,
              gap: 14,
              width: '100%',
              maxWidth: 480,
              maxHeight: '90%',
              alignSelf: 'center',
            }}
          >
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }}>
              <InstallHelp />
              {!!installError && (
                <Text accessibilityRole="alert" style={styles.small}>
                  {installError}
                </Text>
              )}
              {install && (
                <Button
                  title="Add Hishob to this device"
                  onPress={() => {
                    void (async () => {
                      try {
                        await install.prompt();
                        const choice = await install.userChoice;
                        if (choice.outcome === 'accepted') setHelp(false);
                        setInstall(null);
                      } catch {
                        setInstallError('Use your browser menu to install Hishob.');
                      }
                    })();
                  }}
                />
              )}
            </ScrollView>
            <Button title="Done" secondary onPress={() => setHelp(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
