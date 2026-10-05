import { supabase } from "../lib/supabaseClient";

export type CommunityPost = {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
};

export type CommunityComment = {
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type CommunityPostRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  community_comments?: Array<{ count: number }>;
};

type CommunityCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function toCommunityPost(row: CommunityPostRow): CommunityPost {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commentCount: row.community_comments?.[0]?.count ?? 0,
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

export async function loadCommunityPosts(): Promise<CommunityPost[]> {
  const { data, error } = await supabase
    .from("community_posts")
    .select("id, user_id, content, created_at, updated_at, community_comments(count)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => toCommunityPost(row as CommunityPostRow));
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
