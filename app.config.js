/** @type {import('expo/config').ExpoConfig} */
const appJson = require('./app.json');

module.exports = () => ({
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra || {}),
      clerkPublishableKey:
        process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
      supabaseUrl:
        process.env.EXPO_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
    },
  },
});