import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/lib/auth';
import { useSocketEvent } from './src/lib/socket';
import { colors } from './src/lib/theme';
import { Loading } from './src/components/ui';

import AuthScreen from './src/screens/AuthScreen';
import BookScreen from './src/screens/BookScreen';
import TrackScreen from './src/screens/TrackScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import BookingDetailScreen from './src/screens/BookingDetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

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
};

function TabIcon({ emoji, focused }) {
  return (
    <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
}

function HistoryStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="HistoryList" component={HistoryScreen} options={{ title: 'Your trips' }} />
      <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Trip detail' }} />
    </Stack.Navigator>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        ...screenOptions,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 62, paddingBottom: 8, paddingTop: 6 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Book"
        component={BookScreen}
        options={{ title: 'Book an ambulance', tabBarLabel: 'Book', tabBarIcon: ({ focused }) => <TabIcon emoji="🚨" focused={focused} /> }}
      />
      <Tab.Screen
        name="Track"
        component={TrackScreen}
        options={{ title: 'Live tracking', tabBarLabel: 'Track', tabBarIcon: ({ focused }) => <TabIcon emoji="📍" focused={focused} /> }}
      />
      <Tab.Screen
        name="History"
        component={HistoryStack}
        options={{ headerShown: false, tabBarLabel: 'Trips', tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Your account', tabBarLabel: 'Account', tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, booting } = useAuth();

  // F.14: surface important lifecycle events wherever the user happens to be.
  useSocketEvent('notification', () => {}, []);

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading text="Starting up…" />
      </View>
    );
  }

  return user ? <Tabs /> : <AuthScreen />;
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
