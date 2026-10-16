import { StatusBar } from 'expo-status-bar';
import { Platform, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';

import {
  useFonts,
  NotoSans_400Regular,
  NotoSans_500Medium,
  NotoSans_600SemiBold,
  NotoSans_700Bold,
} from '@expo-google-fonts/noto-sans';

import { AuthProvider, useAuth } from './src/lib/auth';
import { FONT, colors } from './src/lib/theme';
import { Loading } from './src/components/ui';

import AuthScreen from './src/screens/AuthScreen';

// Patient
import BookScreen from './src/features/patient/BookScreen';
import TrackScreen from './src/features/patient/TrackScreen';
import HistoryScreen from './src/features/patient/HistoryScreen';
import PatientBookingDetailScreen from './src/features/patient/BookingDetailScreen';
import PatientProfileScreen from './src/features/patient/ProfileScreen';

// Driver / organisation
import DutyScreen from './src/features/driver/DutyScreen';
import TripScreen from './src/features/driver/TripScreen';
import EarningsScreen from './src/features/driver/EarningsScreen';
import DriverProfileScreen from './src/features/driver/ProfileScreen';
import ProfileSetupScreen from './src/features/driver/ProfileSetupScreen';

// Control room
import DashboardScreen from './src/features/admin/DashboardScreen';
import AdminBookingsScreen from './src/features/admin/BookingsScreen';
import AdminBookingDetailScreen from './src/features/admin/BookingDetailScreen';
import FleetScreen from './src/features/admin/FleetScreen';
import ProvidersScreen from './src/features/admin/ProvidersScreen';
import ProviderDetailScreen from './src/features/admin/ProviderDetailScreen';
import MoreScreen from './src/features/admin/MoreScreen';
import ReportsScreen from './src/features/admin/ReportsScreen';
import MessagesScreen from './src/features/admin/MessagesScreen';
import AuditScreen from './src/features/admin/AuditScreen';
import UsersScreen from './src/features/admin/UsersScreen';

// The browser wake lock rejects when a lock is released before it finished
// activating, which React's development double-mount triggers on every reload.
// Screen sleep only matters on a phone, so the web build does without.
// Chosen once at module scope, so the hook order never changes between renders.
const useStayAwake = Platform.OS === 'web' ? () => {} : useKeepAwake;

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  // DBIM 2.2: Inclusive White is the primary page background, with dark text
  // on it. The manual describes no dark variant.
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.line,
    notification: colors.accent,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.text, fontSize: 17 },
  headerTintColor: colors.text,
  contentStyle: { backgroundColor: colors.bg },
  tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 62, paddingBottom: 8, paddingTop: 6 },
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.muted,
  tabBarLabelStyle: { fontSize: 11.5, fontFamily: FONT.semibold },
};

const stackOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.text, fontSize: 17 },
  headerTintColor: colors.text,
  contentStyle: { backgroundColor: colors.bg },
};

const TabIcon = ({ emoji, focused }) => (
  <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
);

const icon = (emoji) => ({ focused }) => <TabIcon emoji={emoji} focused={focused} />;

// ----------------------------------------------------------------- patient
function PatientHistoryStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="HistoryList" component={HistoryScreen} options={{ title: 'Your trips' }} />
      <Stack.Screen name="BookingDetail" component={PatientBookingDetailScreen} options={{ title: 'Trip detail' }} />
    </Stack.Navigator>
  );
}

function PatientTabs() {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Book" component={BookScreen} options={{ title: 'Book an ambulance', tabBarLabel: 'Book', tabBarIcon: icon('🚑') }} />
      <Tab.Screen name="Track" component={TrackScreen} options={{ title: 'Live tracking', tabBarLabel: 'Track', tabBarIcon: icon('📍') }} />
      <Tab.Screen name="History" component={PatientHistoryStack} options={{ headerShown: false, tabBarLabel: 'Trips', tabBarIcon: icon('🧾') }} />
      <Tab.Screen name="Account" component={PatientProfileScreen} options={{ title: 'Your account', tabBarLabel: 'Account', tabBarIcon: icon('👤') }} />
    </Tab.Navigator>
  );
}

