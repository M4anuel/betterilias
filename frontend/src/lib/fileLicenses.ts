import { t } from './i18n';
import type { FileLicense } from '../types';

/** Standard native ILIAS copyright choices; custom institution labels stay intact. */
export function describeFileLicense(license: FileLicense) {
  const label = license.label.trim();
  const cc = label.match(/(?:\(|^CC\s+)(by(?:-nc)?(?:-nd|-sa)?)(?:\)|\s|$)/i)?.[1].toLowerCase();
  if (/^(all rights reserved|alle rechte vorbehalten)$/i.test(label)) {
    return { label: t('authoring.rights'), description: t('authoring.license_rights') };
  }
  if (/^(no license selected|keine lizenz ausgewählt)$/i.test(label)) {
    return { label: t('authoring.no_license'), description: t('authoring.license_unspecified') };
  }
  if (/^(public domain|gemeinfrei)$/i.test(label)) {
    return { label: t('authoring.public_domain'), description: t('authoring.license_public_domain') };
  }
  if (cc === 'by-nc-nd' || /^attribution non-commercial no derivatives$/i.test(label)) {
    return { label: 'CC BY-NC-ND', description: t('authoring.license_by_nc_nd') };
  }
  if (cc === 'by-nc-sa') return { label: 'CC BY-NC-SA', description: t('authoring.license_by_nc_sa') };
  if (cc === 'by-nc') return { label: 'CC BY-NC', description: t('authoring.license_by_nc') };
  if (cc === 'by-nd') return { label: 'CC BY-ND', description: t('authoring.license_by_nd') };
  if (cc === 'by-sa') return { label: 'CC BY-SA', description: t('authoring.license_by_sa') };
  if (cc === 'by') return { label: 'CC BY', description: t('authoring.license_by') };
  return { label, description: t('authoring.license_custom') };
}
