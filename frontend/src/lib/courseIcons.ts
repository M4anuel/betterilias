import faculties from './courseSubjects.json';

const normalize = (label: string) => label.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Subject names taken from ActualListOfAllSubjects; unknown subjects inherit their faculty.
const subjectIcons = new Map(faculties.flatMap((faculty) =>
  Object.entries(faculty.subjects).map(([subject, icon]) => [normalize(subject), icon] as const)));
subjectIcons.set(normalize('Betriebswirtschaftslehre'), 'Briefcase');
const facultyIcons = new Map(faculties.map((faculty) => [normalize(faculty.faculty), faculty.icon]));

export function getDefaultCourseIcon(labels: string[]): string {
  const normalized = labels.map(normalize);
  for (const label of normalized) {
    const icon = subjectIcons.get(label);
    if (icon) return icon;
  }
  for (const label of normalized) {
    const icon = facultyIcons.get(label);
    if (icon) return icon;
  }
  return 'BookOpen';
}
