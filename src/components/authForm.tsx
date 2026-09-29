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

    if (!email || !password) {
      setMessage("メールアドレスとパスワードを入力してください。");
      return;
    }

    if (isSignUp) {
      const result = await signUp(email, password);

      if (!result.success) {
        setMessage(result.error || "新規登録に失敗しました。");
        return;
      }

      setMessage("新規登録が成功しました。確認メールを確認してください。");
      return;
    }

    const result = await signIn(email, password);

    if (!result.success) {
      setMessage(result.error || "ログインに失敗しました。");
      return;
    }

    onLogin();
  }
  return (
    <div>
      <h1>{isSignUp ? "新規登録" : "ログイン"}</h1>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="メールアドレス"
      />

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
      />

      <button onClick={handleSubmit}>
        {isSignUp ? "新規登録" : "ログイン"}
      </button>

      {message && <p>{message}</p>}

      <button onClick={() => setIsSignUp((current) => !current)}>
        {isSignUp ? "ログイン画面に戻る" : "新規登録はこちら"}
      </button>

    </div>
  );
}

export default AuthForm;