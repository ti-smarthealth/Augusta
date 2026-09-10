export type LocaleId = "en" | "zh-Hant"

/** Nested translation JSON: namespace -> key -> string (one level of nesting, as authored) */
export type LocaleContent = Record<string, Record<string, string>>

export interface LocaleFile {
  content: LocaleContent
  sha: string
}

export interface TranslationsResponse {
  en: LocaleFile
  "zh-Hant": LocaleFile
  repo?: string
  branch?: string
}

export interface SaveTranslationsRequest {
  locale: LocaleId
  content: LocaleContent
  sha: string
  message: string
}

export interface SaveTranslationsResponse {
  commitUrl?: string
  sha: string
}

/**
 * An article type (migration 010) — a row staff edit, not a fixed vocabulary.
 * The labels live here rather than in the locale files because a category
 * invented this afternoon has no translation key and never will.
 */
/**
 * The three lookup vocabularies whose names reach a patient's screen
 * (migration 014). The slug is what the API routes on.
 */
export const VOCABULARIES = ["genders", "conditions", "medications"] as const
export type VocabularySlug = (typeof VOCABULARIES)[number]

/**
 * One entry. `name_en` is the natural key and is required; `name_zh_hant` is
 * nullable on purpose — staff can add an entry now and translate it later, and
 * the app falls back to English rather than rendering a blank in between.
 */
export interface VocabularyEntry {
  id: number
  name_en: string
  name_zh_hant: string | null
  /** Medication library only; the other two vocabularies are name-only. */
  default_dosage?: string
}

export interface VocabularyListResponse {
  entries: VocabularyEntry[]
  vocabulary: VocabularySlug
}

export interface SaveVocabularyEntryRequest {
  name_en: string
  name_zh_hant: string | null
  default_dosage?: string
}

export interface AnnouncementType {
  id: number
  label_en: string
  label_zh_hant: string | null
  color: string | null
  sort_order: number
  /** Only present on the dedicated types list — what makes a delete refusable up front. */
  article_count?: number
}

export interface AnnouncementTypeListResponse {
  types: AnnouncementType[]
}

export interface SaveAnnouncementTypeRequest {
  label_en: string
  label_zh_hant: string | null
  color: string | null
  sort_order: number
}

/**
 * An article as the editor sees it: both languages, unresolved, drafts included.
 * The app's own read of the same row is the opposite on both counts — resolved
 * to the reader's language, published only.
 */
export interface Announcement {
  id: number
  type_id: number
  type_label_en?: string | null
  type_label_zh_hant?: string | null
  type_color?: string | null
  title_en: string | null
  title_zh_hant: string | null
  content_en: string | null
  content_zh_hant: string | null
  created_at: string
  updated_at: string
  /** NULL means draft. The whole publish state. */
  published_at: string | null
}

export interface AnnouncementListResponse {
  announcements: Announcement[]
  types: AnnouncementType[]
}

export interface SaveAnnouncementRequest {
  type_id: number
  title_en: string
  title_zh_hant: string
  content_en: string
  content_zh_hant: string
  published: boolean
}

export interface TableInfo {
  name: string
  rowCount: number
}

export interface TableListResponse {
  tables: TableInfo[]
}

export interface TableDataResponse {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
  sort: string
  dir: "ASC" | "DESC"
}

// --- Adherence drill-down (TELEMETRY.md §4) --------------------------------

export interface AdherencePatient {
  id: number
  full_name: string | null
  username: string | null
  doses: number
  confirmed: number
  last_dose_at: string | null
}

export interface AdherencePatientListResponse {
  patients: AdherencePatient[]
}

export interface AdherenceSummary {
  total: number
  confirmed: number
  missed: number
  snoozed: number
  /** Confirmed by somebody other than the patient (D-1). Segmented, not averaged in. */
  by_caregiver: number
}

export interface AdherenceDay {
  day: string
  scheduled: number
  confirmed: number
  missed: number
}

/**
 * One bar of the latency histogram, already bucketed by Postgres.
 *
 * `bucket` is a `width_bucket` index over 0–120 minutes in 24 bins, so bucket
 * *n* covers minutes `(n-1)*5` to `n*5`. Bucket 25 is the overflow — anything
 * past two hours — which `width_bucket` returns for out-of-range values.
 */
export interface AdherenceLatencyBucket {
  bucket: number
  n: number
}

export interface AdherenceDose {
  id: number
  user_id: number
  scheduled_for: string
  confirmed_at: string | null
  confirmed_by: number | null
  /** Device clock at the press, telemetry-only (§2). Null on older rows. */
  confirmed_reported_at: string | null
  /** Device clock when the alarm appeared, telemetry-only (§2). */
  alarm_shown_at: string | null
  snoozed_until: string | null
  snooze_count: number
  med_name: string | null
  selected_dosage: string | null
  /** Resolved in SQL against the server clock, never in the browser. */
  status: "confirmed" | "missed" | "scheduled"
}

