import { supabase } from "../lib/supabaseClient";

export const COMMUNITY_FALLBACK_DISPLAY_NAME = "匿名トレーダー";
export const DISPLAY_NAME_MAX_LENGTH = 24;

export type Profile = {
  userId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

type ProfileRow = {
  user_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

type ProfileNameRow = {
  user_id: string;
  display_name: string;
};

function toProfile(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? toProfile(data as ProfileRow) : null;
}

export async function saveMyDisplayName(displayName: string): Promise<Profile> {
  const normalizedName = displayName.trim();
  const nameLength = [...normalizedName].length;
  if (nameLength === 0) throw new Error("表示名を入力してください。");
  if (nameLength > DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください。`);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("ログインし直してから表示名を保存してください。");

  const existingProfile = await loadMyProfile(authData.user.id);
  if (existingProfile) return updateOwnProfile(authData.user.id, normalizedName);

  const { data, error } = await supabase
    .from("profiles")
    .insert({ user_id: authData.user.id, display_name: normalizedName })
    .select("user_id, display_name, created_at, updated_at")
    .single();

  if (error?.code === "23505") {
    return updateOwnProfile(authData.user.id, normalizedName);
  }
  if (error) throw error;
  return toProfile(data as ProfileRow);
}

async function updateOwnProfile(userId: string, displayName: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", userId)
    .select("user_id, display_name, created_at, updated_at")
    .single();

  if (error) throw error;
  return toProfile(data as ProfileRow);
}

export async function loadProfilesByUserIds(userIds: string[]): Promise<Map<string, string>> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", uniqueUserIds);

  if (error) throw error;

  const profiles = (data ?? []) as ProfileNameRow[];
  return new Map(profiles.map((profile) => [profile.user_id, profile.display_name]));
}
