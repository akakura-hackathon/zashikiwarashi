// FN-06 / FN-08: Shared display calculations for emergency progress.
import type { IssueDetailResponse, SafetyConfirmation, SafetyStatus } from "./api-client";

export function safetyCountdown(createdAt: string | undefined, now: number): string {
  const deadline = Date.parse(createdAt ?? "") + 120_000;
  if (!Number.isFinite(deadline)) return "--:--";
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function safetyRoomStatus(safety: SafetyStatus | undefined) {
  switch (safety) {
    case "SAFE": return "safe";
    case "NEED_HELP": return "urgent";
    case "OUTSIDE_BUILDING": return "away";
    default: return "unresponsive";
  }
}

// FN-08: Apply only a server-acknowledged answer to the matching emergency snapshot.
export function applySafetyConfirmation(
  detail: IssueDetailResponse | null,
  answer: SafetyConfirmation,
  roomNumber: string,
): IssueDetailResponse | null {
  if (!detail || detail.issue.emergency_id !== answer.emergency_id) return detail;
  const previous = detail.resident_states?.[answer.resident_id];
  const summary = { ...detail.current_states_summary };
  if (previous !== answer.safety_status) {
    if (previous) summary[previous] = Math.max(0, (summary[previous] ?? 0) - 1);
    summary[answer.safety_status] = (summary[answer.safety_status] ?? 0) + 1;
  }
  return {
    ...detail,
    resident_states: { ...detail.resident_states, [answer.resident_id]: answer.safety_status },
    room_states: { ...detail.room_states, [roomNumber]: answer.safety_status },
    current_states_summary: summary,
  };
}

// FN-08: A triage request alone is not evidence that someone has accepted a visit.
export function incomingCheckStatus(
  detail: IssueDetailResponse | null,
  residentId: string,
  emergencyId: string | null,
): "waiting" | "triaging" | "approved" | "in_progress" {
  if (!detail || detail.issue.emergency_id !== emergencyId || detail.issue.status !== "TRIAGING") {
    return "waiting";
  }
  const checks = detail.tasks.filter((task) =>
    task.issue_id === detail.issue.issue_id &&
    task.target_resident_id === residentId &&
    task.task_type === "NEIGHBOR_CHECK"
  );
  if (checks.some((task) => task.status === "IN_PROGRESS")) return "in_progress";
  if (checks.some((task) => task.status === "APPROVED")) return "approved";
  return "triaging";
}
