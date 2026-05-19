/**
 * FileUploadPanel — placeholder for Phase E1-D (Excel/CSV upload tab).
 *
 * Wired into the modal tab strip in E1-C so the three-tab shape is visible
 * to operators; the body is intentionally a "coming soon" notice until E1-D
 * lands the drag-and-drop + preflight + template-download UX.
 */

import { FileSpreadsheet } from 'lucide-react';

import { BULK_FILE_COMING_SOON } from '../../config/strings.he';

export default function FileUploadPanel() {
  return (
    <div className="flex flex-col items-center justify-center text-slate-400 py-12 gap-3">
      <FileSpreadsheet className="w-10 h-10" />
      <p className="text-sm text-center">{BULK_FILE_COMING_SOON}</p>
    </div>
  );
}
