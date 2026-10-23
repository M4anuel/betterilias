import React from 'react';
import {
  BookOpen,
  Code,
  Terminal,
  Cpu,
  Database,
  Brain,
  Calculator,
  Atom,
  Palette,
  Compass,
  Globe,
  Layers,
  Shield,
  GraduationCap,
  Sparkles,
  Coffee,
  Briefcase,
  FileText,
  BarChart3,
  Music,
  Stethoscope, HeartPulse, Pill, Microscope, Dna, Leaf, Sprout, Mountain, Map,
  CloudSun, Earth, Scale, Landmark, Church, Languages, ScrollText, Theater,
  Building2, PawPrint, Users, Megaphone, Dumbbell, BrainCircuit,
  FlaskConical,
  LucideIcon,
} from 'lucide-react';

export interface IconOption {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const AVAILABLE_COURSE_ICONS: IconOption[] = [
  { id: 'BookOpen', label: 'Vorlesung / Allgemein', icon: BookOpen },
  { id: 'Code', label: 'Programmieren & Software', icon: Code },
  { id: 'Terminal', label: 'Systeme & Unix', icon: Terminal },
  { id: 'Cpu', label: 'Hardware & Rechner', icon: Cpu },
  { id: 'Database', label: 'Datenbanken & Daten', icon: Database },
  { id: 'Brain', label: 'KI & Kognition', icon: Brain },
  { id: 'Calculator', label: 'Mathematik & Statistik', icon: Calculator },
  { id: 'Atom', label: 'Physik & Naturwissenschaften', icon: Atom },
  { id: 'Palette', label: 'MMS & Design', icon: Palette },
  { id: 'Compass', label: 'Navigation & Logik', icon: Compass },
  { id: 'Globe', label: 'Netzwerke & Web', icon: Globe },
  { id: 'Layers', label: 'Architektur & Modelle', icon: Layers },
  { id: 'Shield', label: 'Sicherheit & Krypto', icon: Shield },
  { id: 'GraduationCap', label: 'Theorie & Abschluss', icon: GraduationCap },
  { id: 'Sparkles', label: 'Spezial & Forschung', icon: Sparkles },
  { id: 'Coffee', label: 'Seminar & Diskussion', icon: Coffee },
  { id: 'Briefcase', label: 'Organisation & BWL', icon: Briefcase },
  { id: 'FileText', label: 'Dokumentation & Recht', icon: FileText },
  { id: 'BarChart3', label: 'Finanzen & Analyse', icon: BarChart3 },
  { id: 'Music', label: 'Audio & Medien', icon: Music },
  { id: 'Stethoscope', label: 'Medizin', icon: Stethoscope },
  { id: 'HeartPulse', label: 'Gesundheit & Biomedizin', icon: HeartPulse },
  { id: 'Pill', label: 'Pharmazie', icon: Pill },
  { id: 'Microscope', label: 'Mikroskopie & Zellbiologie', icon: Microscope },
  { id: 'FlaskConical', label: 'Chemie', icon: FlaskConical },
  { id: 'Dna', label: 'Biochemie & Molekularbiologie', icon: Dna },
  { id: 'Leaf', label: 'Biologie & Ökologie', icon: Leaf },
  { id: 'Sprout', label: 'Pflanzenwissenschaften', icon: Sprout },
  { id: 'Mountain', label: 'Erdwissenschaften & Archäologie', icon: Mountain },
  { id: 'Map', label: 'Geographie', icon: Map },
  { id: 'CloudSun', label: 'Klimawissenschaften', icon: CloudSun },
  { id: 'Earth', label: 'Nachhaltigkeit', icon: Earth },
  { id: 'Scale', label: 'Rechtswissenschaft', icon: Scale },
  { id: 'Landmark', label: 'Politik & Verwaltung', icon: Landmark },
  { id: 'Church', label: 'Theologie & Religion', icon: Church },
  { id: 'Languages', label: 'Sprachen & Literatur', icon: Languages },
  { id: 'ScrollText', label: 'Geschichte & Geisteswissenschaften', icon: ScrollText },
  { id: 'Theater', label: 'Kunst & Theater', icon: Theater },
  { id: 'Building2', label: 'Universitätsleitung', icon: Building2 },
  { id: 'PawPrint', label: 'Veterinärmedizin', icon: PawPrint },
  { id: 'Users', label: 'Sozialwissenschaften & Kultur', icon: Users },
  { id: 'Megaphone', label: 'Kommunikation & Medien', icon: Megaphone },
  { id: 'Dumbbell', label: 'Sportwissenschaft', icon: Dumbbell },
  { id: 'BrainCircuit', label: 'Künstliche Intelligenz', icon: BrainCircuit },
];

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(AVAILABLE_COURSE_ICONS.map((option) => [option.id, option.icon]));

interface CourseIconProps {
  iconName?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const CourseIcon: React.FC<CourseIconProps> = ({ iconName = 'BookOpen', className = 'h-4 w-4', style }) => {
  const IconComponent = ICON_MAP[iconName] || BookOpen;
  return <IconComponent className={className} style={style} />;
};

