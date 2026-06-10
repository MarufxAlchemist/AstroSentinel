import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft,
  FlaskConical,
  LayoutGrid,
  FileText,
  MessageSquare,
  StickyNote,
  Send,
  Trash2,
  Pin,
  Tag,
  User,
  ChevronDown,
  ChevronUp,
  Reply,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/AuthContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NoteAuthor {
  name: string;
  email: string;
}

interface Note {
  id: string;
  content: string;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: NoteAuthor;
}

interface DiscussionPost {
  id: string;
  parentId: string | null;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: NoteAuthor;
  replies: DiscussionPost[];
}

type Tab = "overview" | "notes" | "discussions";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",    label: "Overview",    icon: LayoutGrid    },
  { id: "notes",       label: "Notes",       icon: FileText      },
  { id: "discussions", label: "Discussions", icon: MessageSquare },
];

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3 select-none">
      <div className="bg-muted/50 p-4 rounded-xl border border-border">
        <Icon className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Note card ───────────────────────────────────────────────────────────────

function NoteCard({
  note,
  currentUserId,
  onDelete,
}: {
  note: Note;
  currentUserId: string | undefined;
  onDelete: (id: string) => void;
}) {
  const isOwn = currentUserId !== undefined && note.author.email !== "";
  const date = new Date(note.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={`group relative rounded-lg border bg-card p-4 transition-colors ${
        note.isPinned ? "border-primary/40 bg-primary/5" : "border-border/50 hover:border-border"
      }`}
    >
      {note.isPinned && (
        <div className="absolute top-3 right-3 flex items-center gap-1 text-[9px] font-mono uppercase text-primary">
          <Pin className="w-2.5 h-2.5" />
          Pinned
        </div>
      )}

      {/* Author row */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <User className="w-3 h-3 text-primary" />
        </div>
        <span className="text-xs font-semibold text-foreground">{note.author.name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          {dateStr} · {timeStr}
        </span>
      </div>

      {/* Content */}
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{note.content}</p>

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground font-mono"
            >
              <Tag className="w-2 h-2" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Delete — only shown to note owner */}
      {isOwn && (
        <button
          onClick={() => onDelete(note.id)}
          className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all"
          title="Delete note"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Notes panel ─────────────────────────────────────────────────────────────

function NotesPanel({ eventId }: { eventId: string }) {
  const { token, user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch notes
  useEffect(() => {
    if (!token || !eventId) return;
    setLoading(true);
    fetch(`/api/events/${eventId}/notes`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data: { notes?: Note[]; error?: string }) => {
        if (data.notes) setNotes(data.notes);
        else setError(data.error ?? "Failed to load notes");
      })
      .catch(() => setError("Network error loading notes"))
      .finally(() => setLoading(false));
  }, [token, eventId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitError("");
    setSubmitting(true);

    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/events/${eventId}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: content.trim(), tags }),
      });
      const data = await res.json() as { note?: Note; error?: string };
      if (!res.ok) { setSubmitError(data.error ?? "Failed to post note"); return; }
      setNotes((prev) => [data.note!, ...prev]);
      setContent("");
      setTagsRaw("");
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(noteId: string) {
    try {
      await fetch(`/api/events/${eventId}/notes/${noteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      setError("Failed to delete note");
    }
  }

  const pinned = notes.filter((n) => n.isPinned);
  const rest   = notes.filter((n) => !n.isPinned);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Main column */}
      <div className="lg:col-span-2 space-y-4">

        {/* Add note form */}
        <Card className="bg-card border-border/50 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
              <FileText className="w-3.5 h-3.5" />
              Add Note
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Record an observation, hypothesis, or follow-up action…"
                rows={4}
                className="w-full resize-none px-3 py-2.5 text-sm bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-colors font-mono leading-relaxed"
              />
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <div className="relative flex-1 min-w-0">
                  <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <input
                    type="text"
                    value={tagsRaw}
                    onChange={(e) => setTagsRaw(e.target.value)}
                    placeholder="Tags (comma-separated, optional)"
                    className="w-full pl-7 pr-3 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !content.trim()}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-3 h-3" />
                  {submitting ? "Posting…" : "Post Note"}
                </button>
              </div>
              {submitError && (
                <p className="text-xs text-red-500">{submitError}</p>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Notes list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 rounded-lg border border-border/50 bg-card animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-xs text-red-500 px-1">{error}</p>
        ) : notes.length === 0 ? (
          <Card className="bg-card border-border/50 shadow-none">
            <CardContent className="pt-6">
              <EmptyState
                icon={StickyNote}
                title="No notes yet"
                description="Post the first observation note for this event."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pinned.map((n) => (
              <NoteCard key={n.id} note={n} currentUserId={user?.userId} onDelete={handleDelete} />
            ))}
            {rest.map((n) => (
              <NoteCard key={n.id} note={n} currentUserId={user?.userId} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        <Card className="bg-card border-border/50 shadow-none">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
              Note Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total notes</span>
              <span className="font-mono text-xs">{notes.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Pinned</span>
              <span className="font-mono text-xs">{pinned.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Contributors</span>
              <span className="font-mono text-xs">
                {new Set(notes.map((n) => n.author.email)).size || "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Overview panel ──────────────────────────────────────────────────────────

function OverviewPanel({ id }: { id: string }) {
  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card className="bg-card border-border/50 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutGrid className="w-4 h-4 text-primary" />
              Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={FlaskConical}
              title="Research tools coming soon"
              description="Analysis panels, AI summaries, and observation data will appear here."
            />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card className="bg-card border-border/50 shadow-none">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Event Reference</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Event ID</span>
              <span className="font-mono text-xs text-primary truncate max-w-[150px]">{id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Workspace</span>
              <span className="font-mono text-xs text-muted-foreground">v0 · scaffold</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Discussions panel ───────────────────────────────────────────────────────

function PostAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary select-none">
      {initials || <User className="w-3 h-3" />}
    </div>
  );
}

function ReplyForm({
  onSubmit,
}: {
  onSubmit: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setErr("");
    setSubmitting(true);
    try {
      await onSubmit(content.trim());
      setContent("");
    } catch (ex: any) {
      setErr(ex?.message ?? "Failed to post reply");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handle} className="flex gap-2 mt-3">
      <input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write a reply…"
        className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors font-mono"
      />
      <button
        type="submit"
        disabled={submitting || !content.trim()}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        <Reply className="w-3 h-3" />
        {submitting ? "…" : "Reply"}
      </button>
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
    </form>
  );
}

function ThreadCard({
  thread,
  currentUserEmail,
  onDelete,
  onReply,
}: {
  thread: DiscussionPost;
  currentUserEmail: string | undefined;
  onDelete: (id: string) => void;
  onReply: (threadId: string, content: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const isOwn = thread.author.email !== "" && thread.author.email === currentUserEmail;
  const date = new Date(thread.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-hidden">
      {/* Thread header */}
      <div className="flex items-start gap-3 p-4">
        <PostAvatar name={thread.author.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{thread.author.name}</span>
            <span className="text-[10px] text-muted-foreground">{dateStr} · {timeStr}</span>
          </div>
          <p className="text-sm text-foreground leading-relaxed mt-1 whitespace-pre-wrap">{thread.content}</p>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => setShowReplyForm((v) => !v)}
              className="text-[10px] font-semibold text-muted-foreground hover:text-primary transition-colors"
            >
              {showReplyForm ? "Cancel" : "Reply"}
            </button>
            {thread.replies.length > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
              </button>
            )}
          </div>
        </div>
        {isOwn && (
          <button
            onClick={() => onDelete(thread.id)}
            className="p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all shrink-0"
            title="Delete thread"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Reply form */}
      {showReplyForm && (
        <div className="px-4 pb-3 border-t border-border/50 pt-3 bg-muted/20">
          <ReplyForm
            onSubmit={async (content) => {
              await onReply(thread.id, content);
              setShowReplyForm(false);
            }}
          />
        </div>
      )}

      {/* Replies */}
      {expanded && thread.replies.length > 0 && (
        <div className="border-t border-border/50 divide-y divide-border/30">
          {thread.replies.map((reply) => {
            const rDate = new Date(reply.createdAt);
            return (
              <div key={reply.id} className="flex items-start gap-3 px-4 py-3 pl-10 bg-muted/10">
                <PostAvatar name={reply.author.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-foreground">{reply.author.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {rDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {rDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed mt-1 whitespace-pre-wrap">{reply.content}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiscussionsPanel({ eventId }: { eventId: string }) {
  const { token, user } = useAuth();
  const [threads, setThreads] = useState<DiscussionPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!token || !eventId) return;
    setLoading(true);
    fetch(`/api/events/${eventId}/discussions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data: { threads?: DiscussionPost[]; error?: string }) => {
        if (data.threads) setThreads(data.threads);
        else setError(data.error ?? "Failed to load discussions");
      })
      .catch(() => setError("Network error loading discussions"))
      .finally(() => setLoading(false));
  }, [token, eventId]);

  async function handleNewThread(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/discussions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: newContent.trim() }),
      });
      const data = await res.json() as { thread?: DiscussionPost; error?: string };
      if (!res.ok) { setSubmitError(data.error ?? "Failed to start thread"); return; }
      setThreads((prev) => [data.thread!, ...prev]);
      setNewContent("");
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply(threadId: string, content: string) {
    const res = await fetch(`/api/events/${eventId}/discussions/${threadId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content }),
    });
    const data = await res.json() as { reply?: DiscussionPost; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to post reply");
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, replies: [...t.replies, data.reply!] } : t
      )
    );
  }

  async function handleDelete(threadId: string) {
    try {
      await fetch(`/api/events/${eventId}/discussions/${threadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    } catch {
      setError("Failed to delete thread");
    }
  }

  const totalReplies = threads.reduce((sum, t) => sum + t.replies.length, 0);
  const participants = new Set([
    ...threads.map((t) => t.author.email),
    ...threads.flatMap((t) => t.replies.map((r) => r.author.email)),
  ]).size;

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Main column */}
      <div className="lg:col-span-2 space-y-4">

        {/* New thread form */}
        <Card className="bg-card border-border/50 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
              <MessageSquare className="w-3.5 h-3.5" />
              Start a Thread
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleNewThread} className="space-y-3">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Share an observation, question, or follow-up for the team…"
                rows={3}
                className="w-full resize-none px-3 py-2.5 text-sm bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-colors font-mono leading-relaxed"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !newContent.trim()}
                  className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-3 h-3" />
                  {submitting ? "Posting…" : "Start Thread"}
                </button>
              </div>
              {submitError && <p className="text-xs text-red-500">{submitError}</p>}
            </form>
          </CardContent>
        </Card>

        {/* Thread list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 rounded-lg border border-border/50 bg-card animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-xs text-red-500 px-1">{error}</p>
        ) : threads.length === 0 ? (
          <Card className="bg-card border-border/50 shadow-none">
            <CardContent className="pt-6">
              <EmptyState
                icon={MessageSquare}
                title="No discussions yet"
                description="Start the first thread to discuss this event with your team."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {threads.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                currentUserEmail={user?.email}
                onDelete={handleDelete}
                onReply={handleReply}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        <Card className="bg-card border-border/50 shadow-none">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Thread Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Threads</span>
              <span className="font-mono text-xs">{threads.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Replies</span>
              <span className="font-mono text-xs">{totalReplies}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Participants</span>
              <span className="font-mono text-xs">{participants || "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ResearchWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4 shrink-0">
        <div className="max-w-screen-xl mx-auto">
          <Link
            href={`/events/${id}`}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Event
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-primary/15 p-2 rounded-lg border border-primary/30 shrink-0">
                <FlaskConical className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground tracking-tight">Research Workspace</h1>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  Event: <span className="text-primary">{id}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex mt-5 -mb-4 overflow-x-auto">
            {TABS.map(({ id: tabId, label, icon: Icon }) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`
                  flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold font-mono
                  uppercase tracking-wider border-b-2 whitespace-nowrap transition-colors
                  ${
                    activeTab === tabId
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }
                `}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-screen-xl mx-auto">
          {activeTab === "overview"    && <OverviewPanel id={id ?? ""} />}
          {activeTab === "notes"       && <NotesPanel eventId={id ?? ""} />}
          {activeTab === "discussions" && <DiscussionsPanel eventId={id ?? ""} />}
        </div>
      </div>
    </div>
  );
}
