import MessageThread from "@/components/MessageThread";

export default function MessagesPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">Messages</h1>
        <p className="text-muted text-sm mt-1">A direct line to the FreeLoom team if something&apos;s not working right.</p>
      </div>
      <MessageThread />
    </div>
  );
}
