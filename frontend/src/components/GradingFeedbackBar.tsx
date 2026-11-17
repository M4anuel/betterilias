import { FeedbackBanner } from './ui/FeedbackBanner';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { t, useLanguage } from '../lib/i18n';
import React from 'react';
import {
  Eye,
  Filter,
  Award,
  Users,
} from 'lucide-react';

export interface GradeSavedFeedback {
  id: string;
  memberId: string;
  studentName: string;
  teamId?: string | null;
  status: string; // 'passed' | 'failed' | 'not_graded'
  mark?: string;
  wasFilteredOut: boolean;
}

interface GradingFeedbackBarProps {
  feedback: GradeSavedFeedback | null;
  onDismiss: () => void;
  onViewSubmission?: (memberId: string) => void;
  onResetFilter?: () => void;
}

export const GradingFeedbackBar: React.FC<GradingFeedbackBarProps> = ({ feedback, onDismiss, onViewSubmission, onResetFilter }) => {
  useLanguage();
  if (!feedback) return null;
  const grade = feedback.status === 'passed' ? { tone: 'success' as const, label: t('Bestanden') }
    : feedback.status === 'failed' ? { tone: 'danger' as const, label: t('Nicht bestanden') }
    : { tone: 'neutral' as const, label: t('Nicht bewertet') };
  return <FeedbackBanner onDismiss={onDismiss} aria-live="polite"
    message={<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className="font-bold">{t('Bewertung gespeichert:')}</span>
      <span className="min-w-0 max-w-full break-words font-bold">{feedback.studentName}</span>
      {feedback.teamId && <Badge icon={Users} tone="info">#{feedback.teamId}</Badge>}
      <Badge tone={grade.tone}>{grade.label}</Badge>
      {feedback.mark && <Badge icon={Award} tone="warning">{feedback.mark}</Badge>}
      {feedback.wasFilteredOut && <span className="hidden text-xs md:inline">{t('Aus «Zu korrigieren» entfernt, da jetzt bewertet.')}</span>}
      </div>
      {(onViewSubmission || (feedback.wasFilteredOut && onResetFilter)) && <div className="flex max-w-full flex-wrap gap-2">
      {onViewSubmission && <Button onClick={() => onViewSubmission(feedback.memberId)}><Eye size={16} aria-hidden="true" />{t('Einreichung ansehen')}</Button>}
      {feedback.wasFilteredOut && onResetFilter && <Button onClick={onResetFilter}><Filter size={16} aria-hidden="true" />{t('Filter aufheben')}</Button>}
      </div>}
    </div>} />;
};
