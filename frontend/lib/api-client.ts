// Backend API client（FN-02, FN-06, FN-07, FN-08, FN-09）。
// 画面は API Gateway（NEXT_PUBLIC_API_BASE_URL）を呼び、Firebase の ID トークンを Authorization に付ける。
// デモ・検証環境では X-User-Id / X-User-Role ヘッダーによるペルソナ切り替えもサポートする。
import type { User } from "firebase/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type Role = "admin" | "resident";

export type Me = {
  uid: string;
  email: string | null;
  role: Role;
  building_id: string | null;
  resident_id: string | null;
  unit_id: string | null;
};

export type EmergencyType = "EARTHQUAKE" | "POWER_OUTAGE" | "FIRE" | "FLOOD";
export type EmergencyStatus = "ACTIVE" | "CLOSED";
export type SafetyStatus = "SAFE" | "NEED_HELP" | "OUTSIDE_BUILDING" | "UNKNOWN";
export type TaskStatus =
  | "PENDING"
  | "OFFERED"
  | "APPROVED"
  | "DECLINED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";

export type ReasonCode =
  | "TARGET_RESPONDED"
  | "TARGET_NO_RESPONSE"
  | "BUSY"
  | "UNSAFE"
  | "TIMEOUT";

export type PriorityAlertTarget = {
  resident_id: string;
  unit_id: string;
  room_number: string;
  floor: number;
  safety_status: SafetyStatus;
  is_elderly: boolean;
  is_mobility_difficulty: boolean;
  neighbor_check_result: ReasonCode | null;
  priority_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
};

export type Issue = {
  issue_id: string;
  emergency_id: string;
  issue_type: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
};

export type Task = {
  task_id: string;
  issue_id: string;
  resident_id: string;
  target_resident_id?: string | null;
  task_type: string;
  status: TaskStatus;
  title: string;
  description: string;
  is_disclosed?: boolean;
};

export type SafetyConfirmation = {
  resident_id: string;
  emergency_id: string;
  safety_status: SafetyStatus;
  observed_at: string;
};

export type IssueDetailResponse = {
  issue: Issue;
  tasks: Task[];
  current_states_summary: Record<string, number>;
  resident_states?: Record<string, SafetyStatus>;
  room_states?: Record<string, SafetyStatus>;
  priority_targets: PriorityAlertTarget[];
};

export type TaskDetailResponse = {
  task: Task;
  target_room_number?: string | null;
  target_floor?: number | null;
  target_unit_id?: string | null;
  is_disclosed: boolean;
  latest_event?: unknown;
};

