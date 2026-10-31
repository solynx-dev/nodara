import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { SessionProvider, useSession } from '@/lib/session';
import { ApiError } from '@/lib/api';
import { routeForUrl } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { ForegroundReporter } from '@/components/ForegroundReporter';
import { C } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      staleTime: 15_000,
    },
  },
});

function RootStack() {
  const { ready, server, signedIn } = useSession();
  useRealtime(signedIn);

  // Open the right screen when someone taps a push notification.
  useEffect(() => {
    if (!signedIn) return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const route = routeForUrl((r.notification.request.content.data as { url?: string } | undefined)?.url);
      if (route) router.push(route as never);
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
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="member/[id]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.45, 0.92],
              sheetInitialDetentIndex: 0,
              sheetGrabberVisible: true,
              sheetLargestUndimmedDetentIndex: 0,
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
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
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={{ ...theme, colors: { ...theme.colors, primary: C.accent } }}>
        <SessionProvider>
          <StatusBar style="auto" />
          <RootStack />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
