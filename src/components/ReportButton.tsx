import { ActionForm } from "./ActionForm";
import { inputCls } from "./ui";
import { flagAction } from "@/app/actions";

/** Small "Report" disclosure used under comments. */
export function ReportButton({ targetId, commentId }: { targetId: string; commentId?: string }) {
  return (
    <details className="text-xs text-stone-500">
      <summary className="cursor-pointer select-none">Report</summary>
      <ActionForm action={flagAction} submitLabel="Send report" className="mt-2 flex max-w-sm flex-col gap-2">
        <input type="hidden" name="targetId" value={targetId} />
        {commentId && <input type="hidden" name="commentId" value={commentId} />}
        <input name="reason" required maxLength={500} placeholder="What's wrong?" className={`${inputCls} text-sm`} />
      </ActionForm>
    </details>
  );
}
