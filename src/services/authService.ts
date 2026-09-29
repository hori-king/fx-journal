import { supabase } from "../lib/supabaseClient";

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    console.error("新規登録に失敗しました:", error);
    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
    data,
  };
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("ログインに失敗しました:", error);
    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
    data,
  };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("ログアウトに失敗しました:", error);
    return false;
  }

  return true;
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("セッションの取得に失敗しました:", error);
    return null;
  }

  return data.session;
}
