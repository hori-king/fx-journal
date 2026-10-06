import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  COMMUNITY_FALLBACK_DISPLAY_NAME,
  DISPLAY_NAME_MAX_LENGTH,
  loadMyProfile,
  saveMyDisplayName,
  type Profile,
} from "../services/profileService";
import {
  createCommunityPost,
  createCommunityComment,
  createCommunityLike,
  deleteCommunityComment,
  deleteCommunityPost,
  loadCommunityComments,
  loadCommunityPosts,
  removeCommunityLike,
  type CommunityComment,
  type CommunityPost,
} from "../services/communityService";

type CommunityPageProps = {
  userId: string | null;
  openPostId: string | null;
  onOpenPostHandled: () => void;
};

function getErrorMessage(error: unknown, action: "read" | "write" | "delete"): string {
  const details = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown }
    : null;
  const code = typeof details?.code === "string" ? details.code : "";
  const message = typeof details?.message === "string" ? details.message : "";
  if (code === "PGRST200" || code === "PGRST205" || code === "42P01" || message.includes("does not exist")) {
    return "コミュニティの準備が完了していません。Supabaseのマイグレーションを適用してください。";
  }
  if (message.toLowerCase().includes("row-level security")) {
    return "投稿権限を確認できませんでした。ログインし直してからもう一度お試しください。";
  }
  return action === "write"
    ? "投稿に失敗しました。通信状態を確認して、もう一度お試しください。"
    : action === "delete"
      ? "削除に失敗しました。時間をおいて再度お試しください。"
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

