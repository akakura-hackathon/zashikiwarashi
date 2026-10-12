// FN-08 / #63: 審査デモガイドの進み具合（docs/DEMO_SPEC.md §1.5）
import type { IssueDetailResponse, Task } from "./api-client";

export const DEMO_RESIDENT_ID = "resident-i"; // 住民（301号室）

export type DemoGuideProgress = {
  done: boolean[]; // 5ステップそれぞれの完了
  current: number; // 現在のステップ（-1 = すべて完了）
  myTask?: Task; // 住民301の最新のタスク
  targetRoom?: string; // その確認先の部屋番号
  reported: boolean; // 住民301が結果を報告した
};

export function demoGuideProgress(input: {
  emergencyId: string | null;
  issueDetail: IssueDetailResponse | null;
  triageCompleted: boolean;
  sawAdminView: boolean;
}): DemoGuideProgress {
  const { emergencyId, issueDetail, triageCompleted, sawAdminView } = input;
  const myTasks = (issueDetail?.tasks ?? [])
    .filter((t) => t.resident_id === DEMO_RESIDENT_ID)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const myTask = myTasks[myTasks.length - 1];
  const targetRoom = issueDetail?.task_board?.find((i) => i.task_id === myTask?.task_id)
    ?.target_room_number;
  const reported = myTask?.status === "COMPLETED";

  const done = [
    !!emergencyId,
    issueDetail?.resident_states?.[DEMO_RESIDENT_ID] === "SAFE",
    triageCompleted || (issueDetail?.tasks.length ?? 0) > 0,
    reported,
    reported && sawAdminView,
  ];
  // 前のステップが終わっていないなら、後のステップは完了扱いにしない
  for (let i = 1; i < done.length; i++) done[i] = done[i] && done[i - 1];
  return { done, current: done.findIndex((d) => !d), myTask, targetRoom, reported };
}
