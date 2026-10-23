// Example ONLY, not included or loaded in the production website.
// These are *public* Supabase settings, never R2 secrets or service-role keys.
// The old family-code login remains authoritative until accounts are migrated.
// Load the official Supabase JS client in the test page and have the test user
// sign in before enabling this pilot.
(function () {
  const testSupabase = window.supabase?.createClient(
    "https://REPLACE_WITH_NEW_SUPABASE_PROJECT.supabase.co",
    "REPLACE_WITH_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
  window.AJK_R2_PILOT = {
    enabled: false, // Never enable on the public site until verified Auth/ACL tests pass!
    supabaseUrl: "https://REPLACE_WITH_NEW_SUPABASE_PROJECT.supabase.co",
    publishableKey: "REPLACE_WITH_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    async getAccessToken() {
      if (!testSupabase) throw new Error("Load the Supabase browser SDK first");
      const { data, error } = await testSupabase.auth.getSession();
      if (error || !data.session) return "";
      return data.session.access_token;
    }
  };
  // For isolated development tests only:
  window.AJK_R2_TEST_CLIENT = testSupabase;
})();
