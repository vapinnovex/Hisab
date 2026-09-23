import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/auth';
import { Button, colors, ErrorText, Heading, Loading, Page, styles } from './src/components/ui';
import { useAction } from './src/hooks';
import { MobileLogin, OTPScreen, RoleSelection } from './src/screens/AuthScreens';
import {
  OwnerDashboard,
  ShopSetup,
  TodayAttendance,
  WorkerForm,
  WorkersScreen,
  ManagersScreen,
} from './src/screens/OwnerScreens';
import { MyAttendance, WorkerHistory } from './src/screens/AttendanceScreens';
import { Profile, WorkerDashboard } from './src/screens/WorkerScreens';
import { Routes } from './src/types';
import { ShopSettingsScreen } from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator<Routes>();
function Navigation() {
  const { session, selected, booting, bootError, restore, signOut, reload } = useAuth();
  const action = useAction();
  if (booting)
    return (
      <Page>
        <Loading />
      </Page>
    );
  if (bootError)
    return (
      <Page>
        <Heading title="Let’s reconnect" />
        <ErrorText message={bootError} />
        <Button title="Try again" onPress={() => void restore()} />
      </Page>
    );
  if (session && session.role !== 'OWNER' && !selected)
    return (
      <Page>
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
        key={`${session?.role || 'guest'}-${selected?.id || 'setup'}`}
        screenOptions={{
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!session ? (
          <>
            <Stack.Screen
              name="RoleSelection"
              component={RoleSelection}
              options={{ title: 'hisab' }}
            />
            <Stack.Screen
              name="MobileLogin"
              component={MobileLogin}
              options={{ title: 'Welcome' }}
            />
            <Stack.Screen name="OTP" component={OTPScreen} options={{ title: 'Verification' }} />
          </>
        ) : !selected ? (
          <Stack.Screen
            name="ShopSetup"
            component={ShopSetup}
            options={{ title: 'Welcome to Hisab' }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Dashboard"
              component={session.role !== 'WORKER' ? OwnerDashboard : WorkerDashboard}
              options={{ title: 'hisab' }}
            />
            {session.role !== 'WORKER' ? (
              <>
                {session.role === 'OWNER' && (
                  <>
                    <Stack.Screen
                      name="ShopSetup"
                      component={ShopSetup}
                      options={{ title: 'New shop' }}
                    />
                    <Stack.Screen
                      name="Managers"
                      component={ManagersScreen}
                      options={{ title: 'Managers' }}
                    />
                    <Stack.Screen
                      name="ShopSettings"
                      component={ShopSettingsScreen}
                      options={{ title: 'Shop settings' }}
                    />
                  </>
                )}
                <Stack.Screen
                  name="Workers"
                  component={WorkersScreen}
                  options={{ title: 'Workers' }}
                />
                <Stack.Screen
                  name="WorkerForm"
                  component={WorkerForm}
                  options={{ title: 'Worker details' }}
                />
                <Stack.Screen
                  name="TodayAttendance"
                  component={TodayAttendance}
                  options={{ title: 'Attendance' }}
                />
                <Stack.Screen
                  name="WorkerHistory"
                  component={WorkerHistory}
                  options={{ title: 'Worker history' }}
                />
              </>
            ) : (
              <>
                <Stack.Screen
                  name="MyAttendance"
                  component={MyAttendance}
                  options={{ title: 'My attendance' }}
                />
              </>
            )}
            <Stack.Screen name="Profile" component={Profile} options={{ title: 'Profile' }} />
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
