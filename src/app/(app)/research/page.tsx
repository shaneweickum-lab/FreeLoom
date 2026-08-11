import ResearchLibrary from "@/components/ResearchLibrary";

export default function ResearchPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">Research Library</h1>
        <p className="text-muted text-sm mt-1">
          Real academic citations backing up unschooling, wildschooling, neurodivergent-affirming practice, and
          interest-led learning -- for your own confidence, or to point to if your approach is ever questioned.
        </p>
      </div>
      <ResearchLibrary />
    </div>
  );
}
