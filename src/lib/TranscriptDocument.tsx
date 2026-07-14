import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { GRADE_LEVELS, computeGpa, groupByGradeLevel, type GradableCourse } from "@/lib/gpa";
import type { LayoutStyle } from "@/lib/types";

const DEFAULT_ACCENT = "#b45309";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 2 },

  seal: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  sealMark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
  },
  sealMarkText: { color: "#fff", fontSize: 10, fontWeight: 700 },
  sealText: { fontSize: 7, fontWeight: 700, textAlign: "center", letterSpacing: 0.5 },
  sealRule: { width: 36, borderBottomWidth: 0.5, marginVertical: 2 },
  sealSubtext: { fontSize: 5.5, textAlign: "center", color: "#555" },
  sealLogo: { width: 60, height: 60, borderRadius: 30 },

  casualLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  casualLogo: { width: 44, height: 44, borderRadius: 10 },
  casualMonogram: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  casualMonogramText: { color: "#fff", fontSize: 18, fontWeight: 700 },

  infoGrid: { flexDirection: "row", gap: 24, marginBottom: 18 },
  infoCol: { flex: 1 },
  infoHeading: { fontSize: 8.5, fontWeight: 700, marginBottom: 4, letterSpacing: 0.5 },
  infoLine: { fontSize: 9, marginBottom: 1.5 },

  gradeBlockHeading: { fontSize: 10, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  gradeBlockPill: { alignSelf: "flex-start", borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8, marginTop: 14, marginBottom: 6 },
  gradeBlockPillText: { fontSize: 9, fontWeight: 700, color: "#fff" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 4 },
  headerRowTable: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#333", paddingBottom: 4, fontWeight: 700 },
  colTitle: { width: "55%" },
  colGrade: { width: "15%", textAlign: "center" },
  colCredits: { width: "20%", textAlign: "right" },
  gpaLine: { fontSize: 9, textAlign: "right", marginTop: 4, fontWeight: 700 },

  summaryByGradeHeading: { fontSize: 10, fontWeight: 700, marginTop: 20, marginBottom: 6 },
  summaryTable: { borderWidth: 1, borderColor: "#ccc" },
  summaryTableCasual: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, overflow: "hidden" },
  summaryHeaderRow: { flexDirection: "row", backgroundColor: "#f3f1ea", borderBottomWidth: 1, borderBottomColor: "#ccc" },
  summaryRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#eee" },
  summaryLabelCell: { width: "25%", fontSize: 8.5, fontWeight: 700, padding: 5 },
  summaryCell: { width: "18.75%", fontSize: 8.5, textAlign: "center", padding: 5 },

  bottomSection: { flexDirection: "row", gap: 20, marginTop: 20 },
  bottomBox: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 3, padding: 10 },
  bottomBoxCasual: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 },
  bottomHeading: { fontSize: 8.5, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 },
  gradingRow: { flexDirection: "row" },
  gradingCell: { flex: 1, fontSize: 7.5, textAlign: "center", paddingVertical: 2 },
  cumRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  cumLabel: { fontSize: 8.5, color: "#555" },
  cumValue: { fontSize: 8.5, fontWeight: 700 },

  signatureRow: { flexDirection: "row", gap: 40, marginTop: 36 },
  signatureLine: { flex: 1, borderTopWidth: 1, borderTopColor: "#333", paddingTop: 4, fontSize: 8, color: "#555" },

  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7, color: "#999", textAlign: "center" },
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US");
}

export type TranscriptPdfCourse = GradableCourse & {
  course_title: string;
  subject_area: string;
};

export type TranscriptPdfData = {
  studentName: string;
  gradeLevel: string | null;
  gender: string | null;
  birthDate: string | null;
  graduationDate: string | null;
  expectedGraduationYear: number | null;
  generatedAt: string;
  courses: TranscriptPdfCourse[];
  totalCreditHours: number;
  school: {
    schoolName: string | null;
    parentName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    accentColor: string | null;
    layoutStyle: LayoutStyle;
  };
};