export interface AdherenceResponse {
  from: string
  to: string
  summary: AdherenceSummary
  daily: AdherenceDay[]
  latency: AdherenceLatencyBucket[]
  timeline: AdherenceDose[]
}

export interface DailyOpen {
  day: string
  source: string
  opens: number
  users: number
  refreshed_at: string
}

export interface DailyOpensResponse {
  opens: DailyOpen[]
}

// --- Metabase power control (TELEMETRY.md §4) ------------------------------

export type MetabaseState =
  | "running"
  | "stopped"
  | "pending"
  | "stopping"
  | "shutting-down"
  | "terminated"
  | "unknown"

export interface MetabaseStatus {
  state: MetabaseState
  /** When it last started. Null while stopped. */
  since: string | null
  /** Mid-transition, so nothing can be asked of it yet. */
  transitional: boolean
}

export interface MetabasePowerResult {
  state: MetabaseState
  /** False when it was already in the requested state — not an error. */
  changed: boolean
}

// --- Operational health ----------------------------------------------------

export type AlarmState = "OK" | "ALARM" | "INSUFFICIENT_DATA"

export interface Alarm {
  name: string
  description: string | null
  state: AlarmState
  reason: string | null
  since: string | null
  /** False when nothing is subscribed — the alarm is a dashboard decoration. */
  notifies: boolean
}

/**
 * One crash signature over the trailing window, aggregated across days by the
 * nightly rollup (migration 013). `sample_stack` is the newest example and is
 * minified in production builds — a hint for triage; the symbolicated truth
 * lives in Athena plus the update's source map.
 */
export interface CrashSummary {
  fingerprint: string
  message: string
  platform: string | null
  fatal: boolean
  crashes: number
  last_seen_at: string | null
  refreshed_at: string | null
  sample_stack: string | null
}

export interface CrashesResponse {
  crashes: CrashSummary[]
  windowDays: number
}

export interface AlarmsResponse {
  alarms: Alarm[]
  inAlarm: number
  /**
   * Confirmed subscriptions on the alarm topics. Zero means no alarm reaches a
   * human, however many are configured. Null if it could not be determined.
   */
  subscribers: number | null
}

// ---------------------------------------------------------------------------
// LINE bot console
// ---------------------------------------------------------------------------

/**
 * The five ways the bot can put a message in front of somebody, and how each
 * one addresses its recipients. Mirrors `TARGETING` in `line/send/line-api.mjs`
 * — the console renders its form from this, so a kind that takes no target
 * cannot grow a target field by accident.
 */
export type LineKind = "reply" | "push" | "multicast" | "broadcast" | "narrowcast"

export interface LineMessageRow {
  id: number
  kind: LineKind
  target: string | null
  payload: string | null
  /** queued means the send was issued and never came back — not "waiting". */
  status: "queued" | "sent" | "failed"
  line_request_id: string | null
  error: string | null
  triggered_by: string | null
  created_at: string
  sent_at: string | null
}

export interface LinePendingRow {
  id: number
  kind: string
  target: string | null
  reason: string | null
  attempts: number
  created_at: string
}

export interface LineLogResponse {
  messages: LineMessageRow[]
  pending: LinePendingRow[]
  /** Rows stuck at `queued` past five minutes: sends that never reported back. */
  stuckCount: number
}

export interface LineRecipient {
  line_user_id: string
  source_type: "user" | "group" | "room"
  /** From LINE's profile API. Null until the bot has seen an event from them. */
  display_name: string | null
  /** Non-null once they have redeemed a link code against a TISH account. */
  user_id: number | null
  full_name: string | null
  locale: string | null
  /** Soft: they blocked the bot or it left the group. The row survives. */
  unfollowed_at: string | null
  linked_at: string
  message_count: number
}

export interface LineRecipientsResponse {
  recipients: LineRecipient[]
}

/** Shape of every result the send function returns, success or failure. */
export interface LineResult<T = unknown> {
  ok: boolean
  status?: number
  requestId?: string | null
  error?: string | null
  data?: T | null
}

export interface LineStatusResponse {
  info: LineResult<{ userId: string; basicId: string; displayName: string; premiumId?: string }>
  quota: LineResult<{
    quota: { type: string; value: number | null } | null
    consumption: { totalUsage: number } | null
  }>
  audiences: LineResult<{ audienceGroups?: { audienceGroupId: number; description: string; audienceCount: number }[] }>
}

export interface SendLineRequest {
  kind: LineKind
  to?: string | string[]
  text?: string
  replyToken?: string
  recipient?: unknown
  filter?: unknown
  limit?: unknown
  /** Must be the literal "BROADCAST" for a broadcast. Guarded server-side too. */
  confirm?: string
}
