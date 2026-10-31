import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useConfig, useMe } from './lib/queries';
import { applyTheme } from './lib/theme';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { LoginPage, RegisterPage, SetupPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/auth';
import { JoinPage } from './pages/join';
import { OverviewPage } from './pages/overview';
import { useServiceWorker } from './lib/sw';

const MapPage = lazy(() => import('./pages/map'));
const CirclesPage = lazy(() => import('./pages/circles'));
const CirclePage = lazy(() => import('./pages/circle'));
const HistoryPage = lazy(() => import('./pages/history'));
const TripsPage = lazy(() => import('./pages/trips'));
const TripPage = lazy(() => import('./pages/trip'));
const InsightsPage = lazy(() => import('./pages/insights'));
const PlacesPage = lazy(() => import('./pages/places'));
const NotificationsPage = lazy(() => import('./pages/notifications'));
const SettingsPage = lazy(() => import('./pages/settings'));
const AdminPage = lazy(() => import('./pages/admin'));

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

/** Gate for authenticated routes: setup → login → app. */
function Authed() {
  const { data: config } = useConfig();
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  useEffect(() => {
    if (me) applyTheme(me.preferences.theme);
  }, [me?.preferences.theme, me]);
  if (isLoading || !config) return <FullScreenSpinner />;
  if (config.needsSetup) return <Navigate to="/setup" replace />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <AppShell>
      <Suspense fallback={<FullScreenSpinner />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

function AdminOnly() {
  const { data: me } = useMe();
  return me?.isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/join/:token', element: <JoinPage /> },
  {
    element: <Authed />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/map', element: <MapPage /> },
      { path: '/circles', element: <CirclesPage /> },
      { path: '/circles/:id', element: <CirclePage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/trips', element: <TripsPage /> },
      { path: '/trips/insights', element: <InsightsPage /> },
      { path: '/trips/:id', element: <TripPage /> },
      { path: '/places', element: <PlacesPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/settings/:section?', element: <SettingsPage /> },
      { element: <AdminOnly />, children: [{ path: '/admin/:section?', element: <AdminPage /> }] },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  useServiceWorker();
  return <RouterProvider router={router} />;
}