export function TranscriptDocument({
  studentName,
  gender,
  birthDate,
  graduationDate,
  expectedGraduationYear,
  courses,
  totalCreditHours,
  school,
}: TranscriptPdfData) {
  const accent = school.accentColor || DEFAULT_ACCENT;
  const casual = school.layoutStyle === "casual";
  const monogram = (school.schoolName || studentName || "F").trim().charAt(0).toUpperCase() || "F";

  const grouped = groupByGradeLevel(courses);
  const cumulative = computeGpa(courses);

  const gradDateLabel = graduationDate
    ? formatDate(graduationDate)
    : expectedGraduationYear
    ? `Expected ${expectedGraduationYear}`
    : "—";

  const runningTotals = GRADE_LEVELS.reduce<
    { level: string; hasCourses: boolean; cumCredits: number; cumGpaCredits: number; cumGpaPoints: number }[]
  >((acc, level) => {
    const prev = acc[acc.length - 1];
    const bucket = grouped.find((g) => g.level === level);
    const bucketCourses = bucket?.courses ?? [];
    const bucketCredits = bucketCourses.reduce((sum, c) => sum + c.credit_hours, 0);
    const { gpaCredits, gpaPoints } = computeGpa(bucketCourses);
    return [
      ...acc,
      {
        level,
        hasCourses: bucketCourses.length > 0,
        cumCredits: (prev?.cumCredits ?? 0) + bucketCredits,
        cumGpaCredits: (prev?.cumGpaCredits ?? 0) + gpaCredits,
        cumGpaPoints: (prev?.cumGpaPoints ?? 0) + gpaPoints,
      },
    ];
  }, []);

  const summaryByGrade = runningTotals.map((s) => ({
    level: s.level,
    hasCourses: s.hasCourses,
    cumGpa: s.cumGpaCredits > 0 ? Math.round((s.cumGpaPoints / s.cumGpaCredits) * 100) / 100 : null,
    cumCredits: Math.round(s.cumCredits * 100) / 100,
  }));

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>{casual ? "Learning Record" : "High School Transcript"}</Text>
            {!casual && <Text style={styles.subtitle}>(Grades 9-12)</Text>}
            <Text style={styles.subtitle}>Graduation Date: {gradDateLabel}</Text>
          </View>

          {casual ? (
            <View style={styles.casualLockup}>
              {school.logoUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not an HTML img
                <Image src={school.logoUrl} style={styles.casualLogo} />
              ) : (
                <View style={[styles.casualMonogram, { backgroundColor: accent }]}>
                  <Text style={styles.casualMonogramText}>{monogram}</Text>
                </View>
              )}
              <Text style={{ fontSize: 11, fontWeight: 700 }}>{school.schoolName || "Homeschool"}</Text>
            </View>
          ) : (
            <View style={[styles.seal, { borderColor: accent }]}>
              {school.logoUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not an HTML img
                <Image src={school.logoUrl} style={styles.sealLogo} />
              ) : (
                <>
                  <View style={[styles.sealMark, { backgroundColor: accent }]}>
                    <Text style={styles.sealMarkText}>{monogram}</Text>
                  </View>
                  <Text style={styles.sealText}>{(school.schoolName || "FREELOOM").toUpperCase()}</Text>
                  <View style={[styles.sealRule, { borderBottomColor: accent }]} />
                  <Text style={styles.sealSubtext}>Official Transcript</Text>
                </>
              )}
            </View>
          )}
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCol}>
            <Text style={[styles.infoHeading, { color: accent }]}>SCHOOL OF RECORD</Text>
            <Text style={styles.infoLine}>{school.schoolName || "Homeschool"}</Text>
            {school.parentName && <Text style={styles.infoLine}>{school.parentName}</Text>}
            {school.address && <Text style={styles.infoLine}>{school.address}</Text>}
            {school.phone && <Text style={styles.infoLine}>{school.phone}</Text>}
            {school.email && <Text style={styles.infoLine}>{school.email}</Text>}
          </View>
          <View style={styles.infoCol}>
            <Text style={[styles.infoHeading, { color: accent }]}>STUDENT INFORMATION</Text>
            <Text style={styles.infoLine}>{studentName || "Unnamed Student"}</Text>
            {gender && <Text style={styles.infoLine}>Gender: {gender}</Text>}
            <Text style={styles.infoLine}>Date of Birth: {formatDate(birthDate)}</Text>
            {school.address && <Text style={styles.infoLine}>{school.address}</Text>}
            {school.phone && <Text style={styles.infoLine}>{school.phone}</Text>}
            {school.email && <Text style={styles.infoLine}>{school.email}</Text>}
          </View>
        </View>

        {grouped.length === 0 ? (
          <Text style={{ fontSize: 9, color: "#888" }}>No approved courses yet.</Text>
        ) : (
          grouped.map((bucket) => {
            const blockGpa = computeGpa(bucket.courses);
            const heading = `Course Study ${bucket.level === "Other" ? "" : `— Grade ${bucket.level}`}`;
            return (
              <View key={bucket.level} wrap={false}>
                {casual ? (
                  <View style={[styles.gradeBlockPill, { backgroundColor: accent }]}>
                    <Text style={styles.gradeBlockPillText}>{heading}</Text>
                  </View>
                ) : (
                  <Text style={styles.gradeBlockHeading}>{heading}</Text>
                )}
                <View style={casual ? [styles.headerRowTable, { borderBottomColor: accent, borderBottomWidth: 0.75 }] : styles.headerRowTable}>
                  <Text style={styles.colTitle}>Course Title</Text>
                  <Text style={styles.colGrade}>Grade</Text>
                  <Text style={styles.colCredits}>Credits</Text>
                </View>
                {bucket.courses.map((c, i) => (
                  <View style={styles.row} key={i}>
                    <Text style={styles.colTitle}>{c.course_title}</Text>
                    <Text style={styles.colGrade}>{c.letter_grade || "—"}</Text>
                    <Text style={styles.colCredits}>{c.credit_hours.toFixed(2)}</Text>
                  </View>
                ))}
                {blockGpa.gpa !== null && <Text style={styles.gpaLine}>GPA: {blockGpa.gpa.toFixed(2)}</Text>}
              </View>
            );
          })
        )}

        <Text style={styles.summaryByGradeHeading}>Summary By Grade</Text>
        <View style={casual ? styles.summaryTableCasual : styles.summaryTable}>
          <View style={styles.summaryHeaderRow}>
            <Text style={styles.summaryLabelCell}>Grade</Text>
            {summaryByGrade.map((s) => (
              <Text style={styles.summaryCell} key={s.level}>
                {s.level}th
              </Text>
            ))}
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelCell}>Cum. GPA</Text>
            {summaryByGrade.map((s) => (
              <Text style={styles.summaryCell} key={s.level}>
                {s.cumGpa !== null ? s.cumGpa.toFixed(2) : "—"}
              </Text>
            ))}
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelCell}>Credits Earned</Text>
            {summaryByGrade.map((s) => (
              <Text style={styles.summaryCell} key={s.level}>
                {s.hasCourses || s.cumCredits > 0 ? s.cumCredits.toFixed(2) : "—"}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.bottomSection} wrap={false}>
          <View style={casual ? [styles.bottomBoxCasual, { borderColor: accent }] : styles.bottomBox}>
            <Text style={[styles.bottomHeading, casual ? { color: accent } : {}]}>CUMULATIVE SUMMARY</Text>
            <View style={styles.cumRow}>
              <Text style={styles.cumLabel}>Total Credits</Text>
              <Text style={styles.cumValue}>{totalCreditHours.toFixed(2)}</Text>
            </View>
            <View style={styles.cumRow}>
              <Text style={styles.cumLabel}>GPA Credits</Text>
              <Text style={styles.cumValue}>{cumulative.gpaCredits.toFixed(2)}</Text>
            </View>
            <View style={styles.cumRow}>
              <Text style={styles.cumLabel}>GPA Points</Text>
              <Text style={styles.cumValue}>{cumulative.gpaPoints.toFixed(2)}</Text>
            </View>
            <View style={styles.cumRow}>
              <Text style={styles.cumLabel}>GPA</Text>
              <Text style={styles.cumValue}>{cumulative.gpa !== null ? cumulative.gpa.toFixed(2) : "—"}</Text>
            </View>
          </View>

          <View style={casual ? [styles.bottomBoxCasual, { borderColor: accent }] : styles.bottomBox}>
            <Text style={[styles.bottomHeading, casual ? { color: accent } : {}]}>GRADING SCALE</Text>
            <View style={styles.gradingRow}>
              <Text style={styles.gradingCell}>90-100</Text>
              <Text style={styles.gradingCell}>80-89</Text>
              <Text style={styles.gradingCell}>70-79</Text>
              <Text style={styles.gradingCell}>60-69</Text>
              <Text style={styles.gradingCell}>0-59</Text>
            </View>
            <View style={styles.gradingRow}>
              <Text style={styles.gradingCell}>A (4.0)</Text>
              <Text style={styles.gradingCell}>B (3.0)</Text>
              <Text style={styles.gradingCell}>C (2.0)</Text>
              <Text style={styles.gradingCell}>D (1.0)</Text>
              <Text style={styles.gradingCell}>F (0.0)</Text>
            </View>
          </View>
        </View>

        <View style={styles.signatureRow} wrap={false}>
          <Text style={styles.signatureLine}>Authorized Signature</Text>
          <Text style={styles.signatureLine}>Date</Text>
        </View>

        <Text style={styles.footer} fixed>
          Generated with FreeLoom — real learning, formally recorded.
        </Text>
      </Page>
    </Document>
  );
}
