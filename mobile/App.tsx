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
import { WorkerDashboard } from './src/screens/WorkerScreens';
import { Profile, OwnerProfile, ChangeMobile } from './src/screens/AccountScreens';
import { Routes, TabRoutes } from './src/types';
import { ShopSettingsScreen } from './src/screens/SettingsScreen';

import {
  HishobToday,
  HishobHistory,
  HishobDetails,
  HishobTransaction,
  HishobTransactions,
  HishobClose,
} from './src/financial/screens';

import { HishobSearch } from './src/financial/search';

const Stack = createNativeStackNavigator<Routes>();
const Tabs = createBottomTabNavigator<TabRoutes>();
const tabIcons: Record<
  keyof TabRoutes,
  [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]
> = {
  Hishob: ['wallet', 'wallet-outline'],
  Dashboard: ['home', 'home-outline'],
  TodayAttendance: ['calendar', 'calendar-outline'],
  Workers: ['people', 'people-outline'],
  MyAttendance: ['checkmark-circle', 'checkmark-circle-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};
// Each tab owns a stack so detail pages keep the main navigation available.
function SectionStack({ root }: { root: keyof TabRoutes }) {
  const { session, selected } = useAuth();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerTitle: () => <BrandMark size={34} />,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.green,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {root === 'Dashboard' && (
        <Stack.Screen
          name="DashboardRoot"
          component={session!.role === 'WORKER' ? WorkerDashboard : OwnerDashboard}
          options={{ header: () => <AppHeader /> }}
        />
      )}
      {root === 'TodayAttendance' && (
        <Stack.Screen
          name="TodayAttendanceRoot"
          component={TodayAttendance}
          options={{ header: () => <AppHeader /> }}
        />
      )}
      {root === 'Workers' && (
        <Stack.Screen
          name="WorkersRoot"
          component={WorkersScreen}
          options={{ header: () => <AppHeader /> }}
        />
      )}
      {root === 'MyAttendance' && (
        <Stack.Screen
          name="MyAttendanceRoot"
          component={MyAttendance}
          options={{ header: () => <AppHeader /> }}
        />
      )}
      {root === 'Profile' && (
        <Stack.Screen
          name="ProfileRoot"
          component={Profile}
          options={{ header: () => <AppHeader /> }}
        />
      )}
      {session!.role === 'MANAGER' && selected!.permissions.view_hishob && root !== 'Hishob' && (
        <Stack.Screen name="MyAttendance" component={MyAttendance} />
      )}
      {session!.role !== 'WORKER' && (
        <>
          {root === 'Hishob' && selected!.permissions.view_hishob && (
            <>
              <Stack.Screen
                name="HishobToday"
                component={HishobToday}
                options={{ header: () => <AppHeader /> }}
              />
              <Stack.Screen name="HishobSearch" component={HishobSearch} />
              <Stack.Screen name="HishobHistory" component={HishobHistory} />
              <Stack.Screen name="HishobDetails" component={HishobDetails} />
              <Stack.Screen name="HishobTransaction" component={HishobTransaction} />
              <Stack.Screen name="HishobTransactions" component={HishobTransactions} />
              <Stack.Screen name="HishobClose" component={HishobClose} />
            </>
          )}
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
          {session!.role === 'OWNER' && (
            <>
              <Stack.Screen name="ShopSetup" component={ShopSetup} />
              <Stack.Screen name="OwnerProfile" component={OwnerProfile} />
              <Stack.Screen name="ChangeMobile" component={ChangeMobile} />
              <Stack.Screen name="Managers" component={ManagersScreen} />
              <Stack.Screen name="ShopSettings" component={ShopSettingsScreen} />
            </>
          )}
        </>
      )}
    </Stack.Navigator>
  );
}
function HomeStack() {
  return <SectionStack root="Dashboard" />;
}
function RegisterStack() {
  return <SectionStack root="TodayAttendance" />;
}
function TeamStack() {
  return <SectionStack root="Workers" />;
}
function AttendanceStack() {
  return <SectionStack root="MyAttendance" />;
}
function AccountStack() {
  return <SectionStack root="Profile" />;
}
function HishobStack() {
  return <SectionStack root="Hishob" />;
}
function MainTabs() {
  const insets = useSafeAreaInsets();
  const { session, selected } = useAuth();
  const finance = session!.role !== 'WORKER' && selected!.permissions.view_hishob;
  const worker = session!.role === 'WORKER';
  return (
    <Tabs.Navigator
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
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
        tabBarAccessibilityLabel: `${route.name === 'Hishob' ? 'Hishob' : route.name === 'Dashboard' ? 'Home' : route.name === 'TodayAttendance' ? 'Register' : route.name === 'Workers' ? 'Team' : route.name === 'MyAttendance' ? (worker ? 'Attendance' : 'My day') : 'Account'} tab`,
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
      <Tabs.Screen name="Dashboard" component={HomeStack} options={{ title: 'Home' }} />
      {!worker && (
        <Tabs.Screen
          name="TodayAttendance"
          component={RegisterStack}
          options={{ title: 'Register' }}
        />
      )}
      {(worker || (session!.role === 'MANAGER' && !finance)) && (
        <Tabs.Screen
          name="MyAttendance"
          component={AttendanceStack}
          options={{ title: worker ? 'Attendance' : 'My day' }}
        />
      )}
      {finance && (
        <Tabs.Screen name="Hishob" component={HishobStack} options={{ title: 'Hishob' }} />
      )}
      {!worker && <Tabs.Screen name="Workers" component={TeamStack} options={{ title: 'Team' }} />}
      <Tabs.Screen name="Profile" component={AccountStack} options={{ title: 'Account' }} />
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
