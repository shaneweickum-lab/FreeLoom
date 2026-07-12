import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 20, marginBottom: 4, fontWeight: 700 },
  subtitle: { fontSize: 11, color: "#555", marginBottom: 2 },
  meta: { fontSize: 9, color: "#888", marginBottom: 20 },
  table: { marginTop: 20 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd", paddingVertical: 6 },
  headerRow: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "#333", paddingBottom: 6, fontWeight: 700 },
  colTitle: { width: "45%" },
  colSubject: { width: "35%" },
  colCredits: { width: "20%", textAlign: "right" },
  summary: { marginTop: 24, fontSize: 12 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#999" },
});

export type TranscriptPdfData = {
  studentName: string;
  gradeLevel: string | null;
  generatedAt: string;
  courses: { course_title: string; subject_area: string; credit_hours: number }[];
  totalCreditHours: number;
};

export function TranscriptDocument({ studentName, gradeLevel, generatedAt, courses, totalCreditHours }: TranscriptPdfData) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Homeschool Transcript</Text>
        <Text style={styles.subtitle}>{studentName || "Unnamed Student"}</Text>
        <Text style={styles.subtitle}>{gradeLevel || "Grade level not set"}</Text>
        <Text style={styles.meta}>Generated {new Date(generatedAt).toISOString().slice(0, 10)}</Text>

        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={styles.colTitle}>Course Title</Text>
            <Text style={styles.colSubject}>Subject Area</Text>
            <Text style={styles.colCredits}>Credits</Text>
          </View>
          {courses.map((c, i) => (
            <View style={styles.row} key={i}>
              <Text style={styles.colTitle}>{c.course_title}</Text>
              <Text style={styles.colSubject}>{c.subject_area}</Text>
              <Text style={styles.colCredits}>{c.credit_hours.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.summary}>Cumulative Credit Hours: {totalCreditHours.toFixed(2)}</Text>

        <Text style={styles.footer}>Generated with FreeLoom — real learning, formally recorded.</Text>
      </Page>
    </Document>
  );
}
