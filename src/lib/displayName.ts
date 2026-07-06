type AuthNameSource = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type ProfileNameSource = {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type CustomerNameSource = {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type DisplayNameInput = {
  playerProfile?: ProfileNameSource | null;
  customer?: CustomerNameSource | null;
  authUser?: AuthNameSource | null;
  fallback?: string | null;
};

function clean(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function emailPrefix(email?: string | null) {
  const prefix = clean(email)?.split("@")[0]?.trim();
  return prefix || null;
}

function joinedName(source?: ProfileNameSource | CustomerNameSource | null) {
  const name = [clean(source?.first_name), clean(source?.last_name)].filter(Boolean).join(" ");
  return name || null;
}

export function getDisplayName(input: DisplayNameInput) {
  const metadata = input.authUser?.user_metadata || {};

  return (
    clean(input.playerProfile?.display_name) ||
    clean(input.customer?.display_name) ||
    clean(metadata.display_name) ||
    clean(metadata.full_name) ||
    joinedName(input.playerProfile) ||
    joinedName(input.customer) ||
    emailPrefix(input.authUser?.email) ||
    clean(input.fallback)
  );
}

export function getFirstName(input: DisplayNameInput) {
  const firstName =
    clean(input.playerProfile?.first_name) ||
    clean(input.customer?.first_name) ||
    getDisplayName(input);

  return firstName?.split(/\s+/)[0] || null;
}
