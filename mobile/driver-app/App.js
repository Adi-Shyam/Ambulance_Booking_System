import { StatusBar } from 'expo-status-bar';
import { Platform, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';

// The browser wake lock rejects when a lock is released before it finished
// activating, which React's development double-mount triggers on every reload.
// Screen sleep only matters on a phone, so the web build simply does without.
// Chosen once at module scope, so the hook order never changes between renders.
const useStayAwake = Platform.OS === 'web' ? () => {} : useKeepAwake;

import { AuthProvider, useAuth } from './src/lib/auth';
import { colors } from './src/lib/theme';
import { Loading } from './src/components/ui';

import AuthScreen from './src/screens/AuthScreen';
import ProfileSetupScreen from './src/screens/ProfileSetupScreen';
import DutyScreen from './src/screens/DutyScreen';
import TripScreen from './src/screens/TripScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: true,
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
  tabBarLabelStyle: { fontSize: 11.5, fontWeight: '600' },
};

const TabIcon = ({ emoji, focused }) => (
  <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
);

function Tabs() {
  // A driver on duty must not have the screen sleep while waiting for a request.
  // Releasing the lock throws an uncaught rejection on Android when the original
  // activity is already dead, which this screen cannot do anything about.
  useStayAwake(undefined, { suppressDeactivateWarnings: true });

  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen
        name="Duty"
        component={DutyScreen}
        options={{ title: 'Dispatch console', tabBarLabel: 'Console', tabBarIcon: ({ focused }) => <TabIcon emoji="📟" focused={focused} /> }}
      />
      <Tab.Screen
        name="Trip"
        component={TripScreen}
        options={{ title: 'Active trip', tabBarLabel: 'Trip', tabBarIcon: ({ focused }) => <TabIcon emoji="🛣️" focused={focused} /> }}
      />
      <Tab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{ title: 'Earnings and trips', tabBarLabel: 'Earnings', tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'My ambulance', tabBarLabel: 'Profile', tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, provider, booting } = useAuth();

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading text="Starting up…" />
      </View>
    );
  }

  if (!user) return <AuthScreen />;
  // A signed-in driver without a vehicle profile cannot receive anything yet.
  if (!provider) return <ProfileSetupScreen />;
  return <Tabs />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