export type AuditEvent = {
  audit_event_id: string;
  emergency_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  data_used?: string[];
  data_disclosed?: string[];
  occurred_at: string;
  // Optional backwards-compatibility fields
  audit_id?: string;
  event_name?: string;
  created_at?: string;
  description?: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// アクティブなデモ・シミュレーション用ペルソナ
export type Persona = {
  userId: string;
  role: Role;
  name: string;
  roomNumber: string;
  desc: string;
};

export const DEMO_PERSONAS: Persona[] = [
  {
    userId: "admin-001",
    role: "admin",
    name: "防災センター（管理人）",
    roomNumber: "防災センター",
    desc: "全館把握・トリアージ発令・現地確認出動",
  },
  {
    userId: "resident-i",
    role: "resident",
    name: "住民 I（301号室）",
    roomNumber: "301",
    desc: "健常単身・在宅・「無事」回答・隣室確認候補",
  },
  {
    userId: "resident-h",
    role: "resident",
    name: "住民 H（302号室）",
    roomNumber: "302",
    desc: "高齢単身・在宅・安否未応答（要確認）",
  },
  {
    userId: "resident-j",
    role: "resident",
    name: "住民 J（303号室）",
    roomNumber: "303",
    desc: "一般世帯・在宅・別住戸確認担当中",
  },
  {
    userId: "resident-k",
    role: "resident",
    name: "住民 K（504号室）",
    roomNumber: "504",
    desc: "カレンダー外出中・Likely Away（低優先）",
  },
];

let activePersona: Persona = DEMO_PERSONAS[1]; // デフォルト: 住民I

export function setActivePersona(persona: Persona) {
  activePersona = persona;
}

export function getActivePersona(): Persona {
  return activePersona;
}

export async function apiFetch<T>(
  user: User | null,
  path: string,
  init: RequestInit = {},
  overridePersona?: Persona,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };

  // FN-02: Never send an unauthenticated request when token acquisition fails.
  if (!user || user.isAnonymous) {
    throw new ApiError(401, "Google アカウントでログインしてください。");
  }
  const idToken = await user.getIdToken();
  headers["Authorization"] = `Bearer ${idToken}`;

  // デモ・ローカル環境用のペルソナヘッダー
  const persona = overridePersona ?? activePersona;
  headers["X-User-Id"] = persona.userId;
  headers["X-User-Role"] = persona.role;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

// 管理用: Firestore データベース完全初期化 & 50戸再シード (不要データ全削除)
export function resetDatabase(
  user: User | null,
): Promise<{
  status: string;
  building_id: string;
  units_count: number;
  residents_count: number;
  message: string;
}> {
  return apiFetch(user, "/admin/reset-database", {
    method: "POST",
  }, DEMO_PERSONAS[0]); // 管理人権限で実行
}

// API-01: 緊急モード発令 (Admin)
export function triggerEmergency(
  user: User | null,
  req: {
    building_id: string;
    emergency_type?: EmergencyType;
    instruction?: string;
  },
): Promise<{ emergency_id: string; issue_id: string; status: EmergencyStatus; triggered_at: string }> {
  return apiFetch(user, "/emergency/trigger", {
    method: "POST",
    body: JSON.stringify(req),
  }, DEMO_PERSONAS[0]); // 管理人権限で実行
}

// API-02: 在館・安否の1タップ応答
export function confirmPresence(
  user: User | null,
  req: {
    emergency_id: string;
    safety_status: SafetyStatus;
    message?: string;
  },
  persona?: Persona,
): Promise<SafetyConfirmation> {
  return apiFetch(user, "/emergency/confirm-presence", {
    method: "POST",
    body: JSON.stringify(req),
  }, persona);
}

// API-03: Issue と配下の Task 一覧・集約・優先アラート取得
export function getIssueDetail(
  user: User | null,
  issueId: string,
  persona?: Persona,
  emergencyId?: string | null,
): Promise<IssueDetailResponse> {
  const query = emergencyId ? `?emergency_id=${encodeURIComponent(emergencyId)}` : "";
  return apiFetch<IssueDetailResponse>(user, `/issues/${issueId}${query}`, {
    method: "GET",
  }, persona);
}

// API-04: 打診への回答 (APPROVED / DECLINED)
export function respondToTask(
  user: User | null,
  taskId: string,
  response: TaskStatus,
  reasonCode?: ReasonCode,
  persona?: Persona,
): Promise<{ task_id: string; status: TaskStatus; event_id: string }> {
  return apiFetch(user, `/tasks/${taskId}/respond`, {
    method: "POST",
    body: JSON.stringify({ response, reason_code: reasonCode }),
  }, persona);
}

// API-05: タスクの開始・完了・失敗の報告
export function reportTask(
  user: User | null,
  taskId: string,
  status: TaskStatus,
  reasonCode?: ReasonCode,
  persona?: Persona,
): Promise<{ task_id: string; status: TaskStatus; event_id: string }> {
  return apiFetch(user, `/tasks/${taskId}/report`, {
    method: "POST",
    body: JSON.stringify({ status, reason_code: reasonCode }),
  }, persona);
}

// API-06: 本人の Task の詳細取得（開示状態含む）
export function getTaskDetail(
  user: User | null,
  taskId: string,
  persona?: Persona,
): Promise<TaskDetailResponse> {
  return apiFetch<TaskDetailResponse>(user, `/tasks/${taskId}`, {
    method: "GET",
  }, persona);
}

// API-07: 監査イベント閲覧
export function getMyAuditEvents(
  user: User | null,
  persona?: Persona,
): Promise<{ audit_events: AuditEvent[] }> {
  return apiFetch<{ audit_events: AuditEvent[] }>(user, "/me/audit-events", {
    method: "GET",
  }, persona);
}

// API-08: トリアージ開始 (Admin)
export function startTriage(
  user: User | null,
  emergencyId: string,
  issueId: string,
): Promise<{
  emergency_id: string;
  issue_id: string;
  tasks_created: number;
  triaged_units_count: number;
  unresponsive_count: number;
  likely_away_count: number;
  assigned_residents: string[];
  ai_reasoning: string;
  agent_model: string;
  policy_gate: string;
}> {
  return apiFetch(user, `/emergencies/${emergencyId}/triage`, {
    method: "POST",
    body: JSON.stringify({ issue_id: issueId }),
  }, DEMO_PERSONAS[0]); // 管理人権限で実行
}

// API-09: ログインユーザーのプロファイル取得
export function getMe(user: User): Promise<Me> {
  return apiFetch<Me>(user, "/me");
}

// FN-10: Agent ガバナンス・ガードレール検証 (Model Armor G2 / IAP G4 / SDP)
export function testGuardrail(
  user: User | null,
  testType: "PROMPT_INJECTION" | "IAP_FORBIDDEN_TOOL" | "SDP_ROOM_LEAK",
): Promise<{
  test_type: string;
  status: "BLOCKED" | "ALLOWED";
  guardrail_layer: string;
  violation_code: string;
  message: string;
}> {
  return apiFetch(user, "/governance/test-guardrail", {
    method: "POST",
    body: JSON.stringify({ test_type: testType }),
  }, DEMO_PERSONAS[0]);
}

