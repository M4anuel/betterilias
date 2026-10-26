import { t, useLanguage } from '../lib/i18n';
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
  { id: 'BookOpen', get label() { return t("Vorlesung / Allgemein"); }, icon: BookOpen },
  { id: 'Code', get label() { return t("Programmieren & Software"); }, icon: Code },
  { id: 'Terminal', get label() { return t("Systeme & Unix"); }, icon: Terminal },
  { id: 'Cpu', get label() { return t("Hardware & Rechner"); }, icon: Cpu },
  { id: 'Database', get label() { return t("Datenbanken & Daten"); }, icon: Database },
  { id: 'Brain', get label() { return t("KI & Kognition"); }, icon: Brain },
  { id: 'Calculator', get label() { return t("Mathematik & Statistik"); }, icon: Calculator },
  { id: 'Atom', get label() { return t("Physik & Naturwissenschaften"); }, icon: Atom },
  { id: 'Palette', get label() { return t("MMS & Design"); }, icon: Palette },
  { id: 'Compass', get label() { return t("Navigation & Logik"); }, icon: Compass },
  { id: 'Globe', get label() { return t("Netzwerke & Web"); }, icon: Globe },
  { id: 'Layers', get label() { return t("Architektur & Modelle"); }, icon: Layers },
  { id: 'Shield', get label() { return t("Sicherheit & Krypto"); }, icon: Shield },
  { id: 'GraduationCap', get label() { return t("Theorie & Abschluss"); }, icon: GraduationCap },
  { id: 'Sparkles', get label() { return t("Spezial & Forschung"); }, icon: Sparkles },
  { id: 'Coffee', get label() { return t("Seminar & Diskussion"); }, icon: Coffee },
  { id: 'Briefcase', get label() { return t("Organisation & BWL"); }, icon: Briefcase },
  { id: 'FileText', get label() { return t("Dokumentation & Recht"); }, icon: FileText },
  { id: 'BarChart3', get label() { return t("Finanzen & Analyse"); }, icon: BarChart3 },
  { id: 'Music', get label() { return t("Audio & Medien"); }, icon: Music },
  { id: 'Stethoscope', get label() { return t("Medizin"); }, icon: Stethoscope },
  { id: 'HeartPulse', get label() { return t("Gesundheit & Biomedizin"); }, icon: HeartPulse },
  { id: 'Pill', get label() { return t("Pharmazie"); }, icon: Pill },
  { id: 'Microscope', get label() { return t("Mikroskopie & Zellbiologie"); }, icon: Microscope },
  { id: 'FlaskConical', get label() { return t("Chemie"); }, icon: FlaskConical },
  { id: 'Dna', get label() { return t("Biochemie & Molekularbiologie"); }, icon: Dna },
  { id: 'Leaf', get label() { return t("Biologie & Ökologie"); }, icon: Leaf },
  { id: 'Sprout', get label() { return t("Pflanzenwissenschaften"); }, icon: Sprout },
  { id: 'Mountain', get label() { return t("Erdwissenschaften & Archäologie"); }, icon: Mountain },
  { id: 'Map', get label() { return t("Geographie"); }, icon: Map },
  { id: 'CloudSun', get label() { return t("Klimawissenschaften"); }, icon: CloudSun },
  { id: 'Earth', get label() { return t("Nachhaltigkeit"); }, icon: Earth },
  { id: 'Scale', get label() { return t("Rechtswissenschaft"); }, icon: Scale },
  { id: 'Landmark', get label() { return t("Politik & Verwaltung"); }, icon: Landmark },
  { id: 'Church', get label() { return t("Theologie & Religion"); }, icon: Church },
  { id: 'Languages', get label() { return t("Sprachen & Literatur"); }, icon: Languages },
  { id: 'ScrollText', get label() { return t("Geschichte & Geisteswissenschaften"); }, icon: ScrollText },
  { id: 'Theater', get label() { return t("Kunst & Theater"); }, icon: Theater },
  { id: 'Building2', get label() { return t("Universitätsleitung"); }, icon: Building2 },
  { id: 'PawPrint', get label() { return t("Veterinärmedizin"); }, icon: PawPrint },
  { id: 'Users', get label() { return t("Sozialwissenschaften & Kultur"); }, icon: Users },
  { id: 'Megaphone', get label() { return t("Kommunikation & Medien"); }, icon: Megaphone },
  { id: 'Dumbbell', get label() { return t("Sportwissenschaft"); }, icon: Dumbbell },
  { id: 'BrainCircuit', get label() { return t("Künstliche Intelligenz"); }, icon: BrainCircuit },
];

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(AVAILABLE_COURSE_ICONS.map((option) => [option.id, option.icon]));

interface CourseIconProps {
  iconName?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const CourseIcon: React.FC<CourseIconProps> = ({ iconName = 'BookOpen', className = 'h-4 w-4', style }) => {
  useLanguage();
  const IconComponent = ICON_MAP[iconName] || BookOpen;
  return <IconComponent className={className} style={style} />;
};

