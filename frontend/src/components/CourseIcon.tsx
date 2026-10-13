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
];

const ICON_MAP: Record<string, LucideIcon> = {
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
};

interface CourseIconProps {
  iconName?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const CourseIcon: React.FC<CourseIconProps> = ({ iconName = 'BookOpen', className = 'h-4 w-4', style }) => {
  const IconComponent = ICON_MAP[iconName] || BookOpen;
  return <IconComponent className={className} style={style} />;
};

