import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createCommunityPost,
  loadCommunityPosts,
  type CommunityPost,
} from "../services/communityService";

type CommunityPageProps = {
  userId: string | null;
};

function getErrorMessage(error: unknown, action: "read" | "write"): string {
  const details = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown }
    : null;
  const code = typeof details?.code === "string" ? details.code : "";
  const message = typeof details?.message === "string" ? details.message : "";
  if (code === "PGRST205" || code === "42P01" || message.includes("does not exist")) {
    return "コミュニティの準備が完了していません。Supabaseのマイグレーションを適用してください。";
  }
  if (message.toLowerCase().includes("row-level security")) {
    return "投稿権限を確認できませんでした。ログインし直してからもう一度お試しください。";
  }
  return action === "write"
    ? "投稿に失敗しました。通信状態を確認して、もう一度お試しください。"
    : "投稿一覧を取得できませんでした。時間をおいて再度お試しください。";
}

function formatPostDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function CommunityPage({ userId }: CommunityPageProps) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const refreshPosts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPosts(await loadCommunityPosts());
    } catch (error) {
      setLoadError(getErrorMessage(error, "read"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;
    loadCommunityPosts()
      .then((loadedPosts) => {
        if (isActive) setPosts(loadedPosts);
      })
      .catch((error: unknown) => {
        if (isActive) setLoadError(getErrorMessage(error, "read"));
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const post = await createCommunityPost(trimmedContent);
      setPosts((currentPosts) => [post, ...currentPosts]);
      setContent("");
    } catch (error) {
      setSubmitError(getErrorMessage(error, "write"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="home-page community-page" aria-label="コミュニティ">
      <div className="community-heading">
        <div>
          <p className="trade-search-subtitle">COMMUNITY</p>
          <h2>コミュニティ</h2>
          <p className="community-description">トレードの気づきや学びを共有しましょう。</p>
        </div>
      </div>

      <form className="community-composer" onSubmit={handleSubmit}>
        <label htmlFor="community-content">投稿を書く</label>
        <textarea
          id="community-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="トレードで気づいたことを共有してください"
          rows={4}
          maxLength={5000}
          disabled={isSubmitting}
        />
        <div className="community-composer-footer">
          <span>{content.length} / 5000</span>
          <button type="submit" disabled={isSubmitting || content.trim().length === 0}>
            {isSubmitting ? "投稿中…" : "投稿する"}
          </button>
        </div>
        {submitError && <p className="community-error" role="alert">{submitError}</p>}
      </form>

      <div className="community-feed-heading">
        <h2>投稿一覧</h2>
        <button type="button" className="community-refresh" onClick={() => void refreshPosts()} disabled={isLoading}>
          {isLoading ? "読み込み中…" : "再読み込み"}
        </button>
      </div>

      {loadError && <p className="community-error" role="alert">{loadError}</p>}
      {isLoading ? (
        <p className="community-empty" role="status">投稿を読み込んでいます…</p>
      ) : posts.length === 0 ? (
        <p className="community-empty">まだ投稿がありません。最初の投稿をしてみましょう。</p>
      ) : (
        <div className="community-post-list">
          {posts.map((post) => (
            <article className="community-post-card" key={post.id}>
              <div className="community-post-meta">
                <span className="community-author">匿名トレーダー</span>
                <time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time>
              </div>
              <p className="community-post-content">{post.content}</p>
            </article>
          ))}
        </div>
      )}
      {userId === null && <p className="community-error" role="alert">投稿するにはログインしてください。</p>}
    </section>
  );
}

export default CommunityPage;
