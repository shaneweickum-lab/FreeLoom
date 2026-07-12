import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { computeGpa, totalCredits } from "./gpa";
import type { Course, StudentProfile } from "./types";

export function generateTranscriptPdf(student: StudentProfile, courses: Course[]) {
  const doc = new jsPDF();
  const gpa = computeGpa(courses);
  const credits = totalCredits(courses);

  doc.setFontSize(18);
  doc.text("Official Homeschool Transcript", 14, 20);

  doc.setFontSize(11);
  doc.text(`Student: ${student.name || "—"}`, 14, 30);
  doc.text(`Grade Level: ${student.gradeLevel || "—"}`, 14, 36);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, 14, 42);

  autoTable(doc, {
    startY: 50,
    head: [["Course Title", "Subject Area", "Credit Hours", "Grade"]],
    body: courses.map((c) => [c.title, c.subjectArea, c.creditHours.toFixed(2), c.grade]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [30, 30, 60] },
  });

  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  doc.setFontSize(12);
  doc.text(`Cumulative Credit Hours: ${credits.toFixed(2)}`, 14, afterTableY);
  doc.text(`Cumulative GPA: ${gpa.toFixed(2)}`, 14, afterTableY + 8);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "Generated with FreeLoom — real learning, formally recorded.",
    14,
    doc.internal.pageSize.getHeight() - 10
  );

  const fileName = `${(student.name || "student").replace(/\s+/g, "_").toLowerCase()}_transcript.pdf`;
  doc.save(fileName);
}
