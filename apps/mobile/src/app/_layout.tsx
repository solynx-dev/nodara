import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ToastProvider } from '@/components/ui';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { SessionProvider, useSession } from '@/lib/session';
import { ApiError } from '@/lib/api';
import { routeForUrl, syncPushToken } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { ForegroundReporter } from '@/components/ForegroundReporter';
import { C, NAV } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      staleTime: 15_000,
    },
  },
});

/**
 * Pushed pages get a standard title over a translucent (glass on iOS 26)
 * header. No native large titles: with a transparent header they showed up as
 * an empty blurred band until the page was scrolled.
 */
const pageHeader = {
  headerShown: true,
  headerLargeTitle: false,
  headerTransparent: true,
  headerBlurEffect: 'systemChromeMaterial',
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
} as const;

function RootStack() {
  const { ready, server, signedIn } = useSession();
  useRealtime(signedIn);
  useEffect(() => {
    if (signedIn) void syncPushToken();
  }, [signedIn]);

  // Open the right screen when someone taps a push notification.
  useEffect(() => {
    if (!signedIn) return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const route = routeForUrl((r.notification.request.content.data as { url?: string } | undefined)?.url);
      if (route) router.navigate(route as never);
    });
    return () => sub.remove();
  }, [signedIn]);

  if (!ready) return null;
  return (
    <>
      {signedIn && <ForegroundReporter />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!server}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(server) && !signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        {/* Reachable signed in (Account → Password) and signed out (sign-in screen). */}
        <Stack.Screen name="reset-password" options={{ ...pageHeader, presentation: 'modal', headerTransparent: false, title: 'Reset password' }} />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ animation: 'fade' }} />
          <Stack.Screen name="settings" options={{ ...pageHeader, title: 'Settings' }} />
          <Stack.Screen name="account/index" options={{ ...pageHeader, title: 'Account' }} />
          <Stack.Screen name="account/email" options={{ ...pageHeader, title: 'Email' }} />
          <Stack.Screen name="account/password" options={{ ...pageHeader, title: 'Password' }} />
          <Stack.Screen name="account/two-factor" options={{ ...pageHeader, title: 'Two-step verification' }} />
          <Stack.Screen name="account/passkeys" options={{ ...pageHeader, title: 'Passkeys' }} />
          <Stack.Screen name="account/sessions" options={{ ...pageHeader, title: 'Signed in' }} />
          <Stack.Screen name="account/privacy" options={{ ...pageHeader, title: 'History & privacy' }} />
          <Stack.Screen name="bubble" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.92], sheetGrabberVisible: true }} />
          <Stack.Screen name="alerts" options={{ ...pageHeader, title: 'Alerts' }} />
          <Stack.Screen name="trip/[id]" options={{ ...pageHeader, title: 'Trip' }} />
          <Stack.Screen name="circle/[id]" options={{ ...pageHeader, title: 'Circle' }} />
          <Stack.Screen name="driving" options={{ ...pageHeader, title: 'Driving' }} />
          <Stack.Screen name="place/[id]" options={{ headerShown: true, presentation: 'modal', title: 'Place' }} />
          <Stack.Screen name="edit-profile" options={{ ...pageHeader, presentation: 'modal', title: 'Edit profile' }} />
          <Stack.Screen name="share-location" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75], sheetGrabberVisible: true }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={{ ...theme, colors: { ...theme.colors, ...NAV[scheme === 'dark' ? 'dark' : 'light'], primary: C.accent } }}>
          <SessionProvider>
            <ToastProvider>
              <StatusBar style="auto" />
              <RootStack />
            </ToastProvider>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
