import { renderToBuffer } from "@react-pdf/renderer";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TranscriptDocument } from "@/lib/TranscriptDocument";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ transcriptId: string }> }
) {
  const { transcriptId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_shared_transcript", {
    p_transcript_id: transcriptId,
  });

  if (error) {
    console.error("get_shared_transcript RPC failed", error);
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }
  if (!data) {
    return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
  }

  const shared = data as {
    student: {
      name: string;
      grade_level: string | null;
      gender: string | null;
      birth_date: string | null;
      graduation_date: string | null;
      expected_graduation_year: number | null;
    };
    school: {
      school_name: string | null;
      parent_name: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
    };
    generated_at: string;
    courses: { course_title: string; subject_area: string; credit_hours: number; letter_grade: string | null; grade_level: string | null }[];
    total_credit_hours: number;
  };

  const buffer = await renderToBuffer(
    <TranscriptDocument
      studentName={shared.student.name}
      gradeLevel={shared.student.grade_level}
      gender={shared.student.gender}
      birthDate={shared.student.birth_date}
      graduationDate={shared.student.graduation_date}
      expectedGraduationYear={shared.student.expected_graduation_year}
      generatedAt={shared.generated_at}
      courses={shared.courses}
      totalCreditHours={shared.total_credit_hours}
      school={{
        schoolName: shared.school?.school_name ?? null,
        parentName: shared.school?.parent_name ?? null,
        address: shared.school?.address ?? null,
        phone: shared.school?.phone ?? null,
        email: shared.school?.email ?? null,
      }}
    />
  );

  // Best-effort cache: only succeeds (via storage RLS) when the requester is
  // authenticated and owns this transcript. Anonymous share-page downloads
  // simply skip caching and stream the freshly rendered PDF instead.
  try {
    const path = `${transcriptId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("transcripts")
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (!uploadError) {
      const { data: publicUrlData } = supabase.storage.from("transcripts").getPublicUrl(path);
      await supabase.from("transcripts").update({ pdf_url: publicUrlData.publicUrl }).eq("id", transcriptId);
    }
  } catch {
    // Non-fatal: the caller still gets the PDF below.
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(shared.student.name || "student").replace(/\s+/g, "_").toLowerCase()}_transcript.pdf"`,
    },
  });
}
