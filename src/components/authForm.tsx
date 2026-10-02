import { useState } from "react";
import { signIn, signUp } from "../services/authService";

type AuthFormProps = {
  onLogin: () => void;
};

function AuthForm({ onLogin }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit() {
    setMessage("");
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setMessage("メールアドレスとパスワードを入力してください。");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage("有効なメールアドレスを入力してください。");
      return;
    }

    if (isSignUp && password.length < 8) {
      setMessage("パスワードは8文字以上で入力してください。");
      return;
    }

    if (isSignUp) {
      const missingRequirements = [
        !/[A-Z]/.test(password) && "英大文字",
        !/[a-z]/.test(password) && "英小文字",
        !/[0-9]/.test(password) && "数字",
        !/[^A-Za-z0-9\s]/.test(password) && "特殊文字",
      ].filter(Boolean);

      if (missingRequirements.length > 0) {
        setMessage(`パスワードには${missingRequirements.join("・")}を含めてください。`);
        return;
      }
    }

    if (isSignUp) {
      const result = await signUp(normalizedEmail, password);

      if (!result.success) {
        setMessage(result.error || "新規登録に失敗しました。");
        return;
      }

      setMessage("新規登録が成功しました。確認メールを確認してください。");
      return;
    }

    const result = await signIn(normalizedEmail, password);

    if (!result.success) {
      setMessage(result.error || "ログインに失敗しました。");
      return;
    }

    onLogin();
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand-mark" aria-hidden="true">FX</div>
        <p className="auth-eyebrow">FX TRADING JOURNAL</p>
        <h1>{isSignUp ? "新規登録" : "ログイン"}</h1>

        <div className="auth-fields">
          <label htmlFor="auth-email">メールアドレス</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
          />

          <label htmlFor="auth-password">パスワード</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワードを入力"
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />
          {isSignUp && (
            <p className="auth-password-hint">
              8文字以上で、英大文字・英小文字・数字・特殊文字をすべて含めてください。
            </p>
          )}
        </div>

        <button className="auth-submit" onClick={handleSubmit}>
          {isSignUp ? "アカウントを作成" : "ログイン"}
        </button>

        {message && <p className="auth-message" role="alert">{message}</p>}

        <div className="auth-switch">
          <span>{isSignUp ? "アカウントをお持ちですか？" : "初めてご利用ですか？"}</span>
          <button type="button" onClick={() => setIsSignUp((current) => !current)}>
            {isSignUp ? "ログイン" : "新規登録"}
          </button>
        </div>
      </section>
    </main>
  );
}

export default AuthForm;