function CommunityPage({ userId, openPostId, onOpenPostHandled }: CommunityPageProps) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [manuallySelectedPost, setManuallySelectedPost] = useState<CommunityPost | null>(null);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const requestedPost = openPostId && !isLoading
    ? posts.find((post) => post.id === openPostId) ?? null
    : null;
  const selectedPost = requestedPost ?? manuallySelectedPost;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [pendingLikePostIds, setPendingLikePostIds] = useState<Set<string>>(() => new Set());
  const [postDeleteError, setPostDeleteError] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const refreshPosts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPosts(await loadCommunityPosts(userId));
    } catch (error) {
      setLoadError(getErrorMessage(error, "read"));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const handleCommentCountChange = useCallback((commentCount: number) => {
    if (!selectedPost) return;
    setPosts((currentPosts) => currentPosts.map((post) =>
      post.id === selectedPost.id && post.commentCount !== commentCount
        ? { ...post, commentCount }
        : post,
    ));
  }, [selectedPost]);

  useEffect(() => {
    let isActive = true;
    loadCommunityPosts(userId)
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
  }, [userId]);

  useEffect(() => {
    let isActive = true;
    const profileRequest = userId ? loadMyProfile(userId) : Promise.resolve(null);
    profileRequest
      .then((loadedProfile) => {
        if (isActive) {
          setProfile(loadedProfile);
          setDisplayNameInput(loadedProfile?.displayName ?? "");
        }
      })
      .catch((error: unknown) => {
        if (isActive) setProfileError(getErrorMessage(error, "read"));
      })
      .finally(() => {
        if (isActive) setIsProfileLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [userId]);

  async function handleSaveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = displayNameInput.trim();
    const nameLength = [...normalizedName].length;
    if (nameLength === 0) {
      setProfileError("表示名を入力してください。");
      setProfileSuccess(null);
      return;
    }
    if (nameLength > DISPLAY_NAME_MAX_LENGTH) {
      setProfileError(`表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください。`);
      setProfileSuccess(null);
      return;
    }
    if (!userId || isSavingProfile) return;

    setIsSavingProfile(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const savedProfile = await saveMyDisplayName(normalizedName);
      setProfile(savedProfile);
      setDisplayNameInput(savedProfile.displayName);
      setProfileSuccess("表示名を保存しました。過去の投稿・コメントにも反映されます。");
      try {
        setPosts(await loadCommunityPosts(userId));
      } catch (error) {
        setLoadError(getErrorMessage(error, "read"));
      }
    } catch (error) {
      setProfileError(error instanceof Error
        ? error.message
        : "表示名を保存できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleToggleLike(postId: string) {
    const post = posts.find((item) => item.id === postId);
    if (!post || pendingLikePostIds.has(postId)) return;

    setPendingLikePostIds((current) => new Set(current).add(postId));
    setLikeError(null);
    try {
      if (post.isLikedByCurrentUser) {
        await removeCommunityLike(postId);
      } else {
        await createCommunityLike(postId);
      }

      const isLikedByCurrentUser = !post.isLikedByCurrentUser;
      const likeCount = Math.max(0, post.likeCount + (isLikedByCurrentUser ? 1 : -1));
      setPosts((currentPosts) => currentPosts.map((item) =>
        item.id === postId ? { ...item, likeCount, isLikedByCurrentUser } : item,
      ));
      setManuallySelectedPost((currentPost) => currentPost?.id === postId
        ? { ...currentPost, likeCount, isLikedByCurrentUser }
        : currentPost,
      );
    } catch (error) {
      setLikeError(getErrorMessage(error, "write"));
    } finally {
      setPendingLikePostIds((current) => {
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    }
  }

  async function handleDeletePost(post: CommunityPost) {
    if (deletingPostId !== null) return;
    if (!window.confirm("この投稿を削除しますか？")) return;

    setDeletingPostId(post.id);
    setPostDeleteError(null);
    try {
      await deleteCommunityPost(post.id);
      setPosts((currentPosts) => currentPosts.filter((item) => item.id !== post.id));
      setManuallySelectedPost((currentPost) => currentPost?.id === post.id ? null : currentPost);
    } catch (error) {
      setPostDeleteError(getErrorMessage(error, "delete"));
    } finally {
      setDeletingPostId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const savedPost = await createCommunityPost(trimmedContent);
      const post = {
        ...savedPost,
        displayName: profile?.displayName ?? COMMUNITY_FALLBACK_DISPLAY_NAME,
      };
      setPosts((currentPosts) => [post, ...currentPosts]);
      setContent("");
    } catch (error) {
      setSubmitError(getErrorMessage(error, "write"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (selectedPost) {
    return (
      <CommunityPostDetail
        post={selectedPost}
        userId={userId}
        currentDisplayName={profile?.displayName ?? COMMUNITY_FALLBACK_DISPLAY_NAME}
        onBack={() => {
          if (openPostId) onOpenPostHandled();
          setManuallySelectedPost(null);
        }}
        onCommentCountChange={handleCommentCountChange}
        onToggleLike={handleToggleLike}
        isLikeUpdating={pendingLikePostIds.has(selectedPost.id)}
        likeError={likeError}
        onDeletePost={() => handleDeletePost(selectedPost)}
        isDeletingPost={deletingPostId === selectedPost.id}
        postDeleteError={postDeleteError}
      />
    );
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

      <form className="community-profile-form" onSubmit={handleSaveDisplayName}>
        <div className="community-profile-field">
          <label htmlFor="community-display-name">コミュニティ表示名</label>
          <input
            id="community-display-name"
            type="text"
            value={displayNameInput}
            onChange={(event) => setDisplayNameInput(event.target.value)}
            placeholder={COMMUNITY_FALLBACK_DISPLAY_NAME}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            disabled={isProfileLoading || isSavingProfile || !userId}
          />
          <p>未設定の場合は「{COMMUNITY_FALLBACK_DISPLAY_NAME}」と表示されます。</p>
        </div>
        <button type="submit" disabled={isProfileLoading || isSavingProfile || !userId}>
          {isSavingProfile ? "保存中…" : profile ? "表示名を変更" : "表示名を保存"}
        </button>
        {profileError && <p className="community-error" role="alert">{profileError}</p>}
        {profileSuccess && <p className="community-profile-success" role="status">{profileSuccess}</p>}
      </form>

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
      {likeError && <p className="community-error" role="alert">{likeError}</p>}
      {postDeleteError && <p className="community-error" role="alert">{postDeleteError}</p>}
      {isLoading ? (
        <p className="community-empty" role="status">投稿を読み込んでいます…</p>
      ) : posts.length === 0 ? (
        <p className="community-empty">まだ投稿がありません。最初の投稿をしてみましょう。</p>
      ) : (
        <div className="community-post-list">
          {posts.map((post) => (
            <article className="community-post-card" key={post.id}>
              <div className="community-post-meta">
                <span className="community-author">{post.displayName}</span>
                <time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time>
              </div>
              <p className="community-post-content">{post.content}</p>
              <div className="community-post-actions">
                <button
                  type="button"
                  className={`community-like-button${post.isLikedByCurrentUser ? " is-liked" : ""}`}
                  onClick={() => void handleToggleLike(post.id)}
                  disabled={pendingLikePostIds.has(post.id)}
                  aria-pressed={post.isLikedByCurrentUser}
                  aria-label={post.isLikedByCurrentUser ? "いいねを解除" : "いいねする"}
                >
                  {post.isLikedByCurrentUser ? "♥" : "♡"} いいね {post.likeCount}
                </button>
                <span className="community-post-comment-count">コメント {post.commentCount}件</span>
                <button
                  type="button"
                  className="community-open-post"
                  onClick={() => setManuallySelectedPost(post)}
                  aria-label="コメントを見る"
                >
                  コメントを見る
                </button>
                {post.userId === userId && (
                  <button
                    type="button"
                    className="community-delete-button"
                    onClick={() => void handleDeletePost(post)}
                    disabled={deletingPostId === post.id}
                  >
                    {deletingPostId === post.id ? "削除中…" : "投稿を削除"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {userId === null && <p className="community-error" role="alert">投稿するにはログインしてください。</p>}
    </section>
  );
}

type CommunityPostDetailProps = {
  post: CommunityPost;
  userId: string | null;
  currentDisplayName: string;
  onBack: () => void;
  onCommentCountChange: (commentCount: number) => void;
  onToggleLike: (postId: string) => void;
  isLikeUpdating: boolean;
  likeError: string | null;
  onDeletePost: () => Promise<void>;
  isDeletingPost: boolean;
  postDeleteError: string | null;
};

function CommunityPostDetail({
  post,
  userId,
  currentDisplayName,
  onBack,
  onCommentCountChange,
  onToggleLike,
  isLikeUpdating,
  likeError,
  onDeletePost,
  isDeletingPost,
  postDeleteError,
}: CommunityPostDetailProps) {
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [commentDeleteError, setCommentDeleteError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    loadCommunityComments(post.id)
      .then((loadedComments) => {
        if (isActive) {
          setComments(loadedComments);
          onCommentCountChange(loadedComments.length);
        }
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
  }, [onCommentCountChange, post.id]);

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent || isSubmitting || !userId) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const savedComment = await createCommunityComment(post.id, trimmedContent);
      const comment = { ...savedComment, displayName: currentDisplayName };
      const updatedComments = [...comments, comment];
      setComments(updatedComments);
      onCommentCountChange(updatedComments.length);
      setContent("");
    } catch (error) {
      setSubmitError(getErrorMessage(error, "write"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteComment(comment: CommunityComment) {
    if (deletingCommentId !== null) return;
    if (!window.confirm("このコメントを削除しますか？")) return;

    setDeletingCommentId(comment.id);
    setCommentDeleteError(null);
    try {
      await deleteCommunityComment(comment.id);
      const updatedComments = comments.filter((item) => item.id !== comment.id);
      setComments(updatedComments);
      onCommentCountChange(updatedComments.length);
    } catch (error) {
      setCommentDeleteError(getErrorMessage(error, "delete"));
    } finally {
      setDeletingCommentId(null);
    }
  }

  return (
    <section className="home-page community-page community-detail-page" aria-label="投稿詳細">
      <button type="button" className="community-back-button" onClick={onBack}>← 投稿一覧へ戻る</button>
      <article className="community-post-card community-detail-post">
        <div className="community-post-meta">
          <span className="community-author">{post.displayName}</span>
          <time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time>
        </div>
        <p className="community-post-content">{post.content}</p>
        <div className="community-post-actions">
          <button
            type="button"
            className={`community-like-button${post.isLikedByCurrentUser ? " is-liked" : ""}`}
            onClick={() => onToggleLike(post.id)}
            disabled={isLikeUpdating}
            aria-pressed={post.isLikedByCurrentUser}
            aria-label={post.isLikedByCurrentUser ? "いいねを解除" : "いいねする"}
          >
            {post.isLikedByCurrentUser ? "♥" : "♡"} いいね {post.likeCount}
          </button>
          {post.userId === userId && (
            <button type="button" className="community-delete-button" onClick={() => void onDeletePost()} disabled={isDeletingPost}>
              {isDeletingPost ? "削除中…" : "投稿を削除"}
            </button>
          )}
        </div>
        {likeError && <p className="community-error" role="alert">{likeError}</p>}
        {postDeleteError && <p className="community-error" role="alert">{postDeleteError}</p>}
      </article>

      <div className="community-feed-heading">
        <h2>コメント <span className="community-comment-count">{comments.length}件</span></h2>
      </div>

      <form className="community-composer community-comment-composer" onSubmit={handleCommentSubmit}>
        <label htmlFor="community-comment-content">コメントを書く</label>
        <textarea
          id="community-comment-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="投稿へのコメントを入力してください"
          rows={3}
          maxLength={2000}
          disabled={isSubmitting || !userId}
        />
        <div className="community-composer-footer">
          <span>{content.length} / 2000</span>
          <button type="submit" disabled={isSubmitting || !userId || content.trim().length === 0}>
            {isSubmitting ? "送信中…" : "コメントする"}
          </button>
        </div>
        {!userId && <p className="community-error" role="alert">コメントするにはログインしてください。</p>}
        {submitError && <p className="community-error" role="alert">{submitError}</p>}
      </form>

      {loadError && <p className="community-error" role="alert">{loadError}</p>}
      {isLoading ? (
        <p className="community-empty" role="status">コメントを読み込んでいます…</p>
      ) : comments.length === 0 ? (
        <p className="community-empty">まだコメントがありません。</p>
      ) : (
        <div className="community-comment-list">
          {comments.map((comment) => (
            <article className="community-comment-card" key={comment.id}>
              <div className="community-post-meta">
                <span className="community-author">{comment.displayName}</span>
                <time dateTime={comment.createdAt}>{formatPostDate(comment.createdAt)}</time>
              </div>
              <p className="community-post-content">{comment.content}</p>
              {comment.userId === userId && (
                <button
                  type="button"
                  className="community-delete-button community-comment-delete"
                  onClick={() => void handleDeleteComment(comment)}
                  disabled={deletingCommentId !== null}
                >
                  {deletingCommentId === comment.id ? "削除中…" : "コメントを削除"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {commentDeleteError && <p className="community-error" role="alert">{commentDeleteError}</p>}
    </section>
  );
}

export default CommunityPage;