// ------------------------------------------------------------------ driver
function DriverTabs() {
  // A driver waiting for a request must not have the screen sleep.
  useStayAwake(undefined, { suppressDeactivateWarnings: true });

  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Duty" component={DutyScreen} options={{ title: 'Dispatch console', tabBarLabel: 'Console', tabBarIcon: icon('📟') }} />
      <Tab.Screen name="Trip" component={TripScreen} options={{ title: 'Active trip', tabBarLabel: 'Trip', tabBarIcon: icon('🛣️') }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} options={{ title: 'Earnings and trips', tabBarLabel: 'Earnings', tabBarIcon: icon('💰') }} />
      <Tab.Screen name="Profile" component={DriverProfileScreen} options={{ title: 'My ambulance', tabBarLabel: 'Profile', tabBarIcon: icon('👤') }} />
    </Tab.Navigator>
  );
}

// -------------------------------------------------------------- admin
function AdminBookingsStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="AdminBookingList" component={AdminBookingsScreen} options={{ title: 'Bookings' }} />
      <Stack.Screen name="AdminBookingDetail" component={AdminBookingDetailScreen} options={{ title: 'Booking detail' }} />
    </Stack.Navigator>
  );
}

function AdminProvidersStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="AdminProviderList" component={ProvidersScreen} options={{ title: 'Providers' }} />
      <Stack.Screen name="AdminProviderDetail" component={ProviderDetailScreen} options={{ title: 'Provider detail' }} />
    </Stack.Navigator>
  );
}

function AdminMoreStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="AdminMore" component={MoreScreen} options={{ title: 'More' }} />
      <Stack.Screen name="AdminReports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="AdminMessages" component={MessagesScreen} options={{ title: 'Alert log' }} />
      <Stack.Screen name="AdminAudit" component={AuditScreen} options={{ title: 'Audit trail' }} />
      <Stack.Screen name="AdminUsers" component={UsersScreen} options={{ title: 'Accounts' }} />
    </Stack.Navigator>
  );
}

function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Overview" component={DashboardScreen} options={{ title: 'Dispatch overview', tabBarLabel: 'Overview', tabBarIcon: icon('🛰️') }} />
      <Tab.Screen name="Bookings" component={AdminBookingsStack} options={{ headerShown: false, tabBarIcon: icon('🗒️') }} />
      <Tab.Screen name="Fleet" component={FleetScreen} options={{ title: 'Fleet map', tabBarLabel: 'Fleet', tabBarIcon: icon('🗺️') }} />
      <Tab.Screen name="Providers" component={AdminProvidersStack} options={{ headerShown: false, tabBarIcon: icon('🚐') }} />
      <Tab.Screen name="More" component={AdminMoreStack} options={{ headerShown: false, tabBarIcon: icon('⋯') }} />
    </Tab.Navigator>
  );
}

// ------------------------------------------------------------------- root
function Root() {
  const { user, provider, mode, booting } = useAuth();

  // Rendered outside any navigator, so it carries its own background rather
  // than inheriting one from the navigation theme.
  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading text="Starting up…" />
      </View>
    );
  }
  if (!user) return <AuthScreen />;

  // A driver or operator with no vehicle on file cannot be dispatched anything,
  // so the profile form stands between them and the console (D2, C.6).
  if (mode === 'PROVIDER' && !provider) return <ProfileSetupScreen />;

  if (mode === 'ADMIN') return <AdminTabs />;
  if (mode === 'PROVIDER') return <DriverTabs />;
  return <PatientTabs />;
}

export default function App() {
  // DBIM 4.1.1 mandates Noto Sans. Rendering before it loads would show one
  // frame in the system face and then reflow every screen, so the app waits -
  // the files are bundled, so the wait is a frame or two, not a download.
  const [fontsReady] = useFonts({
    NotoSans_400Regular,
    NotoSans_500Medium,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
  });

  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          {/* Dark glyphs, because the bar now sits on a white header. */}
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
