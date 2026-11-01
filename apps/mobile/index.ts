// Background tasks must be defined at module scope before the app renders,
// so iOS can relaunch Nodara in the background for location and geofence events.
import './src/background/tasks';
import 'expo-router/entry';
