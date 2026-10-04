module.exports = ({ config }) => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV || 'production';
  if (!['development', 'production'].includes(environment)) {
    throw new Error('EXPO_PUBLIC_APP_ENV must be development or production');
  }
  if (environment === 'production') return config;

  const icon = './assets/brand/hishob-dev-logo.png';
  return {
    ...config,
    name: 'Hishob Dev',
    icon,
    android: {
      ...config.android,
      adaptiveIcon: { ...config.android.adaptiveIcon, foregroundImage: icon },
    },
    web: { ...config.web, favicon: icon },
    plugins: config.plugins.map((plugin) =>
      Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
        ? [plugin[0], { ...plugin[1], image: icon }]
        : plugin,
    ),
  };
};
