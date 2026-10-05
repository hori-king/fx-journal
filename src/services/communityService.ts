import { supabase } from "../lib/supabaseClient";

export type CommunityPost = {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  likeCount: number;
  isLikedByCurrentUser: boolean;
};

export type CommunityComment = {
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunityLike = {
  id: string;
  postId: string;
  userId: string;
  createdAt: string;
};

type CommunityPostRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  community_comments?: Array<{ count: number }>;
  community_likes?: Array<{ count: number }>;
};

type CommunityCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function toCommunityPost(row: CommunityPostRow, isLikedByCurrentUser = false): CommunityPost {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commentCount: row.community_comments?.[0]?.count ?? 0,
    likeCount: row.community_likes?.[0]?.count ?? 0,
    isLikedByCurrentUser,
  };
}

function toCommunityComment(row: CommunityCommentRow): CommunityComment {
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadCommunityPosts(userId: string | null): Promise<CommunityPost[]> {
  const { data, error } = await supabase
    .from("community_posts")
    .select("id, user_id, content, created_at, updated_at, community_comments(count), community_likes(count)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as CommunityPostRow[];
  const postIds = rows.map((row) => row.id);
  const likedPostIds = new Set<string>();

  if (userId && postIds.length > 0) {
    const { data: likes, error: likesError } = await supabase
      .from("community_likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", postIds);

    if (likesError) throw likesError;
    for (const like of likes ?? []) likedPostIds.add(like.post_id);
  }

  return rows.map((row) => toCommunityPost(row, likedPostIds.has(row.id)));
}

export async function createCommunityPost(content: string): Promise<CommunityPost> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("投稿するにはログインが必要です。");

  const { data, error } = await supabase
    .from("community_posts")
    .insert({ user_id: userData.user.id, content: content.trim() })
    .select("id, user_id, content, created_at, updated_at")
    .single();

  if (error) throw error;
  return toCommunityPost(data as CommunityPostRow);
}

export async function deleteCommunityPost(postId: string): Promise<void> {
  const { data, error } = await supabase
    .from("community_posts")
    .delete()
    .eq("id", postId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("この投稿を削除できませんでした。");
}

async function getAuthenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("いいねするにはログインが必要です。");
  return data.user.id;
}

export async function createCommunityLike(postId: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  const { error } = await supabase
    .from("community_likes")
    .insert({ post_id: postId, user_id: userId });
  if (error) throw error;
}

export async function removeCommunityLike(postId: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  const { error } = await supabase
    .from("community_likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function loadCommunityComments(postId: string): Promise<CommunityComment[]> {
  const { data, error } = await supabase
    .from("community_comments")
    .select("id, post_id, user_id, content, created_at, updated_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => toCommunityComment(row as CommunityCommentRow));
}

export async function createCommunityComment(
  postId: string,
  content: string,
): Promise<CommunityComment> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("コメントするにはログインが必要です。");

  const { data, error } = await supabase
    .from("community_comments")
    .insert({ post_id: postId, user_id: userData.user.id, content: content.trim() })
    .select("id, post_id, user_id, content, created_at, updated_at")
    .single();

  if (error) throw error;
  return toCommunityComment(data as CommunityCommentRow);
}

export async function deleteCommunityComment(commentId: string): Promise<void> {
  const { data, error } = await supabase
    .from("community_comments")
    .delete()
    .eq("id", commentId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("このコメントを削除できませんでした。");
}
