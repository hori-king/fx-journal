import { supabase } from "../lib/supabaseClient";

function translateAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません。入力内容をご確認ください。";
  }
  if (normalized.includes("email not confirmed")) {
    return "メールアドレスの確認が完了していません。確認メールをご確認ください。";
  }
  if (normalized.includes("user already registered") || normalized.includes("already been registered")) {
    return "このメールアドレスはすでに登録されています。ログインしてください。";
  }
  if (normalized.includes("password should be at least") || normalized.includes("password is too short")) {
    return "パスワードは8文字以上で入力してください。";
  }
  if (normalized.includes("weak password") || normalized.includes("password does not meet")) {
    return "パスワードは8文字以上で、英大文字・英小文字・数字・特殊文字をすべて含めてください。";
  }
  if (normalized.includes("unable to validate email") || normalized.includes("invalid email")) {
    return "有効なメールアドレスを入力してください。";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "試行回数が多すぎます。しばらく待ってからもう一度お試しください。";
  }

  return "認証に失敗しました。入力内容を確認して、もう一度お試しください。";
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    console.error("新規登録に失敗しました:", error);
    return {
      success: false,
      error: translateAuthError(error.message),
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
      error: translateAuthError(error.message),
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
