import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AuthProvider, useAuth } from './src/auth';
import { AppHeader, BrandMark } from './src/components/Brand';
import { Button, colors, ErrorText, Heading, Loading, Page, styles } from './src/components/ui';
import { useAction } from './src/hooks';
import { MobileLogin, OTPScreen, RoleSelection } from './src/screens/AuthScreens';
import {
  OwnerDashboard,
  ShopSetup,
  WorkerForm,
  WorkersScreen,
  ManagersScreen,
  TodayAttendance,
} from './src/screens/OwnerScreens';
import { MyAttendance, WorkerHistory } from './src/screens/AttendanceScreens';
import { Profile, WorkerDashboard } from './src/screens/WorkerScreens';
import { Routes, TabRoutes } from './src/types';
import { ShopSettingsScreen } from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator<Routes>();
const Tabs = createBottomTabNavigator<TabRoutes>();
const tabIcons: Record<
  keyof TabRoutes,
  [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]
> = {
  Dashboard: ['home', 'home-outline'],
  TodayAttendance: ['calendar', 'calendar-outline'],
  Workers: ['people', 'people-outline'],
  MyAttendance: ['checkmark-circle', 'checkmark-circle-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};
function MainTabs() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const worker = session!.role === 'WORKER';
  return (
    <Tabs.Navigator
      backBehavior="history"
      screenOptions={({ route }) => ({
        header: () => <AppHeader />,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 2 },
        tabBarIconStyle: { width: 48, height: 28 },
        tabBarStyle: {
          backgroundColor: '#FFFDF9',
          borderTopColor: colors.line,
          paddingTop: 8,
          paddingBottom: Math.max(8, insets.bottom),
          height: 78 + insets.bottom,
        },
        tabBarAccessibilityLabel: `${route.name === 'Dashboard' ? 'Home' : route.name === 'TodayAttendance' ? 'Register' : route.name === 'Workers' ? 'Team' : route.name === 'MyAttendance' ? (worker ? 'Attendance' : 'My day') : 'Account'} tab`,
        tabBarIcon: ({ focused, color }) => (
          <View
            style={{
              width: 48,
              height: 28,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 14,
              backgroundColor: focused ? colors.mint : 'transparent',
            }}
          >
            <Ionicons name={tabIcons[route.name][focused ? 0 : 1]} size={22} color={color} />
          </View>
        ),
      })}
    >
      <Tabs.Screen
        name="Dashboard"
        component={worker ? WorkerDashboard : OwnerDashboard}
        options={{ title: 'Home' }}
      />
      {!worker && (
        <Tabs.Screen
          name="TodayAttendance"
          component={TodayAttendance}
          options={{ title: 'Register' }}
        />
      )}
      {session!.role !== 'OWNER' && (
        <Tabs.Screen
          name="MyAttendance"
          component={MyAttendance}
          options={{ title: worker ? 'Attendance' : 'My day' }}
        />
      )}
      {!worker && (
        <Tabs.Screen name="Workers" component={WorkersScreen} options={{ title: 'Team' }} />
      )}
      <Tabs.Screen name="Profile" component={Profile} options={{ title: 'Account' }} />
    </Tabs.Navigator>
  );
}
function Navigation() {
  const { session, selected, booting, bootError, restore, signOut, reload } = useAuth();
  const action = useAction();
  if (booting)
    return (
      <Page>
        <View style={{ alignItems: 'center', paddingTop: 100 }}>
          <BrandMark size={90} subtitle="YOUR SHOP. YOUR PEOPLE." />
          <Loading />
        </View>
      </Page>
    );
  if (bootError)
    return (
      <Page>
        <BrandMark />
        <Heading title="Let’s reconnect" />
        <ErrorText message={bootError} />
        <Button title="Try again" onPress={() => void restore()} />
      </Page>
    );
  if (session && session.role !== 'OWNER' && !selected)
    return (
      <Page>
        <BrandMark />
        <Heading title="No active shop" />
        <Text style={styles.subtitle}>
          You haven’t been added to any shop yet. Ask your shop owner to add you.
        </Text>
        <ErrorText message={action.error} />
        <Button title="Refresh access" busy={action.busy} onPress={() => void action.run(reload)} />
        <Button title="Sign out" secondary onPress={() => void action.run(signOut)} />
      </Page>
    );
  return (
    <NavigationContainer
      key={`${session?.user.id || 'guest'}-${session?.role || 'guest'}-${selected?.id || 'setup'}`}
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.background,
          primary: colors.green,
          card: colors.background,
          text: colors.ink,
          border: colors.line,
        },
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerTitle: () => <BrandMark size={34} />,
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.green,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!session ? (
          <>
            <Stack.Screen
              name="RoleSelection"
              component={RoleSelection}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="MobileLogin" component={MobileLogin} />
            <Stack.Screen name="OTP" component={OTPScreen} />
          </>
        ) : !selected ? (
          <Stack.Screen name="ShopSetup" component={ShopSetup} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
            {session.role !== 'WORKER' && (
              <>
                <Stack.Screen
                  name="WorkerForm"
                  component={WorkerForm}
                  options={{ title: 'Team member' }}
                />
                <Stack.Screen
                  name="WorkerHistory"
                  component={WorkerHistory}
                  options={{ title: 'Attendance history' }}
                />
                {session.role === 'OWNER' && (
                  <>
                    <Stack.Screen name="ShopSetup" component={ShopSetup} />
                    <Stack.Screen name="Managers" component={ManagersScreen} />
                    <Stack.Screen name="ShopSettings" component={ShopSettingsScreen} />
                  </>
                )}
              </>
            )}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Navigation />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
