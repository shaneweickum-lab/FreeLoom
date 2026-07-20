"use client";

import { useNotifications } from "@/lib/useNotifications";
import NotificationItem from "@/components/NotificationItem";

export default function NotificationsInboxPage() {
  const { notifications, loading, markAllRead, remove, reload } = useNotifications(100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl font-bold">Notifications</h1>
          <p className="text-muted text-sm mt-1">
            Messages, announcements, and account-access requests, all in one place.
          </p>
        </div>
        {notifications.length > 0 && (
          <button onClick={() => markAllRead()} className="btn-secondary text-xs whitespace-nowrap">
            Mark all read
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {!loading && notifications.length === 0 && <p className="text-sm text-muted">Nothing here yet.</p>}

      <div className="flex flex-col gap-2">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onResponded={reload} onDelete={remove} />
        ))}
      </div>
    </div>
  );
}
